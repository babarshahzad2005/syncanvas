import { createApp, productionServices } from "./app"
import { runCleanup, runDigest } from "./digest"

export { BoardRoom } from "./board-room"

const app = createApp()

/** Must match `triggers.crons` in wrangler.jsonc. */
const DIGEST_CRON = "0 * * * *"
const CLEANUP_CRON = "0 3 * * *"

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

  // Cron triggers (wrangler.jsonc; FLOWS §5): the hourly digest and the daily cleanup.
  async scheduled(controller, env, ctx) {
    const services = productionServices(env)
    try {
      if (controller.cron === DIGEST_CRON) {
        await runDigest(services.db, services.sendDigest, {
          appUrl: env.BETTER_AUTH_URL,
          secret: env.BETTER_AUTH_SECRET,
        })
      } else if (controller.cron === CLEANUP_CRON) {
        await runCleanup(services.db)
      }
    } finally {
      if (services.dispose) ctx.waitUntil(services.dispose())
    }
  },
} satisfies ExportedHandler<Env>
