<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Replay, Side } from '@/viewer/domain/schema'
import { buildMatchEconomy, buyStats, BUY_COLOR, type BuyType } from '@/viewer/analysis/economy/roundEconomy'
import { roundOutcome } from '@/viewer/domain/roundOutcome'
import { TEAM_COLOR } from '@/viewer/domain/colors'
import RoundEquipBar from '@/viewer/analysis/economy/RoundEquipBar.vue'
import RoundBuysSheet from '@/viewer/analysis/economy/RoundBuysSheet.vue'
import { useI18n } from '@/app/i18n'

/**
 * Economy tab, mirroring CS Demo Manager's Economy tab: round outcomes by buy
 * type (win/loss bars per team, filterable by side), the team start money per
 * round (the chart CSDM labels "Equipment value") and a per-round breakdown of
 * each team's equipment value. Clicking an equipment-value bar opens a bottom
 * sheet with that round's full buy breakdown. Built from `buildMatchEconomy`.
 */
const props = defineProps<{ replay: Replay }>()
const emit = defineEmits<{ jump: [{ roundIndex: number; t: number }] }>()

const { t } = useI18n()

const economy = computed(() => buildMatchEconomy(props.replay.rounds, props.replay.demoTickRate))

/** Total / won / lost bar colors (match CSDM's blue-700 / green-700 / red-700). */
const BAR_TOTAL = '#1d4ed8'
const BAR_WON = '#15803d'
const BAR_LOST = '#b91c1c'

function buyLabel(b: BuyType): string {
  return t(`economy.buyType.${b === 'force-buy' ? 'forceBuy' : b}`)
}

function teamName(id: 0 | 1): string {
  return economy.value.teams[id].name || (id === 0 ? t('economy.team1') : t('economy.team2'))
}

// --- Section 1: round outcomes by buy type -----------------------------------

/** Side filter for the win-rate cards (all = both sides). */
const sideFilter = ref<Side | 'all'>('all')

const teamStats = computed(() =>
  economy.value.teams.map((team) => ({
    id: team.id,
    name: teamName(team.id),
    stats: buyStats(team, sideFilter.value === 'all' ? undefined : sideFilter.value),
  })),
)

/** Bar height as a percentage of the card's total (the tallest bar). */
function barHeight(value: number, total: number): string {
  if (total === 0) return '8px'
  return `${Math.max(4, (value / total) * 100)}%`
}

// --- Section 2: start money per round (line chart) ---------------------------

const CHART_W = 1000
const CHART_H = 280
const PAD = 8

/** Per-team start money, indexed by counted round (both teams share order). */
const series = computed(() => economy.value.teams.map((team) => team.rounds.map((r) => r.startMoney)))

/** Y axis max, rounded up to the next 10k (at least 10k). */
const maxMoney = computed(() => {
  let m = 0
  for (const s of series.value) for (const v of s) m = Math.max(m, v)
  return Math.max(10000, Math.ceil(m / 10000) * 10000)
})

const roundCount = computed(() => economy.value.roundCount)

function xAt(i: number): number {
  const n = Math.max(1, roundCount.value - 1)
  return PAD + (i / n) * (CHART_W - 2 * PAD)
}
function yAt(v: number): number {
  return CHART_H - PAD - (v / maxMoney.value) * (CHART_H - 2 * PAD)
}

function linePoints(values: number[]): string {
  return values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')
}

/** Coordinates as percentages of the chart box, for the HTML overlay (points,
 *  crosshair, tooltip) drawn over the non-uniformly scaled svg. */
function xPct(i: number): number {
  return (xAt(i) / CHART_W) * 100
}
function yPct(v: number): number {
  return (yAt(v) / CHART_H) * 100
}

/** Horizontal grid lines (every 10k), positioned in % for the HTML overlay. */
const gridLines = computed(() => {
  const lines: { yPct: number; label: string }[] = []
  for (let v = 0; v <= maxMoney.value; v += 10000) lines.push({ yPct: yPct(v), label: `${v / 1000}k` })
  return lines
})

// Vertical crosshair: the round under the cursor. Its tooltip compares both
// teams' start money for that round.
const hoverIndex = ref<number | null>(null)

function onChartMove(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const frac = (e.clientX - rect.left) / rect.width
  const i = Math.round(frac * Math.max(0, roundCount.value - 1))
  hoverIndex.value = Math.min(Math.max(i, 0), Math.max(0, roundCount.value - 1))
}
function onChartLeave() {
  hoverIndex.value = null
}

const hover = computed(() => {
  const i = hoverIndex.value
  if (i === null || !roundCount.value) return null
  const teams = economy.value.teams
  return {
    index: i,
    roundNumber: teams[0].rounds[i]?.roundNumber ?? i + 1,
    /** Cursor on the left half: place the tooltip to the right (and vice versa). */
    leftHalf: xPct(i) < 50,
    rows: teams.map((tm) => ({
      id: tm.id,
      name: teamName(tm.id),
      value: tm.rounds[i]?.startMoney ?? 0,
    })),
  }
})

// --- Section 3: per-round breakdown ------------------------------------------

