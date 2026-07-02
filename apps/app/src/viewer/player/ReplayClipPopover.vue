<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useFloating, offset, flip, shift, autoUpdate, type ReferenceElement, type Placement } from '@floating-ui/vue'
import { onClickOutside } from '@vueuse/core'
import type { Replay } from '@/viewer/domain/schema'
import ReplayClip from '@/viewer/player/ReplayClip.vue'
import { canCopyImage, copyCanvasToClipboard } from '@/viewer/player/useClipRecorder'
import UiIcon from '@/ui/UiIcon.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * Floating card that plays a looping mini-clip of a moment (a kill, a grenade
 * throw, a flash) and offers a "watch in match" jump. Map-agnostic and reusable:
 * pin it to any anchor (a canvas marker via a virtual element, or a clicked list
 * row / cell via its DOM node) and pass the clip window. The header (who/what)
 * is a slot, so each context renders its own line. Positioned with floating-ui
 * (flips / shifts to stay on screen) and teleported to the body so no ancestor's
 * overflow clips it.
 */
const props = withDefaults(
  defineProps<{
    /** Anchor: a DOM element or a virtual element (viewport-coord rect). */
    reference: ReferenceElement | null
    replay: Replay
    /** Round (array index) the moment belongs to. */
    round: number
    /** Instant to seek to in the full replay (the "watch in match" target, s). */
    jumpT: number
    /** Clip window within the round, in seconds since freeze. */
    from: number
    to: number
    /** Players to frame in the clip (e.g. the two in a kill, or the thrower). */
    focusSteamIds?: string[] | null
    /** Track a moving point along this timed polyline (e.g. a grenade's arc). */
    followPath?: { t: number; x: number; y: number }[] | null
    /** Player the clip is about: a red eye is drawn before their name on the map. */
    observedSteamId?: string | null
    /** Floor radar + Z range for multi-level maps (Nuke), passed to the clip. */
    radarSrc?: string
    levelRange?: { minZ: number; maxZ: number } | null
    placement?: Placement
    /** Close when the user clicks/taps outside the card (default true). Turn off
     *  where the host drives dismissal itself (e.g. the heatmap canvas, whose pan
     *  drag must not close the card). */
    dismissOnOutside?: boolean
    /** Re-measure the anchor every frame, so the card tracks a reference that
     *  moves without firing scroll/resize (e.g. a spot on a pannable map). */
    trackAnchor?: boolean
  }>(),
  {
    focusSteamIds: null,
    placement: 'top',
    dismissOnOutside: true,
    trackAnchor: false,
  },
)

const emit = defineEmits<{
  jump: [{ roundIndex: number; t: number }]
  close: []
}>()

const card = ref<HTMLElement | null>(null)
const anchor = computed(() => props.reference)

const { floatingStyles, isPositioned } = useFloating(anchor, card, {
  placement: props.placement,
  // Fixed against the viewport so the teleported card isn't offset by the body,
  // and bounded to the screen (flip/shift) rather than to any host container.
  strategy: 'fixed',
  whileElementsMounted: props.trackAnchor
    ? (r, f, update) => autoUpdate(r, f, update, { animationFrame: true })
    : autoUpdate,
  middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
})

// Drives the embedded clip's WebM export (real-time canvas capture).
const clip = ref<InstanceType<typeof ReplayClip> | null>(null)
const canExport = computed(() => clip.value?.canExport ?? false)
const canCopy = canCopyImage
const exporting = computed(() => clip.value?.exporting ?? false)

const fileName = computed(() => `${props.replay.map}-round-${props.round + 1}.webm`)

// The recorded clip, shown back in a native <video> the user can play / open in
// a tab / save / copy a frame from. Recording must run with the tab focused, so
// every share action here is a direct user click on the result (a new tab opened
// up front would hide this tab and freeze the capture).
const previewUrl = ref<string | null>(null)
const previewVideo = ref<HTMLVideoElement | null>(null)

async function createClip() {
  const blob = await clip.value?.recordClip()
  if (!blob) return
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(blob)
}

function discardPreview() {
  // Keep the URL alive: if the user opened it in a new tab, revoking would break
  // that tab. The single outstanding blob leaks until the app navigates away.
  previewUrl.value = null
}

/** Copies the frame currently shown in the preview player as a still PNG. */
async function copyPreviewFrame() {
  const v = previewVideo.value
  if (!v || !v.videoWidth) return
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  c.getContext('2d')?.drawImage(v, 0, 0)
  await copyCanvasToClipboard(c)
}

onBeforeUnmount(discardPreview)

// Don't dismiss mid-export: unmounting the clip would kill the recording.
if (props.dismissOnOutside) onClickOutside(card, () => !exporting.value && emit('close'))
</script>

