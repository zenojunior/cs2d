<script setup lang="ts">
import { computed, ref } from 'vue'
import { PopoverClose, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import type { Replay, Side } from '@/viewer/domain/schema'
import { groupTeams } from '@/viewer/domain/teams'
import { computeOpeningDuels, type OpeningDuel } from '@/viewer/analysis/duels/duelStats'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import KillfeedRow from '@/viewer/player/KillfeedRow.vue'
import UiSwitch from '@/ui/UiSwitch.vue'
import { useI18n } from '@/app/i18n'

/** Killfeed gray for a side that could not be resolved (matches ViewerKillfeed). */
const NO_SIDE_COLOR = '#8a93a6'

/**
 * Opening-duel statistics: for each team, how many first-kills-of-the-round each
 * player won (blue) or lost (red), the team's overall win/loss share, and how
 * often the opening outcome carried the round. The faction filter narrows the
 * population and traded openings can be excluded. Clicking a bar opens a popover
 * listing those opening duels; picking one seeks the 2D replay to it. Inspired
 * by CS Demo Manager.
 */
const props = defineProps<{ replay: Replay }>()

const emit = defineEmits<{
  /** Seek the 2D replay to an opening duel (forwarded up to the stage). */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const { t } = useI18n()

const WON_COLOR = '#2563eb'
const LOST_COLOR = '#dc2626'

// Faction narrows the population (the side the player was on in the duel).
const factionFilter = ref<Side | 'all'>('all')
// Drop traded openings: a first kill where the entry winner was traded back did
// not leave a real advantage, so it can be excluded from the breakdown.
const ignoreTraded = ref(false)

/** A side passes the faction filter ('all' = no filter, so null sides count). */
function factionOk(side: Side | null): boolean {
  return factionFilter.value === 'all' || side === factionFilter.value
}

/** steamId -> display name, for the duel-list popover. */
const nameOf = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.replay.players) m.set(p.steamId, p.name)
  return (id: string) => m.get(id) ?? '?'
})

const teams = computed(() => {
  const ts = groupTeams(props.replay)
  ts[0].name ||= t('economy.team1')
  ts[1].name ||= t('economy.team2')
  return ts
})
const duels = computed(() => computeOpeningDuels(props.replay))

interface PlayerStat {
  steamId: string
  name: string
  won: number
  lost: number
  total: number
  /** Won openings that the player's side then won the round. */
  converted: number
  /** Lost openings where the player's side then also lost the round. */
  lostConverted: number
  /** The player's won / lost openings (round order), for the list popover. */
  wonDuels: OpeningDuel[]
  lostDuels: OpeningDuel[]
}

/** Per-player aggregation honoring the faction filter (won/lost toggles don't
 *  affect the counts, only the rendered segments). */
const statsByPlayer = computed(() => {
  const m = new Map<string, Omit<PlayerStat, 'name' | 'total'>>()
  const get = (id: string) => {
    let s = m.get(id)
    if (!s) m.set(id, (s = { steamId: id, won: 0, lost: 0, converted: 0, lostConverted: 0, wonDuels: [], lostDuels: [] }))
    return s
  }
  for (const d of duels.value) {
    if (ignoreTraded.value && d.traded) continue
    if (factionOk(d.winnerSide)) {
      const s = get(d.winnerSteamId)
      s.won++
      if (d.roundWinner && d.roundWinner === d.winnerSide) s.converted++
      s.wonDuels.push(d)
    }
    if (factionOk(d.loserSide)) {
      const s = get(d.loserSteamId)
      s.lost++
      if (d.roundWinner && d.roundWinner !== d.loserSide) s.lostConverted++
      s.lostDuels.push(d)
    }
  }
  return m
})

interface TeamCard {
  id: 0 | 1
  name: string
  players: PlayerStat[]
  won: number
  lost: number
  total: number
  converted: number
  lostConverted: number
}

const cards = computed<TeamCard[]>(() =>
  teams.value.map((team) => {
    const players: PlayerStat[] = team.players
      .map((p) => {
        const s = statsByPlayer.value.get(p.steamId)
        const won = s?.won ?? 0
        const lost = s?.lost ?? 0
        return {
          steamId: p.steamId,
          name: p.name,
          won,
          lost,
          total: won + lost,
          converted: s?.converted ?? 0,
          lostConverted: s?.lostConverted ?? 0,
          wonDuels: s?.wonDuels ?? [],
          lostDuels: s?.lostDuels ?? [],
        }
      })
      // Entry fraggers first: by total opening duels, then by win rate.
      .sort((a, b) => b.total - a.total || winRate(b) - winRate(a))
    const won = players.reduce((a, p) => a + p.won, 0)
    const lost = players.reduce((a, p) => a + p.lost, 0)
    const converted = players.reduce((a, p) => a + p.converted, 0)
    const lostConverted = players.reduce((a, p) => a + p.lostConverted, 0)
    return { id: team.id, name: team.name, players, won, lost, total: won + lost, converted, lostConverted }
  }),
)

