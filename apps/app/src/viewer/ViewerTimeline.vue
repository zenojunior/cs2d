<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TimelineMarker } from './timelineMarkers'
import { SIDE_COLOR } from './colors'

const props = defineProps<{
  currentT: number
  duration: number
  markers: TimelineMarker[]
  /** Per-team voice amplitude envelope (0..1 per column). */
  waveform?: { ct: number[]; t: number[] } | null
}>()

const emit = defineEmits<{ seek: [fraction: number] }>()

const frac = (t: number) => (props.duration > 0 ? Math.min(1, Math.max(0, t / props.duration)) : 0)
const progress = computed(() => frac(props.currentT))

// --- Waveform: mirrored bars (CT up, T down) from the center.
// viewBox in column units (width = number of bins, height 100, center at 50).
const N = computed(() => props.waveform?.ct.length ?? 0)
const AMP = 46 // max amplitude (viewBox units) on each side
const bars = computed(() => {
  const w = props.waveform
  if (!w) return []
  return w.ct.map((ctv, i) => ({
    i,
    ctY: 50 - ctv * AMP,
    ctH: ctv * AMP,
    tH: (w.t[i] ?? 0) * AMP,
  }))
})
// Width (in column units) of the clip for the already-played part.
const playedW = computed(() => progress.value * N.value)

const track = ref<HTMLElement | null>(null)
const dragging = ref(false)
// Cursor position over the track (fraction [0,1]) or null when outside.
const hoverFrac = ref<number | null>(null)

function fracFromEvent(e: PointerEvent) {
  const el = track.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
}
function seekFromEvent(e: PointerEvent) {
  emit('seek', fracFromEvent(e))
}
function down(e: PointerEvent) {
  dragging.value = true
  track.value?.setPointerCapture(e.pointerId)
  seekFromEvent(e)
}
function move(e: PointerEvent) {
  hoverFrac.value = fracFromEvent(e)
  if (dragging.value) seekFromEvent(e)
}
function up(e: PointerEvent) {
  dragging.value = false
  track.value?.releasePointerCapture(e.pointerId)
}
function leave() {
  if (!dragging.value) hoverFrac.value = null
}
</script>

<template>
  <div
    ref="track"
    class="group relative h-[60px] flex-1 cursor-pointer touch-none select-none"
    :class="{ 'is-dragging': dragging }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @pointerleave="leave"
  >
    <!-- Voice waveform (when comms exist): CT up, T down from the center.
         The played part is full color; the rest is faded. -->
    <template v-if="waveform && bars.length">
      <!-- baseline at the center -->
      <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700" />
      <svg
        class="absolute inset-y-1 left-0 h-[calc(100%-8px)] w-full"
        :viewBox="`0 0 ${N} 100`"
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath id="wave-played">
            <rect x="0" y="0" :width="playedW" height="100" />
          </clipPath>
        </defs>
        <!-- faded base (not-yet-played part) -->
        <g opacity="0.3">
          <template v-for="b in bars" :key="`d${b.i}`">
            <rect :x="b.i + 0.2" width="0.6" :y="b.ctY" :height="b.ctH" :fill="SIDE_COLOR.CT" />
            <rect :x="b.i + 0.2" width="0.6" y="50" :height="b.tH" :fill="SIDE_COLOR.T" />
          </template>
        </g>
        <!-- played part in full color (clipped to the playhead) -->
        <g clip-path="url(#wave-played)">
          <template v-for="b in bars" :key="`p${b.i}`">
            <rect :x="b.i + 0.2" width="0.6" :y="b.ctY" :height="b.ctH" :fill="SIDE_COLOR.CT" />
            <rect :x="b.i + 0.2" width="0.6" y="50" :height="b.tH" :fill="SIDE_COLOR.T" />
          </template>
        </g>
      </svg>
    </template>

    <!-- No voice: plain track with a progress fill. -->
    <div v-else class="absolute inset-x-0 inset-y-3 overflow-hidden rounded-md bg-ink-700">
      <div class="h-full bg-ink-500" :style="{ width: progress * 100 + '%' }" />
    </div>

    <!-- markers (vertical lines): plant, first kill, etc. -->
    <div
      v-for="(m, i) in markers"
      :key="m.kind + i"
      v-tooltip="m.label"
      class="absolute inset-y-3 w-[3px] -translate-x-1/2 rounded-full transition-transform duration-150 group-hover:scale-y-110"
      :style="{ left: frac(m.t) * 100 + '%', backgroundColor: m.color }"
    />

    <!-- hover line: follows the cursor over the track -->
    <div
      v-if="hoverFrac !== null"
      class="pointer-events-none absolute inset-y-1 w-px -translate-x-1/2 bg-white/30"
      :style="{ left: hoverFrac * 100 + '%' }"
    />

    <!-- playhead: vertical line at the current position (no dot) -->
    <div
      class="pointer-events-none absolute inset-y-0 -translate-x-1/2 rounded-full bg-surge-300 shadow-[0_0_6px_var(--color-surge-500)] transition-[width] duration-150"
      :class="dragging ? 'w-[3px]' : 'w-0.5 group-hover:w-[3px]'"
      :style="{ left: progress * 100 + '%' }"
    />
  </div>
</template>
