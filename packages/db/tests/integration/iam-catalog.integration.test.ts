import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { validatePolicyDocument } from "@neotamia/permissions";

import { createDatabase, type DatabaseConnection } from "@/client";
import { deleteAuditEventsForTest } from "@/test-support";
import {
  createIamCatalogEntry,
  createService,
  getServiceCatalogue,
  IamCatalogAuthorizationError,
  IamCatalogConflictError,
  IamCatalogNotFoundError,
  setIamCatalogEntryStatus,
  updateService,
} from "@/iam-catalog";
import { applyMigrations } from "@/migrations";
import { auditEvents, platformRoleAssignments, services, user } from "@/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("IAM service catalogue", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const nextOwnerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const actor = (userId: string, suffix: string) => ({
    requestId: `${runId}-${suffix}`,
    userId,
  });

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values(
      [adminId, ownerId, nextOwnerId, outsiderId].map((id, index) => ({
        email: `catalog-${index}-${runId}@example.test`,
        emailVerified: true,
        id,
        name: `Catalogue user ${index}`,
      })),
    );
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.db.delete(services).where(eq(services.key, "ntscout-test"));
    await Promise.all(
      [adminId, ownerId, nextOwnerId, outsiderId].map((id) =>
        connection.db.delete(user).where(eq(user.id, id)),
      ),
    );
    await connection.close();
  });

  test("creates one owned service with unique action and resource names", async () => {
    const service = await createService(
      connection,
      { key: "ntscout-test", name: "NTScout test", ownerUserId: ownerId },
      actor(adminId, "service-create"),
    );
    expect(service).toMatchObject({ key: "ntscout-test", ownerUserId: ownerId, status: "active" });
    await expect(
      createService(
        connection,
        { key: "Invalid", name: "Invalid", ownerUserId: ownerId },
        actor(adminId, "service-invalid"),
      ),
    ).rejects.toBeInstanceOf(IamCatalogConflictError);
    await expect(
      createService(
        connection,
        { key: "ntscout-test", name: "Duplicate", ownerUserId: ownerId },
        actor(adminId, "service-duplicate"),
      ),
    ).rejects.toBeInstanceOf(IamCatalogConflictError);

    const action = await createIamCatalogEntry(
      connection,
      {
        description: "Read one report",
        identifier: "ntscout-test:report:read",
        kind: "action",
        service: "ntscout-test",
      },
      actor(ownerId, "action-create"),
    );
    const resource = await createIamCatalogEntry(
      connection,
      {
        identifier: "ntscout-test:report:*",
        kind: "resource",
        service: "ntscout-test",
      },
      actor(ownerId, "resource-create"),
    );
    expect(action.kind).toBe("action");
    expect(resource.kind).toBe("resource");
    await expect(
      createIamCatalogEntry(
        connection,
        { identifier: action.identifier, kind: "action", service: "ntscout-test" },
        actor(ownerId, "action-duplicate"),
      ),
    ).rejects.toBeInstanceOf(IamCatalogConflictError);
    await expect(
      createIamCatalogEntry(
        connection,
        { identifier: "other:report:read", kind: "action", service: "ntscout-test" },
        actor(ownerId, "action-cross-owner"),
      ),
    ).rejects.toBeInstanceOf(IamCatalogConflictError);

    const catalogue = await getServiceCatalogue(connection, "ntscout-test");
    expect(catalogue.actions.map((entry) => entry.identifier)).toEqual([action.identifier]);
    expect(catalogue.resources.map((entry) => entry.identifier)).toEqual([resource.identifier]);
    expect(
      validatePolicyDocument(
        {
          statements: [
            { actions: [action.identifier], effect: "Allow", resources: [resource.identifier] },
          ],
          version: "2026-01-01",
        },
        {
          actions: new Set(catalogue.actions.map((entry) => entry.identifier)),
          expectedService: "ntscout-test",
          resources: new Set(catalogue.resources.map((entry) => entry.identifier)),
        },
      ).ok,
    ).toBe(true);
    expect(
      validatePolicyDocument(
        {
          statements: [
            {
              actions: ["ntscout-test:report:delete"],
              effect: "Allow",
              resources: [resource.identifier],
            },
          ],
          version: "2026-01-01",
        },
        {
          actions: new Set(catalogue.actions.map((entry) => entry.identifier)),
          expectedService: "ntscout-test",
          resources: new Set(catalogue.resources.map((entry) => entry.identifier)),
        },
      ).ok,
    ).toBe(false);
  });

  test("enforces ownership, entry status and service status fail-closed", async () => {
    await expect(
      createIamCatalogEntry(
        connection,
        { identifier: "ntscout-test:report:write", kind: "action", service: "ntscout-test" },
        actor(outsiderId, "outsider-create"),
      ),
    ).rejects.toBeInstanceOf(IamCatalogAuthorizationError);
    const catalogue = await getServiceCatalogue(connection, "ntscout-test");
    const action = catalogue.actions[0]!;
    await setIamCatalogEntryStatus(
      connection,
      { entryId: action.id, status: "inactive" },
      actor(ownerId, "action-disable"),
    );
    expect((await getServiceCatalogue(connection, "ntscout-test")).actions).toEqual([]);

    await expect(
      updateService(
        connection,
        { key: "ntscout-test", ownerUserId: nextOwnerId },
        actor(ownerId, "owner-transfer-denied"),
      ),
    ).rejects.toBeInstanceOf(IamCatalogAuthorizationError);
    const transferred = await updateService(
      connection,
      { key: "ntscout-test", ownerUserId: nextOwnerId },
      actor(adminId, "owner-transfer"),
    );
    expect(transferred.ownerUserId).toBe(nextOwnerId);
    await updateService(
      connection,
      { key: "ntscout-test", status: "inactive" },
      actor(nextOwnerId, "service-disable"),
    );
    await expect(getServiceCatalogue(connection, "ntscout-test")).rejects.toBeInstanceOf(
      IamCatalogNotFoundError,
    );

    const denied = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.outcome, "denied"));
    expect(
      denied.filter((event) => event.requestId.startsWith(runId)).map((event) => event.requestId),
    ).toEqual(
      expect.arrayContaining([`${runId}-outsider-create`, `${runId}-owner-transfer-denied`]),
    );
  });
});
