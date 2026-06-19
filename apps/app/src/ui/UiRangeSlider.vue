<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { cn } from '@/ui/utils'

/**
 * Themed range slider on top of reka-ui (same base as UiSelect). Bind an array
 * with `v-model`: one thumb per entry, so `[lo, hi]` gives a two-handle range.
 */
const props = defineProps<{
  min?: number
  max: number
  step?: number
  class?: string
}>()

const model = defineModel<number[]>({ required: true })
</script>

<template>
  <SliderRoot
    v-model="model"
    :min="props.min ?? 0"
    :max="props.max"
    :step="props.step ?? 1"
    :min-steps-between-thumbs="0"
    :class="cn('relative flex w-full touch-none select-none items-center py-1.5', props.class)"
  >
    <SliderTrack class="relative h-1 w-full grow overflow-hidden rounded-full bg-ink-700">
      <SliderRange class="absolute h-full rounded-full bg-surge-500" />
    </SliderTrack>
    <SliderThumb
      v-for="(_, i) in model"
      :key="i"
      class="block h-3.5 w-3.5 rounded-full border border-surge-300 bg-surge-400 shadow transition-colors hover:bg-surge-300 focus:outline-none focus:ring-2 focus:ring-surge-500/50"
    />
  </SliderRoot>
</template>
