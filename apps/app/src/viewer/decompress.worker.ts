/**
 * Throwaway Web Worker that turns an uploaded file into the raw `.dem` bytes
 * (decompressing `.gz` / `.zip` / `.zst` as needed). It runs in its own worker
 * so that, once the caller terminates it, the WebAssembly linear memory grown
 * by the zstd decoder — which can reach ~640MB for a large demo and never
 * shrinks — is fully reclaimed before the parser runs. Keeping decompression in
 * the same worker as the parser made big `.zst` demos run out of memory.
 */
import { isCompressed, toRawDemo } from './decompress'

export interface DecompressRequest {
  buffer: ArrayBuffer
}

export type DecompressResponse =
  | { type: 'progress'; phase: 'decompressing' }
  | { type: 'result'; ok: true; buffer: ArrayBuffer; rawSize: number }
  | { type: 'result'; ok: false; error: string }

self.onmessage = async (e: MessageEvent<DecompressRequest>) => {
  try {
    const input = new Uint8Array(e.data.buffer)
    // Tell the UI we're decompressing before the (blocking) decode starts. Raw
    // `.dem` uploads skip this and fall straight through.
    if (isCompressed(input)) {
      const progress: DecompressResponse = { type: 'progress', phase: 'decompressing' }
      self.postMessage(progress)
    }
    const raw = await toRawDemo(input)
    // Transfer the underlying buffer. The decoders already return a tightly-
    // sized buffer they own, so avoid an extra ~370MB copy in the common case;
    // only copy if `raw` happens to be a partial view into a larger buffer.
    const out = (
      raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
        ? raw.buffer
        : raw.slice().buffer
    ) as ArrayBuffer
    const res: DecompressResponse = { type: 'result', ok: true, buffer: out, rawSize: out.byteLength }
    self.postMessage(res, { transfer: [out] })
  } catch (err) {
    const res: DecompressResponse = {
      type: 'result',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(res)
  }
}
