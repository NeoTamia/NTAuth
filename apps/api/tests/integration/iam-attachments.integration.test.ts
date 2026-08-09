import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  createDatabase,
  createIamPolicy,
  iamCatalogEntries,
  organizationMembers,
  organizations,
  services,
  user,
  type DatabaseConnection,
} from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createApp } from "@/app";
import { createAuth } from "@/auth/auth";
import { createIamAttachmentRoutes } from "@/iam-attachments";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("IAM attachment API", () => {
  let connection: DatabaseConnection;
  let ownerCookie: string;
  let policyId: string;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const secret = "iam-attachment-api-secret-32-characters";
  const password = "IAM-attachment-password-123!";
  const service = `api-attachment-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 3 });
    await applyMigrations(connection);
    const email = `iam-attachment-owner-${runId}@example.test`;
    await connection.db.insert(user).values([
      { email, emailVerified: true, id: ownerId, name: "IAM attachment owner" },
      {
        email: `iam-attachment-member-${runId}@example.test`,
        emailVerified: true,
        id: memberId,
        name: "IAM attachment member",
      },
    ]);
    await connection.db.insert(account).values({
      accountId: ownerId,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: ownerId,
    });
    await connection.db.insert(organizations).values({
      id: organizationId,
      name: "IAM attachment API organization",
      slug: `api-attachment-${runId}`,
    });
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId, role: "member", userId: memberId },
    ]);
    await connection.db.insert(services).values({
      key: service,
      name: "IAM attachment API service",
      ownerUserId: ownerId,
    });
    await connection.db.insert(iamCatalogEntries).values([
      { createdByUserId: ownerId, identifier: action, kind: "action", service },
      { createdByUserId: ownerId, identifier: resource, kind: "resource", service },
    ]);
    policyId = (
      await createIamPolicy(
        connection,
        {
          document: {
            statements: [{ actions: [action], effect: "Allow", resources: [resource] }],
            version: "2026-01-01",
          },
          name: "API attachments",
          organizationId,
          service,
        },
        { requestId: `${runId}-policy`, userId: ownerId },
      )
    ).policy.id;
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
    await connection.db.delete(user).where(eq(user.id, memberId));
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
      iamAttachmentRoutes: createIamAttachmentRoutes({
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

  test("manages groups and idempotent policy attachments", async () => {
    const groupResponse = await request(
      "/api/v1/iam/groups",
      { body: JSON.stringify({ name: "Reviewers", organizationId }), method: "POST" },
      "group",
    );
    expect(groupResponse.status).toBe(201);
    const group = (await groupResponse.json()) as { id: string };
    expect(
      (
        await request(
          `/api/v1/iam/groups/${group.id}/members/${memberId}`,
          { method: "PUT" },
          "member",
        )
      ).status,
    ).toBe(201);

    const responses = await Promise.all(
      [
        { principalId: memberId, principalType: "user" },
        { principalId: group.id, principalType: "group" },
        { principalId: "member", principalType: "role" },
      ].map((principal) =>
        request(
          `/api/v1/iam/policies/${policyId}/attachments`,
          { body: JSON.stringify(principal), method: "POST" },
          `attach-${principal.principalType}`,
        ),
      ),
    );
    expect(responses.map(({ status }) => status)).toEqual([201, 201, 201]);
    const attachments = (await Promise.all(responses.map((response) => response.json()))) as {
      id: string;
    }[];
    const duplicate = await request(
      `/api/v1/iam/policies/${policyId}/attachments`,
      {
        body: JSON.stringify({ principalId: "member", principalType: "role" }),
        method: "POST",
      },
      "duplicate",
    );
    expect(duplicate.status).toBe(409);
    const listed = await request(
      `/api/v1/iam/policies/${policyId}/attachments`,
      { method: "GET" },
      "list",
    );
    expect((await listed.json()) as unknown[]).toHaveLength(3);

    const detached = await request(
      `/api/v1/iam/attachments/${attachments[0]!.id}`,
      { method: "DELETE" },
      "detach",
    );
    expect(detached.status).toBe(200);
    const detachedAgain = await request(
      `/api/v1/iam/attachments/${attachments[0]!.id}`,
      { method: "DELETE" },
      "detach-again",
    );
    expect(detachedAgain.status).toBe(200);
  });
});
