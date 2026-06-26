import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { Round, Side, VoiceData } from '@/viewer/domain/schema'

/**
 * Plays the players' voices (demo comms) synced with the 2D replay.
 *
 * Voice comes from the parser as raw per-player Opus packets, in absolute demo
 * ticks. Each round we decode (WebCodecs `AudioDecoder`, native Opus) that round's
 * packets into one `AudioBuffer` per speaker, aligned to round time, and play them
 * routing volume per team (CT/T buses).
 *
 * Audio and mute are per team: each side starts muted and the user enables the
 * team they want to hear (the first click also starts the `AudioContext`, required
 * by the autoplay policy).
 *
 * The "who is talking" indicator comes straight from packet timing (independent of
 * decode and mute), so it always signals comms, including from a dead player.
 */

/** Drift threshold (s) between audio and viewer that triggers a re-sync. */
const DRIFT_THRESHOLD = 0.15
/** Window (s) around the current instant to consider a player "talking". */
const TALKING_WINDOW = 0.2
/** Number of columns (resolution) of the timeline waveform. */
const WAVE_BINS = 160
/** Dynamic range (dB) shown in the waveform: the N loudest dB of the round. */
const WAVE_DYN_DB = 35

/**
 * `OpusHead` header (19 bytes) that `AudioDecoder` expects as `description` for
 * raw Opus packets (no Ogg). Pre-skip 0 to keep 1 output per packet.
 */
function opusHead(channels: number, sampleRate: number): Uint8Array {
  const b = new Uint8Array(19)
  const dv = new DataView(b.buffer)
  b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0) // "OpusHead"
  b[8] = 1 // version
  b[9] = channels
  dv.setUint16(10, 0, true) // pre-skip
  dv.setUint32(12, sampleRate, true) // input sample rate
  dv.setInt16(16, 0, true) // output gain
  b[18] = 0 // mapping family
  return b
}

interface VoicePlaybackOptions {
  voice: Ref<VoiceData | null>
  round: Ref<Round | null>
  /** Seconds since the current round's `startTick` (viewer clock). */
  currentT: Ref<number>
  playing: Ref<boolean>
  speed: Ref<number>
  /** Each player's side in the current round (to route volume per team). */
  sideById: Ref<Map<string, Side>>
}

interface PlayerVoice {
  steamId: string
  buffer: AudioBuffer
}

