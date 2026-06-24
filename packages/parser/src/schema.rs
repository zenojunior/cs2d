//! Output types for the replay JSON (the `replay-schema 2D` contract).
//!
//! Plain serde structs; optional fields are skipped when empty to match the
//! shape the offline parser produced. They are built in `crate::assemble` and
//! `crate::collector`, so the types and their fields are `pub(crate)`.

use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Replay {
    pub(crate) map: String,
    pub(crate) demo_tick_rate: u32,
    pub(crate) frame_rate: u32,
    pub(crate) players: Vec<PlayerMeta>,
    pub(crate) rounds: Vec<Round>,
    pub(crate) final_score_ct: i32,
    pub(crate) final_score_t: i32,
    pub(crate) final_ct_name: String,
    pub(crate) final_t_name: String,
    /// Match pauses (tactical timeouts and admin/tech pauses), in absolute ticks.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) pauses: Vec<Pause>,
    pub(crate) generated_by: String,
}

/// A pause in the match (the game rules went into timeout / waiting-for-resume).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Pause {
    pub(crate) start_tick: u32,
    pub(crate) end_tick: u32,
    /// "tactical" (a team timeout) or "technical" (admin / tech pause).
    pub(crate) kind: String,
    /// Side that called a tactical timeout ("CT"/"T"); absent for technical.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) side: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerMeta {
    pub(crate) steam_id: String,
    pub(crate) name: String,
    pub(crate) start_side: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Round {
    pub(crate) number: u32,
    /// Freeze/buy-period start. The round timeline (frame/event `t`) is measured
    /// from here, so `t = 0` is the start of freeze time.
    pub(crate) freeze_start_tick: u32,
    /// Playable start (round goes live, after freeze time).
    pub(crate) start_tick: u32,
    /// Moment the round was decided (win-status flip). Between this and
    /// `end_tick` is the post-round period (reactions / comms).
    pub(crate) decided_tick: u32,
    /// Official end of the round (round_officially_ended).
    pub(crate) end_tick: u32,
    /// End of the round's window (start of the next round's freeze, or the last
    /// sampled tick for the final round). Covers the post-round period.
    pub(crate) post_end_tick: u32,
    pub(crate) winner: Option<String>,
    pub(crate) reason: Option<String>,
    pub(crate) score_ct: i32,
    pub(crate) score_t: i32,
    pub(crate) ct_name: String,
    pub(crate) t_name: String,
    /// Health damage per player (steamId -> total) in this round.
    pub(crate) damage: HashMap<String, i32>,
    /// Utility (HE + molotov/incendiary) health damage per player (steamId ->
    /// total) in this round. A subset of `damage`, kept separately for the
    /// utility impact view.
    pub(crate) utility_damage: HashMap<String, i32>,
    pub(crate) frames: Vec<Frame>,
    pub(crate) events: Vec<Event>,
    pub(crate) bomb: Vec<BombKeyframe>,
    pub(crate) grenade_paths: Vec<GrenadePath>,
    pub(crate) blinds: Vec<Blind>,
    pub(crate) chat: Vec<ChatMsg>,
    pub(crate) defuses: Vec<Defuse>,
    pub(crate) ground_weapons: Vec<GroundWeapon>,
}

/// A weapon/grenade dropped on the ground, shown as its icon on the map while it
/// lies there (from `start_t` until picked up or the round ends, `end_t`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroundWeapon {
    /// Icon label, same vocabulary as `PlayerState.weapon` (e.g. "AK-47", "Smoke").
    pub(crate) label: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    /// Height (Z), for the multi-floor level filter (mirrors players).
    pub(crate) z: f64,
    pub(crate) start_t: f64,
    pub(crate) end_t: f64,
}

