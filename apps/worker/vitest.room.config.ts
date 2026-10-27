import { generateKeyPairSync } from "node:crypto"
import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineProject } from "vitest/config"

// Board room socket seam: the real Worker and BoardRoom Durable Object running in workerd.
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const encode = (key: typeof publicKey) =>
  Buffer.from(JSON.stringify(key.export({ format: "jwk" }))).toString("base64url")

// The room tests never touch Postgres, but Wrangler requires a local Hyperdrive string.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??=
  "postgres://unused:unused@127.0.0.1:5/unused"

export default defineProject({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          BOARD_TOKEN_PRIVATE_KEY: encode(privateKey),
          BOARD_TOKEN_PUBLIC_KEY: encode(publicKey),
          BETTER_AUTH_SECRET: "unused-in-room-tests",
          // A small connection cap, so the tests can fill a Board.
          CONNECTION_CAP: "4",
          // Tiny state parts, so compaction always splits and joins (M5b ticket 01).
          STATE_PART_BYTES: "512",
          // No Postgres here: tests that check indexing swap in their own writer.
          SEARCH_INDEX: "off",
          EDITED_TIME: "off",
        },
      },
    }),
  ],
  test: { name: "worker-room", include: ["src/**/*.room.test.ts"], testTimeout: 30_000 },
})
