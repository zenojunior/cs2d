<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { CommentAnchor, CommentKind, GrenadePath, PlayerMeta, PlayerState, ReplayComment, Round, Side } from '@/viewer/domain/schema'
import { worldToFraction, worldFromFraction, DEFAULT_BLAST_RADIUS, type MapCalibration } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { commentPositionAt, isCommentActive } from '@/viewer/comments/commentAnchor'
import { commentKindMeta } from '@/viewer/comments/commentKinds'
import {
  COACH_DEFAULT_COLOR,
  COACH_DEFAULT_THICKNESS,
  isShapeTool,
  type CoachDrawing,
  type CoachGrenade,
  type CoachShapeTool,
  type CoachTool,
} from '@/viewer/player/coachTools'
import type { GrenadeKind } from '@/viewer/domain/schema'
import { createGrenadeEffects, paintSimpleSmoke, paintSimpleFire } from '@/viewer/player/grenadeEffects'
import { clamp, drawKill, roundRect, wrapText } from '@/viewer/player/canvasUtils'
import { useViewerAssets } from '@/viewer/player/useViewerAssets'
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
  /** Performance mode: draw smoke/fire as flat circles (no gradients/blur). */
  lowQualityEffects?: boolean
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
  /** Comments anchored to the current round (pins drawn on the map). */
  comments?: ReplayComment[]
  /** Comment mode: a click on the map drops a new comment pin. */
  commentMode?: boolean
  /** Currently selected/edited comment (highlighted). */
  activeCommentId?: string | null
  /** An area rectangle being created (world coords), kept visible while its
   *  popover is open so the selection never disappears. */
  pendingArea?: { x: number; y: number; x2: number; y2: number; kind?: CommentKind } | null
  /** Anchor of the open popover (world coords + kind), to keep it pinned as the
   *  view or the anchored player moves. */
  popoverAnchor?: { anchor: CommentAnchor; wx: number; wy: number } | null
  /** Coach mode: the tactical board. A drag with a shape tool marks the map up. */
  coachMode?: boolean
  /** Active drawing tool. `select` falls back to pan/zoom. */
  coachTool?: CoachTool
  /** Stroke color for new drawings. */
  coachColor?: string
  /** Stroke width (world-unit px at 1x zoom) for new drawings. */
  coachThickness?: number
  /** Committed drawings for the round in view (rendered as a board overlay). */
  coachDrawings?: CoachDrawing[]
  /** Per-player pose overrides (steamId -> world coords + facing yaw) from dragging. */
  playerOverrides?: Record<string, { x: number; y: number; yaw: number }>
  /** Grenades placed on the round's board. */
  coachGrenades?: CoachGrenade[]
  /** Grenade kind the grenade tool places. */
  coachGrenadeKind?: GrenadeKind
}>()

