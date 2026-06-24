<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '@/ui/UiIcon.vue'
import ViewerStage from '@/viewer/player/ViewerStage.vue'
import HeatmapView from '@/viewer/analysis/HeatmapView.vue'
import UtilitiesView from '@/viewer/analysis/UtilitiesView.vue'
import EconomyView from '@/viewer/analysis/EconomyView.vue'
import DuelsView from '@/viewer/analysis/DuelsView.vue'
import DemoPreviewLoop from '@/viewer/player/DemoPreviewLoop.vue'
import { useDemoParser } from '@/viewer/ingest/useDemoParser'
import { useRecentDemos } from '@/viewer/ingest/useRecentDemos'
import { importArchive } from '@/viewer/ingest/demoArchive'
import { fetchReplay } from '@/viewer/ingest/replaySource'
import { listenForExtensionDemo } from '@/viewer/ingest/extensionBridge'
import { fmtSize } from '@/viewer/domain/demoMeta'
import { useI18n } from '@/i18n'

const { t } = useI18n()

// Analysis screen: the user uploads a .dem and the parser (WebAssembly, in a Web
// Worker) builds the replay right here, without uploading anything to any server.
// The 2D stage is the same ViewerStage used in the sample demo viewer. Recent
// history is kept in the browser only, via useRecentDemos.
const route = useRoute()
const router = useRouter()
const parser = useDemoParser()

// Phase → i18n key for the loading label (the `reading` phase uses `readingFile`).
const PHASE_LABEL: Record<string, string> = {
  reading: 'analyzer.readingFile',
  decompressing: 'analyzer.decompressing',
  parsing: 'analyzer.parsing',
  building: 'analyzer.building',
  serializing: 'analyzer.serializing',
}
const phaseLabel = computed(() => t(PHASE_LABEL[parser.phase.value] ?? 'analyzer.parsing'))
// Overall percentage shown next to the bar.
const progressPct = computed(() => Math.round(parser.progress.value * 100))
// During parsing, a "X / Y ticks" detail so the user sees real movement.
const parseTickDetail = computed(() => {
  const total = parser.parseTotalTicks.value
  if (parser.phase.value !== 'parsing' || !total) return ''
  return t('analyzer.parsingTicks', {
    done: parser.parseTick.value.toLocaleString(),
    total: total.toLocaleString(),
  })
})
const recent = useRecentDemos()
const importing = ref(false)
const importError = ref<string | null>(null)
const dragging = ref(false)
const input = ref<HTMLInputElement | null>(null)
// Dedicated picker for the import button, scoped to .cs2dv so its label stays
// truthful (game demos go through the dropzone above).
const importInput = ref<HTMLInputElement | null>(null)
// Loading a demo from the URL (/:id).
const routeLoading = ref(false)
// Id of the currently open demo (avoids reloading when navigating to itself).
const currentId = ref<string | null>(null)
// URL of the currently open external replay (Major demo), if any (same purpose).
const currentSrc = ref<string | null>(null)
// `?skipFreeze=1` opens the replay past the freeze time (Major clips set it).
const skipFreeze = computed(() => route.query.skipFreeze === '1' || route.query.skipFreeze === 'true')
// `?autoplay=1` starts playback as soon as the replay loads (Major clips set it).
const autoplay = computed(() => route.query.autoplay === '1' || route.query.autoplay === 'true')
type Tab = 'viewer' | 'heatmap' | 'utilities' | 'economy' | 'duels'
// The active tab is driven by the URL: `/:id` is the 2D stage, `/:id/heatmaps`
// the heatmap, `/:id/utilities` the utilities page, `/:id/economy` the economy
// page, `/:id/duels` the duels page.
const activeTab = computed<Tab>(() => {
  // History demos carry the tab as a path segment (/:id/:tab); external replays
  // (?replay=) have no id, so the tab rides along as ?tab=.
  const raw = route.params.tab || route.query.tab
  const tab = Array.isArray(raw) ? raw[0] : raw
  if (tab === 'heatmaps') return 'heatmap'
  // `grenades` kept as a backward-compatible alias for older links.
  if (tab === 'utilities' || tab === 'grenades') return 'utilities'
  if (tab === 'economy') return 'economy'
  if (tab === 'duels') return 'duels'
  return 'viewer'
})
const TAB_SEGMENT: Record<Tab, string> = {
  viewer: '',
  heatmap: '/heatmaps',
  utilities: '/utilities',
  economy: '/economy',
  duels: '/duels',
}
// Tab name used in the ?tab= query for external replays ('viewer' = no param).
const TAB_QUERY: Record<Tab, string | undefined> = {
  viewer: undefined,
  heatmap: 'heatmaps',
  utilities: 'utilities',
  economy: 'economy',
  duels: 'duels',
}
function goTab(tab: Tab) {
  // External replay: keep ?replay=/?name= and switch the tab via ?tab=.
  if (currentSrc.value) {
    // Drop the per-tab sub-page params (?h=, ?u=, ?d=) when switching tabs.
    const { h: _h, u: _u, d: _d, ...rest } = route.query
    const query = { ...rest, tab: TAB_QUERY[tab] }
    if (!query.tab) delete query.tab
    router.push({ path: '/', query })
    return
  }
  const id = currentId.value
  if (id) router.push(`/${id}${TAB_SEGMENT[tab]}`)
}

