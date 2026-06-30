<script setup lang="ts">
import type { TeamRoundEconomy } from '@/viewer/analysis/roundEconomy'
import { BUY_COLOR } from '@/viewer/analysis/roundEconomy'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

/**
 * One round's equipment-value row: the two teams' values as mirrored bars (left
 * grows right-to-left, right grows left-to-right), the round number on each side
 * and the outcome icon in the winner's column. Shared by the economy overview's
 * per-round list and the buy sheet header (so the clicked row is echoed there).
 */
type OutcomeIcon = { mask: string } | { glyph: string } | null
defineProps<{
  row: {
    roundNumber: number
    left: TeamRoundEconomy
    right: TeamRoundEconomy
    icon: OutcomeIcon
    labelKey: string | null
  }
  /** Richest team-round equipment value, so bars share one scale. */
  maxEquip: number
}>()

const { t } = useI18n()

function fmtMoney(v: number): string {
  return `$${v.toLocaleString('pt-BR')}`
}
function barWidth(v: number, max: number): string {
  return `${Math.max(4, (v / max) * 100)}%`
}

/** Inline CSS mask style: paints the single-color weapon svg in `color`. */
function maskStyle(src: string, color: string) {
  return {
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    backgroundColor: color,
  }
}
</script>

<template>
  <div class="flex items-center gap-2 text-xs">
    <!-- Left team bar (grows right-to-left) -->
    <div class="flex flex-1 justify-end">
      <div
        class="flex min-w-[4.5rem] items-center justify-end whitespace-nowrap rounded px-2 py-1 font-mono tabular-nums text-white"
        :style="{ width: barWidth(row.left.equipValue, maxEquip), backgroundColor: BUY_COLOR[row.left.buyType] }"
      >
        {{ fmtMoney(row.left.equipValue) }}
      </div>
    </div>

    <!-- Center: round number | left outcome | right outcome | round number.
         The outcome icon shows in the winning side's column, colored by side. -->
    <div class="flex w-32 shrink-0 items-center">
      <span class="w-6 text-right font-mono tabular-nums text-ink-400">{{ row.roundNumber }}</span>
      <span class="flex w-10 justify-center">
        <template v-if="row.left.won && row.icon">
          <span
            v-if="'mask' in row.icon"
            v-tooltip="row.labelKey ? t(row.labelKey) : undefined"
            class="inline-block h-4 w-4"
            :style="maskStyle(row.icon.mask, SIDE_COLOR[row.left.side])"
          />
          <UiIcon
            v-else
            v-tooltip="row.labelKey ? t(row.labelKey) : undefined"
            :name="row.icon.glyph"
            class="h-3.5 w-3.5"
            :style="{ color: SIDE_COLOR[row.left.side] }"
          />
        </template>
      </span>
      <span class="flex w-10 justify-center">
        <template v-if="row.right.won && row.icon">
          <span
            v-if="'mask' in row.icon"
            v-tooltip="row.labelKey ? t(row.labelKey) : undefined"
            class="inline-block h-4 w-4"
            :style="maskStyle(row.icon.mask, SIDE_COLOR[row.right.side])"
          />
          <UiIcon
            v-else
            v-tooltip="row.labelKey ? t(row.labelKey) : undefined"
            :name="row.icon.glyph"
            class="h-3.5 w-3.5"
            :style="{ color: SIDE_COLOR[row.right.side] }"
          />
        </template>
      </span>
      <span class="w-6 text-left font-mono tabular-nums text-ink-400">{{ row.roundNumber }}</span>
    </div>

    <!-- Right team bar (grows left-to-right) -->
    <div class="flex flex-1 justify-start">
      <div
        class="flex min-w-[4.5rem] items-center justify-start whitespace-nowrap rounded px-2 py-1 font-mono tabular-nums text-white"
        :style="{ width: barWidth(row.right.equipValue, maxEquip), backgroundColor: BUY_COLOR[row.right.buyType] }"
      >
        {{ fmtMoney(row.right.equipValue) }}
      </div>
    </div>
  </div>
</template>
