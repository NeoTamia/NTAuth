import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  applyMigrations,
  createDatabase,
  transactWithEmail,
  type DatabaseConnection,
} from "@neotamia/db";

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

  test("deduplicates an outbox message and exposes terminal failure", async () => {
    const queue = new JobQueue(connection, 30_000);
    const job = {
      deduplicationKey: "invitation:test@example.test",
      maxAttempts: 1,
      payload: { subject: "Invitation", text: "Body", to: "test@example.test" },
      type: "email",
    } as const;
    const firstId = await queue.enqueue(job);
    const duplicateId = await queue.enqueue(job);
    expect(duplicateId).toBe(firstId);

    const claimed = await queue.claim("smtp-worker");
    await queue.retry(claimed!, "smtp-worker", 0);
    const [stored] = await connection.client<{ lastError: string; status: string }[]>`
      select status, last_error as "lastError" from jobs where id = ${firstId}
    `;
    expect(stored).toEqual({ lastError: "handler_failed", status: "failed" });
  });

  test("commits or rolls back business data and its email atomically", async () => {
    const component = `outbox-${crypto.randomUUID()}`;
    const message = {
      deduplicationKey: component,
      subject: "Invitation",
      text: "Body",
      to: "test@example.test",
    };
    await transactWithEmail(connection, message, async (transaction) => {
      await transaction`insert into system_health (component) values (${component})`;
    });

    const [committed] = await connection.client<{ count: number }[]>`
      select count(*)::int as count from jobs where deduplication_key = ${component}
    `;
    expect(committed?.count).toBe(1);

    const rolledBackComponent = `${component}-rollback`;
    await expect(
      transactWithEmail(
        connection,
        { ...message, deduplicationKey: rolledBackComponent },
        async (transaction) => {
          await transaction`insert into system_health (component) values (${rolledBackComponent})`;
          throw new Error("business_mutation_failed");
        },
      ),
    ).rejects.toThrow("business_mutation_failed");
    const [rolledBack] = await connection.client<{ count: number }[]>`
      select count(*)::int as count
      from jobs
      where deduplication_key = ${rolledBackComponent}
    `;
    expect(rolledBack?.count).toBe(0);
  });
});
