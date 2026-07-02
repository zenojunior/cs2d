<script setup lang="ts">
import { computed } from 'vue'
import type { Replay, Side } from '@/viewer/domain/schema'
import type { TeamRoundEconomy } from '@/viewer/analysis/economy/roundEconomy'
import { buildRoundBuys } from '@/viewer/analysis/economy/buyBreakdown'
import { SIDE_COLOR, TEAM_COLOR } from '@/viewer/domain/colors'
import RoundEquipBar from '@/viewer/analysis/economy/RoundEquipBar.vue'
import UiBottomSheet from '@/ui/UiBottomSheet.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

/**
 * A round's full buy breakdown in a bottom sheet (`UiBottomSheet`): a grid of
 * player cards, each a receipt of the loadout at the end of the buy (every item
 * priced, bought-this-round highlighted, weapon passes flagged), ending in the
 * loadout value, spent and left. Opened from the equipment-value bars in the
 * economy overview; the clicked bar is echoed in the header (`bar`).
 */
const props = defineProps<{
  replay: Replay
  roundIndex: number | null
  /** The clicked equipment-value row, shown in the header. */
  bar: { roundNumber: number; left: TeamRoundEconomy; right: TeamRoundEconomy; icon: { mask: string } | { glyph: string } | null; labelKey: string | null } | null
  /** Equipment-value scale shared with the overview's bars. */
  barMax: number
}>()
const emit = defineEmits<{ close: []; jump: [{ roundIndex: number; t: number }] }>()

const { t } = useI18n()

const buys = computed(() => (props.roundIndex === null ? null : buildRoundBuys(props.replay, props.roundIndex)))

/**
 * The two teams laid out to match the clicked bar: the team on `bar.left`'s side
 * goes left, the other right, each carrying the overview's identity color
 * (`bar.left` is the overview's team 0 → `TEAM_COLOR[0]`, `bar.right` → team 1).
 * Aligning by side (not by `groupTeams` order) keeps the sheet consistent with
 * the bar even when the two orderings disagree.
 */
const orderedTeams = computed(() => {
  const b = buys.value
  if (!b) return []
  const sides: Side[] = props.bar ? [props.bar.left.side, props.bar.right.side] : [b.teams[0].side, b.teams[1].side]
  return sides.map((side, i) => ({
    team: b.teams.find((tm) => tm.side === side) ?? b.teams[i],
    color: TEAM_COLOR[i],
  }))
})

function onOpenChange(open: boolean) {
  if (!open) emit('close')
}

/** Seek the replay to the start of this round and switch to the viewer tab. */
function watchRound() {
  if (props.roundIndex !== null) emit('jump', { roundIndex: props.roundIndex, t: 0 })
}

function fmtMoney(v: number): string {
  return `$${v.toLocaleString('pt-BR')}`
}
function sideColor(side: Side): string {
  return SIDE_COLOR[side]
}
</script>

