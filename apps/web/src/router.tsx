import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"
import { authClient, safeRedirect } from "@/lib/auth-client"
import { BoardScreen } from "@/routes/board"
import { Dashboard } from "@/routes/dashboard"
import { RootLayout } from "@/routes/root"
import { SignIn } from "@/routes/sign-in"

const rootRoute = createRootRoute({ component: RootLayout })

/** Everything under this layout needs a signed-in User; others are sent to sign-in and back. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: "/sign-in", search: { redirect: location.href } })
    return { session: data }
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: Dashboard,
})

const boardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/b/$boardId",
  component: BoardScreen,
})

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { data } = await authClient.getSession()
    if (data) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: SignIn,
})

/**
 * The DESIGN.md reference page, development builds only. The route (and its dynamic import) is
 * created inside the DEV branch so production builds drop the page's code entirely.
 */
const devOnlyRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/design",
        component: lazyRouteComponent(() => import("@/design/page"), "DesignSystemPage"),
      }),
    ]
  : []

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    authedRoute.addChildren([dashboardRoute, boardRoute]),
    signInRoute,
    ...devOnlyRoutes,
  ]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
