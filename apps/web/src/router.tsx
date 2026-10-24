import { isTemplateId, type TemplateId } from "@syncanvas/board-model"
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"
import { authClient, safeRedirect } from "@/lib/auth-client"
import { rememberSignedIn, seemsSignedIn } from "@/lib/signed-in-hint"
import { BoardScreen } from "@/routes/board"
import { Dashboard, FolderPage } from "@/routes/dashboard"
import { RootLayout } from "@/routes/root"
import { SignIn } from "@/routes/sign-in"
import { TrashPage } from "@/routes/trash"
import { requestTokenEarly } from "@/sync/early-token"

const rootRoute = createRootRoute({ component: RootLayout })

/** Everything under this layout needs a signed-in User; others are sent to sign-in and back. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ location }) => {
    const boardPath = /^\/b\/([^/]+)$/.exec(location.pathname)
    // A Share Link opens without signing in, as a Guest (M3 ticket 04).
    const shareLink =
      boardPath !== null && typeof (location.search as { s?: unknown }).s === "string"
    const check = authClient.getSession().then(({ data, error }) => {
      // An error (offline, say) says nothing about the session either way.
      if (!error) rememberSignedIn(data !== null)
      return { data, known: !error }
    })
    // Opening a Board (M6 ticket 08d): its token is requested alongside the session check, and
    // a device that was signed in last time shows the Board (from its local copy) without
    // waiting for the check; if the session turns out to be gone, it's off to sign-in.
    const boardId = boardPath?.[1] && !shareLink ? decodeURIComponent(boardPath[1]) : null
    if (boardId) {
      requestTokenEarly(boardId)
      if (seemsSignedIn()) {
        void check.then(({ data, known }) => {
          if (known && !data)
            void router.navigate({ to: "/sign-in", search: { redirect: location.href } })
        })
        return { signedIn: true }
      }
    }
    const { data } = await check
    if (!data && !shareLink) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } })
    }
    return { signedIn: data !== null }
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: Dashboard,
})

/** A Folder's page: the dashboard's Board grid, filtered to that Folder (M5a ticket 02). */
const folderRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/folders/$folderId",
  component: FolderPage,
})

/** The Owner's Trash (M5a ticket 03). */
const trashRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/trash",
  component: TrashPage,
})

const boardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/b/$boardId",
  // ?s= carries a Share Link token (M3 ticket 03); ?thread= opens a Thread's card (M4 ticket 03);
  // ?template= fills a new Board once it's connected (M5a ticket 04).
  validateSearch: (
    search: Record<string, unknown>,
  ): { s?: string; thread?: string; template?: TemplateId } => ({
    s: typeof search.s === "string" ? search.s : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
    template: isTemplateId(search.template) ? search.template : undefined,
  }),
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
    rememberSignedIn(data !== null)
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
    authedRoute.addChildren([dashboardRoute, folderRoute, trashRoute, boardRoute]),
    signInRoute,
    ...devOnlyRoutes,
  ]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
