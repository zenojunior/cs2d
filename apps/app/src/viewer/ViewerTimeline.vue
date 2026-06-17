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
  /** Seconds where the round goes live (end of freeze). Freeze = [0, liveStartT]. */
  liveStartT?: number
  /** Seconds where the post-round starts (round decided). Post = [postStartT, duration]. */
  postStartT?: number
  /** Tooltip for the freeze band (e.g. "Freeze · 20s"). */
  freezeLabel?: string
  /** Tooltip for the round-end mark. */
  roundEndLabel?: string
  /** Pause spans within this round (seconds from t = 0), drawn as amber bands. */
  pauseBands?: { startT: number; endT: number; label: string }[]
}>()

const emit = defineEmits<{ seek: [fraction: number] }>()

const frac = (t: number) => (props.duration > 0 ? Math.min(1, Math.max(0, t / props.duration)) : 0)
const progress = computed(() => frac(props.currentT))

// Freeze / post-round shaded bands (only when they have a visible width).
const freezePct = computed(() => frac(props.liveStartT ?? 0) * 100)
const postPct = computed(() => {
  const start = frac(props.postStartT ?? props.duration)
  return Math.max(0, (1 - start) * 100)
})

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
    <!-- Freeze (buy) and post-round bands: dim the non-live phases so the live
         round stands out. The freeze band carries the freeze-time tooltip. -->
    <div
      v-if="freezePct > 0.5"
      v-tooltip="freezeLabel"
      class="absolute inset-y-1 left-0 rounded-l-md bg-sky-500/12"
      :style="{ width: freezePct + '%' }"
    >
      <div class="absolute inset-y-0 right-0 w-px bg-sky-400/40" />
    </div>
    <div
      v-if="postPct > 0.5"
      class="pointer-events-none absolute inset-y-1 right-0 rounded-r-md bg-ink-400/12"
      :style="{ width: postPct + '%' }"
    />

    <!-- Pause bands: tactical timeouts / tech pauses inside the round. -->
    <div
      v-for="(b, i) in pauseBands ?? []"
      :key="'pause' + i"
      v-tooltip="b.label"
      class="absolute inset-y-1 bg-amber-500/20"
      :style="{ left: frac(b.startT) * 100 + '%', width: (frac(b.endT) - frac(b.startT)) * 100 + '%' }"
    >
      <div class="absolute inset-y-0 left-0 w-px bg-amber-400/60" />
      <div class="absolute inset-y-0 right-0 w-px bg-amber-400/60" />
    </div>

    <!-- Round-end mark: where the round was decided (tooltip on hover). -->
    <div
      v-if="postStartT != null"
      v-tooltip="roundEndLabel"
      class="absolute inset-y-2 w-1.5 -translate-x-1/2 rounded-full"
      :style="{ left: frac(postStartT) * 100 + '%' }"
    >
      <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-300/50" />
    </div>

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
