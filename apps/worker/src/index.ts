import { createApp } from "./app"

export { BoardRoom } from "./board-room"

const app = createApp()

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith("/api/")) return app.fetch(request, env, ctx)
    // /ws/{boardId}?token=… → that Board's room. The room checks the token itself.
    const room = pathname.match(/^\/ws\/([^/]+)$/)
    if (room?.[1]) {
      const id = env.BOARD_ROOM.idFromName(decodeURIComponent(room[1]))
      return env.BOARD_ROOM.get(id).fetch(request)
    }
    // Everything else is served from static assets before the Worker runs.
    return new Response("Not found", { status: 404 })
  },
} satisfies ExportedHandler<Env>
