import type {
  CreateBoardResponse,
  DashboardResponse,
  Role,
  ThreadsResponse,
} from "@syncanvas/shared"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { boards, user } from "./db/schema"
import { createTestApp, type TestApp } from "./test-app"

// Deleting an account (M5a ticket 06).

let t: TestApp
let ada: string
let grace: string

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

async function share(owner: string, boardId: string, email: string, role: Role) {
  await t.request(`/api/boards/${boardId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
    cookie: owner,
  })
}

const comment = (cookie: string, boardId: string, body: string) =>
  t.request(`/api/boards/${boardId}/threads`, {
    method: "POST",
    body: JSON.stringify({ anchor: { x: 10, y: 20 }, body }),
    cookie,
  })

const deleteAccount = (cookie: string | undefined, confirm: unknown) =>
  t.request("/api/me", { method: "DELETE", body: JSON.stringify({ confirm }), cookie })

async function threads(cookie: string, boardId: string) {
  return (
    await json<ThreadsResponse>(await t.request(`/api/boards/${boardId}/threads`, { cookie }))
  ).threads
}

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
  grace = await t.signIn("grace@example.com")
})

describe("Deleting an account", () => {
  it("deletes owned Boards for good and keeps comments elsewhere as Deleted user", async () => {
    const mine = await create(ada, "Mine")
    const trashed = await create(ada, "In Trash")
    await t.request(`/api/boards/${trashed}`, { method: "DELETE", cookie: ada })
    await share(ada, mine, "grace@example.com", "editor")
    await t.request(`/api/boards/${mine}/thumbnail`, {
      method: "PUT",
      body: Uint8Array.from([...new TextEncoder().encode("RIFF0000WEBP"), 0, 0]),
      headers: { "content-type": "image/webp" },
      cookie: ada,
    })
    const hers = await create(grace, "Hers")
    await share(grace, hers, "ada@example.com", "commenter")
    expect((await comment(ada, hers, "Looks good")).status).toBe(201)
    expect((await comment(grace, hers, "Thanks")).status).toBe(201)

    const res = await deleteAccount(ada, "DELETE")
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ deletedBoards: 2 })

    // Owned Boards: rooms destroyed, thumbnails and rows gone, Trash included.
    expect(t.destroyed.sort()).toEqual([mine, trashed].sort())
    expect(t.assets.size).toBe(0)
    expect((await t.db.select({ id: boards.id }).from(boards)).map((b) => b.id)).toEqual([hers])
    // Grace's Board stays, with Ada's comment as "Deleted user" (no author).
    const left = await threads(grace, hers)
    expect(
      left.flatMap((th) => th.comments.map((c) => [c.author?.name ?? null, c.body])).sort(),
    ).toEqual(
      [
        ["Grace", "Thanks"],
        [null, "Looks good"],
      ].sort(),
    )
    // Grace's room hears that Ada is gone, like a Member leaving.
    expect(t.access.at(-1)).toEqual({
      boardId: hers,
      change: expect.objectContaining({ role: null }),
    })
    const { boards: graceBoards } = await json<DashboardResponse>(
      await t.request("/api/dashboard", { cookie: grace }),
    )
    expect(graceBoards.map((b) => b.title)).toEqual(["Hers"])
    // The session is over.
    expect((await t.request("/api/dashboard", { cookie: ada })).status).toBe(401)
    expect(await t.db.select().from(user).where(eq(user.email, "ada@example.com"))).toEqual([])
  })

  it("signs in again as a new, empty account", async () => {
    await create(ada, "Old")
    await deleteAccount(ada, "DELETE")
    const again = await t.signIn("ada@example.com")
    const body = await json<DashboardResponse>(await t.request("/api/dashboard", { cookie: again }))
    expect(body).toEqual({ boards: [], folders: [], trash: [] })
  })

  it("needs DELETE typed, and a session", async () => {
    const board = await create(ada, "Kept")
    for (const confirm of [undefined, "delete", "yes"]) {
      const res = await deleteAccount(ada, confirm)
      expect(res.status).toBe(400)
      expect((await json<{ error: string }>(res)).error).toBe("Type DELETE to confirm.")
    }
    expect((await deleteAccount(undefined, "DELETE")).status).toBe(401)
    expect((await t.db.select().from(boards).where(eq(boards.id, board))).length).toBe(1)
    expect(t.destroyed).toEqual([])
  })
})
