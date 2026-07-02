<script setup lang="ts">
import type { PlayerMeta, Replay } from '@/viewer/domain/schema'
import UtilityThrowsView from '@/viewer/analysis/utility/UtilityThrowsView.vue'
import UtilityFlashesView from '@/viewer/analysis/utility/UtilityFlashesView.vue'
import UtilityDamageView from '@/viewer/analysis/utility/UtilityDamageView.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * Utilities tab: groups everything about grenades under one tab, split by a
 * sub-navigation into "Throws" (where utility was used: the list + radar arcs),
 * "Flashes" (flashbang metrics + a flasher x victim blind matrix) and "Damage"
 * (HE / molotov damage per player). The grenade detonation heatmap lives on the
 * Heatmaps tab instead, next to presence/kills/deaths.
 */
type Sub = 'throws' | 'flashes' | 'damage'

const props = defineProps<{
  replay: Replay
  playersById: Map<string, PlayerMeta>
  /** Active utilities page (throws/flashes/damage), driven by the URL. */
  sub: Sub
}>()

const emit = defineEmits<{
  /** Switch utilities page (the parent maps it to a URL). */
  (e: 'update:sub', value: Sub): void
  /** Forwarded from the throws view: seek the replay to a throw. */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const SUBS: Sub[] = ['throws', 'flashes', 'damage']
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- Sub-navigation: Throws / Flashes / Damage. Scrolls sideways on narrow
         viewports instead of overflowing. -->
    <div class="flex shrink-0 items-center justify-start gap-0.5 overflow-x-auto border-b border-ink-800 px-3 py-2 scrollbar-none sm:justify-center">
      <button
        v-for="s in SUBS"
        :key="s"
        type="button"
        class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
        :class="sub === s ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
        @click="emit('update:sub', s)"
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
      <UtilityDamageView v-else :replay="props.replay" />
    </div>
  </div>
</template>
