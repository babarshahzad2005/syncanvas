import type {
  CreateBoardResponse,
  GuestTokenResponse,
  Role,
  ShareLinkState,
  ThreadsResponse,
  ThreadView,
} from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"

// Threads (M4 ticket 01): who may read and write them, what's stored, and what's relayed.

let t: TestApp
let ada: string
let board: string

async function json<T>(res: Response) {
  return (await res.json()) as T
}

async function member(email: string, role: Role) {
  const cookie = await t.signIn(email)
  const res = await t.request(`/api/boards/${board}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
    cookie: ada,
  })
  expect(res.status).toBe(201)
  return cookie
}

const create = (cookie: string, body: unknown, anchor: unknown = { x: 10, y: 20 }) =>
  t.request(`/api/boards/${board}/threads`, {
    method: "POST",
    body: JSON.stringify({ anchor, body }),
    cookie,
  })

const reply = (cookie: string, threadId: string, body: unknown) =>
  t.request(`/api/boards/${board}/threads/${threadId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
    cookie,
  })

async function list(cookie: string) {
  const res = await t.request(`/api/boards/${board}/threads`, { cookie })
  expect(res.status).toBe(200)
  return (await json<ThreadsResponse>(res)).threads
}

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title: "Q4 retro" }),
    cookie: ada,
  })
  board = ((await res.json()) as CreateBoardResponse).id
})

describe("Threads", () => {
  it("starts a Thread on an Element or a point, and relays it live", async () => {
    const onElement = await create(ada, "  Move this?  ", { elementId: "rect-1", fx: 0.25, fy: 2 })
    expect(onElement.status).toBe(201)
    const thread = await json<ThreadView>(onElement)
    expect(thread).toMatchObject({
      boardId: board,
      anchor: { elementId: "rect-1", fx: 0.25, fy: 1 }, // the spot stays inside the box
      status: "open",
      last: null,
      comments: [{ author: { name: "Ada" }, body: "Move this?", editedAt: null }],
    })
    const onPoint = await json<ThreadView>(await create(ada, "Over here", { x: -40.5, y: 300 }))
    expect(onPoint.anchor).toEqual({ x: -40.5, y: 300 })

    expect((await list(ada)).map((th) => th.id)).toEqual([thread.id, onPoint.id])
    expect(t.broadcasts.map((b) => [b.boardId, b.message.type, b.message.thread.id])).toEqual([
      [board, "thread-added", thread.id],
      [board, "thread-added", onPoint.id],
    ])
  })

  it("keeps replies in order and relays the whole Thread", async () => {
    const grace = await member("grace@example.com", "commenter")
    const thread = await json<ThreadView>(await create(ada, "First"))
    const res = await reply(grace, thread.id, "Line one\r\nline two")
    expect(res.status).toBe(201)
    const updated = await json<ThreadView>(res)
    expect(updated.comments.map((c) => [c.author?.name, c.body])).toEqual([
      ["Ada", "First"],
      ["Grace", "Line one\nline two"],
    ])
    expect(t.broadcasts.at(-1)?.message).toEqual({ type: "thread-updated", thread: updated })
  })

  it("lets Commenters and above write, and everyone on the Board read", async () => {
    const editor = await member("ed@example.com", "editor")
    const commenter = await member("co@example.com", "commenter")
    const viewer = await member("vi@example.com", "viewer")
    const outsider = await t.signIn("out@example.com")

    for (const cookie of [editor, commenter]) expect((await create(cookie, "Hi")).status).toBe(201)
    const [thread] = await list(viewer)
    if (!thread) throw new Error("expected a thread")

    const refused = await create(viewer, "Hi")
    expect(refused.status).toBe(403)
    expect((await json<{ error: string }>(refused)).error).toBe(
      "Only commenters, editors, and the owner can comment.",
    )
    expect((await reply(viewer, thread.id, "Hi")).status).toBe(403)

    // Outsiders get the same answer as for a Board that doesn't exist.
    const outside = await create(outsider, "Hi")
    expect(outside.status).toBe(403)
    expect((await t.request(`/api/boards/${board}/threads`, { cookie: outsider })).status).toBe(403)
    expect((await reply(outsider, thread.id, "Hi")).status).toBe(403)
    expect((await t.request(`/api/boards/${board}/threads`)).status).toBe(401)
    expect(await list(ada)).toHaveLength(2)
  })

  it("checks the text and the place", async () => {
    expect((await create(ada, "   ")).status).toBe(400)
    expect((await create(ada, "x".repeat(2001))).status).toBe(400)
    expect((await create(ada, "x".repeat(2000))).status).toBe(201)
    expect((await create(ada, "Hi", null)).status).toBe(400)
    expect((await create(ada, "Hi", { x: "1", y: 2 })).status).toBe(400)
    expect((await create(ada, "Hi", { x: 1e9, y: 2 })).status).toBe(400)
    expect((await create(ada, "Hi", { elementId: "", fx: 0, fy: 0 })).status).toBe(400)
    const thread = (await list(ada))[0]
    expect((await reply(ada, thread?.id ?? "", "")).status).toBe(400)
    expect((await reply(ada, "no-such-thread", "Hi")).status).toBe(404)
  })

  it("never lets a Thread be answered from another Board", async () => {
    const thread = await json<ThreadView>(await create(ada, "Here"))
    const other = await t.request("/api/boards", {
      method: "POST",
      body: "{}",
      cookie: ada,
    })
    const otherId = ((await other.json()) as CreateBoardResponse).id
    const res = await t.request(`/api/boards/${otherId}/threads/${thread.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Sneaky" }),
      cookie: ada,
    })
    expect(res.status).toBe(404)
  })

  it("lets a Guest read with their board token, and nothing else", async () => {
    await create(ada, "For everyone")
    const link = await json<ShareLinkState>(
      await t.request(`/api/boards/${board}/share-link`, {
        method: "PUT",
        body: "{}",
        cookie: ada,
      }),
    )
    const guest = await json<GuestTokenResponse>(
      await t.request(`/api/guest/boards/${board}/token`, {
        method: "POST",
        body: JSON.stringify({ token: link.token }),
      }),
    )
    const read = (token: string, boardId = board) =>
      t.request(`/api/guest/boards/${boardId}/threads`, {
        headers: { authorization: `Bearer ${token}` },
      })
    const res = await read(guest.token)
    expect(res.status).toBe(200)
    expect((await json<ThreadsResponse>(res)).threads.map((th) => th.comments[0]?.body)).toEqual([
      "For everyone",
    ])
    expect((await read("forged")).status).toBe(403)
    expect((await read(guest.token, "another-board")).status).toBe(403)
  })
})
