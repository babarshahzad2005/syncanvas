# Syncanvas

A real-time collaborative whiteboard. Sign in, create a Board, and draw on it together. Edits sync live, keep working offline, and merge cleanly, and the server enforces who may edit.

**Live:** https://syncanvas.babarshahzad2005.workers.dev

It runs on Cloudflare Workers with Durable Objects (one live room per Board), plus Yjs, Neon Postgres via Hyperdrive, Better Auth, React, and Canvas2D. The product, design, and decisions are in [`context/PRD.md`](context/PRD.md), [`DESIGN.md`](DESIGN.md), and [`docs/adr/`](docs/adr/).

## Run it locally

You need Node 24 and pnpm 12. Set up the accounts as described in [`context/SETUP.md`](context/SETUP.md).

```sh
pnpm install
cp apps/web/.env.example apps/web/.env              # paste your Neon *dev* branch string
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @syncanvas/worker gen:secret          # local sign-in secret (never printed)
pnpm --filter @syncanvas/worker gen:keys            # local board-token keys (never printed)
pnpm --filter @syncanvas/worker db:migrate          # create the tables on the dev branch
pnpm dev                                            # http://localhost:5173
```

Sign in with any email address. Locally, the magic link is printed in the terminal running `pnpm dev`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app, the Worker, and the Board rooms on one local server (port 5173) |
| `pnpm check` | Runs Biome, the typecheck, and all unit and integration tests, including the Board-room tests in workerd |
| `pnpm e2e` | Runs the Playwright browser tests against `pnpm dev` (locally it uses the installed Microsoft Edge) |
| `pnpm --filter @syncanvas/worker db:generate` | Creates a migration from schema changes |
| `pnpm --filter @syncanvas/worker db:migrate` | Applies migrations to the dev branch locally, or to `DATABASE_URL` |
| `pnpm release` | Builds and deploys to Cloudflare by hand (CI normally does this) |

## How changes ship

- **Pull request:** CI runs `pnpm check`, then creates a throwaway Neon branch and runs the browser tests against it. The branch is deleted when the PR closes.
- **Merge to `main`:** CI runs the checks, applies migrations to the production database, and deploys to the live URL.

## Repository layout

```
apps/web        React app (Vite, TanStack Router/Query, shadcn on Base UI)
apps/worker     Cloudflare Worker: Hono API, Better Auth, BoardRoom Durable Object
packages/       board-model (Yjs document + validation), renderer (Canvas2D), shared types
e2e/            Playwright tests
context/        PRD, flows, tech stack, setup guide
```
