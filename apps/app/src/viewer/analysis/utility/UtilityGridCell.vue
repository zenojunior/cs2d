<script setup lang="ts">
import { ref } from 'vue'
import {
  PopoverClose,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import type { Replay } from '@/viewer/domain/schema'
import type { CellDetail } from '@/viewer/analysis/utility/utilityStats'
import ReplayClipPopover from '@/viewer/player/ReplayClipPopover.vue'

/**
 * One stat cell of the team grid. When `details` has entries the value becomes a
 * clickable popover trigger listing the underlying plays; otherwise it is plain
 * text. A play with a `clip` (and a `replay`) opens a looping mini-clip popover
 * of the moment, pinned to this cell; a play with only a `jump` seeks the 2D
 * replay straight away.
 */
const props = defineProps<{
  value: string | number
  details?: CellDetail[]
  /** In-memory replay, enabling the mini-clip popover for plays that carry one. */
  replay?: Replay
}>()

const emit = defineEmits<{
  (e: 'jump', payload: { roundIndex: number; t: number }): void
}>()

const hasDetails = () => (props.details?.length ?? 0) > 0

// The trigger element, captured when the drill-in opens, so the clip popover can
// stay pinned to this cell after the drill-in (reka popover) closes.
const triggerEl = ref<HTMLElement | null>(null)
// The play whose mini-clip is open (null = none). Holds the whole detail so the
// popover header can reuse its text/sub lines.
const openDetail = ref<CellDetail | null>(null)
</script>

<template>
  <PopoverRoot v-if="hasDetails()">
    <PopoverTrigger
      class="cursor-pointer rounded px-1 font-mono tabular-nums text-surge-200 underline decoration-dotted underline-offset-2 outline-none transition-colors hover:text-surge-100 focus-visible:ring-1 focus-visible:ring-surge-500"
      @click="triggerEl = ($event.currentTarget as HTMLElement)"
    >
      {{ value }}
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :side-offset="6"
        class="z-50 w-72 rounded-lg border border-ink-700 bg-ink-900/95 p-1.5 text-left shadow-xl shadow-black/50 backdrop-blur"
      >
        <ul class="space-y-0.5">
          <li v-for="d in details" :key="d.key">
            <!-- A play with a clip opens the mini-clip pinned to this cell. -->
            <PopoverClose
              v-if="d.clip && replay"
              class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-ink-800 focus-visible:bg-ink-800 focus-visible:outline-none"
              @click="openDetail = d"
            >
              <span class="text-xs text-ink-100">{{ d.text }}</span>
              <span v-if="d.sub" class="font-mono text-[11px] text-ink-500">{{ d.sub }}</span>
            </PopoverClose>
            <!-- Otherwise: seek the 2D replay directly. -->
            <PopoverClose
              v-else-if="d.jump"
              class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-ink-800 focus-visible:bg-ink-800 focus-visible:outline-none"
              @click="emit('jump', d.jump)"
            >
              <span class="text-xs text-ink-100">{{ d.text }}</span>
              <span v-if="d.sub" class="font-mono text-[11px] text-ink-500">{{ d.sub }}</span>
            </PopoverClose>
            <div v-else class="flex flex-col gap-0.5 px-2 py-1.5">
              <span class="text-xs text-ink-100">{{ d.text }}</span>
              <span v-if="d.sub" class="font-mono text-[11px] text-ink-500">{{ d.sub }}</span>
            </div>
          </li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
  <span v-else class="font-mono tabular-nums text-ink-100">{{ value }}</span>

  <!-- Mini-clip of the picked play, pinned to this cell (the drill-in has closed). -->
  <ReplayClipPopover
    v-if="openDetail?.clip && replay"
    :reference="triggerEl"
    :replay="replay"
    :round="openDetail.clip.round"
    :jump-t="openDetail.clip.jumpT"
    :from="openDetail.clip.from"
    :to="openDetail.clip.to"
    :focus-steam-ids="openDetail.clip.focusSteamIds"
    @jump="(p) => emit('jump', p)"
    @close="openDetail = null"
  >
    <template #header>
      <span class="truncate text-ink-100">{{ openDetail.text }}</span>
    </template>
  </ReplayClipPopover>
</template>
