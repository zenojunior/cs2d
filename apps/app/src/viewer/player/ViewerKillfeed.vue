<script setup lang="ts">
import { computed } from 'vue'
import type { GameEvent, PlayerMeta, Round, Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { flashSetupForKill, roundSides } from '@/viewer/domain/rounds'
import KillfeedRow from '@/viewer/player/KillfeedRow.vue'

type Kill = Extract<GameEvent, { type: 'kill' }>

/** A killfeed row with the effective assist resolved: the demo's own assist when
 *  present, otherwise a flash assist derived from the round's blinds. */
interface FeedKill {
  k: Kill
  assisterSteamId: string | null
  assistedFlash: boolean
}

const props = defineProps<{
  round: Round | null
  currentT: number
  playersById: Map<string, PlayerMeta>
  sideById: Map<string, Side>
  max?: number
}>()

// Sides are stable within a round; memoize so the per-frame recompute below is cheap.
const sides = computed(() => (props.round ? roundSides(props.round) : new Map<string, Side>()))

const kills = computed<FeedKill[]>(() => {
  const round = props.round
  if (!round) return []
  const evs = round.events.filter((e): e is Kill => e.type === 'kill' && e.t <= props.currentT)
  return evs.slice(-(props.max ?? 5)).map((k) => {
    // A damage assist (or a flash assist the demo already credited) is authoritative.
    if (k.assisterSteamId)
      return { k, assisterSteamId: k.assisterSteamId, assistedFlash: k.assistedFlash }
    // Otherwise derive a flash assist from the blinds: some community/tournament
    // demos never set `assistedFlash` on player_death. A self-flash (flasher is the
    // killer) is not an assist, so it stays unassisted.
    const setup = flashSetupForKill(round, k, sides.value)
    if (setup && setup.flasher !== k.attackerSteamId)
      return { k, assisterSteamId: setup.flasher, assistedFlash: true }
    return { k, assisterSteamId: null, assistedFlash: false }
  })
})

const nameOf = (id: string | null) => (id ? (props.playersById.get(id)?.name ?? '') : '')
const colorOf = (id: string | null) =>
  id && props.sideById.get(id) ? SIDE_COLOR[props.sideById.get(id)!] : '#8a93a6'
</script>

<template>
  <div class="flex flex-col items-end gap-1">
    <div
      v-for="({ k, assisterSteamId, assistedFlash }, i) in kills"
      :key="k.tick + '-' + i"
      class="rounded-md bg-ink-950/75 px-2 py-1 backdrop-blur"
    >
      <KillfeedRow
        :attacker-name="k.attackerSteamId ? nameOf(k.attackerSteamId) : null"
        :attacker-color="colorOf(k.attackerSteamId)"
        :assister-name="assisterSteamId ? nameOf(assisterSteamId) : null"
        :assister-color="colorOf(assisterSteamId)"
        :assisted-flash="assistedFlash"
        :weapon="k.weapon"
        :headshot="k.headshot"
        :victim-name="nameOf(k.victimSteamId)"
        :victim-color="colorOf(k.victimSteamId)"
      />
    </div>
  </div>
</template>
