---
name: Syncanvas
version: 0.3.0 # values checked on /design (M0 ticket 02); see the Iteration Guide
personality: calm, minimal, warm, precise
references: [Linear, tldraw, FigJam toolbar]

colors:
  light:
    background: "#F8F7F4"        # page floor, canvas
    surface: "#FFFFFF"           # floating chrome, cards
    popover: "#FFFFFF"           # menus, popovers, dialogs
    foreground: "#1C1B19"        # ink: body text, icons
    muted: "#F2F0EC"             # soft band, hover wash on surfaces
    muted-foreground: "#6B6760"  # secondary text (5.62:1 on surface)
    accent: "#EFEDE8"            # ghost hover, menu highlight, inactive tab
    accent-foreground: "#1C1B19"
    primary: "#5145CD"           # warm indigo: CTA, selection, focus, links (6.81:1 on white)
    primary-foreground: "#FFFFFF"
    primary-active: "#4337B5"    # pressed
    primary-subtle: "#ECEAFB"    # active tool background, selected rows
    border: "#E6E3DD"            # hairline
    input: "#E6E3DD"
    ring: "#5145CD"
    destructive: "#C8321F"       # white text 5.34:1
    destructive-foreground: "#FFFFFF"
    success: "#237A35"           # text-safe: 5.02:1 on background (was #2B8A3E, 4.08)
    warning: "#8A6800"           # text-safe: 4.83:1 on background (was #A87F00, 3.44)
    grid-dot: "#D9D5CE"
  dark:
    background: "#161514"
    surface: "#1F1E1C"
    popover: "#262523"
    foreground: "#EDEBE7"
    muted: "#2A2926"
    muted-foreground: "#A39F98"  # 6.32:1 on surface
    accent: "#2E2D2A"
    accent-foreground: "#EDEBE7"
    primary: "#8C82F6"           # 5.27:1 on surface
    primary-foreground: "#120F2E" # dark text: white on this indigo is only 3.9:1
    primary-active: "#A39BF8"
    primary-subtle: "#26224A"    # primary on it 4.71:1 (was #2A2650, 4.45)
    border: "#3A3834"
    input: "#3A3834"
    ring: "#8C82F6"
    destructive: "#F06A5B"
    destructive-foreground: "#1A0705"
    success: "#6BD48A"
    warning: "#F2CC4A"
    grid-dot: "#45423D"          # 1.82:1; #34322E read as invisible on the real canvas

palette: # Element colors (Palette colors). Elements store the NAME; themes map it.
  #        light stroke, light fill, dark stroke, dark fill
  ink:    ["#1C1B19", "#E8E6E1", "#EDEBE7", "#3A3835"]
  gray:   ["#7A766F", "#EEECE8", "#A8A49D", "#2F2E2B"]
  red:    ["#D2382D", "#FDE2DF", "#FF7B6F", "#4A201C"]
  orange: ["#D2650C", "#FFE7D1", "#FFA35A", "#4A2D13"]
  yellow: ["#A87F00", "#FFF2BF", "#F2CC4A", "#433813"]
  green:  ["#2B8A3E", "#DCF2E0", "#6BD48A", "#183A22"]
  teal:   ["#0C8579", "#D4F2EE", "#4FD1C2", "#123630"]
  blue:   ["#2A64DB", "#DCE7FD", "#7EA9FF", "#182B4D"]
  violet: ["#7646D6", "#ECE3FC", "#B497FF", "#2D204D"]
  pink:   ["#C93A84", "#FCE0EE", "#FF86C3", "#4A1B34"]

sticky: # background light, background dark; text is always #1C1B19
  yellow: ["#FFE58A", "#E6CF7A"]
  orange: ["#FFC99A", "#E6B48A"]
  pink:   ["#FFC2DD", "#E6AEC6"]
  violet: ["#D9C8FF", "#C3B4E6"]
  blue:   ["#BFD9FF", "#ABC3E6"]
  green:  ["#C3EBC4", "#AFD3B0"]

presence: # cursor + label fill, white label text (all >= 4.92:1)
  - "#C62828" # red
  - "#C2410C" # orange
  - "#A16207" # amber
  - "#4D7C0F" # lime
  - "#15803D" # green
  - "#0F766E" # teal
  - "#0369A1" # sky
  - "#1D4ED8" # blue
  - "#7E22CE" # purple
  - "#A21CAF" # fuchsia
  - "#BE185D" # pink
  - "#8B5E34" # brown
  guest: "#57534E"

typography:
  families:
    sans: "Geist Variable"       # UI and all canvas text (@fontsource-variable/geist)
    mono: "Geist Mono Variable"  # shortcuts, zoom %, numbers (@fontsource-variable/geist-mono)
  scale: # size / line-height / weight / tracking
    display:     [32px, 40px, 600, -0.02em]  # dashboard page title only
    title:       [20px, 28px, 600, -0.01em]  # dialog titles, section headers
    heading:     [16px, 24px, 600, -0.005em]
    body:        [14px, 20px, 400, 0]
    body-strong: [14px, 20px, 500, 0]
    caption:     [12px, 16px, 400, 0]
    label:       [12px, 16px, 500, 0]
    mono:        [12px, 16px, 450, 0]
  canvas: # text Element sizes, in canvas units
    S: 16
    M: 20
    L: 28
    XL: 40
    sticky: { S: 14, M: 16, L: 20, min: 10 } # a full note shrinks its text down to min

rounded:
  sm: 4px     # small accents, kbd, selection handles (2px)
  md: 6px     # menu items, list rows
  lg: 8px     # buttons, inputs, toggles, tool buttons
  xl: 12px    # floating panels, dock, cards, popovers, dialogs
  2xl: 16px   # toasts, large containers
  pill: 9999px # avatars, presence pills, badges, cursor labels

spacing: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64] # px, 4px base