function roundReason(roundIndex: number): string | null {
  return props.replay.rounds[roundIndex]?.reason ?? null
}

/**
 * Outcome icon for a round-end reason. Bomb / defuse / elimination reuse the
 * weapon SVGs (recolored to the winning side via CSS mask); time uses the simple
 * clock glyph from UiIcon.
 */
type OutcomeIcon = { mask: string } | { glyph: string } | null
function outcomeIcon(reason: string | null): OutcomeIcon {
  switch (reason) {
    case '1':
      return { mask: '/weapons/c4.svg' } // bomb exploded (T)
    case '7':
      return { mask: '/weapons/defuse.svg' } // bomb defused (CT)
    case '8':
    case '9':
      return { mask: '/weapons/headshot.svg' } // elimination
    case '12':
      return { glyph: 'clock' } // time expired (CT)
    default:
      return null
  }
}

/** Rounds zipped across both teams, in chronological order. */
const breakdown = computed(() => {
  const [a, b] = economy.value.teams
  return a.rounds.map((ra, i) => {
    const rb = b.rounds[i]
    const reason = roundReason(ra.roundIndex)
    return {
      roundIndex: ra.roundIndex,
      roundNumber: ra.roundNumber,
      left: ra,
      right: rb,
      icon: outcomeIcon(reason),
      labelKey: roundOutcome(reason)?.labelKey ?? null,
    }
  })
})

function fmtMoney(v: number): string {
  return `$${v.toLocaleString('pt-BR')}`
}

/** Richest team-round equipment value, so every bar shares one scale. */
const maxBreakdownEquip = computed(() => Math.max(1, ...series.value.flat(), ...breakdown.value.flatMap((r) => [r.left.equipValue, r.right.equipValue])))

/** Round whose buy breakdown the bottom sheet shows (replay round index), or null. */
const sheetRound = ref<number | null>(null)
/** The clicked equipment-value row, echoed in the sheet header. */
const sheetRow = computed(() => (sheetRound.value === null ? null : breakdown.value.find((r) => r.roundIndex === sheetRound.value) ?? null))
</script>

