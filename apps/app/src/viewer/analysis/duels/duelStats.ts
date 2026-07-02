// Pure aggregation helpers for the Duels tab, mirroring CS Demo Manager's duels
// analysis: a killer x victim duel matrix and the opening-duel (first kill of the
// round) breakdown. Everything is derived from the kill events already in the
// replay, so the parser needs no changes.
import type { Replay, Round, Side } from '@/viewer/domain/schema'
import { isKnifeRound, roundDisplayLabels, roundSides } from '@/viewer/domain/rounds'

/**
 * killer steamId -> victim steamId -> kill count across the whole match.
 * Knife round excluded; suicides / bomb deaths (no attacker) are not duels.
 */
export function computeDuelMatrix(replay: Replay): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>()
  const add = (killer: string, victim: string) => {
    let row = matrix.get(killer)
    if (!row) matrix.set(killer, (row = new Map()))
    row.set(victim, (row.get(victim) ?? 0) + 1)
  }
  for (const round of replay.rounds) {
    if (isKnifeRound(round)) continue
    for (const ev of round.events) {
      if (ev.type !== 'kill' || !ev.attackerSteamId) continue
      add(ev.attackerSteamId, ev.victimSteamId)
    }
  }
  return matrix
}

/**
 * The opening duel of a round: its first player kill (earliest tick with a real
 * attacker). The attacker won the duel, the victim lost it. Carries the victim's
 * death position (from the kill event) for the map; the attacker's position is
 * resolved from the frames by the view that needs it.
 */
export interface OpeningDuel {
  /** Index into `replay.rounds` (raw, so it survives a knife round). */
  roundIndex: number
  roundNumber: number
  tick: number
  /** Seconds since the round `freezeStartTick`. */
  t: number
  /** Attacker (took the opening kill). */
  winnerSteamId: string
  /** Victim (lost the opening duel). */
  loserSteamId: string
  /** Side each player was on in that round (from the live frames). */
  winnerSide: Side | null
  loserSide: Side | null
  /** Side that won the round, to measure whether the opening converted. */
  roundWinner: Side | null
  /** The entry winner was traded: killed by an enemy within `TRADE_WINDOW_SECONDS`
   *  of the opening kill, so the opening did not leave a real man advantage. */
  traded: boolean
  weapon: string
  headshot: boolean
  /** Victim (loser) death position, in game units. */
  vx: number
  vy: number
  vz: number
}

/** Seconds within which a kill on the entry winner counts as a trade. */
export const TRADE_WINDOW_SECONDS = 5

/** One opening duel per round (knife round and rounds without a player kill skipped). */
export function computeOpeningDuels(replay: Replay): OpeningDuel[] {
  const out: OpeningDuel[] = []
  // Displayed round numbers (pre-game rounds collapsed to "0"), so the first real
  // round reads as R1 even when the demo opens with a phantom/knife round (GC).
  const labels = roundDisplayLabels(replay.rounds)
  replay.rounds.forEach((round: Round, idx) => {
    if (isKnifeRound(round)) return
    let first: Extract<Round['events'][number], { type: 'kill' }> | null = null
    for (const ev of round.events) {
      if (ev.type !== 'kill' || !ev.attackerSteamId) continue
      // Skip non-duel deaths: a suicide / world death (a disconnect is recorded
      // as a self "world" kill) is not an opening duel; fall through to the
      // round's first real player-vs-player kill instead.
      if (ev.attackerSteamId === ev.victimSteamId || ev.weapon === 'world') continue
      if (!first || ev.tick < first.tick) first = ev
    }
    if (!first || !first.attackerSteamId) return
    const sides = roundSides(round)
    const winnerSide = sides.get(first.attackerSteamId) ?? null
    // Traded: the entry winner is killed by an enemy within the trade window.
    const traded = round.events.some(
      (ev) =>
        ev.type === 'kill' &&
        ev.victimSteamId === first!.attackerSteamId &&
        ev.t > first!.t &&
        ev.t <= first!.t + TRADE_WINDOW_SECONDS &&
        !!ev.attackerSteamId &&
        (sides.get(ev.attackerSteamId) ?? null) !== winnerSide,
    )
    out.push({
      roundIndex: idx,
      // Displayed number (pre-game rounds excluded); falls back to the raw number.
      roundNumber: Number(labels[idx]) || round.number,
      tick: first.tick,
      t: first.t,
      winnerSteamId: first.attackerSteamId,
      loserSteamId: first.victimSteamId,
      winnerSide,
      loserSide: sides.get(first.victimSteamId) ?? null,
      roundWinner: round.winner,
      traded,
      weapon: first.weapon,
      headshot: first.headshot,
      vx: first.x,
      vy: first.y,
      vz: first.z,
    })
  })
  return out
}
