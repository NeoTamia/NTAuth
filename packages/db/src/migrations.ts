import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { DatabaseConnection } from "./client";

const defaultMigrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

type Journal = {
  entries: Array<{ tag: string; when: number }>;
};

export async function applyMigrations(
  connection: DatabaseConnection,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  await migrate(connection.db, { migrationsFolder });
}

export async function rollbackLastMigration(
  connection: DatabaseConnection,
  migrationsFolder = defaultMigrationsFolder,
): Promise<string> {
  const appliedRows = await connection.client<{ created_at: string; id: number }[]>`
    select id, created_at
    from drizzle.__drizzle_migrations
    order by id desc
    limit 1
  `;
  const latest = appliedRows[0];

  if (!latest) {
    throw new Error("No applied migration to roll back");
  }

  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const entry = journal.entries.find(({ when }) => when === Number(latest.created_at));

  if (!entry) {
    throw new Error("The latest applied migration is not present in the local journal");
  }

  const rollbackSql = await readFile(join(migrationsFolder, `${entry.tag}.down.sql`), "utf8");

  await connection.client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('ntauth_migration_rollback'))`;
    await transaction.unsafe(rollbackSql);
    await transaction`delete from drizzle.__drizzle_migrations where id = ${latest.id}`;
  });

  return entry.tag;
}