elevation:
  light:
    panel:   "0 0 0 1px #E6E3DD, 0 1px 2px rgb(28 27 25 / 0.06), 0 4px 12px rgb(28 27 25 / 0.06)"
    popover: "0 0 0 1px #E6E3DD, 0 2px 4px rgb(28 27 25 / 0.06), 0 8px 24px rgb(28 27 25 / 0.10)"
    dialog:  "0 0 0 1px #E6E3DD, 0 4px 8px rgb(28 27 25 / 0.08), 0 24px 48px rgb(28 27 25 / 0.16)"
  dark: # borders and lighter surfaces do the work; shadows only separate from the canvas
    panel:   "0 0 0 1px #3A3834, 0 4px 12px rgb(0 0 0 / 0.30)"
    popover: "0 0 0 1px #3A3834, 0 8px 24px rgb(0 0 0 / 0.40)"
    dialog:  "0 0 0 1px #3A3834, 0 24px 48px rgb(0 0 0 / 0.50)"

motion:
  ease-out: "cubic-bezier(0.23, 1, 0.32, 1)"     # entering, default
  ease-in-out: "cubic-bezier(0.77, 0, 0.175, 1)" # moving on screen
  ease: "ease"                                   # hover and color changes
  duration:
    press: 120ms
    tooltip: 150ms
    menu: 180ms
    panel: 220ms
    dialog: 240ms
    exit-factor: 0.75 # exits run at 75% of the enter duration

components:
  shadcn: { base: base-ui, style: nova, icons: lucide }
  control-height: { default: 36px, touch: 44px } # touch = (pointer: coarse)
  icon: { size: 20px, inline-with-text: 16px, stroke: 1.75 } # 20px standalone (icon buttons, tools)
  button-primary: { fill: primary, text: primary-foreground, radius: lg, height: 36px, padding-x: 12px, pressed: primary-active + scale(0.97) }
  button-secondary: { fill: surface, text: foreground, border: border, radius: lg }
  button-ghost: { fill: transparent, hover: accent, text: foreground, radius: lg }
  tool-button: { size: 32px, touch: 44px, radius: lg, idle: ghost, active: "primary-subtle fill + primary icon" }
  dock: { surface: surface, elevation: panel, radius: xl, padding: 6px, gap: 2px }
  floating-panel: { surface: surface, elevation: panel, radius: xl, padding: 8px }
  input: { height: 36px, radius: lg, border: input, focus: "2px ring, 2px offset" }
  kbd: { font: mono, size: 11px, radius: sm, fill: muted, text: muted-foreground }
  cursor-label: { fill: presence, text: "#FFFFFF", font: label, radius: pill, padding: "2px 6px" }
  comment-pin: { size: 28px, surface: surface, elevation: panel, shape: "teardrop, point at bottom-left" }
---

# Syncanvas design system

The visual and interaction rules for Syncanvas. Product scope lives in `context/PRD.md`, vocabulary in `GLOSSARY.md`, and the decision behind this direction in `docs/adr/0008-visual-direction.md`. **Change this file first, then the code.**

## Overview

Syncanvas is **calm, minimal, warm, and precise**. People spend hours on a Board, so the chrome stays quiet and the Board's content provides the color. The chrome uses warm grays, never cold blue-grays, with **one confident accent**, a warm indigo, for action, selection, and focus. Shapes are clean geometry, never sketchy.

The signature view is an edge-to-edge canvas with a dot grid, chrome floating above it on hairline-bordered panels, and colorful cursors moving smoothly across it.

## Colors

- **Roles, not raw values.** Code uses semantic tokens (`bg-background`, `text-muted-foreground`, `bg-primary`). A raw hex in a component is a bug.
- **Primary is rare.** It's used for one primary button per view, the local selection outline, focus rings, links, and the active tool. Never for decoration.
- **Contrast** (checked, see the comments in the frontmatter): text ≥ 4.5:1, UI graphics and Element strokes ≥ 3:1 against the canvas, in both themes.
- **Dark mode** follows the OS by default, with a manual override in the Board menu and settings. Every token has a light and a dark value.

### Palette colors (Element colors)

Elements store a **Palette color name** (`ink`, `red`, …), never a hex value. Each theme maps the name to a stroke shade and a light fill shade, so two people using different themes on one Board both see readable content. There is no free color picker in v1.

- Shapes: stroke uses the stroke shade. Fill is none, the fill shade, or the solid stroke shade.
- Text Elements use the stroke shade.
- Sticky notes use the six `sticky` backgrounds. Their text is always ink `#1C1B19`, in both themes.
- **Exports render the light theme by default**, with an option for dark.

### Presence colors

Twelve saturated colors, separate from the palette and the accent, so a cursor never looks like an Element or a selection. A User's color is chosen from a hash of their ID, so it's the same on every Board. Guests are always `guest` gray. Cursor arrows always have a 1.5px white outline, which keeps them visible on the dark canvas.

## Typography

- **Geist Sans** for everything. **Geist Mono** only for keyboard shortcuts, the zoom percentage, and other numbers that benefit from fixed width. Both are self-hosted from Fontsource and embedded in SVG/PDF exports.
- Use the `type-*` utilities (`type-body`, `type-label`, …), never ad-hoc font sizes.
- `display` appears only as the dashboard page title. The Board chrome uses `body`, `label`, and `caption`.
- Sentence case everywhere, including buttons and menu items.

## Layout

### Board screen ("Dock tray", chosen from prototype C in M0 ticket 03)

```
┌───────────────────────────────────────────────────────────────┐
│ (◆ Board title ▾)                         (●●●+2 💬3) (Share) │  ← pills, 12px from the edges
│                                                               │
│                · · · · · · dot grid · · · · · ·               │
│        📍┌──────────┐      (edge-to-edge canvas)              │
│          │ thread … │  ← inline thread beside its pin         │
│          └──────────┘                                         │
│              ┌─────────────────────────────────┐              │
│              │ ●●●●●● | S M L B | 🔒 ⋯          │ ← style tray │
│              ├─────────────────────────────────┤  (selection) │
│              │ ↖ ✎ ▭ ◯ → ⤳ T ▤ 🖼 💬           │ ← tool row   │
│              └─────────────────────────────────┘ (↶ ↷ | 100%) │
└───────────────────────────────────────────────────────────────┘
```

