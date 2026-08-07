import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { applyMigrations, createDatabase, type DatabaseConnection } from "@neotamia/db";

import { JobQueue } from "./queue";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("persistent job queue", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
  });

  beforeEach(async () => {
    await connection.client`delete from jobs`;
  });

  afterAll(async () => {
    await connection.close();
  });

  test("persists a retry and then completes the same job", async () => {
    const queue = new JobQueue(connection, 30_000);
    const id = await queue.enqueue({ payload: { purpose: "integration" }, type: "test" });
    const first = await queue.claim("worker-a");

    expect(first?.id).toBe(id);
    await queue.retry(first!, "worker-a", 0);

    const second = await queue.claim("worker-b");
    expect(second).toMatchObject({ attempts: 2, id });
    await queue.complete(second!, "worker-b");

    const [stored] = await connection.client<{ attempts: number; status: string }[]>`
      select attempts, status from jobs where id = ${id}
    `;
    expect(stored).toEqual({ attempts: 2, status: "completed" });
  });

  test("reclaims an expired lock after a worker interruption", async () => {
    const queue = new JobQueue(connection, 1);
    const id = await queue.enqueue({ payload: {}, type: "test" });

    await queue.claim("interrupted-worker");
    await connection.client`update jobs set locked_at = now() - interval '1 second' where id = ${id}`;
    const reclaimed = await queue.claim("replacement-worker");

    expect(reclaimed).toMatchObject({ attempts: 2, id });
  });
});