// The heatmap's own pages (presence/kills/deaths/grenades), each a separate URL:
// history demos carry it as a path segment (/:id/heatmaps/kills), external
// replays as `?h=` (presence is the default, so it has no segment/param).
type HeatmapSource = 'presence' | 'kills' | 'deaths' | 'grenades'
const heatmapSource = computed<HeatmapSource>(() => {
  const raw = route.params.sub || route.query.h
  const s = Array.isArray(raw) ? raw[0] : raw
  return s === 'kills' || s === 'deaths' || s === 'grenades' ? s : 'presence'
})
function goHeatmapSource(src: HeatmapSource) {
  if (currentSrc.value) {
    const query = { ...route.query, tab: 'heatmaps', h: src === 'presence' ? undefined : src }
    if (!query.h) delete query.h
    router.push({ path: '/', query })
    return
  }
  const id = currentId.value
  if (id) router.push(`/${id}/heatmaps${src === 'presence' ? '' : `/${src}`}`)
}

// The utilities tab's own pages (throws/flashes/damage), each a separate URL:
// history demos carry it as a path segment (/:id/utilities/flashes), external
// replays as `?u=` (throws is the default, so it has no segment/param).
type UtilitySub = 'throws' | 'flashes' | 'damage'
const utilitySub = computed<UtilitySub>(() => {
  const raw = route.params.sub || route.query.u
  const s = Array.isArray(raw) ? raw[0] : raw
  return s === 'flashes' || s === 'damage' ? s : 'throws'
})
function goUtilitySub(sub: UtilitySub) {
  if (currentSrc.value) {
    const query = { ...route.query, tab: 'utilities', u: sub === 'throws' ? undefined : sub }
    if (!query.u) delete query.u
    router.push({ path: '/', query })
    return
  }
  const id = currentId.value
  if (id) router.push(`/${id}/utilities${sub === 'throws' ? '' : `/${sub}`}`)
}

// The duels tab's own pages (matrix/opening/opening-map), each a separate URL:
// history demos carry it as a path segment (/:id/duels/opening), external replays
// as `?d=` (matrix is the default, so it has no segment/param).
type DuelSub = 'matrix' | 'opening' | 'opening-map'
const duelSub = computed<DuelSub>(() => {
  const raw = route.params.sub || route.query.d
  const s = Array.isArray(raw) ? raw[0] : raw
  return s === 'opening' || s === 'opening-map' ? s : 'matrix'
})
function goDuelSub(sub: DuelSub) {
  if (currentSrc.value) {
    const query = { ...route.query, tab: 'duels', d: sub === 'matrix' ? undefined : sub }
    if (!query.d) delete query.d
    router.push({ path: '/', query })
    return
  }
  const id = currentId.value
  if (id) router.push(`/${id}/duels${sub === 'matrix' ? '' : `/${sub}`}`)
}

// Landing-page ambient preview: rotates through a few maps, switching to the
// next once each round finishes playing (see DemoPreviewLoop `@ended`). The
// starting map is randomized so refreshes don't always open on the same one.
const PREVIEWS = [
  '/replays/inferno-preview.json',
  '/replays/dust2-preview.json',
  '/replays/anubis-preview.json',
]
const previewIndex = ref(Math.floor(Math.random() * PREVIEWS.length))
const currentPreview = computed(() => PREVIEWS[previewIndex.value])
function nextPreview() {
  previewIndex.value = (previewIndex.value + 1) % PREVIEWS.length
}

