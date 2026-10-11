import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addArrow,
  addElement,
  addShape,
  type ConnectorElement,
  type ElementWithId,
  effectiveGroupId,
  elementsOf,
  expandToGroups,
  groupMembers,
  indexById,
  listElements,
  readElement,
  recolorElement,
  resolveConnector,
  setFill,
  TEXT_LIMIT,
  validateBoardDoc,
} from "./index"

// A Board saved by M0 code: one rectangle with exactly the five v1 fields, as the bytes
// that code produced (Y.encodeStateAsUpdate). Production Boards hold updates like this.
const V1_RECT_UPDATE =
  "AQYBACcBCGVsZW1lbnRzC2xlZ2FjeS1yZWN0ASgAAQAEdHlwZQF3BHJlY3QoAAEACHBvc2l0aW9uAXYCAXh9CgF5fRQoAAEABHNpemUBdgIBd324AQFofZABKAABAAF6AXcCYTAoAAEABWNvbG9yAXcEYmx1ZQA="

const box = { position: { x: 0, y: 0 }, size: { w: 100, h: 60 }, z: "a0" }

/** Valid fields for each type. Text values become Y.Text. */
const VALID: Record<string, Record<string, unknown>> = {
  rect: { type: "rect", ...box, color: "ink", fill: "solid" },
  ellipse: { type: "ellipse", ...box, color: "teal", fill: "none" },
  pen: {
    type: "pen",
    ...box,
    color: "red",
    width: "M",
    points: [
      [0, 0, 0.5],
      [10, 5, 0.7],
    ],
  },
  arrow: {
    type: "arrow",
    ...box,
    color: "ink",
    ends: { from: { x: 0, y: 0 }, to: { x: 100, y: 60 } },
  },
  connector: {
    type: "connector",
    z: "a0",
    color: "gray",
    start: { elementId: "a", anchor: "right", fallback: { x: 0, y: 0 } },
    end: { fallback: { x: 50, y: 50 } },
    style: "elbow",
  },
  text: {
    type: "text",
    ...box,
    color: "ink",
    text: "hello",
    fontSize: "XL",
    bold: false,
    align: "center",
  },
  sticky: { type: "sticky", ...box, color: "yellow", text: "idea", fontSize: "M", bold: true },
}

function fieldsOf(values: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue
    if ((k === "text" && typeof v === "string") || v instanceof Y.AbstractType) {
      const value = v instanceof Y.AbstractType ? v : new Y.Text(v as string)
      m.set(k, value)
    } else m.set(k, v)
  }
  return m
}

function docWith(values: Record<string, unknown>) {
  const doc = new Y.Doc()
  elementsOf(doc).set("e1", fieldsOf(values))
  return doc
}

/** Round-trips through update bytes, as the board room receives them. */
function overTheWire(doc: Y.Doc): Y.Doc {
  const received = new Y.Doc()
  Y.applyUpdate(received, Y.encodeStateAsUpdate(doc))
  return received
}

describe("v1 Boards", () => {
  it("still load and validate a five-field rectangle saved by M0", () => {
    const doc = new Y.Doc()
    Y.applyUpdate(
      doc,
      Uint8Array.from(atob(V1_RECT_UPDATE), (c) => c.charCodeAt(0)),
    )
    expect(validateBoardDoc(doc)).toEqual([])
    expect(listElements(doc)).toEqual([
      {
        id: "legacy-rect",
        type: "rect",
        position: { x: 10, y: 20 },
        size: { w: 120, h: 80 },
        z: "a0",
        color: "blue",
        fill: "light",
      },
    ])
  })
})

