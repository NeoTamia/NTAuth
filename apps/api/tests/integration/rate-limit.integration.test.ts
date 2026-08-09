import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type RedisClientType } from "redis";

import { createRedisRateLimitStore, type RateLimitStore } from "@/rate-limit";

const redisUrl = process.env.REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis("Redis rate limit storage", () => {
  let client: RedisClientType;
  let store: RateLimitStore;
  const runId = crypto.randomUUID();
  const requestKey = `ntauth:test:rate-limit:${runId}:request`;
  const failureKey = `ntauth:test:rate-limit:${runId}:identity`;
  const lockKey = `ntauth:test:rate-limit:${runId}:identity-ip`;

  beforeAll(async () => {
    client = createClient({ url: redisUrl });
    await client.connect();
    store = createRedisRateLimitStore({ client, connect: async () => undefined });
  });

  afterAll(async () => {
    await client.del([
      requestKey,
      `${failureKey}:failures`,
      `${lockKey}:lock`,
      `${failureKey}:lock`,
    ]);
    await client.quit();
  });

  test("atomically admits only the configured concurrent budget", async () => {
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => store.consume(requestKey, 5, 60)),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(15);
    expect(decisions.every((decision) => decision.retryAfter > 0)).toBe(true);
  });

  test("creates and clears a bounded temporary lock", async () => {
    expect(await store.recordFailure(failureKey, lockKey, 2, 60, 120)).toBe(0);
    expect(await store.recordFailure(failureKey, lockKey, 2, 60, 120)).toBe(120);
    expect(await store.lockRetryAfter(lockKey)).toBeGreaterThan(0);
    await store.clearFailures(lockKey);
    expect(await store.lockRetryAfter(lockKey)).toBe(0);
  });
});
