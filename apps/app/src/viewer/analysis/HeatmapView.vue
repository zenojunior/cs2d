<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Replay, Round, Side } from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import HeatmapPlot from '@/viewer/analysis/HeatmapPlot.vue'
import { roundSides } from '@/viewer/analysis/utilityStats'
import UiSelect from '@/ui/UiSelect.vue'
import UiRangeSlider from '@/ui/UiRangeSlider.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * 2D heatmap of the match. Handles the filters (data, side, player, round) and
 * builds the points; drawing lives in HeatmapPlot. On multi-floor maps (e.g.
 * Nuke) it renders one plot per level side by side, each with the floor radar
 * and only the points whose height (Z axis) falls in that range.
 */
const props = defineProps<{ replay: Replay }>()

const calibration = computed(
  () => MAP_CALIBRATION[props.replay.map] ?? MAP_CALIBRATION.de_dust2,
)
const levels = computed(() => calibration.value.levels ?? null)

// --- Filters ---
type Source = 'kills' | 'deaths' | 'presence'
const source = ref<Source>('deaths')
const sideFilter = ref<Side | 'all'>('all')
const playerFilter = ref<string | 'all'>('all')
const roundFilter = ref<number | 'all'>('all')

// Round-time window (live seconds, i.e. since the round went live), so the
// heatmap can be narrowed to a moment of the round (e.g. the last X seconds).
const timeRange = ref<number[]>([0, 0])
/** Freeze-time duration of a round, in seconds (event/frame `t` is since freeze). */
function freezeSeconds(round: Round): number {
  return (round.startTick - round.freezeStartTick) / props.replay.demoTickRate
}
/** Longest live round time across the match: the slider's upper bound. */
const maxRoundTime = computed(() => {
  let max = 0
  for (const round of props.replay.rounds) {
    const fz = freezeSeconds(round)
    const last = round.frames[round.frames.length - 1]
    if (last) max = Math.max(max, last.t - fz)
  }
  return Math.ceil(max)
})
// Start (and reset, if the demo changes) with the full range selected.
watch(maxRoundTime, (m) => (timeRange.value = [0, m]), { immediate: true })
const isFullRange = computed(
  () => timeRange.value[0] <= 0 && timeRange.value[1] >= maxRoundTime.value,
)

const SOURCE_META: Record<Source, { labelKey: string; identity: boolean }> = {
  kills: { labelKey: 'heatmap.kills', identity: true },
  deaths: { labelKey: 'heatmap.deaths', identity: true },
  presence: { labelKey: 'heatmap.presence', identity: true },
}
// Identity (side/player) only exists when the point carries who it is. Grenade
// detonations do not carry the thrower, so the filter is ignored for them.
const hasIdentity = computed(() => SOURCE_META[source.value].identity)

/** A player's side in that round, from the live frames (so the pistol round's
 *  post-knife side swap doesn't invert CT/T; see `roundSides`). Cached per round. */
const sideCache = new Map<number, Map<string, Side>>()
function sideInRound(round: Round, roundIdx: number, steamId: string): Side | null {
  let sides = sideCache.get(roundIdx)
  if (!sides) sideCache.set(roundIdx, (sides = roundSides(round)))
  return sides.get(steamId) ?? null
}

/** A player's position at (or nearest to) a tick, from the round's frames. Used
 *  for kills, where the event only carries the victim's position, not the killer's. */
function playerPosAt(round: Round, steamId: string, tick: number) {
  let best: { x: number; y: number; z: number } | null = null
  let bestDiff = Infinity
  for (const f of round.frames) {
    const diff = Math.abs(f.tick - tick)
    if (diff >= bestDiff) continue
    const p = f.players.find((pl) => pl.steamId === steamId)
    if (!p) continue
    bestDiff = diff
    best = { x: p.x, y: p.y, z: p.z }
  }
  return best
}

interface Pt {
  x: number
  y: number
  z: number
  side: Side | null
  steamId: string | null
  /** Live round time of the point, in seconds (since the round went live). */
  t: number
}

/** Collects the points for the selected source (before side/level filters). */
const rawPoints = computed<Pt[]>(() => {
  const out: Pt[] = []
  const rounds = props.replay.rounds
  rounds.forEach((round, idx) => {
    if (roundFilter.value !== 'all' && idx !== roundFilter.value) return
    const fz = freezeSeconds(round)
    if (source.value === 'deaths') {
      for (const ev of round.events) {
        if (ev.type !== 'kill') continue
        out.push({
          x: ev.x,
          y: ev.y,
          z: ev.z,
          steamId: ev.victimSteamId,
          side: sideInRound(round, idx, ev.victimSteamId),
          t: Math.max(0, ev.t - fz),
        })
      }
    } else if (source.value === 'kills') {
      // The kill event carries the victim's position, so the killer's spot is
      // read from the frames at the kill tick.
      for (const ev of round.events) {
        if (ev.type !== 'kill' || !ev.attackerSteamId) continue
        const pos = playerPosAt(round, ev.attackerSteamId, ev.tick)
        if (!pos) continue
        out.push({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          steamId: ev.attackerSteamId,
          side: sideInRound(round, idx, ev.attackerSteamId),
          t: Math.max(0, ev.t - fz),
        })
      }
    } else {
      // Presence: every sample of every player. High volume, but binning is O(n).
      // Skip freeze-time frames: players sit still in spawn during the buy period,
      // which otherwise makes the CT/T bases dwarf every real position on the map.
      for (const f of round.frames) {
        if (f.tick < round.startTick) continue
        for (const p of f.players) {
          if (!p.alive) continue
          out.push({ x: p.x, y: p.y, z: p.z, side: p.side, steamId: p.steamId, t: Math.max(0, f.t - fz) })
        }
      }
    }
  })
  return out
})

