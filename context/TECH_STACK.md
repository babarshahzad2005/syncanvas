# Syncanvas tech stack

The technologies, libraries, and structure behind `context/PRD.md` and `context/FLOWS.md`. Domain terms follow `GLOSSARY.md`. Decisions that are hard to reverse are recorded in `docs/adr/`.

**Versions:** use the latest stable release of each dependency when the project starts, and pin it in `pnpm-lock.yaml`. This document names libraries, not version numbers, so it doesn't go stale.

---

## 1. At a glance

```
                         ┌──────────────────────────── Cloudflare ─────────────────────────────┐
Browser                  │  Worker "syncanvas" (ADR 0004)                                      │
┌───────────────────┐    │  ┌───────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│ React SPA (Vite)  │───▶│  │ Static assets │  │ Hono API /api/*  │  │ BoardRoom DO /ws/*   │  │
│ Canvas2D renderer │    │  │ app + embed   │  │ Better Auth      │─▶│ (one per Board)      │  │
│ Yjs + y-indexeddb │◀══▶│  └───────────────┘  │ Drizzle          │  │ y-protocols, hibern. │  │
│ Embed viewer      │ WS │                     └──┬─────┬─────┬───┘  │ SQLite storage       │  │
└───────────────────┘    │  scheduled() crons ────┘     │     │      └──────────────────────┘  │
         │               └────────────────────────────── │ ─── │ ───────────────────────────────┘
                                     Workers KV  Hyperdrive│     │ Brevo API
                                     (images,              ▼     ▼
                                      thumbnails)   Neon Postgres  Brevo (email)
```

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | TypeScript (strict) everywhere | One language across client, API, board room, and shared model | — |
| Repo | pnpm workspaces monorepo | Share the Element model and renderer between client, board room, and exports | Turborepo (unneeded at this size), polyrepo |
| Hosting | One Cloudflare Worker with static assets on `*.workers.dev`, Free plan (ADR 0004, 0007) | One origin, one deploy unit, $0 | Cloudflare Pages + separate Workers, custom domain |
| Frontend | Vite + React SPA, TanStack Router, TanStack Query | No SSR needed: the app sits behind a login and the Board is a canvas | Next.js, React Router framework mode |
| UI chrome | Tailwind CSS v4 + shadcn/ui on Base UI, `nova` style, themed from `DESIGN.md` (ADR 0008) | Accessible primitives for the WCAG AA baseline; component source is in the repo; shadcn's current default | Radix base, MUI, Chakra |
| Local UI state | Zustand | Tool, viewport, panels, theme; small and works outside React | Redux, Jotai |
| Canvas | Own engine on Canvas2D (ADR 0005) | Control of data model, rendering, and exports | tldraw SDK, Excalidraw, WebGL |
| Motion | CSS transitions + `@starting-style`; `perfect-cursors` for remote cursors | Stays smooth while the page is busy; no animation library | Motion (Framer Motion) |
| Fonts | Geist Sans + Geist Mono via Fontsource (`@fontsource-variable/geist`, `-geist-mono`) | One font pair for the UI, the canvas, and exports | Inter, a handwritten font |
| CRDT | Yjs + y-protocols + y-indexeddb | Mature CRDT with offline persistence | Automerge, Loro |
| Realtime server | Hand-rolled `BoardRoom` Durable Object (ADR 0006) | Hooks for Role checks, caps, and persistence on every message | y-partyserver, Liveblocks |
| API | Hono on Workers, Zod validation | Small and fast; typed RPC client for the SPA | itty-router, tRPC |
| Auth | Better Auth (magic link + Google, Drizzle adapter) | Covers every flow in the PRD; runs on Workers | Hand-rolled, Auth.js, Clerk |
| Board tokens | `jose` JWT, EdDSA (Ed25519) | The board room verifies them without a database call | Opaque tokens checked against the database |
| Database | Neon Postgres via Hyperdrive (ADR 0003), Drizzle ORM + drizzle-kit | Full-text search, transactions; Neon branches per PR | D1, Supabase, Prisma |
| Object storage | Workers KV, uploads through the Worker (ADR 0007) | Free with no card, same-origin serving | R2 (needs a card), S3 |
| Email | Brevo + React Email (ADR 0007) | Free with no domain; templates live in the repo | Resend (needs a domain), Postmark, SES |
| Rate limiting | Workers Rate Limiting binding | Built in and keyed per User or IP | Custom counters in Postgres |
| Observability | Workers Logs; Sentry optional in M6 | Free and built in; one less account | Sentry from day one |
| Testing | Vitest, `@cloudflare/vitest-pool-workers`, fast-check, Playwright, custom load tool | Covers S1–S8 (§9) | Jest, Cypress, k6 |
| Lint/format | Biome | One fast tool | ESLint + Prettier |
| CI/CD | GitHub Actions + Wrangler | Preview Worker and Neon branch per PR | — |

