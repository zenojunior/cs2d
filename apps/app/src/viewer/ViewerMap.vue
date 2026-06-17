<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { GrenadePath, PlayerMeta, PlayerState, Round, Side } from '@/viewer/schema'
import { worldToFraction, DEFAULT_BLAST_RADIUS, type MapCalibration } from './calibration'
import { SIDE_COLOR } from './colors'
import { WEAPON_LABELS, weaponIconPath } from './weaponIcons'
import { useI18n } from '@/i18n'

// `t` is used internally for time; i18n is aliased as `tr`.
const { t: tr } = useI18n()

const props = defineProps<{
  players: PlayerState[]
  currentT: number
  round: Round | null
  calibration: MapCalibration
  playersById: Map<string, PlayerMeta>
  bombBlink: boolean
  /** steamIds talking right now (shows the mic next to the circle). */
  talking?: Set<string>
  /** Per-team mute: hides the mic for a muted team. */
  muted?: Record<Side, boolean>
  /** Auto zoom: frames all living players, easing in/out. */
  autoZoom?: boolean
  /** Arc to highlight in full (grenades hover): when set, only this one shows. */
  previewPath?: GrenadePath | null
  /** Arcs drawn together (grenades page): the whole filtered set at once. */
  previewPaths?: GrenadePath[] | null
  /** Active floor radar (multi-level maps). Falls back to the calibration radar. */
  radarSrc?: string
  /** Z range of the active floor: players outside it are dimmed. */
  levelRange?: { minZ: number; maxZ: number } | null
  /** Show the zoom buttons (hidden in the decorative preview). Default: true. */
  controls?: boolean
}>()

const KILL_FADE = 1.4
const SHOT_FADE = 0.12 // seconds the tracer stays visible
const SHOT_LEN = 1400 // tracer length in game units
const PLANT_TIME = 3.2 // C4 plant duration (s), animated before bomb_planted
const BLAST_TIME = 0.8 // C4 explosion shockwave duration (s)

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let ro: ResizeObserver | null = null

// real canvas size (CSS px) and base radar side (centered square)
let cw = 0
let ch = 0
let L = 0

// view transform (zoom/pan), in CSS px
const zoom = ref(1)
let panX = 0
let panY = 0

const radar = new Image()
let radarReady = false

// Mic icon (talking indicator), preloaded per team color.
function makeMic(color: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
  img.onload = () => draw()
  return img
}
const micImgs: Record<Side, HTMLImageElement> = {
  CT: makeMic(SIDE_COLOR.CT),
  T: makeMic(SIDE_COLOR.T),
}

