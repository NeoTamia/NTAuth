import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  createDatabase,
  encryptTotpSecret,
  generateTotpCode,
  generateTotpSecret,
  mfaEnrollments,
  platformRoleAssignments,
  services,
  totpCounter,
  user,
  type DatabaseConnection,
} from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createApp } from "@/app";
import { createAuth } from "@/auth/auth";
import { createIamCatalogRoutes } from "@/iam-catalog";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("IAM catalogue API", () => {
  let connection: DatabaseConnection;
  let adminCookie: string;
  let ownerCookie: string;
  let outsiderCookie: string;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const secret = "iam-catalogue-api-secret-32-characters";
  const password = "IAM-catalogue-password-123!";
  const totpSecret = generateTotpSecret();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    const identities = [
      { id: adminId, label: "admin" },
      { id: ownerId, label: "owner" },
      { id: outsiderId, label: "outsider" },
    ];
    await connection.db.insert(user).values(
      identities.map(({ id, label }) => ({
        email: `iam-catalog-${label}-${runId}@example.test`,
        emailVerified: true,
        id,
        name: `IAM catalogue ${label}`,
      })),
    );
    await connection.db.insert(account).values(
      await Promise.all(
        identities.map(async ({ id }) => ({
          accountId: id,
          id: crypto.randomUUID(),
          password: await hashPassword(password),
          providerId: "credential",
          userId: id,
        })),
      ),
    );
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
    await connection.db.insert(mfaEnrollments).values({
      encryptedSecret: await encryptTotpSecret(totpSecret, secret),
      lastUsedCounter: totpCounter() - 1,
      userId: adminId,
      verifiedAt: new Date(),
    });
    const cookies = await Promise.all(
      identities.map(async ({ label }) => {
        const response = await auth().handler(
          new Request(`${baseURL}/sign-in/email`, {
            body: JSON.stringify({
              email: `iam-catalog-${label}-${runId}@example.test`,
              password,
            }),
            headers: { "content-type": "application/json", origin: "http://localhost" },
            method: "POST",
          }),
        );
        return response.headers.get("set-cookie")!.split(";")[0]!;
      }),
    );
    adminCookie = cookies[0]!;
    ownerCookie = cookies[1]!;
    outsiderCookie = cookies[2]!;
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.db.delete(services).where(eq(services.key, "api-catalog"));
    await Promise.all(
      [adminId, ownerId, outsiderId].map((id) => connection.db.delete(user).where(eq(user.id, id))),
    );
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
      iamCatalogRoutes: createIamCatalogRoutes({
        applicationSecret: secret,
        auth: current,
        database: connection,
      }),
    });
  };

  async function request(
    path: string,
    init: RequestInit,
    options: { cookie: string; suffix: string; totp?: boolean },
  ) {
    const headers = new Headers(init.headers);
    headers.set("cookie", options.cookie);
    headers.set("x-request-id", `${runId}-${options.suffix}`);
    if (init.body) headers.set("content-type", "application/json");
    if (options.totp) {
      const counter = totpCounter();
      await connection.db
        .update(mfaEnrollments)
        .set({ lastUsedCounter: counter - 1 })
        .where(eq(mfaEnrollments.userId, adminId));
      headers.set("x-ntauth-totp", await generateTotpCode(totpSecret, counter));
    }
    return application().handle(new Request(`http://localhost${path}`, { ...init, headers }));
  }

  test("creates an owned service and exposes only active catalogue entries", async () => {
    const anonymous = await application().handle(
      new Request("http://localhost/api/v1/services", {
        body: JSON.stringify({ key: "api-catalog", name: "API catalogue", ownerUserId: ownerId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(anonymous.status).toBe(401);
    const createdService = await request(
      "/api/v1/services",
      {
        body: JSON.stringify({ key: "api-catalog", name: "API catalogue", ownerUserId: ownerId }),
        method: "POST",
      },
      { cookie: adminCookie, suffix: "service-create", totp: true },
    );
    expect(createdService.status).toBe(201);

    const listedServices = await request(
      "/api/v1/services",
      {},
      { cookie: ownerCookie, suffix: "service-list" },
    );
    expect(listedServices.status).toBe(200);
    expect(await listedServices.json()).toContainEqual({
      key: "api-catalog",
      name: "API catalogue",
      status: "active",
    });

    const action = await request(
      "/api/v1/iam/catalog",
      {
        body: JSON.stringify({
          identifier: "api-catalog:report:read",
          kind: "action",
          service: "api-catalog",
        }),
        method: "POST",
      },
      { cookie: ownerCookie, suffix: "action-create" },
    );
    expect(action.status).toBe(201);
    const actionBody = (await action.json()) as { id: string };
    const resource = await request(
      "/api/v1/iam/catalog",
      {
        body: JSON.stringify({
          identifier: "api-catalog:report:*",
          kind: "resource",
          service: "api-catalog",
        }),
        method: "POST",
      },
      { cookie: ownerCookie, suffix: "resource-create" },
    );
    expect(resource.status).toBe(201);

    const publicCatalogue = await application().handle(
      new Request("http://localhost/api/v1/iam/catalog/api-catalog"),
    );
    expect(publicCatalogue.status).toBe(200);
    const publicBody = (await publicCatalogue.json()) as Record<string, unknown>;
    expect(publicBody).toMatchObject({
      actions: [{ identifier: "api-catalog:report:read" }],
      resources: [{ identifier: "api-catalog:report:*" }],
    });
    expect(JSON.stringify(publicBody)).not.toMatch(/createdByUserId|ownerUserId/);

    const disabled = await request(
      `/api/v1/iam/catalog/${actionBody.id}`,
      { body: JSON.stringify({ status: "inactive" }), method: "PATCH" },
      { cookie: ownerCookie, suffix: "action-disable" },
    );
    expect(disabled.status).toBe(200);
    expect(
      await (
        await application().handle(new Request("http://localhost/api/v1/iam/catalog/api-catalog"))
      ).json(),
    ).toMatchObject({ actions: [], resources: [{ identifier: "api-catalog:report:*" }] });
  });

  test("rejects another owner and cross-service identifiers", async () => {
    const unauthorized = await request(
      "/api/v1/iam/catalog",
      {
        body: JSON.stringify({
          identifier: "api-catalog:report:write",
          kind: "action",
          service: "api-catalog",
        }),
        method: "POST",
      },
      { cookie: outsiderCookie, suffix: "outsider-create" },
    );
    expect(unauthorized.status).toBe(403);
    const crossService = await request(
      "/api/v1/iam/catalog",
      {
        body: JSON.stringify({
          identifier: "other:report:write",
          kind: "action",
          service: "api-catalog",
        }),
        method: "POST",
      },
      { cookie: ownerCookie, suffix: "cross-service" },
    );
    expect(crossService.status).toBe(409);
  });
});
