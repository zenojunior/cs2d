// Pure aggregation helpers for the Utilities tab (flashes and HE/molotov damage),
// mirroring CS Demo Manager's grenade analysis: per-player metrics grouped by
// team, plus a flasher x victim blind-duration matrix. Round/team primitives
// (sides, flash-assist definition) live in `domain/rounds` and `domain/teams`.
import type { KillEvent, Replay } from '@/viewer/domain/schema'
import { flashSetupForKill, roundSides } from '@/viewer/domain/rounds'

export interface FlashStat {
  /** Flashbangs thrown by the player. */
  thrown: number
  /** Enemies blinded (one count per enemy blind event). */
  enemiesBlinded: number
  /** Total blind seconds inflicted on enemies. */
  enemyBlindDuration: number
  /** Enemies blinded by this player who were killed while still blind (the
   *  flash had a real impact). Sum of the two below. */
  killsFromBlinds: number
  /** ...killed by the flasher themselves (blinded then fragged). */
  selfFlashKills: number
  /** ...killed by a teammate of the flasher (a flash that set up the kill). */
  flashAssists: number
}

/** A drill-down line shown in a grid cell's popover (one play). */
export interface CellDetail {
  key: string
  /** Main line (e.g. what happened). */
  text: string
  /** Secondary line (e.g. round, time, weapon). */
  sub?: string
  /** Replay seek target, when the line is clickable. */
  jump?: { roundIndex: number; t: number }
  /** When present, clicking the line opens a looping mini-clip popover of the
   *  moment (with a "watch in match" button) instead of seeking straight away. */
  clip?: {
    round: number
    /** "Watch in match" seek target (seconds since freeze). */
    jumpT: number
    /** Clip window within the round (seconds since freeze). */
    from: number
    to: number
    /** Players to frame in the clip (e.g. flasher + victim + killer). */
    focusSteamIds: string[]
  }
}

/** A single flash that led to a kill, for the drill-down popover. */
export interface FlashPlay {
  roundNumber: number
  roundIndex: number
  /** Blind start (seconds since freeze) of the flash, used to seek the replay. */
  blindT: number
  /** Moment the blinded victim was killed (seconds since freeze). */
  killT: number
  victimSteamId: string
  killerSteamId: string
  /** Kill-event weapon code (e.g. "ak47"). */
  weapon: string
  /** 'self' = the flasher fragged the blind victim; 'assist' = a teammate did. */
  type: 'self' | 'assist'
}

export interface FlashStats {
  byPlayer: Map<string, FlashStat>
  /** flasher steamId -> victim steamId -> total blind seconds (allies included). */
  matrix: Map<string, Map<string, number>>
  /** flasher steamId -> the plays behind their killsFromBlinds, in time order. */
  playsByPlayer: Map<string, FlashPlay[]>
  roundCount: number
}

/** Aggregates flash metrics and the blind-duration matrix over the whole match. */
export function computeFlashStats(replay: Replay): FlashStats {
  const byPlayer = new Map<string, FlashStat>()
  const matrix = new Map<string, Map<string, number>>()
  const playsByPlayer = new Map<string, FlashPlay[]>()
  const stat = (id: string): FlashStat => {
    let s = byPlayer.get(id)
    if (!s)
      byPlayer.set(
        id,
        (s = {
          thrown: 0,
          enemiesBlinded: 0,
          enemyBlindDuration: 0,
          killsFromBlinds: 0,
          selfFlashKills: 0,
          flashAssists: 0,
        }),
      )
    return s
  }

  replay.rounds.forEach((round, roundIndex) => {
    for (const path of round.grenadePaths) {
      if (path.kind === 'flash' && path.throwerSteamId) stat(path.throwerSteamId).thrown += 1
    }
    const sides = roundSides(round)
    for (const b of round.blinds) {
      const flasher = b.flasherSteamId
      if (!flasher) continue
      // Matrix counts every blind (allies included), like CSDM.
      let row = matrix.get(flasher)
      if (!row) matrix.set(flasher, (row = new Map()))
      row.set(b.steamId, (row.get(b.steamId) ?? 0) + b.duration)
      // Per-player metrics count enemies only.
      const vSide = sides.get(b.steamId)
      const fSide = sides.get(flasher)
      if (vSide && fSide && vSide !== fSide) {
        const s = stat(flasher)
        s.enemiesBlinded += 1
        s.enemyBlindDuration += b.duration
      }
    }

    // Flash impact: an enemy killed while still blinded credits the flasher.
    // Each kill is attributed to at most one flash (the most recent active one
    // on the victim) to avoid double counting, and only when the flasher is on
    // the killer's team (a team flash that got someone killed does not count).
    for (const e of round.events) {
      if (e.type !== 'kill') continue
      const kill = e as KillEvent
      const killer = kill.attackerSteamId
      if (!killer) continue
      const best = flashSetupForKill(round, kill, sides)
      if (!best) continue
      const s = stat(best.flasher)
      s.killsFromBlinds += 1
      const type: 'self' | 'assist' = best.flasher === killer ? 'self' : 'assist'
      if (type === 'self') s.selfFlashKills += 1
      else s.flashAssists += 1
      let plays = playsByPlayer.get(best.flasher)
      if (!plays) playsByPlayer.set(best.flasher, (plays = []))
      plays.push({
        roundNumber: round.number,
        roundIndex,
        blindT: best.blindT,
        killT: kill.t,
        victimSteamId: kill.victimSteamId,
        killerSteamId: killer,
        weapon: kill.weapon,
        type,
      })
    }
  })

  return { byPlayer, matrix, playsByPlayer, roundCount: replay.rounds.length }
}

export interface DamageStat {
  /** HE + molotov/incendiary grenades thrown. */
  thrown: number
  /** Utility health damage dealt. */
  damage: number
  /** Kills with HE/molotov. */
  kills: number
}

export interface DamageStats {
  byPlayer: Map<string, DamageStat>
  roundCount: number
}

/** Weapon classnames (kill events) counted as utility kills. */
function isUtilityKillWeapon(weapon: string): boolean {
  const w = weapon.toLowerCase()
  return w.includes('hegrenade') || w.includes('inferno') || w.includes('molotov') || w.includes('incgrenade')
}

/** Aggregates HE/molotov damage metrics over the whole match. */
export function computeDamageStats(replay: Replay): DamageStats {
  const byPlayer = new Map<string, DamageStat>()
  const stat = (id: string): DamageStat => {
    let s = byPlayer.get(id)
    if (!s) byPlayer.set(id, (s = { thrown: 0, damage: 0, kills: 0 }))
    return s
  }

  for (const round of replay.rounds) {
    for (const path of round.grenadePaths) {
      if ((path.kind === 'he' || path.kind === 'fire') && path.throwerSteamId) stat(path.throwerSteamId).thrown += 1
    }
    for (const [id, dmg] of Object.entries(round.utilityDamage ?? {})) stat(id).damage += dmg
    for (const e of round.events) {
      if (e.type !== 'kill') continue
      const kill = e as KillEvent
      if (kill.attackerSteamId && isUtilityKillWeapon(kill.weapon)) stat(kill.attackerSteamId).kills += 1
    }
  }

  return { byPlayer, roundCount: replay.rounds.length }
}
