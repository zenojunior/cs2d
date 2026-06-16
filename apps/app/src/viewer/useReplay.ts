import { computed, onUnmounted, ref, shallowRef } from 'vue'
import type { PlayerMeta, PlayerState, Replay, Round, Side } from '@/viewer/schema'

/** Playback speeds offered in the controls. */
export const SPEEDS = [1, 2, 4, 8] as const

/** Regulation round time (1:55) and bomb time (40s), competitive/FACEIT standard. */
const ROUND_TIME = 115
const BOMB_TIME = 40

export type Clock = { phase: 'round' | 'bomb'; seconds: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Interpolates angles (degrees) along the shortest path, handling the -180/180 wrap. */
function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + 540) % 360) - 180
  return a + d * t
}

/**
 * State and playback logic for a 2D replay.
 *
 * Takes a `Replay` already in memory (via `setReplay`), usually from the WASM
 * parser in the worker, and exposes positions interpolated over time so movement
 * stays smooth even with few samples per second (downsampled in the file). The
 * map component only consumes `players` (interpolated) and `currentT`.
 */
export function useReplay() {
  const replay = shallowRef<Replay | null>(null)

  const roundIndex = ref(0)
  const frameIndex = ref(0) // current base sample
  const frac = ref(0) // progress [0,1] between the base sample and the next one
  const playing = ref(false)
  const speed = ref<number>(1)

  const round = computed<Round | null>(() => replay.value?.rounds[roundIndex.value] ?? null)
  const frameCount = computed(() => round.value?.frames.length ?? 0)

  /** Positions interpolated between the base sample and the next. */
  const players = computed<PlayerState[]>(() => {
    const frames = round.value?.frames
    if (!frames || !frames.length) return []
    const a = frames[frameIndex.value]
    const b = frames[frameIndex.value + 1] ?? a
    const next = new Map(b.players.map((p) => [p.steamId, p]))
    return a.players.map((p) => {
      const q = next.get(p.steamId) ?? p
      return {
        ...p,
        x: lerp(p.x, q.x, frac.value),
        y: lerp(p.y, q.y, frac.value),
        yaw: lerpAngle(p.yaw, q.yaw, frac.value),
      }
    })
  })

  /** Current time (s) within the round, interpolated. */
  const currentT = computed(() => {
    const frames = round.value?.frames
    if (!frames || !frames.length) return 0
    const a = frames[frameIndex.value]
    const b = frames[frameIndex.value + 1] ?? a
    return lerp(a.t, b.t, frac.value)
  })

  /** Plant time (s) in the current round, if any. */
  const plantT = computed(() => {
    const ev = round.value?.events.find((e) => e.type === 'bomb_planted')
    return ev ? ev.t : null
  })

  /**
   * Tactical clock: counts the round time (1:55) down and, after the plant,
   * switches to the 40s bomb timer. The frames' `t` is already post freeze time.
   */
  const clock = computed<Clock>(() => {
    const t = currentT.value
    const pt = plantT.value
    if (pt !== null && t >= pt) {
      return { phase: 'bomb', seconds: Math.max(0, BOMB_TIME - (t - pt)) }
    }
    return { phase: 'round', seconds: Math.max(0, ROUND_TIME - t) }
  })

  /**
   * C4 LED blink, approximating the beep cadence: the interval shortens as the
   * bomb nears exploding. The phase is integrated (interval linear in time) so it
   * blinks continuously even across seek/speed changes.
   */
  const bombBlink = computed(() => {
    const pt = plantT.value
    if (pt === null) return false
    const elapsed = currentT.value - pt
    if (elapsed < 0 || elapsed > BOMB_TIME) return false
    const beepStart = 1.0 // interval (s) right after the plant
    const beepEnd = 0.1 // interval (s) near the explosion
    const k = (beepStart - beepEnd) / BOMB_TIME
    const phase = Math.log(beepStart / (beepStart - k * elapsed)) / k
    return phase % 1 < 0.5
  })

  /** Metadata by steamId, for name and starting side. */
  const playersById = computed(() => {
    const map = new Map<string, PlayerMeta>()
    for (const p of replay.value?.players ?? []) map.set(p.steamId, p)
    return map
  })

  /** Each player's side in the current round (constant within the round). */
  const sideById = computed(() => {
    const map = new Map<string, Side>()
    for (const p of round.value?.frames[0]?.players ?? []) map.set(p.steamId, p.side)
    return map
  })

  /**
   * Knife round: some servers (FACEIT, scrims) open with a knife-only round to
   * pick sides. It does not count on the scoreboard, so we detect it by the
   * absence of any weapon other than the knife across all samples and treat it as
   * round 0.
   */
  const hasKnifeRound = computed(() => {
    const r0 = replay.value?.rounds[0]
    if (!r0) return false
    return r0.frames.every((f) =>
      f.players.every((p) => p.weapon === 'Faca' || p.weapon === ''),
    )
  })

  /** Label shown per round (knife becomes "0" and shifts the rest). */
  const roundLabels = computed(() =>
    (replay.value?.rounds ?? []).map((r, i) =>
      String(hasKnifeRound.value ? i : r.number),
    ),
  )

  /** Count of "real" rounds (excludes the knife round). */
  const totalRounds = computed(() => {
    const n = replay.value?.rounds.length ?? 0
    return hasKnifeRound.value ? n - 1 : n
  })

  const currentRoundLabel = computed(() => roundLabels.value[roundIndex.value] ?? '')

  /**
   * Score per team entering the current round, placed by the current side (CT/T).
   * Comes straight from the demo (CCSTeam.m_iScore), so it already handles the
   * side swap at halftime and overtime, and ignores the knife round.
   */
  const score = computed<Record<Side, number>>(() => {
    const r = round.value
    return { CT: r?.scoreCt ?? 0, T: r?.scoreT ?? 0 }
  })

  /** Loads a replay already in memory (e.g. from the WASM parser in the worker). */
  function setReplay(r: Replay) {
    pause()
    replay.value = r
    roundIndex.value = 0
    frameIndex.value = 0
    frac.value = 0
  }

  function selectRound(i: number) {
    if (!replay.value) return
    roundIndex.value = Math.max(0, Math.min(i, replay.value.rounds.length - 1))
    frameIndex.value = 0
    frac.value = 0
  }

  function seek(i: number) {
    frameIndex.value = Math.max(0, Math.min(i, frameCount.value - 1))
    frac.value = 0
  }

  /** Moves forward (or back) `delta` seconds within the round, to the nearest frame. */
  function seekBySeconds(delta: number) {
    const frames = round.value?.frames
    if (!frames || !frames.length) return
    const target = currentT.value + delta
    let best = 0
    let bestDiff = Infinity
    for (let i = 0; i < frames.length; i++) {
      const d = Math.abs(frames[i].t - target)
      if (d < bestDiff) {
        bestDiff = d
        best = i
      }
    }
    seek(best)
  }

  // --- Playback loop (real time, respecting frameRate and speed) ---
  let raf = 0
  let last = 0

  function tick(now: number) {
    if (!playing.value) return
    if (!last) last = now
    const dt = now - last
    last = now

    const frameMs = 1000 / (replay.value?.frameRate ?? 8)
    // continuous position (in samples), advanced by real elapsed time
    const pos = frameIndex.value + frac.value + (dt * speed.value) / frameMs

    // We always stop at the end of the round: advancing to the next round is manual.
    if (pos >= frameCount.value - 1) {
      frameIndex.value = Math.max(0, frameCount.value - 1)
      frac.value = 0
      pause()
      return
    }

    frameIndex.value = Math.floor(pos)
    frac.value = pos - frameIndex.value
    raf = requestAnimationFrame(tick)
  }

  function play() {
    if (playing.value || !replay.value) return
    playing.value = true
    last = 0
    raf = requestAnimationFrame(tick)
  }

  function pause() {
    playing.value = false
    cancelAnimationFrame(raf)
  }

  function toggle() {
    playing.value ? pause() : play()
  }

  onUnmounted(pause)

  return {
    replay,
    roundIndex,
    frameIndex,
    frameCount,
    playing,
    speed,
    round,
    players,
    currentT,
    clock,
    bombBlink,
    playersById,
    sideById,
    score,
    hasKnifeRound,
    roundLabels,
    totalRounds,
    currentRoundLabel,
    setReplay,
    selectRound,
    seek,
    seekBySeconds,
    play,
    pause,
    toggle,
  }
}
