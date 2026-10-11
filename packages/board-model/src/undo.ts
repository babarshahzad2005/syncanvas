import * as Y from "yjs"
import { elementsOf } from "./model"

/**
 * The Board's undo history for one tab: tracks only edits made with `origin` (PRD: undo
 * reverts only your own actions). Call `stopCapturing()` at the start of each gesture, so one
 * gesture is one undo step (captureTimeout is Infinity).
 *
 * Undo restores your own previous value even if someone changed it after you (ADR 0010).
 * Yjs's default skips such fields, which can bring an Element back without them.
 */
export function createUndoManager(doc: Y.Doc, origin: unknown): Y.UndoManager {
  return new Y.UndoManager(elementsOf(doc), {
    trackedOrigins: new Set([origin]),
    captureTimeout: Number.POSITIVE_INFINITY,
    ignoreRemoteMapChanges: true,
  })
}
