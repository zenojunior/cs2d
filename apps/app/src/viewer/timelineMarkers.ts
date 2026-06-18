import type { ReplayComment, Round } from '@/viewer/schema'
import { commentDuration } from '@/viewer/commentAnchor'

/**
 * Marker placed on the round timeline (an instant in seconds). This is the
 * extension point to enrich the timeline: today it marks the bomb plant; later,
 * first kill, comments, 1vX, etc. Just add `kind`s and push markers in
 * `buildTimelineMarkers`.
 */
export interface TimelineMarker {
  /** Instante no round, em segundos. */
  t: number
  /** Fim do intervalo, em segundos: marcadores com duração (comentários) viram
   *  uma faixa de `t` a `endT`; sem ele, um risco pontual. */
  endT?: number
  kind: 'plant' | 'firstkill' | 'comment' | 'explode'
  /** Cor do risco/faixa na timeline. */
  color: string
  /** Texto do tooltip. */
  label: string
}

/** Derives the markers for a round. Extensible: add new `push` calls here.
 *  `comments` are the user comments anchored to this round (already filtered). */
export function buildTimelineMarkers(
  round: Round | null,
  comments?: ReplayComment[],
): TimelineMarker[] {
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

  for (const c of comments ?? []) {
    markers.push({
      t: c.t,
      endT: c.t + commentDuration(c),
      kind: 'comment',
      color: '#ffffff',
      label: c.text || 'Comentário',
    })
  }

  return markers
}
