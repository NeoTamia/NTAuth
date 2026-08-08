import { and, asc, eq } from "drizzle-orm";

import { isPolicyIdentifier } from "@neotamia/permissions";

import type { DatabaseConnection } from "./client";
import {
  auditEvents,
  iamCatalogEntries,
  platformRoleAssignments,
  services,
  user,
  type IamCatalogKind,
  type ServiceStatus,
} from "./schema";

type Actor = { requestId: string; userId: string };
type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

export class IamCatalogAuthorizationError extends Error {
  constructor() {
    super("IAM catalogue operation is not permitted");
    this.name = "IamCatalogAuthorizationError";
  }
}

export class IamCatalogConflictError extends Error {
  constructor() {
    super("IAM catalogue entry conflicts with current state");
    this.name = "IamCatalogConflictError";
  }
}

export class IamCatalogNotFoundError extends Error {
  constructor() {
    super("IAM catalogue resource not found");
    this.name = "IamCatalogNotFoundError";
  }
}

export async function listAvailableServices(connection: DatabaseConnection) {
  return connection.db
    .select({ key: services.key, name: services.name, status: services.status })
    .from(services)
    .where(eq(services.status, "active"))
    .orderBy(asc(services.name), asc(services.key));
}

async function isPlatformAdmin(transaction: Transaction, userId: string) {
  const [assignment] = await transaction
    .select({ userId: platformRoleAssignments.userId })
    .from(platformRoleAssignments)
    .where(
      and(
        eq(platformRoleAssignments.userId, userId),
        eq(platformRoleAssignments.role, "platform_admin"),
      ),
    )
    .limit(1);
  return Boolean(assignment);
}

async function canManageService(transaction: Transaction, actorUserId: string, service: string) {
  if (await isPlatformAdmin(transaction, actorUserId)) return true;
  const [owned] = await transaction
    .select({ key: services.key })
    .from(services)
    .where(and(eq(services.key, service), eq(services.ownerUserId, actorUserId)))
    .limit(1);
  return Boolean(owned);
}

async function audit(
  transaction: Transaction,
  input: {
    action: string;
    actor: Actor;
    identifier?: string;
    outcome: "denied" | "success";
    resourceId?: string;
    resourceType: "iam_catalog_entry" | "service";
    service: string;
  },
) {
  await transaction.insert(auditEvents).values({
    action: input.action,
    actorUserId: input.actor.userId,
    metadata: { identifier: input.identifier ?? null, service: input.service },
    outcome: input.outcome,
    requestId: input.actor.requestId,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });
}

function databaseConflict(error: unknown) {
  let current = error;
  while (current && typeof current === "object") {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function validServiceInput(input: { key: string; name: string }) {
  return (
    /^[a-z][a-z0-9-]{0,62}$/.test(input.key) &&
    input.name.trim().length > 0 &&
    input.name.length <= 160
  );
}

export async function createService(
  connection: DatabaseConnection,
  input: { key: string; name: string; ownerUserId: string },
  actor: Actor,
) {
  if (!validServiceInput(input)) throw new IamCatalogConflictError();
  try {
    const result = await connection.db.transaction(async (transaction) => {
      if (!(await isPlatformAdmin(transaction, actor.userId))) {
        await audit(transaction, {
          action: "iam.service.create",
          actor,
          outcome: "denied",
          resourceType: "service",
          service: input.key,
        });
        return { kind: "denied" as const };
      }
      const [owner] = await transaction
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.ownerUserId), eq(user.status, "active")))
        .limit(1);
      if (!owner) return { kind: "missing" as const };
      const [service] = await transaction.insert(services).values(input).returning();
      await audit(transaction, {
        action: "iam.service.create",
        actor,
        outcome: "success",
        resourceId: service!.key,
        resourceType: "service",
        service: service!.key,
      });
      return { kind: "success" as const, service: service! };
    });
    if (result.kind === "denied") throw new IamCatalogAuthorizationError();
    if (result.kind === "missing") throw new IamCatalogNotFoundError();
    return result.service;
  } catch (error) {
    if (databaseConflict(error)) throw new IamCatalogConflictError();
    throw error;
  }
}

