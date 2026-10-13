import { useBoardUi } from "@/board/store"
import { Button } from "@/components/ui/button"
import type { BoardConnection } from "@/sync/board-connection"
import { useCollaborators } from "./presence-pill"

// While following someone (DESIGN.md → Canvas → Follow mode): a 2px frame in their presence
// color around the Board, and a "Following Ada · Stop" chip at the top center. Presentational
// only: nothing here is part of the Board or its exports.

export function FollowFrame({ connection }: { connection: BoardConnection | null }) {
  const following = useBoardUi((s) => s.following)
  const setFollowing = useBoardUi((s) => s.setFollowing)
  const leader = useCollaborators(connection).find((person) => person.id === following)
  if (!leader) return null
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 border-2"
        style={{ borderColor: leader.color }}
      />
      <div
        role="status"
        className="fixed top-3 left-1/2 flex h-10 -translate-x-1/2 items-center gap-2 rounded-full pr-1.5 pl-4 text-white shadow-panel"
        style={{ background: leader.color }}
      >
        <span className="type-body-strong">Following {leader.name}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-full text-white hover:bg-white/15 hover:text-white"
          onClick={() => setFollowing(null)}
        >
          Stop
        </Button>
      </div>
    </>
  )
}
