// Map calibration + multi-floor level selector. Two-floor maps (e.g. Nuke)
// expose a level list that swaps the background radar and the Z range used to
// dim players on the other floor. Manual and predictable (no auto-flip); the
// active level resets to 0 whenever the map changes.
import { computed, ref, watch } from 'vue'
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'

export function useMapLevels(map: () => string | undefined) {
  const calibration = computed(() => {
    const m = map()
    return (m && MAP_CALIBRATION[m]) || MAP_CALIBRATION.de_dust2
  })

  const mapLevels = computed(() => calibration.value.levels ?? null)
  const activeLevel = ref(0)
  watch(mapLevels, () => (activeLevel.value = 0))

  const activeLevelRadar = computed(
    () => mapLevels.value?.[activeLevel.value]?.radar ?? calibration.value.radar,
  )
  const activeLevelRange = computed(() => {
    const lvl = mapLevels.value?.[activeLevel.value]
    return lvl ? { minZ: lvl.minZ, maxZ: lvl.maxZ } : null
  })

  return { calibration, mapLevels, activeLevel, activeLevelRadar, activeLevelRange }
}
