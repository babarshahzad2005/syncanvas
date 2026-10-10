import type { CreateBoardResponse, DashboardResponse } from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"

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
})
