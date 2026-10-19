# Syncanvas v1: Product Requirements

**Status:** Agreed after review · **Date:** 2026-10-10 · **Sources:** `context/IDEA.md`, `context/FLOWS.md`, `context/syncanvas_system_architecture.png` · **Vocabulary:** [`GLOSSARY.md`](../GLOSSARY.md) · **Decisions:** [`docs/adr/`](../docs/adr/)

---

## 1. Summary

Syncanvas is a browser-based whiteboard where a small team can sketch, write, and comment on one shared Board at the same time. Every change appears for everyone within milliseconds. v1 is a **portfolio project**, built solo. Its job is to show, with tests and a public write-up, that a team can do a whole working session on one Board without losing work and without anyone wondering whether the Board is in sync.

## 2. Problem

> **When several people edit the same visual workspace at once, their edits collide, drop, or arrive late. They stop trusting that what they see is what everyone else sees, and they go back to taking turns or screen-sharing.**

Concurrent editing is the normal case here, not an edge case. The product works only if sync stays correct while people edit the same Element at the same moment, while the network drops, and while access changes mid-session. If sync breaks once, people stop trusting the Board, and nothing else in the product makes up for that.

**Problems v1 is not solving:** meeting facilitation, AI help with ideas, getting content in and out of other tools, and team or org administration. See Non-goals.

## 3. Who it's for

**Primary:** small product and engineering teams (2–20 people) who run live working sessions such as retros, brainstorms, flowcharts, and journey maps in a desktop browser or on an iPad.

**Secondary:**
- Stakeholders who join through a Share Link to view or comment.
- Readers of a web page where a Board is embedded live.
- Reviewers of the portfolio write-up.

**Not for v1:** organizations that need admin controls, SSO, or billing; phone users (they get a read-only view).

## 4. Success criteria

v1 ships when every launch criterion passes. The results are published in the README and in the portfolio write-up.

| # | Criterion | Target | How we verify |
|---|---|---|---|
| S1 | **Convergence**: all clients end up with identical Board state after concurrent and offline edits | 100% across a randomized concurrency/offline fuzz suite (≥10k ops, ≥5 simulated clients) | Automated test in CI |
| S2 | **No lost work**: an edit the client accepted is never silently lost | 0 lost edits in fuzz and reconnect tests. The only exception is revoked-while-offline, and the user is offered an export first | Automated test in CI |
| S3 | **Edit latency**: time from pointer-up until the edit shows on another client | p95 < 100 ms in the same region | Load test |
| S4 | **Concurrency**: 20 simultaneous Editors on one Board | S3 holds; no client falls behind by more than 1 s | Load test, written up in README |
| S5 | **Render performance**: pan and zoom a 5,000-Element Board | Sustained 60 fps on a mid-range laptop (desktop only) | Perf benchmark |
| S6 | **Open time** | **Cold:** a 1,000-Element Board is editable in < 2 s on 10 Mbps down with 50 ms round-trip latency, in desktop Chrome. **Warm:** a Board cached locally is visible in < 300 ms | Lab measurement |
| S7 | **Access enforced on the server** | A Viewer or Commenter client that sends a doc update is rejected 100% of the time. A removed or downgraded Member loses write access within 1 s, without a refresh | Automated security test |
| S8 | **Export fidelity** | PNG, SVG, and PDF exports match the on-screen Elements in a visual diff across a fixed Board corpus | Visual regression test |

**Optional after launch:** share of Boards with ≥2 concurrent Editors in their first week, and the 7-day reopen rate. They are useful for the write-up but don't block shipping.

## 5. Non-goals (v1)

- AI features (prompt-to-diagram, clustering, summaries)
- Video, voice, or chat
- Third-party integrations (Slack, Jira, Figma, …)
- Native mobile apps. Phones get a read-only view; iPad must be usable
- Billing, pricing plans, org admin, SSO, **workspaces or teams as entities** ([ADR 0001](../docs/adr/0001-boards-owned-by-users-not-workspaces.md))
- A template marketplace (v1 ships only built-in templates), and **Duplicate Board**
- Board ownership transfer
- Rich text: mixed formatting, links, and lists inside a text Element
- Connectors that route around obstacles; shape recognition for pen strokes
- Screen-reader access to canvas Elements
- SVG image uploads
- Server-side rendering of Boards (thumbnails and exports are rendered on the client)

## 6. Solution direction

