import type {
  CreateBoardResponse,
  GuestTokenResponse,
  ImageUploadResponse,
  Role,
  ShareLinkState,
} from "@syncanvas/shared"
import { IMAGE_MAX_BYTES, IMAGE_QUOTA_BYTES, imageUrl } from "@syncanvas/shared"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { images, kvWrites, user } from "./db/schema"
import { IMAGE_PAUSED, IMAGE_QUOTA, IMAGE_TOO_BIG, IMAGE_WRONG_TYPE, imageInfo } from "./images"
import { createTestApp, type TestApp } from "./test-app"
import { KV_WRITES_FOR_IMAGES, KV_WRITES_FOR_THUMBNAILS } from "./thumbnails"

// Images on Boards (M5b ticket 02): what the header says, who may upload, the limits, who may
// read, and that Delete forever takes the files with it.

// ---------- Just enough of each format for its header ----------

function png(width = 40, height = 30, size = 64) {
  const b = new Uint8Array(size)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0)
  b.set(new TextEncoder().encode("IHDR"), 12)
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}
function gif(width: number, height: number) {
  const b = new Uint8Array(32)
  b.set(new TextEncoder().encode("GIF89a"), 0)
  new DataView(b.buffer).setUint16(6, width, true)
  new DataView(b.buffer).setUint16(8, height, true)
  return b
}
/** A JPEG with an optional EXIF orientation, then a baseline frame header (SOF0). */
function jpeg(width: number, height: number, orientation?: number) {
  const parts: number[] = [0xff, 0xd8]
  if (orientation) {
    // APP1 "Exif\0\0", then a big-endian TIFF with one IFD entry: orientation (0x0112).
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1]
    tiff.push(0, orientation, 0, 0, 0, 0, 0, 0)
    const body = [...new TextEncoder().encode("Exif\0\0"), ...tiff]
    parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body)
  }
  parts.push(0xff, 0xdb, 0, 4, 0, 0) // a quantization table (skipped)
  parts.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 0)
  parts.push(0, 0, 0, 0)
  return new Uint8Array(parts)
}
function webp(chunk: "VP8 " | "VP8L" | "VP8X", width: number, height: number) {
  const b = new Uint8Array(40)
  const text = new TextEncoder()
  b.set(text.encode("RIFF"), 0)
  b.set(text.encode("WEBP"), 8)
  b.set(text.encode(chunk), 12)
  const v = new DataView(b.buffer)
  if (chunk === "VP8 ") {
    b.set([0x9d, 0x01, 0x2a], 23)
    v.setUint16(26, width, true)
    v.setUint16(28, height, true)
  } else if (chunk === "VP8L") {
    b[20] = 0x2f
    const bits = (width - 1) | ((height - 1) << 14)
    v.setUint32(21, bits, true)
  } else {
    v.setUint16(24, (width - 1) & 0xffff, true)
    b[26] = (width - 1) >> 16
    v.setUint16(27, (height - 1) & 0xffff, true)
    b[29] = (height - 1) >> 16
  }
  return b
}

describe("imageInfo", () => {
  it("reads the type and size from each format's header", () => {
    expect(imageInfo(png(640, 480))).toEqual({ type: "image/png", width: 640, height: 480 })
    expect(imageInfo(gif(320, 200))).toEqual({ type: "image/gif", width: 320, height: 200 })
    expect(imageInfo(jpeg(1024, 768))).toEqual({ type: "image/jpeg", width: 1024, height: 768 })
    for (const chunk of ["VP8 ", "VP8L", "VP8X"] as const) {
      expect(imageInfo(webp(chunk, 300, 150))).toEqual({
        type: "image/webp",
        width: 300,
        height: 150,
      })
    }
  })

  it("swaps width and height for a JPEG its EXIF says to turn", () => {
    expect(imageInfo(jpeg(4032, 3024, 6))).toMatchObject({ width: 3024, height: 4032 })
    expect(imageInfo(jpeg(4032, 3024, 3))).toMatchObject({ width: 4032, height: 3024 })
  })

  it("refuses anything else, and headers with no size", () => {
    expect(imageInfo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
      null,
    )
    expect(imageInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(null)
    expect(imageInfo(png(0, 10))).toBe(null)
  })
})

// ---------- The API ----------

let t: TestApp
let ada: string

async function json<T>(res: Response) {
  return (await res.json()) as T
}

async function create(cookie: string) {
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title: "Plan" }),
    cookie,
  })
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