- **Top left: title pill** (rounded-full, panel elevation): the mark and the Board title, which link back to the dashboard, then a small chevron that opens the **Board menu** (M5a: Rename… for the Owner and Editors, and Back to your boards; theme, dot-grid toggle, and export join it later). A rename shows on everyone's open Board at once. **Offline:** the pill gets a 1px `warning` outline plus a cloud-off icon and "Offline". There's no other offline banner. The same "Offline" state shows when a connection dies without the browser noticing (sleep, a flaky network): a heartbeat finds it within about 35 s and reconnects, and others see that person's presence time out within 30 s instead of a frozen cursor.
- **Top right:** a presence pill with the other Collaborators' avatars (up to 4, then `+N`, which opens a list of everyone's names; you're never in it, and it hides when you're alone; each User appears once however many tabs they have; clicking an avatar follows them) and the **comment count button** (💬 + number of open Threads), then a separate pill-shaped Share button, the only primary button. The count button (💬 and the number of open Threads, a 40px panel pill) opens a **comments popover**: "Comments" with a **Show resolved** switch (it shows resolved Threads in the list and their pins on the Board), then rows newest-last with the author, time, the first comment's first line, and "n replies". Clicking a row centers the Board on that pin, keeping the zoom, and opens its card. Empty: "No comments yet. Press M to add one."
- **Bottom center: the dock** is one panel. Its **tool row** holds compact 32px icon buttons, all tools, active tool in `primary-subtle`. While something is selected, a **style tray** slides up out of the same panel (220ms `ease-out`), separated by a hairline on a `muted` background. The tray shows only the controls that apply to the selection:
  - **Sticky notes:** sticky colors, text size S/M/L, bold.
  - **Shapes:** Palette color, plus fill none / light / solid (small squares previewing each fill in the current color).
  - **Arrows:** Palette color only.
  - **Connectors:** Palette color, plus Straight / Elbow.
  - **Text:** Palette color, size S / M / L / XL, bold (B, Ctrl/Cmd+B), and align left / center / right. Pressing tray controls keeps the text in edit mode.
  - **Pen strokes:** Palette color, plus width S / M / L (letter buttons, active one in `primary-subtle`). While the pen tool is active with nothing selected, the same tray sets the color and width of the next strokes.
  - **Always:** Lock and ⋯ (layering, Align ▸, Distribute ▸, Group, Ungroup, Lock). A locked selection shows only these.
  - **Mixed selections** show only the controls the whole selection shares: colors when every Element takes the same kind (Palette or sticky), fill when all are shapes, width when all are pens, size and bold when all are text or stickies (XL and alignment only when all are text), Straight / Elbow when all are connectors. An option shows pressed only when every selected Element has it; Bold shows pressed only when all are bold, and pressing it makes them all bold.
- **Bottom right:** a pill with undo and redo, then the zoom percentage. Clicking the percentage opens a menu: zoom in, zoom out, zoom to fit, 100%.
- **Comment Threads open inline** as a popover card beside their pin, never covering the pinned Element. The card is placed on the side with the most free space. Escape or a click on the Board closes it. There's no permanent comments side panel.
- **Prototype source:** branch `prototype/board-screen` (variants A–C). Variant C won because it's thumb-friendly on iPad and keeps the canvas open, with controls next to the dock.

### Dashboard

**"Launcher"**, chosen from prototype C in M0 ticket 04. It's a page layout, not floating chrome, with roomier spacing (24–32px gutters, sections 40px apart) than the Board.

```
┌──────────────────────────────────────────────────────────────┐
│ ◆ Syncanvas        [ 🔍 Search boards and their text   / ]   (AR) │  ← account menu: Trash, Settings, Sign out
│                                                              │
│ Start something new                                          │
│ [+ Blank] [Retro] [Brainstorm] [Flowchart] [Journey] [Kanban]│  ← compact row; big hero tiles for new users
│                                                              │
│ Folders                                        + New folder  │
│ [📁 Product 4] [📁 Design reviews 2] [📁 Retros 3] [📁 …]    │  ← tiles; click opens the Folder's page
│                                                              │
│ Your boards          [All · Mine · Shared with me · Favorites]│
│ [thumb] [thumb] [thumb] [thumb]                              │  ← tiles with a ⋯ menu
└──────────────────────────────────────────────────────────────┘
```

- **Header:** wordmark at left, a wide centered search (`/` focuses it), account avatar at right. The **account menu** holds Trash, Settings, and Sign out. Trash is deliberately one level down. **Settings** opens a dialog with two sections: Notifications (the digest switch, which replaces the M4 "Notifications…" item) and Account, whose "Delete account…" confirmation names what goes ("3 boards you own will be deleted for everyone") and asks you to type DELETE before the destructive button works. Copy (M5a ticket 06): the Account row reads "Delete account" / "Deletes the boards you own and signs you out. This can't be undone." with an outline "Delete account…" in `destructive`; the confirmation is "Delete your account?", "{n} boards you own will be deleted for everyone. Your memberships, folders, favorites, and notifications go too. Comments you left on other boards stay, shown as “Deleted user”.", the field "Type DELETE to confirm", and Cancel / "Delete account" (disabled until the text is exactly DELETE). Afterwards the sign-in page shows "Your account was deleted." above the form. A comment pin whose author is gone reads "Comment by Deleted user".
- **Start something new:** template tiles with Blank first (dashed `primary` outline, solid `primary` icon).
  - **New users** (no Boards) get big hero tiles titled "Let's make your first board", and "Your boards" shows "Boards you open will show up here."
  - **Returning users** get a compact single row about half the height. On a phone it scrolls sideways.
