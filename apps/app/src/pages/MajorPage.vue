<script setup lang="ts">
import { useRouter } from 'vue-router'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'
import MajorMatchCard from '@/pages/major/MajorMatchCard.vue'
import {
  MAJOR,
  TEAMS,
  QUARTERFINALS,
  SEMIFINALS,
  FINAL,
  type MajorMapReplay,
  type MajorMatch,
} from '@/pages/major/playoffs'

// Static playoffs bracket for the latest CS2 Major. Each series exposes a "watch"
// button that streams the pre-parsed replay (committed to the repo) on demand.
const { t } = useI18n()
const router = useRouter()

// Opens the viewer on the chosen map by handing its replay URL to the analyzer,
// which fetches and hydrates it without re-parsing.
function onPlay(match: MajorMatch, map: MajorMapReplay) {
  if (!map.replay) return
  const a = match.teamA ? TEAMS[match.teamA]?.name : ''
  const b = match.teamB ? TEAMS[match.teamB]?.name : ''
  const matchup = a && b ? `${a} vs ${b}` : MAJOR.name
  const mapName = map.map.replace(/^de_/, '')
  router.push({ path: '/', query: { replay: map.replay, name: `${matchup} · ${mapName}` } })
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <!-- Heading -->
      <div class="flex items-center gap-2 text-surge-400">
        <UiIcon name="trophy" class="h-5 w-5" />
        <span class="text-sm font-semibold uppercase tracking-wide">{{ t('major.kicker') }}</span>
      </div>
      <h1 class="mt-2 text-2xl font-semibold text-ink-50 sm:text-3xl">{{ MAJOR.name }}</h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{{ t('major.intro') }}</p>

      <!-- Bracket -->
      <div class="mt-10 flex flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-4">
        <!-- Quarterfinals -->
        <section class="flex flex-1 flex-col">
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {{ t('major.round.quarterfinal') }}
          </h2>
          <div class="flex flex-1 flex-col justify-around gap-3">
            <MajorMatchCard
              v-for="m in QUARTERFINALS"
              :key="m.id"
              :match="m"
              @play="(map) => onPlay(m, map)"
            />
          </div>
        </section>

        <!-- Semifinals -->
        <section class="flex flex-1 flex-col">
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {{ t('major.round.semifinal') }}
          </h2>
          <div class="flex flex-1 flex-col justify-around gap-3">
            <MajorMatchCard
              v-for="m in SEMIFINALS"
              :key="m.id"
              :match="m"
              @play="(map) => onPlay(m, map)"
            />
          </div>
        </section>

        <!-- Grand Final -->
        <section class="flex flex-1 flex-col">
          <h2 class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-surge-400">
            <UiIcon name="trophy" class="h-3.5 w-3.5" />
            {{ t('major.round.final') }}
          </h2>
          <div class="flex flex-1 flex-col justify-center">
            <MajorMatchCard :match="FINAL" @play="(map) => onPlay(FINAL, map)" />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
