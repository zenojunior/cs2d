import { ref } from 'vue'
import type { Replay, ReplayComment, VoiceData } from '@/viewer/domain/schema'

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
// v3: forces onupgradeneeded to run again for databases that reached v2 without
// the `comments` store (an interrupted/intermediate dev upgrade left some without
// it), recreating any missing store via the idempotent guards below.
const DB_VERSION = 3
/** How many demos to keep in history (the oldest are dropped). */
const MAX = 6

// -------------------------------------------------------------- raw IndexedDB

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      // v2: user comments, keyed by demo id. Kept apart from the heavy payload
      // so editing a comment doesn't rewrite the whole replay+voice blob.
      if (!db.objectStoreNames.contains(STORE_COMMENTS)) db.createObjectStore(STORE_COMMENTS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
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

// Shared state (module singleton, like the other composables).
const list = ref<RecentDemo[]>(readIndex())

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

    // Score per team (handles side swap); falls back to the per-side tally.
    const fallback = tallyScore(input.replay)
    const ct = input.replay.finalScoreCt ?? fallback.ct
    const t = input.replay.finalScoreT ?? fallback.t
    const meta: RecentDemo = {
      id,
      fileName: input.fileName,
      fileSize: input.fileSize,
      map: input.replay.map,
      rounds: input.replay.rounds.length,
      scoreCt: ct,
      scoreT: t,
      hasVoice: (input.voice?.tracks?.length ?? 0) > 0,
      savedAt: Date.now(),
    }

    try {
      await idbPut(id, { replay: input.replay, voice: input.voice })
    } catch {
      // Failed with voice (likely quota): retry with the replay only.
      try {
        await idbPut(id, { replay: input.replay, voice: null })
        meta.hasVoice = false
      } catch {
        // No IndexedDB available: give up storing this demo.
        return null
      }
    }

    const next = [meta, ...list.value].slice(0, MAX)
    // Delete from IndexedDB the payloads + comments of demos that fell off the list.
    const kept = new Set(next.map((d) => d.id))
    for (const old of list.value) {
      if (!kept.has(old.id)) {
        void idbDelete(old.id)
        void idbDeleteComments(old.id)
      }
    }
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

  return { list, save, load, remove, loadComments, saveComments }
}
