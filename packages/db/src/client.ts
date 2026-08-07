import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const createDatabase = (url: string) => {
  const client = postgres(url, { prepare: false });
  return { client, db: drizzle(client, { schema }) };
};
