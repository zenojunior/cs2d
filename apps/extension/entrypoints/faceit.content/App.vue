<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import { Check, Download, ExternalLink, Github, Globe, HardDrive, Library, Loader2, Minus, MoreVertical, Play, Settings, Trash2, Upload, X } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Progress from '@/components/ui/progress/Progress.vue'
import Select from '@/components/ui/select/Select.vue'
import type { ActiveJob, ArchiveMetaRow, StateReply } from '@/utils/protocol'
import { LOCALES, currentLocale, initLocale, setLocale, t, type LocaleCode } from './i18n'

const WEB_APP = 'https://cs2d.app'

// Maps whose top-down 2D radar ships in the extension (public/maps/radars).
const KNOWN_RADARS = new Set([
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2',
  'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_vertigo',
])
// Maps with an in-game photo thumb (public/maps/thumbs), used on library cards.
const KNOWN_THUMBS = new Set([
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2',
  'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass',
])

type Tab = 'library' | 'settings'
const tab = ref<Tab>('library')

const state = ref<StateReply>({ active: [], stored: [], totalBytes: 0 })

// --- live state polling -----------------------------------------------------
async function refresh() {
  try {
    state.value = (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' })) as StateReply
  } catch {
    /* background asleep between sends; next tick retries */
  }
}

// --- actions ----------------------------------------------------------------
function onCancel(matchId: string) {
  void chrome.runtime.sendMessage({ target: 'background', type: 'CANCEL', matchId })
  void refresh()
}
// A stored replay pending delete confirmation (its card shows an inline prompt).
const confirmId = ref<string | null>(null)
function onDelete(matchId: string) {
  confirmId.value = null
  void chrome.runtime.sendMessage({ target: 'background', type: 'DELETE', matchId })
  void refresh()
}
/** Open a stored replay in the web app's 2D viewer (handoff via the bridge). */
function onWatch(matchId: string) {
  void chrome.runtime.sendMessage({ target: 'background', type: 'OPEN_VIEWER', matchId })
}
/** Export a stored replay: pull the .cs2dv (base64) and save it to disk. The
 *  blob lives in the extension origin, so the content script builds the object
 *  URL and clicks an anchor (no downloads permission needed). */
async function onExport(matchId: string) {
  try {
    const reply = (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_BLOB', matchId })) as {
      fileName: string
      base64: string
    } | null
    if (!reply) return
    const bin = atob(reply.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = reply.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    console.error('[cs2dv]', err)
  }
}

// --- import a .cs2dv into the library ----------------------------------------
const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
function triggerImport() {
  importInput.value?.click()
}
async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking the same file
  if (!file) return
  importing.value = true
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    const CHUNK = 0x8000 // chunked so String.fromCharCode never overflows the call stack
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    await chrome.runtime.sendMessage({ target: 'background', type: 'IMPORT', fileName: file.name, base64: btoa(bin) })
    await refresh()
    tab.value = 'library'
  } catch (err) {
    console.error('[cs2dv]', err)
  } finally {
    importing.value = false
  }
}

// --- right-click context menu (export / open / delete) ----------------------
const menu = ref<{ x: number; y: number; row: ArchiveMetaRow } | null>(null)
function openMenu(e: MouseEvent, row: ArchiveMetaRow) {
  e.preventDefault()
  menu.value = { x: e.clientX, y: e.clientY, row }
}
function closeMenu() {
  menu.value = null
}
// Keep the menu inside the viewport (it's positioned at the click point).
const menuStyle = computed(() => ({
  left: Math.min(menu.value?.x ?? 0, window.innerWidth - 180) + 'px',
  top: Math.min(menu.value?.y ?? 0, window.innerHeight - 170) + 'px',
}))

// --- source of a stored demo (faceit today, hltv next, imported .cs2dv) ------
function sourceLabel(source?: string) {
  if (!source) return ''
  return source === 'imported' ? t('library.imported') : source.toUpperCase()
}

