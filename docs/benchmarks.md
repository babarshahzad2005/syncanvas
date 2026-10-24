# Benchmarks

How Syncanvas measures its performance and load targets (PRD success metrics S3–S6), and what it measured. Export fidelity (S8) is an automated test (`e2e/export-fidelity.spec.ts`), so it isn't covered here.

## Targets

| | Target |
|---|---|
| **S3** Edit latency | p95 under 100 ms from pointer-up until the edit shows on another client (same region) |
| **S4** Concurrency | 20 Editors on one Board at once: S3 holds, and no client falls more than 1 s behind |
| **S5** Rendering | Pan and zoom a 5,000-Element Board at a sustained 60 fps on a mid-range laptop |
| **S6** Open time | Cold: a 1,000-Element Board is editable in under 2 s on 10 Mbps down / 50 ms round trip (desktop Chrome). Warm: a Board cached locally is visible in under 300 ms |

## How it's measured

**Machine (all local runs):** Windows 11, Intel Core i5-7300U (2 cores, 4 threads, 2017), Microsoft Edge (Chromium), Node 24.

**Server under test:** the production build served locally, not `pnpm dev`. The dev server proxies every WebSocket message through Vite and runs unoptimized code, which made its latency about 10× worse. The setup:

```sh
pnpm build
cd apps/web
# The local Hyperdrive string points at the Neon dev branch (apps/web/.env).
pnpm exec wrangler dev -c dist/syncanvas/wrangler.json --port 8787 --local
```

**S3/S4: `pnpm loadtest`** (`tools/loadtest/run.mjs`)

- N headless Editors join one Board over the real board-room protocol (y-protocols sync over a WebSocket).
- Each moves its own rectangle about 20 times a second, the rate a drag sends at, stamping the send time into the position.
- Every other client records the time from send to receipt. All clients run on one machine, so one clock times both ends.
- Locally it signs its own board tokens with the dev key.
- Options: `--url`, `--editors`, `--rate` (moves per second per Editor), `--seconds`, and `--token-file` and `--board` for another server.

**S5/S6: `pnpm perf`** (`tools/perf/board.perf.ts`; never in CI)

- **Board:** a Board is filled through the real paste path with a mix of rectangles, sticky notes with text, text, and pen strokes.
- **S5:** times every frame (requestAnimationFrame) while wheel input pans or zooms, at 100% and with the whole Board fitted on screen.
- **S6:** opens the Board in a new browser context throttled over the Chrome DevTools Protocol, with the cache off (cold), then again with the cache and the Board's local copy (warm).
- **Servers:** it needs `pnpm dev` on :5173 (sign-in through the dev inbox) and the build on :8787.

## Results

### Baseline, 2026-10-24 (before any tuning)

| | Result | |
|---|---|---|
| S3, 3 Editors at 20 moves/s, small Board | p50 14 ms, **p95 35 ms**, p99 52 ms | Meets |
| S4, 20 Editors at 5 moves/s (100 edits/s in all) | p95 116 ms, worst client 161 ms behind | Close |
| S4, 20 Editors at 10 moves/s (200/s) | p95 525 ms, worst client 857 ms behind | Misses S3 |
| S4, 20 Editors at 20 moves/s (400/s) | p95 26.6 s, worst client 29.2 s behind | **Misses** |
| S5, pan at 100% | 59.9 fps, p95 frame 16.8 ms | Meets |
| S5, zoom around 100% | 54.6 fps, p95 frame 33.3 ms | Close |
| S5, pan with all 5,000 on screen | **6.6 fps**, p95 frame 200 ms | **Misses** |
| S6, cold open | **4.8 s** to editable | **Misses** (see note) |
| S6, warm open | **2.3 s** to visible, 4.4 s to online | **Misses** |

**Why:**

- **S4.** The board room was the bottleneck: one CPU core saturated, while the test clients used about 60% of another.
  - Every incoming edit is checked by copying the whole Board into a scratch document and validating every Element (`checkUpdate` in `packages/board-model/src/acceptance.ts`).
  - Measured alone, that check costs 1.2 ms per edit on a 20-Element Board, 18 ms on 1,000 Elements, and 115 ms on 5,000. Its cost grows with the Board, not the edit.
  - Fixed in M6 ticket 08b.
- **S5, zoomed out.** Every Element is drawn in full detail, text included, even when it's a few pixels tall. Level-of-detail drawing follows in M6 ticket 08c.
- **S6.** These local runs overstate the server side: the local Worker reaches the Neon dev database across the internet for every API call, which the deployed Worker, next to its database through Hyperdrive, doesn't. The app also downloads its main bundle and checks the session before drawing even the local copy. The deployed site is measured next, and M6 ticket 08d follows if it still misses.
