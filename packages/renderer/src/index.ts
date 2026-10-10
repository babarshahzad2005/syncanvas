/** Canvas units between grid dots at 100% zoom (DESIGN.md: Canvas → Dot grid). */
export const GRID_SPACING = 24

/**
 * Dot-grid spacing and opacity for a zoom level: spacing doubles below 50%,
 * and the grid fades out between 50% and 25%.
 */
export function gridAt(zoom: number): { spacing: number; opacity: number } {
  const spacing = zoom < 0.5 ? GRID_SPACING * 2 : GRID_SPACING
  const opacity = zoom >= 0.5 ? 1 : zoom <= 0.25 ? 0 : (zoom - 0.25) / 0.25
  return { spacing, opacity }
}
