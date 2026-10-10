import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>
  end: () => Promise<void>
}

/** Direct access to the dev database, for setting up states the UI can't create yet. */
export function connectDb(): Sql | null {
  const root = process.cwd()
  const require = createRequire(join(root, "apps/worker/package.json"))
  const postgres = require("postgres") as (url: string, options: { max: number }) => Sql
  const url =
    process.env.DATABASE_URL ??
    readFileSync(join(root, "apps/web/.env"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="))
      ?.split("=")
      .slice(1)
      .join("=")
  return url ? postgres(url, { max: 1 }) : null
}
