// The map's automatic camera: auto-zoom (frame all players / a focused subset /
// a tracked world point) and single-player follow, both easing zoom/pan toward a
// target every frame. Split out of ViewerMap to keep the component smaller; it
// owns the requestAnimationFrame loops and their watchers, and drives the shared
// view transform (`zoom`/pan) that ViewerMap reads back when it draws.
import { onUnmounted, ref, watch, type Ref } from 'vue'
import type { PlayerState } from '@/viewer/domain/schema'
import { worldToFraction, type MapCalibration } from '@/viewer/domain/calibration'
import { clamp } from '@/viewer/player/canvasUtils'

interface MapCameraOptions {
  /** Shared view zoom (also mutated by wheel/pan in the host). */
  zoom: Ref<number>
  /** Base radar side in CSS px (0 until the canvas is laid out). */
  getL: () => number
  /** Canvas size in CSS px. */
  getView: () => { cw: number; ch: number }
  /** Current pan offset (CSS px). */
  getPan: () => { panX: number; panY: number }
  /** Write the pan offset (CSS px). */
  setPan: (panX: number, panY: number) => void
  calibration: () => MapCalibration
  players: () => PlayerState[]
  autoZoom: () => boolean | undefined
  focusSteamIds: () => string[] | null | undefined
  focusWorld: () => { x: number; y: number } | null | undefined
  followSteamId: () => string | null | undefined
  /** Repaint the canvas (called each animation frame). */
  draw: () => void
}

// --- auto zoom: frames all players, easing in/out ---
const AUTO_PAD = 0.22 // padding (fraction of the screen) around the players bbox
const AUTO_EASE = 0.1 // smoothing per frame (higher is faster)
const AUTO_MIN_SPAN = 0.045 // min bbox (fraction) to avoid blowing up the zoom on a cluster
const AUTO_ZOOM_MAX = 2.4 // zoom-in cap: does not get too close to the players
const FOCUS_ZOOM_MAX = 4.5 // tighter cap when framing a focused subset (e.g. a kill)
const FOCUS_POINT_ZOOM = 3.8 // zoom held while tracking a moving world point (tight, so it reads)
const FOCUS_POINT_EASE = 0.3 // snappier easing so a fast point (a grenade) stays centered at that zoom

// --- follow player: keep one player centered, zoomed in, easing in/out ---
const FOLLOW_ZOOM = 2.6 // default closeness; the user can still wheel-zoom
const FOLLOW_EASE = 0.16 // smoothing per frame

