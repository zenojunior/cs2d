// Map art shipped in the extension, shared by the library cards and the in-page
// room preview.

// Maps whose top-down 2D radar ships in the extension (public/maps/radars).
const KNOWN_RADARS = new Set([
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2',
  'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_vertigo',
])
// Maps with an in-game photo thumb (public/maps/thumbs).
const KNOWN_THUMBS = new Set([
  'de_ancient', 'de_anubis', 'de_cache', 'de_dust2',
  'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass',
])

export function radarUrl(map?: string) {
  return map && KNOWN_RADARS.has(map) ? chrome.runtime.getURL(`maps/radars/${map}_radar.png` as never) : null
}
export function thumbUrl(map?: string) {
  return map && KNOWN_THUMBS.has(map) ? chrome.runtime.getURL(`maps/thumbs/${map}.webp` as never) : null
}
export function topLine(parts: (string | undefined)[]) {
  return parts.filter(Boolean).join(' · ')
}
export function prettyMap(map: string) {
  const base = map.replace(/^(de|cs|ar|dz)_/, '')
  return base.charAt(0).toUpperCase() + base.slice(1)
}
