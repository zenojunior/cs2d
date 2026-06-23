import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { PlayerMeta, PlayerState, Replay, Round, Side } from '@/viewer/domain/schema'
import { preGameRoundCount, roundDisplayLabels, roundSides } from '@/viewer/analysis/utilityStats'

/** Playback speeds offered in the controls. */
export const SPEEDS = [1, 2, 4, 8] as const

/** Regulation round time (1:55) and bomb time (40s), competitive/FACEIT standard. */
const ROUND_TIME = 115
const BOMB_TIME = 40

export type Clock = { phase: 'freeze' | 'round' | 'bomb' | 'paused' | 'post'; seconds: number }

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
  /** When set, reaching the end of a round rolls straight into the next one. */
  const autoAdvance = useLocalStorage('viewer.advanced.autoAdvance', false)
  /**
   * When set, switching rounds (and the initial load) starts right after the
   * freeze time instead of playing it. Handy for matches without comms (e.g.
   * majors), where the buy period has nothing to watch. The freeze still stays
   * scrubbable to the left.
   *
   * Two layers: a persistent user preference (toggled in the UI) and a transient
   * per-view force (set via `forceSkipFreeze`, e.g. opening a Major clip with
   * `?skipFreeze=1`). `skipFreeze` reads as `forced || preference`; toggling it
   * off in the UI clears the force and writes the preference, so the toggle
   * always wins and the Major default never leaks into the saved preference.
   */
  const skipFreezePref = useLocalStorage('viewer.advanced.skipFreeze', false)
  const skipFreezeForced = ref(false)
  const skipFreeze = computed<boolean>({
    get: () => skipFreezeForced.value || skipFreezePref.value,
    set: (v) => {
      skipFreezeForced.value = false
      skipFreezePref.value = v
    },
  })
  /** Transient per-view override (does not touch the saved preference). */
  function forceSkipFreeze(v: boolean) {
    skipFreezeForced.value = v
  }

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

  /** Actual explosion time (s) in the current round, if the bomb went off. */
  const explodeT = computed(() => {
    const ev = round.value?.events.find((e) => e.type === 'bomb_exploded')
    return ev ? ev.t : null
  })

  /**
   * Round timeline in seconds from `t = 0` (freeze start). Marks where the round
   * goes live, when it was decided, the official end, and the total duration
   * (which now spans freeze -> live -> post-round). Falls back gracefully for
   * replays parsed before these fields existed (freeze/post collapse to 0).
   */
  const timeline = computed(() => {
    const r = round.value
    const tr = replay.value?.demoTickRate || 64
    if (!r) return { liveStart: 0, decided: 0, roundEnd: 0, duration: 0 }
    const fs = r.freezeStartTick ?? r.startTick
    const liveStart = (r.startTick - fs) / tr
    const decided = ((r.decidedTick ?? r.endTick) - fs) / tr
    const roundEnd = (r.endTick - fs) / tr
    const frames = r.frames
    const duration = frames.length ? frames[frames.length - 1].t : roundEnd
    return { liveStart, decided, roundEnd, duration }
  })

  /**
   * Tactical clock: shows the freeze countdown during the buy period, then the
   * round time (1:55) and, after the plant, the 40s bomb timer. `t = 0` is the
   * start of freeze time, so the live round time is offset by `liveStart`.
   */
  const clock = computed<Clock>(() => {
    const t = currentT.value
    const { liveStart, decided, roundEnd } = timeline.value
    // Paused: during a tactical timeout / tech pause the game clock is frozen, so
    // show "paused" instead of a running timer. The current absolute tick is the
    // round's freeze start plus the elapsed round time.
    const r = round.value
    const pauses = replay.value?.pauses
    if (r && pauses?.length) {
      const fs = r.freezeStartTick ?? r.startTick
      const tick = fs + t * (replay.value?.demoTickRate || 64)
      if (pauses.some((p) => tick >= p.startTick && tick < p.endTick)) {
        return { phase: 'paused', seconds: 0 }
      }
    }
    if (t < liveStart) {
      return { phase: 'freeze', seconds: Math.max(0, liveStart - t) }
    }
    // Post-round: once the round is decided (bomb blew, defuse, last kill) the game
    // keeps running for a few seconds before the side switch / next freeze. Count
    // down to the official round end instead of holding a red 0:00. The bomb's
    // explosion is what decides those rounds, so its tick starts this phase.
    const xt = explodeT.value
    const postStart = xt !== null ? xt : decided
    if (t >= postStart) {
      return { phase: 'post', seconds: Math.max(0, roundEnd - t) }
    }
    const pt = plantT.value
    if (pt !== null && t >= pt) {
      // Anchor the countdown to the real explosion tick when the bomb went off,
      // so 0:00 lands exactly on the detonation (the demo's plant->explosion gap
      // isn't precisely BOMB_TIME). Fall back to the theoretical 40s otherwise
      // (defused / round ended before it blew).
      const seconds = xt !== null ? Math.max(0, xt - t) : Math.max(0, BOMB_TIME - (t - pt))
      return { phase: 'bomb', seconds }
    }
    return { phase: 'round', seconds: Math.max(0, ROUND_TIME - (t - liveStart)) }
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

  /** Each player's side in the current round (constant within the round). Read
   * from the live frames so the pistol round's post-knife side swap doesn't
   * invert CT/T (see `roundSides`). */
  const sideById = computed(() =>
    round.value ? roundSides(round.value) : new Map<string, Side>(),
  )

  /**
   * Leading pre-game rounds: the knife round (FACEIT/scrims open with one to
   * pick sides) plus any frameless "result" round emitted next to it (Gamers
   * Club). They do not count on the scoreboard, so they are labeled "0" and the
   * real rounds are numbered from 1 (see `roundDisplayLabels`).
   */
  const preGameCount = computed(() => preGameRoundCount(replay.value?.rounds ?? []))
  const hasKnifeRound = computed(() => preGameCount.value > 0)

  /** Label shown per round (pre-game rounds become "0" and shift the rest). */
  const roundLabels = computed(() => roundDisplayLabels(replay.value?.rounds ?? []))

  /** Count of "real" rounds (excludes the pre-game rounds). */
  const totalRounds = computed(() => {
    const n = replay.value?.rounds.length ?? 0
    return n - preGameCount.value
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
    // Open on the first round that actually has frames. Some platforms (Gamers
    // Club) emit a leading frameless "result" round for the knife; starting
    // there would show an empty map.
    const startIdx = r.rounds.findIndex((rd) => rd.frames.length > 0)
    roundIndex.value = startIdx < 0 ? 0 : startIdx
    // With skipFreeze on, open past that round's freeze (the freeze stays
    // scrubbable to the left); otherwise start at frame 0 so it plays too.
    const first = r.rounds[roundIndex.value]
    frameIndex.value = first && skipFreeze.value ? liveFrame(first) : 0
    frac.value = 0
  }

  /** First frame at or after `t` seconds (binary-ish linear scan). */
  function frameAtT(frames: Round['frames'], t: number): number {
    if (t <= 0) return 0
    for (let j = 0; j < frames.length; j++) {
      if (frames[j].t >= t) return j
    }
    return Math.max(0, frames.length - 1)
  }

  /** Frame index where the round goes live (right after the freeze time). */
  function liveFrame(r: Round): number {
    const fs = r.freezeStartTick ?? r.startTick
    const liveT = (r.startTick - fs) / (replay.value?.demoTickRate || 64)
    return frameAtT(r.frames, liveT)
  }

  function selectRound(i: number) {
    if (!replay.value) return
    const idx = Math.max(0, Math.min(i, replay.value.rounds.length - 1))
    roundIndex.value = idx
    frac.value = 0
    // Start at the live round (the freeze stays to the left, scrubbable).
    frameIndex.value = liveFrame(replay.value.rounds[idx])
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

    // End of the round. With autoAdvance on, roll into the next round and keep
    // playing; otherwise stop here (advancing is manual).
    if (pos >= frameCount.value - 1) {
      const lastRound = replay.value ? replay.value.rounds.length - 1 : 0
      if (autoAdvance.value && roundIndex.value < lastRound) {
        const next = replay.value!.rounds[roundIndex.value + 1]
        roundIndex.value = roundIndex.value + 1
        // With skipFreeze on, jump past the freeze time; otherwise start at
        // frame 0 so the freeze plays too.
        frameIndex.value = skipFreeze.value ? liveFrame(next) : 0
        frac.value = 0
        last = 0 // reset timing so the gap between rounds isn't counted as elapsed
        raf = requestAnimationFrame(tick)
        return
      }
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
    autoAdvance,
    skipFreeze,
    forceSkipFreeze,
    round,
    players,
    currentT,
    timeline,
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
