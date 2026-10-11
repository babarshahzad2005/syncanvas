import {
  applyTextChange,
  deleteElements,
  elementsOf,
  readElement,
  type StickyElement,
  setSize,
  setTextStyle,
  TEXT_LIMIT,
  type TextElement,
  textOf,
  transformIndex,
} from "@syncanvas/board-model"
import {
  paletteShades,
  STICKY_PADDING,
  STICKY_TEXT_COLOR,
  stickyLayoutOf,
  TEXT_SIZES,
  type Theme,
  textFont,
  textLayoutOf,
} from "@syncanvas/renderer"
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type * as Y from "yjs"
import { useResolvedTheme } from "@/lib/theme"
import { useBoardUi } from "./store"

// Typing on the canvas (spec: Text editing). A textarea sits exactly over the text or sticky,
// in world units scaled by the zoom (BoardCanvas sets its transform every frame), with the
// same font and line breaking as the renderer. It's bound to the Element's Y.Text: local
// input becomes the smallest delete + insert, and remote changes are applied with the caret
// kept in place, so two people typing in one text both keep their words (ADR 0009).

/** Typing pauses longer than this start a new undo step. */
const UNDO_BURST_MS = 500

type Editable = TextElement | StickyElement

/** Everything about the Element except its text, as JSON (cheap for React to compare). */
function readStyle(fields: Y.Map<unknown> | undefined): string {
  const element = fields ? readElement(fields) : null
  if (element?.type !== "text" && element?.type !== "sticky") return "null"
  return JSON.stringify({ ...element, text: "" } satisfies Editable)
}

/**
 * How the textarea looks for an Element with this content: the same font, line height,
 * and box the renderer uses. A sticky's textarea covers the whole note, padding included.
 */
function frameOf(e: Editable, theme: Theme) {
  if (e.type === "sticky") {
    const { layout, fontSize, height, clipped } = stickyLayoutOf(e)
    return {
      box: { w: e.size.w, h: height },
      css: {
        font: textFont(fontSize, e.bold),
        lineHeight: `${layout.lineHeight}px`,
        color: STICKY_TEXT_COLOR,
        textAlign: "left",
        whiteSpace: "pre-wrap",
        padding: STICKY_PADDING,
      } as const,
      clipped,
    }
  }
  const layout = textLayoutOf(e)
  return {
    // Auto width gets a little room for the caret at the end of the widest line.
    box: { w: e.autoWidth ? layout.width + 2 : e.size.w, h: layout.height },
    css: {
      font: textFont(TEXT_SIZES[e.fontSize], e.bold),
      lineHeight: `${layout.lineHeight}px`,
      color: paletteShades(e.color, theme).stroke,
      textAlign: e.align,
      whiteSpace: e.autoWidth ? "pre" : "pre-wrap",
      padding: 0,
    } as const,
    clipped: false,
  }
}

type Props = {
  doc: Y.Doc
  id: string
  /**
   * The edit that opened the editor (creating the text, or the first typed key) and the
   * first words typed are one undo step.
   */
  continuing: boolean
  origin: object
  undoManager: Y.UndoManager
}

