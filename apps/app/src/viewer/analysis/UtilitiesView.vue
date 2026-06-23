<script setup lang="ts">
import { ref } from 'vue'
import type { PlayerMeta, Replay } from '@/viewer/domain/schema'
import UtilityThrowsView from '@/viewer/analysis/UtilityThrowsView.vue'
import UtilityFlashesView from '@/viewer/analysis/UtilityFlashesView.vue'
import UtilityDamageView from '@/viewer/analysis/UtilityDamageView.vue'
import UtilityHeatmapView from '@/viewer/analysis/UtilityHeatmapView.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * Utilities tab: groups everything about grenades under one tab, split by a
 * sub-navigation into "Throws" (where utility was used: the list + radar arcs),
 * "Flashes" (flashbang metrics + a flasher x victim blind matrix), "Damage"
 * (HE / molotov damage per player) and "Heatmap" (grenade detonation density).
 */
const props = defineProps<{
  replay: Replay
  playersById: Map<string, PlayerMeta>
}>()

const emit = defineEmits<{
  /** Forwarded from the throws view: seek the replay to a throw. */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

type Sub = 'throws' | 'flashes' | 'damage' | 'heatmap'
const sub = ref<Sub>('throws')
const SUBS: Sub[] = ['throws', 'flashes', 'damage', 'heatmap']
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- Sub-navigation: Throws / Flashes / Damage -->
    <div class="flex shrink-0 items-center justify-center gap-0.5 border-b border-ink-800 px-3 py-2">
      <button
        v-for="s in SUBS"
        :key="s"
        type="button"
        class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors"
        :class="sub === s ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
        @click="sub = s"
      >
        {{ t(`utilities.tabs.${s}`) }}
      </button>
    </div>

    <!-- Active sub-view -->
    <div class="min-h-0 flex-1">
      <UtilityThrowsView
        v-if="sub === 'throws'"
        :replay="props.replay"
        :players-by-id="props.playersById"
        @jump="(p) => emit('jump', p)"
      />
      <UtilityFlashesView
        v-else-if="sub === 'flashes'"
        :replay="props.replay"
        @jump="(p) => emit('jump', p)"
      />
      <UtilityDamageView v-else-if="sub === 'damage'" :replay="props.replay" />
      <UtilityHeatmapView v-else :replay="props.replay" />
    </div>
  </div>
</template>
