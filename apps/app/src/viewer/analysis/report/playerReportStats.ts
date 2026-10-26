import type { KillEvent, Replay, Side } from '@/viewer/domain/schema'
import { isKnifeRound, roundSides } from '@/viewer/domain/rounds'
import { computeOpeningDuels } from '@/viewer/analysis/duels/duelStats'
import { computeDamageStats, computeFlashStats } from '@/viewer/analysis/utility/utilityStats'

export interface CombatStats { roundsPlayed: number; roundsWon: number; kills: number; assists: number; deaths: number; damage: number; headshotKills: number }
export interface DuelStats { wins: number; losses: number; openingWins: number; openingLosses: number; openingConversions: number }
export interface UtilityReportStats { grenadesThrown: number; flashesThrown: number; enemiesBlinded: number; enemyBlindDuration: number; killsFromBlinds: number; flashAssists: number; utilityDamage: number; damagingUtilityThrown: number; utilityKills: number }
export interface ObjectiveStats { plants: number; defuses: number }
export interface EconomyReportStats { rounds: number; wins: number; losses: number; startMoney: number; equipValue: number }
export interface ReplayAnalysis {
  combat: Map<string, CombatStats>
  duels: Map<string, DuelStats>
  utility: Map<string, UtilityReportStats>
  objectives: Map<string, ObjectiveStats>
  economy: { CT: EconomyReportStats; T: EconomyReportStats }
}

const emptyCombat = (): CombatStats => ({ roundsPlayed: 0, roundsWon: 0, kills: 0, assists: 0, deaths: 0, damage: 0, headshotKills: 0 })
const emptyDuels = (): DuelStats => ({ wins: 0, losses: 0, openingWins: 0, openingLosses: 0, openingConversions: 0 })
const emptyUtility = (): UtilityReportStats => ({ grenadesThrown: 0, flashesThrown: 0, enemiesBlinded: 0, enemyBlindDuration: 0, killsFromBlinds: 0, flashAssists: 0, utilityDamage: 0, damagingUtilityThrown: 0, utilityKills: 0 })
const emptyObjectives = (): ObjectiveStats => ({ plants: 0, defuses: 0 })
const emptyEconomy = (): EconomyReportStats => ({ rounds: 0, wins: 0, losses: 0, startMoney: 0, equipValue: 0 })

function getOrCreate<T>(map: Map<string, T>, id: string, create: () => T): T {
  let value = map.get(id)
  if (!value) { value = create(); map.set(id, value) }
  return value
}

function isEnemyKill(round: Replay['rounds'][number], kill: KillEvent): boolean {
  if (!kill.attackerSteamId || kill.attackerSteamId === kill.victimSteamId) return false
  const sides = roundSides(round)
  const attackerSide = sides.get(kill.attackerSteamId)
  const victimSide = sides.get(kill.victimSteamId)
  return !!attackerSide && !!victimSide && attackerSide !== victimSide
}

function aggregateEconomy(replay: Replay): { CT: EconomyReportStats; T: EconomyReportStats } {
  const out = { CT: emptyEconomy(), T: emptyEconomy() }
  for (const round of replay.rounds) {
    if (isKnifeRound(round)) continue
    const first = round.frames.find((f) => f.tick >= round.startTick)
    if (!first) continue
    for (const side of ['CT', 'T'] as const) {
      const players = first.players.filter((p) => p.side === side)
      if (!players.length) continue
      const stat = out[side]
      stat.rounds += 1
      if (round.winner === side) stat.wins += 1
      else if (round.winner) stat.losses += 1
      stat.startMoney += players.reduce((sum, p) => sum + p.money, 0)
      stat.equipValue += players.reduce((sum, p) => sum + p.equipValue, 0)
    }
  }
  return out
}

export function buildReplayAnalysis(replay: Replay): ReplayAnalysis {
  const combat = new Map<string, CombatStats>()
  const duels = new Map<string, DuelStats>()
  const utility = new Map<string, UtilityReportStats>()
  const objectives = new Map<string, ObjectiveStats>()
  for (const player of replay.players) {
    combat.set(player.steamId, emptyCombat())
    duels.set(player.steamId, emptyDuels())
    utility.set(player.steamId, emptyUtility())
    objectives.set(player.steamId, emptyObjectives())
  }

  for (const round of replay.rounds) {
    if (isKnifeRound(round)) continue
    const sides = roundSides(round)
    for (const [id, side] of sides) {
      const stat = getOrCreate(combat, id, emptyCombat)
      stat.roundsPlayed += 1
      if (round.winner === side) stat.roundsWon += 1
      stat.damage += round.damage?.[id] ?? 0
    }
    for (const path of round.grenadePaths) {
      if (!path.throwerSteamId) continue
      const stat = getOrCreate(utility, path.throwerSteamId, emptyUtility)
      stat.grenadesThrown += 1
      if (path.kind === 'flash') stat.flashesThrown += 1
    }
    for (const event of round.events) {
      if (event.type === 'kill') {
        const kill = event as KillEvent
        const enemyKill = isEnemyKill(round, kill)
        if (kill.attackerSteamId && enemyKill) {
          const attacker = getOrCreate(combat, kill.attackerSteamId, emptyCombat)
          attacker.kills += 1
          if (kill.headshot) attacker.headshotKills += 1
          getOrCreate(duels, kill.attackerSteamId, emptyDuels).wins += 1
        }
        if (kill.assisterSteamId) getOrCreate(combat, kill.assisterSteamId, emptyCombat).assists += 1
        getOrCreate(combat, kill.victimSteamId, emptyCombat).deaths += 1
        if (enemyKill) getOrCreate(duels, kill.victimSteamId, emptyDuels).losses += 1
      } else if (event.type === 'bomb_planted' && event.playerSteamId) {
        getOrCreate(objectives, event.playerSteamId, emptyObjectives).plants += 1
      } else if (event.type === 'bomb_defused' && event.playerSteamId) {
        getOrCreate(objectives, event.playerSteamId, emptyObjectives).defuses += 1
      }
    }
  }

  for (const [id, stat] of computeFlashStats(replay).byPlayer) {
    const target = getOrCreate(utility, id, emptyUtility)
    target.enemiesBlinded = stat.enemiesBlinded
    target.enemyBlindDuration = stat.enemyBlindDuration
    target.killsFromBlinds = stat.killsFromBlinds
    target.flashAssists = stat.flashAssists
  }
  for (const [id, stat] of computeDamageStats(replay).byPlayer) {
    const target = getOrCreate(utility, id, emptyUtility)
    target.utilityDamage = stat.damage
    target.damagingUtilityThrown = stat.thrown
    target.utilityKills = stat.kills
  }
  for (const opening of computeOpeningDuels(replay)) {
    getOrCreate(duels, opening.winnerSteamId, emptyDuels).openingWins += 1
    const winner = getOrCreate(duels, opening.winnerSteamId, emptyDuels)
    if (opening.roundWinner && opening.roundWinner === opening.winnerSide) winner.openingConversions += 1
    getOrCreate(duels, opening.loserSteamId, emptyDuels).openingLosses += 1
  }
  return { combat, duels, utility, objectives, economy: aggregateEconomy(replay) }
}

export function ratio(value: number, denominator: number): number { return denominator > 0 ? value / denominator : 0 }
