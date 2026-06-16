<script setup lang="ts">
import { MAP_CALIBRATION } from '@/viewer/calibration'

/**
 * Decorative background for the upload screen: several radar thumbnails (the
 * same maps used in the viewer) sliding in rows, with alternating directions and
 * speeds. A dark scrim on top keeps the content readable. Purely aesthetic: no
 * interaction, and the animation is disabled under prefers-reduced-motion.
 */
const radars = Object.values(MAP_CALIBRATION).map((c) => c.radar)
const ROWS = 6

// Each row starts at a different rotation of the list and is duplicated, so the
// marquee loops seamlessly.
function rowMaps(i: number) {
  const off = i % radars.length
  const rot = [...radars.slice(off), ...radars.slice(0, off)]
  return [...rot, ...rot]
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 overflow-hidden">
    <div class="absolute inset-0 flex flex-col justify-center gap-5">
      <div
        v-for="i in ROWS"
        :key="i"
        class="flex w-max gap-5"
        :class="i % 2 ? 'marquee-right' : 'marquee-left'"
        :style="{ animationDuration: `${70 + i * 14}s` }"
      >
        <img
          v-for="(src, j) in rowMaps(i)"
          :key="j"
          :src="src"
          alt=""
          draggable="false"
          class="h-40 w-40 shrink-0 rounded-xl object-cover opacity-25 ring-1 ring-white/5"
        />
      </div>
    </div>

    <!-- Scrim: darkens and focuses the center/top for the content. -->
    <div class="absolute inset-0 bg-ink-950/70" />
    <div class="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/50 to-ink-950" />
  </div>
</template>

<style scoped>
.marquee-left {
  animation-name: marquee-left;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
.marquee-right {
  animation-name: marquee-right;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes marquee-left {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
@keyframes marquee-right {
  from {
    transform: translateX(-50%);
  }
  to {
    transform: translateX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .marquee-left,
  .marquee-right {
    animation: none;
  }
}
</style>
