<script setup lang="ts">
import type { Replay } from '@/viewer/domain/schema'
import type { CellDetail } from '@/viewer/analysis/utility/utilityStats'
import type { Team } from '@/viewer/domain/teams'
import UtilityGridCell from '@/viewer/analysis/utility/UtilityGridCell.vue'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * Two-team stat grid, mirroring CS Demo Manager's grenade panels: each team's
 * players are columns, each metric is a row, and the metric label sits in the
 * center between the two teams. Generic over the metrics, so the flashes and
 * damage views reuse it with their own rows. A row may expose `details` to make
 * its cells clickable (a popover of the underlying plays).
 */
defineProps<{
  /** Exactly two teams (started CT, started T). */
  teams: Team[]
  /** One row per metric; `value` formats the cell, optional `details` drills in,
   *  optional `best` flags the match-best player (gets a star). */
  rows: {
    key: string
    label: string
    value: (steamId: string) => string | number
    details?: (steamId: string) => CellDetail[]
    best?: (steamId: string) => boolean
  }[]
  /** In-memory replay, so detail lines carrying `clip` info can open a mini-clip
   *  popover (passed straight to the cells). */
  replay?: Replay
}>()

const emit = defineEmits<{
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

/** Stable team identity colors (not side), matching the economy view. */
const TEAM_COLOR = ['#e0b341', '#6b78e0'] as const
</script>

<template>
  <table class="w-full table-fixed border-separate border-spacing-1 text-center text-sm">
    <thead>
      <!-- Team names, spanning their players -->
      <tr>
        <th
          v-if="teams[0].players.length"
          :colspan="teams[0].players.length"
          class="px-2 pb-1 text-left text-sm font-semibold"
          :style="{ color: TEAM_COLOR[0] }"
        >
          {{ teams[0].name }}
        </th>
        <th class="w-56" />
        <th
          v-if="teams[1].players.length"
          :colspan="teams[1].players.length"
          class="px-2 pb-1 text-right text-sm font-semibold"
          :style="{ color: TEAM_COLOR[1] }"
        >
          {{ teams[1].name }}
        </th>
      </tr>
      <!-- Player names -->
      <tr class="text-[11px] text-ink-400">
        <th
          v-for="p in teams[0].players"
          :key="p.steamId"
          class="truncate px-1 pb-1 font-medium"
          :title="p.name"
        >
          {{ p.name }}
        </th>
        <th />
        <th
          v-for="p in teams[1].players"
          :key="p.steamId"
          class="truncate px-1 pb-1 font-medium"
          :title="p.name"
        >
          {{ p.name }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.key">
        <td v-for="p in teams[0].players" :key="p.steamId" class="rounded bg-ink-900/50 px-1 py-2">
          <span class="inline-flex items-center gap-0.5">
            <UtilityGridCell
              :value="row.value(p.steamId)"
              :details="row.details?.(p.steamId)"
              :replay="replay"
              @jump="(payload) => emit('jump', payload)"
            />
            <span
              v-if="row.best?.(p.steamId)"
              class="text-[9px] leading-none text-amber-300/70"
              :title="t('utilities.bestOfMatch')"
            >★</span>
          </span>
        </td>
        <td class="px-2 py-2 text-[13px] text-ink-300">{{ row.label }}</td>
        <td v-for="p in teams[1].players" :key="p.steamId" class="rounded bg-ink-900/50 px-1 py-2">
          <span class="inline-flex items-center gap-0.5">
            <UtilityGridCell
              :value="row.value(p.steamId)"
              :details="row.details?.(p.steamId)"
              :replay="replay"
              @jump="(payload) => emit('jump', payload)"
            />
            <span
              v-if="row.best?.(p.steamId)"
              class="text-[9px] leading-none text-amber-300/70"
              :title="t('utilities.bestOfMatch')"
            >★</span>
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</template>
