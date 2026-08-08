import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

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

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("effective policy API", () => {
  let connection: DatabaseConnection;
  let cookie: string;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const secret = "effective-policy-api-secret-32-chars";
  const password = "Effective-policy-password-123!";
  const service = `api-effective-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 3 });
    await applyMigrations(connection);
    const email = `effective-policy-${runId}@example.test`;
    await connection.db.insert(user).values({
      email,
      emailVerified: true,
      id: ownerId,
      name: "Effective policy user",
    });
    await connection.db.insert(account).values({
      accountId: ownerId,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: ownerId,
    });
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Effective API organization", slug: `api-effective-${runId}` },
      {
        id: otherOrganizationId,
        name: "Other effective organization",
        slug: `other-api-effective-${runId}`,
      },
    ]);
    await connection.db
      .insert(organizationMembers)
      .values({ organizationId, role: "owner", userId: ownerId });
    await connection.db.insert(services).values({
      key: service,
      name: "Effective API service",
      ownerUserId: ownerId,
    });
    await connection.db.insert(iamCatalogEntries).values([
      { createdByUserId: ownerId, identifier: action, kind: "action", service },
      { createdByUserId: ownerId, identifier: resource, kind: "resource", service },
    ]);
    const actor = { requestId: `${runId}-setup`, userId: ownerId };
    await createServiceGrant(connection, { organizationId, service, userId: ownerId }, actor);
    const policy = await createIamPolicy(
      connection,
      {
        document: {
          statements: [{ actions: [action], effect: "Allow", resources: [resource] }],
          version: "2026-01-01",
        },
        name: "Effective API policy",
        organizationId,
        service,
      },
      actor,
    );
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
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
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
      effectivePolicyRoutes: createEffectivePolicyRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
      }),
    });
  };

  test("resolves only the authenticated subject in the requested scope", async () => {
    const anonymous = await application().handle(
      new Request(
        `http://localhost/api/v1/iam/effective-policies?organization_id=${organizationId}&service=${service}`,
      ),
    );
    expect(anonymous.status).toBe(401);
    const effective = await application().handle(
      new Request(
        `http://localhost/api/v1/iam/effective-policies?organization_id=${organizationId}&service=${service}`,
        { headers: { cookie } },
      ),
    );
    expect(effective.status).toBe(200);
    expect(await effective.json()).toMatchObject({
      organizationId,
      policies: [{ name: "Effective API policy" }],
      service,
      statements: [{ effect: "Allow" }],
      subjectUserId: ownerId,
    });

    const crossTenant = await application().handle(
      new Request(
        `http://localhost/api/v1/iam/effective-policies?organization_id=${otherOrganizationId}&service=${service}`,
        { headers: { cookie } },
      ),
    );
    expect(crossTenant.status).toBe(403);
  });
});
