<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'
import { prettyMap } from '@/viewer/domain/demoMeta'
import { TEAMS, matchById, type MajorMapReplay, type MajorMatch, type MajorTeam } from './playoffs'

const props = defineProps<{ match: MajorMatch }>()
const emit = defineEmits<{ play: [map: MajorMapReplay] }>()

const { t } = useI18n()

// Resolves a slot to either a real team or a "winner of QFx" placeholder so a
// TBD semifinal/final still reads clearly before its feeder match is decided.
type Slot = { team: MajorTeam | null; placeholder: string; score: number | null; isWinner: boolean }

function buildSlot(teamId: string | null, source: string | undefined, score: number | null, isWinner: boolean): Slot {
  const team = teamId ? (TEAMS[teamId] ?? null) : null
  const feeder = source ? matchById(source) : undefined
  const placeholder = feeder ? t('major.winnerOf', { label: feeder.label }) : t('major.tbd')
  return { team, placeholder, score, isWinner }
}

const decided = computed(() => props.match.scoreA != null && props.match.scoreB != null)

const slotA = computed(() =>
  buildSlot(
    props.match.teamA,
    props.match.sourceA,
    props.match.scoreA,
    decided.value && (props.match.scoreA ?? 0) > (props.match.scoreB ?? 0),
  ),
)
const slotB = computed(() =>
  buildSlot(
    props.match.teamB,
    props.match.sourceB,
    props.match.scoreB,
    decided.value && (props.match.scoreB ?? 0) > (props.match.scoreA ?? 0),
  ),
)

// A best-of series has 2-3 maps once played; a popover lets the user pick which
// one to watch. The button is disabled until the demos have been parsed.
const hasMaps = computed(() => props.match.maps.length > 0)

const open = ref(false)
const menu = ref<HTMLElement | null>(null)
onClickOutside(menu, () => (open.value = false))

function play(map: MajorMapReplay) {
  if (!map.replay) return
  emit('play', map)
  open.value = false
}
</script>

<template>
  <div class="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
    <!-- Header: round label, format and date -->
    <div class="mb-2 flex items-center justify-between text-[11px] text-ink-500">
      <span class="font-mono font-medium uppercase tracking-wide text-ink-400">{{ match.label }}</span>
      <span class="flex items-center gap-2">
        <span class="rounded bg-ink-800/80 px-1.5 py-0.5 font-mono text-ink-300">{{
          t('major.bestOf', { n: match.bestOf })
        }}</span>
        <span class="flex items-center gap-1">
          <UiIcon name="calendar" class="h-3 w-3" />
          {{ match.date }}
        </span>
      </span>
    </div>

    <!-- Team rows -->
    <div class="flex flex-col gap-1">
      <div
        v-for="(slot, i) in [slotA, slotB]"
        :key="i"
        class="flex items-center gap-2 rounded-md px-1.5 py-1.5"
        :class="slot.isWinner ? 'bg-surge-500/10' : ''"
      >
        <template v-if="slot.team">
          <img
            :src="slot.team.logo"
            :alt="slot.team.short"
            class="h-6 w-6 shrink-0 object-contain"
            loading="lazy"
          />
          <span class="w-3 shrink-0 text-center font-mono text-[10px] tabular-nums text-ink-600">{{
            slot.team.seed
          }}</span>
          <span
            class="flex-1 truncate text-sm font-medium"
            :class="slot.isWinner ? 'text-ink-50' : 'text-ink-200'"
            >{{ slot.team.name }}</span
          >
        </template>
        <template v-else>
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ink-800 text-[10px] font-bold text-ink-500"
            >?</span
          >
          <span class="w-3 shrink-0" />
          <span class="flex-1 truncate text-sm font-medium italic text-ink-500">{{
            slot.placeholder
          }}</span>
        </template>
        <span
          class="w-5 text-right font-mono text-sm tabular-nums"
          :class="slot.isWinner ? 'font-bold text-surge-400' : 'text-ink-400'"
          >{{ slot.score ?? '–' }}</span
        >
      </div>
    </div>

    <!-- Maps / watch -->
    <div ref="menu" class="relative mt-2 border-t border-ink-800/70 pt-2">
      <button
        type="button"
        :disabled="!hasMaps"
        :aria-expanded="open"
        class="flex w-full items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs font-medium text-ink-200 transition-colors enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
        @click="open = !open"
      >
        <UiIcon :name="hasMaps ? 'play' : 'clock'" class="h-3.5 w-3.5 text-ink-400" />
        {{ hasMaps ? t('major.watch') : t('major.notPlayed') }}
        <UiIcon v-if="hasMaps" name="chevron-down" class="h-3 w-3 text-ink-500" />
      </button>

      <!-- Map picker popover: square radar cards -->
      <div
        v-if="open && hasMaps"
        class="absolute inset-x-0 top-full z-20 mt-1.5 rounded-lg border border-ink-700 bg-ink-900/95 p-2 shadow-2xl backdrop-blur"
      >
        <p class="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
          {{ t('major.pickMap') }}
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="m in match.maps"
            :key="m.map"
            type="button"
            :disabled="!m.replay"
            class="group relative aspect-square overflow-hidden rounded-md border border-ink-700 transition-colors enabled:hover:border-surge-500 disabled:cursor-not-allowed"
            @click="play(m)"
          >
            <img
              :src="`/maps/${m.map}_radar.png`"
              :alt="prettyMap(m.map)"
              class="absolute inset-0 h-full w-full object-cover"
              :class="m.replay ? '' : 'opacity-30 grayscale'"
              loading="lazy"
            />
            <!-- Map name on a bottom gradient -->
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent px-2 pb-1.5 pt-5">
              <span class="font-mono text-xs font-medium text-ink-50">{{ prettyMap(m.map) }}</span>
            </div>
            <!-- Play affordance (or "soon" when the replay isn't ready) -->
            <div
              v-if="m.replay"
              class="absolute inset-0 grid place-items-center transition-colors group-hover:bg-ink-950/40"
            >
              <span
                class="grid h-8 w-8 place-items-center rounded-full bg-surge-500/90 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              >
                <UiIcon name="play" class="h-4 w-4 text-ink-950" />
              </span>
            </div>
            <div v-else class="absolute inset-0 grid place-items-center">
              <span class="flex items-center gap-1 rounded bg-ink-950/70 px-1.5 py-0.5 text-[10px] text-ink-300">
                <UiIcon name="clock" class="h-3 w-3" />
                {{ t('major.soon') }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