export function useVoicePlayback(opts: VoicePlaybackOptions) {
  const { voice, round, currentT, playing, speed, sideById } = opts

  const supported =
    typeof window !== 'undefined' && typeof window.AudioDecoder !== 'undefined'

  /** Comms audio enabled (on by default). The AudioContext is created suspended on
   *  load and resumes on the first playback (a valid user gesture), so no sound
   *  plays before the user interacts. */
  const enabled = ref(true)
  /** CT<->T balance: -1 = CT only, 0 = both at 100%, +1 = T only. */
  const balance = ref(0)
  /** Master comms volume (0 to 1), exposed in the player transport. Starts at 50%;
   *  muting drops it to 0 and unmuting restores `lastVolume`. */
  const masterVolume = ref(0.5)
  /** Volume restored when unmuting (the last non-zero level). */
  const lastVolume = ref(0.5)
  /** Muted = audio off or volume at zero (to the user, the two are the same). */
  const muted = computed(() => !enabled.value || masterVolume.value <= 0)

  let ctx: AudioContext | null = null
  let bus: Record<Side, GainNode> | null = null
  let master: GainNode | null = null
  const sampleRate = computed(() => voice.value?.sampleRate ?? 48000)
  const tickRate = computed(() => voice.value?.tickRate ?? 64)

  /** True while the current round's voice is being decoded (audio not yet
   *  playable). Drives a loading indicator on the comms control. */
  const decoding = ref(false)
  const roundVoices = shallowRef<PlayerVoice[]>([])
  const sources = new Map<string, AudioBufferSourceNode>()
  // Sync anchor: audio position = anchorT + (ctx.now - anchorCtx)*speed.
  let anchorCtx = 0
  let anchorT = 0
  let decodeToken = 0

  const anyAudible = () => enabled.value

  /** Per-team gain from the balance: the favored side stays at 100%, the other
   *  decays to 0 at the extremes. At center (0) both stay at 100%. */
  function teamGain(side: Side) {
    return side === 'CT'
      ? 1 - Math.max(0, balance.value)
      : 1 - Math.max(0, -balance.value)
  }

  function ensureCtx(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: sampleRate.value })
      // Chain: sources -> team bus (balance) -> master volume -> limiter -> output.
      // The DynamicsCompressor acts as a limiter: tames the peaks of someone with a
      // very loud mic (avoids clipping/distortion) without touching normal speakers.
      master = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16 // above this (dB) it starts compressing
      comp.knee.value = 8 // smooth transition around the threshold
      comp.ratio.value = 14 // strong (limiter): holds the peaks
      comp.attack.value = 0.003 // catches the peak fast
      comp.release.value = 0.2 // releases smoothly to avoid "pumping"
      master.connect(comp)
      comp.connect(ctx.destination)
      const ct = ctx.createGain()
      const t = ctx.createGain()
      ct.connect(master)
      t.connect(master)
      bus = { CT: ct, T: t }
      applyVolumes()
    }
    return ctx
  }

  /** Applies master volume (zero if disabled) and the balance to each bus. */
  function applyVolumes() {
    if (!bus || !master) return
    master.gain.value = enabled.value ? masterVolume.value : 0
    bus.CT.gain.value = teamGain('CT')
    bus.T.gain.value = teamGain('T')
  }

  /** Teams muted by the balance (only when audio is on), so the map can hide the
   *  mic of the team that dropped to 0%. */
  const mutedSides = computed<Record<Side, boolean>>(() => ({
    CT: enabled.value && teamGain('CT') <= 0,
    T: enabled.value && teamGain('T') <= 0,
  }))

  // -------------------------------------------------- talking indicator (data)
  // Instants (s in the round) with voice activity per player, straight from packets.
  const roundSpeech = computed<Map<string, number[]>>(() => {
    const r = round.value
    const v = voice.value
    const map = new Map<string, number[]>()
    if (!r || !v) return map
    const tr = v.tickRate || 64
    // Window spans freeze -> live -> post-round (with fallback for older replays).
    const fs = r.freezeStartTick ?? r.startTick
    const pe = r.postEndTick ?? r.endTick
    for (const track of v.tracks) {
      const offs: number[] = []
      let lastBucket = -1
      for (const p of track.packets) {
        if (p.tick < fs || p.tick > pe) continue
        const t = (p.tick - fs) / tr
        const bucket = Math.round(t * 5) // 0.2s buckets
        if (bucket !== lastBucket) {
          offs.push(t)
          lastBucket = bucket
        }
      }
      if (offs.length) map.set(track.steamId, offs)
    }
    return map
  })

  /** steamIds talking at the current instant (always, regardless of mute/audio). */
  const talking = computed<Set<string>>(() => {
    const t = currentT.value
    const set = new Set<string>()
    for (const [steamId, offs] of roundSpeech.value) {
      if (offs.some((s) => t >= s - TALKING_WINDOW && t <= s + TALKING_WINDOW)) {
        set.add(steamId)
      }
    }
    return set
  })

  // ------------------------------------------------------ waveform (timeline)
  /**
   * Voice amplitude envelope for the current round, per team, for the timeline
   * waveform. Uses each packet's `voice_level` (dB), normalized by a dynamic window
   * (the loudest WAVE_DYN_DB dB of the round). Independent of decode/mute.
   */
  const roundWaveform = computed<{ ct: number[]; t: number[] } | null>(() => {
    const r = round.value
    const v = voice.value
    if (!r || !v) return null
    const tr = v.tickRate || 64
    // Full window (freeze -> live -> post-round) so the waveform aligns with the
    // scrubber. Fallback for replays parsed before these fields existed.
    const fs = r.freezeStartTick ?? r.startTick
    const pe = r.postEndTick ?? r.endTick
    const dur = (pe - fs) / tr
    if (dur <= 0) return null
    const n = WAVE_BINS
    const ctDb = new Float32Array(n).fill(-Infinity)
    const tDb = new Float32Array(n).fill(-Infinity)
    let maxDb = -Infinity
    let any = false
    for (const track of v.tracks) {
      const side = sideById.value.get(track.steamId)
      if (side !== 'CT' && side !== 'T') continue
      const arr = side === 'CT' ? ctDb : tDb
      for (const p of track.packets) {
        if (p.tick < fs || p.tick > pe) continue
        const level = p.level
        if (level == null || level >= 0) continue // no valid voice_level
        any = true
        const frac = (p.tick - fs) / tr / dur
        const bin = Math.min(n - 1, Math.max(0, Math.floor(frac * n)))
        if (level > arr[bin]) arr[bin] = level
        if (level > maxDb) maxDb = level
      }
    }
    if (!any || maxDb === -Infinity) return null
    const floor = maxDb - WAVE_DYN_DB
    const toAmp = (db: number) =>
      db === -Infinity ? 0 : Math.max(0, Math.min(1, (db - floor) / WAVE_DYN_DB))
    return { ct: Array.from(ctDb, toAmp), t: Array.from(tDb, toAmp) }
  })

  // ------------------------------------------------------------- decode (audio)
  /** (Re)decodes the current round's voice buffers. */
  async function buildRound(r: Round | null) {
    const token = ++decodeToken
    stopSources()
    roundVoices.value = []
    if (!supported || !anyAudible() || !r || !voice.value) {
      decoding.value = false
      return
    }
    decoding.value = true
    try {
      await decodeRound(r, token)
    } finally {
      // Only clear when this is still the active decode; a newer one owns the flag.
      if (token === decodeToken) decoding.value = false
    }
  }

  /** Decodes one round's packets into per-speaker buffers (the heavy work). */
  async function decodeRound(r: Round, token: number) {
    const v = voice.value
    if (!v) return
    const audio = ensureCtx()
    const tr = tickRate.value
    const sr = sampleRate.value
    // Window spans freeze -> live -> post-round (fallback for older replays), so
    // freeze-time and post-round comms are decoded too.
    const fs = r.freezeStartTick ?? r.startTick
    const pe = r.postEndTick ?? r.endTick
    const durSec = Math.max(0, (pe - fs) / tr)
    if (durSec <= 0) return
    const totalSamples = Math.ceil(durSec * sr)

    const result: PlayerVoice[] = []
    for (const track of v.tracks) {
      const pkts = track.packets.filter((p) => p.tick >= fs && p.tick <= pe)
      if (!pkts.length) continue

      const pcm = new Float32Array(totalSamples)
      // Offset (in samples) of each packet's tick, in submission order. CS2's Opus
      // has 1 frame per packet, so the decoder emits 1 output per input, in order:
      // we match the n-th output to the n-th offset.
      const offsets = pkts.map((p) => Math.floor(((p.tick - fs) / tr) * sr))
      let outIdx = 0
      // Write cursor: several packets land on the same tick (voice is finer than the
      // 64Hz ticks), so we chain the frames of one continuous speech instead of
      // overlapping (overlap distorts). We only jump in time on real silence (the
      // tick offset passes the cursor) -> keeps the sync.
      let cursor = 0
      const dec = new AudioDecoder({
        output: (d) => {
          const frame = new Float32Array(d.numberOfFrames)
          d.copyTo(frame, { planeIndex: 0, format: 'f32-planar' })
          d.close()
          const tickOff = offsets[outIdx++] ?? cursor
          const pos = tickOff > cursor ? tickOff : cursor
          const start = Math.max(0, pos)
          const end = Math.min(pos + frame.length, totalSamples)
          for (let i = start, j = start - pos; i < end; i++, j++) pcm[i] = frame[j]
          cursor = pos + frame.length
        },
        error: () => {
          /* bad packet/config: ignore */
        },
      })
      try {
        dec.configure({
          codec: 'opus',
          sampleRate: sr,
          numberOfChannels: 1,
          description: opusHead(1, sr),
        })
      } catch {
        dec.close()
        continue
      }
      for (const p of pkts) {
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: 0, data: p.data }))
      }
      // flush() only resolves after all pending outputs have been emitted.
      await dec.flush().catch(() => {})
      dec.close()
      if (token !== decodeToken) return // round changed midway: discard

      const buffer = audio.createBuffer(1, totalSamples, sr)
      buffer.copyToChannel(pcm, 0)
      result.push({ steamId: track.steamId, buffer })
    }
    if (token !== decodeToken) return
    roundVoices.value = result
    // Engage playback if the replay is already running. This covers autoplay on
    // open, where `playing` is set before this composable mounts (so the
    // `watch(playing)` transition never fires): resume the context (allowed via
    // the page's sticky activation) and start the sources.
    if (playing.value) {
      ctx?.resume().catch(() => {})
      resync(true)
    }
  }

  // ---------------------------------------------------------- transporte (sync)
  function stopSources() {
    for (const src of sources.values()) {
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
    }
    sources.clear()
  }

  /** (Re)starts the sources at the viewer's current offset, routed per team. */
  function resync(force = false) {
    if (!ctx || !bus) return
    stopSources()
    if (!playing.value && !force) return
    if (!playing.value) return
    const offset = Math.max(0, currentT.value)
    anchorCtx = ctx.currentTime
    anchorT = offset
    for (const pv of roundVoices.value) {
      if (offset >= pv.buffer.duration) continue
      const side = sideById.value.get(pv.steamId) ?? 'CT'
      const src = ctx.createBufferSource()
      src.buffer = pv.buffer
      src.playbackRate.value = speed.value
      src.connect(bus[side])
      src.start(ctx.currentTime, offset)
      sources.set(pv.steamId, src)
    }
  }

  /** Expected audio position right now, from the anchor. */
  function audioPos(): number {
    if (!ctx) return 0
    return anchorT + (ctx.currentTime - anchorCtx) * speed.value
  }

  // Drift correction: cheap, on every currentT change.
  watch(currentT, () => {
    if (!ctx || !playing.value || !anyAudible()) return
    if (Math.abs(audioPos() - currentT.value) > DRIFT_THRESHOLD) resync()
  })

  watch(playing, (on) => {
    if (!ctx || !anyAudible()) return
    if (on) {
      ctx.resume()
      resync(true)
    } else {
      stopSources()
    }
  })

  watch(speed, () => {
    if (ctx && playing.value && anyAudible()) resync()
  })

  // Immediate so the round open at mount is decoded even when playback was
  // started before this composable existed (autoplay on open).
  watch(round, (r) => buildRound(r), { immediate: true })

  watch(balance, () => applyVolumes())

  watch(enabled, (on) => {
    applyVolumes()
    if (on) {
      ensureCtx().resume()
      buildRound(round.value)
    } else {
      stopSources()
    }
  })

  watch(voice, () => {
    if (anyAudible()) buildRound(round.value)
  })

  // ----------------------------------------------------------------------- api
  function toggleMute() {
    if (muted.value) {
      // Unmute: engage audio (create/resume the context within the click gesture)
      // and restore a non-zero level.
      if (supported) ensureCtx().resume().catch(() => {})
      enabled.value = true
      if (masterVolume.value <= 0) masterVolume.value = lastVolume.value > 0 ? lastVolume.value : 1
    } else {
      // Mute: remember the level so unmuting can restore it, then drop to zero
      // (muting and volume = 0 are the same state).
      lastVolume.value = masterVolume.value
      masterVolume.value = 0
    }
    applyVolumes()
  }

  /** CT<->T balance (-1 to 1). */
  function setBalance(value: number) {
    balance.value = Math.max(-1, Math.min(1, value))
    applyVolumes()
  }

  /** Master comms volume (multiplies both teams). Raising it above zero unmutes
   *  (and engages audio if it was never started). */
  function setMasterVolume(value: number) {
    const v = Math.max(0, Math.min(1, value))
    masterVolume.value = v
    if (v > 0) {
      if (supported && !enabled.value) ensureCtx().resume().catch(() => {})
      enabled.value = true
      lastVolume.value = v
    }
    applyVolumes()
  }

  onUnmounted(() => {
    stopSources()
    ctx?.close()
    ctx = null
  })

  return {
    supported,
    enabled,
    muted,
    decoding,
    balance,
    masterVolume,
    mutedSides,
    talking,
    roundWaveform,
    toggleMute,
    setBalance,
    setMasterVolume,
  }
}
