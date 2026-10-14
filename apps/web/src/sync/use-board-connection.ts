import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import * as Y from "yjs"
import { BoardConnection, type ConnectionStatus } from "./board-connection"
import { openLocalCopy } from "./local-copy"

/**
 * One live connection per mounted Board screen, plus its local copy in IndexedDB. Created
 * inside the effect, so React's development double-mount and switching Boards each get a
 * fresh doc, socket, and local copy.
 */
export function useBoardConnection(boardId: string) {
  const [connection, setConnection] = useState<BoardConnection | null>(null)
  // Bumped to start over with a fresh doc after the board room refused this copy's edits.
  const [generation, setGeneration] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new generation starts over
  useEffect(() => {
    const doc = new Y.Doc()
    // Start loading the local copy and connecting at the same time; whichever arrives first
    // renders first, and Yjs merges the two.
    const local = openLocalCopy(boardId, doc)
    const c = new BoardConnection(boardId, doc)
    const unsubscribe = c.subscribe(() => {
      // Access is gone: the local copy must not outlive it (FLOWS §2 "Go offline and reconnect").
      if (c.status === "revoked") void local?.clearData()
      // Downgraded with edits the board room refused (M3 ticket 02): they can never be
      // saved, so drop the local copy and load the Board again as it is on the server.
      if (c.status === "resync") {
        unsubscribe()
        toast("Some of your changes weren't saved", {
          description: "You can only view this board now.",
        })
        void local?.clearData().then(() => setGeneration((g) => g + 1))
      }
    })
    c.start()
    setConnection(c)
    return () => {
      unsubscribe()
      c.stop()
      void local?.destroy()
      doc.destroy()
    }
  }, [boardId, generation])

  const subscribe = useCallback(
    (listener: () => void) => connection?.subscribe(listener) ?? (() => {}),
    [connection],
  )
  const status: ConnectionStatus = useSyncExternalStore(
    subscribe,
    () => connection?.status ?? "connecting",
  )
  // The Role can change while connected (M3 ticket 02), so it's read as a snapshot too.
  const role = useSyncExternalStore(subscribe, () => connection?.role ?? null)
  return {
    connection,
    doc: connection?.doc ?? null,
    status,
    board: connection?.board ?? null,
    role,
  }
}
