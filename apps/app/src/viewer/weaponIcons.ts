/**
 * Maps the weapon label (emitted by the parser in `PlayerState.weapon`) to the
 * icon SVG file under /public/weapons. The (white) SVGs come from the reference
 * project csgo-2d-demo-viewer.
 */
const FILE: Record<string, string> = {
  // rifles
  'AK-47': 'ak47',
  M4A4: 'm4a4',
  'M4A1-S': 'm4a1s',
  AUG: 'aug',
  'SG 553': 'sg556',
  'Galil AR': 'galil',
  FAMAS: 'famas',
  // snipers
  AWP: 'awp',
  'SSG 08': 'scout',
  'SCAR-20': 'scar',
  G3SG1: 'g3sg1',
  // pistols
  Deagle: 'deagle',
  'R8 Revolver': 'deagle',
  'Glock-18': 'glock',
  'USP-S': 'usp-s',
  P2000: 'hkp2000',
  'Five-SeveN': 'fiveseven',
  'Tec-9': 'tec9',
  'CZ75-Auto': 'cz75',
  P250: 'p250',
  'Dual Berettas': 'duals',
  // SMGs
  'MAC-10': 'mac10',
  MP9: 'mp9',
  MP7: 'mp7',
  'MP5-SD': 'mp5',
  'UMP-45': 'ump45',
  P90: 'p90',
  'PP-Bizon': 'bizon',
  // heavy
  Nova: 'nova',
  XM1014: 'xm1014',
  'Sawed-Off': 'sawedoff',
  'MAG-7': 'mag7',
  M249: 'para',
  Negev: 'negev',
  // utility
  Faca: 'knife',
  C4: 'c4',
  HE: 'he',
  Flash: 'flash',
  Smoke: 'smoke',
  Molotov: 'molotov',
  Decoy: 'decoy',
  'Zeus x27': 'taser',
}

/** Labels that have an icon (for preloading). */
export const WEAPON_LABELS = Object.keys(FILE)

/** Path to the icon SVG, or null if none. */
export function weaponIconPath(label: string): string | null {
  const f = FILE[label]
  return f ? `/weapons/${f}.svg` : null
}

/**
 * Maps the weapon code from the kill event (e.g. "ak47", "usp_silencer",
 * "m4a1_silencer") to the icon file. Differs from FILE, which uses the active
 * weapon's display name.
 */
const KILL_FILE: Record<string, string> = {
  ak47: 'ak47',
  aug: 'aug',
  awp: 'awp',
  bizon: 'bizon',
  cz75a: 'cz75',
  deagle: 'deagle',
  revolver: 'deagle',
  elite: 'duals',
  famas: 'famas',
  fiveseven: 'fiveseven',
  g3sg1: 'g3sg1',
  galilar: 'galil',
  glock: 'glock',
  hkp2000: 'hkp2000',
  p2000: 'hkp2000',
  m249: 'para',
  m4a1: 'm4a4',
  m4a1_silencer: 'm4a1s',
  mac10: 'mac10',
  mag7: 'mag7',
  mp5sd: 'mp5',
  mp7: 'mp7',
  mp9: 'mp9',
  negev: 'negev',
  nova: 'nova',
  p250: 'p250',
  p90: 'p90',
  sawedoff: 'sawedoff',
  scar20: 'scar',
  sg556: 'sg556',
  ssg08: 'scout',
  tec9: 'tec9',
  ump45: 'ump45',
  usp_silencer: 'usp-s',
  xm1014: 'xm1014',
  taser: 'taser',
  hegrenade: 'he',
  molotov: 'molotov',
  inferno: 'molotov',
  incgrenade: 'incendiary',
  smokegrenade: 'smoke',
  flashbang: 'flash',
  decoy: 'decoy',
  planted_c4: 'c4',
  c4: 'c4',
}

const KILL_KNIFE_RE = /knife|bayonet|karambit|huntsman|falchion|bowie|butterfly|daggers|navaja|stiletto|ursus|talon|paracord|survival|nomad|skeleton|kukri|flip|gut/i

/** Icon path for a kill's weapon, or null (e.g. "world"). */
export function killWeaponIcon(code: string): string | null {
  if (!code) return null
  if (KILL_KNIFE_RE.test(code)) return '/weapons/knife.svg'
  const f = KILL_FILE[code]
  return f ? `/weapons/${f}.svg` : null
}
