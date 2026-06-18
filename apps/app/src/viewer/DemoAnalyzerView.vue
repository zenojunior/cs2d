<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '@/ui/UiIcon.vue'
import ViewerStage from '@/viewer/ViewerStage.vue'
import HeatmapView from '@/viewer/HeatmapView.vue'
import GrenadesView from '@/viewer/GrenadesView.vue'
import EconomyView from '@/viewer/EconomyView.vue'
import DemoPreviewLoop from '@/viewer/DemoPreviewLoop.vue'
import { useDemoParser } from '@/viewer/useDemoParser'
import { useRecentDemos, type RecentDemo } from '@/viewer/useRecentDemos'
import { importArchive } from '@/viewer/demoArchive'
import { MAP_CALIBRATION } from '@/viewer/calibration'
import type { Replay } from '@/viewer/schema'
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
// Id of the recent demo currently being reloaded from local storage.
const loadingId = ref<string | null>(null)
// Loading a demo from the URL (/:id).
const routeLoading = ref(false)
// Id of the currently open demo (avoids reloading when navigating to itself).
const currentId = ref<string | null>(null)
// URL of the currently open external replay (Major demo), if any (same purpose).
const currentSrc = ref<string | null>(null)
type Tab = 'viewer' | 'heatmap' | 'grenades' | 'economy'
// The active tab is driven by the URL: `/:id` is the 2D stage, `/:id/heatmaps`
// the heatmap, `/:id/grenades` the grenades page, `/:id/economy` the economy page.
const activeTab = computed<Tab>(() => {
  const raw = route.params.tab
  const tab = Array.isArray(raw) ? raw[0] : raw
  if (tab === 'heatmaps') return 'heatmap'
  if (tab === 'grenades') return 'grenades'
  if (tab === 'economy') return 'economy'
  return 'viewer'
})
const TAB_SEGMENT: Record<Tab, string> = {
  viewer: '',
  heatmap: '/heatmaps',
  grenades: '/grenades',
  economy: '/economy',
}
function goTab(tab: Tab) {
  const id = currentId.value
  if (id) router.push(`/${id}${TAB_SEGMENT[tab]}`)
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

// Players indexed by steamId, for the grenades page filters/labels.
const playersById = computed(
  () => new Map((parser.replay.value?.players ?? []).map((p) => [p.steamId, p] as const)),
)
// Focused round in the replay, for the grenades "current round only" filter.
const stageRoundIndex = computed(() => stage.value?.roundIndex ?? 0)

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
  loadingId.value = id
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
    loadingId.value = null
  }
}

/**
 * Loads a pre-parsed replay JSON from a URL (e.g. a Major demo committed to the
 * repo, fetched on demand), hydrating without re-parsing. Not persisted to history.
 */
