import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });

// A DbExecutor is either the top-level Drizzle instance or a transaction
// handle yielded by `db.transaction(async (tx) => …)`. Helpers that need
// to participate in a caller-provided transaction accept this type so the
// same code path can run both standalone and as part of a larger atomic
// unit of work.
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];
