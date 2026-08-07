import { parseDatabaseEnvironment } from "@neotamia/config";
import { applyMigrations, createDatabase } from "@neotamia/db";

import { JobQueue } from "./queue";

const failUntilAttempt = Number.parseInt(process.argv[2] ?? "0", 10);
if (!Number.isInteger(failUntilAttempt) || failUntilAttempt < 0 || failUntilAttempt > 4) {
  throw new Error("The test failure count must be an integer between 0 and 4");
}

const environment = parseDatabaseEnvironment();
const connection = createDatabase(environment.DATABASE_URL, { max: 1 });

try {
  await applyMigrations(connection);
  const queue = new JobQueue(connection, 30_000);
  const id = await queue.enqueue({
    type: "test",
    payload: { failUntilAttempt },
  });
  console.log(`Test job enqueued: ${id}`);
} finally {
  await connection.close();
}
