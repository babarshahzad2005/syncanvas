import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addConnector,
  addShape,
  deleteElements,
  type ElementWithId,
  indexById,
  listElements,
  moveElements,
  resolveConnector,
  setConnectorStyle,
  setGeometry,
  translatedGeometry,
  validateBoardDoc,
} from "./index"

function connected() {
  const doc = new Y.Doc()
  const a = addShape(doc, { type: "rect", position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }, "me")
  const b = addShape(
    doc,
    { type: "rect", position: { x: 300, y: 0 }, size: { w: 100, h: 50 } },
    "me",
  )
  const id = addConnector(
    doc,
    {
      start: { elementId: a, anchor: "right", fallback: { x: 100, y: 25 } },
      end: { elementId: b, anchor: "left", fallback: { x: 300, y: 25 } },
      style: "elbow",
    },
    "me",
  )
  const connector = () =>
    listElements(doc).find((e) => e.id === id) as Extract<ElementWithId, { type: "connector" }>
  const ends = () => resolveConnector(connector(), indexById(listElements(doc)))
  return { doc, a, b, id, connector, ends }
}

describe("connectors", () => {
  it("are valid and follow the Elements they attach to", () => {
    const { doc, a, ends } = connected()
    expect(validateBoardDoc(doc)).toEqual([])
    moveElements(doc, [[a, { x: 0, y: 100 }]], "me")
    expect(ends().start).toEqual({ x: 100, y: 125 })
  })

  it("keeps fallbacks current when an attached Element moves", () => {
    const { doc, a, connector } = connected()
    moveElements(doc, [[a, { x: 0, y: 100 }]], "me")
    expect(connector().start.fallback).toEqual({ x: 100, y: 125 })
  })

  it("leaves an end where its Element was when that Element is deleted", () => {
    const { doc, b, ends } = connected()
    moveElements(doc, [[b, { x: 300, y: 200 }]], "me")
    deleteElements(doc, [b], "me")
    expect(ends().end).toEqual({ x: 300, y: 225 })
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("leaves an end in place when someone else deletes its Element", () => {
    const { doc, b, ends } = connected()
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    deleteElements(other, [b], "them")
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other))
    expect(ends().end).toEqual({ x: 300, y: 25 })
  })

  it("moves only its free ends when moved itself", () => {
    const { doc, id, connector } = connected()
    const free = {
      ...connector(),
      end: { fallback: { x: 500, y: 500 } },
    }
    const geometry = translatedGeometry(free, { x: 10, y: 20 })
    expect(geometry).toEqual({ end: { fallback: { x: 510, y: 520 } } })
    setGeometry(doc, [[id, geometry ?? {}]], "me")
    expect(connector().end).toEqual({ fallback: { x: 510, y: 520 } })
    expect(connector().start.elementId).toBeDefined()
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("switches between straight and elbow", () => {
    const { doc, id, connector } = connected()
    setConnectorStyle(doc, id, "straight", "me")
    expect(connector().style).toBe("straight")
  })
})