describe("v2 Element types", () => {
  it.each(Object.keys(VALID))("accepts a valid %s, including over the wire", (type) => {
    const doc = overTheWire(docWith(VALID[type] as Record<string, unknown>))
    expect(validateBoardDoc(doc)).toEqual([])
    expect(listElements(doc)[0]).toMatchObject({ id: "e1", type })
  })

  it("reads text as a plain string snapshot", () => {
    const doc = overTheWire(docWith(VALID.sticky as Record<string, unknown>))
    expect(readElement(elementsOf(doc).get("e1") as Y.Map<unknown>)).toMatchObject({ text: "idea" })
  })

  it("accepts Lock and group membership on any type", () => {
    for (const values of Object.values(VALID)) {
      const doc = docWith({ ...values, locked: true, groupId: "g1" })
      expect(validateBoardDoc(doc)).toEqual([])
      expect(listElements(doc)[0]).toMatchObject({ locked: true, groupId: "g1" })
    }
  })

  const rect = VALID.rect as Record<string, unknown>
  const pen = VALID.pen as Record<string, unknown>
  const text = VALID.text as Record<string, unknown>
  const sticky = VALID.sticky as Record<string, unknown>
  const connector = VALID.connector as Record<string, unknown>

  it.each([
    ["an unknown field", { ...rect, shadow: true }],
    ["a field from another type", { ...rect, width: "M" }],
    ["a raw color", { ...rect, color: "#ff0000" }],
    ["split x/y", { ...rect, position: undefined, x: 0, y: 0 }],
    ["a position with extra keys", { ...rect, position: { x: 0, y: 0, z: 1 } }],
    ["a bad fill", { ...rect, fill: "gradient" }],
    ["a non-boolean lock", { ...rect, locked: "yes" }],
    ["an empty groupId", { ...rect, groupId: "" }],
    ["a missing required field", { ...pen, width: undefined }],
    ["pen points out of shape", { ...pen, points: [[0, 0]] }],
    ["pen pressure above 1", { ...pen, points: [[0, 0, 2]] }],
    ["no pen points", { ...pen, points: [] }],
    ["text as a plain string", { ...text, text: undefined, body: "x" }],
    ["a bad font size", { ...text, fontSize: "XXL" }],
    ["a bad align", { ...text, align: "justify" }],
    ["a non-sticky color on a sticky", { ...sticky, color: "ink" }],
    ["an XL sticky", { ...sticky, fontSize: "XL" }],
    ["a connector with a position", { ...connector, position: { x: 0, y: 0 } }],
    ["a connector end without fallback", { ...connector, end: { elementId: "a" } }],
    ["a bad anchor", { ...connector, end: { anchor: "middle", fallback: { x: 0, y: 0 } } }],
    ["a bad connector style", { ...connector, style: "curved" }],
  ])("rejects %s", (_label, values) => {
    expect(validateBoardDoc(docWith(values))).toEqual(["element e1 is invalid"])
  })

  it("rejects text stored as a plain string", () => {
    const m = fieldsOf({ ...text, text: undefined })
    m.set("text", "plain")
    const doc = new Y.Doc()
    elementsOf(doc).set("e1", m)
    expect(validateBoardDoc(doc)).toEqual(["element e1 is invalid"])
  })

  it("rejects formatted text, embeds, and XML text", () => {
    const formatted = new Y.Text()
    formatted.insert(0, "hi", { bold: true })
    const embedded = new Y.Text()
    embedded.insertEmbed(0, { image: "x" })
    for (const value of [formatted, embedded, new Y.XmlText("hi")]) {
      const doc = overTheWire(docWith({ ...text, text: value }))
      expect(validateBoardDoc(doc)).toEqual(["element e1 is invalid"])
    }
  })

  it("limits text length", () => {
    const atLimit = docWith({ ...sticky, text: "x".repeat(TEXT_LIMIT) })
    expect(validateBoardDoc(atLimit)).toEqual([])
    const over = docWith({ ...sticky, text: "x".repeat(TEXT_LIMIT + 1) })
    expect(validateBoardDoc(over)).toEqual(["element e1 is invalid"])
  })
})

describe("Element cap", () => {
  it("rejects a Board with more Elements than the cap", () => {
    const doc = new Y.Doc()
    for (let i = 0; i < 4; i++)
      elementsOf(doc).set(`e${i}`, fieldsOf(VALID.rect as Record<string, unknown>))
    expect(validateBoardDoc(doc, { elementCap: 4 })).toEqual([])
    expect(validateBoardDoc(doc, { elementCap: 3 })).toContain("more than 3 elements")
  })
})

