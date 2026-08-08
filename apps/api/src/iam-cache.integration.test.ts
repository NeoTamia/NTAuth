import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { createClient, type RedisClientType } from "redis";

import {
  account,
  applyMigrations,
  attachIamPolicy,
  createDatabase,
  createIamPolicy,
  createServiceGrant,
  iamCatalogEntries,
  organizationMembers,
  organizations,
  services,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

import { createApp } from "./app";
import { createAuth } from "./auth/auth";
import { createEffectivePolicyRoutes } from "./effective-policies";
import { createIamPermissionCache, type IamCacheStore } from "./iam-cache";
import { createIamPolicyRoutes } from "./iam-policies";
import { createServiceGrantRoutes } from "./service-grants";

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const describeWithServices = databaseUrl && redisUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

const unavailable = async () => {
  throw new Error("redis unavailable");
};

describeWithServices("IAM permission cache", () => {
  let connection: DatabaseConnection;
  let redis: RedisClientType;
  let cookie: string;
  let grantId: string;
  let policyId: string;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const secret = "iam-cache-api-secret-32-characters";
  const password = "IAM-cache-password-123!";
  const service = `api-cache-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 3 });
    await applyMigrations(connection);
    redis = createClient({ url: redisUrl });
    redis.on("error", () => undefined);
    await redis.connect();
    const email = `iam-cache-${runId}@example.test`;
    await connection.db.insert(user).values({
      email,
      emailVerified: true,
      id: ownerId,
      name: "IAM cache owner",
    });
    await connection.db.insert(account).values({
      accountId: ownerId,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: ownerId,
    });
    await connection.db.insert(organizations).values({
      id: organizationId,
      name: "IAM cache organization",
      slug: `iam-cache-${runId}`,
    });
    await connection.db
      .insert(organizationMembers)
      .values({ organizationId, role: "owner", userId: ownerId });
    await connection.db.insert(services).values({
      key: service,
      name: "IAM cache service",
      ownerUserId: ownerId,
    });
    await connection.db.insert(iamCatalogEntries).values([
      { createdByUserId: ownerId, identifier: action, kind: "action", service },
      { createdByUserId: ownerId, identifier: resource, kind: "resource", service },
    ]);
    const actor = { requestId: `${runId}-setup`, userId: ownerId };
    grantId = (
      await createServiceGrant(connection, { organizationId, service, userId: ownerId }, actor)
    ).id;
    const policy = await createIamPolicy(
      connection,
      {
        document: {
          statements: [{ actions: [action], effect: "Allow", resources: [resource] }],
          version: "2026-01-01",
        },
        name: "Cached policy",
        organizationId,
        service,
      },
      actor,
    );
    policyId = policy.policy.id;
    await attachIamPolicy(
      connection,
      { policyId: policy.policy.id, principalId: "owner", principalType: "role" },
      actor,
    );
    const response = await auth().handler(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({ email, password }),
        headers: { "content-type": "application/json", origin: "http://localhost" },
        method: "POST",
      }),
    );
    cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    if (redis?.isOpen) {
      const keys = await redis.keys(`ntauth:iam:*${organizationId}*`);
      if (keys.length > 0) await redis.del(keys);
      await redis.quit();
    }
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(services).where(eq(services.key, service));
    await connection.db.delete(user).where(eq(user.id, ownerId));
    await connection.close();
  });

  const auth = () =>
    createAuth({
      baseURL,
      connection,
      database: connection.db,
      secret,
      trustedOrigins: ["http://localhost"],
    });

  const connect = async () => {
    if (!redis.isOpen) await redis.connect();
  };

  test("caches with TTL, deduplicates invalidations and revokes end to end", async () => {
    const cache = createIamPermissionCache({ client: redis, connect, database: connection });
    const current = auth();
    const app = createApp({
      authHandler: current.handler,
      effectivePolicyRoutes: createEffectivePolicyRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
        policyCache: cache,
      }),
      iamPolicyRoutes: createIamPolicyRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
        policyCache: cache,
      }),
      serviceGrantRoutes: createServiceGrantRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
        policyCache: cache,
      }),
    });
    const effectiveUrl = `http://localhost/api/v1/iam/effective-policies?organization_id=${organizationId}&service=${service}`;
    const before = await app.handle(new Request(effectiveUrl, { headers: { cookie } }));
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ statements: [{ effect: "Allow" }] });
    const cacheKeys = await redis.keys(`ntauth:iam:effective:*${organizationId}*`);
    expect(cacheKeys).toHaveLength(1);
    expect(await redis.ttl(cacheKeys[0]!)).toBeGreaterThan(0);
    expect(await redis.ttl(cacheKeys[0]!)).toBeLessThanOrEqual(5);

    const scope = { organizationId, service };
    await cache.invalidateScope(scope, `${runId}-same-event`);
    const generationKey = `ntauth:iam:generation:${organizationId}:${service}`;
    const generation = await redis.get(generationKey);
    await cache.invalidateScope(scope, `${runId}-same-event`);
    expect(await redis.get(generationKey)).toBe(generation);

    const policyUpdate = await app.handle(
      new Request(`http://localhost/api/v1/iam/policies/${policyId}`, {
        body: JSON.stringify({
          document: {
            statements: [{ actions: [action], effect: "Deny", resources: [resource] }],
            version: "2026-01-01",
          },
          expectedVersion: 1,
        }),
        headers: {
          "content-type": "application/json",
          cookie,
          "x-request-id": `${runId}-policy-update`,
        },
        method: "PUT",
      }),
    );
    expect(policyUpdate.status).toBe(200);
    const afterPolicy = await app.handle(new Request(effectiveUrl, { headers: { cookie } }));
    expect(await afterPolicy.json()).toMatchObject({ statements: [{ effect: "Deny" }] });
    expect(afterPolicy.headers.get("etag")).not.toBe(before.headers.get("etag"));

    const revoked = await app.handle(
      new Request(`http://localhost/api/v1/service-grants/${grantId}`, {
        headers: { cookie, "x-request-id": `${runId}-revoke` },
        method: "DELETE",
      }),
    );
    expect(revoked.status).toBe(204);
    const after = await app.handle(new Request(effectiveUrl, { headers: { cookie } }));
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ policies: [], statements: [] });
    expect(after.headers.get("etag")).not.toBe(afterPolicy.headers.get("etag"));
  });

  test("falls back to PostgreSQL when Redis is unavailable", async () => {
    const store: IamCacheStore = {
      eval: unavailable as IamCacheStore["eval"],
      get: unavailable as IamCacheStore["get"],
      set: unavailable as IamCacheStore["set"],
    };
    const cache = createIamPermissionCache({
      client: store,
      connect: unavailable,
      database: connection,
    });
    await expect(cache.get({ organizationId, service, userId: ownerId })).resolves.toMatchObject({
      policies: [],
      statements: [],
    });
    await expect(cache.invalidateScope({ organizationId, service }, runId)).resolves.toBe(false);
  });
});
