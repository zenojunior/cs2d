//! CS2 demo parser in WebAssembly.
//!
//! Reads the bytes of a `.dem` (CS2 / Source 2) and emits the `Replay` JSON in
//! the `replay-schema 2D` format, the same contract the 2D viewer consumes. Runs
//! in the browser inside a Web Worker; no data leaves the machine.
//!
//! Uses `source2-demo` (a streaming, event-driven parser), so memory usage stays
//! well below the wasm32 4 GB ceiling, even on long demos.

use serde::Serialize;
use source2_demo::prelude::*;
use source2_demo::proto::{
    CSvcMsgServerInfo, CSvcMsgVoiceData, CSvcMsgVoiceInit, CUserMessageSayText2,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

const DEMO_TICK_RATE: f64 = 64.0;
const GENERATED_BY: &str = "cs2-demo-parser-wasm@0.0.0";

// ------------------------------------------------------------------ schema ---
// Mirrors the replay-schema 2D. Optional fields are omitted when empty
// (skip_serializing_if) to match the JSON the offline parser produced.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Replay {
    map: String,
    demo_tick_rate: u32,
    frame_rate: u32,
    players: Vec<PlayerMeta>,
    rounds: Vec<Round>,
    final_score_ct: i32,
    final_score_t: i32,
    final_ct_name: String,
    final_t_name: String,
    generated_by: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerMeta {
    steam_id: String,
    name: String,
    start_side: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Round {
    number: u32,
    /// Freeze/buy-period start. The round timeline (frame/event `t`) is measured
    /// from here, so `t = 0` is the start of freeze time.
    freeze_start_tick: u32,
    /// Playable start (round goes live, after freeze time).
    start_tick: u32,
    /// Moment the round was decided (win-status flip). Between this and
    /// `end_tick` is the post-round period (reactions / comms).
    decided_tick: u32,
    /// Official end of the round (round_officially_ended).
    end_tick: u32,
    /// End of the round's window (start of the next round's freeze, or the last
    /// sampled tick for the final round). Covers the post-round period.
    post_end_tick: u32,
    winner: Option<String>,
    reason: Option<String>,
    score_ct: i32,
    score_t: i32,
    ct_name: String,
    t_name: String,
    /// Health damage per player (steamId -> total) in this round.
    damage: HashMap<String, i32>,
    frames: Vec<Frame>,
    events: Vec<Event>,
    bomb: Vec<BombKeyframe>,
    grenade_paths: Vec<GrenadePath>,
    blinds: Vec<Blind>,
    chat: Vec<ChatMsg>,
    defuses: Vec<Defuse>,
    ground_weapons: Vec<GroundWeapon>,
}

/// A weapon/grenade dropped on the ground, shown as its icon on the map while it
/// lies there (from `start_t` until picked up or the round ends, `end_t`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroundWeapon {
    /// Icon label, same vocabulary as `PlayerState.weapon` (e.g. "AK-47", "Smoke").
    label: String,
    x: f64,
    y: f64,
    /// Height (Z), for the multi-floor level filter (mirrors players).
    z: f64,
    start_t: f64,
    end_t: f64,
}

/// One defuse attempt: from start to end (completed or aborted). The viewer
/// animates progress from start_t to start_t + duration (5s with kit, 10s without).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Defuse {
    start_t: f64,
    end_t: f64,
    /// Completed (true) or interrupted (false).
    defused: bool,
    has_kit: bool,
    steam_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMsg {
    t: f64,
    tick: u32,
    name: String,
    text: String,
    team_only: bool,
    steam_id: Option<String>,
}

#[derive(Serialize)]
struct Frame {
    tick: u32,
    t: f64,
    players: Vec<PlayerState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerState {
    steam_id: String,
    x: f64,
    y: f64,
    /// Height (Z axis, game units). Feeds the heatmap level filter on
    /// multi-floor maps (e.g. Nuke, Vertigo).
    z: f64,
    yaw: f64,
    health: i32,
    alive: bool,
    side: String,
    weapon: String,
    money: i32,
    /// Current equipment value (weapons + utility + armor). Sampled per frame;
    /// the economy view reads it on the first live frame of the round to derive
    /// the team's buy (eco / force / full).
    equip_value: i32,
    armor: i32,
    #[serde(skip_serializing_if = "is_false")]
    helmet: bool,
    #[serde(skip_serializing_if = "is_false")]
    defuser: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    grenades: Vec<String>,
}

// Events. We flatten the types into an enum serialized by `type` (tagged), like
// the schema GameEvent (a union discriminated by `type`).
#[derive(Serialize)]
#[serde(tag = "type")]
enum Event {
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
struct BombKeyframe {
    t: f64,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    carrier_steam_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrenadePath {
    kind: String,
    points: Vec<GrenadePoint>,
    /// Who threw the grenade (steamId64), when resolved. Lets the grenades finder
    /// filter by player/side; null when undetermined.
    thrower_steam_id: Option<String>,
}

#[derive(Serialize)]
struct GrenadePoint {
    t: f64,
    x: f64,
    y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Blind {
    t: f64,
    duration: f64,
    steam_id: String,
}

fn is_false(b: &bool) -> bool {
    !*b
}

// ------------------------------------------------------- accumulators ---

struct RawFrame {
    tick: u32,
    players: Vec<PlayerState>,
}

enum RawEvent {
    Kill {
        tick: u32,
        attacker: Option<String>,
        victim: String,
        assister: Option<String>,
        assisted_flash: bool,
        weapon: String,
        headshot: bool,
        x: f64,
        y: f64,
        z: f64,
    },
    Bomb {
        tick: u32,
        kind: BombKind,
        player: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
    },
}

#[derive(Clone, Copy)]
enum BombKind {
    Planted,
    Defused,
    Exploded,
}

#[derive(Clone, Copy, PartialEq)]
enum GrenadeKind {
    Smoke,
    Fire,
    He,
    Flash,
    Decoy,
}

impl GrenadeKind {
    fn as_str(self) -> &'static str {
        match self {
            GrenadeKind::Smoke => "smoke",
            GrenadeKind::Fire => "fire",
            GrenadeKind::He => "he",
            GrenadeKind::Flash => "flash",
            GrenadeKind::Decoy => "decoy",
        }
    }
    /// Fixed window (s) for instant grenades (smoke/fire use the end pair).
    fn instant_duration(self) -> f64 {
        match self {
            GrenadeKind::He | GrenadeKind::Decoy => 0.5,
            GrenadeKind::Flash => 0.4,
            _ => 0.0,
        }
    }
}

/// Sampled C4 state (CC4 entity): carried by someone or on the ground.
#[derive(Clone, PartialEq)]
enum C4Sample {
    Carried(String),
    Ground(f64, f64),
}

#[derive(Default)]
struct Collector {
    map_name: String,
    meta_order: Vec<String>,
    meta: HashMap<String, PlayerMeta>,
    /// Freeze-time start of each round (`round_start`, outside warmup). The buy
    /// period runs from here to the matching `freeze_ends` tick.
    round_starts: Vec<u32>,
    /// Playable start of each round (outside warmup).
    freeze_ends: Vec<u32>,
    /// Official round end: (tick, winner, reason) read from the game rules.
    official_ends: Vec<(u32, Option<String>, Option<String>)>,
    /// Round ends synthesized from the game-rules win status flipping 0 -> non-zero,
    /// captured each tick. Fallback for demos that never emit `round_officially_ended`
    /// (some tournament GOTV recordings). Same shape as `official_ends`.
    synth_ends: Vec<(u32, Option<String>, Option<String>)>,
    /// Last seen `m_iRoundWinStatus` (0 = round in progress), to detect the flip.
    prev_win_status: i32,
    /// Grenade detonations: (tick, kind, entityid, x, y) in world coords.
    grenade_dets: Vec<(u32, GrenadeKind, i32, f64, f64, f64)>,
    /// Smoke/fire end: (entityid, tick), matched by entityid at build time.
    grenade_ends: Vec<(i32, u32)>,
    /// Projectile flight points: (entity index, tick, kind, x, y).
    proj_points: Vec<(u32, u32, GrenadeKind, f64, f64, Option<String>)>,
    /// C4 state per sampled tick (carried/on ground), for keyframes.
    c4_samples: Vec<(u32, C4Sample)>,
    /// Dropped item samples: (entity index, tick, label, x, y, z). Grouped into
    /// ground-weapon intervals at build time.
    ground_samples: Vec<(u32, u32, String, f64, f64, f64)>,
    /// Final round winner (the deciding one does not emit round_officially_ended).
    final_winner: Option<String>,
    final_reason: Option<String>,
    /// Per-team score (CT, T) entering each round, keyed by freeze_end tick.
    round_scores: HashMap<u32, (i32, i32)>,
    /// Clan name (CT, T) entering each round, keyed by freeze_end tick.
    round_names: HashMap<u32, (String, String)>,
    /// Final per-team score (CT, T), read at the end of the match.
    final_score: Option<(i32, i32)>,
    /// Final team names (CT, T), read at the end of the match.
    final_names: Option<(String, String)>,
    /// Damage: (tick, attacker steamId, health damage). Aggregated per round at build.
    hurts: Vec<(u32, String, i32)>,
    /// Shots (tracers): (tick, x, y, yaw) of the shooter.
    shots: Vec<(u32, f64, f64, f64)>,
    /// Blinds: (tick, userid, duration). The steamId comes from the userid->steam map.
    blinds_raw: Vec<(u32, i32, f64)>,
    /// Chat: (tick, name, text, team-only). The steamId is resolved by name at build.
    chats: Vec<(u32, String, String, bool)>,
    /// Defuse start: (tick, userid, has_kit). steamId resolved via userid.
    defuse_begins: Vec<(u32, i32, bool)>,
    /// Defuse end: (tick, completed). Abort = false; bomb_defused = true.
    defuse_ends: Vec<(u32, bool)>,
    /// userid (game event slot) -> steamId, built from events that carry both.
    userid_to_steam: HashMap<i32, String>,
    frames: Vec<RawFrame>,
    events: Vec<RawEvent>,
    /// Pawn entity index -> steamId, refreshed every tick.
    pawn_to_steam: HashMap<u32, String>,
    last_cap: u32,
    tick_step: u32,
    /// Total demo ticks (from the file header), used as the progress denominator.
    total_ticks: u32,
    /// Last tick a progress update was emitted, to throttle the callback.
    last_progress_tick: u32,
    /// Progress sink (used by the wasm build): `(stage, current_tick, total_ticks)`.
    /// Stage 0 = parsing, reported per-tick from `on_tick_start`; later stages are
    /// reported by `parse_all` once the tick loop is done.
    progress: Option<Box<dyn FnMut(u32, u32, u32)>>,
    /// Voice/comms: raw Opus packets per speaker, in absolute demo ticks.
    /// (steamId, tick, voice_level, Opus packet). Each packet is an Opus frame
    /// decodable directly (48kHz mono) in the browser; no Steam SDK needed.
    /// The voice_level (speech amplitude, from the packet itself) feeds the waveform.
    voice: Vec<(String, u32, f32, Vec<u8>)>,
    /// Sample rate declared in the voice packets (typically 48000).
    voice_sample_rate: u32,
    /// Codec declared in VoiceInit (e.g. "vaudio_speex", a legacy/misleading string;
    /// the real packet format is checked per message).
    voice_codec: String,
    /// Voice packets in non-OPUS format, discarded (not decodable without the
    /// Steam SDK). Kept for diagnostics only.
    voice_non_opus: u32,
}

fn side_of(team: i32) -> Option<&'static str> {
    match team {
        3 => Some("CT"),
        2 => Some("T"),
        _ => None,
    }
}

fn round1(n: f64) -> f64 {
    (n * 10.0).round() / 10.0
}

fn prop_i32(e: &Entity, name: &str) -> i32 {
    match e.get_property_by_name(name) {
        Ok(FieldValue::Signed32(v)) => *v,
        Ok(FieldValue::Signed16(v)) => *v as i32,
        Ok(FieldValue::Signed8(v)) => *v as i32,
        Ok(FieldValue::Unsigned32(v)) => *v as i32,
        Ok(FieldValue::Unsigned16(v)) => *v as i32,
        Ok(FieldValue::Unsigned8(v)) => *v as i32,
        _ => 0,
    }
}

fn prop_bool(e: &Entity, name: &str) -> bool {
    matches!(e.get_property_by_name(name), Ok(FieldValue::Boolean(true)))
}

fn prop_u64(e: &Entity, name: &str) -> u64 {
    match e.get_property_by_name(name) {
        Ok(FieldValue::Unsigned64(v)) => *v,
        Ok(FieldValue::Unsigned32(v)) => *v as u64,
        _ => 0,
    }
}

fn prop_u32(e: &Entity, name: &str) -> u32 {
    match e.get_property_by_name(name) {
        Ok(FieldValue::Unsigned32(v)) => *v,
        Ok(FieldValue::Unsigned16(v)) => *v as u32,
        _ => 0,
    }
}

/// World coordinate from the pawn cell + offset pair (CS2).
fn world_coord(e: &Entity, cell: &str, vec: &str) -> f64 {
    let c = match e.get_property_by_name(cell) {
        Ok(FieldValue::Unsigned16(v)) => *v as f64,
        Ok(FieldValue::Unsigned8(v)) => *v as f64,
        _ => 0.0,
    };
    let v = match e.get_property_by_name(vec) {
        Ok(FieldValue::Float(v)) => *v as f64,
        _ => 0.0,
    };
    // CS2 world coordinate: cell * cell_width - MAX_COORD + offset.
    // Cell width = 1<<9 (512); MAX_COORD = 1<<14 (16384).
    c * 512.0 - 16384.0 + v
}

/// Aim yaw (degrees): m_angEyeAngles is a Vector3D [pitch, yaw, roll]. The value
/// comes 180 degrees off from the convention the viewer expects (validated against
/// movement direction and the offline parser format), so we correct it here.
fn pawn_yaw(e: &Entity) -> f64 {
    match e.get_property_by_name("m_angEyeAngles") {
        Ok(FieldValue::Vector3D(a)) => {
            let mut y = a[1] as f64 + 180.0;
            if y > 180.0 {
                y -= 360.0;
            }
            y
        }
        _ => 0.0,
    }
}

/// Short weapon label from a raw name (entity class or event name). Covers knives
/// (-> "Faca"), grenades and the most common weapons; the rest passes through. Matches
/// the labels the viewer already knew.
fn weapon_label(raw: &str) -> String {
    let s = raw.to_lowercase();
    let knife = [
        "knife", "bayonet", "karambit", "huntsman", "falchion", "bowie", "butterfly", "daggers",
        "navaja", "stiletto", "ursus", "talon", "paracord", "survival", "nomad", "skeleton",
        "kukri", "flip", "gut",
    ];
    if knife.iter().any(|k| s.contains(k)) {
        return "Faca".into();
    }
    // Grenades must match the labels the viewer filters/draws
    // ("HE", "Smoke", "Flash", "Molotov", "Decoy"); checked first.
    let grenades: &[(&str, &str)] = &[
        ("hegrenade", "HE"),
        ("smokegrenade", "Smoke"),
        ("flashbang", "Flash"),
        ("incendiary", "Molotov"),
        ("incgrenade", "Molotov"),
        ("molotov", "Molotov"),
        ("decoy", "Decoy"),
    ];
    for (needle, label) in grenades {
        if s.contains(needle) {
            return (*label).into();
        }
    }
    // Weapons: return the DISPLAY NAME that weaponIconPath (FILE table)
    // recognizes. Order matters (specific variants before generic ones).
    let guns: &[(&str, &str)] = &[
        ("deagle", "Deagle"),
        ("revolver", "R8 Revolver"),
        ("elite", "Dual Berettas"),
        ("fiveseven", "Five-SeveN"),
        ("glock", "Glock-18"),
        ("usp_silencer", "USP-S"),
        ("usp", "USP-S"),
        ("hkp2000", "P2000"),
        ("p250", "P250"),
        ("tec9", "Tec-9"),
        ("cz75", "CZ75-Auto"),
        ("mp5sd", "MP5-SD"),
        ("mp5", "MP5-SD"),
        ("mp7", "MP7"),
        ("mp9", "MP9"),
        ("mac10", "MAC-10"),
        ("ump", "UMP-45"),
        ("p90", "P90"),
        ("bizon", "PP-Bizon"),
        ("ak47", "AK-47"),
        ("galilar", "Galil AR"),
        ("galil", "Galil AR"),
        ("scar20", "SCAR-20"),
        ("g3sg1", "G3SG1"),
        ("ssg08", "SSG 08"),
        ("awp", "AWP"),
        ("aug", "AUG"),
        ("sg556", "SG 553"),
        ("sg553", "SG 553"),
        ("famas", "FAMAS"),
        ("m4a1_silencer", "M4A1-S"),
        ("m4a1s", "M4A1-S"),
        ("m4a4", "M4A4"),
        ("m4a1", "M4A4"),
        ("nova", "Nova"),
        ("mag7", "MAG-7"),
        ("sawedoff", "Sawed-Off"),
        ("xm1014", "XM1014"),
        ("negev", "Negev"),
        ("m249", "M249"),
        ("taser", "Zeus x27"),
        ("zeus", "Zeus x27"),
        ("c4", "C4"),
    ];
    for (needle, label) in guns {
        if s.contains(needle) {
            return (*label).into();
        }
    }
    String::new()
}

/// Grenade type from the in-flight projectile entity class.
fn proj_kind(class: &str) -> Option<GrenadeKind> {
    match class {
        "CSmokeGrenadeProjectile" => Some(GrenadeKind::Smoke),
        "CMolotovProjectile" => Some(GrenadeKind::Fire),
        "CHEGrenadeProjectile" => Some(GrenadeKind::He),
        "CFlashbangProjectile" => Some(GrenadeKind::Flash),
        "CDecoyProjectile" => Some(GrenadeKind::Decoy),
        _ => None,
    }
}

/// Grenades in the pawn inventory, as short labels (HE, Smoke, Flash, ...).
fn grenade_inventory(ctx: &Context, pawn: &Entity) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Ok(it) = pawn.get_iter("m_pWeaponServices.m_hMyWeapons") {
        for h in it.flatten() {
            let hv: usize = match h.try_into() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Ok(w) = ctx.entities().get_by_handle(hv) {
                let label = weapon_label(w.class().name());
                if matches!(label.as_str(), "HE" | "Smoke" | "Flash" | "Molotov" | "Decoy")
                    && !out.contains(&label)
                {
                    out.push(label);
                }
            }
        }
    }
    out
}

/// Resolves a pawn active weapon into the short label.
fn active_weapon_label(ctx: &Context, pawn: &Entity) -> String {
    let handle = prop_u32(pawn, "m_pWeaponServices.m_hActiveWeapon");
    if handle == 0 || handle == u32::MAX {
        return String::new();
    }
    match ctx.entities().get_by_handle(handle as usize) {
        Ok(w) => {
            let label = weapon_label(w.class().name());
            // USP-S and P2000 share the CWeaponHKP2000 class; the item definition
            // index distinguishes them (61 = USP-S, 32 = P2000).
            if label == "P2000" && prop_u32(w, "m_iItemDefinitionIndex") == 61 {
                "USP-S".into()
            } else {
                label
            }
        }
        Err(_) => String::new(),
    }
}

/// steamId of a pawn referenced by an event handle (userid_pawn etc.).
fn steam_from_pawn_handle(c: &Collector, ctx: &Context, handle: i32) -> Option<String> {
    let h = handle as u32 as usize;
    let pawn = ctx.entities().get_by_handle(h).ok()?;
    c.pawn_to_steam.get(&pawn.index()).cloned()
}

/// Reads an i32 property from the game rules (CCSGameRulesProxy entity).
fn gamerules_i32(ctx: &Context, name: &str) -> Option<i32> {
    let proxy = ctx.entities().get_by_class_name("CCSGameRulesProxy").ok()?;
    match proxy.get_property_by_name(name) {
        Ok(FieldValue::Signed32(v)) => Some(*v),
        Ok(FieldValue::Unsigned32(v)) => Some(*v as i32),
        _ => None,
    }
}

/// Per-TEAM score (CT, T) read from the CCSTeam entities. m_iScore is the team
/// total (follows side switches), so slot 3 = current CT, slot 2 = current T.
fn team_scores(ctx: &Context) -> (i32, i32) {
    let (mut ct, mut t) = (0, 0);
    for e in ctx.entities().iter() {
        if e.class().name() != "CCSTeam" {
            continue;
        }
        let team = prop_i32(e, "m_iTeamNum");
        let score = prop_i32(e, "m_iScore");
        match team {
            3 => ct = score,
            2 => t = score,
            _ => {}
        }
    }
    (ct, t)
}

/// Per-TEAM clan name (CT, T) from the CCSTeam entities. Strips the "team_" prefix
/// PUGs/FACEIT use (e.g. "team_togs" -> "togs").
fn team_names(ctx: &Context) -> (String, String) {
    let (mut ct, mut t) = (String::new(), String::new());
    for e in ctx.entities().iter() {
        if e.class().name() != "CCSTeam" {
            continue;
        }
        let team = prop_i32(e, "m_iTeamNum");
        let name = match e.get_property_by_name("m_szClanTeamname") {
            Ok(FieldValue::String(s)) => s.trim_start_matches("team_").to_string(),
            _ => String::new(),
        };
        match team {
            3 => ct = name,
            2 => t = name,
            _ => {}
        }
    }
    (ct, t)
}

/// Whether the game is in the warmup period.
fn in_warmup(ctx: &Context) -> bool {
    let proxy = match ctx.entities().get_by_class_name("CCSGameRulesProxy") {
        Ok(p) => p,
        Err(_) => return false,
    };
    matches!(
        proxy.get_property_by_name("m_pGameRules.m_bWarmupPeriod"),
        Ok(FieldValue::Boolean(true))
    )
}

fn ev_i32(ge: &GameEvent, key: &str) -> Option<i32> {
    ge.get_value(key).ok().and_then(|v| v.try_into().ok())
}

fn ev_f32(ge: &GameEvent, key: &str) -> f64 {
    ge.get_value(key)
        .ok()
        .and_then(|v| TryInto::<f32>::try_into(v).ok())
        .map(|f| f as f64)
        .unwrap_or(0.0)
}

fn ev_str(ge: &GameEvent, key: &str) -> Option<String> {
    ge.get_value(key)
        .ok()
        .and_then(|v| TryInto::<String>::try_into(v).ok())
}

fn ev_bool(ge: &GameEvent, key: &str) -> bool {
    ge.get_value(key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .unwrap_or(false)
}

#[observer]
#[uses_all]
impl Collector {
    // The map name comes in ServerInfo, right at the start of the demo.
    #[on_message]
    fn on_server_info(&mut self, _ctx: &Context, msg: CSvcMsgServerInfo) -> ObserverResult {
        if let Some(m) = msg.map_name {
            if !m.is_empty() {
                // May arrive as a path (e.g. "workshop/123/de_x"); keep just the name.
                self.map_name = m.rsplit('/').next().unwrap_or(&m).to_string();
            }
        }
        Ok(())
    }

    // Match chat (typed text). param1 = name, param2 = text. The scope
    // (all vs team) comes from messagename: the "all" ones contain "All".
    #[on_message]
    fn on_chat(&mut self, ctx: &Context, msg: CUserMessageSayText2) -> ObserverResult {
        let text = msg.param2.unwrap_or_default();
        if text.is_empty() {
            return Ok(());
        }
        let name = msg.param1.unwrap_or_default();
        let team_only = !msg.messagename.unwrap_or_default().contains("All");
        self.chats.push((ctx.tick(), name, text, team_only));
        Ok(())
    }

    // Voice codec declaration, once at signon. The string is legacy
    // ("vaudio_speex") and does not reflect the real format; kept for diagnostics only.
    #[on_message]
    fn on_voice_init(&mut self, _ctx: &Context, msg: CSvcMsgVoiceInit) -> ObserverResult {
        if let Some(codec) = msg.codec {
            if !codec.is_empty() {
                self.voice_codec = codec;
            }
        }
        Ok(())
    }

    // Each svc_VoiceData carries a snippet of a player speaking. In current CS2 the
    // format is OPUS (48kHz mono, one packet per message). We store the raw packet
    // by steamId (= xuid) and absolute tick, for the browser to decode and sync.
    #[on_message]
    fn on_voice_data(&mut self, ctx: &Context, msg: CSvcMsgVoiceData) -> ObserverResult {
        let tick = ctx.tick();
        if tick == u32::MAX {
            return Ok(());
        }
        let audio = match msg.audio {
            Some(a) => a,
            None => return Ok(()),
        };
        // VOICEDATA_FORMAT_OPUS = 2. Other formats (STEAM/ENGINE) would need the
        // Steam SDK to decode, so we just count and ignore them.
        if audio.format != Some(2) {
            self.voice_non_opus += 1;
            return Ok(());
        }
        let data = match audio.voice_data {
            Some(d) if !d.is_empty() => d,
            _ => return Ok(()),
        };
        if let Some(sr) = audio.sample_rate {
            if sr != 0 {
                self.voice_sample_rate = sr;
            }
        }
        // The xuid is the speaker steamID64, same identifier as gameplay.
        let steam = match msg.xuid {
            Some(x) if x != 0 => x.to_string(),
            _ => return Ok(()),
        };
        // Speech amplitude in this packet (feeds the timeline waveform).
        let level = audio.voice_level.unwrap_or(0.0);
        self.voice.push((steam, tick, level, data));
        Ok(())
    }

    #[on_tick_start]
    fn on_tick_start(&mut self, ctx: &Context) -> ObserverResult {
        let tick = ctx.tick();
        if tick == u32::MAX {
            return Ok(());
        }

        // Emit throttled parse progress (stage 0) so the UI can show a real bar.
        if self.total_ticks > 0
            && tick.wrapping_sub(self.last_progress_tick) >= PROGRESS_TICK_INTERVAL
        {
            self.last_progress_tick = tick;
            let total = self.total_ticks;
            if let Some(cb) = self.progress.as_mut() {
                cb(0, tick.min(total), total);
            }
        }

        // Refresh the pawn -> steamId map every tick (the pawn is recreated per
        // round, so keeping the map fresh ensures events get the right steamId).
        self.pawn_to_steam.clear();
        for ctrl in ctx.entities().iter() {
            if ctrl.class().name() != "CCSPlayerController" {
                continue;
            }
            let handle = prop_u32(ctrl, "m_hPlayerPawn");
            if let Ok(pawn) = ctx.entities().get_by_handle(handle as usize) {
                let steam = prop_u64(ctrl, "m_steamID");
                if steam != 0 {
                    self.pawn_to_steam.insert(pawn.index(), steam.to_string());
                }
            }
        }

        // Detect round ends from the game-rules win status (every tick, not just
        // sampled frames). m_iRoundWinStatus is 0 while the round is live and flips
        // to the winning side's team number the instant the round is decided, then
        // resets to 0 at the next freeze. Recording the 0 -> non-zero flip gives an
        // authoritative, side-switch-immune winner per round. Used as a fallback for
        // demos with no `round_officially_ended` event; see build below.
        let win_status = gamerules_i32(ctx, "m_pGameRules.m_iRoundWinStatus").unwrap_or(0);
        if win_status != 0 && self.prev_win_status == 0 && !in_warmup(ctx) {
            let winner = side_of(win_status).map(|s| s.to_string());
            let reason =
                gamerules_i32(ctx, "m_pGameRules.m_eRoundWinReason").map(|r| r.to_string());
            self.synth_ends.push((tick, winner, reason));
        }
        self.prev_win_status = win_status;

        // Frame downsample.
        if tick.wrapping_sub(self.last_cap) < self.tick_step && self.last_cap != 0 {
            return Ok(());
        }
        self.last_cap = tick;

        let mut players = Vec::with_capacity(10);
        for ctrl in ctx.entities().iter() {
            if ctrl.class().name() != "CCSPlayerController" {
                continue;
            }
            let steam = prop_u64(ctrl, "m_steamID");
            if steam == 0 {
                continue;
            }
            let steam_id = steam.to_string();
            let handle = prop_u32(ctrl, "m_hPlayerPawn");
            let pawn = match ctx.entities().get_by_handle(handle as usize) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let team = prop_i32(pawn, "m_iTeamNum");
            let side = match side_of(team) {
                Some(s) => s,
                None => continue,
            };

            // Metadata (name + starting side) the first time we see the player.
            if !self.meta.contains_key(&steam_id) {
                let name = ev_name(ctrl);
                self.meta_order.push(steam_id.clone());
                self.meta.insert(
                    steam_id.clone(),
                    PlayerMeta { steam_id: steam_id.clone(), name, start_side: side.into() },
                );
            }

            players.push(PlayerState {
                steam_id,
                x: round1(world_coord(pawn, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX")),
                y: round1(world_coord(pawn, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY")),
                z: round1(world_coord(pawn, "CBodyComponent.m_cellZ", "CBodyComponent.m_vecZ")),
                yaw: round1(pawn_yaw(pawn)),
                health: prop_i32(pawn, "m_iHealth"),
                alive: prop_i32(pawn, "m_lifeState") == 0,
                side: side.into(),
                weapon: active_weapon_label(ctx, pawn),
                money: prop_i32(ctrl, "m_pInGameMoneyServices.m_iAccount"),
                equip_value: prop_i32(pawn, "m_unCurrentEquipmentValue"),
                armor: prop_i32(pawn, "m_ArmorValue"),
                helmet: prop_bool(pawn, "m_pItemServices.m_bHasHelmet"),
                defuser: prop_bool(pawn, "m_pItemServices.m_bHasDefuser"),
                grenades: grenade_inventory(ctx, pawn),
            });
        }
        self.frames.push(RawFrame { tick, players });

        // Grenade projectile flight points on this sampled tick.
        for e in ctx.entities().iter() {
            if let Some(kind) = proj_kind(e.class().name()) {
                let x = world_coord(e, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX");
                let y = world_coord(e, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY");
                // Resolve the thrower now, while pawn_to_steam is valid for this
                // round (the map is cleared each round). Stored per point;
                // arc assembly takes the first known thrower of the segment.
                let thrower = steam_from_pawn_handle(self, ctx, prop_u32(e, "m_hThrower") as i32);
                self.proj_points
                    .push((e.index(), tick, kind, round1(x), round1(y), thrower));
            }
        }

        // C4 state (CC4): with a valid owner = carried; otherwise = on the ground. When
        // planted the entity becomes CPlantedC4 (no CC4), and the planted/gone
        // keyframes (events) take over.
        for e in ctx.entities().iter() {
            if e.class().name() != "CC4" {
                continue;
            }
            let owner = prop_u32(e, "m_hOwnerEntity");
            let sample = match ctx.entities().get_by_handle(owner as usize) {
                Ok(o) => match self.pawn_to_steam.get(&o.index()) {
                    Some(s) => C4Sample::Carried(s.clone()),
                    None => break, // owner with no resolved steam: skip this tick
                },
                Err(_) => C4Sample::Ground(
                    round1(world_coord(e, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX")),
                    round1(world_coord(e, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY")),
                ),
            };
            self.c4_samples.push((tick, sample));
            break;
        }

        // Dropped weapons/grenades on the ground (like the C4 ground case): an item
        // entity whose owner does not resolve to a pawn is lying on the floor. Held
        // items have a valid owner and no world position; in-flight grenades are
        // "*Projectile" classes (captured above) and are skipped. C4 and knives are
        // excluded (C4 has its own keyframes; knives are never dropped).
        for e in ctx.entities().iter() {
            let cls = e.class().name();
            if cls.ends_with("Projectile") {
                continue;
            }
            let label = weapon_label(cls);
            if label.is_empty() || label == "C4" || label == "Faca" {
                continue;
            }
            let owner = prop_u32(e, "m_hOwnerEntity");
            let on_ground = match ctx.entities().get_by_handle(owner as usize) {
                Ok(o) => !self.pawn_to_steam.contains_key(&o.index()),
                Err(_) => true,
            };
            if !on_ground {
                continue;
            }
            let x = world_coord(e, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX");
            let y = world_coord(e, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY");
            // (0,0) is the sentinel for an unpositioned (held/just-created) item.
            if x == 0.0 && y == 0.0 {
                continue;
            }
            let z = world_coord(e, "CBodyComponent.m_cellZ", "CBodyComponent.m_vecZ");
            self.ground_samples.push((
                e.index() as u32,
                tick,
                label,
                round1(x),
                round1(y),
                round1(z),
            ));
        }
        Ok(())
    }

    #[on_game_event]
    fn on_game_event(&mut self, ctx: &Context, ge: &GameEvent) -> ObserverResult {
        let tick = ctx.tick();

        // Feed the userid -> steamId map from events that carry both (player_blind
        // only has userid, so we need this bridge).
        if let (Some(uid), Some(ph)) = (ev_i32(ge, "userid"), ev_i32(ge, "userid_pawn")) {
            if !self.userid_to_steam.contains_key(&uid) {
                if let Some(s) = steam_from_pawn_handle(self, ctx, ph) {
                    self.userid_to_steam.insert(uid, s);
                }
            }
        }

        match ge.name() {
            "round_start" => {
                // Freeze/buy period begins. Ignore warmup (not a match round).
                if !in_warmup(ctx) {
                    self.round_starts.push(tick);
                }
            }
            "round_freeze_end" => {
                // Ignore warmup freezes (they are not match rounds).
                if !in_warmup(ctx) {
                    self.freeze_ends.push(tick);
                    // Team scores and names entering the round (by current side).
                    self.round_scores.insert(tick, team_scores(ctx));
                    self.round_names.insert(tick, team_names(ctx));
                }
            }
            "round_officially_ended" => {
                if in_warmup(ctx) {
                    return Ok(());
                }
                // Winner straight from the game rules (immune to side switches).
                let winner = gamerules_i32(ctx, "m_pGameRules.m_iRoundWinStatus")
                    .and_then(side_of)
                    .map(|s| s.to_string());
                let reason =
                    gamerules_i32(ctx, "m_pGameRules.m_eRoundWinReason").map(|r| r.to_string());
                self.official_ends.push((tick, winner, reason));
            }
            "cs_win_panel_match" => {
                // The deciding round ends the match without round_officially_ended;
                // its winner sits in the game rules status at this moment.
                self.final_winner = gamerules_i32(ctx, "m_pGameRules.m_iRoundWinStatus")
                    .and_then(side_of)
                    .map(|s| s.to_string());
                // Reason for the deciding round end (same code as round_officially_ended).
                self.final_reason =
                    gamerules_i32(ctx, "m_pGameRules.m_eRoundWinReason").map(|r| r.to_string());
                // Final scores and names (with the last round already counted).
                self.final_score = Some(team_scores(ctx));
                self.final_names = Some(team_names(ctx));
            }
            "player_hurt" => {
                let dmg = ev_i32(ge, "dmg_health").unwrap_or(0);
                if dmg <= 0 {
                    return Ok(());
                }
                let atk = ev_i32(ge, "attacker_pawn");
                // No self-damage (attacker == victim).
                if atk.is_none() || atk == ev_i32(ge, "userid_pawn") {
                    return Ok(());
                }
                if let Some(s) = atk.and_then(|h| steam_from_pawn_handle(self, ctx, h)) {
                    self.hurts.push((tick, s, dmg));
                }
            }
            "player_death" => {
                let victim = ev_i32(ge, "userid_pawn")
                    .and_then(|h| steam_from_pawn_handle(self, ctx, h));
                let victim = match victim {
                    Some(v) => v,
                    None => return Ok(()),
                };
                let attacker = ev_i32(ge, "attacker_pawn")
                    .and_then(|h| steam_from_pawn_handle(self, ctx, h));
                let assister = ev_i32(ge, "assister_pawn")
                    .and_then(|h| steam_from_pawn_handle(self, ctx, h));
                // Victim position: resolve the pawn and read its current position.
                let (mut x, mut y, mut z) = (0.0, 0.0, 0.0);
                if let Some(h) = ev_i32(ge, "userid_pawn") {
                    if let Ok(p) = ctx.entities().get_by_handle(h as u32 as usize) {
                        x = round1(world_coord(p, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX"));
                        y = round1(world_coord(p, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY"));
                        z = round1(world_coord(p, "CBodyComponent.m_cellZ", "CBodyComponent.m_vecZ"));
                    }
                }
                self.events.push(RawEvent::Kill {
                    tick,
                    attacker,
                    victim,
                    assister,
                    assisted_flash: ev_bool(ge, "assistedflash"),
                    // Raw event code (e.g. "ak47", "knife_butterfly"); the viewer
                    // resolves the kill icon from this code (KILL_FILE).
                    weapon: ev_str(ge, "weapon").unwrap_or_default(),
                    headshot: ev_bool(ge, "headshot"),
                    x,
                    y,
                    z,
                });
            }
            name @ ("bomb_planted" | "bomb_defused" | "bomb_exploded") => {
                let kind = match name {
                    "bomb_planted" => BombKind::Planted,
                    "bomb_defused" => BombKind::Defused,
                    _ => BombKind::Exploded,
                };
                // Defuse completed: close the matching defuse interval.
                if matches!(kind, BombKind::Defused) {
                    self.defuse_ends.push((tick, true));
                }
                let player = ev_i32(ge, "userid_pawn")
                    .and_then(|h| steam_from_pawn_handle(self, ctx, h));
                let (mut x, mut y) = (None, None);
                if matches!(kind, BombKind::Planted) {
                    if let Some(h) = ev_i32(ge, "userid_pawn") {
                        if let Ok(p) = ctx.entities().get_by_handle(h as u32 as usize) {
                            x = Some(round1(world_coord(p, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX")));
                            y = Some(round1(world_coord(p, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY")));
                        }
                    }
                }
                self.events.push(RawEvent::Bomb { tick, kind, player, x, y });
            }
            "bomb_begindefuse" => {
                if let Some(uid) = ev_i32(ge, "userid") {
                    self.defuse_begins.push((tick, uid, ev_bool(ge, "haskit")));
                }
            }
            "bomb_abortdefuse" => {
                self.defuse_ends.push((tick, false));
            }
            name @ ("smokegrenade_detonate" | "inferno_startburn" | "hegrenade_detonate"
            | "flashbang_detonate" | "decoy_detonate") => {
                let kind = match name {
                    "smokegrenade_detonate" => GrenadeKind::Smoke,
                    "inferno_startburn" => GrenadeKind::Fire,
                    "hegrenade_detonate" => GrenadeKind::He,
                    "flashbang_detonate" => GrenadeKind::Flash,
                    _ => GrenadeKind::Decoy,
                };
                let id = ev_i32(ge, "entityid").unwrap_or(0);
                self.grenade_dets
                    .push((tick, kind, id, ev_f32(ge, "x"), ev_f32(ge, "y"), ev_f32(ge, "z")));
            }
            "smokegrenade_expired" | "inferno_expire" => {
                let id = ev_i32(ge, "entityid").unwrap_or(0);
                self.grenade_ends.push((id, tick));
            }
            "weapon_fire" => {
                // Tracer only for bullet weapons (the demo has no bullet_impact).
                let w = ev_str(ge, "weapon").unwrap_or_default().to_lowercase();
                let skip = ["knife", "grenade", "flash", "smoke", "molotov", "incgrenade",
                    "inc_", "decoy", "c4", "bomb", "taser", "zeus", "healthshot"];
                if skip.iter().any(|s| w.contains(s)) {
                    return Ok(());
                }
                if let Some(ph) = ev_i32(ge, "userid_pawn") {
                    if let Ok(p) = ctx.entities().get_by_handle(ph as u32 as usize) {
                        let x = round1(world_coord(p, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX"));
                        let y = round1(world_coord(p, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY"));
                        self.shots.push((tick, x, y, round1(pawn_yaw(p))));
                    }
                }
            }
            "player_blind" => {
                let dur = ev_f32(ge, "blind_duration");
                if dur > 0.0 {
                    if let Some(uid) = ev_i32(ge, "userid") {
                        self.blinds_raw.push((tick, uid, dur));
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// Player name from the controller.
fn ev_name(ctrl: &Entity) -> String {
    match ctrl.get_property_by_name("m_iszPlayerName") {
        Ok(FieldValue::String(s)) => s.clone(),
        _ => String::new(),
    }
}

// ----------------------------------------------------------- assembly ------

fn build_replay(c: &Collector) -> Replay {
    // Build rounds from the official ends (authoritative: one per completed round,
    // with the winner from the game rules). Each round start is the round_freeze_end
    // immediately before the end (so spurious freezes, like the knife/restart round,
    // are naturally discarded).
    let mut freeze = c.freeze_ends.clone();
    freeze.sort_unstable();
    // Prefer the official ends; fall back to the win-status flips for demos that
    // never emit `round_officially_ended` (otherwise every round collapses into one).
    let mut ends = if c.official_ends.is_empty() {
        c.synth_ends.clone()
    } else {
        c.official_ends.clone()
    };
    ends.sort_by_key(|e| e.0);
    let last_tick = c.frames.iter().map(|f| f.tick).max().unwrap_or(0);

    let new_round = |number: u32, start: u32, end_tick: u32, winner: Option<String>, reason: Option<String>| {
        // Team scores and names entering the round (captured at freeze_end).
        let (score_ct, score_t) = c.round_scores.get(&start).copied().unwrap_or((0, 0));
        let (ct_name, t_name) = c.round_names.get(&start).cloned().unwrap_or_default();
        Round {
            number,
            // Filled in by a second pass below (needs round_starts / the next round).
            freeze_start_tick: start,
            start_tick: start,
            decided_tick: end_tick,
            end_tick,
            post_end_tick: end_tick,
            winner,
            reason,
            score_ct,
            score_t,
            ct_name,
            t_name,
            damage: HashMap::new(),
            frames: Vec::new(),
            events: Vec::new(),
            bomb: Vec::new(),
            grenade_paths: Vec::new(),
            blinds: Vec::new(),
            chat: Vec::new(),
            defuses: Vec::new(),
            ground_weapons: Vec::new(),
        }
    };

    let mut rounds: Vec<Round> = Vec::new();
    for (end_tick, winner, reason) in &ends {
        let start = freeze
            .iter()
            .rev()
            .find(|&&f| f < *end_tick)
            .copied()
            .unwrap_or(0);
        rounds.push(new_round(
            rounds.len() as u32 + 1,
            start,
            *end_tick,
            winner.clone(),
            reason.clone(),
        ));
    }
    // Deciding round: the freeze after the last official end (ends via
    // cs_win_panel_match, without round_officially_ended).
    let last_end = ends.last().map(|e| e.0).unwrap_or(0);
    if let Some(&start) = freeze.iter().find(|&&f| f > last_end) {
        rounds.push(new_round(
            rounds.len() as u32 + 1,
            start,
            last_tick.max(start),
            c.final_winner.clone(),
            c.final_reason.clone(),
        ));
    }

    // Widen each round to cover its freeze time and post-round:
    //  - freeze_start = the `round_start` just before the playable start (the buy
    //    period). Falls back to the previous round's end (or 0) if missing.
    //  - post_end = the next round's freeze_start (so the gap after the round ends
    //    — the post-round — belongs to this round). The last round runs to the
    //    last sampled tick.
    let mut starts = c.round_starts.clone();
    starts.sort_unstable();
    // Win-status flips give the exact moment each round was decided (the
    // post-round runs from there to the official end).
    let mut decided: Vec<u32> = c.synth_ends.iter().map(|e| e.0).collect();
    decided.sort_unstable();
    // Knife round (FACEIT/scrim opener): every sampled player holds only a knife
    // (or nothing) for the whole live round. There is no buy, so we collapse the
    // freeze window — otherwise the long warmup gap before it shows as a huge
    // freeze. (The viewer also detects this to label the round "0".)
    let is_knife_round = |start_tick: u32, end_tick: u32| -> bool {
        let mut saw_player = false;
        for f in &c.frames {
            if f.tick < start_tick || f.tick > end_tick {
                continue;
            }
            for p in &f.players {
                saw_player = true;
                if p.weapon != "Faca" && !p.weapon.is_empty() {
                    return false;
                }
            }
        }
        saw_player
    };
    let mut prev_end = 0u32;
    for r in &mut rounds {
        let fs = starts
            .iter()
            .rev()
            .find(|&&s| s <= r.start_tick && s >= prev_end)
            .copied()
            .unwrap_or_else(|| prev_end.min(r.start_tick));
        // Cap the freeze window (~50s: a 30s tactical timeout + buy time) so a
        // halftime or tech-pause gap doesn't pull in minutes of audio/frames.
        let freeze_cap = r.start_tick.saturating_sub(50 * DEMO_TICK_RATE as u32);
        r.freeze_start_tick = if is_knife_round(r.start_tick, r.end_tick) {
            r.start_tick
        } else {
            fs.max(freeze_cap)
        };
        // The decision tick inside this round's live window (fallback: end_tick,
        // i.e. no separate post-round segment).
        r.decided_tick = decided
            .iter()
            .find(|&&d| d > r.start_tick && d <= r.end_tick)
            .copied()
            .unwrap_or(r.end_tick);
        prev_end = r.end_tick;
    }
    for i in 0..rounds.len() {
        rounds[i].post_end_tick = if i + 1 < rounds.len() {
            rounds[i + 1].freeze_start_tick
        } else {
            last_tick.max(rounds[i].end_tick) + 1
        };
    }

    // Carve a standalone knife round out of round 1's freeze window. FACEIT/scrim
    // openers run the knife round in warmup, so it never becomes a round of its
    // own and gets swallowed by the first round's (now visible) freeze. If that
    // window opens with a long knife-only stretch followed by the real buy
    // (pistols), split it off as its own round 0.
    let knife_split = rounds.first().and_then(|r0| {
        let (win_start, win_end) = (r0.freeze_start_tick, r0.start_tick);
        let (ct_name, t_name) = (r0.ct_name.clone(), r0.t_name.clone());
        let mut knife_lo: Option<u32> = None;
        let mut knife_hi = win_start;
        let mut pistol_start: Option<u32> = None;
        for f in &c.frames {
            if f.tick < win_start || f.tick >= win_end || pistol_start.is_some() {
                continue;
            }
            let armed = f
                .players
                .iter()
                .any(|p| p.weapon != "Faca" && !p.weapon.is_empty());
            if armed {
                // Real weapons appeared: the knife round is over (if one was seen).
                if knife_lo.is_some() {
                    pistol_start = Some(f.tick);
                }
            } else if !f.players.is_empty() {
                // Knife-only frame (players present, none armed).
                knife_lo.get_or_insert(f.tick);
                knife_hi = f.tick;
            }
        }
        match (knife_lo, pistol_start) {
            (Some(klo), Some(pstart))
                if knife_hi.saturating_sub(klo) >= 6 * DEMO_TICK_RATE as u32 =>
            {
                Some((klo, pstart, ct_name, t_name))
            }
            _ => None,
        }
    });
    if let Some((klo, pstart, ct_name, t_name)) = knife_split {
        // Round 1's freeze now starts at the real buy (after the knife round).
        rounds[0].freeze_start_tick = pstart;
        rounds.insert(
            0,
            Round {
                number: 0,
                freeze_start_tick: klo,
                start_tick: klo,
                decided_tick: pstart,
                end_tick: pstart,
                post_end_tick: pstart,
                winner: None,
                reason: None,
                score_ct: 0,
                score_t: 0,
                ct_name,
                t_name,
                damage: HashMap::new(),
                frames: Vec::new(),
                events: Vec::new(),
                bomb: Vec::new(),
                grenade_paths: Vec::new(),
                blinds: Vec::new(),
                chat: Vec::new(),
                defuses: Vec::new(),
                ground_weapons: Vec::new(),
            },
        );
    }

    // A tick belongs to the round whose [freeze_start, post_end) window contains
    // it (half-open so the boundary tick is not claimed by two rounds).
    let round_of = |tick: u32, rounds: &[Round]| -> Option<usize> {
        rounds
            .iter()
            .position(|r| tick >= r.freeze_start_tick && tick < r.post_end_tick)
    };

    // Distribute frames.
    for rf in &c.frames {
        if let Some(idx) = round_of(rf.tick, &rounds) {
            let start = rounds[idx].freeze_start_tick;
            let players = rf
                .players
                .iter()
                .map(|p| PlayerState {
                    steam_id: p.steam_id.clone(),
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    yaw: p.yaw,
                    health: p.health,
                    alive: p.alive,
                    side: p.side.clone(),
                    weapon: p.weapon.clone(),
                    money: p.money,
                    equip_value: p.equip_value,
                    armor: p.armor,
                    helmet: p.helmet,
                    defuser: p.defuser,
                    grenades: p.grenades.clone(),
                })
                .collect();
            rounds[idx].frames.push(Frame {
                tick: rf.tick,
                t: round1((rf.tick as f64 - start as f64) / DEMO_TICK_RATE),
                players,
            });
        }
    }
    for r in &mut rounds {
        r.frames.sort_by_key(|f| f.tick);
    }

    // Distribute events (kills and bomb) and derive bomb keyframes.
    for ev in &c.events {
        let tick = match ev {
            RawEvent::Kill { tick, .. } => *tick,
            RawEvent::Bomb { tick, .. } => *tick,
        };
        let idx = match round_of(tick, &rounds) {
            Some(i) => i,
            None => continue,
        };
        let start = rounds[idx].freeze_start_tick;
        let t = round1((tick as f64 - start as f64) / DEMO_TICK_RATE);
        match ev {
            RawEvent::Kill {
                attacker,
                victim,
                assister,
                assisted_flash,
                weapon,
                headshot,
                x,
                y,
                z,
                ..
            } => {
                rounds[idx].events.push(Event::Kill {
                    tick,
                    t,
                    attacker_steam_id: attacker.clone(),
                    victim_steam_id: victim.clone(),
                    assister_steam_id: assister.clone(),
                    assisted_flash: *assisted_flash,
                    weapon: weapon.clone(),
                    headshot: *headshot,
                    x: *x,
                    y: *y,
                    z: *z,
                });
            }
            RawEvent::Bomb { kind, player, x, y, .. } => {
                match kind {
                    BombKind::Planted => {
                        rounds[idx].events.push(Event::BombPlanted {
                            tick,
                            t,
                            player_steam_id: player.clone(),
                        });
                        rounds[idx].bomb.push(BombKeyframe {
                            t,
                            state: "planted".into(),
                            x: *x,
                            y: *y,
                            carrier_steam_id: None,
                        });
                    }
                    BombKind::Defused => {
                        rounds[idx].events.push(Event::BombDefused {
                            tick,
                            t,
                            player_steam_id: player.clone(),
                        });
                        rounds[idx].bomb.push(BombKeyframe {
                            t,
                            state: "gone".into(),
                            x: None,
                            y: None,
                            carrier_steam_id: None,
                        });
                    }
                    BombKind::Exploded => {
                        rounds[idx].events.push(Event::BombExploded {
                            tick,
                            t,
                            player_steam_id: player.clone(),
                        });
                        rounds[idx].bomb.push(BombKeyframe {
                            t,
                            state: "gone".into(),
                            x: None,
                            y: None,
                            carrier_steam_id: None,
                        });
                    }
                }
            }
        }
    }
    // Grenades. Smoke and fire have an expiration pair (exact duration per entityid);
    // he/flash/decoy are instant, with a fixed short window.
    let mut ends = c.grenade_ends.clone();
    ends.sort_by_key(|e| e.1);
    let mut used = vec![false; ends.len()];
    for &(tick, kind, id, x, y, z) in &c.grenade_dets {
        let idx = match round_of(tick, &rounds) {
            Some(i) => i,
            None => continue,
        };
        let start = rounds[idx].freeze_start_tick;
        let t = round1((tick as f64 - start as f64) / DEMO_TICK_RATE);
        let end_t = if matches!(kind, GrenadeKind::Smoke | GrenadeKind::Fire) {
            // First free end with the same entityid right after the detonation. The
            // entityid is recycled across rounds, so we cap it to a short window
            // (smoke ~18s, fire ~7s) to avoid matching another round.
            const WINDOW: u32 = 30 * 64;
            let m = ends
                .iter()
                .enumerate()
                .find(|(j, e)| !used[*j] && e.0 == id && e.1 >= tick && e.1 - tick <= WINDOW);
            match m {
                Some((j, e)) => {
                    used[j] = true;
                    round1((e.1 as f64 - start as f64) / DEMO_TICK_RATE)
                }
                // No pair: use the typical duration as a fallback.
                None => round1(t + if kind == GrenadeKind::Smoke { 18.0 } else { 7.0 }),
            }
        } else {
            round1(t + kind.instant_duration())
        };
        rounds[idx].events.push(Event::Grenade {
            tick,
            t,
            kind: kind.as_str().to_string(),
            x: round1(x),
            y: round1(y),
            z: round1(z),
            end_t,
        });
    }

    // Shot tracers.
    for &(tick, x, y, yaw) in &c.shots {
        if let Some(idx) = round_of(tick, &rounds) {
            let start = rounds[idx].freeze_start_tick;
            rounds[idx].events.push(Event::Shot {
                tick,
                t: round1((tick as f64 - start as f64) / DEMO_TICK_RATE),
                x,
                y,
                yaw,
            });
        }
    }

    // Flash blinds (steamId resolved via the userid -> steam map).
    for &(tick, uid, dur) in &c.blinds_raw {
        if let Some(idx) = round_of(tick, &rounds) {
            if let Some(steam) = c.userid_to_steam.get(&uid) {
                let start = rounds[idx].freeze_start_tick;
                rounds[idx].blinds.push(Blind {
                    t: round1((tick as f64 - start as f64) / DEMO_TICK_RATE),
                    duration: round1(dur),
                    steam_id: steam.clone(),
                });
            }
        }
    }

    // Defuses: each attempt ends with whatever comes first after the begin:
    // an end event (abort/completed) OR the next begin (interruption without an
    // abort event, e.g. stopped and restarted). Clamped to the round end.
    let mut def_begins = c.defuse_begins.clone();
    def_begins.sort_by_key(|b| b.0);
    let mut def_ends = c.defuse_ends.clone();
    def_ends.sort_by_key(|e| e.0);
    let mut def_used = vec![false; def_ends.len()];
    for (i, (btick, uid, has_kit)) in def_begins.iter().enumerate() {
        let idx = match round_of(*btick, &rounds) {
            Some(i) => i,
            None => continue,
        };
        let round_end = rounds[idx].end_tick;
        let next_begin = def_begins.get(i + 1).map(|b| b.0);
        let end_slot = def_ends
            .iter()
            .enumerate()
            .find(|(j, e)| !def_used[*j] && e.0 >= *btick);

        let (mut end_tick, mut defused) = match end_slot {
            // End by event, if it comes before (or in the absence of) a new begin.
            Some((j, e)) if next_begin.map_or(true, |nb| e.0 <= nb) => {
                def_used[j] = true;
                (e.0, e.1)
            }
            // Interrupted by a new begin before any end.
            _ => (next_begin.unwrap_or(round_end), false),
        };
        if end_tick > round_end {
            end_tick = round_end;
            defused = false;
        }
        if end_tick <= *btick {
            continue;
        }
        let start = rounds[idx].freeze_start_tick;
        rounds[idx].defuses.push(Defuse {
            start_t: round1((*btick as f64 - start as f64) / DEMO_TICK_RATE),
            end_t: round1((end_tick as f64 - start as f64) / DEMO_TICK_RATE),
            defused,
            has_kit: *has_kit,
            steam_id: c.userid_to_steam.get(uid).cloned(),
        });
    }

    // Chat: may occur in the freeze/buy between rounds (outside [start,end]); in that
    // case it falls into the next round and t is clamped to >= 0 (shows at the start).
    let name_to_steam: HashMap<&str, &str> = c
        .meta
        .values()
        .map(|m| (m.name.as_str(), m.steam_id.as_str()))
        .collect();
    for (tick, name, text, team_only) in &c.chats {
        let idx = round_of(*tick, &rounds)
            .or_else(|| rounds.iter().position(|r| r.start_tick > *tick))
            .or(rounds.len().checked_sub(1));
        let idx = match idx {
            Some(i) => i,
            None => continue,
        };
        let start = rounds[idx].freeze_start_tick;
        let t = round1(((*tick as f64 - start as f64) / DEMO_TICK_RATE).max(0.0));
        rounds[idx].chat.push(ChatMsg {
            t,
            tick: *tick,
            name: name.clone(),
            text: text.clone(),
            team_only: *team_only,
            steam_id: name_to_steam.get(name.as_str()).map(|s| s.to_string()),
        });
    }

    // Damage per round and player (for ADR/DMG on the scoreboard).
    for (tick, steam, dmg) in &c.hurts {
        if let Some(idx) = round_of(*tick, &rounds) {
            *rounds[idx].damage.entry(steam.clone()).or_insert(0) += *dmg;
        }
    }

    // C4 carried/on-ground keyframes, from the per-tick samples. Emits only when
    // the state changes (different carrier, or carried<->ground transition, or the
    // ground position changes) to avoid one keyframe per tick.
    for (tick, sample) in &c.c4_samples {
        let idx = match round_of(*tick, &rounds) {
            Some(i) => i,
            None => continue,
        };
        let prev = rounds[idx]
            .bomb
            .iter()
            .rev()
            .find(|k| k.state == "carried" || k.state == "ground");
        let same = match (prev, sample) {
            (Some(k), C4Sample::Carried(s)) => {
                k.state == "carried" && k.carrier_steam_id.as_deref() == Some(s.as_str())
            }
            (Some(k), C4Sample::Ground(x, y)) => {
                k.state == "ground" && k.x == Some(*x) && k.y == Some(*y)
            }
            _ => false,
        };
        if same {
            continue;
        }
        let start = rounds[idx].freeze_start_tick;
        let t = round1((*tick as f64 - start as f64) / DEMO_TICK_RATE);
        let kf = match sample {
            C4Sample::Carried(s) => BombKeyframe {
                t,
                state: "carried".into(),
                x: None,
                y: None,
                carrier_steam_id: Some(s.clone()),
            },
            C4Sample::Ground(x, y) => BombKeyframe {
                t,
                state: "ground".into(),
                x: Some(*x),
                y: Some(*y),
                carrier_steam_id: None,
            },
        };
        rounds[idx].bomb.push(kf);
    }

    // Ground weapons: a dropped item sits still until picked up, so we collapse the
    // per-tick samples into intervals. Samples are grouped by entity index (recycled
    // across rounds), sorted by tick; a run breaks when the tick gap is large (pickup
    // / round change) or the position jumps (a new item reused the same index).
    let gw_gap = (c.tick_step * 3).max(8);
    // A real drop rests on the floor for a while; a grenade mid-throw (or an item
    // swapped for a tick) shows up as a stationary blip. Require a minimum span to
    // keep only items that actually lie on the ground.
    let gw_min_span = (c.tick_step * 3).max(24);
    const GW_EPS: f64 = 40.0; // units; beyond this the item "moved" -> new interval
    let mut gsamples = c.ground_samples.clone();
    gsamples.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
    let flush = |rounds: &mut [Round],
                 label: &str,
                 x: f64,
                 y: f64,
                 z: f64,
                 start_tick: u32,
                 last_tick: u32| {
        if last_tick.saturating_sub(start_tick) < gw_min_span {
            return;
        }
        let idx = match round_of(start_tick, rounds) {
            Some(i) => i,
            None => return,
        };
        let start = rounds[idx].freeze_start_tick;
        // Clamp to the end of the round's window (includes the post-round), so a
        // dropped weapon lingers as long as the round is shown.
        let round_end = rounds[idx].post_end_tick;
        let end_tick = (last_tick + gw_gap).min(round_end).max(start_tick);
        rounds[idx].ground_weapons.push(GroundWeapon {
            label: label.to_string(),
            x,
            y,
            z,
            start_t: round1((start_tick as f64 - start as f64) / DEMO_TICK_RATE),
            end_t: round1((end_tick as f64 - start as f64) / DEMO_TICK_RATE),
        });
    };
    // run = (entity idx, label, x, y, z, start_tick, last_tick)
    let mut run: Option<(u32, String, f64, f64, f64, u32, u32)> = None;
    for (eidx, tick, label, x, y, z) in &gsamples {
        let extend = match &run {
            Some((ridx, rlabel, rx, ry, _rz, _rstart, rlast)) => {
                ridx == eidx
                    && rlabel == label
                    && tick.saturating_sub(*rlast) <= gw_gap
                    && (x - *rx).abs() <= GW_EPS
                    && (y - *ry).abs() <= GW_EPS
            }
            None => false,
        };
        if extend {
            if let Some(r) = run.as_mut() {
                r.6 = *tick;
            }
        } else {
            if let Some((_, rlabel, rx, ry, rz, rstart, rlast)) = run.take() {
                flush(&mut rounds, &rlabel, rx, ry, rz, rstart, rlast);
            }
            run = Some((*eidx, label.clone(), *x, *y, *z, *tick, *tick));
        }
    }
    if let Some((_, rlabel, rx, ry, rz, rstart, rlast)) = run.take() {
        flush(&mut rounds, &rlabel, rx, ry, rz, rstart, rlast);
    }

    for r in &mut rounds {
        r.events.sort_by_key(|e| match e {
            Event::Kill { tick, .. } => *tick,
            Event::BombPlanted { tick, .. } => *tick,
            Event::BombDefused { tick, .. } => *tick,
            Event::BombExploded { tick, .. } => *tick,
            Event::Shot { tick, .. } => *tick,
            Event::Grenade { tick, .. } => *tick,
        });
        r.blinds.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        r.chat.sort_by_key(|m| m.tick);
        r.bomb.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        r.ground_weapons
            .sort_by(|a, b| a.start_t.partial_cmp(&b.start_t).unwrap_or(std::cmp::Ordering::Equal));
    }

    // Grenade trajectories (arcs). Groups points by entity; the index is recycled
    // within the match, so we segment by tick discontinuity. A smoke/molotov keeps
    // emitting points while sitting on the ground, so we cut the arc when the
    // projectile stops moving.
    let mut by_ent: HashMap<u32, Vec<(u32, GrenadeKind, f64, f64, Option<String>)>> =
        HashMap::new();
    for (idx, tick, kind, x, y, thrower) in &c.proj_points {
        by_ent
            .entry(*idx)
            .or_default()
            .push((*tick, *kind, *x, *y, thrower.clone()));
    }
    let mut segments: Vec<Vec<(u32, GrenadeKind, f64, f64, Option<String>)>> = Vec::new();
    for (_idx, mut pts) in by_ent {
        pts.sort_by_key(|p| p.0);
        let mut seg: Vec<(u32, GrenadeKind, f64, f64, Option<String>)> = Vec::new();
        for p in pts {
            if let Some(last) = seg.last() {
                if p.0 - last.0 > 64 {
                    if seg.len() >= 2 {
                        segments.push(std::mem::take(&mut seg));
                    } else {
                        seg.clear();
                    }
                }
            }
            seg.push(p);
        }
        if seg.len() >= 2 {
            segments.push(seg);
        }
    }
    for seg in segments {
        let kind = seg[0].1;
        // First known thrower of the segment (may be missing in the early ticks).
        let thrower = seg.iter().find_map(|p| p.4.clone());
        let mut flight: Vec<(u32, f64, f64)> = vec![(seg[0].0, seg[0].2, seg[0].3)];
        for p in seg.iter().skip(1) {
            let (_, px, py) = *flight.last().unwrap();
            flight.push((p.0, p.2, p.3));
            let d = ((p.2 - px).powi(2) + (p.3 - py).powi(2)).sqrt();
            if d < 3.0 && flight.len() > 3 {
                break;
            }
        }
        let idx = match round_of(flight[0].0, &rounds) {
            Some(i) => i,
            None => continue,
        };
        let start = rounds[idx].freeze_start_tick;
        let points = flight
            .iter()
            .map(|&(tk, x, y)| GrenadePoint {
                t: round1((tk as f64 - start as f64) / DEMO_TICK_RATE),
                x: round1(x),
                y: round1(y),
            })
            .collect();
        rounds[idx].grenade_paths.push(GrenadePath {
            kind: kind.as_str().to_string(),
            points,
            thrower_steam_id: thrower,
        });
    }

    let players = c
        .meta_order
        .iter()
        .filter_map(|id| c.meta.get(id))
        .map(|m| PlayerMeta {
            steam_id: m.steam_id.clone(),
            name: m.name.clone(),
            start_side: m.start_side.clone(),
        })
        .collect();

    // Final per-team score: from cs_win_panel_match; otherwise last round + winner.
    let (final_score_ct, final_score_t) = c.final_score.unwrap_or_else(|| {
        rounds
            .last()
            .map(|r| {
                let (mut ct, mut t) = (r.score_ct, r.score_t);
                match r.winner.as_deref() {
                    Some("CT") => ct += 1,
                    Some("T") => t += 1,
                    _ => {}
                }
                (ct, t)
            })
            .unwrap_or((0, 0))
    });
    let (final_ct_name, final_t_name) = c
        .final_names
        .clone()
        .or_else(|| rounds.last().map(|r| (r.ct_name.clone(), r.t_name.clone())))
        .unwrap_or_default();

    Replay {
        map: c.map_name.clone(),
        demo_tick_rate: DEMO_TICK_RATE as u32,
        frame_rate: (DEMO_TICK_RATE as u32) / std::cmp::max(1, c.tick_step),
        players,
        rounds,
        final_score_ct,
        final_score_t,
        final_ct_name,
        final_t_name,
        generated_by: GENERATED_BY.into(),
    }
}

// --------------------------------------------------------- voice / blob --

/// Voice container magic. Version 2 (adds voice_level per packet).
const VOICE_MAGIC: &[u8; 4] = b"CLV2";

/// Packs the voice packets into a compact binary blob, grouped by player.
///
/// Layout (little-endian):
/// ```text
/// magic        "CLV2"   (4 bytes)
/// sampleRate   u32      (e.g. 48000)
/// tickRate     u32      (e.g. 64; a packet at tick T plays at T/tickRate seconds)
/// playerCount  u32
/// per player:
///   steamId    u64
///   packets    u32
///   per packet:
///     tick     u32      (absolute demo tick)
///     level    f32      (voice_level: speech amplitude, for the waveform)
///     len      u32
///     opus     [len]    (one raw Opus frame, 48kHz mono)
/// ```
/// With no OPUS packet at all, returns an empty blob (just the header with
/// playerCount 0), so the viewer knows the demo has no voice.
fn build_voice_blob(c: &Collector) -> Vec<u8> {
    use std::collections::BTreeMap;
    let mut by_player: BTreeMap<&str, Vec<(u32, f32, &[u8])>> = BTreeMap::new();
    for (sid, tick, level, data) in &c.voice {
        by_player
            .entry(sid.as_str())
            .or_default()
            .push((*tick, *level, data.as_slice()));
    }

    let sample_rate = if c.voice_sample_rate != 0 { c.voice_sample_rate } else { 48000 };
    let mut out = Vec::new();
    out.extend_from_slice(VOICE_MAGIC);
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(DEMO_TICK_RATE as u32).to_le_bytes());
    out.extend_from_slice(&(by_player.len() as u32).to_le_bytes());
    for (sid, mut pkts) in by_player {
        pkts.sort_by_key(|p| p.0);
        let steam: u64 = sid.parse().unwrap_or(0);
        out.extend_from_slice(&steam.to_le_bytes());
        out.extend_from_slice(&(pkts.len() as u32).to_le_bytes());
        for (tick, level, data) in pkts {
            out.extend_from_slice(&tick.to_le_bytes());
            out.extend_from_slice(&level.to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(data);
        }
    }
    out
}

/// Parses the bytes of a `.dem` in a single pass and returns `(Replay JSON, voice
/// blob)`. The `Replay` matches `replay-schema 2D`; the blob follows the `CLV2`
/// layout above (empty when the demo has no recorded voice).
/// `frame_rate` is the number of gameplay samples per second (downsample); 8 is a
/// good default. Voice is not affected by the downsample (all packets are kept).
pub fn parse_all<F: FnMut(u32, u32, u32) + 'static>(
    bytes: &[u8],
    frame_rate: u32,
    on_progress: F,
) -> Result<(String, Vec<u8>), String> {
    let frame_rate = frame_rate.max(1);
    let tick_step = ((DEMO_TICK_RATE / frame_rate as f64).round() as u32).max(1);

    let mut parser = Parser::from_slice(bytes).map_err(|e| format!("{e}"))?;
    // Total ticks come from the file header (read up front), the progress denominator.
    let total_ticks = parser.replay_info().playback_ticks() as u32;
    let collector: Rc<RefCell<Collector>> = parser.register_observer::<Collector>();
    {
        let mut c = collector.borrow_mut();
        c.tick_step = tick_step;
        c.total_ticks = total_ticks;
        c.progress = Some(Box::new(on_progress));
    }
    parser.run_to_end().map_err(|e| format!("{e}"))?;

    // Pull the progress sink back out to report the post-loop stages directly.
    let mut progress = collector.borrow_mut().progress.take();
    let mut report = |stage: u32| {
        if let Some(cb) = progress.as_mut() {
            cb(stage, 0, 0);
        }
    };

    let c = collector.borrow();
    #[cfg(not(feature = "wasm"))]
    eprintln!(
        "[debug] frames={} freeze_ends={} official_ends={} events={} map='{}' voice_pkts={} voice_codec='{}' voice_non_opus={} defuse_begins={} defuse_ends={}",
        c.frames.len(),
        c.freeze_ends.len(),
        c.official_ends.len(),
        c.events.len(),
        c.map_name,
        c.voice.len(),
        c.voice_codec,
        c.voice_non_opus,
        c.defuse_begins.len(),
        c.defuse_ends.len(),
    );
    report(1); // building the replay
    let replay = build_replay(&c);
    report(2); // serializing to JSON
    let json = serde_json::to_string(&replay).map_err(|e| format!("{e}"))?;
    let voice = build_voice_blob(&c);
    Ok((json, voice))
}

/// How many demo ticks between parse-progress callbacks (throttle). At 64 tps a
/// 30-min demo is ~115k ticks, so this yields a couple hundred smooth updates.
const PROGRESS_TICK_INTERVAL: u32 = 512;

/// Shortcut that returns only the `Replay` JSON (used by the legacy native binary
/// and by consumers that only want the gameplay).
pub fn parse_replay(bytes: &[u8], frame_rate: u32) -> Result<String, String> {
    parse_all(bytes, frame_rate, |_, _, _| {}).map(|(json, _)| json)
}

// --------------------------------------------------------------- wasm api ----

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Initializes readable panic hooks in the browser console. Idempotent.
#[cfg(feature = "wasm")]
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Parser output for the worker: the `Replay` (JSON) and the voice blob (bytes,
/// `CLV2` layout). Exposed with getters because `String`/`Vec<u8>` become
/// `string`/`Uint8Array` in JS.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct ParseOutput {
    replay: String,
    voice: Vec<u8>,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl ParseOutput {
    /// `Replay` serialized as JSON (`replay-schema 2D` contract).
    #[wasm_bindgen(getter)]
    pub fn replay(&self) -> String {
        self.replay.clone()
    }
    /// Voice blob in the `CLV2` layout. Empty (no players) when the demo has no
    /// recorded voice.
    #[wasm_bindgen(getter)]
    pub fn voice(&self) -> Vec<u8> {
        self.voice.clone()
    }
}

/// Worker entry point: takes the `.dem` bytes and returns the `Replay` (JSON)
/// together with the voice blob. Throws an error string on failure.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn parse_demo(
    bytes: &[u8],
    frame_rate: u32,
    on_progress: Option<js_sys::Function>,
) -> Result<ParseOutput, JsValue> {
    // Bridge the Rust progress callback to the optional JS function:
    // `on_progress(stage, currentTick, totalTicks)`. stage 0 = parsing,
    // 1 = building the replay, 2 = serializing.
    let cb = move |stage: u32, cur: u32, total: u32| {
        if let Some(f) = &on_progress {
            let _ = f.call3(
                &JsValue::NULL,
                &JsValue::from_f64(stage as f64),
                &JsValue::from_f64(cur as f64),
                &JsValue::from_f64(total as f64),
            );
        }
    };
    let (replay, voice) = parse_all(bytes, frame_rate, cb).map_err(|e| JsValue::from_str(&e))?;
    Ok(ParseOutput { replay, voice })
}
