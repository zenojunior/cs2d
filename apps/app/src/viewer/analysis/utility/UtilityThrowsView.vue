<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  GrenadeEvent,
  GrenadeKind,
  GrenadePath,
  PlayerMeta,
  Replay,
  Round,
  Side,
} from '@/viewer/domain/schema'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { KIND_ORDER, grenadeIconStyle as iconStyle } from '@/viewer/domain/grenades'
import ViewerMap from '@/viewer/player/ViewerMap.vue'
import ReplayClipPopover from '@/viewer/player/ReplayClipPopover.vue'
import UiSelect from '@/ui/UiSelect.vue'
import { useI18n } from '@/app/i18n'

// `t` is the template loop variable; i18n is aliased as `tr`.
const { t: tr } = useI18n()

/**
 * Grenades throws page: lists every grenade throw of the match, filterable by
 * type, side and player. Hovering a throw previews its full arc on the radar to
 * the right; clicking it asks the parent to open the 2D replay at the throw
 * instant. Reuses the data the parser already emits (`Round.grenadePaths`).
 */
const props = defineProps<{
  replay: Replay
  playersById: Map<string, PlayerMeta>
}>()

const emit = defineEmits<{
  /** Seek request: round (index) and instant (seconds into the round) of the throw. */
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const calibration = computed(
  () => MAP_CALIBRATION[props.replay.map] ?? MAP_CALIBRATION.de_dust2,
)

// Two-floor maps (e.g. Nuke): a selector swaps the background radar and the
// aggregate throws drawn on it. The list itself spans both floors (each row is
// tagged with its floor); hovering a throw temporarily flips the radar to that
// throw's floor so its arc always lands on the right one. `activeLevel` is the
// manual selection; `displayLevel` is what the map actually shows right now.
const mapLevels = computed(() => calibration.value.levels ?? null)
const activeLevel = ref(0)
watch(mapLevels, () => (activeLevel.value = 0))

/** Arc previewed on the radar (null = nothing highlighted), plus its floor, set
 *  together on hover. Declared here so the floor logic below can read them. */
const previewPath = ref<GrenadePath | null>(null)
const previewFloor = ref<number | null>(null)

/** Floor currently shown on the map: the hovered throw's floor while previewing
 *  (so its path renders on the correct radar), otherwise the manual selection. */
const displayLevel = computed(() =>
  previewPath.value && previewFloor.value != null ? previewFloor.value : activeLevel.value,
)
const displayRadar = computed(
  () => mapLevels.value?.[displayLevel.value]?.radar ?? calibration.value.radar,
)
const displayRange = computed(() => {
  const lvl = mapLevels.value?.[displayLevel.value]
  return lvl ? { minZ: lvl.minZ, maxZ: lvl.maxZ } : null
})

/** Floor index whose Z band contains `z`, or null (single-level map / no z). */
function floorOfZ(z: number | null | undefined): number | null {
  const levels = mapLevels.value
  if (!levels || z == null) return null
  const i = levels.findIndex((l) => z >= l.minZ && z < l.maxZ)
  return i >= 0 ? i : null
}

/**
 * Floor a throw belongs to. The flight points carry no Z, so we read the height
 * from the throw's detonation event (which does), matched within the round by
 * grenade kind and nearest impact position. This works on every replay since
 * detonation events have always carried Z.
 */
function classifyFloor(path: GrenadePath, detonations: GrenadeEvent[]): number | null {
  if (!mapLevels.value) return null
  const last = path.points[path.points.length - 1]
  if (!last) return null
  let best: GrenadeEvent | null = null
  let bestDist = Infinity
  for (const e of detonations) {
    if (e.kind !== path.kind) continue
    const d = Math.hypot(e.x - last.x, e.y - last.y)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  return best ? floorOfZ(best.z) : null
}

/** Floor name for a throw's tag in the list (empty when single-level/unknown). */
function floorLabel(floor: number | null): string {
  return floor == null ? '' : (mapLevels.value?.[floor]?.name ?? '')
}

/** Translated grenade type label. */
function kindLabel(k: GrenadeKind): string {
  return tr(`grenadeKind.${k}`)
}

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
  /** Map floor of the impact (multi-level maps); null = single-level/unknown. */
  floor: number | null
  /** Original arc, to preview on the map on hover. */
  path: GrenadePath
}

/** Flattens every throw of the match, in chronological round/time order. */
const allThrows = computed<Throw[]>(() => {
  const out: Throw[] = []
  props.replay.rounds.forEach((round, roundIndex) => {
    const detonations = round.events.filter(
      (e): e is GrenadeEvent => e.type === 'grenade',
    )
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
        floor: classifyFloor(path, detonations),
        path,
      })
    }
  })
  return out
})

