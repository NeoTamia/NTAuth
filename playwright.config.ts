import { defineConfig, devices } from "@playwright/test";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const apiPort = 3101;
const webPort = 3100;
const apiBaseURL = `http://127.0.0.1:${apiPort}`;
const webBaseURL = `http://127.0.0.1:${webPort}`;
const databaseURL = process.env.TEST_DATABASE_URL;

if (!databaseURL) throw new Error("TEST_DATABASE_URL is required for browser tests");

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  globalSetup: "./apps/web/tests/e2e/global-setup.ts",
  globalTeardown: "./apps/web/tests/e2e/global-teardown.ts",
  outputDir: "./test-results/playwright",
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./apps/web/tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 45_000,
  use: {
    baseURL: webBaseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun apps/api/src/index.ts",
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(apiPort),
        AUTH_BASE_URL: `${apiBaseURL}/api/auth`,
        BETTER_AUTH_SECRET: "ntauth-e2e-secret-with-at-least-32-chars",
        CORS_ORIGINS: webBaseURL,
        DATABASE_URL: databaseURL,
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "false",
        REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
        TEST_DATABASE_URL: databaseURL,
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: `${apiBaseURL}/ready`,
    },
    {
      command: `bun run --cwd apps/web dev -- --host 127.0.0.1 --port ${webPort}`,
      env: {
        ...process.env,
        NODE_ENV: "test",
        NUXT_PUBLIC_API_BASE_URL: apiBaseURL,
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: webBaseURL,
    },
  ],
  workers: 1,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
