import { describe, expect, it } from "vitest"
import {
  collaborators,
  GUEST_COLOR,
  PRESENCE_COLORS,
  presenceColor,
  type TabPresence,
  tabPresence,
} from "./model"

describe("presenceColor", () => {
  it("gives a User the same color every time, from the twelve presence colors", () => {
    const color = presenceColor("user-ada")
    expect(presenceColor("user-ada")).toBe(color)
    expect(PRESENCE_COLORS).toContain(color)
  })

  it("spreads different Users across the colors", () => {
    const colors = new Set(Array.from({ length: 200 }, (_, i) => presenceColor(`user-${i}`)))
    expect(colors.size).toBe(PRESENCE_COLORS.length)
  })

  it("makes Guests gray", () => {
    expect(presenceColor("guest-1", true)).toBe(GUEST_COLOR)
  })
})

describe("tabPresence", () => {
  it("reads a state the board room stamped", () => {
    expect(tabPresence(7, { cursor: null, user: { id: "u", name: "Ada", guest: false } })).toEqual({
      clientId: 7,
      user: { id: "u", name: "Ada", guest: false },
      state: { cursor: null },
    })
  })

  it("ignores states without an identity", () => {
    expect(tabPresence(7, { cursor: null })).toBeNull()
    expect(tabPresence(7, null)).toBeNull()
  })
})

describe("collaborators", () => {
  const tab = (clientId: number, id: string, name = id): TabPresence => ({
    clientId,
    user: { id, name, guest: false },
    state: {},
  })

  it("lists each User once with all their tabs, leaving you out", () => {
    const people = collaborators(
      [tab(1, "ada"), tab(2, "me"), tab(3, "grace"), tab(4, "ada"), tab(5, "me")],
      "me",
    )
    expect(people.map((p) => [p.id, p.tabs.map((t) => t.clientId)])).toEqual([
      ["ada", [1, 4]],
      ["grace", [3]],
    ])
    expect(people[0]?.color).toBe(presenceColor("ada"))
  })

  it("is empty when you're alone, even with your own other tabs open", () => {
    expect(collaborators([tab(1, "me"), tab(2, "me")], "me")).toEqual([])
  })
})
