import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq, like } from "drizzle-orm";

import {
  account,
  applyMigrations,
  auditEvents,
  createDatabase,
  organizationMembers,
  organizations,
  services,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

import { createApp } from "./app";
import { createAuditEventRoutes } from "./audit-events";
import { createAuth } from "./auth/auth";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("IAM audit event API", () => {
  let connection: DatabaseConnection;
  let ownerCookie: string;
  let outsiderCookie: string;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const service = `audit-api-${runId}`;
  const secret = "audit-event-api-secret-32-characters";
  const password = "Audit-events-password-123!";

  const auth = () =>
    createAuth({
      baseURL,
      connection,
      database: connection.db,
      secret,
      trustedOrigins: ["http://localhost"],
    });

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 3 });
    await applyMigrations(connection);
    const identities = [
      { email: `${runId}-owner@example.test`, id: ownerId, name: "Audit owner" },
      { email: `${runId}-outsider@example.test`, id: outsiderId, name: "Audit outsider" },
    ];
    await connection.db
      .insert(user)
      .values(identities.map((identity) => ({ ...identity, emailVerified: true })));
    await connection.db.insert(account).values(
      await Promise.all(
        identities.map(async (identity) => ({
          accountId: identity.id,
          id: crypto.randomUUID(),
          password: await hashPassword(password),
          providerId: "credential",
          userId: identity.id,
        })),
      ),
    );
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Audit API organization", slug: `audit-api-${runId}` },
      { id: otherOrganizationId, name: "Other audit API", slug: `audit-api-other-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId: otherOrganizationId, role: "owner", userId: outsiderId },
    ]);
    await connection.db
      .insert(services)
      .values({ key: service, name: "Audit API service", ownerUserId: ownerId });
    await connection.db.insert(auditEvents).values({
      action: "iam.policy.create",
      actorUserId: ownerId,
      metadata: { service: "ntscout", token: "must-not-leak" },
      organizationId,
      outcome: "success",
      requestId: `${runId}-policy-create`,
      resourceId: crypto.randomUUID(),
      resourceType: "iam_policy",
    });
    await connection.db.insert(auditEvents).values({
      action: "iam.catalog.create",
      actorUserId: ownerId,
      metadata: { identifier: `${service}:report:read`, service },
      outcome: "success",
      requestId: `${runId}-catalogue-create`,
      resourceId: crypto.randomUUID(),
      resourceType: "iam_catalog_entry",
    });

    const current = auth();
    const signIn = async (email: string) => {
      const response = await current.handler(
        new Request(`${baseURL}/sign-in/email`, {
          body: JSON.stringify({ email, password }),
          headers: { "content-type": "application/json", origin: "http://localhost" },
          method: "POST",
        }),
      );
      return response.headers.get("set-cookie")!.split(";")[0]!;
    };
    ownerCookie = await signIn(identities[0]!.email);
    outsiderCookie = await signIn(identities[1]!.email);
  });

  afterAll(async () => {
    await connection.db.delete(auditEvents).where(like(auditEvents.requestId, `${runId}-%`));
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    await connection.db.delete(services).where(eq(services.key, service));
    await connection.db.delete(user).where(eq(user.id, ownerId));
    await connection.db.delete(user).where(eq(user.id, outsiderId));
    await connection.close();
  });

  const app = () => {
    const current = auth();
    return createApp({
      auditEventRoutes: createAuditEventRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
      }),
      authHandler: current.handler,
    });
  };

  test("returns only authorized, filtered and redacted tenant events", async () => {
    const response = await app().handle(
      new Request(
        `http://localhost/api/v1/audit-events?organization_id=${organizationId}&service=ntscout&action=iam.policy.create`,
        { headers: { cookie: ownerCookie } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: unknown[]; retentionDays: number };
    expect(body.events).toHaveLength(1);
    expect(body.retentionDays).toBe(365);
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  test("fails closed for unauthenticated, cross-tenant and malformed queries", async () => {
    const url = `http://localhost/api/v1/audit-events?organization_id=${organizationId}`;
    expect((await app().handle(new Request(url))).status).toBe(401);
    expect(
      (await app().handle(new Request(url, { headers: { cookie: outsiderCookie } }))).status,
    ).toBe(403);
    expect(
      (await app().handle(new Request(`${url}&limit=101`, { headers: { cookie: ownerCookie } })))
        .status,
    ).toBe(400);
    expect(
      (
        await app().handle(
          new Request("http://localhost/api/v1/audit-events?organization_id=invalid", {
            headers: { cookie: ownerCookie },
          }),
        )
      ).status,
    ).toBe(400);
  });

  test("returns global catalogue events only to the service owner", async () => {
    const url = `http://localhost/api/v1/audit-events?service=${service}&action=iam.catalog.create`;
    const allowed = await app().handle(new Request(url, { headers: { cookie: ownerCookie } }));
    expect(allowed.status).toBe(200);
    expect((await allowed.json()) as unknown).toMatchObject({
      events: [{ scope: { organizationId: null, service } }],
    });
    expect(
      (await app().handle(new Request(url, { headers: { cookie: outsiderCookie } }))).status,
    ).toBe(403);
  });
});
