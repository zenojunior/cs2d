<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loader2, Play } from 'lucide-vue-next'
import {
  demoUrlFromPayload,
  enqueueJob,
  extractMeta,
  fetchPayload,
  openViewer,
  signDemoUrl,
} from '@/utils/faceitDownload'
import { t } from './i18n'
import { refreshExtensionState, useExtensionState } from './extensionState'

// Small "2D" button injected beside each item in Faceit's match-history list.
// Unlike the room button, the match isn't the open room: we resolve its demo URL
// from the match API on click. Progress shows as a vertical fill (the background
// rising bottom -> top) plus a circular spinner; downloads share the same queue.
const props = defineProps<{ matchId: string; roomUrl: string }>()

const state = useExtensionState()
const resolving = ref(false)
const failed = ref(false)

const job = computed(() => state.value.active.find((a) => a.matchId === props.matchId) ?? null)
const stored = computed(() => state.value.stored.find((s) => s.matchId === props.matchId) ?? null)
const busy = computed(() => (!!job.value && !job.value.error) || resolving.value)
const errored = computed(() => failed.value || !!job.value?.error)

// Vertical fill height: download percent while downloading, full once parsing.
const pct = computed(() => {
  const j = job.value
  if (!j || j.error) return 0
  return j.phase === 'downloading' ? (j.total ? Math.round((j.loaded / j.total) * 100) : 0) : 100
})

async function onClick() {
  if (stored.value && !job.value) {
    void openViewer(props.matchId)
    return
  }
  if (busy.value) return
  resolving.value = true
  failed.value = false
  try {
    const p = await fetchPayload(props.matchId)
    const demoUrl = demoUrlFromPayload(p)
    const signed = demoUrl ? await signDemoUrl(demoUrl) : null
    if (!signed) throw new Error('no demo URL')
    const meta = { ...extractMeta(p), roomUrl: props.roomUrl, source: 'faceit' }
    await enqueueJob({
      matchId: props.matchId,
      url: signed,
      label: meta.teamA ? `${meta.teamA} vs ${meta.teamB}` : props.matchId,
      meta,
    })
    await refreshExtensionState()
  } catch {
    failed.value = true
  } finally {
    resolving.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="relative flex h-[80px] w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border text-[11px] font-bold leading-none transition-colors"
    :class="
      errored
        ? 'border-destructive/60 bg-card text-destructive'
        : busy
          ? 'border-primary/50 bg-card text-foreground'
          : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
    "
    :title="stored ? t('room.watch') : '2D'"
    @click.stop.prevent="onClick"
  >
    <!-- Background progress (primary), rising bottom -> top over the neutral base. -->
    <div
      v-if="busy"
      class="absolute inset-x-0 bottom-0 bg-primary transition-[height] duration-200"
      :style="{ height: pct + '%' }"
    />
    <Loader2 v-if="busy" class="relative size-4 animate-spin" />
    <Play v-else-if="stored" class="relative size-3.5" />
    <span v-else class="relative">2D</span>
  </button>
</template>
