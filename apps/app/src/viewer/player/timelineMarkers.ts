import type { PlayerMeta, ReplayComment, Round } from '@/viewer/domain/schema'
import { commentDuration } from '@/viewer/comments/commentAnchor'
import { roundSides } from '@/viewer/domain/rounds'
import { SIDE_COLOR } from '@/viewer/domain/colors'

/**
 * Marker placed on the round timeline (an instant in seconds). This is the
 * extension point to enrich the timeline: today it marks the bomb plant, the
 * kills and comments; later, 1vX, etc. Just add `kind`s and push markers in
 * `buildTimelineMarkers`.
 */
export interface TimelineMarker {
  /** Instante no round, em segundos. */
  t: number
  /** Fim do intervalo, em segundos: marcadores com duração (comentários) viram
   *  uma faixa de `t` a `endT`; sem ele, um risco pontual. */
  endT?: number
  kind: 'plant' | 'kill' | 'comment' | 'explode'
  /** Cor do risco/faixa na timeline. */
  color: string
  /** Texto do tooltip. */
  label: string
}

/** Derives the markers for a round. Extensible: add new `push` calls here.
 *  `comments` are the user comments anchored to this round (already filtered);
 *  `playersById` resolves the kill markers' tooltip names. */
export function buildTimelineMarkers(
  round: Round | null,
  comments?: ReplayComment[],
  playersById?: Map<string, PlayerMeta>,
): TimelineMarker[] {
  if (!round) return []
  const markers: TimelineMarker[] = []

  // One tick per kill, colored by the killer's side (CT/T); neutral when the
  // death has no attacker (suicide / world). Tooltip shows killer ✖ victim.
  const sides = roundSides(round)
  const nameOf = (id: string | null) =>
    (id && playersById?.get(id)?.name) || id || '?'
  for (const ev of round.events) {
    if (ev.type !== 'kill') continue
    const killerSide = ev.attackerSteamId ? sides.get(ev.attackerSteamId) : null
    markers.push({
      t: ev.t,
      kind: 'kill',
      color: killerSide ? SIDE_COLOR[killerSide] : '#8a93a6',
      label: ev.attackerSteamId
        ? `${nameOf(ev.attackerSteamId)} ✖ ${nameOf(ev.victimSteamId)}`
        : nameOf(ev.victimSteamId),
    })
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
