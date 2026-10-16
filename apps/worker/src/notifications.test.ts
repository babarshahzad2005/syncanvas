import type {
  CreateBoardResponse,
  NotificationsResponse,
  Role,
  SharingResponse,
  ThreadView,
} from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"

// Mentions and Notifications (M4 ticket 03): who gets notified, how Mentions are stored and
// shown, and reading the list.

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

async function idOf(email: string) {
  const res = await t.request(`/api/boards/${board}/sharing`, { cookie: ada })
  const id = (await json<SharingResponse>(res)).members.find((m) => m.email === email)?.id
  if (!id) throw new Error(`${email} isn't a Member`)
  return id
}

async function create(cookie: string, body: string) {
  const res = await t.request(`/api/boards/${board}/threads`, {
    method: "POST",
    body: JSON.stringify({ anchor: { x: 0, y: 0 }, body }),
    cookie,
  })
  expect(res.status).toBe(201)
  return json<ThreadView>(res)
}

async function reply(cookie: string, threadId: string, body: string) {
  const res = await t.request(`/api/boards/${board}/threads/${threadId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
    cookie,
  })
  expect(res.status).toBe(201)
  return json<ThreadView>(res)
}

async function inbox(cookie: string) {
  const res = await t.request("/api/notifications", { cookie })
  expect(res.status).toBe(200)
  return json<NotificationsResponse>(res)
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

describe("Mentions", () => {
  it("keeps Members' Mentions and shows their current names", async () => {
    await member("grace@example.com", "viewer")
    const grace = await idOf("grace@example.com")
    const thread = await create(ada, `Hi <@${grace}>, look`)
    const [first] = thread.comments
    expect(first?.body).toBe(`Hi <@${grace}>, look`)
    expect(first?.mentions).toEqual([{ id: grace, name: "Grace", member: true }])
  })

  it("turns Mentions of anyone else into plain text", async () => {
    const outsider = await t.signIn("out@example.com")
    void outsider
    const res = await t.request("/api/dashboard", { cookie: outsider })
    expect(res.status).toBe(200)
    // The outsider's id, from their own session.
    const session = await t.request("/api/auth/get-session", { cookie: outsider })
    const outsiderId = ((await session.json()) as { user: { id: string } }).user.id
    const thread = await create(ada, `Ping <@${outsiderId}> and <@nobody-at-all>!`)
    expect(thread.comments[0]?.body).toBe("Ping @Out and !")
    expect(thread.comments[0]?.mentions).toEqual([])
    expect((await inbox(outsider)).notifications).toEqual([])
  })

  it("shows a Mention of someone who left as plain text", async () => {
    const grace = await member("grace@example.com", "commenter")
    const graceId = await idOf("grace@example.com")
    const thread = await create(ada, `Thanks <@${graceId}>`)
    await t.request(`/api/boards/${board}/members/${graceId}`, { method: "DELETE", cookie: grace })
    const res = await t.request(`/api/boards/${board}/threads`, { cookie: ada })
    const [again] = (await json<{ threads: ThreadView[] }>(res)).threads
    expect(again?.id).toBe(thread.id)
    expect(again?.comments[0]?.mentions).toEqual([{ id: graceId, name: "Grace", member: false }])
  })
})

describe("Notifications", () => {
  it("notifies the mentioned, then everyone following the Thread on a reply, never the author", async () => {
    const grace = await member("grace@example.com", "commenter")
    const linus = await member("linus@example.com", "viewer")
    const editor = await member("ed@example.com", "editor")
    const [graceId, linusId] = [await idOf("grace@example.com"), await idOf("linus@example.com")]

    const thread = await create(ada, `<@${graceId}> what do you think? <@${linusId}> FYI`)
    expect((await inbox(grace)).notifications.map((n) => [n.kind, n.actor?.name])).toEqual([
      ["mention", "Ada"],
    ])
    expect((await inbox(linus)).unread).toBe(1)
    expect((await inbox(ada)).notifications).toEqual([]) // never yourself
    expect((await inbox(editor)).notifications).toEqual([]) // not in the Thread
    expect(t.broadcasts.at(-1)?.message).toEqual({
      type: "notify",
      userIds: expect.arrayContaining([graceId, linusId]),
    })

    // Grace replies: Ada (the author) and Linus (mentioned) follow it; Grace isn't notified.
    await reply(grace, thread.id, "Looks good")
    const adaInbox = await inbox(ada)
    expect(adaInbox.notifications.map((n) => [n.kind, n.actor?.name, n.excerpt])).toEqual([
      ["reply", "Grace", "Looks good"],
    ])
    expect((await inbox(linus)).notifications.map((n) => n.kind)).toEqual(["reply", "mention"])
    expect((await inbox(grace)).notifications).toHaveLength(1)

    // A reply that mentions a follower is one Notification for them: the Mention.
    await reply(editor, thread.id, `<@${graceId}> merged`)
    const graceKinds = (await inbox(grace)).notifications.map((n) => n.kind)
    expect(graceKinds).toEqual(["mention", "mention"])
  })

  it("reads them one at a time or all at once, each User only their own", async () => {
    const grace = await member("grace@example.com", "commenter")
    const graceId = await idOf("grace@example.com")
    await create(ada, `<@${graceId}> one`)
    await create(ada, `<@${graceId}> two`)
    const { notifications, unread } = await inbox(grace)
    expect(unread).toBe(2)
    expect(notifications.map((n) => n.excerpt)).toEqual([`@Grace two`, `@Grace one`])
    expect(notifications[0]).toMatchObject({ board: { id: board, title: "Q4 retro" }, read: false })

    const id = notifications[0]?.id ?? ""
    expect(
      (await t.request(`/api/notifications/${id}/read`, { method: "POST", cookie: ada })).status,
    ).toBe(404)
    expect(
      (await t.request(`/api/notifications/${id}/read`, { method: "POST", cookie: grace })).status,
    ).toBe(200)
    const unreadRes = await t.request("/api/notifications/unread", { cookie: grace })
    expect(await unreadRes.json()).toEqual({ unread: 1 })
    expect((await inbox(grace)).notifications.map((n) => n.read)).toEqual([true, false])

    await t.request("/api/notifications/read-all", { method: "POST", cookie: grace })
    expect((await inbox(grace)).unread).toBe(0)
    expect((await t.request("/api/notifications")).status).toBe(401)
  })

  it("hides Notifications for Boards you can't open anymore", async () => {
    const grace = await member("grace@example.com", "commenter")
    const graceId = await idOf("grace@example.com")
    await create(ada, `<@${graceId}> before you go`)
    expect((await inbox(grace)).unread).toBe(1)
    await t.request(`/api/boards/${board}/members/${graceId}`, { method: "DELETE", cookie: ada })
    expect(await inbox(grace)).toEqual({ notifications: [], unread: 0 })
  })

  it("notifies only people newly mentioned when a comment is edited", async () => {
    const grace = await member("grace@example.com", "commenter")
    await member("linus@example.com", "commenter")
    const [graceId, linusId] = [await idOf("grace@example.com"), await idOf("linus@example.com")]
    const thread = await create(ada, `<@${graceId}> hi`)
    const commentId = thread.comments[0]?.id ?? ""
    await t.request(`/api/boards/${board}/threads/${thread.id}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body: `<@${graceId}> <@${linusId}> hi all` }),
      cookie: ada,
    })
    expect((await inbox(grace)).notifications).toHaveLength(1)
    const linus = await t.signIn("linus@example.com")
    expect((await inbox(linus)).notifications.map((n) => n.kind)).toEqual(["mention"])
  })
})
