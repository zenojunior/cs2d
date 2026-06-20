// Small presentation helpers for demo metadata (map name, thumbnail, size, date)
// shared by the upload home, the Major bracket and the Library page so the
// formatting stays consistent in one place.
import { MAP_CALIBRATION } from '@/viewer/domain/calibration'

// Maps with preview art (16:9) in /maps/thumbs.
const MAP_THUMBS = new Set([
  'de_ancient',
  'de_anubis',
  'de_cache',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_overpass',
])

// "de_dust2" -> "Dust2"; strips the game-mode prefix and capitalizes.
export function prettyMap(map: string): string {
  const base = map.replace(/^(de|cs|ar|dz)_/, '')
  return base.charAt(0).toUpperCase() + base.slice(1)
}

// Map image: the preview art when it exists; otherwise the radar used in the
// viewer; otherwise null (callers fall back to a generic icon).
export function mapImage(map: string): string | null {
  if (MAP_THUMBS.has(map)) return `/maps/thumbs/${map}.webp`
  return MAP_CALIBRATION[map]?.radar ?? null
}

// Byte count -> short human size (KB under 1 MB, one decimal under 10 MB). The
// parsed `.cs2dv` we store is small, so the finer granularity reads better than
// rounding everything to whole MB.
export function fmtSize(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}

// Compact date (day + short month) for tight rows.
export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// Full date + time for places with room for the detail (e.g. context menus).
export function fmtDateFull(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
