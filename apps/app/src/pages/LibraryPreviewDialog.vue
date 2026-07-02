<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
import UiIcon from '@/ui/UiIcon.vue'
import ViewerMap from '@/viewer/player/ViewerMap.vue'
import { useReplay } from '@/viewer/player/useReplay'
import { useRecentDemos, type RecentDemo } from '@/viewer/ingest/useRecentDemos'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { mapImage, prettyMap } from '@/viewer/domain/demoMeta'
import { useI18n } from '@/app/i18n'
import type { Side } from '@/viewer/domain/schema'

/**
 * Preview a saved demo without entering the player: a frozen, non-playable
 * snapshot of round 3 (or the nearest round with frames) at the midpoint between
 * the round going live and its first kill, with a player sidebar and a button to
 * actually watch the replay. Driven by a private `useReplay` instance that we
 * only ever seek, never play.
 */
const props = defineProps<{ demo: RecentDemo | null }>()
const emit = defineEmits<{ close: []; watch: [demo: RecentDemo] }>()

const { t } = useI18n()
const recent = useRecentDemos()
const r = useReplay()

const ready = ref(false)
const failed = ref(false)

const calibration = computed(() => {
  const map = r.replay.value?.map
  return (map && MAP_CALIBRATION[map]) || MAP_CALIBRATION.de_dust2
})
const mapName = computed(() => (r.replay.value ? prettyMap(r.replay.value.map) : ''))
const thumb = computed(() => (r.replay.value ? mapImage(r.replay.value.map) : null))
const roundNumber = computed(() => r.round.value?.number ?? null)

/** Player rows for a side at the snapshot moment, with their display names. */
function team(side: Side) {
  return r.players.value
    .filter((p) => p.side === side)
    .map((p) => ({ ...p, name: r.playersById.value.get(p.steamId)?.name ?? '—' }))
}
const teams = computed(() => {
  const round = r.round.value
  return [
    { side: 'CT' as Side, color: 'text-pulse-300', name: round?.ctName ?? '', rows: team('CT') },
    { side: 'T' as Side, color: 'text-warn', name: round?.tName ?? '', rows: team('T') },
  ]
})

// Editable replay title (shown over the map). Falls back to the file name when
// the user has not set one. Renaming flows through the recents store, just like
// the library cards.
const displayTitle = computed(() => props.demo?.title?.trim() || props.demo?.fileName || '')
const editing = ref(false)
const draft = ref('')
const titleInput = ref<HTMLInputElement | null>(null)

async function startEdit() {
  if (!props.demo) return
  draft.value = displayTitle.value
  editing.value = true
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}
function commitEdit() {
  if (!editing.value || !props.demo) return
  recent.rename(props.demo.id, draft.value)
  editing.value = false
}
function cancelEdit() {
  editing.value = false
}

async function setup(demo: RecentDemo) {
  ready.value = false
  failed.value = false
  const payload = await recent.load(demo.id)
  // Bail if it vanished or the user already opened a different demo.
  if (!payload || props.demo?.id !== demo.id) {
    if (!payload) failed.value = true
    return
  }
  r.setReplay(payload.replay)

  // Round 3 by array index, but fall back to the first round that has frames
  // (some demos lead with a frameless knife "result" round).
  const rounds = payload.replay.rounds
  let idx = Math.min(2, rounds.length - 1)
  if (!rounds[idx]?.frames.length) idx = rounds.findIndex((rd) => rd.frames.length > 0)
  if (idx < 0) {
    failed.value = true
    return
  }
  r.selectRound(idx)

  // Freeze at the midpoint between the round going live and the first kill
  // (or the round's midpoint when it has no kills).
  const round = r.round.value
  if (round) {
    const { liveStart, roundEnd } = r.timeline.value
    const firstKill = round.events.find((e) => e.type === 'kill')
    const end = firstKill ? firstKill.t : roundEnd
    r.seekBySeconds((liveStart + end) / 2 - r.currentT.value)
  }
  ready.value = true
}

watch(
  () => props.demo,
  (demo) => {
    editing.value = false
    if (demo) setup(demo)
  },
  { immediate: true },
)

function onOpenChange(open: boolean) {
  if (!open) emit('close')
}
function watchNow() {
  if (props.demo) emit('watch', props.demo)
}
</script>

