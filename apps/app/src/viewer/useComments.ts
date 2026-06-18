import { ref, shallowRef } from 'vue'
import type { CommentAnchor, CommentKind, ReplayComment } from '@/viewer/schema'
import { useRecentDemos } from '@/viewer/useRecentDemos'

/**
 * Reactive user comments for the demo currently open in the viewer. Module
 * singleton (like the other viewer composables), so the map canvas, the timeline
 * and the popover all read one source of truth.
 *
 * Every mutation REPLACES the array (never mutates in place): the map canvas
 * repaints from a plain, non-deep `watch` on it, and IndexedDB persistence is
 * keyed by demo id and best-effort. Comments live apart from the heavy
 * replay+voice payload, so editing one is cheap.
 */

const recent = useRecentDemos()

const currentId = ref<string | null>(null)
// shallowRef (not ref): every mutation replaces the array, so reactivity still
// fires, and the stored value stays a plain array. A deep-reactive proxy can't be
// structured-cloned by IndexedDB (DataCloneError), which would silently drop the
// save and lose comments on reload.
const comments = shallowRef<ReplayComment[]>([])

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Persists the current comments to IndexedDB. Debounced by default so typing in
 * the panel (which saves on every keystroke) doesn't hit the DB per character;
 * pass `immediate` for discrete actions (add/remove) so they're written at once.
 */
function persist(immediate = false) {
  if (!currentId.value) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const id = currentId.value
  const snapshot = comments.value
  if (immediate) {
    void recent.saveComments(id, snapshot)
    return
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    void recent.saveComments(id, snapshot)
  }, 250)
}

export function useComments() {
  /** Loads the stored comments for a demo id into the shared state. */
  async function loadFor(id: string): Promise<void> {
    currentId.value = id
    comments.value = await recent.loadComments(id)
  }

  /** Replaces the whole list for a demo and persists it (used after an import). */
  async function setAll(id: string, list: ReplayComment[]): Promise<void> {
    currentId.value = id
    comments.value = [...list]
    await recent.saveComments(id, comments.value)
  }

  /** Resets the shared state (e.g. when leaving the viewer). Does not persist. */
  function clear(): void {
    currentId.value = null
    comments.value = []
  }

  /** Adds a comment and returns its generated id. */
  function add(input: {
    roundIndex: number
    t: number
    duration: number
    x: number
    y: number
    z?: number
    anchor: CommentAnchor
    kind?: CommentKind
    textInside?: boolean
    text: string
    author?: string
  }): string {
    const comment: ReplayComment = {
      id: newId(),
      roundIndex: input.roundIndex,
      t: input.t,
      duration: input.duration,
      x: input.x,
      y: input.y,
      z: input.z,
      anchor: input.anchor,
      kind: input.kind,
      textInside: input.textInside,
      text: input.text,
      author: input.author?.trim() || undefined,
      createdAt: Date.now(),
    }
    comments.value = [...comments.value, comment]
    persist(true)
    return comment.id
  }

  /** Edits a comment's text/author/duration and stamps `updatedAt`. */
  function update(
    id: string,
    patch: { text?: string; author?: string; duration?: number; kind?: CommentKind; textInside?: boolean },
  ): void {
    comments.value = comments.value.map((c) =>
      c.id === id
        ? {
            ...c,
            ...(patch.text !== undefined ? { text: patch.text } : null),
            ...(patch.author !== undefined ? { author: patch.author.trim() || undefined } : null),
            ...(patch.duration !== undefined ? { duration: Math.max(0.5, patch.duration) } : null),
            ...(patch.kind !== undefined ? { kind: patch.kind } : null),
            ...(patch.textInside !== undefined ? { textInside: patch.textInside } : null),
            updatedAt: Date.now(),
          }
        : c,
    )
    persist()
  }

  /** Resizes (or moves) an area comment's rectangle, in world coords. */
  function setArea(id: string, x: number, y: number, x2: number, y2: number): void {
    comments.value = comments.value.map((c) =>
      c.id === id && c.anchor.kind === 'area'
        ? { ...c, x, y, anchor: { ...c.anchor, x2, y2 }, updatedAt: Date.now() }
        : c,
    )
    persist()
  }

  /** Removes a comment. */
  function remove(id: string): void {
    comments.value = comments.value.filter((c) => c.id !== id)
    persist(true)
  }

  return { comments, currentId, loadFor, setAll, clear, add, update, setArea, remove }
}
