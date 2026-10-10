import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "drizzle-kit"

// Migrations run against the same Neon database as `pnpm dev`. The connection string lives
// in apps/web/.env (see apps/web/.env.example), or DATABASE_URL in CI.
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/.env"), "utf8")
  const line = env
    .split(/\r?\n/)
    .find((l: string) => l.startsWith("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="))
  const value = line?.split("=").slice(1).join("=").trim()
  if (!value) throw new Error("Set the Neon connection string in apps/web/.env first.")
  return value
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl() },
  strict: true,
})
