<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'
import TournamentMatchCard from './TournamentMatchCard.vue'
import {
  bracketColumns,
  findTournament,
  type TournamentMapReplay,
  type TournamentMatch,
} from './registry'

// Static playoffs bracket for one showcase tournament, resolved from the route
// (/tournaments/:year/:slug). Each series exposes a "watch" button that streams
// the pre-parsed replay (committed to the repo) on demand.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const tournament = computed(() =>
  findTournament(String(route.params.year), String(route.params.slug)),
)

// An unknown year/slug falls back to the listing rather than a blank bracket.
watchEffect(() => {
  if (!tournament.value) router.replace('/tournaments')
})

const quarterfinals = computed(() =>
  tournament.value ? bracketColumns(tournament.value).quarterfinals : [],
)
const semifinals = computed(() =>
  tournament.value ? bracketColumns(tournament.value).semifinals : [],
)
const final = computed(() =>
  tournament.value ? bracketColumns(tournament.value).final : undefined,
)

// Opens the viewer on the chosen map by handing its replay URL to the analyzer,
// which fetches and hydrates it without re-parsing. `from` lets the Back button
// return to this bracket rather than the listing.
function onPlay(match: TournamentMatch, map: TournamentMapReplay) {
  const tourney = tournament.value
  if (!tourney || !map.replay) return
  const a = match.teamA ? tourney.teams[match.teamA]?.name : ''
  const b = match.teamB ? tourney.teams[match.teamB]?.name : ''
  const matchup = a && b ? `${a} vs ${b}` : tourney.name
  const mapName = map.map.replace(/^de_/, '')
  // Major GOTV demos carry no comms, so the buy period has nothing to watch:
  // open straight past the freeze (`skipFreeze`) and start playing (`autoplay`).
  // The freeze stays scrubbable to the left.
  router.push({
    path: '/',
    query: {
      replay: map.replay,
      name: `${matchup} · ${mapName}`,
      skipFreeze: '1',
      autoplay: '1',
      from: `/tournaments/${tourney.year}/${tourney.slug}`,
    },
  })
}
</script>

<template>
  <div v-if="tournament" class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <!-- Heading -->
      <RouterLink
        to="/tournaments"
        class="inline-flex items-center gap-1 text-xs font-medium text-ink-400 transition-colors hover:text-ink-200"
      >
        <UiIcon name="arrow-left" class="h-3.5 w-3.5" />
        {{ t('shell.tournaments') }}
      </RouterLink>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold text-ink-50 sm:text-3xl">{{ tournament.name }}</h1>
        <span
          v-if="tournament.tier === 'major'"
          class="rounded bg-surge-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-surge-400"
          >{{ t('tournaments.majorBadge') }}</span
        >
      </div>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{{ t('tournaments.intro') }}</p>

      <!-- Bracket -->
      <div class="mt-10 flex flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-4">
        <!-- Quarterfinals -->
        <section class="flex flex-1 flex-col">
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {{ t('tournaments.round.quarterfinal') }}
          </h2>
          <div class="flex flex-1 flex-col justify-around gap-3">
            <TournamentMatchCard
              v-for="m in quarterfinals"
              :key="m.id"
              :tournament="tournament"
              :match="m"
              @play="(map) => onPlay(m, map)"
            />
          </div>
        </section>

        <!-- Semifinals -->
        <section class="flex flex-1 flex-col">
          <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {{ t('tournaments.round.semifinal') }}
          </h2>
          <div class="flex flex-1 flex-col justify-around gap-3">
            <TournamentMatchCard
              v-for="m in semifinals"
              :key="m.id"
              :tournament="tournament"
              :match="m"
              @play="(map) => onPlay(m, map)"
            />
          </div>
        </section>

        <!-- Grand Final -->
        <section v-if="final" class="flex flex-1 flex-col">
          <h2 class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-surge-400">
            <UiIcon name="trophy" class="h-3.5 w-3.5" />
            {{ t('tournaments.round.final') }}
          </h2>
          <div class="flex flex-1 flex-col justify-center">
            <TournamentMatchCard
              :tournament="tournament"
              :match="final"
              @play="(map) => onPlay(final!, map)"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
