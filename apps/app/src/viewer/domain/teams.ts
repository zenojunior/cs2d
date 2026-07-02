// Team identity: split the match players into the two stable teams (started-CT
// vs started-T), named from a reference round's clan names. Pure over a parsed
// `Replay`; shared by the analysis tabs that group per-player stats by team.
import type { Replay, Side } from '@/viewer/domain/schema'
import { isPreGameRound, roundSides } from '@/viewer/domain/rounds'

export interface TeamPlayer {
  steamId: string
  name: string
}

export interface Team {
  /** 0 = started CT, 1 = started T (stable team identity). */
  id: 0 | 1
  name: string
  players: TeamPlayer[]
}

/**
 * Splits the match players into the two teams, naming each from the reference
 * round's clan names. Players are listed in the replay's order.
 *
 * Names and sides must come from the *same* reference round, the first live
 * (non-knife) one. When the match opens with a knife round, the side pick happens
 * during the pistol round's freeze, so the clan names (captured at that freeze)
 * are post-swap, while `player.startSide` (the parser's first-seen frame) still
 * carries the knife-round side. Grouping by `startSide` would then put each
 * player under the opposite team's name. Reading sides from the reference round's
 * live frames (via `roundSides`) keeps both in sync; `startSide` is only a
 * fallback for a player absent from that round's frames.
 */
export function groupTeams(replay: Replay): Team[] {
  const ref = replay.rounds.find((r) => !isPreGameRound(r)) ?? replay.rounds[0]
  const ctName = ref?.ctName || ''
  const tName = ref?.tName || ''
  const sides = ref ? roundSides(ref) : new Map<string, Side>()
  const onSide = (side: Side) =>
    replay.players
      .filter((p) => (sides.get(p.steamId) ?? p.startSide) === side)
      .map((p) => ({ steamId: p.steamId, name: p.name }))
  return [
    { id: 0, name: ctName, players: onSide('CT') },
    { id: 1, name: tName, players: onSide('T') },
  ]
}
