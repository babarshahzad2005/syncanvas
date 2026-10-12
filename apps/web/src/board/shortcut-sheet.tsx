import { useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { keyName } from "@/lib/keys"
import { useBoardUi } from "./store"

// The "?" sheet (PRD A1 → Shortcuts): every keyboard shortcut on the Board, grouped by
// tools, selection, editing, and navigation. Keys are written once ("Mod" is ⌘ or Ctrl).

type Row = { label: string; keys: string[][] }

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Tools",
    rows: [
      { label: "Select", keys: [["V"]] },
      { label: "Pen", keys: [["P"]] },
      { label: "Rectangle", keys: [["R"]] },
      { label: "Ellipse", keys: [["O"]] },
      { label: "Arrow", keys: [["A"]] },
      { label: "Connector", keys: [["C"]] },
      { label: "Text", keys: [["T"]] },
      { label: "Sticky note", keys: [["S"]] },
    ],
  },
  {
    title: "Selection",
    rows: [
      { label: "Add or remove", keys: [["Shift", "Click"]] },
      { label: "Delete", keys: [["Delete"], ["Backspace"]] },
      { label: "Nudge", keys: [["←", "↑", "→", "↓"]] },
      { label: "Nudge further", keys: [["Shift", "←"]] },
      { label: "Group", keys: [["Mod", "G"]] },
      { label: "Ungroup", keys: [["Mod", "Shift", "G"]] },
      { label: "Lock or unlock", keys: [["Mod", "Shift", "L"]] },
      { label: "Bring forward", keys: [["Mod", "]"]] },
      { label: "Send backward", keys: [["Mod", "["]] },
      { label: "Deselect", keys: [["Esc"]] },
    ],
  },
  {
    title: "Editing",
    rows: [
      { label: "Undo", keys: [["Mod", "Z"]] },
      {
        label: "Redo",
        keys: [
          ["Mod", "Shift", "Z"],
          ["Mod", "Y"],
        ],
      },
      { label: "Copy", keys: [["Mod", "C"]] },
      { label: "Cut", keys: [["Mod", "X"]] },
      { label: "Paste", keys: [["Mod", "V"]] },
      { label: "Duplicate", keys: [["Mod", "D"]] },
      { label: "Edit text or sticky", keys: [["Enter"], ["Double-click"]] },
      { label: "Bold", keys: [["Mod", "B"]] },
      { label: "Finish editing", keys: [["Esc"]] },
    ],
  },
  {
    title: "Navigation",
    rows: [
      { label: "Pan", keys: [["Space", "Drag"], ["Scroll"]] },
      { label: "Zoom", keys: [["Mod", "Scroll"], ["Pinch"]] },
      { label: "Zoom to fit", keys: [["Shift", "1"]] },
      { label: "This list", keys: [["?"]] },
    ],
  },
]

export function ShortcutSheet() {
  // A read-only sheet: focus its content, not the close button (which would show a ring).
  const content = useRef<HTMLDivElement>(null)
  const open = useBoardUi((s) => s.shortcutsOpen)
  const setOpen = useBoardUi((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open !== false} onOpenChange={(next) => setOpen(next ? "pointer" : false)}>
      <DialogContent
        instant={open === "keyboard"}
        initialFocus={content}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          Every keyboard shortcut on the Board.
        </DialogDescription>
        <div
          ref={content}
          tabIndex={-1}
          className="grid gap-x-10 gap-y-6 outline-none sm:grid-cols-2"
        >
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="type-label mb-2 text-muted-foreground">{group.title}</h3>
              <dl className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4">
                    <dt className="type-body">{row.label}</dt>
                    <dd className="flex items-center gap-1.5">
                      {row.keys.map((combo, i) => (
                        <span key={combo.join("+")} className="flex items-center gap-1">
                          {i > 0 && <span className="type-caption text-muted-foreground">or</span>}
                          {combo.map((key) => (
                            <Kbd key={key}>{keyName(key)}</Kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
