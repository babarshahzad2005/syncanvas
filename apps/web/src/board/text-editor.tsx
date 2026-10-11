import {
  applyTextChange,
  deleteElements,
  elementsOf,
  type PaletteColor,
  readElement,
  setSize,
  setTextStyle,
  TEXT_LIMIT,
  type TextAlign,
  type TextSize,
  textOf,
  transformIndex,
} from "@syncanvas/board-model"
import { LINE_HEIGHT, layoutText, paletteShades, TEXT_SIZES, textFont } from "@syncanvas/renderer"
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

// Typing on the canvas (spec: Text editing). A textarea sits exactly over the text Element,
// in world units scaled by the zoom (BoardCanvas sets its transform every frame), with the
// same font and line breaking as the renderer. It's bound to the Element's Y.Text: local
// input becomes the smallest delete + insert, and remote changes are applied with the caret
// kept in place, so two people typing in one text both keep their words (ADR 0009).

/** Typing pauses longer than this start a new undo step. */
const UNDO_BURST_MS = 500

type Style = {
  color: PaletteColor
  fontSize: TextSize
  bold: boolean
  align: TextAlign
  autoWidth: boolean
  width: number
}

function readStyle(fields: Y.Map<unknown> | undefined): string {
  const element = fields ? readElement(fields) : null
  if (element?.type !== "text") return "null"
  return JSON.stringify({
    color: element.color,
    fontSize: element.fontSize,
    bold: element.bold,
    align: element.align,
    autoWidth: element.autoWidth,
    width: element.size.w,
  } satisfies Style)
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
  const style = JSON.parse(styleJson) as Style | null
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
      // brings back an empty box); otherwise record the measured box.
      if (elements.has(id)) {
        const fields = elements.get(id)
        if (known.trim() === "") deleteElements(doc, [id], origin)
        else if (fields) {
          const s = JSON.parse(readStyle(fields)) as Style
          const layout = layoutText(known, {
            fontSize: TEXT_SIZES[s.fontSize],
            bold: s.bold,
            width: s.autoWidth ? null : s.width,
          })
          setSize(doc, id, { w: s.autoWidth ? layout.width : s.width, h: layout.height }, origin)
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

  // The textarea is always sized to its content, so it never needs to scroll; undo any
  // scrolling the browser did while the caret briefly ran past the old size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every size change
  useLayoutEffect(() => {
    const area = textarea.current
    if (area) {
      area.scrollLeft = 0
      area.scrollTop = 0
    }
  }, [value, styleJson])

  if (!style) return null
  const fontSize = TEXT_SIZES[style.fontSize]
  const layout = layoutText(value, {
    fontSize,
    bold: style.bold,
    width: style.autoWidth ? null : style.width,
  })

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
        font: textFont(fontSize, style.bold),
        lineHeight: `${fontSize * LINE_HEIGHT}px`,
        color: paletteShades(style.color, theme).stroke,
        textAlign: style.align,
        whiteSpace: style.autoWidth ? "pre" : "pre-wrap",
        overflowWrap: "break-word",
        // A little room for the caret at the end of the widest line.
        width: style.autoWidth ? layout.width + 2 : style.width,
        height: layout.height,
      }}
    />
  )
})