// --- library filters --------------------------------------------------------
const search = ref('')
const mapFilter = ref('')
const sourceFilter = ref('')
const availableMaps = computed(() => [...new Set(state.value.stored.map((r) => r.map))].sort())
const availableSources = computed(() => [...new Set(state.value.stored.map((r) => r.source).filter(Boolean))] as string[])
const mapOptions = computed(() => availableMaps.value.map((m) => ({ value: m, label: prettyMap(m) })))
const sourceOptions = computed(() => availableSources.value.map((s) => ({ value: s, label: sourceLabel(s) })))
const filteredStored = computed(() => {
  const q = search.value.trim().toLowerCase()
  return state.value.stored.filter((r) => {
    if (mapFilter.value && r.map !== mapFilter.value) return false
    if (sourceFilter.value && r.source !== sourceFilter.value) return false
    if (!q) return true
    return [r.teamA, r.teamB, r.competition, r.map, r.label, r.source].some((f) => f?.toLowerCase().includes(q))
  })
})

// Library paging: keep the rendered card count bounded so a large library does
// not bloat the content-script DOM. "Load more" reveals the next page; the
// window resets to the first page whenever the filters change the result set.
const PAGE = 24
const visibleCount = ref(PAGE)
const visibleStored = computed(() => filteredStored.value.slice(0, visibleCount.value))
const hasMore = computed(() => filteredStored.value.length > visibleCount.value)
watch([search, mapFilter, sourceFilter], () => {
  visibleCount.value = PAGE
})

// --- presentation helpers ---------------------------------------------------
function radarUrl(map?: string) {
  return map && KNOWN_RADARS.has(map) ? chrome.runtime.getURL(`maps/radars/${map}_radar.png` as never) : null
}
function thumbUrl(map?: string) {
  return map && KNOWN_THUMBS.has(map) ? chrome.runtime.getURL(`maps/thumbs/${map}.webp` as never) : null
}
function topLine(parts: (string | undefined)[]) {
  return parts.filter(Boolean).join(' · ')
}
function prettyMap(map: string) {
  const base = map.replace(/^(de|cs|ar|dz)_/, '')
  return base.charAt(0).toUpperCase() + base.slice(1)
}
function fmtMB(bytes: number) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}
function jobPct(job: ActiveJob) {
  return job.total ? Math.round((job.loaded / job.total) * 100) : 0
}
function jobStatus(job: ActiveJob) {
  if (job.error) return t('hero.error')
  if (job.phase === 'downloading') {
    return job.total ? `${t('status.downloading')} ${jobPct(job)}%` : `${t('status.downloading')} ${fmtMB(job.loaded)}`
  }
  return t(`status.${job.phase}`)
}
function jobProgress(job: ActiveJob) {
  return job.error ? 0 : job.phase === 'downloading' ? jobPct(job) : 100
}

// --- settings ---------------------------------------------------------------
const locale = computed(() => currentLocale())
function chooseLocale(code: LocaleCode) {
  setLocale(code)
}

// --- footer links -----------------------------------------------------------
const GITHUB = 'https://github.com/zenojunior/cs-demo-analyzer'
const version = chrome.runtime.getManifest?.().version ?? ''

// --- panel position: anchored to the top-right corner -----------------------
// Everything is positioned by its top-right corner (where the minimize button
// sits). That makes minimize collapse *into* that corner and restore grow back
// out to the left — and keeps the corner pinned on-screen as size/window change.
const MARGIN = 10 // minimum gap kept from every screen edge
const PANEL_W = 500
const BUBBLE_W = 44
const corner = reactive({ x: 0, y: 0 }) // top-right corner, viewport px
const minimized = ref(false)
let drag: { ox: number; oy: number; sx: number; sy: number; moved: boolean } | null = null

