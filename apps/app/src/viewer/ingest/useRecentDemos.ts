import { ref } from 'vue'
import type { Replay, ReplayComment, VoiceData } from '@/viewer/domain/schema'
import { exportArchive } from '@/viewer/ingest/demoArchive'

/**
 * Local history of already-analyzed demos. Since the raw demo never leaves the
 * machine, we keep the parse result here so the user can reopen a match without
 * re-uploading the `.dem`.
 *
 * Two storage tiers:
 * - `localStorage`: light index (map, score, date) so the list renders instantly.
 * - `IndexedDB`: the heavy payload (`Replay` + voice), loaded only on reopen.
 *
 * Everything stays in the browser; nothing is sent to any server.
 */

/** Light metadata of a stored demo (what shows in the recents list). */
export interface RecentDemo {
  id: string
  fileName: string
  /** User-set display title. Falls back to `fileName` when unset. */
  title?: string
  /**
   * Bytes of the parsed `.cs2dv` archive (replay + voice), which is what we
   * actually keep locally, NOT the raw `.dem` the user dropped in. Matches the
   * size the extension shows. Older entries may still hold the raw `.dem` size.
   */
  fileSize: number
  map: string
  rounds: number
  /** Rounds won by the CT side across the whole match. */
  scoreCt: number
  /** Rounds won by the T side across the whole match. */
  scoreT: number
  hasVoice: boolean
  /** Epoch in ms of when it was analyzed. */
  savedAt: number
}

/** Heavy payload stored in IndexedDB, retrieved only on reopen. */
export interface RecentDemoPayload {
  replay: Replay
  voice: VoiceData | null
}

const INDEX_KEY = 'cs2dv:recent-demos'
const DB_NAME = 'cs2dv-demos'
const STORE = 'payloads'
const STORE_COMMENTS = 'comments'
// History is unbounded: demos persist until the user deletes them explicitly.
// v3: forces onupgradeneeded to run again for databases that reached v2 without
// the `comments` store (an interrupted/intermediate dev upgrade left some without
// it), recreating any missing store via the idempotent guards below.
// This is the minimum version: a database already at a higher one (left by another
// build of the app) is opened as is, see `openDb`.
const DB_VERSION = 3
const REQUIRED_STORES = [STORE, STORE_COMMENTS]

// -------------------------------------------------------------- raw IndexedDB

/** Opens the database at `version` (its current one when omitted). */
function openAt(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      // v2: user comments, keyed by demo id. Kept apart from the heavy payload
      // so editing a comment doesn't rewrite the whole replay+voice blob.
      if (!db.objectStoreNames.contains(STORE_COMMENTS)) db.createObjectStore(STORE_COMMENTS)
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab needs to upgrade: step aside instead of blocking it.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    // Without this, an upgrade held up by another open tab hangs forever.
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab'))
  })
}

/**
 * Opens the database without ever asking for a lower version than the stored one:
 * that throws `VersionError`, so a database bumped by another build of the app
 * (e.g. a dev branch) would make every save fail. Upgrades only when below
 * `DB_VERSION` or when a required store is missing.
 */
async function openDb(): Promise<IDBDatabase> {
  const db = await openAt()
  const missing = REQUIRED_STORES.some((name) => !db.objectStoreNames.contains(name))
  if (db.version >= DB_VERSION && !missing) return db
  const next = Math.max(DB_VERSION, db.version + (missing ? 1 : 0))
  db.close()
  return openAt(next)
}

async function idbPut(id: string, value: RecentDemoPayload): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbGet(id: string): Promise<RecentDemoPayload | undefined> {
  const db = await openDb()
  try {
    return await new Promise<RecentDemoPayload | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result as RecentDemoPayload | undefined)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbKeys(): Promise<string[]> {
  const db = await openDb()
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result.map(String))
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbGetComments(id: string): Promise<ReplayComment[] | undefined> {
  const db = await openDb()
  try {
    return await new Promise<ReplayComment[] | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_COMMENTS, 'readonly')
      const req = tx.objectStore(STORE_COMMENTS).get(id)
      req.onsuccess = () => resolve(req.result as ReplayComment[] | undefined)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbPutComments(id: string, comments: ReplayComment[]): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_COMMENTS, 'readwrite')
      tx.objectStore(STORE_COMMENTS).put(comments, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbDeleteComments(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_COMMENTS, 'readwrite')
      tx.objectStore(STORE_COMMENTS).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// ----------------------------------------------------------------- light index

function readIndex(): RecentDemo[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentDemo[]) : []
  } catch {
    return []
  }
}

function writeIndex(items: RecentDemo[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(items))
  } catch {
    // Quota full or storage unavailable: history just does not persist.
  }
}

/** Raw match score (rounds won per side, summing both halves). */
function tallyScore(replay: Replay): { ct: number; t: number } {
  let ct = 0
  let t = 0
  for (const round of replay.rounds) {
    if (round.winner === 'CT') ct++
    else if (round.winner === 'T') t++
  }
  return { ct, t }
}

/**
 * Index entry for a demo. The size is that of the parsed `.cs2dv` archive (what we
 * actually keep locally, NOT the heavy raw `.dem`, same as the extension shows),
 * falling back to `fileSize` if the gzip pass fails.
 */
