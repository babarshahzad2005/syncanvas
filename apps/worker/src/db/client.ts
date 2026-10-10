import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

/**
 * A per-request Postgres client over Hyperdrive. Hyperdrive pools the real connections,
 * so each request opens a small client and closes it when the response is done.
 */
export function createDb(connectionString: string) {
  const sql = postgres(connectionString, { max: 5, fetch_types: false, prepare: true })
  return { db: drizzle(sql, { schema }), close: () => sql.end() }
}

/** Any Drizzle Postgres database with our schema: postgres-js in the Worker, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>
