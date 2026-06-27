import type { Replay, Round } from '@/viewer/domain/schema'

/**
 * Round-time helpers shared by the heatmap pages. Event/frame `t` is seconds
 * since a round's `freezeStartTick`; the heatmaps filter on "live" time (since
 * the round went live), so the freeze duration is subtracted.
 */

/** Freeze-time duration of a round, in seconds. */
export function freezeSeconds(round: Round, demoTickRate: number): number {
  return (round.startTick - round.freezeStartTick) / demoTickRate
}

/**
 * Longest live round time across the match (excluding pauses): the time
 * slider's upper bound. While paused (tactical/tech timeouts) every player
 * stands frozen, so those frames are skipped rather than inflating the bound.
 */
export function maxLiveRoundTime(replay: Replay): number {
  const pauses = (replay.pauses ?? []).map((p) => [p.startTick, p.endTick] as const)
  const isPaused = (tick: number) => pauses.some(([s, e]) => tick >= s && tick <= e)
  let max = 0
  for (const round of replay.rounds) {
    const fz = freezeSeconds(round, replay.demoTickRate)
    for (const f of round.frames) {
      if (isPaused(f.tick)) continue
      max = Math.max(max, f.t - fz)
    }
  }
  return Math.ceil(max)
}
