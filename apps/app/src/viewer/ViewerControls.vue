<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import type { Round, Side } from '@/viewer/schema'
import UiIcon from '@/ui/UiIcon.vue'
import UiSwitch from '@/ui/UiSwitch.vue'
import ViewerTimeline from './ViewerTimeline.vue'
import { SPEEDS } from './useReplay'
import { SIDE_COLOR } from './colors'
import { buildTimelineMarkers } from './timelineMarkers'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{
  rounds: Round[]
  roundLabels: string[]
  roundIndex: number
  frameIndex: number
  frameCount: number
  round: Round | null
  currentT: number
  playing: boolean
  speed: number
  /** The demo has voice (comms): show the audio controls in the player. */
  showVoice?: boolean
  /** Comms muted (audio off or volume at zero). */
  muted?: boolean
  /** Master comms volume (0 to 1). */
  masterVolume?: number
  /** CT<->T balance (-1 = CT only, 0 = both, +1 = T only). */
  balance?: number
  /** Per-team voice amplitude envelope (timeline waveform). */
  waveform?: { ct: number[]; t: number[] } | null
  /** Demo tick rate (for freeze/post-round timeline math). */
  demoTickRate?: number
  /** "Advanced" menu options (viewer behavior toggles). */
  advancedOptions?: { key: string; label: string; description?: string; enabled: boolean }[]
}>()

const emit = defineEmits<{
  toggle: []
  seek: [index: number]
  skip: [seconds: number]
  selectRound: [index: number]
  setSpeed: [speed: number]
  toggleMute: []
  setMasterVolume: [value: number]
  setBalance: [value: number]
  toggleAdvanced: [key: string]
}>()

// Vertical master-volume slider, revealed on hover over the comms button.
const volHover = ref(false)

// Speed dropdown: shows only the selected one and opens options on click.
const speedOpen = ref(false)
const speedMenu = ref<HTMLElement | null>(null)
onClickOutside(speedMenu, () => (speedOpen.value = false))
function pickSpeed(s: number) {
  emit('setSpeed', s)
  speedOpen.value = false
}

// "Advanced" menu: popover with behavior toggles.
const advancedOpen = ref(false)
const advancedMenu = ref<HTMLElement | null>(null)
onClickOutside(advancedMenu, () => (advancedOpen.value = false))
const advancedActive = computed(() => (props.advancedOptions ?? []).some((o) => o.enabled))

const totalT = computed(() => {
  const f = props.round?.frames
  return f && f.length ? f[f.length - 1].t : 0
})

// Freeze/post-round boundaries on the round timeline, in seconds from t = 0
// (freeze start). Fallback for replays parsed before these fields existed.
const tickRate = computed(() => props.demoTickRate || 64)
const freezeStartTick = computed(() => props.round?.freezeStartTick ?? props.round?.startTick ?? 0)
const liveStartT = computed(() => {
  const r = props.round
  if (!r) return 0
  return Math.max(0, (r.startTick - freezeStartTick.value) / tickRate.value)
})
const postStartT = computed(() => {
  const r = props.round
  if (!r) return totalT.value
  return ((r.decidedTick ?? r.endTick) - freezeStartTick.value) / tickRate.value
})
/** Freeze duration (s), for the badge — only when there is a real freeze. */
const freezeSeconds = computed(() => liveStartT.value)

const markers = computed(() => buildTimelineMarkers(props.round))

/**
 * Round indices where the teams switched sides versus the previous round
 * (halftime and every overtime swap). Detected by comparing each player's side
 * between consecutive rounds: at a swap most players flip CT<->T, within a half
 * none do. Drives the swap marker drawn between the round bubbles.
 */
const sideSwaps = computed<Set<number>>(() => {
  const swaps = new Set<number>()
  // Sample sides from a mid-round frame: sides are locked there, unlike the
  // freeze start (e.g. round 1 begins during the FACEIT side pick, so its first
  // frame can still hold the pre-pick sides).
  const sidesOf = (r: Round) => {
    const m = new Map<string, Side>()
    const f = r.frames[Math.floor(r.frames.length / 2)]
    for (const p of f?.players ?? []) m.set(p.steamId, p.side)
    return m
  }
  let prev: Map<string, Side> | null = null
  props.rounds.forEach((r, i) => {
    const cur = sidesOf(r)
    if (!cur.size) return
    if (prev) {
      let flipped = 0
      let same = 0
      for (const [id, side] of cur) {
        const before = prev.get(id)
        if (before == null) continue
        before === side ? same++ : flipped++
      }
      if (flipped > 0 && flipped >= same) swaps.add(i)
    }
    prev = cur
  })
  return swaps
})

