// Registry of showcase tournaments (CS2 majors and friends). Each tournament
// carries its metadata plus a static single-elimination playoffs bracket whose
// series stream pre-parsed replays committed to the repo. Data is hardcoded per
// tournament under `data/`; add a new file there and list it in `TOURNAMENTS`.

export interface TournamentTeam {
  id: string
  name: string
  short: string
  seed: number
  // Logo lives in public/teams/<id>.png.
  logo: string
}

export interface TournamentMapReplay {
  map: string
  // Relative replay ref passed to `?replay=`, resolved by `resolveReplayRef`
  // (repo `replays/` dir in dev, raw.githubusercontent in prod); null until the
  // demo has been parsed and committed.
  replay: string | null
  // Final round score on this map, from teamA's / teamB's perspective; null
  // until the map has been played. Sourced from the parsed replay's final score.
  scoreA: number | null
  scoreB: number | null
}

export type TournamentRound = 'quarterfinal' | 'semifinal' | 'final'

export interface TournamentMatch {
  id: string
  round: TournamentRound
  label: string
  bestOf: number
  date: string
  teamA: string | null
  teamB: string | null
  // Match ids whose winners fill the slots, used to label a TBD slot.
  sourceA?: string
  sourceB?: string
  scoreA: number | null
  scoreB: number | null
  maps: TournamentMapReplay[]
}

export interface Tournament {
  // URL slug (without the year), e.g. 'major-cologne' → /tournaments/2026/major-cologne.
  slug: string
  year: number
  // Full display name, e.g. 'IEM Cologne Major 2026'.
  name: string
  // Prestige tier; 'major' gets a badge and the trophy accent.
  tier: 'major' | 'other'
  // Host city, shown on the listing card.
  city: string
  // Human-readable date span, e.g. 'Jun 18–21, 2026'.
  dates: string
  // Winning team id (key into `teams`); undefined until the event is decided.
  champion?: string
  // Directory prefix under the repo `replays/` dir for this tournament's demos.
  replayDir: string
  teams: Record<string, TournamentTeam>
  matches: TournamentMatch[]
}

// Resolve a tournament from its route params. Year is a string in the URL.
export function findTournament(year: string, slug: string): Tournament | undefined {
  return TOURNAMENTS.find((tourney) => String(tourney.year) === year && tourney.slug === slug)
}

// Split a tournament's bracket into its three rounds for the column layout.
export function bracketColumns(tournament: Tournament) {
  return {
    quarterfinals: tournament.matches.filter((m) => m.round === 'quarterfinal'),
    semifinals: tournament.matches.filter((m) => m.round === 'semifinal'),
    final: tournament.matches.find((m) => m.round === 'final'),
  }
}

import { majorCologne2026 } from './data/major-cologne-2026'

// Most recent first — the listing renders them in this order.
export const TOURNAMENTS: Tournament[] = [majorCologne2026]
