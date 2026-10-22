import { indexById, listElements } from "@syncanvas/board-model"
import type { Theme } from "@syncanvas/renderer"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type * as Y from "yjs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  download,
  type ExportFormat,
  type ExportScope,
  exportElements,
  exportFileName,
  exportPng,
} from "./export"
import { useBoardUi } from "./store"

// The export dialog (DESIGN.md → Export; M6 ticket 01): format, what, theme, then download.

/** Formats ready so far; the others show but wait for their tickets (M6 02–03). */
const READY: readonly ExportFormat[] = ["png"]

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean; hint?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="type-label mb-1.5 text-muted-foreground">{label}</legend>
      <div className="flex rounded-lg bg-muted p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={option.disabled}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              "type-label h-8 flex-1 rounded-md px-3 disabled:opacity-40 pointer-coarse:h-11",
              value === option.value
                ? "bg-surface text-foreground shadow-panel"
                : "text-muted-foreground enabled:hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function ExportDialog({
  open,
  onOpenChange,
  doc,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: Y.Doc
  title?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[400px]">
        {open && <ExportForm doc={doc} title={title} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ExportForm({ doc, title, onDone }: { doc: Y.Doc; title?: string; onDone: () => void }) {
  const selection = useBoardUi((s) => s.selection)
  const hasSelection = selection.size > 0
  const [format, setFormat] = useState<ExportFormat>("png")
  const [scope, setScope] = useState<ExportScope>(hasSelection ? "selection" : "board")
  const [theme, setTheme] = useState<Theme>("light")
  const [busy, setBusy] = useState(false)
  const empty = listElements(doc).length === 0

  const run = async () => {
    const all = listElements(doc)
    const elements = exportElements(all, selection, scope)
    if (elements.length === 0) return
    setBusy(true)
    try {
      const { blob, percent } = await exportPng(elements, indexById(all), theme)
      download(blob, exportFileName(title, format))
      if (percent < 100) toast(`Exported at ${percent}% so it fits 8,192 px.`)
      onDone()
    } catch {
      toast.error("Couldn't export the board", { description: "Try again in a moment." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void run()
      }}
    >
      <DialogTitle>Export</DialogTitle>
      <Segmented
        label="Format"
        value={format}
        onChange={setFormat}
        options={(["png", "svg", "pdf"] as const).map((f) => ({
          value: f,
          label: f.toUpperCase(),
          disabled: !READY.includes(f),
          hint: READY.includes(f) ? undefined : "Coming soon",
        }))}
      />
      <Segmented
        label="What"
        value={scope}
        onChange={setScope}
        options={[
          {
            value: "selection",
            label: "Selection",
            disabled: !hasSelection,
            hint: hasSelection ? undefined : "Select something first",
          },
          { value: "board", label: "Whole board" },
        ]}
      />
      <Segmented
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      {empty && <p className="type-caption text-muted-foreground">This board is empty.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || empty}>
          {busy && <Loader2 className="animate-spin" />} Export
        </Button>
      </div>
    </form>
  )
}
