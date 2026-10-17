import type {
  BoardTokenResponse,
  ChangeRoleRequest,
  CreateBoardResponse,
  CreateThreadRequest,
  DashboardResponse,
  EditCommentRequest,
  FolderSummary,
  GuestTokenResponse,
  InviteRequest,
  InviteResponse,
  JoinResponse,
  NotificationsResponse,
  ReplyRequest,
  ShareLinkRequest,
  ShareLinkState,
  SharingResponse,
  ThreadsResponse,
  ThreadView,
  UserSettings,
} from "@syncanvas/shared"

export class ApiError extends Error {
  readonly status: number
  /** The error body's other fields (for example `resetsAt` on a 429). */
  readonly details: Record<string, unknown>
  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const message = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`
    throw new ApiError(res.status, message, body ?? {})
  }
  return res.json() as Promise<T>
}

export const api = {
  dashboard: () => request<DashboardResponse>("/api/dashboard"),
  createBoard: (input: { title?: string } = {}) =>
    request<CreateBoardResponse>("/api/boards", { method: "POST", body: JSON.stringify(input) }),
  boardToken: (boardId: string) =>
    request<BoardTokenResponse>(`/api/boards/${encodeURIComponent(boardId)}/token`, {
      method: "POST",
    }),
  sharing: (boardId: string) => request<SharingResponse>(`${board(boardId)}/sharing`),
  invite: (boardId: string, input: InviteRequest) =>
    request<InviteResponse>(`${board(boardId)}/invitations`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resendInvitation: (boardId: string, invitationId: string) =>
    request<{ ok: true }>(
      `${board(boardId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: "POST" },
    ),
  cancelInvitation: (boardId: string, invitationId: string) =>
    request<{ ok: true }>(`${board(boardId)}/invitations/${encodeURIComponent(invitationId)}`, {
      method: "DELETE",
    }),
  changeRole: (boardId: string, userId: string, input: ChangeRoleRequest) =>
    request<{ ok: true }>(`${board(boardId)}/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  /** The Owner removes someone; with your own id, you leave. */
  removeMember: (boardId: string, userId: string) =>
    request<{ ok: true }>(`${board(boardId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  setShareLink: (boardId: string, input: ShareLinkRequest) =>
    request<ShareLinkState>(`${board(boardId)}/share-link`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  regenerateShareLink: (boardId: string) =>
    request<ShareLinkState>(`${board(boardId)}/share-link/regenerate`, { method: "POST" }),
  deleteShareLink: (boardId: string) =>
    request<{ ok: true }>(`${board(boardId)}/share-link`, { method: "DELETE" }),
  join: (boardId: string, token: string) =>
    request<JoinResponse>(`${board(boardId)}/join`, {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  /** A Guest's pass from a Share Link token, without signing in (M3 ticket 04). */
  guestToken: (boardId: string, token: string) =>
    request<GuestTokenResponse>(`/api/guest/boards/${encodeURIComponent(boardId)}/token`, {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  // ---------- Threads (M4) ----------
  threads: (boardId: string) => request<ThreadsResponse>(`${board(boardId)}/threads`),
  /** A Guest reads Threads with the board token they connected with. */
  guestThreads: (boardId: string, token: string) =>
    request<ThreadsResponse>(`/api/guest/boards/${encodeURIComponent(boardId)}/threads`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  createThread: (boardId: string, input: CreateThreadRequest) =>
    request<ThreadView>(`${board(boardId)}/threads`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  editComment: (boardId: string, threadId: string, commentId: string, input: EditCommentRequest) =>
    request<ThreadView>(
      `${board(boardId)}/threads/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  /** The Thread as it is now, or null when it went with its only comment. */
  deleteComment: (boardId: string, threadId: string, commentId: string) =>
    request<{ thread: ThreadView | null }>(
      `${board(boardId)}/threads/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE" },
    ),
  deleteThread: (boardId: string, threadId: string) =>
    request<{ ok: true }>(`${board(boardId)}/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    }),
  setThreadStatus: (boardId: string, threadId: string, action: "resolve" | "reopen") =>
    request<ThreadView>(`${board(boardId)}/threads/${encodeURIComponent(threadId)}/${action}`, {
      method: "POST",
    }),
  reply: (boardId: string, threadId: string, input: ReplyRequest) =>
    request<ThreadView>(`${board(boardId)}/threads/${encodeURIComponent(threadId)}/comments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // ---------- Notifications (M4 ticket 03) ----------
  notifications: () => request<NotificationsResponse>("/api/notifications"),
  markNotificationRead: (id: string) =>
    request<{ ok: true }>(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
    }),
  markAllNotificationsRead: () =>
    request<{ ok: true }>("/api/notifications/read-all", { method: "POST" }),
  // ---------- Settings (M4 ticket 04) ----------
  settings: () => request<UserSettings>("/api/me/settings"),
  saveSettings: (input: UserSettings) =>
    request<UserSettings>("/api/me/settings", { method: "PUT", body: JSON.stringify(input) }),
  // ---------- Board lifecycle (M5a) ----------
  renameBoard: (boardId: string, title: string) =>
    request<{ title: string }>(board(boardId), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  setFavorite: (boardId: string, favorite: boolean) =>
    request<{ favorite: boolean }>(`${board(boardId)}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    }),
  // ---------- Trash (M5a ticket 03) ----------
  deleteBoard: (boardId: string) => request<{ ok: true }>(board(boardId), { method: "DELETE" }),
  restoreBoard: (boardId: string) =>
    request<{ ok: true }>(`${board(boardId)}/restore`, { method: "POST" }),
  deleteForever: (boardId: string) =>
    request<{ ok: true }>(`${board(boardId)}/forever`, { method: "DELETE" }),

  // ---------- Folders (M5a ticket 02) ----------
  createFolder: (name: string) =>
    request<FolderSummary>("/api/folders", { method: "POST", body: JSON.stringify({ name }) }),
  renameFolder: (id: string, name: string) =>
    request<{ id: string; name: string }>(`/api/folders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteFolder: (id: string) =>
    request<{ ok: true }>(`/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  moveToFolder: (boardId: string, folderId: string | null) =>
    request<{ folderId: string | null }>(`${board(boardId)}/folder`, {
      method: "PUT",
      body: JSON.stringify({ folderId }),
    }),
}

function board(boardId: string) {
  return `/api/boards/${encodeURIComponent(boardId)}`
}

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  sharing: (boardId: string) => ["sharing", boardId] as const,
  threads: (boardId: string) => ["threads", boardId] as const,
  notifications: ["notifications"] as const,
  settings: ["settings"] as const,
}