const emit = defineEmits<{
  /** A click in comment mode: world anchor + detected target + the reference rect in
   *  viewport coords (vx,vy = top-left, vw,vh = size; a point is 0x0) the popover
   *  anchors to, so an area opens above its top and flips below its bottom. */
  dropComment: [{ x: number; y: number; anchor: CommentAnchor; vx: number; vy: number; vw: number; vh: number }]
  /** A click on an existing comment: its id + reference rect in viewport coords. */
  selectComment: [{ id: string; vx: number; vy: number; vw: number; vh: number }]
  /** Right-click target: the comment under the cursor (with its reference rect) or
   *  null, so the stage shows comment actions in the context menu (both modes). */
  contextComment: [{ id: string; vx: number; vy: number; vw: number; vh: number } | null]
  /** An area comment was resized: its new opposite corners in world coords. */
  resizeArea: [{ id: string; x: number; y: number; x2: number; y2: number }]
  /** Right-click target for a new comment (a player) or null, so the stage can
   *  offer "add a comment" in the context menu. */
  contextTarget: [
    { x: number; y: number; z: number; yaw: number; anchor: CommentAnchor; vx: number; vy: number } | null,
  ]
  /** The open popover's anchor moved on screen (view/player change): its new rect. */
  popoverMoved: [{ vx: number; vy: number; vw: number; vh: number }]
  /** A coach drawing was completed: tool + world points + stroke style + floor Z. */
  addDrawing: [{ tool: CoachShapeTool; points: { x: number; y: number }[]; color: string; thickness: number; z?: number }]
  /** A player was moved or rotated on the board (world coords + facing yaw). */
  setPlayerPose: [{ steamId: string; x: number; y: number; yaw: number }]
  /** A grenade was placed on the board (world coords + floor Z). */
  addGrenade: [{ kind: GrenadeKind; x: number; y: number; z?: number }]
  /** A placed grenade was dragged to a new spot (world coords). */
  moveGrenade: [{ id: string; x: number; y: number }]
  /** A placed grenade was removed (right-clicked) from the board. */
  removeGrenade: [{ id: string }]
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

// Mic/weapon/comment icon assets, preloaded; redraw as each image loads.
const { micImgs, weaponImgs, kindIconPaths } = useViewerAssets(() => draw())

// Smoke/fire/scorch rendering + its offscreen sprite cache (see grenadeEffects).
const effects = createGrenadeEffects()

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
// --- screen -> world (inverse of w2s): turns a click into a map anchor ---
function s2w(sx: number, sy: number) {
  const fx = (sx - panX) / (L * zoom.value)
  const fy = (sy - panY) / (L * zoom.value)
  return worldFromFraction(props.calibration, fx, fy)
}

// Dot radius sized in game units (~hitbox), so it grows with the map on zoom
// ("real" size). The clamp only keeps it from disappearing / blowing up.
const PLAYER_RADIUS_UNITS = 34
function playerRadius() {
  return clamp(unitsToScreen(PLAYER_RADIUS_UNITS), 7, 62)
}

/** Coach-board pose of a player: the live drag preview, a committed override, or
 *  null (use the replay pose). Only applies in coach mode. */
function coachPosOf(p: PlayerState): { x: number; y: number; yaw: number } | null {
  if (!props.coachMode) return null
  if (playerDrag && playerDrag.steamId === p.steamId) {
    return { x: playerDrag.x, y: playerDrag.y, yaw: playerDrag.yaw }
  }
  return props.playerOverrides?.[p.steamId] ?? null
}

/** Resolved pose of a player (override-aware), falling back to the replay pose. */
function playerPose(p: PlayerState): { x: number; y: number; yaw: number } {
  return coachPosOf(p) ?? { x: p.x, y: p.y, yaw: p.yaw }
}

/** Effect radius (screen px) of a smoke/fire grenade, for rendering and hit-test. */
function smokeRadius() {
  return unitsToScreen(144)
}
function fireRadius() {
  return unitsToScreen(150)
}

function drawGrenade(
  ev: Extract<Round['events'][number], { type: 'grenade' }>,
  t: number,
) {
  if (!ctx) return
  // Multi-floor maps: only the floor where the grenade went off (effect + timer).
  if (!zOnActiveLevel(ev.z)) return
  const { x, y } = w2s(ev.x, ev.y)
  const span = Math.max(0.001, ev.endT - ev.t)
  const k = clamp((t - ev.t) / span, 0, 1)
  ctx.save()
  if (ev.kind === 'smoke') {
    if (props.lowQualityEffects) paintSimpleSmoke(ctx, x, y, smokeRadius())
    else effects.paintSmoke(ctx, x, y, smokeRadius(), t, ev.x * 0.011 + ev.y * 0.015)
  } else if (ev.kind === 'fire') {
    if (props.lowQualityEffects) paintSimpleFire(ctx, x, y, fireRadius())
    else effects.paintFire(ctx, x, y, fireRadius(), t, ev.x * 0.013 + ev.y * 0.017)
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
  if (!zOnActiveLevel(ev.z)) return
  const { x, y } = w2s(ev.x, ev.y)
  // HE blast covers a smaller area than fire
  const R = unitsToScreen(ev.kind === 'he' ? 90 : 150)
  effects.paintScorch(ctx, x, y, R, ev.x * 0.013 + ev.y * 0.017)
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

/** Is a world Z on the active floor? Visible by default when there is no
 *  multi-level map or the Z is unknown (e.g. the C4 before z was emitted). */
function zOnActiveLevel(z: number | null | undefined) {
  const lvl = props.levelRange
  return !lvl || z == null || (z >= lvl.minZ && z < lvl.maxZ)
}

/** Representative Z of the active floor, stamped on new board objects so they
 *  belong to the floor they were drawn on. Undefined on single-level maps.
 *  Floor ranges are often half-unbounded (e.g. Nuke's upper floor is
 *  [-575, Infinity)), so the midpoint would be Infinity and fail the range test;
 *  fall back to a finite value just inside whichever edge is bounded. */
function activeLevelZ(): number | undefined {
  const lvl = props.levelRange
  if (!lvl) return undefined
  const { minZ, maxZ } = lvl
  if (Number.isFinite(minZ) && Number.isFinite(maxZ)) return (minZ + maxZ) / 2
  if (Number.isFinite(minZ)) return minZ + 1
  if (Number.isFinite(maxZ)) return maxZ - 1
  return 0
}

/** Detonation Z of a flight path (its points carry none): the nearest grenade
 *  event of the same kind in the round. Null when there is no match, which the
 *  level filter then treats as visible. */
function grenadePathZ(path: Round['grenadePaths'][number]): number | null {
  const evs = props.round?.events
  const last = path.points[path.points.length - 1]
  if (!evs || !last) return null
  let best: number | null = null
  let bestDist = Infinity
  for (const e of evs) {
    if (e.type !== 'grenade' || e.kind !== path.kind) continue
    const d = Math.hypot(e.x - last.x, e.y - last.y)
    if (d < bestDist) {
      bestDist = d
      best = e.z
    }
  }
  return best
}

function drawPlayer(p: PlayerState, death: { x: number; y: number } | undefined) {
  if (!ctx) return
  const color = SIDE_COLOR[p.side]
  const name = props.playersById.get(p.steamId)?.name ?? ''
  const r = playerRadius()
  // Coach board: a dragged/overridden player draws at its board position.
  const ov = coachPosOf(p)
  const base = ov ?? p

  // On two-floor maps, anyone on the other level becomes a discreet marker
  // (faded disc, no name/aim), to avoid cluttering the focused floor.
  if (!onActiveLevel(p)) {
    const pos = death && p.alive ? death : base
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
    const pos = death && p.alive ? death : base
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

  const { x, y } = w2s(base.x, base.y)
  const ang = (-base.yaw * Math.PI) / 180 // screen has Y inverted

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

// --- comments -----------------------------------------------------------------
/** Rounded-rect path helper (starts a fresh path). */
// Cache of Path2D per comment kind, for drawing the kind icon on the bubble.
/**
 * Draws a comment text bubble around an anchor `box`: a small white rounded card
 * with dark text, a soft shadow, the kind icon on the left, and a stem pointing
 * into the box (a point/player uses a tiny box; an area uses its rectangle, so the
 * card sits outside and the arrow dips inside). The text is capped so the card
 * never gets large. It tries four placements (below/above/right/left) and picks
 * the one that overlaps the fewest players and best stays on screen.
 */
function drawCommentBubble(
  box: { cx: number; cy: number; halfW: number; halfH: number; inset: number },
  text: string,
  kind: CommentKind | undefined,
  obstacles: { x: number; y: number; r: number }[],
): { x: number; y: number; w: number; h: number } | null {
  if (!ctx) return null
  const PAD = 8
  const MAXW = 180
  const lineH = 15
  const STEM = 8
  const ICON = 15
  const IGAP = 6
  ctx.save()
  ctx.font = '500 12.5px Inter, sans-serif'
  const lines = wrapText(ctx, text, MAXW, 3)
  let textW = 0
  for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width)
  const w = ICON + IGAP + Math.min(MAXW, textW) + PAD * 2
  const h = PAD * 2 + lines.length * lineH
  const { cx, cy, halfW, halfH, inset } = box

  // Candidates: the card sits just OUTSIDE the anchor box on each side, the stem
  // starts at the card edge and the tip dips `inset` INSIDE the box (so for an
  // area the arrow points into the rectangle). Preference order: below/above/R/L.
  type Cand = { rx: number; ry: number; tipX: number; tipY: number; bx: number; by: number; horiz: boolean }
  const cands: Cand[] = [
    { rx: cx - w / 2, ry: cy + halfH + STEM, tipX: cx, tipY: cy + halfH - inset, bx: cx, by: cy + halfH + STEM, horiz: false },
    { rx: cx - w / 2, ry: cy - halfH - STEM - h, tipX: cx, tipY: cy - halfH + inset, bx: cx, by: cy - halfH - STEM, horiz: false },
    { rx: cx + halfW + STEM, ry: cy - h / 2, tipX: cx + halfW - inset, tipY: cy, bx: cx + halfW + STEM, by: cy, horiz: true },
    { rx: cx - halfW - STEM - w, ry: cy - h / 2, tipX: cx - halfW + inset, tipY: cy, bx: cx - halfW - STEM, by: cy, horiz: true },
  ]
  const costOf = (c: Cand) => {
    let cost = 0
    // overlap with player circles (closest point on the card to each center)
    for (const o of obstacles) {
      const px = clamp(o.x, c.rx, c.rx + w)
      const py = clamp(o.y, c.ry, c.ry + h)
      const d = Math.hypot(o.x - px, o.y - py)
      if (d < o.r) cost += o.r - d + 6
    }
    // staying on screen
    cost += Math.max(0, 4 - c.rx) + Math.max(0, c.rx + w - (cw - 4))
    cost += Math.max(0, 4 - c.ry) + Math.max(0, c.ry + h - (ch - 4))
    return cost
  }
  let best = cands[0]
  let bestCost = costOf(cands[0])
  for (let i = 1; i < cands.length; i++) {
    const cost = costOf(cands[i])
    if (cost < bestCost - 0.5) {
      best = cands[i]
      bestCost = cost
    }
  }

  // soft shadow so the white card stands out over the radar
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  // stem: a small triangle from the card edge to the tip near the anchor
  ctx.beginPath()
  if (best.horiz) {
    ctx.moveTo(best.bx, best.by - 5)
    ctx.lineTo(best.bx, best.by + 5)
  } else {
    ctx.moveTo(best.bx - 5, best.by)
    ctx.lineTo(best.bx + 5, best.by)
  }
  ctx.lineTo(best.tipX, best.tipY)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  // card
  roundRect(ctx, best.rx, best.ry, w, h, 8)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  // colored marker (the kind color) on the anchor tip
  const meta = commentKindMeta(kind)
  ctx.beginPath()
  ctx.arc(best.tipX, best.tipY, 5, 0, Math.PI * 2)
  ctx.fillStyle = meta.color
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
  ctx.stroke()
  // kind icon, left side, vertically centered
  ctx.save()
  ctx.translate(best.rx + PAD, best.ry + (h - ICON) / 2)
  ctx.scale(ICON / 24, ICON / 24)
  ctx.strokeStyle = meta.color
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const p of kindIconPaths(kind)) ctx.stroke(p)
  ctx.restore()
  // text: dark, shifted right of the icon
  ctx.fillStyle = '#16181f'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = '500 12.5px Inter, sans-serif'
  const textX = best.rx + PAD + ICON + IGAP
  let ty = best.ry + PAD
  for (const l of lines) {
    ctx.fillText(l, textX, ty)
    ty += lineH
  }
  ctx.restore()
  return { x: best.rx, y: best.ry, w, h }
}

/** Draws a dashed rectangle for an area comment (or the live area drag), tinted by
 *  the kind color. `highlighted` thickens the border and deepens the fill. */
function drawAreaRect(
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  color: string,
  highlighted: boolean,
) {
  if (!ctx) return
  const x = Math.min(sx1, sx2)
  const y = Math.min(sy1, sy2)
  const w = Math.abs(sx2 - sx1)
  const h = Math.abs(sy2 - sy1)
  ctx.save()
  ctx.globalAlpha = highlighted ? 0.22 : 0.13
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 1
  ctx.lineWidth = highlighted ? 2.5 : 1.5
  ctx.strokeStyle = color
  ctx.setLineDash([5, 4])
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

// --- coach mode: tactical-board shapes -------------------------------------
// Strokes are solid (comments use dashes) and scale with zoom so a drawing stays
// pinned to the map. Points come in screen coords (already world->screen mapped).

/** Draws a coach shape from screen-space points. Two-point tools read [a, b];
 *  freehand `path` reads every point. */
function paintCoach(
  tool: CoachShapeTool,
  pts: { x: number; y: number }[],
  color: string,
  thickness: number,
) {
  if (!ctx || pts.length < 2) return
  const lw = Math.max(0.75, thickness * zoom.value)
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 3
  const a = pts[0]
  const b = pts[pts.length - 1]
  if (tool === 'rectangle') {
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  } else if (tool === 'circle') {
    ctx.beginPath()
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (tool === 'arrow') {
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const head = Math.max(10, lw * 3.2)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6))
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6))
    ctx.stroke()
  } else if (tool === 'path') {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  }
  ctx.restore()
}

/** Draws a committed coach drawing, mapping its world points to the screen.
 *  Skipped when it belongs to another floor (multi-level maps). */
function drawCoachDrawing(d: CoachDrawing) {
  if (!zOnActiveLevel(d.z)) return
  paintCoach(d.tool, d.points.map((p) => w2s(p.x, p.y)), d.color, d.thickness)
}

/** Draws a placed board grenade. Smoke and fire render as their full detonation
 *  effect (so the board matches what happens in-game); he/flash/decoy are point
 *  grenades shown as a ringed disc with the kind icon. Follows the live drag. */
function drawCoachGrenade(g: CoachGrenade) {
  if (!ctx || !zOnActiveLevel(g.z)) return
  const pos = grenadeDrag && grenadeDrag.id === g.id ? grenadeDrag : g
  const { x, y } = w2s(pos.x, pos.y)
  const t = props.currentT
  if (g.kind === 'smoke') {
    if (props.lowQualityEffects) paintSimpleSmoke(ctx, x, y, smokeRadius())
    else effects.paintSmoke(ctx, x, y, smokeRadius(), t, pos.x * 0.011 + pos.y * 0.015)
    return
  }
  if (g.kind === 'fire') {
    if (props.lowQualityEffects) paintSimpleFire(ctx, x, y, fireRadius())
    else effects.paintFire(ctx, x, y, fireRadius(), t, pos.x * 0.013 + pos.y * 0.017)
    return
  }
  const r = clamp(playerRadius() * 0.7, 9, 26)
  const color = PATH_COLOR[g.kind] ?? 'rgba(220, 224, 232, 0.9)'
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(8, 11, 18, 0.78)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.stroke()
  const img = weaponImgs.get(KIND_ICON[g.kind])
  if (img && img.complete && img.naturalWidth) {
    const s = r * 1.15
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s)
  }
  ctx.restore()
}

