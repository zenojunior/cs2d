// Optional host-permission helpers, one per demo source. Faceit, HLTV and
// GamersClub are required hosts; the rest are optional and granted at runtime.

export type OptionalSource = 'valve' | '5eplay' | 'renown'

const SOURCE_ORIGINS: Record<OptionalSource, string[]> = {
  valve: ['*://*.valve.net/*'],
  '5eplay': ['*://*.5eplay.com/*'],
  renown: ['*://*.renown.gg/*'],
}

export function originsForSource(source: string): string[] {
  return SOURCE_ORIGINS[source as OptionalSource] ?? []
}

export async function hasSourceHostPermissions(source: string): Promise<boolean> {
  const origins = originsForSource(source)
  if (origins.length === 0) return true
  return chrome.permissions.contains({ origins })
}

// Must be called from an extension page inside a user gesture (not a content
// script or the service worker), or chrome.permissions.request rejects.
export async function requestSourceHostPermissions(source: string): Promise<boolean> {
  const origins = originsForSource(source)
  if (origins.length === 0) return true
  return chrome.permissions.request({ origins })
}
