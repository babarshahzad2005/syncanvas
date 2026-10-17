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

describe("Folders", () => {
  const folderReq = (cookie: string, method: string, path = "", body?: object) =>
    t.request(`/api/folders${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      cookie,
    })
  async function newFolder(cookie: string, name: string) {
    const res = await folderReq(cookie, "POST", "", { name })
    expect(res.status).toBe(201)
    return json<{ id: string; name: string }>(res)
  }
  const move = (cookie: string, boardId: string, folderId: unknown) =>
    t.request(`/api/boards/${boardId}/folder`, {
      method: "PUT",
      body: JSON.stringify({ folderId }),
      cookie,
    })
  async function folders(cookie: string) {
    return (await json<DashboardResponse>(await t.request("/api/dashboard", { cookie }))).folders
  }

  it("files Boards into one of your Folders and counts them", async () => {
    const board = await create(ada, "Plan")
    const other = await create(ada, "Notes")
    const product = await newFolder(ada, "  Product  ")
    expect(product.name).toBe("Product")
    const ideas = await newFolder(ada, "Ideas")

    expect((await move(ada, board, product.id)).status).toBe(200)
    expect((await move(ada, other, product.id)).status).toBe(200)
    expect((await folders(ada)).map((f) => [f.name, f.boardCount])).toEqual([
      ["Ideas", 0],
      ["Product", 2],
    ])
    // A Board sits in at most one of your Folders: moving it moves it.
    await move(ada, board, ideas.id)
    const boards = await dashboard(ada)
    expect(boards.find((b) => b.id === board)?.folderId).toBe(ideas.id)
    await move(ada, board, null)
    expect((await dashboard(ada)).find((b) => b.id === board)?.folderId).toBeNull()
  })

  it("keeps Folders private, and someone else's Folder refused", async () => {
    const board = await create(ada, "Shared")
    const grace = await share(board, "grace@example.com", "viewer")
    const mine = await newFolder(ada, "Ada's")
    const hers = await newFolder(grace, "Grace's")

    await move(grace, board, hers.id)
    expect((await dashboard(grace))[0]?.folderId).toBe(hers.id)
    expect((await dashboard(ada))[0]?.folderId).toBeNull() // her filing is hers alone
    expect((await folders(ada)).map((f) => f.name)).toEqual(["Ada's"])

    expect((await move(grace, board, mine.id)).status).toBe(404)
    expect((await folderReq(grace, "PATCH", `/${mine.id}`, { name: "Mine now" })).status).toBe(404)
    expect((await folderReq(grace, "DELETE", `/${mine.id}`)).status).toBe(404)
    const outsider = await t.signIn("out@example.com")
    expect((await move(outsider, board, mine.id)).status).toBe(403)
  })

  it("renames, and deleting a Folder keeps its Boards", async () => {
    const board = await create(ada, "Keep me")
    const folder = await newFolder(ada, "Old")
    await move(ada, board, folder.id)
    expect((await folderReq(ada, "PATCH", `/${folder.id}`, { name: "New" })).status).toBe(200)
    expect((await folders(ada))[0]?.name).toBe("New")
    expect((await folderReq(ada, "PATCH", `/${folder.id}`, { name: " " })).status).toBe(400)
    expect((await folderReq(ada, "POST", "", { name: "x".repeat(61) })).status).toBe(400)

    expect((await folderReq(ada, "DELETE", `/${folder.id}`)).status).toBe(200)
    expect(await folders(ada)).toEqual([])
    const [kept] = await dashboard(ada)
    expect(kept).toMatchObject({ title: "Keep me", folderId: null })
  })

  it("drops a Board from your Folders when you leave it", async () => {
    const board = await create(ada, "Shared")
    const grace = await share(board, "grace@example.com", "commenter")
    const folder = await newFolder(grace, "Work")
    await move(grace, board, folder.id)
    const session = await json<{ user: { id: string } }>(
      await t.request("/api/auth/get-session", { cookie: grace }),
    )
    await t.request(`/api/boards/${board}/members/${session.user.id}`, {
      method: "DELETE",
      cookie: grace,
    })
    expect((await folders(grace)).map((f) => f.boardCount)).toEqual([0])
  })
})