---

## 2. Repository layout

```
syncanvas/
├── apps/
│   ├── web/                    # Vite: two entries → index.html (app), embed.html (Embed viewer)
│   │   ├── src/routes/         # TanStack Router: /, /b/$boardId, /settings, /trash, /auth/*
│   │   ├── src/board/          # Board screen: tools, input, selection, text editing, presence UI
│   │   ├── src/comments/       # Thread pins, panel, mention picker
│   │   ├── src/sync/           # Yjs doc, WebSocket provider, reconnect, IndexedDB, token refresh
│   │   └── src/embed/          # Lightweight viewer: renderer + read-only provider only
│   └── worker/                 # The single Worker (ADR 0004)
│       ├── src/index.ts        # fetch router: assets | /api/* → Hono | /ws/* → BoardRoom; scheduled()
│       ├── src/api/            # Hono routes, middleware, auth, Drizzle queries
│       ├── src/board-room/     # BoardRoom DO: sync, awareness, admission, persistence, compaction
│       ├── src/cron/           # digest, cleanup
│       ├── src/email/          # React Email templates
│       ├── drizzle/            # migrations
│       └── wrangler.jsonc
├── packages/
│   ├── board-model/            # Element types, Yjs read/write helpers, validation, caps (client + DO)
│   ├── renderer/               # Canvas2D + SVG drawing; shared by screen, PNG/SVG/PDF export, thumbnails
│   └── shared/                 # Roles & permission matrix, Zod API schemas, constants (limits, quotas)
├── tools/
│   └── loadtest/               # Node script: N headless Yjs clients, latency percentiles
├── e2e/                        # Playwright: multi-browser collaboration, visual diffs, perf traces
├── GLOSSARY.md
├── docs/adr/
└── context/                    # IDEA, PRD, FLOWS, TECH_STACK
```

`packages/board-model` is the one module both sides of the wire must agree on. The client uses it to write Elements, and the board room uses it to validate incoming updates. `packages/renderer` has no DOM dependency beyond a 2D context interface, so the same code draws the screen, PNG exports, and thumbnails.

---

## 3. Client (`apps/web`)

### App shell
- **Routing:** TanStack Router with typed routes and search params. Route loaders prefetch API data through TanStack Query.
- **Server data:** TanStack Query for the dashboard, Members, Threads, and Notifications. Real-time events from the board room (`comment-added`, `thread-resolved`, `notification`) update the query cache directly instead of refetching.
- **Hono RPC client** (`hc<AppType>`) gives end-to-end types from `apps/worker` routes, with no code generation.
- **UI:** shadcn/ui on Base UI, `nova` style, with only the components we use installed (Dialog, DropdownMenu, Popover, Tooltip, Command for the mention picker, Toast, …), Tailwind v4, and `lucide-react` icons (20px, 1.75 stroke). All tokens, type utilities, and component recipes come from `DESIGN.md`. A dev-only `/design` route shows every token and component in both themes.
- **Local UI state:** Zustand stores for the active tool, viewport (x, y, zoom), selection, panel visibility, and follow target.

