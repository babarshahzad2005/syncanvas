import type {
  CreateBoardResponse,
  NotificationsResponse,
  SharingResponse,
  UserSettings,
} from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { runCleanup, runDigest, unsubscribeUrl, verifyUnsubscribe } from "./digest"
import { createTestApp, env, ORIGIN, type TestApp } from "./test-app"

// Digest emails, unsubscribe, settings, and the daily cleanup (M4 ticket 04).

const HOUR = 60 * 60 * 1000
let t: TestApp
let ada: string
let grace: string
let graceId: string
let board: string

async function json<T>(res: Response) {
  return (await res.json()) as T
}

/** Ada mentions Grace in a new Thread: one Notification for Grace. */
async function mentionGrace(text = "look") {
  const res = await t.request(`/api/boards/${board}/threads`, {
    method: "POST",
    body: JSON.stringify({ anchor: { x: 0, y: 0 }, body: `<@${graceId}> ${text}` }),
    cookie: ada,
  })
  expect(res.status).toBe(201)
}

const digest = (hoursFromNow: number) =>
  runDigest(t.db, async (m) => void t.digests.push(m), {
    appUrl: ORIGIN,
    secret: env.BETTER_AUTH_SECRET,
    now: new Date(Date.now() + hoursFromNow * HOUR),
  })

