// IEM Cologne Major 2026 playoffs bracket. Source: https://www.hltv.org/major/simulator

export interface MajorTeam {
  id: string
  name: string
  short: string
  seed: number
  // Logo lives in public/teams/<id>.png.
  logo: string
}

export interface MajorMapReplay {
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

// Replays live in the repo `replays/` dir, outside the app bundle and PWA
// precache, fetched on demand (in prod from raw.githubusercontent, which sends
// `Access-Control-Allow-Origin: *`). Refs are relative so the same value
// resolves locally too; see `resolveReplayRef`.
const REPLAY_DIR = 'major-cologne-2026'

export type MajorRound = 'quarterfinal' | 'semifinal' | 'final'

export interface MajorMatch {
  id: string
  round: MajorRound
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
  maps: MajorMapReplay[]
}

export const MAJOR = {
  name: 'IEM Cologne Major 2026',
}

export const TEAMS: Record<string, MajorTeam> = {
  spirit: { id: 'spirit', name: 'Team Spirit', short: 'SPIRIT', seed: 1, logo: '/teams/spirit.png' },
  furia: { id: 'furia', name: 'FURIA Esports', short: 'FURIA', seed: 2, logo: '/teams/furia.png' },
  aurora: { id: 'aurora', name: 'Aurora Gaming', short: 'AURORA', seed: 3, logo: '/teams/aurora.png' },
  vitality: { id: 'vitality', name: 'Team Vitality', short: 'VITALITY', seed: 4, logo: '/teams/vitality.png' },
  falcons: { id: 'falcons', name: 'Team Falcons', short: 'FALCONS', seed: 5, logo: '/teams/falcons.png' },
  betboom: { id: 'betboom', name: 'BetBoom Team', short: 'BETBOOM', seed: 6, logo: '/teams/betboom.png' },
  '9z': { id: '9z', name: '9z Team', short: '9Z', seed: 7, logo: '/teams/9z.png' },
  g2: { id: 'g2', name: 'G2 Esports', short: 'G2', seed: 8, logo: '/teams/g2.png' },
}

// Single-elimination bracket. Quarterfinals are seeded; semifinals and the
// grand final start as TBD and reference the matches that feed them.
export const MATCHES: MajorMatch[] = [
  {
    id: 'qf1',
    round: 'quarterfinal',
    label: 'QF1',
    bestOf: 3,
    date: 'Jun 18',
    teamA: 'aurora',
    teamB: 'betboom',
    scoreA: 2,
    scoreB: 0,
    maps: [
      { map: 'de_nuke', replay: `${REPLAY_DIR}/qf1-nuke.cs2dv`, scoreA: 13, scoreB: 6 },
      { map: 'de_anubis', replay: `${REPLAY_DIR}/qf1-anubis.cs2dv`, scoreA: 13, scoreB: 9 },
    ],
  },
  {
    id: 'qf2',
    round: 'quarterfinal',
    label: 'QF2',
    bestOf: 3,
    date: 'Jun 18',
    teamA: '9z',
    teamB: 'furia',
    scoreA: 1,
    scoreB: 2,
    maps: [
      { map: 'de_dust2', replay: `${REPLAY_DIR}/qf2-dust2.cs2dv`, scoreA: 13, scoreB: 8 },
      { map: 'de_mirage', replay: `${REPLAY_DIR}/qf2-mirage.cs2dv`, scoreA: 9, scoreB: 13 },
      { map: 'de_overpass', replay: `${REPLAY_DIR}/qf2-overpass.cs2dv`, scoreA: 6, scoreB: 13 },
    ],
  },
  {
    id: 'qf3',
    round: 'quarterfinal',
    label: 'QF3',
    bestOf: 3,
    date: 'Jun 19',
    teamA: 'spirit',
    teamB: 'g2',
    scoreA: 2,
    scoreB: 1,
    maps: [
      { map: 'de_overpass', replay: `${REPLAY_DIR}/qf3-overpass.cs2dv`, scoreA: 9, scoreB: 13 },
      { map: 'de_dust2', replay: `${REPLAY_DIR}/qf3-dust2.cs2dv`, scoreA: 16, scoreB: 14 },
      { map: 'de_mirage', replay: `${REPLAY_DIR}/qf3-mirage.cs2dv`, scoreA: 25, scoreB: 22 },
    ],
  },
  {
    id: 'qf4',
    round: 'quarterfinal',
    label: 'QF4',
    bestOf: 3,
    date: 'Jun 19',
    teamA: 'falcons',
    teamB: 'vitality',
    scoreA: 2,
    scoreB: 1,
    maps: [
      { map: 'de_anubis', replay: `${REPLAY_DIR}/qf4-anubis.cs2dv`, scoreA: 13, scoreB: 11 },
      { map: 'de_inferno', replay: `${REPLAY_DIR}/qf4-inferno.cs2dv`, scoreA: 11, scoreB: 13 },
      { map: 'de_dust2', replay: `${REPLAY_DIR}/qf4-dust2.cs2dv`, scoreA: 13, scoreB: 11 },
    ],
  },
  {
    id: 'sf1',
    round: 'semifinal',
    label: 'SF1',
    bestOf: 3,
    date: 'Jun 20',
    teamA: 'aurora',
    teamB: 'furia',
    sourceA: 'qf1',
    sourceB: 'qf2',
    scoreA: 0,
    scoreB: 2,
    maps: [
      { map: 'de_dust2', replay: `${REPLAY_DIR}/sf1-dust2.cs2dv`, scoreA: 9, scoreB: 13 },
      { map: 'de_nuke', replay: `${REPLAY_DIR}/sf1-nuke.cs2dv`, scoreA: 4, scoreB: 13 },
    ],
  },
  {
    id: 'sf2',
    round: 'semifinal',
    label: 'SF2',
    bestOf: 3,
    date: 'Jun 20',
    teamA: 'spirit',
    teamB: 'falcons',
    sourceA: 'qf3',
    sourceB: 'qf4',
    scoreA: 1,
    scoreB: 2,
    maps: [
      { map: 'de_anubis', replay: `${REPLAY_DIR}/sf2-anubis.cs2dv`, scoreA: 14, scoreB: 16 },
      { map: 'de_mirage', replay: `${REPLAY_DIR}/sf2-mirage.cs2dv`, scoreA: 13, scoreB: 8 },
      { map: 'de_dust2', replay: `${REPLAY_DIR}/sf2-dust2.cs2dv`, scoreA: 12, scoreB: 16 },
    ],
  },
  {
    id: 'final',
    round: 'final',
    label: 'Final',
    bestOf: 5,
    date: 'Jun 21',
    teamA: 'furia',
    teamB: 'falcons',
    sourceA: 'sf1',
    sourceB: 'sf2',
    scoreA: 0,
    scoreB: 3,
    maps: [
      { map: 'de_mirage', replay: `${REPLAY_DIR}/final-mirage.cs2dv`, scoreA: 8, scoreB: 13 },
      { map: 'de_anubis', replay: `${REPLAY_DIR}/final-anubis.cs2dv`, scoreA: 8, scoreB: 13 },
      { map: 'de_inferno', replay: `${REPLAY_DIR}/final-inferno.cs2dv`, scoreA: 8, scoreB: 13 },
    ],
  },
]

export const QUARTERFINALS = MATCHES.filter((m) => m.round === 'quarterfinal')
export const SEMIFINALS = MATCHES.filter((m) => m.round === 'semifinal')
export const FINAL = MATCHES.find((m) => m.round === 'final')!

const MATCH_BY_ID = new Map(MATCHES.map((m) => [m.id, m]))
export function matchById(id: string): MajorMatch | undefined {
  return MATCH_BY_ID.get(id)
}
