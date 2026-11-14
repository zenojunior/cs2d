// Always-on logger for the extension. Kept in production on purpose: it makes
// diagnosing download/parse failures (a CDN host missing from host_permissions,
// a CORS block, a parser crash) possible from a real user's machine. Nothing
// sensitive is stored; signed demo URLs are reduced to their host before logging.
//
// Every entry goes to the console (prefixed, so it's easy to filter) and to a
// ring buffer in chrome.storage.local, so it survives across the content script,
// the service worker and the offscreen document. Grab it with exportLogs() from
// any extension console (also exposed as globalThis.cs2dvLogs).

const PREFIX = '[CS2DV]'
const STORAGE_KEY = 'cs2dv:logs'
const MAX_ENTRIES = 500

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  t: number
  level: LogLevel
  scope: string
  msg: string
  data?: unknown
}

function consoleFn(level: LogLevel): (...args: unknown[]) => void {
  return level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
}

// Persist to a per-scope ring buffer. Each context (background, offscreen, ...)
// owns its own key and serializes its writes: a single shared array updated with
// read-modify-write from several contexts lost entries to concurrent overwrites.
const writeChains = new Map<string, Promise<void>>()
export function persist(entry: LogEntry): Promise<void> {
  // Offscreen documents only get chrome.runtime (no chrome.storage): hand the
  // entry to the background, which owns persistence for them.
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve(chrome?.runtime?.sendMessage?.({ target: 'background', type: 'LOG', entry })).then(
      () => {},
      () => {},
    )
  }
  const key = `${STORAGE_KEY}:${entry.scope}`
  const next = (writeChains.get(key) ?? Promise.resolve()).then(async () => {
    try {
      const cur = ((await chrome.storage.local.get(key))[key] as LogEntry[] | undefined) ?? []
      cur.push(entry)
      if (cur.length > MAX_ENTRIES) cur.splice(0, cur.length - MAX_ENTRIES)
      await chrome.storage.local.set({ [key]: cur })
    } catch {
      /* no chrome.storage here (e.g. MAIN world): console output is enough */
    }
  })
  writeChains.set(key, next)
  return next
}

function emit(level: LogLevel, scope: string, msg: string, data?: unknown): void {
  consoleFn(level)(`${PREFIX} [${scope}] ${msg}`, data ?? '')
  void persist({ t: Date.now(), level, scope, msg, data })
}

/** A scoped logger, e.g. makeLog('offscreen'). */
export function makeLog(scope: string) {
  return {
    info: (msg: string, data?: unknown) => emit('info', scope, msg, data),
    warn: (msg: string, data?: unknown) => emit('warn', scope, msg, data),
    error: (msg: string, data?: unknown) => emit('error', scope, msg, data),
  }
}

export async function getLogs(): Promise<LogEntry[]> {
  try {
    const all = await chrome.storage.local.get(null)
    return Object.entries(all)
      .filter(([k]) => k.startsWith(`${STORAGE_KEY}:`))
      .flatMap(([, v]) => v as LogEntry[])
      .sort((x, y) => x.t - y.t)
  } catch {
    return []
  }
}

/** Flatten the ring buffer to a copy-pasteable string. */
export async function exportLogs(): Promise<string> {
  const logs = await getLogs()
  return logs
    .map((e) => {
      const head = `${new Date(e.t).toISOString()} ${e.level.toUpperCase()} [${e.scope}] ${e.msg}`
      return e.data !== undefined ? `${head} ${safeJson(e.data)}` : head
    })
    .join('\n')
}

export async function clearLogs(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null)
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(`${STORAGE_KEY}:`)))
  } catch {
    /* noop */
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
