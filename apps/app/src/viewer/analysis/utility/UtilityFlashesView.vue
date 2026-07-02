<script setup lang="ts">
import { computed } from 'vue'
import type { Replay } from '@/viewer/domain/schema'
import { computeFlashStats, type CellDetail, type FlashPlay } from '@/viewer/analysis/utility/utilityStats'
import { groupTeams } from '@/viewer/domain/teams'
import UtilityTeamGrid from '@/viewer/analysis/utility/UtilityTeamGrid.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

/**
 * Flashes sub-tab: per-player flash metrics grouped by team (thrown, enemies
 * blinded, blind duration, and per-throw / per-round rates), a flasher x victim
 * blind-duration matrix (allies included), and a flash-impact table whose cells
 * drill into the individual plays. Inspired by CS Demo Manager's flashbang panel.
 */
const props = defineProps<{ replay: Replay }>()

const emit = defineEmits<{
  /** Seek the 2D replay to a flash play (forwarded up to the stage). */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const { t } = useI18n()

/** Player display names by steamId, for play descriptions. */
const nameOf = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.replay.players) m.set(p.steamId, p.name)
  return (id: string) => m.get(id) ?? id
})

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Clip padding: a touch before the blind, to a touch after the kill it enabled.
const CLIP_LEAD = 1
const CLIP_TAIL = 2

/** Builds the popover lines for a flasher's impact plays (optionally one type). */
function playsToDetails(steamId: string, only?: FlashPlay['type']): CellDetail[] {
  const plays = stats.value.playsByPlayer.get(steamId) ?? []
  return plays
    .filter((p) => !only || p.type === only)
    .map((p, i) => ({
      key: `${p.roundIndex}-${i}`,
      text:
        p.type === 'self'
          ? t('utilities.flash.playSelf', { victim: nameOf.value(p.victimSteamId) })
          : t('utilities.flash.playAssist', {
              victim: nameOf.value(p.victimSteamId),
              killer: nameOf.value(p.killerSteamId),
            }),
      sub: `R${p.roundNumber} · ${fmtTime(p.killT)} · ${p.weapon.toUpperCase()}`,
      jump: { roundIndex: p.roundIndex, t: p.blindT },
      // Frame the flasher, the blinded victim and the killer (deduped) over the
      // flash and the kill it set up.
      clip: {
        round: p.roundIndex,
        jumpT: p.blindT,
        from: p.blindT - CLIP_LEAD,
        to: p.killT + CLIP_TAIL,
        focusSteamIds: [...new Set([steamId, p.victimSteamId, p.killerSteamId])],
      },
    }))
}

const teams = computed(() => {
  const ts = groupTeams(props.replay)
  ts[0].name ||= t('economy.team1')
  ts[1].name ||= t('economy.team2')
  return ts
})
const stats = computed(() => computeFlashStats(props.replay))

/** No attributable blind data: the demo carries no usable player_blind events,
 *  so every flash metric would be zero. Common in GOTV/HLTV demos (e.g. Majors),
 *  where these events are simply not recorded. We show a notice instead. */
const noFlashData = computed(() => stats.value.matrix.size === 0)

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits)
}

/** Every shown player's steamId (both teams), for "best of the match" stars. */
const allPlayerIds = computed(() => teams.value.flatMap((tm) => tm.players.map((p) => p.steamId)))

/** SteamIds achieving the max of `num` across shown players (empty if max <= 0). */
function bestSet(num: (id: string) => number): Set<string> {
  const ids = allPlayerIds.value
  let max = 0
  for (const id of ids) max = Math.max(max, num(id))
  const set = new Set<string>()
  if (max > 0) for (const id of ids) if (num(id) === max) set.add(id)
  return set
}

const rows = computed(() => {
  const by = stats.value.byPlayer
  const rounds = Math.max(1, stats.value.roundCount)
  const get = (id: string) => by.get(id)
  // Numeric value per metric (used both for display and to pick the match best).
  const num = {
    thrown: (id: string) => get(id)?.thrown ?? 0,
    blinded: (id: string) => get(id)?.enemiesBlinded ?? 0,
    duration: (id: string) => get(id)?.enemyBlindDuration ?? 0,
    perThrow: (id: string) => {
      const s = get(id)
      return s && s.thrown ? s.enemiesBlinded / s.thrown : 0
    },
    perRound: (id: string) => (get(id)?.enemiesBlinded ?? 0) / rounds,
  }
  const best = {
    thrown: bestSet(num.thrown),
    blinded: bestSet(num.blinded),
    duration: bestSet(num.duration),
    perThrow: bestSet(num.perThrow),
    perRound: bestSet(num.perRound),
  }
  return [
    { key: 'thrown', label: t('utilities.flash.thrown'), value: num.thrown, best: (id: string) => best.thrown.has(id) },
    {
      key: 'blinded',
      label: t('utilities.flash.enemiesBlinded'),
      value: num.blinded,
      best: (id: string) => best.blinded.has(id),
    },
    {
      key: 'duration',
      label: t('utilities.flash.duration'),
      value: (id: string) => fmt(num.duration(id), 1),
      best: (id: string) => best.duration.has(id),
    },
    {
      key: 'perThrow',
      label: t('utilities.flash.perThrow'),
      value: (id: string) => {
        const s = get(id)
        return s && s.thrown ? fmt(s.enemiesBlinded / s.thrown) : '-'
      },
      best: (id: string) => best.perThrow.has(id),
    },
    {
      key: 'perRound',
      label: t('utilities.flash.perRound'),
      value: (id: string) => fmt(num.perRound(id)),
      best: (id: string) => best.perRound.has(id),
    },
  ]
})

