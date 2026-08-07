import { and, eq } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import { auditEvents, platformRoleAssignments, session } from "./schema";

export class SessionRevocationAuthorizationError extends Error {
  constructor() {
    super("The actor is not allowed to revoke this user's sessions");
    this.name = "SessionRevocationAuthorizationError";
  }
}

export async function revokeUserSessions(
  connection: DatabaseConnection,
  input: { reason: "administrative" | "compromised"; userId: string },
  actor: { requestId: string; userId: string },
): Promise<number> {
  const result = await connection.db.transaction(async (transaction) => {
    const [platformAdmin] = await transaction
      .select({ userId: platformRoleAssignments.userId })
      .from(platformRoleAssignments)
      .where(
        and(
          eq(platformRoleAssignments.userId, actor.userId),
          eq(platformRoleAssignments.role, "platform_admin"),
        ),
      )
      .limit(1);

    if (!platformAdmin) {
      await transaction.insert(auditEvents).values({
        action: "user.sessions.revoke",
        actorUserId: actor.userId,
        metadata: { reason: input.reason, targetUserId: input.userId },
        outcome: "denied",
        requestId: actor.requestId,
        resourceId: input.userId,
        resourceType: "user_sessions",
      });
      return null;
    }

    const revoked = await transaction
      .delete(session)
      .where(eq(session.userId, input.userId))
      .returning({ id: session.id });
    await transaction.insert(auditEvents).values({
      action: "user.sessions.revoke",
      actorUserId: actor.userId,
      metadata: {
        reason: input.reason,
        revokedCount: revoked.length,
        targetUserId: input.userId,
      },
      outcome: "success",
      requestId: actor.requestId,
      resourceId: input.userId,
      resourceType: "user_sessions",
    });
    return revoked.length;
  });

  if (result === null) throw new SessionRevocationAuthorizationError();
  return result;
}
