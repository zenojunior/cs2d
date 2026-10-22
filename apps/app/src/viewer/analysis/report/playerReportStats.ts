import type { KillEvent, Replay, Side } from '@/viewer/domain/schema'
import { isKnifeRound, roundSides } from '@/viewer/domain/rounds'
import { computeOpeningDuels } from '@/viewer/analysis/duels/duelStats'
import { computeDamageStats, computeFlashStats } from '@/viewer/analysis/utility/utilityStats'

export interface PlayerReport {
  steamId: string
  name: string
  map: string
  roundsPlayed: number
  roundsWon: number
  roundWinRate: number
  kills: number
  assists: number
  deaths: number
  kda: number
  kdr: number
  damage: number
  adr: number
  headshotKills: number
  headshotPct: number
  duelWins: number
  duelLosses: number
  duelWinRate: number
  openingWins: number
  openingLosses: number
  openingAttempts: number
  openingWinRate: number
  openingConversions: number
  openingConversionRate: number
  grenadesThrown: number
  utilityPerRound: number
  flashesThrown: number
  enemiesBlinded: number
  enemiesBlindedPerRound: number
  enemyBlindDuration: number
  blindSecondsPerFlash: number
  killsFromBlinds: number
  flashAssists: number
  utilityDamage: number
  damagingUtilityThrown: number
  utilityDamagePerRound: number
  utilityDamagePerThrow: number
  utilityKills: number
  plants: number
  defuses: number
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : numerator
}

function playerSideInRound(replay: Replay, roundIndex: number, steamId: string): Side | null {
  const round = replay.rounds[roundIndex]
  const sides = roundSides(round)
  return sides.get(steamId) ?? null
}

export function computePlayerReport(replay: Replay, steamId: string): PlayerReport {
  const player = replay.players.find((p) => p.steamId === steamId)
  const name = player?.name ?? steamId
  const flash = computeFlashStats(replay).byPlayer.get(steamId)
  const utilityDamage = computeDamageStats(replay).byPlayer.get(steamId)
  const openings = computeOpeningDuels(replay)

  let roundsPlayed = 0
  let roundsWon = 0
  let kills = 0
  let assists = 0
  let deaths = 0
  let damage = 0
  let headshotKills = 0
  let duelWins = 0
  let duelLosses = 0
  let grenadesThrown = 0
  let flashesThrown = 0
  let plants = 0
  let defuses = 0

  replay.rounds.forEach((round, roundIndex) => {
    if (isKnifeRound(round)) return
    const side = playerSideInRound(replay, roundIndex, steamId)
    if (side) {
      roundsPlayed += 1
      if (round.winner === side) roundsWon += 1
    }
    damage += round.damage?.[steamId] ?? 0
    for (const path of round.grenadePaths) {
      if (path.throwerSteamId !== steamId) continue
      grenadesThrown += 1
      if (path.kind === 'flash') flashesThrown += 1
    }
    for (const ev of round.events) {
      if (ev.type === 'kill') {
        const kill = ev as KillEvent
        if (kill.attackerSteamId === steamId && kill.victimSteamId !== steamId) {
          kills += 1
          duelWins += 1
          if (kill.headshot) headshotKills += 1
        }
        if (kill.assisterSteamId === steamId) assists += 1
        if (kill.victimSteamId === steamId) {
          deaths += 1
          if (kill.attackerSteamId && kill.attackerSteamId !== steamId) duelLosses += 1
        }
      } else if (ev.type === 'bomb_planted' && ev.playerSteamId === steamId) {
        plants += 1
      } else if (ev.type === 'bomb_defused' && ev.playerSteamId === steamId) {
        defuses += 1
      }
    }
  })

  let openingWins = 0
  let openingLosses = 0
  let openingConversions = 0
  for (const o of openings) {
    if (o.winnerSteamId === steamId) {
      openingWins += 1
      if (o.roundWinner && o.winnerSide === o.roundWinner) openingConversions += 1
    }
    if (o.loserSteamId === steamId) openingLosses += 1
  }
  const openingAttempts = openingWins + openingLosses
  const played = Math.max(1, roundsPlayed)
  const damagingUtilityThrown = utilityDamage?.thrown ?? 0

  return {
    steamId,
    name,
    map: replay.map,
    roundsPlayed,
    roundsWon,
    roundWinRate: pct(roundsWon, roundsPlayed),
    kills,
    assists,
    deaths,
    kda: safeRatio(kills + assists, deaths),
    kdr: safeRatio(kills, deaths),
    damage,
    adr: damage / played,
    headshotKills,
    headshotPct: pct(headshotKills, kills),
    duelWins,
    duelLosses,
    duelWinRate: pct(duelWins, duelWins + duelLosses),
    openingWins,
    openingLosses,
    openingAttempts,
    openingWinRate: pct(openingWins, openingAttempts),
    openingConversions,
    openingConversionRate: pct(openingConversions, openingWins),
    grenadesThrown,
    utilityPerRound: grenadesThrown / played,
    flashesThrown,
    enemiesBlinded: flash?.enemiesBlinded ?? 0,
    enemiesBlindedPerRound: (flash?.enemiesBlinded ?? 0) / played,
    enemyBlindDuration: flash?.enemyBlindDuration ?? 0,
    blindSecondsPerFlash: pct(flash?.enemyBlindDuration ?? 0, flashesThrown),
    killsFromBlinds: flash?.killsFromBlinds ?? 0,
    flashAssists: flash?.flashAssists ?? 0,
    utilityDamage: utilityDamage?.damage ?? 0,
    damagingUtilityThrown,
    utilityDamagePerRound: (utilityDamage?.damage ?? 0) / played,
    utilityDamagePerThrow: pct(utilityDamage?.damage ?? 0, damagingUtilityThrown),
    utilityKills: utilityDamage?.kills ?? 0,
    plants,
    defuses,
  }
}

export function reportToExportObject(report: PlayerReport) {
  return {
    player: report.name,
    steamId: report.steamId,
    map: report.map,
    roundsPlayed: report.roundsPlayed,
    roundsWon: report.roundsWon,
    roundWinRate: report.roundWinRate,
    kills: report.kills,
    assists: report.assists,
    deaths: report.deaths,
    kda: report.kda,
    kdr: report.kdr,
    damage: report.damage,
    adr: report.adr,
    headshotKills: report.headshotKills,
    headshotPct: report.headshotPct,
    duelWins: report.duelWins,
    duelLosses: report.duelLosses,
    duelWinRate: report.duelWinRate,
    openingWins: report.openingWins,
    openingLosses: report.openingLosses,
    openingWinRate: report.openingWinRate,
    openingConversionRate: report.openingConversionRate,
    grenadesThrown: report.grenadesThrown,
    utilityPerRound: report.utilityPerRound,
    flashesThrown: report.flashesThrown,
    enemiesBlinded: report.enemiesBlinded,
    enemiesBlindedPerRound: report.enemiesBlindedPerRound,
    enemyBlindDuration: report.enemyBlindDuration,
    blindSecondsPerFlash: report.blindSecondsPerFlash,
    killsFromBlinds: report.killsFromBlinds,
    flashAssists: report.flashAssists,
    utilityDamage: report.utilityDamage,
    damagingUtilityThrown: report.damagingUtilityThrown,
    utilityDamagePerRound: report.utilityDamagePerRound,
    utilityDamagePerThrow: report.utilityDamagePerThrow,
    utilityKills: report.utilityKills,
    plants: report.plants,
    defuses: report.defuses,
  }
}
