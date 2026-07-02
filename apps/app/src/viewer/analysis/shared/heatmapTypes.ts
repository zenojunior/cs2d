/**
 * Self-contained kill description carried by a kill/death heatmap point, so
 * clicking the marker can show a "who killed whom" popover (like the killfeed)
 * and seek the replay to the moment.
 */
export interface KillInfo {
  /** Round array index and event time (seconds since freeze) for the jump. */
  roundIndex: number
  t: number
  roundNumber: number
  /** Killer + victim steamIds, so a clip can frame both players of the duel
   *  (attacker is null for world/suicide deaths). */
  attackerSteamId: string | null
  victimSteamId: string
  attackerName: string | null
  attackerColor: string
  victimName: string
  victimColor: string
  weapon: string
  weaponIcon: string | null
  headshot: boolean
  assistedFlash: boolean
  /** Shooter (attacker) world position at the kill, if known (null otherwise). */
  ax: number | null
  ay: number | null
  /** Victim world position (the death spot). */
  vx: number
  vy: number
}
