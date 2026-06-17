<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onKeyStroke, useEventListener, useLocalStorage } from '@vueuse/core'
import type { Replay, VoiceData } from '@/viewer/schema'
import ViewerMap from '@/viewer/ViewerMap.vue'
import ViewerControls from '@/viewer/ViewerControls.vue'
import ViewerRoster from '@/viewer/ViewerRoster.vue'
import ViewerKillfeed from '@/viewer/ViewerKillfeed.vue'
import ViewerChat from '@/viewer/ViewerChat.vue'
import ViewerScoreboard from '@/viewer/ViewerScoreboard.vue'
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
import { useReplay, SPEEDS } from '@/viewer/useReplay'
import { useVoicePlayback } from '@/viewer/useVoicePlayback'
import { MAP_CALIBRATION } from '@/viewer/calibration'
import { SIDE_COLOR } from '@/viewer/colors'
import { roundOutcome } from '@/viewer/roundOutcome'
import { useI18n } from '@/i18n'

const { t } = useI18n()

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
      <div class="relative h-full w-full select-none bg-ink-950">
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
    />

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
      </div>
    </div>

    <!-- Killfeed: round kills up to the current moment (top-right) -->
    <div class="pointer-events-none absolute right-4 top-4 z-10">
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
          @toggle="r.toggle"
          @seek="r.seek"
          @select-round="r.selectRound"
          @set-speed="(s) => (r.speed.value = s)"
          @toggle-mute="audio.toggleMute"
          @set-master-volume="audio.setMasterVolume"
          @set-balance="audio.setBalance"
          :advanced-options="advancedOptions"
          @toggle-advanced="toggleAdvanced"
        />
      </div>
    </div>
      </div>
    </ContextMenuTrigger>

    <!-- Context menu (right click) of the replay -->
    <ContextMenuContent class="w-60">
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
