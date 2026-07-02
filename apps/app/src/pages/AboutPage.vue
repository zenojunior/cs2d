<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'

// Static "about" page: motivation, author, tech stack and credits. Everything
// translatable lives in i18n; the tech/credits lists are data (names + links).
const { t } = useI18n()

const GITHUB_URL = 'https://github.com/zenojunior/cs2d'
const AUTHOR_NAME = 'Zeno Junior'
const AUTHOR_URL = 'https://zenojunior.com'

// The author paragraph carries the name as a `{name}` placeholder so it can be
// rendered as a link; split it into the text before and after the name.
const authorParts = computed(() => {
  // Use a NUL sentinel so vue-i18n's own interpolation doesn't drop the
  // placeholder before we split the body around the author name.
  const [before, after] = t('about.authorBody', { name: '\0' }).split('\0')
  return { before, after: after ?? '' }
})

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
  { name: 'source2-demo', url: 'https://github.com/Rupas1k/source2-demo', descKey: 'source2' },
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

// Projects that inspired this one (not dependencies, just admiration).
const RELATED: { name: string; url: string; desc: string }[] = [
  {
    name: 'CS Demo Manager',
    url: 'https://github.com/akiver/cs-demo-manager',
    desc: 'A full-featured desktop app to manage and analyze Counter-Strike demos, by akiver.',
  },
  {
    name: 'csgo-2d-demo-viewer',
    url: 'https://github.com/sparkoo/csgo-2d-demo-viewer',
    desc: 'A browser-based 2D Counter-Strike demo viewer, by sparkoo.',
  },
]
</script>

<template>
  <div class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-2xl px-5 py-10 sm:px-6 sm:py-14">
      <h1 class="text-2xl font-semibold text-ink-50 sm:text-3xl">{{ t('about.title') }}</h1>
      <p class="mt-3 text-sm leading-relaxed text-ink-300 sm:text-base">{{ t('about.tagline') }}</p>

      <!-- Motivation -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.motivationTitle') }}
        </h2>
        <ul class="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink-300">
          <li class="flex gap-2">
            <span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-surge-400" />
            <span>{{ t('about.motivationPoint1') }}</span>
          </li>
          <li class="flex gap-2">
            <span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-surge-400" />
            <span>{{ t('about.motivationPoint2') }}</span>
          </li>
          <li class="flex gap-2">
            <span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-surge-400" />
            <span>{{ t('about.motivationPoint3') }}</span>
          </li>
        </ul>
      </section>

      <!-- Author -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.authorTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">
          {{ authorParts.before
          }}<a
            :href="AUTHOR_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-ink-100 underline decoration-ink-600 underline-offset-2 transition-colors hover:text-ink-50 hover:decoration-ink-400"
            >{{ AUTHOR_NAME }}</a
          >{{ authorParts.after }}
        </p>
        <a
          :href="GITHUB_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-4 inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-xs text-ink-200 transition-colors hover:bg-ink-800"
        >
          <UiIcon name="github" class="h-3.5 w-3.5 text-ink-400" />
          <span class="font-medium">zenojunior/cs2d</span>
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

      <!-- Credits -->
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
              class="inline-flex items-center gap-1.5 text-sm font-medium text-ink-200 transition-colors hover:text-ink-50"
            >
              <UiIcon name="github" class="h-3.5 w-3.5 text-ink-400" />
              {{ credit.name }}
            </a>
            <p class="mt-1 text-xs leading-relaxed text-ink-400">{{ CREDIT_DESC[credit.descKey] }}</p>
          </li>
        </ul>
      </section>

      <!-- Related projects -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('about.relatedTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">{{ t('about.relatedBody') }}</p>
        <ul class="mt-4 flex flex-col gap-3">
          <li
            v-for="project in RELATED"
            :key="project.name"
            class="rounded-lg border border-ink-800 bg-ink-900/40 p-3"
          >
            <a
              :href="project.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-sm font-medium text-ink-200 transition-colors hover:text-ink-50"
            >
              <UiIcon name="github" class="h-3.5 w-3.5 text-ink-400" />
              {{ project.name }}
            </a>
            <p class="mt-1 text-xs leading-relaxed text-ink-400">{{ project.desc }}</p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
