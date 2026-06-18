/**
 * Web Worker that parses a CS2 `.dem` demo in the browser, off the main thread.
 * Loads the WebAssembly module (generated from the Rust crate in
 * `packages/parser`) and returns the `Replay` already in the
 * `@/viewer/schema` format, along with player voice (comms). No demo byte
 * leaves the machine.
 */
import init, { parse_demo } from './parser/demo_parser.js'
import type { VoiceData } from '@/viewer/schema'
import { parseVoiceBlob } from '@/viewer/voiceCodec'

export interface ParseRequest {
  buffer: ArrayBuffer
  frameRate?: number
}

export type ParseResponse =
  | { type: 'progress'; phase: 'parsing' | 'building' | 'serializing'; tick?: number; totalTicks?: number }
  | { type: 'result'; ok: true; replay: unknown; voice: VoiceData }
  | { type: 'result'; ok: false; error: string }

// Initializes the wasm only once (idempotent across messages).
let ready: Promise<unknown> | null = null

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { buffer, frameRate = 8 } = e.data
  try {
    if (!ready) ready = init()
    await ready
    // `buffer` is already the raw `.dem` (decompression happens earlier, in a
    // separate throwaway worker — see `useDemoParser`).
    const dem = new Uint8Array(buffer)
    // The parser reports real progress via this callback (same thread, but the
    // posted messages reach the main thread live): stage 0 = parsing (per tick),
    // 1 = building the replay, 2 = serializing.
    const onProgress = (stage: number, tick: number, totalTicks: number) => {
      if (stage === 0) {
        self.postMessage({ type: 'progress', phase: 'parsing', tick, totalTicks } satisfies ParseResponse)
      } else if (stage === 1) {
        self.postMessage({ type: 'progress', phase: 'building' } satisfies ParseResponse)
      } else {
        self.postMessage({ type: 'progress', phase: 'serializing' } satisfies ParseResponse)
      }
    }
    // Switch the label to "parsing" instantly, before the first tick is reported.
    self.postMessage({ type: 'progress', phase: 'parsing' } satisfies ParseResponse)
    const out = parse_demo(dem, frameRate, onProgress)
    // JS-side finalization: turning the parser's big JSON string into objects.
    self.postMessage({ type: 'progress', phase: 'serializing' } satisfies ParseResponse)
    const replay = JSON.parse(out.replay)
    const voice = parseVoiceBlob(out.voice)
    out.free()

    // Transfer each packet's buffer (zero-copy) to the main thread.
    const transfer = voice.tracks.flatMap((t) => t.packets.map((p) => p.data.buffer))
    const res: ParseResponse = { type: 'result', ok: true, replay, voice }
    self.postMessage(res, { transfer })
  } catch (err) {
    const res: ParseResponse = {
      type: 'result',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(res)
  }
}
