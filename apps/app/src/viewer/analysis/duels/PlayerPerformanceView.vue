<script setup lang="ts">
import { computed } from 'vue'
import type { Replay } from '@/viewer/domain/schema'
import { groupTeams } from '@/viewer/domain/teams'
import { computePlayerPerformance } from '@/viewer/analysis/duels/playerPerformance'
import UtilityTeamGrid from '@/viewer/analysis/utility/UtilityTeamGrid.vue'
import { useI18n } from '@/app/i18n'

/**
 * Duels "Stats" performance grid: per-player combat numbers for the whole match
 * (K / A / D, K/D, ADR, HS%, duel win rate, plants, defuses), grouped by team in
 * the same two-team grid as the utility pages, with the match best starred.
 */
const props = defineProps<{ replay: Replay }>()

const { t } = useI18n()

const teams = computed(() => {
  const ts = groupTeams(props.replay)
  ts[0].name ||= t('economy.team1')
  ts[1].name ||= t('economy.team2')
  return ts
})
const stats = computed(() => computePlayerPerformance(props.replay))

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)

const rows = computed(() => {
  const ids = teams.value.flatMap((tm) => tm.players.map((p) => p.steamId))
  const get = (id: string) => stats.value.get(id)
  /** SteamIds holding the max of `num` (empty when the max is 0). */
  const bestSet = (num: (id: string) => number) => {
    const max = Math.max(0, ...ids.map(num))
    return new Set(max > 0 ? ids.filter((id) => num(id) === max) : [])
  }
  const metric = (key: string, num: (id: string) => number, format: (n: number) => string | number = (n) => n) => {
    const best = bestSet(num)
    return { key, label: t(`duels.performance.${key}`), value: (id: string) => format(num(id)), best: (id: string) => best.has(id) }
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`
  return [
    metric('kills', (id) => get(id)?.kills ?? 0),
    metric('assists', (id) => get(id)?.assists ?? 0),
    // Fewer deaths is better, so no star here.
    { key: 'deaths', label: t('duels.performance.deaths'), value: (id: string) => get(id)?.deaths ?? 0 },
    metric('kdr', (id) => ratio(get(id)?.kills ?? 0, get(id)?.deaths ?? 0), (n) => n.toFixed(2)),
    metric('adr', (id) => ratio(get(id)?.damage ?? 0, get(id)?.roundsPlayed ?? 0), (n) => n.toFixed(1)),
    metric('headshotPct', (id) => ratio(get(id)?.headshotKills ?? 0, get(id)?.kills ?? 0), pct),
    metric('duelWinRate', (id) => {
      const s = get(id)
      return s ? ratio(s.kills, s.kills + s.duelLosses) : 0
    }, pct),
    metric('plants', (id) => get(id)?.plants ?? 0),
    metric('defuses', (id) => get(id)?.defuses ?? 0),
  ]
})
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-6">
    <UtilityTeamGrid :teams="teams" :rows="rows" />
  </div>
</template>
