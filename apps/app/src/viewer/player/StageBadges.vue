<script setup lang="ts">
// Transient status pills overlaid on the stage (all at top-center): the comment /
// coach mode hints, the "following <player>" badge (with an exit button), and the
// dismissible export-error banner. Purely presentational; the stage owns the state.
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'

defineProps<{
  hudHidden: boolean
  commentMode: boolean
  coachMode: boolean
  followSteamId: string | null
  followName: string
  exportError: string | null
}>()

const emit = defineEmits<{
  /** Stop following the current player. */
  unfollow: []
  /** Dismiss the export-error banner. */
  dismissError: []
}>()

const { t } = useI18n()
</script>

<template>
  <!-- Comment mode hint -->
  <div
    v-if="commentMode && !exportError"
    class="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center"
  >
    <span class="rounded-full bg-surge-500/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur">
      {{ t('viewer.comment.modeHint') }}
    </span>
  </div>

  <!-- Following a player: badge with an exit button (also via Esc). -->
  <div
    v-if="followSteamId && !hudHidden"
    class="pointer-events-auto absolute inset-x-0 top-20 z-10 flex justify-center"
  >
    <button
      type="button"
      v-tooltip="t('viewer.follow.exit')"
      class="flex cursor-pointer items-center gap-2 rounded-full bg-surge-500/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur transition-colors hover:bg-surge-500"
      @click="emit('unfollow')"
    >
      <UiIcon name="target" class="h-3.5 w-3.5" />
      {{ t('viewer.follow.following', { name: followName }) }}
      <UiIcon name="x" class="h-3.5 w-3.5 opacity-80" />
    </button>
  </div>

  <!-- Coach mode hint -->
  <div
    v-if="coachMode && !exportError"
    class="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center"
  >
    <span class="rounded-full bg-surge-500/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur">
      {{ t('viewer.coach.modeHint') }}
    </span>
  </div>

  <!-- Export error: dismissible banner -->
  <div
    v-if="exportError"
    class="pointer-events-auto absolute inset-x-0 top-20 z-20 flex justify-center"
  >
    <button
      type="button"
      v-tooltip="exportError"
      class="flex cursor-pointer items-center gap-2 rounded-full bg-loss/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur"
      @click="emit('dismissError')"
    >
      <UiIcon name="ban" class="h-3.5 w-3.5" />
      {{ t('viewer.exportError') }}
      <UiIcon name="x" class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