/** Draws a comment's text + kind icon as a label hugging the rectangle's top edge
 *  (or below it, if there's no room above), for area comments during playback. */
function drawAreaLabel(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  text: string,
  kind: CommentKind | undefined,
): { x: number; y: number; w: number; h: number } | null {
  if (!ctx) return null
  const PAD = 6
  const ICON = 14
  const IGAP = 5
  const lineH = 14
  ctx.save()
  ctx.font = '600 12px Inter, sans-serif'
  const lines = wrapText(ctx, text, 200, 2)
  let textW = 0
  for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width)
  const w = ICON + IGAP + textW + PAD * 2
  const h = PAD * 2 + lines.length * lineH
  const lx = clamp(rx + rw / 2 - w / 2, 4, Math.max(4, cw - w - 4))
  let ly = ry - h - 4
  if (ly < 4) ly = Math.min(ry + rh + 4, ch - h - 4)
  // background strip
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 1
  roundRect(ctx, lx, ly, w, h, 6)
  ctx.fillStyle = 'rgba(17, 18, 26, 0.92)'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  // kind icon
  const meta = commentKindMeta(kind)
  ctx.save()
  ctx.translate(lx + PAD, ly + (h - ICON) / 2)
  ctx.scale(ICON / 24, ICON / 24)
  ctx.strokeStyle = meta.color
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const p of kindIconPaths(kind)) ctx.stroke(p)
  ctx.restore()
  // text
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = '600 12px Inter, sans-serif'
  let ty = ly + PAD
  for (const l of lines) {
    ctx.fillText(l, lx + PAD + ICON + IGAP, ty)
    ty += lineH
  }
  ctx.restore()
  return { x: lx, y: ly, w, h }
}

/** A rounded violet outline around a comment element, drawn while hovered to make
 *  it read as clickable. */