### Canvas engine (ADR 0005)

| Piece | Implementation |
|---|---|
| Element model | `packages/board-model`: `Y.Map<elementId, Y.Map>` per Board. Position and size are each one plain value (ADR 0002). z-order uses a `fractional-indexing` key. Text is a plain string with whole-Element style properties |
| Renderer | `packages/renderer`: Canvas2D with devicePixelRatio scaling. Draws only Elements in the viewport (culling via `rbush`), with level-of-detail at low zoom (text becomes blocks, strokes are simplified). The scene redraws on `requestAnimationFrame` when something changes |
| Layers | Three stacked canvases: **scene** (Elements), **overlay** (selection, handles, in-progress drag preview), **presence** (remote cursors and selections). A cursor moving doesn't redraw the scene |
| Hit-testing | `rbush` query, then precise per-type geometry tests |
| Pen | `perfect-freehand` with `PointerEvent.pressure`; points are simplified before writing |
| Connectors | Store `{fromId, fromAnchor, toId, toAnchor, style: straight\|elbow}`; endpoints are computed at render time from the bound shapes |
| Text editing | A positioned `<textarea>` over the canvas while editing, written to Yjs on commit |
| Input | Pointer Events (mouse, pen, touch), pinch and two-finger pan on iPad, keyboard shortcuts through a single key map |
| Undo | `Y.UndoManager` with `trackedOrigins = {localOrigin}`. One transaction per gesture. Lives only for the current tab session |
| Clipboard | Async Clipboard API: custom `web application/x-syncanvas+json` type plus a PNG fallback |

### Sync (`src/sync`)
- **Local persistence:** `y-indexeddb`, one database per Board.
- **Provider:** a small custom WebSocket provider that speaks `y-protocols` sync and awareness, plus Syncanvas control messages.
  - Reconnects with exponential backoff and full jitter.
  - Refreshes the board token before it expires.
  - Exposes the states `online | connecting | offline | revoked` to the UI.
- **Revoked while offline:** the provider tells the UI, which offers a PNG/SVG export of the local doc, then deletes the IndexedDB database.

### Export
- **PNG:** the renderer draws to an `OffscreenCanvas`, capped at 8,192 px on the longest side.
- **SVG:** the renderer's SVG backend, with fonts embedded as base64 `@font-face`.
- **PDF:** `jspdf` + `svg2pdf.js`, which converts the SVG so the PDF stays vector and the fonts are registered with jsPDF.
- **Images in exports:** served by our own Worker from KV, on the same origin, so the canvas isn't tainted.
- **Fonts:** Geist Sans and Geist Mono, self-hosted, the same files on screen and in exports.
- **Theme:** Elements store Palette color names (ADR 0008). Exports resolve them with the light theme by default, or dark if the user chooses it.

### Embed viewer (`embed.html`)
A separate Vite entry that bundles only the renderer, a read-only provider, and pan/zoom. It has no React Query, comments, or dashboard code. If the board room returns `capped`, it falls back to the static image.

---

## 4. Board room (`apps/worker/src/board-room`)

One `BoardRoom` Durable Object per Board, keyed by `idFromName(boardId)`, using SQLite storage.

### Connections
- **WebSockets:** uses the hibernatable WebSocket API (`ctx.acceptWebSocket`), so idle Boards cost close to nothing.
- **Per-socket state:** `{userId | guestId, role, kind: member|guest|embed}` is kept with `serializeAttachment` and survives hibernation.
- **Admission:** the token is verified with `jose` and an Ed25519 public key. The cap of 100 connections is applied in priority order:
  - Members are always admitted.
  - Guests and Embed viewers are rejected with close code `4429 capped`, and the client switches to the static-image fallback.
