<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { appFullscreenKey } from '@/shell/appFullscreen'
import type { Replay, VoiceData } from '@/viewer/domain/schema'
import ViewerMap from '@/viewer/player/ViewerMap.vue'
import ViewerControls from '@/viewer/player/ViewerControls.vue'
import CoachToolbar from '@/viewer/player/CoachToolbar.vue'
import ViewerRoster from '@/viewer/player/ViewerRoster.vue'
import ViewerKillfeed from '@/viewer/player/ViewerKillfeed.vue'
import ViewerChat from '@/viewer/player/ViewerChat.vue'
import ViewerScoreboard from '@/viewer/player/ViewerScoreboard.vue'
import CommentPopover from '@/viewer/comments/CommentPopover.vue'
import CommentsPanel from '@/viewer/comments/CommentsPanel.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { ContextMenu, ContextMenuTrigger } from '@/ui/context-menu'
import StageBadges from '@/viewer/player/StageBadges.vue'
import StageContextMenu from '@/viewer/player/StageContextMenu.vue'
import { useReplay } from '@/viewer/player/useReplay'
import { useVoicePlayback } from '@/viewer/player/useVoicePlayback'
import { useComments } from '@/viewer/comments/useComments'
import { useCoachBoard } from '@/viewer/player/useCoachBoard'
import { useCoachSession } from '@/viewer/player/useCoachSession'
import { useReplayExport } from '@/viewer/player/useReplayExport'
import { useMapLevels } from '@/viewer/player/useMapLevels'
import { useViewerShortcuts } from '@/viewer/player/useViewerShortcuts'
import { useCommentFlow } from '@/viewer/player/useCommentFlow'
import { useContextMenu } from '@/viewer/player/useContextMenu'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { useI18n } from '@/app/i18n'

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
  /**
   * Start past the freeze time (e.g. Major clips opened with `?skipFreeze=1`).
   * A transient override that does not change the saved user preference.
   */
  skipFreeze?: boolean
  /** Start playing as soon as the replay loads (e.g. Major clips). */
  autoplay?: boolean
  /** Whether the stage is the visible tab. The stage stays mounted (via v-show)
   *  on other tabs, so keyboard shortcuts must stand down unless it's active, or
   *  e.g. Space would toggle playback (and audio) from the heatmap. Default true
   *  for standalone uses (the sample demo viewer). */
  active?: boolean
}>()