const upload = (cookie: string, boardId: string, bytes: Uint8Array<ArrayBuffer> = png()) =>
  t.request(`/api/boards/${boardId}/images`, {
    method: "POST",
    body: bytes,
    headers: { "content-type": "application/octet-stream" },
    cookie,
  })

async function uploaded(cookie: string, boardId: string) {
  const res = await upload(cookie, boardId)
  expect(res.status).toBe(201)
  return (await json<ImageUploadResponse>(res)).key
}

async function guestToken(boardId: string) {
  const link = await json<ShareLinkState>(
    await t.request(`/api/boards/${boardId}/share-link`, {
      method: "PUT",
      body: "{}",
      cookie: ada,
    }),
  )
  const guest = await json<GuestTokenResponse>(
    await t.request(`/api/guest/boards/${boardId}/token`, {
      method: "POST",
      body: JSON.stringify({ token: link.token }),
    }),
  )
  return guest.token
}

const read = (key: string, auth: { cookie?: string; token?: string } = {}) =>
  t.request(imageUrl(key), {
    cookie: auth.cookie,
    headers: auth.token ? { authorization: `Bearer ${auth.token}` } : {},
  })

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
})

describe("Uploading an image", () => {
  it("stores an Editor's image under a new key, with its size from the header", async () => {
    const board = await create(ada)
    const editor = await share(board, "grace@example.com", "editor")
    // The Content-Type said octet-stream: the bytes decide.
    const res = await upload(editor, board, png(800, 600))
    expect(res.status).toBe(201)
    const body = await json<ImageUploadResponse>(res)
    expect(body).toEqual({
      key: expect.stringMatching(new RegExp(`^images/${board}/[0-9a-f-]{36}$`)),
      width: 800,
      height: 600,
    })
    expect(t.assets.get(body.key)?.contentType).toBe("image/png")
    const [row] = await t.db.select().from(images).where(eq(images.key, body.key))
    expect(row).toMatchObject({ boardId: board, bytes: 64, contentType: "image/png" })
  })

  it("refuses Commenters, Viewers, and anyone without access", async () => {
    const board = await create(ada)
    const commenter = await share(board, "c@example.com", "commenter")
    const viewer = await share(board, "v@example.com", "viewer")
    const stranger = await t.signIn("s@example.com")
    for (const cookie of [commenter, viewer]) {
      const res = await upload(cookie, board)
      expect(res.status).toBe(403)
      expect((await json<{ error: string }>(res)).error).toBe(
        "Only the owner and editors can add images.",
      )
    }
    expect((await upload(stranger, board)).status).toBe(403)
    expect(t.assets.size).toBe(0)
  })

  it("refuses other file types and files over 5 MB", async () => {
    const board = await create(ada)
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")
    const wrong = await upload(ada, board, svg as Uint8Array<ArrayBuffer>)
    expect(wrong.status).toBe(415)
    expect((await json<{ error: string }>(wrong)).error).toBe(IMAGE_WRONG_TYPE)
    const big = await upload(ada, board, png(10, 10, IMAGE_MAX_BYTES + 1))
    expect(big.status).toBe(413)
    expect((await json<{ error: string }>(big)).error).toBe(IMAGE_TOO_BIG)
    expect((await upload(ada, board, png(10, 10, IMAGE_MAX_BYTES))).status).toBe(201)
  })

  it("keeps each User within 50 MB on Boards that still exist", async () => {
    const board = await create(ada)
    const full = await create(ada)
    await t.db.insert(images).values({
      key: `images/${full}/${crypto.randomUUID()}`,
      boardId: full,
      userId:
        (await t.db.select().from(user).where(eq(user.email, "ada@example.com")))[0]?.id ?? "",
      bytes: IMAGE_QUOTA_BYTES - 32,
      contentType: "image/png",
    })
    const res = await upload(ada, board)
    expect(res.status).toBe(403)
    expect((await json<{ error: string }>(res)).error).toBe(IMAGE_QUOTA)
    // Another User has their own 50 MB.
    const editor = await share(board, "grace@example.com", "editor")
    expect((await upload(editor, board)).status).toBe(201)
    // Deleting the full Board for good frees Ada's space.
    await t.request(`/api/boards/${full}`, { method: "DELETE", cookie: ada })
    await t.request(`/api/boards/${full}/forever`, { method: "DELETE", cookie: ada })
    expect((await upload(ada, board)).status).toBe(201)
  })

  it("pauses at 950 KV writes a day, after thumbnails have stopped at 700", async () => {
    const board = await create(ada)
    const today = new Date().toISOString().slice(0, 10)
    await t.db.insert(kvWrites).values({ day: today, count: KV_WRITES_FOR_THUMBNAILS })
    const thumb = await t.request(`/api/boards/${board}/thumbnail`, {
      method: "PUT",
      body: png(),
      headers: { "content-type": "image/png" },
      cookie: ada,
    })
    expect(thumb.status).toBe(503)
    expect((await upload(ada, board)).status).toBe(201)
    await t.db.update(kvWrites).set({ count: KV_WRITES_FOR_IMAGES }).where(eq(kvWrites.day, today))
    const res = await upload(ada, board)
    expect(res.status).toBe(503)
    expect((await json<{ error: string }>(res)).error).toBe(IMAGE_PAUSED)
  })
})

