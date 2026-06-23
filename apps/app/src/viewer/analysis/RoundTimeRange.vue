<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * Round-time window picker, styled like the replay timeline: a track spanning
 * the whole round, with the selected [lo, hi] window highlighted. Drag either
 * edge to resize the window, or grab the middle of the window and drag to slide
 * it (keeping its width). Bind `[lo, hi]` with `v-model`.
 */
const props = defineProps<{
  min?: number
  max: number
  step?: number
  /** Accent color (any CSS color) for the window fill, edges and handles. */
  color?: string
}>()

const model = defineModel<number[]>({ required: true })

const accent = computed(() => props.color ?? 'var(--color-surge-500)')
const fillStyle = computed(() => ({
  left: loPct.value + '%',
  width: hiPct.value - loPct.value + '%',
  backgroundColor: `color-mix(in srgb, ${accent.value} 28%, transparent)`,
}))
const edgeStyle = computed(() => ({
  backgroundColor: `color-mix(in srgb, ${accent.value} 70%, transparent)`,
}))
const handleStyle = computed(() => ({
  backgroundColor: accent.value,
  borderColor: `color-mix(in srgb, ${accent.value} 50%, white)`,
}))

const min = computed(() => props.min ?? 0)
const step = computed(() => props.step ?? 1)
const span = computed(() => Math.max(1, props.max - min.value))

const lo = computed(() => model.value[0] ?? min.value)
const hi = computed(() => model.value[1] ?? props.max)
const loPct = computed(() => ((lo.value - min.value) / span.value) * 100)
const hiPct = computed(() => ((hi.value - min.value) / span.value) * 100)

const track = ref<HTMLElement | null>(null)
// Active drag: which part was grabbed, plus (for 'move') the pointer's offset
// from `lo` at grab time so the window slides under the cursor without jumping.
type Mode = 'lo' | 'hi' | 'move'
const drag = ref<{ mode: Mode; grabOffset: number } | null>(null)

/** Pointer X as a value on the [min, max] scale, snapped to `step`. */
function valueFromEvent(e: PointerEvent): number {
  const el = track.value
  if (!el) return min.value
  const rect = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  const raw = min.value + frac * span.value
  return Math.round(raw / step.value) * step.value
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}

function down(mode: Mode, e: PointerEvent) {
  e.stopPropagation()
  const grabOffset = mode === 'move' ? valueFromEvent(e) - lo.value : 0
  drag.value = { mode, grabOffset }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function move(e: PointerEvent) {
  if (!drag.value) return
  const v = valueFromEvent(e)
  if (drag.value.mode === 'lo') {
    model.value = [clamp(v, min.value, hi.value), hi.value]
  } else if (drag.value.mode === 'hi') {
    model.value = [lo.value, clamp(v, lo.value, props.max)]
  } else {
    const width = hi.value - lo.value
    const newLo = clamp(v - drag.value.grabOffset, min.value, props.max - width)
    model.value = [newLo, newLo + width]
  }
}

function up(e: PointerEvent) {
  drag.value = null
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
}

/** Click on the bare track (outside the window): jump the nearest edge there. */
function trackDown(e: PointerEvent) {
  const v = valueFromEvent(e)
  if (v < lo.value) {
    drag.value = { mode: 'lo', grabOffset: 0 }
    model.value = [v, hi.value]
  } else if (v > hi.value) {
    drag.value = { mode: 'hi', grabOffset: 0 }
    model.value = [lo.value, v]
  } else {
    return
  }
  track.value?.setPointerCapture(e.pointerId)
}
</script>

<template>
  <div
    ref="track"
    class="relative h-9 w-full cursor-pointer touch-none select-none rounded-md bg-ink-700/60"
    @pointerdown="trackDown"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <!-- Selected window: drag the middle to slide it. -->
    <div
      class="absolute inset-y-0 cursor-grab rounded-md active:cursor-grabbing"
      :style="fillStyle"
      @pointerdown="down('move', $event)"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <div class="absolute inset-y-0 left-0 w-px" :style="edgeStyle" />
      <div class="absolute inset-y-0 right-0 w-px" :style="edgeStyle" />
    </div>

    <!-- Edge handles: drag to resize the window. -->
    <div
      v-for="edge in (['lo', 'hi'] as const)"
      :key="edge"
      class="absolute inset-y-0 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center"
      :style="{ left: (edge === 'lo' ? loPct : hiPct) + '%' }"
      @pointerdown="down(edge, $event)"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <div class="h-5 w-1 rounded-full border shadow" :style="handleStyle" />
    </div>
  </div>
</template>
