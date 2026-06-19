<script setup lang="ts">
import { computed } from 'vue'
import type { Replay } from '@/viewer/domain/schema'
import { computeDamageStats, groupTeams } from '@/viewer/analysis/utilityStats'
import UtilityTeamGrid from '@/viewer/analysis/UtilityTeamGrid.vue'
import { useI18n } from '@/i18n'

/**
 * Damage sub-tab: per-player HE + molotov metrics grouped by team (thrown,
 * utility damage, per-throw / per-round rates, and kills), inspired by CS Demo
 * Manager's explosive-grenade panel. Damage comes from `Round.utilityDamage`.
 */
const props = defineProps<{ replay: Replay }>()

const { t } = useI18n()

const teams = computed(() => {
  const ts = groupTeams(props.replay)
  ts[0].name ||= t('economy.team1')
  ts[1].name ||= t('economy.team2')
  return ts
})
const stats = computed(() => computeDamageStats(props.replay))

/** Empty when no utility damage and nothing thrown (e.g. an older replay parsed
 *  before the utilityDamage field existed). */
const isEmpty = computed(() => {
  for (const s of stats.value.byPlayer.values()) {
    if (s.damage || s.thrown || s.kills) return false
  }
  return true
})

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits)
}

/** Every shown player's steamId (both teams), for "best of the match" stars. */
const allPlayerIds = computed(() => teams.value.flatMap((tm) => tm.players.map((p) => p.steamId)))

/** SteamIds achieving the max of `num` across shown players (empty if max <= 0). */
function bestSet(num: (id: string) => number): Set<string> {
  const ids = allPlayerIds.value
  let max = 0
  for (const id of ids) max = Math.max(max, num(id))
  const set = new Set<string>()
  if (max > 0) for (const id of ids) if (num(id) === max) set.add(id)
  return set
}

const rows = computed(() => {
  const by = stats.value.byPlayer
  const rounds = Math.max(1, stats.value.roundCount)
  const get = (id: string) => by.get(id)
  // Numeric value per metric (used both for display and to pick the match best).
  const num = {
    thrown: (id: string) => get(id)?.thrown ?? 0,
    total: (id: string) => get(id)?.damage ?? 0,
    perThrow: (id: string) => {
      const s = get(id)
      return s && s.thrown ? s.damage / s.thrown : 0
    },
    perRound: (id: string) => (get(id)?.damage ?? 0) / rounds,
    kills: (id: string) => get(id)?.kills ?? 0,
  }
  const best = {
    thrown: bestSet(num.thrown),
    total: bestSet(num.total),
    perThrow: bestSet(num.perThrow),
    perRound: bestSet(num.perRound),
    kills: bestSet(num.kills),
  }
  return [
    {
      key: 'thrown',
      label: t('utilities.damage.thrown'),
      value: num.thrown,
      best: (id: string) => best.thrown.has(id),
    },
    {
      key: 'total',
      label: t('utilities.damage.total'),
      value: num.total,
      best: (id: string) => best.total.has(id),
    },
    {
      key: 'perThrow',
      label: t('utilities.damage.perThrow'),
      value: (id: string) => {
        const s = get(id)
        return s && s.thrown ? fmt(s.damage / s.thrown) : '-'
      },
      best: (id: string) => best.perThrow.has(id),
    },
    {
      key: 'perRound',
      label: t('utilities.damage.perRound'),
      value: (id: string) => fmt(num.perRound(id)),
      best: (id: string) => best.perRound.has(id),
    },
    {
      key: 'kills',
      label: t('utilities.damage.kills'),
      value: num.kills,
      best: (id: string) => best.kills.has(id),
    },
  ]
})
</script>

<template>
  <div class="h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
    <div class="mx-auto max-w-5xl px-6 py-6">
      <p v-if="isEmpty" class="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-6 text-center text-sm text-ink-500">
        {{ t('utilities.empty') }}
      </p>
      <template v-else>
        <UtilityTeamGrid :teams="teams" :rows="rows" />
        <p class="mt-3 text-xs text-ink-600">{{ t('utilities.damage.hint') }}</p>
      </template>
    </div>
  </div>
</template>
