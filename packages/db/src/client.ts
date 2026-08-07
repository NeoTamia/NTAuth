import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max, prepare: false });
  const db = drizzle(client, { schema });

  return {
    client,
    db,
    async close() {
      await client.end({ timeout: 5 });
    },
    async ping() {
      await client`select 1`;
    },
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
