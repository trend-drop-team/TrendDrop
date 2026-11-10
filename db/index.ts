import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseUrl, hasDatabaseUrl } from "../lib/env.ts";

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!dbInstance) {
    const client = postgres(getDatabaseUrl(), {
      prepare: false,
      max: 5,
    });

    dbInstance = drizzle(client);
  }

  return dbInstance;
}

export function isDbConfigured() {
  return hasDatabaseUrl();
}
