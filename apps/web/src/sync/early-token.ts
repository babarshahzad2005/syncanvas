import type { BoardTokenResponse } from "@syncanvas/shared"
import { api } from "@/lib/api"

// The board token for the Board being opened, requested while the session is still being
// checked rather than after (M6 ticket 08d): the token route checks the session itself.

/** How long an early token may wait to be used; tokens last 5 minutes. */
const FRESH_MS = 30_000

let early: { boardId: string; at: number; pass: Promise<BoardTokenResponse> } | null = null

export function requestTokenEarly(boardId: string) {
  const pass = api.boardToken(boardId)
  pass.catch(() => {}) // whoever takes it handles the error
  early = { boardId, at: Date.now(), pass }
}

/** The early request for `boardId`, once, if it's still fresh. */
export function takeEarlyToken(boardId: string): Promise<BoardTokenResponse> | null {
  if (!early || early.boardId !== boardId || Date.now() - early.at > FRESH_MS) return null
  const { pass } = early
  early = null
  return pass
}
