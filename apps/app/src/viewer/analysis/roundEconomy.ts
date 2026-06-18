/**
 * Per-round economy, derived from the replay the parser already emits, mirroring
 * CS Demo Manager's analyzer (akiver/cs-demo-analyzer, `pkg/api/economy.go`).
 *
 * Two moments are sampled per round:
 *  - start money: each player's cash on the first frame (freeze start, before
 *    buying), summed per team. This is what CSDM's "Equipment value" line chart
 *    actually plots (a misnamed start-money chart).
 *  - equipment value + cash: sampled `EQUIP_DELAY_SECONDS` after freeze end (CSDM
 *    waits because players keep buying for a few seconds), summed per team. Drives
 *    the buy classification and the breakdown bars.
 *
 * Teams are tracked by a stable identity across the halftime / overtime side
 * swaps, so a team's rounds can be grouped even though its side (CT/T) flips.
 */
import type { Round, Side } from '@/viewer/domain/schema'

export type BuyType = 'pistol' | 'eco' | 'semi' | 'force-buy' | 'full'

/** Buy types in display order. */
export const BUY_TYPES: BuyType[] = ['pistol', 'eco', 'semi', 'force-buy', 'full']

/**
 * Color per buy type (data colors, applied via :style). A sequential ramp that
 * reads as rising investment (eco → full), with pistol as a distinct special
 * case. Tones are deep enough for the white value text drawn over the breakdown
 * bars to stay legible on the dark surface.
 */
export const BUY_COLOR: Record<BuyType, string> = {
  pistol: '#4f46e5', // indigo: special opening round
  eco: '#586277', // ink-400 grey: minimal investment
  semi: '#0f766e', // teal: partial buy
  'force-buy': '#b45309', // burnt amber: a hot, risky bet
  full: '#15803d', // green: full, confident buy
}

// CSDM thresholds (pkg/api/economy.go). All scale with the valid player count.
const EQUIP_DELAY_SECONDS = 7
const ECO_PER_PLAYER = 1000
const FULL_PER_PLAYER_CT = 4500
const FULL_PER_PLAYER_T = 4000
const FORCE_MONEY_PER_PLAYER = 400

export interface TeamRoundEconomy {
  /** Index in `rounds` (0-based). */
  roundIndex: number
  /** Displayed round number (knife round is 0). */
  roundNumber: number
  /** Side this team played in the round. */
  side: Side
  buyType: BuyType
  /** Team equipment value sampled 7s after freeze end (sum of the players). */
  equipValue: number
  /** Team cash at the start of the round, before buying (sum of the players). */
  startMoney: number
  won: boolean
}

export interface TeamEconomy {
  /** Stable team identity index (0 = started on CT, 1 = started on T). */
  id: 0 | 1
  /** Clan/team name (best effort from the demo; may be empty for pugs). */
  name: string
  /** Economy of every counted round this team played, in chronological order. */
  rounds: TeamRoundEconomy[]
}

export interface MatchEconomy {
  /** The two teams by stable identity. */
  teams: [TeamEconomy, TeamEconomy]
  /** Counted rounds (knife round excluded), for the per-round charts. */
  roundCount: number
}

/**
 * Knife round (FACEIT/scrims open with one to pick sides): the first round with
 * nothing but knives across all samples. It does not count, so it is excluded.
 */
function hasKnifeRound(rounds: Round[]): boolean {
  const r0 = rounds[0]
  if (!r0) return false
  return r0.frames.every((f) => f.players.every((p) => p.weapon === 'Faca' || p.weapon === ''))
}

/**
 * Sides sampled from the middle of the live window [startTick, endTick]. Sampling
 * by frame-array index is wrong when a round has a long post-round: the last round
 * of a half absorbs the halftime break (and any tech pause), so its array middle
 * lands in the break where players already hold their swapped, second-half sides.
 * The freeze start is also unreliable (sides may still be mid-pick), so we anchor
 * to gameplay.
 */
