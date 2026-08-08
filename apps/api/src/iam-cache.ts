import { and, eq, isNull } from "drizzle-orm";
import type { RedisClientType } from "redis";

import {
  getEffectivePolicies,
  iamPolicies,
  iamPolicyAttachments,
  type DatabaseConnection,
} from "@neotamia/db";

export const IAM_CACHE_TTL_SECONDS = 5;
const INVALIDATION_EVENT_TTL_SECONDS = 86_400;
const INVALIDATE_SCRIPT = `
local accepted = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1])
if accepted then
  return redis.call('INCR', KEYS[2])
end
return tonumber(redis.call('GET', KEYS[2]) or '0')
`;

export type IamCacheStore = Pick<RedisClientType, "eval" | "get" | "set">;
type EffectivePolicies = Awaited<ReturnType<typeof getEffectivePolicies>>;
type Scope = { organizationId: string; service: string };

function component(value: string) {
  return encodeURIComponent(value);
}

function scopeKey(scope: Scope) {
  return `${component(scope.organizationId)}:${component(scope.service)}`;
}

function validCachedValue(
  value: unknown,
  input: Scope & { userId: string },
): value is EffectivePolicies {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<EffectivePolicies>;
  return (
    candidate.organizationId === input.organizationId &&
    candidate.service === input.service &&
    candidate.subjectUserId === input.userId &&
    typeof candidate.etag === "string" &&
    /^"[0-9a-f]{64}"$/.test(candidate.etag) &&
    Array.isArray(candidate.policies) &&
    Array.isArray(candidate.statements)
  );
}

export function createIamPermissionCache(options: {
  client: IamCacheStore;
  connect: () => Promise<void>;
  database: DatabaseConnection;
  ttlSeconds?: number;
}) {
  const ttlSeconds = options.ttlSeconds ?? IAM_CACHE_TTL_SECONDS;

  const invalidateScope = async (scope: Scope, eventId: string) => {
    try {
      await options.connect();
      const key = scopeKey(scope);
      await options.client.eval(INVALIDATE_SCRIPT, {
        arguments: [String(INVALIDATION_EVENT_TTL_SECONDS)],
        keys: [
          `ntauth:iam:invalidation:${key}:${component(eventId)}`,
          `ntauth:iam:generation:${key}`,
        ],
      });
      return true;
    } catch {
      return false;
    }
  };

  const invalidatePolicy = async (policyId: string, eventId: string) => {
    const [policy] = await options.database.db
      .select({ organizationId: iamPolicies.organizationId, service: iamPolicies.service })
      .from(iamPolicies)
      .where(eq(iamPolicies.id, policyId))
      .limit(1);
    return policy ? invalidateScope(policy, eventId) : false;
  };

  const invalidateGroup = async (groupId: string, eventId: string) => {
    const scopes = await options.database.db
      .selectDistinct({ organizationId: iamPolicies.organizationId, service: iamPolicies.service })
      .from(iamPolicyAttachments)
      .innerJoin(iamPolicies, eq(iamPolicies.id, iamPolicyAttachments.policyId))
      .where(
        and(
          eq(iamPolicyAttachments.principalType, "group"),
          eq(iamPolicyAttachments.principalId, groupId),
          isNull(iamPolicyAttachments.detachedAt),
        ),
      );
    const results = await Promise.all(
      scopes.map((scope) => invalidateScope(scope, `${eventId}:${scopeKey(scope)}`)),
    );
    return results.every(Boolean);
  };

  const get = async (input: Scope & { userId: string }) => {
    try {
      await options.connect();
      const key = scopeKey(input);
      const generation = (await options.client.get(`ntauth:iam:generation:${key}`)) ?? "0";
      const cacheKey = `ntauth:iam:effective:${key}:${component(input.userId)}:${generation}`;
      const cached = await options.client.get(cacheKey);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (validCachedValue(parsed, input)) return parsed;
      }
      const effective = await getEffectivePolicies(options.database, input);
      await options.client.set(cacheKey, JSON.stringify(effective), { EX: ttlSeconds });
      return effective;
    } catch {
      return getEffectivePolicies(options.database, input);
    }
  };

  return { get, invalidateGroup, invalidatePolicy, invalidateScope };
}

export type IamPermissionCache = ReturnType<typeof createIamPermissionCache>;
