import { onUnmounted, ref, shallowRef } from 'vue'
import type { Replay, VoiceData } from '@/viewer/schema'
import type { ParseResponse } from '@/viewer/demoParser.worker'
import type { DecompressResponse } from '@/viewer/decompress.worker'

/** Estados do ciclo de upload + parse de uma demo. */
export type ParseStatus = 'idle' | 'reading' | 'parsing' | 'done' | 'error'

/** Fine-grained step within the `reading`/`parsing` work, for the progress UI. */
export type ParsePhase = 'reading' | 'decompressing' | 'parsing' | 'building'

/** Coarse progress (0..1) per phase — the steps are blocking, so within a phase
 * the bar holds; the label tells the user what the worker is doing. */
const PHASE_PROGRESS: Record<ParsePhase, number> = {
  reading: 0.06,
  decompressing: 0.3,
  parsing: 0.7,
  building: 0.92,
}

/**
 * Takes a `.dem` file, reads its bytes and delegates parsing to a WebAssembly
 * Web Worker. The result is a `Replay` ready for the 2D viewer. Everything runs
 * on the client, with no backend.
 */
export function useDemoParser() {
  const status = ref<ParseStatus>('idle')
  const phase = ref<ParsePhase>('reading')
  const progress = ref(0) // 0..1, phase-based
  const error = ref<string | null>(null)
  const replay = shallowRef<Replay | null>(null)
  const voice = shallowRef<VoiceData | null>(null)
  const fileName = ref('')
  const fileSize = ref(0)
  const rawSize = ref(0) // decompressed `.dem` size in bytes (0 until known)

  function setPhase(p: ParsePhase) {
    phase.value = p
    progress.value = PHASE_PROGRESS[p]
  }

  let worker: Worker | null = null

  function ensureWorker(): Worker {
    if (!worker) {
      worker = new Worker(new URL('./demoParser.worker.ts', import.meta.url), {
        type: 'module',
      })
    }
    return worker
  }

  /**
   * Decompresses the upload (`.gz` / `.zip` / `.zst`) in a dedicated worker that
   * is terminated as soon as it returns the raw `.dem`. This reclaims the
   * grow-only WASM memory the zstd decoder allocates (~640MB for a large demo)
   * before the parser runs, so big `.zst` demos don't exhaust the worker's
   * memory. Raw `.dem` uploads pass straight through.
   */
  function decompress(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const w = new Worker(new URL('./decompress.worker.ts', import.meta.url), {
      type: 'module',
    })
    return new Promise<ArrayBuffer>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<DecompressResponse>) => {
        const msg = e.data
        if (msg.type === 'progress') {
          setPhase(msg.phase)
          return
        }
        w.terminate()
        if (msg.ok) {
          rawSize.value = msg.rawSize
          resolve(msg.buffer)
        } else {
          reject(new Error(msg.error))
        }
      }
      // If the worker dies (e.g. the browser kills it for running out of memory
      // on a very large demo), surface it instead of hanging forever.
      w.onerror = (ev) => {
        w.terminate()
        reject(new Error(ev.message || 'O worker de descompressão falhou (memória?).'))
      }
      w.postMessage({ buffer }, [buffer])
    })
  }

  async function parse(file: File): Promise<void> {
    error.value = null
    replay.value = null
    voice.value = null
    fileName.value = file.name
    fileSize.value = file.size
    rawSize.value = 0
    status.value = 'reading'
    setPhase('reading')

    const buffer = await file.arrayBuffer()
    status.value = 'parsing'

    let raw: ArrayBuffer
    try {
      // Decompress first, in a throwaway worker, then parse in the long-lived
      // one (keeps the parser's memory free of the zstd decoder's heap).
      raw = await decompress(buffer)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      status.value = 'error'
      return
    }

    const w = ensureWorker()

    await new Promise<void>((resolve) => {
      w.onmessage = (e: MessageEvent<ParseResponse>) => {
        const msg = e.data
        if (msg.type === 'progress') {
          setPhase(msg.phase)
          return
        }
        if (msg.ok) {
          replay.value = msg.replay as Replay
          voice.value = msg.voice
          progress.value = 1
          status.value = 'done'
        } else {
          error.value = msg.error
          status.value = 'error'
        }
        resolve()
      }
      // A worker crash (e.g. out-of-memory on a huge demo) would otherwise leave
      // the UI stuck on "parsing" forever — surface it as an error instead.
      w.onerror = (ev) => {
        error.value = ev.message || 'O worker de parsing falhou (memória?).'
        status.value = 'error'
        worker?.terminate()
        worker = null
        resolve()
      }
      // Transfere o buffer (zero-copy) para o worker.
      w.postMessage({ buffer: raw, frameRate: 8 }, [raw])
    })
  }

  /**
   * Loads an already-parsed replay (e.g. from local history), without re-parsing.
   * Leaves the composable in the `done` state, ready for the viewer.
   */
  function hydrate(entry: {
    replay: Replay
    voice: VoiceData | null
    fileName: string
    fileSize?: number
  }): void {
    error.value = null
    replay.value = entry.replay
    voice.value = entry.voice
    fileName.value = entry.fileName
    fileSize.value = entry.fileSize ?? 0
    status.value = 'done'
  }

  function reset() {
    status.value = 'idle'
    phase.value = 'reading'
    progress.value = 0
    error.value = null
    replay.value = null
    voice.value = null
    fileName.value = ''
    fileSize.value = 0
    rawSize.value = 0
  }

  onUnmounted(() => {
    worker?.terminate()
    worker = null
  })

  return {
    status,
    phase,
    progress,
    error,
    replay,
    voice,
    fileName,
    fileSize,
    rawSize,
    parse,
    hydrate,
    reset,
  }
}
