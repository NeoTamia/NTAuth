import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { betterAuthSchema, type DatabaseConnection } from "@neotamia/db";

type AuthOptions = {
  baseURL: string;
  database: DatabaseConnection["db"];
  secret: string;
  trustedOrigins: string[];
};

export function createAuth(options: AuthOptions) {
  return betterAuth({
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
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
  });
}
