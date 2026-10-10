import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
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

  useEffect(() => {
    const doc = new Y.Doc()
    // Start loading the local copy and connecting at the same time; whichever arrives first
    // renders first, and Yjs merges the two.
    const local = openLocalCopy(boardId, doc)
    const c = new BoardConnection(boardId, doc)
    const unsubscribe = c.subscribe(() => {
      // Access is gone: the local copy must not outlive it (FLOWS §2 "Go offline and reconnect").
      if (c.status === "revoked") void local?.clearData()
    })
    c.start()
    setConnection(c)
    return () => {
      unsubscribe()
      c.stop()
      void local?.destroy()
      doc.destroy()
    }
  }, [boardId])

  const subscribe = useCallback(
    (listener: () => void) => connection?.subscribe(listener) ?? (() => {}),
    [connection],
  )
  const status: ConnectionStatus = useSyncExternalStore(
    subscribe,
    () => connection?.status ?? "connecting",
  )
  return {
    doc: connection?.doc ?? null,
    status,
    board: connection?.board ?? null,
    role: connection?.role ?? null,
  }
}
