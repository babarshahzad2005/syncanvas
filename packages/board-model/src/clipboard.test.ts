import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addConnector,
  addShape,
  addText,
  copyPayload,
  type ElementWithId,
  groupElements,
  indexById,
  listElements,
  liveGroups,
  parsePayload,
  pasteElements,
  resolveConnectorEnd,
  validateBoardDoc,
} from "./index"

/** Two grouped rects joined by a connector, plus a text, and a connector to a third rect. */
function source() {
  const doc = new Y.Doc()
  const a = addShape(doc, { type: "rect", position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }, "me")
  const b = addShape(doc, { type: "rect", position: { x: 50, y: 0 }, size: { w: 10, h: 10 } }, "me")
  const far = addShape(
    doc,
    { type: "rect", position: { x: 500, y: 0 }, size: { w: 10, h: 10 } },
    "me",
  )
  groupElements(doc, [a, b], "me")
  addConnector(
    doc,
    {
      start: { elementId: a, anchor: "right", fallback: { x: 10, y: 5 } },
      end: { elementId: b, anchor: "left", fallback: { x: 50, y: 5 } },
      style: "elbow",
    },
    "me",
  )
  addConnector(
    doc,
    {
      start: { elementId: b, anchor: "right", fallback: { x: 60, y: 5 } },
      end: { elementId: far, anchor: "left", fallback: { x: 999, y: 999 } }, // stale on purpose
      style: "straight",
    },
    "me",
  )
  addText(doc, { position: { x: 0, y: 40 }, width: null, lineHeight: 26, content: "hello" }, "me")
  const all = listElements(doc)
  const byId = indexById(all)
  const copied = all.filter((e) => e.id !== far)
  const payload = copyPayload(copied, (end) => resolveConnectorEnd(end, byId))
  return { payload }
}

describe("copy and paste", () => {
  it("round-trips through JSON into another Board with new ids", () => {
    const { payload } = source()
    const parsed = parsePayload(JSON.parse(JSON.stringify(payload)))
    expect(parsed).toHaveLength(payload.elements.length)

    const target = new Y.Doc()
    addShape(target, { type: "ellipse", position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }, "them")
    const ids = pasteElements(target, parsed, { x: 100, y: 200 }, "me")
    expect(validateBoardDoc(target)).toEqual([])
    const pasted = listElements(target).filter((e) => ids.includes(e.id))
    expect(pasted).toHaveLength(5)
    expect(ids.some((id) => payload.elements.some((e) => e.id === id))).toBe(false)

    // On top, moved by the offset, text included.
    expect(listElements(target).at(0)?.type).toBe("ellipse")
    const text = pasted.find((e) => e.type === "text")
    expect(text?.type === "text" && [text.text, text.position]).toEqual([
      "hello",
      { x: 100, y: 240 },
    ])

    // The group came along with a new groupId.
    expect([...liveGroups(pasted).values()].map((members) => members.length)).toEqual([2])

    // The inner connector attaches to the pasted rects; the other one's far end is free,
    // at where it was drawn (moved by the offset), not its stale stored fallback.
    const connectors = pasted.filter((e) => e.type === "connector")
    const [inner, outer] = connectors as Extract<ElementWithId, { type: "connector" }>[]
    expect(ids).toContain(inner?.start.elementId)
    expect(ids).toContain(inner?.end.elementId)
    expect(outer?.end).toEqual({ fallback: { x: 600, y: 205 } })
  })

  it("drops anything that isn't a valid Element", () => {
    const { payload } = source()
    const tampered = {
      syncanvas: 1,
      elements: [
        ...payload.elements,
        { id: "x", type: "rect", position: { x: 0, y: 0 } },
        { id: "y", type: "pen", position: { x: 0, y: 0 }, size: { w: 1, h: 1 }, z: "a0" },
        "nonsense",
        { type: "rect" },
      ],
    }
    expect(parsePayload(tampered)).toHaveLength(payload.elements.length)
    expect(parsePayload({ syncanvas: 2, elements: [] })).toEqual([])
    expect(parsePayload("text")).toEqual([])
  })
})