export async function updateService(
  connection: DatabaseConnection,
  input: { key: string; name?: string; ownerUserId?: string; status?: ServiceStatus },
  actor: Actor,
) {
  if (
    !/^[a-z][a-z0-9-]{0,62}$/.test(input.key) ||
    (input.name !== undefined && (input.name.trim().length === 0 || input.name.length > 160))
  ) {
    throw new IamCatalogConflictError();
  }
  const result = await connection.db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(services)
      .where(eq(services.key, input.key))
      .limit(1);
    if (!current) return { kind: "missing" as const };
    const platformAdmin = await isPlatformAdmin(transaction, actor.userId);
    if (
      (!platformAdmin && current.ownerUserId !== actor.userId) ||
      (input.ownerUserId && !platformAdmin)
    ) {
      await audit(transaction, {
        action: "iam.service.update",
        actor,
        outcome: "denied",
        resourceId: current.key,
        resourceType: "service",
        service: current.key,
      });
      return { kind: "denied" as const };
    }
    if (input.ownerUserId) {
      const [owner] = await transaction
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.ownerUserId), eq(user.status, "active")))
        .limit(1);
      if (!owner) return { kind: "missing" as const };
    }
    const [service] = await transaction
      .update(services)
      .set({
        name: input.name ?? current.name,
        ownerUserId: input.ownerUserId ?? current.ownerUserId,
        status: input.status ?? current.status,
        updatedAt: new Date(),
      })
      .where(eq(services.key, input.key))
      .returning();
    await audit(transaction, {
      action: "iam.service.update",
      actor,
      outcome: "success",
      resourceId: service!.key,
      resourceType: "service",
      service: service!.key,
    });
    return { kind: "success" as const, service: service! };
  });
  if (result.kind === "denied") throw new IamCatalogAuthorizationError();
  if (result.kind === "missing") throw new IamCatalogNotFoundError();
  return result.service;
}

export async function createIamCatalogEntry(
  connection: DatabaseConnection,
  input: { description?: string; identifier: string; kind: IamCatalogKind; service: string },
  actor: Actor,
) {
  if (
    !isPolicyIdentifier(input.identifier, input.kind, input.service) ||
    (input.description !== undefined && input.description.length > 500)
  ) {
    throw new IamCatalogConflictError();
  }
  try {
    const result = await connection.db.transaction(async (transaction) => {
      if (!(await canManageService(transaction, actor.userId, input.service))) {
        await audit(transaction, {
          action: "iam.catalog.create",
          actor,
          identifier: input.identifier,
          outcome: "denied",
          resourceType: "iam_catalog_entry",
          service: input.service,
        });
        return { kind: "denied" as const };
      }
      const [service] = await transaction
        .select({ key: services.key })
        .from(services)
        .where(and(eq(services.key, input.service), eq(services.status, "active")))
        .limit(1);
      if (!service) return { kind: "missing" as const };
      const [entry] = await transaction
        .insert(iamCatalogEntries)
        .values({ ...input, createdByUserId: actor.userId })
        .returning();
      await audit(transaction, {
        action: "iam.catalog.create",
        actor,
        identifier: entry!.identifier,
        outcome: "success",
        resourceId: entry!.id,
        resourceType: "iam_catalog_entry",
        service: entry!.service,
      });
      return { entry: entry!, kind: "success" as const };
    });
    if (result.kind === "denied") throw new IamCatalogAuthorizationError();
    if (result.kind === "missing") throw new IamCatalogNotFoundError();
    return result.entry;
  } catch (error) {
    if (databaseConflict(error)) throw new IamCatalogConflictError();
    throw error;
  }
}

export async function setIamCatalogEntryStatus(
  connection: DatabaseConnection,
  input: { entryId: string; status: ServiceStatus },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(iamCatalogEntries)
      .where(eq(iamCatalogEntries.id, input.entryId))
      .limit(1);
    if (!current) return { kind: "missing" as const };
    if (!(await canManageService(transaction, actor.userId, current.service))) {
      await audit(transaction, {
        action: "iam.catalog.status.change",
        actor,
        identifier: current.identifier,
        outcome: "denied",
        resourceId: current.id,
        resourceType: "iam_catalog_entry",
        service: current.service,
      });
      return { kind: "denied" as const };
    }
    const [entry] = await transaction
      .update(iamCatalogEntries)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(iamCatalogEntries.id, input.entryId))
      .returning();
    await audit(transaction, {
      action: "iam.catalog.status.change",
      actor,
      identifier: entry!.identifier,
      outcome: "success",
      resourceId: entry!.id,
      resourceType: "iam_catalog_entry",
      service: entry!.service,
    });
    return { entry: entry!, kind: "success" as const };
  });
  if (result.kind === "denied") throw new IamCatalogAuthorizationError();
  if (result.kind === "missing") throw new IamCatalogNotFoundError();
  return result.entry;
}

export async function getServiceCatalogue(
  connection: DatabaseConnection,
  service: string,
  options: { activeOnly?: boolean } = { activeOnly: true },
) {
  const [registered] = await connection.db
    .select()
    .from(services)
    .where(
      and(
        eq(services.key, service),
        options.activeOnly === false ? undefined : eq(services.status, "active"),
      ),
    )
    .limit(1);
  if (!registered) throw new IamCatalogNotFoundError();
  const entries = await connection.db
    .select()
    .from(iamCatalogEntries)
    .where(
      and(
        eq(iamCatalogEntries.service, service),
        options.activeOnly === false ? undefined : eq(iamCatalogEntries.status, "active"),
      ),
    );
  return {
    actions: entries.filter((entry) => entry.kind === "action"),
    resources: entries.filter((entry) => entry.kind === "resource"),
    service: registered,
  };
}