async function buildMeta(
  id: string,
  input: { fileName: string; fileSize: number; replay: Replay; voice: VoiceData | null },
): Promise<RecentDemo> {
  // Score per team (handles side swap); falls back to the per-side tally.
  const fallback = tallyScore(input.replay)
  let sizeBytes = input.fileSize
  try {
    const archive = await exportArchive({
      fileName: input.fileName,
      replay: input.replay,
      voice: input.voice,
      comments: [],
    })
    sizeBytes = archive.size
  } catch {
    // Keep the fallback size.
  }
  return {
    id,
    fileName: input.fileName,
    fileSize: sizeBytes,
    map: input.replay.map,
    rounds: input.replay.rounds.length,
    scoreCt: input.replay.finalScoreCt ?? fallback.ct,
    scoreT: input.replay.finalScoreT ?? fallback.t,
    hasVoice: (input.voice?.tracks?.length ?? 0) > 0,
    savedAt: Date.now(),
  }
}

// Shared state (module singleton, like the other composables).
const list = ref<RecentDemo[]>(readIndex())

/**
 * Re-lists payloads that sit in IndexedDB without an index entry (the index was
 * lost or overwritten while the payloads survived), so those demos show up in the
 * library again. The file name isn't part of the payload, so recovered entries get
 * one from the teams (or the map); the user can rename them.
 */
async function recoverOrphans(): Promise<void> {
  let keys: string[]
  try {
    keys = await idbKeys()
  } catch (err) {
    console.warn('[library] could not list stored demos', err)
    return
  }
  const known = new Set(list.value.map((d) => d.id))
  const recovered: RecentDemo[] = []
  for (const id of keys) {
    if (known.has(id)) continue
    try {
      const payload = await idbGet(id)
      if (!payload?.replay) continue
      const { replay, voice } = payload
      const teams = replay.finalCtName && replay.finalTName ? `${replay.finalCtName} vs ${replay.finalTName}` : ''
      const fileName = teams ? `${replay.map} - ${teams}` : replay.map
      recovered.push(await buildMeta(id, { fileName, fileSize: 0, replay, voice }))
    } catch (err) {
      console.warn('[library] could not recover stored demo', id, err)
    }
  }
  if (!recovered.length) return
  // Re-read the index: a save may have landed while the payloads were loading.
  const current = readIndex()
  const fresh = recovered.filter((d) => !current.some((c) => c.id === d.id))
  list.value = [...current, ...fresh]
  writeIndex(list.value)
  console.info(`[library] recovered ${fresh.length} demo(s) missing from the index`)
}

if (typeof indexedDB !== 'undefined') void recoverOrphans()

export function useRecentDemos() {
  /**
   * Stores a freshly analyzed demo. Tries to persist the voice too; if it blows
   * the browser quota, it saves only the replay and marks the entry as no-voice.
   */
  async function save(input: {
    fileName: string
    fileSize: number
    replay: Replay
    voice: VoiceData | null
  }): Promise<string | null> {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.round(Math.random() * 1e9)}`

    const meta = await buildMeta(id, input)

    try {
      await idbPut(id, { replay: input.replay, voice: input.voice })
    } catch (err) {
      // Failed with voice (likely quota): retry with the replay only.
      console.warn('[library] save with voice failed, retrying without it', err)
      try {
        await idbPut(id, { replay: input.replay, voice: null })
        meta.hasVoice = false
      } catch (err) {
        // No IndexedDB available: give up storing this demo.
        console.error('[library] could not save the demo', err)
        return null
      }
    }

    // History grows without bound: demos are only ever removed when the user
    // explicitly deletes them (see `remove`), never auto-dropped.
    const next = [meta, ...list.value]
    list.value = next
    writeIndex(next)
    return id
  }

  /** Loads the heavy payload of a stored demo (null if it no longer exists). */
  async function load(id: string): Promise<RecentDemoPayload | null> {
    try {
      const payload = await idbGet(id)
      return payload ?? null
    } catch {
      return null
    }
  }

  /**
   * Renames a demo. An empty title clears the override so the display falls
   * back to the original file name.
   */
  function rename(id: string, title: string): void {
    const trimmed = title.trim()
    list.value = list.value.map((d) =>
      d.id === id ? { ...d, title: trimmed || undefined } : d,
    )
    writeIndex(list.value)
  }

  /** Removes a demo from history (index + payload + comments). */
  function remove(id: string): void {
    list.value = list.value.filter((d) => d.id !== id)
    writeIndex(list.value)
    void idbDelete(id)
    void idbDeleteComments(id)
  }

  /** Loads the comments stored for a demo (empty list when none/unavailable). */
  async function loadComments(id: string): Promise<ReplayComment[]> {
    try {
      return (await idbGetComments(id)) ?? []
    } catch (err) {
      console.warn('[comments] load failed', err)
      return []
    }
  }

  /** Persists the comments for a demo (best-effort; ignored when storage fails). */
  async function saveComments(id: string, comments: ReplayComment[]): Promise<void> {
    try {
      await idbPutComments(id, comments)
    } catch (err) {
      // Storage unavailable/over quota, or a value that can't be structured-cloned.
      console.warn('[comments] save failed', err)
    }
  }

  return { list, save, load, rename, remove, loadComments, saveComments }
}
