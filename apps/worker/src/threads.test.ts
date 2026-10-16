import type {
  ControlMessage,
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

/** The Thread a relayed message is about. */
function threadIdOf(message: ControlMessage) {
  return "thread" in message ? message.thread.id : "threadId" in message ? message.threadId : null
}

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
    expect(t.broadcasts.map((b) => [b.boardId, b.message.type, threadIdOf(b.message)])).toEqual([
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
    // The Thread goes out live (then a "notify" for Ada, who follows it).
    expect(t.broadcasts.map((b) => b.message)).toContainEqual({
      type: "thread-updated",
      thread: updated,
    })
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

describe("Managing Threads", () => {
  const commentUrl = (threadId: string, commentId: string) =>
    `/api/boards/${board}/threads/${threadId}/comments/${commentId}`
  const edit = (cookie: string, threadId: string, commentId: string, body: unknown) =>
    t.request(commentUrl(threadId, commentId), {
      method: "PATCH",
      body: JSON.stringify({ body }),
      cookie,
    })
  const remove = (cookie: string, threadId: string, commentId: string) =>
    t.request(commentUrl(threadId, commentId), { method: "DELETE", cookie })
  const status = (cookie: string, threadId: string, action: "resolve" | "reopen") =>
    t.request(`/api/boards/${board}/threads/${threadId}/${action}`, { method: "POST", cookie })
  const removeThread = (cookie: string, threadId: string) =>
    t.request(`/api/boards/${board}/threads/${threadId}`, { method: "DELETE", cookie })

  async function threadWithReply(first: string, second: string) {
    const thread = await json<ThreadView>(await create(first, "First"))
    const replied = await json<ThreadView>(await reply(second, thread.id, "Second"))
    return replied
  }

  it("lets authors edit their own comments, marked as edited", async () => {
    const grace = await member("grace@example.com", "commenter")
    const thread = await threadWithReply(ada, grace)
    const [first, second] = thread.comments
    if (!first || !second) throw new Error("expected two comments")

    const res = await edit(grace, thread.id, second.id, "Second, edited")
    expect(res.status).toBe(200)
    const edited = (await json<ThreadView>(res)).comments[1]
    expect(edited?.body).toBe("Second, edited")
    expect(edited?.editedAt).not.toBeNull()
    expect(t.broadcasts.at(-1)?.message.type).toBe("thread-updated")

    // Not someone else's, not even the Owner's; and the text rules still apply.
    expect((await edit(ada, thread.id, second.id, "Mine now")).status).toBe(403)
    expect((await edit(grace, thread.id, first.id, "Mine now")).status).toBe(403)
    expect((await edit(grace, thread.id, second.id, "  ")).status).toBe(400)
  })

  it("deletes a lone first comment with its Thread", async () => {
    const thread = await json<ThreadView>(await create(ada, "Alone"))
    const res = await remove(ada, thread.id, thread.comments[0]?.id ?? "")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ thread: null })
    expect(await list(ada)).toEqual([])
    expect(t.broadcasts.at(-1)?.message).toEqual({ type: "thread-removed", threadId: thread.id })
  })

  it("keeps a replied-to first comment as 'Comment deleted', and drops replies", async () => {
    const grace = await member("grace@example.com", "commenter")
    const thread = await threadWithReply(ada, grace)
    const [first, second] = thread.comments
    if (!first || !second) throw new Error("expected two comments")

    const after = (await json<{ thread: ThreadView }>(await remove(ada, thread.id, first.id)))
      .thread
    expect(after.comments.map((c) => [c.deleted, c.author, c.body])).toEqual([
      [true, null, ""],
      [false, expect.objectContaining({ name: "Grace" }), "Second"],
    ])
    // The deleted one can't be edited or deleted again.
    expect((await edit(ada, thread.id, first.id, "Back")).status).toBe(404)
    expect((await remove(ada, thread.id, first.id)).status).toBe(404)

    // Once the last reply goes too, nothing is left, so the Thread goes.
    const res = await remove(grace, thread.id, second.id)
    expect(await res.json()).toEqual({ thread: null })
    expect(await list(ada)).toEqual([])
  })

  it("lets the author or the Owner delete a comment, and only the Owner a Thread", async () => {
    const grace = await member("grace@example.com", "commenter")
    const editor = await member("ed@example.com", "editor")
    const thread = await threadWithReply(editor, grace)
    const [, second] = thread.comments
    if (!second) throw new Error("expected a reply")

    expect((await remove(editor, thread.id, second.id)).status).toBe(403)
    expect((await removeThread(editor, thread.id)).status).toBe(403)
    expect((await removeThread(grace, thread.id)).status).toBe(403)
    expect((await remove(ada, thread.id, second.id)).status).toBe(200)

    expect((await removeThread(ada, thread.id)).status).toBe(200)
    expect(await list(ada)).toEqual([])
    expect(t.broadcasts.at(-1)?.message).toEqual({ type: "thread-removed", threadId: thread.id })
    expect((await removeThread(ada, thread.id)).status).toBe(404)
  })

  it("lets Commenters and above resolve and reopen; Viewers can't", async () => {
    const commenter = await member("co@example.com", "commenter")
    const viewer = await member("vi@example.com", "viewer")
    const thread = await json<ThreadView>(await create(ada, "Done?"))

    expect((await status(viewer, thread.id, "resolve")).status).toBe(403)
    const resolved = await status(commenter, thread.id, "resolve")
    expect((await json<ThreadView>(resolved)).status).toBe("resolved")
    expect((await list(viewer))[0]?.status).toBe("resolved")
    expect((await json<ThreadView>(await status(ada, thread.id, "reopen"))).status).toBe("open")
    expect((await status(ada, "no-such-thread", "resolve")).status).toBe(404)
  })

  it("stops a downgraded author from editing", async () => {
    const grace = await member("grace@example.com", "commenter")
    const thread = await threadWithReply(ada, grace)
    const graceId = thread.comments[1]?.author?.id ?? ""
    await t.request(`/api/boards/${board}/members/${graceId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "viewer" }),
      cookie: ada,
    })
    expect((await edit(grace, thread.id, thread.comments[1]?.id ?? "", "Late")).status).toBe(403)
    expect((await remove(grace, thread.id, thread.comments[1]?.id ?? "")).status).toBe(403)
  })
})
