import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "@/client";
import {
  applyMigrations,
  MigrationLockUnavailableError,
  rollbackLastMigration,
  withMigrationLock,
} from "@/migrations";
import { systemHealth } from "@/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL integration", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
  });

  afterAll(async () => {
    await connection.close();
  });

  test("opens and checks a connection", async () => {
    await expect(connection.ping()).resolves.toBeUndefined();
  });

  test("rolls back an interrupted transaction", async () => {
    const component = `transaction-${crypto.randomUUID()}`;

    await expect(
      connection.db.transaction(async (transaction) => {
        await transaction.insert(systemHealth).values({ component });
        throw new Error("expected rollback");
      }),
    ).rejects.toThrow("expected rollback");

    const rows = await connection.db
      .select()
      .from(systemHealth)
      .where(eq(systemHealth.component, component));
    expect(rows).toHaveLength(0);
  });

  test("fails fast when another production migration owns the advisory lock", async () => {
    const contender = createDatabase(databaseUrl!, { max: 1 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const owner = withMigrationLock(connection, () => held);

    await Bun.sleep(10);
    await expect(withMigrationLock(contender, async () => undefined)).rejects.toBeInstanceOf(
      MigrationLockUnavailableError,
    );
    release();
    await owner;
    await contender.close();
  });

  test("rolls the latest migration down and reapplies it", async () => {
    await expect(rollbackLastMigration(connection)).resolves.toBe("0018_audit_delete_guard");

    const [auditGuard] = await connection.client<{ exists: boolean }[]>`
      select exists (
        select 1 from pg_trigger
        where tgname = 'audit_events_guarded_delete' and not tgisinternal
      ) as exists
    `;
    expect(auditGuard?.exists).toBe(false);

    await applyMigrations(connection);
    const [restoredAuditGuard] = await connection.client<{ exists: boolean }[]>`
      select exists (
        select 1 from pg_trigger
        where tgname = 'audit_events_guarded_delete' and not tgisinternal
      ) as exists
    `;
    expect(restoredAuditGuard?.exists).toBe(true);
    await expect(connection.ping()).resolves.toBeUndefined();
  });
});
