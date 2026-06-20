<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from '@/ui/UiIcon.vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { useRecentDemos, type RecentDemo } from '@/viewer/ingest/useRecentDemos'
import { prettyMap, mapImage, fmtSize, fmtDate, fmtDateFull } from '@/viewer/domain/demoMeta'
import { useI18n } from '@/i18n'

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

// Footprint we actually keep (sum of the stored parsed archives).
const totalBytes = computed(() => recent.list.value.reduce((s, d) => s + (d.fileSize || 0), 0))

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

function openRecent(demo: RecentDemo) {
  if (loadingId.value) return
  router.push(`/${demo.id}`)
}

function copyName(demo: RecentDemo) {
  void navigator.clipboard?.writeText(demo.fileName).catch(() => {})
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
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div class="flex items-center gap-2">
        <UiIcon name="library" class="h-5 w-5 text-ink-400" />
        <h1 class="text-2xl font-semibold text-ink-50">{{ t('library.title') }}</h1>
      </div>

      <!-- Storage summary: what we keep locally + real device usage when known -->
      <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-400">
        <span>{{ t('library.count', { n: recent.list.value.length }) }}</span>
        <span class="text-ink-700">·</span>
        <span>{{ fmtSize(totalBytes) }} {{ t('library.stored') }}</span>
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
        <ul class="mt-4 grid gap-2 sm:grid-cols-2">
          <li v-for="demo in filtered" :key="demo.id">
            <ContextMenu>
              <ContextMenuTrigger as-child>
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
                          :title="t('analyzer.menu.withVoice')"
                        >
                          <UiIcon name="mic" class="h-3 w-3" />
                        </span>
                      </p>
                      <p class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-500">
                        <span class="shrink-0">{{ demo.rounds }} {{ t('analyzer.menu.rounds') }}</span>
                        <span class="text-ink-700">·</span>
                        <span class="shrink-0">{{ fmtSize(demo.fileSize) }}</span>
                        <span class="text-ink-700">·</span>
                        <span class="shrink-0">{{ fmtDate(demo.savedAt) }}</span>
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    :aria-label="t('analyzer.menu.remove')"
                    class="shrink-0 cursor-pointer rounded-md p-1.5 text-ink-500 opacity-0 transition-colors hover:bg-ink-800 hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100"
                    @click="removeMaybeResetFilter(demo.id)"
                  >
                    <UiIcon name="x" class="h-4 w-4" />
                  </button>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent class="w-64">
                <div class="px-2 py-1.5">
                  <p class="break-all text-sm font-medium text-ink-100" :title="demo.fileName">
                    {{ demo.fileName }}
                  </p>
                  <p class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
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

                <ContextMenuSeparator />

                <ContextMenuItem :disabled="Boolean(loadingId)" @select="openRecent(demo)">
                  <UiIcon name="play" class="h-4 w-4 text-ink-400" />
                  {{ t('analyzer.menu.open') }}
                </ContextMenuItem>
                <ContextMenuItem @select="copyName(demo)">
                  <UiIcon name="copy" class="h-4 w-4 text-ink-400" />
                  {{ t('analyzer.menu.copyName') }}
                </ContextMenuItem>

                <ContextMenuSeparator />

                <ContextMenuItem
                  class="text-loss data-[highlighted]:text-loss"
                  @select="removeMaybeResetFilter(demo.id)"
                >
                  <UiIcon name="trash-2" class="h-4 w-4" />
                  {{ t('analyzer.menu.remove') }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </li>
        </ul>

        <p class="mt-4 text-xs text-ink-600">{{ t('analyzer.recentNote') }}</p>
      </template>
    </div>
  </div>
</template>
