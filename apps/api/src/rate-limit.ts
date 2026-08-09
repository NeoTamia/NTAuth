import type { RedisClientType } from "redis";

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('TTL', KEYS[1])
if count > tonumber(ARGV[1]) then return {0, ttl, count} end
return {1, ttl, count}
`;
const FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if count >= tonumber(ARGV[1]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return tonumber(ARGV[3])
end
return 0
`;

export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfter: number };
export interface RateLimitStore {
  clearFailures(key: string): Promise<void>;
  consume(key: string, max: number, windowSeconds: number): Promise<RateLimitDecision>;
  lockRetryAfter(key: string): Promise<number>;
  recordFailure(
    failureKey: string,
    lockKey: string,
    threshold: number,
    windowSeconds: number,
    lockSeconds: number,
  ): Promise<number>;
}

type RedisStore = Pick<RedisClientType, "del" | "eval" | "ttl">;

export function createRedisRateLimitStore(options: {
  client: RedisStore;
  connect: () => Promise<void>;
}): RateLimitStore {
  return {
    async clearFailures(key) {
      await options.connect();
      await options.client.del([`${key}:failures`, `${key}:lock`]);
    },
    async consume(key, max, windowSeconds) {
      await options.connect();
      const result = (await options.client.eval(CONSUME_SCRIPT, {
        arguments: [String(max), String(windowSeconds)],
        keys: [key],
      })) as [number, number, number];
      return {
        allowed: result[0] === 1,
        remaining: Math.max(0, max - result[2]),
        retryAfter: Math.max(1, result[1]),
      };
    },
    async lockRetryAfter(key) {
      await options.connect();
      return Math.max(0, await options.client.ttl(`${key}:lock`));
    },
    async recordFailure(failureKey, lockKey, threshold, windowSeconds, lockSeconds) {
      await options.connect();
      return Number(
        await options.client.eval(FAILURE_SCRIPT, {
          arguments: [String(threshold), String(windowSeconds), String(lockSeconds)],
          keys: [`${failureKey}:failures`, `${lockKey}:lock`],
        }),
      );
    },
  };
}

type Rule = {
  id: string;
  lockout?: { seconds: number; threshold: number; windowSeconds: number };
  max: number;
  method: string;
  path: string;
  subject: "client_id" | "email" | "token";
  windowSeconds: number;
};

export type RateLimitConfiguration = {
  lockoutSeconds: number;
  lockoutThreshold: number;
  loginMax: number;
  loginWindowSeconds: number;
  oauthMax: number;
  oauthWindowSeconds: number;
  recoveryMax: number;
  recoveryWindowSeconds: number;
};

export const DEFAULT_RATE_LIMIT_CONFIGURATION: RateLimitConfiguration = {
  lockoutSeconds: 15 * 60,
  lockoutThreshold: 8,
  loginMax: 10,
  loginWindowSeconds: 60,
  oauthMax: 30,
  oauthWindowSeconds: 60,
  recoveryMax: 5,
  recoveryWindowSeconds: 5 * 60,
};

function rules(configuration: RateLimitConfiguration): readonly Rule[] {
  return [
    {
      id: "login",
      lockout: {
        seconds: configuration.lockoutSeconds,
        threshold: configuration.lockoutThreshold,
        windowSeconds: configuration.lockoutSeconds,
      },
      max: configuration.loginMax,
      method: "POST",
      path: "/api/auth/sign-in/email",
      subject: "email",
      windowSeconds: configuration.loginWindowSeconds,
    },
    {
      id: "password-forgot",
      max: configuration.recoveryMax,
      method: "POST",
      path: "/api/v1/password/forgot",
      subject: "email",
      windowSeconds: configuration.recoveryWindowSeconds,
    },
    {
      id: "password-reset",
      max: configuration.recoveryMax * 2,
      method: "POST",
      path: "/api/v1/password/reset",
      subject: "token",
      windowSeconds: configuration.recoveryWindowSeconds,
    },
    {
      id: "invitation-validate",
      max: configuration.recoveryMax * 4,
      method: "GET",
      path: "/api/v1/invitations/validate",
      subject: "token",
      windowSeconds: configuration.recoveryWindowSeconds,
    },
    {
      id: "invitation-accept",
      max: configuration.recoveryMax,
      method: "POST",
      path: "/api/v1/invitations/accept",
      subject: "token",
      windowSeconds: configuration.recoveryWindowSeconds,
    },
    {
      id: "oauth-authorize",
      max: configuration.oauthMax,
      method: "GET",
      path: "/api/auth/oauth2/authorize",
      subject: "client_id",
      windowSeconds: configuration.oauthWindowSeconds,
    },
    {
      id: "oauth-token",
      max: configuration.oauthMax,
      method: "POST",
      path: "/api/auth/oauth2/token",
      subject: "client_id",
      windowSeconds: configuration.oauthWindowSeconds,
    },
  ];
}

