import { describe, expect, it } from "vitest"
import {
  collaborators,
  cursorOf,
  fitView,
  GUEST_COLOR,
  IDLE_AWAY_MS,
  isAway,
  leaderTab,
  PRESENCE_COLORS,
  presenceColor,
  publishedSelection,
  SELECTION_IDS_MAX,
  selectionOf,
  type TabPresence,
  tabIsAway,
  tabPresence,
  viewOf,
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

describe("cursors and away", () => {
  const tab = (state: Record<string, unknown>, clientId = 1): TabPresence => ({
    clientId,
    user: { id: "ada", name: "Ada", guest: false },
    state,
  })

  it("reads a cursor in world units, and none when away or off the Board", () => {
    expect(cursorOf(tab({ cursor: { x: 10, y: -4 } }))).toEqual({ x: 10, y: -4 })
    expect(cursorOf(tab({ cursor: null }))).toBeNull()
    expect(cursorOf(tab({ cursor: { x: 10, y: -4 }, away: true }))).toBeNull()
    expect(cursorOf(tab({ cursor: { x: "10", y: 0 } }))).toBeNull()
  })

  it("marks a tab away when hidden or idle for a minute", () => {
    expect(tabIsAway(false, 0, IDLE_AWAY_MS - 1)).toBe(false)
    expect(tabIsAway(false, 0, IDLE_AWAY_MS)).toBe(true)
    expect(tabIsAway(true, 0, 1)).toBe(true)
  })

  it("marks a person away only when all their tabs are", () => {
    expect(isAway({ tabs: [tab({ away: true }), tab({ away: false }, 2)] })).toBe(false)
    expect(isAway({ tabs: [tab({ away: true }), tab({ away: true }, 2)] })).toBe(true)
  })
})

describe("selections", () => {
  const tab = (selection: unknown): TabPresence => ({
    clientId: 1,
    user: { id: "ada", name: "Ada", guest: false },
    state: { selection },
  })
  const box = { x: 1, y: 2, w: 3, h: 4 }

  it("publishes ids, or the box of a selection too big to list", () => {
    expect(publishedSelection([], () => box)).toBeNull()
    expect(publishedSelection(["a", "b"], () => box)).toEqual({ ids: ["a", "b"] })
    const many = Array.from({ length: SELECTION_IDS_MAX + 1 }, (_, i) => `e${i}`)
    expect(publishedSelection(many, () => box)).toEqual({ box })
  })

  it("reads a selection someone published, ignoring anything malformed", () => {
    expect(selectionOf(tab({ ids: ["a", 7, "b"] }))).toEqual({ ids: ["a", "b"] })
    expect(selectionOf(tab({ box }))).toEqual({ box })
    expect(selectionOf(tab({ box: { x: 1, y: "2", w: 3, h: 4 } }))).toBeNull()
    expect(selectionOf(tab({ ids: [] }))).toBeNull()
    expect(selectionOf(tab(null))).toBeNull()
    expect(
      selectionOf(tab({ ids: Array.from({ length: 500 }, (_, i) => `e${i}`) }))?.ids,
    ).toHaveLength(SELECTION_IDS_MAX)
  })
})

describe("follow mode", () => {
  const limits = { min: 0.1, max: 8 }
  const tab = (clientId: number, view: unknown): TabPresence => ({
    clientId,
    user: { id: "ada", name: "Ada", guest: false },
    state: { view },
  })

  it("shows the leader's view at the same zoom on a screen the same size", () => {
    expect(fitView({ x: -640, y: -400, w: 1280, h: 800 }, { w: 1280, h: 800 }, limits)).toEqual({
      zoom: 1,
      x: 640,
      y: 400,
    })
  })

  it("zooms out on a smaller screen so all of the leader's view fits, centered", () => {
    const camera = fitView({ x: 0, y: 0, w: 1000, h: 500 }, { w: 500, h: 500 }, limits)
    expect(camera.zoom).toBe(0.5)
    // The view's center (500, 250) lands on the screen's center (250, 250).
    expect(500 * camera.zoom + camera.x).toBe(250)
    expect(250 * camera.zoom + camera.y).toBe(250)
  })

  it("stays within the zoom limits", () => {
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 1000 }, limits).zoom).toBe(8)
  })

  it("follows the leader's most recently active tab that shares its view", () => {
    const tabs = [
      tab(1, { x: 0, y: 0, w: 10, h: 10 }),
      tab(2, { x: 5, y: 5, w: 10, h: 10 }),
      tab(3, null),
    ]
    expect(
      leaderTab(
        tabs,
        new Map([
          [1, 100],
          [2, 200],
          [3, 300],
        ]),
      )?.clientId,
    ).toBe(2)
    expect(leaderTab([tab(3, null)], new Map())).toBeNull()
  })

  it("ignores views that aren't a real area", () => {
    expect(viewOf(tab(1, { x: 0, y: 0, w: 0, h: 10 }))).toBeNull()
    expect(viewOf(tab(1, { x: "0", y: 0, w: 1, h: 1 }))).toBeNull()
  })
})
