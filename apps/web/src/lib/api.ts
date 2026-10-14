import type {
  BoardTokenResponse,
  ChangeRoleRequest,
  CreateBoardResponse,
  DashboardResponse,
  InviteRequest,
  InviteResponse,
  SharingResponse,
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
}

function board(boardId: string) {
  return `/api/boards/${encodeURIComponent(boardId)}`
}

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  sharing: (boardId: string) => ["sharing", boardId] as const,
}
