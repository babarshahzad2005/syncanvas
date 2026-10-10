import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, ORIGIN, sessionCookie, type TestApp } from "./test-app"

async function currentUser(t: TestApp, cookie?: string) {
  const res = await t.request("/api/auth/get-session", { cookie })
  const body = (await res.json()) as { user?: { email: string } } | null
  return body?.user?.email ?? null
}

describe("magic link sign-in", () => {
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp()
  })

  it("signs in by link, keeps the session, and signs out", async () => {
    const link = await t.requestLink("ada@example.com", "/b/abc")

    const verify = await t.request(link, { method: "GET" })
    expect(verify.status).toBe(302)
    expect(verify.headers.get("location")).toBe(`${ORIGIN}/b/abc`)
    const cookie = sessionCookie(verify)
    expect(cookie).toBeTruthy()

    const setCookie = verify.headers.getSetCookie().find((c) => c.includes("session_token="))
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)

    expect(await currentUser(t, cookie)).toBe("ada@example.com")

    const out = await t.request("/api/auth/sign-out", { method: "POST", body: "{}", cookie })
    expect(out.status).toBe(200)
    expect(await currentUser(t, cookie)).toBeNull()
  })

  it("has no session without a cookie", async () => {
    expect(await currentUser(t)).toBeNull()
  })

  it("rejects a link that was already used", async () => {
    const link = await t.requestLink("grace@example.com")
    expect(sessionCookie(await t.request(link))).toBeTruthy()

    const again = await t.request(link)
    expect(sessionCookie(again)).toBeUndefined()
    expect(again.headers.get("location")).toMatch(/\/sign-in\?error=\w+/)
  })

  it("rejects an expired link", async () => {
    const short = await createTestApp({ magicLinkExpiresIn: 1 })
    const link = await short.requestLink("linus@example.com")
    await new Promise((r) => setTimeout(r, 1500))

    const res = await short.request(link)
    expect(sessionCookie(res)).toBeUndefined()
    expect(res.headers.get("location")).toMatch(/\/sign-in\?error=\w+/)
  })

  it("creates one User per email across sign-ins", async () => {
    for (let i = 0; i < 2; i++) {
      const cookie = await t.signIn("Mixed.Case@Example.com")
      expect(await currentUser(t, cookie)).toBe("mixed.case@example.com")
    }
  })
})
