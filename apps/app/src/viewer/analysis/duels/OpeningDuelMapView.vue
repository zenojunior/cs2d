<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Replay, Round, Side } from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { killWeaponIcon } from '@/viewer/domain/weaponIcons'
import HeatmapPlot from '@/viewer/analysis/shared/HeatmapPlot.vue'
import KillfeedRow from '@/viewer/player/KillfeedRow.vue'
import type { KillInfo } from '@/viewer/analysis/shared/heatmapTypes'
import { computeOpeningDuels } from '@/viewer/analysis/duels/duelStats'
import { groupTeams } from '@/viewer/domain/teams'
import { useI18n } from '@/app/i18n'

/**
 * Map of the opening duels: the shooter -> victim path of every round's first
 * kill, colored by the side that won the opening. A side list (who killed whom,
 * at what round time) drives it: hovering a row highlights its path, clicking it
 * opens the kill popover (a looping mini-clip of the moment, with a "watch in
 * match" button that seeks the 2D replay). Mirrors the Utilities throws page.
 */
const props = defineProps<{ replay: Replay }>()

const emit = defineEmits<{
  /** Seek the 2D replay to an opening duel (forwarded up to the stage). */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const { t } = useI18n()

/** Filter by the team that won the opening ('all' / '0' = started-CT team /
 *  '1' = started-T team). Team identity is stable across the side swap, unlike a
 *  raw CT/T filter. */
const teamFilter = ref<string>('all')
/** Filter by the side that won the opening ('all' / 'CT' / 'T'). */
const sideFilter = ref<Side | 'all'>('all')
/** The engagement whose path is emphasized on the map (hovered list row). */
const highlight = ref<{ roundIndex: number; t: number } | null>(null)
/** The engagement whose kill popover (mini-clip) is open, from a clicked row. A
 *  fresh object each click so re-clicking the same row reopens it. */
const openKill = ref<{ roundIndex: number; t: number } | null>(null)

// Stable teams (0 = started CT, 1 = started T) for the filter.
const teams = computed(() => {
  const ts = groupTeams(props.replay)
  ts[0].name ||= t('economy.team1')
  ts[1].name ||= t('economy.team2')
  return ts
})
/** steamId -> stable team id (0/1) as a string, to match the button value. */
const teamOf = computed(() => {
  const m = new Map<string, string>()
  for (const tm of teams.value) for (const p of tm.players) m.set(p.steamId, String(tm.id))
  return m
})

const calibration = computed(() => MAP_CALIBRATION[props.replay.map] ?? MAP_CALIBRATION.de_dust2)
const levels = computed(() => calibration.value.levels ?? null)

const nameById = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.replay.players) m.set(p.steamId, p.name)
  return m
})

/** Attacker's spot at the kill tick, read from the round's frames (the kill event
 *  only carries the victim's position). */
function playerPosAt(round: Round, steamId: string, tick: number) {
  let best: { x: number; y: number } | null = null
  let bestDiff = Infinity
  for (const f of round.frames) {
    const diff = Math.abs(f.tick - tick)
    if (diff >= bestDiff) continue
    const p = f.players.find((pl) => pl.steamId === steamId)
    if (!p) continue
    bestDiff = diff
    best = { x: p.x, y: p.y }
  }
  return best
}

interface DuelPoint {
  x: number
  y: number
  z: number
  side: Side | null
  kill: KillInfo
}

const points = computed<DuelPoint[]>(() => {
  const out: DuelPoint[] = []
  for (const d of computeOpeningDuels(props.replay)) {
    if (teamFilter.value !== 'all' && teamOf.value.get(d.winnerSteamId) !== teamFilter.value) continue
    if (sideFilter.value !== 'all' && d.winnerSide !== sideFilter.value) continue
    const round = props.replay.rounds[d.roundIndex]
    const aPos = playerPosAt(round, d.winnerSteamId, d.tick)
    out.push({
      x: d.vx,
      y: d.vy,
      z: d.vz,
      // Color the marker/path by the side that won the opening.
      side: d.winnerSide,
      kill: {
        roundIndex: d.roundIndex,
        t: d.t,
        roundNumber: d.roundNumber,
        attackerSteamId: d.winnerSteamId,
        victimSteamId: d.loserSteamId,
        attackerName: nameById.value.get(d.winnerSteamId) ?? '?',
        attackerColor: d.winnerSide ? SIDE_COLOR[d.winnerSide] : '#cbd5e1',
        victimName: nameById.value.get(d.loserSteamId) ?? '?',
        victimColor: d.loserSide ? SIDE_COLOR[d.loserSide] : '#cbd5e1',
        weapon: d.weapon,
        weaponIcon: killWeaponIcon(d.weapon),
        headshot: d.headshot,
        assistedFlash: false,
        ax: aPos?.x ?? null,
        ay: aPos?.y ?? null,
        vx: d.vx,
        vy: d.vy,
      },
    })
  }
  return out
})