/** Points after side/player/time (the level filter happens per plot). */
const points = computed<Pt[]>(() =>
  rawPoints.value.filter((p) => {
    if (!isFullRange.value && (p.t < timeRange.value[0] || p.t > timeRange.value[1])) return false
    if (hasIdentity.value) {
      if (sideFilter.value !== 'all' && p.side !== sideFilter.value) return false
      if (playerFilter.value !== 'all' && p.steamId !== playerFilter.value) return false
    }
    return true
  }),
)

interface Plot {
  key: string
  label?: string
  radar: string
  points: { x: number; y: number }[]
}

/** One plot per floor (multi-level maps) or a single plot. */
const plots = computed<Plot[]>(() => {
  if (levels.value) {
    return levels.value.map((lvl, i) => ({
      key: `${lvl.name}-${i}`,
      label: lvl.name,
      radar: lvl.radar ?? calibration.value.radar,
      points: points.value.filter((p) => p.z >= lvl.minZ && p.z < lvl.maxZ),
    }))
  }
  return [{ key: 'single', radar: calibration.value.radar, points: points.value }]
})

// --- Select options (UiSelect uses string values) ---
const playerOptions = computed(() => [
  { value: 'all', label: t('heatmap.all') },
  ...props.replay.players.map((p) => ({ value: p.steamId, label: p.name })),
])
const roundOptions = computed(() => [
  { value: 'all', label: t('heatmap.allRounds') },
  ...props.replay.rounds.map((r, i) => ({ value: String(i), label: `${t('heatmap.round')} ${r.number}` })),
])
/** Bridges the string-valued round select to the `number | 'all'` filter. */
const roundFilterModel = computed<string>({
  get: () => (roundFilter.value === 'all' ? 'all' : String(roundFilter.value)),
  set: (v) => (roundFilter.value = v === 'all' ? 'all' : Number(v)),
})
</script>

<template>
  <div class="flex h-full w-full">
    <!-- Filters panel -->
    <aside class="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink-800 bg-ink-900/40 p-4">
      <!-- Source -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.data') }}</label>
        <div class="grid grid-cols-3 overflow-hidden rounded-md border border-ink-700">
          <button
            v-for="(meta, key) in SOURCE_META"
            :key="key"
            type="button"
            class="cursor-pointer px-1 py-1.5 text-xs transition-colors"
            :class="source === key ? 'bg-surge-500/20 text-surge-200' : 'text-ink-300 hover:bg-ink-800'"
            @click="source = key as Source"
          >
            {{ t(meta.labelKey) }}
          </button>
        </div>
      </div>

      <!-- Side -->
      <div :class="{ 'pointer-events-none opacity-40': !hasIdentity }">
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.side') }}</label>
        <div class="flex overflow-hidden rounded-md border border-ink-700">
          <button
            v-for="s in (['all', 'CT', 'T'] as const)"
            :key="s"
            type="button"
            class="flex-1 cursor-pointer px-2 py-1.5 text-xs transition-colors"
            :class="sideFilter === s ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
            :style="sideFilter === s && s !== 'all' ? { color: SIDE_COLOR[s] } : undefined"
            @click="sideFilter = s"
          >
            {{ s === 'all' ? t('heatmap.both') : s }}
          </button>
        </div>
      </div>

      <!-- Player -->
      <div :class="{ 'pointer-events-none opacity-40': !hasIdentity }">
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.player') }}</label>
        <UiSelect v-model="playerFilter" :options="playerOptions" class="w-full" />
      </div>

      <!-- Round -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.round') }}</label>
        <UiSelect v-model="roundFilterModel" :options="roundOptions" class="w-full" />
      </div>

      <!-- Round time window -->
      <div>
        <div class="mb-1 flex items-center justify-between">
          <label class="text-xs font-medium text-ink-300">{{ t('heatmap.time') }}</label>
          <span class="font-mono text-xs text-ink-500">{{ timeRange[0] }}s – {{ timeRange[1] }}s</span>
        </div>
        <UiRangeSlider v-model="timeRange" :max="maxRoundTime" />
      </div>

      <p v-if="levels" class="text-xs text-ink-600">
        {{ t('heatmap.multiLevelNote', { map: replay.map.replace(/^de_/, '') }) }}
      </p>
    </aside>

    <!-- Plots: one per floor (side by side) or a single one -->
    <div class="flex min-w-0 flex-1 divide-x divide-ink-800">
      <HeatmapPlot
        v-for="plot in plots"
        :key="plot.key"
        :points="plot.points"
        :calibration="calibration"
        :radar="plot.radar"
        :label="plot.label"
      />
    </div>
  </div>
</template>