const stage = ref<InstanceType<typeof ViewerStage> | null>(null)
// Leaving the 2D stage pauses playback (the stage stays mounted via v-show).
watch(activeTab, (tab) => {
  if (tab !== 'viewer') stage.value?.pause()
})

// Players indexed by steamId, for the utilities page filters/labels.
const playersById = computed(
  () => new Map((parser.replay.value?.players ?? []).map((p) => [p.steamId, p] as const)),
)

// A grenade picked on its tab seeks the replay to the throw and switches back.
function onGrenadeJump(payload: { roundIndex: number; t: number }) {
  stage.value?.jumpToThrow(payload)
  goTab('viewer')
}

function pick() {
  input.value?.click()
}

function pickImport() {
  importInput.value?.click()
}

async function onFiles(files: FileList | null | undefined) {
  const file = files?.[0]
  if (!file) return
  await handleFile(file)
}

/** Ingests a single demo File (from the dropzone, file picker, or the extension). */
async function handleFile(file: File) {
  // A `.cs2dv` is an exported, already-parsed replay: import it (no re-parsing).
  if (/\.cs2dv$/i.test(file.name)) {
    await onImportArchive(file)
    return
  }
  // Accept a raw .dem or a supported archive (.gz / .zip / .zst); the worker
  // detects the actual format by magic bytes and decompresses if needed.
  if (!/\.(dem|gz|zip|zst)$/i.test(file.name)) {
    parser.reset()
    return
  }
  await parser.parse(file)
  // New parse done: save to local history and open via the URL (with id).
  if (parser.status.value === 'done' && parser.replay.value) {
    const id = await recent.save({
      fileName: parser.fileName.value,
      fileSize: parser.fileSize.value,
      replay: parser.replay.value,
      voice: parser.voice.value,
    })
    if (id) {
      currentId.value = id // already loaded: keeps the watcher from reloading
      router.push(`/${id}`)
    }
  }
}

/** Imports an exported `.cs2dv` (replay + voice + comments) without re-parsing. */
async function onImportArchive(file: File) {
  importError.value = null
  importing.value = true
  try {
    const archive = await importArchive(file)
    const id = await recent.save({
      fileName: archive.meta.fileName,
      fileSize: file.size,
      replay: archive.replay,
      voice: archive.voice,
    })
    if (!id) return
    // Persist the comments before navigating, so the stage loads them on open.
    await recent.saveComments(id, archive.comments)
    // Hydrate now so the URL change doesn't reload it from IndexedDB.
    parser.hydrate({
      replay: archive.replay,
      voice: archive.voice,
      fileName: archive.meta.fileName,
      fileSize: file.size,
    })
    currentId.value = id
    router.push(`/${id}`)
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err)
  } finally {
    importing.value = false
  }
}

/** Opens a demo from history by id (loads from IndexedDB and hydrates). */
async function loadById(id: string) {
  if (currentId.value === id && parser.status.value === 'done') return
  routeLoading.value = true
  try {
    const payload = await recent.load(id)
    if (!payload) {
      // Not present in this browser (cleared storage / link from another machine).
      currentId.value = null
      router.replace('/')
      return
    }
    const meta = recent.list.value.find((d) => d.id === id)
    parser.hydrate({
      replay: payload.replay,
      voice: payload.voice,
      fileName: meta?.fileName ?? '',
      fileSize: meta?.fileSize ?? 0,
    })
    currentId.value = id
  } finally {
    routeLoading.value = false
  }
}

/**
 * Loads a pre-parsed replay from a `?replay=` ref (e.g. a Major demo committed
 * to the repo, fetched on demand), hydrating without re-parsing. The ref can be
 * a short relative path (`major-cologne-2026/qf1-nuke.cs2dv`) or a full URL; see
 * `resolveReplayRef`. Not persisted to history.
 */
