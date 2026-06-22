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

// Persist to the ring buffer. Wrapped in try/catch because chrome.storage is
// unavailable in MAIN-world scripts; the console output still goes through.
async function persist(entry: LogEntry): Promise<void> {
  try {
    const cur = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as LogEntry[] | undefined
    const next = cur ?? []
    next.push(entry)
    if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
    await chrome.storage.local.set({ [STORAGE_KEY]: next })
  } catch {
    /* no chrome.storage here (e.g. MAIN world): console output is enough */
  }
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
    return ((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as LogEntry[]) ?? []
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
    await chrome.storage.local.remove(STORAGE_KEY)
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
