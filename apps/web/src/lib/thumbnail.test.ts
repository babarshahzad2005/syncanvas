import type { ElementWithId } from "@syncanvas/board-model"
import { THUMBNAIL_EVERY_MS } from "@syncanvas/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createThumbnailQueue, type UploadOutcome } from "./thumbnail"

// The picture of a Board left twice within the server's window still arrives (FLOWS §6).

const picture = (text: string) => [{ id: text } as unknown as ElementWithId]

describe("createThumbnailQueue", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(outcomes: UploadOutcome[] = []) {
    const sent: { boardId: string; first: string; closing: boolean }[] = []
    const upload = vi.fn(
      async (boardId: string, elements: readonly ElementWithId[], closing: boolean) => {
        sent.push({ boardId, first: elements[0]?.id ?? "", closing })
        return outcomes.shift() ?? "stored"
      },
    )
    return { queue: createThumbnailQueue(upload, () => Date.now()), sent }
  }

  it("sends at once when allowed", async () => {
    const { queue, sent } = setup()
    await expect(queue.send("b", picture("hello"), true)).resolves.toBe(true)
    expect(sent).toEqual([{ boardId: "b", first: "hello", closing: true }])
  })

  it("holds a too-soon picture and sends it once allowed", async () => {
    const { queue, sent } = setup()
    await queue.send("b", picture("hello"), false)
    vi.advanceTimersByTime(3 * 60_000)
    const later = queue.send("b", picture("hello world"), true)
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(THUMBNAIL_EVERY_MS)
    await expect(later).resolves.toBe(true)
    // Sent from a timer, the page is still open: no need to outlive it.
    expect(sent.at(-1)).toEqual({ boardId: "b", first: "hello world", closing: false })
  })

  it("lets a newer picture replace a waiting one", async () => {
    const { queue, sent } = setup()
    await queue.send("b", picture("one"), false)
    const two = queue.send("b", picture("two"), false)
    const three = queue.send("b", picture("three"), false)
    await expect(two).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(THUMBNAIL_EVERY_MS + 5_000)
    await expect(three).resolves.toBe(true)
    expect(sent.map((s) => s.first)).toEqual(["one", "three"])
  })

  it("keeps each Board's turn separate", async () => {
    const { queue, sent } = setup()
    await queue.send("a", picture("a1"), false)
    await expect(queue.send("b", picture("b1"), false)).resolves.toBe(true)
    expect(sent.map((s) => s.first)).toEqual(["a1", "b1"])
  })

  it("waits its turn when the server says another picture just went", async () => {
    const { queue, sent } = setup(["too-soon", "stored"])
    const result = queue.send("b", picture("mine"), false)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(THUMBNAIL_EVERY_MS + 5_000)
    await expect(result).resolves.toBe(true)
    expect(sent).toHaveLength(2)
  })

  it("gives up on a failure, so the next leave tries again", async () => {
    const { queue } = setup(["failed"])
    await expect(queue.send("b", picture("x"), false)).resolves.toBe(false)
  })
})
