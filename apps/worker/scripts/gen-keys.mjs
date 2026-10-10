// Fills BOARD_TOKEN_PRIVATE_KEY / BOARD_TOKEN_PUBLIC_KEY in .dev.vars with a new Ed25519 key pair
// (JWK JSON, base64url-encoded so it fits on one line). Never prints the keys.
import { generateKeyPairSync } from "node:crypto"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"

const file = new URL("../.dev.vars", import.meta.url)
if (!existsSync(file)) copyFileSync(new URL("../.dev.vars.example", import.meta.url), file)
const lines = readFileSync(file, "utf8").split(/\r?\n/)
const filled = (name) => lines.some((l) => l.startsWith(`${name}=`) && l.length > name.length + 1)
if (filled("BOARD_TOKEN_PRIVATE_KEY") && filled("BOARD_TOKEN_PUBLIC_KEY")) {
  console.log("Board token keys are already set in .dev.vars; left unchanged.")
  process.exit(0)
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const encode = (key) =>
  Buffer.from(JSON.stringify(key.export({ format: "jwk" }))).toString("base64url")
const set = (name, value) => {
  const i = lines.findIndex((l) => l.startsWith(`${name}=`))
  if (i === -1) lines.push(`${name}=${value}`)
  else lines[i] = `${name}=${value}`
}
set("BOARD_TOKEN_PRIVATE_KEY", encode(privateKey))
set("BOARD_TOKEN_PUBLIC_KEY", encode(publicKey))
writeFileSync(file, lines.join("\n"))
console.log("Wrote a new board token key pair to apps/worker/.dev.vars.")
