// The coach-mode tactical board: tool/colour/thickness selection, the per-round
// drawings/overrides/grenades from the board store, and the add/move/remove
// handlers the map emits into. Split out of ViewerStage; `coachMode` is owned by
// the stage (shared with the demo-switch reset and the shortcuts) and injected.
import { computed, ref, type Ref } from 'vue'
import type { GrenadeKind } from '@/viewer/domain/schema'
import {
  COACH_DEFAULT_COLOR,
  COACH_DEFAULT_THICKNESS,
  COACH_DEFAULT_TOOL,
  type CoachShapeTool,
  type CoachTool,
} from '@/viewer/player/coachTools'
import type { useReplay } from '@/viewer/player/useReplay'
import type { useCoachBoard } from '@/viewer/player/useCoachBoard'

type ReplayControls = ReturnType<typeof useReplay>
type CoachBoard = ReturnType<typeof useCoachBoard>

interface CoachSessionOptions {
  r: ReplayControls
  board: CoachBoard
  /** Coach mode flag, owned by the stage (reset on demo switch, read by shortcuts). */
  coachMode: Ref<boolean>
  /** Comment mode flag, cleared when entering coach mode. */
  commentMode: Ref<boolean>
  /** Dismiss any open comment popover (it would float over the board). */
  closePopover: () => void
}

export function useCoachSession({ r, board, coachMode, commentMode, closePopover }: CoachSessionOptions) {
  const coachTool = ref<CoachTool>(COACH_DEFAULT_TOOL)
  const coachColor = ref(COACH_DEFAULT_COLOR)
  const coachThickness = ref(COACH_DEFAULT_THICKNESS)
  const coachGrenadeKind = ref<GrenadeKind>('smoke')
  /** Hide the game HUD while coaching, so only the map (and the board) shows. */
  const hudHidden = computed(() => coachMode.value)

  function toggleCoachMode() {
    coachMode.value = !coachMode.value
    if (coachMode.value) {
      // Entering: pause and leave comment mode (its popover would float over the board).
      r.pause()
      commentMode.value = false
      closePopover()
      seedReplayGrenades()
    }
  }

  /** Imports the grenades active at the current tick (the smokes/molotovs already on
   *  the map) onto the board, so the coach can move or remove them like placed ones.
   *  Once per round (the board keeps them after that). */
  function seedReplayGrenades() {
    const round = r.round.value
    if (!round) return
    const t = r.currentT.value
    const live = round.events.flatMap((ev) =>
      ev.type === 'grenade' && t >= ev.t && t <= ev.endT
        ? [{ id: newDrawingId(), kind: ev.kind, x: ev.x, y: ev.y, z: ev.z }]
        : [],
    )
    board.seedGrenades(r.roundIndex.value, live)
  }

  // Tactical board: per-round, editable, with undo/redo (the store is owned by the
  // stage). In-memory for now; IndexedDB persistence (like comments) lands later.
  /** Drawings on the round in view. */
  const roundCoachDrawings = computed(() => board.boardFor(r.roundIndex.value).drawings)
  /** Player position overrides on the round in view. */
  const roundCoachOverrides = computed(() => board.boardFor(r.roundIndex.value).playerOverrides)
  /** Grenades placed on the round in view. */
  const roundCoachGrenades = computed(() => board.boardFor(r.roundIndex.value).grenades)
  function newDrawingId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  }
  function onAddDrawing(d: {
    tool: CoachShapeTool
    points: { x: number; y: number }[]
    color: string
    thickness: number
    z?: number
  }) {
    const round = r.roundIndex.value
    board.addDrawing(round, { id: newDrawingId(), roundIndex: round, ...d })
  }
  function onSetPlayerPose(p: { steamId: string; x: number; y: number; yaw: number }) {
    board.setPlayerPose(r.roundIndex.value, p.steamId, p.x, p.y, p.yaw)
  }
  function onAddGrenade(g: { kind: GrenadeKind; x: number; y: number; z?: number }) {
    board.addGrenade(r.roundIndex.value, { id: newDrawingId(), ...g })
  }
  function onMoveGrenade(g: { id: string; x: number; y: number }) {
    board.moveGrenade(r.roundIndex.value, g.id, g.x, g.y)
  }
  function onRemoveGrenade(g: { id: string }) {
    board.removeGrenade(r.roundIndex.value, g.id)
  }
  /** Clears the board on the round in view (keeps other rounds untouched). */
  function clearCoachDrawings() {
    board.clearRound(r.roundIndex.value)
  }

  return {
    coachTool,
    coachColor,
    coachThickness,
    coachGrenadeKind,
    hudHidden,
    toggleCoachMode,
    roundCoachDrawings,
    roundCoachOverrides,
    roundCoachGrenades,
    onAddDrawing,
    onSetPlayerPose,
    onAddGrenade,
    onMoveGrenade,
    onRemoveGrenade,
    clearCoachDrawings,
  }
}
