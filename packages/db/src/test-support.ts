import { eq, inArray, like, or, sql } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import { auditEvents } from "./schema";

export type AuditEventTestSelector =
  | { actorUserIds: string[] }
  | { requestIdPrefixes: string[] }
  | { resourceId: string };

/**
 * Deletes fixtures protected by the append-only audit guard.
 *
 * This helper deliberately lives outside the main package export and refuses to
 * run unless the connection targets the database declared by TEST_DATABASE_URL.
 */
export async function deleteAuditEventsForTest(
  connection: DatabaseConnection,
  selector: AuditEventTestSelector,
) {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for audit fixture cleanup");

  const expectedDatabase = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
  return connection.db.transaction(async (transaction) => {
    const result = await transaction.execute<{ database: string }>(
      sql`select current_database() as database`,
    );
    if (result[0]?.database !== expectedDatabase) {
      throw new Error("Refusing to delete audit fixtures outside TEST_DATABASE_URL");
    }

    await transaction.execute(sql`select set_config('ntauth.audit_purge', 'enabled', true)`);
    if ("actorUserIds" in selector) {
      if (selector.actorUserIds.length === 0) return [];
      return transaction
        .delete(auditEvents)
        .where(inArray(auditEvents.actorUserId, selector.actorUserIds));
    }
    if ("requestIdPrefixes" in selector) {
      if (selector.requestIdPrefixes.length === 0) return [];
      return transaction
        .delete(auditEvents)
        .where(
          or(
            ...selector.requestIdPrefixes.map((prefix) =>
              like(auditEvents.requestId, `${prefix}%`),
            ),
          ),
        );
    }
    return transaction.delete(auditEvents).where(eq(auditEvents.resourceId, selector.resourceId));
  });
}
