import {
  type Anchor,
  addArrow,
  addConnector,
  addPen,
  addShape,
  addSticky,
  addText,
  arrowGeometry,
  attachedTarget,
  type ConnectorEnd,
  type ConnectorStyle,
  deleteElements,
  type ElementWithId,
  elementsOf,
  expandToGroups,
  type Geometry,
  hasBox,
  isAttachable,
  listElements,
  liveGroups,
  MIN_STICKY_WIDTH,
  MIN_TEXT_WIDTH,
  type PaletteColor,
  type PenWidth,
  type Point,
  type Rect,
  readElement,
  type StrokePoint,
  scaledGeometry,
  setGeometry,
  setTextStyle,
  textOf,
  translatedGeometry,
} from "@syncanvas/board-model"
import {
  boundsOf,
  type Camera,
  clearTextLayoutCache,
  drawScene,
  ElementIndex,
  elementBox,
  fitCamera,
  hitTest,
  LINE_HEIGHT,
  lockBadgeRect,
  type RemoteSelection,
  type Scene,
  screenToWorld,
  selectionFrame,
  snapPoints,
  TEXT_SIZES,
  worldToScreen,
  zoomAt,
} from "@syncanvas/renderer"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react"
import { toast } from "sonner"
import type * as Y from "yjs"
import { useResolvedTheme } from "@/lib/theme"
import { CursorLayer } from "@/presence/cursor-layer"
import { LocalPresence } from "@/presence/local-presence"
import { presenceColor, publishedSelection, selectionOf } from "@/presence/model"
import type { BoardConnection } from "@/sync/board-connection"
import { groupSelection, reorderSelection, toggleLock, ungroupSelection } from "./actions"
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  elementsFromPaste,
  pasteAt,
} from "./clipboard"
import { type DragTool, isDragTool, useBoardUi } from "./store"
import { TextEditor } from "./text-editor"

// The Board canvas: Canvas2D rendering plus pointer/keyboard input (DESIGN.md → Canvas).
// The document is only written at gesture boundaries (and throttled during drags), so local
// previews stay smooth and one gesture is one undo step.

/** Moving an existing Element streams to collaborators at about 20 per second (FLOWS §2). */
const MOVE_SEND_INTERVAL_MS = 50
/** Pen points closer than this (screen px) to the simplified line are dropped. */
const PEN_TOLERANCE_PX = 0.5
/** Shapes smaller than this (in screen px) are treated as a click, not a drag. */
const MIN_DRAW_PX = 4
/** How close (screen px) the pointer must be to a handle to grab it. */
const HANDLE_REACH_PX = 6
/** Smallest a resized selection gets, in canvas units (text and stickies have their own). */
const MIN_RESIZE = 8

/** Arrow keys nudge the selection this far (canvas units), or further with Shift. */
const NUDGE = 1
const NUDGE_SHIFT = 10
const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

export type CanvasHandle = {
  zoomBy: (factor: number) => void
  zoomTo: (zoom: number) => void
  fit: () => void
}

type Gesture =
  | { kind: "pan"; pointerId: number; start: Point; camera: Camera }
  | { kind: "pinch"; distance: number; center: Point; camera: Camera }
  | { kind: "draw"; pointerId: number; tool: DragTool; start: Point; current: Point }
  | { kind: "stroke"; pointerId: number; points: StrokePoint[] }
  | {
      // Moving the selection: every member keeps its offset from where it started.
      kind: "move"
      pointerId: number
      start: Point
      /** The moving Elements as they were when the move started. */
      originals: ReadonlyMap<string, ElementWithId>
      offset: Point
      moved: boolean
      lastSent: number
      /** Pressed inside a bigger selection: a click without a drag selects just this (group). */
      collapseTo: string[] | null
    }
  | {
      // Resizing from a corner handle, or dragging one end of an arrow.
      kind: "resize"
      pointerId: number
      start: Point
      /** The Elements as they were when the gesture started. */
      originals: ReadonlyMap<string, ElementWithId>
      /** New geometry for each Element, for a pointer position (Shift keeps proportions). */
      reshape: (pointer: Point, keepRatio: boolean) => Map<string, Geometry>
      geometry: Map<string, Geometry>
      moved: boolean
      lastSent: number
    }
  | {
      // Drawing a connector with C: from where it was pressed to where it's released.
      kind: "connect"
      pointerId: number
      start: ConnectorEnd & { point: Point }
      current: Point
      snap: Snap | null
    }
  | {
      kind: "marquee"
      pointerId: number
      start: Point
      current: Point
      /** Selected before the drag (kept when Shift is held). */
      base: ReadonlySet<string>
    }

type Props = {
  doc: Y.Doc
  /** Transaction origin for this tab's edits (what the UndoManager tracks). */
  origin: object
  undoManager: Y.UndoManager
  canEdit: boolean
  /** The live connection: presence goes out and comes in through it. */
  connection?: BoardConnection | null
}

declare global {
  interface Window {
    __SYNCANVAS_TEST__?: boolean
    __syncanvas?: { elements: () => ElementWithId[]; camera: () => Camera }
    /** Test hook: every other tab's presence state, as this tab sees it. */
    __syncanvasPresence?: () => Record<string, unknown>[]
  }
}

/** A connector end snapping to one of an Element's four side midpoints. */
type Snap = { elementId: string; anchor: Anchor; point: Point; points: Point[] }

