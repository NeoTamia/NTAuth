import { describe, expect, test } from "bun:test";

import {
  EnvironmentValidationError,
  parseApiEnvironment,
  parseDatabaseEnvironment,
  parsePublicWebEnvironment,
  parseWorkerEnvironment,
} from "./env";

const sharedEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://ntauth:ntauth@localhost:5432/ntauth",
  REDIS_URL: "redis://localhost:6379",
};

describe("runtime environment validation", () => {
  test("parses and coerces API values", () => {
    const environment = parseApiEnvironment({
      ...sharedEnvironment,
      API_HOST: "0.0.0.0",
      API_PORT: "3001",
      AUTH_BASE_URL: "http://localhost:3001/api/auth",
      BETTER_AUTH_SECRET: "a-valid-test-secret-with-32-characters",
      CORS_ORIGINS: "http://localhost:3000, https://auth.example.com",
    });

    expect(environment.API_PORT).toBe(3001);
    expect(environment.CORS_ORIGINS).toEqual(["http://localhost:3000", "https://auth.example.com"]);
  });

  test("keeps server variables out of the public web environment", () => {
    const environment = parsePublicWebEnvironment({
      NUXT_PUBLIC_API_BASE_URL: "https://auth.example.com",
      BETTER_AUTH_SECRET: "must-never-be-exposed",
    });

    expect(environment).toEqual({ NUXT_PUBLIC_API_BASE_URL: "https://auth.example.com" });
    expect(environment).not.toHaveProperty("BETTER_AUTH_SECRET");
  });

  test("validates database tooling without requiring another service", () => {
    expect(parseDatabaseEnvironment({ DATABASE_URL: sharedEnvironment.DATABASE_URL })).toEqual({
      DATABASE_URL: sharedEnvironment.DATABASE_URL,
    });
  });

  test("normalizes optional SMTP credentials", () => {
    const environment = parseWorkerEnvironment({
      ...sharedEnvironment,
      EMAIL_OUTBOX_POLL_INTERVAL_MS: "1000",
      JOB_LOCK_TIMEOUT_MS: "30000",
      SMTP_FROM: "NTAuth <no-reply@example.com>",
      SMTP_HOST: "localhost",
      SMTP_PASSWORD: "",
      SMTP_PORT: "1025",
      SMTP_SECURE: "false",
      SMTP_USER: "",
      WORKER_HOST: "127.0.0.1",
      WORKER_PORT: "3002",
    });

    expect(environment.SMTP_PASSWORD).toBeUndefined();
    expect(environment.SMTP_SECURE).toBe(false);
    expect(environment.SMTP_USER).toBeUndefined();
  });

  test("reports invalid fields without leaking their values", () => {
    const secret = "short-secret";

    expect(() =>
      parseApiEnvironment({
        ...sharedEnvironment,
        API_HOST: "localhost",
        API_PORT: "invalid-port",
        AUTH_BASE_URL: "not-a-url",
        BETTER_AUTH_SECRET: secret,
        CORS_ORIGINS: "not-an-origin",
      }),
    ).toThrow(EnvironmentValidationError);

    try {
      parseApiEnvironment({ ...sharedEnvironment, BETTER_AUTH_SECRET: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("BETTER_AUTH_SECRET");
    }
  });
});
