import { afterEach, describe, expect, it, vi } from "vitest"
import {
  brevoDigestSender,
  brevoMagicLinkSender,
  digestEmail,
  invitationEmail,
  magicLinkEmail,
} from "./email"

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

describe("invitation emails", () => {
  const message = {
    email: "grace@example.com",
    inviter: "Ada <Lovelace>",
    boardTitle: 'Q4 "retro" <script>',
    role: "commenter" as const,
    url: "https://x.test/b/abc",
  }

  it("tells a new address who invited them to which Board", () => {
    const email = invitationEmail({ ...message, kind: "invitation" })
    expect(email.subject).toBe('Ada <Lovelace> invited you to “Q4 "retro" <script>” on Syncanvas')
    expect(email.textContent).toContain("invited you to comment on")
    expect(email.textContent).toContain("https://x.test/b/abc")
    expect(email.textContent).toContain("expires in 30 days")
  })

  it("tells an existing User the Board is shared with them", () => {
    const email = invitationEmail({ ...message, kind: "shared", role: "viewer" })
    expect(email.subject).toBe('Ada <Lovelace> shared “Q4 "retro" <script>” with you')
    expect(email.textContent).toContain("invited you to view")
  })

  it("escapes names and titles inside the HTML", () => {
    const { htmlContent } = invitationEmail({ ...message, kind: "invitation" })
    expect(htmlContent).not.toContain("<script>")
    expect(htmlContent).not.toContain("<Lovelace>")
    expect(htmlContent).toContain("&#60;script&#62;")
  })
})

describe("digest emails", () => {
  const message = {
    email: "grace@example.com",
    items: [
      {
        headline: "Ada <Lovelace> mentioned you",
        boardTitle: 'Q4 "retro"',
        excerpt: "<b>check</b> this",
        url: "https://x.test/b/1?thread=2",
      },
    ],
    more: 0,
    unsubscribeUrl: "https://x.test/api/unsubscribe?u=g&t=sig",
  }

  it("lists each Notification and links to unsubscribe, in one click from mail apps", () => {
    const email = digestEmail(message)
    expect(email.subject).toBe("You have a new notification on Syncanvas")
    expect(email.textContent).toContain("https://x.test/b/1?thread=2")
    expect(email.textContent).toContain("https://x.test/api/unsubscribe?u=g&t=sig")
    expect(email.headers).toEqual({
      "List-Unsubscribe": "<https://x.test/api/unsubscribe?u=g&t=sig>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    })
    expect(digestEmail({ ...message, more: 4 }).subject).toBe(
      "You have 5 new notifications on Syncanvas",
    )
  })

  it("escapes names, titles, and comments inside the HTML", () => {
    const { htmlContent } = digestEmail(message)
    expect(htmlContent).not.toContain("<b>check</b>")
    expect(htmlContent).not.toContain("<Lovelace>")
    expect(htmlContent).toContain("&#60;b&#62;check")
  })

  it("passes the headers to Brevo", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    await brevoDigestSender({ apiKey: "k", senderEmail: "me@gmail.com" })(message)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).headers).toMatchObject({
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    })
  })
})
