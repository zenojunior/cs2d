<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Replay, Round, Side } from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import HeatmapPlot from '@/viewer/analysis/HeatmapPlot.vue'
import UtilityHeatmapView from '@/viewer/analysis/UtilityHeatmapView.vue'
import type { KillInfo } from '@/viewer/analysis/heatmapTypes'
import { killWeaponIcon } from '@/viewer/domain/weaponIcons'
import { isKnifeRound, roundSides } from '@/viewer/analysis/utilityStats'
import UiSelect from '@/ui/UiSelect.vue'
import RoundTimeRange from '@/viewer/analysis/RoundTimeRange.vue'
import RoundStrip from '@/viewer/analysis/RoundStrip.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * 2D heatmap of the match. Handles the filters (data, side, player, round) and
 * builds the points; drawing lives in HeatmapPlot. On multi-floor maps (e.g.
 * Nuke) it renders one plot per level side by side, each with the floor radar
 * and only the points whose height (Z axis) falls in that range.
 */
type Source = 'kills' | 'deaths' | 'presence' | 'grenades'

const props = defineProps<{
  replay: Replay
  /** Active heatmap page (presence/kills/deaths/grenades), driven by the URL. */
  source: Source
}>()

const emit = defineEmits<{
  /** Switch heatmap page (the parent maps it to a URL). */
  (e: 'update:source', value: Source): void
  /** Seek the replay to a kill (clicked on a kill/death marker). */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const calibration = computed(
  () => MAP_CALIBRATION[props.replay.map] ?? MAP_CALIBRATION.de_dust2,
)
const levels = computed(() => calibration.value.levels ?? null)

// --- Filters ---
const sideFilter = ref<Side | 'all'>('all')
// Team is identified by the side it started on (rosters are fixed for the match;
// only the side swaps at halftime), so 'CT'/'T' here mean the started-CT / -T team.
const teamFilter = ref<Side | 'all'>('all')
const playerFilter = ref<string | 'all'>('all')
const roundFilter = ref<number | 'all'>('all')

/** steamId -> the side the player started on (their team key). */
const teamOf = computed(() => {
  const m = new Map<string, Side>()
  for (const p of props.replay.players) m.set(p.steamId, p.startSide)
  return m
})
// Team display names come from the first round (CT/T names before any swap).
const teamNames = computed<Record<Side, string>>(() => {
  const first = props.replay.rounds[0]
  return { CT: first?.ctName || 'CT', T: first?.tName || 'T' }
})

// Narrow the player select to the chosen team; reset the player if it no longer fits.
watch(teamFilter, (team) => {
  if (team === 'all' || playerFilter.value === 'all') return
  if (teamOf.value.get(playerFilter.value) !== team) playerFilter.value = 'all'
})

// Round-time window (live seconds, i.e. since the round went live), so the
// heatmap can be narrowed to a moment of the round (e.g. the last X seconds).
const timeRange = ref<number[]>([0, 0])
/** Freeze-time duration of a round, in seconds (event/frame `t` is since freeze). */
function freezeSeconds(round: Round): number {
  return (round.startTick - round.freezeStartTick) / props.replay.demoTickRate
}
// Absolute tick ranges of match pauses (tactical timeouts / tech pauses). While
// paused, every player stands frozen at spawn, so those frames would pile
// hundreds of samples onto a handful of base spots and dwarf the real positions.
// They are dropped from the presence heatmap (and from the slider's range below).
const pauseRanges = computed(() =>
  (props.replay.pauses ?? []).map((p) => [p.startTick, p.endTick] as const),
)
function isPaused(tick: number): boolean {
  for (const [start, end] of pauseRanges.value) if (tick >= start && tick <= end) return true
  return false
}
/** Longest live round time across the match (excluding pauses): the slider's
 *  upper bound. The last frame can fall inside a pause, so scan for the latest
 *  non-paused frame rather than just taking `frames.at(-1)`. */
const maxRoundTime = computed(() => {
  let max = 0
  for (const round of props.replay.rounds) {
    const fz = freezeSeconds(round)
    for (const f of round.frames) {
      if (isPaused(f.tick)) continue
      max = Math.max(max, f.t - fz)
    }
  }
  return Math.ceil(max)
})
// Start (and reset, if the demo changes) with the first 30 live seconds selected.
watch(maxRoundTime, (m) => (timeRange.value = [0, Math.min(30, m)]), { immediate: true })
const isFullRange = computed(
  () => timeRange.value[0] <= 0 && timeRange.value[1] >= maxRoundTime.value,
)

const SOURCE_META: Record<Source, { labelKey: string; identity: boolean }> = {
  presence: { labelKey: 'heatmap.presence', identity: true },
  kills: { labelKey: 'heatmap.kills', identity: true },
  deaths: { labelKey: 'heatmap.deaths', identity: true },
  // Grenade detonation density. It carries its own filters/plots
  // (UtilityHeatmapView), so the shared sidebar below is skipped for it.
  grenades: { labelKey: 'heatmap.grenades', identity: false },
}
// Identity (side/player) only exists when the point carries who it is. Grenade
// detonations do not carry the thrower, so the filter is ignored for them.
const hasIdentity = computed(() => SOURCE_META[props.source].identity)

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
  /** Kill description (kills/deaths sources), for the click popover + jump. */
  kill?: KillInfo
}

