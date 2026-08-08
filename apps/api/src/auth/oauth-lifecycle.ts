import type { JSONWebKeySet, JWTPayload } from "better-auth";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { and, eq, gt, isNull, lte } from "drizzle-orm";

import {
  oauthAccessTokens,
  oauthClients,
  oauthRefreshTokens,
  oauthTokenRevocations,
  session,
  type DatabaseConnection,
} from "@neotamia/db";
import { NTSCOUT_AUDIENCE, NTSCOUT_SERVICE } from "@neotamia/permissions";

import type { createAuth } from "./auth";

type Auth = ReturnType<typeof createAuth>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function oauthProblem(status: number, error: string, errorDescription: string) {
  return Response.json(
    { error, error_description: errorDescription },
    {
      headers: status === 401 ? { "www-authenticate": `Bearer error="${error}"` } : undefined,
      status,
    },
  );
}

function oauthIssuer(request: Request) {
  const url = new URL(request.url);
  const [basePath] = url.pathname.split("/oauth2/");
  return `${url.origin}${basePath}`;
}

async function verifyLocalJwt(auth: Auth, request: Request, token: string, audience: string) {
  const issuer = oauthIssuer(request);
  return verifyJwsAccessToken(token, {
    jwksFetch: async () => {
      const response = await auth.handler(new Request(`${issuer}/jwks`));
      if (!response.ok) throw new Error("JWKS unavailable");
      return (await response.json()) as JSONWebKeySet;
    },
    verifyOptions: { algorithms: ["ES256"], audience, issuer },
  });
}

function hasStrictAccessClaims(payload: JWTPayload) {
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  return (
    typeof payload.sub === "string" &&
    payload.azp === NTSCOUT_SERVICE &&
    typeof payload.sid === "string" &&
    typeof payload.jti === "string" &&
    uuidPattern.test(payload.jti) &&
    typeof payload.organization_id === "string" &&
    uuidPattern.test(payload.organization_id) &&
    payload.service === NTSCOUT_SERVICE &&
    typeof payload.policies_etag === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(payload.policies_etag) &&
    scopes.includes("openid") &&
    scopes.includes("ntscout:access")
  );
}

export async function validateUserInfoToken(
  auth: Auth,
  database: DatabaseConnection,
  request: Request,
) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return;
  try {
    const payload = await verifyLocalJwt(
      auth,
      request,
      authorization.slice("Bearer ".length),
      NTSCOUT_AUDIENCE,
    );
    if (!hasStrictAccessClaims(payload)) throw new Error("Invalid access-token claims");
    const [activeSession] = await database.db
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.id, payload.sid as string),
          eq(session.userId, payload.sub as string),
          gt(session.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const [revocation] = await database.db
      .select({ jti: oauthTokenRevocations.jti })
      .from(oauthTokenRevocations)
      .where(
        and(
          eq(oauthTokenRevocations.jti, payload.jti as string),
          gt(oauthTokenRevocations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!activeSession || revocation) throw new Error("Access token is inactive");
    return;
  } catch {
    return oauthProblem(401, "invalid_token", "access token is invalid");
  }
}

export type RevocationContext = {
  clientId: string;
  idempotent: boolean;
  payload?: JWTPayload;
  response?: Response;
  tokenType: "access_token" | "refresh_token" | "unknown";
};

export async function inspectRevocation(
  auth: Auth,
  database: DatabaseConnection,
  request: Request,
): Promise<RevocationContext | undefined> {
  if (request.method !== "POST") return;
  const body = new URLSearchParams(await request.clone().text());
  const clientId = body.get("client_id");
  const token = body.get("token");
  if (!clientId || !token) return;
  const hint = body.get("token_type_hint");
  const tokenType =
    hint === "refresh_token"
      ? "refresh_token"
      : hint === "access_token" || token.split(".").length === 3
        ? "access_token"
        : "unknown";
  const [client] = await database.db
    .select({
      clientId: oauthClients.clientId,
      disabled: oauthClients.disabled,
      public: oauthClients.public,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!client || client.disabled) return;
  const idempotent = client.public === true;
  if (tokenType !== "access_token") return { clientId, idempotent, tokenType };
  if (!idempotent) return { clientId, idempotent, tokenType };
  try {
    const payload = await verifyLocalJwt(auth, request, token, NTSCOUT_AUDIENCE);
    if (payload.azp !== clientId || !hasStrictAccessClaims(payload)) {
      return {
        clientId,
        idempotent,
        response: new Response(null, { status: 200 }),
        tokenType,
      };
    }
    return { clientId, idempotent, payload, tokenType };
  } catch {
    return {
      clientId,
      idempotent,
      response: new Response(null, { status: 200 }),
      tokenType,
    };
  }
}

export async function persistAccessTokenRevocation(
  database: DatabaseConnection,
  context: RevocationContext,
) {
  const payload = context.payload;
  if (
    !payload ||
    typeof payload.jti !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return;
  }
  await database.db
    .delete(oauthTokenRevocations)
    .where(lte(oauthTokenRevocations.expiresAt, new Date()));
  await database.db
    .insert(oauthTokenRevocations)
    .values({
      clientId: context.clientId,
      expiresAt: new Date(payload.exp * 1000),
      jti: payload.jti,
      sessionId: payload.sid,
      userId: payload.sub,
    })
    .onConflictDoUpdate({
      set: { expiresAt: new Date(payload.exp * 1000), revokedAt: new Date() },
      target: oauthTokenRevocations.jti,
    });
}

export async function enforceIntrospectionState(database: DatabaseConnection, response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }
  const payload = (await response
    .clone()
    .json()
    .catch(() => undefined)) as
    | { active?: unknown; jti?: unknown; sid?: unknown; sub?: unknown }
    | undefined;
  if (payload?.active !== true) return response;
  const activeSession =
    typeof payload.sid === "string" && typeof payload.sub === "string"
      ? await database.db
          .select({ id: session.id })
          .from(session)
          .where(
            and(
              eq(session.id, payload.sid),
              eq(session.userId, payload.sub),
              gt(session.expiresAt, new Date()),
            ),
          )
          .limit(1)
      : [];
  const revocation =
    typeof payload.jti === "string"
      ? await database.db
          .select({ jti: oauthTokenRevocations.jti })
          .from(oauthTokenRevocations)
          .where(
            and(
              eq(oauthTokenRevocations.jti, payload.jti),
              gt(oauthTokenRevocations.expiresAt, new Date()),
            ),
          )
          .limit(1)
      : [];
  return activeSession.length > 0 && revocation.length === 0
    ? response
    : Response.json({ active: false });
}

type LogoutResult = {
  clientId?: string;
  response: Response;
  sessionId?: string;
  userId?: string;
};

function unverifiedAudience(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as {
      aud?: unknown;
    };
    return typeof payload.aud === "string" ? payload.aud : undefined;
  } catch {
    return;
  }
}

