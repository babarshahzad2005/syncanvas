import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "@/lib/api"
import { requestTokenEarly, takeEarlyToken } from "./early-token"

describe("early board tokens", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function fakeToken() {
    const pass = Promise.resolve({ token: "t" } as Awaited<ReturnType<typeof api.boardToken>>)
    return vi.spyOn(api, "boardToken").mockReturnValue(pass)
  }

  it("hands the early request to the Board it was for, once", () => {
    const spy = fakeToken()
    requestTokenEarly("a")
    expect(spy).toHaveBeenCalledWith("a")
    expect(takeEarlyToken("b")).toBeNull()
    expect(takeEarlyToken("a")).not.toBeNull()
    expect(takeEarlyToken("a")).toBeNull()
  })

  it("doesn't hand over a request that has waited too long", () => {
    vi.useFakeTimers()
    fakeToken()
    requestTokenEarly("a")
    vi.advanceTimersByTime(31_000)
    expect(takeEarlyToken("a")).toBeNull()
  })

  it("keeps a failed early request's error for whoever takes it", async () => {
    vi.spyOn(api, "boardToken").mockReturnValue(Promise.reject(new Error("no access")))
    requestTokenEarly("a")
    await expect(takeEarlyToken("a")).rejects.toThrow("no access")
  })
})
