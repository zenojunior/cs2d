<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type MapCalibration, worldToFraction } from '@/viewer/domain/calibration'
import type { Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import type { KillInfo } from '@/viewer/analysis/heatmapTypes'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * A single map plot: one floor's radar with either a heat layer (`mode: 'heat'`)
 * or one colored dot per point (`mode: 'dots'`, for discrete events like kills /
 * deaths). Receives already-filtered points (side/player/round/level) and only
 * handles drawing. Heat is computed in a buffer in map-fraction space (zoom
 * independent); zoom/pan just redraws that buffer with a transform.
 */
const props = defineProps<{
  points: { x: number; y: number; side?: Side | null; kill?: KillInfo }[]
  calibration: MapCalibration
  /** Radar image of this floor. */
  radar: string
  /** Floor label (e.g. "Upper"); omitted on single-level maps. */
  label?: string
  /** 'heat' (density blobs) or 'dots' (one marker per point). Defaults to heat. */
  mode?: 'heat' | 'dots'
  /** Marker shape in dots mode: a filled circle or a skull (e.g. for deaths). */
  marker?: 'dot' | 'skull'
  /** Draw a faint shooter -> victim line for every point that carries a kill
   *  (dots mode), so all engagements show their path, not just dots. */
  paths?: boolean
  /** Emphasize one engagement's path (by round + instant), e.g. the row hovered
   *  in a side list. Draws the bright line + shooter marker for that kill. */
  highlight?: { roundIndex: number; t: number } | null
  /** Scale of the dot / skull markers (1 = default). The opening-duel map and the
   *  kills/deaths heatmaps use a smaller one for a tighter, less cluttered look. */
  markerScale?: number
}>()

const emit = defineEmits<{ jump: [payload: { roundIndex: number; t: number }] }>()

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
  // Dots mode draws straight from the points in render(); no heat buffer needed.
  if (props.mode === 'dots' || !pts.length) {
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
  } else {
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, cw, ch)
  }
  // Keep the open popover anchored to its marker as the view zooms/pans.
  if (selected.value) {
    const f = worldToFraction(props.calibration, selected.value.wx, selected.value.wy)
    selected.value.sx = panX + f.fx * w
    selected.value.sy = panY + f.fy * w
  }
  if (props.mode === 'dots') {
    if (props.paths) drawAllPaths(w)
    drawDots(w)
    drawHighlightPath(w)
    drawSelection(w)
  } else if (heatHasData) {
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(heatCanvas, panX, panY, w, w)
  }
}

/** For every kill point: a faint shooter -> victim line and a circle marking the
 *  shooter (the player who got the kill). The victim skull is already drawn by
 *  `drawDots`; this adds the line and the shooter dot. */