<template>
  <DialogRoot :open="demo !== null" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      <DialogContent
        class="pointer-events-auto fixed left-1/2 top-1/2 z-50 flex h-[80vh] max-h-[680px] w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/60 focus:outline-none"
      >
        <DialogTitle class="sr-only">{{ mapName }} {{ t('library.preview.round', { n: roundNumber }) }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('library.preview.desc') }}</DialogDescription>

        <!-- Frozen, non-interactive map snapshot -->
        <div class="relative min-w-0 flex-1 bg-ink-950">
          <div v-if="ready" class="pointer-events-none absolute inset-0">
            <ViewerMap
              :players="r.players.value"
              :current-t="r.currentT.value"
              :round="r.round.value"
              :calibration="calibration"
              :players-by-id="r.playersById.value"
              :bomb-blink="false"
              :auto-zoom="true"
              :controls="false"
            />
          </div>
          <!-- Editable replay title -->
          <div v-if="ready" class="absolute left-3 top-3 z-10 max-w-[70%]">
            <input
              v-if="editing"
              ref="titleInput"
              v-model="draft"
              type="text"
              class="w-full rounded-md border border-surge-500/60 bg-ink-950/90 px-2 py-1 text-lg font-semibold text-ink-50 outline-none backdrop-blur focus:border-surge-400"
              @keydown.enter.prevent="commitEdit"
              @keydown.esc.prevent="cancelEdit"
              @blur="commitEdit"
            />
            <button
              v-else
              type="button"
              :title="displayTitle"
              :aria-label="t('analyzer.menu.rename')"
              class="group flex max-w-full cursor-pointer items-center gap-1.5 rounded-md bg-ink-950/70 px-2 py-1 text-left backdrop-blur transition hover:bg-ink-950/90"
              @click="startEdit"
            >
              <span class="truncate text-lg font-semibold text-ink-50">{{ displayTitle }}</span>
              <UiIcon
                name="pencil"
                class="h-3.5 w-3.5 shrink-0 text-ink-400 opacity-0 transition group-hover:opacity-100"
              />
            </button>
          </div>
        </div>

        <!-- Sidebar: map header, watch button, player roster -->
        <aside class="flex w-64 shrink-0 flex-col sm:w-72">
          <div class="relative h-40 shrink-0 overflow-hidden bg-ink-800">
            <img
              v-if="thumb"
              :src="thumb"
              :alt="mapName"
              class="absolute inset-0 h-full w-full object-cover opacity-90"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
            <div class="absolute inset-x-0 bottom-0 p-3">
              <p class="text-sm font-semibold text-white drop-shadow">{{ mapName }}</p>
              <p class="font-mono text-xs">
                <span class="text-pulse-300">{{ demo?.scoreCt }}</span>
                <span class="text-white/50"> : </span>
                <span class="text-warn">{{ demo?.scoreT }}</span>
              </p>
            </div>
          </div>

          <div class="p-3">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-surge-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-surge-400"
              @click="watchNow"
            >
              <UiIcon name="play" class="h-4 w-4" />
              {{ t('library.preview.watch') }}
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <section v-for="grp in teams" :key="grp.side" class="mt-3 first:mt-0">
              <h3 class="mb-1 flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                <span :class="grp.color">{{ grp.side }}</span>
                <span v-if="grp.name" class="truncate normal-case text-ink-400" :title="grp.name">
                  {{ grp.name }}
                </span>
              </h3>
              <ul class="space-y-0.5">
                <li
                  v-for="p in grp.rows"
                  :key="p.steamId"
                  class="flex items-center gap-2 rounded px-1.5 py-1 text-sm"
                  :class="p.alive ? 'text-ink-100' : 'text-ink-600'"
                >
                  <span class="truncate" :title="p.name">{{ p.name }}</span>
                </li>
              </ul>
            </section>
          </div>
        </aside>

        <!-- Loading veil: covers stale content while a (new) demo loads, so
             switching demos never flashes the previous one's roster/map. -->
        <Transition
          enter-active-class="transition-opacity duration-150"
          leave-active-class="transition-opacity duration-150"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div v-if="!ready" class="absolute inset-0 z-20 grid place-items-center bg-ink-900">
            <UiIcon
              :name="failed ? 'alert-triangle' : 'loader'"
              :class="['h-7 w-7 text-ink-600', { 'animate-spin': !failed }]"
            />
          </div>
        </Transition>

        <DialogClose
          :aria-label="t('extension.close')"
          class="absolute right-3 top-3 z-30 grid h-7 w-7 cursor-pointer place-items-center rounded-md bg-ink-950/70 text-ink-300 backdrop-blur transition hover:bg-ink-800 hover:text-ink-100"
        >
          <UiIcon name="x" class="h-4 w-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
