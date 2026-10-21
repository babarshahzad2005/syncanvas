// Test harness for the HTTP seam: the real Hono app, Better Auth, and Drizzle migrations,
// on an in-memory Postgres (PGlite) instead of Neon. Used only by *.test.ts files.
import { generateKeyPairSync } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import type { ControlMessage } from "@syncanvas/shared"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { expect } from "vitest"
import { createApp } from "./app"
import { createAuth } from "./auth"
import type { AccessChange, VersionSummary } from "./board-room"
import * as schema from "./db/schema"
import type { DigestMessage, InvitationMessage } from "./email"
import type { AssetStore } from "./thumbnails"
import type { VersionsRoom } from "./versions"

export const ORIGIN = "http://localhost:5173"
/** A fresh Ed25519 pair in the same encoding as scripts/gen-keys.mjs. */
export function testBoardTokenKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const encode = (key: typeof publicKey) =>
    Buffer.from(JSON.stringify(key.export({ format: "jwk" }))).toString("base64url")
  return { BOARD_TOKEN_PRIVATE_KEY: encode(privateKey), BOARD_TOKEN_PUBLIC_KEY: encode(publicKey) }
}

export const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  ...testBoardTokenKeys(),
} as Env
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

export async function createTestApp(options: { magicLinkExpiresIn?: number } = {}) {
  const pg = new PGlite()
  // Neon runs in UTC; PGlite would use this machine's zone for now() and timestamps.
  await pg.exec("set timezone = 'UTC'")
  const db = drizzle(pg, { schema })
  await migrate(db, {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "../drizzle"),
  })
  const outbox: { email: string; url: string }[] = []
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: ORIGIN,
    sendMagicLink: async (m) => {
      outbox.push(m)
    },
    magicLinkExpiresIn: options.magicLinkExpiresIn,
  })
  const invitations: InvitationMessage[] = []
  /** Changes pushed to board rooms, in order. */
  const access: { boardId: string; change: AccessChange }[] = []
  /** Boards whose Guests were disconnected, in order. */
  const guestsClosed: string[] = []
  /** Control messages relayed to board rooms, in order (M4). */
  const broadcasts: { boardId: string; message: ControlMessage }[] = []
  /** Digest emails sent (M4 ticket 04). */
  const digests: DigestMessage[] = []
  /** Boards whose rooms were closed (to Trash) or destroyed (for good), in order (M5a). */
  const closedAll: string[] = []
  const destroyed: string[] = []
  /** The thumbnail KV namespace (M5a ticket 05). */
  const assets = new Map<string, { bytes: ArrayBuffer; contentType: string }>()
  const assetStore: AssetStore = {
    put: async (key, bytes, contentType) => {
      assets.set(key, { bytes, contentType })
    },
    get: async (key) => assets.get(key) ?? null,
    delete: async (key) => {
      assets.delete(key)
    },
  }
  /** Each board room's Versions (M5b ticket 06), and the restores noted. */
  const versionStore = new Map<string, { summary: VersionSummary; state: Uint8Array }[]>()
  const restores: { boardId: string; versionId: number; name: string }[] = []
  const versionsRoom: VersionsRoom = {
    list: async (boardId) => (versionStore.get(boardId) ?? []).map((v) => v.summary),
    state: async (boardId, id) =>
      versionStore.get(boardId)?.find((v) => v.summary.id === id)?.state ?? null,
    noteRestore: async (boardId, versionId, name) => {
      if (!versionStore.get(boardId)?.some((v) => v.summary.id === versionId)) return false
      restores.push({ boardId, versionId, name })
      return true
    },
  }
  const app = createApp(() => ({
    db,
    auth,
    sendInvitation: async (m) => {
      invitations.push(m)
    },
    applyAccess: async (boardId, change) => {
      access.push({ boardId, change })
    },
    closeGuests: async (boardId) => {
      guestsClosed.push(boardId)
    },
    broadcast: async (boardId, message) => {
      broadcasts.push({ boardId, message })
    },
    sendDigest: async (m) => {
      digests.push(m)
    },
    closeAll: async (boardId) => {
      closedAll.push(boardId)
    },
    destroyRoom: async (boardId) => {
      destroyed.push(boardId)
    },
    versions: versionsRoom,
    assets: assetStore,
  }))

  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const { cookie, ...rest } = init
    return app.fetch(
      new Request(`${ORIGIN}${path}`, {
        ...rest,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...rest.headers,
        },
      }),
      env,
      ctx,
    )
  }

  /** Requests a link for `email` and returns its path + query, as clicked from the email. */
  async function requestLink(email: string, callbackURL = "/") {
    const res = await request("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, callbackURL, errorCallbackURL: "/sign-in" }),
    })
    expect(res.status).toBe(200)
    const sent = outbox.at(-1)
    expect(sent?.email).toBe(email)
    const url = new URL(sent?.url ?? "")
    return url.pathname + url.search
  }

  /** Signs `email` in through a magic link and returns its session cookie. */
  async function signIn(email: string) {
    const cookie = sessionCookie(await request(await requestLink(email)))
    if (!cookie) throw new Error(`sign-in failed for ${email}`)
    return cookie
  }

  return {
    request,
    requestLink,
    signIn,
    outbox,
    invitations,
    access,
    guestsClosed,
    broadcasts,
    digests,
    closedAll,
    destroyed,
    versionStore,
    restores,
    assets,
    assetStore,
    db,
    pg,
  }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

export function sessionCookie(res: Response) {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))
  return cookie?.split(";")[0]
}
