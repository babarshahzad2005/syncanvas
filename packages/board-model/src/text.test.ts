import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addElement,
  addText,
  applyTextChange,
  diffText,
  elementsOf,
  listElements,
  setTextStyle,
  textOf,
  transformIndex,
  validateBoardDoc,
} from "./index"

describe("diffText", () => {
  it.each([
    ["typing", "helo", "hello", { index: 3, remove: 0, insert: "l" }],
    ["deleting", "hello", "hllo", { index: 1, remove: 1, insert: "" }],
    [
      "replacing a selection",
      "hello world",
      "hello there",
      { index: 6, remove: 5, insert: "there" },
    ],
    ["no change", "same", "same", { index: 4, remove: 0, insert: "" }],
    ["repeated letters", "aaa", "aaaa", { index: 3, remove: 0, insert: "a" }],
  ])("finds the smallest edit for %s", (_label, before, after, expected) => {
    expect(diffText(before, after)).toEqual(expected)
  })
})

describe("diffText with emoji", () => {
  it.each([
    ["swapping one emoji for another", "a😀b", "a😃b"],
    ["typing after an emoji", "😀", "😀😃"],
    ["typing before an emoji", "😀", "😃😀"],
    ["deleting an emoji", "x😀😀y", "x😀y"],
  ])("never splits a surrogate pair: %s", (_label, before, after) => {
    const doc = new Y.Doc()
    const text = doc.getText("t")
    text.insert(0, before)
    applyTextChange(text, before, after, "me")
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    expect(copy.getText("t").toString()).toBe(after)
  })
})

describe("applyTextChange", () => {
  it("merges two people typing in the same text at the same time", () => {
    const a = new Y.Doc()
    const id = addText(
      a,
      { position: { x: 0, y: 0 }, width: null, lineHeight: 26, content: "hello" },
      "a",
    )
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    applyTextChange(textOf(a, id) as Y.Text, "hello", "hello world", "a")
    applyTextChange(textOf(b, id) as Y.Text, "hello", "oh hello", "b")
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(textOf(a, id)?.toString()).toBe("oh hello world")
    expect(textOf(b, id)?.toString()).toBe("oh hello world")
  })
})

describe("transformIndex", () => {
  const caretAfterRemote = (before: string, caret: number, edit: (t: Y.Text) => void) => {
    const doc = new Y.Doc()
    const text = doc.getText("t")
    text.insert(0, before)
    let result = -1
    text.observe((event) => {
      result = transformIndex(caret, event.delta)
    })
    edit(text)
    return result
  }

  it("moves the caret right when text is inserted before it", () => {
    expect(caretAfterRemote("hello", 5, (t) => t.insert(0, "oh "))).toBe(8)
  })
  it("keeps the caret when text is inserted after it", () => {
    expect(caretAfterRemote("hello", 2, (t) => t.insert(4, "XX"))).toBe(2)
  })
  it("keeps the caret in front of text inserted exactly at it", () => {
    expect(caretAfterRemote("hello", 2, (t) => t.insert(2, "XX"))).toBe(2)
  })
  it("pulls the caret back over text deleted before it", () => {
    expect(caretAfterRemote("hello world", 8, (t) => t.delete(0, 6))).toBe(2)
  })
  it("lands at the start of a deletion that swallowed the caret", () => {
    expect(caretAfterRemote("hello world", 8, (t) => t.delete(4, 6))).toBe(4)
  })
})

describe("text Elements", () => {
  it("adds auto-width and fixed-width texts that validate", () => {
    const doc = new Y.Doc()
    addText(doc, { position: { x: 1, y: 2 }, width: null, lineHeight: 26 }, "me")
    addText(doc, { position: { x: 1, y: 2 }, width: 200, lineHeight: 26, content: "hi" }, "me")
    expect(
      listElements(doc).map((e) => e.type === "text" && [e.autoWidth, e.text, e.size.w]),
    ).toEqual([
      [true, "", 0],
      [false, "hi", 200],
    ])
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("rejects a non-boolean autoWidth", () => {
    const doc = new Y.Doc()
    const id = addText(doc, { position: { x: 0, y: 0 }, width: null, lineHeight: 26 }, "me")
    elementsOf(doc).get(id)?.set("autoWidth", "yes")
    expect(validateBoardDoc(doc)).toEqual([`element ${id} is invalid`])
  })

  it("changes size, bold, and alignment (stickies have no alignment)", () => {
    const doc = new Y.Doc()
    const text = addText(doc, { position: { x: 0, y: 0 }, width: null, lineHeight: 26 }, "me")
    const sticky = addElement(
      doc,
      {
        type: "sticky",
        position: { x: 0, y: 0 },
        size: { w: 200, h: 200 },
        color: "yellow",
        text: "",
        fontSize: "M",
        bold: false,
      },
      "me",
    )
    setTextStyle(doc, text, { fontSize: "XL", bold: true, align: "right" }, "me")
    setTextStyle(doc, sticky, { fontSize: "L", align: "right" }, "me")
    expect(
      listElements(doc).map((e) =>
        e.type === "text" ? [e.fontSize, e.bold, e.align] : e.type === "sticky" && e.fontSize,
      ),
    ).toEqual([["XL", true, "right"], "L"])
    expect(validateBoardDoc(doc)).toEqual([])
  })
})