- **Awareness:** in memory only. Clients re-send it every 15 s, which rebuilds it after hibernation (ADR 0006).

### Message handling
1. **Sync step 1/2 and updates:**
   - Updates from Viewer, Commenter, Guest, and Embed sockets are rejected.
   - Each update is applied to a scratch copy first and validated with `board-model`: the Element cap and the schema.
   - Only then is it applied to the live doc, appended to SQLite, and broadcast to the other sockets.
2. **Awareness:** relayed to everyone except Embed sockets, rate-limited per socket.
3. **Control messages** (JSON): `comment-added`, `thread-updated`, `role-changed`, `kicked`. They come from the API through DO RPC methods.

### Storage (DO SQLite)

| Table | Columns | Purpose |
|---|---|---|
| `updates` | `seq INTEGER PK, data BLOB, at INTEGER` | Append-only Yjs updates since the last compaction |
| `state` | `id=1, doc BLOB, seq INTEGER, at INTEGER` | Latest compacted doc |
| `versions` | `id, at, doc BLOB, kind: auto\|restore` | Version history (hourly for 30 days, then daily) |
| `thread_anchors` | `element_id PK` | Elements with Threads, so the board room reports their last position when they're deleted |

**Alarms** (`ctx.storage.setAlarm`) drive three jobs:
- **Compaction:** after 500 updates or 5 minutes of activity, merge the updates into `state`.
- **Version thinning:** apply the retention rules.
- **Text extraction:** send the Board's text to the API's internal search-index endpoint (within about 5 minutes of a change).

### RPC surface (called from the API in the same Worker)
`setRole(userId, role)`, `kick(userId | 'guests' | 'embeds')`, `closeAll()` (deletion), `broadcast(event)`, `listVersions()`, `previewVersion(id)`, `restoreVersion(id, userId)`.

**Static fallback image:** the server never renders, so while the Board is at its cap, the board room sends a `refresh-static` request to one connected Editor every 30 s. That client renders a PNG (≤ 1 MB, to fit a 2 MB SQLite row) and sends it back over its socket. The board room stores it in a `static_image` table in its own SQLite storage, not KV (ADR 0007), and serves it at `/ws/{boardId}/static.png`, which turned-away viewers poll.

---

## 5. API (`apps/worker/src/api`)

**Hono app with middleware:**
- request ID
- Better Auth session
- Zod validation (`@hono/zod-validator`)
- rate limiting (Workers Rate Limiting binding)
- Role checks using the permission matrix in `packages/shared`

| Route group | Endpoints (summary) |
|---|---|
| `/api/auth/*` | Better Auth: magic link, Google OAuth callback, session, sign-out. Accounts linked by verified email |
| `/api/me` | Profile, settings (digest toggle), delete account |
| `/api/dashboard` | One call: owned, shared, Folders, favorites, recent, Trash |
| `/api/boards` | Create (quota 50), rename, delete → Trash, restore, leave |
| `/api/boards/:id/token` | Issue a board token (5-minute EdDSA JWT: `sub`, `board`, `role`, `kind`) |
| `/api/boards/:id/members` | List, change Role, remove (Owner) |
| `/api/boards/:id/invitations` | Create (Owner, or Editor at their own Role or lower; rate-limited), resend, cancel |
| `/api/boards/:id/share-link` | Get, enable with Role and expiry, regenerate, disable (Owner) |
| `/api/share/:token` | Redeem a Share Link: Membership for a User, Guest token for an anonymous visitor |
| `/api/boards/:id/embed` | Enable, revoke (Owner). `/api/embed/:token` issues a viewer token |
| `/api/boards/:id/threads` | List, create, reply, edit, delete, resolve, reopen |
| `/api/notifications` | List, mark read, mark all read, unread count |
| `/api/folders`, `/api/favorites` | Personal organization |
| `/api/uploads` | Presigned PUT for an image or thumbnail (Editor + quota check) |
| `/api/search` | Full-text search over the user's Boards |
| `/api/internal/*` | Called only by BoardRoom (search text, Element deleted → Thread last position). Authenticated with a shared secret |
| `/api/unsubscribe/:token` | One-click unsubscribe (also served as an RFC 8058 `List-Unsubscribe-Post` target) |