describe("Reading an image", () => {
  it("serves Members by session, cached privately for good", async () => {
    const board = await create(ada)
    const viewer = await share(board, "v@example.com", "viewer")
    const key = await uploaded(ada, board)
    for (const cookie of [ada, viewer]) {
      const res = await read(key, { cookie })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/png")
      expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
      expect(res.headers.get("x-content-type-options")).toBe("nosniff")
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(png())
    }
    expect((await read(key, { cookie: await t.signIn("s@example.com") })).status).toBe(403)
    expect((await read(key)).status).toBe(401)
  })

  it("serves anyone with that Board's token, and no other Board's", async () => {
    const board = await create(ada)
    const other = await create(ada)
    const key = await uploaded(ada, board)
    expect((await read(key, { token: await guestToken(board) })).status).toBe(200)
    expect((await read(key, { token: await guestToken(other) })).status).toBe(403)
    expect((await read(key, { token: "forged" })).status).toBe(403)
  })

  it("closes to tokens once the Board is in Trash", async () => {
    const board = await create(ada)
    const key = await uploaded(ada, board)
    const token = await guestToken(board)
    await t.request(`/api/boards/${board}`, { method: "DELETE", cookie: ada })
    expect((await read(key, { token })).status).toBe(403)
  })

  it("answers 404 for a key KV doesn't have (yet)", async () => {
    const board = await create(ada)
    const key = await uploaded(ada, board)
    t.assets.delete(key)
    expect((await read(key, { cookie: ada })).status).toBe(404)
    expect((await read(`images/${board}/not-a-uuid`, { cookie: ada })).status).toBe(404)
  })
})

describe("Deleting a Board for good", () => {
  it("deletes its image files and rows", async () => {
    const board = await create(ada)
    const kept = await create(ada)
    await uploaded(ada, board)
    await uploaded(ada, board)
    const other = await uploaded(ada, kept)
    await t.request(`/api/boards/${board}`, { method: "DELETE", cookie: ada })
    expect(
      (await t.request(`/api/boards/${board}/forever`, { method: "DELETE", cookie: ada })).status,
    ).toBe(200)
    expect([...t.assets.keys()]).toEqual([other])
    expect((await t.db.select().from(images)).map((r) => r.key)).toEqual([other])
  })

  it("keeps the Board for the next cleanup if KV can't delete them", async () => {
    const board = await create(ada)
    await uploaded(ada, board)
    await t.request(`/api/boards/${board}`, { method: "DELETE", cookie: ada })
    const realDelete = t.assetStore.delete
    t.assetStore.delete = async () => {
      throw new Error("KV is down")
    }
    const res = await t.request(`/api/boards/${board}/forever`, { method: "DELETE", cookie: ada })
    t.assetStore.delete = realDelete
    expect(res.status).toBe(500)
    expect(await t.db.select().from(images)).toHaveLength(1)
  })
})
