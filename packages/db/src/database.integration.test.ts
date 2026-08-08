import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "./client";
import { applyMigrations, rollbackLastMigration } from "./migrations";
import { systemHealth } from "./schema";

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

  test("rolls the latest migration down and reapplies it", async () => {
    await expect(rollbackLastMigration(connection)).resolves.toBe("0013_steep_daredevil");

    const [serviceGrantsTable] = await connection.client<{ exists: boolean }[]>`
      select to_regclass('public.service_grants') is not null as exists
    `;
    expect(serviceGrantsTable?.exists).toBe(false);

    await applyMigrations(connection);
    const [restoredServiceGrantsTable] = await connection.client<{ exists: boolean }[]>`
      select to_regclass('public.service_grants') is not null as exists
    `;
    expect(restoredServiceGrantsTable?.exists).toBe(true);
    await expect(connection.ping()).resolves.toBeUndefined();
  });
});
