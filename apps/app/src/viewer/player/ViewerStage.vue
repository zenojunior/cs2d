<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { onKeyStroke, useEventListener, useLocalStorage } from '@vueuse/core'
import { appFullscreenKey } from '@/shell/appFullscreen'
import type { CommentAnchor, CommentKind, Replay, VoiceData } from '@/viewer/domain/schema'
import ViewerMap from '@/viewer/player/ViewerMap.vue'
import ViewerControls from '@/viewer/player/ViewerControls.vue'
import ViewerRoster from '@/viewer/player/ViewerRoster.vue'
import ViewerKillfeed from '@/viewer/player/ViewerKillfeed.vue'
import ViewerChat from '@/viewer/player/ViewerChat.vue'
import ViewerScoreboard from '@/viewer/player/ViewerScoreboard.vue'
import CommentPopover from '@/viewer/comments/CommentPopover.vue'
import CommentsPanel from '@/viewer/comments/CommentsPanel.vue'
import UiIcon from '@/ui/UiIcon.vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { useReplay, SPEEDS } from '@/viewer/player/useReplay'
import { useVoicePlayback } from '@/viewer/player/useVoicePlayback'
import { useComments } from '@/viewer/comments/useComments'
import { commentDuration } from '@/viewer/comments/commentAnchor'
import { exportArchive, archiveFileName } from '@/viewer/ingest/demoArchive'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { roundOutcome } from '@/viewer/domain/roundOutcome'
import { useI18n } from '@/i18n'

const { t } = useI18n()

// Fullscreen toggle, provided by the app shell (hides the top bar when active).
const appFullscreen = inject(appFullscreenKey, null)
const isFullscreen = computed(() => appFullscreen?.isFullscreen.value ?? false)
function toggleFullscreen() {
  void appFullscreen?.toggle()
}

/**
 * 2D replay stage: map, players, killfeed, rosters, clock and transport. Takes a
 * `Replay` already loaded (from the WASM parser in the worker), so it stays
 * independent of how the match arrived. The surrounding chrome (upload, appbar,
 * etc.) is the responsibility of whoever uses this component.
 */
const props = defineProps<{
  replay: Replay
  /** Player voice (comms), when the demo carried recorded audio. */
  voice?: VoiceData | null
  /** Source label shown at the top (e.g. "FACEIT demo" or the file name). */
  sourceLabel?: string
  /** Demo id in local history, used to load/save this demo's comments. */
  id?: string
  /** Original demo file name, used to name the exported archive. */
  fileName?: string
}>()

const r = useReplay()
watch(
  () => props.replay,
  (rep) => r.setReplay(rep),
  { immediate: true },
)

// Comms audio synced to the replay clock. Voice comes via prop (may not exist,
// e.g. a demo with no recorded voice).
const voiceRef = computed(() => props.voice ?? null)
const audio = useVoicePlayback({
  voice: voiceRef,
  round: r.round,
  currentT: r.currentT,
  playing: r.playing,
  speed: r.speed,
  sideById: r.sideById,
})

// Only show the comms control when the demo carried voice.
const hasVoice = computed(() => (props.voice?.tracks?.length ?? 0) > 0)

// Grenades live on their own tab now; this lets that tab seek the replay to a
// throw (round + instant) and switch back here. currentT recomputes to ~0 after
// selectRound, so the delta lands on the throw frame.
function jumpToThrow({ roundIndex, t }: { roundIndex: number; t: number }) {
  r.pause()
  r.selectRound(roundIndex)
  r.seekBySeconds(t - r.currentT.value)
}

// --- Comments ----------------------------------------------------------------
const comments = useComments()

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
const popover = ref<Popover | null>(null)

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

