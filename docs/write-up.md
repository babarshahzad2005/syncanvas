# Building Syncanvas: a whiteboard you can trust to stay in sync

Syncanvas is a real-time collaborative whiteboard I built on Cloudflare's free tier. This is the story of the parts that were hard: keeping everyone's Board identical, letting the server say no inside a system designed to always merge, and making it fast on modest hardware without paying for anything.

## The one thing that has to work

A shared whiteboard has a single job underneath all its features: when several people edit at once, everyone must end up looking at the same Board, and nobody's work may quietly vanish. If that breaks once, people stop trusting the Board and go back to taking turns. So before writing features I wrote down measurable targets (convergence, no lost work, latency, 20 concurrent editors, rendering speed, open time, server-side access control, export fidelity) and built the tests for them alongside the features.

## A CRDT, shaped for drawing

The Board is a [Yjs](https://yjs.dev) document: a map of Elements, each a small map of fields. CRDTs merge concurrent edits without a central lock, but how you shape the data decides what "merge" means. With `x` and `y` as separate fields, two people dragging the same sticky note at once could leave it at one person's `x` and the other's `y`, a position neither of them chose. So position and size are each stored as one atomic value: the last drag wins as a whole. Text, on the other hand, is a Yjs text type, so two people typing in the same note both keep their words. Undo is scoped to your own changes, so it never reverts a colleague's work.

## Proving it converges

Example-based tests can't find the interleavings that break sync, so the core proof is a randomized suite built with fast-check. Seven simulated clients (five editors and two viewers) issue every kind of operation through the real Board API, while a simulated network delays, reorders, and drops their messages and takes clients offline and back. A simulated server applies the real acceptance rules. After every message is delivered, all clients must hold the same Board, and every accepted edit must still be there. One hundred sessions of 400 to 500 operations run on every check, and a failure prints a seed and a shrunk sequence that replays it exactly.

## Letting the server say no

A CRDT wants to accept everything; a product needs a Viewer to stay a Viewer. Each Board has one **board room**, a Cloudflare Durable Object that holds the live document, relays edits over WebSockets, and stores them in its own SQLite database. Clients connect with a short-lived token signed by the API (user, Board, Role), and the room checks every incoming update: may this sender edit, and would this update leave the Board valid? A refused update is never stored or forwarded, so invalid content can't reach anyone else. When an owner changes someone's Role, the API tells the room, which applies it to their open connections at once. These rules are tested against the real Workers runtime, not mocks.

The first version of that check copied the whole Board and validated every Element on each edit. It was simple and obviously correct, and it fell over under load: 115 ms per edit on a 5,000-Element Board, and in a load test with 20 editors on a 1,000-Element Board, clients ended up 28 seconds behind. The fix keeps a shadow copy of the document in step with the room and validates only the Elements each update actually touched (Yjs reports which types changed in a transaction). The check now costs about 0.1 ms at any Board size, and the same load test stays under half a second behind. Because a mistake here would be a security bug, the new checker is also tested against the old one on a random mix of valid and invalid edits, and they must agree on every verdict.

## Offline first, without surprises

Every Board a signed-in member opens is saved in IndexedDB, so it opens instantly from the device, keeps working offline, and merges on reconnect. The awkward case is losing access while offline with unsaved work: the server will refuse those edits, so before the copy is deleted the app offers to download the work as a picture or SVG. Nothing disappears silently.

## Rendering 5,000 Elements on a 2017 laptop

I wrote the canvas engine myself on Canvas2D with a spatial index, so only what's on screen is drawn. Panning at normal zoom held 60 fps, but with all 5,000 Elements on screen it dropped to 6.6 fps. My first guess was text, so I drew tiny text as soft bars. It made no difference.

Measuring instead of guessing found three real causes:

1. **Rounded rectangles.** On this GPU they drew five times slower than square ones. At that zoom the corners are half a pixel, so they're now drawn square below one pixel.
2. **The whole screen re-rendered on every frame.** A React hook subscribed to a per-frame counter, so every pan rebuilt the toolbar, the menus, and everything else. It now subscribes to "has the canvas drawn yet", which changes once.
3. **Detailed pen strokes.** Strokes smaller than 48 px on screen are now drawn as a simple line through their points, and full outlines are cached per Element.

The result is 48 fps with all 5,000 on screen, from 6.6. It isn't 60 on this machine, and the README says so. Exports and thumbnails always draw full detail; only the screen simplifies.

## Opening a Board fast

Opening a Board waited on three slow requests, one after another: the session check, then the Board's token, then a second session check. Nothing rendered until the first finished, not even a Board already saved on the device. Now the device remembers that it was signed in, so a saved Board draws immediately while the session is confirmed in the background (a definite "signed out" still goes to the sign-in page), and the token is requested alongside the session check instead of after it. Reopening a Board went from 2.2 s to 0.4 s under the target's throttled network. Cold opens improved from 4.5 s to 3.5 s but still miss the 2-second target; the remaining time is server work and syncing 1,000 Elements over a slow link.

## Living inside free tiers

Running on free plans shaped real design decisions:

- **Thumbnails** are written to KV, which allows 1,000 writes a day, so each Board's picture is written at most once every 10 minutes. A picture that comes too soon now waits in the tab and goes once allowed, so a quick second edit still ends up on the dashboard.
- **The "last edited" time** is written by the board room during its housekeeping run about five minutes after an edit, not on every edit, so an active Board costs one database write every five minutes.
- **Durable Objects** have a daily allowance of rows read. I learned that the hard way: a load test against the live site used up the whole day's allowance, and every Board showed as offline until it reset. The cause was the room counting its stored edits on every update (up to 500 rows read per edit) just to decide when to compact. It now keeps that count in memory, so an edit reads nothing. Load tests now run only against a local build.

## Testing at three levels

- **Unit and property tests** (Vitest, fast-check) for the Board model, the renderer, and the convergence suite.
- **Integration tests** for the API against an in-process Postgres (PGlite), and for the board room inside the real Workers runtime.
- **Browser tests** (Playwright) for what needs real browsers and real sync: two people drawing together, offline edits merging, access revoked mid-session, exports matching the screen to within 0.02% of pixels, an Embed framed by another site.

Every success target has a test or a measurement behind it, recorded in [`benchmarks.md`](benchmarks.md), including the ones that fall short.

## What I'd do next

- Bring cold opens under 2 seconds, starting with what the token route does on the server.
- Run the 20-editor load test from machines in the same region as the server; from my location, every edit crosses about 160 ms of network twice, so live latency numbers mostly measure my connection.
- Reach 60 fps with everything on screen, likely by caching zoomed-out regions as bitmaps.
