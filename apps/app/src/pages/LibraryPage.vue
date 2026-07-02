<script setup lang="ts">
import { computed, nextTick, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from 'reka-ui'
import UiIcon from '@/ui/UiIcon.vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import LibraryPreviewDialog from '@/pages/LibraryPreviewDialog.vue'
import { useRecentDemos, type RecentDemo } from '@/viewer/ingest/useRecentDemos'
import { exportArchive, archiveFileName } from '@/viewer/ingest/demoArchive'
import { prettyMap, mapImage, fmtSize, fmtDate, fmtDateFull } from '@/viewer/domain/demoMeta'
import { useI18n } from '@/app/i18n'

// Library: the local history of analyzed demos, with the total footprint and a
// per-map filter. Everything stays in the browser (see useRecentDemos); the raw
// `.dem` is never kept, only the light parsed `.cs2dv`.
const { t } = useI18n()
const router = useRouter()
const recent = useRecentDemos()
const loadingId = ref<string | null>(null)

// Per-map filter ('all' = no filter). Distinct maps drive the filter chips.
const mapFilter = ref<string>('all')
const maps = computed(() => [...new Set(recent.list.value.map((d) => d.map))])
const filtered = computed(() =>
  mapFilter.value === 'all'
    ? recent.list.value
    : recent.list.value.filter((d) => d.map === mapFilter.value),
)

// Real device storage usage/quota (best-effort; not every browser exposes it).
const storage = ref<{ usage: number; quota: number } | null>(null)
onMounted(async () => {
  try {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate()
      storage.value = { usage: usage ?? 0, quota: quota ?? 0 }
    }
  } catch {
    // Storage estimate unavailable: just hide the device line.
  }
})

// Clicking a card opens a preview dialog (a frozen round snapshot); navigation
// to the player happens from there (or from the context menu's "open").
const previewDemo = ref<RecentDemo | null>(null)
function openPreview(demo: RecentDemo) {
  previewDemo.value = demo
}

function openRecent(demo: RecentDemo) {
  if (loadingId.value) return
  router.push(`/${demo.id}`)
}

function copyName(demo: RecentDemo) {
  void navigator.clipboard?.writeText(demo.fileName).catch(() => {})
}

