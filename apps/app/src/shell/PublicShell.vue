<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFullscreen } from '@vueuse/core'
import { Flag } from '@blade-flags/vue'
import { circleFlags } from '@blade-flags/core/flags/circle'
import UiIcon from '@/ui/UiIcon.vue'
import AppSidebar from '@/shell/AppSidebar.vue'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from '@/ui/menubar'
import { appFullscreenKey } from '@/shell/appFullscreen'
import { useSidebar } from '@/shell/useSidebar'
import { useI18n, type LocaleCode } from '@/i18n'

// App chrome: a compact collapsible sidebar for the primary nav (Upload / Major /
// Library) plus a thin top bar with a desktop-app-style Menubar (Info, Language).
// The whole frame hides in fullscreen so the player can fill the screen.
const { t, locale, setLocale, LOCALES } = useI18n()

const GITHUB_URL = 'https://github.com/zenojunior/cs-demo-analyzer'

const current = computed(() => LOCALES.find((l) => l.code === locale.value) ?? LOCALES[0])

// Primary-sidebar collapse, driven from the start of the top bar.
const { collapsed, toggle: toggleSidebar } = useSidebar()

const route = useRoute()
const router = useRouter()

// A demo is being viewed when the analyzer route carries an id (history demo) or a
// `replay` query (external Major replay). In that case we drop the sidebar and swap
// the toggle for a Back button, so the focused viewing layout is clearly distinct.
const inDemo = computed(
  () => route.name === 'demoviewer' && Boolean(route.params.id || route.query.replay),
)

// Leaving a demo always lands on a non-demo hub: the Major bracket for external
// replays, the Library for everything else.
function exitDemo() {
  router.push(route.query.replay ? '/cologne-major-2026' : '/library')
}

// Fullscreen the whole shell (so the top bar can hide and the player fills the
// screen). Shared down to the viewer, which renders the toggle button.
const shellRoot = ref<HTMLElement | null>(null)
const { isFullscreen, toggle } = useFullscreen(shellRoot)
provide(appFullscreenKey, { isFullscreen, toggle })
</script>

<template>
  <div ref="shellRoot" class="flex h-dvh overflow-hidden bg-ink-950">
    <AppSidebar v-show="!isFullscreen && !inDemo" />

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        v-show="!isFullscreen"
        class="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-ink-800/80 bg-ink-950/80 px-4 backdrop-blur-md sm:px-6"
      >
        <!-- Start: a Back button while viewing a demo, the sidebar toggle otherwise -->
        <button
          v-if="inDemo"
          type="button"
          class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-ink-200 transition-colors hover:bg-ink-800"
          @click="exitDemo"
        >
          <UiIcon name="arrow-left" class="h-4 w-4 text-ink-400" />
          {{ t('shell.back') }}
        </button>
        <button
          v-else
          type="button"
          :aria-label="t('shell.toggleMenu')"
          :title="t('shell.toggleMenu')"
          class="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          @click="toggleSidebar"
        >
          <UiIcon :name="collapsed ? 'panel-left-open' : 'panel-left-close'" class="h-4 w-4" />
        </button>

        <!-- End: GitHub link + language menu -->
        <div class="ml-auto flex items-center gap-2">
          <a
            :href="GITHUB_URL"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="t('shell.github')"
            class="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs font-medium text-ink-200 transition-colors hover:bg-ink-800"
          >
            <UiIcon name="github" class="h-3.5 w-3.5 text-ink-400" />
            <span class="hidden sm:inline">GitHub</span>
          </a>

          <Menubar>
            <MenubarMenu>
              <MenubarTrigger :aria-label="t('shell.language')">
                <Flag :code="current.flag" :flags="circleFlags" class="h-4 w-4 shrink-0" />
                <span class="font-mono text-[11px] font-medium">{{ current.label }}</span>
                <UiIcon name="chevron-down" class="h-3 w-3 text-ink-500" />
              </MenubarTrigger>
              <MenubarContent align="end" class="max-h-72 w-44 overflow-y-auto">
                <MenubarItem
                  v-for="l in LOCALES"
                  :key="l.code"
                  :class="locale === l.code ? 'bg-ink-800 text-ink-50' : ''"
                  @select="setLocale(l.code as LocaleCode)"
                >
                  <Flag :code="l.flag" :flags="circleFlags" class="h-4 w-4 shrink-0" />
                  <span class="flex-1 truncate">{{ l.name }}</span>
                  <UiIcon
                    v-if="locale === l.code"
                    name="check"
                    class="h-3.5 w-3.5 shrink-0 text-surge-400"
                  />
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </div>

        <!-- Center: tool actions (via Teleport, e.g. the viewer tabs) -->
        <div
          id="publicbar-center"
          class="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center"
        />
      </header>

      <main class="min-h-0 flex-1 overflow-hidden">
        <RouterView />
      </main>
    </div>
  </div>
</template>
