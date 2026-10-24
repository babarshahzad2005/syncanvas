import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addRect,
  addSticky,
  deleteElements,
  elementsOf,
  moveElements,
  UpdateChecker,
  type UpdateVerdict,
  validateBoardDoc,
} from "./index"

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

/** A copy of `doc`, as a client that has synced with it. */
function copyOf(doc: Y.Doc) {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

/** The rules as they were before 08b: try the update on a full copy and validate everything. */
function wholeBoardVerdict(doc: Y.Doc, update: Uint8Array, mayEdit: boolean): UpdateVerdict {
  const { structs, ds } = Y.decodeUpdate(update)
  if (structs.length === 0 && ds.clients.size === 0) return "unchanged"
  const scratch = copyOf(doc)
  Y.applyUpdate(scratch, update)
  if (Y.equalSnapshots(Y.snapshot(scratch), Y.snapshot(doc))) return "unchanged"
  if (!mayEdit) return "read-only"
  if (scratch.store.pendingStructs !== null && doc.store.pendingStructs === null) {
    return "incomplete"
  }
  return validateBoardDoc(scratch).length > 0 ? "invalid" : "accepted"
}

const box = { position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }

describe("UpdateChecker", () => {
  it("accepts a valid edit from an Editor, without touching the live doc", () => {
    const room = new Y.Doc()
    const client = new Y.Doc()
    const update = capture(client, () => addRect(client, box, "me"))
    expect(new UpdateChecker(room).check(update, true)).toBe("accepted")
    expect(elementsOf(room).size).toBe(0)
  })

  it("refuses edits from someone who can't edit", () => {
    const client = new Y.Doc()
    const update = capture(client, () => addRect(client, box, "me"))
    expect(new UpdateChecker(new Y.Doc()).check(update, false)).toBe("read-only")
  })

  it("ignores content the room already has, even from a read-only sender", () => {
    const client = new Y.Doc()
    const update = capture(client, () => addRect(client, box, "me"))
    const room = new Y.Doc()
    Y.applyUpdate(room, update)
    const checker = new UpdateChecker(room)
    expect(checker.check(update, false)).toBe("unchanged")
    expect(checker.check(Y.encodeStateAsUpdate(new Y.Doc()), false)).toBe("unchanged")
    expect(checker.check(Y.encodeStateAsUpdate(room), false)).toBe("unchanged")
  })

  it("refuses an edit that would make the Board invalid", () => {
    const client = new Y.Doc()
    const update = capture(client, () => {
      const fields = new Y.Map<unknown>()
      fields.set("type", "rect")
      elementsOf(client).set("bad", fields)
    })
    expect(new UpdateChecker(new Y.Doc()).check(update, true)).toBe("invalid")
  })

  it("refuses a nested text edit that makes an Element invalid", () => {
    const room = new Y.Doc()
    const id = addSticky(room, { center: { x: 0, y: 0 }, content: "hello" }, "room")
    const checker = new UpdateChecker(room)
    const client = copyOf(room)
    const text = elementsOf(client).get(id)?.get("text") as Y.Text
    // Formatting isn't allowed in Board text, and the change lives inside the Y.Text only.
    expect(
      checker.check(
        capture(client, () => text.format(0, 2, { bold: true })),
        true,
      ),
    ).toBe("invalid")
    const plain = copyOf(room)
    const ok = elementsOf(plain).get(id)?.get("text") as Y.Text
    expect(
      checker.check(
        capture(plain, () => ok.insert(5, " there")),
        true,
      ),
    ).toBe("accepted")
  })

  it("refuses an edit that adds an Element past the cap, but not a move at the cap", () => {
    const room = new Y.Doc()
    const a = addRect(room, box, "room")
    addRect(room, box, "room")
    const checker = new UpdateChecker(room, 2)
    const client = copyOf(room)
    expect(
      checker.check(
        capture(client, () => addRect(client, box, "me")),
        true,
      ),
    ).toBe("invalid")
    const mover = copyOf(room)
    const move = capture(mover, () => moveElements(mover, [[a, { x: 5, y: 5 }]], "me"))
    expect(checker.check(move, true)).toBe("accepted")
  })

  it("refuses a new root type and list content in the elements map", () => {
    const client = new Y.Doc()
    const root = capture(client, () => client.getMap("other").set("x", 1))
    expect(new UpdateChecker(new Y.Doc()).check(root, true)).toBe("invalid")
    const lister = new Y.Doc()
    const list = capture(lister, () => lister.getArray("elements").push([1]))
    expect(new UpdateChecker(new Y.Doc()).check(list, true)).toBe("invalid")
  })

  it("accepts deleting an Element", () => {
    const room = new Y.Doc()
    const id = addRect(room, box, "room")
    const client = copyOf(room)
    const update = capture(client, () => deleteElements(client, [id], "me"))
    expect(new UpdateChecker(room).check(update, true)).toBe("accepted")
  })

  it("rebuilds its copy after a rejection, so a later edit to the same Element is judged fresh", () => {
    const room = new Y.Doc()
    const id = addRect(room, box, "room")
    const checker = new UpdateChecker(room)
    const bad = copyOf(room)
    const badUpdate = capture(bad, () => elementsOf(bad).get(id)?.set("color", "nope"))
    expect(checker.check(badUpdate, true)).toBe("invalid")
    // Had the refused color stayed in the checker's copy, this move would be judged with it.
    const good = copyOf(room)
    const move = capture(good, () => moveElements(good, [[id, { x: 9, y: 9 }]], "me"))
    expect(checker.check(move, true)).toBe("accepted")
  })

  it("follows changes made to the live doc directly", () => {
    const room = new Y.Doc()
    addRect(room, box, "room")
    const checker = new UpdateChecker(room)
    // Known content: changes nothing, but builds the checker's copy.
    expect(checker.check(Y.encodeStateAsUpdate(room), true)).toBe("unchanged")
    const id = addRect(room, box, "room") // e.g. loading or a server-side change
    const client = copyOf(room)
    const move = capture(client, () => moveElements(client, [[id, { x: 1, y: 1 }]], "me"))
    // Without following, the move would depend on content the checker hadn't seen.
    expect(checker.check(move, true)).toBe("accepted")
  })

  it("sets aside an update that can only be partly applied", () => {
    // The room has rectangle E. Client C recolors it, but that edit never reaches the room.
    // A message then carries C's recolor-dependent edit (B recolors again on top of C's)
    // together with an unrelated new rectangle. Only the rectangle could be applied, so the
    // room must not judge (or store) the half it can see.
    const a = new Y.Doc()
    const e = addRect(a, box, "a")
    const room = copyOf(a)
    const b = copyOf(a)
    const c = copyOf(a)
    Y.applyUpdate(
      b,
      capture(c, () => elementsOf(c).get(e)?.set("color", "red")),
    )
    const fresh = new Y.Doc()
    const partial = Y.mergeUpdates([
      capture(fresh, () => addRect(fresh, box, "fresh")),
      capture(b, () => elementsOf(b).get(e)?.set("color", "blue")),
    ])
    const checker = new UpdateChecker(room)
    expect(checker.check(partial, true)).toBe("incomplete")
    // Its copy didn't keep the half it could apply.
    const later = copyOf(room)
    expect(
      checker.check(
        capture(later, () => addRect(later, box, "x")),
        true,
      ),
    ).toBe("accepted")
  })

  it("agrees with the whole-Board check on a random mix of edits", () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const room = new Y.Doc()
    const ids = Array.from({ length: 8 }, () => addRect(room, box, "room"))
    ids.push(addSticky(room, { center: { x: 0, y: 0 }, content: "note" }, "room"))
    const checker = new UpdateChecker(room)
    const edits: ((d: Y.Doc, id: string) => void)[] = [
      (d, id) => moveElements(d, [[id, { x: random() * 100, y: 0 }]], "me"),
      (d, id) =>
        elementsOf(d)
          .get(id)
          ?.set("color", random() < 0.5 ? "red" : "nope"),
      (d, id) => elementsOf(d).get(id)?.set("extra", 1),
      (d, id) => deleteElements(d, [id], "me"),
      (d) => addRect(d, box, "me"),
      (d) => elementsOf(d).set(`raw${random()}`, new Y.Map()),
      (d, id) => {
        const text = elementsOf(d).get(id)?.get("text")
        if (text instanceof Y.Text) text.insert(0, "x", random() < 0.5 ? { bold: true } : undefined)
        else elementsOf(d).get(id)?.set("z", "a1")
      },
    ]
    const verdicts = new Set<UpdateVerdict>()
    for (let i = 0; i < 300; i++) {
      const client = copyOf(room)
      const live = [...elementsOf(room).keys()]
      const id = live[Math.floor(random() * live.length)] ?? "none"
      const edit = edits[Math.floor(random() * edits.length)] ?? edits[0]
      let update: Uint8Array
      try {
        update = capture(client, () => edit?.(client, id))
      } catch {
        continue // the edit changed nothing
      }
      const mayEdit = random() < 0.9
      const expected = wholeBoardVerdict(room, update, mayEdit)
      expect(checker.check(update, mayEdit)).toBe(expected)
      verdicts.add(expected)
      if (expected === "accepted") Y.applyUpdate(room, update)
    }
    expect([...verdicts].sort()).toEqual(["accepted", "invalid", "read-only"])
  })
})
