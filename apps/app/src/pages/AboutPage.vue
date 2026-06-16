<script setup lang="ts">
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

// Static "about" page: motivation, author, tech stack and credits. Everything
// translatable lives in i18n; the tech/credits lists are data (names + links).
const { t } = useI18n()

const GITHUB_URL = 'https://github.com/zenojunior/cs-demo-analyzer'

// Main libraries the app is built on (label + where to learn more).
const TECH: { name: string; url: string }[] = [
  { name: 'Vue 3', url: 'https://vuejs.org' },
  { name: 'Vite', url: 'https://vite.dev' },
  { name: 'Tailwind CSS', url: 'https://tailwindcss.com' },
  { name: 'Reka UI', url: 'https://reka-ui.com' },
  { name: 'VueUse', url: 'https://vueuse.org' },
  { name: 'Rust + WebAssembly', url: 'https://www.rust-lang.org' },
]

// Open-source work this project depends on or is inspired by (proper credit).
const CREDITS: { name: string; url: string; descKey: string }[] = [
  { name: 'source2-demo', url: 'https://crates.io/crates/source2-demo', descKey: 'source2' },
  { name: 'cs2-map-icons', url: 'https://github.com/MurkyYT/cs2-map-icons', descKey: 'mapIcons' },
  { name: '@bokuweb/zstd-wasm', url: 'https://github.com/bokuweb/zstd-wasm', descKey: 'zstd' },
  { name: 'fflate', url: 'https://github.com/101arrowz/fflate', descKey: 'fflate' },
]

// Short, untranslated descriptions for each credit (names/tech terms stay as-is).
const CREDIT_DESC: Record<string, string> = {
  source2: 'Streaming, event-driven Source 2 demo parser (Rust) that powers the .dem parser.',
  mapIcons: 'Radar overview images for the CS2 maps, by MurkyYT.',
  zstd: 'WebAssembly Zstandard decoder for .zst demos.',
  fflate: 'Fast, tiny gzip/zip inflate used to read compressed demos.',
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-2xl px-5 py-10 sm:px-6 sm:py-14">
      <RouterLink
        to="/"
        class="mb-8 inline-flex items-center gap-1.5 text-xs text-ink-400 transition-colors hover:text-ink-200"
      >
        <UiIcon name="arrow-left" class="h-3.5 w-3.5" />
        <span class="font-medium">{{ t('about.back') }}</span>
      </RouterLink>

      <h1 class="text-2xl font-semibold text-ink-50 sm:text-3xl">{{ t('about.title') }}</h1>
      <p class="mt-3 text-sm leading-relaxed text-ink-300 sm:text-base">{{ t('about.tagline') }}</p>

      <!-- Motivation -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.motivationTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">{{ t('about.motivationBody') }}</p>
      </section>

      <!-- Author -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.authorTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">{{ t('about.authorBody') }}</p>
        <a
          :href="GITHUB_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-4 inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-xs text-ink-200 transition-colors hover:bg-ink-800"
        >
          <UiIcon name="github" class="h-3.5 w-3.5 text-ink-400" />
          <span class="font-medium">zenojunior/cs-demo-analyzer</span>
        </a>
      </section>

      <!-- Technologies -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.techTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">{{ t('about.techBody') }}</p>
        <ul class="mt-4 flex flex-wrap gap-2">
          <li v-for="tech in TECH" :key="tech.name">
            <a
              :href="tech.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center rounded-md border border-ink-700 bg-ink-900/60 px-2.5 py-1 text-xs font-medium text-ink-200 transition-colors hover:bg-ink-800"
            >
              {{ tech.name }}
            </a>
          </li>
        </ul>
      </section>

      <!-- Credits & related projects -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.creditsTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">{{ t('about.creditsBody') }}</p>
        <ul class="mt-4 flex flex-col gap-3">
          <li
            v-for="credit in CREDITS"
            :key="credit.name"
            class="rounded-lg border border-ink-800 bg-ink-900/40 p-3"
          >
            <a
              :href="credit.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-sm font-medium text-pulse-400 transition-colors hover:text-pulse-300"
            >
              {{ credit.name }}
              <UiIcon name="arrow-right" class="h-3 w-3" />
            </a>
            <p class="mt-1 text-xs leading-relaxed text-ink-400">{{ CREDIT_DESC[credit.descKey] }}</p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
