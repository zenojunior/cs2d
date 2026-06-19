<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { Flag } from '@blade-flags/vue'
import { circleFlags } from '@blade-flags/core/flags/circle'
import Cs2Mark from '@/shell/Cs2Mark.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n, type LocaleCode } from '@/i18n'

// Lean CS Demo Analyzer shell: thin bar with the CS2 mark, a language
// selector (dropdown, scalable to many languages) and full-screen content.
const { t, locale, setLocale, LOCALES } = useI18n()

// Public repository for the project (shown as a GitHub link in the bar).
const GITHUB_URL = 'https://github.com/zenojunior/cs-demo-analyzer'

// Hovering the home button (icon + title) triggers the icon's lift animation.
const brandHover = ref(false)

const langOpen = ref(false)
const langMenu = ref<HTMLElement | null>(null)
onClickOutside(langMenu, () => (langOpen.value = false))

const current = computed(() => LOCALES.find((l) => l.code === locale.value) ?? LOCALES[0])

function choose(code: LocaleCode) {
  setLocale(code)
  langOpen.value = false
}
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-ink-950">
    <header
      class="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-ink-800/80 bg-ink-950/80 px-4 backdrop-blur-md sm:px-6"
    >
      <div class="flex items-center gap-2 sm:gap-4">
        <RouterLink
          to="/"
          :aria-label="t('shell.home')"
          class="flex cursor-pointer items-center gap-2"
          @pointerenter="brandHover = true"
          @pointerleave="brandHover = false"
        >
          <Cs2Mark size="sm" :animate="brandHover" />
          <span class="hidden text-sm font-medium text-ink-300 sm:inline">CS Demo Analyzer</span>
        </RouterLink>

        <RouterLink
          to="/cologne-major-2026"
          :aria-label="t('shell.major')"
          class="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs text-ink-200 transition-colors hover:bg-ink-800"
        >
          <UiIcon name="trophy" class="h-3.5 w-3.5 text-ink-400" />
          <span class="hidden font-medium sm:inline">{{ t('shell.major') }}</span>
        </RouterLink>
      </div>

      <!-- Center: tool actions (via Teleport, e.g. tabs) -->
      <div id="publicbar-center" class="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center" />

      <div class="flex items-center gap-2 text-xs text-ink-400 sm:gap-3">
        <RouterLink
          to="/about"
          :aria-label="t('shell.about')"
          class="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-ink-200 transition-colors hover:bg-ink-800"
        >
          <UiIcon name="sparkles" class="h-3.5 w-3.5 text-ink-400" />
          <span class="hidden font-medium sm:inline">{{ t('shell.about') }}</span>
        </RouterLink>

        <a
          :href="GITHUB_URL"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('shell.github')"
          class="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-ink-200 transition-colors hover:bg-ink-800"
        >
          <UiIcon name="github" class="h-3.5 w-3.5 text-ink-400" />
          <span class="hidden font-medium sm:inline">GitHub</span>
        </a>

        <!-- Language selector: dropdown (scales to many languages) -->
        <div ref="langMenu" class="relative">
          <button
            type="button"
            :aria-label="t('shell.language')"
            :aria-expanded="langOpen"
            class="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-ink-200 transition-colors hover:bg-ink-800"
            @click="langOpen = !langOpen"
          >
            <Flag :code="current.flag" :flags="circleFlags" class="h-4 w-4 shrink-0" />
            <span class="font-mono text-[11px] font-medium">{{ current.label }}</span>
            <UiIcon name="chevron-down" class="h-3 w-3 text-ink-500" />
          </button>

          <div
            v-if="langOpen"
            class="absolute right-0 top-full z-30 mt-1.5 max-h-72 w-44 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900/95 p-1 shadow-2xl backdrop-blur"
          >
            <button
              v-for="l in LOCALES"
              :key="l.code"
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors"
              :class="locale === l.code ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'"
              @click="choose(l.code)"
            >
              <Flag :code="l.flag" :flags="circleFlags" class="h-4 w-4 shrink-0" />
              <span class="flex-1 truncate">{{ l.name }}</span>
              <UiIcon v-if="locale === l.code" name="check" class="h-3.5 w-3.5 shrink-0 text-surge-400" />
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-hidden">
      <RouterView />
    </main>
  </div>
</template>
