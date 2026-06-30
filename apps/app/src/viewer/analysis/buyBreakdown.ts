/**
 * Per-round buy breakdown: each player's full loadout at the end of the buy phase,
 * priced so the total equals the equipment value the overview shows, with what was
 * bought THIS round highlighted versus what was already carried (and which guns
 * were dropped to a teammate). Plus the cash spent / left.
 *
 * Sources, all already in the replay (see `buildRoundBuys`):
 *  - `Round.purchases` (the parser's `item_pickup` events, buy-window filtered):
 *    what each player acquired this round. GOTV demos don't emit `item_purchase`,
 *    so a buy and a ground/teammate pickup look alike — reconciled below against
 *    the money actually spent. Absent for pre-tracking replays (view degrades).
 *  - Per-frame inventory (`PlayerState.money`/`equipValue`/`armor`/`helmet`/
 *    `defuser`/`primary`/`weapon`/`grenades`): the cash delta is `spent`/
 *    `remaining`; `equipValue` is the authoritative loadout total (matches the
 *    overview); the settled inventory gives the held loadout.
 */
import type { Replay, Round, Side } from '@/viewer/domain/schema'
import { groupTeams, preGameRoundCount, roundSides } from '@/viewer/analysis/utilityStats'
import { weaponIconPath } from '@/viewer/domain/weaponIcons'
import { playerColor } from '@/viewer/domain/colors'

/** Seconds after the round goes live to read the "settled" inventory (matches the
 *  economy overview's 7s equipment sample, so the totals line up). */
const SETTLE_DELAY_SECONDS = 7

/** Synthetic labels for the derived (non-pickup) equipment. */
export const ARMOR_LABEL = 'Kevlar'
export const ARMOR_HELMET_LABEL = 'Kevlar+Helmet'
export const KIT_LABEL = 'Defuse Kit'

/** Icons for the derived equipment (gun/grenade icons come from `weaponIconPath`). */
const EQUIP_ICON: Record<string, string> = {
  [ARMOR_LABEL]: '/weapons/vest.svg',
  [ARMOR_HELMET_LABEL]: '/weapons/vesthelm.svg',
  [KIT_LABEL]: '/weapons/defuse.svg',
}

/** CS2 buy-menu prices, keyed by the parser's item label vocabulary. Molotov is
 *  side-dependent (T molotov 400 / CT incendiary 600), resolved at use. */
const PRICE: Record<string, number> = {
  // pistols
  'Glock-18': 200,
  'USP-S': 200,
  P2000: 200,
  P250: 300,
  'Five-SeveN': 500,
  'Tec-9': 500,
  'CZ75-Auto': 500,
  'Dual Berettas': 300,
  Deagle: 700,
  'R8 Revolver': 600,
  // SMGs
  MP9: 1250,
  'MAC-10': 1050,
  MP7: 1500,
  'MP5-SD': 1500,
  'UMP-45': 1200,
  P90: 2350,
  'PP-Bizon': 1400,
  // rifles
  'Galil AR': 1800,
  FAMAS: 1950,
  'AK-47': 2700,
  M4A4: 2900,
  'M4A1-S': 2900,
  'SSG 08': 1700,
  'SG 553': 3000,
  AUG: 3300,
  AWP: 4750,
  G3SG1: 5000,
  'SCAR-20': 5000,
  // heavy
  Nova: 1050,
  XM1014: 2000,
  'MAG-7': 1300,
  'Sawed-Off': 1100,
  M249: 5200,
  Negev: 1700,
  // utility
  HE: 300,
  Flash: 200,
  Smoke: 300,
  Decoy: 50,
  Molotov: 400,
  'Zeus x27': 200,
  // derived (from the inventory, not a pickup)
  [ARMOR_LABEL]: 650,
  [ARMOR_HELMET_LABEL]: 1000,
  [KIT_LABEL]: 400,
}

