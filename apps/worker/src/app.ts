import { Hono } from "hono"
import { type Auth, createAuth, logMagicLink } from "./auth"
import { createDb } from "./db/client"

/** What a request needs from the outside world. Tests swap these for in-memory versions. */
export type Services = { auth: Auth; dispose?: () => Promise<void> }
export type ServicesFactory = (env: Env) => Services

export const productionServices: ServicesFactory = (env) => {
  const { db, close } = createDb(env.HYPERDRIVE.connectionString)
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    sendMagicLink: logMagicLink,
  })
  return { auth, dispose: close }
}

type AppEnv = { Bindings: Env; Variables: { services: Services } }

export function createApp(services: ServicesFactory = productionServices) {
  const app = new Hono<AppEnv>().basePath("/api")

  // Only routes that touch the database or auth open a connection.
  app.use("/auth/*", async (c, next) => {
    const s = services(c.env)
    c.set("services", s)
    try {
      await next()
    } finally {
      if (s.dispose) c.executionCtx.waitUntil(s.dispose())
    }
  })

  app.get("/health", (c) => c.json({ ok: true }))
  app.on(["GET", "POST"], "/auth/*", (c) => c.var.services.auth.handler(c.req.raw))

  return app
}

export type AppType = ReturnType<typeof createApp>
