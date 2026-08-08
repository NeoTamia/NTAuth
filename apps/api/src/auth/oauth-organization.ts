import { AsyncLocalStorage } from "node:async_hooks";

import { and, eq, gt } from "drizzle-orm";

import {
  oauthRefreshTokens,
  organizationMembers,
  organizations,
  session,
  verification,
  type DatabaseConnection,
} from "@neotamia/db";

const organizationContext = new AsyncLocalStorage<string>();
const refreshTokenPrefix = "ntauth_refresh_";

type StoredGrantContext =
  | { status: "invalid" }
  | { status: "not-found" }
  | {
      clientId: string;
      grant: "refresh_token";
      organizationId: string;
      refreshTokenId: string;
      revoked: boolean;
      sessionActive: boolean;
      status: "valid";
      userId: string;
    }
  | {
      grant: "authorization_code";
      organizationId: string;
      status: "valid";
      userId: string;
    };

export function currentOAuthOrganization() {
  return organizationContext.getStore();
}

export function withOAuthOrganization<T>(organizationId: string, operation: () => T): T {
  return organizationContext.run(organizationId, operation);
}

export async function hasActiveOrganizationMembership(
  database: DatabaseConnection,
  userId: string,
  organizationId: string,
) {
  const [membership] = await database.db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

function parseAuthorizationCode(
  value: string,
): { referenceId?: string; userId?: string } | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      referenceId: typeof parsed.referenceId === "string" ? parsed.referenceId : undefined,
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function resolveStoredGrantContext(
  database: DatabaseConnection,
  body: URLSearchParams,
): Promise<StoredGrantContext> {
  const grantType = body.get("grant_type");
  if (grantType === "authorization_code") {
    const code = body.get("code");
    if (!code) return { status: "not-found" };
    const [stored] = await database.db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, await tokenHash(code)))
      .limit(1);
    if (!stored) return { status: "not-found" };
    const context = parseAuthorizationCode(stored.value);
    if (!context?.referenceId || !context.userId) return { status: "invalid" };
    return {
      grant: "authorization_code",
      organizationId: context.referenceId,
      status: "valid",
      userId: context.userId,
    };
  }
  if (grantType === "refresh_token") {
    const presented = body.get("refresh_token");
    if (!presented?.startsWith(refreshTokenPrefix)) return { status: "not-found" };
    const [stored] = await database.db
      .select({
        clientId: oauthRefreshTokens.clientId,
        id: oauthRefreshTokens.id,
        organizationId: oauthRefreshTokens.referenceId,
        revoked: oauthRefreshTokens.revoked,
        activeSessionId: session.id,
        userId: oauthRefreshTokens.userId,
      })
      .from(oauthRefreshTokens)
      .leftJoin(
        session,
        and(
          eq(session.id, oauthRefreshTokens.sessionId),
          eq(session.userId, oauthRefreshTokens.userId),
          gt(session.expiresAt, new Date()),
        ),
      )
      .where(
        eq(oauthRefreshTokens.token, await tokenHash(presented.slice(refreshTokenPrefix.length))),
      )
      .limit(1);
    if (!stored) return { status: "not-found" };
    if (!stored.organizationId) return { status: "invalid" };
    return {
      clientId: stored.clientId,
      grant: "refresh_token",
      organizationId: stored.organizationId,
      refreshTokenId: stored.id,
      revoked: Boolean(stored.revoked),
      sessionActive: Boolean(stored.activeSessionId),
      status: "valid",
      userId: stored.userId,
    };
  }
  return { status: "not-found" };
}

export function organizationFromOAuthRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oauth2/authorize")) {
    return url.searchParams.get("organization_id") ?? undefined;
  }
  if (
    request.method === "POST" &&
    (url.pathname.endsWith("/oauth2/consent") || url.pathname.endsWith("/oauth2/continue"))
  ) {
    return request
      .clone()
      .json()
      .then((body: unknown) => {
        if (!body || typeof body !== "object" || !("oauth_query" in body)) return undefined;
        const query = (body as { oauth_query?: unknown }).oauth_query;
        return typeof query === "string"
          ? (new URLSearchParams(query).get("organization_id") ?? undefined)
          : undefined;
      })
      .catch(() => undefined);
  }
  return undefined;
}