/** Grenade labels (the `item_pickup` / inventory vocabulary). */
const GRENADE_LABELS = new Set(['HE', 'Flash', 'Smoke', 'Molotov', 'Decoy'])
/** CS2 carry limits per grenade (the pickup over-counts ground re-picks). */
const GRENADE_MAX: Record<string, number> = { HE: 1, Smoke: 1, Molotov: 1, Decoy: 1, Flash: 2 }
/** The synthetic equipment labels (armor/kit). */
const EQUIP_LABELS = new Set([ARMOR_LABEL, ARMOR_HELMET_LABEL, KIT_LABEL])
/** Free spawn pistols (CT default USP-S/P2000, T default Glock-18): never a buy. */
const DEFAULT_PISTOLS = new Set(['USP-S', 'P2000', 'Glock-18'])

export function isGrenadeLabel(label: string): boolean {
  return GRENADE_LABELS.has(label)
}

/** A real gun (not a grenade, not Zeus, not armor/kit, not the residual). */
function isGun(label: string): boolean {
  return !GRENADE_LABELS.has(label) && !EQUIP_LABELS.has(label) && label !== 'Zeus x27'
}

/** Unit price of an item label, side-aware for the molotov/incendiary split. */
function priceOf(label: string, side: Side): number {
  if (label === 'Molotov') return side === 'CT' ? 600 : 400
  return PRICE[label] ?? 0
}

export interface BuyItem {
  label: string
  icon: string | null
  count: number
  unitPrice: number
  /** Value of this line (count × unitPrice, or the residual for the carried line). */
  total: number
  /** True = bought this round; false = already carried. */
  bought: boolean
  /** Gun-only: this player dropped it for a teammate (their display name). */
  passedToName?: string
  /** Gun-only: this player is holding it but a teammate dropped it to them. */
  receivedFromName?: string
  /** Gun-only: bought but dropped/lost (not held at settle, nobody took it). */
  dropped?: boolean
  /** Gun-only: an extra copy bought beyond what the buyer kept (bought to drop). */
  extra?: boolean
}

export interface PlayerBuy {
  steamId: string
  name: string
  side: Side
  /** CS2 color hex (`m_iCompTeammateColor`), or null when unassigned. */
  color: string | null
  startMoney: number
  /** Authoritative cash delta (not a sum of item prices). */
  spent: number
  remaining: number
  /** Settled-frame loadout total; matches the overview's equip value. */
  equipValue: number
  /** Value already carried / not itemizable (free pistol, stowed secondary, prior
   *  gear): `items` + `carried` = `equipValue`. Shown as a footer line. */
  carried: number
  items: BuyItem[]
}

export interface TeamBuy {
  side: Side
  name: string
  players: PlayerBuy[]
  totalSpent: number
  totalRemaining: number
  /** Sum of the players' equip value (matches the overview's per-round bar). */
  totalEquip: number
}

export interface RoundBuys {
  roundIndex: number
  roundNumber: number
  /** [CT team, T team] for this round. */
  teams: [TeamBuy, TeamBuy]
  /** False when the replay carries no `purchases` for this round (old replays):
   *  the view shows an empty-state note instead of an incomplete breakdown. */
  hasData: boolean
}

/** Frame at or just after a tick (frames are tick-sorted), or null. */
function frameAt(round: Round, tick: number) {
  for (const f of round.frames) if (f.tick >= tick) return f
  return round.frames[round.frames.length - 1] ?? null
}

/** Whether a player state is holding a given gun label (active or stowed). */
function holdsGun(p: { primary?: string; weapon: string } | undefined, label: string): boolean {
  if (!p) return false
  return p.primary === label || p.weapon === label
}

/**
 * Builds the buy breakdown for a single round. Pure: reads only the replay.
 */
