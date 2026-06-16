<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GrenadeKind, GrenadePath, PlayerMeta, Replay, Round, Side } from '@/viewer/schema'
import { MAP_CALIBRATION } from '@/viewer/calibration'
import { SIDE_COLOR } from '@/viewer/colors'
import ViewerMap from '@/viewer/ViewerMap.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

// `t` is the template loop variable; i18n is aliased as `tr`.
const { t: tr } = useI18n()

/**
 * Grenades page: lists every grenade throw of the match, filterable by type,
 * side, player and round. Hovering a throw previews its full arc on the radar
 * to the right; clicking it asks the parent to open the 2D replay at the throw
 * instant. Reuses the data the parser already emits (`Round.grenadePaths`).
 */
const props = defineProps<{
  replay: Replay
  playersById: Map<string, PlayerMeta>
  /** Currently focused round (0-based index), for the "this round only" filter. */
  currentRoundIndex: number
}>()

const emit = defineEmits<{
  /** Seek request: round (index) and instant (seconds into the round) of the throw. */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const calibration = computed(
  () => MAP_CALIBRATION[props.replay.map] ?? MAP_CALIBRATION.de_dust2,
)

/** Color per grenade type (data color, applied via :style). The label comes
 *  from i18n (`grenadeKind.<type>`). */
const KIND_COLOR: Record<GrenadeKind, string> = {
  smoke: 'rgba(206, 211, 222, 0.95)',
  fire: 'rgba(255, 120, 30, 0.95)',
  he: 'rgba(255, 90, 60, 0.95)',
  flash: 'rgba(255, 238, 170, 0.95)',
  decoy: 'rgba(140, 150, 165, 0.95)',
}
/** Translated grenade type label. */
function kindLabel(k: GrenadeKind): string {
  return tr(`grenadeKind.${k}`)
}
const KIND_ORDER: GrenadeKind[] = ['smoke', 'flash', 'he', 'fire', 'decoy']

/** A player's side in that round, read from the first frame that contains them. */
function sideInRound(round: Round, steamId: string | null): Side | null {
  if (!steamId) return null
  for (const f of round.frames) {
    const p = f.players.find((pl) => pl.steamId === steamId)
    if (p) return p.side
  }
  return null
}

interface Throw {
  roundIndex: number
  roundNumber: number
  kind: GrenadeKind
  throwerSteamId: string | null
  throwerName: string
  side: Side | null
  /** Throw instant (seconds since the round start). */
  t: number
  /** Original arc, to preview on the map on hover. */
  path: GrenadePath
}

/** Flattens every throw of the match, in chronological round/time order. */
const allThrows = computed<Throw[]>(() => {
  const out: Throw[] = []
  props.replay.rounds.forEach((round, roundIndex) => {
    for (const path of round.grenadePaths) {
      if (!path.points.length) continue
      const id = path.throwerSteamId
      out.push({
        roundIndex,
        roundNumber: round.number,
        kind: path.kind,
        throwerSteamId: id,
        throwerName: (id && props.playersById.get(id)?.name) || '',
        side: sideInRound(round, id),
        t: path.points[0].t,
        path,
      })
    }
  })
  return out
})

// --- Filters ---
const kindFilter = ref<GrenadeKind | 'all'>('all')
const sideFilter = ref<Side | 'all'>('all')
const playerFilter = ref<string | 'all'>('all')
const currentRoundOnly = ref(false)

/** Arc previewed on the radar (null = nothing highlighted). */
const previewPath = ref<GrenadePath | null>(null)

/** Players who threw something, for the selector (name + steamId). */
const throwers = computed(() => {
  const seen = new Map<string, string>()
  for (const t of allThrows.value) {
    if (t.throwerSteamId && !seen.has(t.throwerSteamId)) {
      seen.set(t.throwerSteamId, t.throwerName)
    }
  }
  return [...seen.entries()].map(([steamId, name]) => ({ steamId, name }))
})

const filtered = computed(() =>
  allThrows.value.filter((t) => {
    if (kindFilter.value !== 'all' && t.kind !== kindFilter.value) return false
    if (sideFilter.value !== 'all' && t.side !== sideFilter.value) return false
    if (playerFilter.value !== 'all' && t.throwerSteamId !== playerFilter.value) return false
    if (currentRoundOnly.value && t.roundIndex !== props.currentRoundIndex) return false
    return true
  }),
)

/** Arcs of every grenade passing the filters, drawn together on the map. */
const filteredPaths = computed(() => filtered.value.map((t) => t.path))

/** Count per type (respecting the other filters), for the chips. */
const countsByKind = computed(() => {
  const c: Record<string, number> = { all: 0 }
  for (const t of allThrows.value) {
    if (sideFilter.value !== 'all' && t.side !== sideFilter.value) continue
    if (playerFilter.value !== 'all' && t.throwerSteamId !== playerFilter.value) continue
    if (currentRoundOnly.value && t.roundIndex !== props.currentRoundIndex) continue
    c.all++
    c[t.kind] = (c[t.kind] ?? 0) + 1
  }
  return c
})

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function onPick(t: Throw) {
  emit('jump', { roundIndex: t.roundIndex, t: t.t })
}
</script>

<template>
  <div class="flex h-full w-full">
    <!-- Filtros + lista -->
    <aside class="flex w-72 shrink-0 flex-col border-r border-ink-800 bg-ink-900/40">
      <!-- Cabeçalho -->
      <header class="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
        <UiIcon name="search" class="h-4 w-4 text-surge-400" />
        <h3 class="font-display text-sm text-ink-50">{{ tr('grenades.title') }}</h3>
        <span class="ml-auto font-mono text-xs text-ink-400">{{ filtered.length }}</span>
      </header>

      <!-- Filtros -->
      <div class="space-y-2 border-b border-ink-800 p-3">
        <!-- Tipo -->
        <div class="flex flex-wrap gap-1">
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-0.5 text-xs transition-colors"
            :class="kindFilter === 'all' ? 'bg-surge-500/20 text-surge-200' : 'text-ink-300 hover:bg-ink-800'"
            @click="kindFilter = 'all'"
          >
            {{ tr('grenades.all') }}
            <span class="ml-1 font-mono text-ink-500">{{ countsByKind.all }}</span>
          </button>
          <button
            v-for="k in KIND_ORDER"
            :key="k"
            type="button"
            class="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors"
            :class="kindFilter === k ? 'bg-surge-500/20 text-surge-200' : 'text-ink-300 hover:bg-ink-800'"
            @click="kindFilter = k"
          >
            <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: KIND_COLOR[k] }" />
            {{ kindLabel(k) }}
            <span class="font-mono text-ink-500">{{ countsByKind[k] ?? 0 }}</span>
          </button>
        </div>

        <!-- Lado + jogador -->
        <div class="flex items-center gap-2">
          <div class="flex overflow-hidden rounded border border-ink-700">
            <button
              v-for="s in (['all', 'CT', 'T'] as const)"
              :key="s"
              type="button"
              class="cursor-pointer px-2 py-0.5 text-xs transition-colors"
              :class="sideFilter === s ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:bg-ink-800'"
              :style="sideFilter === s && s !== 'all' ? { color: SIDE_COLOR[s] } : undefined"
              @click="sideFilter = s"
            >
              {{ s === 'all' ? tr('grenades.both') : s }}
            </button>
          </div>

          <select
            v-model="playerFilter"
            class="min-w-0 flex-1 cursor-pointer rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-200"
          >
            <option value="all">{{ tr('grenades.allPlayers') }}</option>
            <option v-for="p in throwers" :key="p.steamId" :value="p.steamId">{{ p.name }}</option>
          </select>
        </div>

        <label class="flex cursor-pointer items-center gap-2 text-xs text-ink-300">
          <input v-model="currentRoundOnly" type="checkbox" class="cursor-pointer accent-surge-500" />
          {{ tr('grenades.currentRoundOnly') }}
        </label>
      </div>

      <!-- Lista -->
      <ul class="min-h-0 flex-1 overflow-y-auto p-1">
        <li v-if="!filtered.length" class="px-3 py-6 text-center text-xs text-ink-500">
          {{ tr('grenades.empty') }}
        </li>
        <li v-for="(t, i) in filtered" :key="i">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-ink-800"
            @click="onPick(t)"
            @mouseenter="previewPath = t.path"
            @mouseleave="previewPath = null"
          >
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :style="{ backgroundColor: KIND_COLOR[t.kind] }"
              :title="kindLabel(t.kind)"
            />
            <span class="w-12 shrink-0 text-xs text-ink-400">{{ kindLabel(t.kind) }}</span>
            <span
              class="min-w-0 flex-1 truncate text-xs"
              :style="t.side ? { color: SIDE_COLOR[t.side] } : { color: 'var(--color-ink-200)' }"
            >
              {{ t.throwerName || tr('grenades.unknown') }}
            </span>
            <span class="shrink-0 font-mono text-[11px] text-ink-500"
              >R{{ t.roundNumber }} · {{ fmtTime(t.t) }}</span
            >
          </button>
        </li>
      </ul>
    </aside>

    <!-- Radar: prévia do arco da granada em foco -->
    <div class="relative min-w-0 flex-1">
      <ViewerMap
        :players="[]"
        :current-t="0"
        :round="null"
        :calibration="calibration"
        :players-by-id="playersById"
        :bomb-blink="false"
        :preview-paths="filteredPaths"
        :preview-path="previewPath"
      />
      <p
        v-if="!previewPath"
        class="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-ink-500"
      >
        {{ tr('grenades.hint') }}
      </p>
    </div>
  </div>
</template>
