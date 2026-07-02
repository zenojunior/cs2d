<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GrenadeEvent, GrenadeKind, Replay, Round, Side } from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { KIND_ORDER, grenadeIconStyle } from '@/viewer/domain/grenades'
import HeatmapPlot from '@/viewer/analysis/shared/HeatmapPlot.vue'
import RoundStrip from '@/viewer/analysis/shared/RoundStrip.vue'
import RoundTimeRange from '@/viewer/analysis/shared/RoundTimeRange.vue'
import { freezeSeconds, maxLiveRoundTime } from '@/viewer/analysis/shared/roundTime'
import { groupTeams } from '@/viewer/domain/teams'
import { isKnifeRound } from '@/viewer/domain/rounds'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * Heatmap of grenade detonations, as a sub-tab of the Utilities page. Filterable
 * by grenade type, team and round (a single round or all, via the shared
 * RoundStrip timeline). On multi-floor maps (e.g. Nuke) one plot per level.
 *
 * Detonation events carry the position (x/y/z) but not the thrower, so the team
 * is recovered by matching each detonation to the grenade arc (`grenadePaths`,
 * which carries `throwerSteamId`) of the same kind that lands nearest to it.
 */
const props = defineProps<{ replay: Replay }>()

const calibration = computed(
  () => MAP_CALIBRATION[props.replay.map] ?? MAP_CALIBRATION.de_dust2,
)
const levels = computed(() => calibration.value.levels ?? null)

// --- Filters ---
const kindFilter = ref<GrenadeKind | 'all'>('all')
// 0 = team that started CT, 1 = team that started T (stable team identity).
const teamFilter = ref<0 | 1 | 'all'>('all')

const teams = computed(() => groupTeams(props.replay))
/** Start side per steamId, used to map a thrower to its (stable) team. */
const startSideById = computed(() => {
  const m = new Map<string, Side>()
  for (const p of props.replay.players) m.set(p.steamId, p.startSide)
  return m
})

// Round filter: a single round or all of them, via the shared RoundStrip
// timeline (matching the kills/deaths heatmaps). Knife rounds are hidden there
// and skipped below.
const roundFilter = ref<number | 'all'>('all')

// Round-time window (live seconds), to narrow detonations to a moment of the
// round (e.g. only execute-time smokes). Defaults to the whole round.
const maxRoundTime = computed(() => maxLiveRoundTime(props.replay))
const timeRange = ref<number[]>([0, 0])
watch(maxRoundTime, (m) => (timeRange.value = [0, m]), { immediate: true })

/** Thrower's team for a detonation (0/1), or null when it can't be resolved. */
function teamOfDetonation(round: Round, det: GrenadeEvent): 0 | 1 | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const path of round.grenadePaths) {
    if (path.kind !== det.kind || !path.throwerSteamId) continue
    const last = path.points[path.points.length - 1]
    if (!last) continue
    const d = Math.hypot(last.x - det.x, last.y - det.y)
    if (d < bestDist) {
      bestDist = d
      best = path.throwerSteamId
    }
  }
  if (!best) return null
  const side = startSideById.value.get(best)
  return side === 'CT' ? 0 : side === 'T' ? 1 : null
}

interface Pt {
  x: number
  y: number
  z: number
}

/** Grenade detonations matching the kind/team/round/time filters (before the per-plot level filter). */
const points = computed<Pt[]>(() => {
  const out: Pt[] = []
  const [lo, hi] = timeRange.value
  props.replay.rounds.forEach((round, idx) => {
    if (roundFilter.value !== 'all' && idx !== roundFilter.value) return
    // Knife rounds carry no real utility, so they're excluded from "all" too.
    if (isKnifeRound(round)) return
    const fz = freezeSeconds(round, props.replay.demoTickRate)
    for (const ev of round.events) {
      if (ev.type !== 'grenade') continue
      // Keep the grenade if its active window (detonation -> effect end, in live
      // seconds) overlaps the selected one: a smoke/molotov that lingers into the
      // window counts even if it went off earlier. HE/flash are ~instant.
      const start = Math.max(0, ev.t - fz)
      const end = Math.max(0, ev.endT - fz)
      if (end < lo || start > hi) continue
      if (kindFilter.value !== 'all' && ev.kind !== kindFilter.value) continue
      if (teamFilter.value !== 'all' && teamOfDetonation(round, ev) !== teamFilter.value) continue
      out.push({ x: ev.x, y: ev.y, z: ev.z })
    }
  })
  return out
})

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
</script>