- **Folders:** tiles showing the Folder icon, name, and Board count, plus "New folder". Each Folder tile has a ⋯ menu: Rename, Delete folder (confirmed: "Its boards go back to Your boards."). Clicking a tile opens the **Folder page**: a "Home › Folder name" breadcrumb and the same Board grid, filtered to that Folder. An empty Folder says "This folder is empty. Move boards here from their menu." "Your boards" on home still lists every Board, filed or not; Folders only add a way in. Folder names are 1–60 characters.
- **Your boards:** every Board the User can open, sorted by when they last opened it (there's no separate Recent section). Boards never opened (for example, newly shared ones) come after. A segmented filter switches between **All · Mine · Shared with me · Favorites**.
- **Board tiles:** a thumbnail (light-theme render in both themes; before the first one, the template's preview for a Board made from a template, otherwise the placeholder dot grid with the mark), the title on one line truncated, then "Owner · last edited" (owner only when shared), and a filled star in `warning` after the title when it's a favorite (the ⋯ menu reads "Add to favorites" / "Remove from favorites"). A **⋯ menu** appears on hover (always visible on touch): Open, Rename, Favorite, Move to folder, then Delete (Owner) or Leave board (Members). On desktop, dragging a tile onto a Folder moves it.
- **Trash page:** "Home › Trash", a list of rows reading "Deleted 3 days ago · 27 days left", each with Restore and "Delete forever" (confirmed), under the note "Boards in Trash are deleted for good after 30 days. They don't count toward your 50 boards." An empty Trash says "Trash is empty." Deleting (tile ⋯ or Board menu → "Delete board…", Owner only) asks "Delete “{title}”?" with "Everyone it's shared with loses access right away. It stays in your Trash for 30 days, so you can restore it." and toasts "“{title}” moved to Trash". Anyone with it open is sent to their dashboard with "“{title}” was deleted"; a Guest sees a "“{title}” was deleted" notice instead. Past the quota, "Blank board" shows the server's message under the tiles: "You own 50 boards, the most for one account. Delete one or empty Trash to make room."
- **Search** (M5b planning; shipped in M5b ticket 05): typing in the header's search box (two characters or more) opens a dropdown under it, updated as you type (about 150 ms after the last key): up to 10 Boards, each with its title (`body-strong`) and, when the text on it matched, a one-line `caption` snippet in `muted-foreground` with the matching words in bold `foreground`. Every word typed counts as the start of a word ("roadm" finds "roadmap"), and English endings are ignored ("quarter" finds "quarterly"). Title matches come first. The dropdown is a popover-style panel the width of the box; the row under the arrow keys or pointer gets `accent`. Arrow keys move (wrapping), Enter opens, Escape closes (a second Escape leaves the box); `/` focuses the box from anywhere on the dashboard and Trash (shown as a `kbd` in the empty box on desktop). No matches: "No boards match “{query}”." On phones the box takes its own full-width row under the wordmark, bell, and avatar.
- **Templates:** each template tile shows a small preview drawn from the template's own Elements (light theme), not an image file. The preview fits the whole template in the tile and stays light in dark mode. Each template (`packages/board-model/src/templates.ts`, approved 2026-10-18) starts with an XL bold title and a gray one-line hint, then: **Retro**: Went well (green), To improve (red), Action items (blue) columns, each with a prompt note and an empty note. **Brainstorm**: a "Main question" oval with six colored notes connected to it. **Flowchart**: Start → First step → Decision? → Yes: Next step → End, and No: Fix it, looping back. **User journey**: five connected stages (Discover, Sign up, First use, Get value, Come back) over Doing, Thinking, and Feeling rows of notes. **Kanban**: To do, In progress, Done columns with example cards. Example text stays: empty notes look unfinished in the previews.
- **Grid:** 4 columns on desktop, 2 on tablet, 1 on phone.
- **Prototype source:** branch `prototype/dashboard` (variants A–C). C won because it makes creating a Board the hero action and gives Folders a simple tile-and-page model.

## Elevation

Three tiers: **panel** (dock and floating chrome), **popover** (menus, tooltips, popovers), and **dialog**. Light mode uses a hairline border plus soft layered shadows. Dark mode relies on borders and lighter surfaces, and its shadows only separate panels from the canvas. Nothing else gets a shadow.

## Shapes

Use the radius scale only: 4 / 6 / 8 / 12 / 16 / pill. Controls are 8, floating surfaces are 12, and avatars and labels are pill. Nested corners shrink inward: a control inside a 12px panel with 6px padding is 8px (6 + 8 ≈ 12 + 2).

## Components

shadcn/ui on **Base UI** with the **nova** style and Lucide icons. Only the components we use are installed (see Known Gaps).

- **Buttons:** 36px tall (44px on touch). Variants: `default` (primary), `outline` (secondary), `ghost`, `destructive`, `link`. Pressing scales the button to 0.97 for 120ms.
- **Shortcut sheet:** "?" (or the zoom menu's "Keyboard shortcuts") opens a dialog listing every Board shortcut in four groups: Tools, Selection, Editing, Navigation. Two columns on wide screens, one on phones, each key a `kbd`. Shortcuts read ⌘ / ⇧ / ⌥ on Apple devices and Ctrl / Shift / Alt elsewhere, everywhere they're shown (tooltips, menus, the sheet).
- **Images** (M5b planning; shipped in M5b ticket 03): the dock's Image button (shortcut I) opens a file picker for one or several files; dropping or pasting works too. A new image fits within 480 px and lands at the drop point (or the view's center; pasting goes to the cursor), several in a row 16 px apart. Resizing keeps its proportions from any corner, with or without Shift. While uploading, and while a new image hasn't reached a collaborator's region yet (about a minute of retries), the image's box shows a `muted` placeholder with a small `muted-foreground` spinner; after that the placeholder stays, without the spinner. A failed upload's box shows "Couldn't upload" (`caption`, `muted-foreground`) over a Retry button (`outline`, small) and a × (ghost, "Remove"), with a toast giving the reason. Files are checked before uploading, with the same toasts the API uses ("Images can be up to 5 MB.", "Images can be PNG, JPEG, GIF, or WebP."); past the daily limit the toast reads "Image uploads are paused until tomorrow." The style tray offers no colors for images (alone or mixed with other types). Copying an image into another Board uploads a copy there; any that fail are left out with "Couldn't copy an image".
- **Version history** (M5b planning; shipped in M5b ticket 07; Editors and the Owner while connected): Board menu → "Version history…" opens a right-hand panel (popover-style surface, 320 px, from under the top bar to above the zoom pill; header "Version history" with a ×). Versions are grouped by day ("Today", "Yesterday", then "Tue, Oct 14", with the year only when it differs), newest first; each row shows its time in the viewer's locale and, for restores, "Restored by {name}" as a `caption` in `muted-foreground`. Empty: "No versions yet. They're saved as the board changes." Choosing one swaps the canvas for that Version, read-only (no dock, no comment pins, same view position), with the chosen row in `primary-subtle` and a centered pill banner "Viewing {Oct 21, 2:00 PM}" with Restore (primary) and "Back to current" (outline); Escape also goes back. Live changes from others keep arriving underneath and show on "Back to current". Restore applies the difference from now as one edit (Ctrl+Z undoes it), closes history, and toasts "Restored the version from {date, time}".
- **Export** (M6 planning): Board menu → "Export…" (everyone who can see the Board) opens a 400 px dialog "Export": **Format** as a segmented control (PNG · SVG · PDF), **What** (Selection · Whole board; Selection only when something is selected, and then the default), **Theme** (Light · Dark), then Cancel / **Export** (primary; a spinner while PDF loads). The file downloads as `{title}.{ext}` and the dialog closes. A PNG cut down to 8,192 px toasts "Exported at {n}% so it fits 8,192 px."
- **Embed section** (M6 planning, in the Share dialog under Share link, Owner only): under a hairline, "Embed" (`body-strong`) with the caption "Show this board live and read-only on another website." and a switch. When on: the snippet in a read-only mono field and **Copy snippet** (`outline`; toast "Snippet copied"); the caption "Turning it off stops every embed at once." Turning it off toasts "Embed turned off"; turning it on again makes a new snippet (the old one stops working).
- **Embed viewer** (M6 planning): the Board alone on the canvas background (no chrome, no dot grid toggle), fitted to the frame with 24 px of padding; pan by dragging and zoom with the wheel or a pinch. Bottom right, a small pill badge with the mark and "Syncanvas" (`caption`, surface fill, panel elevation) linking to the site in a new tab. Light theme unless `?theme=dark`. A revoked or unknown Embed shows a centered `muted-foreground` line: "This embed is no longer available."
- **Busy fallback picture** (M6 planning; shipped in M6 ticket 07): on the busy page, in place of the lock and above "This board is busy right now", the Board's latest thumbnail in a 16:10 frame (`lg` radius, hairline border); it refreshes every 30 s with the retry. The Embed viewer shows the picture full-frame with a small "Busy, retrying…" caption in the corner.
- **Tool buttons:** 32px squares (44px on touch), ghost when idle. The compact dock is part of the Dock tray layout. The active tool gets a `primary-subtle` fill with a `primary` icon. Tooltips show the name plus the shortcut in a `kbd`.
- **Inputs:** 36px, 8px radius, hairline border, 2px focus ring with a 2px offset.
- **Menus and popovers:** popover elevation and 12px radius. Items are 32px tall with 6px radius, and the highlight uses `accent`.
- **Display name:** the first time a User without a name opens a Board, a dialog asks "What should others see?" with one input prefilled from their email (`ada.lovelace@…` → "Ada Lovelace"), and Save / "Skip for now" (skipping keeps the prefill). The account menu's "Display name…" reopens it (as "Display name", with Cancel instead of Skip). Dismissing the first-time dialog (Escape, a click outside) counts as skipping. Names are 1–50 characters. The account menu's header shows the name above the email, and the account avatar's initials come from the name.
- **Share dialog** (M3): "Share “{title}”", one dialog in three parts. **Invite:** email input, Role menu, Send (Editors only see Roles up to their own). **People with access:** each Member with avatar, name, and Role; the Owner gets a Role menu and Remove on each row; pending Invitations show the email, "Pending", and Resend / Cancel. **Share link:** an on/off switch, "Anyone with the link can [Role ▾]", "Expires [Never / 1 day / 7 days / 30 days ▾]" with the date shown, Copy link, and Regenerate. Non-Owners get "Leave board" at the bottom (with a confirmation). Viewers and Commenters see the list read-only. The Role menu lists each Role with a one-line hint ("Can edit", "Can view and comment", "Can view") and keeps the last pick. Errors show under the invite row in `destructive` caption text: someone who already has access ("Grace Hopper already has access to this board."; the Owner changes Roles in the list instead), or a daily limit, ending with when it resets in the viewer's own time ("You can send more tomorrow at 5:00 AM."). Sending toasts "{email} can edit now" for an existing account, or "Invitation sent" for a new address. Pending rows read "Pending · invited by {name}". Long names and emails truncate; the dialog is 512px wide and fits phones. The Owner's Role control on a Member's row is a ghost button ("Editor ▾") opening the same Role list plus a separator and a destructive **Remove** (no confirmation; the toast "{name} no longer has access" confirms it). "Leave board" is a destructive-text ghost button under a hairline at the bottom; it and the dashboard tile's ⋯ "Leave board" open a confirmation: "Leave “{title}”?", "It leaves your dashboard, and you'll need a new invitation to get back in.", Cancel / **Leave board** (`destructive`).
- **Share link section** (M3, the Owner only; others don't see it): under a hairline, "Share link" (`body-strong`) with a caption ("Anyone with the link can open the board and stays a member." / "Off. Only the people above can open this board.") and a switch on the right (`primary` track when on). When on: "Anyone with the link can [view ▾]" (a ghost button with the verb: edit / comment / view; its menu is the Role list) and "Expires [Never ▾]" (Never, 1 day, 7 days, 30 days; the button shows the date once set, "Oct 21"). Below, the read-only address with **Copy link** (`outline`; toast "Link copied"), and a caption "Never expires" / "Expires Oct 21" · **Regenerate** (a link button; toast "New link ready" / "The old link no longer works", and the same toast when a Role change issues a new address). A new link starts as Viewer, never expiring.
- **Opening a Share Link:** a signed-in User sees "Opening the board…" while they join, then the Board, with `?s=` dropped from the address. Signed out, they sign in first and come back to the link. A dead link shows the no-access page as "This link doesn't work" with the server's reason and "Back to your boards".
- **Access changes** (M3): the affected person's screen follows within a second. A Role change toasts "{name} changed your role to {Role}" and the dock's tools disable or return at once (tooltips read "{Tool} (view only)"). Removal goes to the dashboard with the toast "You no longer have access to “{title}”"; leaving goes there with "You left “{title}”". If the board room refuses edits made just before a downgrade, the Board reloads from the server with the toast "Some of your changes weren't saved" / "You can only view this board now."
- **Guests** (M3): a signed-out visitor from a Share Link sees the Board view-only; the primary button where Share sits reads "Sign in to edit" / "Sign in to comment" / "Sign in" (matching the link's Role) and returns them as a Member. Guests show as gray "Guest N" (initials "G1"; the tooltip says "Guests can't be followed"). The Guest button is a real link to sign-in that returns to the Share Link. Guests keep no local copy on the device.
- **Lost access with unsaved work** (M3): if access is refused on reconnecting and this device holds edits the board room never received, a dialog sits over the no-access page: "You no longer have access to “{title}”", "Changes you made while offline couldn't be saved to the board. Download a picture of your copy before it's removed from this device.", with ghost **Discard and close** and primary **Download a picture** (a PNG of the whole Board, light theme, named "{title}.png"; focus starts here). It can't be dismissed any other way. Discarding clears the copy and goes to the dashboard with "You no longer have access to “{title}”". Without unsaved work, a Board that was open goes straight to the dashboard with that toast; opening a Board you can't access shows the no-access page.
- **No-access pages** (M3): one centered layout (a lock in a `muted` circle, `title`, `muted-foreground` body, one action). "You don't have access to this board" (Back to your boards); "This link doesn't work" for a bad link opened while signed in (the server's message); "This link doesn't work anymore" when a Guest's link is turned off or replaced (Sign in). **Busy:** "This board is busy right now", "It has as many visitors as it can take. We'll try again every 30 seconds, so you can leave this page open.", with a spinner and "Waiting for room…" instead of a button; it turns into the Board by itself once there's room.
- **Access changes** (M3): a downgrade turns the Board read-only at once with a toast "{name} changed your role to {Role}"; an upgrade restores tools with a toast; removal returns to the dashboard with "You no longer have access to “{title}”". A full Board shows turned-away Guests "This board is busy right now", retrying every 30 s.
- **Toasts:** bottom-center above the dock on the Board (120px up, clear of the style tray), bottom-right on the dashboard. Errors say what happened and what to do next. Built on `sonner` (`components/ui/toaster.tsx`): `popover` background, `border` hairline, `shadow-popover`, `2xl` corners, `body-strong` title and `caption` description.

### Canvas

- **Dot grid:** a 1px dot every 24 canvas units in `grid-dot`. Below 50% zoom the spacing doubles. Below 25% the grid fades out entirely. It can be toggled in the Board menu.
- **Local selection:** a 1.5px `primary` outline. Handles are 8×8px white squares with a 1.5px `primary` border and 2px radius. They keep a constant screen size at any zoom.
- **Multi-selection:** each member gets a 1px `primary` outline (lines get a 1px line along them), and the selection as a whole gets the local selection box and handles.
- **Resize:** drag a corner handle of the selection box; Shift keeps the proportions, and the opposite corner stays put (no flipping past it). A multi-selection scales everything in it around that corner: positions, sizes, pen points, and arrow ends. Font sizes never scale: text and sticky notes get wider or narrower and rewrap (an auto-width text resized on its own becomes fixed width; in a multi-selection it only moves). Text and sticky notes resize their width only, with minimums of 20 and 80 units; anything else stops at 8. A selected arrow's two handles drag its ends. Hovering a handle shows a resize cursor.
- **Connectors (C):** drag from one Element to another. An end snaps to the nearest of the four side midpoints of the topmost shape, text, or sticky under the pointer (or within 16px of it); lines and pen strokes don't take connectors. While the tool hovers or drags, the target's four snap points show as 8px white dots with a 1.5px `primary` ring, and the one it will snap to as a 12px filled `primary` dot. A drag that ends on nothing leaves that end free. Elbow connectors route in 2–3 orthogonal segments (attached ends leave their side perpendicularly; free ends along the longer axis; no obstacle avoidance); straight ones are one segment. Every connector ends in the arrowhead. The tray offers color plus Straight / Elbow; new connectors take the style last picked (elbow at first). Selected, a connector's two end handles drag to re-attach or free that end; moving a connector moves only its free ends.
- **Layering, align, distribute (tray ⋯ menu):** Bring forward (Ctrl/Cmd+]) and Send backward (Ctrl/Cmd+[) move the selection one step past the next Element it overlaps, keeping its own order; nothing in the way, nothing changes. Align (left, center, right, top, middle, bottom) needs 2+ units and lines them up with the selection's box; Distribute (horizontally, vertically) needs 3+ and makes the gaps equal, keeping the outermost units in place. A group is one unit; connectors and locked Elements don't move. Each is one undo step. The menu's order: layering, Align ▸, Distribute ▸, then Group, Ungroup, Lock.
- **Board menus and focus:** after a pointer pick, a Board menu lets focus go instead of returning it to its button, so Board shortcuts (Escape, Delete, Ctrl+Z) keep working; keyboard use still returns focus to the button.
- **Copy, cut, paste, duplicate:** Ctrl/Cmd+C copies the selection (Viewers too), Ctrl/Cmd+X cuts it, Ctrl/Cmd+V pastes at the cursor (or the viewport's center when the pointer is off the Board), and Ctrl/Cmd+D duplicates 16 units right and down. Pasted and duplicated Elements arrive on top, selected, as one undo step. Pasting into another app gives a light-theme picture of the selection. A paste that would pass 20,000 Elements shows a toast instead; so does pasting into a view-only Board.
- **Marquee:** `primary` at 8% opacity, with a 1px `primary` border. It selects what lies entirely inside it; Shift+drag adds to the selection.
- **Remote selection:** a 1.5px outline in the Collaborator's presence color around each Element they've selected (lines outlined along their path), plus a name tag above the selection's top-left corner: an 18px pill in their color with white 11px medium text, 4px above the outline. A selection of more than 100 Elements is shown as one outline around its box. Your own other tabs' selections show too; selections of deleted Elements disappear.
- **Cursors:** a 16px arrow in the presence color with a 1.5px white outline. The label pill sits below and to the right, with white `label` text, and fades out after 3s without movement. Motion is smoothed with `perfect-cursors`, and a cursor that stops settles exactly on its last reported point. Cursors are published at about 30 per second and are world positions, so they stay on the same spot of the Board while you pan or zoom. Every open tab has its own cursor (a User with two tabs shows two, in the same color); you also see your own other tabs' cursors, never the one under your pointer. Cursors draw above Board content and below all chrome, at constant screen size.
- **Presence pill avatars:** 28px circles in the person's presence color with white `label` initials (from their display name), overlapping by 4px with a 2px `surface` ring; a tooltip gives the name. The "+N" chip (`muted` fill, `muted-foreground` text) opens an "On this board" menu listing everyone with a small avatar.
- **Away:** a tab that's hidden or has had no input for 60s hides its cursor; when all of a User's tabs are away, their avatar dims and its tooltip says "Away". Any input brings them back at once. Going offline clears everyone else's presence from your screen until you reconnect.
- **Follow mode:** clicking an avatar in the presence pill (or a name in its "+N" list) follows that person's most recently active tab. Your view fits their whole visible area (centered, zoomed out if your screen is smaller). While following, a 2px frame in their presence color surrounds the Board and a chip at the top center reads "Following {name} · Stop" (a 40px pill in their color, white `body-strong` text, and a ghost Stop button). The followed avatar gets a `primary` ring, and avatar tooltips end in "Click to follow" / "Click to stop following". The camera jumps to their view at once and moves without animation (camera changes are never animated). Panning, zooming, Escape, Stop, or the leader leaving ends it. Guests can't be followed.
- **Someone typing** in a text or sticky shows the same remote-selection outline and name tag around it; there's no remote text caret.
- **Comment tool** (M4): the dock's Comment button or **M** (C is the connector). Click an Element or an empty spot to place a pin there and open a new Thread card with the reply box focused; Escape with nothing typed removes the draft. Disabled for Viewers and Guests ("Comment (view only)") and while offline ("Comments need a connection").
- **Thread card** (M4): the inline popover beside its pin. Comments top to bottom, each with avatar, name, time ("5 min ago"), and text (line breaks kept, links clickable, Mentions as `@Name` in `primary`). A ⋯ menu on your own comment: Edit, Delete; the Owner also gets Delete on anyone's, and the card's header ⋯ has Resolve / Reopen and, for the Owner, Delete thread (confirmed). A deleted first comment with replies reads "Comment deleted" in `muted-foreground` italics. At the bottom, a reply box ("Reply…", Enter sends, Shift+Enter for a new line, 2,000 characters with a counter from 1,800); typing `@` opens a Member picker (avatar, name, email; arrows and Enter). Viewers and Guests see the Thread without the reply box or menus.
- **Bell and notification list** (M4): a 40px bell button (panel pill on the Board, ghost on the dashboard) with a `primary` dot and count (9+) for unread Notifications. On the Board it sits at the left of the top-right row, before the presence pill; on the dashboard, left of the account avatar. It opens a 360px popover: "Notifications", "Mark all read", then rows newest first (avatar, "{name} mentioned you" / "{name} replied", the comment's first line, the Board's title, time; unread rows have a `primary` dot). Clicking a row marks it read and opens the Board with that Thread's card open. Empty: "You're all caught up".
- **Notifications settings** (M4; inside Settings since M5a): one switch, "Email me about unread notifications" (on by default), and a caption that digests come at most every 3 hours.
- **Digest email and unsubscribe** (M4 ticket 04): the digest uses the email layout of the sign-in and Invitation emails. Subject "You have n new notifications on Syncanvas"; one row per Notification ("{name} mentioned you on “{title}”", the comment's first line, "Open the thread"), the newest 20 and then "…and n more in Syncanvas."; a footer saying it comes at most every 3 hours, with "Stop these emails". That link opens a plain page "Stop digest emails?" with one primary button; after it, "You're unsubscribed". Mail apps unsubscribe in one click through the `List-Unsubscribe` headers. While the settings dialog loads, a muted placeholder stands in for the switch.
- **Comment pins:** a 28px teardrop pointing to its anchor, on `surface` with panel elevation, showing the author's initials or the reply count. A Detached Thread pin is at 50% opacity with a dashed border. Resolved pins are hidden unless Show resolved is on, and then show a check instead of initials. A Detached Thread's card starts with "Detached: its element was deleted. Undo brings it back." (M4 ticket 02). The card's header holds Resolve / Reopen and, for the Owner, ⋯ → Delete thread ("Delete this thread?", "Every comment in it goes, for everyone on the board."). Edited comments add " · edited" after the time.
- **Lock:** a locked Element shows a small lock badge on hover (on touch, on tap), with no other visual change: a 20px `surface` square with a `border` hairline and a `muted-foreground` padlock, centered on the Element's top-right corner (a line's arrowhead end). Clicks and marquees pass locked Elements by. Clicking the badge selects the Element; a locked selection has no handles and its tray shows only a pressed Lock toggle (Unlock) and ⋯: it can't be moved, resized, nudged, deleted, or restyled until unlocked. Shortcut: Shift+Ctrl/Cmd+L.
- **Groups:** clicking a member selects the whole group; the first double-click on a member selects just it (a second one edits a text or sticky). A marquee selects a group only when all its members are inside it. Group with Ctrl/Cmd+G, ungroup with Shift+Ctrl/Cmd+G, or from the tray's ⋯ menu (Group, Ungroup, Lock).
- **Arrows and connectors:** a 2px line in the stroke shade (thicker in canvas units when zoomed out below 50%, like shape outlines) ending in a filled arrowhead about 10px long with a ~26° half-angle; short lines get a smaller head. Selected, they show a handle at each end instead of a box.
- **Text:** Geist at the `typography.canvas` sizes, line height 1.3, regular (400) or bold (600), in the stroke shade. A click with T places auto-width text (it grows as you type; only Enter breaks lines). Dragging with T sets a fixed width that wraps at word boundaries, breaking over-long words anywhere. Editing happens in a textarea laid exactly over the text, so the canvas and the editor break lines identically.
- **Sticky notes:** a flat `sticky` background with 4px corners (no border or shadow), and ink text at the sticky sizes (S / M / L = 14 / 16 / 20, line height 1.3), top-left with 16 units of padding. A new note is 200 × 200, centered where you click with S, in the sticky color you last picked (yellow at first). It keeps its width and grows taller as you type, up to twice its width (400); past that, the text shrinks 1px at a time down to 10px, and anything still left over is cut off at the bottom (the editor scrolls). An empty note stays when editing ends; an empty text doesn't.
- **Pen strokes:** drawn with `perfect-freehand` (thinning 0.6, smoothing 0.5, streamline 0.5) in the stroke shade. Widths S / M / L are 2 / 4 / 8 canvas units. A stylus varies the width with pressure; mouse and touch draw at a constant width.

## Motion

Motion confirms what you did and never slows you down (emil-design-eng).

- **Keyboard-opened dialogs** (the shortcut sheet from "?") appear and close with no animation; opened from a menu they animate as dialogs do. Tool and toggle buttons change state instantly (their press still scales).
- **Never animate:** keyboard-triggered actions, switching tools, drawing, panning, zooming, selection changes, or any change to Elements made by you or by others.
- **Animate:** popovers and menus (scale from 0.96 plus fade, origin-aware, 180ms), tooltips (150ms; after the first tooltip opens, the next ones show instantly), panels (220ms), dialogs (240ms), button presses (scale 0.97, 120ms), and toasts.
- **Easing:** `ease-out` for anything entering, `ease-in-out` for movement on screen, and `ease` for color changes. **Never ease-in.** Exits run at 75% of the enter duration.
- **Only `transform` and `opacity` animate.** Use CSS transitions and `@starting-style`. Don't use a JS animation library.
- **Never scale from 0.** Start at 0.95–0.97.
- **`prefers-reduced-motion`:** remove movement and keep only short opacity fades.
- **Hover effects** apply only under `@media (hover: hover) and (pointer: fine)`, so they never stick on iPad.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use semantic tokens (`bg-primary`) | Write raw hex or Tailwind palette colors (`bg-indigo-600`) in components |
| Keep one primary button per view | Put two indigo buttons side by side |
| Store a Palette color name on Elements | Store hex values in the Board document |
| Use the `type-*` utilities | Set ad-hoc `text-[13px]` sizes |
| Use `flex` / `gap-*` | Use `space-x-*` / `space-y-*` |
| Use the radius scale only | Invent 10px or 14px corners |
| Animate `transform` and `opacity` with the curves above | Use `transition: all` or `ease-in` |
| Write sentence case with no exclamation marks | Write "Oops! Something went wrong!" |
| Make error messages say what happened and what to do next | Show a bare "Error" |
| Leave the canvas content to provide the color | Add colored backgrounds or illustrations to the chrome |

## Responsive

| Context | Rule |
|---|---|
| Desktop (pointer: fine) | 36px controls; all features available |
| iPad (pointer: coarse, ≥ 768px) | 44px touch targets; dock and panels keep their positions; no hover effects |
| Phone (< 640px) | The Board opens read-only: no dock, only pan and zoom plus a "View only on small screens" note. The dashboard is a single column |

## Known Gaps

- **Logo mark** is not drawn yet. The wordmark is "Syncanvas" set in Geist at 600 weight.
- **Checked on `/design` (ticket 02):** every text pair passes 4.5:1 and every Palette stroke passes 3:1 in both themes. The pass fixed light `warning` and `success` (too faint as text), dark `primary-subtle` (4.45 → 4.71), and the dark `grid-dot` (invisible on the real canvas). Shadows, dark sticky colors, and spacing look right.
- **Deviation from the shadcn skill:** we install only the components we use instead of `add --all`. The `/design` page coverage check runs against the installed set.

## Iteration Guide

1. Change the value **here** first, with the reason in the commit message.
2. Mirror it in `apps/web` theme CSS (`:root`, `.dark`, `@theme inline`).
3. Check the `/design` page (`pnpm dev`, then `/design`; development only) in both themes. Contrast is measured live; text pairs must stay ≥ 4.5:1 and strokes ≥ 3:1.
4. If a rule changes (not only a value), update the Do's and Don'ts table.
5. Run an emil-design-eng review on any new or changed motion.
