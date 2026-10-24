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
- Options: `--url`, `--editors`, `--rate` (moves per second per Editor), `--seconds`, `--fill` (first add that many rectangles, to measure a big Board), and `--token-file` and `--board` for another server.
- **Restart the server between runs.** A run that falls behind leaves a backlog the room is still working through when the next one starts, which skews that one too.

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
  - Fixed in M6 ticket 08b (below).
- **S5, zoomed out.** Every Element is drawn in full detail, text included, even when it's a few pixels tall. Level-of-detail drawing follows in M6 ticket 08c.
- **S6.** These local runs overstate the server side: the local Worker reaches the Neon dev database across the internet for every API call, which the deployed Worker, next to its database through Hyperdrive, doesn't. The app also downloads its main bundle and checks the session before drawing even the local copy. The deployed site is measured next, and M6 ticket 08d follows if it still misses.

### After 08b: each edit checked by what it changes, 2026-10-24

The room keeps a shadow copy of the Board and validates only the Elements an update touches (`UpdateChecker` in `packages/board-model/src/acceptance.ts`).

**The check alone,** per move, including the room applying it:

| Board | Before | After |
|---|---|---|
| 20 Elements | 2.0 ms | 0.09 ms |
| 1,000 Elements | 18 ms | 0.06 ms |
| 5,000 Elements | 122 ms | 0.10 ms |

**`pnpm loadtest`, 20 Editors at 5 moves/s each (100 edits/s),** with a fresh server for each run, old and new code back to back:

| Board | Before 08b | After 08b |
|---|---|---|
| About 20 Elements | p95 132 ms, worst 0.3 s behind | p95 137 ms, worst 0.6 s behind |
| 1,000 Elements | p95 27 s, **worst 28 s behind** (two runs) | p95 135–149 ms, worst 0.3–0.5 s behind (two runs) |
| 5,000 Elements | (not run; worse than 1,000) | p95 151 ms, worst 0.3 s behind |

- **S4 now holds on big Boards at 100 edits/s.** Board size no longer matters.
- **At 200 and 400 edits/s it still falls behind on this laptop** (10 moves/s: 13 s behind; 20 moves/s: 25 s), on small Boards too, where the check was never the cost. These runs were slower than the baseline's (857 ms at 10 moves/s), with VS Code and Chrome using a lot of the same 2 cores. The room, the 20 test clients, and those apps all share the machine, so these numbers can't show what the room alone can do. The production run in 08d can: there the room has its own machine.
- **S3 with 20 Editors** was a p95 of 135–150 ms here (old and new alike): a miss, measured on the same busy laptop. With 3 Editors it's 42 ms.

### After 08c: zoomed-out drawing, 2026-10-24

`pnpm perf` S5 in a visible browser window (`--headed`, so the graphics chip is used). Headless runs gave the same numbers before these changes.

| | Before | After |
|---|---|---|
| Pan at 100% | 59.9 fps | 60.0 fps, no frame over 20 ms |
| Zoom around 100% | 54.6 fps | 49.8 fps (p95 frame 33.5 ms; unchanged by these changes, within noise) |
| Pan with all 5,000 on screen | **6.6 fps** | **47.8 fps**, p95 frame 33.5 ms |

What it took, measured one step at a time:

1. **Text as bars** below 4px on screen: no visible gain on its own (6.6 → 5.6 fps, noise). Text layout was already cached, so the letters themselves weren't the cost.
2. **Square corners below 1px.** Rounded rectangles turned out to be the main cost. On a bare canvas, 5,000 rounded boxes drew at 9.7 fps against 49 fps square. With this: 15.6 fps.
3. **The Board screen re-rendered on every frame.** A hook in `routes/board.tsx` subscribed to the frame counter, so React rebuilt the whole screen on every frame of every pan or zoom, at any zoom. With this: 16.9 fps (the production build's React is cheap; the dev server was hit far harder).
4. **Pen strokes under 48px as plain lines.** 500 stroke outlines alone drew at 38 fps on a bare canvas. With this: 47.8 fps.

Still short of 60 fps with all 5,000 visible on this laptop (Intel HD 620). What's left is mostly rasterizing several thousand shapes per frame.

