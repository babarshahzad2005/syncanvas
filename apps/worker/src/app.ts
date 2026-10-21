import { isTemplateId, TEMPLATES } from "@syncanvas/board-model"
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
  IMAGE_MAX_BYTES,
  IMAGE_TOO_BIG,
  type ImageUploadResponse,
  type InviteRequest,
  type InviteResponse,
  type JoinRequest,
  type JoinResponse,
  type NotificationsResponse,
  type ReplyRequest,
  type SearchResponse,
  type ShareLinkRequest,
  type ShareLinkState,
  type SharingResponse,
  THUMBNAIL_MAX_BYTES,
  type ThreadsResponse,
  type ThreadView,
  type ThumbnailResponse,
  type UserSettings,
  type VersionsResponse,
} from "@syncanvas/shared"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { deleteAccount } from "./account"
import {
  type Auth,
  createAuth,
  devInboxEnabled,
  lastDevMagicLink,
  logAndKeepMagicLink,
  logMagicLink,
} from "./auth"
import { signBoardToken, verifyBoardToken } from "./board-token"
import {
  createBoard,
  findMembership,
  listBoards,
  listFolders,
  listTrash,
  markOpened,
} from "./boards"
import { createDb, type Database } from "./db/client"
import { user } from "./db/schema"
import { setDigestEnabled, settingsOf, unsubscribeUrl, verifyUnsubscribe } from "./digest"
import {
  brevoDigestSender,
  brevoInvitationSender,
  brevoMagicLinkSender,
  logDigest,
  logInvitation,
  type SendDigest,
  type SendInvitation,
} from "./email"
import { readImage, uploadImage } from "./images"
import {
  type CloseAll,
  checkQuota,
  createFolder,
  type DestroyRoom,
  deleteBoard,
  deleteFolder,
  deleteForever,
  moveToFolder,
  renameBoard,
  renameFolder,
  restoreBoard,
  setFavorite,
} from "./lifecycle"
import { listNotifications, markAllRead, markRead, unreadFor } from "./notifications"
import { search } from "./search"
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
import { type AssetStore, kvAssetStore, readThumbnail, uploadThumbnail } from "./thumbnails"
import { listVersions, noteRestore, type VersionsRoom, versionState } from "./versions"

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
  /** Sends a digest email (M4 ticket 04). */
  sendDigest: SendDigest
  /** Closes every connection to a Board that went to Trash (M5a ticket 03). */
  closeAll: CloseAll
  /** Closes everything and deletes a Board's room storage, before deleting it for good. */
  destroyRoom: DestroyRoom
  /** The board room's Version history (M5b ticket 06). */
  versions: VersionsRoom
  /** Board thumbnails (M5a ticket 05) and images (M5b ticket 02) in Workers KV. */
  assets: AssetStore
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
  const sendDigest = brevo ? brevoDigestSender(brevo) : logDigest
  const applyAccess: ApplyAccess = (boardId, change) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).applyAccess(change)
  const closeGuests: CloseGuests = (boardId) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).closeGuests()
  const broadcast: Broadcast = (boardId, message) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).control(message)
  const closeAll: CloseAll = (boardId) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).closeAll()
  const destroyRoom: DestroyRoom = (boardId) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).destroy()
  const room = (boardId: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId))
  const versions: VersionsRoom = {
    list: (boardId) => room(boardId).listVersions(),
    state: (boardId, id) => room(boardId).versionState(id),
    noteRestore: (boardId, id, name) => room(boardId).noteRestore(id, name),
  }
  return {
    db,
    auth,
    sendInvitation,
    applyAccess,
    closeGuests,
    broadcast,
    sendDigest,
    closeAll,
    destroyRoom,
    versions,
    assets: kvAssetStore(env.ASSETS),
    dispose: close,
  }
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
  for (const path of [
    "/auth/*",
    "/boards",
    "/boards/*",
    "/dashboard",
    "/search",
    "/guest/*",
    "/notifications",
    "/notifications/*",
    "/me",
    "/me/*",
    "/folders",
    "/folders/*",
    "/assets/*",
    "/unsubscribe",
    "/dev/unsubscribe-link",
  ]) {
    app.use(path, withServices)
  }

  // Signed-in User for everything except auth itself.
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const session = await c.var.services.auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: "You need to sign in." }, 401)
    c.set("user", { id: session.user.id, email: session.user.email, name: session.user.name })
    await next()
  })
  for (const path of [
    "/boards",
    "/boards/*",
    "/dashboard",
    "/search",
    "/notifications",
    "/notifications/*",
    "/me",
    "/me/*",
    "/folders",
    "/folders/*",
    // Images take a board token instead, for Guests (below).
    "/assets/thumbs/*",
  ]) {
    app.use(path, requireUser)
  }

  app.get("/health", (c) => c.json({ ok: true }))

  // End-to-end tests read magic links here. Off unless DEV_MAGIC_LINK_INBOX=on on localhost.
  app.get("/dev/magic-link", (c) => {
    if (!devInboxEnabled(c.env)) return c.notFound()
    const url = lastDevMagicLink(c.req.query("email") ?? "")
    return url ? c.json({ url }) : c.json({ error: "No link sent to that address yet." }, 404)
  })
  // End-to-end tests compact a Board now instead of waiting for its alarm (M5b ticket 01).
  app.post("/dev/compact/:boardId", async (c) => {
    if (!devInboxEnabled(c.env)) return c.notFound()
    const room = c.env.BOARD_ROOM.get(c.env.BOARD_ROOM.idFromName(c.req.param("boardId")))
    return c.json(await room.compactNow())
  })
  app.on(["GET", "POST"], "/auth/*", (c) => c.var.services.auth.handler(c.req.raw))

  // Search (M5b ticket 05): your own Boards by title or text.
  app.get("/search", async (c) => {
    const body: SearchResponse = {
      results: await search(c.var.services.db, c.var.user.id, c.req.query("q") ?? ""),
    }
    return c.json(body)
  })

  app.get("/dashboard", async (c) => {
    const body: DashboardResponse = {
      boards: await listBoards(c.var.services.db, c.var.user.id),
      folders: await listFolders(c.var.services.db, c.var.user.id),
      trash: await listTrash(c.var.services.db, c.var.user.id),
    }
    return c.json(body)
  })

  app.post("/boards", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as {
      title?: unknown
      template?: unknown
    }
    // A template (M5a ticket 04) names the Board; the client adds its Elements once connected.
    if (input.template !== undefined && !isTemplateId(input.template)) {
      return c.json({ error: "That template doesn't exist." }, 400)
    }
    const title =
      typeof input.title === "string"
        ? input.title.trim().slice(0, BOARD_TITLE_MAX)
        : input.template
          ? TEMPLATES[input.template].name
          : undefined
    await checkQuota(c.var.services.db, c.var.user.id)
    const board: CreateBoardResponse = await createBoard(c.var.services.db, {
      ownerId: c.var.user.id,
      title: title || undefined,
      template: input.template,
    })
    return c.json(board, 201)
  })

  app.post("/boards/:id/token", async (c) => {
    const boardId = c.req.param("id")
    const membership = await findMembership(c.var.services.db, boardId, c.var.user.id)
    // Same answer for "no such Board" and "not a Member", so Board ids can't be probed.
    if (!membership) return c.json({ error: "You don't have access to this board." }, 403)
    // Opening a Board orders the dashboard (M5a).
    await markOpened(c.var.services.db, boardId, c.var.user.id)
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

  // ---------- Rename and favorites (M5a ticket 01) ----------

  app.patch("/boards/:id", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { title?: unknown }
    return c.json(
      await renameBoard(c.var.services.db, c.var.services.broadcast, {
        boardId: c.req.param("id"),
        caller: c.var.user,
        title: input.title,
      }),
    )
  })

  app.put("/boards/:id/favorite", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { favorite?: unknown }
    return c.json(
      await setFavorite(c.var.services.db, {
        boardId: c.req.param("id"),
        caller: c.var.user,
        favorite: input.favorite,
      }),
    )
  })

  // ---------- Trash (M5a ticket 03) ----------

  app.delete("/boards/:id", async (c) => {
    await deleteBoard(c.var.services.db, c.var.services.closeAll, {
      boardId: c.req.param("id"),
      caller: c.var.user,
    })
    return c.json({ ok: true })
  })

  app.post("/boards/:id/restore", async (c) => {
    await restoreBoard(c.var.services.db, { boardId: c.req.param("id"), caller: c.var.user })
    return c.json({ ok: true })
  })

  app.delete("/boards/:id/forever", async (c) => {
    await deleteForever(c.var.services.db, c.var.services.destroyRoom, c.var.services.assets, {
      boardId: c.req.param("id"),
      caller: c.var.user,
    })
    return c.json({ ok: true })
  })

  // ---------- Thumbnails (M5a ticket 05) ----------

  app.put("/boards/:id/thumbnail", async (c) => {
    // Refused before reading a body that's plainly too big.
    if (Number(c.req.header("content-length") ?? 0) > THUMBNAIL_MAX_BYTES) {
      return c.json({ error: "Thumbnails are at most 200 KB." }, 413)
    }
    const body: ThumbnailResponse = await uploadThumbnail(
      c.var.services.db,
      c.var.services.assets,
      {
        boardId: c.req.param("id"),
        caller: c.var.user,
        contentType: c.req.header("content-type") ?? "",
        bytes: await c.req.arrayBuffer(),
      },
    )
    return c.json(body)
  })

  app.get("/assets/thumbs/:boardId", async (c) => {
    const thumb = await readThumbnail(c.var.services.db, c.var.services.assets, {
      boardId: c.req.param("boardId"),
      caller: c.var.user,
      version: c.req.query("v"),
    })
    return new Response(thumb.bytes, {
      headers: {
        "content-type": thumb.contentType,
        "x-content-type-options": "nosniff",
        // Private: only Members may see it. A new upload gets a new ?v=, so this never goes stale.
        "cache-control": thumb.fresh ? "private, max-age=31536000, immutable" : "private, no-cache",
      },
    })
  })

  // ---------- Version history (M5b ticket 06): Editors and the Owner only ----------

  app.get("/boards/:id/versions", async (c) => {
    const body: VersionsResponse = {
      versions: await listVersions(c.var.services.db, c.var.services.versions, {
        boardId: c.req.param("id"),
        caller: c.var.user,
      }),
    }
    return c.json(body)
  })

  app.get("/boards/:id/versions/:versionId", async (c) => {
    const state = await versionState(c.var.services.db, c.var.services.versions, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      versionId: c.req.param("versionId"),
    })
    return new Response(state, {
      headers: {
        "content-type": "application/octet-stream",
        // A Version never changes; only people who may see history get it.
        "cache-control": "private, max-age=31536000, immutable",
      },
    })
  })

  app.post("/boards/:id/versions/:versionId/restored", async (c) => {
    await noteRestore(c.var.services.db, c.var.services.versions, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      versionId: c.req.param("versionId"),
      name: displayNameOf(c.var.user),
    })
    return c.json({ ok: true })
  })

  // ---------- Images (M5b ticket 02) ----------

  app.post("/boards/:id/images", async (c) => {
    // Refused before reading a body that's plainly too big.
    if (Number(c.req.header("content-length") ?? 0) > IMAGE_MAX_BYTES) {
      return c.json({ error: IMAGE_TOO_BIG }, 413)
    }
    const body: ImageUploadResponse = await uploadImage(c.var.services.db, c.var.services.assets, {
      boardId: c.req.param("id"),
      caller: c.var.user,
      bytes: await c.req.arrayBuffer(),
    })
    return c.json(body, 201)
  })

  // A Member's session, or a board token as a Bearer (Guests have no session).
  app.get("/assets/images/:boardId/:id", async (c) => {
    const authorization = c.req.header("authorization")
    let reader: Parameters<typeof readImage>[2]["reader"]
    if (authorization) {
      const bearer = authorization.replace(/^Bearer\s+/i, "")
      reader = {
        kind: "token",
        claims: await verifyBoardToken(bearer, c.env.BOARD_TOKEN_PUBLIC_KEY),
      }
    } else {
      const session = await c.var.services.auth.api.getSession({ headers: c.req.raw.headers })
      if (!session) return c.json({ error: "You need to sign in." }, 401)
      reader = { kind: "member", userId: session.user.id }
    }
    const image = await readImage(c.var.services.db, c.var.services.assets, {
      boardId: c.req.param("boardId"),
      id: c.req.param("id"),
      reader,
    })
    return new Response(image.bytes, {
      headers: {
        "content-type": image.contentType,
        "x-content-type-options": "nosniff",
        // A key's bytes never change; private, as only people with access may see it.
        "cache-control": "private, max-age=31536000, immutable",
      },
    })
  })

  // ---------- Folders (M5a ticket 02) ----------

  app.post("/folders", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { name?: unknown }
    return c.json(await createFolder(c.var.services.db, c.var.user, input.name), 201)
  })

  app.patch("/folders/:id", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { name?: unknown }
    return c.json(await renameFolder(c.var.services.db, c.var.user, c.req.param("id"), input.name))
  })

  app.delete("/folders/:id", async (c) => {
    await deleteFolder(c.var.services.db, c.var.user, c.req.param("id"))
    return c.json({ ok: true })
  })

  app.put("/boards/:id/folder", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { folderId?: unknown }
    return c.json(
      await moveToFolder(c.var.services.db, {
        boardId: c.req.param("id"),
        caller: c.var.user,
        folderId: input.folderId ?? null,
      }),
    )
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

  // ---------- Deleting an account (M5a ticket 06) ----------

  app.delete("/me", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { confirm?: unknown }
    const { destroyRoom, applyAccess, assets } = c.var.services
    return c.json(
      await deleteAccount(
        c.var.services.db,
        { destroy: destroyRoom, applyAccess, assets },
        { caller: c.var.user, confirm: input.confirm },
      ),
    )
  })

  // ---------- Digest settings and unsubscribe (M4 ticket 04) ----------

  app.get("/me/settings", async (c) => {
    const body: UserSettings = await settingsOf(c.var.services.db, c.var.user.id)
    return c.json(body)
  })

  app.put("/me/settings", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as Partial<UserSettings>
    if (typeof input.digestEnabled !== "boolean") {
      return c.json({ error: "Say whether digest emails are on." }, 400)
    }
    await setDigestEnabled(c.var.services.db, c.var.user.id, input.digestEnabled)
    const body: UserSettings = await settingsOf(c.var.services.db, c.var.user.id)
    return c.json(body)
  })

  // The link in every digest: GET asks first (link scanners mustn't unsubscribe anyone);
  // POST does it, from that page's button or a mail app's one-click (RFC 8058).
  app.get("/unsubscribe", async (c) => {
    const { u = "", t = "" } = c.req.query()
    if (!(await verifyUnsubscribe(c.env.BETTER_AUTH_SECRET, u, t))) {
      return c.html(
        unsubscribePage(
          "This link doesn't work",
          "It may be incomplete. You can turn digest emails off from Notifications… in the account menu.",
        ),
        400,
      )
    }
    return c.html(
      unsubscribePage(
        "Stop digest emails?",
        "You won't get emails about unread notifications. You'll still see them in Syncanvas.",
        c.req.url,
      ),
    )
  })

  app.post("/unsubscribe", async (c) => {
    const { u = "", t = "" } = c.req.query()
    if (!(await verifyUnsubscribe(c.env.BETTER_AUTH_SECRET, u, t))) {
      return c.html(unsubscribePage("This link doesn't work", "It may be incomplete."), 400)
    }
    await setDigestEnabled(c.var.services.db, u, false)
    return c.html(
      unsubscribePage(
        "You're unsubscribed",
        "No more digest emails. Turn them back on any time from Notifications… in the account menu.",
      ),
    )
  })

  // End-to-end tests read a User's unsubscribe link here (like the magic-link inbox).
  app.get("/dev/unsubscribe-link", async (c) => {
    if (!devInboxEnabled(c.env)) return c.notFound()
    const email = (c.req.query("email") ?? "").toLowerCase()
    const [row] = await c.var.services.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    if (!row) return c.json({ error: "No such User." }, 404)
    return c.json({
      url: await unsubscribeUrl(c.env.BETTER_AUTH_URL, c.env.BETTER_AUTH_SECRET, row.id),
    })
  })

  // ---------- Notifications (M4 ticket 03) ----------

  app.get("/notifications", async (c) => {
    const body: NotificationsResponse = await listNotifications(c.var.services.db, c.var.user)
    return c.json(body)
  })

  app.get("/notifications/unread", async (c) =>
    c.json(await unreadFor(c.var.services.db, c.var.user)),
  )

  app.post("/notifications/read-all", async (c) => {
    await markAllRead(c.var.services.db, c.var.user)
    return c.json({ ok: true })
  })

  app.post("/notifications/:id/read", async (c) => {
    await markRead(c.var.services.db, c.var.user, c.req.param("id"))
    return c.json({ ok: true })
  })

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

/** The small page an unsubscribe link shows; `action` adds the confirm button. */
function unsubscribePage(title: string, body: string, action?: string) {
  const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
  const button = action
    ? `<form method="post" action="${esc(action)}"><button style="background:#5145CD;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer">Stop digest emails</button></form>`
    : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Syncanvas</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8F7F4;font-family:-apple-system,Segoe UI,sans-serif;color:#1C1B19">
<main style="max-width:400px;padding:16px;text-align:center"><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${esc(title)}</h1>
<p style="font-size:14px;line-height:20px;color:#6B6760;margin:0 0 20px">${esc(body)}</p>${button}</main></body></html>`
}

export type AppType = ReturnType<typeof createApp>
