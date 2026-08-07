import { and, eq } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import {
  account,
  auditEvents,
  organizationMembers,
  platformRoleAssignments,
  session,
  user,
  type UserStatus,
} from "./schema";

type Actor = { requestId: string; userId: string };
export type ReversibleUserStatus = "active" | "deactivated" | "suspended";

export class UserLifecycleAuthorizationError extends Error {
  constructor() {
    super("The actor is not allowed to manage user lifecycle");
    this.name = "UserLifecycleAuthorizationError";
  }
}

export class UserLifecycleNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "UserLifecycleNotFoundError";
  }
}

export class InvalidUserLifecycleTransitionError extends Error {
  constructor() {
    super("Invalid user lifecycle transition");
    this.name = "InvalidUserLifecycleTransitionError";
  }
}

async function isPlatformAdmin(
  transaction: Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0],
  userId: string,
) {
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

async function auditDenied(
  transaction: Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0],
  action: string,
  targetUserId: string,
  actor: Actor,
) {
  await transaction.insert(auditEvents).values({
    action,
    actorUserId: actor.userId,
    metadata: { targetUserId },
    outcome: "denied",
    requestId: actor.requestId,
    resourceId: targetUserId,
    resourceType: "user",
  });
}

export async function setUserStatus(
  connection: DatabaseConnection,
  input: { status: ReversibleUserStatus; userId: string },
  actor: Actor,
  now = new Date(),
) {
  const action = {
    active: "user.reactivate",
    deactivated: "user.deactivate",
    suspended: "user.suspend",
  }[input.status];
  const result = await connection.db.transaction(async (transaction) => {
    if (!(await isPlatformAdmin(transaction, actor.userId))) {
      await auditDenied(transaction, action, input.userId, actor);
      return { kind: "denied" as const };
    }

    const [current] = await transaction
      .select({ status: user.status })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!current) return { kind: "not_found" as const };
    if (current.status === "deleted" || current.status === input.status)
      return { kind: "invalid" as const };

    const [updated] = await transaction
      .update(user)
      .set({ status: input.status, statusChangedAt: now, updatedAt: now })
      .where(eq(user.id, input.userId))
      .returning({ id: user.id, status: user.status });

    const revoked = await transaction
      .delete(session)
      .where(eq(session.userId, input.userId))
      .returning({ id: session.id });
    await transaction.insert(auditEvents).values({
      action,
      actorUserId: actor.userId,
      metadata: {
        previousStatus: current.status,
        revokedSessionCount: revoked.length,
        status: input.status,
      },
      outcome: "success",
      requestId: actor.requestId,
      resourceId: input.userId,
      resourceType: "user",
    });
    return { kind: "success" as const, user: updated! };
  });

  if (result.kind === "denied") throw new UserLifecycleAuthorizationError();
  if (result.kind === "not_found") throw new UserLifecycleNotFoundError();
  if (result.kind === "invalid") throw new InvalidUserLifecycleTransitionError();
  return result.user;
}

export async function deleteUser(
  connection: DatabaseConnection,
  userId: string,
  actor: Actor,
  now = new Date(),
) {
  const result = await connection.db.transaction(async (transaction) => {
    if (!(await isPlatformAdmin(transaction, actor.userId))) {
      await auditDenied(transaction, "user.delete", userId, actor);
      return { kind: "denied" as const };
    }

    const [current] = await transaction
      .select({ status: user.status })
      .from(user)
      .where(eq(user.id, userId))
      .for("update")
      .limit(1);
    if (!current) return { kind: "not_found" as const };
    if (current.status === "deleted") return { kind: "invalid" as const };

    await transaction.delete(session).where(eq(session.userId, userId));
    await transaction.delete(account).where(eq(account.userId, userId));
    await transaction.delete(organizationMembers).where(eq(organizationMembers.userId, userId));
    await transaction
      .delete(platformRoleAssignments)
      .where(eq(platformRoleAssignments.userId, userId));
    const [deleted] = await transaction
      .update(user)
      .set({
        deletedAt: now,
        email: `deleted+${userId}@invalid.ntauth.local`,
        emailVerified: false,
        image: null,
        name: "Deleted user",
        status: "deleted",
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(eq(user.id, userId))
      .returning({ deletedAt: user.deletedAt, id: user.id, status: user.status });
    await transaction.insert(auditEvents).values({
      action: "user.delete",
      actorUserId: actor.userId,
      metadata: { previousStatus: current.status, retention: "audit_identity_only" },
      outcome: "success",
      requestId: actor.requestId,
      resourceId: userId,
      resourceType: "user",
    });
    return { kind: "success" as const, user: deleted! };
  });

  if (result.kind === "denied") throw new UserLifecycleAuthorizationError();
  if (result.kind === "not_found") throw new UserLifecycleNotFoundError();
  if (result.kind === "invalid") throw new InvalidUserLifecycleTransitionError();
  return result.user;
}

export async function isUserActive(connection: DatabaseConnection, userId: string) {
  const [active] = await connection.db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.status, "active")))
    .limit(1);
  return Boolean(active);
}

export function permitsAuthentication(status: UserStatus) {
  return status === "active";
}
