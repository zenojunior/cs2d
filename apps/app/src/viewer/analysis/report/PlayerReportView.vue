<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Replay } from '@/viewer/domain/schema'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'
import { computePlayerReport, reportToExportObject, type PlayerReport } from '@/viewer/analysis/report/playerReportStats'

const props = defineProps<{
  replay: Replay
  sourceLabel?: string
}>()

const { t } = useI18n()

const selectedSteamId = ref(props.replay.players[0]?.steamId ?? '')
type RankingCriterion = 'impact' | 'kda' | 'adr' | 'kills' | 'headshotPct' | 'duelWinRate' | 'utilityDamage' | 'enemiesBlinded'
const rankingCriterion = ref<RankingCriterion>('impact')

watch(
  () => props.replay,
  (replay) => {
    if (!replay.players.some((p) => p.steamId === selectedSteamId.value)) selectedSteamId.value = replay.players[0]?.steamId ?? ''
  },
)

const players = computed(() => [...props.replay.players].sort((a, b) => a.name.localeCompare(b.name)))
const report = computed(() => computePlayerReport(props.replay, selectedSteamId.value))
const matchLabel = computed(() => props.sourceLabel || props.replay.map)

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '-'
}

function pct(n: number): string {
  return `${fmt(n * 100, 0)}%`
}

