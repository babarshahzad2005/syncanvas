import { describe, expect, it } from "vitest"
import { safeRedirect } from "./auth-client"

describe("safeRedirect", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirect("/b/abc?x=1")).toBe("/b/abc?x=1")
  })
  it("rejects other sites and junk", () => {
    expect(safeRedirect("https://evil.example")).toBe("/")
    expect(safeRedirect("//evil.example")).toBe("/")
    expect(safeRedirect("/\\evil.example")).toBe("/")
    expect(safeRedirect(undefined)).toBe("/")
  })
})
