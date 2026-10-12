import {
  type Alignment,
  type ArrangeUnit,
  alignUnits,
  distributeUnits,
  type ElementWithId,
  elementsOf,
  groupElements,
  indexById,
  listElements,
  liveGroups,
  moveUnits,
  reorderElements,
  setLocked,
  ungroupElements,
} from "@syncanvas/board-model"
import { elementBox } from "@syncanvas/renderer"
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
  const locked = selection.size > 0 && [...selection].every((id) => elements.get(id)?.get("locked"))
  const units = arrangeUnits(doc, selection).length
  return {
    canGroup: selection.size >= 2 && !oneGroup,
    canReorder: selection.size > 0 && !locked,
    canAlign: units >= 2,
    canDistribute: units >= 3,
    canUngroup: grouped.length > 0,
    /** Every selected Element is locked (the Lock toggle shows pressed). */
    locked,
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

/** An Element's box as drawn (text and sticky boxes come from their layout). */
function drawnBox(byId: ReadonlyMap<string, ElementWithId>) {
  return (e: ElementWithId) => {
    const { position, size } = elementBox(e, byId)
    return { x: position.x, y: position.y, w: size.w, h: size.h }
  }
}

/**
 * The selection as units that align and distribute together: each live group is one unit,
 * every other Element its own. Connectors (they follow their ends) and locked Elements stay
 * out.
 */
function arrangeUnits(doc: Y.Doc, selection: ReadonlySet<string>): ArrangeUnit[] {
  const all = listElements(doc)
  const byId = indexById(all)
  const groups = liveGroups(all)
  const boxOf = drawnBox(byId)
  const members = new Map<string, ElementWithId[]>()
  for (const id of selection) {
    const e = byId.get(id)
    if (!e || e.type === "connector" || e.locked) continue
    const key = e.groupId !== undefined && groups.has(e.groupId) ? `g:${e.groupId}` : e.id
    members.set(key, [...(members.get(key) ?? []), e])
  }
  return [...members.values()].map((list) => {
    const boxes = list.map(boxOf)
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    return {
      ids: list.map((e) => e.id),
      box: {
        x,
        y,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
        h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
      },
    }
  })
}

/** Brings the selection forward or sends it backward one step (Ctrl/Cmd+] and [). */
export function reorderSelection(
  { doc, origin, undoManager }: Context,
  direction: "forward" | "backward",
) {
  const { selection } = useBoardUi.getState()
  if (!selectionCommands(doc, selection).canReorder) return
  undoManager.stopCapturing()
  const byId = indexById(listElements(doc))
  reorderElements(doc, selection, direction, drawnBox(byId), origin)
}

/** Lines the selection up (2+ units), or spaces it evenly (3+), as one undo step. */
export function arrangeSelection(
  { doc, origin, undoManager }: Context,
  how: Alignment | "horizontal" | "vertical",
) {
  const { selection } = useBoardUi.getState()
  const units = arrangeUnits(doc, selection)
  const offsets =
    how === "horizontal" || how === "vertical"
      ? distributeUnits(units, how)
      : alignUnits(units, how)
  if (offsets.size === 0) return
  undoManager.stopCapturing()
  moveUnits(doc, units, offsets, origin)
}
