<script setup lang="ts">
import { computed } from 'vue'
import type { Round, Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'

/**
 * Match chat in the top corner. Each message appears at its timestamp and stays
 * until the end of the round (switching rounds resets to the new round's chat).
 * The name is colored by the sender's side, when resolved.
 */
const props = defineProps<{
  round: Round | null
  currentT: number
  sideById: Map<string, Side>
}>()

const active = computed(() => {
  const list = props.round?.chat ?? []
  const t = props.currentT
  const out: { key: number; name: string; text: string; teamOnly: boolean; color: string }[] = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (t < m.t) continue // message timestamp not reached yet
    const side = m.steamId ? props.sideById.get(m.steamId) : undefined
    out.push({
      key: i,
      name: m.name,
      text: m.text,
      teamOnly: m.teamOnly,
      color: side ? SIDE_COLOR[side] : '#cbd5e1',
    })
  }
  // Keep only the most recent ones to avoid stacking too many.
  return out.slice(-6)
})
</script>

<template>
  <div class="flex flex-col items-start gap-1">
    <div
      v-for="m in active"
      :key="m.key"
      class="max-w-sm rounded bg-ink-950/70 px-2 py-1 text-xs leading-snug backdrop-blur-sm"
    >
      <span v-if="m.teamOnly" class="mr-1 text-[0.65rem] text-ink-500">(time)</span>
      <span class="font-semibold" :style="{ color: m.color }">{{ m.name }}</span>
      <span class="text-ink-500">: </span>
      <span class="break-words text-ink-100">{{ m.text }}</span>
    </div>
  </div>
</template>