// Pistol/utility loadout: anything outside this set is a primary (rifle, SMG,
// shotgun, sniper, MG), which means the round was a buy, not a pistol round.
const PISTOL_LOADOUT = new Set<string>([
  'Deagle', 'R8 Revolver', 'Glock-18', 'USP-S', 'P2000', 'Five-SeveN', 'Tec-9',
  'CZ75-Auto', 'P250', 'Dual Berettas',
  'Faca', 'C4', 'HE', 'Flash', 'Smoke', 'Molotov', 'Decoy', 'Zeus x27', '',
])

/**
 * Pistol rounds: a half-start round (after the knife round / after a side swap)
 * where everyone is on pistols in the opening seconds. The half-start gate keeps
 * mid-half ecos out; the loadout gate keeps overtime half-starts out (those have
 * rifle money). Drives the pistol icon on the round bubble.
 */
const pistolRounds = computed<Set<number>>(() => {
  const out = new Set<number>()
  const halfStarts = new Set<number>(sideSwaps.value)
  const firstReal = props.roundLabels.findIndex((l) => l !== '0')
  if (firstReal >= 0) halfStarts.add(firstReal)
  const tr = props.demoTickRate || 64
  for (const i of halfStarts) {
    const r = props.rounds[i]
    if (!r) continue
    const hi = r.startTick + 20 * tr // only the opening of the round
    let pistolOnly = true
    for (const f of r.frames) {
      if (f.tick < r.startTick || f.tick > hi) continue
      if (f.players.some((p) => !PISTOL_LOADOUT.has(p.weapon))) {
        pistolOnly = false
        break
      }
    }
    if (pistolOnly) out.add(i)
  }
  return out
})

