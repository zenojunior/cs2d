/**
 * Game coordinate calibration -> radar fraction [0,1], per map.
 *
 * Uses the official CS2 overview convention: `pos_x`/`pos_y` are the world
 * coordinate of the radar's top-left corner and `scale` is game units per pixel
 * (on a 1024px radar). Same source as the images in /public/maps (official
 * radars from the cs2-map-icons repo:
 * https://github.com/MurkyYT/cs2-map-icons/tree/main/images/radars).
 *
 * We work in [0,1] fractions to stay independent of canvas size: the viewer
 * just multiplies by whatever dimension it is drawing.
 *
 * Only `de_dust2` is validated against real demo data. The rest use the
 * official tabulated values and should be checked once we have a replay for them.
 */
export interface MapLevel {
  name: string
  /** Min Z (inclusive) and max Z (exclusive) of the band, in game units. */
  minZ: number
  maxZ: number
  /** Floor's own radar. When absent, uses the map's main radar. */
  radar?: string
}

export interface MapCalibration {
  radar: string
  /** Game units per pixel on a 1024px radar. */
  scale: number
  /** World coordinate of the radar's top-left corner. */
  posX: number
  posY: number
  /** Map floors by Z band (multi-level maps only). When absent, the heatmap
   *  treats the map as a single level. */
  levels?: MapLevel[]
  /** C4 explosion damage radius in game units (per-map, from the bomb's
   *  ConVar-tuned radius). Drives the size of the detonation shockwave. When
   *  absent, the viewer falls back to DEFAULT_BLAST_RADIUS. */
  blastRadius?: number
}

/** Fallback C4 blast radius (game units) for maps without a tabulated value. */
export const DEFAULT_BLAST_RADIUS = 1750

const RADAR_PX = 1024

export const MAP_CALIBRATION: Record<string, MapCalibration> = {
  // validated against a real demo
  de_dust2: { radar: '/maps/de_dust2_radar.png', scale: 4.4, posX: -2476, posY: 3239, blastRadius: 1750 },
  // official tabulated values (to validate with a replay)
  de_mirage: { radar: '/maps/de_mirage_radar.png', scale: 5.0, posX: -3230, posY: 1713, blastRadius: 2275 },
  de_inferno: { radar: '/maps/de_inferno_radar.png', scale: 4.9, posX: -2087, posY: 3870, blastRadius: 2175 },
  de_nuke: {
    radar: '/maps/de_nuke_radar.png',
    scale: 7.0,
    posX: -3453,
    posY: 2887,
    blastRadius: 2275,
    // Nuke is the classic two-floor case: each floor has its own radar. The Z
    // cut sits BETWEEN the floors: the main one (site A) is around z ~ -415 and
    // the basement (site B) around z ~ -767, so we split at -575. Upper floor =
    // higher Z. (Adjust if a real replay shows floors at a different height.)
    levels: [
      { name: 'Superior', minZ: -575, maxZ: Infinity },
      { name: 'Inferior', minZ: -Infinity, maxZ: -575, radar: '/maps/de_nuke_lower_radar.png' },
    ],
  },
  de_ancient: { radar: '/maps/de_ancient_radar.png', scale: 5.0, posX: -2953, posY: 2164, blastRadius: 2250 },
  de_anubis: { radar: '/maps/de_anubis_radar.png', scale: 5.22, posX: -2796, posY: 3328, blastRadius: 1575 },
  de_overpass: { radar: '/maps/de_overpass_radar.png', scale: 5.2, posX: -4831, posY: 1781, blastRadius: 2275 },
  de_cache: { radar: '/maps/de_cache_radar.png', scale: 5.5, posX: -2000, posY: 3250, blastRadius: 2260 },
  de_vertigo: {
    radar: '/maps/de_vertigo_radar.png',
    scale: 4.0,
    posX: -3168,
    posY: 1762,
    blastRadius: 1750,
    // Vertigo is a skybox tower: the two playable floors sit very high up. The
    // official overview splits the vertical sections at altitude 11700 (upper =
    // higher Z). (Adjust if a real replay shows the floors at a different height.)
    levels: [
      { name: 'Superior', minZ: 11700, maxZ: Infinity },
      { name: 'Inferior', minZ: -Infinity, maxZ: 11700, radar: '/maps/de_vertigo_lower_radar.png' },
    ],
  },
}

/** Converts a game coordinate to a radar fraction [0,1] (origin at the top). */
export function worldToFraction(
  cal: MapCalibration,
  x: number,
  y: number,
): { fx: number; fy: number } {
  const fx = (x - cal.posX) / cal.scale / RADAR_PX
  const fy = (cal.posY - y) / cal.scale / RADAR_PX
  return { fx, fy }
}

/** Inverse of `worldToFraction`: a radar fraction [0,1] back to game coordinates.
 *  Used to turn a click on the map into a world anchor for a comment pin. */
export function worldFromFraction(
  cal: MapCalibration,
  fx: number,
  fy: number,
): { x: number; y: number } {
  const x = fx * RADAR_PX * cal.scale + cal.posX
  const y = cal.posY - fy * RADAR_PX * cal.scale
  return { x, y }
}
