import {
  BOARD_TITLE_MAX,
  type BoardTokenResponse,
  type ChangeRoleRequest,
  type CreateBoardResponse,
  type CreateThreadRequest,
  type DashboardResponse,
  displayNameOf,
  type EditCommentRequest,
  type GuestTokenResponse,
  type InviteRequest,
  type InviteResponse,
  type JoinRequest,
  type JoinResponse,
  type ReplyRequest,
  type ShareLinkRequest,
  type ShareLinkState,
  type SharingResponse,
  type ThreadsResponse,
  type ThreadView,
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
import { signBoardToken, verifyBoardToken } from "./board-token"
import { createBoard, findMembership, listBoards } from "./boards"
import { createDb, type Database } from "./db/client"
import {
  brevoInvitationSender,
  brevoMagicLinkSender,
  logInvitation,
  type SendInvitation,
} from "./email"
import {
  type ApplyAccess,
  type CloseGuests,
  cancelInvitation,
  changeRole,
  deleteShareLink,
  invite,
  joinByLink,
  liveLink,
  regenerateShareLink,
  removeMember,
  resendInvitation,
  setShareLink,
  sharingState,
} from "./sharing"
import {
  type Broadcast,
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  listThreads,
  listThreadsFor,
  reply,
  setThreadStatus,
} from "./threads"

/** What a request needs from the outside world. Tests swap these for in-memory versions. */
export type Services = {
  db: Database
  auth: Auth
  sendInvitation: SendInvitation
  /** Pushes a saved access change to the Board's live room (M3 ticket 02). */
  applyAccess: ApplyAccess
  /** Disconnects a Board's Guests when its Share Link goes off or changes (M3 ticket 04). */
  closeGuests: CloseGuests
  /** Relays a comment change to everyone on the Board (M4). */
  broadcast: Broadcast
  dispose?: () => Promise<void>
}
export type ServicesFactory = (env: Env) => Services

export const productionServices: ServicesFactory = (env) => {
  const { db, close } = createDb(env.HYPERDRIVE.connectionString)
  const brevo = env.BREVO_API_KEY
    ? { apiKey: env.BREVO_API_KEY, senderEmail: env.BREVO_SENDER_EMAIL }
    : null
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    sendMagicLink: brevo
      ? brevoMagicLinkSender(brevo)
      : devInboxEnabled(env)
        ? logAndKeepMagicLink
        : logMagicLink,
  })
  const sendInvitation = brevo ? brevoInvitationSender(brevo) : logInvitation
  const applyAccess: ApplyAccess = (boardId, change) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).applyAccess(change)
  const closeGuests: CloseGuests = (boardId) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).closeGuests()
  const broadcast: Broadcast = (boardId, message) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).control(message)
  return { db, auth, sendInvitation, applyAccess, closeGuests, broadcast, dispose: close }
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
  for (const path of ["/auth/*", "/boards", "/boards/*", "/dashboard", "/guest/*"]) {
    app.use(path, withServices)
  }

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

  // ---------- Sharing (M3) ----------

  app.get("/boards/:id/sharing", async (c) => {
    const body: SharingResponse = await sharingState(
      c.var.services.db,
      c.req.param("id"),
      c.var.user,
    )
    return c.json(body)
  })

  const mail = (c: { var: AppEnv["Variables"]; env: Env }) => ({
    send: c.var.services.sendInvitation,
    appUrl: c.env.BETTER_AUTH_URL,
  })

  app.post("/boards/:id/invitations", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<InviteRequest>
    const body: InviteResponse = await invite(c.var.services.db, mail(c), {
      boardId: c.req.param("id"),
      caller: c.var.user,
      email: input.email,
      role: input.role,
    })
    return c.json(body, 201)
  })

  app.post("/boards/:id/invitations/:invitationId/resend", async (c) => {
    await resendInvitation(c.var.services.db, mail(c), {
      boardId: c.req.param("id"),
      invitationId: c.req.param("invitationId"),
      caller: c.var.user,
    })
    return c.json({ ok: true })
  })

  app.delete("/boards/:id/invitations/:invitationId", async (c) => {
    await cancelInvitation(c.var.services.db, {
      boardId: c.req.param("id"),
      invitationId: c.req.param("invitationId"),
      caller: c.var.user,
    })
    return c.json({ ok: true })
  })

  app.patch("/boards/:id/members/:userId", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<ChangeRoleRequest>
    await changeRole(c.var.services.db, c.var.services.applyAccess, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      userId: c.req.param("userId"),
      role: input.role,
    })
    return c.json({ ok: true })
  })

  // The Owner removes someone, or anyone else leaves (their own id).
  app.delete("/boards/:id/members/:userId", async (c) => {
    await removeMember(c.var.services.db, c.var.services.applyAccess, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      userId: c.req.param("userId"),
    })
    return c.json({ ok: true })
  })

  // ---------- Share Link (M3 ticket 03) ----------

  app.put("/boards/:id/share-link", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as ShareLinkRequest
    const body: ShareLinkState = await setShareLink(c.var.services.db, c.var.services.closeGuests, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      role: input.role,
      expiresInDays: input.expiresInDays,
    })
    return c.json(body)
  })

  app.post("/boards/:id/share-link/regenerate", async (c) => {
    const body: ShareLinkState = await regenerateShareLink(
      c.var.services.db,
      c.var.services.closeGuests,
      {
        boardId: c.req.param("id"),
        caller: c.var.user,
      },
    )
    return c.json(body)
  })

  app.delete("/boards/:id/share-link", async (c) => {
    await deleteShareLink(c.var.services.db, c.var.services.closeGuests, {
      boardId: c.req.param("id"),
      caller: c.var.user,
    })
    return c.json({ ok: true })
  })

  app.post("/boards/:id/join", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<JoinRequest>
    const body: JoinResponse = await joinByLink(c.var.services.db, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      token: input.token,
    })
    return c.json(body)
  })

  // ---------- Threads (M4) ----------

  app.get("/boards/:id/threads", async (c) => {
    const threads = await listThreadsFor(c.var.services.db, c.req.param("id"), c.var.user)
    const body: ThreadsResponse = { threads }
    return c.json(body)
  })

  app.post("/boards/:id/threads", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<CreateThreadRequest>
    const body: ThreadView = await createThread(c.var.services.db, c.var.services.broadcast, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      anchor: input.anchor,
      body: input.body,
    })
    return c.json(body, 201)
  })

  app.post("/boards/:id/threads/:threadId/comments", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<ReplyRequest>
    const body: ThreadView = await reply(c.var.services.db, c.var.services.broadcast, {
      boardId: c.req.param("id"),
      threadId: c.req.param("threadId"),
      caller: c.var.user,
      body: input.body,
    })
    return c.json(body, 201)
  })

  app.patch("/boards/:id/threads/:threadId/comments/:commentId", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<EditCommentRequest>
    const body: ThreadView = await editComment(c.var.services.db, c.var.services.broadcast, {
      boardId: c.req.param("id"),
      threadId: c.req.param("threadId"),
      commentId: c.req.param("commentId"),
      caller: c.var.user,
      body: input.body,
    })
    return c.json(body)
  })

  // Answers the Thread as it is now, or { thread: null } when it went with the comment.
  app.delete("/boards/:id/threads/:threadId/comments/:commentId", async (c) => {
    const thread = await deleteComment(c.var.services.db, c.var.services.broadcast, {
      boardId: c.req.param("id"),
      threadId: c.req.param("threadId"),
      commentId: c.req.param("commentId"),
      caller: c.var.user,
    })
    return c.json({ thread })
  })

  app.delete("/boards/:id/threads/:threadId", async (c) => {
    await deleteThread(c.var.services.db, c.var.services.broadcast, {
      boardId: c.req.param("id"),
      threadId: c.req.param("threadId"),
      caller: c.var.user,
    })
    return c.json({ ok: true })
  })

  for (const [action, status] of [
    ["resolve", "resolved"],
    ["reopen", "open"],
  ] as const) {
    app.post(`/boards/:id/threads/:threadId/${action}`, async (c) => {
      const body: ThreadView = await setThreadStatus(c.var.services.db, c.var.services.broadcast, {
        boardId: c.req.param("id"),
        threadId: c.req.param("threadId"),
        caller: c.var.user,
        status,
      })
      return c.json(body)
    })
  }

  // A Guest reads Threads with the board token they connected with (M4).
  app.get("/guest/boards/:id/threads", async (c) => {
    const boardId = c.req.param("id")
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
    const claims = await verifyBoardToken(bearer, c.env.BOARD_TOKEN_PUBLIC_KEY)
    if (!claims || claims.boardId !== boardId) {
      return c.json({ error: "You don't have access to this board." }, 403)
    }
    const body: ThreadsResponse = { threads: await listThreads(c.var.services.db, boardId) }
    return c.json(body)
  })

  // ---------- Guests (M3 ticket 04): no session, just a working Share Link ----------

  app.post("/guest/boards/:id/token", async (c) => {
    const boardId = c.req.param("id")
    const input = (await c.req.json().catch(() => ({}))) as { token?: unknown }
    const link = await liveLink(c.var.services.db, boardId, input.token)
    const guestId = `guest-${crypto.randomUUID()}`
    // No name: the board room numbers Guests ("Guest 1", "Guest 2"…) as they connect.
    const { token, expiresAt } = await signBoardToken(
      { userId: guestId, name: "", boardId, role: "viewer", kind: "guest" },
      c.env.BOARD_TOKEN_PRIVATE_KEY,
    )
    const body: GuestTokenResponse = {
      token,
      expiresAt,
      role: "viewer",
      board: { id: boardId, title: link.title },
      you: { id: guestId, name: "Guest" },
      linkRole: link.role,
    }
    return c.json(body)
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
