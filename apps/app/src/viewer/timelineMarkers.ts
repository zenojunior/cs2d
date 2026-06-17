import type { Round } from '@/viewer/schema'

/**
 * Marker placed on the round timeline (an instant in seconds). This is the
 * extension point to enrich the timeline: today it marks the bomb plant; later,
 * first kill, comments, 1vX, etc. Just add `kind`s and push markers in
 * `buildTimelineMarkers`.
 */
export interface TimelineMarker {
  /** Instante no round, em segundos. */
  t: number
  kind: 'plant' | 'firstkill' | 'comment' | 'explode'
  /** Cor do risco na timeline. */
  color: string
  /** Texto do tooltip. */
  label: string
}

/** Derives the markers for a round. Extensible: add new `push` calls here. */
export function buildTimelineMarkers(round: Round | null): TimelineMarker[] {
  if (!round) return []
  const markers: TimelineMarker[] = []

  const firstKill = round.events.find((e) => e.type === 'kill')
  if (firstKill) {
    markers.push({ t: firstKill.t, kind: 'firstkill', color: '#ffb020', label: 'First kill' })
  }

  const plant = round.bomb.find((b) => b.state === 'planted')
  if (plant) {
    markers.push({ t: plant.t, kind: 'plant', color: '#ff4d5e', label: 'Bomba plantada' })
  }

  const explode = round.events.find((e) => e.type === 'bomb_exploded')
  if (explode) {
    markers.push({ t: explode.t, kind: 'explode', color: '#ff6b35', label: 'Bomba explodiu' })
  }

  // Future: comments, 1vX, bomb site rotation, etc.

  return markers
}