// Export the stored demo as a `.cs2dv` archive (replay + voice + comments), the
// same file the player exports. Loads the heavy payload on demand since the list
// only holds light metadata.
const exportingId = ref<string | null>(null)
async function exportDemo(demo: RecentDemo) {
  if (exportingId.value) return
  exportingId.value = demo.id
  try {
    const [payload, comments] = await Promise.all([
      recent.load(demo.id),
      recent.loadComments(demo.id),
    ])
    if (!payload) return
    const blob = await exportArchive({
      fileName: demo.fileName,
      replay: payload.replay,
      voice: payload.voice,
      comments,
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = archiveFileName(titleOf(demo))
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Demo export failed:', err)
  } finally {
    exportingId.value = null
  }
}

// Display title: the user-set name, or the original file name as the default.
function titleOf(demo: RecentDemo): string {
  return demo.title?.trim() || demo.fileName
}

// Inline title editing. Only one card edits at a time, so a single input ref and
// draft string are enough.
const editingId = ref<string | null>(null)
const editDraft = ref('')
// Function ref (not a string ref): a string `ref` inside v-for collects into an
// array, so we'd lose the single mounted input. Only one card edits at a time.
const editInput = ref<HTMLInputElement | null>(null)
function setEditInput(el: Element | ComponentPublicInstance | null) {
  editInput.value = (el as HTMLInputElement | null) ?? null
}

async function startEdit(demo: RecentDemo) {
  editingId.value = demo.id
  editDraft.value = titleOf(demo)
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

function commitEdit(demo: RecentDemo) {
  // Guard against the blur that fires right after Enter/Escape already closed it.
  if (editingId.value !== demo.id) return
  recent.rename(demo.id, editDraft.value)
  editingId.value = null
}

function cancelEdit() {
  // Drop the edit; the input's trailing blur then no-ops (id no longer matches).
  editingId.value = null
}

// Deleting a demo is irreversible (it drops the parsed payload), so it goes
// through a confirmation dialog. `confirmId` drives the dialog (open state +
// shown name); `pendingId` mirrors it as the deletion target. They are separate
// because confirming both fires our handler and closes the dialog on the same
// click: the close resets `confirmId`, so reading the target from it would race.
const confirmId = ref<string | null>(null)
let pendingId: string | null = null
const confirmDemo = computed(() => recent.list.value.find((d) => d.id === confirmId.value) ?? null)

function askRemove(demo: RecentDemo) {
  pendingId = demo.id
  confirmId.value = demo.id
}

function confirmRemove() {
  if (pendingId) removeMaybeResetFilter(pendingId)
  pendingId = null
  confirmId.value = null
}

function removeMaybeResetFilter(id: string) {
  recent.remove(id)
  // If the filtered map is now empty, drop back to "all" so the list isn't blank.
  if (mapFilter.value !== 'all' && !recent.list.value.some((d) => d.map === mapFilter.value)) {
    mapFilter.value = 'all'
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div class="flex items-center gap-2">
        <UiIcon name="library" class="h-5 w-5 text-ink-400" />
        <h1 class="text-2xl font-semibold text-ink-50">{{ t('library.title') }}</h1>
      </div>

      <!-- Demo count + real device storage usage when the browser exposes it -->
      <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-400">
        <span>{{ t('library.count', { n: recent.list.value.length }) }}</span>
        <span v-if="storage && storage.quota" class="text-ink-700">·</span>
        <span v-if="storage && storage.quota">
          {{ t('library.device', { used: fmtSize(storage.usage), quota: fmtSize(storage.quota) }) }}
        </span>
      </p>

      <!-- Empty state -->
      <div
        v-if="!recent.list.value.length"
        class="mt-10 flex flex-col items-center gap-3 rounded-xl border border-dashed border-ink-800 py-16 text-center"
      >
        <UiIcon name="library" class="h-8 w-8 text-ink-600" />
        <p class="text-sm text-ink-400">{{ t('library.empty') }}</p>
        <RouterLink
          to="/"
          class="mt-1 inline-flex items-center gap-1.5 rounded-md bg-surge-500 px-3 py-1.5 text-sm font-medium text-ink-950 transition-colors hover:bg-surge-400"
        >
          <UiIcon name="upload" class="h-4 w-4" />
          {{ t('library.uploadCta') }}
        </RouterLink>
      </div>

      <template v-else>
        <!-- Per-map filter chips -->
        <div v-if="maps.length > 1" class="mt-5 flex flex-wrap gap-1.5">
          <button
            type="button"
            class="cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            :class="
              mapFilter === 'all'
                ? 'border-surge-500 bg-surge-500/10 text-surge-300'
                : 'border-ink-700 text-ink-300 hover:bg-ink-800'
            "
            @click="mapFilter = 'all'"
          >
            {{ t('library.allMaps') }}
          </button>
          <button
            v-for="m in maps"
            :key="m"
            type="button"
            class="cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            :class="
              mapFilter === m
                ? 'border-surge-500 bg-surge-500/10 text-surge-300'
                : 'border-ink-700 text-ink-300 hover:bg-ink-800'
            "
            @click="mapFilter = m"
          >
            {{ prettyMap(m) }}
          </button>
        </div>

        <!-- Demo cards -->
        <ul class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <li v-for="demo in filtered" :key="demo.id">
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <div
                  class="group relative flex flex-col overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40 transition-colors hover:border-ink-600 hover:bg-ink-900/70"
                >
                  <!-- Map banner: radar image with the map name + score overlaid -->
                  <button
                    type="button"
                    class="relative block aspect-[16/9] w-full cursor-pointer overflow-hidden bg-ink-800 text-ink-300"
                    :disabled="Boolean(loadingId)"
                    @click="openPreview(demo)"
                  >
                      <img
                        v-if="mapImage(demo.map)"
                        :src="mapImage(demo.map)!"
                        :alt="prettyMap(demo.map)"
                        class="absolute inset-0 h-full w-full object-cover"
                      />
                      <UiIcon
                        v-else
                        name="map"
                        class="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2"
                      />
                      <!-- Readability scrim behind the overlaid text -->
                      <div
                        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
                      />
                      <div
                        class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5 text-left"
                      >
                        <span class="flex min-w-0 items-baseline gap-2">
                          <span class="truncate text-sm font-semibold text-white drop-shadow">
                            {{ prettyMap(demo.map) }}
                          </span>
                          <span class="shrink-0 font-mono text-xs">
                            <span class="text-pulse-300">{{ demo.scoreCt }}</span>
                            <span class="text-white/50"> : </span>
                            <span class="text-warn">{{ demo.scoreT }}</span>
                          </span>
                        </span>
                        <span
                          v-if="demo.hasVoice"
                          class="shrink-0 text-white/70"
                          :title="t('analyzer.menu.withVoice')"
                        >
                          <UiIcon name="mic" class="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div
                        v-if="loadingId === demo.id"
                        class="absolute inset-0 grid place-items-center bg-ink-950/60"
                      >
                        <UiIcon name="loader" class="h-5 w-5 animate-spin text-surge-400" />
                      </div>
                  </button>

                  <!-- Body: editable title + metadata -->
                  <div class="flex flex-col gap-1 p-3">
                    <div class="flex items-center gap-1">
                      <input
                        v-if="editingId === demo.id"
                        :ref="setEditInput"
                        v-model="editDraft"
                        type="text"
                        class="min-w-0 flex-1 rounded border border-surge-500/60 bg-ink-950 px-1.5 py-0.5 text-sm text-ink-50 outline-none focus:border-surge-400"
                        @keydown.enter.prevent="commitEdit(demo)"
                        @keydown.esc.prevent="cancelEdit"
                        @blur="commitEdit(demo)"
                      />
                      <template v-else>
                        <button
                          type="button"
                          class="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium text-ink-100 hover:text-ink-50"
                          :title="titleOf(demo)"
                          @click="openPreview(demo)"
                        >
                          {{ titleOf(demo) }}
                        </button>
                        <button
                          type="button"
                          :aria-label="t('analyzer.menu.rename')"
                          class="shrink-0 cursor-pointer rounded p-1 text-ink-500 opacity-0 transition-colors hover:bg-ink-800 hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100"
                          @click="startEdit(demo)"
                        >
                          <UiIcon name="pencil" class="h-3.5 w-3.5" />
                        </button>
                      </template>
                    </div>
                    <p class="flex items-center gap-1.5 truncate text-xs text-ink-500">
                      <span class="shrink-0">{{ demo.rounds }} {{ t('analyzer.menu.rounds') }}</span>
                      <span class="text-ink-700">·</span>
                      <span class="shrink-0">{{ fmtSize(demo.fileSize) }}</span>
                      <span class="text-ink-700">·</span>
                      <span class="shrink-0">{{ fmtDate(demo.savedAt) }}</span>
                    </p>
                  </div>

                  <!-- Delete: top-right over the banner -->
                  <button
                    type="button"
                    :aria-label="t('analyzer.menu.remove')"
                    class="absolute right-2 top-2 cursor-pointer rounded-md bg-ink-950/70 p-1.5 text-ink-200 opacity-0 backdrop-blur transition hover:bg-loss hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                    @click="askRemove(demo)"
                  >
                    <UiIcon name="x" class="h-4 w-4" />
                  </button>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent class="w-64">
                <ContextMenuItem :disabled="Boolean(loadingId)" @select="openRecent(demo)">
                  <UiIcon name="play" class="h-4 w-4 text-ink-400" />
                  {{ t('analyzer.menu.open') }}
                </ContextMenuItem>
                <ContextMenuItem @select="startEdit(demo)">
                  <UiIcon name="pencil" class="h-4 w-4 text-ink-400" />
                  {{ t('analyzer.menu.rename') }}
                </ContextMenuItem>
                <ContextMenuItem @select="copyName(demo)">
                  <UiIcon name="copy" class="h-4 w-4 text-ink-400" />
                  {{ t('analyzer.menu.copyName') }}
                </ContextMenuItem>
                <ContextMenuItem :disabled="Boolean(exportingId)" @select="exportDemo(demo)">
                  <UiIcon name="download" class="h-4 w-4 text-ink-400" />
                  {{ t('analyzer.menu.export') }}
                  <span class="text-ink-500">({{ fmtSize(demo.fileSize) }})</span>
                </ContextMenuItem>

                <ContextMenuSeparator />

                <ContextMenuItem
                  class="text-loss data-[highlighted]:text-loss"
                  @select="askRemove(demo)"
                >
                  <UiIcon name="trash-2" class="h-4 w-4" />
                  {{ t('analyzer.menu.remove') }}
                </ContextMenuItem>

                <ContextMenuSeparator />

                <div class="px-2 py-1.5">
                  <p class="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
                    <span>{{ prettyMap(demo.map) }}</span>
                    <span class="text-ink-700">·</span>
                    <span>{{ demo.scoreCt }} : {{ demo.scoreT }}</span>
                    <span class="text-ink-700">·</span>
                    <span>{{ demo.rounds }} {{ t('analyzer.menu.rounds') }}</span>
                    <span class="text-ink-700">·</span>
                    <span>{{ fmtSize(demo.fileSize) }}</span>
                  </p>
                  <p class="mt-0.5 text-xs text-ink-500">{{ fmtDateFull(demo.savedAt) }}</p>
                  <p
                    v-if="demo.hasVoice"
                    class="mt-0.5 flex items-center gap-1 text-xs text-ink-500"
                  >
                    <UiIcon name="mic" class="h-3 w-3" />
                    {{ t('analyzer.menu.withVoice') }}
                  </p>
                </div>
              </ContextMenuContent>
            </ContextMenu>
          </li>
        </ul>

        <p class="mt-4 text-xs text-ink-600">{{ t('analyzer.recentNote') }}</p>
      </template>
    </div>

    <!-- Card click opens a frozen round-snapshot preview -->
    <LibraryPreviewDialog
      :demo="previewDemo"
      @close="previewDemo = null"
      @watch="openRecent"
    />

    <!-- Confirmation before deleting a demo (irreversible) -->
    <AlertDialogRoot
      :open="confirmId !== null"
      @update:open="(open) => !open && (confirmId = null)"
    >
      <AlertDialogPortal>
        <AlertDialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <AlertDialogContent
          class="pointer-events-auto fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl shadow-black/60 focus:outline-none"
        >
          <AlertDialogTitle class="text-base font-semibold text-ink-50">
            {{ t('library.removeTitle') }}
          </AlertDialogTitle>
          <AlertDialogDescription class="mt-2 text-sm leading-relaxed text-ink-300">
            <i18n-t keypath="library.removeBody" tag="span">
              <template #name>
                <strong class="font-semibold text-ink-100">{{
                  confirmDemo ? titleOf(confirmDemo) : ''
                }}</strong>
              </template>
            </i18n-t>
          </AlertDialogDescription>
          <div class="mt-6 flex justify-end gap-2">
            <AlertDialogCancel
              class="cursor-pointer rounded-md border border-ink-700 px-4 py-2 text-sm font-medium text-ink-200 transition-colors hover:bg-ink-800"
            >
              {{ t('library.removeCancel') }}
            </AlertDialogCancel>
            <AlertDialogAction
              class="cursor-pointer rounded-md bg-loss px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110"
              @click="confirmRemove"
            >
              {{ t('library.removeConfirm') }}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>
