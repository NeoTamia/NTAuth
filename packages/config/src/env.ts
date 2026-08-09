import { z } from "zod";
import { readFile } from "node:fs/promises";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalBoolean = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
);

function usesProtocol(value: string, protocol: RegExp): boolean {
  try {
    return protocol.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

const httpUrl = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, /^https?:$/), {
    message: "URL must use HTTP or HTTPS",
  });
const postgresUrl = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, /^postgres(?:ql)?:$/), {
    message: "URL must use PostgreSQL",
  });
const redisUrl = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, /^rediss?:$/), {
    message: "URL must use Redis",
  });
const trustedProxyCidrs = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(z.string().regex(/^[0-9a-f:.]+(?:\/\d{1,3})?$/i, "Invalid proxy IP or CIDR")).max(16),
  );

const sharedEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
});

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: postgresUrl,
});

const bootstrapAdminEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    NODE_ENV: z.enum(["development", "test", "production"]),
    NTAUTH_BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    NTAUTH_BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).max(120).default("NTAuth Administrator"),
    NTAUTH_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128),
    NTAUTH_BOOTSTRAP_CONFIRM: optionalString,
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.NTAUTH_BOOTSTRAP_CONFIRM !== "create-first-platform-admin"
    ) {
      context.addIssue({
        code: "custom",
        message: "Production bootstrap requires explicit confirmation",
        path: ["NTAUTH_BOOTSTRAP_CONFIRM"],
      });
    }
  });

const apiEnvironmentSchema = sharedEnvironmentSchema.extend({
  API_HOST: z.string().trim().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  AUTH_BASE_URL: httpUrl,
  BETTER_AUTH_SECRET: z.string().min(32),
  CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(",").map((origin) => origin.trim()))
    .pipe(z.array(httpUrl).min(1)),
  RATE_LIMIT_ENABLED: optionalBoolean.default(false),
  RATE_LIMIT_LOCKOUT_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  RATE_LIMIT_LOCKOUT_THRESHOLD: z.coerce.number().int().min(2).max(100).default(8),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  RATE_LIMIT_OAUTH_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
  RATE_LIMIT_OAUTH_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  RATE_LIMIT_RECOVERY_MAX: z.coerce.number().int().min(1).max(10_000).default(5),
  RATE_LIMIT_RECOVERY_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
  TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
});

const workerEnvironmentSchema = sharedEnvironmentSchema.extend({
  EMAIL_OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(300_000),
  JOB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000),
  SMTP_FROM: z.string().trim().min(1),
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PASSWORD: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
  SMTP_SECURE: optionalBoolean.default(false),
  SMTP_USER: optionalString,
  WORKER_HOST: z.string().trim().min(1),
  WORKER_PORT: z.coerce.number().int().min(1).max(65_535),
});

const publicWebEnvironmentSchema = z.object({
  NUXT_PUBLIC_API_BASE_URL: httpUrl,
});

const ntscoutSeedEnvironmentSchema = z
  .object({
    NTSCOUT_ENVIRONMENT: z.enum(["development", "staging", "production"]),
    NTSCOUT_REDIRECT_URIS: z
      .string()
      .transform((value) => value.split(",").map((uri) => uri.trim()))
      .pipe(z.array(httpUrl).min(1)),
  })
  .superRefine((environment, context) => {
    const uniqueUris = new Set(environment.NTSCOUT_REDIRECT_URIS);
    if (uniqueUris.size !== environment.NTSCOUT_REDIRECT_URIS.length) {
      context.addIssue({
        code: "custom",
        message: "Redirect URIs must be unique",
        path: ["NTSCOUT_REDIRECT_URIS"],
      });
    }
    for (const [index, value] of environment.NTSCOUT_REDIRECT_URIS.entries()) {
      const uri = new URL(value);
      const loopback =
        uri.hostname === "localhost" || uri.hostname === "127.0.0.1" || uri.hostname === "[::1]";
      if (uri.hash || uri.username || uri.password || uri.hostname.includes("*")) {
        context.addIssue({
          code: "custom",
          message: "Redirect URI must be exact and contain no fragment, credentials, or wildcard",
          path: ["NTSCOUT_REDIRECT_URIS", index],
        });
      }
      if (
        uri.protocol !== "https:" &&
        !(environment.NTSCOUT_ENVIRONMENT === "development" && loopback)
      ) {
        context.addIssue({
          code: "custom",
          message: "Redirect URI must use HTTPS outside a development loopback",
          path: ["NTSCOUT_REDIRECT_URIS", index],
        });
      }
    }
  });

export class EnvironmentValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: z.core.$ZodIssue[]) {
    const safeIssues = issues.map((issue) => ({
      path: issue.path.join(".") || "environment",
      message: issue.message,
    }));

    super(
      `Invalid environment: ${safeIssues.map(({ path, message }) => `${path}: ${message}`).join("; ")}`,
    );
    this.name = "EnvironmentValidationError";
    this.issues = safeIssues;
  }
}

function parseEnvironment<T>(schema: z.ZodType<T>, environment: unknown): T {
  const result = schema.safeParse(environment);

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }

  return result.data;
}

export async function materializeSecretFiles(
  environment: NodeJS.ProcessEnv,
  names: ReadonlyArray<string>,
) {
  const resolved = { ...environment };
  await Promise.all(
    names.map(async (name) => {
      if (resolved[name]?.trim()) return;
      const path = resolved[`${name}_FILE`]?.trim();
      if (!path) return;
      const value = (await readFile(path, "utf8")).trimEnd();
      if (!value) throw new Error(`Secret file for ${name} is empty`);
      resolved[name] = value;
    }),
  );
  return resolved;
}

export function parseApiEnvironment(environment: unknown = process.env) {
  return parseEnvironment(apiEnvironmentSchema, environment);
}

export function parseWorkerEnvironment(environment: unknown = process.env) {
  return parseEnvironment(workerEnvironmentSchema, environment);
}

export function parsePublicWebEnvironment(environment: unknown = process.env) {
  return parseEnvironment(publicWebEnvironmentSchema, environment);
}

export function parseDatabaseEnvironment(environment: unknown = process.env) {
  return parseEnvironment(databaseEnvironmentSchema, environment);
}

export function parseBootstrapAdminEnvironment(environment: unknown = process.env) {
  return parseEnvironment(bootstrapAdminEnvironmentSchema, environment);
}

export function parseNtscoutSeedEnvironment(environment: unknown = process.env) {
  return parseEnvironment(ntscoutSeedEnvironmentSchema, environment);
}

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type PublicWebEnvironment = z.infer<typeof publicWebEnvironmentSchema>;
export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type BootstrapAdminEnvironment = z.infer<typeof bootstrapAdminEnvironmentSchema>;
export type NtscoutSeedEnvironment = z.infer<typeof ntscoutSeedEnvironmentSchema>;