/// One defuse attempt: from start to end (completed or aborted). The viewer
/// animates progress from start_t to start_t + duration (5s with kit, 10s without).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Defuse {
    pub(crate) start_t: f64,
    pub(crate) end_t: f64,
    /// Completed (true) or interrupted (false).
    pub(crate) defused: bool,
    pub(crate) has_kit: bool,
    pub(crate) steam_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatMsg {
    pub(crate) t: f64,
    pub(crate) tick: u32,
    pub(crate) name: String,
    pub(crate) text: String,
    pub(crate) team_only: bool,
    pub(crate) steam_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct Frame {
    pub(crate) tick: u32,
    pub(crate) t: f64,
    pub(crate) players: Vec<PlayerState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerState {
    pub(crate) steam_id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    /// Height (Z axis, game units). Feeds the heatmap level filter on
    /// multi-floor maps (e.g. Nuke, Vertigo).
    pub(crate) z: f64,
    pub(crate) yaw: f64,
    pub(crate) health: i32,
    pub(crate) alive: bool,
    pub(crate) side: String,
    pub(crate) weapon: String,
    /// The player's main gun stowed in the inventory (rifle/SMG/sniper/shotgun/MG,
    /// or a pistol if that's all they carry). Lets the UI keep showing the real
    /// weapon while the player has their knife out. Empty when they hold only a
    /// knife/grenades/C4/Zeus.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) primary: String,
    pub(crate) money: i32,
    /// Current equipment value (weapons + utility + armor). Sampled per frame;
    /// the economy view reads it on the first live frame of the round to derive
    /// the team's buy (eco / force / full).
    pub(crate) equip_value: i32,
    pub(crate) armor: i32,
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) helmet: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) defuser: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) grenades: Vec<String>,
}

// Events. We flatten the types into an enum serialized by `type` (tagged), like
// the schema GameEvent (a union discriminated by `type`).
#[derive(Serialize)]
#[serde(tag = "type")]
pub(crate) enum Event {
    #[serde(rename = "kill", rename_all = "camelCase")]
    Kill {
        tick: u32,
        t: f64,
        attacker_steam_id: Option<String>,
        victim_steam_id: String,
        assister_steam_id: Option<String>,
        assisted_flash: bool,
        weapon: String,
        headshot: bool,
        x: f64,
        y: f64,
        z: f64,
    },
    #[serde(rename = "bomb_planted", rename_all = "camelCase")]
    BombPlanted { tick: u32, t: f64, player_steam_id: Option<String> },
    #[serde(rename = "bomb_defused", rename_all = "camelCase")]
    BombDefused { tick: u32, t: f64, player_steam_id: Option<String> },
    #[serde(rename = "bomb_exploded", rename_all = "camelCase")]
    BombExploded { tick: u32, t: f64, player_steam_id: Option<String> },
    #[serde(rename = "shot", rename_all = "camelCase")]
    Shot { tick: u32, t: f64, x: f64, y: f64, yaw: f64 },
    #[serde(rename = "grenade", rename_all = "camelCase")]
    Grenade {
        tick: u32,
        t: f64,
        kind: String,
        x: f64,
        y: f64,
        z: f64,
        /// End of the effect (s since the round start).
        end_t: f64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BombKeyframe {
    pub(crate) t: f64,
    pub(crate) state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) y: Option<f64>,
    /// Height (Z axis), for the multi-floor level filter (dropped/planted C4).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) z: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) carrier_steam_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrenadePath {
    pub(crate) kind: String,
    pub(crate) points: Vec<GrenadePoint>,
    /// Who threw the grenade (steamId64), when resolved. Lets the grenades finder
    /// filter by player/side; null when undetermined.
    pub(crate) thrower_steam_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct GrenadePoint {
    pub(crate) t: f64,
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Blind {
    pub(crate) t: f64,
    pub(crate) duration: f64,
    /// The blinded player (victim).
    pub(crate) steam_id: String,
    /// Who threw the flash, resolved from the event's attacker pawn (None when
    /// the parser could not resolve it). Lets the impact view attribute
    /// "enemies flashed" to a player.
    pub(crate) flasher_steam_id: Option<String>,
}

pub(crate) fn is_false(b: &bool) -> bool {
    !*b
}
