// Offscreen document: the only context that touches the raw demo bytes. It runs
// in the extension origin, so its fetch is exempt from CORS (host_permissions),
// and it can host a Web Worker + WASM (which the background service worker
// cannot). Pipeline: fetch -> decompress -> parse (worker) -> .cs2dv -> IndexedDB,
// then discard the raw bytes. Only small JSON progress crosses chrome.runtime.

// Reuse the app's framework-free pipeline, vendored under lib/ (see wxt.config).
import { init as zstdInitRaw, decompress as zstdDecompress } from '@bokuweb/zstd-wasm'
import ParserWorker from '../../lib/demoParser.worker?worker'
import type { ParseResponse } from '../../lib/demoParser.worker'
import wasmUrl from '../../lib/parser/demo_parser_bg.wasm?url'
import { exportArchive } from '@cs2/replay-core/demoArchive'
import type { Replay, VoiceData } from '@cs2/replay-core/schema'

// The bundled types resolve to the Node build's `init()` (no args); the web
// build accepts an explicit wasm path. We load it from the extension root
// (synced to public/zstd.wasm) since the offscreen runs in the extension origin.
const zstdInit = zstdInitRaw as (path?: string) => Promise<void>
let zstdReady: Promise<void> | undefined
function ensureZstd(): Promise<void> {
  return (zstdReady ??= zstdInit(chrome.runtime.getURL('zstd.wasm' as never)))
}
import { fileNameFromUrl, type ArchiveMetaRow, type Job, type ToOffscreen } from '../../utils/protocol'
import { putArchive } from '../../utils/db'
import { exportLogs, makeLog } from '../../utils/log'

const log = makeLog('offscreen')
// Grab the full log from the offscreen.html console with `await cs2dvLogs()`.
;(globalThis as { cs2dvLogs?: () => Promise<string> }).cs2dvLogs = exportLogs

/** Best-effort host of a URL, for logging (never throws). */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(unparseable url)'
  }
}

// Cancellation: the user can abort a job from the overlay. We abort the
// in-flight fetch (the only externally-interruptible step) and also gate the
// later CPU-bound steps so a cancel mid-decompress/parse still discards the
// result instead of silently saving it.
const cancelled = new Set<string>()
let activeJobId: string | null = null
let activeAbort: AbortController | null = null

class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

chrome.runtime.onMessage.addListener((msg: ToOffscreen) => {
  if (msg?.target !== 'offscreen') return
  if (msg.type === 'PROCESS') void process(msg.job)
  else if (msg.type === 'CANCEL') {
    cancelled.add(msg.matchId)
    if (msg.matchId === activeJobId) activeAbort?.abort()
  }
})

const report = (m: Record<string, unknown>) =>
  chrome.runtime.sendMessage({ target: 'background', ...m }).catch(() => {})

