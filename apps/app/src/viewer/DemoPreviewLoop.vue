<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Replay } from '@/viewer/schema'
import ViewerMap from '@/viewer/ViewerMap.vue'
import { useReplay } from '@/viewer/useReplay'
import { MAP_CALIBRATION } from '@/viewer/calibration'

/**
 * Looping preview of the 2D viewer: loads a short round (static fixture) and
 * plays the map on loop, with no audio or controls. Purely demonstrative for
 * the landing; reuses ViewerMap and the interpolation engine from useReplay.
 */
const props = withDefaults(
  defineProps<{ src?: string; autoZoom?: boolean; loop?: boolean }>(),
  {
    src: '/replays/inferno-preview.json',
    autoZoom: false,
    // When false, emit `ended` on round completion instead of restarting — lets
    // the parent rotate to a different map.
    loop: true,
  },
)

const emit = defineEmits<{ ended: [] }>()

const r = useReplay()
const ready = ref(false)
let mounted = true

const calibration = computed(() => {
  const map = r.replay.value?.map
  return (map && MAP_CALIBRATION[map]) || MAP_CALIBRATION.de_dust2
})

// On reaching the end of the round: loop it (continuous effect) or hand control
// back to the parent so it can rotate to another map.
watch(r.playing, (playing) => {
  if (!playing && mounted && ready.value) {
    if (props.loop) {
      r.selectRound(0)
      r.play()
    } else {
      emit('ended')
    }
  }
})

onMounted(async () => {
  try {
    const res = await fetch(props.src)
    const replay = (await res.json()) as Replay
    if (!mounted) return
    r.setReplay(replay)
    r.selectRound(0)
    r.speed.value = 1.4
    ready.value = true
    r.play()
  } catch {
    // Missing/broken fixture: don't stall a rotation on a blank map — let the
    // parent move on after a short pause (avoids a hot loop if all fail).
    if (!props.loop && mounted) setTimeout(() => mounted && emit('ended'), 3000)
  }
})
onBeforeUnmount(() => {
  mounted = false
  r.pause()
})
</script>

<template>
  <div v-if="ready && r.replay.value" class="h-full w-full">
    <ViewerMap
      :players="r.players.value"
      :current-t="r.currentT.value"
      :round="r.round.value"
      :calibration="calibration"
      :players-by-id="r.playersById.value"
      :bomb-blink="r.bombBlink.value"
      :auto-zoom="props.autoZoom"
      :controls="false"
    />
  </div>
</template>