export async function handleOidcLogout(
  auth: Auth,
  database: DatabaseConnection,
  request: Request,
): Promise<LogoutResult> {
  const query = new URL(request.url).searchParams;
  const idToken = query.get("id_token_hint");
  const clientId = query.get("client_id") ?? (idToken ? unverifiedAudience(idToken) : undefined);
  if (!idToken || !clientId) {
    return { response: oauthProblem(400, "invalid_request", "logout request is invalid") };
  }
  const [client] = await database.db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!client || client.disabled || !client.enableEndSession) {
    return {
      clientId,
      response: oauthProblem(400, "invalid_request", "logout request is invalid"),
    };
  }
  const redirect = query.get("post_logout_redirect_uri");
  if (redirect && !client.postLogoutRedirectUris?.includes(redirect)) {
    return {
      clientId,
      response: oauthProblem(400, "invalid_request", "logout request is invalid"),
    };
  }
  try {
    const payload = await verifyLocalJwt(auth, request, idToken, clientId);
    if (typeof payload.sid !== "string" || typeof payload.sub !== "string") {
      throw new Error("ID token logout claims are invalid");
    }
    const now = new Date();
    await database.db.transaction(async (transaction) => {
      await transaction
        .update(oauthRefreshTokens)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthRefreshTokens.sessionId, payload.sid as string),
            isNull(oauthRefreshTokens.revoked),
          ),
        );
      await transaction
        .delete(oauthAccessTokens)
        .where(eq(oauthAccessTokens.sessionId, payload.sid as string));
      await transaction
        .delete(session)
        .where(
          and(eq(session.id, payload.sid as string), eq(session.userId, payload.sub as string)),
        );
    });
    if (redirect) {
      const destination = new URL(redirect);
      const state = query.get("state");
      if (state) destination.searchParams.set("state", state);
      return {
        clientId,
        response: Response.redirect(destination, 302),
        sessionId: payload.sid,
        userId: payload.sub,
      };
    }
    return {
      clientId,
      response: Response.json({ message: "Logout successful" }),
      sessionId: payload.sid,
      userId: payload.sub,
    };
  } catch {
    return {
      clientId,
      response: oauthProblem(400, "invalid_request", "logout request is invalid"),
    };
  }
}
