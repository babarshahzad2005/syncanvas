import { describe, expect, it } from "vitest"
import { canEdit } from "./index"

describe("canEdit", () => {
  it("allows Owners and Editors only", () => {
    expect(canEdit("owner")).toBe(true)
    expect(canEdit("editor")).toBe(true)
    expect(canEdit("commenter")).toBe(false)
    expect(canEdit("viewer")).toBe(false)
  })
})
