import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { ELEMENT_CAP, listElements, validateBoardDoc } from "./model"
import { applyTemplate, isTemplateId, TEMPLATE_IDS, TEMPLATES } from "./templates"

describe("templates", () => {
  for (const id of TEMPLATE_IDS) {
    describe(id, () => {
      it("is a valid Board within the Element cap", () => {
        const doc = new Y.Doc()
        const ids = applyTemplate(doc, id, null)
        expect(validateBoardDoc(doc)).toEqual([])
        expect(ids.length).toBe(TEMPLATES[id].elements.length)
        expect(listElements(doc).length).toBe(ids.length)
        expect(ids.length).toBeLessThanOrEqual(ELEMENT_CAP)
      })

      it("gets fresh ids every time", () => {
        const a = new Y.Doc()
        const b = new Y.Doc()
        const first = applyTemplate(a, id, null)
        const second = applyTemplate(b, id, null)
        expect(new Set([...first, ...second]).size).toBe(first.length * 2)
        const template = new Set(TEMPLATES[id].elements.map((e) => e.id))
        expect(first.some((x) => template.has(x))).toBe(false)
      })

      it("attaches every connector to Elements of the same template", () => {
        const doc = new Y.Doc()
        const ids = new Set(applyTemplate(doc, id, null))
        for (const e of listElements(doc)) {
          if (e.type !== "connector") continue
          expect(ids.has(e.start.elementId ?? "")).toBe(true)
          expect(ids.has(e.end.elementId ?? "")).toBe(true)
        }
      })

      it("is one transaction", () => {
        const doc = new Y.Doc()
        let transactions = 0
        doc.on("afterTransaction", () => transactions++)
        applyTemplate(doc, id, "tab")
        expect(transactions).toBe(1)
      })
    })
  }

  it("knows its ids", () => {
    expect(isTemplateId("kanban")).toBe(true)
    expect(isTemplateId("blank")).toBe(false)
    expect(isTemplateId(3)).toBe(false)
  })
})
