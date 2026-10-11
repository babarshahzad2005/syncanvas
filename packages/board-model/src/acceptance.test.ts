import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { addRect, checkUpdate, elementsOf } from "./index"

/** Records the update each transaction on `doc` produces. */
function capture(doc: Y.Doc, edit: () => void): Uint8Array {
  let update: Uint8Array | null = null
  const listener = (u: Uint8Array) => {
    update = u
  }
  doc.on("update", listener)
  edit()
  doc.off("update", listener)
  if (!update) throw new Error("no update")
  return update
}

const box = { position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }

describe("checkUpdate", () => {
  it("accepts a valid edit from an Editor, without touching the live doc", () => {
    const room = new Y.Doc()
    const client = new Y.Doc()
    const update = capture(client, () => addRect(client, box, "me"))
    expect(checkUpdate(room, update, true)).toBe("accepted")
    expect(elementsOf(room).size).toBe(0)
  })

  it("refuses edits from someone who can't edit", () => {
    const client = new Y.Doc()
    const update = capture(client, () => addRect(client, box, "me"))
    expect(checkUpdate(new Y.Doc(), update, false)).toBe("read-only")
  })

  it("ignores content the room already has, even from a read-only sender", () => {
    const client = new Y.Doc()
    const update = capture(client, () => addRect(client, box, "me"))
    const room = new Y.Doc()
    Y.applyUpdate(room, update)
    expect(checkUpdate(room, update, false)).toBe("unchanged")
    expect(checkUpdate(room, Y.encodeStateAsUpdate(new Y.Doc()), false)).toBe("unchanged")
  })

  it("refuses an edit that would make the Board invalid", () => {
    const client = new Y.Doc()
    const update = capture(client, () => {
      const fields = new Y.Map<unknown>()
      fields.set("type", "rect")
      elementsOf(client).set("bad", fields)
    })
    expect(checkUpdate(new Y.Doc(), update, true)).toBe("invalid")
  })

  it("sets aside an update that can only be partly applied", () => {
    // The room has rectangle E. Client C recolors it, but that edit never reaches the room.
    // A message then carries C's recolor-dependent edit (B recolors again on top of C's)
    // together with an unrelated new rectangle. Only the rectangle could be applied, so the
    // room must not judge (or store) the half it can see.
    const a = new Y.Doc()
    const e = addRect(a, box, "a")
    const room = new Y.Doc()
    Y.applyUpdate(room, Y.encodeStateAsUpdate(a))
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const c = new Y.Doc()
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a))
    Y.applyUpdate(
      b,
      capture(c, () => elementsOf(c).get(e)?.set("color", "red")),
    )
    const fresh = new Y.Doc()
    const partial = Y.mergeUpdates([
      capture(fresh, () => addRect(fresh, box, "fresh")),
      capture(b, () => elementsOf(b).get(e)?.set("color", "blue")),
    ])
    expect(checkUpdate(room, partial, true)).toBe("incomplete")
  })
})
