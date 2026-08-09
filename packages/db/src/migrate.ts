import { materializeSecretFiles, parseDatabaseEnvironment } from "@neotamia/config";

import { createDatabase } from "./client";
import { applyMigrations, rollbackLastMigration, withMigrationLock } from "./migrations";

const command = process.argv[2];

if (command !== "up" && command !== "down") {
  throw new Error("Usage: bun src/migrate.ts <up|down>");
}

const environment = parseDatabaseEnvironment(
  await materializeSecretFiles(process.env, ["DATABASE_URL"]),
);
const connection = createDatabase(environment.DATABASE_URL, { max: 1 });

try {
  await withMigrationLock(connection, async () => {
    if (command === "up") {
      await applyMigrations(connection);
      console.log("Database migrations applied");
    } else {
      const migration = await rollbackLastMigration(connection);
      console.log(`Database migration rolled back: ${migration}`);
    }
  });
} finally {
  await connection.close();
}
