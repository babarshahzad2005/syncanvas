/**
 * Palette colors an Element can have (GLOSSARY: Palette color, ADR 0008).
 * Elements store the name; each theme maps it to its own shades (DESIGN.md `palette`).
 */
export const PALETTE_COLORS = [
  "ink",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const
export type PaletteColor = (typeof PALETTE_COLORS)[number]

export function isPaletteColor(value: unknown): value is PaletteColor {
  return typeof value === "string" && (PALETTE_COLORS as readonly string[]).includes(value)
}
