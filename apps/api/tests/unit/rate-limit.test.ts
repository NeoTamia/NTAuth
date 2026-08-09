import { describe, expect, test } from "bun:test";

import { createRequestRateLimiter, type RateLimitStore } from "../../src/rate-limit";

function memoryStore() {
  const counts = new Map<string, number>();
  const locks = new Map<string, number>();
  const failures = new Map<string, number>();
  const store: RateLimitStore = {
    async clearFailures(key) {
      failures.delete(`${key}:failures`);
      locks.delete(`${key}:lock`);
    },
    async consume(key, max, windowSeconds) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        retryAfter: windowSeconds,
      };
    },
    async lockRetryAfter(key) {
      return locks.get(`${key}:lock`) ?? 0;
    },
    async recordFailure(failureKey, lockKey, threshold, _windowSeconds, lockSeconds) {
      const key = `${failureKey}:failures`;
      const count = (failures.get(key) ?? 0) + 1;
      failures.set(key, count);
      if (count >= threshold) locks.set(`${lockKey}:lock`, lockSeconds);
      return count >= threshold ? lockSeconds : 0;
    },
  };
  return { counts, locks, store };
}

function login(email: string, ip = "192.0.2.10") {
  return new Request("https://auth.neotamia.re/api/auth/sign-in/email", {
    body: JSON.stringify({ email, password: "never-inspected" }),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    method: "POST",
  });
}

describe("shared request rate limiter", () => {
  test("enforces IP and pseudonymous subject limits with Retry-After", async () => {
    const memory = memoryStore();
    const limiter = createRequestRateLimiter({
      keySecret: "rate-limit-test-secret-32-characters",
      store: memory.store,
      trustProxyHeaders: true,
    });
    const response = await Array.from({ length: 11 }).reduce<Promise<Response | undefined>>(
      async (previous, _, index) => {
        await previous;
        return limiter.check(login(`user-${index}@example.test`));
      },
      Promise.resolve(undefined),
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify([...memory.counts.keys()])).not.toContain("example.test");
    expect(JSON.stringify([...memory.counts.keys()])).not.toContain("192.0.2.10");
  });

  test("locks only one subject and IP pair after repeated failed logins", async () => {
    const memory = memoryStore();
    const limiter = createRequestRateLimiter({
      keySecret: "rate-limit-test-secret-32-characters",
      store: memory.store,
      trustProxyHeaders: true,
    });
    await Array.from({ length: 8 }).reduce(async (previous) => {
      await previous;
      const request = login("target@example.test");
      expect(await limiter.check(request)).toBeUndefined();
      await limiter.observe(request, 401);
    }, Promise.resolve());
    const locked = await limiter.check(login("target@example.test"));
    expect(locked?.status).toBe(429);
    expect(await locked?.json()).toMatchObject({ code: "locked" });
    expect(await limiter.check(login("target@example.test", "192.0.2.11"))).toBeUndefined();
  });

  test("clears temporary failures after a successful authentication", async () => {
    const memory = memoryStore();
    const limiter = createRequestRateLimiter({
      keySecret: "rate-limit-test-secret-32-characters",
      store: memory.store,
      trustProxyHeaders: true,
    });
    const failed = login("recovered@example.test");
    await limiter.check(failed);
    await limiter.observe(failed, 401);
    const succeeded = login("recovered@example.test");
    await limiter.check(succeeded);
    await limiter.observe(succeeded, 200);
    expect(memory.locks.size).toBe(0);
  });
});
