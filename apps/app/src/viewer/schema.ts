/**
 * Normalized replay contract for the CS Demo Analyzer.
 *
 * This is the intermediate format between the demo parser and the 2D viewer.
 * The WASM parser (`packages/parser`) reads a .dem in the browser and
 * emits a `Replay`; the viewer only ever knows this schema, never the binary
 * demo. The Rust crate mirrors these same structs (see `lib.rs`), so change both
 * together.
 *
 * Coordinates: `x`/`y` are in game units (the same as the demo). The conversion
 * to radar pixels happens in the viewer, via a per-map calibration table.
 */

export type Side = 'CT' | 'T'

/** Winner of a round (raw field from the demo parser). */
export type RoundWinner = Side | null

export interface Replay {
  /** Map name (e.g. "de_dust2"). */
  map: string
  /** Demo tick rate (typically 64). */
  demoTickRate: number
  /** Effective tick rate after frame downsampling (e.g. 8 samples/s). */
  frameRate: number
  players: PlayerMeta[]
  /** Rounds in chronological order. */
  rounds: Round[]
  /** Final score per team, placed by the side each team ended on. */
  finalScoreCt: number
  finalScoreT: number
  /** Clan name of each team, by the side it ended on. */
  finalCtName: string
  finalTName: string
  /** Match pauses (tactical timeouts and admin/tech pauses), in absolute ticks.
   *  Omitted (undefined) for replays parsed before this field existed. */
  pauses?: Pause[]
  /** Generator version, useful for format migrations. */
  generatedBy: string
}

/** A pause in the match: a tactical timeout or an admin/technical pause. */
export interface Pause {
  startTick: number
  endTick: number
  /** "tactical" (a team timeout) or "technical" (admin / tech pause). */
  kind: 'tactical' | 'technical'
  /** Side that called a tactical timeout; absent for technical pauses. */
  side?: Side
}

export interface PlayerMeta {
  steamId: string
  name: string
  /** Side the player started on (sides swap at halftime). */
  startSide: Side
}

export interface Round {
  /** Round number starting at 1 (in played order). */
  number: number
  /** Freeze/buy-period start. The round timeline (`Frame.t` and every event's
   * `t`) is measured from here, so `t = 0` is the start of freeze time. */
  freezeStartTick: number
  /** Tick when the round becomes playable (round goes live, after freeze time). */
  startTick: number
  /** Tick when the round was decided (win-status flip). Between this and
   * `endTick` is the post-round (reactions). Equals `endTick` when there is no
   * distinct post-round in the demo. */
  decidedTick: number
  /** Official end of the round (round_officially_ended). */
  endTick: number
  /** End of the round's playable window (start of the next round's freeze, or
   * the last sampled tick for the final round). Covers the post-round period. */
  postEndTick: number
  winner: RoundWinner
  /** Raw end reason code (`m_eRoundWinReason` from CS2). */
  reason: string | null
  /** Score per team entering this round (already placed by the current side). */
  scoreCt: number
  scoreT: number
  /** Clan name of each team entering this round, by the current side. */
  ctName: string
  tName: string
  /** Health damage per player (steamId -> total) this round. */
  damage: Record<string, number>
  /** Time samples of positions, already downsampled. */
  frames: Frame[]
  /** Round events (kills, bomb, etc.) in tick order. */
  events: GameEvent[]
  /** C4 states across the round, in chronological order. */
  bomb: BombKeyframe[]
  /** Flight arcs of grenades thrown in the round. */
  grenadePaths: GrenadePath[]
  /** Flashbang blinds in the round. */
  blinds: BlindFlash[]
  /** Chat messages tied to this round (in tick order). */
  chat: ChatMessage[]
  /** C4 defuse attempts in the round (drives the progress animation). */
  defuses: Defuse[]
  /** Weapons/grenades lying on the ground during the round (dropped items). */
  groundWeapons: GroundWeapon[]
}

/**
 * A weapon or grenade dropped on the ground. The viewer draws its icon at
 * `x`/`y` while `startT <= currentT <= endT` (until someone picks it up or the
 * round ends).
 */
export interface GroundWeapon {
  /** Icon label, same vocabulary as `PlayerState.weapon` (e.g. "AK-47", "Smoke"). */
  label: string
  /** Position on the ground (game units). */
  x: number
  y: number
  /** Height (Z axis), for the multi-floor level filter. */
  z: number
  /** Seconds since the round `freezeStartTick` when it appears on the ground. */
  startT: number
  /** Seconds since the round `freezeStartTick` when it is picked up / the round ends. */
  endT: number
}

/**
 * A defuse attempt, start to finish. The viewer animates progress from `startT`
 * over `hasKit ? 5 : 10` seconds. If interrupted (`defused: false`) the
 * animation stops at `endT` and disappears; if completed it reaches 100% at `endT`.
 */
export interface Defuse {
  /** Seconds since the round `freezeStartTick` when the defuse started. */
  startT: number
  /** Seconds since the round `freezeStartTick` when it stopped (done or aborted). */
  endT: number
  defused: boolean
  hasKit: boolean
  steamId: string | null
}

/** In-game chat message typed by players. */
export interface ChatMessage {
  /** Seconds since the round `freezeStartTick` (clamped to >= 0). */
  t: number
  tick: number
  /** Sender name at the time of the message. */
  name: string
  text: string
  /** Team-only chat (true) or all-chat (false). */
  teamOnly: boolean
  /** Sender resolved by name, to color by side (or null). */
  steamId: string | null
}

