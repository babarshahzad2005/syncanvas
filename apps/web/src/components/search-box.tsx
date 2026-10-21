import { SEARCH_MIN_LENGTH, type SearchResult, snippetParts } from "@syncanvas/shared"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Kbd } from "@/components/ui/kbd"
import { api, queryKeys } from "@/lib/api"
import { cn } from "@/lib/utils"

// The dashboard's search (DESIGN.md → Search; M5b ticket 05): a dropdown under the header's
// box, updated as you type. Arrow keys move, Enter opens, Escape closes, `/` focuses it.

/** Typing settles for this long before a search goes out. */
const DEBOUNCE_MS = 150

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** A snippet with its matched words in bold: built from text, never HTML from the server. */
function Snippet({ snippet }: { snippet: string }) {
  return (
    <span className="type-caption truncate text-muted-foreground">
      {snippetParts(snippet).map((part, i) =>
        part.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are fixed for this snippet
          <strong key={i} className="font-semibold text-foreground">
            {part.text}
          </strong>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are fixed for this snippet
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
}

export function SearchBox({ className, slashFocus }: { className?: string; slashFocus: boolean }) {
  const navigate = useNavigate()
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const query = useDebounced(text.trim(), DEBOUNCE_MS)
  const searching = query.length >= SEARCH_MIN_LENGTH
  const { data, isFetching } = useQuery({
    queryKey: queryKeys.search(query),
    queryFn: () => api.search(query),
    enabled: searching,
    // The last results stay up while the next ones load, so the list doesn't flicker.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
  const results: SearchResult[] = searching ? (data?.results ?? []) : []
  const shown = open && searching && (data !== undefined || !isFetching)

  // A new list starts at its first row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the results change
  useEffect(() => setActive(0), [data])

  // `/` focuses the box from anywhere on the page, unless you're typing somewhere.
  useEffect(() => {
    if (!slashFocus) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable], [role='dialog']")) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [slashFocus])

  const openBoard = (result: SearchResult) => {
    setOpen(false)
    void navigate({ to: "/b/$boardId", params: { boardId: result.id } })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open && text) setOpen(false)
      else input.current?.blur()
      return
    }
    if (!shown || results.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const result = results[active]
      if (result) openBoard(result)
    }
  }

  const optionId = (i: number) => `${listId}-${i}`
  return (
    <div className={cn("relative", className)}>
      <label className="flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-surface px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
        <Search className="size-4 shrink-0" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search boards"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && results.length > 0 ? optionId(active) : undefined}
          placeholder="Search boards and their text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          // Later than a click on a result, which navigates first.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {slashFocus && !text && <Kbd className="hidden md:inline-flex">/</Kbd>}
      </label>
      {shown && (
        <div
          id={listId}
          role="listbox"
          aria-label="Matching boards"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-popover"
        >
          {results.length === 0 ? (
            <p className="type-body px-3 py-2.5 text-muted-foreground">
              No boards match “{query}”.
            </p>
          ) : (
            results.map((result, i) => (
              <div
                key={result.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onPointerDown={(e) => e.preventDefault()} // keep the focus in the box
                onPointerEnter={() => setActive(i)}
                onClick={() => openBoard(result)}
                onKeyDown={() => {}}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                <span className="type-body-strong truncate">{result.title}</span>
                {result.snippet && <Snippet snippet={result.snippet} />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
