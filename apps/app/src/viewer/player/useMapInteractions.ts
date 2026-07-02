// All pointer interaction on the map canvas: wheel zoom, hand pan, comment-mode
// placement/hover/area-resize, and the coach board (draw shapes, place/drag
// grenades, move/rotate players). Split out of ViewerMap, which keeps only the
// render loop; this owns the transient drag/hover state and the hit-testing, and
// resolves player poses (override- and drag-aware) that the renderer reads back.
//
// The view transform (zoom/pan/L) and the canvas/ctx live in the component and
// are injected as accessors, so this stays a pure "input + hit-test" layer that
// mutates the shared view and emits committed changes to the host.
import { ref, type Ref } from 'vue'
import type {
  CommentAnchor,
  GrenadeKind,
  PlayerState,
  ReplayComment,
  Round,
} from '@/viewer/domain/schema'
import {
  COACH_DEFAULT_COLOR,
  COACH_DEFAULT_THICKNESS,
  isShapeTool,
  type CoachGrenade,
  type CoachShapeTool,
  type CoachTool,
} from '@/viewer/player/coachTools'
import { clamp } from '@/viewer/player/canvasUtils'
import { isCommentActive } from '@/viewer/comments/commentAnchor'

/** The subset of ViewerMap props the interaction layer reads. */
interface InteractionProps {
  players: PlayerState[]
  currentT: number
  round: Round | null
  comments?: ReplayComment[]
  commentMode?: boolean
  autoZoom?: boolean
  followSteamId?: string | null
  coachMode?: boolean
  coachTool?: CoachTool
  coachColor?: string
  coachThickness?: number
  coachGrenades?: CoachGrenade[]
  coachGrenadeKind?: GrenadeKind
  playerOverrides?: Record<string, { x: number; y: number; yaw: number }>
}

type CommentHitbox = { id: string; x: number; y: number; w: number; h: number }

interface MapInteractionsOptions {
  props: InteractionProps
  // Loosely typed on purpose: the component's typed `defineEmits` result isn't
  // assignable to a narrow string-keyed signature (event-name contravariance).
  emit: (event: any, ...args: any[]) => void
  canvas: Ref<HTMLCanvasElement | null>
  getCtx: () => CanvasRenderingContext2D | null
  /** Shared view transform (also driven by the auto camera). */
  zoom: Ref<number>
  getPan: () => { panX: number; panY: number }
  setPan: (panX: number, panY: number) => void
  getView: () => { cw: number; ch: number }
  /** Follow-camera zoom, nudged by the wheel while following a player. */
  followZoom: Ref<number>
  /** Bubble-card rects drawn this frame (filled by the render loop). */
  commentHitboxes: Ref<CommentHitbox[]>
  // World<->screen + sizing helpers (owned by the component).
  w2s: (wx: number, wy: number) => { x: number; y: number }
  s2w: (sx: number, sy: number) => { x: number; y: number }
  unitsToScreen: (u: number) => number
  playerRadius: () => number
  onActiveLevel: (p: PlayerState) => boolean
  zOnActiveLevel: (z: number | null | undefined) => boolean
  activeLevelZ: () => number | undefined
  smokeRadius: () => number
  fireRadius: () => number
  /** Repaint the canvas. */
  draw: () => void
}

export function useMapInteractions(opts: MapInteractionsOptions) {
  const {
    props,
    emit,
    canvas,
    getCtx,
    zoom,
    getPan,
    setPan,
    followZoom,
    commentHitboxes,
    w2s,
    s2w,
    unitsToScreen,
    playerRadius,
    onActiveLevel,
    zOnActiveLevel,
    activeLevelZ,
    smokeRadius,
    fireRadius,
    draw,
  } = opts

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

  // Bubble card rects drawn this frame (comment mode) are shared via the injected
  // `commentHitboxes` ref (the render loop fills it; hit-testing reads it below).

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
    for (let i = commentHitboxes.value.length - 1; i >= 0; i--) {
      const b = commentHitboxes.value[i]
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

  // --- manual interaction: wheel zoom, drag pan (inactive in auto zoom) ---
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    // While following, the wheel only changes how close the camera sits; pan stays
    // locked on the player (handled by the follow loop).
    if (props.followSteamId) {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      followZoom.value = clamp(followZoom.value * factor, 0.6, 8)
      return
    }
    if (props.autoZoom) return
    const rect = canvas.value!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const next = clamp(zoom.value * factor, 0.5, 8)
    const real = next / zoom.value
    const { panX, panY } = getPan()
    setPan(mx - (mx - panX) * real, my - (my - panY) * real)
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
    const ctx = getCtx()
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
    const ctx = getCtx()
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
    // Normal mode: left button pans. Auto zoom / follow also start a drag, but the
    // camera mode is only released once the pointer actually moves (see onPointerMove),
    // so a plain click on a followed player doesn't drop the camera.
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    canvas.value?.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging) {
      // A hand drag releases auto zoom / follow once it passes the click threshold,
      // so the manual pan below isn't fought by the camera loops.
      if ((props.autoZoom || props.followSteamId) && Math.hypot(e.clientX - downX, e.clientY - downY) > 3) {
        emit('cancelCamera')
        lastX = e.clientX
        lastY = e.clientY
        return
      }
      const { panX, panY } = getPan()
      setPan(panX + (e.clientX - lastX), panY + (e.clientY - lastY))
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

  // Live drag/hover state read by the render loop (getters expose the current value
  // without letting the component mutate it).
  const state = {
    get areaStart() {
      return areaStart
    },
    get areaCur() {
      return areaCur
    },
    get resizing() {
      return resizing
    },
    get coachStart() {
      return coachStart
    },
    get coachCur() {
      return coachCur
    },
    get coachPath() {
      return coachPath
    },
    get playerDrag() {
      return playerDrag
    },
    get grenadeDrag() {
      return grenadeDrag
    },
    get hoverMouse() {
      return hoverMouse
    },
  }

  return {
    // Pose resolution (read by the renderer to draw override/drag positions).
    coachPosOf,
    playerPose,
    // Refs consumed by the template (cursor) and the render loop.
    hoveredCommentId,
    resizeCursor,
    coachHoverObject,
    coachHoverHandle,
    coachHoverPlayerId,
    // Transient drag/hover state read by the render loop.
    state,
    // Interaction overlays + hit-tests the render loop calls.
    drawRotateHandle,
    drawAreaHandles,
    hoverAt,
    popoverAnchorRect,
    // Pointer handlers bound in the template.
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onContextMenu,
  }
}