export const TextEditor = forwardRef<HTMLTextAreaElement, Props>(function TextEditor(
  { doc, id, continuing, origin, undoManager },
  ref,
) {
  const theme = useResolvedTheme()
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  // Ends the session (blur or Escape). Not an effect cleanup: React's development
  // double-mount would run that immediately and delete a brand-new empty text.
  const finish = useRef<() => void>(() => {})
  const styleJson = useSyncExternalStore(
    (onChange) => {
      const elements = elementsOf(doc)
      elements.observeDeep(onChange)
      return () => elements.unobserveDeep(onChange)
    },
    () => readStyle(elementsOf(doc).get(id)),
  )
  const style = JSON.parse(styleJson) as Editable | null
  // The textarea's content, mirrored for sizing it (the Y.Text is the source of truth).
  const [value, setValue] = useState(() => textOf(doc, id)?.toString() ?? "")

  // Bind to the Y.Text for the whole editing session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one session per mounted editor
  useEffect(() => {
    const text = textOf(doc, id)
    const area = textarea.current
    if (!text || !area) {
      useBoardUi.getState().setEditing(null)
      return
    }
    let known = text.toString()
    let lastInput = continuing ? performance.now() : 0
    area.value = known
    area.focus({ preventScroll: true })
    area.setSelectionRange(known.length, known.length)
    if (!continuing) undoManager.stopCapturing() // the session starts a new undo step

    const onInput = () => {
      const now = performance.now()
      if (now - lastInput > UNDO_BURST_MS) undoManager.stopCapturing()
      lastInput = now
      applyTextChange(text, known, area.value, origin)
      known = area.value
      setValue(known)
    }
    // Remote typing (and undo/redo) arrives as a delta: move the caret along with it.
    const onRemote = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === origin) return
      const start = transformIndex(area.selectionStart, event.delta)
      const end = transformIndex(area.selectionEnd, event.delta)
      known = text.toString()
      area.value = known
      area.setSelectionRange(start, end)
      setValue(known)
    }
    // Someone else deleted the text while it was being edited.
    const elements = elementsOf(doc)
    const onElements = () => {
      if (!elements.has(id)) useBoardUi.getState().setEditing(null)
    }

    let done = false
    finish.current = () => {
      if (done) return
      done = true
      // An empty text is removed in the same undo step as the last edit (so undo never
      // brings back an empty box); otherwise record the measured box. An empty sticky stays:
      // a blank note is still a note.
      const fields = elements.get(id)
      const element = fields ? (JSON.parse(readStyle(fields)) as Editable | null) : null
      if (element?.type === "text" && known.trim() === "") deleteElements(doc, [id], origin)
      else if (element) {
        const measured = { ...element, text: known }
        if (measured.type === "sticky") {
          setSize(doc, id, { w: measured.size.w, h: stickyLayoutOf(measured).height }, origin)
        } else {
          const layout = textLayoutOf(measured)
          const w = measured.autoWidth ? layout.width : measured.size.w
          setSize(doc, id, { w, h: layout.height }, origin)
        }
      }
      undoManager.stopCapturing()
      useBoardUi.getState().setEditing(null)
    }

    area.addEventListener("input", onInput)
    text.observe(onRemote)
    elements.observe(onElements)
    return () => {
      area.removeEventListener("input", onInput)
      text.unobserve(onRemote)
      elements.unobserve(onElements)
    }
  }, [doc, id])

  const frame = style ? frameOf({ ...style, text: value }, theme) : null

  // The textarea is sized to its content, so it never needs to scroll; undo any scrolling
  // the browser did while the caret briefly ran past the old size. (A full sticky whose
  // text is cut off does scroll, so the caret stays visible.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every size change
  useLayoutEffect(() => {
    const area = textarea.current
    if (area) {
      area.scrollLeft = 0
      if (!frame?.clipped) area.scrollTop = 0
    }
  }, [value, styleJson])

  if (!style || !frame) return null

  return (
    <textarea
      ref={(node) => {
        textarea.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      aria-label="Text"
      spellCheck={false}
      maxLength={TEXT_LIMIT}
      onBlur={() => finish.current()}
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey
        if (e.key === "Escape") {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (mod && e.key.toLowerCase() === "z") {
          // The Board's undo, not the textarea's own: it covers this tab's whole history.
          e.preventDefault()
          if (e.shiftKey) undoManager.redo()
          else undoManager.undo()
        } else if (mod && e.key.toLowerCase() === "y") {
          e.preventDefault()
          undoManager.redo()
        } else if (mod && e.key.toLowerCase() === "b") {
          e.preventDefault()
          setTextStyle(doc, id, { bold: !style.bold }, origin)
        }
      }}
      className="absolute top-0 left-0 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        transformOrigin: "0 0",
        ...frame.css,
        overflowWrap: "break-word",
        width: frame.box.w,
        height: frame.box.h,
      }}
    />
  )
})