function drawHoverOutline(x: number, y: number, w: number, h: number, radius: number) {
  if (!ctx) return
  ctx.save()
  roundRect(ctx, x - 2, y - 2, w + 4, h + 4, radius)
  ctx.strokeStyle = '#a78bfa'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

/** Draws the comment text inside the area rectangle (textInside mode), auto-sizing
 *  the font to the box: binary-searches the largest size whose wrapped text fits
 *  the available width and height. White with a shadow for legibility. */
function drawAreaText(rx: number, ry: number, rw: number, rh: number, text: string) {
  if (!ctx) return
  const padX = 8
  const padY = 6
  const maxW = Math.max(12, rw - padX * 2)
  const maxH = Math.max(12, rh - padY * 2)
  ctx.save()
  // Cap the font at the player-name size (same scale, see drawLabel for names) so
  // area text never reads larger than a player label; then take the largest size
  // whose fully-wrapped text fits both width and height.
  const nameSize = 11 * clamp(playerRadius() / 16, 0.9, 2)
  const MIN = 7
  let lo = MIN
  let hi = Math.min(Math.round(nameSize), Math.floor(maxH))
  let chosen = MIN
  while (lo <= hi) {
    const fs = (lo + hi) >> 1
    ctx.font = `600 ${fs}px Inter, sans-serif`
    const lineH = Math.round(fs * 1.3)
    const lines = wrapText(ctx, text, maxW, 999)
    let widest = 0
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width)
    if (widest <= maxW && lines.length * lineH <= maxH) {
      chosen = fs
      lo = fs + 1
    } else {
      hi = fs - 1
    }
  }
  // Draw at the chosen size, clamping the line count to the box (ellipsis if a tiny
  // box can't fit even the minimum size).
  ctx.font = `600 ${chosen}px Inter, sans-serif`
  const lineH = Math.round(chosen * 1.3)
  const lines = wrapText(ctx, text, maxW, Math.max(1, Math.floor(maxH / lineH)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 4
  const cx = rx + rw / 2
  let ty = ry + rh / 2 - ((lines.length - 1) * lineH) / 2
  for (const l of lines) {
    ctx.fillText(l, cx, ty)
    ty += lineH
  }
  ctx.restore()
}

// Bubble card rects drawn this frame (comment mode), for click hit-testing.
let commentHitboxes: { id: string; x: number; y: number; w: number; h: number }[] = []

/** Returns the topmost active comment under (sx, sy): inside an area rectangle, or
 *  inside a drawn bubble card. Matches the draw (only comments visible now). */
function hitTestComment(sx: number, sy: number): ReplayComment | null {
  const list = (props.comments ?? []).filter((c) => isCommentActive(c, props.currentT))
  // Area rectangles (topmost first).
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    if (c.anchor.kind !== 'area') continue
    const p1 = w2s(c.x, c.y)
    const p2 = w2s(c.anchor.x2, c.anchor.y2)
    const x = Math.min(p1.x, p2.x)
    const y = Math.min(p1.y, p2.y)
    if (sx >= x && sx <= x + Math.abs(p2.x - p1.x) && sy >= y && sy <= y + Math.abs(p2.y - p1.y)) {
      return c
    }
  }
  // Bubble cards drawn this frame (topmost first).
  for (let i = commentHitboxes.length - 1; i >= 0; i--) {
    const b = commentHitboxes[i]
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
      return list.find((c) => c.id === b.id) ?? null
    }
  }
  return null
}

/**
 * Detects what the user clicked, to anchor a new comment: a living player, an
 * active grenade detonation, or a plain point. Returns the world anchor + target.
 */
function detectTarget(sx: number, sy: number): { x: number; y: number; anchor: CommentAnchor } {
  // 1. A living player under the click?
  const pr = playerRadius() + 4
  for (const p of props.players) {
    if (!p.alive) continue
    const { x, y } = w2s(p.x, p.y)
    if (Math.hypot(sx - x, sy - y) <= pr) {
      return { x: p.x, y: p.y, anchor: { kind: 'player', steamId: p.steamId } }
    }
  }
  // 2. An active grenade detonation under the click?
  const tt = props.currentT
  for (const ev of props.round?.events ?? []) {
    if (ev.type !== 'grenade') continue
    if (tt < ev.t || tt > ev.endT) continue
    const { x, y } = w2s(ev.x, ev.y)
    const tol = Math.max(16, unitsToScreen(80))
    if (Math.hypot(sx - x, sy - y) <= tol) {
      return { x: ev.x, y: ev.y, anchor: { kind: 'grenade', grenadeKind: ev.kind } }
    }
  }
  // 3. A plain point on the map.
  const w = s2w(sx, sy)
  return { x: w.x, y: w.y, anchor: { kind: 'point' } }
}

/**
 * The player/grenade under the cursor in comment mode: screen centre + radius for
 * the hover ring (or null over the empty map). Recomputed each draw so the ring
 * tracks a moving target.
 */