export function buildRoundBuys(replay: Replay, roundIndex: number): RoundBuys {
  const round = replay.rounds[roundIndex]
  const nameById = new Map(replay.players.map((p) => [p.steamId, p.name]))
  const colorById = new Map(replay.players.map((p) => [p.steamId, playerColor(p.compColor)]))
  const sides = roundSides(round)

  const freezeFrame = round.frames.find((f) => f.tick < round.startTick) ?? round.frames[0] ?? null
  const settleFrame = frameAt(round, round.startTick + SETTLE_DELAY_SECONDS * replay.demoTickRate)
  const stateOf = (frame: typeof freezeFrame, id: string) =>
    frame?.players.find((p) => p.steamId === id)

  const purchases = round.purchases ?? []
  const hasData = purchases.length > 0

  // Start money (with the round-1 match-start reset handled), mirroring
  // `roundEconomy.startMoneyOf`.
  const isFirstCounted = roundIndex === preGameRoundCount(replay.rounds)
  const freezeFrames = round.frames.filter((f) => f.tick < round.startTick)
  const startFrames = freezeFrames.length ? freezeFrames : round.frames
  const moneyOf = (frame: (typeof startFrames)[number], id: string) =>
    frame.players.find((p) => p.steamId === id)?.money ?? 0
  function startMoneyFor(id: string): number {
    let start = startFrames.length ? moneyOf(startFrames[0], id) : 0
    if (!isFirstCounted) return start
    for (let k = 1; k < startFrames.length; k++) {
      const prev = moneyOf(startFrames[k - 1], id)
      const cur = moneyOf(startFrames[k], id)
      if (prev - cur > 3000 && cur < prev / 2) start = cur
    }
    return start
  }

  // Items each player picked up this round (a receiver of a drop picks the gun up),
  // to tell a real drop-receive from a gun simply carried over from a prior round.
  const pickedUp = new Map<string, Set<string>>()
  for (const buy of purchases) {
    let s = pickedUp.get(buy.steamId)
    if (!s) pickedUp.set(buy.steamId, (s = new Set()))
    s.add(buy.item)
  }

  const byPlayer = new Map<string, PlayerBuy>()
  const playerSide = (id: string): Side => sides.get(id) ?? 'CT'
  const ensure = (id: string): PlayerBuy => {
    let pb = byPlayer.get(id)
    if (!pb) {
      pb = {
        steamId: id,
        name: nameById.get(id) ?? '?',
        side: playerSide(id),
        color: colorById.get(id) ?? null,
        startMoney: startMoneyFor(id),
        spent: 0,
        remaining: 0,
        equipValue: 0,
        carried: 0,
        items: [],
      }
      byPlayer.set(id, pb)
    }
    return pb
  }
  for (const [id] of sides) ensure(id)

  // Cash facts (authoritative) + equip value (the loadout total).
  for (const pb of byPlayer.values()) {
    const after = stateOf(settleFrame, pb.steamId)
    pb.remaining = after?.money ?? pb.startMoney
    pb.spent = Math.max(0, pb.startMoney - pb.remaining)
    pb.equipValue = after?.equipValue ?? 0
  }

  // Armor / kit bought THIS round (inventory diff), needed for the buy budget.
  const boughtArmor = new Map<string, string>() // steamId -> armor label bought
  const boughtKit = new Set<string>()
  const budget = new Map<string, number>()
  for (const pb of byPlayer.values()) {
    const before = stateOf(freezeFrame, pb.steamId)
    const after = stateOf(settleFrame, pb.steamId)
    let equipCost = 0
    if (after) {
      const gotHelmet = !!after.helmet && !before?.helmet
      const gotArmor = (after.armor ?? 0) > (before?.armor ?? 0)
      if (gotHelmet) {
        boughtArmor.set(pb.steamId, ARMOR_HELMET_LABEL)
        equipCost += PRICE[ARMOR_HELMET_LABEL]
      } else if (gotArmor) {
        boughtArmor.set(pb.steamId, ARMOR_LABEL)
        equipCost += PRICE[ARMOR_LABEL]
      }
      if (after.defuser && !before?.defuser) {
        boughtKit.add(pb.steamId)
        equipCost += PRICE[KIT_LABEL]
      }
    }
    budget.set(pb.steamId, Math.max(0, pb.spent - equipCost))
  }

  // Budget reconciliation: `item_pickup` lists everything a player touched (buys
  // AND a teammate's dropped item). For GUNS, count a pickup as bought only while
  // the cash budget (spent minus armor/kit) covers it — a gun still held at the
  // settled frame is taken first (so a refunded/swapped pistol doesn't crowd out
  // the rifle kept), the rest were ground pickups. GRENADES are always recorded
  // (the carry-limit cap handles re-pick noise) — they're cheap and often thrown
  // before the settled frame, so gating them on the budget would hide real buys;
  // they still consume budget so a ground-picked gun doesn't sneak in.
  const heldGun = (steamId: string, item: string) =>
    isGun(item) && holdsGun(stateOf(settleFrame, steamId), item)
  const ordered = [...purchases].sort(
    (a, b) =>
      (heldGun(a.steamId, a.item) ? 0 : 1) - (heldGun(b.steamId, b.item) ? 0 : 1) || a.tick - b.tick,
  )
  const bought = new Map<string, Map<string, BuyItem>>() // steamId -> label -> item
  for (const buy of ordered) {
    if (DEFAULT_PISTOLS.has(buy.item)) continue
    const pb = byPlayer.get(buy.steamId)
    if (!pb) continue
    const price = priceOf(buy.item, pb.side)
    const left = budget.get(pb.steamId) ?? 0
    if (isGun(buy.item)) {
      if (price > left) continue // can't afford it -> a ground pickup, not a buy
      budget.set(pb.steamId, left - price)
    } else {
      budget.set(pb.steamId, Math.max(0, left - price)) // consume, but never gate
    }
    let group = bought.get(pb.steamId)
    if (!group) bought.set(pb.steamId, (group = new Map()))
    let item = group.get(buy.item)
    if (!item) {
      item = { label: buy.item, icon: weaponIconPath(buy.item), count: 0, unitPrice: price, total: 0, bought: true }
      group.set(buy.item, item)
    }
    item.count++
    item.total += price
  }

  // Assemble each player's loadout: bought items (this round) + carried gear, then
  // a residual "already had" line so the receipt totals the equip value exactly.
  // The parser's `equipValue` is the authoritative loadout total; the per-item
  // inventory (esp. `primary`) can be stale, so we cap the itemization at it: add
  // items by trust order (armor/kit, then bought guns, grenades, carried gun) only
  // while they fit, and the "already had" residual closes the rest. A grace covers
  // small price-table mismatches; a stale gun ($1800+) still won't fit and is dropped.
  const FIT_GRACE = 300
  for (const pb of byPlayer.values()) {
    const after = stateOf(settleFrame, pb.steamId)
    const items: BuyItem[] = []
    let running = 0
    const fit = (item: BuyItem): boolean => {
      if (running + item.total > pb.equipValue + FIT_GRACE) return false
      running += item.total
      items.push(item)
      return true
    }

    // Armor / kit (bought this round or carried — armor persists between rounds).
    const armorLabel = boughtArmor.get(pb.steamId) ?? (after?.helmet ? ARMOR_HELMET_LABEL : (after?.armor ?? 0) > 0 ? ARMOR_LABEL : '')
    if (armorLabel) fit({ label: armorLabel, icon: EQUIP_ICON[armorLabel] ?? null, count: 1, unitPrice: PRICE[armorLabel], total: PRICE[armorLabel], bought: boughtArmor.has(pb.steamId) })
    if (after?.defuser) fit({ label: KIT_LABEL, icon: EQUIP_ICON[KIT_LABEL], count: 1, unitPrice: PRICE[KIT_LABEL], total: PRICE[KIT_LABEL], bought: boughtKit.has(pb.steamId) })

    const group = bought.get(pb.steamId)

    // Bought GUNS, one line per gun bought. The player holds at most one of a given
    // gun: that one is "kept" and counts toward the loadout; any extra copies were
    // bought to drop — shown but not counted, and matched to a receiver below.
    const gunEntries = [...(group?.values() ?? [])]
      .filter((i) => isGun(i.label))
      .sort((a, b) => b.unitPrice - a.unitPrice)
    for (const g of gunEntries) {
      const label = g.label
      const price = priceOf(label, pb.side)
      const keeps = holdsGun(after, label) ? 1 : 0
      for (let n = 0; n < g.count; n++) {
        const line: BuyItem = { label, icon: weaponIconPath(label), count: 1, unitPrice: price, total: price, bought: true }
        if (n < keeps) fit(line)
        else {
          line.extra = true
          items.push(line)
        }
      }
    }

    // Bought grenades / Zeus (grouped): cap grenades + attach throws. A grenade
    // still held at the settled frame counts toward the loadout; one bought and
    // already thrown by then is shown as used (▸), not counted toward the value.
    for (const item of [...(group?.values() ?? [])].filter((i) => !isGun(i.label))) {
      if (isGrenadeLabel(item.label)) {
        item.count = Math.min(item.count, GRENADE_MAX[item.label] ?? 1)
        item.total = item.count * item.unitPrice
        if (after?.grenades?.includes(item.label)) fit(item)
        else items.push(item) // already thrown by the settled frame -> shown, not counted
      } else {
        fit(item) // Zeus / other
      }
    }

    // Carried main gun: held, not bought this round, and consistent with the value.
    const primary = after?.primary || (after && isGun(after.weapon) ? after.weapon : '')
    if (primary && holdsGun(after, primary) && !items.some((i) => i.label === primary)) {
      const price = priceOf(primary, pb.side)
      fit({ label: primary, icon: weaponIconPath(primary), count: 1, unitPrice: price, total: price, bought: false })
    }

    // Residual "already had": the rest of the equip value we didn't itemize
    // (free default pistol, stowed secondary, carried gear). Shown in the footer.
    pb.carried = Math.max(0, pb.equipValue - running)
    pb.items = items
  }

  // Gun drops: match each "extra" gun (bought beyond what the buyer kept) to the
  // teammate who received it — one who holds the gun and picked it up this round
  // but didn't buy it. Mark the buyer's line "→ receiver" and the receiver's
  // held line "← buyer". An extra nobody took was dropped/lost.
  for (const side of ['CT', 'T'] as const) {
    const team = [...byPlayer.values()].filter((p) => p.side === side)
    const usedReceiver = new Set<string>() // `${steamId}:${label}` already matched
    const extras = team.flatMap((p) => p.items.filter((i) => i.extra).map((item) => ({ buyer: p, item })))
    for (const { buyer, item } of extras) {
      const label = item.label
      const receiver = team.find(
        (r) =>
          r.steamId !== buyer.steamId &&
          !usedReceiver.has(`${r.steamId}:${label}`) &&
          holdsGun(stateOf(settleFrame, r.steamId), label) &&
          pickedUp.get(r.steamId)?.has(label) &&
          !r.items.some((i) => i.bought && !i.extra && i.label === label),
      )
      if (receiver) {
        usedReceiver.add(`${receiver.steamId}:${label}`)
        item.passedToName = receiver.name
        const rItem = receiver.items.find((i) => !i.extra && i.label === label)
        if (rItem) rItem.receivedFromName ||= buyer.name
        else
          receiver.items.unshift({
            label,
            icon: weaponIconPath(label),
            count: 1,
            unitPrice: priceOf(label, receiver.side),
            total: priceOf(label, receiver.side),
            bought: false,
            receivedFromName: buyer.name,
          })
      } else {
        item.dropped = true
      }
    }
  }

  // Stable order: guns first (by price desc), Zeus, grenades, armor/kit, then the
  // carried residual last.
  for (const pb of byPlayer.values()) {
    pb.items.sort((a, b) => rank(a) - rank(b) || b.unitPrice - a.unitPrice)
  }

  // Stable layout: the two teams keep their identity (0 = started CT, 1 = started T)
  // and each team's players keep the roster order, so navigating rounds never
  // reshuffles them — only the side color/label tracks the current half.
  const stable = groupTeams(replay)
  const teamFor = (team: { id: 0 | 1; name: string; players: { steamId: string }[] }): TeamBuy => {
    const players = team.players
      .map((tp) => byPlayer.get(tp.steamId))
      .filter((p): p is PlayerBuy => !!p)
    const side: Side = players[0]?.side ?? (team.id === 0 ? 'CT' : 'T')
    return {
      side,
      name: (side === 'CT' ? round.ctName : round.tName) || team.name || side,
      players,
      totalSpent: players.reduce((s, p) => s + p.spent, 0),
      totalRemaining: players.reduce((s, p) => s + p.remaining, 0),
      totalEquip: players.reduce((s, p) => s + p.equipValue, 0),
    }
  }

  return {
    roundIndex,
    roundNumber: round.number,
    teams: [teamFor(stable[0]), teamFor(stable[1])],
    hasData,
  }
}

/** Sort rank: guns (0), Zeus (1), grenades (2), armor/kit (3). */
function rank(item: BuyItem): number {
  if (EQUIP_LABELS.has(item.label)) return 3
  if (isGrenadeLabel(item.label)) return 2
  if (item.label === 'Zeus x27') return 1
  return 0
}
