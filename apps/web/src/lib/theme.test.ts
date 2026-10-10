import { describe, expect, it } from "vitest"
import { parsePreference, resolveTheme } from "./theme"

describe("resolveTheme", () => {
  it("follows the OS when set to system", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
  it("overrides the OS when set explicitly", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })
})

describe("parsePreference", () => {
  it("falls back to system for missing or unknown values", () => {
    expect(parsePreference(null)).toBe("system")
    expect(parsePreference("sepia")).toBe("system")
    expect(parsePreference("dark")).toBe("dark")
  })
})
