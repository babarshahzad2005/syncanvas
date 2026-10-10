---
name: Syncanvas
version: 0.1.0 # v0: tokens set, layouts pending prototypes (see Known Gaps)
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
    success: "#2B8A3E"
    warning: "#A87F00"
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
    primary-subtle: "#2A2650"
    border: "#3A3834"
    input: "#3A3834"
    ring: "#8C82F6"
    destructive: "#F06A5B"
    destructive-foreground: "#1A0705"
    success: "#6BD48A"
    warning: "#F2CC4A"
    grid-dot: "#34322E"

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
    sticky: { max: 20, min: 10 } # sticky text shrinks between these

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

- **Top left: title pill** (rounded-full, panel elevation): the mark, the Board title, and a small chevron. Clicking it opens the **Board menu**: rename, theme, dot-grid toggle, export, and back to the dashboard. **Offline:** the pill gets a 1px `warning` outline plus a cloud-off icon and "Offline". There's no other offline banner.
- **Top right:** a presence pill with avatars (up to 4, then `+N`) and the **comment count button** (💬 + number of open Threads), then a separate pill-shaped Share button, the only primary button. The count button opens a **comments popover** with Open and Resolved tabs. Each row shows the first comment. Clicking a row pans the Board to that pin and opens its inline thread.
- **Bottom center: the dock** is one panel. Its **tool row** holds compact 32px icon buttons, all tools, active tool in `primary-subtle`. While something is selected, a **style tray** slides up out of the same panel (220ms `ease-out`), separated by a hairline on a `muted` background. The tray shows only the controls that apply to the selection:
  - **Sticky notes:** sticky colors, text size S/M/L, bold.
  - **Shapes:** stroke and fill Palette colors.
  - **Always:** lock and "more".
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

- **Header:** wordmark at left, a wide centered search (`/` focuses it), account avatar at right. The **account menu** holds Trash, Settings, and Sign out. Trash is deliberately one level down.
- **Start something new:** template tiles with Blank first (dashed `primary` outline, solid `primary` icon).
  - **New users** (no Boards) get big hero tiles titled "Let's make your first board", and "Your boards" shows "Boards you open will show up here."
  - **Returning users** get a compact single row about half the height. On a phone it scrolls sideways.
- **Folders:** tiles showing the Folder icon, name, and Board count, plus "New folder". Clicking a tile opens the **Folder page**: a "Home › Folder name" breadcrumb and the same Board grid, filtered to that Folder. An empty Folder says "This folder is empty. Move boards here from their menu."
- **Your boards:** every Board the User can open, sorted by last opened. Boards never opened (for example, newly shared ones) come after. A segmented filter switches between **All · Mine · Shared with me · Favorites**.
- **Board tiles:** a thumbnail (light-theme render, placeholder dot grid with the mark when there's none yet), the title on one line truncated, then "Owner · last edited" (owner only when shared), and a star when it's a favorite. A **⋯ menu** appears on hover (always visible on touch): Open, Rename, Favorite, Move to folder, then Delete (Owner) or Leave board (Members). On desktop, dragging a tile onto a Folder moves it.
- **Trash page:** "Home › Trash", a list of rows reading "Deleted 3 days ago · 27 days left", each with Restore, under the note "Boards in Trash are deleted for good after 30 days."
- **Grid:** 4 columns on desktop, 2 on tablet, 1 on phone.
- **Prototype source:** branch `prototype/dashboard` (variants A–C). C won because it makes creating a Board the hero action and gives Folders a simple tile-and-page model.

## Elevation

Three tiers: **panel** (dock and floating chrome), **popover** (menus, tooltips, popovers), and **dialog**. Light mode uses a hairline border plus soft layered shadows. Dark mode relies on borders and lighter surfaces, and its shadows only separate panels from the canvas. Nothing else gets a shadow.

## Shapes

Use the radius scale only: 4 / 6 / 8 / 12 / 16 / pill. Controls are 8, floating surfaces are 12, and avatars and labels are pill. Nested corners shrink inward: a control inside a 12px panel with 6px padding is 8px (6 + 8 ≈ 12 + 2).

## Components

shadcn/ui on **Base UI** with the **nova** style and Lucide icons. Only the components we use are installed (see Known Gaps).

- **Buttons:** 36px tall (44px on touch). Variants: `default` (primary), `outline` (secondary), `ghost`, `destructive`, `link`. Pressing scales the button to 0.97 for 120ms.
- **Tool buttons:** 32px squares (44px on touch), ghost when idle. The compact dock is part of the Dock tray layout. The active tool gets a `primary-subtle` fill with a `primary` icon. Tooltips show the name plus the shortcut in a `kbd`.
- **Inputs:** 36px, 8px radius, hairline border, 2px focus ring with a 2px offset.
- **Menus and popovers:** popover elevation and 12px radius. Items are 32px tall with 6px radius, and the highlight uses `accent`.
- **Toasts:** bottom-center above the dock on the Board, bottom-right on the dashboard. Errors say what happened and what to do next.

### Canvas

- **Dot grid:** a 1px dot every 24 canvas units in `grid-dot`. Below 50% zoom the spacing doubles. Below 25% the grid fades out entirely. It can be toggled in the Board menu.
- **Local selection:** a 1.5px `primary` outline. Handles are 8×8px white squares with a 1.5px `primary` border and 2px radius. They keep a constant screen size at any zoom.
- **Marquee:** `primary` at 8% opacity, with a 1px `primary` border.
- **Remote selection:** a 1.5px outline in the Collaborator's presence color, plus a small name tag.
- **Cursors:** a 16px arrow in the presence color with a 1.5px white outline. The label pill sits below and to the right, with white `label` text, and fades out after 3s without movement. Motion is smoothed with `perfect-cursors`.
- **Comment pins:** a 28px teardrop pointing to its anchor, on `surface` with panel elevation, showing the author's initials or the reply count. A Detached Thread pin is at 50% opacity with a dashed border. Resolved pins are hidden unless the filter is on.
- **Lock:** a locked Element shows a small lock badge on hover, with no other visual change.

## Motion

Motion confirms what you did and never slows you down (emil-design-eng).

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
- **v0 values:** colors pass the contrast math, but the shadows, dark-mode sticky colors, and spacing still need to be checked visually on the `/design` page.
- **Deviation from the shadcn skill:** we install only the components we use instead of `add --all`. The `/design` page coverage check runs against the installed set.

## Iteration Guide

1. Change the value **here** first, with the reason in the commit message.
2. Mirror it in `apps/web` theme CSS (`:root`, `.dark`, `@theme inline`).
3. Check the `/design` page in both themes. Text pairs must stay ≥ 4.5:1 and strokes ≥ 3:1.
4. If a rule changes (not only a value), update the Do's and Don'ts table.
5. Run an emil-design-eng review on any new or changed motion.
