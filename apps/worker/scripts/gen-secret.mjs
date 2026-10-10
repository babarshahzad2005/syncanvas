// Fills BETTER_AUTH_SECRET in .dev.vars with a random local-only secret. Never prints it.
import { randomBytes } from "node:crypto"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"

const file = new URL("../.dev.vars", import.meta.url)
if (!existsSync(file)) copyFileSync(new URL("../.dev.vars.example", import.meta.url), file)

const lines = readFileSync(file, "utf8").split(/\r?\n/)
const i = lines.findIndex((l) => l.startsWith("BETTER_AUTH_SECRET="))
if (i === -1) lines.push(`BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`)
else if (lines[i] === "BETTER_AUTH_SECRET=")
  lines[i] = `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`
else {
  console.log("BETTER_AUTH_SECRET is already set in .dev.vars; left unchanged.")
  process.exit(0)
}
writeFileSync(file, lines.join("\n"))
console.log("Wrote a new BETTER_AUTH_SECRET to apps/worker/.dev.vars.")
