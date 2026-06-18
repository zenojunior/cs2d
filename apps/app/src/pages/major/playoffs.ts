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
  // Full URL of the pre-parsed replay JSON, fetched on demand; null until the
  // demo has been parsed and committed. See REPLAY_BASE.
  replay: string | null
}

// Replays are served straight from the open-source repo (raw.githubusercontent
// sends `Access-Control-Allow-Origin: *`), so the ~50MB files stay out of the
// app bundle and the PWA precache and are downloaded only when the user hits play.
const REPLAY_BASE =
  'https://raw.githubusercontent.com/zenojunior/cs-demo-analyzer/main/replays/major-cologne-2026'

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
      { map: 'de_nuke', replay: `${REPLAY_BASE}/qf1-nuke.json` },
      { map: 'de_anubis', replay: `${REPLAY_BASE}/qf1-anubis.json` },
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
    scoreA: null,
    scoreB: null,
    maps: [],
  },
  {
    id: 'qf3',
    round: 'quarterfinal',
    label: 'QF3',
    bestOf: 3,
    date: 'Jun 19',
    teamA: 'spirit',
    teamB: 'g2',
    scoreA: null,
    scoreB: null,
    maps: [],
  },
  {
    id: 'qf4',
    round: 'quarterfinal',
    label: 'QF4',
    bestOf: 3,
    date: 'Jun 19',
    teamA: 'falcons',
    teamB: 'vitality',
    scoreA: null,
    scoreB: null,
    maps: [],
  },
  {
    id: 'sf1',
    round: 'semifinal',
    label: 'SF1',
    bestOf: 3,
    date: 'Jun 20',
    teamA: 'aurora',
    teamB: null,
    sourceA: 'qf1',
    sourceB: 'qf2',
    scoreA: null,
    scoreB: null,
    maps: [],
  },
  {
    id: 'sf2',
    round: 'semifinal',
    label: 'SF2',
    bestOf: 3,
    date: 'Jun 20',
    teamA: null,
    teamB: null,
    sourceA: 'qf3',
    sourceB: 'qf4',
    scoreA: null,
    scoreB: null,
    maps: [],
  },
  {
    id: 'final',
    round: 'final',
    label: 'Final',
    bestOf: 5,
    date: 'Jun 21',
    teamA: null,
    teamB: null,
    sourceA: 'sf1',
    sourceB: 'sf2',
    scoreA: null,
    scoreB: null,
    maps: [],
  },
]

export const QUARTERFINALS = MATCHES.filter((m) => m.round === 'quarterfinal')
export const SEMIFINALS = MATCHES.filter((m) => m.round === 'semifinal')
export const FINAL = MATCHES.find((m) => m.round === 'final')!

const MATCH_BY_ID = new Map(MATCHES.map((m) => [m.id, m]))
export function matchById(id: string): MajorMatch | undefined {
  return MATCH_BY_ID.get(id)
}
