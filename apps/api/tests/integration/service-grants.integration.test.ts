import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  auditEvents,
  createDatabase,
  organizationMembers,
  organizations,
  serviceGrants,
  services,
  user,
  type DatabaseConnection,
} from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createApp } from "@/app";
import { createAuth } from "@/auth/auth";
import { createServiceGrantRoutes } from "@/service-grants";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("service grant API", () => {
  let connection: DatabaseConnection;
  let cookie: string;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const applicationSecret = "service-grant-api-secret-32-characters";
  const password = "Service-grant-owner-password-123!";

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `service-grant-owner-${runId}@example.test`,
        emailVerified: true,
        id: ownerId,
        name: "Service grant owner",
      },
      {
        email: `service-grant-member-${runId}@example.test`,
        emailVerified: true,
        id: memberId,
        name: "Service grant member",
      },
      {
        email: `service-grant-outsider-${runId}@example.test`,
        emailVerified: true,
        id: outsiderId,
        name: "Service grant outsider",
      },
    ]);
    await connection.db.insert(account).values({
      accountId: ownerId,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: ownerId,
    });
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "API grants", slug: `api-grants-${runId}` },
      { id: otherOrganizationId, name: "Other API grants", slug: `other-api-grants-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId, role: "member", userId: memberId },
      { organizationId: otherOrganizationId, role: "member", userId: outsiderId },
    ]);
    await connection.db
      .insert(services)
      .values({ key: "ntscout", name: "NTScout", ownerUserId: ownerId });
    const signIn = await auth().handler(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({
          email: `service-grant-owner-${runId}@example.test`,
          password,
        }),
        headers: { "content-type": "application/json", origin: "http://localhost" },
        method: "POST",
      }),
    );
    cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    await connection.db.delete(services).where(eq(services.key, "ntscout"));
    await connection.db.delete(user).where(eq(user.id, ownerId));
    await connection.db.delete(user).where(eq(user.id, memberId));
    await connection.db.delete(user).where(eq(user.id, outsiderId));
    await connection.close();
  });

  const auth = () =>
    createAuth({
      baseURL,
      connection,
      database: connection.db,
      secret: applicationSecret,
      trustedOrigins: ["http://localhost"],
    });

  const application = () => {
    const currentAuth = auth();
    return createApp({
      authHandler: currentAuth.handler,
      serviceGrantRoutes: createServiceGrantRoutes({
        applicationSecret,
        auth: currentAuth,
        database: connection,
      }),
    });
  };

  function request(path: string, init: RequestInit = {}, suffix = "request") {
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    headers.set("x-request-id", `${runId}-${suffix}`);
    if (init.body) headers.set("content-type", "application/json");
    return application().handle(
      new Request(`http://localhost/api/v1/service-grants${path}`, { ...init, headers }),
    );
  }

  test("requires authentication and validates its public inputs", async () => {
    const anonymous = await application().handle(
      new Request("http://localhost/api/v1/service-grants", {
        body: JSON.stringify({ organizationId, service: "ntscout", userId: memberId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(anonymous.status).toBe(401);
    expect(
      (
        await request(
          "",
          {
            body: JSON.stringify({ organizationId, service: "NTScout", userId: memberId }),
            method: "POST",
          },
          "invalid",
        )
      ).status,
    ).toBe(400);
  });

  test("creates, lists, disables and revokes a scoped grant", async () => {
    const catalogue = await request("/administration", {}, "administration");
    expect(catalogue.status).toBe(200);
    expect(await catalogue.json()).toMatchObject({
      organizations: [expect.objectContaining({ id: organizationId })],
      services: [expect.objectContaining({ key: "ntscout" })],
    });
    const created = await request(
      "",
      {
        body: JSON.stringify({ organizationId, service: "ntscout", userId: memberId }),
        method: "POST",
      },
      "create",
    );
    expect(created.status).toBe(201);
    const grant = (await created.json()) as { id: string; status: string };
    expect(grant.status).toBe("active");

    const administration = await request(
      `/administration?${new URLSearchParams({ organizationId })}`,
      {},
      "administration-detail",
    );
    expect(administration.status).toBe(200);
    expect(await administration.json()).toMatchObject({
      detail: { members: expect.arrayContaining([expect.objectContaining({ userId: memberId })]) },
      grants: [expect.objectContaining({ id: grant.id })],
    });

    const listed = await request(
      `?${new URLSearchParams({ organizationId, service: "ntscout", userId: memberId })}`,
      {},
      "list",
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([expect.objectContaining({ id: grant.id })]);

    const disabled = await request(
      `/${grant.id}`,
      { body: JSON.stringify({ active: false }), method: "PATCH" },
      "disable",
    );
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({ status: "inactive" });

    const revoked = await request(`/${grant.id}`, { method: "DELETE" }, "revoke");
    expect(revoked.status).toBe(204);
    const [stored] = await connection.db
      .select()
      .from(serviceGrants)
      .where(eq(serviceGrants.id, grant.id));
    expect(stored).toMatchObject({ status: "revoked" });
    const events = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, grant.id));
    expect(events.map((event) => event.requestId)).toEqual(
      expect.arrayContaining([`${runId}-create`, `${runId}-disable`, `${runId}-revoke`]),
    );
  });

  test("rejects a target that belongs to another tenant", async () => {
    const response = await request(
      "",
      {
        body: JSON.stringify({ organizationId, service: "ntscout", userId: outsiderId }),
        method: "POST",
      },
      "cross-tenant",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden" });
  });
});
