import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

/** Deletes the e2e-…@example.com Users the tests created (their Boards cascade). */
export default async function globalTeardown() {
  const root = process.cwd()
  const require = createRequire(join(root, "apps/worker/package.json"))
  const postgres = require("postgres") as (
    url: string,
    options: { max: number },
  ) => {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
    end: () => Promise<void>
  }
  const url =
    process.env.DATABASE_URL ??
    readFileSync(join(root, "apps/web/.env"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="))
      ?.split("=")
      .slice(1)
      .join("=")
  if (!url) return
  const sql = postgres(url, { max: 1 })
  await sql`delete from "user" where email like 'e2e-%@example.com'`
  await sql.end()
}