const settings = (cookie: string, body?: unknown) =>
  t.request("/api/me/settings", {
    method: body === undefined ? "GET" : "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
    cookie,
  })

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title: "Q4 retro" }),
    cookie: ada,
  })
  board = ((await res.json()) as CreateBoardResponse).id
  grace = await t.signIn("grace@example.com")
  await t.request(`/api/boards/${board}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email: "grace@example.com", role: "commenter" }),
    cookie: ada,
  })
  const sharing = await json<SharingResponse>(
    await t.request(`/api/boards/${board}/sharing`, { cookie: ada }),
  )
  graceId = sharing.members.find((m) => m.email === "grace@example.com")?.id ?? ""
})

describe("Digest", () => {
  it("emails unread Notifications once they're an hour old, then marks them emailed", async () => {
    await mentionGrace("can you check?")
    expect(await digest(0)).toEqual({ sent: 0 }) // too new: it may still be read in the app
    expect(await digest(2)).toEqual({ sent: 1 })
    const [mail] = t.digests
    expect(mail).toMatchObject({
      email: "grace@example.com",
      more: 0,
      items: [
        { headline: "Ada mentioned you", boardTitle: "Q4 retro", excerpt: "@Grace can you check?" },
      ],
    })
    expect(mail?.items[0]?.url).toMatch(new RegExp(`/b/${board}\\?thread=`))
    const link = new URL(mail?.unsubscribeUrl ?? "")
    expect(
      await verifyUnsubscribe(
        env.BETTER_AUTH_SECRET,
        link.searchParams.get("u") ?? "",
        link.searchParams.get("t") ?? "",
      ),
    ).toBe(true)

    // Nothing goes twice, and it stays unread in the app.
    expect(await digest(6)).toEqual({ sent: 0 })
    expect(
      (await json<NotificationsResponse>(await t.request("/api/notifications", { cookie: grace })))
        .unread,
    ).toBe(1)
  })

  it("leaves out what was read, opted out, or on a Board you lost", async () => {
    await mentionGrace()
    await t.request("/api/notifications/read-all", { method: "POST", cookie: grace })
    expect(await digest(2)).toEqual({ sent: 0 })

    await mentionGrace()
    expect((await settings(grace, { digestEnabled: false })).status).toBe(200)
    expect(await digest(2)).toEqual({ sent: 0 })

    await settings(grace, { digestEnabled: true })
    await t.request(`/api/boards/${board}/members/${graceId}`, { method: "DELETE", cookie: ada })
    expect(await digest(2)).toEqual({ sent: 0 })
  })

  it("sends a User at most one digest every 3 hours", async () => {
    await mentionGrace("first")
    expect(await digest(2)).toEqual({ sent: 1 })
    await mentionGrace("second")
    // Two hours after the last digest: too soon.
    expect(await digest(4)).toEqual({ sent: 0 })
    expect(await digest(5.5)).toEqual({ sent: 1 })
    expect(t.digests.at(-1)?.items.map((i) => i.excerpt)).toEqual(["@Grace second"])
  })

  it("stops at 50 digests a day in total", async () => {
    const now = new Date(Date.now() + 2 * HOUR)
    await t.pg.query(
      `insert into digest_emails (id, user_id, sent_at)
       select gen_random_uuid()::text, id, $1 from "user", generate_series(1, 50) where email = 'ada@example.com'`,
      [now.toISOString()],
    )
    await mentionGrace()
    expect(await digest(2)).toEqual({ sent: 0 })
  })

  it("lists the newest 20 and counts the rest", async () => {
    for (let i = 0; i < 22; i++) await mentionGrace(`note ${i}`)
    await digest(2)
    const [mail] = t.digests
    expect(mail?.items).toHaveLength(20)
    expect(mail?.more).toBe(2)
    expect(mail?.items[0]?.excerpt).toBe("@Grace note 21")
  })
})

describe("Settings and unsubscribe", () => {
  it("keeps the digest switch per User, on by default", async () => {
    expect(await json<UserSettings>(await settings(grace))).toEqual({ digestEnabled: true })
    expect(await json<UserSettings>(await settings(grace, { digestEnabled: false }))).toEqual({
      digestEnabled: false,
    })
    expect(await json<UserSettings>(await settings(grace))).toEqual({ digestEnabled: false })
    expect(await json<UserSettings>(await settings(ada))).toEqual({ digestEnabled: true })
    expect((await settings(grace, { digestEnabled: "no" })).status).toBe(400)
    expect((await t.request("/api/me/settings")).status).toBe(401)
  })

  it("asks before unsubscribing, and refuses forged links", async () => {
    const url = new URL(await unsubscribeUrl(ORIGIN, env.BETTER_AUTH_SECRET, graceId))
    const path = url.pathname + url.search
    const page = await t.request(path)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("Stop digest emails?")
    expect(await json<UserSettings>(await settings(grace))).toEqual({ digestEnabled: true })

    const forged = `/api/unsubscribe?u=${graceId}&t=${"A".repeat(43)}`
    expect((await t.request(forged)).status).toBe(400)
    expect((await t.request(forged, { method: "POST", body: "" })).status).toBe(400)
    // Someone else's id with Grace's signature doesn't work either.
    const adaSession = await json<{ user: { id: string } }>(
      await t.request("/api/auth/get-session", { cookie: ada }),
    )
    const swapped = path.replace(graceId, adaSession.user.id)
    expect((await t.request(swapped, { method: "POST", body: "" })).status).toBe(400)

    // One click from a mail app (RFC 8058) turns digests off.
    const done = await t.request(path, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })
    expect(done.status).toBe(200)
    expect(await done.text()).toContain("unsubscribed") // the page escapes the apostrophe
    expect(await json<UserSettings>(await settings(grace))).toEqual({ digestEnabled: false })
  })
})

describe("Cleanup", () => {
  it("deletes old Notifications, expired Invitations, and old email logs", async () => {
    await mentionGrace("old")
    await mentionGrace("new")
    await t.request(`/api/boards/${board}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email: "pending@example.com", role: "viewer" }),
      cookie: ada,
    })
    await t.pg.exec(`
      update notifications set created_at = now() - interval '91 days'
        where comment_id in (select id from comments where body like '%old');
      update invitations set expires_at = now() - interval '1 minute';
      update invitation_emails set sent_at = now() - interval '3 days';
    `)
    await runCleanup(t.db)
    const count = async (sql: string) => (await t.pg.query<{ n: number }>(sql)).rows[0]?.n
    expect(await count("select count(*)::int as n from notifications")).toBe(1)
    expect(await count("select count(*)::int as n from invitations")).toBe(0)
    expect(await count("select count(*)::int as n from invitation_emails")).toBe(0)
  })
})
