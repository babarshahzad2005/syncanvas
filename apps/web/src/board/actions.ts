import {
  elementsOf,
  groupElements,
  listElements,
  liveGroups,
  setLocked,
  ungroupElements,
} from "@syncanvas/board-model"
import type * as Y from "yjs"
import { useBoardUi } from "./store"

// Selection commands shared by the keyboard shortcuts and the tray's ⋯ menu.

type Context = { doc: Y.Doc; origin: object; undoManager: Y.UndoManager }

/** What the group and Lock commands can do with the current selection. */
export function selectionCommands(doc: Y.Doc, selection: ReadonlySet<string>) {
  const elements = elementsOf(doc)
  const groupIds = [...selection].map((id) => elements.get(id)?.get("groupId"))
  const live = liveGroups(listElements(doc))
  const grouped = groupIds.filter((g): g is string => typeof g === "string" && live.has(g))
  // Already exactly one whole group: grouping again would change nothing.
  const oneGroup =
    grouped.length === selection.size &&
    new Set(grouped).size === 1 &&
    live.get(grouped[0] as string)?.length === selection.size
  return {
    canGroup: selection.size >= 2 && !oneGroup,
    canUngroup: grouped.length > 0,
    /** Every selected Element is locked (the Lock toggle shows pressed). */
    locked: selection.size > 0 && [...selection].every((id) => elements.get(id)?.get("locked")),
  }
}

export function groupSelection({ doc, origin, undoManager }: Context) {
  const { selection } = useBoardUi.getState()
  if (!selectionCommands(doc, selection).canGroup) return
  undoManager.stopCapturing()
  groupElements(doc, selection, origin)
}

export function ungroupSelection({ doc, origin, undoManager }: Context) {
  const { selection } = useBoardUi.getState()
  if (!selectionCommands(doc, selection).canUngroup) return
  undoManager.stopCapturing()
  ungroupElements(doc, selection, origin)
}

/** Locks the selection, or unlocks it when it's all locked already. */
export function toggleLock({ doc, origin, undoManager }: Context) {
  const { selection } = useBoardUi.getState()
  if (selection.size === 0) return
  undoManager.stopCapturing()
  setLocked(doc, selection, !selectionCommands(doc, selection).locked, origin)
}
