import { describe, expect, it } from "vitest"
import { createApp } from "./app"

describe("GET /api/health", () => {
  it("reports ok without touching the database", async () => {
    const app = createApp(() => {
      throw new Error("health must not create services")
    })
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe("GET /api/dev/magic-link", () => {
  const app = createApp(() => {
    throw new Error("must not create services")
  })
  const ask = (env: Record<string, string>) =>
    app.request("/api/dev/magic-link?email=a@example.com", {}, env as unknown as Env)

  it("doesn't exist unless explicitly enabled on localhost", async () => {
    expect((await ask({ BETTER_AUTH_URL: "http://localhost:5173" })).status).toBe(404)
    expect(
      (
        await ask({
          BETTER_AUTH_URL: "https://syncanvas.example.workers.dev",
          DEV_MAGIC_LINK_INBOX: "on",
        })
      ).status,
    ).toBe(404)
  })

  it("returns the last link sent to an address when enabled locally", async () => {
    const { logAndKeepMagicLink } = await import("./auth")
    await logAndKeepMagicLink({ email: "A@example.com", url: "http://localhost:5173/api/auth/x" })
    const res = await ask({ BETTER_AUTH_URL: "http://localhost:5173", DEV_MAGIC_LINK_INBOX: "on" })
    expect(await res.json()).toEqual({ url: "http://localhost:5173/api/auth/x" })
  })
})
