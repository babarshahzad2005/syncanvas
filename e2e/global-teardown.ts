import { connectDb } from "./db"

/** Deletes the e2e-…@example.com Users the tests created (their Boards cascade). */
export default async function globalTeardown() {
  // In CI the shards share the PR's throwaway Neon branch, so one shard finishing mustn't delete
  // the Users another is still using; the branch is deleted with the PR (pr-cleanup.yml).
  if (process.env.CI) return
  const sql = connectDb()
  if (!sql) return
  await sql`delete from "user" where email like 'e2e-%@example.com'`
  await sql.end()
}