// weapon icons (SVG) preloaded as images to draw on the canvas
const weaponImgs = new Map<string, HTMLImageElement>()
for (const label of WEAPON_LABELS) {
  const path = weaponIconPath(label)
  if (!path) continue
  const img = new Image()
  img.src = path
  img.onload = () => draw()
  weaponImgs.set(label, img)
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function fit() {
  L = Math.min(cw, ch)
  panX = (cw - L * zoom.value) / 2
  panY = (ch - L * zoom.value) / 2
}

function resize() {
  const el = wrap.value
  const cv = canvas.value
  if (!el || !cv) return
  const dpr = window.devicePixelRatio || 1
  cw = el.clientWidth
  ch = el.clientHeight
  cv.width = cw * dpr
  cv.height = ch * dpr
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  fit()
  draw()
}

// --- world -> screen conversions (zoom/pan already applied) ---
function w2s(wx: number, wy: number) {
  const { fx, fy } = worldToFraction(props.calibration, wx, wy)
  return { x: fx * L * zoom.value + panX, y: fy * L * zoom.value + panY }
}
function unitsToScreen(u: number) {
  return (u / props.calibration.scale / 1024) * L * zoom.value
}

// Dot radius sized in game units (~hitbox), so it grows with the map on zoom
// ("real" size). The clamp only keeps it from disappearing / blowing up.
const PLAYER_RADIUS_UNITS = 34
function playerRadius() {
  return clamp(unitsToScreen(PLAYER_RADIUS_UNITS), 7, 62)
}

function drawKill(x: number, y: number, alpha: number) {
  if (!ctx) return
  const r = 7
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#ff4d5e'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x - r, y - r)
  ctx.lineTo(x + r, y + r)
  ctx.moveTo(x + r, y - r)
  ctx.lineTo(x - r, y + r)
  ctx.stroke()
  ctx.restore()
}

function drawGrenade(
  ev: Extract<Round['events'][number], { type: 'grenade' }>,
  t: number,
) {
  if (!ctx) return
  const { x, y } = w2s(ev.x, ev.y)
  const span = Math.max(0.001, ev.endT - ev.t)
  const k = clamp((t - ev.t) / span, 0, 1)
  ctx.save()
  if (ev.kind === 'smoke') {
    // Smoke: a puffy, irregular body (not a perfect circle) built from a seeded
    // deformed outline plus a few inner puffs for volume, softened with a blur.
    // It drifts very slowly so it reads as smoke without looking nervous.
    const R = unitsToScreen(144)
    const seed = ev.x * 0.011 + ev.y * 0.015
    const rand = (n: number) => {
      const v = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
      return v - Math.floor(v)
    }
    // irregular outline, computed once and reused for the fill and the border
    const verts = 34
    const ring: { x: number; y: number }[] = []
    for (let i = 0; i < verts; i++) {
      const ang = (i / verts) * Math.PI * 2
      const wob = 0.86 + 0.12 * rand(i + 7) + 0.03 * Math.sin(t * 1.8 + i * 0.5 + seed)
      ring.push({ x: x + Math.cos(ang) * R * wob, y: y + Math.sin(ang) * R * wob })
    }
    const tracePath = () => {
      ctx!.beginPath()
      ctx!.moveTo(ring[0].x, ring[0].y)
      for (let i = 1; i < ring.length; i++) ctx!.lineTo(ring[i].x, ring[i].y)
      ctx!.closePath()
    }
    // body
    ctx.filter = `blur(${clamp(R * 0.06, 2, 7)}px)`
    const grad = ctx.createRadialGradient(x, y, R * 0.1, x, y, R)
    grad.addColorStop(0, 'rgba(220, 224, 232, 0.46)')
    grad.addColorStop(0.7, 'rgba(208, 213, 224, 0.34)')
    grad.addColorStop(1, 'rgba(206, 211, 222, 0.04)')
    ctx.fillStyle = grad
    tracePath()
    ctx.fill()
    // inner puffs drifting slowly for a volumetric look
    const puffs = 7
    for (let i = 0; i < puffs; i++) {
      const ang = rand(i + 50) * Math.PI * 2 + t * 0.12
      const dist = R * (0.1 + 0.42 * rand(i + 80))
      const px = x + Math.cos(ang) * dist
      const py = y + Math.sin(ang) * dist
      const pr = R * (0.28 + 0.22 * rand(i + 90))
      const pg = ctx.createRadialGradient(px, py, 0, px, py, pr)
      pg.addColorStop(0, 'rgba(230, 234, 242, 0.2)')
      pg.addColorStop(1, 'rgba(220, 224, 232, 0)')
      ctx.fillStyle = pg
      ctx.beginPath()
      ctx.arc(px, py, pr, 0, Math.PI * 2)
      ctx.fill()
    }
    // soft irregular border
    ctx.filter = 'blur(1.5px)'
    ctx.strokeStyle = 'rgba(228, 232, 240, 0.4)'
    ctx.lineWidth = 1.5
    tracePath()
    ctx.stroke()
  } else if (ev.kind === 'fire') {
    // Fire: a soft base glow filled with flickering flame blobs, so it reads as
    // burning rather than a flat orange disc. Blob layout is deterministic (seeded
    // from the detonation position); only the intensity/size animate with `t`.
    const R = unitsToScreen(150)
    const seed = ev.x * 0.013 + ev.y * 0.017
    const rand = (n: number) => {
      const v = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
      return v - Math.floor(v)
    }
    // base glow
    const base = ctx.createRadialGradient(x, y, R * 0.1, x, y, R)
    base.addColorStop(0, 'rgba(255, 120, 30, 0.28)')
    base.addColorStop(0.7, 'rgba(220, 70, 20, 0.16)')
    base.addColorStop(1, 'rgba(180, 40, 10, 0)')
    ctx.fillStyle = base
    ctx.beginPath()
    ctx.arc(x, y, R, 0, Math.PI * 2)
    ctx.fill()
    // flickering flame blobs (additive blending so overlaps glow brighter)
    ctx.globalCompositeOperation = 'lighter'
    const blobs = 12
    for (let i = 0; i < blobs; i++) {
      const ang = rand(i + 1) * Math.PI * 2
      const dist = R * (0.12 + 0.62 * rand(i + 31))
      const fx = x + Math.cos(ang) * dist
      const fy = y + Math.sin(ang) * dist
      const flick = 0.55 + 0.45 * Math.sin(t * 9 + i * 1.7 + seed)
      const fr = R * (0.16 + 0.13 * flick)
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr)
      g.addColorStop(0, `rgba(255, 235, 130, ${0.5 * flick})`)
      g.addColorStop(0.45, `rgba(255, 140, 40, ${0.38 * flick})`)
      g.addColorStop(1, 'rgba(200, 50, 10, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(fx, fy, fr, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (ev.kind === 'he') {
    ctx.globalAlpha = 1 - k
    ctx.strokeStyle = '#ffb020'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(x, y, unitsToScreen(60) * (0.6 + k * 0.8), 0, Math.PI * 2)
    ctx.stroke()
  } else if (ev.kind === 'flash') {
    ctx.globalAlpha = (1 - k) * 0.7
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, unitsToScreen(70), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  // Countdown for lingering effects (smoke dissipating / fire burning out).
  if (ev.kind === 'smoke' || ev.kind === 'fire') {
    drawGrenadeTimer(x, y, ev.endT - t, span, ev.kind)
  }
}

/** Compact circular countdown shown at the center of a smoke/fire effect. The
 *  ring drains clockwise as the effect runs out and the remaining whole seconds
 *  are printed in the middle. */
function drawGrenadeTimer(
  x: number,
  y: number,
  remaining: number,
  span: number,
  kind: 'smoke' | 'fire',
) {
  if (!ctx) return
  const p = clamp(remaining / span, 0, 1)
  const radius = 11
  const color = kind === 'smoke' ? 'rgba(232, 236, 244, 0.95)' : 'rgba(255, 150, 60, 0.98)'
  ctx.save()
  ctx.lineCap = 'round'
  // track
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()
  // remaining time (drains clockwise from the top)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
  ctx.stroke()
  // remaining whole seconds in the middle
  ctx.fillStyle = color
  ctx.font = '700 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 3
  ctx.fillText(String(Math.max(0, Math.ceil(remaining))), x, y + 0.5)
  ctx.restore()
}

/** Darkened patch left where a molotov/incendiary burned or an HE detonated.
 *  It persists for the rest of the round (cleared when the round changes), so
 *  it marks the affected ground without fading out. Reuses the effect's seeded
 *  irregular outline so the mark matches the affected area. */
function drawScorch(
  ev: Extract<Round['events'][number], { type: 'grenade' }>,
) {
  if (!ctx) return
  const { x, y } = w2s(ev.x, ev.y)
  // HE blast covers a smaller area than fire
  const R = unitsToScreen(ev.kind === 'he' ? 90 : 150)
  const seed = ev.x * 0.013 + ev.y * 0.017
  const rand = (n: number) => {
    const v = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  ctx.save()
  ctx.globalAlpha = 0.5
  const verts = 30
  ctx.beginPath()
  for (let i = 0; i < verts; i++) {
    const ang = (i / verts) * Math.PI * 2
    const wob = 0.82 + 0.14 * rand(i + 101)
    const px = x + Math.cos(ang) * R * wob
    const py = y + Math.sin(ang) * R * wob
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  const grad = ctx.createRadialGradient(x, y, R * 0.1, x, y, R)
  grad.addColorStop(0, 'rgba(16, 11, 8, 0.9)')
  grad.addColorStop(1, 'rgba(28, 18, 12, 0.4)')
  ctx.fillStyle = grad
  ctx.fill()
  ctx.restore()
}

const PATH_COLOR: Record<string, string> = {
  smoke: 'rgba(206, 211, 222, 0.9)',
  fire: 'rgba(255, 120, 30, 0.9)',
  he: 'rgba(255, 90, 60, 0.9)',
  flash: 'rgba(255, 238, 170, 0.9)',
  decoy: 'rgba(140, 150, 165, 0.9)',
}

// Grenade kind -> weapon icon label (key into `weaponImgs`). 'fire' covers both
// molotov and incendiary; we use the molotov icon as the shared symbol.
const KIND_ICON: Record<string, string> = {
  smoke: 'Smoke',
  fire: 'Molotov',
  he: 'HE',
  flash: 'Flash',
  decoy: 'Decoy',
}

/** Arc of the grenade in flight, traced up to its position at instant t. */
function drawGrenadePath(path: Round['grenadePaths'][number], t: number) {
  if (!ctx) return
  const pts = path.points
  if (pts.length < 2) return
  const end = pts[pts.length - 1].t
  if (t < pts[0].t || t > end + 0.25) return

  // In top-down 2D the flight X/Y is nearly straight (the arc lives on the
  // invisible Z axis). We bow the line sideways with a sine shape (0 at the
  // ends, max in the middle) to suggest the arc. The shape is fixed for the
  // whole trajectory and revealed up to t.
  const screen = pts.map((p) => w2s(p.x, p.y))
  const a = screen[0]
  const b = screen[screen.length - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const amp = Math.min(len * 0.04, 14)
  const arc = screen.map((s, i) => {
    const bow = Math.sin((i / (screen.length - 1)) * Math.PI) * amp
    return { x: s.x + nx * bow, y: s.y + ny * bow, t: pts[i].t }
  })

  // points to draw: up to currentT, with the tip interpolated
  const draw: { x: number; y: number }[] = []
  for (let i = 0; i < arc.length; i++) {
    if (arc[i].t <= t) {
      draw.push(arc[i])
    } else {
      const prev = arc[i - 1]
      const f = (t - prev.t) / (arc[i].t - prev.t)
      draw.push({ x: prev.x + (arc[i].x - prev.x) * f, y: prev.y + (arc[i].y - prev.y) * f })
      break
    }
  }
  if (!draw.length) return

  ctx.save()
  ctx.strokeStyle = PATH_COLOR[path.kind] ?? 'rgba(220,224,232,0.9)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(draw[0].x, draw[0].y)
  // smooth by passing through midpoints (quadratics), keeping the curve continuous
  for (let i = 1; i < draw.length - 1; i++) {
    const mx = (draw[i].x + draw[i + 1].x) / 2
    const my = (draw[i].y + draw[i + 1].y) / 2
    ctx.quadraticCurveTo(draw[i].x, draw[i].y, mx, my)
  }
  ctx.lineTo(draw[draw.length - 1].x, draw[draw.length - 1].y)
  ctx.stroke()
  ctx.setLineDash([])

  // Tip of the arc: while the grenade is still airborne, draw its icon so the
  // viewer can tell which grenade it is; once it detonates the effect takes over.
  const head = draw[draw.length - 1]
  const img = weaponImgs.get(KIND_ICON[path.kind] ?? '')
  if (t <= end && img && img.complete && img.naturalWidth) {
    const boxH = clamp(unitsToScreen(34), 12, 20)
    const s = boxH / img.naturalHeight
    const iw = img.naturalWidth * s
    const ih = boxH
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(7, 8, 12, 0.6)'
    ctx.beginPath()
    ctx.roundRect(head.x - iw / 2 - 2, head.y - ih / 2 - 1.5, iw + 4, ih + 3, 2)
    ctx.fill()
    ctx.drawImage(img, head.x - iw / 2, head.y - ih / 2, iw, ih)
  } else {
    ctx.fillStyle = PATH_COLOR[path.kind] ?? '#dee2ea'
    ctx.beginPath()
    ctx.arc(head.x, head.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Draws the ENTIRE arc of a grenade (from throw to impact), ignoring the
 * current time. Used on grenades finder hover to preview the throw without
 * replaying the round. Highlights with a solid line and marks start/end.
 */
function drawGrenadePathPreview(path: GrenadePath, alpha = 1) {
  if (!ctx) return
  const pts = path.points
  if (pts.length < 2) return

  // Same sine bow as the normal drawing, but revealed in full.
  const screen = pts.map((p) => w2s(p.x, p.y))
  const a = screen[0]
  const b = screen[screen.length - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const amp = Math.min(len * 0.04, 14)
  const arc = screen.map((s, i) => {
    const bow = Math.sin((i / (screen.length - 1)) * Math.PI) * amp
    return { x: s.x + nx * bow, y: s.y + ny * bow }
  })

  const color = PATH_COLOR[path.kind] ?? 'rgba(220,224,232,0.95)'
  ctx.save()
  ctx.globalAlpha = alpha
  // Halo escuro por baixo, para destacar sobre qualquer fundo do radar.
  ctx.strokeStyle = 'rgba(8, 11, 18, 0.7)'
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(arc[0].x, arc[0].y)
  for (let i = 1; i < arc.length - 1; i++) {
    const mx = (arc[i].x + arc[i + 1].x) / 2
    const my = (arc[i].y + arc[i + 1].y) / 2
    ctx.quadraticCurveTo(arc[i].x, arc[i].y, mx, my)
  }
  ctx.lineTo(arc[arc.length - 1].x, arc[arc.length - 1].y)
  ctx.stroke()

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(arc[0].x, arc[0].y)
  for (let i = 1; i < arc.length - 1; i++) {
    const mx = (arc[i].x + arc[i + 1].x) / 2
    const my = (arc[i].y + arc[i + 1].y) / 2
    ctx.quadraticCurveTo(arc[i].x, arc[i].y, mx, my)
  }
  ctx.lineTo(arc[arc.length - 1].x, arc[arc.length - 1].y)
  ctx.stroke()

  // Throw marker (hollow ring) and impact marker (filled disc).
  const start = arc[0]
  const end = arc[arc.length - 1]
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(end.x, end.y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(start.x, start.y, 4, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawTracer(
  ev: Extract<Round['events'][number], { type: 'shot' }>,
  alpha: number,
) {
  if (!ctx) return
  const a = (ev.yaw * Math.PI) / 180
  const p1 = w2s(ev.x, ev.y)
  const p2 = w2s(ev.x + Math.cos(a) * SHOT_LEN, ev.y + Math.sin(a) * SHOT_LEN)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(255, 238, 170, 0.9)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.stroke()
  ctx.restore()
}

/** Blind level [0,1] of a player at t (decays from t to t+duration). */
function blindLevel(steamId: string, t: number) {
  let lvl = 0
  for (const b of props.round?.blinds ?? []) {
    if (b.steamId !== steamId || t < b.t || t > b.t + b.duration) continue
    lvl = Math.max(lvl, 1 - (t - b.t) / b.duration)
  }
  return lvl
}

/**
 * Dropped weapon/grenade icon on the ground: a small, dimmed icon (no label) so
 * it reads as loot without competing with the players. Hidden when the item is
 * on another floor (multi-level maps).
 */
function drawGroundWeapon(gw: Round['groundWeapons'][number], t: number) {
  if (!ctx) return
  if (t < gw.startT || t > gw.endT) return
  const lvl = props.levelRange
  if (lvl && (gw.z < lvl.minZ || gw.z >= lvl.maxZ)) return
  const img = weaponImgs.get(gw.label)
  if (!img || !img.complete || !img.naturalWidth) return
  const { x, y } = w2s(gw.x, gw.y)
  // Box scales gently with zoom but stays small (loot < player).
  const boxH = clamp(unitsToScreen(26), 6, 15)
  const boxW = boxH * 2
  const s = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight)
  const iw = img.naturalWidth * s
  const ih = img.naturalHeight * s
  ctx.save()
  ctx.globalAlpha = 0.7
  ctx.fillStyle = 'rgba(7,8,12,0.55)'
  ctx.beginPath()
  ctx.roundRect(x - iw / 2 - 2, y - ih / 2 - 1.5, iw + 4, ih + 3, 2)
  ctx.fill()
  ctx.drawImage(img, x - iw / 2, y - ih / 2, iw, ih)
  ctx.restore()
}

/** Active bomb keyframe at t (last one with t <= currentT). */
function bombAt(t: number) {
  const kfs = props.round?.bomb
  if (!kfs || !kfs.length) return null
  let cur: (typeof kfs)[number] | null = null
  for (const kf of kfs) {
    if (kf.t <= t) cur = kf
    else break
  }
  return cur
}

/** C4 icon on screen (on the ground, planted, or next to the carrier). */
function drawBombIcon(sx: number, sy: number, boxH: number, planted: boolean) {
  const img = weaponImgs.get('C4')
  if (!ctx || !img || !img.complete || !img.naturalWidth) return
  const s = boxH / img.naturalHeight
  const iw = img.naturalWidth * s
  const ih = boxH
  ctx.save()
  if (planted) {
    // Ring pulses to the C4 beep cadence (synced with the HUD LED).
    const on = props.bombBlink
    ctx.strokeStyle = '#ff4d5e'
    ctx.globalAlpha = on ? 1 : 0.4
    ctx.lineWidth = on ? 2.5 : 1.5
    ctx.shadowColor = '#ff4d5e'
    ctx.shadowBlur = on ? 8 : 0
    ctx.beginPath()
    ctx.arc(sx, sy, Math.max(iw, ih) / 2 + (on ? 5 : 4), 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
  }
  ctx.fillStyle = planted ? 'rgba(120,12,18,0.9)' : 'rgba(7,8,12,0.82)'
  ctx.beginPath()
  ctx.roundRect(sx - iw / 2 - 3, sy - ih / 2 - 2, iw + 6, ih + 4, 3)
  ctx.fill()
  ctx.drawImage(img, sx - iw / 2, sy - ih / 2, iw, ih)
  ctx.restore()
}

/** C4 detonation: a shockwave that expands to the lethal blast radius in under a
 *  second. A bright flash kicks it off, then an orange ring races outward (ease-out)
 *  while a hot core fades behind it. */
function drawBlast(wx: number, wy: number, startT: number, t: number) {
  if (!ctx) return
  const age = t - startT
  if (age < 0 || age > BLAST_TIME) return
  const { x, y } = w2s(wx, wy)
  const p = age / BLAST_TIME
  const ease = 1 - (1 - p) * (1 - p) // ease-out: fast then settling
  const maxR = unitsToScreen(props.calibration.blastRadius ?? DEFAULT_BLAST_RADIUS)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'

  // Initial flash: a quick white burst over the first ~25% of the effect.
  if (p < 0.25) {
    const fk = p / 0.25
    ctx.globalAlpha = (1 - fk) * 0.85
    const grad = ctx.createRadialGradient(x, y, 0, x, y, maxR * 0.6)
    grad.addColorStop(0, 'rgba(255, 250, 235, 1)')
    grad.addColorStop(1, 'rgba(255, 180, 80, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, maxR * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }

  // Hot core trailing behind the ring, fading as it spreads.
  ctx.globalAlpha = (1 - p) * 0.5
  const core = ctx.createRadialGradient(x, y, 0, x, y, maxR * ease)
  core.addColorStop(0, 'rgba(255, 140, 40, 0.7)')
  core.addColorStop(0.7, 'rgba(255, 90, 30, 0.25)')
  core.addColorStop(1, 'rgba(255, 70, 20, 0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(x, y, maxR * ease, 0, Math.PI * 2)
  ctx.fill()

  // Leading shockwave ring.
  ctx.globalAlpha = 1 - ease
  ctx.strokeStyle = '#ffcf6b'
  ctx.lineWidth = clamp((1 - p) * 4, 1, 4)
  ctx.beginPath()
  ctx.arc(x, y, maxR * ease, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Plant animation: a progress ring (0..1) around the planter circle (radius `r`
 *  follows the zoom). Drawn on top of the player. */
function drawPlanting(sx: number, sy: number, r: number, p: number) {
  if (!ctx) return
  const radius = r + 5
  ctx.save()
  ctx.lineCap = 'round'
  // track
  ctx.strokeStyle = 'rgba(255,77,94,0.25)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(sx, sy, radius, 0, Math.PI * 2)
  ctx.stroke()
  // progress (fills from the top, clockwise)
  ctx.strokeStyle = '#ff4d5e'
  ctx.lineWidth = 3
  ctx.shadowColor = '#ff4d5e'
  ctx.shadowBlur = 6
  ctx.beginPath()
  ctx.arc(sx, sy, radius, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Defuse progress ring (CT blue) around the defuser. */
function drawDefusing(sx: number, sy: number, r: number, p: number) {
  if (!ctx) return
  const radius = r + 5
  const color = SIDE_COLOR.CT
  ctx.save()
  ctx.lineCap = 'round'
  // trilho neutro
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(sx, sy, radius, 0, Math.PI * 2)
  ctx.stroke()
  // progress (fills from the top, clockwise)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  ctx.beginPath()
  ctx.arc(sx, sy, radius, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// label (box with opaque background, centered at cx/cy)
function drawLabel(text: string, cx: number, cy: number, fg: string, font: string, bh: number) {
  if (!ctx || !text) return
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText(text).width
  const padX = 4
  ctx.fillStyle = 'rgba(7,8,12,0.78)'
  ctx.beginPath()
  ctx.roundRect(cx - tw / 2 - padX, cy - bh / 2, tw + padX * 2, bh, 3)
  ctx.fill()
  ctx.fillStyle = fg
  ctx.fillText(text, cx, cy + 0.5)
}

/**
 * Talking indicator: a tiny mic (team color) tucked to the left of the name
 * label. `cx`/`cy`/`font`/`bh` mirror the name's `drawLabel` so the icon aligns
 * with the box edge.
 */
function drawVoiceMini(side: Side, name: string, cx: number, cy: number, font: string, bh: number) {
  if (!ctx || !name) return
  const img = micImgs[side]
  if (!img.complete || !img.naturalWidth) return
  ctx.save()
  ctx.font = font
  const tw = ctx.measureText(name).width
  const leftEdge = cx - tw / 2 - 4 // 4 = padX of the name box in drawLabel
  const s = bh * 0.85 // tiny, ~ name height
  ctx.drawImage(img, leftEdge - s - 1, cy - s / 2, s, s)
  ctx.restore()
}

/** Is the player on the active floor? Without multi-level, everyone counts. */
function onActiveLevel(p: PlayerState) {
  const lvl = props.levelRange
  return !lvl || (p.z >= lvl.minZ && p.z < lvl.maxZ)
}

function drawPlayer(p: PlayerState, death: { x: number; y: number } | undefined) {
  if (!ctx) return
  const color = SIDE_COLOR[p.side]
  const name = props.playersById.get(p.steamId)?.name ?? ''
  const r = playerRadius()

  // On two-floor maps, anyone on the other level becomes a discreet marker
  // (faded disc, no name/aim), to avoid cluttering the focused floor.
  if (!onActiveLevel(p)) {
    const pos = death && p.alive ? death : p
    const { x, y } = w2s(pos.x, pos.y)
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  // Name and weapon follow the (clamped) circle radius so they stay proportional
  // to the player at any zoom, without shrinking too much at high zoom.
  const lblScale = clamp(r / 16, 0.9, 2)

  // Dead: by frame state or by a kill that already happened (fixes the lag when
  // the death lands after the last sampled frame). If the frame does not yet
  // reflect the death, use the exact kill position.
  if (!p.alive || death) {
    const pos = death && p.alive ? death : p
    const { x, y } = w2s(pos.x, pos.y)
    ctx.save()
    ctx.globalAlpha = 0.5
    // dead: outline only (no fill), in the side color.
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    // X marking the death
    const s = r * 0.55
    ctx.beginPath()
    ctx.moveTo(x - s, y - s)
    ctx.lineTo(x + s, y + s)
    ctx.moveTo(x + s, y - s)
    ctx.lineTo(x - s, y + s)
    ctx.stroke()
    drawLabel(
      name,
      x,
      y - r - 9 * lblScale,
      color,
      `600 ${(10 * lblScale).toFixed(1)}px Inter, sans-serif`,
      14 * lblScale,
    )
    ctx.restore()
    // Dead but talking: keep the mic (full opacity) next to the name.
    if (props.talking?.has(p.steamId) && !props.muted?.[p.side]) {
      drawVoiceMini(
        p.side,
        name,
        x,
        y - r - 9 * lblScale,
        `600 ${(10 * lblScale).toFixed(1)}px Inter, sans-serif`,
        14 * lblScale,
      )
    }
    return
  }

  const { x, y } = w2s(p.x, p.y)
  const ang = (-p.yaw * Math.PI) / 180 // screen has Y inverted

  // direction caret: a tip pointing where the player looks. The base goes under
  // the circle, but we clip the disc interior (clip "outside the circle") so only
  // the tip shows. That way the base does not leak when the body is translucent
  // at low health (the health bar below is no longer an opaque disc).
  const caretH = r * 0.7
  const caretW = r * 0.55
  const perp = ang + Math.PI / 2
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, cw, ch)
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip('evenodd')
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + Math.cos(ang) * (r + caretH), y + Math.sin(ang) * (r + caretH))
  ctx.lineTo(
    x + Math.cos(ang) * r * 0.5 + Math.cos(perp) * caretW,
    y + Math.sin(ang) * r * 0.5 + Math.sin(perp) * caretW,
  )
  ctx.lineTo(
    x + Math.cos(ang) * r * 0.5 - Math.cos(perp) * caretW,
    y + Math.sin(ang) * r * 0.5 - Math.sin(perp) * caretW,
  )
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // body as a health bar: the fill rises from bottom to top with HP (100 = full,
  // 0 = empty). The dimmed base keeps the silhouette and the team color readable
  // even at low health.
  const hp = clamp(p.health / 100, 0, 1)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha = 0.25
  ctx.fillStyle = color
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  ctx.globalAlpha = 1
  const fillH = r * 2 * hp
  if (fillH > 0) ctx.fillRect(x - r, y + r - fillH, r * 2, fillH)
  ctx.restore()
  // outline
  ctx.lineWidth = 2
  ctx.strokeStyle = '#07080c'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()

  // blindness: white over the body, opacity = flash level
  const blind = blindLevel(p.steamId, props.currentT)
  if (blind > 0) {
    ctx.save()
    ctx.globalAlpha = blind
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // name above the circle, in the side color; equipment (icon) above the name.
  const nameBh = 15 * lblScale
  const nameY = y - r - caretH - nameBh / 2 - 2
  drawLabel(name, x, nameY, color, `600 ${(11 * lblScale).toFixed(1)}px Inter, sans-serif`, nameBh)

  // normalized weapon icon: fit into a box (contain), so wide rifles and narrow
  // grenades end up at a comparable visual size. The box follows the player
  // radius (lblScale) to keep proportion at any zoom.
  const img = weaponImgs.get(p.weapon)
  if (img && img.complete && img.naturalWidth) {
    const boxW = 24 * lblScale
    const boxH = 13 * lblScale
    const s = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight)
    const iw = img.naturalWidth * s
    const ih = img.naturalHeight * s
    const padX = 5 * lblScale
    const padY = 3 * lblScale
    const cy = nameY - 8 * lblScale - (ih + padY * 2) / 2
    ctx.fillStyle = 'rgba(7,8,12,0.78)'
    ctx.beginPath()
    ctx.roundRect(x - iw / 2 - padX, cy - ih / 2 - padY, iw + padX * 2, ih + padY * 2, 3)
    ctx.fill()
    ctx.drawImage(img, x - iw / 2, cy - ih / 2, iw, ih)
  } else if (p.weapon) {
    drawLabel(
      p.weapon,
      x,
      nameY - 14 * lblScale,
      'rgba(222,226,234,0.92)',
      `600 ${(9 * lblScale).toFixed(1)}px Inter, sans-serif`,
      13 * lblScale,
    )
  }

  // tiny mic next to the name when the player is talking
  if (props.talking?.has(p.steamId) && !props.muted?.[p.side]) {
    drawVoiceMini(
      p.side,
      name,
      x,
      nameY,
      `600 ${(11 * lblScale).toFixed(1)}px Inter, sans-serif`,
      nameBh,
    )
  }
}

function draw() {
  if (!ctx) return
  ctx.clearRect(0, 0, cw, ch)
  // radar
  if (radarReady) {
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(radar, panX, panY, L * zoom.value, L * zoom.value)
  }
  const t = props.currentT

  // At the end of the round we treat all kills as already happened: the deciding
  // one usually lands right after the last sampled frame.
  const frames = props.round?.frames
  const lastT = frames && frames.length ? frames[frames.length - 1].t : 0
  const atRoundEnd = t >= lastT - 1e-3
  const killCutoff = atRoundEnd ? Infinity : t

  // Death position per player (events already happened), to erase the player at
  // the right spot even when the frame still shows them alive.
  const deaths = new Map<string, { x: number; y: number }>()
  for (const ev of props.round?.events ?? []) {
    if (ev.type === 'kill' && ev.t <= killCutoff) deaths.set(ev.victimSteamId, { x: ev.x, y: ev.y })
  }

  // arcs of grenades in flight (under the detonations)
  for (const path of props.round?.grenadePaths ?? []) drawGrenadePath(path, t)
  for (const ev of props.round?.events ?? []) {
    if (ev.type !== 'grenade') continue
    if (t >= ev.t && t <= ev.endT) drawGrenade(ev, t)
    // burnt mark left after a molotov/incendiary burns out or an HE detonates;
    // stays for the rest of the round (the round change clears it)
    else if ((ev.kind === 'fire' || ev.kind === 'he') && t > ev.endT) drawScorch(ev)
  }
  // C4 on the ground / planted (under the players). During the ~3.2s of the plant
  // we do not draw the icon here: the progress ring goes over the planter (below).
  const bomb = bombAt(t)
  const plantedKf = props.round?.bomb.find((k) => k.state === 'planted')
  const planting =
    !!plantedKf && plantedKf.x != null && t >= plantedKf.t - PLANT_TIME && t < plantedKf.t
  if (!planting && bomb && (bomb.state === 'ground' || bomb.state === 'planted')) {
    const { x, y } = w2s(bomb.x ?? 0, bomb.y ?? 0)
    drawBombIcon(x, y, bomb.state === 'planted' ? 11 : 14, bomb.state === 'planted')
  }
  // Dropped weapons/grenades on the floor (under the players).
  for (const gw of props.round?.groundWeapons ?? []) drawGroundWeapon(gw, t)
  for (const ev of props.round?.events ?? []) {
    if (ev.type !== 'kill') continue
    let age = t - ev.t
    if (atRoundEnd && age < 0) age = 0 // shows the final kill X during the hold
    if (age < 0 || age > KILL_FADE) continue
    const { x, y } = w2s(ev.x, ev.y)
    drawKill(x, y, 1 - age / KILL_FADE)
  }
  for (const ev of props.round?.events ?? []) {
    if (ev.type !== 'shot') continue
    const age = t - ev.t
    if (age < 0 || age > SHOT_FADE) continue
    drawTracer(ev, 1 - age / SHOT_FADE)
  }
  // dead first, alive on top
  for (const p of props.players) if (!p.alive || deaths.has(p.steamId)) drawPlayer(p, deaths.get(p.steamId))
  for (const p of props.players) if (p.alive && !deaths.has(p.steamId)) drawPlayer(p, undefined)

  // C4 detonation shockwave (on top of players, at the plant position).
  const blastEv = props.round?.events.find((e) => e.type === 'bomb_exploded')
  if (blastEv) {
    const pk = props.round?.bomb.find((k) => k.state === 'planted')
    if (pk && pk.x != null) drawBlast(pk.x, pk.y ?? 0, blastEv.t, t)
  }

  // Plant in progress: progress ring around the planter (on top of everything,
  // so it stays visible at any zoom). Falls back to the plant position if the
  // planter is not among the alive players.
  if (planting && plantedKf) {
    const plantEv = props.round?.events.find((e) => e.type === 'bomb_planted')
    const planterId = plantEv && 'playerSteamId' in plantEv ? plantEv.playerSteamId : undefined
    const planter = planterId
      ? props.players.find((p) => p.steamId === planterId && p.alive && !deaths.has(p.steamId))
      : undefined
    const prog = (t - (plantedKf.t - PLANT_TIME)) / PLANT_TIME
    if (planter) {
      const { x, y } = w2s(planter.x, planter.y)
      drawPlanting(x, y, playerRadius(), prog)
    } else {
      const { x, y } = w2s(plantedKf.x ?? 0, plantedKf.y ?? 0)
      drawPlanting(x, y, playerRadius(), prog)
    }
  } else if (bomb && bomb.state === 'carried') {
    // C4 carried: marker next to the carrier (alive)
    const carrier = props.players.find(
      (p) => p.steamId === bomb.carrierSteamId && p.alive && !deaths.has(p.steamId),
    )
    if (carrier) {
      const r = playerRadius()
      const { x, y } = w2s(carrier.x, carrier.y)
      drawBombIcon(x + r + 7, y, 11, false)
    }
  }

  // Defuse in progress: progress ring (CT blue) on the defuser. Fills over
  // hasKit ? 5 : 10 s; if interrupted, it stops and vanishes at endT (unfinished).
  const def = (props.round?.defuses ?? []).find((d) => t >= d.startT && t < d.endT)
  if (def) {
    const prog = clamp((t - def.startT) / (def.hasKit ? 5 : 10), 0, 1)
    const defuser = def.steamId
      ? props.players.find((p) => p.steamId === def.steamId && p.alive && !deaths.has(p.steamId))
      : undefined
    if (defuser) {
      const { x, y } = w2s(defuser.x, defuser.y)
      drawDefusing(x, y, playerRadius(), prog)
    } else {
      const pk = props.round?.bomb.find((k) => k.state === 'planted')
      if (pk && pk.x != null) {
        const { x, y } = w2s(pk.x, pk.y ?? 0)
        drawDefusing(x, y, playerRadius(), prog)
      }
    }
  }

  // Grenades preview, on top of everything. With a hovered arc, only that one
  // shows (full); otherwise the whole filtered set is drawn together, slightly
  // dimmed so the overlap stays readable.
  if (props.previewPath) {
    drawGrenadePathPreview(props.previewPath)
  } else if (props.previewPaths?.length) {
    const alpha = props.previewPaths.length > 1 ? 0.55 : 1
    for (const path of props.previewPaths) drawGrenadePathPreview(path, alpha)
  }
}

// --- auto zoom: frames all players, easing in/out ---
const AUTO_PAD = 0.22 // padding (fraction of the screen) around the players bbox
const AUTO_EASE = 0.1 // smoothing per frame (higher is faster)
const AUTO_MIN_SPAN = 0.045 // min bbox (fraction) to avoid blowing up the zoom on a cluster
const AUTO_ZOOM_MAX = 2.4 // zoom-in cap: does not get too close to the players

/** Alvo de zoom/pan que enquadra os jogadores vivos (fallback: todos). */
function autoTarget(): { zoom: number; panX: number; panY: number } | null {
  let pts = props.players.filter((p) => p.alive)
  if (!pts.length) pts = props.players // round ended: use the last positions
  if (!pts.length || L === 0) return null

  let fxMin = Infinity
  let fxMax = -Infinity
  let fyMin = Infinity
  let fyMax = -Infinity
  for (const p of pts) {
    const { fx, fy } = worldToFraction(props.calibration, p.x, p.y)
    fxMin = Math.min(fxMin, fx)
    fxMax = Math.max(fxMax, fx)
    fyMin = Math.min(fyMin, fy)
    fyMax = Math.max(fyMax, fy)
  }
  const cfx = (fxMin + fxMax) / 2
  const cfy = (fyMin + fyMax) / 2
  const dfx = Math.max(fxMax - fxMin, AUTO_MIN_SPAN)
  const dfy = Math.max(fyMax - fyMin, AUTO_MIN_SPAN)
  const availW = cw * (1 - AUTO_PAD * 2)
  const availH = ch * (1 - AUTO_PAD * 2)
  const z = clamp(Math.min(availW / (dfx * L), availH / (dfy * L)), 0.5, AUTO_ZOOM_MAX)
  return { zoom: z, panX: cw / 2 - cfx * L * z, panY: ch / 2 - cfy * L * z }
}

let autoRaf = 0
function autoStep() {
  const tgt = autoTarget()
  if (tgt) {
    zoom.value += (tgt.zoom - zoom.value) * AUTO_EASE
    panX += (tgt.panX - panX) * AUTO_EASE
    panY += (tgt.panY - panY) * AUTO_EASE
  }
  draw()
  autoRaf = requestAnimationFrame(autoStep)
}
function stopAuto() {
  cancelAnimationFrame(autoRaf)
  autoRaf = 0
}
watch(
  () => props.autoZoom,
  (on) => {
    if (on && !autoRaf) autoRaf = requestAnimationFrame(autoStep)
    else if (!on) stopAuto()
  },
)

// --- manual interaction: wheel zoom, drag pan (inactive in auto zoom) ---
function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (props.autoZoom) return
  const rect = canvas.value!.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const next = clamp(zoom.value * factor, 0.5, 8)
  const real = next / zoom.value
  panX = mx - (mx - panX) * real
  panY = my - (my - panY) * real
  zoom.value = next
  draw()
}

let dragging = false
let lastX = 0
let lastY = 0
function onPointerDown(e: PointerEvent) {
  // Only the left button pans; the right one is free for the context menu.
  if (e.button !== 0 || props.autoZoom) return
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
  canvas.value?.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  panX += e.clientX - lastX
  panY += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  draw()
}
function onPointerUp(e: PointerEvent) {
  dragging = false
  canvas.value?.releasePointerCapture(e.pointerId)
}

function zoomBy(factor: number) {
  const cx = cw / 2
  const cy = ch / 2
  const next = clamp(zoom.value * factor, 0.5, 8)
  const real = next / zoom.value
  panX = cx - (cx - panX) * real
  panY = cy - (cy - panY) * real
  zoom.value = next
  draw()
}
function reset() {
  zoom.value = 1
  fit()
  draw()
}

// Radar source: the active floor (multi-level maps) or the calibration radar.
const radarSource = () => props.radarSrc ?? props.calibration.radar

watch(() => props.players, draw)
watch(() => props.bombBlink, draw)
watch(() => props.previewPath, draw)
watch(() => props.previewPaths, draw)
watch(() => props.levelRange, draw, { deep: true })
watch(() => props.talking, draw)
watch(() => props.muted, draw, { deep: true })
watch(radarSource, (src) => {
  radarReady = false
  radar.src = src
})

onMounted(() => {
  radar.onload = () => {
    radarReady = true
    draw()
  }
  radar.src = radarSource()
  ro = new ResizeObserver(resize)
  if (wrap.value) ro.observe(wrap.value)
  resize()
})
onUnmounted(() => {
  ro?.disconnect()
  stopAuto()
})
</script>

<template>
  <div ref="wrap" class="absolute inset-0 overflow-hidden bg-ink-950">
    <canvas
      ref="canvas"
      class="h-full w-full touch-none"
      :class="autoZoom ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />

    <!-- Zoom controls (hidden in auto zoom and in the preview) -->
    <div
      v-if="controls !== false && !autoZoom"
      class="pointer-events-auto absolute bottom-4 right-4 flex flex-col gap-1"
    >
      <button
        v-tooltip="tr('viewer.zoomIn')"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-850/90 text-lg text-ink-100 backdrop-blur transition-colors hover:bg-ink-700"
        @click="zoomBy(1.3)"
      >
        +
      </button>
      <button
        v-tooltip="tr('viewer.zoomOut')"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-850/90 text-lg text-ink-100 backdrop-blur transition-colors hover:bg-ink-700"
        @click="zoomBy(1 / 1.3)"
      >
        −
      </button>
      <button
        v-tooltip="tr('viewer.zoomReset')"
        class="mt-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-850/90 font-mono text-xs text-ink-100 backdrop-blur transition-colors hover:bg-ink-700"
        @click="reset"
      >
        {{ Math.round(zoom * 100) }}
      </button>
    </div>
  </div>
</template>
