// Message contracts for the in-extension pipeline.
//
// All cross-context messages carry only small JSON (job ids, URLs, progress
// numbers). Demo bytes NEVER cross chrome.runtime (it serializes as JSON and
// corrupts typed arrays): the offscreen document both fetches and parses, so the
// 500 MB raw demo stays in one context and only the light .cs2dv is persisted.
//
// `target` namespaces who should handle a message, since runtime.sendMessage
// fans out to every extension context.

import type { LogEntry } from './log'

export type Phase = 'queued' | 'downloading' | 'decompressing' | 'parsing' | 'building' | 'storing'

/** Rich match info scraped from Faceit's API, shown on the card before/while the
 *  demo is parsed (the parser later fills in the authoritative map/score). */
export interface MatchMeta {
  teamA?: string
  teamB?: string
  scoreA?: number
  scoreB?: number
  map?: string
  competition?: string
  region?: string
  /** Epoch ms of the match. */
  date?: number
  /** Faceit match room URL, captured at download time so the library can link
   *  straight back to the room. */
  roomUrl?: string
  /** Where the demo came from (`faceit` today, `hltv` next, `imported` for a
   *  hand-imported .cs2dv). Shown as a badge and filterable in the library. */
  source?: string
}

/** A unit of work: download + parse one match's demo. */
export interface Job {
  matchId: string
  url: string
  label: string
  meta?: MatchMeta
}

/** Live state of an in-flight job (what the overlay renders). */
export interface ActiveJob {
  matchId: string
  label: string
  phase: Phase
  /** Download bytes so far / total (0 total when the CDN gave no length). */
  loaded: number
  total: number
  /** Parser tick progress, when phase === 'parsing'. */
  tick?: number
  totalTicks?: number
  error?: string
  meta?: MatchMeta
}

/** Metadata for a stored .cs2dv (no blob; that's read on demand). */
export interface ArchiveMetaRow {
  matchId: string
  fileName: string
  label: string
  map: string
  scoreCt: number
  scoreT: number
  sizeBytes: number
  createdAt: number
  teamA?: string
  teamB?: string
  competition?: string
  region?: string
  date?: number
  /** Faceit match room URL, for the "open room" link in the library. */
  roomUrl?: string
  /** Where the demo came from (`faceit` / `hltv` / `imported`). */
  source?: string
}

// --- content/overlay -> background ------------------------------------------
export type ToBackground =
  | { target: 'background'; type: 'ENQUEUE'; job: Job }
  | { target: 'background'; type: 'GET_STATE' }
  | { target: 'background'; type: 'DELETE'; matchId: string }
  // Abort an in-flight or queued job (the user hit cancel on the card).
  | { target: 'background'; type: 'CANCEL'; matchId: string }
  // Open a stored replay in the web app's 2D viewer (background opens the tab).
  | { target: 'background'; type: 'OPEN_VIEWER'; matchId: string }
  // App-origin content script asks for a stored .cs2dv to hand to the viewer.
  | { target: 'background'; type: 'GET_BLOB'; matchId: string }
  // Import an exported .cs2dv into the library (base64, parsed for its metadata).
  | { target: 'background'; type: 'IMPORT'; fileName: string; base64: string }
  // Log line from a context without chrome.storage (the offscreen document).
  | { target: 'background'; type: 'LOG'; entry: LogEntry }
  // Diagnostics: the persisted log as text (for the overlay's copy button), or wipe it.
  | { target: 'background'; type: 'GET_LOGS' }
  | { target: 'background'; type: 'CLEAR_LOGS' }

export interface StateReply {
  active: ActiveJob[]
  stored: ArchiveMetaRow[]
  totalBytes: number
}

/** Reply to GET_BLOB: the .cs2dv as base64 (runtime messaging can't carry raw
 *  bytes; the content script decodes it and transfers an ArrayBuffer to the
 *  page, which survives structured clone intact). Null when not found. */
export interface BlobReply {
  fileName: string
  base64: string
}

// --- background -> offscreen ------------------------------------------------
export type ToOffscreen =
  | { target: 'offscreen'; type: 'PROCESS'; job: Job }
  | { target: 'offscreen'; type: 'CANCEL'; matchId: string }

// --- offscreen -> background ------------------------------------------------
export type ToBackgroundFromOffscreen =
  | { target: 'background'; type: 'JOB_PROGRESS'; matchId: string; patch: Partial<ActiveJob> }
  | { target: 'background'; type: 'JOB_DONE'; matchId: string; meta: ArchiveMetaRow }
  | { target: 'background'; type: 'JOB_ERROR'; matchId: string; message: string }

/** Derive a sensible demo file name from a signed CDN URL. */
export function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop() || ''
    const name = decodeURIComponent(last)
    if (/\.(dem|gz|zip|zst)$/i.test(name)) return name
  } catch {
    /* fall through */
  }
  return 'faceit-demo.dem.gz'
}
