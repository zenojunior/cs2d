<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Replay, Round, Side } from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import HeatmapPlot from '@/viewer/analysis/HeatmapPlot.vue'
import UiIcon from '@/ui/UiIcon.vue'
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
type Source = 'deaths' | 'presence' | 'utility'
const source = ref<Source>('deaths')
const sideFilter = ref<Side | 'all'>('all')
const playerFilter = ref<string | 'all'>('all')
const roundFilter = ref<number | 'all'>('all')

const SOURCE_META: Record<Source, { labelKey: string; identity: boolean }> = {
  deaths: { labelKey: 'heatmap.deaths', identity: true },
  presence: { labelKey: 'heatmap.presence', identity: true },
  utility: { labelKey: 'heatmap.utility', identity: false },
}
// Identity (side/player) only exists when the point carries who it is. Grenade
// detonations do not carry the thrower, so the filter is ignored for them.
const hasIdentity = computed(() => SOURCE_META[source.value].identity)

/** A player side in that round (read from the first frame that contains them). */
const sideCache = new Map<string, Side | null>()
function sideInRound(round: Round, roundIdx: number, steamId: string): Side | null {
  const key = `${roundIdx}:${steamId}`
  const hit = sideCache.get(key)
  if (hit !== undefined) return hit
  let side: Side | null = null
  for (const f of round.frames) {
    const p = f.players.find((pl) => pl.steamId === steamId)
    if (p) {
      side = p.side
      break
    }
  }
  sideCache.set(key, side)
  return side
}

interface Pt {
  x: number
  y: number
  z: number
  side: Side | null
  steamId: string | null
}

/** Collects the points for the selected source (before side/level filters). */
const rawPoints = computed<Pt[]>(() => {
  const out: Pt[] = []
  const rounds = props.replay.rounds
  rounds.forEach((round, idx) => {
    if (roundFilter.value !== 'all' && idx !== roundFilter.value) return
    if (source.value === 'deaths') {
      for (const ev of round.events) {
        if (ev.type !== 'kill') continue
        out.push({
          x: ev.x,
          y: ev.y,
          z: ev.z,
          steamId: ev.victimSteamId,
          side: sideInRound(round, idx, ev.victimSteamId),
        })
      }
    } else if (source.value === 'utility') {
      for (const ev of round.events) {
        if (ev.type !== 'grenade') continue
        out.push({ x: ev.x, y: ev.y, z: ev.z, side: null, steamId: null })
      }
    } else {
      // Presence: every sample of every player. High volume, but binning is O(n).
      for (const f of round.frames) {
        for (const p of f.players) {
          if (!p.alive) continue
          out.push({ x: p.x, y: p.y, z: p.z, side: p.side, steamId: p.steamId })
        }
      }
    }
  })
  return out
})

/** Points after side/player (the level filter happens per plot). */
const points = computed<Pt[]>(() =>
  rawPoints.value.filter((p) => {
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

const totalPoints = computed(() => points.value.length)
</script>

<template>
  <div class="flex h-full w-full">
    <!-- Filters panel -->
    <aside class="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink-800 bg-ink-900/40 p-4">
      <div>
        <h3 class="flex items-center gap-2 font-display text-sm text-ink-50">
          <UiIcon name="bar-chart" class="h-4 w-4 text-surge-400" />
          {{ t('heatmap.title') }}
        </h3>
        <p class="mt-1 text-xs text-ink-500">{{ totalPoints }} {{ t('heatmap.points') }}</p>
      </div>

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
        <select
          v-model="playerFilter"
          class="w-full cursor-pointer rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-200"
        >
          <option value="all">{{ t('heatmap.all') }}</option>
          <option v-for="p in replay.players" :key="p.steamId" :value="p.steamId">{{ p.name }}</option>
        </select>
      </div>

      <!-- Round -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.round') }}</label>
        <select
          v-model="roundFilter"
          class="w-full cursor-pointer rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-200"
        >
          <option :value="'all'">{{ t('heatmap.allRounds') }}</option>
          <option v-for="(r, i) in replay.rounds" :key="i" :value="i">{{ t('heatmap.round') }} {{ r.number }}</option>
        </select>
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
