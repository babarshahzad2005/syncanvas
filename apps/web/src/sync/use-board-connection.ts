import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import * as Y from "yjs"
import { BoardConnection, type ConnectionStatus } from "./board-connection"

/**
 * One live connection per mounted Board screen. Created inside the effect, so React's
 * development double-mount and switching Boards each get a fresh doc and socket.
 */
export function useBoardConnection(boardId: string) {
  const [connection, setConnection] = useState<BoardConnection | null>(null)

  useEffect(() => {
    const c = new BoardConnection(boardId, new Y.Doc())
    c.start()
    setConnection(c)
    return () => {
      c.stop()
      c.doc.destroy()
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
