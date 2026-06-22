<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

// Top-bar entry point for the Chrome extension: a button next to GitHub that
// opens a focused dialog pitching the extension (download Faceit demos straight
// from the browser) with the install buttons below. Self-contained: trigger +
// dialog live here so the shell only renders <ExtensionDialog />.
const { t } = useI18n()

const STORE_URL =
  'https://chromewebstore.google.com/detail/cs-demo-analyzer/hnogplpdlhcjflpnlllcakoddmfnchin'

// Short selling points, in order. Each maps to a `{Title, Body}` pair in i18n.
const FEATURES: { key: string; icon: string }[] = [
  { key: 'featureDownload', icon: 'download' },
  { key: 'featureLocal', icon: 'lock' },
  { key: 'featureLibrary', icon: 'library' },
]
</script>

<template>
  <DialogRoot>
    <DialogTrigger
      :aria-label="t('shell.extension')"
      class="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs font-medium text-ink-200 transition-colors hover:bg-ink-800"
    >
      <UiIcon name="download" class="h-3.5 w-3.5 text-surge-400" />
      <span class="hidden sm:inline">{{ t('shell.extension') }}</span>
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl shadow-black/60 focus:outline-none"
      >
        <!-- Header -->
        <div class="flex items-start gap-3">
          <div
            class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surge-500/15 text-surge-400"
          >
            <UiIcon name="download" class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-base font-semibold text-ink-50">
              {{ t('extension.title') }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm leading-relaxed text-ink-300">
              {{ t('extension.tagline') }}
            </DialogDescription>
          </div>
        </div>

        <!-- Selling points -->
        <ul class="mt-5 flex flex-col gap-3">
          <li v-for="feature in FEATURES" :key="feature.key" class="flex gap-3">
            <UiIcon :name="feature.icon" class="mt-0.5 h-4 w-4 shrink-0 text-surge-400" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink-100">
                {{ t(`extension.${feature.key}Title`) }}
              </p>
              <p class="mt-0.5 text-xs leading-relaxed text-ink-400">
                {{ t(`extension.${feature.key}Body`) }}
              </p>
            </div>
          </li>
        </ul>

        <!-- Install buttons (Chrome only for now) -->
        <div class="mt-6 flex flex-col gap-2">
          <a
            :href="STORE_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center gap-2 rounded-md bg-surge-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-surge-400"
          >
            <UiIcon name="download" class="h-4 w-4" />
            {{ t('extension.installChrome') }}
          </a>
          <p class="text-center text-xs text-ink-500">{{ t('extension.free') }}</p>
        </div>

        <DialogClose
          :aria-label="t('extension.close')"
          class="absolute right-4 top-4 grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          <UiIcon name="x" class="h-4 w-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