type RequestScope = { compositeKey: string; lockout?: Rule["lockout"]; ruleId: string };

function rateLimitProblem(retryAfter: number, reason: "locked" | "rate_limited") {
  return Response.json(
    {
      code: reason,
      status: 429,
      title: reason === "locked" ? "Authentication temporarily locked" : "Too many requests",
      type: `urn:ntauth:error:${reason}`,
    },
    {
      headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfter))) },
      status: 429,
    },
  );
}

function unavailableProblem() {
  return Response.json(
    {
      code: "rate_limit_unavailable",
      status: 503,
      title: "Authentication protection is temporarily unavailable",
      type: "urn:ntauth:error:rate_limit_unavailable",
    },
    { headers: { "retry-after": "1" }, status: 503 },
  );
}

function clientAddress(request: Request, trustProxyHeaders: boolean) {
  if (!trustProxyHeaders) return "direct";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const value = forwarded || real;
  return value && /^[0-9a-f:.]{2,45}$/i.test(value) ? value.toLowerCase() : "unknown";
}

async function requestInput(request: Request) {
  const url = new URL(request.url);
  if (request.method === "GET") return Object.fromEntries(url.searchParams);
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const value = (await request.clone().json()) as unknown;
      return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(await request.clone().text()));
    }
  } catch {
    return {};
  }
  return {};
}

async function keyedHash(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  ).toString("base64url");
}

export function createRequestRateLimiter(options: {
  configuration?: RateLimitConfiguration;
  keySecret: string;
  store: RateLimitStore;
  trustProxyHeaders: boolean;
}) {
  const scopes = new WeakMap<Request, RequestScope>();
  const configuredRules = rules(options.configuration ?? DEFAULT_RATE_LIMIT_CONFIGURATION);

  async function check(request: Request) {
    const url = new URL(request.url);
    const rule = configuredRules.find(
      (candidate) => candidate.method === request.method && candidate.path === url.pathname,
    );
    if (!rule) return;
    const input = await requestInput(request);
    const subjectValue = input[rule.subject];
    const normalizedSubject =
      typeof subjectValue === "string" && subjectValue.length <= 2_048
        ? subjectValue.trim().toLowerCase()
        : "unknown";
    const [ipHash, subjectHash] = await Promise.all([
      keyedHash(options.keySecret, clientAddress(request, options.trustProxyHeaders)),
      keyedHash(options.keySecret, normalizedSubject),
    ]);
    const prefix = `ntauth:rate-limit:${rule.id}`;
    const compositeKey = `${prefix}:lock:${subjectHash}:${ipHash}`;
    scopes.set(request, { compositeKey, lockout: rule.lockout, ruleId: rule.id });
    try {
      const lockedFor = rule.lockout ? await options.store.lockRetryAfter(compositeKey) : 0;
      if (lockedFor > 0) {
        scopes.delete(request);
        return rateLimitProblem(lockedFor, "locked");
      }

      const [ipDecision, subjectDecision] = await Promise.all([
        options.store.consume(`${prefix}:ip:${ipHash}`, rule.max, rule.windowSeconds),
        options.store.consume(`${prefix}:subject:${subjectHash}`, rule.max * 3, rule.windowSeconds),
      ]);
      if (!ipDecision.allowed || !subjectDecision.allowed) {
        scopes.delete(request);
        return rateLimitProblem(
          Math.max(ipDecision.retryAfter, subjectDecision.retryAfter),
          "rate_limited",
        );
      }
    } catch {
      scopes.delete(request);
      return unavailableProblem();
    }
  }

  async function observe(request: Request, status: number) {
    const scope = scopes.get(request);
    if (!scope?.lockout) return;
    try {
      if (status < 400) {
        await options.store.clearFailures(scope.compositeKey);
        return;
      }
      await options.store.recordFailure(
        scope.compositeKey,
        scope.compositeKey,
        scope.lockout.threshold,
        scope.lockout.windowSeconds,
        scope.lockout.seconds,
      );
    } catch {
      // The next protected request fails closed in check(); response delivery must not be changed.
    }
  }

  return { check, observe };
}

export type RequestRateLimiter = ReturnType<typeof createRequestRateLimiter>;