/** A connector end at a snap, or free at `point`. */
function endAt(snap: Snap | null, point: Point): ConnectorEnd {
  return snap
    ? { elementId: snap.elementId, anchor: snap.anchor, fallback: snap.point }
    : { fallback: point }
}

/**
 * Where everything moved is right now, during a move: boxed Elements by their position,
 * connectors by their free ends (attached ends follow their Elements).
 */
function draggedGeometry(
  g: Extract<Gesture, { kind: "move" }>,
  byId: ReadonlyMap<string, ElementWithId>,
): Map<string, Geometry> {
  const attached = (end: ConnectorEnd) => attachedTarget(end, byId) !== undefined
  const out = new Map<string, Geometry>()
  for (const [id, e] of g.originals) {
    const geometry = translatedGeometry(e, g.offset, attached)
    if (geometry) out.set(id, geometry)
  }
  return out
}

/** The Elements a move or resize in progress shows in place of the document's. */
function overridesOf(
  g: Gesture | null,
  byId: ReadonlyMap<string, ElementWithId>,
): Map<string, ElementWithId> | undefined {
  if (g?.kind === "move") {
    const out = new Map<string, ElementWithId>()
    for (const [id, geometry] of draggedGeometry(g, byId)) {
      const e = g.originals.get(id)
      if (e) out.set(id, { ...e, ...geometry } as ElementWithId)
    }
    return out
  }
  if (g?.kind === "resize") {
    const out = new Map<string, ElementWithId>()
    for (const [id, geometry] of g.geometry) {
      const e = g.originals.get(id)
      if (e) out.set(id, { ...e, ...geometry } as ElementWithId)
    }
    return out
  }
  return undefined
}

/** What the gesture in progress is drawing, for the renderer to show before it's written. */
function previewOf(
  g: Gesture | null,
  ui: { pen: { color: PaletteColor; width: PenWidth }; connectorStyle: ConnectorStyle },
): Scene["preview"] {
  const { pen } = ui
  if (g?.kind === "stroke") return { type: "pen", points: g.points, ...pen }
  if (g?.kind === "connect") {
    return {
      type: "connector",
      start: g.start.point,
      startAnchor: g.start.anchor,
      end: g.snap?.point ?? g.current,
      endAnchor: g.snap?.anchor,
      style: ui.connectorStyle,
      color: "ink",
    }
  }
  if (g?.kind !== "draw" || g.tool === "sticky") return null
  if (g.tool === "arrow") return { type: "arrow", from: g.start, to: g.current, color: "ink" }
  if (g.tool === "text") {
    // Dragging with T sets the text's width; show the box being dragged out.
    return {
      type: "rect",
      position: g.start,
      size: { w: g.current.x - g.start.x, h: g.current.y - g.start.y },
      color: "gray",
      fill: "none",
    }
  }
  return {
    type: g.tool,
    position: g.start,
    size: { w: g.current.x - g.start.x, h: g.current.y - g.start.y },
    color: "ink",
    fill: "light",
  }
}

