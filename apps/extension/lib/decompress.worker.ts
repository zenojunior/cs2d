/**
 * Throwaway worker that turns a downloaded demo into the raw `.dem` bytes
 * (gzip / zstd / raw). It exists so the caller can terminate it afterwards: the
 * zstd decoder's WASM linear memory (hundreds of MB for a big demo) never
 * shrinks, and keeping it alive in the offscreen document while the parser runs
 * made large demos crash the extension. Mirrors the web app's decompress worker.
 */
import { init as zstdInitRaw, decompress as zstdDecompress } from '@bokuweb/zstd-wasm'

export interface DecompressRequest {
  /** The downloaded file, kept as a Blob so it never sits whole in a JS heap
   *  until a decoder actually needs it. */
  blob: Blob
  /** Extension URL of zstd.wasm (workers have no `chrome.runtime`). */
  zstdUrl: string
}

export type DecompressResponse =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; error: string }

const zstdInit = zstdInitRaw as (path?: string) => Promise<void>

self.onmessage = async (e: MessageEvent<DecompressRequest>) => {
  try {
    const { blob, zstdUrl } = e.data
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    let raw: Uint8Array
    if (head[0] === 0x1f && head[1] === 0x8b) {
      // Streamed straight from the blob: the compressed bytes are never copied.
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
      raw = new Uint8Array(await new Response(stream).arrayBuffer())
    } else if (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) {
      await zstdInit(zstdUrl)
      raw = zstdDecompress(new Uint8Array(await blob.arrayBuffer()))
    } else {
      raw = new Uint8Array(await blob.arrayBuffer()) // assume raw PBDEMS2
    }
    // Transfer the buffer (no copy); only copy if `raw` is a partial view.
    const out = (
      raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength ? raw.buffer : raw.slice().buffer
    ) as ArrayBuffer
    const res: DecompressResponse = { ok: true, buffer: out }
    self.postMessage(res, { transfer: [out] })
  } catch (err) {
    const res: DecompressResponse = { ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(res)
  }
}
