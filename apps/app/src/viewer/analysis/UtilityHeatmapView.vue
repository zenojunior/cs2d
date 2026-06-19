<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GrenadeEvent, GrenadeKind, Replay, Round, Side } from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { KIND_ORDER, grenadeIconStyle } from '@/viewer/domain/grenades'
import HeatmapPlot from '@/viewer/analysis/HeatmapPlot.vue'
import { groupTeams, isKnifeRound, roundSides } from '@/viewer/analysis/utilityStats'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * Heatmap of grenade detonations, as a sub-tab of the Utilities page. Filterable
 * by grenade type, team and a multi-select of rounds. On multi-floor maps (e.g.
 * Nuke) it renders one plot per level.
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

// --- Round multi-select (checkboxes) ---
// Knife rounds carry no real utility and don't count on the scoreboard, so they
// are not offered as a filter option.
const selectableRounds = computed(() =>
  props.replay.rounds
    .map((round, index) => ({ round, index }))
    .filter(({ round }) => !isKnifeRound(round)),
)
const selectableIndices = computed(() => selectableRounds.value.map((r) => r.index))
const selectedRounds = ref<Set<number>>(new Set(selectableIndices.value))
const allSelected = computed(() => selectedRounds.value.size === selectableIndices.value.length)
function toggleAllRounds() {
  selectedRounds.value = allSelected.value ? new Set() : new Set(selectableIndices.value)
}
function toggleRound(i: number) {
  const next = new Set(selectedRounds.value)
  next.has(i) ? next.delete(i) : next.add(i)
  selectedRounds.value = next
}

/** Side the selected team played in a round (a team plays both sides over the
 *  match), or null when no team is selected. Drives the round checkbox color. */
const sideCache = new Map<number, Map<string, Side>>()
function teamSideInRound(idx: number): Side | null {
  if (teamFilter.value === 'all') return null
  let sides = sideCache.get(idx)
  if (!sides) sideCache.set(idx, (sides = roundSides(props.replay.rounds[idx])))
  for (const p of teams.value[teamFilter.value].players) {
    const s = sides.get(p.steamId)
    if (s) return s
  }
  return null
}

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

/** Grenade detonations matching the kind/team/round filters (before the per-plot level filter). */
const points = computed<Pt[]>(() => {
  const out: Pt[] = []
  props.replay.rounds.forEach((round, idx) => {
    if (!selectedRounds.value.has(idx)) return
    for (const ev of round.events) {
      if (ev.type !== 'grenade') continue
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
  <div class="flex h-full w-full">
    <!-- Filters panel -->
    <aside class="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink-800 bg-ink-900/40 p-4">
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

      <!-- Rounds (multi-select) -->
      <div class="flex min-h-0 flex-col">
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.round') }}</label>
        <label class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-ink-200 hover:bg-ink-800">
          <input type="checkbox" :checked="allSelected" class="accent-surge-500" @change="toggleAllRounds" />
          {{ t('heatmap.allRounds') }}
        </label>
        <div class="mt-1 grid grid-cols-2 gap-0.5">
          <label
            v-for="{ round, index } in selectableRounds"
            :key="index"
            class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-ink-300 hover:bg-ink-800"
          >
            <input
              type="checkbox"
              :checked="selectedRounds.has(index)"
              class="accent-surge-500"
              :style="teamSideInRound(index) ? { accentColor: SIDE_COLOR[teamSideInRound(index)!] } : undefined"
              @change="toggleRound(index)"
            />
            {{ round.number }}
          </label>
        </div>
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
