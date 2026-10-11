import {
  addArrow,
  addPen,
  addShape,
  addSticky,
  addText,
  deleteElements,
  type ElementWithId,
  elementsOf,
  hasBox,
  listElements,
  moveElements,
  type PaletteColor,
  type PenWidth,
  type Point,
  readElement,
  type StrokePoint,
  setTextStyle,
  textOf,
} from "@syncanvas/board-model"
import {
  boundsOf,
  type Camera,
  clearTextLayoutCache,
  drawScene,
  ElementIndex,
  fitCamera,
  hitTest,
  LINE_HEIGHT,
  type Scene,
  screenToWorld,
  TEXT_SIZES,
  worldToScreen,
  zoomAt,
} from "@syncanvas/renderer"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react"
import type * as Y from "yjs"
import { useResolvedTheme } from "@/lib/theme"
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
      origins: Map<string, Point>
      offset: Point
      moved: boolean
      lastSent: number
      /** Pressed on a member of a multi-selection: a click without a drag selects just it. */
      collapseTo: string | null
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
}

declare global {
  interface Window {
    __SYNCANVAS_TEST__?: boolean
    __syncanvas?: { elements: () => ElementWithId[]; camera: () => Camera }
  }
}

/** Where each dragged Element is right now, during a move. */
function draggedPositions(g: Extract<Gesture, { kind: "move" }>): Map<string, Point> {
  const positions = new Map<string, Point>()
  for (const [id, p] of g.origins) positions.set(id, { x: p.x + g.offset.x, y: p.y + g.offset.y })
  return positions
}

/** What the gesture in progress is drawing, for the renderer to show before it's written. */
function previewOf(
  g: Gesture | null,
  pen: { color: PaletteColor; width: PenWidth },
): Scene["preview"] {
  if (g?.kind === "stroke") return { type: "pen", points: g.points, ...pen }
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
  { doc, origin, undoManager, canEdit },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
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
      const dragging = g?.kind === "move" ? draggedPositions(g) : undefined
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
        dragging?.keys(),
      )
      drawScene(ctx, {
        elements: visible,
        byId: s.index.byId,
        camera: s.camera,
        theme: s.theme,
        size: s.size,
        dpr: s.dpr,
        selection: ui.selection,
        dragging,
        preview: previewOf(g, ui.pen),
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
    })
  }, [placeEditor])

  const setCamera = (camera: Camera) => {
    state.current.camera = camera
    useBoardUi.getState().setZoom(camera.zoom)
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
        moveElements(
          doc,
          selectedElements().flatMap((el) =>
            hasBox(el)
              ? [
                  [
                    el.id,
                    { x: el.position.x + arrow.x * step, y: el.position.y + arrow.y * step },
                  ] as const,
                ]
              : [],
          ),
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
            deleteElements(doc, ui().selection, origin)
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

    const hit = hitAt(world)
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
    if (e.shiftKey) {
      // Shift+click toggles membership and starts nothing else.
      const next = new Set(ui.selection)
      if (next.has(hit)) next.delete(hit)
      else next.add(hit)
      ui.select(next)
      return
    }
    // Pressing a member of the selection keeps the selection, so it can be dragged together.
    const keep = ui.selection.has(hit)
    if (!keep) ui.select([hit])
    if (!canEdit) return
    const origins = new Map<string, Point>()
    for (const id of useBoardUi.getState().selection) {
      const element = s.index.byId.get(id)
      // Connectors follow their ends; moving them comes with ticket 12.
      if (element && hasBox(element)) origins.set(id, element.position)
    }
    if (origins.size === 0) return
    undoManager.stopCapturing()
    s.gesture = {
      kind: "move",
      pointerId: e.pointerId,
      start: world,
      origins,
      offset: { x: 0, y: 0 },
      moved: false,
      lastSent: 0,
      collapseTo: keep && ui.selection.size > 1 ? hit : null,
    }
  }

  /** The topmost Element at a world point, looking only at Elements near it. */
  function hitAt(world: Point): string | null {
    const { index, camera } = state.current
    const reach = 16 / camera.zoom
    const nearby = index.query({
      x: world.x - reach,
      y: world.y - reach,
      w: reach * 2,
      h: reach * 2,
    })
    return hitTest(nearby, world, camera.zoom, index.byId)
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
    const g = s.gesture
    if (!g) return

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
        moveElements(doc, draggedPositions(g), origin)
      }
      render()
    } else if (g.kind === "marquee") {
      g.current = screenToWorld(s.camera, point)
      const inside = s.index.inside({
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
      if (g.moved) moveElements(doc, draggedPositions(g), origin)
      else if (g.collapseTo) useBoardUi.getState().select([g.collapseTo])
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
      : (isDragTool(tool) || tool === "pen") && canEdit
        ? "crosshair"
        : "default"

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canEdit) return
    const s = state.current
    const hit = hitAt(screenToWorld(s.camera, local(e)))
    const element = hit ? s.index.byId.get(hit) : undefined
    if (element?.type !== "text" && element?.type !== "sticky") return
    useBoardUi.getState().select([element.id])
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
    </>
  )
})
