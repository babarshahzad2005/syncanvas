import { magicLinkClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/** Talks to the Worker's Better Auth routes on the same origin (/api/auth). */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [magicLinkClient()],
})

export type Session = typeof authClient.$Infer.Session

/** Only same-site paths are allowed as post-sign-in destinations (no open redirects). */
export function safeRedirect(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/"
}
