import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addShape,
  deleteElements,
  expandToGroups,
  groupElements,
  listElements,
  liveGroups,
  moveElements,
  setLocked,
  ungroupElements,
  validateBoardDoc,
} from "./index"

function board(count: number) {
  const doc = new Y.Doc()
  const ids = Array.from({ length: count }, (_, i) =>
    addShape(doc, { type: "rect", position: { x: i * 20, y: 0 }, size: { w: 10, h: 10 } }, "me"),
  )
  return { doc, ids }
}
const groupIds = (doc: Y.Doc) => listElements(doc).map((e) => e.groupId)

describe("groups", () => {
  it("groups Elements so selecting one selects all", () => {
    const { doc, ids } = board(3)
    const [a, b, c] = ids as [string, string, string]
    const groupId = groupElements(doc, [a, b], "me")
    expect(groupId).not.toBeNull()
    expect(expandToGroups([a], listElements(doc))).toEqual(new Set([a, b]))
    expect(expandToGroups([c], listElements(doc))).toEqual(new Set([c]))
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("merges groups instead of nesting them", () => {
    const { doc, ids } = board(4)
    const [a, b, c, d] = ids as [string, string, string, string]
    groupElements(doc, [a, b], "me")
    groupElements(doc, [c, d], "me")
    const merged = groupElements(doc, [a, b, c, d], "me")
    expect(groupIds(doc)).toEqual([merged, merged, merged, merged])
    expect(liveGroups(listElements(doc)).size).toBe(1)
  })

  it("cleans up the member a merge leaves alone", () => {
    const { doc, ids } = board(3)
    const [a, b, c] = ids as [string, string, string]
    groupElements(doc, [a, b], "me")
    const merged = groupElements(doc, [b, c], "me")
    expect(groupIds(doc)).toEqual([undefined, merged, merged])
  })

  it("dissolves a group deleted down to one member", () => {
    const { doc, ids } = board(2)
    const [a, b] = ids as [string, string]
    groupElements(doc, [a, b], "me")
    deleteElements(doc, [a], "me")
    expect(groupIds(doc)).toEqual([undefined])
  })

  it("treats a stale groupId as no group and drops it on the next write", () => {
    // Two people delete different members at once: neither write saw the group dissolve.
    const { doc, ids } = board(3)
    const [a, b, c] = ids as [string, string, string]
    groupElements(doc, [a, b, c], "me")
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    deleteElements(doc, [a], "me")
    deleteElements(other, [b], "them")
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other))
    expect(liveGroups(listElements(doc)).size).toBe(0)
    expect(groupIds(doc)).not.toEqual([undefined]) // still stored...
    moveElements(doc, [[c, { x: 5, y: 5 }]], "me")
    expect(groupIds(doc)).toEqual([undefined]) // ...until a local write touches it
  })

  it("ungroups", () => {
    const { doc, ids } = board(2)
    groupElements(doc, ids, "me")
    ungroupElements(doc, ids, "me")
    expect(groupIds(doc)).toEqual([undefined, undefined])
  })
})

describe("Lock", () => {
  it("locks and unlocks, leaving no field behind", () => {
    const { doc, ids } = board(1)
    setLocked(doc, ids, true, "me")
    expect(listElements(doc)[0]?.locked).toBe(true)
    setLocked(doc, ids, false, "me")
    expect(listElements(doc)[0]).not.toHaveProperty("locked")
    expect(validateBoardDoc(doc)).toEqual([])
  })
})