/** steamId -> display name, for the kill popover. */
const nameById = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.replay.players) m.set(p.steamId, p.name)
  return m
})

/** Builds the "who killed whom" description shared by kills and deaths points. */
function killInfo(round: Round, idx: number, ev: Extract<Round['events'][number], { type: 'kill' }>): KillInfo {
  const aSide = ev.attackerSteamId ? sideInRound(round, idx, ev.attackerSteamId) : null
  const vSide = sideInRound(round, idx, ev.victimSteamId)
  const aPos = ev.attackerSteamId ? playerPosAt(round, ev.attackerSteamId, ev.tick) : null
  return {
    roundIndex: idx,
    t: ev.t,
    roundNumber: round.number,
    attackerName: ev.attackerSteamId ? (nameById.value.get(ev.attackerSteamId) ?? '?') : null,
    attackerColor: aSide ? SIDE_COLOR[aSide] : '#cbd5e1',
    victimName: nameById.value.get(ev.victimSteamId) ?? '?',
    victimColor: vSide ? SIDE_COLOR[vSide] : '#cbd5e1',
    weapon: ev.weapon,
    weaponIcon: killWeaponIcon(ev.weapon),
    headshot: ev.headshot,
    assistedFlash: ev.assistedFlash,
    ax: aPos?.x ?? null,
    ay: aPos?.y ?? null,
    vx: ev.x,
    vy: ev.y,
  }
}

/** Collects the points for the selected source (before side/level filters). */
const rawPoints = computed<Pt[]>(() => {
  const out: Pt[] = []
  const rounds = props.replay.rounds
  rounds.forEach((round, idx) => {
    if (roundFilter.value !== 'all' && idx !== roundFilter.value) return
    // The knife round has no meaningful positions to map, so skip it entirely.
    if (isKnifeRound(round)) return
    const fz = freezeSeconds(round)
    if (props.source === 'deaths') {
      for (const ev of round.events) {
        if (ev.type !== 'kill') continue
        out.push({
          x: ev.x,
          y: ev.y,
          z: ev.z,
          steamId: ev.victimSteamId,
          side: sideInRound(round, idx, ev.victimSteamId),
          t: Math.max(0, ev.t - fz),
          kill: killInfo(round, idx, ev),
        })
      }
    } else if (props.source === 'kills') {
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
          kill: killInfo(round, idx, ev),
        })
      }
    } else {
      // Presence: every sample of every player. High volume, but binning is O(n).
      // Skip freeze-time frames: players sit still in spawn during the buy period,
      // which otherwise makes the CT/T bases dwarf every real position on the map.
      // Same reasoning for pauses (timeouts): everyone is frozen at spawn.
      for (const f of round.frames) {
        if (f.tick < round.startTick) continue
        if (isPaused(f.tick)) continue
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
      if (teamFilter.value !== 'all' && (!p.steamId || teamOf.value.get(p.steamId) !== teamFilter.value)) return false
      if (playerFilter.value !== 'all' && p.steamId !== playerFilter.value) return false
    }
    return true
  }),
)