export const BoardCanvas = forwardRef<CanvasHandle, Props>(function BoardCanvas(
  { doc, origin, undoManager, canEdit, connection = null },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const cursorHost = useRef<HTMLDivElement>(null)
  const theme = useResolvedTheme()
  const tool = useBoardUi((s) => s.tool)
  const editing = useBoardUi((s) => s.editing)

  // Mutable rendering state lives in refs: it changes at pointer rate, not React rate.
  const state = useRef({
    camera: { x: 0, y: 0, zoom: 1 } as Camera,
    cameraReady: false,
    size: { w: 0, h: 0 },
    dpr: 1,
    index: new ElementIndex(),
    /** Connector snap points to show (while the connector tool hovers or drags an end). */
    snap: null as Scene["snap"],
    /** Where the pointer is over the canvas (world), for pasting at the cursor. */
    pointer: null as Point | null,
    /** The same, in screen px: after a pan or zoom it's over a different world point. */
    screenPointer: null as Point | null,
    cursors: null as CursorLayer | null,
    /** Others' selections, drawn by the renderer (M2 ticket 04). */
    remoteSelections: [] as RemoteSelection[],
    presence: null as LocalPresence | null,
    /** A locked Element under the pointer, showing its lock badge. */
    hoverLocked: null as string | null,
    gesture: null as Gesture | null,
    pointers: new Map<number, Point>(),
    spaceHeld: false,
    frame: 0,
    theme,
  })
  state.current.theme = theme

  // Keeps the text editor exactly over its Element (world units, scaled by the zoom).
  const placeEditor = useCallback(() => {
    const s = state.current
    const editor = editorRef.current
    const id = useBoardUi.getState().editing?.id
    const element = id ? s.index.byId.get(id) : undefined
    if (!editor || !element || !hasBox(element)) return
    const p = worldToScreen(s.camera, element.position)
    editor.style.transform = `translate(${p.x}px, ${p.y}px) scale(${s.camera.zoom})`
  }, [])

  // Stable: it only reads refs and the store, so effects can depend on it safely.
  const render = useCallback(() => {
    const s = state.current
    if (s.frame) return
    s.frame = requestAnimationFrame(() => {
      s.frame = 0
      const ctx = canvasRef.current?.getContext("2d")
      if (!ctx) return
      const g = s.gesture
      const ui = useBoardUi.getState()
      const overrides = overridesOf(g, s.index.byId)
      // Only what's in view (with a margin for strokes), plus whatever is being dragged.
      const topLeft = screenToWorld(s.camera, { x: 0, y: 0 })
      const margin = 16 / s.camera.zoom
      const visible = s.index.query(
        {
          x: topLeft.x - margin,
          y: topLeft.y - margin,
          w: s.size.w / s.camera.zoom + margin * 2,
          h: s.size.h / s.camera.zoom + margin * 2,
        },
        overrides?.keys(),
      )
      drawScene(ctx, {
        elements: visible,
        byId: s.index.byId,
        camera: s.camera,
        theme: s.theme,
        size: s.size,
        dpr: s.dpr,
        selection: ui.selection,
        overrides,
        preview: previewOf(g, ui),
        snap: s.snap,
        lockBadge: s.hoverLocked,
        remoteSelections: s.remoteSelections,
        handles: ![...ui.selection].some((id) => s.index.byId.get(id)?.locked),
        marquee:
          g?.kind === "marquee"
            ? {
                position: g.start,
                size: { w: g.current.x - g.start.x, h: g.current.y - g.start.y },
              }
            : null,
        editing: ui.editing?.id ?? null,
      })
      placeEditor()
      s.cursors?.setCamera(s.camera)
    })
  }, [placeEditor])

  const setCamera = (camera: Camera) => {
    const s = state.current
    s.camera = camera
    useBoardUi.getState().setZoom(camera.zoom)
    // The pointer now sits over another part of the Board: others see the cursor move with it.
    if (s.screenPointer) {
      s.pointer = screenToWorld(camera, s.screenPointer)
      s.presence?.cursor(s.pointer)
    }
    render()
  }

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const { size, camera } = state.current
      setCamera(zoomAt(camera, { x: size.w / 2, y: size.h / 2 }, factor))
    },
    zoomTo: (zoom) => {
      const { size, camera } = state.current
      setCamera(zoomAt(camera, { x: size.w / 2, y: size.h / 2 }, zoom / camera.zoom))
    },
    fit: () => {
      const { index, size } = state.current
      setCamera(fitCamera(boundsOf(index.all(), index.byId), size))
    },
  }))

  // Re-render when the theme or the selection changes.
  useEffect(() => {
    render()
    return useBoardUi.subscribe(render)
  })

  // Presence (M2): publish this tab's cursor and away state, and draw everyone else's cursors.
  useEffect(() => {
    const host = cursorHost.current
    if (!connection || !host) return
    const s = state.current
    const cursors = new CursorLayer(host)
    cursors.setCamera(s.camera)
    s.cursors = cursors
    const presence = new LocalPresence((fields) => connection.setPresence(fields))
    presence.start()
    s.presence = presence
    const refresh = () => {
      cursors.update(connection.presence)
      s.remoteSelections = connection.presence.flatMap((tab) => {
        const selection = selectionOf(tab)
        if (!selection) return []
        return [
          { ...selection, name: tab.user.name, color: presenceColor(tab.user.id, tab.user.guest) },
        ]
      })
      render()
    }
    refresh()
    // Publish what this tab has selected (someone typing has their text selected, too).
    const publishSelection = () => {
      const ids = [...useBoardUi.getState().selection]
      connection.setPresence({
        selection: publishedSelection(ids, (list) => {
          const elements = list.flatMap((id) => s.index.byId.get(id) ?? [])
          return boundsOf(elements, s.index.byId)
        }),
      })
    }
    publishSelection()
    const unsubscribeSelection = useBoardUi.subscribe((ui, before) => {
      if (ui.selection !== before.selection) publishSelection()
    })
    if (window.__SYNCANVAS_TEST__) {
      window.__syncanvasPresence = () =>
        connection.presence.map((t) => ({ ...t.state, user: t.user }))
    }
    const unsubscribe = connection.subscribePresence(refresh)
    return () => {
      unsubscribe()
      unsubscribeSelection()
      presence.stop()
      cursors.dispose()
      s.cursors = null
      s.presence = null
    }
  }, [connection, render])

  // Keep the spatial index in sync with the document (local and remote changes alike),
  // re-reading only the Elements each change touched.
  useEffect(() => {
    const elements = elementsOf(doc)
    state.current.index.reset(listElements(doc))
    const refresh = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const changed = new Set<string>()
      for (const event of events) {
        if (event.target === elements) for (const id of event.changes.keys.keys()) changed.add(id)
        else if (typeof event.path[0] === "string") changed.add(event.path[0])
      }
      state.current.index.update(
        [...changed].map((id) => {
          const fields = elements.get(id)
          const element = fields ? readElement(fields) : null
          return [id, element ? { ...element, id } : null] as const
        }),
      )
      // Drop selected Elements that someone else deleted.
      const { selection, select } = useBoardUi.getState()
      const alive = [...selection].filter((id) => elements.has(id))
      if (alive.length !== selection.size) select(alive)
      render()
    }
    render()
    elements.observeDeep(refresh)
    if (window.__SYNCANVAS_TEST__) {
      window.__syncanvas = { elements: () => listElements(doc), camera: () => state.current.camera }
    }
    return () => elements.unobserveDeep(refresh)
  }, [doc, render])

  // Text is measured with Geist; until the web font loads, measurements use a fallback font.
  // Re-measure once it's ready.
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      document.fonts.load('400 20px "Geist Variable"'),
      document.fonts.load('600 20px "Geist Variable"'),
    ]).then(() => {
      if (cancelled) return
      clearTextLayoutCache()
      // Text and sticky boxes were measured with the fallback font: index them again.
      state.current.index.reset(state.current.index.all())
      render()
    })
    return () => {
      cancelled = true
    }
  }, [render])

  // Size the canvas to its box at device-pixel resolution.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      const s = state.current
      const box = canvas.getBoundingClientRect()
      s.dpr = window.devicePixelRatio || 1
      s.size = { w: box.width, h: box.height }
      canvas.width = Math.round(box.width * s.dpr)
      canvas.height = Math.round(box.height * s.dpr)
      if (!s.cameraReady) {
        // Start with the world origin in the middle of the screen.
        s.camera = { x: box.width / 2, y: box.height / 2, zoom: 1 }
        s.cameraReady = true
      }
      render()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [render])

  // Wheel: pan, or zoom around the cursor with Ctrl/Cmd (trackpad pinch sends ctrlKey).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { camera } = state.current
      if (e.ctrlKey || e.metaKey) {
        setCamera(zoomAt(camera, local(e), Math.exp(-e.deltaY * 0.01)))
      } else {
        setCamera({ ...camera, x: camera.x - e.deltaX, y: camera.y - e.deltaY })
      }
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  })

  // Keyboard shortcuts (DESIGN.md / PRD A1). Ignored while typing in a field.
  useEffect(() => {
    const ui = useBoardUi.getState
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return
      const mod = e.ctrlKey || e.metaKey
      if (e.code === "Space") {
        state.current.spaceHeld = true
        e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (!canEdit) return
        if (e.shiftKey) undoManager.redo()
        else undoManager.undo()
        return
      }
      if (mod && e.key.toLowerCase() === "b") {
        // Bold for selected texts and stickies, toggled together from the first one's state.
        const texts = selectedElements().filter((el) => el.type === "text" || el.type === "sticky")
        const first = texts[0]
        if (!canEdit || !(first?.type === "text" || first?.type === "sticky")) return
        e.preventDefault()
        for (const el of texts) setTextStyle(doc, el.id, { bold: !first.bold }, origin)
        return
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault()
        if (!canEdit) return
        if (e.shiftKey) ungroupSelection({ doc, origin, undoManager })
        else groupSelection({ doc, origin, undoManager })
        return
      }
      if (mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault()
        if (canEdit) {
          reorderSelection({ doc, origin, undoManager }, e.key === "]" ? "forward" : "backward")
        }
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault()
        if (canEdit) toggleLock({ doc, origin, undoManager })
        return
      }
      // Copy works for Viewers; cut, duplicate, and paste need Editor access.
      if (mod && !e.shiftKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
        if (ui().selection.size === 0) return // nothing of ours: leave the key to the browser
        e.preventDefault()
        if (e.key.toLowerCase() === "c") copySelection(clipboardContext())
        else if (canEdit) cutSelection(clipboardContext())
        return
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault() // not the browser's bookmark shortcut
        if (canEdit) duplicateSelection(clipboardContext())
        return
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        if (canEdit) undoManager.redo()
        return
      }
      if (mod) return
      // Typing while one text or sticky is selected starts editing it (Enter just opens the
      // editor).
      const selected = ui().selection.size === 1 ? [...ui().selection][0] : undefined
      const element = selected ? state.current.index.byId.get(selected) : undefined
      if (
        canEdit &&
        (element?.type === "text" || element?.type === "sticky") &&
        (e.key === "Enter" || e.key.length === 1)
      ) {
        e.preventDefault()
        const text = textOf(doc, element.id)
        if (e.key !== "Enter" && text) {
          undoManager.stopCapturing()
          const key = e.key
          doc.transact(() => text.insert(text.length, key), origin)
        }
        ui().setEditing({ id: element.id, continuing: e.key !== "Enter" })
        return
      }
      if (e.key === "?") {
        e.preventDefault()
        ui().setShortcutsOpen("keyboard")
        return
      }
      if (e.shiftKey && e.code === "Digit1") {
        const { index, size } = state.current
        setCamera(fitCamera(boundsOf(index.all(), index.byId), size))
        return
      }
      const arrow = ARROWS[e.key]
      if (arrow && ui().selection.size > 0) {
        // Each press is its own undo step (holding the key repeats it).
        e.preventDefault()
        if (!canEdit) return
        const step = e.shiftKey ? NUDGE_SHIFT : NUDGE
        undoManager.stopCapturing()
        const { byId } = state.current.index
        const attached = (end: ConnectorEnd) => attachedTarget(end, byId) !== undefined
        setGeometry(
          doc,
          selectedElements().flatMap((el) => {
            const geometry = el.locked
              ? null
              : translatedGeometry(el, { x: arrow.x * step, y: arrow.y * step }, attached)
            return geometry ? [[el.id, geometry] as const] : []
          }),
          origin,
        )
        return
      }
      switch (e.key.toLowerCase()) {
        case "v":
          ui().setTool("select")
          return
        case "p":
          if (canEdit) ui().setTool("pen")
          return
        case "r":
          if (canEdit) ui().setTool("rect")
          return
        case "o":
          if (canEdit) ui().setTool("ellipse")
          return
        case "a":
          if (canEdit) ui().setTool("arrow")
          return
        case "t":
          if (canEdit) ui().setTool("text")
          return
        case "c":
          if (canEdit) ui().setTool("connector")
          return
        case "s":
          if (canEdit) ui().setTool("sticky")
          return
        case "escape":
          state.current.gesture = null
          ui().select([])
          render()
          return
        case "delete":
        case "backspace":
          if (canEdit && ui().selection.size > 0) {
            undoManager.stopCapturing()
            // Locked Elements stay (only unlocking them is allowed).
            deleteElements(
              doc,
              selectedElements()
                .filter((el) => !el.locked)
                .map((el) => el.id),
              origin,
            )
            ui().select([])
          }
          return
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") state.current.spaceHeld = false
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  })

  // Paste (Ctrl/Cmd+V fires a paste event): Syncanvas Elements land at the cursor, or the
  // viewport's center when the pointer isn't over the Board.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return
      const elements = elementsFromPaste(e)
      if (!elements) return
      e.preventDefault()
      if (!canEdit) {
        toast("This Board is view-only", {
          description: "Ask its Owner for edit access to paste here.",
        })
        return
      }
      const { camera, size, pointer } = state.current
      pasteAt(
        clipboardContext(),
        elements,
        pointer ?? screenToWorld(camera, { x: size.w / 2, y: size.h / 2 }),
      )
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  })

  function clipboardContext() {
    const { index } = state.current
    return { doc, origin, undoManager, byId: index.byId, all: index.all() }
  }

  function local(e: { clientX: number; clientY: number }): Point {
    const box = canvasRef.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  function startPinch() {
    const [a, b] = [...state.current.pointers.values()]
    if (!a || !b) return
    state.current.gesture = {
      kind: "pinch",
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      camera: state.current.camera,
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = state.current
    const point = local(e)
    s.pointers.set(e.pointerId, point)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (s.pointers.size === 2) return startPinch() // second finger: pinch/pan, cancel the rest
    if (s.pointers.size > 2) return

    const world = screenToWorld(s.camera, point)
    const ui = useBoardUi.getState()

    if (e.button === 1 || s.spaceHeld) {
      s.gesture = { kind: "pan", pointerId: e.pointerId, start: point, camera: s.camera }
      return
    }
    if (e.button !== 0) return

    if (ui.tool === "pen" && canEdit) {
      undoManager.stopCapturing()
      s.gesture = { kind: "stroke", pointerId: e.pointerId, points: [strokePoint(e, s.camera)] }
      ui.select([])
      return
    }
    if (ui.tool === "connector" && canEdit) {
      undoManager.stopCapturing()
      const snap = snapAt(world)
      s.gesture = {
        kind: "connect",
        pointerId: e.pointerId,
        start: { ...endAt(snap, world), point: snap?.point ?? world },
        current: world,
        snap: null,
      }
      ui.select([])
      return
    }
    if (isDragTool(ui.tool) && canEdit) {
      undoManager.stopCapturing()
      s.gesture = {
        kind: "draw",
        pointerId: e.pointerId,
        tool: ui.tool,
        start: world,
        current: world,
      }
      ui.select([])
      return
    }

    // The lock badge of a locked Element selects it, so it can be unlocked.
    const badged = s.hoverLocked ? s.index.byId.get(s.hoverLocked) : undefined
    if (badged) {
      const r = lockBadgeRect(badged, s.index.byId, s.camera)
      if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
        ui.select([badged.id])
        return
      }
    }

    // Handles win over everything under them, Shift included (Shift keeps proportions).
    const handle = handleAt(point)
    if (handle) {
      undoManager.stopCapturing()
      s.gesture = {
        kind: "resize",
        pointerId: e.pointerId,
        start: world,
        ...handle,
        geometry: new Map(),
        moved: false,
        lastSent: 0,
      }
      return
    }

    const hit = hitAt(world)
    // Touch has no hover: tapping a locked Element shows its badge instead.
    if (e.pointerType === "touch") setHoverLocked(hit ? null : lockedAt(world))
    if (!hit) {
      // On touch, dragging empty canvas pans (there's no Space key).
      if (e.pointerType === "touch") {
        ui.select([])
        s.gesture = { kind: "pan", pointerId: e.pointerId, start: point, camera: s.camera }
        return
      }
      // A marquee; with Shift it adds to the selection. Viewers can select too.
      const base = e.shiftKey ? ui.selection : new Set<string>()
      if (!e.shiftKey) ui.select([])
      s.gesture = { kind: "marquee", pointerId: e.pointerId, start: world, current: world, base }
      return
    }
    // Clicking a group member means the whole group.
    const unit = [...expandToGroups([hit], s.index.all())]
    if (e.shiftKey) {
      // Shift+click toggles membership (of the whole group) and starts nothing else.
      const next = new Set(ui.selection)
      const all = unit.every((id) => next.has(id))
      for (const id of unit) {
        if (all) next.delete(id)
        else next.add(id)
      }
      ui.select(next)
      return
    }
    // Pressing a member of the selection keeps the selection, so it can be dragged together.
    // (A member picked out of its group by double-click stays picked out.)
    const keep = ui.selection.has(hit)
    if (!keep) ui.select(unit)
    if (!canEdit) return
    const originals = new Map<string, ElementWithId>()
    for (const id of useBoardUi.getState().selection) {
      const element = s.index.byId.get(id)
      // Locked Elements stay put; connectors move their free ends.
      if (element && !element.locked) originals.set(id, element)
    }
    if (originals.size === 0) return
    undoManager.stopCapturing()
    s.gesture = {
      kind: "move",
      pointerId: e.pointerId,
      start: world,
      originals,
      offset: { x: 0, y: 0 },
      moved: false,
      lastSent: 0,
      collapseTo: keep && ui.selection.size > unit.length ? unit : null,
    }
  }

  /** Elements near a world point (in drawing order), for hit-testing it. */
  function nearby(world: Point): ElementWithId[] {
    const { index, camera } = state.current
    const reach = 16 / camera.zoom
    return index.query({ x: world.x - reach, y: world.y - reach, w: reach * 2, h: reach * 2 })
  }

  /**
   * Where a connector end would snap at a world point: the nearest side midpoint of the
   * topmost shape, text, or sticky under (or within a few pixels of) it.
   */
  function snapAt(world: Point, exclude?: string): Snap | null {
    const { index, camera } = state.current
    const reach = 16 / camera.zoom
    const candidates = nearby(world)
    for (let i = candidates.length - 1; i >= 0; i--) {
      const e = candidates[i]
      if (!e || e.id === exclude || !isAttachable(e)) continue
      const { position: p, size } = elementBox(e, index.byId)
      const inside =
        world.x >= p.x - reach &&
        world.x <= p.x + size.w + reach &&
        world.y >= p.y - reach &&
        world.y <= p.y + size.h + reach
      if (!inside) continue
      const points = snapPoints(e)
      let best = points[0]
      for (const option of points) {
        const d = Math.hypot(option.point.x - world.x, option.point.y - world.y)
        if (best && d < Math.hypot(best.point.x - world.x, best.point.y - world.y)) best = option
      }
      if (!best) continue
      return {
        elementId: e.id,
        anchor: best.anchor,
        point: best.point,
        points: points.map((option) => option.point),
      }
    }
    return null
  }

  function showSnap(snap: Snap | null, active: boolean) {
    const s = state.current
    const next = snap ? { points: snap.points, active: active ? snap.point : null } : null
    if (JSON.stringify(next) === JSON.stringify(s.snap)) return
    s.snap = next
    render()
  }

  /** The topmost selectable Element at a world point (locked ones are skipped). */
  function hitAt(world: Point): string | null {
    const { index, camera } = state.current
    const candidates = nearby(world).filter((el) => !el.locked)
    return hitTest(candidates, world, camera.zoom, index.byId)
  }

  /** The topmost Element at a world point if it's locked (it then shows its lock badge). */
  function lockedAt(world: Point): string | null {
    const { index, camera } = state.current
    const id = hitTest(nearby(world), world, camera.zoom, index.byId)
    return id && index.byId.get(id)?.locked ? id : null
  }

  function setHoverLocked(id: string | null) {
    if (state.current.hoverLocked === id) return
    state.current.hoverLocked = id
    render()
  }

  /**
   * What a marquee selects: unlocked Elements entirely inside it, and groups only when every
   * member is inside (then the whole group).
   */
  function marqueeSelection(rect: Rect): string[] {
    const { index } = state.current
    const inside = new Set(index.inside(rect).filter((id) => !index.byId.get(id)?.locked))
    const groups = liveGroups(index.all())
    return [...inside].filter((id) => {
      const groupId = index.byId.get(id)?.groupId
      const members = groupId === undefined ? undefined : groups.get(groupId)
      return !members || members.every((member) => inside.has(member))
    })
  }

  /**
   * The resize handle under a screen point, if any: a corner of the selection's box, or one
   * end of a single selected arrow. Returns how to reshape the selection from that handle.
   */
  function handleAt(point: Point): {
    cursor: string
    originals: ReadonlyMap<string, ElementWithId>
    reshape: (pointer: Point, keepRatio: boolean) => Map<string, Geometry>
  } | null {
    const { index, camera } = state.current
    if (!canEdit || useBoardUi.getState().tool !== "select") return null
    const selected = selectedElements()
    if (selected.some((el) => el.locked)) return null // locked: only unlocking is allowed
    const frame = selectionFrame(selected, index.byId)
    if (!frame) return null
    const originals = new Map(selected.map((e) => [e.id, e]))
    const near = (p: Point) => {
      const screen = worldToScreen(camera, p)
      return Math.hypot(screen.x - point.x, screen.y - point.y) <= HANDLE_REACH_PX
    }

    if (frame.kind === "ends") {
      const line = originals.get(frame.id)
      if (line?.type === "connector") {
        // Dragging a connector's end re-attaches it to what it's dropped on, or frees it.
        for (const which of ["start", "end"] as const) {
          if (!near(which === "start" ? frame.from : frame.to)) continue
          const other = line[which === "start" ? "end" : "start"].elementId
          return {
            cursor: "move",
            originals,
            reshape: (p) => {
              const snap = snapAt(p, other)
              showSnap(snap, true)
              return new Map([[line.id, { [which]: endAt(snap, p) }]])
            },
          }
        }
        return null
      }
      // Dragging one end of an arrow moves that end.
      if (line?.type !== "arrow") return null
      const { id, from, to } = frame
      if (near(to)) {
        return {
          cursor: "move",
          originals,
          reshape: (p) => new Map([[id, arrowGeometry(from, p)]]),
        }
      }
      if (near(from)) {
        return { cursor: "move", originals, reshape: (p) => new Map([[id, arrowGeometry(p, to)]]) }
      }
      return null
    }

    const r = frame.rect
    const corners = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]
    const i = corners.findIndex(near)
    const corner = corners[i]
    const anchor = corners[(i + 2) % 4] // the opposite corner stays put
    if (!corner || !anchor) return null
    const [only] = selected
    const single = selected.length === 1
    // Text and sticky notes resize their width only; their height follows their text.
    const widthOnly = single && (only?.type === "text" || only?.type === "sticky")
    const min =
      single && only?.type === "text"
        ? MIN_TEXT_WIDTH
        : single && only?.type === "sticky"
          ? MIN_STICKY_WIDTH
          : MIN_RESIZE
    const dirX = corner.x >= anchor.x ? 1 : -1
    const dirY = corner.y >= anchor.y ? 1 : -1
    const reshape = (p: Point, keepRatio: boolean) => {
      // A side the selection doesn't have (a flat line's height) stays flat.
      let w = r.w === 0 ? 0 : Math.max(min, (p.x - anchor.x) * dirX)
      let h = r.h === 0 || widthOnly ? r.h : Math.max(min, (p.y - anchor.y) * dirY)
      if (keepRatio && !widthOnly && r.w > 0 && r.h > 0) {
        const k = Math.max(w / r.w, h / r.h)
        w = r.w * k
        h = r.h * k
      }
      const to: Rect = {
        x: dirX > 0 ? anchor.x : anchor.x - w,
        y: widthOnly ? r.y : dirY > 0 ? anchor.y : anchor.y - h,
        w,
        h,
      }
      const out = new Map<string, Geometry>()
      for (const e of selected) {
        const geometry = scaledGeometry(e, r, to, single)
        if (geometry) out.set(e.id, geometry)
      }
      return out
    }
    return { cursor: dirX === dirY ? "nwse-resize" : "nesw-resize", originals, reshape }
  }

  function selectedElements(): ElementWithId[] {
    const { byId } = state.current.index
    return [...useBoardUi.getState().selection].flatMap((id) => {
      const element = byId.get(id)
      return element ? [element] : []
    })
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = state.current
    const point = local(e)
    if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, point)
    s.pointer = screenToWorld(s.camera, point)
    s.screenPointer = point
    s.presence?.cursor(s.pointer)
    const g = s.gesture
    if (!g) {
      // The connector tool shows where an end would snap.
      if (useBoardUi.getState().tool === "connector" && canEdit) {
        showSnap(snapAt(screenToWorld(s.camera, point)), false)
      } else if (s.snap) showSnap(null, false)
      if (e.pointerType === "mouse") {
        // Show a resize cursor over the selection's handles, and badges on locked Elements.
        e.currentTarget.style.cursor = handleAt(point)?.cursor ?? cursor
        const world = screenToWorld(s.camera, point)
        // Keep the badge while the pointer is on it (it pokes out past the Element).
        const badged = s.hoverLocked ? s.index.byId.get(s.hoverLocked) : undefined
        const r = badged && lockBadgeRect(badged, s.index.byId, s.camera)
        const onBadge =
          r && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h
        if (onBadge) e.currentTarget.style.cursor = "pointer"
        else setHoverLocked(lockedAt(world))
      }
      return
    }

    if (g.kind === "pinch") {
      const [a, b] = [...s.pointers.values()]
      if (!a || !b) return
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const moved = {
        ...g.camera,
        x: g.camera.x + center.x - g.center.x,
        y: g.camera.y + center.y - g.center.y,
      }
      setCamera(zoomAt(moved, center, Math.hypot(a.x - b.x, a.y - b.y) / g.distance))
      return
    }
    if (g.pointerId !== e.pointerId) return

    if (g.kind === "pan") {
      setCamera({
        ...g.camera,
        x: g.camera.x + point.x - g.start.x,
        y: g.camera.y + point.y - g.start.y,
      })
    } else if (g.kind === "draw") {
      g.current = screenToWorld(s.camera, point)
      render()
    } else if (g.kind === "stroke") {
      // Coalesced events keep fast strokes smooth: the browser batches points between frames.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const event of events.length > 0 ? events : [e.nativeEvent]) {
        g.points.push(strokePoint(event, s.camera))
      }
      render()
    } else if (g.kind === "move") {
      const world = screenToWorld(s.camera, point)
      g.offset = { x: world.x - g.start.x, y: world.y - g.start.y }
      // A few pixels of jitter in a click isn't a move.
      if (!g.moved && Math.hypot(g.offset.x, g.offset.y) * s.camera.zoom < MIN_DRAW_PX) return
      g.moved = true
      const now = performance.now()
      if (now - g.lastSent >= MOVE_SEND_INTERVAL_MS) {
        g.lastSent = now
        setGeometry(doc, draggedGeometry(g, s.index.byId), origin)
      }
      render()
    } else if (g.kind === "resize") {
      const world = screenToWorld(s.camera, point)
      const travel = Math.hypot(world.x - g.start.x, world.y - g.start.y) * s.camera.zoom
      if (!g.moved && travel < MIN_DRAW_PX) return
      g.moved = true
      g.geometry = g.reshape(world, e.shiftKey)
      const now = performance.now()
      if (now - g.lastSent >= MOVE_SEND_INTERVAL_MS) {
        g.lastSent = now
        setGeometry(doc, g.geometry, origin)
      }
      render()
    } else if (g.kind === "connect") {
      g.current = screenToWorld(s.camera, point)
      g.snap = snapAt(g.current, g.start.elementId)
      showSnap(g.snap, true)
      render()
    } else if (g.kind === "marquee") {
      g.current = screenToWorld(s.camera, point)
      const inside = marqueeSelection({
        x: g.start.x,
        y: g.start.y,
        w: g.current.x - g.start.x,
        h: g.current.y - g.start.y,
      })
      useBoardUi.getState().select(new Set([...g.base, ...inside]))
      render()
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = state.current
    s.pointers.delete(e.pointerId)
    const g = s.gesture
    if (!g) return
    if (g.kind === "pinch") {
      if (s.pointers.size < 2) s.gesture = null
      return
    }
    if (g.pointerId !== e.pointerId) return
    s.gesture = null

    if (g.kind === "draw") {
      const w = g.current.x - g.start.x
      const h = g.current.y - g.start.y
      const minWorld = MIN_DRAW_PX / s.camera.zoom
      // One transaction for the whole Element, so one undo removes it (FLOWS §2).
      if (g.tool === "sticky") {
        // A click (or the end of a drag) places a note centered there, ready to type in.
        const id = addSticky(
          doc,
          { center: g.current, color: useBoardUi.getState().stickyColor },
          origin,
        )
        useBoardUi.getState().select([id])
        useBoardUi.getState().setEditing({ id, continuing: true })
      } else if (g.tool === "text") {
        // A click places auto-width text with the click at the middle of its first line;
        // a drag sets a fixed width that wraps.
        const lineHeight = TEXT_SIZES.M * LINE_HEIGHT
        const dragged = Math.abs(w) >= minWorld
        const id = addText(
          doc,
          dragged
            ? {
                position: {
                  x: Math.min(g.start.x, g.current.x),
                  y: Math.min(g.start.y, g.current.y),
                },
                width: Math.abs(w),
                lineHeight,
              }
            : {
                position: { x: g.start.x, y: g.start.y - lineHeight / 2 },
                width: null,
                lineHeight,
              },
          origin,
        )
        useBoardUi.getState().select([id])
        useBoardUi.getState().setEditing({ id, continuing: true })
      } else if (g.tool === "arrow") {
        if (Math.hypot(w, h) >= minWorld) {
          const id = addArrow(doc, { from: g.start, to: g.current }, origin)
          useBoardUi.getState().select([id])
        }
      } else if (Math.abs(w) >= minWorld && Math.abs(h) >= minWorld) {
        const id = addShape(doc, { type: g.tool, position: g.start, size: { w, h } }, origin)
        useBoardUi.getState().select([id])
      }
      useBoardUi.getState().setTool("select")
    } else if (g.kind === "stroke") {
      // One write for the whole stroke; the pen stays active for the next one.
      addPen(
        doc,
        {
          points: g.points,
          ...useBoardUi.getState().pen,
          tolerance: PEN_TOLERANCE_PX / s.camera.zoom,
        },
        origin,
      )
    } else if (g.kind === "move") {
      if (g.moved) setGeometry(doc, draggedGeometry(g, s.index.byId), origin)
      else if (g.collapseTo) useBoardUi.getState().select(g.collapseTo)
    } else if (g.kind === "resize") {
      s.snap = null
      if (g.moved) setGeometry(doc, g.geometry, origin)
    } else if (g.kind === "connect") {
      s.snap = null
      const end = endAt(g.snap, g.current)
      const endPoint = g.snap?.point ?? g.current
      const length = Math.hypot(endPoint.x - g.start.point.x, endPoint.y - g.start.point.y)
      // A click without a drag draws nothing; the tool stays on for another try.
      if (length * s.camera.zoom >= MIN_DRAW_PX) {
        const { point: _, ...start } = g.start
        const ui = useBoardUi.getState()
        const id = addConnector(doc, { start, end, style: ui.connectorStyle }, origin)
        ui.select([id])
        ui.setTool("select")
      }
    }
    render()
  }

  function strokePoint(e: PointerEvent | React.PointerEvent, camera: Camera): StrokePoint {
    const world = screenToWorld(camera, local(e))
    // Only a stylus reports real pressure; mouse and touch get a constant middle value.
    return [world.x, world.y, e.pointerType === "pen" ? e.pressure : 0.5]
  }

  const cursor =
    tool === "text" && canEdit
      ? "text"
      : (isDragTool(tool) || tool === "pen" || tool === "connector") && canEdit
        ? "crosshair"
        : "default"

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canEdit) return
    const s = state.current
    const hit = hitAt(screenToWorld(s.camera, local(e)))
    const element = hit ? s.index.byId.get(hit) : undefined
    if (!element) return
    const { selection, select } = useBoardUi.getState()
    // In a group, the first double-click picks out the one member; the next one edits it.
    const grouped = expandToGroups([element.id], s.index.all()).size > 1
    if (grouped && !(selection.size === 1 && selection.has(element.id))) {
      select([element.id])
      return
    }
    if (element.type !== "text" && element.type !== "sticky") return
    select([element.id])
    useBoardUi.getState().setEditing({ id: element.id, continuing: false })
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Board canvas"
        className="absolute inset-0 size-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          state.current.pointer = null
          state.current.screenPointer = null
          state.current.presence?.cursor(null)
        }}
        onDoubleClick={onDoubleClick}
      />
      {editing && canEdit && (
        <TextEditor
          key={editing.id}
          ref={(node) => {
            editorRef.current = node
            placeEditor()
          }}
          doc={doc}
          id={editing.id}
          continuing={editing.continuing}
          origin={origin}
          undoManager={undoManager}
        />
      )}
      {/* Remote cursors: above the Board's content, below all chrome (rendered later). */}
      <div ref={cursorHost} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </>
  )
})
