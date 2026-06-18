/**
 * `.cs2dv` archive codec: packs an already-parsed demo (replay + voice +
 * comments) into a single shareable file, and reads it back. The whole point is
 * that importing skips the WASM parser entirely: the replay is hydrated directly.
 *
 * On-disk file = `gzip(container)`. The container is binary so the Opus voice
 * rides along without base64 bloat:
 *
 *   magic "CS2DV1" (6 ASCII bytes)
 *   then four length-prefixed sections, each `u32 len` (LE) + payload:
 *     1. meta     JSON (utf8)
 *     2. replay   JSON (utf8)
 *     3. voice    CLV2 binary (empty when the demo has no comms)
 *     4. comments JSON (utf8)
 *
 * gzip/gunzip use the native `CompressionStream`/`DecompressionStream` (the app
 * already relies on the latter in `decompress.ts`), so there are no extra deps
 * and the heavy lifting runs off the JS heap.
 */
import type { Replay, ReplayComment, VoiceData } from '@/viewer/domain/schema'
import { buildVoiceBlob, parseVoiceBlob } from '@/viewer/player/voiceCodec'

const MAGIC = 'CS2DV1'
/** Bumped when the container layout changes in a breaking way. */
export const ARCHIVE_VERSION = 1

/** Light header describing the archive (also drives the recents entry on import). */
export interface ArchiveMeta {
  /** Format tag, for a clear error on unrelated files. */
  format: 'cs2dv'
  version: number
  /** Original demo file name (e.g. "match.dem"). */
  fileName: string
  map: string
  scoreCt: number
  scoreT: number
  hasVoice: boolean
  /** Epoch ms when this archive was exported. */
  exportedAt: number
  /** Replay generator tag (`Replay.generatedBy`), for diagnostics. */
  generatedBy?: string
}

/** Everything an import yields, ready to hydrate the viewer and persist. */
export interface DemoArchive {
  meta: ArchiveMeta
  replay: Replay
  voice: VoiceData | null
  comments: ReplayComment[]
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** gzip via the browser-native streaming compressor. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** gunzip via the browser-native streaming decompressor (same as decompress.ts). */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Concatenates the magic + four length-prefixed sections into one buffer. */
function encodeContainer(sections: Uint8Array[]): Uint8Array {
  const magic = textEncoder.encode(MAGIC)
  let total = magic.length
  for (const s of sections) total += 4 + s.length

  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let o = 0
  bytes.set(magic, o)
  o += magic.length
  for (const s of sections) {
    dv.setUint32(o, s.length, true)
    o += 4
    bytes.set(s, o)
    o += s.length
  }
  return bytes
}

/**
 * Serializes a parsed demo to a `.cs2dv` Blob. `JSON.stringify(replay)` and the
 * gzip run on the main thread, so call this behind an explicit action with a
 * busy indicator.
 */
export async function exportArchive(data: {
  fileName: string
  replay: Replay
  voice: VoiceData | null
  comments: ReplayComment[]
}): Promise<Blob> {
  const meta: ArchiveMeta = {
    format: 'cs2dv',
    version: ARCHIVE_VERSION,
    fileName: data.fileName,
    map: data.replay.map,
    scoreCt: data.replay.finalScoreCt ?? 0,
    scoreT: data.replay.finalScoreT ?? 0,
    hasVoice: (data.voice?.tracks?.length ?? 0) > 0,
    exportedAt: Date.now(),
    generatedBy: data.replay.generatedBy,
  }

  const container = encodeContainer([
    textEncoder.encode(JSON.stringify(meta)),
    textEncoder.encode(JSON.stringify(data.replay)),
    data.voice ? buildVoiceBlob(data.voice) : new Uint8Array(0),
    textEncoder.encode(JSON.stringify(data.comments ?? [])),
  ])

  const gz = await gzip(container)
  return new Blob([gz as BlobPart], { type: 'application/gzip' })
}

/** Reads a `.cs2dv` file back into its parts. Throws a user-facing message on
 *  a corrupt or unrelated file. */
export async function importArchive(file: Blob): Promise<DemoArchive> {
  let container: Uint8Array
  try {
    container = await gunzip(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('Não foi possível ler o arquivo: ele não é um .cs2dv válido.')
  }

  const magic = textEncoder.encode(MAGIC)
  if (container.length < magic.length || !magic.every((b, i) => container[i] === b)) {
    throw new Error('Arquivo .cs2dv inválido ou corrompido.')
  }

  const dv = new DataView(container.buffer, container.byteOffset, container.byteLength)
  let o = magic.length
  function readSection(): Uint8Array {
    if (o + 4 > container.length) throw new Error('Arquivo .cs2dv truncado.')
    const len = dv.getUint32(o, true)
    o += 4
    if (o + len > container.length) throw new Error('Arquivo .cs2dv truncado.')
    const slice = container.subarray(o, o + len)
    o += len
    return slice
  }

  const meta = JSON.parse(textDecoder.decode(readSection())) as ArchiveMeta
  if (meta?.format !== 'cs2dv') throw new Error('Formato de arquivo desconhecido.')
  if (meta.version > ARCHIVE_VERSION) {
    throw new Error('Este replay foi exportado por uma versão mais nova do app. Atualize para abri-lo.')
  }

  const replay = JSON.parse(textDecoder.decode(readSection())) as Replay
  const voiceBytes = readSection()
  const voice = voiceBytes.length ? parseVoiceBlob(voiceBytes) : null
  const commentsBytes = readSection()
  const comments = commentsBytes.length
    ? (JSON.parse(textDecoder.decode(commentsBytes)) as ReplayComment[])
    : []

  return { meta, replay, voice, comments }
}

/** Suggests a download name: strips demo/compression extensions, appends .cs2dv. */
export function archiveFileName(fileName: string): string {
  const base =
    fileName
      .replace(/\.(gz|zip|zst|bz2|cs2dv)$/i, '')
      .replace(/\.dem$/i, '')
      .trim() || 'replay'
  return `${base}.cs2dv`
}
