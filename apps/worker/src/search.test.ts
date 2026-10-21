import {
  type CreateBoardResponse,
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  type SearchResponse,
} from "@syncanvas/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { boardSearch } from "./db/schema"
import { searchTerms } from "./search"
import { createTestApp, type TestApp } from "./test-app"

// Search (M5b ticket 05): titles at once, Board text once indexed, only your own Boards, never
// Trash.

let t: TestApp
let ada: string

async function create(cookie: string, title: string) {
  const res = await t.request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title }),
    cookie,
  })
  return ((await res.json()) as CreateBoardResponse).id
}

/** What the board room writes after an edit (ticket 04). */
async function index(boardId: string, body: string) {
  await t.db.insert(boardSearch).values({ boardId, body })
}

async function find(cookie: string, q: string) {
  const res = await t.request(`/api/search?q=${encodeURIComponent(q)}`, { cookie })
  expect(res.status).toBe(200)
  return ((await res.json()) as SearchResponse).results
}

beforeEach(async () => {
  t = await createTestApp()
  ada = await t.signIn("ada@example.com")
})

describe("searchTerms", () => {
  it("makes every word a required prefix, and lets nothing else through", () => {
    expect(searchTerms("Launch roadm")).toBe("launch:* & roadm:*")
    expect(searchTerms("a & b | !c")).toBe("a:* & b:* & c:*")
    expect(searchTerms("x")).toBe(null)
    expect(searchTerms("&& !!")).toBe(null)
  })
})

describe("GET /api/search", () => {
  it("finds a Board by its title at once, as you type", async () => {
    const id = await create(ada, "Quarterly roadmap")
    expect(await find(ada, "roadm")).toMatchObject([
      { id, title: "Quarterly roadmap", snippet: null, role: "owner" },
    ])
    // Stemmed: "quarter" finds "Quarterly".
    expect((await find(ada, "quarter")).map((r) => r.id)).toEqual([id])
  })

  it("finds a Board by the text on it, with the matched words marked", async () => {
    const id = await create(ada, "Retro")
    await index(id, "Went well: shipping images\nTo improve: flaky zebra tests")
    const [result] = await find(ada, "zebra")
    expect(result?.id).toBe(id)
    expect(result?.snippet).toContain(`${SEARCH_MARK_START}zebra${SEARCH_MARK_END}`)
  })

  it("puts title matches first", async () => {
    const inText = await create(ada, "Notes")
    await index(inText, "the budget for next year")
    const inTitle = await create(ada, "Budget")
    expect((await find(ada, "budget")).map((r) => r.id)).toEqual([inTitle, inText])
  })

  it("never returns someone else's Board, and only Boards you're a Member of", async () => {
    const grace = await t.signIn("grace@example.com")
    const hers = await create(grace, "Secret plan")
    await index(hers, "secret words")
    expect(await find(ada, "secret")).toEqual([])
    // Once shared with Ada, it's hers to find too.
    await t.request(`/api/boards/${hers}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", role: "viewer" }),
      cookie: grace,
    })
    expect(await find(ada, "secret")).toMatchObject([{ id: hers, role: "viewer" }])
  })

  it("leaves out Boards in Trash", async () => {
    const id = await create(ada, "Old roadmap")
    await t.request(`/api/boards/${id}`, { method: "DELETE", cookie: ada })
    expect(await find(ada, "roadmap")).toEqual([])
  })

  it("answers nothing for a query under 2 characters, and needs a session", async () => {
    await create(ada, "A board")
    expect(await find(ada, "a")).toEqual([])
    expect(await find(ada, " ")).toEqual([])
    expect((await t.request("/api/search?q=board")).status).toBe(401)
  })

  it("returns at most 10", async () => {
    for (let i = 0; i < 12; i++) await create(ada, `Sprint ${i}`)
    expect(await find(ada, "sprint")).toHaveLength(10)
  })
})
