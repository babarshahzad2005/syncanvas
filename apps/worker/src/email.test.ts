import { afterEach, describe, expect, it, vi } from "vitest"
import { brevoMagicLinkSender, magicLinkEmail } from "./email"

afterEach(() => vi.unstubAllGlobals())

describe("Brevo magic link sender", () => {
  it("sends one email from the verified sender with the link", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ messageId: "m1" }), { status: 201 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const send = brevoMagicLinkSender({ apiKey: "key-123", senderEmail: "me@gmail.com" })

    await send({ email: "ada@example.com", url: "https://x.test/verify?token=abc" })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.brevo.com/v3/smtp/email")
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key-123")
    const body = JSON.parse(String(init.body))
    expect(body.sender).toEqual({ name: "Syncanvas", email: "me@gmail.com" })
    expect(body.to).toEqual([{ email: "ada@example.com" }])
    expect(body.textContent).toContain("https://x.test/verify?token=abc")
  })

  it("fails loudly without leaking the key when Brevo refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 })),
    )
    const send = brevoMagicLinkSender({ apiKey: "secret-key", senderEmail: "me@gmail.com" })
    const error = await send({ email: "a@example.com", url: "https://x.test/v" }).catch(
      (e: Error) => e,
    )
    expect(String(error)).toContain("401 unauthorized")
    expect(String(error)).not.toContain("secret-key")
  })

  it("escapes the link inside the HTML", () => {
    expect(magicLinkEmail('https://x.test/"><script>').htmlContent).not.toContain("<script>")
  })
})
