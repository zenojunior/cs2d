<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Replay, Side } from '@/viewer/domain/schema'
import UiBottomSheet from '@/ui/UiBottomSheet.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'
import type { ReplayAnalysis } from '@/viewer/analysis/report/playerReportStats'
import { ratio } from '@/viewer/analysis/report/playerReportStats'

type Domain = 'combat' | 'duels' | 'utility' | 'objectives' | 'economy'

const props = defineProps<{
  open: boolean
  domain: Domain | Domain[]
  replay: Replay
  analysis: ReplayAnalysis
  sourceLabel?: string
}>()

const emit = defineEmits<{ 'update:open': [boolean] }>()
const { t } = useI18n()
const selectedSteamId = ref(props.replay.players[0]?.steamId ?? '')
const selectedSide = ref<Side>('CT')

watch(() => props.replay, (replay) => {
  if (!replay.players.some((p) => p.steamId === selectedSteamId.value)) selectedSteamId.value = replay.players[0]?.steamId ?? ''
})

const players = computed(() => [...props.replay.players].sort((a, b) => a.name.localeCompare(b.name)))
const playerName = computed(() => props.replay.players.find((p) => p.steamId === selectedSteamId.value)?.name ?? selectedSteamId.value)
const domains = computed(() => (Array.isArray(props.domain) ? props.domain : [props.domain]))
const title = computed(() => t('report.title'))
const subtitle = computed(() => t('report.subtitle'))
const rounds = computed(() => Math.max(1, props.analysis.combat.get(selectedSteamId.value)?.roundsPlayed ?? props.replay.rounds.length))

function fmt(value: number, digits = 1): string { return Number.isFinite(value) ? value.toFixed(digits) : '-' }
function pct(value: number): string { return `${fmt(value * 100, 0)}%` }

function rowsForDomain(domain: Domain): [string, string | number][] {
  const id = selectedSteamId.value
  const combat = props.analysis.combat.get(id)
  const duels = props.analysis.duels.get(id)
  const utility = props.analysis.utility.get(id)
  const objective = props.analysis.objectives.get(id)
  const played = Math.max(1, combat?.roundsPlayed ?? rounds.value)
  if (domain === 'combat') return [
    [t('report.metrics.kills'), combat?.kills ?? 0],
    [t('report.metrics.assists'), combat?.assists ?? 0],
    [t('report.metrics.deaths'), combat?.deaths ?? 0],
    [t('report.metrics.kdr'), fmt(ratio(combat?.kills ?? 0, combat?.deaths ?? 0), 2)],
    [t('report.metrics.kda'), fmt(ratio((combat?.kills ?? 0) + (combat?.assists ?? 0), combat?.deaths ?? 0), 2)],
    [t('report.metrics.damage'), combat?.damage ?? 0],
    [t('report.metrics.adr'), fmt((combat?.damage ?? 0) / played, 1)],
    [t('report.metrics.headshotPct'), pct(ratio(combat?.headshotKills ?? 0, combat?.kills ?? 0))],
    [t('report.metrics.roundWinRate'), pct(ratio(combat?.roundsWon ?? 0, combat?.roundsPlayed ?? 0))],
  ]
  if (domain === 'duels') return [
    [t('report.metrics.duelWins'), duels?.wins ?? 0],
    [t('report.metrics.duelLosses'), duels?.losses ?? 0],
    [t('report.metrics.duelWinRate'), pct(ratio(duels?.wins ?? 0, (duels?.wins ?? 0) + (duels?.losses ?? 0)))],
    [t('report.metrics.openingWins'), duels?.openingWins ?? 0],
    [t('report.metrics.openingLosses'), duels?.openingLosses ?? 0],
    [t('report.metrics.openingWinRate'), pct(ratio(duels?.openingWins ?? 0, (duels?.openingWins ?? 0) + (duels?.openingLosses ?? 0)))],
    [t('report.metrics.openingConversion'), pct(ratio(duels?.openingConversions ?? 0, duels?.openingWins ?? 0))],
  ]
  if (domain === 'utility') return [
    [t('report.metrics.grenadesThrown'), utility?.grenadesThrown ?? 0],
    [t('report.metrics.utilityPerRound'), fmt((utility?.grenadesThrown ?? 0) / played, 2)],
    [t('report.metrics.flashesThrown'), utility?.flashesThrown ?? 0],
    [t('report.metrics.enemiesBlinded'), utility?.enemiesBlinded ?? 0],
    [t('report.metrics.enemiesBlindedPerRound'), fmt((utility?.enemiesBlinded ?? 0) / played, 2)],
    [t('report.metrics.blindSecondsPerFlash'), fmt(ratio(utility?.enemyBlindDuration ?? 0, utility?.flashesThrown ?? 0), 1)],
    [t('report.metrics.utilityDamage'), utility?.utilityDamage ?? 0],
    [t('report.metrics.utilityDamagePerRound'), fmt((utility?.utilityDamage ?? 0) / played, 1)],
    [t('report.metrics.utilityDamagePerThrow'), fmt(ratio(utility?.utilityDamage ?? 0, utility?.damagingUtilityThrown ?? 0), 1)],
    [t('report.metrics.killsFromBlinds'), utility?.killsFromBlinds ?? 0],
    [t('report.metrics.flashAssists'), utility?.flashAssists ?? 0],
    [t('report.metrics.utilityKills'), utility?.utilityKills ?? 0],
  ]
  if (domain === 'objectives') return [
    [t('report.metrics.plants'), objective?.plants ?? 0],
    [t('report.metrics.defuses'), objective?.defuses ?? 0],
  ]
  const economy = props.analysis.economy[selectedSide.value]
  return [
    [t('report.metrics.rounds'), economy.rounds],
    [t('report.metrics.roundsWon'), economy.wins],
    [t('report.metrics.roundsLost'), economy.losses],
    [t('report.metrics.startMoney'), fmt(economy.startMoney / Math.max(1, economy.rounds), 0)],
    [t('report.metrics.equipValue'), fmt(economy.equipValue / Math.max(1, economy.rounds), 0)],
  ]
}