/** One popover row per opening duel of a player, as a killfeed kill (winner is
 *  the killer, loser the victim, colored by side). */
interface DuelRow {
  key: string
  round: number
  attackerName: string
  attackerColor: string
  victimName: string
  victimColor: string
  weapon: string
  headshot: boolean
  jump: { roundIndex: number; t: number }
}
function duelRows(list: OpeningDuel[]): DuelRow[] {
  return list.map((d, i) => ({
    key: `${d.roundIndex}-${i}`,
    round: d.roundNumber,
    attackerName: nameOf.value(d.winnerSteamId),
    attackerColor: d.winnerSide ? SIDE_COLOR[d.winnerSide] : NO_SIDE_COLOR,
    victimName: nameOf.value(d.loserSteamId),
    victimColor: d.loserSide ? SIDE_COLOR[d.loserSide] : NO_SIDE_COLOR,
    weapon: d.weapon,
    headshot: d.headshot,
    jump: { roundIndex: d.roundIndex, t: d.t },
  }))
}

/** Shared bar scale across both teams, so heights are comparable. */
const maxTotal = computed(() => {
  let m = 0
  for (const c of cards.value) for (const p of c.players) m = Math.max(m, p.total)
  return m || 1
})
const BAR_PX = 200
function segPx(count: number): number {
  return Math.round((count / maxTotal.value) * BAR_PX)
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}
function winRate(p: { won: number; total: number }): number {
  return p.total > 0 ? p.won / p.total : 0
}
</script>

