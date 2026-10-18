import type { CreateBoardResponse, DashboardResponse, Role } from "@syncanvas/shared"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { boards, kvWrites } from "./db/schema"
import { createTestApp, type TestApp } from "./test-app"
import { KV_WRITES_PER_DAY } from "./thumbnails"

// Board thumbnails (M5a ticket 05): who may upload, what, how often, and who may read them.

let t: TestApp
let ada: string

async function json<T>(res: Response) {
  return (await res.json()) as T
}

async function create(cookie: string, body: object = { title: "Plan" }) {
  const res = await t.request("/api/boards", { method: "POST", body: JSON.stringify(body), cookie })
  return ((await res.json()) as CreateBoardResponse).id
}

async function share(boardId: string, email: string, role: Role) {
  const cookie = await t.signIn(email)
  await t.request(`/api/boards/${boardId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
    cookie: ada,
  })
  return cookie
}

/** Just enough of a file to pass the signature check. */
function webp(size = 64) {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode("RIFF"), 0)
  bytes.set(new TextEncoder().encode("WEBP"), 8)
  return bytes
}
function png(size = 64) {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return bytes
}

const upload = (
  cookie: string,
  boardId: string,
  bytes: Uint8Array<ArrayBuffer> = webp(),
  type = "image/webp",
) =>
  t.request(`/api/boards/${boardId}/thumbnail`, {
    method: "PUT",
    body: bytes,
    headers: { "content-type": type },
    cookie,
  })

async function tile(cookie: string, boardId: string) {
  const { boards } = await json<DashboardResponse>(await t.request("/api/dashboard", { cookie }))
  return boards.find((b) => b.id === boardId)
}

/** Makes the current thumbnail look `minutes` old, as if uploaded back then. */
async function age(boardId: string, minutes: number) {
  const [row] = await t.db.select().from(boards).where(eq(boards.id, boardId))
  const key = row?.thumbnailKey ?? ""
  const older = `thumbs/${boardId}/${(Date.now() - minutes * 60_000).toString(36)}`
  const value = t.thumbs.get(key)
  if (value) t.thumbs.set(older, value)
  t.thumbs.delete(key)
  await t.db.update(boards).set({ thumbnailKey: older }).where(eq(boards.id, boardId))
  return older
}

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
})

describe("Uploading a thumbnail", () => {
  it("stores it in KV and puts a versioned URL on the dashboard", async () => {
    const board = await create(ada)
    expect((await tile(ada, board))?.thumbnailUrl).toBeNull()

    const res = await upload(ada, board)
    expect(res.status).toBe(200)
    const { thumbnailUrl } = await json<{ thumbnailUrl: string }>(res)
    expect(thumbnailUrl).toMatch(new RegExp(`^/api/assets/thumbs/${board}\\?v=[0-9a-z]+$`))
    expect((await tile(ada, board))?.thumbnailUrl).toBe(thumbnailUrl)
    expect([...t.thumbs.keys()]).toEqual([expect.stringMatching(`^thumbs/${board}/`)])
  })

  it("lets the Owner and Editors upload, and nobody else", async () => {
    const board = await create(ada)
    const editor = await share(board, "ed@example.com", "editor")
    const commenter = await share(board, "cy@example.com", "commenter")
    const viewer = await share(board, "vi@example.com", "viewer")
    const stranger = await t.signIn("zed@example.com")

    for (const cookie of [commenter, viewer]) {
      const res = await upload(cookie, board)
      expect(res.status).toBe(403)
      expect((await json<{ error: string }>(res)).error).toBe(
        "Only the owner and editors can update the thumbnail.",
      )
    }
    expect((await upload(stranger, board)).status).toBe(403)
    expect((await upload(editor, board)).status).toBe(200)
    expect(t.thumbs.size).toBe(1)
  })

  it("takes WebP or PNG up to 200 KB, and nothing else", async () => {
    const board = await create(ada)
    const text = new Uint8Array(new TextEncoder().encode("not an image at all, just some text"))
    expect((await upload(ada, board, text, "image/webp")).status).toBe(415)
    // The bytes must match the type claimed.
    expect((await upload(ada, board, png(), "image/webp")).status).toBe(415)
    expect((await upload(ada, board, webp(), "image/gif")).status).toBe(415)
    expect((await upload(ada, board, webp(200 * 1024 + 1))).status).toBe(413)
    expect(t.thumbs.size).toBe(0)
    expect((await upload(ada, board, png(), "image/png")).status).toBe(200)
  })

  it("allows one upload per Board every 10 minutes, replacing the old key", async () => {
    const board = await create(ada)
    const other = await create(ada)
    expect((await upload(ada, board)).status).toBe(200)
    const again = await upload(ada, board)
    expect(again.status).toBe(429)
    expect((await json<{ error: string }>(again)).error).toBe(
      "This board's thumbnail was updated in the last 10 minutes.",
    )
    // Another Board has its own limit.
    expect((await upload(ada, other)).status).toBe(200)

    await age(board, 9)
    expect((await upload(ada, board)).status).toBe(429)
    const old = await age(board, 11)
    expect((await upload(ada, board)).status).toBe(200)
    // One key per Board: the old one goes.
    expect(t.thumbs.has(old)).toBe(false)
    expect([...t.thumbs.keys()].filter((k) => k.startsWith(`thumbs/${board}/`))).toHaveLength(1)
  })

  it("stops for the day once KV writes reach the cap", async () => {
    const board = await create(ada)
    const today = new Date().toISOString().slice(0, 10)
    await t.db.insert(kvWrites).values({ day: today, count: KV_WRITES_PER_DAY - 1 })
    expect((await upload(ada, board)).status).toBe(200)
    await age(board, 11)
    const res = await upload(ada, board)
    expect(res.status).toBe(503)
    expect((await json<{ error: string }>(res)).error).toBe("Thumbnails are paused until tomorrow.")
    const [row] = await t.db.select().from(kvWrites).where(eq(kvWrites.day, today))
    expect(row?.count).toBe(KV_WRITES_PER_DAY)
  })
})

describe("Reading a thumbnail", () => {
  it("serves it to anyone who can open the Board, cached for good at its version", async () => {
    const board = await create(ada)
    const viewer = await share(board, "vi@example.com", "viewer")
    const stranger = await t.signIn("zed@example.com")
    expect((await t.request(`/api/assets/thumbs/${board}`, { cookie: ada })).status).toBe(404)

    const { thumbnailUrl } = await json<{ thumbnailUrl: string }>(await upload(ada, board))
    const res = await t.request(thumbnailUrl, { cookie: viewer })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/webp")
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp())

    // An old version still gets today's picture, but not for keeps.
    const stale = await t.request(`/api/assets/thumbs/${board}?v=old`, { cookie: viewer })
    expect(stale.headers.get("cache-control")).toBe("private, no-cache")

    expect((await t.request(thumbnailUrl, { cookie: stranger })).status).toBe(403)
    expect((await t.request(thumbnailUrl)).status).toBe(401)
    // A Board in Trash shows nothing.
    await t.request(`/api/boards/${board}`, { method: "DELETE", cookie: ada })
    expect((await t.request(thumbnailUrl, { cookie: viewer })).status).toBe(403)
  })

  it("goes from KV when the Board is deleted for good", async () => {
    const board = await create(ada)
    await upload(ada, board)
    expect(t.thumbs.size).toBe(1)
    await t.request(`/api/boards/${board}`, { method: "DELETE", cookie: ada })
    // Still there in Trash, so a restore brings it back.
    expect(t.thumbs.size).toBe(1)
    await t.request(`/api/boards/${board}/forever`, { method: "DELETE", cookie: ada })
    expect(t.thumbs.size).toBe(0)
  })

  it("tells the dashboard which template a Board came from", async () => {
    const board = await create(ada, { template: "kanban" })
    const plain = await create(ada)
    expect((await tile(ada, board))?.template).toBe("kanban")
    expect((await tile(ada, plain))?.template).toBeNull()
  })
})