const sections = computed(() => domains.value.map((domain) => ({
  domain,
  title: t(`report.groups.${domain}`),
  rows: rowsForDomain(domain),
})))

function exportData() {
  const data = Object.fromEntries(sections.value.flatMap((section) => section.rows.map(([label, value]) => [label, value])))
  const domainName = domains.value.join('-')
  const payload = { exportedAt: new Date().toISOString(), source: props.sourceLabel ?? null, domain: domains.value, player: domains.value.includes('economy') ? selectedSide.value : playerName.value, metrics: data }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report-${domainName}-${(domains.value.includes('economy') ? selectedSide.value : playerName.value).replace(/[^a-z0-9_-]+/gi, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <UiBottomSheet :open="open" :title="title" @update:open="(value) => emit('update:open', value)">
    <div class="flex min-h-0 flex-col">
      <header class="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
        <div>
          <h2 class="font-display text-lg text-ink-50">{{ title }}</h2>
          <p class="mt-1 text-sm text-ink-400">{{ subtitle }}</p>
        </div>
        <button type="button" class="rounded-md p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-50" :aria-label="t('report.close')" @click="emit('update:open', false)">
          <UiIcon name="x" class="h-5 w-5" />
        </button>
      </header>
      <div class="flex flex-wrap items-center gap-2 border-b border-ink-800 px-5 py-3">
        <select v-if="!domains.includes('economy')" v-model="selectedSteamId" class="h-9 min-w-52 rounded-md border border-ink-700 bg-ink-950 px-3 text-sm text-ink-100">
          <option v-for="player in players" :key="player.steamId" :value="player.steamId">{{ player.name }}</option>
        </select>
        <select v-if="domains.includes('economy')" v-model="selectedSide" class="h-9 rounded-md border border-ink-700 bg-ink-950 px-3 text-sm text-ink-100">
          <option value="CT">CT</option>
          <option value="T">T</option>
        </select>
        <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-ink-700 px-3 text-sm text-ink-200 hover:border-ink-500 hover:text-ink-50" @click="exportData">
          <UiIcon name="download" class="h-4 w-4" />
          {{ t('report.export') }}
        </button>
      </div>
      <div class="min-h-0 overflow-y-auto px-5 py-4">
        <div class="space-y-5">
          <section v-for="section in sections" :key="section.domain">
            <h3 class="mb-2 font-display text-sm text-ink-300">{{ section.title }}</h3>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div v-for="[label, value] in section.rows" :key="label" class="flex items-center justify-between gap-4 rounded-md border border-ink-800 bg-ink-950/50 px-4 py-3">
                <span class="text-sm text-ink-400">{{ label }}</span>
                <span class="font-mono text-sm text-ink-50 tabular-nums">{{ value }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </UiBottomSheet>
</template>
