import type { SendMagicLink } from "./auth"

// Transactional email through Brevo (ADR 0007: free, 300/day, single verified sender).

const BREVO_SEND = "https://api.brevo.com/v3/smtp/email"

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function magicLinkEmail(url: string) {
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

export function brevoMagicLinkSender(options: {
  apiKey: string
  senderEmail: string
}): SendMagicLink {
  return async ({ email, url }) => {
    const res = await fetch(BREVO_SEND, {
      method: "POST",
      headers: {
        "api-key": options.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Syncanvas", email: options.senderEmail },
        to: [{ email }],
        ...magicLinkEmail(url),
      }),
    })
    if (!res.ok) {
      // Never log the API key or the link; status and Brevo's error code are enough to debug.
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      throw new Error(`Brevo rejected the email (${res.status} ${body.code ?? ""})`)
    }
  }
}