async function loadExternal(ref: string, label: string) {
  if (currentSrc.value === ref && parser.status.value === 'done') return
  routeLoading.value = true
  currentId.value = null
  try {
    const { replay, voice } = await fetchReplay(ref)
    parser.hydrate({ replay, voice, fileName: label })
    currentSrc.value = ref
  } catch {
    currentSrc.value = null
    router.replace('/')
  } finally {
    routeLoading.value = false
  }
}

// The URL drives: /:id opens a demo from history; `?replay=<url>` streams an
// external replay (Major demos); `/` alone shows the upload.
watch(
  () => [route.params.id, route.query.replay, route.query.name] as const,
  ([rawId, rawReplay, rawName]) => {
    const id = Array.isArray(rawId) ? rawId[0] : rawId
    if (id) {
      currentSrc.value = null
      if (id === currentId.value && parser.status.value === 'done') return
      void loadById(id)
      return
    }
    const url = Array.isArray(rawReplay) ? rawReplay[0] : rawReplay
    if (url) {
      const label = (Array.isArray(rawName) ? rawName[0] : rawName) ?? ''
      void loadExternal(url, label)
      return
    }
    parser.reset()
    currentId.value = null
    currentSrc.value = null
  },
  { immediate: true },
)

// A companion browser extension (Faceit "Open in 2D") can hand a freshly
// downloaded demo straight to the analyzer over window.postMessage; we feed it
// through the same ingest path as a local file. While the extension downloads
// the demo from Faceit's CDN we show a progress overlay in this tab (the same
// surface the parser progress uses), so the wait isn't a blank page.
type ExtDownload =
  | { phase: 'connecting' }
  | { phase: 'downloading'; loaded: number; total: number }
  | { phase: 'error'; message: string }
const extDownload = ref<ExtDownload | null>(null)
// Download percentage (0 when the CDN didn't send a Content-Length).
const extPct = computed(() => {
  const d = extDownload.value
  if (d?.phase !== 'downloading' || !d.total) return 0
  return Math.round((d.loaded / d.total) * 100)
})
let stopExtensionBridge: (() => void) | null = null
onMounted(() => {
  // Opened by the extension: show feedback before the first byte even arrives.
  if (route.query.fromExtension) extDownload.value = { phase: 'connecting' }
  stopExtensionBridge = listenForExtensionDemo({
    onDownloadStart: (total) => {
      extDownload.value = { phase: 'downloading', loaded: 0, total }
    },
    onDownloadProgress: (loaded, total) => {
      extDownload.value = { phase: 'downloading', loaded, total }
    },
    onDownloadError: (message) => {
      extDownload.value = { phase: 'error', message }
    },
    onDemo: (file) => {
      // Bytes are in: hand off to the parser (its own overlay takes over).
      extDownload.value = null
      void handleFile(file)
    },
  })
})
onUnmounted(() => stopExtensionBridge?.())

function onDrop(e: DragEvent) {
  dragging.value = false
  void onFiles(e.dataTransfer?.files)
}

function onInput(e: Event) {
  void onFiles((e.target as HTMLInputElement).files)
}

function onImportInput(e: Event) {
  const el = e.target as HTMLInputElement
  void onFiles(el.files)
  // Allow re-picking the same file (no change event fires otherwise).
  el.value = ''
}

</script>

