<script setup lang="ts">
import type { Replay } from '@/viewer/domain/schema'
import DuelMatrixView from '@/viewer/analysis/DuelMatrixView.vue'
import OpeningDuelsView from '@/viewer/analysis/OpeningDuelsView.vue'
import OpeningDuelMapView from '@/viewer/analysis/OpeningDuelMapView.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * Duels tab: groups the player-vs-player analysis under one tab, split by a
 * sub-navigation into "Matrix" (the duel matrix), "Opening" (first-duel stats)
 * and "Opening map" (first-duel positions on the radar).
 */
type Sub = 'matrix' | 'opening' | 'opening-map'

const props = defineProps<{
  replay: Replay
  /** Active duels page, driven by the URL. */
  sub: Sub
}>()

const emit = defineEmits<{
  /** Switch duels page (the parent maps it to a URL). */
  (e: 'update:sub', value: Sub): void
  /** Forwarded from the opening map: seek the replay to an opening duel. */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const SUBS: Sub[] = ['matrix', 'opening', 'opening-map']
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- Sub-navigation: Matrix / Opening / Opening map. Scrolls sideways on
         narrow viewports instead of overflowing. -->
    <div class="flex shrink-0 items-center justify-start gap-0.5 overflow-x-auto border-b border-ink-800 px-3 py-2 scrollbar-none sm:justify-center">
      <button
        v-for="s in SUBS"
        :key="s"
        type="button"
        class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
        :class="sub === s ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
        @click="emit('update:sub', s)"
      >
        {{ t(`duels.tabs.${s}`) }}
      </button>
    </div>

    <!-- Active sub-view -->
    <div class="min-h-0 flex-1">
      <DuelMatrixView v-if="sub === 'matrix'" :replay="props.replay" />
      <OpeningDuelsView v-else-if="sub === 'opening'" :replay="props.replay" @jump="(p) => emit('jump', p)" />
      <OpeningDuelMapView v-else :replay="props.replay" @jump="(p) => emit('jump', p)" />
    </div>
  </div>
</template>