function hoverAt(sx: number, sy: number): { sx: number; sy: number; r: number; key: string } | null {
  const pr = playerRadius()
  for (const p of props.players) {
    if (!p.alive) continue
    const { x, y } = w2s(p.x, p.y)
    if (Math.hypot(sx - x, sy - y) <= pr + 4) {
      return { sx: x, sy: y, r: pr + 6, key: `p:${p.steamId}` }
    }
  }
  const tt = props.currentT
  for (const ev of props.round?.events ?? []) {
    if (ev.type !== 'grenade') continue
    if (tt < ev.t || tt > ev.endT) continue
    const { x, y } = w2s(ev.x, ev.y)
    const tol = Math.max(16, unitsToScreen(80))
    if (Math.hypot(sx - x, sy - y) <= tol) {
      return { sx: x, sy: y, r: tol, key: `g:${ev.t}` }
    }
  }
  return null
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

  // arcs of grenades in flight (under the detonations), active floor only
  for (const path of props.round?.grenadePaths ?? []) {
    if (zOnActiveLevel(grenadePathZ(path))) drawGrenadePath(path, t)
  }
  for (const ev of props.round?.events ?? []) {
    if (ev.type !== 'grenade') continue
    // Coach mode imports the active grenades into the board (movable/removable),
    // so skip the replay's own draw to avoid drawing each one twice.
    if (!props.coachMode && t >= ev.t && t <= ev.endT) drawGrenade(ev, t)
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
  if (
    !planting &&
    bomb &&
    (bomb.state === 'ground' || bomb.state === 'planted') &&
    zOnActiveLevel(bomb.z)
  ) {
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
    drawKill(ctx, x, y, 1 - age / KILL_FADE)
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
    if (pk && pk.x != null && zOnActiveLevel(pk.z)) drawBlast(pk.x, pk.y ?? 0, blastEv.t, t)
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
      if (onActiveLevel(planter)) {
        const { x, y } = w2s(planter.x, planter.y)
        drawPlanting(x, y, playerRadius(), prog)
      }
    } else if (zOnActiveLevel(plantedKf.z)) {
      const { x, y } = w2s(plantedKf.x ?? 0, plantedKf.y ?? 0)
      drawPlanting(x, y, playerRadius(), prog)
    }
  } else if (bomb && bomb.state === 'carried') {
    // C4 carried: marker next to the carrier (alive), only on the active floor.
    const carrier = props.players.find(
      (p) => p.steamId === bomb.carrierSteamId && p.alive && !deaths.has(p.steamId),
    )
    if (carrier && onActiveLevel(carrier)) {
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
      if (onActiveLevel(defuser)) {
        const { x, y } = w2s(defuser.x, defuser.y)
        drawDefusing(x, y, playerRadius(), prog)
      }
    } else {
      const pk = props.round?.bomb.find((k) => k.state === 'planted')
      if (pk && pk.x != null && zOnActiveLevel(pk.z)) {
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

  // Comments, on top of everything. Only those active at the current time show
  // (so each disappears after its duration), positioned at their anchor and
  // following the player they're tied to. Comment mode draws a clickable pin;
  // playback draws the text bubble. The full list lives in the side panel.
  const activeComments = (props.comments ?? []).filter((c) => isCommentActive(c, t))
  // Living-player circles (screen space) the bubbles steer around.
  const obstacles = props.players
    .filter((p) => p.alive)
    .map((p) => {
      const s = w2s(p.x, p.y)
      return { x: s.x, y: s.y, r: playerRadius() }
    })
  commentHitboxes = []
  activeComments.forEach((c) => {
    // The area being resized is drawn as a live draft below; skip its stale copy.
    if (resizing && c.id === resizing.id) return
    const hovered = c.id === hoveredCommentId.value
    if (c.anchor.kind === 'area') {
      // Area: dashed rectangle + a text label hugging it; the rectangle is the
      // click target (see hitTestComment).
      const p1 = w2s(c.x, c.y)
      const p2 = w2s(c.anchor.x2, c.anchor.y2)
      drawAreaRect(p1.x, p1.y, p2.x, p2.y, commentKindMeta(c.kind).color, hovered || c.id === props.activeCommentId)
      const ax = Math.min(p1.x, p2.x)
      const ay = Math.min(p1.y, p2.y)
      const aw = Math.abs(p2.x - p1.x)
      const ah = Math.abs(p2.y - p1.y)
      if (c.textInside) {
        // Text inside the box; the rectangle itself is the click target.
        drawAreaText(ax, ay, aw, ah, c.text)
      } else {
        const labelRect = drawAreaLabel(ax, ay, aw, ah, c.text, c.kind)
        if (labelRect) {
          commentHitboxes.push({ id: c.id, ...labelRect })
          if (hovered) drawHoverOutline(labelRect.x, labelRect.y, labelRect.w, labelRect.h, 6)
        }
      }
      // Resize handles on the hovered area (comment mode).
      if (props.commentMode && hovered) drawAreaHandles(p1.x, p1.y, p2.x, p2.y)
      return
    }
    // The open comment bubble (text + kind icon + colored marker on the anchor),
    // shown in both modes; clickable to edit.
    const pos = commentPositionAt(c, props.players)
    const { x, y } = w2s(pos.x, pos.y)
    const clearR = c.anchor.kind === 'player' ? playerRadius() : 0
    const rect = drawCommentBubble({ cx: x, cy: y, halfW: clearR, halfH: clearR, inset: 0 }, c.text, c.kind, obstacles)
    if (rect) {
      // Hitboxes feed both the click (comment mode) and the right-click menu (both
      // modes); the hover outline only shows in comment mode (hovered is set there).
      commentHitboxes.push({ id: c.id, ...rect })
      if (hovered) drawHoverOutline(rect.x, rect.y, rect.w, rect.h, 10)
    }
  })

  // Area being created (its popover is open): keep the rectangle on screen,
  // highlighted, so the selection stays visible and tied to the popover.
  if (props.pendingArea) {
    const p1 = w2s(props.pendingArea.x, props.pendingArea.y)
    const p2 = w2s(props.pendingArea.x2, props.pendingArea.y2)
    drawAreaRect(p1.x, p1.y, p2.x, p2.y, commentKindMeta(props.pendingArea.kind).color, true)
  }

  // Coach mode tactical board: placed grenades, committed drawings, then the shape
  // being drawn live. Scoped to coach mode so the board never leaks into playback.
  if (props.coachMode) {
    for (const g of props.coachGrenades ?? []) drawCoachGrenade(g)
    for (const d of props.coachDrawings ?? []) drawCoachDrawing(d)
    // Rotate handle on the player being rotated, or the one under the cursor.
    const isSelect = !props.coachTool || props.coachTool === 'select'
    const handleId = playerDrag?.mode === 'rotate' ? playerDrag.steamId : isSelect ? coachHoverPlayerId.value : null
    if (handleId) {
      const pl = props.players.find((p) => p.steamId === handleId && p.alive)
      if (pl) drawRotateHandle(pl)
    }
    const color = props.coachColor ?? COACH_DEFAULT_COLOR
    const thickness = props.coachThickness ?? COACH_DEFAULT_THICKNESS
    if (coachPath && coachPath.length > 1) paintCoach('path', coachPath, color, thickness)
    else if (coachStart && coachCur && isShapeTool(props.coachTool)) {
      paintCoach(props.coachTool, [coachStart, coachCur], color, thickness)
    }
  }

  // Hover highlight in comment mode: a dashed white ring around the target the
  // click would anchor to (a living player or an active grenade detonation).
  if (props.commentMode && hoverMouse) {
    const h = hoverAt(hoverMouse.sx, hoverMouse.sy)
    if (h) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(h.sx, h.sy, h.r, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2.5
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.restore()
    }
  }

  // Area being drawn (comment-mode drag): live dashed rectangle.
  if (props.commentMode && areaStart && areaCur) {
    drawAreaRect(areaStart.sx, areaStart.sy, areaCur.sx, areaCur.sy, '#ffffff', true)
  }

  // Area being resized: live draft rectangle (kind-tinted) + handles.
  if (resizing) {
    const rid = resizing.id
    const c = (props.comments ?? []).find((x) => x.id === rid)
    const f = w2s(resizing.fwx, resizing.fwy)
    drawAreaRect(f.x, f.y, resizing.sx, resizing.sy, commentKindMeta(c?.kind).color, true)
    drawAreaHandles(f.x, f.y, resizing.sx, resizing.sy)
  }

  // Keep the open popover pinned to its anchor as the view or the player moves.
  if (props.popoverAnchor) {
    emit('popoverMoved', popoverAnchorRect(props.popoverAnchor))
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
let downX = 0
let downY = 0
// Cursor position over the map in comment mode, to highlight the hover target.
let hoverMouse: { sx: number; sy: number } | null = null
let hoverKey: string | null = null
// Comment under the cursor (both modes), for the hover highlight + pointer cursor.
const hoveredCommentId = ref<string | null>(null)
// Area drag in comment mode: start + current corner (screen px), null when idle.
let areaStart: { sx: number; sy: number } | null = null
let areaCur: { sx: number; sy: number } | null = null
// Resizing an existing area: comment id + its fixed (opposite) corner in world +
// the dragged corner in screen px. Null when not resizing.
const HANDLE_R = 6
let resizing: { id: string; fwx: number; fwy: number; sx: number; sy: number } | null = null
// Resize cursor shown while hovering/holding a corner handle (null otherwise).
const resizeCursor = ref<string | null>(null)
// Coach mode: the shape being drawn (screen px). Two-point tools track start+cur;
// freehand `path` accumulates samples. All null when idle.
let coachStart: { x: number; y: number } | null = null
let coachCur: { x: number; y: number } | null = null
let coachPath: { x: number; y: number }[] | null = null
// Coach mode (select tool): a player being moved or rotated, or a grenade being
// dragged, in world coords. Null when idle.
let playerDrag: { steamId: string; x: number; y: number; yaw: number; mode: 'move' | 'rotate' } | null = null
let grenadeDrag: { id: string; x: number; y: number } | null = null
// Player whose rotate handle is shown (cursor hovers it or its body), or null.
const coachHoverPlayerId = ref<string | null>(null)
// Cursor hint: over a draggable object (move), or over a rotate handle (rotate).
const coachHoverObject = ref(false)
const coachHoverHandle = ref(false)

const ROTATE_HANDLE_R = 7
function rotateHandleDist() {
  return playerRadius() * 2.1
}
/** Screen position of a player's rotate handle (at the tip of its facing). */
function rotateHandleScreen(p: PlayerState): { x: number; y: number } {
  const pose = playerPose(p)
  const c = w2s(pose.x, pose.y)
  const ang = (-pose.yaw * Math.PI) / 180
  const d = rotateHandleDist()
  return { x: c.x + Math.cos(ang) * d, y: c.y + Math.sin(ang) * d }
}
/** The alive player whose rotate handle is under (sx, sy), or null. */
function hitTestRotateHandle(sx: number, sy: number): PlayerState | null {
  for (let i = props.players.length - 1; i >= 0; i--) {
    const p = props.players[i]
    if (!p.alive || !onActiveLevel(p)) continue
    const h = rotateHandleScreen(p)
    if (Math.hypot(sx - h.x, sy - h.y) <= ROTATE_HANDLE_R + 4) return p
  }
  return null
}
/** Draws the rotate handle (dashed stem + grab dot) for a player. */
function drawRotateHandle(p: PlayerState) {
  if (!ctx) return
  const pose = playerPose(p)
  const c = w2s(pose.x, pose.y)
  const h = rotateHandleScreen(p)
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(c.x, c.y)
  ctx.lineTo(h.x, h.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(h.x, h.y, ROTATE_HANDLE_R, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.stroke()
  ctx.restore()
}

/** The player under (sx, sy) on the coach board (override-aware), or null. */
function hitTestPlayer(sx: number, sy: number): PlayerState | null {
  const pr = playerRadius() + 4
  for (let i = props.players.length - 1; i >= 0; i--) {
    const p = props.players[i]
    if (!onActiveLevel(p)) continue
    const pos = coachPosOf(p) ?? p
    const { x, y } = w2s(pos.x, pos.y)
    if (Math.hypot(sx - x, sy - y) <= pr) return p
  }
  return null
}

/** Grab radius (screen px) of a placed grenade: the effect area for smoke/fire,
 *  a small disc for point grenades. */
function grenadeHitRadius(kind: GrenadeKind): number {
  if (kind === 'smoke') return smokeRadius()
  if (kind === 'fire') return fireRadius()
  return clamp(playerRadius() * 0.7, 9, 26) + 4
}

/** The placed grenade under (sx, sy), or null (drag-preview aware). */
function hitTestGrenade(sx: number, sy: number): CoachGrenade | null {
  const list = props.coachGrenades ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i]
    if (!zOnActiveLevel(g.z)) continue
    const pos = grenadeDrag && grenadeDrag.id === g.id ? grenadeDrag : g
    const { x, y } = w2s(pos.x, pos.y)
    if (Math.hypot(sx - x, sy - y) <= grenadeHitRadius(g.kind)) return g
  }
  return null
}

function localPoint(e: PointerEvent): { sx: number; sy: number } {
  const rect = canvas.value!.getBoundingClientRect()
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
}
/** Canvas-local point -> viewport (clientX/clientY), for floating-ui anchoring. */
function toClient(sx: number, sy: number): { vx: number; vy: number } {
  const rect = canvas.value!.getBoundingClientRect()
  return { vx: rect.left + sx, vy: rect.top + sy }
}
/** Reference rect (viewport) for a comment's popover: the area rectangle (so it
 *  opens above/below the whole box), or a zero-size point at the click otherwise. */
function commentClientRect(
  c: ReplayComment,
  e: MouseEvent,
): { vx: number; vy: number; vw: number; vh: number } {
  if (c.anchor.kind === 'area') {
    const p1 = w2s(c.x, c.y)
    const p2 = w2s(c.anchor.x2, c.anchor.y2)
    const c1 = toClient(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y))
    const c2 = toClient(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y))
    return { vx: c1.vx, vy: c1.vy, vw: c2.vx - c1.vx, vh: c2.vy - c1.vy }
  }
  return { vx: e.clientX, vy: e.clientY, vw: 0, vh: 0 }
}

/** Current viewport rect of the open popover's anchor: the area rectangle, the live
 *  player position, or a fixed world point. */
function popoverAnchorRect(pa: {
  anchor: CommentAnchor
  wx: number
  wy: number
}): { vx: number; vy: number; vw: number; vh: number } {
  const anchor = pa.anchor
  if (anchor.kind === 'area') {
    const p1 = w2s(pa.wx, pa.wy)
    const p2 = w2s(anchor.x2, anchor.y2)
    const c1 = toClient(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y))
    const c2 = toClient(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y))
    return { vx: c1.vx, vy: c1.vy, vw: c2.vx - c1.vx, vh: c2.vy - c1.vy }
  }
  let wx = pa.wx
  let wy = pa.wy
  if (anchor.kind === 'player') {
    const sid = anchor.steamId
    const player = props.players.find((p) => p.steamId === sid)
    if (player) {
      wx = player.x
      wy = player.y
    }
  }
  const s = w2s(wx, wy)
  const c = toClient(s.x, s.y)
  return { vx: c.vx, vy: c.vy, vw: 0, vh: 0 }
}

/** Returns the area-resize handle under (sx, sy): the comment id, its opposite
 *  (anchored) corner in world coords, and the resize cursor. Null if none. */
function hitTestAreaHandle(
  sx: number,
  sy: number,
): { id: string; fwx: number; fwy: number; cursor: string } | null {
  const list = (props.comments ?? []).filter(
    (c) => isCommentActive(c, props.currentT) && c.anchor.kind === 'area',
  )
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    const a = c.anchor as { x2: number; y2: number }
    const p1 = w2s(c.x, c.y)
    const p2 = w2s(a.x2, a.y2)
    // Each corner: its screen point + the opposite (fixed) corner in world coords.
    const corners = [
      { sx: p1.x, sy: p1.y, ox: a.x2, oy: a.y2 },
      { sx: p2.x, sy: p2.y, ox: c.x, oy: c.y },
      { sx: p2.x, sy: p1.y, ox: c.x, oy: a.y2 },
      { sx: p1.x, sy: p2.y, ox: a.x2, oy: c.y },
    ]
    const midX = (p1.x + p2.x) / 2
    const midY = (p1.y + p2.y) / 2
    for (const corner of corners) {
      if (Math.hypot(sx - corner.sx, sy - corner.sy) <= HANDLE_R + 4) {
        const sameSide = corner.sx < midX === corner.sy < midY
        return {
          id: c.id,
          fwx: corner.ox,
          fwy: corner.oy,
          cursor: sameSide ? 'nwse-resize' : 'nesw-resize',
        }
      }
    }
  }
  return null
}

