/**
 * Resolves a `?replay=` reference to a URL and fetches it into a replay.
 *
 * A reference can be:
 *   - an absolute URL (`https://…`)           — used verbatim (already-shared links)
 *   - a host-absolute path (`/replays/x.json`) — used verbatim (public previews)
 *   - a bare relative ref (`major-cologne-2026/qf1-nuke.cs2dv`)
 *       resolved against the replay base, which differs per environment:
 *         dev:  `/_replays/`  — served from the repo `replays/` dir by a Vite
 *               middleware (the files live outside `public/`, see vite.config)
 *         prod: the open-source repo's raw.githubusercontent endpoint
 *
 * So a short relative ref resolves the same locally and in production:
 *   ?replay=major-cologne-2026/qf1-nuke.cs2dv
 */
import { importArchive } from '@/viewer/ingest/demoArchive'
import type { Replay, ReplayComment, VoiceData } from '@/viewer/domain/schema'

const RAW_BASE =
  'https://raw.githubusercontent.com/zenojunior/cs-demo-analyzer/main/replays/'

/** Base every relative replay ref is resolved against (dev serves from disk). */
export const REPLAY_BASE = import.meta.env.DEV ? '/_replays/' : RAW_BASE

/** Turns a `?replay=` ref into an absolute (or host-absolute) URL. */
export function resolveReplayRef(ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref // absolute URL
  if (ref.startsWith('/')) return ref // host-absolute path (public previews)
  return REPLAY_BASE + ref // relative → resolve against the replay base
}

export interface LoadedReplay {
  replay: Replay
  voice: VoiceData | null
  comments: ReplayComment[]
}

/**
 * Fetches a replay ref and decodes it, picking the format by extension:
 * `.cs2dv` is the gzipped archive (replay + voice + comments); a bare `.json`
 * is the raw replay (landing-page previews).
 */
export async function fetchReplay(ref: string): Promise<LoadedReplay> {
  const url = resolveReplayRef(ref)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/\.cs2dv(\?|$)/i.test(url)) {
    const archive = await importArchive(await res.blob())
    return { replay: archive.replay, voice: archive.voice, comments: archive.comments }
  }
  const replay = (await res.json()) as Replay
  return { replay, voice: null, comments: [] }
}
