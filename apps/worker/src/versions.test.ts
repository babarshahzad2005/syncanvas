import type { CreateBoardResponse, Role, VersionsResponse } from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"
import { HISTORY_REFUSED } from "./versions"

// Version history through the API (M5b ticket 06): Editors and the Owner only.

let t: TestApp
let ada: string
let board: string

async function json<T>(res: Response) {
  return (await res.json()) as T
}

async function member(email: string, role: Role) {
  const cookie = await t.signIn(email)
  await t.request(`/api/boards/${board}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
    cookie: ada,
  })
  return cookie
}

const AT = Date.UTC(2026, 9, 1, 12)

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
  const res = await t.request("/api/boards", { method: "POST", body: "{}", cookie: ada })
  board = (await json<CreateBoardResponse>(res)).id
  t.versionStore.set(board, [
    {
      summary: { id: 2, at: AT + 3_600_000, kind: "restore", by: "Grace Hopper" },
      state: new Uint8Array([2]),
    },
    { summary: { id: 1, at: AT, kind: "auto", by: null }, state: new Uint8Array([1, 1]) },
  ])
})

describe("Version history", () => {
  it("lists Versions for the Owner and Editors, newest first, with ISO times", async () => {
    const editor = await member("grace@example.com", "editor")
    for (const cookie of [ada, editor]) {
      const res = await t.request(`/api/boards/${board}/versions`, { cookie })
      expect(res.status).toBe(200)
      expect((await json<VersionsResponse>(res)).versions).toEqual([
        { id: 2, at: new Date(AT + 3_600_000).toISOString(), kind: "restore", by: "Grace Hopper" },
        { id: 1, at: new Date(AT).toISOString(), kind: "auto", by: null },
      ])
    }
  })

  it("gives a Version's state as bytes, and 404 for one that doesn't exist", async () => {
    const res = await t.request(`/api/boards/${board}/versions/1`, { cookie: ada })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/octet-stream")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 1]))
    for (const id of ["7", "abc", "-1"]) {
      expect((await t.request(`/api/boards/${board}/versions/${id}`, { cookie: ada })).status).toBe(
        404,
      )
    }
  })

  it("records a restore with the restorer's display name", async () => {
    const editor = await member("grace@example.com", "editor")
    const res = await t.request(`/api/boards/${board}/versions/1/restored`, {
      method: "POST",
      cookie: editor,
    })
    expect(res.status).toBe(200)
    expect(t.restores).toEqual([{ boardId: board, versionId: 1, name: "Grace" }])
    const missing = await t.request(`/api/boards/${board}/versions/9/restored`, {
      method: "POST",
      cookie: editor,
    })
    expect(missing.status).toBe(404)
  })

  it("refuses Commenters, Viewers, strangers, and anyone without a session (Guests)", async () => {
    const commenter = await member("c@example.com", "commenter")
    const viewer = await member("v@example.com", "viewer")
    for (const cookie of [commenter, viewer]) {
      for (const [path, method] of [
        ["versions", "GET"],
        ["versions/1", "GET"],
        ["versions/1/restored", "POST"],
      ] as const) {
        const res = await t.request(`/api/boards/${board}/${path}`, { method, cookie })
        expect(res.status).toBe(403)
        expect((await json<{ error: string }>(res)).error).toBe(HISTORY_REFUSED)
      }
    }
    const stranger = await t.signIn("s@example.com")
    expect((await t.request(`/api/boards/${board}/versions`, { cookie: stranger })).status).toBe(
      403,
    )
    expect((await t.request(`/api/boards/${board}/versions`)).status).toBe(401)
    expect(t.restores).toEqual([])
  })
})