async function loadExternal(url: string, label: string) {
  if (currentSrc.value === url && parser.status.value === 'done') return
  routeLoading.value = true
  currentId.value = null
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const replay = (await res.json()) as Replay
    parser.hydrate({ replay, voice: null, fileName: label })
    currentSrc.value = url
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

// Reopening a demo from history = navigate to the id (the URL drives loading).
function openRecent(demo: RecentDemo) {
  if (loadingId.value) return
  router.push(`/${demo.id}`)
}

function fmtSize(bytes: number) {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

// "de_dust2" -> "Dust2"; strips the game-mode prefix and capitalizes.
function prettyMap(map: string) {
  const base = map.replace(/^(de|cs|ar|dz)_/, '')
  return base.charAt(0).toUpperCase() + base.slice(1)
}

// Maps with preview art (16:9) in /maps/thumbs.
const MAP_THUMBS = new Set([
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2',
  'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass',
])

// Map image for the thumbnail: the preview art when it exists; otherwise the
// radar used in the viewer; otherwise nothing (falls back to the generic icon).
function mapImage(map: string): string | null {
  if (MAP_THUMBS.has(map)) return `/maps/thumbs/${map}.webp`
  return MAP_CALIBRATION[map]?.radar ?? null
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
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
        />
      </div>
      <HeatmapView v-if="activeTab === 'heatmap'" :replay="parser.replay.value" />
      <GrenadesView
        v-if="activeTab === 'grenades'"
        :replay="parser.replay.value"
        :players-by-id="playersById"
        :current-round-index="stageRoundIndex"
        @jump="onGrenadeJump"
      />
      <EconomyView v-if="activeTab === 'economy'" :replay="parser.replay.value" />

      <!-- Tabs (2D / Heatmaps / Grenades) in the center of the appbar -->
      <Teleport to="#publicbar-center">
        <div class="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900/60 p-0.5">
          <button
            type="button"
            class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'viewer' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('viewer')"
          >
            {{ t('tabs.replay') }}
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'heatmap' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('heatmap')"
          >
            {{ t('tabs.heatmaps') }}
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'grenades' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('grenades')"
          >
            {{ t('tabs.grenades') }}
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors"
            :class="activeTab === 'economy' ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="goTab('economy')"
          >
            {{ t('tabs.economy') }}
          </button>
        </div>
      </Teleport>
    </template>

    <!-- Processing state (new parse or opening a demo via the URL) -->
    <div
      v-else-if="
        routeLoading || parser.status.value === 'reading' || parser.status.value === 'parsing'
      "
      class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <UiIcon name="loader" class="h-10 w-10 animate-spin text-surge-400" />
      <div>
        <p class="font-display text-lg text-ink-50">
          {{ routeLoading ? t('analyzer.openingDemo') : phaseLabel }}
        </p>
        <p v-if="parser.fileName.value" class="mt-1 text-sm text-ink-300">
          {{ parser.fileName.value }}
          <span v-if="parser.fileSize.value" class="text-ink-500">
            · {{ fmtSize(parser.fileSize.value) }}
            <template v-if="parser.rawSize.value"> → {{ fmtSize(parser.rawSize.value) }}</template>
          </span>
        </p>
        <p v-if="!routeLoading && parseTickDetail" class="mt-1 font-mono text-xs text-ink-500">
          {{ parseTickDetail }}
        </p>
      </div>

      <!-- Linear progress: real bar (tick-driven during parsing) so the user can
           see actual movement, especially for big .zst demos. -->
      <div v-if="!routeLoading" class="w-full max-w-sm">
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

        <!-- Local history: previously analyzed demos, stored in the browser -->
        <section v-if="recent.list.value.length" class="mx-auto mt-10 max-w-xl">
          <div class="mb-3 flex items-center gap-2">
            <UiIcon name="history" class="h-4 w-4 text-ink-400" />
            <h2 class="text-sm font-semibold text-ink-200">{{ t('analyzer.recentTitle') }}</h2>
          </div>

          <ul class="space-y-2">
            <li v-for="demo in recent.list.value" :key="demo.id">
              <div
                class="group flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900/40 p-3 transition-colors hover:border-ink-600 hover:bg-ink-900/70"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  :disabled="Boolean(loadingId)"
                  @click="openRecent(demo)"
                >
                  <div
                    class="relative grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-800 text-ink-300"
                  >
                    <img
                      v-if="mapImage(demo.map)"
                      :src="mapImage(demo.map)!"
                      :alt="prettyMap(demo.map)"
                      class="absolute inset-0 h-full w-full object-cover opacity-90"
                    />
                    <UiIcon v-else name="map" class="h-4 w-4" />
                    <!-- Loading overlay while reopening the demo -->
                    <div
                      v-if="loadingId === demo.id"
                      class="absolute inset-0 grid place-items-center bg-ink-950/60"
                    >
                      <UiIcon name="loader" class="h-4 w-4 animate-spin text-surge-400" />
                    </div>
                  </div>

                  <div class="min-w-0 flex-1">
                    <p class="flex items-center gap-2 text-sm font-medium text-ink-50">
                      <span class="truncate">{{ prettyMap(demo.map) }}</span>
                      <span class="font-mono text-xs text-ink-400">
                        <span class="text-pulse-300">{{ demo.scoreCt }}</span>
                        <span class="text-ink-600"> : </span>
                        <span class="text-warn">{{ demo.scoreT }}</span>
                      </span>
                      <span
                        v-if="demo.hasVoice"
                        class="inline-flex items-center gap-0.5 text-ink-500"
                        title="Com voz dos jogadores"
                      >
                        <UiIcon name="mic" class="h-3 w-3" />
                      </span>
                    </p>
                    <p class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-500">
                      <span class="truncate">{{ demo.fileName }}</span>
                      <span class="text-ink-700">·</span>
                      <span class="shrink-0">{{ fmtSize(demo.fileSize) }}</span>
                      <span class="text-ink-700">·</span>
                      <span class="shrink-0">{{ fmtDate(demo.savedAt) }}</span>
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  aria-label="Remover do histórico"
                  class="shrink-0 cursor-pointer rounded-md p-1.5 text-ink-500 opacity-0 transition-colors hover:bg-ink-800 hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100"
                  @click="recent.remove(demo.id)"
                >
                  <UiIcon name="x" class="h-4 w-4" />
                </button>
              </div>
            </li>
          </ul>

          <p class="mt-3 text-xs text-ink-600">
            {{ t('analyzer.recentNote') }}
          </p>
        </section>
      </div>
      </div>
    </div>
  </div>
</template>
