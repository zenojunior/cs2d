import { computed, ref, shallowRef } from 'vue'
import type { CoachDrawing, CoachGrenade } from '@/viewer/player/coachTools'

/**
 * The coach mode tactical board: a per-round, editable snapshot the coach marks
 * up. Unlike comments (which annotate the live replay), the board freezes a tick
 * and lets the coach move things around freely.
 *
 * State is one object per round (drawings now; player overrides and inserted
 * grenades land in later phases). Every mutation REPLACES the state object and
 * pushes the previous one onto an undo stack, so undo/redo is a plain snapshot
 * history (cheap, since the board is small) covering every action uniformly.
 * In-memory only for now; IndexedDB persistence comes later.
 */

export interface CoachBoard {
  /** Shapes drawn on the board. */
  drawings: CoachDrawing[]
  /** Per-player pose overrides (steamId -> world coords + facing yaw) from dragging. */
  playerOverrides: Record<string, { x: number; y: number; yaw: number }>
  /** Grenades placed on the board. */
  grenades: CoachGrenade[]
}

/** Boards keyed by round index. */
export type CoachBoards = Record<number, CoachBoard>

const EMPTY_BOARD: CoachBoard = { drawings: [], playerOverrides: {}, grenades: [] }
const MAX_HISTORY = 100

// Module singleton, like the other viewer composables: the map, the toolbar and
// the shortcuts all read one source of truth.
const state = shallowRef<CoachBoards>({})
const past = ref<CoachBoards[]>([])
const future = ref<CoachBoards[]>([])
// Rounds whose live (replay) grenades have already been imported, so re-entering
// coach mode doesn't import them again.
const seeded = ref<Set<number>>(new Set())

/** Replaces the state, recording the previous snapshot for undo. */
function commit(next: CoachBoards) {
  past.value = [...past.value, state.value].slice(-MAX_HISTORY)
  future.value = []
  state.value = next
}

export function useCoachBoard() {
  function boardFor(round: number): CoachBoard {
    return state.value[round] ?? EMPTY_BOARD
  }
  function patchBoard(round: number, patch: Partial<CoachBoard>) {
    const cur = state.value[round] ?? EMPTY_BOARD
    commit({ ...state.value, [round]: { ...cur, ...patch } })
  }

  function addDrawing(round: number, drawing: CoachDrawing) {
    patchBoard(round, { drawings: [...boardFor(round).drawings, drawing] })
  }

  /** Overrides a player's pose (position + facing yaw) on a round's board. */
  function setPlayerPose(round: number, steamId: string, x: number, y: number, yaw: number) {
    const cur = boardFor(round)
    patchBoard(round, { playerOverrides: { ...cur.playerOverrides, [steamId]: { x, y, yaw } } })
  }

  /** Places a grenade on a round's board. */
  function addGrenade(round: number, grenade: CoachGrenade) {
    patchBoard(round, { grenades: [...boardFor(round).grenades, grenade] })
  }

  /** Moves a placed grenade (world coords) on a round's board. */
  function moveGrenade(round: number, id: string, x: number, y: number) {
    const cur = boardFor(round)
    patchBoard(round, { grenades: cur.grenades.map((g) => (g.id === id ? { ...g, x, y } : g)) })
  }

  /** Removes a placed grenade from a round's board. */
  function removeGrenade(round: number, id: string) {
    const cur = boardFor(round)
    patchBoard(round, { grenades: cur.grenades.filter((g) => g.id !== id) })
  }

  /**
   * Imports the round's live (replay) grenades onto the board, once per round.
   * Sets state directly (not through `commit`): seeding is the board's starting
   * point, not an undoable action, and must not wipe history from other rounds.
   */
  function seedGrenades(round: number, grenades: CoachGrenade[]) {
    if (seeded.value.has(round)) return
    seeded.value = new Set(seeded.value).add(round)
    if (!grenades.length) return
    const cur = boardFor(round)
    state.value = { ...state.value, [round]: { ...cur, grenades: [...cur.grenades, ...grenades] } }
  }

  /** Clears everything on a round's board. No-op if already empty. */
  function clearRound(round: number) {
    const cur = boardFor(round)
    if (!cur.drawings.length && !cur.grenades.length && !Object.keys(cur.playerOverrides).length) return
    patchBoard(round, { drawings: [], playerOverrides: {}, grenades: [] })
  }

  function undo() {
    if (!past.value.length) return
    const prev = past.value[past.value.length - 1]
    past.value = past.value.slice(0, -1)
    future.value = [state.value, ...future.value].slice(0, MAX_HISTORY)
    state.value = prev
  }
  function redo() {
    if (!future.value.length) return
    const next = future.value[0]
    future.value = future.value.slice(1)
    past.value = [...past.value, state.value].slice(-MAX_HISTORY)
    state.value = next
  }

  /** Wipes the board and its history (e.g. switching demos). */
  function reset() {
    state.value = {}
    past.value = []
    future.value = []
    seeded.value = new Set()
  }

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  return {
    state,
    boardFor,
    addDrawing,
    setPlayerPose,
    addGrenade,
    moveGrenade,
    removeGrenade,
    seedGrenades,
    clearRound,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
  }
}