interface Plot {
  key: string
  label?: string
  radar: string
  points: DuelPoint[]
}
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

/** Live round time of a kill (seconds since the round went live, freeze removed). */
function freezeSeconds(round: Round): number {
  return (round.startTick - round.freezeStartTick) / props.replay.demoTickRate
}
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** One side-list row per opening duel (in round order), as a killfeed kill. */
const rows = computed(() =>
  points.value.map((p) => {
    const round = props.replay.rounds[p.kill.roundIndex]
    return {
      key: `${p.kill.roundIndex}-${p.kill.t}`,
      roundIndex: p.kill.roundIndex,
      roundNumber: p.kill.roundNumber,
      t: p.kill.t,
      time: fmtTime(Math.max(0, p.kill.t - freezeSeconds(round))),
      kill: p.kill,
    }
  }),
)
</script>

<template>
  <div class="flex h-full w-full flex-col sm:flex-row">
    <!-- Team filter + opening-duel list: full width on top on mobile (capped
         height, the list scrolls), fixed side column from sm up. -->
    <aside class="flex max-h-[45vh] w-full shrink-0 flex-col border-b border-ink-800 bg-ink-900/40 sm:max-h-none sm:w-96 sm:border-b-0 sm:border-r">
      <div class="flex flex-col gap-4 border-b border-ink-800 p-4">
        <!-- Side that won the opening (Both / CT / T), matching the kills/deaths
             point maps and the heatmap. -->
        <div>
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

        <!-- Team that won the opening (stable across the side swap). -->
        <div>
          <label class="mb-1.5 block text-xs font-medium text-ink-300">{{ t('heatmap.team') }}</label>
          <div class="flex overflow-hidden rounded-md border border-ink-700">
            <button
              type="button"
              class="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-xs transition-colors"
              :class="teamFilter === 'all' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
              @click="teamFilter = 'all'"
            >
              {{ t('heatmap.all') }}
            </button>
            <button
              v-for="tm in teams"
              :key="tm.id"
              type="button"
              class="min-w-0 flex-1 cursor-pointer truncate border-l border-ink-700 px-2 py-1.5 text-xs transition-colors"
              :class="teamFilter === String(tm.id) ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
              :title="tm.name"
              @click="teamFilter = String(tm.id)"
            >
              {{ tm.name }}
            </button>
          </div>
        </div>
      </div>

      <ul class="min-h-0 flex-1 overflow-y-auto p-1" @mouseleave="highlight = null">
        <li v-if="!rows.length" class="px-3 py-6 text-center text-xs text-ink-500">
          {{ t('grenades.empty') }}
        </li>
        <li v-for="row in rows" :key="row.key">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded px-2 py-1.5 text-left transition-colors hover:bg-ink-800"
            @click="openKill = { roundIndex: row.roundIndex, t: row.t }"
            @mouseenter="highlight = { roundIndex: row.roundIndex, t: row.t }"
          >
            <span class="w-7 shrink-0 font-mono text-[11px] text-ink-500">R{{ row.roundNumber }}</span>
            <KillfeedRow
              class="min-w-0 flex-1"
              truncate-names
              :attacker-name="row.kill.attackerName"
              :attacker-color="row.kill.attackerColor"
              :weapon="row.kill.weapon"
              :headshot="row.kill.headshot"
              :victim-name="row.kill.victimName"
              :victim-color="row.kill.victimColor"
            />
            <span class="shrink-0 font-mono text-[11px] text-ink-500">{{ row.time }}</span>
          </button>
        </li>
      </ul>
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
          :replay="replay"
          :label="plot.label"
          subject="attacker"
          mode="dots"
          marker="skull"
          paths
          :marker-scale="0.6"
          :highlight="highlight"
          :open-kill="openKill"
          @jump="(p) => emit('jump', p)"
        />
      </div>
    </div>
  </div>
</template>
