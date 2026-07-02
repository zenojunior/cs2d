// The stage's comment interaction: the create/edit popover lifecycle, the
// comment mode toggle + side panel, and the seek-to-comment helpers. Glue between
// the replay clock (`useReplay`) and the comment store (`useComments`); split out
// of ViewerStage to keep the component focused on layout/orchestration.
import { computed, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { CommentAnchor, CommentKind } from '@/viewer/domain/schema'
import { commentDuration } from '@/viewer/comments/commentAnchor'
import type { useReplay } from '@/viewer/player/useReplay'
import type { useComments } from '@/viewer/comments/useComments'

type ReplayControls = ReturnType<typeof useReplay>
type CommentStore = ReturnType<typeof useComments>

type Popover = {
  mode: 'create' | 'edit'
  /** Reference rect in viewport coords (vx,vy = top-left, vw,vh = size); floating-ui
   *  places the card above/below it. */
  vx: number
  vy: number
  vw: number
  vh: number
  /** create: world anchor + the moment + the detected target. */
  wx?: number
  wy?: number
  roundIndex?: number
  t?: number
  anchor?: CommentAnchor
  /** edit: the comment being changed. */
  id?: string
  text?: string
  author?: string
  duration?: number
  kind?: CommentKind
  isArea?: boolean
  textInside?: boolean
  /** Resolved target badge shown in the popover. */
  anchorLabel?: string
  anchorIcon?: string
}

interface CommentFlowOptions {
  r: ReplayControls
  comments: CommentStore
  t: (key: string) => string
}

export function useCommentFlow({ r, comments, t }: CommentFlowOptions) {
  const popover = ref<Popover | null>(null)
  const commentMode = ref(false)
  const lastAuthor = useLocalStorage('viewer.comment.author', '')
  const panelOpen = ref(false)

  /** While creating an area comment, the rectangle being drawn (world coords), so
   *  the map keeps it visible and connected to the open popover. */
  const pendingArea = computed(() => {
    const p = popover.value
    if (p?.mode === 'create' && p.anchor?.kind === 'area' && p.wx != null && p.wy != null) {
      return { x: p.wx, y: p.wy, x2: p.anchor.x2, y2: p.anchor.y2, kind: p.kind }
    }
    return null
  })

  /** Live kind change from the popover, so the pending area recolors as you pick. */
  function onPopoverKind(k: CommentKind) {
    if (popover.value) popover.value.kind = k
  }

  /** While the popover is open, its anchor (world coords + kind) so the map can keep
   *  the popover pinned to it as the view (zoom/pan) or the anchored player moves. */
  const popoverAnchor = computed(() => {
    const p = popover.value
    if (!p || !p.anchor || p.wx == null || p.wy == null) return null
    return { anchor: p.anchor, wx: p.wx, wy: p.wy }
  })
  /** The map recomputed the anchor's screen rect; re-pin the popover to it. */
  function onPopoverMoved(rect: { vx: number; vy: number; vw: number; vh: number }) {
    const p = popover.value
    if (!p) return
    p.vx = rect.vx
    p.vy = rect.vy
    p.vw = rect.vw
    p.vh = rect.vh
  }

  /** Human label for what a comment is anchored to (player name / grenade / point). */
  function anchorLabel(anchor: CommentAnchor): string {
    if (anchor.kind === 'player') {
      return r.playersById.value.get(anchor.steamId)?.name ?? t('viewer.comment.targetPlayer')
    }
    if (anchor.kind === 'grenade') return t(`grenadeKind.${anchor.grenadeKind}`)
    if (anchor.kind === 'area') return t('viewer.comment.targetArea')
    return t('viewer.comment.targetPoint')
  }
  function anchorIcon(anchor: CommentAnchor): string {
    if (anchor.kind === 'player') return 'user'
    if (anchor.kind === 'grenade') return 'flame'
    if (anchor.kind === 'area') return 'square'
    return 'map-pin'
  }

  function onDropComment(p: {
    x: number
    y: number
    anchor: CommentAnchor
    vx: number
    vy: number
    vw: number
    vh: number
  }) {
    r.pause()
    popover.value = {
      mode: 'create',
      vx: p.vx,
      vy: p.vy,
      vw: p.vw,
      vh: p.vh,
      wx: p.x,
      wy: p.y,
      roundIndex: r.roundIndex.value,
      t: r.currentT.value,
      anchor: p.anchor,
      author: lastAuthor.value,
      duration: 5,
      kind: 'note',
      isArea: p.anchor.kind === 'area',
      textInside: false,
      anchorLabel: anchorLabel(p.anchor),
      anchorIcon: anchorIcon(p.anchor),
    }
  }

  function jumpToComment(c: { roundIndex: number; t: number }) {
    r.pause()
    r.selectRound(c.roundIndex)
    r.seekBySeconds(c.t - r.currentT.value)
  }

  function onSelectComment(p: { id: string; vx: number; vy: number; vw: number; vh: number }) {
    const c = comments.comments.value.find((x) => x.id === p.id)
    if (!c) return
    jumpToComment(c)
    popover.value = {
      mode: 'edit',
      vx: p.vx,
      vy: p.vy,
      vw: p.vw,
      vh: p.vh,
      anchor: c.anchor,
      wx: c.x,
      wy: c.y,
      id: c.id,
      text: c.text,
      author: c.author ?? '',
      duration: commentDuration(c),
      kind: c.kind ?? 'note',
      isArea: c.anchor.kind === 'area',
      textInside: c.textInside ?? false,
      anchorLabel: anchorLabel(c.anchor),
      anchorIcon: anchorIcon(c.anchor),
    }
  }

  function onPopoverSave({
    text,
    author,
    duration,
    kind,
    textInside,
  }: {
    text: string
    author: string
    duration: number
    kind: CommentKind
    textInside: boolean
  }) {
    const p = popover.value
    if (!p) return
    lastAuthor.value = author
    if (p.mode === 'create') {
      comments.add({
        roundIndex: p.roundIndex ?? r.roundIndex.value,
        t: p.t ?? r.currentT.value,
        duration,
        x: p.wx ?? 0,
        y: p.wy ?? 0,
        anchor: p.anchor ?? { kind: 'point' },
        kind,
        textInside,
        text,
        author,
      })
    } else if (p.id) {
      comments.update(p.id, { text, author, duration, kind, textInside })
    }
    popover.value = null
  }

  function onPopoverRemove() {
    if (popover.value?.id) comments.remove(popover.value.id)
    popover.value = null
  }

  // Switching rounds from the controls dismisses an open popover (its pin is
  // round-scoped); jump-to-comment stays on the same round, so it is unaffected.
  function selectRound(i: number) {
    popover.value = null
    r.selectRound(i)
  }

  function onPanelUpdate(patch: {
    id: string
    text?: string
    author?: string
    duration?: number
    kind?: CommentKind
    textInside?: boolean
  }) {
    comments.update(patch.id, patch)
  }

  /** Comments anchored to the round in view (drives the pins + timeline markers). */
  const roundComments = computed(() =>
    comments.comments.value.filter((c) => c.roundIndex === r.roundIndex.value),
  )

  /** Round indices that have at least one comment (drives the round badge). */
  const commentedRounds = computed(() => {
    const s = new Set<number>()
    for (const c of comments.comments.value) s.add(c.roundIndex)
    return s
  })

  function toggleCommentMode() {
    commentMode.value = !commentMode.value
    if (commentMode.value) {
      // Pause on entering so the map (and the bubbles) stays still while annotating,
      // and open the comments sidebar (the side rosters are hidden to make room).
      r.pause()
      panelOpen.value = true
    } else {
      popover.value = null
      panelOpen.value = false
    }
  }

  return {
    popover,
    commentMode,
    panelOpen,
    pendingArea,
    onPopoverKind,
    popoverAnchor,
    onPopoverMoved,
    anchorLabel,
    anchorIcon,
    onDropComment,
    jumpToComment,
    onSelectComment,
    onPopoverSave,
    onPopoverRemove,
    selectRound,
    onPanelUpdate,
    roundComments,
    commentedRounds,
    toggleCommentMode,
  }
}
