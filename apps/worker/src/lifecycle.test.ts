import {
  BOARDS_PER_USER,
  type CreateBoardResponse,
  type DashboardResponse,
  type Role,
  type ThreadsResponse,
} from "@syncanvas/shared"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { boards } from "./db/schema"
import { purgeTrash } from "./lifecycle"
import { createTestApp, type TestApp } from "./test-app"

// Board lifecycle from the dashboard (M5a): last-opened order, rename, favorites, Folders,
// Trash, and the quota.

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

describe("Trash and the quota", () => {
  const trashOf = async (cookie: string) =>
    (await json<DashboardResponse>(await t.request("/api/dashboard", { cookie }))).trash
  const del = (cookie: string, boardId: string) =>
    t.request(`/api/boards/${boardId}`, { method: "DELETE", cookie })
  const restore = (cookie: string, boardId: string) =>
    t.request(`/api/boards/${boardId}/restore`, { method: "POST", cookie })
  const forever = (cookie: string, boardId: string) =>
    t.request(`/api/boards/${boardId}/forever`, { method: "DELETE", cookie })
  const threadsOf = async (cookie: string, boardId: string) => {
    const res = await t.request(`/api/boards/${boardId}/threads`, { cookie })
    return res.status === 200 ? (await json<ThreadsResponse>(res)).threads : null
  }

  it("lets only the Owner delete, and closes the room", async () => {
    const board = await create(ada, "Plan")
    const editor = await share(board, "ed@example.com", "editor")
    const outsider = await t.signIn("out@example.com")

    const byEditor = await del(editor, board)
    expect(byEditor.status).toBe(403)
    expect(await byEditor.json()).toEqual({ error: "Only the owner can delete this board." })
    expect((await del(outsider, board)).status).toBe(403)
    expect(t.closedAll).toEqual([])

    expect((await del(ada, board)).status).toBe(200)
    expect(t.closedAll).toEqual([board])
    expect(await dashboard(ada)).toEqual([])
    expect(await dashboard(editor)).toEqual([])
    expect((await trashOf(ada)).map((b) => b.title)).toEqual(["Plan"])
    expect(await trashOf(editor)).toEqual([]) // Trash is the Owner's
    expect((await open(editor, board)).status).toBe(403)
    expect((await open(ada, board)).status).toBe(403)
    expect((await del(ada, board)).status).toBe(403) // already in Trash
  })

  it("restores with Members and Threads", async () => {
    const board = await create(ada, "Retro")
    const grace = await share(board, "grace@example.com", "commenter")
    await t.request(`/api/boards/${board}/threads`, {
      method: "POST",
      body: JSON.stringify({ anchor: { x: 1, y: 2 }, body: "Keep this" }),
      cookie: grace,
    })
    await del(ada, board)
    expect(await threadsOf(grace, board)).toBeNull()

    expect((await restore(grace, board)).status).toBe(403)
    expect((await restore(ada, board)).status).toBe(200)
    expect((await dashboard(grace)).map((b) => b.title)).toEqual(["Retro"])
    expect((await threadsOf(grace, board))?.length).toBe(1)
    expect(await trashOf(ada)).toEqual([])
    expect((await restore(ada, board)).status).toBe(409) // not in Trash
  })

  it("deletes forever only from Trash, and only the Owner", async () => {
    const board = await create(ada, "Gone")
    const grace = await share(board, "grace@example.com", "editor")
    expect((await forever(ada, board)).status).toBe(409)
    await del(ada, board)
    expect((await forever(grace, board)).status).toBe(403)
    expect(t.destroyed).toEqual([])
    expect((await forever(ada, board)).status).toBe(200)
    expect(t.destroyed).toEqual([board])
    expect(await trashOf(ada)).toEqual([])
    expect((await restore(ada, board)).status).toBe(403)
  })

  it("refuses a 51st owned Board, but Trash doesn't count", async () => {
    const session = await json<{ user: { id: string } }>(
      await t.request("/api/auth/get-session", { cookie: ada }),
    )
    await t.db.insert(boards).values(
      Array.from({ length: BOARDS_PER_USER - 1 }, (_, i) => ({
        id: `seed-${i}`,
        ownerId: session.user.id,
      })),
    )
    const last = await create(ada, "Fiftieth")
    const refused = await t.request("/api/boards", { method: "POST", body: "{}", cookie: ada })
    expect(refused.status).toBe(403)
    expect((await json<{ error: string }>(refused)).error).toBe(
      "You own 50 boards, the most for one account. Delete one or empty Trash to make room.",
    )
    await del(ada, last)
    const again = await create(ada, "Room again")
    expect(again).toBeTruthy()
    // Restoring past the quota is refused the same way.
    expect((await restore(ada, last)).status).toBe(403)
  })

  it("cleanup deletes only Boards in Trash for over 30 days", async () => {
    const old = await create(ada, "Old")
    const recent = await create(ada, "Recent")
    const kept = await create(ada, "Kept")
    await del(ada, old)
    await del(ada, recent)
    const day = 24 * 60 * 60 * 1000
    await t.db
      .update(boards)
      .set({ deletedAt: new Date(Date.now() - 31 * day) })
      .where(eq(boards.id, old))
    await t.db
      .update(boards)
      .set({ deletedAt: new Date(Date.now() - 29 * day) })
      .where(eq(boards.id, recent))

    const destroyed: string[] = []
    expect(await purgeTrash(t.db, async (id) => void destroyed.push(id))).toEqual({ purged: 1 })
    expect(destroyed).toEqual([old])
    expect((await trashOf(ada)).map((b) => b.title)).toEqual(["Recent"])
    expect((await dashboard(ada)).map((b) => b.id)).toEqual([kept])

    // A room that can't be reached keeps the row for the next run.
    await t.db
      .update(boards)
      .set({ deletedAt: new Date(Date.now() - 40 * day) })
      .where(eq(boards.id, recent))
    expect(
      await purgeTrash(t.db, async () => {
        throw new Error("unreachable")
      }),
    ).toEqual({ purged: 0 })
    expect((await trashOf(ada)).length).toBe(1)
  })
})
