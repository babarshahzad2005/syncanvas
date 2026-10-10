import type { CreateBoardResponse, DashboardResponse } from "@syncanvas/shared"

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const api = {
  dashboard: () => request<DashboardResponse>("/api/dashboard"),
  createBoard: (input: { title?: string } = {}) =>
    request<CreateBoardResponse>("/api/boards", { method: "POST", body: JSON.stringify(input) }),
}

export const queryKeys = {
  dashboard: ["dashboard"] as const,
}
