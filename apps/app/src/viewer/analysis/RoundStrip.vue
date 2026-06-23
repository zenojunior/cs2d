<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Round, Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { roundDisplayLabels } from '@/viewer/analysis/utilityStats'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

/**
 * Round picker reusing the 2D replay's round bubbles, each colored by its winner
 * side and knife / pistol / side-swap markers, optionally prefixed with an "All"
 * chip. Bind the selected round index (or 'all') with `v-model`. The strip is
 * collapsed by default and revealed when an ancestor `.group` is hovered (so the
 * parent timeline drives it, like the player's controls).
 */
const props = defineProps<{
  rounds: Round[]
  demoTickRate: number
  /** Show an "All rounds" chip before the bubbles. */
  allowAll?: boolean
  /** Omit the knife round bubble (it has no meaningful heatmap data). */
  hideKnife?: boolean
}>()

const model = defineModel<number | 'all'>({ required: true })

/** Label per round (pre-game rounds become "0" and shift the rest), like the player. */
const roundLabels = computed(() => roundDisplayLabels(props.rounds))

/**
 * Round indices where the teams switched sides versus the previous round
 * (halftime / overtime), by comparing each player's side between consecutive
 * rounds. Drives the swap marker drawn between the bubbles.
 */
const sideSwaps = computed<Set<number>>(() => {
  const swaps = new Set<number>()
  const sidesOf = (r: Round) => {
    const m = new Map<string, Side>()
    const target = r.startTick + (r.endTick - r.startTick) / 2
    const f = r.frames.find((f) => f.tick >= target) ?? r.frames[Math.floor(r.frames.length / 2)]
    for (const p of f?.players ?? []) m.set(p.steamId, p.side)
    return m
  }
  let prev: Map<string, Side> | null = null
  props.rounds.forEach((r, i) => {
    const cur = sidesOf(r)
    if (!cur.size) return
    if (prev) {
      let flipped = 0
      let same = 0
      for (const [id, side] of cur) {
        const before = prev.get(id)
        if (before == null) continue
        before === side ? same++ : flipped++
      }
      if (flipped > 0 && flipped >= same) swaps.add(i)
    }
    prev = cur
  })
  return swaps
})

// Anything outside this set is a primary, i.e. the round was a buy not a pistol.
const PISTOL_LOADOUT = new Set<string>([
  'Deagle', 'R8 Revolver', 'Glock-18', 'USP-S', 'P2000', 'Five-SeveN', 'Tec-9',
  'CZ75-Auto', 'P250', 'Dual Berettas',
  'Faca', 'C4', 'HE', 'Flash', 'Smoke', 'Molotov', 'Decoy', 'Zeus x27', '',
])

/** Pistol rounds: a half-start round where everyone is on pistols at the open. */
const pistolRounds = computed<Set<number>>(() => {
  const out = new Set<number>()
  const halfStarts = new Set<number>(sideSwaps.value)
  const firstReal = roundLabels.value.findIndex((l) => l !== '0')
  if (firstReal >= 0) halfStarts.add(firstReal)
  const tr = props.demoTickRate || 64
  for (const i of halfStarts) {
    const r = props.rounds[i]
    if (!r) continue
    const hi = r.startTick + 20 * tr
    let pistolOnly = true
    for (const f of r.frames) {
      if (f.tick < r.startTick || f.tick > hi) continue
      if (f.players.some((p) => !PISTOL_LOADOUT.has(p.weapon))) {
        pistolOnly = false
        break
      }
    }
    if (pistolOnly) out.add(i)
  }
  return out
})

function roundStyle(r: Round, active: boolean): Record<string, string> | undefined {
  if (!r.winner) return undefined
  const c = SIDE_COLOR[r.winner]
  return active ? { backgroundColor: c, color: '#fff' } : { backgroundColor: c + '2e', color: c }
}

const track = ref<HTMLElement | null>(null)
function onRoundsWheel(e: WheelEvent) {
  const box = track.value
  if (!box || box.scrollWidth <= box.clientWidth) return
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.preventDefault()
  box.scrollLeft += e.deltaY
}
</script>

<template>
  <!-- Rounds: collapsed by default, revealed when the ancestor `.group` (the
       timeline) is hovered, like the player's controls. -->
  <div
    class="grid grid-rows-[0fr] opacity-0 transition-all duration-200 ease-out group-hover:grid-rows-[1fr] group-hover:opacity-100"
  >
    <div class="overflow-hidden">
      <div
        ref="track"
        class="flex gap-1.5 overflow-x-auto px-0.5 pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        @wheel="onRoundsWheel"
      >
          <!-- All-rounds chip -->
          <button
            v-if="allowAll"
            type="button"
            class="flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-lg px-2 text-[0.65rem] font-mono transition-all duration-150"
            :class="
              model === 'all'
                ? 'scale-105 bg-ink-500 font-semibold text-white shadow-lg shadow-black/40'
                : 'bg-ink-700 text-ink-300 opacity-70 hover:scale-105 hover:opacity-100'
            "
            @click="model = 'all'"
          >
            {{ t('heatmap.all') }}
          </button>

          <template v-for="(r, i) in rounds" :key="r.number">
            <!-- Skip frameless rounds (e.g. Gamers Club's knife "result" round). -->
            <template v-if="r.frames.length > 0 && (!hideKnife || roundLabels[i] !== '0')">
            <!-- Side-swap marker (halftime / overtime). -->
            <div
              v-if="sideSwaps.has(i)"
              v-tooltip="t('viewer.sideSwap')"
              class="flex shrink-0 items-center self-stretch px-0.5 text-ink-500"
            >
              <UiIcon name="swap" class="h-3.5 w-3.5" />
            </div>
            <button
              type="button"
              v-tooltip="
                roundLabels[i] === '0'
                  ? t('viewer.knife')
                  : `${t('viewer.round')} ${roundLabels[i]}${pistolRounds.has(i) ? ` · ${t('viewer.pistol')}` : ''}${r.winner ? ` · ${r.winner}` : ''}`
              "
              class="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[0.65rem] font-mono transition-all duration-150"
              :class="[
                i === model
                  ? 'scale-110 font-semibold shadow-lg shadow-black/40'
                  : 'opacity-70 hover:scale-105 hover:opacity-100',
                !r.winner && (i === model ? 'bg-ink-500 text-white' : 'bg-ink-700 text-ink-300'),
              ]"
              :style="roundStyle(r, i === model)"
              @click="model = i"
            >
              <img
                v-if="roundLabels[i] === '0'"
                src="/weapons/knife.svg"
                :alt="t('viewer.knife')"
                class="w-5 object-contain"
              />
              <img
                v-else-if="pistolRounds.has(i)"
                src="/weapons/p250.svg"
                :alt="t('viewer.pistol')"
                class="w-4 object-contain"
              />
              <template v-else>{{ roundLabels[i] }}</template>
            </button>
            </template>
          </template>
      </div>
    </div>
  </div>
</template>