function drawAllPaths(w: number) {
  if (!ctx) return
  const r = Math.max(3, L * 0.006)
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 1.5
  for (const p of props.points) {
    const k = p.kill
    if (!k || k.ax == null || k.ay == null) continue
    const a = worldToFraction(props.calibration, k.ax, k.ay)
    const v = worldToFraction(props.calibration, k.vx, k.vy)
    const asx = panX + a.fx * w
    const asy = panY + a.fy * w
    // The shooter dot/line take the shooter's (attacker's) side color.
    const color = k.attackerColor
    // Faint line shooter -> victim.
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.strokeStyle = color + '40'
    ctx.beginPath()
    ctx.moveTo(asx, asy)
    ctx.lineTo(panX + v.fx * w, panY + v.fy * w)
    ctx.stroke()
    // Shooter (first-kill) circle.
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(asx, asy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + 'cc'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = color
    ctx.stroke()
  }
  ctx.restore()
}

/** Bright shooter -> victim line and shooter marker for one engagement. */
function emphasizeKill(k: KillInfo, w: number) {
  if (!ctx || k.ax == null || k.ay == null) return
  const a = worldToFraction(props.calibration, k.ax, k.ay)
  const v = worldToFraction(props.calibration, k.vx, k.vy)
  const asx = panX + a.fx * w
  const asy = panY + a.fy * w
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = 2
  ctx.setLineDash([5, 4])
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.beginPath()
  ctx.moveTo(asx, asy)
  ctx.lineTo(panX + v.fx * w, panY + v.fy * w)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(asx, asy, Math.max(4, L * 0.009), 0, Math.PI * 2)
  ctx.fillStyle = k.attackerColor
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.stroke()
  ctx.restore()
}

/** Emphasize the highlighted engagement (a hovered list row, via `highlight`)
 *  and whatever marker is under the cursor on the canvas, so hovering either the
 *  shooter or the victim lights up the whole path. */
function drawHighlightPath(w: number) {
  const hoverKill = hovered.value?.kill
  if (hoverKill) emphasizeKill(hoverKill, w)
  const h = props.highlight
  if (!h) return
  const p = props.points.find(
    (pt) => pt.kill && pt.kill.roundIndex === h.roundIndex && pt.kill.t === h.t,
  )
  if (p?.kill && p !== hovered.value) emphasizeKill(p.kill, w)
}

/** When a kill/death is selected, draw a line from the shooter's spot to the
 *  death spot, mark where the shooter was (dot, attacker side color) and the
 *  death spot (skull, victim side color). */
function drawSelection(w: number) {
  const k = selected.value?.kill
  if (!ctx || !k || k.ax == null || k.ay == null) return
  const a = worldToFraction(props.calibration, k.ax, k.ay)
  const v = worldToFraction(props.calibration, k.vx, k.vy)
  const asx = panX + a.fx * w
  const asy = panY + a.fy * w
  const vsx = panX + v.fx * w
  const vsy = panY + v.fy * w
  const r = Math.max(3, L * 0.007) * (props.markerScale ?? 1)
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = 2
  // Line shooter -> death spot.
  ctx.setLineDash([5, 4])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.beginPath()
  ctx.moveTo(asx, asy)
  ctx.lineTo(vsx, vsy)
  ctx.stroke()
  ctx.setLineDash([])
  // Shooter marker.
  ctx.beginPath()
  ctx.arc(asx, asy, Math.max(4, L * 0.009), 0, Math.PI * 2)
  ctx.fillStyle = k.attackerColor
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.stroke()
  // Death spot: skull, tinted by the victim's side.
  const skullImg = skullImage(k.victimColor)
  if (skullImg) {
    const s = r * 3.6
    ctx.drawImage(skullImg, vsx - s / 2, vsy - s / 2, s, s)
  }
  ctx.restore()
}

// Skull marker (deaths): the skull silhouette, tinted per side. We rasterize the
// SVG once, then build one side-colored canvas per color via `source-in`
// compositing (cached). Redraw when the source image loads.
const SKULL_PX = 64
const skullSrc = new Image()
let skullReady = false
skullSrc.onload = () => {
  skullReady = true
  render()
}
skullSrc.src = '/weapons/skull.svg'

const skullCache = new Map<string, HTMLCanvasElement>()
function skullImage(color: string): HTMLCanvasElement | null {
  if (!skullReady) return null
  const cached = skullCache.get(color)
  if (cached) return cached
  const off = document.createElement('canvas')
  off.width = SKULL_PX
  off.height = SKULL_PX
  const octx = off.getContext('2d')!
  octx.drawImage(skullSrc, 0, 0, SKULL_PX, SKULL_PX)
  // Recolor the opaque silhouette to the side color, keeping its alpha shape.
  octx.globalCompositeOperation = 'source-in'
  octx.fillStyle = color
  octx.fillRect(0, 0, SKULL_PX, SKULL_PX)
  skullCache.set(color, off)
  return off
}

/** One marker per point, colored by side (CT blue, T gold, gray when unknown):
 *  a translucent circle, or a skull when `marker === 'skull'`. `w` is the
 *  on-screen radar size; positions come from map fractions. */
function drawDots(w: number) {
  if (!ctx) return
  const r = Math.max(3, L * 0.007) * (props.markerScale ?? 1)
  const skull = props.marker === 'skull'
  ctx.lineWidth = 1
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
  ctx.shadowBlur = 2
  for (const p of props.points) {
    const { fx, fy } = worldToFraction(props.calibration, p.x, p.y)
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue
    const sx = panX + fx * w
    const sy = panY + fy * w
    // A skull marks the victim's death: tint by the victim's side (from the kill
    // data) rather than the point's side, which on the opening-duel map is the
    // winner's. Matches the selected/clicked skull below.
    const color =
      skull && p.kill ? p.kill.victimColor : p.side ? SIDE_COLOR[p.side] : '#cbd5e1'
    const hot = p === hovered.value
    // Hovered marker: a white halo ring behind it, and a slightly larger size.
    if (hot) {
      ctx.beginPath()
      ctx.arc(sx, sy, r * (skull ? 2.4 : 1.9), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.stroke()
      ctx.lineWidth = 1
    }
    if (skull) {
      const img = skullImage(color)
      if (!img) continue
      const s = r * 3.6 * (hot ? 1.3 : 1)
      ctx.drawImage(img, sx - s / 2, sy - s / 2, s, s)
    } else {
      ctx.beginPath()
      ctx.arc(sx, sy, r * (hot ? 1.3 : 1), 0, Math.PI * 2)
      ctx.fillStyle = hot ? color + 'dd' : color + '99'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.stroke()
    }
  }
  ctx.restore()
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

type Point = (typeof props.points)[number]
// Popover for a clicked kill/death marker. `wx/wy` is the clicked marker's world
// position (the anchor); `sx/sy` is its current on-screen px, recomputed on every
// render so the popover follows zoom/pan instead of closing.
const selected = ref<{ wx: number; wy: number; sx: number; sy: number; kill: KillInfo } | null>(null)
// Kill point currently under the cursor, drawn emphasized (hover effect).
const hovered = ref<Point | null>(null)

/** Nearest kill marker to a canvas-space (mx, my), within the marker hit radius.
 *  Both the victim (death spot) and, when paths are drawn, the shooter circle are
 *  hittable, so either end of an engagement is clickable. `wx`/`wy` is the world
 *  position of the marker hit (anchors the popover where the user clicked). */
function hitTest(
  mx: number,
  my: number,
): { point: Point; sx: number; sy: number; wx: number; wy: number } | null {
  const w = L * zoom.value
  const reach = Math.max(11, L * 0.014)
  let best: { point: Point; sx: number; sy: number; wx: number; wy: number } | null = null
  let bestDist = reach * reach
  const consider = (p: Point, wx: number, wy: number) => {
    const { fx, fy } = worldToFraction(props.calibration, wx, wy)
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return
    const sx = panX + fx * w
    const sy = panY + fy * w
    const d = (sx - mx) ** 2 + (sy - my) ** 2
    if (d <= bestDist) {
      bestDist = d
      best = { point: p, sx, sy, wx, wy }
    }
  }
  for (const p of props.points) {
    if (!p.kill) continue
    consider(p, p.x, p.y) // victim / death spot
    if (props.paths && p.kill.ax != null && p.kill.ay != null) {
      consider(p, p.kill.ax, p.kill.ay) // shooter (first-kill) circle
    }
  }
  return best
}

let dragging = ref(false)
let lastX = 0
let lastY = 0
let downX = 0
let downY = 0
let moved = 0
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragging.value = true
  lastX = e.clientX
  lastY = e.clientY
  downX = e.clientX
  downY = e.clientY
  moved = 0
  canvas.value?.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (dragging.value) {
    panX += e.clientX - lastX
    panY += e.clientY - lastY
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY)
    lastX = e.clientX
    lastY = e.clientY
    render()
    return
  }
  // Idle hover: highlight the kill marker under the cursor.
  const rect = canvas.value!.getBoundingClientRect()
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
  if ((hit?.point ?? null) !== hovered.value) {
    hovered.value = hit?.point ?? null
    render()
  }
}
function onPointerLeave() {
  if (hovered.value) {
    hovered.value = null
    render()
  }
}
function onPointerUp(e: PointerEvent) {
  dragging.value = false
  canvas.value?.releasePointerCapture(e.pointerId)
  // A click (no real drag): open the kill popover under the cursor, or dismiss.
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) <= 4) {
    const rect = canvas.value!.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    selected.value = hit
      ? { wx: hit.wx, wy: hit.wy, sx: hit.sx, sy: hit.sy, kill: hit.point.kill! }
      : null
    render()
  }
}