const r = useReplay()
// Apply the per-view skip-freeze override before the replay loads, so the first
// round opens past the freeze. Declared first so its immediate run precedes
// setReplay's.
watch(() => props.skipFreeze, (v) => r.forceSkipFreeze(!!v), { immediate: true })
watch(
  () => props.replay,
  (rep) => {
    r.setReplay(rep)
    if (props.autoplay) r.play()
  },
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
// Tactical board (coach mode). Declared here (with the coach-mode flag) so the
// demo-switch watch below, which resets them, runs after initialization (it would
// otherwise hit a TDZ error).
const board = useCoachBoard()
const coachMode = ref(false)

// Comment interaction: the create/edit popover lifecycle, comment mode + panel,
// and the seek-to-comment helpers. Declared early so the demo-switch watch and
// coach mode below can reset `popover`/`commentMode`.
const commentFlow = useCommentFlow({ r, comments, t })
const {
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
} = commentFlow

// Right-click context menu: comment/target under the cursor + its actions. The
// edit/create actions delegate to the comment flow; follow is owned by the stage.
const {
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
} = useContextMenu({
  comments,
  t,
  onSelectComment: commentFlow.onSelectComment,
  onDropComment: commentFlow.onDropComment,
  toggleFollow,
})

const stageEl = ref<HTMLElement | null>(null)

// Load this demo's comments (and clear when switching demos).
watch(
  () => props.id,
  (id) => {
    popover.value = null
    comments.clear()
    board.reset()
    coachMode.value = false
    if (id) void comments.loadFor(id)
  },
  { immediate: true },
)

// Coach mode: a tactical-board overlay that hides the game HUD and replaces the
// transport's extras with a Figma-style toolbar so a coach can mark the map up.
// `coachMode` is owned by the stage (above); the board wiring lives here.
const {
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
} = useCoachSession({
  r,
  board,
  coachMode,
  commentMode,
  closePopover: () => {
    popover.value = null
  },
})




// --- Export ------------------------------------------------------------------
const { exporting, exportError, exportReplay } = useReplayExport({
  fileName: () => props.fileName,
  sourceLabel: () => props.sourceLabel,
  replay: () => props.replay,
  voice: () => props.voice ?? null,
  comments: () => comments.comments.value,
})

// Player advanced options ("Advanced" menu). Extensible: each item toggles a
// behavior. For now: auto zoom that frames the players.
// Advanced options persist across sessions (localStorage).
const autoZoom = useLocalStorage('viewer.advanced.autoZoom', false)
const lowQualityEffects = useLocalStorage('viewer.advanced.lowQualityEffects', false)

// Follow a player: clicking a roster card centers and tracks them on the map.
// Clicking the same player (or Esc / the exit badge) stops following.
const followSteamId = ref<string | null>(null)
function toggleFollow(steamId: string) {
  followSteamId.value = followSteamId.value === steamId ? null : steamId
}
// Dragging the map by hand hands control back to the user: drop follow and auto zoom.
function onCancelCamera() {
  followSteamId.value = null
  autoZoom.value = false
}
const followName = computed(() =>
  followSteamId.value ? (r.playersById.value.get(followSteamId.value)?.name ?? '?') : '',
)
const advancedOptions = computed(() => [
  {
    key: 'autoZoom',
    label: t('viewer.autoZoom'),
    description: t('viewer.autoZoomDesc'),
    enabled: autoZoom.value,
  },
  {
    key: 'lowQualityEffects',
    label: t('viewer.lowQualityEffects'),
    description: t('viewer.lowQualityEffectsDesc'),
    enabled: lowQualityEffects.value,
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
  else if (key === 'lowQualityEffects') lowQualityEffects.value = !lowQualityEffects.value
  else if (key === 'autoAdvance') r.autoAdvance.value = !r.autoAdvance.value
  else if (key === 'skipFreeze') r.skipFreeze.value = !r.skipFreeze.value
}

// Map calibration + the two-floor level selector (e.g. Nuke): swaps the radar
// and the Z range that dims players on the other floor.
const { calibration, mapLevels, activeLevel, activeLevelRadar, activeLevelRange } = useMapLevels(
  () => r.replay.value?.map,
)

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

// Keyboard shortcuts (space/arrows/undo-redo/Tab scoreboard/Esc). Owns the
// held-Tab scoreboard state; play/seek and board undo/redo are wired in.
const { scoreboardOpen } = useViewerShortcuts({
  active: () => props.active,
  coachMode,
  followSteamId,
  toggle: () => r.toggle(),
  seek: (s) => r.seekBySeconds(s),
  undo: () => board.undo(),
  redo: () => board.redo(),
})

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
      :follow-steam-id="followSteamId"
      :low-quality-effects="lowQualityEffects"
      :radar-src="activeLevelRadar"
      :level-range="activeLevelRange"
      :comments="roundComments"
      :comment-mode="commentMode"
      :active-comment-id="popover?.id ?? null"
      :pending-area="pendingArea"
      :coach-mode="coachMode"
      :coach-tool="coachTool"
      :coach-color="coachColor"
      :coach-thickness="coachThickness"
      :coach-drawings="roundCoachDrawings"
      :player-overrides="roundCoachOverrides"
      :coach-grenades="roundCoachGrenades"
      :coach-grenade-kind="coachGrenadeKind"
      @add-drawing="onAddDrawing"
      @set-player-pose="onSetPlayerPose"
      @add-grenade="onAddGrenade"
      @move-grenade="onMoveGrenade"
      @remove-grenade="onRemoveGrenade"
      @cancel-camera="onCancelCamera"
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
        <div v-if="!hudHidden" class="pointer-events-auto">
          <h2 class="font-display text-base text-ink-50">
            <template v-if="r.currentRoundLabel.value === '0'">{{ t('viewer.knifeRound') }}</template>
            <template v-else>
              {{ t('viewer.round') }} {{ r.currentRoundLabel.value }}
              <span class="text-ink-400">{{ t('viewer.of') }} {{ r.totalRounds.value }}</span>
            </template>
          </h2>
          <p class="text-xs text-ink-300">{{ r.replay.value.map }}</p>
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

        <!-- Right: coach mode, export (the comments panel opens via comment mode) -->
        <div v-if="!hudHidden" class="pointer-events-auto flex items-center gap-1.5">
          <button
            v-tooltip="t('viewer.coach.enter')"
            class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            @click="toggleCoachMode"
          >
            <UiIcon name="pencil" class="h-5 w-5" />
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


    <!-- Transient status pills: comment/coach hints, follow badge, export error -->
    <StageBadges
      :hud-hidden="hudHidden"
      :comment-mode="commentMode"
      :coach-mode="coachMode"
      :follow-steam-id="followSteamId"
      :follow-name="followName"
      :export-error="exportError"
      @unfollow="followSteamId = null"
      @dismiss-error="exportError = null"
    />

    <!-- Killfeed: round kills up to the current moment (top-right, below the top bar) -->
    <div v-if="!hudHidden" class="pointer-events-none absolute right-4 top-16 z-10">
      <ViewerKillfeed
        :round="r.round.value"
        :current-t="r.currentT.value"
        :players-by-id="r.playersById.value"
        :side-by-id="r.sideById.value"
      />
    </div>

    <!-- Match chat (top-left, below the action buttons) -->
    <div v-if="!hudHidden" class="pointer-events-none absolute left-4 top-32 z-10">
      <ViewerChat
        :round="r.round.value"
        :current-t="r.currentT.value"
        :side-by-id="r.sideById.value"
      />
    </div>

    <!-- Scoreboard (TAB): above everything while the key is held -->
    <ViewerScoreboard
      v-if="scoreboardOpen && !hudHidden"
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

    <!-- CT team: bottom-left corner (hidden in comment mode to make room for the
         panel, and hidden on mobile where there's no room for the rosters) -->
    <aside
      v-if="!hudHidden && !commentMode"
      class="pointer-events-auto absolute bottom-4 left-4 z-10 hidden w-52 sm:block"
    >
      <ViewerRoster
        :players="r.players.value"
        :players-by-id="r.playersById.value"
        :score="r.score.value"
        side="CT"
        align="left"
        :hide-score="true"
        :selected-id="followSteamId"
        @select="toggleFollow"
      />
    </aside>

    <!-- T team: bottom-right corner (hidden in comment mode to make room for the
         panel, and hidden on mobile where there's no room for the rosters) -->
    <aside
      v-if="!hudHidden && !commentMode"
      class="pointer-events-auto absolute bottom-4 right-4 z-10 hidden w-52 sm:block"
    >
      <ViewerRoster
        :players="r.players.value"
        :players-by-id="r.playersById.value"
        :score="r.score.value"
        side="T"
        align="right"
        :hide-score="true"
        :selected-id="followSteamId"
        @select="toggleFollow"
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

      <!-- Coach mode: the tactical toolbar replaces the transport bar (no timeline:
           the board is frozen on the tick the coach entered). -->
      <div v-if="coachMode" class="pointer-events-auto flex justify-center">
        <CoachToolbar
          :tool="coachTool"
          :color="coachColor"
          :thickness="coachThickness"
          :grenade-kind="coachGrenadeKind"
          :can-undo="board.canUndo.value"
          :can-redo="board.canRedo.value"
          @set-tool="(tl) => (coachTool = tl)"
          @set-color="(c) => (coachColor = c)"
          @set-thickness="(w) => (coachThickness = w)"
          @set-grenade-kind="(k) => (coachGrenadeKind = k)"
          @undo="board.undo"
          @redo="board.redo"
          @clear="clearCoachDrawings"
          @exit="toggleCoachMode"
        />
      </div>

      <div
        v-else
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
          :voice-loading="audio.decoding.value"
          :master-volume="audio.masterVolume.value"
          :balance="audio.balance.value"
          :waveform="audio.roundWaveform.value"
          :demo-tick-rate="r.replay.value.demoTickRate"
          :pauses="r.replay.value.pauses ?? []"
          :comments="roundComments"
          :players-by-id="r.playersById.value"
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
    <StageContextMenu
      :r="r"
      :context-comment="contextComment"
      :context-target="contextTarget"
      :context-player-id="contextPlayerId"
      :follow-steam-id="followSteamId"
      :anchor-label="anchorLabel"
      @edit-comment="editContextComment"
      @delete-comment="deleteContextComment"
      @follow-player="followContextPlayer"
      @add-comment="addContextComment"
      @copy-setpos="copyContextSetpos"
    />
  </ContextMenu>
</template>