interface Plot {
  key: string
  label?: string
  radar: string
  points: { x: number; y: number; side: Side | null; kill?: KillInfo }[]
}

// Discrete events (kills/deaths) read better as individual colored dots than as
// a density blob; presence stays a heatmap.
const plotMode = computed<'heat' | 'dots'>(() => (props.source === 'presence' ? 'heat' : 'dots'))
// Deaths read clearest as skulls; kills stay simple dots.
const plotMarker = computed<'dot' | 'skull'>(() => (props.source === 'deaths' ? 'skull' : 'dot'))

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
const teamOptions = computed(() => [
  { value: 'all', label: t('heatmap.all') },
  { value: 'CT', label: teamNames.value.CT },
  { value: 'T', label: teamNames.value.T },
])
const playerOptions = computed(() => [
  { value: 'all', label: t('heatmap.all') },
  ...props.replay.players
    .filter((p) => teamFilter.value === 'all' || p.startSide === teamFilter.value)
    .map((p) => ({ value: p.steamId, label: p.name })),
])
// Color the round-time range by the selected side: CT blue, T the default
// accent, both a neutral light gray.
const rangeColor = computed(() => {
  if (sideFilter.value === 'CT') return SIDE_COLOR.CT
  if (sideFilter.value === 'T') return 'var(--color-surge-500)'
  return '#cbd5e1'
})
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- Sub-navigation: Presence / Kills / Deaths / Grenades. Scrolls sideways
         on narrow viewports instead of overflowing. -->
    <div class="flex shrink-0 items-center justify-start gap-0.5 overflow-x-auto border-b border-ink-800 px-3 py-2 scrollbar-none sm:justify-center">
      <button
        v-for="(meta, key) in SOURCE_META"
        :key="key"
        type="button"
        class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
        :class="source === key ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
        @click="emit('update:source', key as Source)"
      >
        {{ t(meta.labelKey) }}
      </button>
    </div>

    <!-- Grenade detonation heatmap: brings its own filters and plots. -->
    <UtilityHeatmapView v-if="source === 'grenades'" :replay="replay" class="min-h-0 flex-1" />

    <div v-else class="flex min-h-0 flex-1 flex-col sm:flex-row">
    <!-- Filters panel: full width on top on mobile, fixed side column from sm up. -->
    <aside class="flex max-h-[40vh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-ink-800 bg-ink-900/40 p-4 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
      <!-- Filters: a compact grid on mobile (Side full width, Team/Player side by
           side) to save vertical space; a stacked column from sm up, where
           sm:contents dissolves this wrapper back into the aside's flex column. -->
      <div class="grid grid-cols-2 gap-2 sm:contents">
      <!-- Side -->
      <div class="col-span-2" :class="{ 'pointer-events-none opacity-40': !hasIdentity }">
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

      <!-- Team -->
      <div :class="{ 'pointer-events-none opacity-40': !hasIdentity }">
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.team') }}</label>
        <UiSelect v-model="teamFilter" :options="teamOptions" class="w-full" />
      </div>

      <!-- Player -->
      <div :class="{ 'pointer-events-none opacity-40': !hasIdentity }">
        <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.player') }}</label>
        <UiSelect v-model="playerFilter" :options="playerOptions" class="w-full" />
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
          :mode="plotMode"
          :marker="plotMarker"
          :marker-scale="0.6"
          @jump="(p) => emit('jump', p)"
        />
      </div>

      <!-- Round-time window: floats over the heatmap, like the 2D replay controls.
           Hovering the bar reveals the round bubbles above it (same as the player). -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-ink-950/80 to-transparent p-4">
        <div class="group pointer-events-auto w-full max-w-xl rounded-lg border border-ink-700 bg-ink-900/80 px-3 py-2 backdrop-blur">
          <!-- Round bubbles: revealed on hover over the timeline. -->
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
          <RoundTimeRange v-model="timeRange" :max="maxRoundTime" :color="rangeColor" />
        </div>
      </div>
    </div>
    </div>
  </div>
</template>
