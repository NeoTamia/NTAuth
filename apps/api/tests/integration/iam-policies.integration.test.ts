import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  createDatabase,
  iamCatalogEntries,
  organizationMembers,
  organizations,
  services,
  user,
  type DatabaseConnection,
} from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth/auth";
import { createIamPolicyRoutes } from "../../src/iam-policies";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("IAM policy API", () => {
  let connection: DatabaseConnection;
  let ownerCookie: string;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const secret = "iam-policy-api-secret-32-characters";
  const password = "IAM-policy-password-123!";
  const service = `api-policy-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;
  const document = (effect: "Allow" | "Deny") => ({
    statements: [{ actions: [action], effect, resources: [resource] }],
    version: "2026-01-01",
  });

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 3 });
    await applyMigrations(connection);
    const email = `iam-policy-owner-${runId}@example.test`;
    await connection.db.insert(user).values({
      email,
      emailVerified: true,
      id: ownerId,
      name: "IAM policy owner",
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
      name: "IAM policy API organization",
      slug: `api-policy-${runId}`,
    });
    await connection.db
      .insert(organizationMembers)
      .values({ organizationId, role: "owner", userId: ownerId });
    await connection.db.insert(services).values({
      key: service,
      name: "IAM policy API service",
      ownerUserId: ownerId,
    });
    await connection.db.insert(iamCatalogEntries).values([
      { createdByUserId: ownerId, identifier: action, kind: "action", service },
      { createdByUserId: ownerId, identifier: resource, kind: "resource", service },
    ]);
    const response = await auth().handler(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({ email, password }),
        headers: { "content-type": "application/json", origin: "http://localhost" },
        method: "POST",
      }),
    );
    ownerCookie = response.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
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

  const application = () => {
    const current = auth();
    return createApp({
      authHandler: current.handler,
      iamPolicyRoutes: createIamPolicyRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
      }),
    });
  };

  async function request(path: string, init: RequestInit, suffix: string) {
    const headers = new Headers(init.headers);
    headers.set("cookie", ownerCookie);
    headers.set("x-request-id", `${runId}-${suffix}`);
    if (init.body) headers.set("content-type", "application/json");
    return application().handle(new Request(`http://localhost${path}`, { ...init, headers }));
  }

  test("creates, versions, rejects stale writes, reads history and rolls back", async () => {
    const anonymous = await application().handle(
      new Request("http://localhost/api/v1/iam/policies", { method: "POST" }),
    );
    expect(anonymous.status).toBe(401);

    const created = await request(
      "/api/v1/iam/policies",
      {
        body: JSON.stringify({
          document: document("Allow"),
          name: "Reports",
          organizationId,
          service,
        }),
        method: "POST",
      },
      "create",
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { policy: { id: string } };
    const policyId = createdBody.policy.id;

    const listed = await request(
      `/api/v1/iam/policies?organization_id=${organizationId}&service=${service}`,
      { method: "GET" },
      "list",
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ currentVersion: 1, id: policyId, name: "Reports", service }),
    ]);

    const updated = await request(
      `/api/v1/iam/policies/${policyId}`,
      { body: JSON.stringify({ document: document("Deny"), expectedVersion: 1 }), method: "PUT" },
      "update",
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ version: { version: 2 } });

    const stale = await request(
      `/api/v1/iam/policies/${policyId}`,
      { body: JSON.stringify({ document: document("Allow"), expectedVersion: 1 }), method: "PUT" },
      "stale",
    );
    expect(stale.status).toBe(409);
    expect(stale.headers.get("content-type")).toContain("application/problem+json");

    const rolledBack = await request(
      `/api/v1/iam/policies/${policyId}/rollback`,
      { body: JSON.stringify({ expectedVersion: 2, targetVersion: 1 }), method: "POST" },
      "rollback",
    );
    expect(rolledBack.status).toBe(200);
    expect(await rolledBack.json()).toMatchObject({ version: { sourceVersion: 1, version: 3 } });

    const history = await request(
      `/api/v1/iam/policies/${policyId}/history`,
      { method: "GET" },
      "history",
    );
    expect(history.status).toBe(200);
    expect(((await history.json()) as { versions: unknown[] }).versions).toHaveLength(3);
  });
});
