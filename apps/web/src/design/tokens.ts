// Values from DESIGN.md that aren't CSS variables yet (sticky notes and presence arrive in M1/M2).
// Keep in sync with DESIGN.md frontmatter.

export const STICKY = {
  yellow: ["#FFE58A", "#E6CF7A"],
  orange: ["#FFC99A", "#E6B48A"],
  pink: ["#FFC2DD", "#E6AEC6"],
  violet: ["#D9C8FF", "#C3B4E6"],
  blue: ["#BFD9FF", "#ABC3E6"],
  green: ["#C3EBC4", "#AFD3B0"],
} as const
export const STICKY_TEXT = "#1C1B19"

export const PRESENCE = [
  ["red", "#C62828"],
  ["orange", "#C2410C"],
  ["amber", "#A16207"],
  ["lime", "#4D7C0F"],
  ["green", "#15803D"],
  ["teal", "#0F766E"],
  ["sky", "#0369A1"],
  ["blue", "#1D4ED8"],
  ["purple", "#7E22CE"],
  ["fuchsia", "#A21CAF"],
  ["pink", "#BE185D"],
  ["brown", "#8B5E34"],
  ["guest", "#57534E"],
] as const

export const CANVAS_BG = { light: "#F8F7F4", dark: "#161514" } as const

export const TYPE_SCALE = [
  [
    "type-display",
    "32 / 40 · 600 · −0.02em",
    "Dashboard page title only",
    "Let's make your first board",
  ],
  [
    "type-title",
    "20 / 28 · 600 · −0.01em",
    "Dialog titles, section headers",
    "Start something new",
  ],
  ["type-heading", "16 / 24 · 600 · −0.005em", "Card titles, wordmark", "Q4 product retro"],
  [
    "type-body",
    "14 / 20 · 400",
    "Running text, inputs, menus",
    "Edits sync live and keep working offline.",
  ],
  ["type-body-strong", "14 / 20 · 500", "Board titles, emphasized labels", "Onboarding flow v2"],
  ["type-label", "12 / 16 · 500", "Pills, tabs, cursor labels", "Shared with me"],
  ["type-caption", "12 / 16 · 400", "Meta text, hints", "Edited 12 minutes ago"],
  ["type-mono", "12 / 16 · 450 · Geist Mono", "Shortcuts, zoom %, numbers", "Ctrl Z · 100%"],
] as const

export const SPACING = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const

export const RADII = [
  ["rounded-sm", 4, "Small accents, kbd"],
  ["rounded-md", 6, "Menu items, list rows"],
  ["rounded-lg", 8, "Buttons, inputs, tool buttons"],
  ["rounded-xl", 12, "Floating panels, dock, cards, popovers"],
  ["rounded-2xl", 16, "Toasts, large containers"],
  ["rounded-full", 9999, "Avatars, pills, cursor labels"],
] as const

export const MOTION = [
  ["--duration-press", "120ms", "Button press (scale 0.97)"],
  ["--duration-tooltip", "150ms", "Tooltips; later ones open instantly"],
  ["--duration-menu", "180ms", "Menus and popovers (scale from 0.95–0.97)"],
  ["--duration-panel", "220ms", "Panels, the dock's style tray"],
  ["--duration-dialog", "240ms", "Dialogs"],
  ["--ease-out", "cubic-bezier(0.23, 1, 0.32, 1)", "Anything entering (default)"],
  ["--ease-in-out", "cubic-bezier(0.77, 0, 0.175, 1)", "Movement on screen"],
] as const

/** WCAG contrast ratio between two hex colors. */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(bl ?? 0)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}
