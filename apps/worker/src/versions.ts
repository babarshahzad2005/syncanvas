import { canEdit, type VersionInfo } from "@syncanvas/shared"
import type { VersionSummary } from "./board-room"
import type { Database } from "./db/client"
import { type Caller, memberOrRefuse, refuse } from "./sharing"

// Version history (M5b ticket 06; FLOWS "Restore a Version"): the board room keeps the
// Versions; the API lets only Editors and the Owner see them. Guests have no session, so they
// never get this far.

/** The board room's Version calls (Durable Object RPC; in-memory in tests). */
export type VersionsRoom = {
  list(boardId: string): Promise<VersionSummary[]>
  state(boardId: string, versionId: number): Promise<Uint8Array | null>
  noteRestore(boardId: string, versionId: number, name: string): Promise<boolean>
}

export const HISTORY_REFUSED = "Only the owner and editors can see version history."

async function editorOrRefuse(db: Database, boardId: string, caller: Caller) {
  const membership = await memberOrRefuse(db, boardId, caller)
  if (!canEdit(membership.role)) throw refuse(403, { error: HISTORY_REFUSED })
}

function versionIdOrRefuse(value: string) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw refuse(404, { error: "No such version." })
  return id
}

export async function listVersions(
  db: Database,
  room: VersionsRoom,
  input: { boardId: string; caller: Caller },
): Promise<VersionInfo[]> {
  await editorOrRefuse(db, input.boardId, input.caller)
  const versions = await room.list(input.boardId)
  return versions.map((v) => ({ ...v, at: new Date(v.at).toISOString() }))
}

/** A Version's doc as one Yjs update, for the client to preview and restore from. */
export async function versionState(
  db: Database,
  room: VersionsRoom,
  input: { boardId: string; caller: Caller; versionId: string },
) {
  await editorOrRefuse(db, input.boardId, input.caller)
  const state = await room.state(input.boardId, versionIdOrRefuse(input.versionId))
  if (!state) throw refuse(404, { error: "No such version." })
  return state
}

/** The caller restored a Version (applied in their client): the room records it. */
export async function noteRestore(
  db: Database,
  room: VersionsRoom,
  input: { boardId: string; caller: Caller; versionId: string; name: string },
) {
  await editorOrRefuse(db, input.boardId, input.caller)
  const id = versionIdOrRefuse(input.versionId)
  if (!(await room.noteRestore(input.boardId, id, input.name))) {
    throw refuse(404, { error: "No such version." })
  }
}
