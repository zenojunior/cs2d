import type { KillEvent, Replay } from '@/viewer/domain/schema'
import { isKnifeRound, roundSides } from '@/viewer/domain/rounds'

/** Whole-match combat numbers for one player (knife rounds excluded). */
export interface PlayerPerformance {
  roundsPlayed: number
  kills: number
  assists: number
  deaths: number
  damage: number
  headshotKills: number
  /** Deaths to an enemy; with `kills` (enemy kills only, no team kills or
   *  suicides) it gives the duel win rate. */
  duelLosses: number
  plants: number
  defuses: number
}

const empty = (): PlayerPerformance => ({
  roundsPlayed: 0,
  kills: 0,
  assists: 0,
  deaths: 0,
  damage: 0,
  headshotKills: 0,
  duelLosses: 0,
  plants: 0,
  defuses: 0,
})

function isEnemyKill(sides: ReturnType<typeof roundSides>, kill: KillEvent): boolean {
  if (!kill.attackerSteamId || kill.attackerSteamId === kill.victimSteamId) return false
  const attackerSide = sides.get(kill.attackerSteamId)
  const victimSide = sides.get(kill.victimSteamId)
  return !!attackerSide && !!victimSide && attackerSide !== victimSide
}

/** Per-player performance over the match, keyed by steamId. Every roster player
 *  gets an entry, so the grid shows zeros instead of blanks. */
export function computePlayerPerformance(replay: Replay): Map<string, PlayerPerformance> {
  const out = new Map<string, PlayerPerformance>(replay.players.map((p) => [p.steamId, empty()]))
  const get = (id: string) => {
    let s = out.get(id)
    if (!s) out.set(id, (s = empty()))
    return s
  }
  for (const round of replay.rounds) {
    if (isKnifeRound(round)) continue
    const sides = roundSides(round)
    for (const id of sides.keys()) {
      const s = get(id)
      s.roundsPlayed += 1
      s.damage += round.damage?.[id] ?? 0
    }
    for (const event of round.events) {
      if (event.type === 'kill') {
        const kill = event as KillEvent
        const enemyKill = isEnemyKill(sides, kill)
        if (kill.attackerSteamId && enemyKill) {
          const attacker = get(kill.attackerSteamId)
          attacker.kills += 1
          if (kill.headshot) attacker.headshotKills += 1
        }
        if (kill.assisterSteamId) get(kill.assisterSteamId).assists += 1
        const victim = get(kill.victimSteamId)
        victim.deaths += 1
        if (enemyKill) victim.duelLosses += 1
      } else if (event.type === 'bomb_planted' && event.playerSteamId) {
        get(event.playerSteamId).plants += 1
      } else if (event.type === 'bomb_defused' && event.playerSteamId) {
        get(event.playerSteamId).defuses += 1
      }
    }
  }
  return out
}