<template>
  <div class="relative h-full w-full bg-ink-950">
    <!-- Content when the replay is ready: 2D stage or heatmap, per tab -->
    <template v-if="parser.status.value === 'done' && parser.replay.value">
      <!-- v-show keeps the stage mounted (preserves playback position across tab switches) -->
      <div v-show="activeTab === 'viewer'" class="h-full w-full">
        <ViewerStage
          ref="stage"
          :replay="parser.replay.value"
          :voice="parser.voice.value"
          :source-label="parser.fileName.value"
          :id="currentId ?? undefined"
          :file-name="parser.fileName.value"
          :skip-freeze="skipFreeze"
          :autoplay="autoplay"
        />
      </div>
      <HeatmapView
        v-if="activeTab === 'heatmap'"
        :replay="parser.replay.value"
        :source="heatmapSource"
        @update:source="goHeatmapSource"
        @jump="onGrenadeJump"
      />
      <UtilitiesView
        v-if="activeTab === 'utilities'"
        :replay="parser.replay.value"
        :players-by-id="playersById"
        :sub="utilitySub"
        @update:sub="goUtilitySub"
        @jump="onGrenadeJump"
      />
      <EconomyView v-if="activeTab === 'economy'" :replay="parser.replay.value" />
      <DuelsView
        v-if="activeTab === 'duels'"
        :replay="parser.replay.value"
        :sub="duelSub"
        @update:sub="goDuelSub"
        @jump="onGrenadeJump"
      />

      <!-- Tabs (2D / Heatmaps / Utilities / Economy / Duels) in the center of the appbar -->
      <Teleport to="#publicbar-center">
        <div class="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900/60 p-0.5">
          <button
            type="button"
            class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'viewer' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('viewer')"
          >
            {{ t('tabs.replay') }}
          </button>
          <button
            type="button"
            class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'heatmap' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('heatmap')"
          >
            {{ t('tabs.heatmaps') }}
          </button>
          <button
            type="button"
            class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'utilities' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('utilities')"
          >
            {{ t('tabs.utilities') }}
          </button>
          <button
            type="button"
            class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'economy' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('economy')"
          >
            {{ t('tabs.economy') }}
          </button>
          <button
            type="button"
            class="shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'duels' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('duels')"
          >
            {{ t('tabs.duels') }}
          </button>
        </div>
      </Teleport>
    </template>

    <!-- Extension download state: the companion extension is fetching the demo
         from Faceit's CDN. Same visual language as the parser overlay below. -->
    <div
      v-else-if="extDownload"
      class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <UiIcon
        :name="extDownload.phase === 'error' ? 'info' : 'loader'"
        class="h-10 w-10"
        :class="extDownload.phase === 'error' ? 'text-red-400' : 'animate-spin text-surge-400'"
      />
      <div>
        <p class="font-display text-lg text-ink-50">
          {{
            extDownload.phase === 'error'
              ? t('analyzer.extDownloadError')
              : extDownload.phase === 'downloading'
                ? t('analyzer.extDownloading')
                : t('analyzer.extConnecting')
          }}
        </p>
        <p v-if="extDownload.phase === 'error'" class="mt-1 max-w-sm font-mono text-xs text-ink-500">
          {{ extDownload.message }}
        </p>
        <p
          v-else-if="extDownload.phase === 'downloading' && !extDownload.total"
          class="mt-1 font-mono text-xs text-ink-500"
        >
          {{ fmtSize(extDownload.loaded) }}
        </p>
      </div>

      <!-- Real bar when the CDN sent a Content-Length; otherwise just the spinner. -->
      <div v-if="extDownload.phase === 'downloading' && extDownload.total" class="w-full max-w-sm">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
          <div
            class="h-full rounded-full bg-surge-400 transition-all duration-300 ease-out"
            :style="{ width: `${extPct}%` }"
          />
        </div>
        <p class="mt-1.5 text-right font-mono text-xs text-ink-500">{{ extPct }}%</p>
      </div>

      <p class="max-w-sm text-xs text-ink-500">{{ t('analyzer.localNote') }}</p>
    </div>

    <!-- Processing state (new parse, importing a .cs2dv, or opening a demo via
         the URL). The extension hands over a .cs2dv, so `importing` keeps this
         loader on screen instead of falling back to the landing dropzone. -->
    <div
      v-else-if="
        routeLoading ||
        importing ||
        parser.status.value === 'reading' ||
        parser.status.value === 'parsing'
      "
      class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <UiIcon name="loader" class="h-10 w-10 animate-spin text-surge-400" />
      <div>
        <p class="font-display text-lg text-ink-50">
          {{ importing ? t('analyzer.importing') : routeLoading ? t('analyzer.openingDemo') : phaseLabel }}
        </p>
        <p v-if="!importing && parser.fileName.value" class="mt-1 text-sm text-ink-300">
          {{ parser.fileName.value }}
          <span v-if="parser.fileSize.value" class="text-ink-500">
            · {{ fmtSize(parser.fileSize.value) }}
            <template v-if="parser.rawSize.value"> → {{ fmtSize(parser.rawSize.value) }}</template>
          </span>
        </p>
        <p v-if="!routeLoading && !importing && parseTickDetail" class="mt-1 font-mono text-xs text-ink-500">
          {{ parseTickDetail }}
        </p>
      </div>

      <!-- Linear progress: real bar (tick-driven during parsing) so the user can
           see actual movement, especially for big .zst demos. -->
      <div v-if="!routeLoading && !importing" class="w-full max-w-sm">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
          <div
            class="h-full rounded-full bg-surge-400 transition-all duration-300 ease-out"
            :style="{ width: `${progressPct}%` }"
          />
        </div>
        <p class="mt-1.5 text-right font-mono text-xs text-ink-500">{{ progressPct }}%</p>
      </div>

      <p class="max-w-sm text-xs text-ink-500">
        {{ t('analyzer.localNote') }}
      </p>
    </div>

    <!-- Dropzone + history (idle / error) -->
    <div v-else class="relative h-full overflow-hidden">
      <!-- Looping preview as ambient background, filling the right half of the screen.
           No box or controls: just illustrates what the tool is about. -->
      <div class="pointer-events-none absolute inset-y-0 right-0 left-1/2 hidden lg:block">
        <DemoPreviewLoop
          :key="currentPreview"
          :src="currentPreview"
          :loop="false"
          class="h-full w-full opacity-70"
          @ended="nextPreview"
        />
        <!-- Blends the left edge into the content and darkens top/bottom. -->
        <div class="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/25 to-transparent" />
        <div class="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-ink-950/70" />
      </div>

      <div class="relative h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div class="flex min-h-full w-full flex-col justify-center px-6 py-10">
        <!-- Hero content, centered in the window (the preview sits behind it). -->
        <div class="mx-auto max-w-xl">
          <div class="mb-6">
            <h1 class="font-display text-3xl text-ink-50">{{ t('analyzer.title') }}</h1>
            <p class="mt-2 max-w-md text-sm text-ink-300">
              {{ t('analyzer.subtitleA') }}<span class="font-mono text-ink-100">.dem</span>{{ t('analyzer.subtitleB') }}
            </p>
          </div>

          <div
            class="flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors"
            :class="
              dragging
                ? 'border-surge-500 bg-surge-500/5'
                : 'border-ink-700 bg-ink-900/60 hover:border-ink-500 hover:bg-ink-900/80'
            "
            role="button"
            tabindex="0"
            @click="pick"
            @keydown.enter.prevent="pick"
            @keydown.space.prevent="pick"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <div class="flex h-14 w-14 items-center justify-center rounded-full bg-ink-800 text-surge-400">
              <UiIcon name="upload" class="h-7 w-7" />
            </div>
            <div>
              <p class="font-display text-ink-50">{{ t('analyzer.dragHere') }}</p>
              <p class="mt-1 text-sm text-ink-400">{{ t('analyzer.orClick') }}</p>
            </div>
            <p class="text-xs text-ink-500">{{ t('analyzer.formatHint') }}</p>

            <input
              ref="input"
              type="file"
              accept=".dem,.gz,.zip,.zst,.cs2dv"
              class="hidden"
              @change="onInput"
              @click.stop
            />
          </div>

          <!-- Import an exported replay (.cs2dv); scoped picker, not the demo dropzone -->
          <div class="mt-3">
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-2.5 text-sm text-ink-300 transition-colors hover:border-ink-600 hover:bg-ink-900/70 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="importing"
              @click="pickImport"
            >
              <UiIcon
                :name="importing ? 'loader' : 'download'"
                class="h-4 w-4"
                :class="{ 'animate-spin': importing }"
              />
              {{ importing ? t('analyzer.importing') : t('analyzer.import') }}
            </button>
            <p class="mt-1.5 text-center text-xs text-ink-500">{{ t('analyzer.importHint') }}</p>
            <input
              ref="importInput"
              type="file"
              accept=".cs2dv"
              class="hidden"
              @change="onImportInput"
            />
          </div>

          <div
            v-if="parser.status.value === 'error'"
            class="mt-4 flex items-start gap-3 rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm text-loss"
          >
            <UiIcon name="ban" class="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p class="font-medium">{{ t('analyzer.errorTitle') }}</p>
              <p class="mt-0.5 text-xs text-loss/80">{{ parser.error.value }}</p>
            </div>
          </div>

          <div
            v-if="importError"
            class="mt-4 flex items-start gap-3 rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm text-loss"
          >
            <UiIcon name="ban" class="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p class="font-medium">{{ t('analyzer.importError') }}</p>
              <p class="mt-0.5 text-xs text-loss/80">{{ importError }}</p>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
