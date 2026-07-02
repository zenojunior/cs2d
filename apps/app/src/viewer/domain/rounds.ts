// Pure round-structure helpers over a parsed `Replay`: per-player sides, knife /
// pre-game round detection, display numbering, and the flash-assist definition.
// Shared by the player (killfeed, replay clock, timeline) and the analysis tabs,
// so they live in `domain/` rather than under any single feature.
import type { KillEvent, Round, Side } from '@/viewer/domain/schema'

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
