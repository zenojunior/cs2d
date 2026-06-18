<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type MapCalibration, worldToFraction } from '@/viewer/domain/calibration'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * A single heatmap plot: one map floor's radar with the heat layer on top.
 * Receives already-filtered points (side/player/round/level) and only handles
 * drawing. Heat is computed in a buffer in map-fraction space (zoom independent);
 * zoom/pan just redraws that buffer with a transform.
 */
const props = defineProps<{
  points: { x: number; y: number }[]
  calibration: MapCalibration
  /** Radar image of this floor. */
  radar: string
  /** Floor label (e.g. "Upper"); omitted on single-level maps. */
  label?: string
}>()

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
const radarImg = new Image()
let radarReady = false
let cw = 0
let ch = 0
let L = 0

const HEAT = 512
const BLUR_RADIUS = 7
const BLUR_PASSES = 3
const heatCanvas = document.createElement('canvas')
heatCanvas.width = HEAT
heatCanvas.height = HEAT
let heatHasData = false

const zoom = ref(1)
let panX = 0
let panY = 0
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function heatColor(v: number): [number, number, number] {
  const stops: [number, number[]][] = [
    [0.0, [40, 80, 200]],
    [0.35, [40, 200, 220]],
    [0.6, [80, 220, 90]],
    [0.8, [240, 220, 60]],
    [1.0, [240, 60, 50]],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const f = (v - t0) / (t1 - t0 || 1)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]
    }
  }
  return [240, 60, 50]
}

/** Separable box blur applied N times (3 passes ~ gaussian => round blobs). */
function blur(grid: Float32Array, w: number, h: number, r: number, passes: number) {
  const span = r * 2 + 1
  const tmp = new Float32Array(grid.length)
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k))
          sum += grid[y * w + xx]
        }
        tmp[y * w + x] = sum / span
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k))
          sum += tmp[yy * w + x]
        }
        grid[y * w + x] = sum / span
      }
    }
  }
}

function buildHeat() {
  const pts = props.points
  const hctx = heatCanvas.getContext('2d')!
  hctx.clearRect(0, 0, HEAT, HEAT)
  heatHasData = false
  if (!pts.length) {
    render()
    return
  }

  const grid = new Float32Array(HEAT * HEAT)
  for (const p of pts) {
    const { fx, fy } = worldToFraction(props.calibration, p.x, p.y)
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue
    const gx = Math.min(HEAT - 1, Math.floor(fx * HEAT))
    const gy = Math.min(HEAT - 1, Math.floor(fy * HEAT))
    grid[gy * HEAT + gx] += 1
  }
  blur(grid, HEAT, HEAT, BLUR_RADIUS, BLUR_PASSES)

  let max = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i]
  if (max <= 0) {
    render()
    return
  }

  const img = hctx.createImageData(HEAT, HEAT)
  for (let i = 0; i < grid.length; i++) {
    const v = Math.sqrt(grid[i] / max)
    if (v <= 0.02) continue
    const [r, g, b] = heatColor(v)
    const o = i * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    img.data[o + 3] = Math.round(Math.min(0.85, v) * 255)
  }
  hctx.putImageData(img, 0, 0)
  heatHasData = true
  render()
}

function render() {
  if (!ctx || cw === 0) return
  ctx.clearRect(0, 0, cw, ch)
  const w = L * zoom.value
  if (radarReady) {
    ctx.drawImage(radarImg, panX, panY, w, w)
    ctx.fillStyle = 'rgba(8, 11, 18, 0.45)'
    ctx.fillRect(panX, panY, w, w)
  } else {
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, cw, ch)
  }
  if (heatHasData) {
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(heatCanvas, panX, panY, w, w)
  }
}

function fit() {
  const el = wrap.value
  const cv = canvas.value
  if (!el || !cv) return
  const dpr = window.devicePixelRatio || 1
  cw = el.clientWidth
  ch = el.clientHeight
  L = Math.min(cw, ch)
  cv.width = Math.round(cw * dpr)
  cv.height = Math.round(ch * dpr)
  cv.style.width = `${cw}px`
  cv.style.height = `${ch}px`
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  panX = (cw - L * zoom.value) / 2
  panY = (ch - L * zoom.value) / 2
  render()
}

function onWheel(e: WheelEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = clamp(zoom.value * factor, 1, 10)
  const real = next / zoom.value
  panX = mx - (mx - panX) * real
  panY = my - (my - panY) * real
  zoom.value = next
  render()
}

let dragging = ref(false)
let lastX = 0
let lastY = 0
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragging.value = true
  lastX = e.clientX
  lastY = e.clientY
  canvas.value?.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  panX += e.clientX - lastX
  panY += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  render()
}
function onPointerUp(e: PointerEvent) {
  dragging.value = false
  canvas.value?.releasePointerCapture(e.pointerId)
}

function zoomBy(factor: number) {
  const cx = cw / 2
  const cy = ch / 2
  const next = clamp(zoom.value * factor, 1, 10)
  const real = next / zoom.value
  panX = cx - (cx - panX) * real
  panY = cy - (cy - panY) * real
  zoom.value = next
  render()
}
function resetView() {
  zoom.value = 1
  panX = (cw - L) / 2
  panY = (ch - L) / 2
  render()
}

let ro: ResizeObserver | null = null
onMounted(() => {
  radarImg.onload = () => {
    radarReady = true
    render()
  }
  radarImg.src = props.radar
  fit()
  buildHeat()
  ro = new ResizeObserver(fit)
  if (wrap.value) ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())

watch(
  () => props.radar,
  (src) => {
    radarReady = false
    radarImg.src = src
  },
)
watch(() => props.points, buildHeat)

const canReset = computed(() => zoom.value > 1.0001)
</script>

<template>
  <div ref="wrap" class="relative h-full min-w-0 flex-1 overflow-hidden">
    <canvas
      ref="canvas"
      class="block touch-none"
      :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    />

    <!-- Rótulo do andar -->
    <div
      v-if="label"
      class="pointer-events-none absolute left-3 top-3 rounded-md bg-ink-950/70 px-2.5 py-1 font-display text-xs text-ink-100 backdrop-blur"
    >
      {{ label }}
    </div>

    <!-- Controles de zoom -->
    <div class="absolute bottom-4 right-4 flex flex-col gap-1">
      <button
        type="button"
        :aria-label="t('viewer.zoomIn')"
        class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-900/80 text-ink-200 backdrop-blur transition-colors hover:bg-ink-800"
        @click="zoomBy(1.4)"
      >
        <UiIcon name="plus" class="h-4 w-4" />
      </button>
      <button
        type="button"
        :aria-label="t('viewer.zoomOut')"
        class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-900/80 text-ink-200 backdrop-blur transition-colors hover:bg-ink-800"
        @click="zoomBy(1 / 1.4)"
      >
        <UiIcon name="minus" class="h-4 w-4" />
      </button>
      <button
        v-if="canReset"
        type="button"
        :aria-label="t('viewer.zoomReset')"
        class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-900/80 text-ink-200 backdrop-blur transition-colors hover:bg-ink-800"
        @click="resetView"
      >
        <UiIcon name="maximize" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