function sidesOf(r: Round): Map<string, Side> {
  const m = new Map<string, Side>()
  const target = r.startTick + (r.endTick - r.startTick) / 2
  const f = r.frames.find((f) => f.tick >= target) ?? r.frames[Math.floor(r.frames.length / 2)]
  for (const p of f?.players ?? []) m.set(p.steamId, p.side)
  return m
}

/**
 * Round indices where the teams switched sides versus the previous round
 * (halftime and every overtime swap), detected by the CT<->T flip of most
 * players. Used both to find half-starts and to keep team identity stable.
 */
function sideSwaps(rounds: Round[]): Set<number> {
  const swaps = new Set<number>()
  let prev: Map<string, Side> | null = null
  rounds.forEach((r, i) => {
    const cur = sidesOf(r)
    if (!cur.size) return
    if (prev) {
      let flipped = 0
      let same = 0
      for (const [id, side] of cur) {
        const before = prev.get(id)
        if (before == null) continue
        before === side ? same++ : flipped++
      }
      if (flipped > 0 && flipped >= same) swaps.add(i)
    }
    prev = cur
  })
  return swaps
}

/**
 * Frame sampled `EQUIP_DELAY_SECONDS` after freeze end (the round goes live at
 * `startTick`). Falls back to the last frame for rounds shorter than the delay.
 */
function econFrame(r: Round, demoTickRate: number) {
  const target = r.startTick + EQUIP_DELAY_SECONDS * demoTickRate
  for (const f of r.frames) if (f.tick >= target) return f
  return r.frames[r.frames.length - 1] ?? null
}

interface SideAgg {
  equip: number
  money: number
  count: number
}

/** Sums equipment value, cash and player count for one side in a frame. */
function aggregate(frame: { players: { side: Side; money: number; equipValue: number }[] } | null, side: Side): SideAgg {
  const agg: SideAgg = { equip: 0, money: 0, count: 0 }
  for (const p of frame?.players ?? []) {
    if (p.side !== side) continue
    agg.equip += p.equipValue ?? 0
    agg.money += p.money
    agg.count++
  }
  return agg
}

/** Team money in a single frame for one side, plus the side's player count. */
function teamMoney(frame: Round['frames'][number], side: Side): { money: number; count: number } {
  let money = 0
  let count = 0
  for (const p of frame.players) {
    if (p.side !== side) continue
    money += p.money
    count++
  }
  return { money, count }
}

/** A money drop larger than this per player marks the match-start reset (16k -> ~800),
 *  not a buy: well above any single-round purchase delta. */
const RESET_DROP_PER_PLAYER = 3000

/**
 * Start-money sum for one side: the team's cash at freeze start, before buying.
 *
 * For the first counted round the freeze window can include warmup frames (every
 * player at `mp_maxmoney`, e.g. 16000) before the match-start reset, which would
 * inflate the start money to ~80000. There we take the money right after the
 * largest reset-sized drop. For every other round freeze start is already correct.
 */
function startMoneyOf(r: Round, side: Side, isFirstCounted: boolean): number {
  const freeze = r.frames.filter((f) => f.tick < r.startTick)
  const frames = freeze.length ? freeze : r.frames
  if (!frames.length) return 0

  let start = teamMoney(frames[0], side).money
  if (!isFirstCounted) return start

  for (let k = 1; k < frames.length; k++) {
    const prev = teamMoney(frames[k - 1], side)
    const cur = teamMoney(frames[k], side)
    const dropPerPlayer = (prev.money - cur.money) / Math.max(1, cur.count)
    if (dropPerPlayer > RESET_DROP_PER_PLAYER && cur.money < prev.money / 2) {
      start = cur.money
    }
  }
  return start
}

/**
 * Classifies a team's buy, mirroring CSDM's `computeTeamEconomyType`.
 * `pistol` is decided by the caller (first round of a non-overtime half).
 */
