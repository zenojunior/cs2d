<script setup lang="ts">
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'
import { TOURNAMENTS } from './registry'

// Landing page listing the showcase tournaments (most recent first). Each card
// links to its playoffs bracket at /tournaments/:year/:slug.
const { t } = useI18n()
</script>

<template>
  <div class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <!-- Heading -->
      <h1 class="text-2xl font-semibold text-ink-50 sm:text-3xl">{{ t('shell.tournaments') }}</h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{{ t('tournaments.listIntro') }}</p>

      <!-- Tournament cards -->
      <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RouterLink
          v-for="tourney in TOURNAMENTS"
          :key="`${tourney.year}-${tourney.slug}`"
          :to="`/tournaments/${tourney.year}/${tourney.slug}`"
          class="group flex flex-col rounded-xl border border-ink-800 bg-ink-900/40 p-5 transition-colors hover:border-ink-600 hover:bg-ink-900/70"
        >
          <div class="flex items-center justify-between gap-2">
            <span
              v-if="tourney.tier === 'major'"
              class="rounded bg-surge-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surge-400"
              >{{ t('tournaments.majorBadge') }}</span
            >
            <span class="ml-auto font-mono text-xs text-ink-500">{{ tourney.year }}</span>
          </div>

          <h2 class="mt-3 text-lg font-semibold text-ink-50">{{ tourney.name }}</h2>

          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
            <span class="flex items-center gap-1">
              <UiIcon name="calendar" class="h-3 w-3" />
              {{ tourney.dates }}
            </span>
            <span>{{ tourney.city }}</span>
          </div>

          <!-- Champion -->
          <div
            v-if="tourney.champion && tourney.teams[tourney.champion]"
            class="mt-4 flex items-center gap-2 rounded-lg bg-ink-800/50 px-3 py-2"
          >
            <UiIcon name="trophy" class="h-4 w-4 shrink-0 text-surge-400" />
            <span class="text-[11px] font-medium uppercase tracking-wide text-ink-500">{{
              t('tournaments.champion')
            }}</span>
            <img
              :src="tourney.teams[tourney.champion].logo"
              :alt="tourney.teams[tourney.champion].short"
              class="ml-auto h-5 w-5 shrink-0 object-contain"
              loading="lazy"
            />
            <span class="text-sm font-semibold text-ink-100">{{
              tourney.teams[tourney.champion].name
            }}</span>
          </div>

          <span
            class="mt-4 inline-flex items-center gap-1 text-xs font-medium text-ink-300 transition-colors group-hover:text-surge-400"
          >
            {{ t('tournaments.viewBracket') }}
            <UiIcon name="arrow-right" class="h-3.5 w-3.5" />
          </span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
