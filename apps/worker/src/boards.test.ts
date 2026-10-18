import type { BoardTokenResponse, CreateBoardResponse, DashboardResponse } from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { verifyBoardToken } from "./board-token"
import { createTestApp, env, type TestApp } from "./test-app"

async function dashboard(t: TestApp, cookie: string) {
  const res = await t.request("/api/dashboard", { cookie })
  expect(res.status).toBe(200)
  return ((await res.json()) as DashboardResponse).boards
}

async function create(t: TestApp, cookie: string, body: object = {}) {
  const res = await t.request("/api/boards", { method: "POST", body: JSON.stringify(body), cookie })
  return { res, board: res.ok ? ((await res.json()) as CreateBoardResponse) : null }
}

describe("Boards", () => {
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp()
  })

  it("requires a signed-in User", async () => {
    expect((await t.request("/api/dashboard")).status).toBe(401)
    expect((await t.request("/api/boards", { method: "POST", body: "{}" })).status).toBe(401)
  })

  it("names a Board after its template, and refuses unknown templates", async () => {
    const ada = await t.signIn("ada@example.com")
    const kanban = await create(t, ada, { template: "kanban" })
    expect(kanban.res.status).toBe(201)
    expect(kanban.board?.title).toBe("Kanban")
    expect((await create(t, ada, { template: "journey" })).board?.title).toBe("User journey")
    // A title given alongside wins.
    expect((await create(t, ada, { template: "retro", title: "Q4 retro" })).board?.title).toBe(
      "Q4 retro",
    )
    const unknown = await create(t, ada, { template: "gantt" })
    expect(unknown.res.status).toBe(400)
    expect((await create(t, ada, { template: 7 })).res.status).toBe(400)
    expect(await dashboard(t, ada)).toHaveLength(3)
  })

  it("creates an untitled Board owned by its creator", async () => {
    const ada = await t.signIn("ada@example.com")
    const { res, board } = await create(t, ada)
    expect(res.status).toBe(201)
    expect(board?.title).toBe("Untitled board")

    const boards = await dashboard(t, ada)
    expect(boards).toHaveLength(1)
    expect(boards[0]).toMatchObject({
      id: board?.id,
      role: "owner",
      owner: { email: "ada@example.com" },
    })
  })

  it("keeps a trimmed title and ignores a blank one", async () => {
    const ada = await t.signIn("ada@example.com")
    expect((await create(t, ada, { title: "  Q4 retro  " })).board?.title).toBe("Q4 retro")
    expect((await create(t, ada, { title: "   " })).board?.title).toBe("Untitled board")
  })

  it("lists only Boards the User is a Member of, newest first", async () => {
    const ada = await t.signIn("ada@example.com")
    const grace = await t.signIn("grace@example.com")
    const first = (await create(t, ada, { title: "First" })).board
    await new Promise((r) => setTimeout(r, 10))
    const second = (await create(t, ada, { title: "Second" })).board
    await create(t, grace, { title: "Grace's board" })

    expect((await dashboard(t, ada)).map((b) => b.id)).toEqual([second?.id, first?.id])
    expect((await dashboard(t, grace)).map((b) => b.title)).toEqual(["Grace's board"])
  })

  it("leaves neither row behind when creating the Membership fails", async () => {
    const ada = await t.signIn("ada@example.com")
    // Make the second insert of the transaction fail, like a crash halfway through.
    await t.pg.exec(`
      create function fail_membership() returns trigger language plpgsql as
        $$ begin raise exception 'simulated failure'; end $$;
      create trigger fail_membership before insert on memberships
        for each row execute function fail_membership();
    `)

    const { res } = await create(t, ada, { title: "Doomed" })
    expect(res.status).toBe(500)

    const rows = await t.pg.query<{ n: number }>("select count(*)::int as n from boards")
    expect(rows.rows[0]?.n).toBe(0)
  })

  it("issues a board token with the Member's Role", async () => {
    const ada = await t.signIn("ada@example.com")
    const board = (await create(t, ada, { title: "Q4 retro" })).board
    const res = await t.request(`/api/boards/${board?.id}/token`, { method: "POST", cookie: ada })
    expect(res.status).toBe(200)
    const body = (await res.json()) as BoardTokenResponse
    expect(body).toMatchObject({ role: "owner", board: { id: board?.id, title: "Q4 retro" } })

    const claims = await verifyBoardToken(body.token, env.BOARD_TOKEN_PUBLIC_KEY)
    expect(claims).toMatchObject({ boardId: board?.id, role: "owner", kind: "member" })
    const lifetime = new Date(body.expiresAt).getTime() - Date.now()
    expect(lifetime).toBeGreaterThan(4 * 60_000)
    expect(lifetime).toBeLessThanOrEqual(5 * 60_000)
  })

  it("puts the display name in the token: the prefill until the User picks one", async () => {
    const grace = await t.signIn("grace.hopper@example.com")
    const board = (await create(t, grace)).board
    const token = async () => {
      const res = await t.request(`/api/boards/${board?.id}/token`, {
        method: "POST",
        cookie: grace,
      })
      const body = (await res.json()) as BoardTokenResponse
      return { body, claims: await verifyBoardToken(body.token, env.BOARD_TOKEN_PUBLIC_KEY) }
    }
    const before = await token()
    expect(before.claims?.name).toBe("Grace Hopper")
    expect(before.body.you.name).toBe("Grace Hopper")

    const rename = (name: unknown) =>
      t.request("/api/auth/update-user", {
        method: "POST",
        cookie: grace,
        body: JSON.stringify({ name }),
        headers: { "content-type": "application/json" },
      })
    expect((await rename("  Amazing   Grace ")).status).toBe(200)
    expect((await token()).claims?.name).toBe("Amazing Grace")

    // Empty or over-long names are refused, and the saved name stays.
    expect((await rename("   ")).status).toBe(400)
    expect((await rename("x".repeat(51))).status).toBe(400)
    expect((await token()).claims?.name).toBe("Amazing Grace")
  })

  it("refuses a board token to non-Members and for unknown Boards alike", async () => {
    const ada = await t.signIn("ada@example.com")
    const grace = await t.signIn("grace@example.com")
    const board = (await create(t, ada)).board

    const notMember = await t.request(`/api/boards/${board?.id}/token`, {
      method: "POST",
      cookie: grace,
    })
    const unknown = await t.request("/api/boards/no-such-board/token", {
      method: "POST",
      cookie: grace,
    })
    expect(notMember.status).toBe(403)
    expect(unknown.status).toBe(403)
    expect(await notMember.json()).toEqual(await unknown.json())
    expect((await t.request(`/api/boards/${board?.id}/token`, { method: "POST" })).status).toBe(401)
  })
})