/** A player blinded by a flash: the viewer fades the level from t to t+duration. */
export interface BlindFlash {
  t: number
  /** Total blind duration, in seconds. */
  duration: number
  steamId: string
}

/** Flight arc of a grenade, from throw to landing/detonation. */
export interface GrenadePath {
  kind: GrenadeKind
  /** Flight points (t in round seconds; x/y in game units). */
  points: { t: number; x: number; y: number }[]
  /** Who threw it (steamId64), when resolved. Powers the grenades finder
   *  (filter by player/side); null when the parser could not resolve it. */
  throwerSteamId: string | null
}

/**
 * C4 state from a moment in the round. The viewer takes the last keyframe with
 * `t <= currentT`: if `carried`, it draws the bomb on the carrier; if
 * `ground`/`planted`, at the position; if `gone`, it draws nothing.
 */
export interface BombKeyframe {
  t: number
  state: 'carried' | 'ground' | 'planted' | 'gone'
  /** Position on the ground/planted (game units). */
  x?: number
  y?: number
  /** Carrier, when `carried`. */
  carrierSteamId?: string
}

export interface Frame {
  tick: number
  /** Seconds since the round `freezeStartTick` (t = 0 is the start of freeze). */
  t: number
  players: PlayerState[]
}

export interface PlayerState {
  steamId: string
  /** Coordinates in game units. */
  x: number
  y: number
  /** Height (Z axis). Used to filter the level in the heatmap of multi-floor maps. */
  z: number
  /** Aim direction in degrees (yaw). */
  yaw: number
  health: number
  alive: boolean
  side: Side
  /** Short label of the active weapon (e.g. "AK-47", "AWP", "HE"). */
  weapon: string
  money: number
  /** Current equipment value (weapons + utility + armor). The economy view reads
   *  it on the first live frame of each round to derive the team's buy. */
  equipValue: number
  /** Armor (0 to 100). */
  armor: number
  /** Has helmet (omitted when false). */
  helmet?: boolean
  /** Has defuse kit, CT only (omitted when false). */
  defuser?: boolean
  /** Grenades in inventory, as short labels (omitted when empty). */
  grenades?: string[]
}

export type GameEventType =
  | 'kill'
  | 'bomb_planted'
  | 'bomb_defused'
  | 'bomb_exploded'
  | 'grenade'
  | 'shot'

export interface BaseEvent {
  type: GameEventType
  tick: number
  /** Seconds since the round `freezeStartTick`. */
  t: number
}

export interface KillEvent extends BaseEvent {
  type: 'kill'
  attackerSteamId: string | null
  victimSteamId: string
  assisterSteamId: string | null
  /** Assist was via flashbang (blinding the victim). */
  assistedFlash: boolean
  weapon: string
  headshot: boolean
  /** Victim position at the moment of death (game units). */
  x: number
  y: number
  /** Height (Z axis) of the death, for the heatmap level filter. */
  z: number
}

export interface BombEvent extends BaseEvent {
  type: 'bomb_planted' | 'bomb_defused' | 'bomb_exploded'
  /** Steam ID of the player who caused the event, when applicable. */
  playerSteamId: string | null
}

export type GrenadeKind = 'smoke' | 'fire' | 'he' | 'flash' | 'decoy'

export interface GrenadeEvent extends BaseEvent {
  type: 'grenade'
  kind: GrenadeKind
  /** Detonation position (game units). */
  x: number
  y: number
  /** Height (Z axis) of the detonation, for the heatmap level filter. */
  z: number
  /** Effect end (seconds since the round `freezeStartTick`). For smoke/fire it comes
   *  from the expire pair; for he/flash it is a short fixed window. */
  endT: number
}

/** Gunfire shot (used to draw the tracer). */
export interface ShotEvent extends BaseEvent {
  type: 'shot'
  /** Shooter position (game units). */
  x: number
  y: number
  /** Aim direction at the shot (degrees). */
  yaw: number
}

export type GameEvent = KillEvent | BombEvent | GrenadeEvent | ShotEvent

// ------------------------------------------------------------------ voice / comms

/**
 * Player voice extracted from the demo (in-game comms). Each packet is a raw
 * Opus frame (48kHz mono), positioned by absolute demo tick. The viewer decodes
 * and syncs it with gameplay: a packet at tick T plays at `T / tickRate` seconds
 * (same reference as the rounds' `startTick`/`endTick`).
 *
 * It comes outside `Replay` because it is binary (does not serialize to JSON);
 * the parser delivers the two side by side.
 */
export interface VoiceData {
  /** Packet sample rate (typically 48000). */
  sampleRate: number
  /** Demo tick rate: tick T equals `T / tickRate` seconds. */
  tickRate: number
  /** One track per player who spoke in the match. */
  tracks: VoiceTrack[]
}

export interface VoiceTrack {
  /** Speaker steamId64 (matches `PlayerMeta.steamId`). */
  steamId: string
  /** Opus packets in ascending tick order. */
  packets: VoicePacket[]
}

export interface VoicePacket {
  /** Absolute demo tick when the speech happened. */
  tick: number
  /** Speech level (voice_level) in dB; feeds the waveform. Closer to 0 is louder.
   *  Absent in demos parsed before the CLV2 format. */
  level?: number
  /** Raw Opus frame, directly decodable (48kHz mono). */
  data: Uint8Array
}
