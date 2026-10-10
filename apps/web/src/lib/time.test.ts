import { describe, expect, it } from "vitest"
import { timeAgo } from "./time"

const now = new Date("2026-10-10T12:00:00Z")
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString()

describe("timeAgo", () => {
  it("reads naturally at each scale", () => {
    expect(timeAgo(ago(10), now)).toBe("just now")
    expect(timeAgo(ago(5 * 60), now)).toBe("5 minutes ago")
    expect(timeAgo(ago(3 * 3600), now)).toBe("3 hours ago")
    expect(timeAgo(ago(26 * 3600), now)).toBe("yesterday")
    expect(timeAgo(ago(8 * 24 * 3600), now)).toBe("last week")
  })
})