// The currently-rendered root (panel or bubble), measured so the whole thing is
// kept on-screen. A ResizeObserver re-clamps on size changes (tab switch,
// download progress); the window `resize` listener handles a shrinking viewport.
let panelEl: HTMLElement | null = null
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => clampCorner()) : null
function setPanelEl(el: Element | ComponentPublicInstance | null) {
  // Ignore unmount nulls (during the minimize/restore transition both roots
  // exist briefly); the entering element's ref keeps panelEl pointing at it.
  const node = el instanceof HTMLElement ? el : null
  if (!node) return
  if (panelEl && ro) ro.unobserve(panelEl)
  panelEl = node
  ro?.observe(node)
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
function clampCorner() {
  const w = panelEl?.offsetWidth ?? (minimized.value ? BUBBLE_W : PANEL_W)
  const h = panelEl?.offsetHeight ?? 0
  corner.x = clamp(corner.x, w + MARGIN, Math.max(w + MARGIN, window.innerWidth - MARGIN))
  corner.y = clamp(corner.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN))
}
const panelStyle = computed(() => ({
  left: corner.x - PANEL_W + 'px',
  top: corner.y + 'px',
  // Subtle brand-amber glow from the top-right corner (where the icon sits),
  // fading into the base surface. Tune the alpha / spread to taste.
  background: 'radial-gradient(130% 90% at 100% 0%, rgba(253, 172, 26, 0.12), transparent 55%), #15151a',
}))
const bubbleStyle = computed(() => ({ left: corner.x - BUBBLE_W + 'px', top: corner.y + 'px' }))
// Flip the bubble's tooltip to whichever side has room (recomputes as it moves).
const tooltipOnLeft = computed(() => corner.x > window.innerWidth / 2)

function persist() {
  void chrome.storage.local.set({ corner: { x: corner.x, y: corner.y }, minimized: minimized.value })
}
function setMinimized(v: boolean) {
  minimized.value = v
  void nextTick(() => {
    clampCorner()
    persist()
  })
}

function onDragStart(e: PointerEvent) {
  drag = { ox: corner.x - e.clientX, oy: corner.y - e.clientY, sx: e.clientX, sy: e.clientY, moved: false }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}
function onDragMove(e: PointerEvent) {
  if (!drag) return
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true
  corner.x = e.clientX + drag.ox
  corner.y = e.clientY + drag.oy
  clampCorner()
}
function onDragEnd() {
  // A press on the bubble that never moved is a click: restore the panel.
  const clickedBubble = minimized.value && !!drag && !drag.moved
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  if (clickedBubble) setMinimized(false)
  else persist()
}

// --- lifecycle --------------------------------------------------------------
let timer: number | undefined
onMounted(async () => {
  await initLocale()
  const { corner: saved, panelPos, minimized: savedMin } = await chrome.storage.local.get(['corner', 'panelPos', 'minimized'])
  minimized.value = !!savedMin
  if (saved) {
    corner.x = saved.x
    corner.y = saved.y
  } else if (panelPos) {
    corner.x = panelPos.left + 340 // migrate from the old top-left model (340px panel)
    corner.y = panelPos.top
  } else {
    corner.x = window.innerWidth - 24
    corner.y = Math.round(window.innerHeight * 0.16)
  }
  window.addEventListener('resize', clampCorner)
  await refresh()
  timer = window.setInterval(refresh, 1000)
  void nextTick(clampCorner) // first clamp once the real size is laid out
})
onUnmounted(() => {
  window.removeEventListener('resize', clampCorner)
  ro?.disconnect()
  if (timer) clearInterval(timer)
})
</script>

