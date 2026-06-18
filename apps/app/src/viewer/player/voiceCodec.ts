/**
 * CLV2 voice container codec: the single source of truth for the binary format
 * that carries player voice (raw Opus frames) outside the JSON `Replay`.
 *
 * The Rust parser (`packages/parser/src/lib.rs`, `build_voice_blob`) emits this
 * blob when parsing a demo, and the parse worker decodes it with
 * `parseVoiceBlob`. The `.cs2dv` export re-encodes voice with `buildVoiceBlob`
 * (the byte-compatible inverse) so an imported demo carries the exact same comms
 * without re-parsing the `.dem`.
 *
 * Layout (little-endian):
 *   magic u32, sampleRate u32, tickRate u32, playerCount u32;
 *   per player: steamId u64, packetCount u32;
 *   per packet: tick u32, level f32, len u32, opus[len].
 */
import type { VoiceData, VoiceTrack } from '@/viewer/domain/schema'

/** Magic of the voice container ("CLV2", little-endian). */
export const VOICE_MAGIC = 0x32564c43

/**
 * Decodes a binary CLV2 blob into a `VoiceData` structure. Returns an empty
 * track list when the blob is missing/too short or has the wrong magic.
 */
export function parseVoiceBlob(blob: Uint8Array): VoiceData {
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  let o = 0
  if (blob.byteLength < 16 || dv.getUint32(o, true) !== VOICE_MAGIC) {
    return { sampleRate: 48000, tickRate: 64, tracks: [] }
  }
  o += 4
  const sampleRate = dv.getUint32(o, true)
  o += 4
  const tickRate = dv.getUint32(o, true)
  o += 4
  const playerCount = dv.getUint32(o, true)
  o += 4

  const tracks: VoiceTrack[] = []
  for (let i = 0; i < playerCount; i++) {
    const steamId = dv.getBigUint64(o, true).toString()
    o += 8
    const packetCount = dv.getUint32(o, true)
    o += 4
    const packets = new Array(packetCount)
    for (let j = 0; j < packetCount; j++) {
      const tick = dv.getUint32(o, true)
      o += 4
      const level = dv.getFloat32(o, true)
      o += 4
      const len = dv.getUint32(o, true)
      o += 4
      // Copy the slice into its own buffer (the source blob may be discarded).
      packets[j] = { tick, level, data: blob.slice(o, o + len) }
      o += len
    }
    tracks.push({ steamId, packets })
  }
  return { sampleRate, tickRate, tracks }
}

/**
 * Encodes a `VoiceData` structure into a CLV2 blob: the inverse of
 * `parseVoiceBlob`, byte-compatible with the Rust `build_voice_blob`. The
 * round-trip is exact except for f32 precision on each packet's `level`.
 */
export function buildVoiceBlob(voice: VoiceData): Uint8Array {
  const tracks = voice.tracks ?? []

  // Pass 1: total byte size, so everything lands in one buffer (no growing).
  let size = 16 // header: magic + sampleRate + tickRate + playerCount
  for (const track of tracks) {
    size += 8 + 4 // steamId u64 + packetCount u32
    for (const p of track.packets) size += 12 + p.data.byteLength // tick + level + len + opus
  }

  // Pass 2: write.
  const buf = new ArrayBuffer(size)
  const dv = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let o = 0
  dv.setUint32(o, VOICE_MAGIC, true)
  o += 4
  dv.setUint32(o, voice.sampleRate || 48000, true)
  o += 4
  dv.setUint32(o, voice.tickRate || 64, true)
  o += 4
  dv.setUint32(o, tracks.length, true)
  o += 4
  for (const track of tracks) {
    let steamId: bigint
    try {
      steamId = BigInt(track.steamId)
    } catch {
      steamId = 0n
    }
    dv.setBigUint64(o, steamId, true)
    o += 8
    dv.setUint32(o, track.packets.length, true)
    o += 4
    for (const p of track.packets) {
      dv.setUint32(o, p.tick >>> 0, true)
      o += 4
      dv.setFloat32(o, p.level ?? 0, true)
      o += 4
      dv.setUint32(o, p.data.byteLength, true)
      o += 4
      bytes.set(p.data, o)
      o += p.data.byteLength
    }
  }
  return bytes
}
