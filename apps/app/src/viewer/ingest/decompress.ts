/**
 * Detects the container/compression of an uploaded demo by its magic bytes and
 * returns the raw `.dem` bytes ready for the WASM parser. Runs in the Web Worker
 * (off the main thread). Supported inputs:
 *
 *   - `.dem`      raw CS2 demo (magic `PBDEMS2`) / CS:GO (`HL2DEMO`) — passthrough
 *   - `.dem.gz`   gzip — native `DecompressionStream` (Faceit serves these)
 *   - `.zip`      zip container — first `.dem` entry, via fflate
 *   - `.dem.zst`  zstandard — via the libzstd WASM build (`@bokuweb/zstd-wasm`)
 *
 * We use the reference libzstd (compiled to WASM) rather than the pure-JS
 * `fzstd`, which has a Huffman-table decoding bug that rejects some perfectly
 * valid demos (e.g. large GOTV `.dem.zst`) with "invalid zstd data".
 *
 * bzip2 (`.dem.bz2`) is intentionally not supported yet (no native API and a
 * heavier dependency); it fails with a clear, actionable message.
 */
import { unzipSync } from 'fflate'
import { init as zstdInitRaw, decompress as zstdDecompress } from '@bokuweb/zstd-wasm'

// The bundled types resolve to the Node build's `init()` (no args), but the web
// build accepts an explicit wasm path — re-type it so we can pass our own URL.
const zstdInit = zstdInitRaw as (path?: string) => Promise<void>

// Stable URL for the libzstd wasm, served from `public/` (see ensureZstd).
const ZSTD_WASM_URL = '/zstd.wasm'

/** Whether `bytes` starts with the given byte signature. */
function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false
  }
  return true
}

const GZIP = [0x1f, 0x8b]
const ZSTD = [0x28, 0xb5, 0x2f, 0xfd]
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const BZIP2 = [0x42, 0x5a, 0x68] // "BZh"

/** Whether `bytes` is a compressed/packed container (i.e. not a raw `.dem`). */
export function isCompressed(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, GZIP) ||
    startsWith(bytes, ZSTD) ||
    startsWith(bytes, ZIP) ||
    startsWith(bytes, BZIP2)
  )
}

/** Loads the libzstd WASM module once; reused across uploads. */
let zstdReady: Promise<void> | undefined
function ensureZstd(): Promise<void> {
  // Load the wasm from a stable public URL (`/zstd.wasm`, kept in sync by
  // `scripts/sync-zstd-wasm.mjs`). The package's default `new URL('./zstd.wasm',
  // import.meta.url)` is mis-resolved by Vite's dev server inside a Web Worker
  // (it serves index.html, so the wasm fails to compile).
  return (zstdReady ??= zstdInit(ZSTD_WASM_URL))
}

/** zstandard via the libzstd WASM build (lazy-inits the module on first use). */
async function unzstd(bytes: Uint8Array): Promise<Uint8Array> {
  await ensureZstd()
  return zstdDecompress(bytes)
}

/** gzip via the browser-native streaming decompressor (works in workers). */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** Picks the `.dem` entry from a zip (or the largest entry as a fallback). */
function pickDemFromZip(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes)
  const names = Object.keys(files)
  if (names.length === 0) throw new Error('O arquivo .zip está vazio.')
  const dem = names.find((n) => n.toLowerCase().endsWith('.dem'))
  const chosen = dem ?? names.reduce((a, b) => (files[b].length > files[a].length ? b : a))
  return files[chosen]
}

/**
 * Returns the raw `.dem` bytes for `input`, decompressing/unpacking if needed.
 * Throws with a user-facing message for unsupported or empty containers.
 */
export async function toRawDemo(input: Uint8Array): Promise<Uint8Array> {
  if (startsWith(input, GZIP)) return gunzip(input)
  if (startsWith(input, ZSTD)) return unzstd(input)
  if (startsWith(input, ZIP)) return pickDemFromZip(input)
  if (startsWith(input, BZIP2)) {
    throw new Error('Demos .bz2 ainda não são suportadas. Descomprima para .dem antes de enviar.')
  }
  // Anything else is assumed to be a raw demo (PBDEMS2 / HL2DEMO).
  return input
}
