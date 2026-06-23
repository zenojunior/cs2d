// Pure aggregation helpers for the Utilities tab (flashes and HE/molotov damage),
// mirroring CS Demo Manager's grenade analysis: per-player metrics grouped by
// team, plus a flasher x victim blind-duration matrix.
import type { KillEvent, Replay, Round, Side } from '@/viewer/domain/schema'

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
 * Each player's side in a round, read from the live frames (after `startTick`).
 *
 * Live frames matter at the pistol round: when the match opens with a knife
 * round, the side pick happens *during* the pistol round's freeze time, so its
 * first frames still carry the knife-round sides before the swap. Reading the
 * first frame would invert CT/T there. Live frames always carry the real round
 * sides. First occurrence wins, so a player who dies early still gets a side.
 *
 * A second pass over every frame fills any player who never appears live (e.g.
 * disconnected during freeze), so they still get a side instead of rendering
 * gray; live frames already won for everyone present, so this never re-inverts.
 */
export function roundSides(round: Round): Map<string, Side> {
  const m = new Map<string, Side>()
  for (const f of round.frames) {
    if (f.tick < round.startTick) continue
    for (const p of f.players) {
      if (!m.has(p.steamId)) m.set(p.steamId, p.side)
    }
  }
  for (const f of round.frames) {
    for (const p of f.players) {
      if (!m.has(p.steamId)) m.set(p.steamId, p.side)
    }
  }
  return m
}

/**
 * Knife round: some servers (FACEIT, scrims) open with a knife-only round to
 * pick sides. It does not count on the scoreboard, so we detect it by the
 * absence of any weapon other than the knife across all samples.
 */
export function isKnifeRound(round: Round): boolean {
  return (
    round.frames.length > 0 &&
    round.frames.every((f) =>
      f.players.every((p) => p.weapon === 'Faca' || p.weapon === ''),
    )
  )
}

/**
 * A pre-game round that precedes the real match and does not count on the
 * scoreboard: the knife round (knife-only frames) or a frameless "result" round
 * some platforms emit alongside it. FACEIT opens with a single knife round;
 * Gamers Club emits two (a 0-frame result round + the knife frames), so the
 * opener cannot be assumed to be a single round.
 */
export function isPreGameRound(round: Round): boolean {
  return round.frames.length === 0 || isKnifeRound(round)
}

/**
 * Count of leading pre-game rounds (knife / frameless openers). Only leading
 * rounds count, so a pathological frameless round mid-match never shifts the
 * numbering. Returns 0 when every round looks pre-game (nothing real to anchor).
 */
export function preGameRoundCount(rounds: Round[]): number {
  let n = 0
  while (n < rounds.length && isPreGameRound(rounds[n])) n++
  return n >= rounds.length ? 0 : n
}

/**
 * Display label per round: leading pre-game rounds are "0" (hidden where the UI
 * hides the knife round); the real match rounds are numbered from 1. Replaces
 * the old "knife at index 0 only" assumption, which mis-numbered Gamers Club
 * demos (two opener rounds). With no pre-game round, the parser's `number` is
 * kept (matchmaking demos, where it is the source of truth).
 */
export function roundDisplayLabels(rounds: Round[]): string[] {
  const preGame = preGameRoundCount(rounds)
  return rounds.map((r, i) =>
    i < preGame ? '0' : preGame === 0 ? String(r.number) : String(i - preGame + 1),
  )
}

/**
 * The flash that set up a kill: the most recent blind still active on the victim
 * at the moment of death, thrown by someone on the killer's team against an
 * enemy. Returns the flasher (which may be the killer themselves, a self-flash)
 * and the blind start, or null when no flash set up the kill.
 *
 * This is the demo-independent definition of a flash assist, used both by the
 * Utilities stats and to surface the killfeed icon when the demo never set the
 * `assistedFlash` flag on `player_death` (some community/tournament servers).
 */
export function flashSetupForKill(
  round: Round,
  kill: KillEvent,
  sides: Map<string, Side>,
): { flasher: string; blindT: number } | null {
  const killer = kill.attackerSteamId
  if (!killer) return null
  let best: { flasher: string; blindT: number } | null = null
  for (const b of round.blinds) {
    if (b.steamId !== kill.victimSteamId || !b.flasherSteamId) continue
    if (kill.t >= b.t && kill.t <= b.t + b.duration && (!best || b.t > best.blindT)) {
      best = { flasher: b.flasherSteamId, blindT: b.t }
    }
  }
  if (!best) return null
  const fSide = sides.get(best.flasher)
  const kSide = sides.get(killer)
  const vSide = sides.get(kill.victimSteamId)
  if (fSide && kSide && fSide === kSide && vSide && vSide !== fSide) return best
  return null
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
