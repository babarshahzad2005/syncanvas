import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { beforeEach, describe, expect, it } from "vitest"
import { createApp } from "./app"
import { createAuth } from "./auth"
import * as schema from "./db/schema"

// HTTP seam: real requests through the Hono app, Better Auth, and the real migrations,
// on an in-memory Postgres (PGlite) instead of Neon.

const ORIGIN = "http://localhost:5173"
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
} as Env
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

async function setup(options: { magicLinkExpiresIn?: number } = {}) {
  const db = drizzle(new PGlite(), { schema })
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
  const app = createApp(() => ({ auth }))
  const request = (path: string, init: RequestInit = {}) =>
    app.fetch(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: { origin: ORIGIN, "content-type": "application/json", ...init.headers },
      }),
      env,
      ctx,
    )
  return { request, outbox }
}

/** Requests a link for `email` and returns its path + query, as clicked from the email. */
async function requestLink(t: Awaited<ReturnType<typeof setup>>, email: string, callbackURL = "/") {
  const res = await t.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    body: JSON.stringify({ email, callbackURL, errorCallbackURL: "/sign-in" }),
  })
  expect(res.status).toBe(200)
  const sent = t.outbox.at(-1)
  expect(sent?.email).toBe(email)
  const url = new URL(sent?.url ?? "")
  return url.pathname + url.search
}

function sessionCookie(res: Response) {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))
  return cookie?.split(";")[0]
}

async function currentUser(t: Awaited<ReturnType<typeof setup>>, cookie?: string) {
  const res = await t.request("/api/auth/get-session", { headers: cookie ? { cookie } : {} })
  const body = (await res.json()) as { user?: { email: string } } | null
  return body?.user?.email ?? null
}

describe("magic link sign-in", () => {
  let t: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    t = await setup()
  })

  it("signs in by link, keeps the session, and signs out", async () => {
    const link = await requestLink(t, "ada@example.com", "/b/abc")

    const verify = await t.request(link, { method: "GET" })
    expect(verify.status).toBe(302)
    expect(verify.headers.get("location")).toBe(`${ORIGIN}/b/abc`)
    const cookie = sessionCookie(verify)
    expect(cookie).toBeTruthy()

    const setCookie = verify.headers.getSetCookie().find((c) => c.includes("session_token="))
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)

    expect(await currentUser(t, cookie)).toBe("ada@example.com")

    const out = await t.request("/api/auth/sign-out", {
      method: "POST",
      body: "{}",
      headers: { cookie: cookie ?? "" },
    })
    expect(out.status).toBe(200)
    expect(await currentUser(t, cookie)).toBeNull()
  })

  it("has no session without a cookie", async () => {
    expect(await currentUser(t)).toBeNull()
  })

  it("rejects a link that was already used", async () => {
    const link = await requestLink(t, "grace@example.com")
    expect(sessionCookie(await t.request(link))).toBeTruthy()

    const again = await t.request(link)
    expect(sessionCookie(again)).toBeUndefined()
    expect(again.headers.get("location")).toMatch(/\/sign-in\?error=\w+/)
  })

  it("rejects an expired link", async () => {
    const short = await setup({ magicLinkExpiresIn: 1 })
    const link = await requestLink(short, "linus@example.com")
    await new Promise((r) => setTimeout(r, 1500))

    const res = await short.request(link)
    expect(sessionCookie(res)).toBeUndefined()
    expect(res.headers.get("location")).toMatch(/\/sign-in\?error=\w+/)
  })

  it("creates one User per email across sign-ins", async () => {
    for (let i = 0; i < 2; i++) {
      const link = await requestLink(t, "Mixed.Case@Example.com")
      const cookie = sessionCookie(await t.request(link))
      expect(await currentUser(t, cookie)).toBe("mixed.case@example.com")
    }
  })
})