**Board tokens:** the private key lives in a Worker secret and the public key in a variable. The API signs and the BoardRoom verifies. They're in the same Worker, but the code path stays separate, which keeps the option of splitting the deployment open.

---

## 6. Data (Neon Postgres via Hyperdrive)

**Driver:** `postgres.js` over the Hyperdrive connection string. **ORM:** Drizzle, with migrations from `drizzle-kit generate` applied in CI.

| Table | Key columns |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth schema (via its Drizzle adapter) |
| `user_settings` | `user_id`, `digest_enabled` |
| `boards` | `id`, `owner_id`, `title`, `thumbnail_key`, `created_at`, `updated_at`, `deleted_at` |
| `memberships` | `board_id`, `user_id`, `role`, `via: owner\|invitation\|share_link`, PK (`board_id`, `user_id`) |
| `invitations` | `id`, `board_id`, `email`, `role`, `invited_by`, `expires_at`, `accepted_at` |
| `share_links` | `board_id` (unique), `token_hash`, `role`, `expires_at` |
| `embeds` | `board_id` (unique), `token_hash`, `revoked_at` |
| `folders` | `id`, `user_id`, `name` |
| `board_placements` | `user_id`, `board_id`, `folder_id?`, `favorite`, `last_opened_at`, PK (`user_id`, `board_id`) |
| `threads` | `id`, `board_id`, `element_id?`, `x?`, `y?`, `last_x?`, `last_y?`, `status`, `created_by` |
| `comments` | `id`, `thread_id`, `author_id?` (null = "Deleted user"), `body`, `edited_at` |
| `thread_participants` | `thread_id`, `user_id` (posted or mentioned → gets reply Notifications) |
| `notifications` | `id`, `user_id`, `kind: mention\|reply`, `thread_id`, `read_at`, `emailed_at`, `created_at` |
| `images` | `key`, `user_id`, `board_id`, `bytes` (for the 50 MB quota) |
| `board_search` | `board_id`, `body`, `tsv tsvector` (GIN index); titles indexed via a generated `tsvector` on `boards` |

Share Link and Embed tokens are stored only as SHA-256 hashes. Search uses `websearch_to_tsquery` + `ts_rank` + `ts_headline` for snippets, joined to `memberships` so results only include the user's own Boards.

---

## 7. Storage, email, crons

**Workers KV** (namespace `ASSETS`, ADR 0007)
- Keys: `images/{boardId}/{uuid}`, `thumbs/{boardId}.webp`, `static/{boardId}.png` (the capped fallback image).
- Uploads: `POST /api/uploads` (Editor, type and size checked, quota 5 MB per image and 50 MB per User), then `KV.put`. Serving: `GET /api/assets/:key` with `Cache-Control: immutable`, so most reads come from the edge cache and not from KV.
- Free-tier limits: 1 GB storage, 1,000 writes per day. Thumbnails are written at most once per Board every 10 minutes. New keys can take about 60 s to appear in other regions, so the client retries missing images with a placeholder.

**Email:** Brevo transactional API (free: 300 per day, single verified sender), with React Email templates for: magic link, Invitation, digest. Every digest carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers.

**Crons** (`scheduled()` in the same Worker)

| Schedule | Job |
|---|---|
| `0 * * * *` | Digest: unread, unemailed Notifications for Users with the digest on → one email each → set `emailed_at` |
| `0 3 * * *` | Cleanup: hard-delete Boards in Trash for more than 30 days (`closeAll`, DO storage `deleteAll`, KV images and thumbnail), expire Invitations older than 30 days, delete Notifications older than 90 days |

---

## 8. Security

