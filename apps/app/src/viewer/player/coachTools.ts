/**
 * Coach mode: the tactical-board layer over the map. The transport bar collapses
 * to bare navigation (play/pause + timeline) and a Figma-style toolbar takes over
 * so a coach can mark the map up: rectangles, circles, arrows and freehand paths.
 *
 * Drawings live in world coordinates (see `w2s`/`s2w` in ViewerMap) so they track
 * zoom and pan, and they are scoped to the round in view, like comments.
 */

import type { GrenadeKind } from '@/viewer/domain/schema'

/** Shape tools: each produces a `CoachDrawing`. */
export type CoachShapeTool = 'rectangle' | 'circle' | 'arrow' | 'path'

/** A coach toolbar mode: `select` edits/moves, shape tools draw, `grenade` places. */
export type CoachTool = 'select' | CoachShapeTool | 'grenade'

/** Narrowing guard: is this tool one that draws a shape? */
export function isShapeTool(t: CoachTool | undefined): t is CoachShapeTool {
  return t === 'rectangle' || t === 'circle' || t === 'arrow' || t === 'path'
}

/** A shape drawn on the tactical board, scoped to one round and stored in world
 *  coordinates so it tracks zoom/pan. Two-point tools (rectangle, circle, arrow)
 *  keep `[start, end]`; freehand `path` keeps every sampled point. */
export interface CoachDrawing {
  id: string
  roundIndex: number
  tool: CoachShapeTool
  points: { x: number; y: number }[]
  color: string
  /** Stroke width in world-unit pixels at 1x zoom (scaled by zoom when drawn). */
  thickness: number
  /** Floor Z (multi-level maps) the drawing belongs to; undefined = all floors. */
  z?: number
}

/** A grenade placed on the tactical board (world coords). */
export interface CoachGrenade {
  id: string
  kind: GrenadeKind
  x: number
  y: number
  /** Floor Z (multi-level maps) the grenade belongs to; undefined = all floors. */
  z?: number
}

/** Grenade kinds offered by the grenade tool, in toolbar order. */
export const COACH_GRENADE_KINDS: GrenadeKind[] = ['smoke', 'fire', 'he', 'flash', 'decoy']

/** Stroke palette offered in the toolbar. Bright on the dark radar. */
export const COACH_COLORS = ['#ff4d4f', '#ffd400', '#36d399', '#3b9dff', '#ffffff', '#000000'] as const

/** Stroke widths (world-unit pixels at 1x zoom). */
export const COACH_THICKNESSES = [1, 2, 4, 6] as const

/** Default tool/color/thickness when entering coach mode. */
export const COACH_DEFAULT_TOOL: CoachTool = 'path'
export const COACH_DEFAULT_COLOR: string = COACH_COLORS[0]
export const COACH_DEFAULT_THICKNESS: number = COACH_THICKNESSES[2]

/** Lucide-style icon name for each tool (registered in UiIcon). */
export const COACH_TOOL_ICON: Record<CoachTool, string> = {
  select: 'mouse-pointer',
  rectangle: 'square',
  circle: 'circle',
  arrow: 'arrow-up-right',
  path: 'route',
  grenade: 'flame',
}
