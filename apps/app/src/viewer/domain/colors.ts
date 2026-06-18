import type { Side } from '@/viewer/domain/schema'

/**
 * Side colors, used in the canvas and the viewer panels. These are data colors
 * (player's side), so they count as hex applied via `:style` (design system
 * rule for data-driven colors).
 */
export const SIDE_COLOR: Record<Side, string> = {
  CT: '#418ac5',
  T: '#c7a247',
}
