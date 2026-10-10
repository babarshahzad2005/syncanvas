# What we're building

The idea behind Syncanvas, a real-time collaborative whiteboard.

- A Miro/Excalidraw-style shared canvas in the browser
- Teams sign in, organize their boards, and invite collaborators
- Multiple people draw, write, comment, and arrange ideas together, live

## Core feature 1: The canvas

- Infinite canvas with pan and zoom
- Tools: freehand pen, shapes (rectangle, ellipse, arrow), connectors, text, sticky notes, images
- Connectors stay attached to shapes when the shapes move
- Select, multi-select, group, align, resize, recolor, lock, and layer elements
- Undo/redo that only undoes *your* actions, not other people's

## Core feature 2: Real-time collaboration

- Every change syncs to everyone on the board within milliseconds
- Live cursors with each person's name and color
- Presence list showing who's on the board right now
- "Follow" mode: click a collaborator to jump to and follow their viewport
- Share links with roles: owner, editor, commenter, or view-only

## Core feature 3: Comments and mentions

- Pin comment threads to any element or spot on the board
- Comments move with the element they're attached to
- @mention collaborators to pull them into a thread
- Resolve and reopen threads; filter by open/resolved
- In-app notifications and an email digest for mentions and replies

## Core feature 4: Accounts and dashboard

- Sign up / sign in with email or Google
- Dashboard listing your boards and boards shared with you, with thumbnails
- Folders, favorites, and recently opened boards
- Full-text search across board titles and the text inside boards
- Starter templates: retro, brainstorm, flowchart, user journey, kanban

## Core feature 5: Export and embed

- Export a whole board or a selection to PNG, SVG, or PDF
- Exports match the canvas exactly
- Embed a read-only, live-updating board on any website with an iframe snippet
- Public link toggle with optional expiry

## Conflicts have to resolve themselves

- Two people will edit the same thing at the same time; that's the normal case, not an edge case
- Board state is stored as a CRDT (e.g. Yjs), so concurrent edits merge without a central lock
- Same element moved by two people → everyone converges on the same result, no flicker or lost work
- Network drops → user keeps drawing offline; changes merge when they reconnect
- Permissions are enforced on the server, not just hidden in the UI: a viewer's client can't push edits
- Why it matters: if sync ever breaks, people lose trust in the board and stop using it

## Persistence and history

- Boards save automatically; no "save" button
- Board updates are persisted incrementally, with periodic snapshots so large boards load fast
- Version history: browse, preview, and restore earlier states of a board
- Images stored in object storage (e.g. S3 or R2), not inside the board document

## Performance targets

- Board with 5,000 elements pans and zooms at 60 fps
- 20 simultaneous editors on one board without noticeable lag
- Board opens in under 2 seconds on a normal connection
- Load-test results and the approach behind them written up in the README

## What we're NOT building (v1)

- AI features (prompt-to-diagram, clustering, summaries)
- Video/voice calls and chat
- Third-party integrations (Slack, Jira, Figma, etc.)
- Mobile apps (the web app should still be usable on a tablet)
- Billing, pricing plans, and organization-level admin
- Templates marketplace (built-in templates only)

## End result

A working product: sign in, create a board from a template, invite teammates, and draw together in real time, with comments and mentions, clean merging of concurrent and offline edits, exports that look exactly like the board, and a live embed on a real website.
