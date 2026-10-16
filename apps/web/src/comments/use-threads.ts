import type { ThreadView } from "@syncanvas/shared"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"
import { api, queryKeys } from "@/lib/api"
import type { BoardConnection } from "@/sync/board-connection"

/** Adds or replaces a Thread in a list, keeping it in creation order. */
export function upsertThread(list: readonly ThreadView[], thread: ThreadView): ThreadView[] {
  const rest = list.filter((t) => t.id !== thread.id)
  return [...rest, thread].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * A Board's Threads (M4): loaded once it's connected, then kept current by the board room's
 * comment events, which update the cache directly instead of refetching (TECH_STACK §3).
 * Guests read with the board token they connected with.
 */
export function useThreads(boardId: string, connection: BoardConnection | null, online: boolean) {
  const queryClient = useQueryClient()
  const key = useMemo(() => queryKeys.threads(boardId), [boardId])
  const guest = connection?.guestLink != null
  const threads = useQuery({
    queryKey: key,
    queryFn: async () => {
      const token = connection?.token
      const res =
        guest && token ? await api.guestThreads(boardId, token) : await api.threads(boardId)
      return res.threads
    },
    enabled: online && connection !== null,
    // Comment events keep it current; Guest tokens expire, so they never refetch on focus.
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(
    () =>
      connection?.subscribeControl((message) => {
        queryClient.setQueryData<ThreadView[]>(key, (old) =>
          upsertThread(old ?? [], message.thread),
        )
      }),
    [connection, queryClient, key],
  )

  // Back online after a gap: catch up on anything missed while away.
  useEffect(() => {
    if (online) void queryClient.invalidateQueries({ queryKey: key })
  }, [online, queryClient, key])

  return threads.data ?? []
}
