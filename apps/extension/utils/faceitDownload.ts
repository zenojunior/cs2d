// Faceit demo download helpers, shared by the floating overlay (App.vue) and the
// in-page room button (faceit.content/roomButton.ts). Framework-free so both the
// Vue overlay and the DOM-only injector use one source of truth.
//
// The signed CDN URL is obtained one of two ways: the MAIN-world interceptor
// captures it from Faceit's own download request (faceit-intercept), or we resolve
// it ourselves from the match payload (signDemoUrl). Both run in the page/content
// origin, so the same-origin Faceit API calls carry the user's auth cookies.
import type { MatchMeta, StateReply } from './protocol'

/** The match id from a `/room/<id>` URL, or null when not in a room. */
export function matchIdFromUrl(): string | null {
  return location.pathname.match(/\/room\/([\w-]+)/)?.[1] ?? null
}

/** The current room URL trimmed to `.../room/<id>` (drops sub-tabs like
 *  /scoreboard), so a saved library row links back to the room itself. */
export function roomUrlFromLocation(): string {
  const base = location.pathname.match(/^(.*\/room\/[\w-]+)/)?.[1] ?? location.pathname
  return location.origin + base
}

/** Faceit internal API: the raw match payload (meta + demo URLs). */
export async function fetchPayload(matchId: string): Promise<Record<string, any>> {
  const match = await fetch(`https://www.faceit.com/api/match/v2/match/${matchId}`, {
    credentials: 'include',
  }).then((r) => r.json())
  return match?.payload ?? {}
}

/** Exchange a stored demo URL for a short-lived signed CDN download URL. */
export async function signDemoUrl(demoUrl: string): Promise<string | null> {
  const signed = await fetch('https://www.faceit.com/api/download/v2/demos/download-url', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource_url: demoUrl }),
  }).then((r) => r.json())
  return signed?.payload?.download_url ?? null
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** The round score lives in different places across Faceit match payloads
 *  (matchmaking vs leagues, single result vs per-map detailedResults). Probe the
 *  known shapes in order and take the first that yields a faction score. */
function factionScores(p: Record<string, any>): { a?: number; b?: number } {
  const results = Array.isArray(p?.results) ? p.results[0] : p?.results
  const factionSources = [p?.detailedResults?.[0]?.factions, results?.factions]
  for (const f of factionSources) {
    const a = num(f?.faction1?.score)
    const b = num(f?.faction2?.score)
    if (a != null || b != null) return { a, b }
  }
  const scoreSources = [results?.score, p?.detailedResults?.[0]?.score]
  for (const s of scoreSources) {
    const a = num(s?.faction1)
    const b = num(s?.faction2)
    if (a != null || b != null) return { a, b }
  }
  return {}
}

/** Pull the card metadata (teams, score, map, competition) from a payload. */
export function extractMeta(p: Record<string, any>): MatchMeta {
  const teams = p?.teams ?? {}
  const rawDate = p?.finishedAt ?? p?.startedAt ?? p?.configuredAt
  const date = rawDate ? (typeof rawDate === 'number' ? rawDate : Date.parse(rawDate) || undefined) : undefined
  const { a, b } = factionScores(p)
  return {
    teamA: teams.faction1?.name,
    teamB: teams.faction2?.name,
    scoreA: a,
    scoreB: b,
    map: p?.voting?.map?.pick?.[0],
    competition: p?.competitionName ?? p?.competition_name,
    region: p?.region,
    date,
  }
}

/** The first demo URL on a payload, if any (the resource to sign). */
export function demoUrlFromPayload(p: Record<string, any>): string | null {
  return p?.demoURLs?.[0] ?? null
}

// --- background messaging (small JSON only) ---------------------------------
export async function getState(): Promise<StateReply> {
  return (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' })) as StateReply
}
export async function enqueueJob(job: {
  matchId: string
  url: string
  label: string
  meta?: MatchMeta
}): Promise<void> {
  await chrome.runtime.sendMessage({ target: 'background', type: 'ENQUEUE', job })
}
export async function openViewer(matchId: string): Promise<void> {
  await chrome.runtime.sendMessage({ target: 'background', type: 'OPEN_VIEWER', matchId })
}
export async function cancelJob(matchId: string): Promise<void> {
  await chrome.runtime.sendMessage({ target: 'background', type: 'CANCEL', matchId })
}