- **Sessions:** HTTP-only, `Secure`, `SameSite=Lax` cookies. Only one origin exists (ADR 0004), so there's no CORS for the API.
- **Server-side access control:** enforced in two places, API middleware and BoardRoom message handling. The UI hiding controls is never the only check.
- **Content Security Policy:**
  - The app (`index.html`): strict CSP with `frame-ancestors 'none'`.
  - The Embed viewer (`embed.html`): `frame-ancestors *`, but no cookies are sent and it uses only its own token.
- **Uploads:** the Worker checks content type (by magic bytes, not only the header) and size, and SVG is excluded.
- **Rate limits:** sign-in, invitation emails, uploads, Board creation, and per-socket awareness and update rate.
- **Secrets:** Wrangler secrets for Better Auth, Google OAuth, the Brevo API key, the Ed25519 private key, and the internal secret. Locally they live in `.dev.vars` (gitignored).

---

## 9. Testing and measurement

| Criterion | Tool | Where it runs |
|---|---|---|
| S1 Convergence, S2 No lost work | `fast-check` model-based fuzz: ≥5 in-memory Yjs clients, random ops, partitions, and offline periods; asserts identical state and no accepted edit lost | Vitest, every PR |
| Board room logic (Role rejection, caps, compaction, Versions) | `@cloudflare/vitest-pool-workers` against real workerd + DO SQLite | Every PR |
| S7 Access enforced on the server | The same pool: forged Viewer updates rejected; `setRole` and `kick` take effect within 1 s | Every PR |
| API routes | Vitest + workers pool + Neon branch | Every PR |
| End-to-end collaboration | Playwright with multiple browser contexts on one Board | PR preview |
| S8 Export fidelity | Playwright: render a fixed Board corpus, export, rasterize, compare with `pixelmatch` (threshold set per format) | PR preview |
| S5 60 fps, S6 open time | Playwright + Chrome DevTools Protocol tracing and network throttling (10 Mbps / 50 ms RTT) | Nightly on `main` |
| S3 Latency, S4 20 Editors | `tools/loadtest`: Node, `ws` + `yjs`, N clients, timestamps embedded in updates, p50/p95/p99 | Long runs locally against `wrangler dev`; short confirmation runs against production (free-tier daily limits); results go in the README |

---

## 10. Environments and CI/CD

| Environment | Worker | Database | KV |
|---|---|---|---|
| Local | `wrangler dev` (workerd, local DO + KV) | Neon dev branch via Hyperdrive local connection string | Local KV emulation |
| PR preview | `syncanvas-pr-{n}` | Neon branch per PR (created and deleted by CI) | Shared preview namespace, prefixed per PR |
| Production | `syncanvas` | Neon `main` | `ASSETS` |

**GitHub Actions:**
1. Install (pnpm cache).
2. Biome check, then `tsc -b`.
3. Unit tests, fuzz suite, workers-pool tests.
4. Create the Neon branch, then run `drizzle-kit migrate`.
5. `wrangler deploy` the preview.
6. Run Playwright against the preview.
7. On merge to `main`: migrate production, `wrangler deploy`.

**Tooling:**
- Node LTS, pnpm (pinned via `packageManager`).
- Biome for lint and format, TypeScript strict.
- Vite for the web build. Wrangler bundles the Worker with esbuild.

---

## Appendix: decisions behind this document

- ADR 0001: Boards owned by Users, not workspaces
- ADR 0002: position and size stored as one value each
- ADR 0003: Postgres via Hyperdrive, not D1
- ADR 0004: one Worker serves app, API, board rooms, and crons
- ADR 0005: our own canvas engine instead of tldraw or Excalidraw
- ADR 0006: hand-rolled board room sync on y-protocols
- ADR 0007: free tiers only: Workers KV for images, Brevo for email, workers.dev hosting
- ADR 0008: visual direction; Elements store Palette color names

Visual design: `DESIGN.md` at the repo root.
