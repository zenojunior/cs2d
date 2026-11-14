<script setup lang="ts">
import type { Replay } from '@/viewer/domain/schema'
import DuelStatsView from '@/viewer/analysis/duels/DuelStatsView.vue'
import OpeningDuelMapView from '@/viewer/analysis/duels/OpeningDuelMapView.vue'
import HeatmapView from '@/viewer/analysis/heatmap/HeatmapView.vue'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * Duels tab: groups the player-vs-player analysis under one tab, split by a
 * sub-navigation into the kills/deaths point maps (reused from HeatmapView, point
 * overlays rather than density), "Stats" (the duel matrix + opening-duel stats
 * stacked) and "Opening duel" (first-duel positions on the radar).
 */
type Sub = 'kills' | 'deaths' | 'stats' | 'opening-map'

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

const SUBS: Sub[] = ['kills', 'deaths', 'opening-map', 'stats']
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
      <DuelStatsView v-if="sub === 'stats'" :replay="props.replay" @jump="(p) => emit('jump', p)" />
      <OpeningDuelMapView v-else-if="sub === 'opening-map'" :replay="props.replay" @jump="(p) => emit('jump', p)" />
      <!-- Kills/deaths point maps, reused from the heatmap tab (embedded: no own nav). -->
      <HeatmapView
        v-else
        :replay="props.replay"
        :source="(sub as 'kills' | 'deaths')"
        embedded
        @jump="(p) => emit('jump', p)"
      />
    </div>
  </div>
</template>
