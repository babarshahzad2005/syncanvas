import {
  addArrow,
  addPen,
  addShape,
  addText,
  deleteElements,
  type ElementWithId,
  elementsOf,
  hasBox,
  listElements,
  moveElement,
  type PaletteColor,
  type PenWidth,
  type Point,
  type StrokePoint,
  setTextStyle,
  textOf,
} from "@syncanvas/board-model"
import {
  boundsOf,
  type Camera,
  clearTextLayoutCache,
  drawScene,
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
      kind: "move"
      pointerId: number
      id: string
      grab: Point
      position: Point
      moved: boolean
      lastSent: number
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

/** What the gesture in progress is drawing, for the renderer to show before it's written. */
function previewOf(
  g: Gesture | null,
  pen: { color: PaletteColor; width: PenWidth },
): Scene["preview"] {
  if (g?.kind === "stroke") return { type: "pen", points: g.points, ...pen }
  if (g?.kind !== "draw") return null
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
    elements: [] as ElementWithId[],
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
    const element = s.elements.find((el) => el.id === id)
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
      drawScene(ctx, {
        elements: s.elements,
        camera: s.camera,
        theme: s.theme,
        size: s.size,
        dpr: s.dpr,
        selection: ui.selection,
        dragging: g?.kind === "move" ? new Map([[g.id, g.position]]) : undefined,
        preview: previewOf(g, ui.pen),
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
    fit: () => setCamera(fitCamera(boundsOf(state.current.elements), state.current.size)),
  }))

  // Re-render when the theme or the selection changes.
  useEffect(() => {
    render()
    return useBoardUi.subscribe(render)
  })

  // Keep the Element list in sync with the document (local and remote changes alike).
  useEffect(() => {
    const elements = elementsOf(doc)
    const refresh = () => {
      state.current.elements = listElements(doc)
      // Drop selected Elements that someone else deleted.
      const { selection, select } = useBoardUi.getState()
      const alive = [...selection].filter((id) => elements.has(id))
      if (alive.length !== selection.size) select(alive)
      render()
    }
    refresh()
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
        // Bold for selected texts, toggled together from the first one's state.
        const texts = state.current.elements.filter(
          (el) => ui().selection.has(el.id) && el.type === "text",
        )
        const first = texts[0]
        if (!canEdit || first?.type !== "text") return
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
      // Typing while one text is selected starts editing it (Enter just opens the editor).
      const selected = ui().selection.size === 1 ? [...ui().selection][0] : undefined
      const element = state.current.elements.find((el) => el.id === selected)
      if (canEdit && element?.type === "text" && (e.key === "Enter" || e.key.length === 1)) {
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
        setCamera(fitCamera(boundsOf(state.current.elements), state.current.size))
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

    const hit = hitTest(s.elements, world, s.camera.zoom)
    if (!hit) {
      ui.select([])
      // On touch, dragging empty canvas pans (there's no Space key).
      if (e.pointerType === "touch") {
        s.gesture = { kind: "pan", pointerId: e.pointerId, start: point, camera: s.camera }
      }
      return
    }
    ui.select([hit])
    if (!canEdit) return
    const element = s.elements.find((el) => el.id === hit)
    if (!element || !hasBox(element)) return // connectors follow their ends; moving them comes later
    undoManager.stopCapturing()
    s.gesture = {
      kind: "move",
      pointerId: e.pointerId,
      id: hit,
      grab: { x: world.x - element.position.x, y: world.y - element.position.y },
      position: element.position,
      moved: false,
      lastSent: 0,
    }
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
      g.position = { x: world.x - g.grab.x, y: world.y - g.grab.y }
      g.moved = true
      const now = performance.now()
      if (now - g.lastSent >= MOVE_SEND_INTERVAL_MS) {
        g.lastSent = now
        moveElement(doc, g.id, g.position, origin)
      }
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
      if (g.tool === "text") {
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
    } else if (g.kind === "move" && g.moved) {
      moveElement(doc, g.id, g.position, origin)
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
    const hit = hitTest(s.elements, screenToWorld(s.camera, local(e)), s.camera.zoom)
    const element = s.elements.find((el) => el.id === hit)
    if (element?.type !== "text") return
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
