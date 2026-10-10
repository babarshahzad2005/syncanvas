import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { magicLink } from "better-auth/plugins"
import * as schema from "./db/schema"

export type SendMagicLink = (message: { email: string; url: string }) => Promise<void>

/** Local development: print the link where `pnpm dev` runs (Brevo replaces this in ticket 10). */
export const logMagicLink: SendMagicLink = async ({ email, url }) => {
  console.log(`\n  Magic sign-in link for ${email}:\n  ${url}\n`)
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
