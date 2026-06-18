// Node-side encoder for the `.cs2dv` archive, kept byte-compatible with the
// browser reader in src/viewer/ingest/demoArchive.ts:
//   gzip( magic "CS2DV1" + 4× [u32 LE length + payload] : meta, replay, voice, comments )
// gzip is RFC1952, so the browser's DecompressionStream('gzip') reads it back.
import { gzipSync } from 'node:zlib'

const MAGIC = 'CS2DV1'
export const ARCHIVE_VERSION = 1

function lenPrefixed(buf) {
  const head = Buffer.alloc(4)
  head.writeUInt32LE(buf.length, 0)
  return Buffer.concat([head, buf])
}

/**
 * Encodes a parsed replay into a `.cs2dv` gzip Buffer. `voice`/`comments` are
 * optional binary/array sections; the majors carry neither, so they default empty.
 * @param {{ replay: object, fileName: string, voice?: Uint8Array|null, comments?: unknown[] }} data
 */
export function encodeArchive({ replay, fileName, voice = null, comments = [] }) {
  const meta = {
    format: 'cs2dv',
    version: ARCHIVE_VERSION,
    fileName,
    map: replay.map,
    scoreCt: replay.finalScoreCt ?? 0,
    scoreT: replay.finalScoreT ?? 0,
    hasVoice: !!(voice && voice.length),
    exportedAt: Date.now(),
    generatedBy: replay.generatedBy,
  }

  const container = Buffer.concat([
    Buffer.from(MAGIC, 'ascii'),
    lenPrefixed(Buffer.from(JSON.stringify(meta), 'utf8')),
    lenPrefixed(Buffer.from(JSON.stringify(replay), 'utf8')),
    lenPrefixed(voice && voice.length ? Buffer.from(voice) : Buffer.alloc(0)),
    lenPrefixed(Buffer.from(JSON.stringify(comments ?? []), 'utf8')),
  ])

  return gzipSync(container, { level: 9 })
}
