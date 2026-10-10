import { describe, expect, it } from "vitest"
import { backoffDelay } from "./board-connection"

describe("backoffDelay", () => {
  it("grows exponentially up to the cap, scaled by jitter", () => {
    expect(backoffDelay(0, () => 0.999)).toBe(499)
    expect(backoffDelay(3, () => 0.999)).toBe(3996)
    expect(backoffDelay(20, () => 0.999)).toBe(14_985)
  })
  it("spreads reconnects out instead of synchronizing them", () => {
    expect(backoffDelay(3, () => 0)).toBe(0)
    expect(backoffDelay(3, () => 0.5)).toBe(2000)
  })
})