<template>
  <div class="flex h-full w-full flex-col sm:flex-row">
    <!-- Filters panel: full width on top on mobile, fixed side column from sm up. -->
    <aside class="flex max-h-[40vh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-ink-800 bg-ink-900/40 p-4 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
      <!-- Grenade type -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.data') }}</label>
        <div class="flex flex-wrap gap-1">
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-0.5 text-xs transition-colors"
            :class="kindFilter === 'all' ? 'bg-surge-500/20 text-surge-200' : 'text-ink-300 hover:bg-ink-800'"
            @click="kindFilter = 'all'"
          >
            {{ t('heatmap.all') }}
          </button>
          <button
            v-for="k in KIND_ORDER"
            :key="k"
            type="button"
            class="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors"
            :class="kindFilter === k ? 'bg-surge-500/20 text-surge-200' : 'text-ink-300 hover:bg-ink-800'"
            @click="kindFilter = k"
          >
            <span class="h-3.5 w-3.5" :style="grenadeIconStyle(k)" />
            {{ t(`grenadeKind.${k}`) }}
          </button>
        </div>
      </div>

      <!-- Team -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.team') }}</label>
        <div class="flex overflow-hidden rounded-md border border-ink-700">
          <button
            type="button"
            class="flex-1 cursor-pointer px-2 py-1.5 text-xs transition-colors"
            :class="teamFilter === 'all' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
            @click="teamFilter = 'all'"
          >
            {{ t('heatmap.all') }}
          </button>
          <button
            v-for="team in teams"
            :key="team.id"
            type="button"
            class="flex-1 cursor-pointer truncate px-2 py-1.5 text-xs transition-colors"
            :class="teamFilter === team.id ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
            :style="teamFilter === team.id ? { color: SIDE_COLOR[team.id === 0 ? 'CT' : 'T'] } : undefined"
            :title="team.name || (team.id === 0 ? 'CT' : 'T')"
            @click="teamFilter = team.id"
          >
            {{ team.name || (team.id === 0 ? 'CT' : 'T') }}
          </button>
        </div>
      </div>

      <p v-if="levels" class="text-xs text-ink-600">
        {{ t('heatmap.multiLevelNote', { map: replay.map.replace(/^de_/, '') }) }}
      </p>
    </aside>

    <!-- Plots: one per floor (side by side) or a single one -->
    <div class="relative min-h-0 min-w-0 flex-1">
      <div class="flex h-full divide-x divide-ink-800">
      <HeatmapPlot
        v-for="plot in plots"
        :key="plot.key"
        :points="plot.points"
        :calibration="calibration"
        :radar="plot.radar"
        :label="plot.label"
      />
      </div>

      <!-- Round timeline: floats over the heatmap, matching the kills/deaths
           pages. Hovering reveals the round bubbles above the bar. -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-ink-950/80 to-transparent p-4">
        <div class="group pointer-events-auto w-full max-w-xl rounded-lg border border-ink-700 bg-ink-900/80 px-3 py-2 backdrop-blur">
          <RoundStrip
            v-model="roundFilter"
            :rounds="replay.rounds"
            :demo-tick-rate="replay.demoTickRate"
            allow-all
            hide-knife
          />
          <div class="mb-1 flex items-center justify-between">
            <label class="text-xs font-medium text-ink-300">{{ t('heatmap.time') }}</label>
            <span class="font-mono text-xs text-ink-400">{{ timeRange[0] }}s – {{ timeRange[1] }}s</span>
          </div>
          <RoundTimeRange v-model="timeRange" :max="maxRoundTime" />
        </div>
      </div>
    </div>
  </div>
</template>