function jumpToSelected() {
  const k = selected.value?.kill
  if (!k) return
  emit('jump', { roundIndex: k.roundIndex, t: k.t })
  selected.value = null
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
watch([() => props.points, () => props.mode, () => props.marker], () => {
  selected.value = null
  hovered.value = null
  buildHeat()
})
// Re-render (cheap, no heat rebuild) when the external highlight changes.
watch(() => props.highlight, () => render())

const canReset = computed(() => zoom.value > 1.0001)
</script>

<template>
  <div ref="wrap" class="relative h-full min-w-0 flex-1 overflow-hidden">
    <canvas
      ref="canvas"
      class="block touch-none"
      :class="dragging ? 'cursor-grabbing' : hovered ? 'cursor-pointer' : 'cursor-grab'"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
    />

    <!-- Rótulo do andar -->
    <div
      v-if="label"
      class="pointer-events-none absolute left-3 top-3 rounded-md bg-ink-950/70 px-2.5 py-1 font-display text-xs text-ink-100 backdrop-blur"
    >
      {{ label }}
    </div>

    <!-- Kill popover: who killed whom at this spot; click to seek the replay. -->
    <button
      v-if="selected"
      type="button"
      class="absolute z-10 flex -translate-x-1/2 -translate-y-full cursor-pointer flex-col gap-0.5 rounded-lg border border-ink-700 bg-ink-900/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur transition-colors hover:border-surge-500/60"
      :style="{ left: `${selected.sx}px`, top: `${selected.sy - 10}px` }"
      @click="jumpToSelected"
    >
      <div class="flex items-center gap-1.5 whitespace-nowrap">
        <span
          v-if="selected.kill.attackerName"
          class="font-medium"
          :style="{ color: selected.kill.attackerColor }"
          >{{ selected.kill.attackerName }}</span
        >
        <template v-if="selected.kill.assistedFlash">
          <span class="font-medium" :style="{ color: selected.kill.attackerColor }">+</span>
          <img src="/weapons/flash.svg" alt="flash" class="h-3.5 w-3.5 object-contain" />
        </template>
        <img
          v-if="selected.kill.weaponIcon"
          :src="selected.kill.weaponIcon"
          :alt="selected.kill.weapon"
          class="h-3 w-7 object-contain"
        />
        <span v-else class="text-ink-400">{{ selected.kill.weapon }}</span>
        <img
          v-if="selected.kill.headshot"
          src="/weapons/headshot.svg"
          :alt="t('viewer.headshot')"
          class="h-3.5 w-3.5 object-contain"
        />
        <span class="font-medium" :style="{ color: selected.kill.victimColor }">{{
          selected.kill.victimName
        }}</span>
      </div>
      <div class="text-[0.65rem] text-ink-400">
        {{ t('viewer.round') }} {{ selected.kill.roundNumber }} · {{ t('heatmap.jumpHint') }}
      </div>
    </button>

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
