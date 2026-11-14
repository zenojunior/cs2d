<script setup lang="ts">
import type { Replay } from '@/viewer/domain/schema'
import PlayerPerformanceView from '@/viewer/analysis/duels/PlayerPerformanceView.vue'
import DuelMatrixView from '@/viewer/analysis/duels/DuelMatrixView.vue'
import OpeningDuelsView from '@/viewer/analysis/duels/OpeningDuelsView.vue'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * Duels "Stats" page: stacks the per-player performance grid (top), the duel
 * matrix and the opening-duel stats (bottom) in a single scroll, so the
 * player-vs-player breakdowns live together.
 */
defineProps<{ replay: Replay }>()

const emit = defineEmits<{
  /** Forwarded from the opening-duel stats: seek the replay to an opening duel. */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()
</script>

<template>
  <div class="h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
    <section>
      <div class="mx-auto max-w-5xl px-6 pt-6">
        <h2 class="font-display text-sm text-ink-300">{{ t('duels.performance.title') }}</h2>
      </div>
      <PlayerPerformanceView :replay="replay" />
    </section>
    <section class="border-t border-ink-800">
      <div class="mx-auto max-w-5xl px-6 pt-6">
        <h2 class="font-display text-sm text-ink-300">{{ t('duels.tabs.matrix') }}</h2>
      </div>
      <DuelMatrixView :replay="replay" />
    </section>
    <section class="border-t border-ink-800">
      <div class="mx-auto max-w-5xl px-6 pt-6">
        <h2 class="font-display text-sm text-ink-300">{{ t('duels.tabs.opening') }}</h2>
      </div>
      <OpeningDuelsView :replay="replay" @jump="(p) => emit('jump', p)" />
    </section>
  </div>
</template>
