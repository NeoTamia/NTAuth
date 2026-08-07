import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const systemHealth = pgTable("system_health", {
  id: uuid("id").defaultRandom().primaryKey(),
  component: varchar("component", { length: 64 }).notNull().unique(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});
