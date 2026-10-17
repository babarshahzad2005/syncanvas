import type { CreateBoardResponse, DashboardResponse, Role } from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"

// Board lifecycle from the dashboard (M5a): last-opened order, rename, favorites.

let t: TestApp
let ada: string

async function json<T>(res: Response) {
  return (await res.json()) as T
}

async function create(cookie: string, title: string) {
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title }),
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

const open = (cookie: string, boardId: string) =>
  t.request(`/api/boards/${boardId}/token`, { method: "POST", cookie })

async function dashboard(cookie: string) {
  return (await json<DashboardResponse>(await t.request("/api/dashboard", { cookie }))).boards
}

const rename = (cookie: string, boardId: string, title: unknown) =>
  t.request(`/api/boards/${boardId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
    cookie,
  })

const star = (cookie: string, boardId: string, favorite: unknown) =>
  t.request(`/api/boards/${boardId}/favorite`, {
    method: "PUT",
    body: JSON.stringify({ favorite }),
    cookie,
  })

const pause = () => new Promise((r) => setTimeout(r, 15))

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
})

describe("Dashboard order", () => {
  it("puts the most recently opened first and never-opened Boards last", async () => {
    const first = await create(ada, "First")
    await pause()
    const second = await create(ada, "Second")
    await pause()
    const third = await create(ada, "Third") // never opened: last, though edited most recently
    await open(ada, second)
    await pause()
    await open(ada, first)
    const boards = await dashboard(ada)
    expect(boards.map((b) => b.title)).toEqual(["First", "Second", "Third"])
    expect(boards[0]?.lastOpenedAt).not.toBeNull()
    expect(boards.find((b) => b.id === third)?.lastOpenedAt).toBeNull()

    await open(ada, third)
    expect((await dashboard(ada)).map((b) => b.title)[0]).toBe("Third")
  })

  it("orders each Member by their own opening", async () => {
    const a = await create(ada, "A")
    const b = await create(ada, "B")
    const grace = await share(a, "grace@example.com", "viewer")
    await share(b, "grace@example.com", "viewer")
    await open(ada, a)
    await pause()
    await open(grace, b)
    expect((await dashboard(ada)).map((x) => x.title)).toEqual(["A", "B"])
    expect((await dashboard(grace)).map((x) => x.title)).toEqual(["B", "A"])
  })
})

describe("Rename", () => {
  it("lets the Owner and Editors rename, and tells open Boards", async () => {
    const board = await create(ada, "Draft")
    const editor = await share(board, "ed@example.com", "editor")
    const commenter = await share(board, "co@example.com", "commenter")
    const outsider = await t.signIn("out@example.com")

    const res = await rename(editor, board, "  Q4   retro ")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: "Q4 retro" })
    expect(t.broadcasts.at(-1)).toEqual({
      boardId: board,
      message: { type: "board-renamed", title: "Q4 retro" },
    })
    expect((await rename(ada, board, "Q4 retro, final")).status).toBe(200)
    expect((await dashboard(commenter))[0]?.title).toBe("Q4 retro, final")

    expect((await rename(commenter, board, "Mine")).status).toBe(403)
    expect((await rename(outsider, board, "Mine")).status).toBe(403)
    expect((await rename(ada, board, "   ")).status).toBe(400)
    expect((await rename(ada, board, "x".repeat(201))).status).toBe(400)
    expect((await rename(ada, board, 7)).status).toBe(400)
  })
})

describe("Favorites", () => {
  it("stars a Board for one Member only", async () => {
    const board = await create(ada, "Shared")
    const grace = await share(board, "grace@example.com", "viewer")
    const outsider = await t.signIn("out@example.com")

    expect((await star(grace, board, true)).status).toBe(200)
    expect((await dashboard(grace))[0]?.favorite).toBe(true)
    expect((await dashboard(ada))[0]?.favorite).toBe(false)
    expect((await star(grace, board, false)).status).toBe(200)
    expect((await dashboard(grace))[0]?.favorite).toBe(false)

    expect((await star(grace, board, "yes")).status).toBe(400)
    expect((await star(outsider, board, true)).status).toBe(403)
  })
})
