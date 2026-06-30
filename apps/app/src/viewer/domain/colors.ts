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

/**
 * Stable team-identity colors by team id (0/1, as ordered by `groupTeams`).
 * Identity, not side: a team keeps its color across the halftime side swap, so
 * the economy charts and the buy sheet stay consistent.
 */
export const TEAM_COLOR = ['#e0b341', '#6b78e0'] as const

/**
 * CS2 competitive teammate colors by `PlayerMeta.compColor` index (the in-game
 * radar/scoreboard colors): 0 green, 1 yellow, 2 orange, 3 purple, 4 blue.
 */
export const PLAYER_COLOR = ['#4cd24c', '#e6d635', '#e8923a', '#c057cf', '#4a9eea'] as const

/** Hex for a `compColor` index, or null when unassigned (-1 / absent). */
export function playerColor(index: number | undefined | null): string | null {
  return index != null && index >= 0 && index < PLAYER_COLOR.length ? PLAYER_COLOR[index] : null
}
