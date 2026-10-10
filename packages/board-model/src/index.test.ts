import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { elementsOf, isPaletteColor, readElement, validateBoardDoc } from "./index"

function rect(fields: Record<string, unknown> = {}) {
  const m = new Y.Map<unknown>()
  const base = {
    type: "rect",
    position: { x: 1, y: 2 },
    size: { w: 30, h: 20 },
    z: "a0",
    color: "ink",
  }
  for (const [k, v] of Object.entries({ ...base, ...fields })) if (v !== undefined) m.set(k, v)
  return m
}

function docWith(fields?: Record<string, unknown>) {
  const doc = new Y.Doc()
  elementsOf(doc).set("e1", rect(fields))
  return doc
}

describe("isPaletteColor", () => {
  it("accepts palette names and rejects raw colors", () => {
    expect(isPaletteColor("ink")).toBe(true)
    expect(isPaletteColor("#1C1B19")).toBe(false)
    expect(isPaletteColor(undefined)).toBe(false)
  })
})

describe("validateBoardDoc", () => {
  it("accepts a valid rectangle", () => {
    const doc = docWith()
    expect(validateBoardDoc(doc)).toEqual([])
    expect(readElement(elementsOf(doc).get("e1") as Y.Map<unknown>)).toMatchObject({ type: "rect" })
  })

  it("accepts an empty Board", () => {
    expect(validateBoardDoc(new Y.Doc())).toEqual([])
  })

  it.each([
    ["a raw hex color", { color: "#ff0000" }],
    ["split x/y fields instead of one position", { position: undefined, x: 1, y: 2 }],
    ["a negative size", { size: { w: -1, h: 5 } }],
    ["a non-finite position", { position: { x: Number.NaN, y: 0 } }],
    ["an unknown type", { type: "triangle" }],
    ["an extra field", { extra: true }],
  ])("rejects %s", (_label, fields) => {
    expect(validateBoardDoc(docWith(fields))).not.toEqual([])
  })

  it("rejects an elements root that isn't a map", () => {
    const doc = new Y.Doc()
    doc.getArray("elements").push([1])
    expect(validateBoardDoc(doc)).toEqual(['root "elements" is not a map'])
  })

  it("rejects list items sent into elements over the wire", () => {
    const attacker = new Y.Doc()
    attacker.getArray("elements").push(["junk"])
    const received = new Y.Doc()
    Y.applyUpdate(received, Y.encodeStateAsUpdate(attacker))
    expect(validateBoardDoc(received)).toContain('root "elements" has list content')
  })

  it("rejects an Element that isn't a map", () => {
    const doc = new Y.Doc()
    elementsOf(doc).set("e1", "nope" as unknown as Y.Map<unknown>)
    expect(validateBoardDoc(doc)).toEqual(["element e1 is not a map"])
  })

  it("rejects content outside the elements map", () => {
    const doc = new Y.Doc()
    doc.getMap("hacked").set("x", 1)
    expect(validateBoardDoc(doc)).toContain('unexpected root "hacked"')
  })
})