<template>
  <UiBottomSheet :open="roundIndex !== null" :title="t('economy.buys.title')" @update:open="onOpenChange">
    <header class="flex shrink-0 flex-col gap-2.5 border-b border-ink-800 px-4 py-3 sm:px-6">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-ink-50">
          {{ t('economy.buys.title') }} <span class="text-ink-500">·</span> {{ t('economy.roundAxis') }} {{ buys?.roundNumber }}
        </h2>
        <button
          type="button"
          class="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2.5 py-1 text-xs font-medium text-ink-200 transition-colors hover:bg-ink-800"
          @click="watchRound"
        >
          <UiIcon name="play" class="h-3.5 w-3.5 text-surge-400" />
          <span class="hidden sm:inline">{{ t('economy.buys.watchRound') }}</span>
        </button>
        <button
          type="button"
          :aria-label="t('extension.close')"
          class="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          @click="emit('close')"
        >
          <UiIcon name="x" class="h-4 w-4" />
        </button>
      </div>
      <!-- Echo of the clicked equipment-value row, so the context is explicit. -->
      <RoundEquipBar v-if="bar" :row="bar" :max-equip="barMax" />
    </header>

    <!-- No purchase data (replay parsed before purchase tracking). -->
    <div v-if="buys && !buys.hasData" class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <UiIcon name="info" class="h-6 w-6 text-ink-500" />
      <p class="max-w-sm text-sm text-ink-400">{{ t('economy.buys.noData') }}</p>
    </div>

    <!-- One team per half: 50% left / 50% right (stacked on narrow viewports). -->
    <div v-else-if="buys" class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-ink-800 overflow-y-auto [scrollbar-gutter:stable] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      <section v-for="({ team, color }, ti) in orderedTeams" :key="ti" class="p-4 sm:p-5">
        <header class="mb-2 flex items-center gap-2">
          <!-- Team-identity color (matches the overview charts), then the side this round. -->
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: color }" />
          <span class="min-w-0 truncate text-sm font-semibold text-ink-100">{{ team.name }}</span>
          <span class="shrink-0 font-mono text-[10px] font-semibold" :style="{ color: sideColor(team.side) }">{{ team.side }}</span>
          <span class="ml-auto font-mono text-xs tabular-nums text-ink-300">
            {{ fmtMoney(team.totalEquip) }}
            <span class="text-ink-600">·</span>
            <span class="text-loss">−{{ fmtMoney(team.totalSpent) }}</span>
          </span>
        </header>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <article
            v-for="p in team.players"
            :key="p.steamId"
            class="flex flex-col overflow-hidden rounded-lg border border-ink-800 bg-ink-900/60 shadow-card"
          >
            <header
              class="flex items-center gap-1.5 border-b border-ink-800 px-2.5 py-1.5"
              :style="{ borderColor: 'color-mix(in srgb, ' + color + ' 30%, var(--color-ink-800))' }"
            >
              <!-- Per-player CS2 color, falling back to the team identity. -->
              <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: p.color ?? color }" />
              <span class="min-w-0 flex-1 truncate text-xs font-semibold text-ink-100">{{ p.name }}</span>
            </header>

            <div class="flex min-h-0 flex-1 flex-col px-2.5 py-2">
              <p v-if="!p.items.length" class="py-2 text-center text-[11px] text-ink-500">
                {{ t('economy.buys.eco') }}
              </p>

              <ul v-else class="space-y-1">
                <li
                  v-for="(item, i) in p.items"
                  :key="i"
                  class="flex items-center gap-1.5 text-[11px]"
                  :class="item.bought ? '' : 'text-ink-500'"
                >
                  <img
                    v-if="item.icon"
                    :src="item.icon"
                    :alt="item.label"
                    class="h-3.5 w-7 shrink-0 object-contain"
                    :class="{ 'opacity-50': !item.bought }"
                  />
                  <span v-else class="w-7 shrink-0 text-center text-ink-600">·</span>
                  <span class="min-w-0 flex-1 truncate" :class="item.bought ? 'text-ink-200' : ''">
                    {{ item.label }}<span v-if="item.count > 1" class="text-ink-500"> ×{{ item.count }}</span>
                  </span>
                  <span
                    v-if="item.passedToName"
                    v-tooltip="t('economy.buys.passedTip', { name: item.passedToName })"
                    class="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-amber-400"
                  ><UiIcon name="arrow-right" class="h-2.5 w-2.5" />{{ item.passedToName }}</span>
                  <span
                    v-else-if="item.receivedFromName"
                    v-tooltip="t('economy.buys.receivedTip', { name: item.receivedFromName })"
                    class="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-pulse-400"
                  ><UiIcon name="arrow-left" class="h-2.5 w-2.5" />{{ item.receivedFromName }}</span>
                  <span
                    v-else-if="item.dropped"
                    v-tooltip="t('economy.buys.droppedTip')"
                    class="shrink-0 font-mono text-[10px] text-ink-500"
                  >↓</span>
                  <span
                    class="shrink-0 font-mono tabular-nums"
                    :class="item.passedToName || item.dropped ? 'text-ink-600 line-through' : item.bought ? 'text-ink-400' : 'text-ink-600'"
                  >{{ fmtMoney(item.total) }}</span>
                </li>
              </ul>

              <div class="mt-auto space-y-0.5 border-t border-ink-700/70 pt-1.5 text-[11px]">
                <div v-if="p.carried >= 50" class="flex items-center justify-between text-ink-500">
                  <span>{{ t('economy.buys.carried') }}</span>
                  <span class="font-mono tabular-nums">{{ fmtMoney(p.carried) }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-ink-300">{{ t('economy.buys.equip') }}</span>
                  <span class="font-mono font-semibold tabular-nums text-ink-50">{{ fmtMoney(p.equipValue) }}</span>
                </div>
                <div class="flex items-center justify-between text-ink-500">
                  <span>{{ t('economy.buys.spent') }} · {{ t('economy.buys.remaining') }}</span>
                  <span class="font-mono tabular-nums">
                    <span class="text-loss">−{{ fmtMoney(p.spent) }}</span>
                    <span class="text-ink-700"> · </span>
                    <span class="text-win">{{ fmtMoney(p.remaining) }}</span>
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </UiBottomSheet>
</template>