<template>
  <!-- Minimized: a draggable bubble showing the extension icon (click restores). -->
  <Transition name="pop">
  <div v-if="minimized" :ref="setPanelEl" class="fixed z-[999999] origin-top-right" :style="bubbleStyle">
    <div class="group relative">
      <button
        class="flex size-[44px] cursor-grab touch-none items-center justify-center rounded-2xl border border-border bg-[#0a0c12] shadow-2xl active:cursor-grabbing"
        @pointerdown.prevent="onDragStart"
      >
        <svg viewBox="0 0 403 404" class="size-6 fill-primary" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M57.7397 12.9922C57.7417 12.9902 75.5147 30.7642 97.2347 52.4892L135.029 90.292L126.581 91.9892H0.0117188L0.71072 88.2632C6.05272 59.7872 25.5907 32.3772 51.8157 16.5632L57.7397 12.9922Z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M0.00396729 215.24C0.00796729 308.513 0.125914 310.931 5.46191 327.277C18.2509 366.454 52.2201 395.265 93.0001 401.522C106.968 403.665 294.901 403.678 309 401.536C356.2 394.369 393.378 357.19 400.545 309.99C401.717 302.276 401.989 284.369 401.994 214.74L402 128.99H0L0.00396729 215.24ZM156.316 171.876C153.735 173.083 151.054 175.463 149.316 178.088L146.5 182.342L146.197 236.415C145.996 272.207 146.25 291.712 146.946 294.105C150.134 305.05 162.757 310.201 173.29 304.853C184.803 299.008 266.747 253.57 268.356 252.139C276.109 245.248 275.519 230.019 267.273 224.203C265.748 223.127 243.375 210.632 217.556 196.435C165.671 167.906 165.209 167.72 156.316 171.876Z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M189.984 91.9895H255.984L165 0.989502H99L189.984 91.9895Z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M266.492 45.5C284.258 63.2689 311.984 91 311.984 91H402.715L402.016 87.274C395.142 50.634 366.033 17.902 329.38 5.598C314.77 0.693997 306.512 0.00800162 261.996 0.00400162L221 0C221 0 248.726 27.7311 266.492 45.5Z" />
        </svg>
      </button>
      <span
        class="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
        :class="tooltipOnLeft ? 'right-full mr-2' : 'left-full ml-2'"
      >
        CS Demo Analyzer
      </span>
    </div>
  </div>
  </Transition>

  <Transition name="pop">
  <div
    v-if="!minimized"
    :ref="setPanelEl"
    class="fixed z-[999999] flex h-[450px] max-h-[88vh] w-[500px] origin-top-right flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
    :style="panelStyle"
  >
    <!-- Header / drag handle -->
    <div
      class="flex cursor-grab touch-none items-center justify-between border-b border-border bg-[#0a0c12] px-3 py-2.5 active:cursor-grabbing"
      @pointerdown.prevent="onDragStart"
    >
      <div class="flex items-center gap-1.5 font-semibold">
        <svg viewBox="0 0 403 404" class="size-4 fill-primary" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M57.7397 12.9922C57.7417 12.9902 75.5147 30.7642 97.2347 52.4892L135.029 90.292L126.581 91.9892H0.0117188L0.71072 88.2632C6.05272 59.7872 25.5907 32.3772 51.8157 16.5632L57.7397 12.9922Z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M0.00396729 215.24C0.00796729 308.513 0.125914 310.931 5.46191 327.277C18.2509 366.454 52.2201 395.265 93.0001 401.522C106.968 403.665 294.901 403.678 309 401.536C356.2 394.369 393.378 357.19 400.545 309.99C401.717 302.276 401.989 284.369 401.994 214.74L402 128.99H0L0.00396729 215.24ZM156.316 171.876C153.735 173.083 151.054 175.463 149.316 178.088L146.5 182.342L146.197 236.415C145.996 272.207 146.25 291.712 146.946 294.105C150.134 305.05 162.757 310.201 173.29 304.853C184.803 299.008 266.747 253.57 268.356 252.139C276.109 245.248 275.519 230.019 267.273 224.203C265.748 223.127 243.375 210.632 217.556 196.435C165.671 167.906 165.209 167.72 156.316 171.876Z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M189.984 91.9895H255.984L165 0.989502H99L189.984 91.9895Z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M266.492 45.5C284.258 63.2689 311.984 91 311.984 91H402.715L402.016 87.274C395.142 50.634 366.033 17.902 329.38 5.598C314.77 0.693997 306.512 0.00800162 261.996 0.00400162L221 0C221 0 248.726 27.7311 266.492 45.5Z" />
        </svg>
        CS Demo Analyzer
      </div>
      <div class="flex items-center gap-2">
        <div class="text-xs font-medium">
          <span v-if="state.active.length" class="text-primary">{{ t('header.downloading', { n: state.active.length }) }} · </span>
          <span class="text-muted-foreground">{{ fmtMB(state.totalBytes) }}</span>
        </div>
        <div class="group relative">
          <button
            class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            @pointerdown.stop
            @click="setMinimized(true)"
          >
            <Minus class="size-4" />
          </button>
          <span class="pointer-events-none absolute right-0 top-full z-30 mt-1.5 whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
            {{ t('header.minimize') }}
          </span>
        </div>
      </div>
    </div>

    <!-- Body: sidebar nav + content -->
    <div class="flex min-h-0 flex-1">
      <!-- Sidebar -->
      <nav class="flex w-[140px] shrink-0 flex-col gap-1 border-r border-border p-2">
        <button
          v-for="item in (['library', 'settings'] as Tab[])"
          :key="item"
          class="flex items-center gap-2 rounded-md px-2 py-2 text-xs font-medium transition-colors"
          :class="tab === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          @click="tab = item"
        >
          <Library v-if="item === 'library'" class="size-4 shrink-0" />
          <Settings v-else class="size-4 shrink-0" />
          <span class="min-w-0 truncate">{{ t(`tabs.${item}`) }}</span>
          <span
            v-if="item === 'library' && state.stored.length"
            class="ml-auto rounded px-1 text-[10px]"
            :class="tab === item ? 'bg-primary-foreground/20' : 'bg-muted'"
          >{{ state.stored.length }}</span>
        </button>

        <!-- Footer: project links (with tooltips) + version -->
        <div class="mt-auto flex flex-col items-center gap-1.5 pt-2">
          <div class="flex gap-3 text-muted-foreground">
            <a :href="GITHUB" target="_blank" rel="noopener" class="group relative hover:text-foreground">
              <Github class="size-4" />
              <span class="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">GitHub</span>
            </a>
            <a :href="WEB_APP" target="_blank" rel="noopener" class="group relative hover:text-foreground">
              <Globe class="size-4" />
              <span class="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">cs2d.app</span>
            </a>
          </div>
          <span v-if="version" class="text-[10px] text-muted-foreground">v{{ version }}</span>
        </div>
      </nav>

      <!-- Content -->
      <div class="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
      <!-- ===== LIBRARY TAB ===== -->
      <template v-if="tab === 'library'">
        <!-- Filters + import -->
        <div class="flex items-center gap-1.5">
          <input
            v-model="search"
            type="text"
            :placeholder="t('library.search')"
            class="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          <Select
            v-if="availableSources.length > 1"
            v-model="sourceFilter"
            :options="sourceOptions"
            :all-label="t('library.allSources')"
          />
          <Select
            v-if="availableMaps.length > 1"
            v-model="mapFilter"
            :options="mapOptions"
            :all-label="t('library.allMaps')"
          />
          <div class="group relative shrink-0">
            <button
              class="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              :disabled="importing"
              @click="triggerImport"
            >
              <Loader2 v-if="importing" class="size-3.5 animate-spin" />
              <Upload v-else class="size-3.5" />
            </button>
            <span class="pointer-events-none absolute right-0 top-full z-30 mt-1.5 whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {{ t('library.import') }}
            </span>
          </div>
        </div>

        <!-- In-flight jobs -->
        <div
          v-for="job in state.active"
          :key="'a-' + job.matchId"
          class="relative overflow-hidden rounded-lg border border-border bg-card"
        >
          <div v-if="thumbUrl(job.meta?.map)" class="absolute inset-0 bg-cover bg-center opacity-30" :style="{ backgroundImage: `url(${thumbUrl(job.meta?.map)})` }" />
          <div v-else-if="radarUrl(job.meta?.map)" class="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-20" :style="{ backgroundImage: `url(${radarUrl(job.meta?.map)})` }" />
          <div class="absolute inset-0 bg-gradient-to-b from-card/40 to-card/85" />
          <div class="relative p-2.5">
            <button class="absolute right-1.5 top-1.5 z-10 rounded text-muted-foreground hover:text-foreground" :title="t('hero.cancel')" @click="onCancel(job.matchId)">
              <X class="size-3.5" />
            </button>
            <div class="truncate pr-5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {{ topLine([job.meta?.competition, job.meta?.region, job.meta?.map && prettyMap(job.meta.map)]) || job.label }}
            </div>
            <div v-if="job.meta?.teamA || job.meta?.teamB" class="my-1 flex items-center justify-center gap-2.5 text-sm">
              <span class="flex-1 truncate text-right">{{ job.meta?.teamA }}</span>
              <span class="font-bold">{{ job.meta?.scoreA ?? '–' }}<span class="text-muted-foreground"> : </span>{{ job.meta?.scoreB ?? '–' }}</span>
              <span class="flex-1 truncate">{{ job.meta?.teamB }}</span>
            </div>
            <div class="mb-1.5 text-xs" :class="job.error ? 'text-destructive' : 'text-foreground/80'">{{ jobStatus(job) }}</div>
            <Progress :model-value="jobProgress(job)" />
          </div>
        </div>

        <!-- Stored demos (left-click watches, right-click / ⋮ opens the menu) -->
        <div
          v-for="row in visibleStored"
          :key="row.matchId"
          class="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card"
          :title="t('hero.watch')"
          @click="onWatch(row.matchId)"
          @contextmenu="openMenu($event, row)"
        >
          <div v-if="thumbUrl(row.map)" class="absolute inset-0 bg-cover bg-center opacity-45 transition-opacity group-hover:opacity-60" :style="{ backgroundImage: `url(${thumbUrl(row.map)})` }" />
          <div v-else-if="radarUrl(row.map)" class="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-25" :style="{ backgroundImage: `url(${radarUrl(row.map)})` }" />
          <div class="absolute inset-0 bg-gradient-to-b from-card/50 to-card/90" />
          <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            <Play class="size-6 fill-primary text-primary" />
          </div>
          <!-- Delete confirmation -->
          <div
            v-if="confirmId === row.matchId"
            class="absolute inset-0 z-30 flex cursor-default flex-col items-center justify-center gap-2 bg-background/95 p-2.5"
            @click.stop
          >
            <span class="text-center text-xs font-medium">{{ t('library.deleteConfirm') }}</span>
            <div class="flex gap-1.5">
              <Button variant="secondary" size="sm" @click.stop="confirmId = null">{{ t('hero.cancel') }}</Button>
              <Button variant="destructive" size="sm" @click.stop="onDelete(row.matchId)">{{ t('library.remove') }}</Button>
            </div>
          </div>

          <div class="relative p-2.5">
            <button
              class="absolute right-1.5 top-1.5 z-20 rounded text-muted-foreground hover:text-foreground"
              :title="t('library.more')"
              @click.stop="openMenu($event, row)"
            >
              <MoreVertical class="size-4" />
            </button>
            <div class="flex items-center gap-1.5 pr-5">
              <!-- Source icon (replaces the region, which is noise) -->
              <svg
                v-if="row.source === 'faceit'"
                viewBox="0 0 24 24"
                class="size-3.5 shrink-0"
                fill="#ff5500"
                :title="sourceLabel(row.source)"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M23.999 2.705a.167.167 0 00-.312-.1 1141.27 1141.27 0 00-6.053 9.375H.218c-.221 0-.301.282-.11.352 7.227 2.73 17.667 6.836 23.5 9.134.15.06.39-.08.39-.18z" />
              </svg>
              <HardDrive v-else-if="row.source" class="size-3 shrink-0 text-muted-foreground" />
              <span class="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {{ topLine([row.competition, prettyMap(row.map)]) || row.label }}
              </span>
            </div>
            <div v-if="row.teamA || row.teamB" class="my-1 flex items-center justify-center gap-2.5 text-sm">
              <span class="flex-1 truncate text-right">{{ row.teamA }}</span>
              <span class="font-bold">{{ row.scoreCt }}<span class="text-muted-foreground"> : </span>{{ row.scoreT }}</span>
              <span class="flex-1 truncate">{{ row.teamB }}</span>
            </div>
            <div v-else-if="row.scoreCt || row.scoreT" class="my-1 text-center text-sm font-bold">
              {{ row.scoreCt }}<span class="text-muted-foreground"> : </span>{{ row.scoreT }}
            </div>
            <div class="flex justify-between text-xs text-muted-foreground">
              <span class="inline-flex items-center gap-1"><Check class="size-3 text-emerald-500" /> {{ t('library.ready') }}</span>
              <span>{{ fmtMB(row.sizeBytes) }}</span>
            </div>
          </div>
        </div>

        <!-- Reveal the next page of stored demos -->
        <button
          v-if="hasMore"
          class="mt-0.5 rounded-md border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="visibleCount += PAGE"
        >
          {{ t('library.loadMore', { n: filteredStored.length - visibleCount }) }}
        </button>

        <div v-if="!state.active.length && !state.stored.length" class="px-1 py-6 text-center text-sm text-muted-foreground">
          {{ t('library.empty') }}
        </div>
        <div v-else-if="!filteredStored.length && state.stored.length" class="px-1 py-6 text-center text-sm text-muted-foreground">
          {{ t('library.noResults') }}
        </div>
      </template>

      <!-- ===== SETTINGS TAB ===== -->
      <template v-else>
        <div class="px-1 text-xs font-medium text-muted-foreground">{{ t('settings.language') }}</div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="l in LOCALES"
            :key="l.code"
            class="truncate rounded-md border px-2 py-1.5 text-xs transition-colors"
            :class="locale === l.code ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'"
            @click="chooseLocale(l.code)"
          >
            {{ l.label }}
          </button>
        </div>

        <a :href="WEB_APP" target="_blank" rel="noopener" class="mt-1">
          <Button variant="outline" class="w-full">
            <Download class="size-4" /> {{ t('settings.openApp') }}
          </Button>
        </a>
        <div class="px-1 pt-1 text-center text-[11px] text-muted-foreground">{{ t('settings.about') }}</div>
      </template>
      </div>
    </div>
  </div>
  </Transition>

  <!-- Hidden picker for importing an exported .cs2dv -->
  <input ref="importInput" type="file" accept=".cs2dv" class="hidden" @change="onImportFile" />

  <!-- Right-click / ⋮ context menu for a library item -->
  <div v-if="menu" class="fixed inset-0 z-[1000000]" @click="closeMenu" @contextmenu.prevent="closeMenu">
    <div
      class="absolute min-w-[168px] origin-top-left rounded-md border border-border bg-background p-1 text-sm text-foreground shadow-xl"
      :style="menuStyle"
      @click.stop
    >
      <button class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent" @click="onWatch(menu.row.matchId); closeMenu()">
        <Play class="size-4" /> {{ t('hero.watch') }}
      </button>
      <button class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent" @click="onExport(menu.row.matchId); closeMenu()">
        <Download class="size-4" /> {{ t('library.export') }}
      </button>
      <a
        v-if="menu.row.roomUrl"
        :href="menu.row.roomUrl"
        target="_blank"
        rel="noopener"
        class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent"
        @click="closeMenu"
      >
        <ExternalLink class="size-4" /> {{ t('library.openRoom') }}
      </a>
      <div class="my-1 h-px bg-border" />
      <button class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10" @click="confirmId = menu.row.matchId; tab = 'library'; closeMenu()">
        <Trash2 class="size-4" /> {{ t('library.remove') }}
      </button>
    </div>
  </div>
</template>

<style>
/* Minimize/restore: collapse into / grow out of the top-right corner (where the
   minimize button and the bubble sit), so the panel expands leftward. */
.pop-enter-active,
.pop-leave-active {
  transition: transform 0.17s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.17s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.1);
}
</style>
