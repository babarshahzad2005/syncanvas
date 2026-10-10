import { createApp } from "./app"

const app = createApp()

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith("/api/")) return app.fetch(request, env, ctx)
    // Board rooms arrive in M0 ticket 07.
    if (pathname.startsWith("/ws/")) return new Response("Not implemented", { status: 501 })
    // Everything else is served from static assets before the Worker runs.
    return new Response("Not found", { status: 404 })
  },
} satisfies ExportedHandler<Env>
