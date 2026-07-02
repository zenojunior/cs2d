// The map's right-click context menu: tracks what the right-click landed on (a
// comment, or a player/point target) and the actions offered for it — edit /
// delete / resize a comment, add a comment, follow the player, or copy a CS2
// `setpos` teleport command. Split out of ViewerStage; the comment edit/create
// actions delegate to the comment flow, and follow is injected from the stage.
import { computed, ref } from 'vue'
import type { CommentAnchor } from '@/viewer/domain/schema'
import type { useComments } from '@/viewer/comments/useComments'

type CommentStore = ReturnType<typeof useComments>

type ContextComment = { id: string; vx: number; vy: number; vw: number; vh: number }
type ContextTarget = {
  x: number
  y: number
  z: number
  yaw: number
  anchor: CommentAnchor
  vx: number
  vy: number
}

interface ContextMenuOptions {
  comments: CommentStore
  t: (key: string) => string
  /** Open the edit popover for a comment (from the comment flow). */
  onSelectComment: (p: ContextComment) => void
  /** Open the create popover at a world target (from the comment flow). */
  onDropComment: (p: {
    x: number
    y: number
    anchor: CommentAnchor
    vx: number
    vy: number
    vw: number
    vh: number
  }) => void
  /** Follow / stop following a player (owned by the stage). */
  toggleFollow: (steamId: string) => void
}

export function useContextMenu({
  comments,
  t,
  onSelectComment,
  onDropComment,
  toggleFollow,
}: ContextMenuOptions) {
  // Right-click context menu actions, keyed to the comment under the cursor (set on
  // contextmenu by the map; null when the right-click missed every comment).
  const contextComment = ref<ContextComment | null>(null)
  function onContextComment(p: ContextComment | null) {
    contextComment.value = p
  }
  function editContextComment() {
    if (contextComment.value) onSelectComment(contextComment.value)
  }
  function deleteContextComment() {
    if (contextComment.value) comments.remove(contextComment.value.id)
  }

  /** An area comment was resized by dragging a corner handle on the map. */
  function onResizeArea(p: { id: string; x: number; y: number; x2: number; y2: number }) {
    comments.setArea(p.id, p.x, p.y, p.x2, p.y2)
  }

  // Right-click target for a new comment (a player under the cursor), for the
  // "add a comment" context-menu action.
  const contextTarget = ref<ContextTarget | null>(null)
  function onContextTarget(p: ContextTarget | null) {
    contextTarget.value = p
  }
  function addContextComment() {
    const tgt = contextTarget.value
    if (tgt) onDropComment({ x: tgt.x, y: tgt.y, anchor: tgt.anchor, vx: tgt.vx, vy: tgt.vy, vw: 0, vh: 0 })
  }
  // steamId of the player under the right-click (null when it's not a player), so
  // the context menu can offer "follow / stop following".
  const contextPlayerId = computed(() => {
    const a = contextTarget.value?.anchor
    return a?.kind === 'player' ? a.steamId : null
  })
  function followContextPlayer() {
    if (contextPlayerId.value) toggleFollow(contextPlayerId.value)
  }

  // Brief confirmation toast (auto-hides), used when copying a position to the clipboard.
  const toast = ref('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function showToast(msg: string) {
    toast.value = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = ''), 1800)
  }

  /**
   * Copies a CS2 console teleport command for the right-clicked player, mirroring
   * the in-game `getpos` output: `setpos x y z;setang pitch yaw roll`. We only know
   * the yaw, so pitch and roll are left at 0.
   */
  async function copyContextSetpos() {
    const tgt = contextTarget.value
    if (!tgt) return
    const cmd = `setpos ${tgt.x.toFixed(2)} ${tgt.y.toFixed(2)} ${tgt.z.toFixed(2)};setang 0 ${tgt.yaw.toFixed(2)} 0`
    try {
      await navigator.clipboard.writeText(cmd)
      showToast(t('viewer.copyPosDone'))
    } catch {
      showToast(cmd)
    }
  }

  return {
    contextComment,
    onContextComment,
    editContextComment,
    deleteContextComment,
    onResizeArea,
    contextTarget,
    onContextTarget,
    addContextComment,
    contextPlayerId,
    followContextPlayer,
    toast,
    copyContextSetpos,
  }
}
