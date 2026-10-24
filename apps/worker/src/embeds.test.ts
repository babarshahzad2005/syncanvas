import type {
  CreateBoardResponse,
  EmbedState,
  EmbedTokenResponse,
  Role,
  SharingResponse,
} from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, type TestApp } from "./test-app"

// The Embed (M6 ticket 05): the Owner switches it on and off; its token gets a read-only
// board token and nothing else; the Share Link and the Embed don't touch each other.

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

const turnOn = async (cookie = ada) =>
  t.request(`/api/boards/${board}/embed`, { method: "PUT", body: "{}", cookie })
const turnOff = (cookie = ada) =>
  t.request(`/api/boards/${board}/embed`, { method: "DELETE", cookie })
const pass = (token: string) =>
  t.request(`/api/embed/${encodeURIComponent(token)}/token`, { method: "POST", body: "{}" })

/** The claims inside a board token (signature checked by the board room, not here). */
function claimsOf(token: string) {
  const part = token.split(".")[1] ?? ""
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>
}

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title: "Roadmap" }),
    cookie: ada,
  })
  board = (await json<CreateBoardResponse>(res)).id
})

describe("Embed", () => {
  it("is off at first; the Owner turns it on and sees it in the Share dialog", async () => {
    const sharing = () => t.request(`/api/boards/${board}/sharing`, { cookie: ada })
    expect((await json<SharingResponse>(await sharing())).embed).toBeNull()
    const res = await turnOn()
    expect(res.status).toBe(200)
    const { token } = await json<EmbedState>(res)
    expect(token).toMatch(/^[\w-]{20,}$/)
    expect((await json<SharingResponse>(await sharing())).embed).toEqual({ token })
    // Others never see it.
    const editor = await member("grace@example.com", "editor")
    const theirs = await t.request(`/api/boards/${board}/sharing`, { cookie: editor })
    expect((await json<SharingResponse>(theirs)).embed).toBeNull()
  })

  it("is the Owner's alone", async () => {
    const editor = await member("grace@example.com", "editor")
    for (const res of [await turnOn(editor), await turnOff(editor)]) {
      expect(res.status).toBe(403)
      expect((await json<{ error: string }>(res)).error).toBe(
        "Only the owner can embed this board.",
      )
    }
  })

  it("gives a read-only Embed board token, without a session", async () => {
    const { token } = await json<EmbedState>(await turnOn())
    const res = await pass(token)
    expect(res.status).toBe(200)
    const body = await json<EmbedTokenResponse>(res)
    expect(body).toMatchObject({ role: "viewer", board: { id: board, title: "Roadmap" } })
    expect(claimsOf(body.token)).toMatchObject({ board, role: "viewer", kind: "embed" })
  })

  it("stops working when turned off, or renewed, and its viewers are closed", async () => {
    const first = (await json<EmbedState>(await turnOn())).token
    const second = (await json<EmbedState>(await turnOn())).token
    expect(second).not.toBe(first)
    expect(t.embedsClosed).toEqual([board]) // renewing closes the old snippet's viewers
    expect((await pass(first)).status).toBe(403)
    expect((await pass(second)).status).toBe(200)
    expect((await turnOff()).status).toBe(200)
    expect(t.embedsClosed).toEqual([board, board])
    expect((await pass(second)).status).toBe(403)
  })

  it("answers every bad token alike, and refuses a Board in Trash", async () => {
    const { token } = await json<EmbedState>(await turnOn())
    const unknown = await pass("not-a-token")
    expect(unknown.status).toBe(403)
    await t.request(`/api/boards/${board}`, { method: "DELETE", cookie: ada })
    const trashed = await pass(token)
    expect(trashed.status).toBe(403)
    expect(await json(trashed)).toEqual(await json(unknown))
  })

  it("and the Share Link don't touch each other", async () => {
    const { token } = await json<EmbedState>(await turnOn())
    await t.request(`/api/boards/${board}/share-link`, { method: "PUT", body: "{}", cookie: ada })
    await t.request(`/api/boards/${board}/share-link`, { method: "DELETE", cookie: ada })
    expect(t.embedsClosed).toEqual([])
    expect((await pass(token)).status).toBe(200)
    await turnOff()
    expect(t.guestsClosed).toEqual([board]) // only from turning the link off above
  })
})