function fileSafe(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function download(name: string, type: string, body: string) {
  const blob = new Blob([body], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    source: props.sourceLabel ?? null,
    report: reportToExportObject(report.value),
  }
  download(
    `player-report-${fileSafe(report.value.name)}-${fileSafe(props.replay.map)}.json`,
    'application/json',
    `${JSON.stringify(payload, null, 2)}\n`,
  )
}

function csvEscape(value: unknown): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function exportCsv() {
  const row = reportToExportObject(report.value)
  const headers = Object.keys(row)
  const values = Object.values(row)
  download(
    `player-report-${fileSafe(report.value.name)}-${fileSafe(props.replay.map)}.csv`,
    'text/csv',
    `${headers.map(csvEscape).join(',')}\n${values.map(csvEscape).join(',')}\n`,
  )
}

const overview = computed(() => [
  { key: 'kda', label: t('report.metrics.kda'), value: fmt(report.value.kda, 2), hint: `${report.value.kills}/${report.value.assists}/${report.value.deaths}` },
  { key: 'adr', label: t('report.metrics.adr'), value: fmt(report.value.adr, 1), hint: `${report.value.damage} DMG` },
  { key: 'hs', label: t('report.metrics.headshotPct'), value: pct(report.value.headshotPct), hint: `${report.value.headshotKills}/${report.value.kills}` },
  { key: 'duel', label: t('report.metrics.duelWinRate'), value: pct(report.value.duelWinRate), hint: `${report.value.duelWins}W / ${report.value.duelLosses}L` },
])

const groups = computed(() => [
  {
    title: t('report.groups.combat'),
    rows: [
      [t('report.metrics.kills'), report.value.kills],
      [t('report.metrics.assists'), report.value.assists],
      [t('report.metrics.deaths'), report.value.deaths],
      [t('report.metrics.kdr'), fmt(report.value.kdr, 2)],
      [t('report.metrics.damage'), report.value.damage],
      [t('report.metrics.roundWinRate'), pct(report.value.roundWinRate)],
    ],
  },
  {
    title: t('report.groups.duels'),
    rows: [
      [t('report.metrics.duelWins'), report.value.duelWins],
      [t('report.metrics.duelLosses'), report.value.duelLosses],
      [t('report.metrics.openingWins'), report.value.openingWins],
      [t('report.metrics.openingLosses'), report.value.openingLosses],
      [t('report.metrics.openingWinRate'), pct(report.value.openingWinRate)],
      [t('report.metrics.openingConversion'), pct(report.value.openingConversionRate)],
    ],
  },
  {
    title: t('report.groups.utility'),
    rows: [
      [t('report.metrics.grenadesThrown'), report.value.grenadesThrown],
      [t('report.metrics.utilityPerRound'), fmt(report.value.utilityPerRound, 2)],
      [t('report.metrics.flashesThrown'), report.value.flashesThrown],
      [t('report.metrics.enemiesBlinded'), report.value.enemiesBlinded],
      [t('report.metrics.enemiesBlindedPerRound'), fmt(report.value.enemiesBlindedPerRound, 2)],
      [t('report.metrics.blindSecondsPerFlash'), fmt(report.value.blindSecondsPerFlash, 1)],
    ],
  },
  {
    title: t('report.groups.impact'),
    rows: [
      [t('report.metrics.utilityDamage'), report.value.utilityDamage],
      [t('report.metrics.utilityDamagePerRound'), fmt(report.value.utilityDamagePerRound, 1)],
      [t('report.metrics.utilityDamagePerThrow'), fmt(report.value.utilityDamagePerThrow, 1)],
      [t('report.metrics.utilityKills'), report.value.utilityKills],
      [t('report.metrics.killsFromBlinds'), report.value.killsFromBlinds],
      [t('report.metrics.flashAssists'), report.value.flashAssists],
      [t('report.metrics.plants'), report.value.plants],
      [t('report.metrics.defuses'), report.value.defuses],
    ],
  },
])

const rankingCriteria = computed<{ key: RankingCriterion; label: string; value: (r: PlayerReport) => number; display: (r: PlayerReport) => string }[]>(() => [
  {
    key: 'impact',
    label: t('report.rankingCriteria.impact'),
    value: (r) => r.kills * 2 + r.assists + r.utilityDamage / 50 + r.enemiesBlinded * 0.25 + r.openingWins,
    display: (r) => fmt(r.kills * 2 + r.assists + r.utilityDamage / 50 + r.enemiesBlinded * 0.25 + r.openingWins, 1),
  },
  { key: 'kda', label: t('report.rankingCriteria.kda'), value: (r) => r.kda, display: (r) => fmt(r.kda, 2) },
  { key: 'adr', label: t('report.rankingCriteria.adr'), value: (r) => r.adr, display: (r) => fmt(r.adr, 1) },
  { key: 'kills', label: t('report.rankingCriteria.kills'), value: (r) => r.kills, display: (r) => String(r.kills) },
  { key: 'headshotPct', label: t('report.rankingCriteria.headshotPct'), value: (r) => r.headshotPct, display: (r) => pct(r.headshotPct) },
  { key: 'duelWinRate', label: t('report.rankingCriteria.duelWinRate'), value: (r) => r.duelWinRate, display: (r) => pct(r.duelWinRate) },
  { key: 'utilityDamage', label: t('report.rankingCriteria.utilityDamage'), value: (r) => r.utilityDamage, display: (r) => String(r.utilityDamage) },
  { key: 'enemiesBlinded', label: t('report.rankingCriteria.enemiesBlinded'), value: (r) => r.enemiesBlinded, display: (r) => String(r.enemiesBlinded) },
])

const activeRankingCriterion = computed(
  () => rankingCriteria.value.find((c) => c.key === rankingCriterion.value) ?? rankingCriteria.value[0],
)

const ranking = computed(() =>
  props.replay.players
    .map((p) => computePlayerReport(props.replay, p.steamId))
    .sort((a, b) => activeRankingCriterion.value.value(b) - activeRankingCriterion.value.value(a) || b.kills - a.kills),
)
</script>

<template>
  <div class="h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
    <div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
      <header class="flex flex-col gap-4 border-b border-ink-800 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">{{ t('report.title') }}</p>
          <h1 class="mt-1 font-display text-2xl text-ink-50">{{ report.name }}</h1>
          <p class="mt-1 text-sm text-ink-400">{{ matchLabel }} · {{ props.replay.map }} · {{ report.roundsPlayed }} {{ t('report.rounds') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="sr-only" for="report-player">{{ t('report.selectPlayer') }}</label>
          <select
            id="report-player"
            v-model="selectedSteamId"
            class="h-9 min-w-56 rounded-md border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-surge-400"
          >
            <option v-for="p in players" :key="p.steamId" :value="p.steamId">{{ p.name }}</option>
          </select>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-ink-700 px-3 text-sm text-ink-200 transition-colors hover:border-ink-500 hover:text-ink-50"
            @click="exportJson"
          >
            <UiIcon name="download" class="h-4 w-4" />
            JSON
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-ink-700 px-3 text-sm text-ink-200 transition-colors hover:border-ink-500 hover:text-ink-50"
            @click="exportCsv"
          >
            <UiIcon name="file" class="h-4 w-4" />
            CSV
          </button>
        </div>
      </header>

      <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="item in overview" :key="item.key" class="rounded-lg border border-ink-800 bg-ink-900/45 p-4">
          <p class="text-xs text-ink-500">{{ item.label }}</p>
          <p class="mt-1 font-mono text-3xl text-ink-50 tabular-nums">{{ item.value }}</p>
          <p class="mt-1 font-mono text-xs text-ink-500">{{ item.hint }}</p>
        </div>
      </section>

      <section class="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div class="grid gap-4 md:grid-cols-2">
          <article v-for="group in groups" :key="group.title" class="rounded-lg border border-ink-800 bg-ink-900/35">
            <h2 class="border-b border-ink-800 px-4 py-3 font-display text-sm text-ink-200">{{ group.title }}</h2>
            <div class="divide-y divide-ink-800/70">
              <div v-for="[label, value] in group.rows" :key="label" class="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span class="text-ink-400">{{ label }}</span>
                <span class="font-mono text-ink-100 tabular-nums">{{ value }}</span>
              </div>
            </div>
          </article>
        </div>

        <aside class="rounded-lg border border-ink-800 bg-ink-900/35">
          <div class="border-b border-ink-800 px-4 py-3">
            <h2 class="font-display text-sm text-ink-200">{{ t('report.ranking') }}</h2>
            <label class="mt-3 block text-xs text-ink-500" for="report-ranking">{{ t('report.rankingBy') }}</label>
            <select
              id="report-ranking"
              v-model="rankingCriterion"
              class="mt-1 h-9 w-full rounded-md border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-surge-400"
            >
              <option v-for="criterion in rankingCriteria" :key="criterion.key" :value="criterion.key">
                {{ criterion.label }}
              </option>
            </select>
          </div>
          <div class="divide-y divide-ink-800/70">
            <button
              v-for="(p, index) in ranking"
              :key="p.steamId"
              type="button"
              class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
              :class="p.steamId === selectedSteamId && 'bg-surge-400/10'"
              @click="selectedSteamId = p.steamId"
            >
              <span class="w-5 font-mono text-xs text-ink-500">{{ index + 1 }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-ink-100">{{ p.name }}</span>
                <span class="block font-mono text-xs text-ink-500">
                  {{ activeRankingCriterion.label }}: {{ activeRankingCriterion.display(p) }}
                </span>
              </span>
            </button>
          </div>
        </aside>
      </section>
    </div>
  </div>
</template>