/** Draws the 4 corner resize handles of an area rectangle (screen corners). */
function drawAreaHandles(sx1: number, sy1: number, sx2: number, sy2: number) {
  if (!ctx) return
  ctx.save()
  ctx.setLineDash([])
  for (const hx of [sx1, sx2]) {
    for (const hy of [sy1, sy2]) {
      ctx.beginPath()
      ctx.rect(hx - HANDLE_R, hy - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.stroke()
    }
  }
  ctx.restore()
}

function onPointerDown(e: PointerEvent) {
  // Middle button (mouse wheel click) pans the map in any mode/tool, so the coach
  // can reframe without leaving the active tool.
  if (e.button === 1) {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    downX = e.clientX
    downY = e.clientY
    canvas.value?.setPointerCapture(e.pointerId)
    return
  }
  if (e.button !== 0) return
  downX = e.clientX
  downY = e.clientY
  // Coach mode: shape tools draw on drag; `grenade` places on click; `select`
  // drags a grenade/player under the cursor, or falls through to pan on empty map.
  if (props.coachMode) {
    const p = localPoint(e)
    if (isShapeTool(props.coachTool)) {
      if (props.coachTool === 'path') coachPath = [{ x: p.sx, y: p.sy }]
      else {
        coachStart = { x: p.sx, y: p.sy }
        coachCur = { x: p.sx, y: p.sy }
      }
      canvas.value?.setPointerCapture(e.pointerId)
      return
    }
    if (props.coachTool === 'grenade') {
      const w = s2w(p.sx, p.sy)
      emit('addGrenade', { kind: props.coachGrenadeKind ?? 'smoke', x: w.x, y: w.y, z: activeLevelZ() })
      return
    }
    const rot = hitTestRotateHandle(p.sx, p.sy)
    if (rot) {
      const pose = playerPose(rot)
      playerDrag = { steamId: rot.steamId, x: pose.x, y: pose.y, yaw: pose.yaw, mode: 'rotate' }
      canvas.value?.setPointerCapture(e.pointerId)
      return
    }
    const g = hitTestGrenade(p.sx, p.sy)
    if (g) {
      grenadeDrag = { id: g.id, x: g.x, y: g.y }
      canvas.value?.setPointerCapture(e.pointerId)
      return
    }
    const hit = hitTestPlayer(p.sx, p.sy)
    if (hit) {
      const pose = playerPose(hit)
      playerDrag = { steamId: hit.steamId, x: pose.x, y: pose.y, yaw: pose.yaw, mode: 'move' }
      canvas.value?.setPointerCapture(e.pointerId)
      return
    }
    // Nothing grabbed: fall through to pan.
  }
  if (props.commentMode) {
    const p = localPoint(e)
    // Grabbing an area's corner handle resizes it; anywhere else starts a new area.
    const handle = hitTestAreaHandle(p.sx, p.sy)
    if (handle) {
      resizing = { id: handle.id, fwx: handle.fwx, fwy: handle.fwy, sx: p.sx, sy: p.sy }
      canvas.value?.setPointerCapture(e.pointerId)
      return
    }
    // Comment mode locks panning: a drag marks a rectangular area, a click drops
    // a point/player/grenade comment (decided on pointerup by how far it moved).
    areaStart = p
    areaCur = p
    canvas.value?.setPointerCapture(e.pointerId)
    return
  }
  // Normal mode: left button pans (disabled in auto zoom).
  if (!props.autoZoom) {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    canvas.value?.setPointerCapture(e.pointerId)
  }
}
function onPointerMove(e: PointerEvent) {
  if (dragging) {
    panX += e.clientX - lastX
    panY += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    draw()
    return
  }
  // Resizing an area (corner handle held): track the dragged corner.
  if (resizing) {
    const p = localPoint(e)
    resizing.sx = p.sx
    resizing.sy = p.sy
    draw()
    return
  }
  // Dragging a player on the coach board: move tracks the cursor; rotate spins the
  // facing toward the cursor (screen Y is inverted, matching the render's -yaw).
  if (playerDrag) {
    const lp = localPoint(e)
    if (playerDrag.mode === 'rotate') {
      const c = w2s(playerDrag.x, playerDrag.y)
      playerDrag.yaw = (-Math.atan2(lp.sy - c.y, lp.sx - c.x) * 180) / Math.PI
    } else {
      const w = s2w(lp.sx, lp.sy)
      playerDrag.x = w.x
      playerDrag.y = w.y
    }
    draw()
    return
  }
  // Dragging a grenade on the coach board: track the cursor in world coords.
  if (grenadeDrag) {
    const lp = localPoint(e)
    const w = s2w(lp.sx, lp.sy)
    grenadeDrag.x = w.x
    grenadeDrag.y = w.y
    draw()
    return
  }
  // Drawing a coach shape (button held): track the moving corner / sample the path.
  if (props.coachMode && (coachStart || coachPath)) {
    const p = localPoint(e)
    if (coachPath) coachPath.push({ x: p.sx, y: p.sy })
    else coachCur = { x: p.sx, y: p.sy }
    draw()
    return
  }
  // Coach select mode (no drag in progress): track the hovered player (to show its
  // rotate handle) and the cursor hints; repaint when the hovered player changes.
  if (props.coachMode) {
    const { sx, sy } = localPoint(e)
    const isSelect = !props.coachTool || props.coachTool === 'select'
    const rot = isSelect ? hitTestRotateHandle(sx, sy) : null
    const player = isSelect && !rot ? hitTestPlayer(sx, sy) : null
    const grenade = isSelect && !rot && !player ? hitTestGrenade(sx, sy) : null
    const hoverId = (rot ?? player)?.steamId ?? null
    coachHoverHandle.value = !!rot
    coachHoverObject.value = !!rot || !!player || !!grenade
    if (hoverId !== coachHoverPlayerId.value) {
      coachHoverPlayerId.value = hoverId
      draw()
    }
    return
  }
  // Drawing an area (comment mode, button held): track the moving corner.
  if (props.commentMode && areaStart) {
    areaCur = localPoint(e)
    draw()
    return
  }
  // Hover affordances (pointer/resize cursor + highlight) are comment-mode only.
  if (!props.commentMode) {
    if (hoveredCommentId.value || resizeCursor.value) {
      hoveredCommentId.value = null
      resizeCursor.value = null
      draw()
    }
    return
  }
  const { sx, sy } = localPoint(e)
  hoverMouse = { sx, sy }
  const handle = hitTestAreaHandle(sx, sy)
  resizeCursor.value = handle?.cursor ?? null
  // A handle also counts as hovering its area, so the handles stay visible.
  const overComment = handle?.id ?? hitTestComment(sx, sy)?.id ?? null
  // Comment mode also rings the player/grenade a new pin would anchor to.
  const key = hoverAt(sx, sy)?.key ?? null
  if (overComment !== hoveredCommentId.value || key !== hoverKey) {
    hoveredCommentId.value = overComment
    hoverKey = key
    draw()
  }
}
function onPointerUp(e: PointerEvent) {
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
  dragging = false
  // Finishing a player drag: commit the new pose (undoable). Rotation commits even
  // on a tiny move; a move needs a real drag to avoid jitter on a plain click.
  if (playerDrag) {
    const d = playerDrag
    playerDrag = null
    canvas.value?.releasePointerCapture(e.pointerId)
    if (e.button === 0 && (d.mode === 'rotate' || moved > 3)) {
      emit('setPlayerPose', { steamId: d.steamId, x: d.x, y: d.y, yaw: d.yaw })
    }
    draw()
    return
  }
  if (grenadeDrag) {
    const d = grenadeDrag
    grenadeDrag = null
    canvas.value?.releasePointerCapture(e.pointerId)
    if (e.button === 0 && moved > 3) emit('moveGrenade', { id: d.id, x: d.x, y: d.y })
    draw()
    return
  }
  // Finishing a coach shape: commit it in world coords (drawings track zoom/pan).
  if (props.coachMode && (coachStart || coachPath)) {
    const tool: CoachShapeTool = isShapeTool(props.coachTool) ? props.coachTool : 'rectangle'
    const path = coachPath
    const a = coachStart
    const b = coachCur
    coachStart = null
    coachCur = null
    coachPath = null
    canvas.value?.releasePointerCapture(e.pointerId)
    const color = props.coachColor ?? COACH_DEFAULT_COLOR
    const thickness = props.coachThickness ?? COACH_DEFAULT_THICKNESS
    const z = activeLevelZ()
    if (e.button === 0) {
      if (tool === 'path' && path && path.length > 1) {
        emit('addDrawing', { tool, color, thickness, z, points: path.map((p) => s2w(p.x, p.y)) })
      } else if (tool !== 'path' && a && b && moved > 6) {
        emit('addDrawing', { tool, color, thickness, z, points: [s2w(a.x, a.y), s2w(b.x, b.y)] })
      }
    }
    draw()
    return
  }
  // Finishing an area resize: commit the new world rect (fixed corner + dragged one).
  if (resizing) {
    const f = resizing
    resizing = null
    canvas.value?.releasePointerCapture(e.pointerId)
    if (e.button === 0 && moved > 3) {
      const corner = s2w(f.sx, f.sy)
      emit('resizeArea', { id: f.id, x: f.fwx, y: f.fwy, x2: corner.x, y2: corner.y })
    }
    draw()
    return
  }
  const start = areaStart
  const cur = areaCur
  areaStart = null
  areaCur = null
  canvas.value?.releasePointerCapture(e.pointerId)
  // Comments are interactive only in comment mode; a normal click just ends a pan.
  if (e.button !== 0 || !props.commentMode) {
    draw()
    return
  }

  // A real drag marks a rectangular area; a click adds a point comment.
  if (moved > 6 && start && cur) {
    const a = s2w(start.sx, start.sy)
    const b = s2w(cur.sx, cur.sy)
    // Anchor the popover to the whole rectangle (top-left + size), so it opens
    // above the top and, when flipped, below the bottom.
    const c1 = toClient(Math.min(start.sx, cur.sx), Math.min(start.sy, cur.sy))
    const c2 = toClient(Math.max(start.sx, cur.sx), Math.max(start.sy, cur.sy))
    emit('dropComment', {
      x: a.x,
      y: a.y,
      anchor: { kind: 'area', x2: b.x, y2: b.y },
      vx: c1.vx,
      vy: c1.vy,
      vw: c2.vx - c1.vx,
      vh: c2.vy - c1.vy,
    })
    // No draw() here: the canvas keeps the just-drawn rectangle until the
    // popover's pendingArea prop arrives next tick and the watch repaints it,
    // so the selection never blinks out.
    return
  }
  const { sx, sy } = localPoint(e)
  // A click on an existing comment edits it; otherwise drop a new one on whatever
  // is under it (a living player, an active grenade detonation, or a point).
  const hit = hitTestComment(sx, sy)
  if (hit) {
    emit('selectComment', { id: hit.id, ...commentClientRect(hit, e) })
    return
  }
  const target = detectTarget(sx, sy)
  emit('dropComment', { ...target, vx: e.clientX, vy: e.clientY, vw: 0, vh: 0 })
}
function onPointerLeave() {
  coachHoverObject.value = false
  coachHoverHandle.value = false
  if (
    hoverMouse ||
    hoverKey ||
    areaStart ||
    hoveredCommentId.value ||
    coachStart ||
    coachPath ||
    playerDrag ||
    grenadeDrag ||
    coachHoverPlayerId.value
  ) {
    hoverMouse = null
    hoverKey = null
    hoveredCommentId.value = null
    areaStart = null
    areaCur = null
    coachStart = null
    coachCur = null
    coachPath = null
    playerDrag = null
    grenadeDrag = null
    coachHoverPlayerId.value = null
    draw()
  }
}
function onContextMenu(e: MouseEvent) {
  if (!canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  // Coach mode: right-click removes the grenade under the cursor. Suppress the
  // replay context menu (stopPropagation keeps it from reaching the reka trigger).
  if (props.coachMode) {
    e.preventDefault()
    e.stopPropagation()
    const g = hitTestGrenade(sx, sy)
    if (g) emit('removeGrenade', { id: g.id })
    return
  }
  // Right-click on an existing comment -> let the menu open with its actions.
  const hit = hitTestComment(sx, sy)
  if (hit) {
    emit('contextComment', { id: hit.id, ...commentClientRect(hit, e) })
    return
  }
  emit('contextComment', null)
  // Right-click on a player -> the menu offers "add a comment on them". The reka-ui
  // trigger still opens the menu (no preventDefault here).
  const target = detectTarget(sx, sy)
  const anchor = target.anchor
  if (anchor.kind === 'player') {
    // Pull z/yaw from the current frame so the menu can offer a setpos command.
    const p = props.players.find((pl) => pl.steamId === anchor.steamId)
    emit('contextTarget', {
      x: target.x,
      y: target.y,
      z: p?.z ?? 0,
      yaw: p?.yaw ?? 0,
      anchor,
      vx: e.clientX,
      vy: e.clientY,
    })
  } else {
    emit('contextTarget', null)
  }
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

watch(() => props.round, () => {
  effects.clear()
  draw()
})
watch(() => props.lowQualityEffects, draw)
watch(() => props.players, draw)
watch(() => props.bombBlink, draw)
watch(() => props.previewPath, draw)
watch(() => props.previewPaths, draw)
watch(() => props.levelRange, draw, { deep: true })
watch(() => props.talking, draw)
watch(() => props.muted, draw, { deep: true })
watch(() => props.comments, draw)
watch(() => props.activeCommentId, draw)
watch(() => props.commentMode, () => {
  if (!props.commentMode) hoveredCommentId.value = null
  draw()
})
watch(() => props.pendingArea, draw)
watch(() => props.popoverAnchor, draw)
watch(() => props.coachDrawings, draw, { deep: true })
watch(() => props.coachMode, draw)
watch(() => props.coachTool, draw)
watch(() => props.playerOverrides, draw, { deep: true })
watch(() => props.coachGrenades, draw, { deep: true })
watch(() => props.coachGrenadeKind, draw)
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
      data-viewer-canvas
      class="h-full w-full touch-none"
      :class="
        coachMode
          ? coachTool && coachTool !== 'select'
            ? 'cursor-crosshair'
            : coachHoverHandle
              ? 'cursor-crosshair'
              : coachHoverObject
                ? 'cursor-move'
                : 'cursor-grab active:cursor-grabbing'
          : commentMode
            ? hoveredCommentId
              ? 'cursor-pointer'
              : 'cursor-crosshair'
            : autoZoom
              ? 'cursor-default'
              : 'cursor-grab active:cursor-grabbing'
      "
      :style="resizeCursor ? { cursor: resizeCursor } : {}"
      @wheel="onWheel"
      @mousedown.middle.prevent
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @contextmenu="onContextMenu"
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
