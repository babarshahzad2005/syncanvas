import {
  BOARD_TITLE_MAX,
  type BoardTokenResponse,
  type CreateBoardResponse,
  type DashboardResponse,
  displayNameOf,
} from "@syncanvas/shared"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import {
  type Auth,
  createAuth,
  devInboxEnabled,
  lastDevMagicLink,
  logAndKeepMagicLink,
  logMagicLink,
} from "./auth"
import { signBoardToken } from "./board-token"
import { createBoard, findMembership, listBoards } from "./boards"
import { createDb, type Database } from "./db/client"
import { brevoMagicLinkSender } from "./email"

/** What a request needs from the outside world. Tests swap these for in-memory versions. */
export type Services = { db: Database; auth: Auth; dispose?: () => Promise<void> }
export type ServicesFactory = (env: Env) => Services

export const productionServices: ServicesFactory = (env) => {
  const { db, close } = createDb(env.HYPERDRIVE.connectionString)
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    sendMagicLink: env.BREVO_API_KEY
      ? brevoMagicLinkSender({ apiKey: env.BREVO_API_KEY, senderEmail: env.BREVO_SENDER_EMAIL })
      : devInboxEnabled(env)
        ? logAndKeepMagicLink
        : logMagicLink,
  })
  return { db, auth, dispose: close }
}

type SessionUser = { id: string; email: string; name: string }
type AppEnv = { Bindings: Env; Variables: { services: Services; user: SessionUser } }

export function createApp(services: ServicesFactory = productionServices) {
  const app = new Hono<AppEnv>().basePath("/api")

  // Only routes that touch the database or auth open a connection.
  const withServices = createMiddleware<AppEnv>(async (c, next) => {
    const s = services(c.env)
    c.set("services", s)
    try {
      await next()
    } finally {
      if (s.dispose) c.executionCtx.waitUntil(s.dispose())
    }
  })
  for (const path of ["/auth/*", "/boards", "/boards/*", "/dashboard"]) app.use(path, withServices)

  // Signed-in User for everything except auth itself.
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const session = await c.var.services.auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: "You need to sign in." }, 401)
    c.set("user", { id: session.user.id, email: session.user.email, name: session.user.name })
    await next()
  })
  for (const path of ["/boards", "/boards/*", "/dashboard"]) app.use(path, requireUser)

  app.get("/health", (c) => c.json({ ok: true }))

  // End-to-end tests read magic links here. Off unless DEV_MAGIC_LINK_INBOX=on on localhost.
  app.get("/dev/magic-link", (c) => {
    if (!devInboxEnabled(c.env)) return c.notFound()
    const url = lastDevMagicLink(c.req.query("email") ?? "")
    return url ? c.json({ url }) : c.json({ error: "No link sent to that address yet." }, 404)
  })
  app.on(["GET", "POST"], "/auth/*", (c) => c.var.services.auth.handler(c.req.raw))

  app.get("/dashboard", async (c) => {
    const body: DashboardResponse = { boards: await listBoards(c.var.services.db, c.var.user.id) }
    return c.json(body)
  })

  app.post("/boards", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { title?: unknown }
    const title =
      typeof input.title === "string" ? input.title.trim().slice(0, BOARD_TITLE_MAX) : undefined
    const board: CreateBoardResponse = await createBoard(c.var.services.db, {
      ownerId: c.var.user.id,
      title: title || undefined,
    })
    return c.json(board, 201)
  })

  app.post("/boards/:id/token", async (c) => {
    const boardId = c.req.param("id")
    const membership = await findMembership(c.var.services.db, boardId, c.var.user.id)
    // Same answer for "no such Board" and "not a Member", so Board ids can't be probed.
    if (!membership) return c.json({ error: "You don't have access to this board." }, 403)
    const { token, expiresAt } = await signBoardToken(
      {
        userId: c.var.user.id,
        name: displayNameOf(c.var.user),
        boardId,
        role: membership.role,
        kind: "member",
      },
      c.env.BOARD_TOKEN_PRIVATE_KEY,
    )
    const body: BoardTokenResponse = {
      token,
      expiresAt,
      role: membership.role,
      board: { id: boardId, title: membership.title },
      you: { id: c.var.user.id, name: displayNameOf(c.var.user) },
    }
    return c.json(body)
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
