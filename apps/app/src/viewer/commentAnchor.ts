/**
 * Time/space resolution for comments: how long one stays visible and where it
 * sits at the current moment (a player-anchored comment follows that player).
 */
import type { PlayerState, ReplayComment } from '@/viewer/schema'

/** Fallback visible window (seconds) for a comment with no stored duration. */
export const DEFAULT_COMMENT_DURATION = 5

/** Effective duration: the stored value, or the default for older comments. */
export function commentDuration(comment: ReplayComment): number {
  return comment.duration > 0 ? comment.duration : DEFAULT_COMMENT_DURATION
}

/** Whether the comment is visible at round-time `t` (within [t, t+duration]). */
export function isCommentActive(comment: ReplayComment, t: number): boolean {
  return t >= comment.t && t <= comment.t + commentDuration(comment)
}

/**
 * Where the comment sits right now. A player-anchored comment tracks that
 * player's interpolated position (`players` are the states at the current time);
 * a point/grenade comment stays at its fixed `x,y`. Falls back to `x,y` when the
 * followed player isn't in the frame (dead/absent).
 */
export function commentPositionAt(
  comment: ReplayComment,
  players: PlayerState[],
): { x: number; y: number } {
  const anchor = comment.anchor
  if (anchor?.kind === 'player') {
    const p = players.find((pl) => pl.steamId === anchor.steamId)
    if (p) return { x: p.x, y: p.y }
  }
  if (anchor?.kind === 'area') {
    // Anchor the bubble at the rectangle's top-middle (top = larger world y).
    return { x: (comment.x + anchor.x2) / 2, y: Math.max(comment.y, anchor.y2) }
  }
  return { x: comment.x, y: comment.y }
}