/** Did the flash achieve anything: enemies blinded who were then killed while
 *  blind, split into the flasher's own frags vs teammate frags, plus the share
 *  of blinded enemies that it converted into a kill. */
const impactRows = computed(() => {
  const by = stats.value.byPlayer
  const get = (id: string) => by.get(id)
  return [
    {
      key: 'killsFromBlinds',
      label: t('utilities.flash.killsFromBlinds'),
      value: (id: string) => get(id)?.killsFromBlinds ?? 0,
      details: (id: string) => playsToDetails(id),
    },
    {
      key: 'selfFlashKills',
      label: t('utilities.flash.selfFlashKills'),
      value: (id: string) => get(id)?.selfFlashKills ?? 0,
      details: (id: string) => playsToDetails(id, 'self'),
    },
    {
      key: 'flashAssists',
      label: t('utilities.flash.flashAssists'),
      value: (id: string) => get(id)?.flashAssists ?? 0,
      details: (id: string) => playsToDetails(id, 'assist'),
    },
    {
      key: 'leverage',
      label: t('utilities.flash.leverageRate'),
      value: (id: string) => {
        const s = get(id)
        return s && s.enemiesBlinded ? `${Math.round((s.killsFromBlinds / s.enemiesBlinded) * 100)}%` : '-'
      },
    },
  ]
})

// --- Matrix (flasher row x victim column, blind seconds) ---

const TEAM_COLOR = ['#e0b341', '#6b78e0'] as const

/** All players in team order, tagged with their team color + id, for the axes. */
const axis = computed(() =>
  teams.value.flatMap((team) =>
    team.players.map((p) => ({ ...p, color: TEAM_COLOR[team.id], teamId: team.id })),
  ),
)

function cellValue(flasher: string, victim: string): number {
  return stats.value.matrix.get(flasher)?.get(victim) ?? 0
}

const maxCell = computed(() => {
  let m = 0
  for (const row of stats.value.matrix.values()) for (const v of row.values()) m = Math.max(m, v)
  return m || 1
})

/** Cell fill scaled by its share of the max (transparent at 0). Team flashes
 *  (flasher and victim on the same side) are red; enemy flashes are blue. */
function cellStyle(v: number, teamFlash: boolean) {
  if (v <= 0) return { backgroundColor: 'transparent' }
  const a = 0.12 + 0.88 * (v / maxCell.value)
  const rgb = teamFlash ? '239, 68, 68' : '59, 130, 246'
  return { backgroundColor: `rgba(${rgb}, ${a.toFixed(3)})` }
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
    <div class="mx-auto max-w-5xl px-6 py-6">
      <div
        v-if="noFlashData"
        class="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 rounded-lg border border-ink-800 bg-ink-900/40 px-6 py-8 text-center"
      >
        <UiIcon name="info" class="h-6 w-6 text-surge-400" />
        <p class="font-display text-sm text-ink-100">{{ t('utilities.flash.emptyTitle') }}</p>
        <p class="text-xs text-ink-400">{{ t('utilities.flash.empty') }}</p>
      </div>

      <template v-else>
        <!-- Per-player metrics by team -->
        <UtilityTeamGrid :teams="teams" :rows="rows" />

        <!-- Flash impact: did the flashes lead to kills? -->
        <section class="mt-10">
          <h3 class="mb-1 font-display text-sm text-ink-50">{{ t('utilities.flash.impactTitle') }}</h3>
          <p class="mb-3 text-xs text-ink-500">{{ t('utilities.flash.impactHint') }}</p>
          <UtilityTeamGrid
            :teams="teams"
            :rows="impactRows"
            :replay="replay"
            @jump="(p) => emit('jump', p)"
          />
        </section>

        <!-- Blind-duration matrix -->
        <section class="mt-10">
          <h3 class="mb-1 font-display text-sm text-ink-50">{{ t('utilities.flash.matrixTitle') }}</h3>
          <p class="mb-3 text-xs text-ink-500">{{ t('utilities.flash.matrixHint') }}</p>

          <table class="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
            <tbody>
              <tr v-for="f in axis" :key="f.steamId">
                <!-- Row label: flasher name + team dot -->
                <th class="w-28 truncate pr-2 text-right font-medium text-ink-300" :title="f.name">
                  <span class="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" :style="{ backgroundColor: f.color }" />
                  {{ f.name }}
                </th>
                <td
                  v-for="v in axis"
                  :key="v.steamId"
                  v-tooltip="
                    cellValue(f.steamId, v.steamId) > 0
                      ? t('utilities.flash.matrixCell', { flasher: f.name, victim: v.name })
                      : undefined
                  "
                  class="rounded px-1 py-1.5 font-mono tabular-nums"
                  :class="cellValue(f.steamId, v.steamId) > 0 ? 'text-white' : 'text-ink-700'"
                  :style="cellStyle(cellValue(f.steamId, v.steamId), f.teamId === v.teamId)"
                >
                  {{ fmt(cellValue(f.steamId, v.steamId)) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <!-- Column labels at the bottom (victims), matching CSDM -->
              <tr class="text-[11px] text-ink-400">
                <td />
                <td v-for="v in axis" :key="v.steamId" class="truncate px-1 pt-1" :title="v.name">
                  <span class="mr-0.5 inline-block h-1.5 w-1.5 rounded-full align-middle" :style="{ backgroundColor: v.color }" />
                  {{ v.name }}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      </template>
    </div>
  </div>
</template>
