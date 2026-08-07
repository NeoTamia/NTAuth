import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { createOAuthProviderPlugin } from "./oauth-provider";

import {
  betterAuthSchema,
  permitsAuthentication,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

type AuthOptions = {
  baseURL: string;
  connection?: DatabaseConnection;
  database: DatabaseConnection["db"];
  secret: string;
  trustedOrigins: string[];
};

export function minimizeUserAgent(value: string | null | undefined): string | null {
  if (!value) return null;

  if (/Edg\//.test(value)) return "Edge";
  if (/Firefox\//.test(value)) return "Firefox";
  if (/Chrome\//.test(value)) return "Chrome";
  if (/Safari\//.test(value)) return "Safari";
  return "Other";
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    advanced: {
      ipAddress: { disableIpTracking: true },
    },
    appName: "NTAuth",
    baseURL: options.baseURL,
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema: betterAuthSchema,
    }),
    emailAndPassword: {
      autoSignIn: false,
      disableSignUp: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      requireEmailVerification: true,
    },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: { alg: "ES256" } },
        jwt: { audience: options.baseURL, expirationTime: "15m", issuer: options.baseURL },
      }),
      createOAuthProviderPlugin(
        options.connection
          ? { applicationSecret: options.secret, database: options.connection }
          : undefined,
      ),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [identity] = await options.database
              .select({ status: user.status })
              .from(user)
              .where(eq(user.id, session.userId))
              .limit(1);
            if (!identity || !permitsAuthentication(identity.status)) return false;
            return {
              data: {
                ...session,
                ipAddress: null,
                userAgent: minimizeUserAgent(session.userAgent),
              },
            };
          },
        },
      },
    },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
  });
}
