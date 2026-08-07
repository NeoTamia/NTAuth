import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const systemHealth = pgTable("system_health", {
  id: uuid("id").defaultRandom().primaryKey(),
  component: varchar("component", { length: 64 }).notNull().unique(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobStatus = "available" | "completed" | "failed" | "running";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 128 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 16 }).$type<JobStatus>().notNull().default("available"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 128 }),
    lastError: varchar("last_error", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("jobs_available_idx").on(table.status, table.availableAt),
    check("jobs_attempts_check", sql`${table.attempts} >= 0`),
    check("jobs_max_attempts_check", sql`${table.maxAttempts} > 0`),
    check(
      "jobs_status_check",
      sql`${table.status} in ('available', 'running', 'completed', 'failed')`,
    ),
  ],
);
