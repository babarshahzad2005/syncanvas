import { describe, expect, it } from "vitest"
import { mentionAt, suggestions, toEditable, toStored } from "./mentions"

describe("Mentions while typing", () => {
  it("stores picked names as ids, longest first, and leaves typed names alone", () => {
    const picked = new Map([
      ["Ada", "u1"],
      ["Ada Lovelace", "u2"],
    ])
    expect(toStored("@Ada Lovelace and @Ada, not @Grace", picked)).toBe(
      "<@u2> and <@u1>, not @Grace",
    )
  })

  it("turns a saved comment back into names for editing", () => {
    const { text, picked } = toEditable("Hi <@u1> and <@gone>, <@unknown>", [
      { id: "u1", name: "Grace Hopper", member: true },
      { id: "gone", name: "Linus", member: false },
    ])
    expect(text).toBe("Hi @Grace Hopper and @Linus, @someone")
    expect([...picked]).toEqual([["Grace Hopper", "u1"]])
  })

  it("finds the @query just before the caret", () => {
    expect(mentionAt("Hello @gr", 9)).toEqual({ start: 6, query: "gr" })
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" })
    expect(mentionAt("mail me@example.com", 19)).toBeNull()
    expect(mentionAt("Hello @grace there", 18)).toBeNull()
  })

  it("suggests Members by name or email, best match first", () => {
    const members = [
      { name: "Grace Hopper", email: "grace@example.com" },
      { name: "Ada Lovelace", email: "ada@example.com" },
      { name: "Linus", email: "lt@example.com" },
    ]
    expect(suggestions(members, "lo").map((m) => m.name)).toEqual(["Ada Lovelace"])
    expect(suggestions(members, "g").map((m) => m.name)).toEqual(["Grace Hopper"])
    expect(suggestions(members, "lt").map((m) => m.name)).toEqual(["Linus"])
    expect(suggestions(members, "")).toHaveLength(3)
  })
})
