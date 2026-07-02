<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerMeta, PlayerState, Round, Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { roundOutcome } from '@/viewer/domain/roundOutcome'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * Match scoreboard (CS2 TAB style): big score and team name on the left, and per
 * player K / A / D / KDR / ADR / DMG accumulated up to the watched moment. Read
 * only, shown while the user holds TAB.
 */
const props = defineProps<{
  rounds: Round[]
  roundIndex: number
  currentT: number
  players: PlayerState[]
  playersById: Map<string, PlayerMeta>
  score: Record<Side, number>
  ctName: string
  tName: string
  map: string
  roundLabel: string
  totalRounds: number
}>()

interface Stat {
  k: number
  a: number
  d: number
  dmg: number
}

// Stats accumulated up to the watched point. K/A/D come from kill events (the
// current round counts up to currentT); damage comes from the per-round total.
const stats = computed(() => {
  const m = new Map<string, Stat>()
  const get = (id: string): Stat => {
    let s = m.get(id)
    if (!s) {
      s = { k: 0, a: 0, d: 0, dmg: 0 }
      m.set(id, s)
    }
    return s
  }
  for (let i = 0; i <= props.roundIndex && i < props.rounds.length; i++) {
    const rd = props.rounds[i]
    for (const ev of rd.events) {
      if (ev.type !== 'kill') continue
      if (i === props.roundIndex && ev.t > props.currentT) break
      if (ev.attackerSteamId) get(ev.attackerSteamId).k++
      if (ev.assisterSteamId) get(ev.assisterSteamId).a++
      get(ev.victimSteamId).d++
    }
    for (const [id, d] of Object.entries(rd.damage ?? {})) get(id).dmg += d
  }
  return m
})

// Rounds played so far (for ADR). At least 1 to avoid dividing by zero.
const roundsPlayed = computed(() => Math.max(1, props.roundIndex + 1))

interface Row extends Stat {
  steamId: string
  name: string
  alive: boolean
  kdr: number
  adr: number
}

function rows(side: Side): Row[] {
  return props.players
    .filter((p) => p.side === side)
    .map((p) => {
      const s = stats.value.get(p.steamId) ?? { k: 0, a: 0, d: 0, dmg: 0 }
      return {
        steamId: p.steamId,
        name: props.playersById.get(p.steamId)?.name ?? '?',
        alive: p.alive,
        ...s,
        kdr: s.d > 0 ? s.k / s.d : s.k,
        adr: Math.round(s.dmg / roundsPlayed.value),
      }
    })
    .sort((a, b) => b.dmg - a.dmg || b.k - a.k)
}

const teams = computed(() => [
  { side: 'CT' as Side, name: props.ctName, score: props.score.CT, rows: rows('CT') },
  { side: 'T' as Side, name: props.tName, score: props.score.T, rows: rows('T') },
])

const aliveCount = (side: Side) => props.players.filter((p) => p.side === side && p.alive).length

// Each round result (for the middle strip): winner color.
const roundMarks = computed(() =>
  props.rounds.map((r, i) => ({
    color: r.winner ? SIDE_COLOR[r.winner] : '#3a4150',
    current: i === props.roundIndex,
    outcome: roundOutcome(r.reason),
  })),
)
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-ink-950/75 p-6 backdrop-blur-sm"
  >
    <div
      class="w-full max-w-4xl overflow-hidden rounded-xl border border-ink-700 bg-ink-900/90 shadow-2xl shadow-black/60"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-ink-800 px-5 py-2.5 text-sm">
        <span class="text-ink-300">
          {{ map }} <span class="text-ink-500">· {{ t('scoreboard.round') }} {{ roundLabel }} {{ t('scoreboard.of') }} {{ totalRounds }}</span>
        </span>
      </div>

      <template v-for="(team, ti) in teams" :key="team.side">
        <!-- Round strip between the teams -->
        <div v-if="ti === 1" class="flex items-end gap-0.5 px-5 py-2">
          <span
            v-for="(m, i) in roundMarks"
            :key="i"
            v-tooltip="m.outcome ? t(m.outcome.labelKey) : undefined"
            class="flex h-5 flex-1 items-center justify-center rounded-sm"
            :class="m.current && 'ring-1 ring-ink-50'"
            :style="{ backgroundColor: m.color }"
          >
            <UiIcon
              v-if="m.outcome"
              :name="m.outcome.icon"
              class="h-3 w-3 text-ink-950/80"
            />
          </span>
        </div>

        <div class="flex items-stretch gap-4 px-5" :class="ti === 0 ? 'pt-2 pb-1' : 'pb-3 pt-1'">
          <!-- Left: big score + name + alive count -->
          <div class="flex w-32 shrink-0 flex-col justify-center">
            <span class="font-display text-5xl font-bold leading-none" :style="{ color: SIDE_COLOR[team.side] }">
              {{ team.score }}
            </span>
            <span class="mt-1 truncate text-sm font-semibold text-ink-100">
              {{ team.name || team.side }}
            </span>
            <span class="text-xs text-ink-500">{{ t('scoreboard.alive') }}: {{ aliveCount(team.side) }}/5</span>
          </div>

          <!-- Right: players table -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-end gap-1 px-2 pb-1 text-[0.7rem] font-semibold text-ink-500">
              <span class="mr-auto">{{ team.side }}</span>
              <span class="w-8 text-right">K</span>
              <span class="w-8 text-right">A</span>
              <span class="w-8 text-right">D</span>
              <span class="w-12 text-right">KDR</span>
              <span class="w-12 text-right">ADR</span>
              <span class="w-14 text-right">DMG</span>
            </div>
            <div
              v-for="p in team.rows"
              :key="p.steamId"
              class="flex items-center gap-1 rounded px-2 py-1 text-sm odd:bg-white/[0.02]"
              :class="p.alive ? 'text-ink-100' : 'text-ink-500'"
            >
              <span class="mr-auto flex min-w-0 items-center gap-2">
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: p.alive ? SIDE_COLOR[team.side] : '#3a4150' }"
                />
                <span class="truncate">{{ p.name }}</span>
              </span>
              <span class="w-8 text-right font-mono tabular-nums">{{ p.k }}</span>
              <span class="w-8 text-right font-mono tabular-nums text-ink-400">{{ p.a }}</span>
              <span class="w-8 text-right font-mono tabular-nums text-ink-400">{{ p.d }}</span>
              <span class="w-12 text-right font-mono tabular-nums">{{ p.kdr.toFixed(2) }}</span>
              <span class="w-12 text-right font-mono tabular-nums">{{ p.adr }}</span>
              <span class="w-14 text-right font-mono tabular-nums text-ink-300">{{ p.dmg }}</span>
            </div>
          </div>
        </div>
      </template>

      <p class="border-t border-ink-800 px-5 py-2 text-center text-[0.7rem] text-ink-500">
        {{ t('scoreboard.holdA') }}<span class="font-mono text-ink-300">TAB</span>{{ t('scoreboard.holdB') }}
      </p>
    </div>
  </div>
</template>