Full requirements and acceptance criteria are in [Appendix A](#appendix-a-requirements-and-acceptance-criteria).

1. **Live Board.** An infinite canvas with pan and zoom, rendered with Canvas2D. Tools: pen, shapes, arrows, connectors, plain text, sticky notes, and images. Arrange tools: select, group, align, layer, Lock. Includes copy and paste, and undo that only reverts your own actions.
2. **Sync that resolves itself.** Board state is a CRDT (Yjs). An Element's position and size are each stored as one value ([ADR 0002](../docs/adr/0002-atomic-geometry-in-the-crdt.md)). The Board renders from a local copy right away, keeps working offline, and merges on reconnect.
3. **Presence.** Live named cursors (Guests appear as "Guest N"), a presence list, and follow mode.
4. **Sharing with real access control.** Roles are Owner, Editor, Commenter, and Viewer, granted through Invitations or the Share Link. The server checks the Role on every update and applies access changes to live connections immediately.
5. **Comments.** Threads pinned to an Element or to a point on the Board. Includes Mentions, reply notifications, resolve and reopen, an in-app notification list, and an hourly email digest with unsubscribe.
6. **Dashboard.** Sign-in with Google or an email link. Owned and shared Boards, private Folders, favorites, recent Boards, Trash, full-text search, and five starter templates.
7. **History.** Autosave, Versions with read-only preview, and restore applied as a new, reversible edit.
8. **Export and Embed.** Export Elements to PNG, SVG, or PDF. An Embed is a live, read-only view of a Board on another website, revoked separately from the Share Link.

### Architecture at a glance

```
Browser client (React, Canvas2D renderer, Yjs, IndexedDB)
One Worker (ADR 0004)
   ├── Static assets ...... the React app and the Embed viewer
   ├── API ................ Hono: REST, auth, comments, sharing
   │      ├── Postgres .... via Hyperdrive: Users, Boards, Memberships, Threads, Notifications, search (ADR 0003)
   │      └── Workers KV .. images, thumbnails (uploaded through the Worker; ADR 0007)
   └── Board room ......... one Durable Object per Board: live Yjs doc, WebSocket fan-out, Role checks, caps
          └── SQLite ...... incremental updates, compacted state, Versions
Cron worker ............... hourly email digest (Brevo); daily cleanup (Trash, expired Invitations, old Notifications)
```

The **board room** is the source of truth for Board content. **Postgres** is the source of truth for identity, access, and comments. The two meet in a **board token**: the API signs a short-lived token (User, Board, Role), and the board room verifies it. When access changes, the API calls the board room to downgrade or disconnect the affected sockets.

### Limits and quotas

| Limit | Value | Behavior at the limit |
|---|---|---|
| Elements per Board | 20,000 | The client blocks new Elements with a clear message, and the board room enforces the same cap |
| Live connections per Board | 100 | Members are always admitted. A turned-away Guest sees a "busy" page that retries every 30 s (decided in M3 planning; a static image of the Board arrives with export in M6). Embed viewers come last |
| Boards per User (owned) | 50 | Creation is blocked with a message |
| Image size / storage per User | 5 MB / 50 MB (KV free tier: 1 GB total) | Upload rejected with a message. Allowed types: PNG, JPEG, GIF (first frame), WebP |
| PNG export | 8,192 px longest side | Scaled down automatically, with a notice |
| Invitation emails | 20 per User per day, 150 per day in total | Sending is blocked with a message saying when it resets |
| Digest emails | 50 per day in total, at most one per User every 3 hours | Unread Notifications wait for the next digest (the next day once the 50 are spent) |
| Email budget | Brevo's free 300/day: 100 kept for sign-in links, 150 invitations, 50 digests (M4 planning) | Sign-in links are never limited by the other two |
| Comment length | 2,000 characters | The reply box stops accepting text and says so |

## 7. Key risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Z-order and group conflicts** | Concurrent reordering or regrouping can leave duplicates or orphans | Fractional indexing for z-order. A group with fewer than 2 Elements dissolves (A1) |
| **Export fidelity** | Fonts and cross-origin images can taint the canvas or render differently | Embed fonts in SVG/PDF. Serve images from our own origin. One drawing path for screen and PNG; SVG tested against it with visual diffs |
| **5,000 Elements at 60 fps** | Could miss S5 | Spatial index, skip drawing off-screen Elements, level-of-detail, Canvas2D only |
| **Durable Object limits** | Large or busy Boards degrade | Compaction, keep images out of the doc, Element cap, connection cap |
| **A viral Embed** | Thousands of sockets on one board room | Connection cap with a static-image fallback for Embeds |
| **Abuse of open sign-up** | Storage and email costs | Per-User quotas and invitation rate limits |
| **Revoked-while-offline edits** | Users can see it as data loss | Explain clearly and offer a PNG/SVG export of the local copy before discarding |

## 8. Timeline and cut line

**Time budget:** 10–12 weeks, solo. There's no separate design phase; UI decisions are made while building.

**Budget:** $0. Every service runs on a free tier with no payment method (ADR 0007). Long load tests (S3, S4) run locally with `wrangler dev`. Only short confirmation runs go against the live site, because 20 simulated Editors use up the Free plan's daily Durable Object allowance in about 30 minutes.

If the schedule slips, **cut in this order:** (1) Version history, (2) email digest, (3) follow mode, (4) search. **Never cut:** S1, S2, S7.

| Milestone | Scope | Exit check |
|---|---|---|
| **M0 Walking skeleton** | Auth, create Board, board token, board room, Yjs sync, IndexedDB, rectangles only | Two browsers edit one Board live. A Viewer token is rejected on write |
| **M1 Canvas core** | All tools, connectors, selection/group/align/layer/Lock, copy/paste, local-only undo, throttled moves, shortcuts | Fuzz suite (S1, S2) green |
| **M2 Presence and offline** | Cursors, presence list, follow mode, reconnect with backoff and jitter | Offline merge tests green |
| **M3 Sharing and access** | Invitations, Share Link, Roles, live downgrade and revoke, connection cap | S7 green |
| **M4 Comments and notifications** | Threads, pins, Mentions, replies, resolve, notification list, digest with unsubscribe | Two browsers: a Commenter pins a Thread to an Element and mentions the Owner, who sees the pin and the Notification live; the pin follows the Element, detaches when it's deleted, and reattaches on undo. Viewers and Guests are refused every comment write |
| **M5a Dashboard and Board lifecycle** | Folders, favorites, sort by last opened, rename, Trash (restore, delete forever), owned-Board quota, templates, thumbnails, Settings and account deletion | A new User makes a Board from a template, renames it, files it in a Folder and stars it; the dashboard shows its thumbnail and sorts by last opened. Deleting it closes a Collaborator's open connection at once and moves it to Trash; Restore brings it back with its Members and Threads. Deleting the account removes its owned Boards and leaves its comments as "Deleted user" |
| **M5b Content** | Compaction, images, search, then Versions (Versions last: first to cut) | An Editor drops a PNG and a Collaborator sees it live, while a Viewer can't upload. Search finds a Board by text on one of its sticky notes and never returns someone else's Board. After 500+ edits the Board compacts and reloads identical. An Editor previews an older Version and restores it, the restore can be undone, and a Viewer never sees history |
| **M6 Export, Embed, hardening** | PNG/SVG/PDF export, Embed, Share Link expiry, load and perf tests, README and portfolio write-up with a live Embed | S3–S6 and S8 green |

## 9. Open questions

None. All open questions from the first draft were resolved in review on 2026-10-10. The answers are in this document, in `GLOSSARY.md`, and in ADRs 0001–0003.

---

## Appendix A: Requirements and acceptance criteria

Priority: **P0** = required for v1 launch · **P1** = expected in v1, can be cut in the order given in §8.

### A1. Canvas (P0)

- Infinite canvas with pan and zoom using mouse, trackpad, and touch (pinch and two-finger pan on iPad).
- **Tools:**
  - Freehand pen: smoothed, uses pressure when a stylus provides it.
  - Rectangle, ellipse, arrow.
  - Connector: straight or elbow, attaching to snap points on shapes.
  - Text: plain text. Font size, Palette color, alignment, and bold apply to the whole Element.
  - Sticky note: grows to fit its text up to a maximum size, then the text shrinks.
  - Image.
- **Arranging:** select, multi-select (marquee and shift-click), group and ungroup, align, resize, recolor, Lock, bring forward and send backward.
- **Colors:** Elements use one of 10 Palette colors (stroke and light fill), and sticky notes use 6 pastel backgrounds. Colors adapt to light and dark mode, and there's no free color picker (ADR 0008, `DESIGN.md`).
- **Theme:** light and dark mode, following the OS by default, with a manual override.
- **Lock** prevents accidental selection or movement. Any Editor can lift it.
- **Connectors** bind to shapes by Element ID and re-route on every client when a shape moves, including when someone else moves it.
- **Groups:** a group with fewer than 2 Elements left dissolves automatically. An Element whose group no longer exists counts as ungrouped.
- **Position and size** are each stored as one value that's replaced whole (ADR 0002).
- **Undo/redo** covers only the local user's actions, within the current tab session. One gesture is one undo step. Undo puts back your own previous value even if someone changed it after you (ADR 0010). Undoing an action on an Element someone else has since deleted does nothing and shows no error.
- **Copy, cut, paste, duplicate** work within a Board and between Boards. Pasting an image from the clipboard uploads it. Pasting into a Board needs Editor access there. Copying out of a Board you can only view is allowed.
- **Drawing and moving:** while you drag out a new shape, it's only a local preview, and the document is written once, on pointer-up. Moving existing Elements streams at about 20 Hz so collaborators see smooth motion.
- **Shortcuts:**
  - Tools: V, P, R, O, A, C, T, S.
  - Selection: Delete removes it; arrow keys nudge it (with Shift for bigger steps); Ctrl/Cmd+G groups and Shift+Ctrl/Cmd+G ungroups.
  - Undo and redo: Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z.
  - Navigation: Space+drag pans, Ctrl/Cmd+scroll zooms, Shift+1 zooms to fit.
  - "?" opens the list of shortcuts.

**Acceptance:** Given two users drag the same shape at the same time, when both release, then every client shows the shape at the same position, which is one of the two positions the users chose, with no flicker afterward.

### A2. Sync, offline, persistence (P0)

- The Board renders from IndexedDB before the network responds. It becomes editable after sync completes.
- Sync runs in both directions using state vectors, so only missing updates are sent.
- If the connection drops, an "Offline, changes saved locally" indicator appears and editing continues. Reconnect uses exponential backoff with jitter.
- If the token expires during a session, the client refreshes it silently and reconnects.
- **Revoked while offline:** the client explains what happened and offers a one-time PNG/SVG export of the local copy. Then it discards the local edits and clears the local copy.
- The board room persists every accepted update to SQLite before broadcasting it, and compacts periodically. There is no save button.
- The board room enforces the 20,000-Element cap.

**Acceptance:** Given a user edits for 5 minutes offline while others edit the same Board online, when the user reconnects, then all clients converge and every edit from both sides is present.

### A3. Presence (P0, follow mode P1)

- Each client publishes its cursor, name, color, selection, and viewport at about 30 Hz. This presence data is never persisted.
- Guests appear as "Guest N" with a visible cursor. They can't be followed or mentioned, but they can follow others.
- The presence list updates within 2 s of someone joining or leaving.
- Follow mode makes your viewport track another Collaborator's until you pan or zoom yourself.
- Embed viewers are invisible and see no cursors.

### A4. Sharing and access (P0)

| Role | View | Comment | Edit | Invite | Change Roles / remove Members / manage Share Link and Embed | See and restore Versions | Delete Board |
|---|---|---|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Editor | ✓ | ✓ | ✓ | at own Role or lower | ✗ | ✓ | ✗ |
| Commenter | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Guest | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

**Accounts**
- One verified email is one User, whether they sign in by email link or Google.
- After sign-in, the user lands back on the Board link they originally opened.

**Invitations**
- Sent by email through Brevo.
- An Invitation to an existing User becomes a Membership immediately. One to an unknown email converts on that address's first sign-in.
- Invitations expire after 30 days. The Owner can resend or cancel any pending Invitation; Editors can cancel their own.
- Inviting someone who already has access is refused with a message: an Invitation never changes an existing Member's Role (the Owner does that in the Share dialog).
- The daily Invitation limits count UTC days, like Brevo's own quota. Resending counts as a send.

**Share Link**
- A Board has at most one Share Link, with one Role and an optional expiry (never, 1, 7, or 30 days). The URL is `/b/{boardId}?s={token}`.
- Changing its Role or regenerating it invalidates the old URL.
- A signed-in User who opens it becomes a lasting Member. Turning the link off doesn't remove Members who already joined through it.
- Anonymous visitors become Guests with view access only.
- Only the Owner sees and manages the link. A new link is Viewer and never expires; choosing an expiry counts from that moment. Every bad, old, or expired link gets the same answer, so tokens can't be probed.

**Leaving and access changes**
- Any Member except the Owner can leave a Board.
- When a Role changes or a Member is removed, the change is written to Postgres, then pushed to the board room. Within 1 s the affected client switches to read-only or returns to the dashboard.
- The board room checks the Role on **every** incoming update. Hiding controls in the UI is never enough on its own.
- The board room remembers each access change, so a board token issued before it (they live 5 minutes) can't undo it: it gets the new Role, or is refused after a removal.

**Connection cap**
- 100 live connections per Board.
- Members are always admitted. Guests are admitted next, then Embed viewers. A turned-away Guest sees a "busy" page that retries every 30 s; a static image of the Board replaces it in M6.

### A5. Comments and notifications (P0, email digest P1)

- **Anchors:** a Thread is anchored to an Element ID or to canvas coordinates, and its pin moves with its Element.
- **Detached Threads:** when the Element doesn't exist, the Thread is a Detached Thread. Its pin stays at the Element's last known position, faded and labeled "detached", and snaps back if the Element returns (through undo or a Version restore).
- **Who can do what:**
  - Commenters and above can create Threads, reply, and resolve or reopen any Thread.
  - Authors can edit and delete their own comments.
  - The Owner can delete any comment or Thread.
  - Viewers and Guests can read Threads but not write in them.
- **Comments** are plain text up to 2,000 characters: line breaks kept, web links clickable, and Mentions. No other formatting (M4 planning).
- **Pins** sit exactly where they were placed. A pin on an Element keeps its spot relative to the Element's box, so it moves and scales with it.
- **Deleting:** deleting a Thread's first comment removes the whole Thread if nobody has replied; otherwise it reads "Comment deleted" and the replies stay. The Owner's "Delete thread" removes it all, after a confirmation.
- **Offline:** comments need a connection. They aren't part of the offline copy.
- **Mentions:** `@` suggests only Members of the Board. A Mention stores the Member's account, so it always shows their current name; someone who no longer has access shows as plain text.
- **Notifications:** a Notification goes to the mentioned Member, and to everyone who has posted in or been mentioned in a Thread when it gets a reply. The person replying is never notified of their own reply.
- **Notification list:** a bell icon opens your Notifications across all Boards, newest first. Clicking one opens the Board with the Thread focused. Items can be marked read one by one or all at once, and are kept for 90 days. Notifications for Boards you can no longer open are hidden.
- **Live badge:** on a Board, its Notifications arrive instantly over the Board connection. Elsewhere the badge checks every 30 s while the tab is visible, and again when it gets focus (M4 planning).
- **Visibility filter:** open, resolved, or both. Resolved Threads are hidden by default.
- **Hourly digest:** one email per User covering Notifications that are unread and not yet emailed, then marks them emailed; at most one per User every 3 hours, and 50 a day in total. Every email has a one-click unsubscribe link and `List-Unsubscribe` headers, and the account menu's "Notifications…" has a switch for it (on by default).

### A6. Accounts and dashboard (P0, search P1)

- Sign-in uses Google OAuth or an email magic link. Sessions use an HTTP-only cookie.
- The dashboard shows owned Boards, shared Boards, Folders, favorites, recent Boards, and Trash, loaded in one request.
- **Folders** are private to each User, one level with no nesting, and can hold any Board you can open. A Board sits in at most one of your Folders. Folders can be renamed and deleted; deleting a Folder never deletes its Boards, which go back to "Your boards" (M5 planning).
- **Order:** "Your boards" is sorted by when you last opened each Board; Boards you've never opened come after. There's no separate Recent section (M5 planning).
- **Rename:** the Owner and Editors rename a Board, from the Board menu or the dashboard tile's ⋯ (M5 planning).
- **Thumbnails** come from KV and refresh when an Editor leaves after making changes, at most once per Board every 10 minutes.
- **Templates:** retro, brainstorm, flowchart, user journey, kanban. A template is applied as the Board's first ordinary edit. Template tiles and a new Board's first thumbnail are drawn from the template's own Elements in the browser, so there are no image files to keep in sync (M5 planning).
- **Search** covers titles (searchable immediately) and text on Boards (searchable within about 5 minutes). It shows snippets and returns only Boards the User is a Member of. Results appear in a dropdown under the header's search box as you type: up to 10 Boards, each with its title and a snippet with the matching words highlighted. There's no separate results page (M5b planning).
- **Board deletion** (Owner only, after a confirmation) moves the Board to Trash for 30 days. Members lose access immediately and their open connections close. The Owner can restore it from Trash, or delete it forever there. Boards in Trash don't count toward the 50 owned Boards (M5 planning).
- **Account deletion** permanently deletes the User's owned Boards, bypassing Trash. It removes their Memberships and changes the author of their comments to "Deleted user". It's in Settings → Account, confirmed by typing DELETE after a summary of what goes (M5 planning).
- **Settings** is a dialog from the account menu with two sections: Notifications (the digest switch) and Account (M5 planning).
- **Accessibility:** the dashboard, menus, dialogs, and comments are fully keyboard-navigable and meet WCAG AA contrast.

### A7. Content and history (P0, Versions P1)

- **Image upload:**
  1. The client validates the type (PNG, JPEG, GIF, WebP) and size (5 MB, within the 50 MB per-User quota) and shows a placeholder.
  2. It uploads through the API, which checks that the user is an Editor and has quota left, then stores the image in KV.
  3. It writes the image Element.
  4. A failed upload leaves a placeholder with a retry button.
- **Adding images** (M5b planning): drop or paste them onto the canvas, or use the dock's Image button (a file picker). A new image fits within 480 px; resizing always keeps its proportions. Several files at once are laid out in a row.
- **Image lifetime** (M5b planning): deleting an image from the canvas keeps its file, because undo and Versions may need it. Files go when their Board is deleted for good. The 50 MB quota counts every image a User has uploaded to Boards that still exist.
- **Daily upload pause** (M5b planning): KV allows 1,000 writes a day for the whole account. Thumbnails stop at 700 writes a day, images at 950; past that, uploads say "Image uploads are paused until tomorrow."
- **Versions** are visible only to Editors and above. One is kept per hour of activity for 30 days, then one per day for a year, then none (M5b planning: the free plan's 5 GB of board room storage is shared by every Board). Preview is read-only. Restore applies the difference as a new edit attributed to the person restoring, which also creates a new Version.

### A8. Export and Embed (P0, Share Link expiry P1)

- **Export** the whole Board or the selection to PNG (capped at 8,192 px, scaled down with a notice), SVG, or PDF (vector text). Everything runs on the client.
- Exports contain Elements only: no pins, cursors, or selection outlines. They render in the light theme by default, with a dark option.
- **Embed:** the Owner switches it on to get an iframe snippet backed by its own read-only token. It doesn't expire by default and can be revoked on its own; the Share Link doesn't affect it.
- The Embed viewer is lightweight, updates live, and shows Board content only: no Threads, pins, or cursors.

---

## Appendix B: Vocabulary and decisions

- **Domain terms** (User, Owner, Member, Collaborator, Guest, Role, Invitation, Share Link, Embed, Board, Element, Folder, Trash, Version, Lock, Thread, Mention, Notification, Detached Thread): see [`GLOSSARY.md`](../GLOSSARY.md).
- **Architecture decisions:**
  - [ADR 0001](../docs/adr/0001-boards-owned-by-users-not-workspaces.md): Boards owned by Users, not workspaces
  - [ADR 0002](../docs/adr/0002-atomic-geometry-in-the-crdt.md): position and size stored as one value each
  - [ADR 0003](../docs/adr/0003-postgres-over-d1.md): Postgres via Hyperdrive, not D1
  - [ADR 0004](../docs/adr/0004-single-worker-with-static-assets.md): one Worker serves the app, API, board rooms, and crons
  - [ADR 0005](../docs/adr/0005-own-canvas-engine.md): our own canvas engine instead of tldraw or Excalidraw
  - [ADR 0006](../docs/adr/0006-hand-rolled-board-room-sync.md): hand-rolled board room sync on y-protocols
  - [ADR 0007](../docs/adr/0007-zero-cost-services.md): free tiers only: Workers KV for images, Brevo for email, workers.dev hosting
  - [ADR 0008](../docs/adr/0008-visual-direction.md): visual direction; Elements store Palette color names
- **Visual design:** [`DESIGN.md`](../DESIGN.md)
- **Tech stack in detail:** [`context/TECH_STACK.md`](./TECH_STACK.md)

## Appendix C: Source flows

`context/FLOWS.md` has the step-by-step behavior of each flow and matches this PRD as of 2026-10-10. If they ever disagree, this PRD wins and FLOWS.md should be updated.