<template>
  <div class="h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
    <div class="mx-auto max-w-6xl space-y-10 px-6 py-6">
      <!-- Section 1: round outcomes by buy type -->
      <section>
        <header class="mb-4 flex items-center gap-3">
          <h2 class="font-display text-sm text-ink-50">{{ t('economy.outcomesTitle') }}</h2>
          <div class="flex overflow-hidden rounded border border-ink-700 text-xs">
            <button
              v-for="s in (['all', 'CT', 'T'] as const)"
              :key="s"
              type="button"
              class="cursor-pointer px-2.5 py-0.5 transition-colors"
              :class="sideFilter === s ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
              @click="sideFilter = s"
            >
              {{ s === 'all' ? t('economy.bothSides') : s }}
            </button>
          </div>
          <div class="ml-auto flex items-center gap-3 text-[11px] text-ink-400">
            <span class="flex items-center gap-1"><span class="h-2.5 w-4 rounded-sm" :style="{ backgroundColor: BAR_TOTAL }" />{{ t('economy.total') }}</span>
            <span class="flex items-center gap-1"><span class="h-2.5 w-4 rounded-sm" :style="{ backgroundColor: BAR_WON }" />{{ t('economy.won') }}</span>
            <span class="flex items-center gap-1"><span class="h-2.5 w-4 rounded-sm" :style="{ backgroundColor: BAR_LOST }" />{{ t('economy.lost') }}</span>
          </div>
        </header>

        <div class="grid gap-6 lg:grid-cols-2">
          <div v-for="team in teamStats" :key="team.id">
            <p class="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-100">
              <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: TEAM_COLOR[team.id] }" />
              {{ team.name }}
            </p>
            <div class="grid grid-cols-5 gap-2">
              <div
                v-for="row in team.stats"
                :key="row.buyType"
                class="flex flex-col rounded-lg border border-ink-800 bg-ink-900/40 p-2"
              >
                <span class="text-center font-display text-base font-bold tabular-nums text-ink-50">
                  {{ row.winRate === null ? '–' : `${Math.round(row.winRate * 100)}%` }}
                </span>
                <div class="mt-2 flex h-24 items-end justify-center gap-1">
                  <div
                    v-for="bar in [
                      { v: row.total, c: BAR_TOTAL },
                      { v: row.won, c: BAR_WON },
                      { v: row.lost, c: BAR_LOST },
                    ]"
                    :key="bar.c"
                    class="flex w-1/3 items-start justify-center rounded-sm pt-0.5"
                    :style="{ height: barHeight(bar.v, row.total), backgroundColor: row.total === 0 ? 'transparent' : bar.c, border: row.total === 0 ? '1px solid var(--color-ink-700)' : undefined }"
                  >
                    <span class="font-mono text-[10px] leading-none text-white">{{ row.total === 0 ? '' : bar.v }}</span>
                  </div>
                </div>
                <span class="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-ink-300">
                  <span class="h-2 w-2 rounded-sm" :style="{ backgroundColor: BUY_COLOR[row.buyType] }" />
                  {{ buyLabel(row.buyType) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 2: start money per round -->
      <section>
        <header class="mb-3 flex items-center gap-4">
          <div>
            <h2 class="font-display text-sm text-ink-50">{{ t('economy.startMoneyTitle') }}</h2>
            <p class="text-xs text-ink-500">{{ t('economy.startMoneyHint') }}</p>
          </div>
          <div class="flex items-center gap-4 text-xs text-ink-300">
            <span v-for="team in economy.teams" :key="team.id" class="flex items-center gap-1.5">
              <span class="h-2.5 w-4 rounded-sm" :style="{ backgroundColor: TEAM_COLOR[team.id] }" />
              {{ teamName(team.id) }}
            </span>
          </div>
        </header>

        <div class="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
          <div class="relative h-64 w-full" @mousemove="onChartMove" @mouseleave="onChartLeave">
            <!-- Grid lines + Y labels: HTML overlay, so the non-uniform svg scale
                 doesn't distort the text. -->
            <div
              v-for="g in gridLines"
              :key="g.label"
              class="pointer-events-none absolute inset-x-0 border-t border-ink-800/70"
              :style="{ top: `${g.yPct}%` }"
            />
            <span
              v-for="g in gridLines"
              :key="`lbl-${g.label}`"
              class="pointer-events-none absolute left-0 -translate-y-1/2 bg-ink-900/40 pr-1 font-mono text-[10px] text-ink-600"
              :style="{ top: `${g.yPct}%` }"
            >{{ g.label }}</span>

            <svg
              :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
              preserveAspectRatio="none"
              class="pointer-events-none absolute inset-0 h-full w-full"
            >
              <polyline
                v-for="(s, i) in series"
                :key="i"
                :points="linePoints(s)"
                fill="none"
                :stroke="TEAM_COLOR[i as 0 | 1]"
                stroke-width="2"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <div
              v-if="hover"
              class="pointer-events-none absolute inset-y-0 w-px bg-ink-500"
              :style="{ left: `${xPct(hover.index)}%` }"
            />

            <template v-for="(s, ti) in series" :key="`pts-${ti}`">
              <span
                v-for="(v, i) in s"
                :key="`p-${ti}-${i}`"
                class="pointer-events-none absolute rounded-full border border-ink-950"
                :class="hoverIndex === i ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5'"
                :style="{
                  left: `${xPct(i)}%`,
                  top: `${yPct(v)}%`,
                  backgroundColor: TEAM_COLOR[ti as 0 | 1],
                  transform: 'translate(-50%, -50%)',
                }"
              />
            </template>

            <div
              v-if="hover"
              class="pointer-events-none absolute top-1 z-10 min-w-32 rounded-md border border-ink-700 bg-ink-900/95 p-2 text-xs shadow-lg backdrop-blur"
              :style="hover.leftHalf
                ? { left: `${xPct(hover.index)}%`, marginLeft: '8px' }
                : { left: `${xPct(hover.index)}%`, transform: 'translateX(calc(-100% - 8px))' }"
            >
              <p class="mb-1 font-semibold text-ink-200">{{ t('economy.roundAxis') }} {{ hover.roundNumber }}</p>
              <div v-for="row in hover.rows" :key="row.id" class="flex items-center gap-2">
                <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: TEAM_COLOR[row.id] }" />
                <span class="min-w-0 flex-1 truncate text-ink-300">{{ row.name }}</span>
                <span class="font-mono tabular-nums text-ink-50">{{ fmtMoney(row.value) }}</span>
              </div>
            </div>
          </div>
          <p class="mt-1 text-center text-[11px] text-ink-600">{{ t('economy.roundAxis') }}</p>
        </div>
      </section>

      <!-- Section 3: per-round equipment value -->
      <section>
        <div class="mb-3">
          <h2 class="font-display text-sm text-ink-50">{{ t('economy.equipValueTitle') }}</h2>
          <p class="text-xs text-ink-500">{{ t('economy.equipValueHint') }}</p>
        </div>

        <div class="mb-1 flex items-center gap-2 text-[11px] text-ink-500">
          <div class="flex-1" />
          <div class="flex w-32 shrink-0 justify-between px-1">
            <span>{{ t('economy.roundAxis') }}</span>
            <span>{{ t('economy.roundAxis') }}</span>
          </div>
          <div class="flex-1" />
        </div>

        <div class="space-y-1">
          <!-- Each row opens that round's buy breakdown in the bottom sheet. -->
          <button
            v-for="row in breakdown"
            :key="row.roundNumber"
            type="button"
            class="block w-full cursor-pointer rounded-md px-1 py-0.5 transition-colors hover:bg-ink-800/60"
            @click="sheetRound = row.roundIndex"
          >
            <RoundEquipBar :row="row" :max-equip="maxBreakdownEquip" />
          </button>
        </div>
      </section>
    </div>

    <RoundBuysSheet
      :replay="props.replay"
      :round-index="sheetRound"
      :bar="sheetRow"
      :bar-max="maxBreakdownEquip"
      @close="sheetRound = null"
      @jump="emit('jump', $event)"
    />
  </div>
</template>
