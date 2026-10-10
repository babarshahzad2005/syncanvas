import { connectDb } from "./db"

/** Deletes the e2e-…@example.com Users the tests created (their Boards cascade). */
export default async function globalTeardown() {
  const sql = connectDb()
  if (!sql) return
  await sql`delete from "user" where email like 'e2e-%@example.com'`
  await sql.end()
}