// Right-click context menu actions, keyed to the comment under the cursor (set on
// contextmenu by the map; null when the right-click missed every comment).
const contextComment = ref<{ id: string; vx: number; vy: number; vw: number; vh: number } | null>(null)
function onContextComment(p: { id: string; vx: number; vy: number; vw: number; vh: number } | null) {
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
const contextTarget = ref<{
  x: number
  y: number
  z: number
  yaw: number
  anchor: CommentAnchor
  vx: number
  vy: number
} | null>(null)
function onContextTarget(
  p: { x: number; y: number; z: number; yaw: number; anchor: CommentAnchor; vx: number; vy: number } | null,
) {
  contextTarget.value = p
}
function addContextComment() {
  const tgt = contextTarget.value
  if (tgt) onDropComment({ x: tgt.x, y: tgt.y, anchor: tgt.anchor, vx: tgt.vx, vy: tgt.vy, vw: 0, vh: 0 })
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
const commentMode = ref(false)
const lastAuthor = useLocalStorage('viewer.comment.author', '')
const stageEl = ref<HTMLElement | null>(null)

// Load this demo's comments (and clear when switching demos).
watch(
  () => props.id,
  (id) => {
    popover.value = null
    comments.clear()
    if (id) void comments.loadFor(id)
  },
  { immediate: true },
)

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
  // Pause on entering so the map (and the bubbles) stays still while annotating.
  if (commentMode.value) r.pause()
  else popover.value = null
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

// --- Comments panel (side drawer) --------------------------------------------
const panelOpen = ref(false)
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

// --- Export ------------------------------------------------------------------
const exporting = ref(false)
const exportError = ref<string | null>(null)
async function exportReplay() {
  if (exporting.value) return
  exporting.value = true
  exportError.value = null
  try {
    const name = props.fileName || props.sourceLabel || props.replay.map
    const blob = await exportArchive({
      fileName: props.fileName || props.sourceLabel || `${props.replay.map}.dem`,
      replay: props.replay,
      voice: props.voice ?? null,
      comments: comments.comments.value,
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = archiveFileName(name)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    exportError.value = err instanceof Error ? err.message : String(err)
    console.error('Replay export failed:', err)
  } finally {
    exporting.value = false
  }
}

// Player advanced options ("Advanced" menu). Extensible: each item toggles a
// behavior. For now: auto zoom that frames the players.
// Advanced options persist across sessions (localStorage).
const autoZoom = useLocalStorage('viewer.advanced.autoZoom', false)
const advancedOptions = computed(() => [
  {
    key: 'autoZoom',
    label: t('viewer.autoZoom'),
    description: t('viewer.autoZoomDesc'),
    enabled: autoZoom.value,
  },
  {
    key: 'autoAdvance',
    label: t('viewer.autoAdvance'),
    description: t('viewer.autoAdvanceDesc'),
    enabled: r.autoAdvance.value,
  },
  {
    key: 'skipFreeze',
    label: t('viewer.skipFreeze'),
    description: t('viewer.skipFreezeDesc'),
    enabled: r.skipFreeze.value,
  },
])
function toggleAdvanced(key: string) {
  if (key === 'autoZoom') autoZoom.value = !autoZoom.value
  else if (key === 'autoAdvance') r.autoAdvance.value = !r.autoAdvance.value
  else if (key === 'skipFreeze') r.skipFreeze.value = !r.skipFreeze.value
}

const calibration = computed(() => {
  const map = r.replay.value?.map
  return (map && MAP_CALIBRATION[map]) || MAP_CALIBRATION.de_dust2
})

// Two-floor maps (e.g. Nuke): level selector that swaps the background radar and
// fades the players on the other floor. Manual and predictable (no auto-flip).
const mapLevels = computed(() => calibration.value.levels ?? null)
const activeLevel = ref(0)
watch(mapLevels, () => (activeLevel.value = 0))
const activeLevelRadar = computed(
  () => mapLevels.value?.[activeLevel.value]?.radar ?? calibration.value.radar,
)
const activeLevelRange = computed(() => {
  const lvl = mapLevels.value?.[activeLevel.value]
  return lvl ? { minZ: lvl.minZ, maxZ: lvl.maxZ } : null
})

function fmtClock(s: number) {
  // Ceil the total seconds so the clock holds the upper whole second and only
  // hits 0:00 at the actual deadline (e.g. the bomb shows 0:00 the instant it
  // blows, not a full second early). Split after rounding to avoid 1:60.
  const total = Math.ceil(s)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Red highlight: bomb planted or live round ending (<= 10s). Never during freeze.
const clockAlert = computed(
  () =>
    r.clock.value.phase === 'bomb' ||
    (r.clock.value.phase === 'round' && r.clock.value.seconds <= 10),
)

// Keyboard shortcuts: space toggles play/pause, arrows seek +/-5s in the round.
// Ignored when focus is in a text field.
const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', 'number']
function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.includes((el as HTMLInputElement).type)
}

onKeyStroke(' ', (e) => {
  if (isTyping(e)) return
  e.preventDefault()
  r.toggle()
})
onKeyStroke('ArrowRight', (e) => {
  if (isTyping(e)) return
  e.preventDefault()
  r.seekBySeconds(5)
})
onKeyStroke('ArrowLeft', (e) => {
  if (isTyping(e)) return
  e.preventDefault()
  r.seekBySeconds(-5)
})

// Scoreboard (TAB style): shown while the key is held.
const scoreboardOpen = ref(false)
onKeyStroke(
  'Tab',
  (e) => {
    if (isTyping(e)) return
    e.preventDefault()
    scoreboardOpen.value = true
  },
  { eventName: 'keydown' },
)
onKeyStroke(
  'Tab',
  (e) => {
    e.preventDefault()
    scoreboardOpen.value = false
  },
  { eventName: 'keyup' },
)
// Lost focus (e.g. alt-tab) with TAB held: make sure the scoreboard closes.
useEventListener(window, 'blur', () => (scoreboardOpen.value = false))

// Color of the side that won the round (for the Rounds menu); neutral if none.
function roundWinnerColor(i: number): string {
  const winner = r.replay.value?.rounds[i]?.winner
  return winner ? SIDE_COLOR[winner] : 'var(--color-ink-600)'
}

// Round outcome icon (bomb, defuse, elimination, time).
function roundOutcomeFor(i: number) {
  return roundOutcome(r.replay.value?.rounds[i]?.reason ?? null)
}

// Container hooks: `pause` stops playback when leaving this tab (the stage stays
// mounted via v-show); `jumpToThrow` lets the grenades tab seek the replay; and
// `roundIndex` exposes the focused round for the grenades "current round" filter.
defineExpose({ pause: r.pause, jumpToThrow, roundIndex: r.roundIndex })
</script>

<template>
  <ContextMenu v-if="r.replay.value">
    <ContextMenuTrigger as-child>
      <div ref="stageEl" class="relative h-full w-full select-none bg-ink-950">
        <!-- Fullscreen map (zoom/pan) -->
        <ViewerMap
      :players="r.players.value"
      :current-t="r.currentT.value"
      :round="r.round.value"
      :calibration="calibration"
      :players-by-id="r.playersById.value"
      :bomb-blink="r.bombBlink.value"
      :talking="audio.talking.value"
      :muted="audio.mutedSides.value"
      :auto-zoom="autoZoom"
      :radar-src="activeLevelRadar"
      :level-range="activeLevelRange"
      :comments="roundComments"
      :comment-mode="commentMode"
      :active-comment-id="popover?.id ?? null"
      :pending-area="pendingArea"
      @drop-comment="onDropComment"
      @select-comment="onSelectComment"
      :popover-anchor="popoverAnchor"
      @context-comment="onContextComment"
      @context-target="onContextTarget"
      @resize-area="onResizeArea"
      @popover-moved="onPopoverMoved"
    />

    <!-- Transient confirmation toast (e.g. "position copied") -->
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="toast"
        class="pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-md bg-ink-900/90 px-3 py-1.5 text-sm text-ink-100 shadow-lg ring-1 ring-ink-700"
      >
        {{ toast }}
      </div>
    </Transition>

    <!-- Top: score and current round -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-ink-950/90 to-transparent p-4"
    >
      <div class="relative flex items-center justify-between gap-4">
        <div class="pointer-events-auto">
          <h2 class="font-display text-base text-ink-50">
            {{ t('viewer.round') }} {{ r.currentRoundLabel.value }}
            <span class="text-ink-400">{{ t('viewer.of') }} {{ r.totalRounds.value }}</span>
          </h2>
          <p class="text-xs text-ink-300">
            {{ r.replay.value.map }}<template v-if="sourceLabel"> · {{ sourceLabel }}</template>
          </p>
        </div>

        <!-- Center: score around the tactical clock -->
        <div class="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-4">
          <span class="font-mono text-2xl tabular-nums" :style="{ color: SIDE_COLOR.CT }">
            {{ r.score.value.CT }}
          </span>

          <!-- Tactical clock: freeze (buy) time, round time (1:55) or bomb (40s) -->
          <div
            class="flex items-center gap-2 rounded-lg border bg-ink-900/80 px-4 py-1.5 backdrop-blur"
            :class="
              clockAlert
                ? 'border-live/50'
                : r.clock.value.phase === 'paused'
                  ? 'border-amber-500/40'
                  : r.clock.value.phase === 'freeze'
                    ? 'border-sky-500/40'
                    : 'border-ink-700'
            "
          >
            <span
              v-if="r.clock.value.phase === 'freeze'"
              class="text-[10px] font-semibold uppercase tracking-wide text-sky-300"
            >
              {{ t('viewer.freeze') }}
            </span>
            <span
              v-else-if="r.clock.value.phase === 'bomb'"
              class="h-2.5 w-2.5 rounded-full bg-live transition-opacity duration-75"
              :class="r.bombBlink.value ? 'opacity-100 shadow-[0_0_6px_var(--color-live)]' : 'opacity-25'"
            />
            <span
              v-else-if="r.clock.value.phase === 'post'"
              class="text-[10px] font-semibold uppercase tracking-wide text-ink-400"
            >
              {{ t('viewer.over') }}
            </span>
            <UiIcon
              v-else
              :name="r.clock.value.phase === 'paused' ? 'pause' : 'clock'"
              class="h-3.5 w-3.5"
              :class="
                clockAlert ? 'text-live' : r.clock.value.phase === 'paused' ? 'text-amber-400' : 'text-ink-400'
              "
            />
            <!-- During a pause the game clock is frozen: show "paused", no timer. -->
            <span
              v-if="r.clock.value.phase === 'paused'"
              class="text-sm font-semibold uppercase tracking-wide text-amber-300"
            >
              {{ t('viewer.paused') }}
            </span>
            <span
              v-else
              class="font-mono text-xl tabular-nums"
              :class="
                clockAlert
                  ? 'text-live'
                  : r.clock.value.phase === 'freeze'
                    ? 'text-sky-200'
                    : r.clock.value.phase === 'post'
                      ? 'text-ink-400'
                      : 'text-ink-50'
              "
            >
              {{ fmtClock(r.clock.value.seconds) }}
            </span>
          </div>

          <span class="font-mono text-2xl tabular-nums" :style="{ color: SIDE_COLOR.T }">
            {{ r.score.value.T }}
          </span>
        </div>

        <!-- Right: comments panel, export -->
        <div class="pointer-events-auto flex items-center gap-1.5">
          <button
            v-tooltip="t('viewer.comment.panelTitle')"
            class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150"
            :class="panelOpen ? 'bg-surge-500 text-white' : 'text-ink-200 hover:bg-white/10 hover:text-white'"
            @click="panelOpen = !panelOpen"
          >
            <UiIcon name="message" class="h-5 w-5" />
          </button>
          <button
            v-tooltip="t('viewer.exportTitle')"
            :disabled="exporting"
            class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            @click="exportReplay"
          >
            <UiIcon
              :name="exporting ? 'loader' : 'download'"
              class="h-5 w-5"
              :class="{ 'animate-spin': exporting }"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Comment mode hint -->
    <div
      v-if="commentMode && !exportError"
      class="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center"
    >
      <span class="rounded-full bg-surge-500/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur">
        {{ t('viewer.comment.modeHint') }}
      </span>
    </div>

    <!-- Export error: dismissible banner -->
    <div
      v-if="exportError"
      class="pointer-events-auto absolute inset-x-0 top-20 z-20 flex justify-center"
    >
      <button
        type="button"
        v-tooltip="exportError"
        class="flex cursor-pointer items-center gap-2 rounded-full bg-loss/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur"
        @click="exportError = null"
      >
        <UiIcon name="ban" class="h-3.5 w-3.5" />
        {{ t('viewer.exportError') }}
        <UiIcon name="x" class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Killfeed: round kills up to the current moment (top-right, below the top bar) -->
    <div class="pointer-events-none absolute right-4 top-16 z-10">
      <ViewerKillfeed
        :round="r.round.value"
        :current-t="r.currentT.value"
        :players-by-id="r.playersById.value"
        :side-by-id="r.sideById.value"
      />
    </div>

    <!-- Match chat (top-left, below the action buttons) -->
    <div class="pointer-events-none absolute left-4 top-32 z-10">
      <ViewerChat
        :round="r.round.value"
        :current-t="r.currentT.value"
        :side-by-id="r.sideById.value"
      />
    </div>

    <!-- Scoreboard (TAB): above everything while the key is held -->
    <ViewerScoreboard
      v-if="scoreboardOpen"
      :rounds="r.replay.value.rounds"
      :round-index="r.roundIndex.value"
      :current-t="r.currentT.value"
      :players="r.players.value"
      :players-by-id="r.playersById.value"
      :score="r.score.value"
      :ct-name="r.round.value?.ctName ?? ''"
      :t-name="r.round.value?.tName ?? ''"
      :map="r.replay.value.map"
      :round-label="r.currentRoundLabel.value"
      :total-rounds="r.totalRounds.value"
    />

    <!-- CT team: bottom-left corner -->
    <aside
      class="pointer-events-auto absolute bottom-4 left-4 z-10 w-52 rounded-lg border border-ink-700 bg-ink-900/80 p-3 backdrop-blur"
    >
      <ViewerRoster
        :players="r.players.value"
        :players-by-id="r.playersById.value"
        :score="r.score.value"
        side="CT"
        align="left"
        :hide-score="true"
      />
    </aside>

    <!-- T team: bottom-right corner -->
    <aside
      class="pointer-events-auto absolute bottom-4 right-4 z-10 w-52 rounded-lg border border-ink-700 bg-ink-900/80 p-3 backdrop-blur"
    >
      <ViewerRoster
        :players="r.players.value"
        :players-by-id="r.playersById.value"
        :score="r.score.value"
        side="T"
        align="right"
        :hide-score="true"
      />
    </aside>

    <!-- Footer: transport -->
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-950/90 to-transparent p-4"
    >
      <!-- Floor selector (multi-level maps only, e.g. Nuke): just above the player -->
      <div
        v-if="mapLevels"
        class="pointer-events-auto mx-auto mb-2 flex w-fit items-center gap-0.5 rounded-md border border-ink-700 bg-ink-900/80 p-0.5 backdrop-blur"
      >
        <button
          v-for="(lvl, i) in mapLevels"
          :key="i"
          type="button"
          class="cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors"
          :class="activeLevel === i ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
          @click="activeLevel = i"
        >
          {{ lvl.name }}
        </button>
      </div>

      <div
        class="pointer-events-auto mx-auto max-w-3xl rounded-lg border border-ink-700 bg-ink-900/80 p-3 backdrop-blur"
      >
        <ViewerControls
          :rounds="r.replay.value.rounds"
          :round-labels="r.roundLabels.value"
          :round-index="r.roundIndex.value"
          :frame-index="r.frameIndex.value"
          :frame-count="r.frameCount.value"
          :round="r.round.value"
          :current-t="r.currentT.value"
          :playing="r.playing.value"
          :speed="r.speed.value"
          :show-voice="hasVoice && audio.supported"
          :muted="audio.muted.value"
          :master-volume="audio.masterVolume.value"
          :balance="audio.balance.value"
          :waveform="audio.roundWaveform.value"
          :demo-tick-rate="r.replay.value.demoTickRate"
          :pauses="r.replay.value.pauses ?? []"
          :comments="roundComments"
          :commented-rounds="commentedRounds"
          :comment-mode="commentMode"
          :fullscreen="isFullscreen"
          @toggle="r.toggle"
          @toggle-comment-mode="toggleCommentMode"
          @toggle-fullscreen="toggleFullscreen"
          @seek="r.seek"
          @select-round="selectRound"
          @set-speed="(s) => (r.speed.value = s)"
          @toggle-mute="audio.toggleMute"
          @set-master-volume="audio.setMasterVolume"
          @set-balance="audio.setBalance"
          :advanced-options="advancedOptions"
          @toggle-advanced="toggleAdvanced"
        />
      </div>
    </div>

    <!-- Comment create/edit popover, anchored at the pin -->
    <CommentPopover
      v-if="popover"
      :key="popover.id ?? `${popover.vx}-${popover.vy}`"
      :mode="popover.mode"
      :vx="popover.vx"
      :vy="popover.vy"
      :vw="popover.vw"
      :vh="popover.vh"
      :text="popover.text"
      :author="popover.author"
      :duration="popover.duration"
      :kind="popover.kind"
      :is-area="popover.isArea"
      :text-inside="popover.textInside"
      :anchor-label="popover.anchorLabel"
      :anchor-icon="popover.anchorIcon"
      @update:kind="onPopoverKind"
      @save="onPopoverSave"
      @remove="onPopoverRemove"
      @close="popover = null"
    />

    <!-- Comments side drawer -->
    <CommentsPanel
      v-if="panelOpen"
      :comments="comments.comments.value"
      :round-labels="r.roundLabels.value"
      :players-by-id="r.playersById.value"
      @update="onPanelUpdate"
      @remove="comments.remove"
      @jump="jumpToComment"
      @close="panelOpen = false"
    />
      </div>
    </ContextMenuTrigger>

    <!-- Context menu (right click) of the replay -->
    <ContextMenuContent class="w-60">
      <!-- Comment actions, shown when the right-click landed on a comment -->
      <template v-if="contextComment">
        <ContextMenuItem @select="editContextComment">
          <UiIcon name="pencil" class="h-4 w-4 text-ink-400" />
          {{ t('viewer.comment.edit') }}
        </ContextMenuItem>
        <ContextMenuItem @select="deleteContextComment">
          <UiIcon name="trash-2" class="h-4 w-4 text-ink-400" />
          {{ t('viewer.comment.delete') }}
        </ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <!-- Add a comment on the player under the right-click -->
      <template v-else-if="contextTarget">
        <ContextMenuItem @select="addContextComment">
          <UiIcon name="message" class="h-4 w-4 text-ink-400" />
          {{ t('viewer.comment.add') }}
          <span class="ml-auto max-w-28 truncate pl-3 text-ink-400">
            {{ anchorLabel(contextTarget.anchor) }}
          </span>
        </ContextMenuItem>
        <ContextMenuItem @select="copyContextSetpos">
          <UiIcon name="copy" class="h-4 w-4 text-ink-400" />
          {{ t('viewer.copyPos') }}
        </ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <ContextMenuItem @select="r.toggle">
        <UiIcon :name="r.playing.value ? 'pause' : 'play'" class="h-4 w-4 text-ink-400" />
        {{ r.playing.value ? t('viewer.pause') : t('viewer.play') }}
        <ContextMenuShortcut>{{ t('viewer.space') }}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem @select="r.seekBySeconds(-5)">
        <UiIcon name="rotate-ccw" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.back5') }}
        <ContextMenuShortcut>&larr;</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem @select="r.seekBySeconds(5)">
        <UiIcon name="rotate-cw" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.fwd5') }}
        <ContextMenuShortcut>&rarr;</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <UiIcon name="signal" class="h-4 w-4 text-ink-400" />
          {{ t('viewer.speed') }}
          <span class="ml-auto pl-4 font-mono text-xs text-ink-400">{{ r.speed.value }}x</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem v-for="s in SPEEDS" :key="s" inset @select="r.speed.value = s">
            <UiIcon
              v-if="s === r.speed.value"
              name="check"
              class="absolute left-2 h-3.5 w-3.5 text-surge-400"
            />
            {{ s }}x
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <UiIcon name="grid" class="h-4 w-4 text-ink-400" />
          {{ t('viewer.rounds') }}
          <span class="ml-auto pl-4 font-mono text-xs text-ink-400">
            {{ r.currentRoundLabel.value }}/{{ r.totalRounds.value }}
          </span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent class="max-h-80 overflow-y-auto">
          <ContextMenuItem
            v-for="(label, i) in r.roundLabels.value"
            :key="i"
            inset
            @select="r.selectRound(i)"
          >
            <UiIcon
              v-if="i === r.roundIndex.value"
              name="check"
              class="absolute left-2 h-3.5 w-3.5 text-surge-400"
            />
            <span
              class="mr-2 inline-block h-2 w-2 shrink-0 rounded-full"
              :style="{ backgroundColor: roundWinnerColor(i) }"
            />
            <span class="flex-1">{{ label === '0' ? t('viewer.knife') : `${t('viewer.round')} ${label}` }}</span>
            <UiIcon
              v-if="roundOutcomeFor(i)"
              :name="roundOutcomeFor(i)!.icon"
              class="ml-3 h-3.5 w-3.5 text-ink-400"
            />
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  </ContextMenu>
</template>
