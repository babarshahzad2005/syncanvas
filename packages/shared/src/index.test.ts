import { describe, expect, it } from "vitest"
import {
  canEdit,
  DISPLAY_NAME_MAX,
  displayNameOf,
  nameFromEmail,
  normalizeDisplayName,
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  snippetParts,
} from "./index"

describe("canEdit", () => {
  it("allows Owners and Editors only", () => {
    expect(canEdit("owner")).toBe(true)
    expect(canEdit("editor")).toBe(true)
    expect(canEdit("commenter")).toBe(false)
    expect(canEdit("viewer")).toBe(false)
  })
})

describe("display names", () => {
  it.each([
    ["ada.lovelace@example.com", "Ada Lovelace"],
    ["grace_hopper@example.com", "Grace Hopper"],
    ["jdoe84@example.com", "Jdoe84"],
    ["e2e-1791730619769@example.com", "E2e 1791730619769"],
    ["sam+boards@example.com", "Sam"],
    ["łukasz.żak@example.com", "Łukasz Żak"],
    ["...@example.com", "Collaborator"],
  ])("prefills %s as %s", (email, name) => {
    expect(nameFromEmail(email)).toBe(name)
  })

  it("keeps prefills within the limit", () => {
    expect(nameFromEmail(`${"a".repeat(80)}@example.com`)).toHaveLength(DISPLAY_NAME_MAX)
  })

  it("normalizes chosen names and refuses empty or long ones", () => {
    expect(normalizeDisplayName("  Ada   Lovelace ")).toBe("Ada Lovelace")
    expect(normalizeDisplayName("   ")).toBeNull()
    expect(normalizeDisplayName("x".repeat(51))).toBeNull()
    expect(normalizeDisplayName(42)).toBeNull()
  })

  it("shows the chosen name, or the prefill until there is one", () => {
    expect(displayNameOf({ name: "Ada", email: "x@example.com" })).toBe("Ada")
    expect(displayNameOf({ name: "", email: "grace.hopper@example.com" })).toBe("Grace Hopper")
  })
})

describe("snippetParts", () => {
  it("splits a snippet into plain and matched parts", () => {
    expect(snippetParts(`to improve: ${SEARCH_MARK_START}zebra${SEARCH_MARK_END} tests`)).toEqual([
      { text: "to improve: ", match: false },
      { text: "zebra", match: true },
      { text: " tests", match: false },
    ])
    expect(snippetParts("<b>no html</b>")).toEqual([{ text: "<b>no html</b>", match: false }])
  })
})