// The timeline works in fraction [0,1]; we convert to the nearest frame.
function onSeek(fraction: number) {
  emit('seek', Math.round(fraction * Math.max(0, props.frameCount - 1)))
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Time readout: shows elapsed round time by default; click to toggle to a
// countdown (time left until the round ends).
const showRemaining = ref(false)
const timeLabel = computed(() =>
  showRemaining.value ? `-${fmt(Math.max(0, totalT.value - props.currentT))}` : fmt(props.currentT),
)

// Round button colors: background in the winner color (solid when active).
function roundStyle(r: Round, active: boolean): Record<string, string> | undefined {
  if (!r.winner) return undefined
  const c = SIDE_COLOR[r.winner]
  return active ? { backgroundColor: c, color: '#fff' } : { backgroundColor: c + '2e', color: c }
}

// Single-line round strip: keeps the current round always centered.
const track = ref<HTMLElement | null>(null)
const roundEls = ref<HTMLElement[]>([])

function setRoundEl(el: Element | null, i: number) {
  if (el) roundEls.value[i] = el as HTMLElement
}

function centerCurrent(behavior: ScrollBehavior) {
  const el = roundEls.value[props.roundIndex]
  const box = track.value
  if (!el || !box) return
  const elRect = el.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  const delta = elRect.left + elRect.width / 2 - (boxRect.left + boxRect.width / 2)
  box.scrollTo({ left: box.scrollLeft + delta, behavior })
}

watch(
  () => props.roundIndex,
  () => centerCurrent('smooth'),
  { flush: 'post' },
)

// Wheel scroll (vertical) scrolls the round strip horizontally. Only intercepts
// when there is overflow and the gesture is mostly vertical (lets native
// horizontal trackpad scrolling pass through).
function onRoundsWheel(e: WheelEvent) {
  const box = track.value
  if (!box || box.scrollWidth <= box.clientWidth) return
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.preventDefault()
  box.scrollLeft += e.deltaY
}

onMounted(() => centerCurrent('auto'))
</script>

<template>
  <div class="group flex flex-col">
    <!-- Rounds: hidden by default, revealed on hover over the player -->
    <div
      class="grid grid-rows-[0fr] opacity-0 transition-all duration-200 ease-out group-hover:grid-rows-[1fr] group-hover:opacity-100"
    >
      <div class="overflow-hidden">
        <div
          ref="track"
          class="flex gap-1.5 overflow-x-auto px-0.5 pb-3 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          @wheel="onRoundsWheel"
        >
          <template v-for="(r, i) in rounds" :key="r.number">
            <!-- Side-swap marker (halftime / overtime): drawn before the round
                 where the teams flipped CT<->T. -->
            <div
              v-if="sideSwaps.has(i)"
              v-tooltip="t('viewer.sideSwap')"
              class="flex shrink-0 items-center self-stretch px-0.5 text-ink-500"
            >
              <UiIcon name="swap" class="h-3.5 w-3.5" />
            </div>
            <button
              :ref="(el) => setRoundEl(el as Element | null, i)"
              v-tooltip="
                roundLabels[i] === '0'
                  ? t('viewer.knife')
                  : `${t('viewer.round')} ${roundLabels[i]}${pistolRounds.has(i) ? ` · ${t('viewer.pistol')}` : ''}${r.winner ? ` · ${r.winner}` : ''}`
              "
              class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[0.65rem] font-mono transition-all duration-150"
              :class="[
                i === roundIndex
                  ? 'scale-110 font-semibold shadow-lg shadow-black/40'
                  : 'opacity-70 hover:scale-105 hover:opacity-100',
                !r.winner &&
                  (i === roundIndex ? 'bg-ink-500 text-white' : 'bg-ink-700 text-ink-300'),
              ]"
              :style="roundStyle(r, i === roundIndex)"
              @click="emit('selectRound', i)"
            >
              <!-- Knife / pistol rounds: show the weapon icon instead of the label. -->
              <img
                v-if="roundLabels[i] === '0'"
                src="/weapons/knife.svg"
                :alt="t('viewer.knife')"
                class="w-5 object-contain"
              />
              <img
                v-else-if="pistolRounds.has(i)"
                src="/weapons/p250.svg"
                :alt="t('viewer.pistol')"
                class="w-4 object-contain"
              />
              <template v-else>{{ roundLabels[i] }}</template>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Transport -->
    <div class="flex items-center gap-3">
      <div class="flex shrink-0 items-center gap-1">
        <button
          v-tooltip="`${t('viewer.back5')} (←)`"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white"
          @click="emit('skip', -5)"
        >
          <UiIcon name="rotate-ccw" class="h-4 w-4" />
        </button>

        <button
          v-tooltip="`${playing ? t('viewer.pause') : t('viewer.play')} (${t('viewer.space')})`"
          class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-50 transition-colors duration-150 hover:bg-white/10"
          @click="emit('toggle')"
        >
          <UiIcon :name="playing ? 'pause' : 'play'" class="h-5 w-5" />
        </button>

        <button
          v-tooltip="`${t('viewer.fwd5')} (→)`"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white"
          @click="emit('skip', 5)"
        >
          <UiIcon name="rotate-cw" class="h-4 w-4" />
        </button>
      </div>

      <button
        v-tooltip="showRemaining ? t('viewer.showElapsed') : t('viewer.showRemaining')"
        class="shrink-0 cursor-pointer font-mono text-xs text-ink-300 tabular-nums transition-colors hover:text-white"
        @click="showRemaining = !showRemaining"
      >
        {{ timeLabel }}
      </button>

      <ViewerTimeline
        :current-t="currentT"
        :duration="totalT"
        :markers="markers"
        :waveform="waveform"
        :live-start-t="liveStartT"
        :post-start-t="postStartT"
        :freeze-label="`${t('viewer.freeze')} · ${Math.round(freezeSeconds)}s`"
        :round-end-label="t('viewer.roundEnd')"
        @seek="onSeek"
      />

      <!-- Speed: dropdown that shows only the selected one -->
      <div ref="speedMenu" class="relative shrink-0">
        <button
          type="button"
          v-tooltip="t('viewer.speed')"
          class="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-white/5 px-2.5 font-mono text-xs text-ink-100 transition-colors duration-150 hover:bg-white/10"
          @click="speedOpen = !speedOpen"
        >
          {{ speed }}x
          <UiIcon name="chevron-down" class="h-3 w-3 text-ink-400" />
        </button>
        <div
          v-if="speedOpen"
          class="absolute bottom-full right-0 mb-1.5 flex flex-col gap-0.5 rounded-lg border border-ink-700 bg-ink-900/95 p-1 backdrop-blur"
        >
          <button
            v-for="s in SPEEDS"
            :key="s"
            type="button"
            class="cursor-pointer rounded-md px-3 py-1 text-right font-mono text-xs transition-colors duration-150"
            :class="
              s === speed
                ? 'bg-white/15 text-white'
                : 'text-ink-300 hover:bg-white/10 hover:text-white'
            "
            @click="pickSpeed(s)"
          >
            {{ s }}x
          </button>
        </div>
      </div>

      <!-- Comms: mute all (hover opens master volume) and balance between teams -->
      <div v-if="showVoice" class="flex shrink-0 items-center gap-2">
        <div
          class="relative"
          @mouseenter="volHover = true"
          @mouseleave="volHover = false"
        >
          <button
            v-tooltip="muted ? t('viewer.enableComms') : t('viewer.muteComms')"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/10"
            :class="muted ? 'text-ink-500 hover:text-white' : 'text-ink-200 hover:text-white'"
            @click="emit('toggleMute')"
          >
            <UiIcon :name="muted ? 'volume-x' : 'volume-2'" class="h-4 w-4" />
          </button>

          <!-- Master volume: vertical slider (the outer area bridges the hover) -->
          <div
            v-show="volHover"
            class="absolute bottom-full left-1/2 -translate-x-1/2 pb-2"
          >
            <div
              class="flex flex-col items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/95 px-2 py-2.5 backdrop-blur"
            >
              <span class="font-mono text-[10px] tabular-nums text-ink-400">
                {{ Math.round((masterVolume ?? 1) * 100) }}
              </span>
              <div class="flex h-24 w-5 items-center justify-center">
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="Math.round((masterVolume ?? 1) * 100)"
                  class="h-1 w-24 -rotate-90 cursor-pointer appearance-none rounded-full bg-white/15"
                  :style="{ accentColor: 'var(--color-surge-500)' }"
                  :aria-label="t('viewer.volumeAria')"
                  @input="emit('setMasterVolume', Number(($event.target as HTMLInputElement).value) / 100)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Balance: center = both 100%, ends = only one team. Disabled (not
             hidden) while muted; the whole block only shows when the demo has
             comms (see v-if="showVoice" above). -->
        <div class="flex items-center gap-1.5" :class="{ 'opacity-40': muted }">
          <span class="font-mono text-[10px] leading-none" :style="{ color: SIDE_COLOR.CT }">CT</span>
          <input
            v-tooltip="t('viewer.balance')"
            type="range"
            min="-100"
            max="100"
            :value="Math.round((balance ?? 0) * 100)"
            :disabled="muted"
            class="balance-slider h-1.5 w-20 appearance-none rounded-full"
            :class="muted ? 'cursor-not-allowed' : 'cursor-pointer'"
            :style="{ background: `linear-gradient(to right, ${SIDE_COLOR.CT}, ${SIDE_COLOR.T})` }"
            :aria-label="t('viewer.balanceAria')"
            @input="emit('setBalance', Number(($event.target as HTMLInputElement).value) / 100)"
          />
          <span class="font-mono text-[10px] leading-none" :style="{ color: SIDE_COLOR.T }">T</span>
        </div>
      </div>

      <!-- Advanced: menu of viewer behavior toggles -->
      <div v-if="advancedOptions?.length" ref="advancedMenu" class="relative shrink-0">
        <button
          type="button"
          v-tooltip="t('viewer.advanced')"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/10"
          :class="advancedActive ? 'text-surge-300' : 'text-ink-200 hover:text-white'"
          @click="advancedOpen = !advancedOpen"
        >
          <UiIcon name="settings" class="h-4 w-4" />
        </button>
        <div
          v-if="advancedOpen"
          class="absolute bottom-full right-0 mb-1.5 w-64 rounded-lg border border-ink-700 bg-ink-900/95 p-1.5 backdrop-blur"
        >
          <p class="px-2 py-1 text-[11px] font-semibold text-ink-500">{{ t('viewer.advanced') }}</p>
          <button
            v-for="o in advancedOptions"
            :key="o.key"
            type="button"
            class="flex w-full cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5"
            @click="emit('toggleAdvanced', o.key)"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-ink-100">{{ o.label }}</span>
              <span v-if="o.description" class="mt-0.5 block text-xs text-ink-500">
                {{ o.description }}
              </span>
            </span>
            <UiSwitch :model-value="o.enabled" class="pointer-events-none mt-0.5 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* White thumb for the balance fader (the track already has the CT->T gradient). */
.balance-slider::-webkit-slider-thumb {
  appearance: none;
  height: 12px;
  width: 12px;
  border-radius: 9999px;
  background: #fff;
  border: 2px solid var(--color-ink-900);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}
.balance-slider::-moz-range-thumb {
  height: 12px;
  width: 12px;
  border: 2px solid var(--color-ink-900);
  border-radius: 9999px;
  background: #fff;
}
</style>