<template>
  <!-- No own scroll: stacked inside the Stats page, which scrolls. -->
  <div class="w-full">
    <div class="mx-auto max-w-5xl px-6 py-6">
      <!-- Filters -->
      <div class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div class="flex items-center gap-3">
          <span class="text-xs font-medium text-ink-400">{{ t('duels.opening.faction') }}</span>
          <div class="flex overflow-hidden rounded-md border border-ink-700">
            <button
              v-for="f in (['all', 'CT', 'T'] as const)"
              :key="f"
              type="button"
              class="cursor-pointer px-3 py-1 text-xs transition-colors"
              :class="[
                factionFilter === f ? 'bg-ink-700 text-ink-50' : 'text-ink-400 hover:bg-ink-800',
                f !== 'all' ? 'border-l border-ink-700' : '',
              ]"
              @click="factionFilter = f"
            >
              {{ f === 'all' ? t('heatmap.both') : f }}
            </button>
          </div>
        </div>
        <UiSwitch
          v-model="ignoreTraded"
          v-tooltip="t('duels.opening.ignoreTradedHint')"
          :label="t('duels.opening.ignoreTraded')"
        />
      </div>

      <!-- Team cards -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          v-for="card in cards"
          :key="card.id"
          class="rounded-lg border border-ink-800 bg-ink-900/40 p-4"
        >
          <!-- Header: name + total -->
          <div class="mb-1 flex items-baseline justify-between">
            <span class="truncate font-display text-sm text-ink-50" :title="card.name">{{ card.name }}</span>
            <span class="font-mono text-lg tabular-nums text-ink-100">{{ card.total }}</span>
          </div>
          <!-- Win/loss share (always from won+lost, so it stays meaningful) -->
          <div class="flex h-1 overflow-hidden rounded-full bg-ink-800">
            <div class="h-full" :style="{ width: `${pct(card.won, card.total)}%`, backgroundColor: WON_COLOR }" />
            <div class="h-full" :style="{ width: `${pct(card.lost, card.total)}%`, backgroundColor: LOST_COLOR }" />
          </div>
          <div class="mt-1 flex justify-between text-xs">
            <div>
              <span class="font-display text-base font-semibold" :style="{ color: WON_COLOR }">{{ pct(card.won, card.total) }}%</span>
              <span class="ml-1 text-ink-400">{{ t('duels.opening.duelsWon') }}</span>
            </div>
            <div class="text-right">
              <span class="font-display text-base font-semibold" :style="{ color: LOST_COLOR }">{{ pct(card.lost, card.total) }}%</span>
              <span class="ml-1 text-ink-400">{{ t('duels.opening.duelsLost') }}</span>
            </div>
          </div>
          <!-- Conversion: how often the opening outcome carried the round.
               Won openings → round won, and lost openings → round lost. -->
          <div class="mb-6 mt-2 grid grid-cols-2 gap-x-4 border-t border-ink-800 pt-2 text-xs">
            <div v-tooltip="t('duels.opening.conversionHint')" class="flex items-center gap-1.5">
              <span class="truncate text-ink-400">{{ t('duels.opening.conversion') }}</span>
              <span class="font-display text-sm font-semibold" :style="{ color: WON_COLOR }">{{ pct(card.converted, card.won) }}%</span>
              <span class="font-mono text-ink-500">({{ card.converted }}/{{ card.won }})</span>
            </div>
            <div v-tooltip="t('duels.opening.lostConversionHint')" class="flex items-center justify-end gap-1.5">
              <span class="truncate text-ink-400">{{ t('duels.opening.lostConversion') }}</span>
              <span class="font-display text-sm font-semibold" :style="{ color: LOST_COLOR }">{{ pct(card.lostConverted, card.lost) }}%</span>
              <span class="font-mono text-ink-500">({{ card.lostConverted }}/{{ card.lost }})</span>
            </div>
          </div>

          <!-- Per-player stacked bars (sorted, clickable to seek) -->
          <div class="flex items-end justify-around gap-2" :style="{ height: `${BAR_PX + 88}px` }">
            <div v-for="p in card.players" :key="p.steamId" class="flex min-w-0 flex-1 flex-col items-center">
              <div class="flex w-full flex-col justify-end" :style="{ height: `${BAR_PX}px` }">
                <!-- Lost (red) stacked on top: click to list those openings -->
                <PopoverRoot v-if="p.lost > 0">
                  <PopoverTrigger
                    class="flex w-full cursor-pointer items-center justify-center rounded-t text-xs font-semibold text-white tabular-nums outline-none transition hover:brightness-125 focus-visible:ring-1 focus-visible:ring-white/70"
                    :style="{ height: `${segPx(p.lost)}px`, minHeight: '18px', backgroundColor: LOST_COLOR }"
                  >
                    {{ p.lost }}
                  </PopoverTrigger>
                  <PopoverPortal>
                    <PopoverContent
                      :side-offset="6"
                      class="z-50 w-72 rounded-lg border border-ink-700 bg-ink-900/95 p-1.5 text-left shadow-xl shadow-black/50 backdrop-blur"
                    >
                      <p class="px-2 pb-1 text-[11px] font-medium text-ink-400">{{ t('duels.opening.watchLost') }}</p>
                      <ul class="max-h-60 space-y-0.5 overflow-y-auto">
                        <li v-for="row in duelRows(p.lostDuels)" :key="row.key">
                          <PopoverClose
                            class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-ink-800 focus-visible:bg-ink-800 focus-visible:outline-none"
                            @click="emit('jump', row.jump)"
                          >
                            <span class="w-7 shrink-0 font-mono text-[11px] text-ink-500">R{{ row.round }}</span>
                            <KillfeedRow
                              class="min-w-0 flex-1"
                              truncate-names
                              :attacker-name="row.attackerName"
                              :attacker-color="row.attackerColor"
                              :weapon="row.weapon"
                              :headshot="row.headshot"
                              :victim-name="row.victimName"
                              :victim-color="row.victimColor"
                            />
                          </PopoverClose>
                        </li>
                      </ul>
                    </PopoverContent>
                  </PopoverPortal>
                </PopoverRoot>
                <!-- Won (blue): click to list those openings -->
                <PopoverRoot v-if="p.won > 0">
                  <PopoverTrigger
                    class="flex w-full cursor-pointer items-center justify-center text-xs font-semibold text-white tabular-nums outline-none transition hover:brightness-125 focus-visible:ring-1 focus-visible:ring-white/70"
                    :class="p.lost > 0 ? '' : 'rounded-t'"
                    :style="{ height: `${segPx(p.won)}px`, minHeight: '18px', backgroundColor: WON_COLOR }"
                  >
                    {{ p.won }}
                  </PopoverTrigger>
                  <PopoverPortal>
                    <PopoverContent
                      :side-offset="6"
                      class="z-50 w-72 rounded-lg border border-ink-700 bg-ink-900/95 p-1.5 text-left shadow-xl shadow-black/50 backdrop-blur"
                    >
                      <p class="px-2 pb-1 text-[11px] font-medium text-ink-400">{{ t('duels.opening.watchWon') }}</p>
                      <ul class="max-h-60 space-y-0.5 overflow-y-auto">
                        <li v-for="row in duelRows(p.wonDuels)" :key="row.key">
                          <PopoverClose
                            class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-ink-800 focus-visible:bg-ink-800 focus-visible:outline-none"
                            @click="emit('jump', row.jump)"
                          >
                            <span class="w-7 shrink-0 font-mono text-[11px] text-ink-500">R{{ row.round }}</span>
                            <KillfeedRow
                              class="min-w-0 flex-1"
                              truncate-names
                              :attacker-name="row.attackerName"
                              :attacker-color="row.attackerColor"
                              :weapon="row.weapon"
                              :headshot="row.headshot"
                              :victim-name="row.victimName"
                              :victim-color="row.victimColor"
                            />
                          </PopoverClose>
                        </li>
                      </ul>
                    </PopoverContent>
                  </PopoverPortal>
                </PopoverRoot>
              </div>
              <!-- Total + win rate -->
              <div class="mt-1.5 flex h-6 w-9 items-center justify-center rounded border border-ink-700 text-xs tabular-nums text-ink-200">
                {{ p.total }}
              </div>
              <span class="mt-1 text-[0.65rem] tabular-nums text-ink-500">{{ p.total ? `${pct(p.won, p.total)}%` : '–' }}</span>
              <!-- Name -->
              <span class="mt-0.5 max-w-full truncate text-xs text-ink-400" :title="p.name">{{ p.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
