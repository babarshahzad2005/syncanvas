import { DIGEST_GAP_HOURS, INVITATION_DAYS, type InviteRole } from "@syncanvas/shared"
import type { SendMagicLink } from "./auth"

// Transactional email through Brevo (ADR 0007: free, 300/day, single verified sender).

const BREVO_SEND = "https://api.brevo.com/v3/smtp/email"

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function magicLinkEmail(url: string): Email {
  const safeUrl = escapeHtml(url)
  return {
    subject: "Your Syncanvas sign-in link",
    textContent: `Sign in to Syncanvas:\n\n${url}\n\nThis link works once and expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    htmlContent: `<!doctype html><html><body style="margin:0;background:#F8F7F4;font-family:-apple-system,Segoe UI,sans-serif;color:#1C1B19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="420" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E3DD;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 8px;font-size:20px;font-weight:600">Sign in to Syncanvas</p>
<p style="margin:0 0 24px;font-size:14px;line-height:20px;color:#6B6760">Click the button to sign in. The link works once and expires in 10 minutes.</p>
<a href="${safeUrl}" style="display:inline-block;background:#5145CD;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:10px 16px;border-radius:8px">Sign in</a>
<p style="margin:24px 0 0;font-size:12px;line-height:16px;color:#6B6760">If you didn't ask for this, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`,
  }
}

type Email = {
  subject: string
  textContent: string
  htmlContent: string
  /** Extra headers, such as List-Unsubscribe on digests. */
  headers?: Record<string, string>
}
type BrevoOptions = { apiKey: string; senderEmail: string }

async function brevoSend(options: BrevoOptions, to: string, email: Email) {
  const res = await fetch(BREVO_SEND, {
    method: "POST",
    headers: {
      "api-key": options.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Syncanvas", email: options.senderEmail },
      to: [{ email: to }],
      ...email,
    }),
  })
  if (!res.ok) {
    // Never log the API key or the link; status and Brevo's error code are enough to debug.
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    throw new Error(`Brevo rejected the email (${res.status} ${body.code ?? ""})`)
  }
}

export function brevoMagicLinkSender(options: BrevoOptions): SendMagicLink {
  return ({ email, url }) => brevoSend(options, email, magicLinkEmail(url))
}

// ---------- Invitations (M3 ticket 01) ----------

/**
 * "invitation": a new address, which gets access when it first signs in. "shared": someone
 * with an account, who has access already.
 */
export type InvitationMessage = {
  email: string
  kind: "invitation" | "shared"
  inviter: string
  boardTitle: string
  role: InviteRole
  url: string
}
export type SendInvitation = (message: InvitationMessage) => Promise<void>

const VERB: Record<InviteRole, string> = { editor: "edit", commenter: "comment on", viewer: "view" }

export function invitationEmail(m: InvitationMessage): Email {
  const subject =
    m.kind === "shared"
      ? `${m.inviter} shared “${m.boardTitle}” with you`
      : `${m.inviter} invited you to “${m.boardTitle}” on Syncanvas`
  const lead = `${m.inviter} invited you to ${VERB[m.role]} “${m.boardTitle}”.`
  const note =
    m.kind === "shared"
      ? "It's on your Syncanvas dashboard now."
      : `Sign in with this email address to open it. The invitation expires in ${INVITATION_DAYS} days.`
  const [safeUrl, safeLead, safeNote] = [m.url, lead, note].map(escapeHtml)
  return {
    subject,
    textContent: `${lead}\n\nOpen the board:\n${m.url}\n\n${note}`,
    htmlContent: `<!doctype html><html><body style="margin:0;background:#F8F7F4;font-family:-apple-system,Segoe UI,sans-serif;color:#1C1B19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="420" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E3DD;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 8px;font-size:20px;font-weight:600">${safeLead}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:20px;color:#6B6760">${safeNote}</p>
<a href="${safeUrl}" style="display:inline-block;background:#5145CD;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:10px 16px;border-radius:8px">Open board</a>
</td></tr></table></td></tr></table></body></html>`,
  }
}

export function brevoInvitationSender(options: BrevoOptions): SendInvitation {
  return (message) => brevoSend(options, message.email, invitationEmail(message))
}

/** Local development: print the invitation where `pnpm dev` runs. */
export const logInvitation: SendInvitation = async (m) => {
  const what = m.kind === "shared" ? "Shared" : "Invitation"
  console.log(`\n  ${what} email for ${m.email}:\n  ${m.url}\n`)
}

// ---------- Digest (M4 ticket 04) ----------

export type DigestItem = {
  /** "Grace Hopper mentioned you" / "Grace Hopper replied". */
  headline: string
  boardTitle: string
  excerpt: string
  url: string
}

export type DigestMessage = {
  email: string
  items: DigestItem[]
  /** Unread Notifications beyond the ones listed. */
  more: number
  unsubscribeUrl: string
}
export type SendDigest = (message: DigestMessage) => Promise<void>

export function digestEmail(m: DigestMessage): Email {
  const total = m.items.length + m.more
  const subject =
    total === 1
      ? "You have a new notification on Syncanvas"
      : `You have ${total} new notifications on Syncanvas`
  const lines = m.items.map((i) => `${i.headline} on “${i.boardTitle}”:\n${i.excerpt}\n${i.url}`)
  const more = m.more > 0 ? `\n\n…and ${m.more} more in Syncanvas.` : ""
  const why = `You get this because these are unread. At most one email every ${DIGEST_GAP_HOURS} hours.`
  const rows = m.items
    .map(
      (i) => `<tr><td style="padding:12px 0;border-top:1px solid #E6E3DD">
<p style="margin:0 0 4px;font-size:14px;font-weight:600">${escapeHtml(i.headline)} <span style="font-weight:400;color:#6B6760">on “${escapeHtml(i.boardTitle)}”</span></p>
<p style="margin:0 0 8px;font-size:14px;line-height:20px">${escapeHtml(i.excerpt)}</p>
<a href="${escapeHtml(i.url)}" style="font-size:14px;color:#5145CD">Open the thread</a>
</td></tr>`,
    )
    .join("")
  return {
    subject,
    textContent: `${lines.join("\n\n")}${more}\n\n${why}\nStop these emails: ${m.unsubscribeUrl}`,
    htmlContent: `<!doctype html><html><body style="margin:0;background:#F8F7F4;font-family:-apple-system,Segoe UI,sans-serif;color:#1C1B19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E6E3DD;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(subject)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
${m.more > 0 ? `<p style="margin:12px 0 0;font-size:14px;color:#6B6760">…and ${m.more} more in Syncanvas.</p>` : ""}
<p style="margin:24px 0 0;font-size:12px;line-height:16px;color:#6B6760">${escapeHtml(why)} <a href="${escapeHtml(m.unsubscribeUrl)}" style="color:#6B6760">Stop these emails</a></p>
</td></tr></table></td></tr></table></body></html>`,
    // One-click unsubscribe in mail apps (RFC 8058).
    headers: {
      "List-Unsubscribe": `<${m.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  }
}

export function brevoDigestSender(options: BrevoOptions): SendDigest {
  return (message) => brevoSend(options, message.email, digestEmail(message))
}

/** Local development: print the digest where `pnpm dev` runs. */
export const logDigest: SendDigest = async (m) => {
  console.log(
    `\n  Digest for ${m.email}: ${m.items.length + m.more} notification(s)\n  ${m.unsubscribeUrl}\n`,
  )
}
