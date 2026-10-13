import { useCallback, useSyncExternalStore } from "react"
import { initials } from "@/components/account-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { BoardConnection } from "@/sync/board-connection"
import { type Collaborator, collaborators, isAway } from "./model"

// The presence pill (DESIGN.md → Layout → Board screen, top right): everyone else on the
// Board, each User once, up to four avatars then "+N". Hidden when you're alone.

const SHOWN = 4

type Person = Pick<Collaborator, "id" | "name" | "guest" | "color"> & { away: boolean }

/** The people on the Board but you, re-rendered only when that list itself changes. */
export function useCollaborators(connection: BoardConnection | null): Person[] {
  const subscribe = useCallback(
    (listener: () => void) => connection?.subscribePresence(listener) ?? (() => {}),
    [connection],
  )
  const snapshot = useSyncExternalStore(subscribe, () => {
    if (!connection?.you) return "[]"
    const people = collaborators(connection.presence, connection.you.id)
    return JSON.stringify(
      people.map((p) => ({
        id: p.id,
        name: p.name,
        guest: p.guest,
        color: p.color,
        away: isAway(p),
      })),
    )
  })
  return JSON.parse(snapshot) as Person[]
}

function Avatar({ person, className }: { person: Person; className?: string }) {
  return (
    <span
      className={cn(
        "type-label flex size-7 items-center justify-center rounded-full text-[11px] text-white ring-2 ring-surface",
        // Away: every tab of theirs is hidden or idle (DESIGN.md → Away).
        person.away && "opacity-45",
        className,
      )}
      style={{ background: person.color }}
    >
      {initials(person.name)}
    </span>
  )
}

export function PresencePill({ connection }: { connection: BoardConnection | null }) {
  const people = useCollaborators(connection)
  if (people.length === 0) return null
  const shown = people.slice(0, SHOWN)
  const more = people.length - shown.length

  return (
    <section
      aria-label="People on this board"
      className="fixed top-3 right-3 flex h-10 items-center rounded-full bg-surface pr-1.5 pl-1.5 shadow-panel"
    >
      <div className="flex -space-x-1">
        {shown.map((person) => (
          <Tooltip key={person.id}>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={person.away ? `${person.name} (away)` : person.name}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <Avatar person={person} />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {person.name}
              {person.away && <span className="text-background/70"> · Away</span>}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {more > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${more} more`}
                className="type-label ml-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            +{more}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>On this board</DropdownMenuLabel>
            </DropdownMenuGroup>
            {people.map((person) => (
              <DropdownMenuItem key={person.id}>
                <Avatar person={person} className="size-5 text-[9px] ring-0" />
                <span className="truncate">{person.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  )
}