export function useMapCamera(opts: MapCameraOptions) {
  const { zoom, draw } = opts

  /** Whether the auto-zoom loop should run: tracking a world point, framing all
   *  players or a focused subset, unless a single-player follow takes precedence. */
  function autoActive(): boolean {
    return (
      !opts.followSteamId() &&
      (!!opts.autoZoom() || !!opts.focusSteamIds()?.length || !!opts.focusWorld())
    )
  }

  /** Alvo de zoom/pan: o ponto do mundo rastreado (`focusWorld`, prioridade), ou os
   *  jogadores vivos (fallback: todos), ou apenas o subconjunto em foco. */
  function autoTarget(): { zoom: number; panX: number; panY: number } | null {
    const L = opts.getL()
    const { cw, ch } = opts.getView()
    const focusWorld = opts.focusWorld()
    if (focusWorld) {
      if (L === 0) return null
      const { fx, fy } = worldToFraction(opts.calibration(), focusWorld.x, focusWorld.y)
      const z = FOCUS_POINT_ZOOM
      return { zoom: z, panX: cw / 2 - fx * L * z, panY: ch / 2 - fy * L * z }
    }
    const focus = opts.focusSteamIds()
    const players = opts.players()
    let pts: PlayerState[]
    let zoomMax = AUTO_ZOOM_MAX
    if (focus?.length) {
      // Framed subset: keep them even when dead, so the death spot stays in view.
      const set = new Set(focus)
      pts = players.filter((p) => set.has(p.steamId))
      zoomMax = FOCUS_ZOOM_MAX
    } else {
      pts = players.filter((p) => p.alive)
      if (!pts.length) pts = players // round ended: use the last positions
    }
    if (!pts.length || L === 0) return null

    let fxMin = Infinity
    let fxMax = -Infinity
    let fyMin = Infinity
    let fyMax = -Infinity
    for (const p of pts) {
      const { fx, fy } = worldToFraction(opts.calibration(), p.x, p.y)
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
    const z = clamp(Math.min(availW / (dfx * L), availH / (dfy * L)), 0.5, zoomMax)
    return { zoom: z, panX: cw / 2 - cfx * L * z, panY: ch / 2 - cfy * L * z }
  }

  let autoRaf = 0
  function autoStep() {
    const tgt = autoTarget()
    if (tgt) {
      const ease = opts.focusWorld() ? FOCUS_POINT_EASE : AUTO_EASE
      zoom.value += (tgt.zoom - zoom.value) * ease
      const { panX, panY } = opts.getPan()
      opts.setPan(panX + (tgt.panX - panX) * ease, panY + (tgt.panY - panY) * ease)
    }
    draw()
    autoRaf = requestAnimationFrame(autoStep)
  }
  function stopAuto() {
    cancelAnimationFrame(autoRaf)
    autoRaf = 0
  }
  watch(
    [opts.autoZoom, opts.focusSteamIds, () => !!opts.focusWorld()],
    () => {
      if (autoActive() && !autoRaf) autoRaf = requestAnimationFrame(autoStep)
      else if (!autoActive()) stopAuto()
    },
  )

  // Follow zoom level, adjustable with the wheel while following (pan stays locked).
  const followZoom = ref(FOLLOW_ZOOM)

  /** Zoom/pan that centers the followed player; null if they aren't in view. */
  function followTarget(): { zoom: number; panX: number; panY: number } | null {
    const id = opts.followSteamId()
    const L = opts.getL()
    if (!id || L === 0) return null
    const p = opts.players().find((pl) => pl.steamId === id)
    if (!p) return null
    const { cw, ch } = opts.getView()
    const { fx, fy } = worldToFraction(opts.calibration(), p.x, p.y)
    const z = followZoom.value
    return { zoom: z, panX: cw / 2 - fx * L * z, panY: ch / 2 - fy * L * z }
  }

  let followRaf = 0
  function followStep() {
    const tgt = followTarget()
    if (tgt) {
      zoom.value += (tgt.zoom - zoom.value) * FOLLOW_EASE
      const { panX, panY } = opts.getPan()
      opts.setPan(panX + (tgt.panX - panX) * FOLLOW_EASE, panY + (tgt.panY - panY) * FOLLOW_EASE)
    }
    draw()
    followRaf = requestAnimationFrame(followStep)
  }
  function stopFollow() {
    cancelAnimationFrame(followRaf)
    followRaf = 0
  }
  watch(
    opts.followSteamId,
    (id, prevId) => {
      if (id) {
        stopAuto() // follow overrides auto zoom while active
        // Starting a fresh follow keeps the current view's zoom; switching between
        // players preserves whatever follow zoom the user had dialed in.
        if (!prevId) followZoom.value = clamp(zoom.value, 0.6, 8)
        if (!followRaf) followRaf = requestAnimationFrame(followStep)
      } else {
        stopFollow()
        // Hand back to auto zoom / focus framing if either is still enabled.
        if (autoActive() && !autoRaf) autoRaf = requestAnimationFrame(autoStep)
      }
    },
  )

  /** Kick the auto-zoom loop when framing is set from the start (e.g. an embedded
   *  clip): unlike the autoZoom toggle, it has no off->on edge for the watch to
   *  catch. Call once the canvas has been laid out (after the first resize). */
  function kickIfFocused() {
    if ((opts.focusSteamIds()?.length || opts.focusWorld()) && !autoRaf) {
      autoRaf = requestAnimationFrame(autoStep)
    }
  }

  onUnmounted(() => {
    stopAuto()
    stopFollow()
  })

  return { followZoom, autoActive, stopAuto, stopFollow, kickIfFocused }
}
