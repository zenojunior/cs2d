<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import type { Round } from '@/viewer/schema'
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
  /** Comms audio enabled. */
  enabled?: boolean
  /** Master comms volume (0 to 1). */
  masterVolume?: number
  /** CT<->T balance (-1 = CT only, 0 = both, +1 = T only). */
  balance?: number
  /** Per-team voice amplitude envelope (timeline waveform). */
  waveform?: { ct: number[]; t: number[] } | null
  /** "Advanced" menu options (viewer behavior toggles). */
  advancedOptions?: { key: string; label: string; description?: string; enabled: boolean }[]
}>()

const emit = defineEmits<{
  toggle: []
  seek: [index: number]
  skip: [seconds: number]
  selectRound: [index: number]
  setSpeed: [speed: number]
  toggleEnabled: []
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

const markers = computed(() => buildTimelineMarkers(props.round))

// The timeline works in fraction [0,1]; we convert to the nearest frame.
function onSeek(fraction: number) {
  emit('seek', Math.round(fraction * Math.max(0, props.frameCount - 1)))
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

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
          <button
            v-for="(r, i) in rounds"
            :key="r.number"
            :ref="(el) => setRoundEl(el as Element | null, i)"
            v-tooltip="`${t('viewer.round')} ${roundLabels[i]}${r.winner ? ` · ${r.winner}` : ''}`"
            class="h-7 w-7 shrink-0 cursor-pointer rounded-lg text-[0.65rem] font-mono transition-all duration-150"
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
            {{ roundLabels[i] }}
          </button>
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

      <span class="shrink-0 font-mono text-xs text-ink-300 tabular-nums">
        {{ fmt(currentT) }} / {{ fmt(totalT) }}
      </span>

      <ViewerTimeline
        :current-t="currentT"
        :duration="totalT"
        :markers="markers"
        :waveform="waveform"
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
            v-tooltip="enabled ? t('viewer.muteComms') : t('viewer.enableComms')"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/10"
            :class="enabled ? 'text-surge-300' : 'text-ink-300 hover:text-white'"
            @click="emit('toggleEnabled')"
          >
            <UiIcon :name="enabled ? 'volume-2' : 'volume-x'" class="h-4 w-4" />
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

        <!-- Balance: center = both 100%, ends = only one team -->
        <div v-if="enabled" class="flex items-center gap-1.5">
          <span class="font-mono text-[10px] leading-none" :style="{ color: SIDE_COLOR.CT }">CT</span>
          <input
            v-tooltip="t('viewer.balance')"
            type="range"
            min="-100"
            max="100"
            :value="Math.round((balance ?? 0) * 100)"
            class="balance-slider h-1.5 w-20 cursor-pointer appearance-none rounded-full"
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