<template>
  <Teleport to="body">
    <!-- While recording, a full-screen shield (below the card, above everything
         else) swallows clicks/drags so they can't reach a host canvas and
         dismiss or pan under the live capture. Covers every host at once,
         including the ones that drive their own dismissal. -->
    <div v-if="exporting" class="fixed inset-0 z-40 cursor-progress bg-ink-950/20" />
    <TooltipProvider>
      <div
        ref="card"
        class="z-50 flex w-72 flex-col gap-1.5 rounded-lg border border-ink-700 bg-ink-900/95 p-2 text-xs shadow-lg backdrop-blur"
        :style="[floatingStyles, { opacity: isPositioned ? '1' : '0' }]"
      >
        <!-- Header (who/what) + close. -->
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <slot name="header" />
          </div>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                :aria-label="t('heatmap.close')"
                :disabled="exporting"
                class="-mr-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100 disabled:cursor-default disabled:opacity-40"
                @click="emit('close')"
              >
                <UiIcon name="x" class="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{{ t('heatmap.close') }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Looping mini-clip of the moment, with the recorded-clip preview on top
             once a clip is made. -->
        <div class="relative aspect-square w-full overflow-hidden rounded-md border border-ink-800 bg-ink-950">
          <ReplayClip
            ref="clip"
            :replay="replay"
            :round="round"
            :from="from"
            :to="to"
            :focus-steam-ids="focusSteamIds"
            :follow-path="followPath"
            :observed-steam-id="observedSteamId"
            :auto-zoom="!(focusSteamIds?.length || followPath?.length)"
            :radar-src="radarSrc"
            :level-range="levelRange"
          />
          <!-- Recorded clip: a native player the user plays / opens / saves / copies
               from via direct clicks (no popup blocker, no focus loss mid-capture). -->
          <video
            v-if="previewUrl"
            ref="previewVideo"
            :src="previewUrl"
            class="absolute inset-0 h-full w-full bg-ink-950"
            controls
            autoplay
            loop
            muted
            playsinline
          />
        </div>

        <!-- Default actions: jump to the moment, or record a shareable clip. -->
        <div v-if="!previewUrl" class="flex items-center gap-1.5">
          <button
            type="button"
            class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1.5 font-medium text-ink-100 transition-colors hover:border-surge-500/60 hover:bg-ink-800"
            @click="emit('jump', { roundIndex: round, t: jumpT })"
          >
            <UiIcon name="play" class="h-3.5 w-3.5" />
            {{ t('heatmap.watchInMatch') }}
          </button>

          <!-- Records one real-time pass off the map canvas (so the button shows a
               spinner meanwhile), then reveals the preview above. -->
          <Tooltip v-if="canExport">
            <TooltipTrigger as-child>
              <button
                type="button"
                :disabled="exporting"
                :aria-label="t('heatmap.exportClip')"
                class="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-800/60 text-ink-100 transition-colors hover:border-surge-500/60 hover:bg-ink-800 disabled:cursor-default disabled:opacity-60"
                @click="createClip"
              >
                <UiIcon :name="exporting ? 'loader' : 'clapperboard'" class="h-3.5 w-3.5" :class="{ 'animate-spin': exporting }" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('heatmap.exportClip') }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Clip ready: share / save / copy it, or discard to record again. -->
        <div v-else class="flex items-center gap-1.5">
          <a
            :href="previewUrl"
            target="_blank"
            rel="noopener"
            class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1.5 font-medium text-ink-100 transition-colors hover:border-surge-500/60 hover:bg-ink-800"
          >
            <UiIcon name="globe" class="h-3.5 w-3.5" />
            {{ t('heatmap.openInNewTab') }}
          </a>
          <Tooltip>
            <TooltipTrigger as-child>
              <a
                :href="previewUrl"
                :download="fileName"
                :aria-label="t('heatmap.saveVideo')"
                class="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-800/60 text-ink-100 transition-colors hover:border-surge-500/60 hover:bg-ink-800"
              >
                <UiIcon name="download" class="h-3.5 w-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('heatmap.saveVideo') }}</TooltipContent>
          </Tooltip>
          <Tooltip v-if="canCopy">
            <TooltipTrigger as-child>
              <button
                type="button"
                :aria-label="t('heatmap.copyImage')"
                class="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-800/60 text-ink-100 transition-colors hover:border-surge-500/60 hover:bg-ink-800"
                @click="copyPreviewFrame"
              >
                <UiIcon name="image" class="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('heatmap.copyImage') }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                :aria-label="t('heatmap.discardClip')"
                class="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-ink-700 bg-ink-800/60 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
                @click="discardPreview"
              >
                <UiIcon name="x" class="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('heatmap.discardClip') }}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  </Teleport>
</template>
