<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronDown, Loader2, Play } from 'lucide-vue-next'
import { initLocale, t } from './i18n'
import {
  demoUrlFromPayload,
  enqueueJob,
  extractMeta,
  fetchPayload,
  getState,
  matchIdFromUrl,
  openViewer,
  roomUrlFromLocation,
  signDemoUrl,
} from '@/utils/faceitDownload'
import type { ActiveJob, MatchMeta, StateReply } from '@/utils/protocol'

// In-page button injected above Faceit's "Watch demo", mounted by index.ts via
// createShadowRootUi (Tailwind isolated in the shadow root, same as the overlay).
// Shares the download logic and the background queue with the overlay, so the
// progress shown here matches it.
const AUTO_OPEN_KEY = 'autoOpenOnDone'

const state = ref<StateReply>({ active: [], stored: [], totalBytes: 0 })
const matchId = ref<string | null>(matchIdFromUrl())
const meta = ref<MatchMeta>({})
const demoUrl = ref<string | null>(null)
const resolving = ref(false)
const autoOpen = ref(false)
const menuOpen = ref(false)
const rootEl = ref<HTMLElement | null>(null)
// The signed URL captured by the MAIN-world interceptor (skips a sign call).
let capturedUrl: string | null = null
// Matches started here, so auto-open only fires for downloads the user began
// from this button (not pre-existing library entries).
const startedHere = new Set<string>()
const autoOpened = new Set<string>()

const currentJob = computed<ActiveJob | null>(
  () => state.value.active.find((a) => a.matchId === matchId.value) ?? null,
)
const currentStored = computed(
  () => state.value.stored.find((s) => s.matchId === matchId.value) ?? null,
)
const busy = computed(() => !!currentJob.value && !currentJob.value.error)

const pct = computed(() => {
  const j = currentJob.value
  if (!j || j.error) return 0
  return j.phase === 'downloading' ? (j.total ? Math.round((j.loaded / j.total) * 100) : 0) : 100
})

function fmtMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}

// Main button caption: job status while running, otherwise watch/download.
const caption = computed(() => {
  const j = currentJob.value
  if (j) {
    if (j.error) return t('hero.error')
    if (j.phase === 'downloading') {
      return j.total ? `${t('status.downloading')} ${pct.value}%` : `${t('status.downloading')} ${fmtMB(j.loaded)}`
    }
    return t(`status.${j.phase}`)
  }
  // Always "Watch": clicking downloads first (progress shows in the footer bar),
  // then plays. Once stored, it just plays.
  return t('room.watch')
})

async function loadMeta(id: string | null) {
  meta.value = {}
  demoUrl.value = null
  capturedUrl = null
  if (!id) return
  try {
    const p = await fetchPayload(id)
    if (matchId.value !== id) return // left the room before the reply
    meta.value = extractMeta(p)
    demoUrl.value = demoUrlFromPayload(p)
  } catch {
    /* preview is best-effort; the captured URL still lets the click work */
  }
}
watch(matchId, (id) => void loadMeta(id))

function matchLabel(): string {
  const title = document.title.replace(/\s*\|\s*FACEIT.*$/i, '').trim()
  return title || matchId.value || 'match'
}

async function onMain() {
  const id = matchId.value
  if (!id) return
  if (currentStored.value && !currentJob.value) {
    void openViewer(id)
    return
  }
  if (currentJob.value || resolving.value) return
  resolving.value = true
  try {
    let signed = capturedUrl
    if (!signed && demoUrl.value) signed = await signDemoUrl(demoUrl.value)
    if (!signed) throw new Error('no demo URL')
    const m = { ...meta.value, roomUrl: roomUrlFromLocation(), source: 'faceit' }
    startedHere.add(id)
    await enqueueJob({ matchId: id, url: signed, label: m.teamA ? `${m.teamA} vs ${m.teamB}` : matchLabel(), meta: m })
    await refresh()
  } catch {
    /* the overlay surfaces errors in detail; keep the button quiet */
  } finally {
    resolving.value = false
  }
}

function toggleAuto() {
  autoOpen.value = !autoOpen.value
  void chrome.storage.local.set({ [AUTO_OPEN_KEY]: autoOpen.value })
}

async function refresh() {
  try {
    state.value = await getState()
  } catch {
    /* background asleep between sends; next tick retries */
  }
  matchId.value = matchIdFromUrl()
  const id = matchId.value
  if (id && autoOpen.value && currentStored.value && !currentJob.value && startedHere.has(id) && !autoOpened.has(id)) {
    autoOpened.add(id)
    void openViewer(id)
  }
}

const onCapture = (e: MessageEvent) => {
  if (e.source !== window) return
  const d = e.data
  if (d?.source === 'cs2dv-extension' && d?.kind === 'capturedDemoUrl' && d?.url) capturedUrl = d.url
}
const onDocClick = (e: MouseEvent) => {
  if (menuOpen.value && rootEl.value && !rootEl.value.contains(e.target as Node)) menuOpen.value = false
}

let timer: number | undefined
onMounted(async () => {
  await initLocale()
  try {
    autoOpen.value = !!(await chrome.storage.local.get(AUTO_OPEN_KEY))[AUTO_OPEN_KEY]
  } catch {
    /* storage unavailable: default off */
  }
  window.addEventListener('message', onCapture)
  document.addEventListener('click', onDocClick)
  await loadMeta(matchId.value)
  await refresh()
  timer = window.setInterval(refresh, 1000)
})
onUnmounted(() => {
  window.removeEventListener('message', onCapture)
  document.removeEventListener('click', onDocClick)
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div ref="rootEl" class="mb-2 w-full" style="font-family: 'Play', sans-serif">
    <div class="flex gap-px">
      <button
        type="button"
        class="relative flex h-10 flex-1 items-center justify-center gap-2 overflow-hidden rounded-l border-0 px-3 text-sm font-bold uppercase leading-none transition-colors"
        :class="[
          currentJob?.error
            ? 'bg-destructive text-white'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
          busy || resolving ? 'cursor-default' : 'cursor-pointer',
        ]"
        :disabled="busy || resolving"
        @click="onMain"
      >
        <Loader2 v-if="busy || resolving" class="size-4 shrink-0 animate-spin" />
        <Play v-else class="size-4 shrink-0" />
        <span class="truncate">{{ caption }}</span>
        <div v-if="busy" class="absolute inset-x-0 bottom-0 h-[3px] bg-black/20">
          <div class="h-full bg-primary-foreground/70 transition-[width] duration-200" :style="{ width: pct + '%' }" />
        </div>
      </button>
      <button
        type="button"
        class="flex h-10 w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-r border-0 bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        :aria-label="t('room.autoOpen')"
        @click.stop="menuOpen = !menuOpen"
      >
        <ChevronDown class="size-3.5" />
      </button>
    </div>

    <div v-if="menuOpen" class="mt-1.5 rounded border border-border bg-background p-2 text-foreground">
      <label class="flex cursor-pointer items-center gap-2 text-xs font-medium leading-snug">
        <input
          type="checkbox"
          :checked="autoOpen"
          class="size-3.5 cursor-pointer accent-primary"
          @change="toggleAuto"
        />
        <span>{{ t('room.autoOpen') }}</span>
      </label>
    </div>
  </div>
</template>
