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
