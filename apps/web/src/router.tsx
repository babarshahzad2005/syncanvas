import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { BoardScreen } from "@/routes/board"
import { Dashboard } from "@/routes/dashboard"
import { RootLayout } from "@/routes/root"

const rootRoute = createRootRoute({ component: RootLayout })

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
})

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/b/$boardId",
  component: BoardScreen,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([dashboardRoute, boardRoute]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
