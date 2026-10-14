import type {
  CreateBoardResponse,
  DashboardResponse,
  LimitError,
  Role,
  SharingResponse,
} from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"

// Sharing API (M3 ticket 01): Invitations, their Role rules and limits, and the sharing state.

let t: TestApp

async function json<T>(res: Response) {
  return (await res.json()) as T
}

async function createBoard(cookie: string, title = "Q4 retro") {
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title }),
    cookie,
  })
  return (await json<CreateBoardResponse>(res)).id
}

/** Signs `email` in and gives them `role` on the Board through an Owner's Invitation. */
async function member(owner: string, boardId: string, email: string, role: Role) {
  const cookie = await t.signIn(email)
  if (role !== "owner") {
    expect((await inviteAs(owner, boardId, email, role)).status).toBe(201)
  }
  return cookie
}

function inviteAs(cookie: string, boardId: string, email: unknown, role: unknown) {
  return t.request(`/api/boards/${boardId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
    cookie,
  })
}

async function sharing(cookie: string, boardId: string) {
  const res = await t.request(`/api/boards/${boardId}/sharing`, { cookie })
  expect(res.status).toBe(200)
  return json<SharingResponse>(res)
}

async function dashboardIds(cookie: string) {
  const res = await t.request("/api/dashboard", { cookie })
  return (await json<DashboardResponse>(res)).boards.map((b) => [b.id, b.role])
}

const resend = (cookie: string, boardId: string, id: string) =>
  t.request(`/api/boards/${boardId}/invitations/${id}/resend`, { method: "POST", cookie })
const cancel = (cookie: string, boardId: string, id: string) =>
  t.request(`/api/boards/${boardId}/invitations/${id}`, { method: "DELETE", cookie })

describe("Invitations", () => {
  let ada: string
  let board: string
  beforeEach(async () => {
    t = await createTestApp()
    ada = await t.signIn("ada@example.com")
    board = await createBoard(ada)
  })

  it("gives an existing User access at once, and emails them", async () => {
    const grace = await t.signIn("grace@example.com")
    const res = await inviteAs(ada, board, "  Grace@Example.com ", "commenter")
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ result: "member" })

    expect(await dashboardIds(grace)).toEqual([[board, "commenter"]])
    expect(t.invitations.at(-1)).toMatchObject({
      email: "grace@example.com",
      kind: "shared",
      inviter: "Ada",
      boardTitle: "Q4 retro",
      role: "commenter",
      url: `http://localhost:5173/b/${board}`,
    })
    const state = await sharing(ada, board)
    expect(state.members.map((m) => [m.email, m.role])).toEqual([
      ["ada@example.com", "owner"],
      ["grace@example.com", "commenter"],
    ])
    expect(state.invitations).toEqual([])
  })

  it("keeps an unknown address pending until its first sign-in", async () => {
    const res = await inviteAs(ada, board, "linus@example.com", "editor")
    expect(await res.json()).toEqual({ result: "invited" })
    expect(t.invitations.at(-1)).toMatchObject({ email: "linus@example.com", kind: "invitation" })

    const pending = (await sharing(ada, board)).invitations
    expect(pending).toEqual([
      expect.objectContaining({
        email: "linus@example.com",
        role: "editor",
        invitedBy: expect.objectContaining({ name: "Ada" }),
        canResend: true,
        canCancel: true,
      }),
    ])
    const days = (new Date(pending[0]?.expiresAt ?? 0).getTime() - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(30)

    const linus = await t.signIn("Linus@example.com")
    expect(await dashboardIds(linus)).toEqual([[board, "editor"]])
    expect((await sharing(ada, board)).invitations).toEqual([])
  })

  it("ignores an expired Invitation on sign-in", async () => {
    await inviteAs(ada, board, "late@example.com", "viewer")
    await t.pg.exec("update invitations set expires_at = now() - interval '1 minute'")
    expect((await sharing(ada, board)).invitations).toEqual([])

    const late = await t.signIn("late@example.com")
    expect(await dashboardIds(late)).toEqual([])
  })

  it("inviting a pending address again updates its Role and resends", async () => {
    await inviteAs(ada, board, "linus@example.com", "viewer")
    await inviteAs(ada, board, "linus@example.com", "editor")
    const pending = (await sharing(ada, board)).invitations
    expect(pending.map((i) => [i.email, i.role])).toEqual([["linus@example.com", "editor"]])
    expect(t.invitations).toHaveLength(2)
  })

  it("refuses to invite someone who already has access", async () => {
    await member(ada, board, "grace@example.com", "viewer")
    const sent = t.invitations.length
    const again = await inviteAs(ada, board, "grace@example.com", "editor")
    expect(again.status).toBe(409)
    expect((await json<{ error: string }>(again)).error).toBe(
      "Grace already has access to this board.",
    )
    expect((await inviteAs(ada, board, "ada@example.com", "editor")).status).toBe(409)
    expect(t.invitations).toHaveLength(sent)
    // The Role stays as it was.
    const state = await sharing(ada, board)
    expect(state.members.find((m) => m.email === "grace@example.com")?.role).toBe("viewer")
  })

  it("checks the email and the Role", async () => {
    expect((await inviteAs(ada, board, "not-an-email", "editor")).status).toBe(400)
    expect((await inviteAs(ada, board, 42, "editor")).status).toBe(400)
    expect((await inviteAs(ada, board, "x@example.com", "owner")).status).toBe(400)
    expect((await inviteAs(ada, board, "x@example.com", "admin")).status).toBe(400)
    expect(t.invitations).toHaveLength(0)
  })

  it("follows the PRD A4 Role rules", async () => {
    const editor = await member(ada, board, "ed@example.com", "editor")
    const commenter = await member(ada, board, "co@example.com", "commenter")
    const viewer = await member(ada, board, "vi@example.com", "viewer")
    const outsider = await t.signIn("out@example.com")

    // Editors invite at their own Role or lower.
    for (const role of ["editor", "commenter", "viewer"]) {
      expect((await inviteAs(editor, board, `${role}@example.com`, role)).status).toBe(201)
    }
    // Commenters, Viewers and outsiders can't invite; outsiders can't even tell the Board exists.
    expect((await inviteAs(commenter, board, "x@example.com", "viewer")).status).toBe(403)
    expect((await inviteAs(viewer, board, "x@example.com", "viewer")).status).toBe(403)
    const outside = await inviteAs(outsider, board, "x@example.com", "viewer")
    const unknown = await inviteAs(outsider, "no-such-board", "x@example.com", "viewer")
    expect(outside.status).toBe(403)
    expect(await outside.json()).toEqual(await unknown.json())
    expect((await t.request(`/api/boards/${board}/sharing`, { cookie: outsider })).status).toBe(403)
    expect((await t.request(`/api/boards/${board}/sharing`)).status).toBe(401)

    // What each Role is told it may do.
    const ownerView = await sharing(ada, board)
    expect([ownerView.canInvite, ownerView.canManage]).toEqual([
      ["editor", "commenter", "viewer"],
      true,
    ])
    const editorView = await sharing(editor, board)
    expect([editorView.canInvite, editorView.canManage]).toEqual([
      ["editor", "commenter", "viewer"],
      false,
    ])
    expect(editorView.invitations.every((i) => i.canCancel && !i.canResend)).toBe(true)
    const viewerView = await sharing(viewer, board)
    expect([viewerView.canInvite, viewerView.canManage]).toEqual([[], false])
    expect(viewerView.members).toHaveLength(4)
    expect(viewerView.invitations).toEqual([]) // pending ones are for inviters only
  })

  it("resends (Owner) and cancels (Owner, or the Editor who sent it)", async () => {
    const editor = await member(ada, board, "ed@example.com", "editor")
    await inviteAs(ada, board, "by-owner@example.com", "viewer")
    await inviteAs(editor, board, "by-editor@example.com", "viewer")
    const [byOwner, byEditor] = (await sharing(ada, board)).invitations
    if (!byOwner || !byEditor) throw new Error("expected two invitations")

    const sent = t.invitations.length
    expect((await resend(editor, board, byEditor.id)).status).toBe(403)
    expect((await resend(ada, board, byEditor.id)).status).toBe(200)
    expect(t.invitations).toHaveLength(sent + 1)
    expect(t.invitations.at(-1)).toMatchObject({ email: "by-editor@example.com", inviter: "Ada" })

    expect((await cancel(editor, board, byOwner.id)).status).toBe(403)
    expect((await cancel(editor, board, byEditor.id)).status).toBe(200)
    expect((await cancel(ada, board, byOwner.id)).status).toBe(200)
    expect((await sharing(ada, board)).invitations).toEqual([])
    expect((await cancel(ada, board, byOwner.id)).status).toBe(404)

    // An Invitation id only works on its own Board.
    await inviteAs(ada, board, "x@example.com", "viewer")
    const [pending] = (await sharing(ada, board)).invitations
    const other = await createBoard(ada, "Other")
    expect((await cancel(ada, other, pending?.id ?? "")).status).toBe(404)
  })

  it("stops at 20 emails per User per day", async () => {
    await t.pg.exec(`
      insert into invitation_emails (id, sender_id)
      select gen_random_uuid()::text, id from "user", generate_series(1, 19)
      where email = 'ada@example.com'
    `)
    expect((await inviteAs(ada, board, "twenty@example.com", "viewer")).status).toBe(201)
    const res = await inviteAs(ada, board, "more@example.com", "viewer")
    expect(res.status).toBe(429)
    const body = await json<LimitError>(res)
    expect(body.error).toBe("You've sent 20 invitations today, the most for one day.")
    const resets = new Date(body.resetsAt)
    expect(resets.getUTCHours()).toBe(0)
    expect(resets.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000)
    expect(resets.getTime()).toBeGreaterThan(Date.now())

    // Yesterday's sends don't count.
    await t.pg.exec("update invitation_emails set sent_at = sent_at - interval '1 day'")
    expect((await inviteAs(ada, board, "more@example.com", "viewer")).status).toBe(201)
  })

  it("stops at 200 emails a day across everyone", async () => {
    await t.signIn("busy@example.com")
    await t.pg.exec(`
      insert into invitation_emails (id, sender_id)
      select gen_random_uuid()::text, id from "user", generate_series(1, 200)
      where email = 'busy@example.com'
    `)
    const res = await inviteAs(ada, board, "x@example.com", "viewer")
    expect(res.status).toBe(429)
    expect((await json<LimitError>(res)).error).toBe(
      "Syncanvas has sent all the invitations it can for today.",
    )
    expect(t.invitations).toHaveLength(0)
  })
})
