<script setup lang="ts">
import { computed } from 'vue'
import type { Replay } from '@/viewer/domain/schema'
import { groupTeams } from '@/viewer/analysis/utilityStats'
import { computeDuelMatrix } from '@/viewer/analysis/duelStats'
import { useI18n } from '@/i18n'

/**
 * Duel matrix: every player of one team (rows) against every player of the other
 * (columns). Each cell is split by a diagonal into two circles, the row player's
 * kills on the column player (bottom-left) and the column player's kills on the
 * row player (top-right); the duel winner is green, the loser red, a tie olive.
 * Inspired by CS Demo Manager's duels matrix.
 */
const props = defineProps<{ replay: Replay }>()

const { t } = useI18n()

const TEAM_COLOR = ['#e0b341', '#6b78e0'] as const
/** Circle colors: won the duel / lost it / tied. */
const DUEL_COLOR = { win: '#3f7d33', loss: '#b03434', tie: '#736a37' } as const

const teams = computed(() => {
  const ts = groupTeams(props.replay)
  ts[0].name ||= t('economy.team1')
  ts[1].name ||= t('economy.team2')
  return ts
})
const matrix = computed(() => computeDuelMatrix(props.replay))

/** Rows = first team, columns = second team (enemies only). */
const rowPlayers = computed(() => teams.value[0].players)
const colPlayers = computed(() => teams.value[1].players)

function kills(killer: string, victim: string): number {
  return matrix.value.get(killer)?.get(victim) ?? 0
}
</script>

<template>
  <!-- No own vertical scroll: stacked inside the Stats page, which scrolls. Keeps
       horizontal scroll for wide matrices (many players). -->
  <div class="w-full overflow-x-auto">
    <div class="mx-auto w-fit px-6 py-8">
      <table class="border-separate border-spacing-1">
        <thead>
          <tr>
            <!-- Corner spacer -->
            <th class="w-32" />
            <!-- Column players (second team) -->
            <th v-for="c in colPlayers" :key="c.steamId" class="w-28 pb-2 align-bottom">
              <div class="flex flex-col items-center gap-1">
                <span class="max-w-[6.5rem] truncate text-sm font-medium text-ink-100" :title="c.name">{{ c.name }}</span>
                <span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: TEAM_COLOR[1] }" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rowPlayers" :key="r.steamId">
            <!-- Row player (first team) -->
            <th class="pr-3 text-right align-middle">
              <span class="inline-flex items-center gap-2">
                <span class="max-w-[6.5rem] truncate text-sm font-medium text-ink-100" :title="r.name">{{ r.name }}</span>
                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: TEAM_COLOR[0] }" />
              </span>
            </th>
            <td v-for="c in colPlayers" :key="c.steamId" class="p-0">
              <!-- Cell: diagonal split, row-kills (bottom-left) vs col-kills (top-right) -->
              <div
                class="relative h-[4.5rem] w-28 rounded border border-ink-800 bg-ink-900/40"
                style="
                  background-image: linear-gradient(
                    to bottom right,
                    transparent calc(50% - 0.5px),
                    rgba(255, 255, 255, 0.08) 50%,
                    transparent calc(50% + 0.5px)
                  );
                "
              >
                <!-- Top-right: column player's kills on the row player. Pulled in
                     toward the center diagonal so the two circles of a duel read
                     as a connected pair rather than sitting in far corners. -->
                <span
                  v-tooltip="t('duels.matrix.cell', { killer: c.name, victim: r.name, count: kills(c.steamId, r.steamId) })"
                  class="absolute right-8 top-2 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-white tabular-nums"
                  :style="{
                    backgroundColor:
                      kills(c.steamId, r.steamId) > kills(r.steamId, c.steamId)
                        ? DUEL_COLOR.win
                        : kills(c.steamId, r.steamId) < kills(r.steamId, c.steamId)
                          ? DUEL_COLOR.loss
                          : DUEL_COLOR.tie,
                  }"
                >
                  {{ kills(c.steamId, r.steamId) }}
                </span>
                <!-- Bottom-left: row player's kills on the column player (pulled in
                     toward the center diagonal, mirroring the top-right circle). -->
                <span
                  v-tooltip="t('duels.matrix.cell', { killer: r.name, victim: c.name, count: kills(r.steamId, c.steamId) })"
                  class="absolute bottom-2 left-8 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-white tabular-nums"
                  :style="{
                    backgroundColor:
                      kills(r.steamId, c.steamId) > kills(c.steamId, r.steamId)
                        ? DUEL_COLOR.win
                        : kills(r.steamId, c.steamId) < kills(c.steamId, r.steamId)
                          ? DUEL_COLOR.loss
                          : DUEL_COLOR.tie,
                  }"
                >
                  {{ kills(r.steamId, c.steamId) }}
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
