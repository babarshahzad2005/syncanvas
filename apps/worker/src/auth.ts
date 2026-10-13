import { DISPLAY_NAME_MAX, normalizeDisplayName } from "@syncanvas/shared"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { magicLink } from "better-auth/plugins"
import * as schema from "./db/schema"

export type SendMagicLink = (message: { email: string; url: string }) => Promise<void>

/** Local development: print the link where `pnpm dev` runs (Brevo replaces this in ticket 10). */
export const logMagicLink: SendMagicLink = async ({ email, url }) => {
  console.log(`\n  Magic sign-in link for ${email}:\n  ${url}\n`)
}

/**
 * Development-only inbox so end-to-end tests can sign in: remembers the last link per email.
 * Only reachable when DEV_MAGIC_LINK_INBOX=on AND the app runs on localhost (see devInboxEnabled).
 */
const devInbox = new Map<string, string>()

export const logAndKeepMagicLink: SendMagicLink = async (message) => {
  devInbox.set(message.email.toLowerCase(), message.url)
  await logMagicLink(message)
}

export function lastDevMagicLink(email: string): string | undefined {
  return devInbox.get(email.toLowerCase())
}

export function devInboxEnabled(env: { DEV_MAGIC_LINK_INBOX?: string; BETTER_AUTH_URL: string }) {
  return env.DEV_MAGIC_LINK_INBOX === "on" && env.BETTER_AUTH_URL.startsWith("http://localhost")
}

export function createAuth(options: {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle databases differ by driver (postgres-js, PGlite in tests)
  db: any
  secret: string
  baseURL: string
  sendMagicLink: SendMagicLink
  magicLinkExpiresIn?: number
}) {
  return betterAuth({
    database: drizzleAdapter(options.db, { provider: "pg", schema }),
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [options.baseURL],
    databaseHooks: {
      user: {
        update: {
          // Display names (M2 ticket 01) are set through Better Auth's update-user route:
          // trimmed, 1–50 characters. Photos aren't a feature yet, so `image` can't be set.
          before: async (user, context) => {
            const data: Record<string, unknown> = { ...user }
            if (context?.path === "/update-user") delete data.image
            if ("name" in data) {
              const name = normalizeDisplayName(data.name)
              if (name === null) {
                throw new APIError("BAD_REQUEST", {
                  message: `Names are 1–${DISPLAY_NAME_MAX} characters.`,
                })
              }
              data.name = name
            }
            return { data }
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: options.magicLinkExpiresIn ?? 60 * 10,
        storeToken: "hashed",
        sendMagicLink: ({ email, url }) => options.sendMagicLink({ email, url }),
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