// --- Filters ---
const kindFilter = ref<GrenadeKind | 'all'>('all')
const sideFilter = ref<Side | 'all'>('all')
const playerFilter = ref<string>('all')

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

/** Options for the player select ("all" + every thrower). */
const playerOptions = computed(() => [
  { value: 'all', label: tr('grenades.allPlayers') },
  ...throwers.value.map((p) => ({ value: p.steamId, label: p.name })),
])

const filtered = computed(() =>
  allThrows.value.filter((t) => {
    if (kindFilter.value !== 'all' && t.kind !== kindFilter.value) return false
    if (sideFilter.value !== 'all' && t.side !== sideFilter.value) return false
    if (playerFilter.value !== 'all' && t.throwerSteamId !== playerFilter.value) return false
    return true
  }),
)

/** Arcs drawn together on the map (the non-hover overview). On multi-floor maps
 *  this is limited to the active floor so the upper/lower arcs don't pile up on
 *  the wrong radar; the per-throw hover preview handles cross-floor throws. */
const filteredPaths = computed(() => {
  const throws = mapLevels.value
    ? filtered.value.filter((t) => t.floor === null || t.floor === activeLevel.value)
    : filtered.value
  return throws.map((t) => t.path)
})

/** Count per type (respecting the other filters), for the chips. */
const countsByKind = computed(() => {
  const c: Record<string, number> = { all: 0 }
  for (const t of allThrows.value) {
    if (sideFilter.value !== 'all' && t.side !== sideFilter.value) continue
    if (playerFilter.value !== 'all' && t.throwerSteamId !== playerFilter.value) continue
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

// Clip window around a throw: a touch before it and a few seconds after, to see
// the grenade fly and land/detonate.
const CLIP_LEAD = 2
const CLIP_TAIL = 6

// Clicking a throw opens a looping mini-clip of it; "watch in match" inside still
// seeks the 2D replay. The popover pins to the throw's impact spot on the map.
const selectedThrow = ref<Throw | null>(null)
const mapRef = ref<InstanceType<typeof ViewerMap> | null>(null)
function onPick(t: Throw) {
  selectedThrow.value = t
  // Show the clicked throw's floor while its clip is open (multi-level maps).
  if (mapLevels.value && t.floor != null) activeLevel.value = t.floor
}

/** Virtual anchor spanning the whole throw arc on the map (viewport coords),
 *  read live so it tracks zoom/pan. Using the arc's bounding box (not a single
 *  point) lets floating-ui place the card beside the arc instead of over it. */
const throwReference = computed(() => {
  const pts = selectedThrow.value?.path.points ?? null
  return {
    getBoundingClientRect: () => {
      const map = mapRef.value
      const empty = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
      if (!pts?.length || !map) return empty
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of pts) {
        const c = map.worldToClient(p.x, p.y)
        if (!c) continue
        minX = Math.min(minX, c.x)
        maxX = Math.max(maxX, c.x)
        minY = Math.min(minY, c.y)
        maxY = Math.max(maxY, c.y)
      }
      if (!Number.isFinite(minX)) return empty
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY,
      }
    },
  }
})

/** Floor radar + Z range for the selected throw's clip (multi-level maps). */
const selectedThrowFloor = computed(() => {
  const s = selectedThrow.value
  const lvl = s && s.floor != null ? mapLevels.value?.[s.floor] : null
  return lvl
    ? { radar: lvl.radar ?? calibration.value.radar, range: { minZ: lvl.minZ, maxZ: lvl.maxZ } }
    : null
})

/** Preview a throw's arc and flip the map to its floor. */
function onHover(t: Throw) {
  previewPath.value = t.path
  previewFloor.value = t.floor
}
function onLeave() {
  previewPath.value = null
  previewFloor.value = null
}
</script>

<template>
  <div class="flex h-full w-full flex-col sm:flex-row">
    <!-- Filtros + lista: full width on top on mobile (capped height, the list
         scrolls), fixed side column from sm up. -->
    <aside class="flex max-h-[45vh] w-full shrink-0 flex-col border-b border-ink-800 bg-ink-900/40 sm:max-h-none sm:w-72 sm:border-b-0 sm:border-r">
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
            <span class="h-3.5 w-3.5" :style="iconStyle(k)" />
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

          <UiSelect
            v-model="playerFilter"
            :options="playerOptions"
            :placeholder="tr('grenades.allPlayers')"
            class="min-w-0 flex-1"
          />
        </div>
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
            @mouseenter="onHover(t)"
            @mouseleave="onLeave()"
          >
            <span
              class="h-4 w-4 shrink-0"
              :style="iconStyle(t.kind)"
              :title="kindLabel(t.kind)"
            />
            <span class="w-12 shrink-0 text-xs text-ink-400">{{ kindLabel(t.kind) }}</span>
            <span
              class="min-w-0 flex-1 truncate text-xs"
              :style="t.side ? { color: SIDE_COLOR[t.side] } : { color: 'var(--color-ink-200)' }"
            >
              {{ t.throwerName || tr('grenades.unknown') }}
            </span>
            <span
              v-if="mapLevels && t.floor != null"
              class="shrink-0 rounded bg-ink-800 px-1 text-[10px] uppercase text-ink-400"
              :title="floorLabel(t.floor)"
              >{{ floorLabel(t.floor).slice(0, 3) }}</span
            >
            <span class="shrink-0 font-mono text-[11px] text-ink-500"
              >R{{ t.roundNumber }} · {{ fmtTime(t.t) }}</span
            >
          </button>
        </li>
      </ul>
    </aside>

    <!-- Radar: prévia do arco da granada em foco -->
    <div class="relative min-h-0 min-w-0 flex-1">
      <ViewerMap
        ref="mapRef"
        :players="[]"
        :current-t="0"
        :round="null"
        :calibration="calibration"
        :players-by-id="playersById"
        :bomb-blink="false"
        :radar-src="displayRadar"
        :level-range="displayRange"
        :preview-paths="filteredPaths"
        :preview-path="previewPath ?? selectedThrow?.path ?? null"
      />

      <!-- Floor selector (multi-level maps only, e.g. Nuke): over the radar,
           bottom-centered like the 2D replay. Swaps the background radar and the
           shown throws. -->
      <div
        v-if="mapLevels"
        class="absolute inset-x-0 bottom-3 flex justify-center"
      >
        <div
          class="flex w-fit items-center gap-0.5 rounded-md border border-ink-700 bg-ink-900/80 p-0.5 backdrop-blur"
        >
          <button
            v-for="(lvl, i) in mapLevels"
            :key="i"
            type="button"
            class="cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors"
            :class="displayLevel === i ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'"
            @click="activeLevel = i"
          >
            {{ lvl.name }}
          </button>
        </div>
      </div>

      <!-- Hidden on multi-level maps, where the bottom-centered floor selector
           would otherwise overlap it. -->
      <p
        v-if="!previewPath && !mapLevels"
        class="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-ink-500"
      >
        {{ tr('grenades.hint') }}
      </p>
    </div>

    <!-- Clip of the clicked throw, pinned to its row (to the side, over the map). -->
    <ReplayClipPopover
      v-if="selectedThrow"
      :reference="throwReference"
      :replay="replay"
      :round="selectedThrow.roundIndex"
      :jump-t="selectedThrow.t"
      :from="selectedThrow.t - CLIP_LEAD"
      :to="selectedThrow.t + CLIP_TAIL"
      :follow-path="selectedThrow.path.points"
      :observed-steam-id="selectedThrow.throwerSteamId"
      :radar-src="selectedThrowFloor?.radar"
      :level-range="selectedThrowFloor?.range ?? null"
      track-anchor
      @jump="(p) => emit('jump', p)"
      @close="selectedThrow = null"
    >
      <template #header>
        <span class="h-4 w-4 shrink-0" :style="iconStyle(selectedThrow.kind)" />
        <span
          class="truncate font-medium"
          :style="selectedThrow.side ? { color: SIDE_COLOR[selectedThrow.side] } : undefined"
        >
          {{ selectedThrow.throwerName || tr('grenades.unknown') }}
        </span>
        <span class="shrink-0 text-ink-400">{{ kindLabel(selectedThrow.kind) }}</span>
      </template>
    </ReplayClipPopover>
  </div>
</template>
