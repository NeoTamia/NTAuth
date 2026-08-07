import { defineConfig } from "drizzle-kit";
import { parseDatabaseEnvironment } from "@neotamia/config";

const environment = parseDatabaseEnvironment();

export default defineConfig({
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/schema.ts",
  dbCredentials: { url: environment.DATABASE_URL },
  strict: true,
  verbose: true,
});