describe("operations", () => {
  it("adds any type, turning text into Y.Text", () => {
    const doc = new Y.Doc()
    const { z: _z, ...values } = VALID.sticky as Record<string, unknown>
    const id = addElement(doc, values, "me")
    expect(elementsOf(doc).get(id)?.get("text")).toBeInstanceOf(Y.Text)
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("adds an arrow drawn in any direction, with its ends relative to its box", () => {
    const doc = new Y.Doc()
    addArrow(doc, { from: { x: 100, y: 20 }, to: { x: 40, y: 80 }, color: "red" }, "me")
    expect(listElements(doc)[0]).toMatchObject({
      type: "arrow",
      position: { x: 40, y: 20 },
      size: { w: 60, h: 60 },
      color: "red",
      ends: { from: { x: 60, y: 0 }, to: { x: 0, y: 60 } },
    })
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("adds ellipses and changes the fill of shapes only", () => {
    const doc = new Y.Doc()
    const ellipse = addShape(
      doc,
      { type: "ellipse", position: { x: 10, y: 10 }, size: { w: -10, h: 20 } },
      "me",
    )
    const sticky = addElement(doc, VALID.sticky as Record<string, unknown>, "me")
    setFill(doc, ellipse, "solid", "me")
    setFill(doc, sticky, "solid", "me") // stickies have no fill
    expect(listElements(doc).find((e) => e.id === ellipse)).toMatchObject({
      type: "ellipse",
      position: { x: 0, y: 10 },
      size: { w: 10, h: 20 },
      fill: "solid",
    })
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("never gives a sticky a non-sticky color", () => {
    const doc = new Y.Doc()
    const id = addElement(doc, VALID.sticky as Record<string, unknown>, "me")
    recolorElement(doc, id, "ink", "me")
    recolorElement(doc, id, "blue", "me")
    expect(listElements(doc)[0]?.color).toBe("blue")
    expect(validateBoardDoc(doc)).toEqual([])
  })
})

describe("groups", () => {
  const el = (id: string, groupId?: string) =>
    ({ id, ...(VALID.rect as object), ...(groupId ? { groupId } : {}) }) as ElementWithId

  it("collects members of a live group", () => {
    const elements = [el("a", "g"), el("b", "g"), el("c")]
    expect(groupMembers(elements, "g")).toEqual(["a", "b"])
    expect(effectiveGroupId(el("a", "g"), elements)).toBe("g")
    expect([...expandToGroups(["a", "c"], elements)].sort()).toEqual(["a", "b", "c"])
  })

  it("treats a group with fewer than 2 members as no group", () => {
    const elements = [el("a", "g"), el("c")]
    expect(groupMembers(elements, "g")).toEqual([])
    expect(effectiveGroupId(el("a", "g"), elements)).toBeUndefined()
    expect([...expandToGroups(["a"], elements)]).toEqual(["a"])
  })
})

describe("connectors", () => {
  const shape = {
    id: "a",
    ...(VALID.rect as object),
    position: { x: 100, y: 100 },
    size: { w: 50, h: 40 },
  } as ElementWithId
  const connector = { id: "c", ...(VALID.connector as object) } as ConnectorElement & { id: string }

  it("resolves an attached end from the Element's current geometry", () => {
    const { start } = resolveConnector(connector, indexById([shape, connector]))
    expect(start).toEqual({ x: 150, y: 120 }) // right side midpoint
  })

  it("follows the Element when it moves", () => {
    const moved = { ...shape, position: { x: 0, y: 0 } } as ElementWithId
    expect(resolveConnector(connector, indexById([moved])).start).toEqual({ x: 50, y: 20 })
  })

  it("falls back when the attached Element is gone", () => {
    expect(resolveConnector(connector, indexById([]))).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 50, y: 50 },
    })
  })

  it("uses the center when attached without an anchor", () => {
    const centered = { ...connector, end: { elementId: "a", fallback: { x: 0, y: 0 } } }
    expect(resolveConnector(centered, indexById([shape])).end).toEqual({ x: 125, y: 120 })
  })
})