function classifyBuy(
  side: Side,
  agg: SideAgg,
  pistol: boolean,
  prevWinner: Side | null,
): BuyType {
  if (pistol) return 'pistol'
  const n = Math.max(1, agg.count)
  if (agg.equip <= ECO_PER_PLAYER * n) return 'eco'
  const minFull = (side === 'T' ? FULL_PER_PLAYER_T : FULL_PER_PLAYER_CT) * n
  if (agg.equip >= minFull) return 'full'
  if (prevWinner !== null && prevWinner !== side && agg.money < FORCE_MONEY_PER_PLAYER * n) {
    return 'force-buy'
  }
  return 'semi'
}

/**
 * Builds the match economy from the replay rounds. `demoTickRate` is the demo
 * tick rate (defaults to 64), used to find the 7s post-freeze sample.
 */
export function buildMatchEconomy(rounds: Round[], demoTickRate = 64): MatchEconomy {
  const knife = hasKnifeRound(rounds)
  const swaps = sideSwaps(rounds)

  // Pistol rounds: the first round of each regulation half (round 1 and the
  // first after the halftime swap). Overtime half-starts are NOT pistols (CSDM
  // gates on `OvertimeCount == 0`), so only the first two half-starts count.
  const firstReal = knife ? 1 : 0
  const halfStarts = [...new Set<number>([firstReal, ...swaps])].sort((a, b) => a - b)
  const pistolIndices = new Set(halfStarts.slice(0, 2))

  const team0: TeamEconomy = { id: 0, name: '', rounds: [] }
  const team1: TeamEconomy = { id: 1, name: '', rounds: [] }
  let swapsSoFar = 0

  rounds.forEach((r, i) => {
    if (swaps.has(i)) swapsSoFar++
    if (knife && i === 0) return // knife round does not count

    // Which stable team is on CT this round (flips with each swap).
    const ctTeam = swapsSoFar % 2 === 0 ? team0 : team1
    const tTeam = ctTeam === team0 ? team1 : team0
    if (!ctTeam.name && r.ctName) ctTeam.name = r.ctName
    if (!tTeam.name && r.tName) tTeam.name = r.tName

    const frame = econFrame(r, demoTickRate)
    const pistol = pistolIndices.has(i)
    const prevWinner = i > 0 ? rounds[i - 1].winner : null
    const roundNumber = knife ? i : r.number

    const ctAgg = aggregate(frame, 'CT')
    const tAgg = aggregate(frame, 'T')
    const isFirstCounted = i === firstReal

    ctTeam.rounds.push({
      roundIndex: i,
      roundNumber,
      side: 'CT',
      buyType: classifyBuy('CT', ctAgg, pistol, prevWinner),
      equipValue: ctAgg.equip,
      startMoney: startMoneyOf(r, 'CT', isFirstCounted),
      won: r.winner === 'CT',
    })
    tTeam.rounds.push({
      roundIndex: i,
      roundNumber,
      side: 'T',
      buyType: classifyBuy('T', tAgg, pistol, prevWinner),
      equipValue: tAgg.equip,
      startMoney: startMoneyOf(r, 'T', isFirstCounted),
      won: r.winner === 'T',
    })
  })

  return { teams: [team0, team1], roundCount: team0.rounds.length }
}

export interface BuyStat {
  buyType: BuyType
  total: number
  won: number
  lost: number
  /** Win rate in [0,1], or null when the team never had this buy. */
  winRate: number | null
}

/**
 * Win/loss per buy type for a team, optionally restricted to one side. Returns a
 * row for every buy type (in display order), with `total = 0` when unused.
 */
export function buyStats(team: TeamEconomy, side?: Side): BuyStat[] {
  return BUY_TYPES.map((buyType) => {
    let total = 0
    let won = 0
    for (const r of team.rounds) {
      if (side && r.side !== side) continue
      if (r.buyType !== buyType) continue
      total++
      if (r.won) won++
    }
    return { buyType, total, won, lost: total - won, winRate: total ? won / total : null }
  })
}