async function process(job: Job) {
  const { matchId, url } = job
  const abort = new AbortController()
  activeJobId = matchId
  activeAbort = abort
  const ensureLive = () => {
    if (cancelled.has(matchId)) throw new CancelledError()
  }
  const host = hostOf(url)
  try {
    // --- download (streamed, with progress) ---
    log.info('download start', { matchId, host })
    report({ type: 'JOB_PROGRESS', matchId, patch: { phase: 'downloading', loaded: 0, total: 0 } })
    let res: Response
    try {
      res = await fetch(url, { signal: abort.signal })
    } catch (fetchErr) {
      // A CORS block (host not in host_permissions) surfaces as a TypeError
      // "Failed to fetch" with no response, indistinguishable from a network
      // drop. Aborts are real cancels, not fetch failures: let those rethrow.
      if ((fetchErr as Error)?.name === 'AbortError') throw fetchErr
      log.error('fetch failed (CORS or network) — is the host in host_permissions?', {
        matchId,
        host,
        error: (fetchErr as Error)?.message ?? String(fetchErr),
      })
      throw fetchErr
    }
    if (!res.ok) {
      log.error('download HTTP error', { matchId, host, status: res.status })
      throw new Error(`HTTP ${res.status} downloading demo`)
    }
    const total = Number(res.headers.get('content-length')) || 0
    const reader = res.body!.getReader()
    const parts: Uint8Array[] = []
    let loaded = 0
    let lastReport = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      loaded += value.byteLength
      // Throttle progress messages to ~10/s.
      const now = performance.now()
      if (now - lastReport > 100) {
        lastReport = now
        report({ type: 'JOB_PROGRESS', matchId, patch: { phase: 'downloading', loaded, total } })
      }
    }
    ensureLive()
    const compressed = concat(parts, loaded)
    log.info('downloaded', { matchId, bytes: loaded })

    // --- decompress to raw .dem ---
    report({ type: 'JOB_PROGRESS', matchId, patch: { phase: 'decompressing' } })
    const raw = await toRawDemo(compressed)
    log.info('decompressed', { matchId, rawBytes: raw.byteLength })

    // --- parse (in the reused app worker) ---
    ensureLive()
    const { replay, voice } = await parse(raw, (patch) =>
      report({ type: 'JOB_PROGRESS', matchId, patch }),
    )
    log.info('parsed', { matchId, map: replay.map })

    // --- pack to .cs2dv and store (discard raw) ---
    ensureLive()
    report({ type: 'JOB_PROGRESS', matchId, patch: { phase: 'storing' } })
    const fileName = fileNameFromUrl(url).replace(/\.(gz|zst|zip)$/i, '')
    const blob = await exportArchive({ fileName, replay, voice, comments: [] })
    const meta: ArchiveMetaRow = {
      matchId,
      fileName,
      label: job.label,
      // Authoritative map/score from the parsed replay; team/competition from
      // the Faceit API metadata carried on the job.
      map: replay.map,
      scoreCt: replay.finalScoreCt ?? 0,
      scoreT: replay.finalScoreT ?? 0,
      sizeBytes: blob.size,
      createdAt: Date.now(),
      teamA: job.meta?.teamA,
      teamB: job.meta?.teamB,
      competition: job.meta?.competition,
      region: job.meta?.region,
      date: job.meta?.date,
      roomUrl: job.meta?.roomUrl,
      source: job.meta?.source,
    }
    ensureLive()
    await putArchive(meta, blob)
    log.info('stored', { matchId, fileName, sizeBytes: blob.size })
    report({ type: 'JOB_DONE', matchId, meta })
  } catch (err) {
    // A cancel (abort or gate trip) is not a real failure: the background has
    // already dropped the card, so this JOB_ERROR is ignored and just pumps the
    // queue. Report it anyway to keep the single error path.
    const aborted = err instanceof CancelledError || (err as Error)?.name === 'AbortError'
    if (aborted) log.info('cancelled', { matchId })
    else log.error('pipeline failed', { matchId, host, error: err instanceof Error ? err.message : String(err) })
    report({ type: 'JOB_ERROR', matchId, message: aborted ? 'cancelled' : err instanceof Error ? err.message : String(err) })
  } finally {
    cancelled.delete(matchId)
    if (activeJobId === matchId) {
      activeJobId = null
      activeAbort = null
    }
  }
}

/** Concatenate the streamed chunks into one buffer. */
function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}

/** Decompresses the demo to raw `.dem`: gzip (native) or zstandard (libzstd
 *  WASM, same decoder as the app); a raw demo passes through. */
async function toRawDemo(input: Uint8Array): Promise<Uint8Array> {
  if (input[0] === 0x1f && input[1] === 0x8b) {
    const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  if (input[0] === 0x28 && input[1] === 0xb5 && input[2] === 0x2f && input[3] === 0xfd) {
    await ensureZstd()
    return zstdDecompress(input)
  }
  return input // assume raw PBDEMS2
}

/** Runs the WASM parser worker once and resolves the replay + voice. */
function parse(
  raw: Uint8Array,
  onProgress: (patch: { phase: 'parsing' | 'building'; tick?: number; totalTicks?: number }) => void,
): Promise<{ replay: Replay; voice: VoiceData }> {
  return new Promise((resolve, reject) => {
    const worker = new ParserWorker()
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      const data = e.data
      if (data.type === 'progress') {
        if (data.phase === 'parsing') onProgress({ phase: 'parsing', tick: data.tick, totalTicks: data.totalTicks })
        else if (data.phase === 'building') onProgress({ phase: 'building' })
        return
      }
      worker.terminate()
      if (data.ok) resolve({ replay: data.replay as Replay, voice: data.voice })
      else reject(new Error(data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'parser worker crashed'))
    }
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    worker.postMessage({ buffer, frameRate: 8, wasmUrl }, [buffer])
  })
}
