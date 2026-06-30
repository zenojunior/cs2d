//! Streaming observer: walks the demo tick by tick and accumulates raw samples
//! and events, later assembled into the `Replay` by `crate::assemble`.

use crate::props::*;
use crate::schema::{PlayerMeta, PlayerState};
use crate::weapons::*;
use source2_demo::prelude::*;
use source2_demo::proto::{
    CSvcMsgServerInfo, CSvcMsgVoiceData, CSvcMsgVoiceInit, CUserMessageSayText2,
};
use std::collections::HashMap;

pub(crate) struct RawFrame {
    pub(crate) tick: u32,
    pub(crate) players: Vec<PlayerState>,
}

pub(crate) enum RawEvent {
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
        z: Option<f64>,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum BombKind {
    Planted,
    Defused,
    Exploded,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum GrenadeKind {
    Smoke,
    Fire,
    He,
    Flash,
    Decoy,
}

impl GrenadeKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            GrenadeKind::Smoke => "smoke",
            GrenadeKind::Fire => "fire",
            GrenadeKind::He => "he",
            GrenadeKind::Flash => "flash",
            GrenadeKind::Decoy => "decoy",
        }
    }
    /// Fixed window (s) for instant grenades (smoke/fire use the end pair).
    pub(crate) fn instant_duration(self) -> f64 {
        match self {
            GrenadeKind::He | GrenadeKind::Decoy => 0.5,
            GrenadeKind::Flash => 0.4,
            _ => 0.0,
        }
    }
}

/// Sampled C4 state (CC4 entity): carried by someone or on the ground.
#[derive(Clone, PartialEq)]
pub(crate) enum C4Sample {
    Carried(String),
    Ground(f64, f64, f64),
}

#[derive(Default)]
pub(crate) struct Collector {
    pub(crate) map_name: String,
    pub(crate) meta_order: Vec<String>,
    pub(crate) meta: HashMap<String, PlayerMeta>,
    /// Freeze-time start of each round (`round_start`, outside warmup). The buy
    /// period runs from here to the matching `freeze_ends` tick.
    pub(crate) round_starts: Vec<u32>,
    /// Playable start of each round (outside warmup).
    pub(crate) freeze_ends: Vec<u32>,
    /// Official round end: (tick, winner, reason) read from the game rules.
    pub(crate) official_ends: Vec<(u32, Option<String>, Option<String>)>,
    /// Round ends synthesized from the game-rules win status flipping 0 -> non-zero,
    /// captured each tick. Fallback for demos that never emit `round_officially_ended`
    /// (some tournament GOTV recordings). Same shape as `official_ends`.
    pub(crate) synth_ends: Vec<(u32, Option<String>, Option<String>)>,
    /// Last seen `m_iRoundWinStatus` (0 = round in progress), to detect the flip.
    pub(crate) prev_win_status: i32,
    /// Closed pause intervals: (start_tick, end_tick, kind, side).
    pub(crate) pauses: Vec<(u32, u32, String, Option<String>)>,
    /// Pause currently in progress: (start_tick, kind, side). None when live.
    pub(crate) pause_open: Option<(u32, String, Option<String>)>,
    /// Grenade detonations: (tick, kind, entityid, x, y) in world coords.
    pub(crate) grenade_dets: Vec<(u32, GrenadeKind, i32, f64, f64, f64)>,
    /// Smoke/fire end: (entityid, tick), matched by entityid at build time.
    pub(crate) grenade_ends: Vec<(i32, u32)>,
    /// Projectile flight points: (entity index, tick, kind, x, y).
    pub(crate) proj_points: Vec<(u32, u32, GrenadeKind, f64, f64, Option<String>)>,
    /// C4 state per sampled tick (carried/on ground), for keyframes.
    pub(crate) c4_samples: Vec<(u32, C4Sample)>,
    /// Dropped item samples: (entity index, tick, label, x, y, z). Grouped into
    /// ground-weapon intervals at build time.
    pub(crate) ground_samples: Vec<(u32, u32, String, f64, f64, f64)>,
    /// Final round winner (the deciding one does not emit round_officially_ended).
    pub(crate) final_winner: Option<String>,
    pub(crate) final_reason: Option<String>,
    /// Per-team score (CT, T) entering each round, keyed by freeze_end tick.
    pub(crate) round_scores: HashMap<u32, (i32, i32)>,
    /// Clan name (CT, T) entering each round, keyed by freeze_end tick.
    pub(crate) round_names: HashMap<u32, (String, String)>,
    /// Final per-team score (CT, T), read at the end of the match.
    pub(crate) final_score: Option<(i32, i32)>,
    /// Final team names (CT, T), read at the end of the match.
    pub(crate) final_names: Option<(String, String)>,
    /// Damage: (tick, attacker steamId, health damage, weapon classname lowercased).
    /// The weapon lets the build split out utility damage. Aggregated per round.
    pub(crate) hurts: Vec<(u32, String, i32, String)>,
    /// Shots (tracers): (tick, x, y, yaw) of the shooter.
    pub(crate) shots: Vec<(u32, f64, f64, f64)>,
    /// Blinds: (tick, userid, duration, flasher steamId). The victim steamId comes
    /// from the userid->steam map; the flasher is resolved from the attacker pawn.
    pub(crate) blinds_raw: Vec<(u32, i32, f64, Option<String>)>,
    /// Chat: (tick, name, text, team-only). The steamId is resolved by name at build.
    pub(crate) chats: Vec<(u32, String, String, bool)>,
    /// Defuse start: (tick, userid, has_kit). steamId resolved via userid.
    pub(crate) defuse_begins: Vec<(u32, i32, bool)>,
    /// Defuse end: (tick, completed). Abort = false; bomb_defused = true.
    pub(crate) defuse_ends: Vec<(u32, bool)>,
    /// userid (game event slot) -> steamId, built from events that carry both.
    pub(crate) userid_to_steam: HashMap<i32, String>,
    pub(crate) frames: Vec<RawFrame>,
    pub(crate) events: Vec<RawEvent>,
    /// `buytime_ended` ticks, used to bound each round's buy window.
    pub(crate) buytime_ends: Vec<u32>,
    /// Raw `item_pickup` acquisitions (tick, steamId, item label), filtered to the
    /// buy window at assemble time. GOTV demos lack `item_purchase`, so a buy and a
    /// pickup look alike here; the buy view reconciles them against the cash delta.
    pub(crate) purchases: Vec<(u32, String, String)>,
    /// Pawn entity index -> steamId, refreshed every tick.
    pub(crate) pawn_to_steam: HashMap<u32, String>,
    pub(crate) last_cap: u32,
    pub(crate) tick_step: u32,
    /// Total demo ticks (from the file header), used as the progress denominator.
    pub(crate) total_ticks: u32,
    /// Last tick a progress update was emitted, to throttle the callback.
    pub(crate) last_progress_tick: u32,
    /// Progress sink (used by the wasm build): `(stage, current_tick, total_ticks)`.
    /// Stage 0 = parsing, reported per-tick from `on_tick_start`; later stages are
    /// reported by `parse_all` once the tick loop is done.
    pub(crate) progress: Option<Box<dyn FnMut(u32, u32, u32)>>,
    /// Voice/comms: raw Opus packets per speaker, in absolute demo ticks.
    /// (steamId, tick, voice_level, Opus packet). Each packet is an Opus frame
    /// decodable directly (48kHz mono) in the browser; no Steam SDK needed.
    /// The voice_level (speech amplitude, from the packet itself) feeds the waveform.
    pub(crate) voice: Vec<(String, u32, f32, Vec<u8>)>,
    /// Sample rate declared in the voice packets (typically 48000).
    pub(crate) voice_sample_rate: u32,
    /// Codec declared in VoiceInit (e.g. "vaudio_speex", a legacy/misleading string;
    /// the real packet format is checked per message).
    pub(crate) voice_codec: String,
    /// Voice packets in non-OPUS format, discarded (not decodable without the
    /// Steam SDK). Kept for diagnostics only.
    pub(crate) voice_non_opus: u32,
}

/// steamId of a pawn referenced by an event handle (userid_pawn etc.).
fn steam_from_pawn_handle(c: &Collector, ctx: &Context, handle: i32) -> Option<String> {
    let h = handle as u32 as usize;
    let pawn = ctx.entities().get_by_handle(h).ok()?;
    c.pawn_to_steam.get(&pawn.index()).cloned()
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

        // Pause/timeout tracking (every tick). The game rules expose tactical
        // timeouts (per side) and an admin/tech pause (match waiting for resume);
        // we record [start, end] intervals, opening one on the live -> paused edge
        // and closing it on the paused -> live edge.
        match (pause_state(ctx), self.pause_open.is_some()) {
            (Some((kind, side)), false) => {
                self.pause_open = Some((tick, kind.to_string(), side));
            }
            (None, true) => {
                let (start, kind, side) = self.pause_open.take().unwrap();
                self.pauses.push((start, tick, kind, side));
            }
            _ => {}
        }

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
            // Skip coaches: they own a CCSPlayerController and a pawn that is
            // stuck on a playing team (CT/T), but the controller itself sits on
            // the spectator team (m_iTeamNum == 1). Real players have the
            // controller on the same playing side as their pawn. Gating on the
            // controller's team drops the coach, who would otherwise show up as
            // a 6th "player" permanently dead at a fixed spot.
            if side_of(prop_i32(ctrl, "m_iTeamNum")).is_none() {
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
            let comp_color = prop_i32(ctrl, "m_iCompTeammateColor");
            if !self.meta.contains_key(&steam_id) {
                let name = ev_name(ctrl);
                self.meta_order.push(steam_id.clone());
                self.meta.insert(
                    steam_id.clone(),
                    PlayerMeta { steam_id: steam_id.clone(), name, start_side: side.into(), comp_color },
                );
            } else if let Some(m) = self.meta.get_mut(&steam_id) {
                // Color is assigned a bit after connect; keep the last valid value.
                if comp_color >= 0 {
                    m.comp_color = comp_color;
                }
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
                primary: primary_weapon(ctx, pawn),
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
                    round1(world_coord(e, "CBodyComponent.m_cellZ", "CBodyComponent.m_vecZ")),
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
                    let weapon = ev_str(ge, "weapon").unwrap_or_default().to_lowercase();
                    self.hurts.push((tick, s, dmg, weapon));
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
                let (mut x, mut y, mut z) = (None, None, None);
                if matches!(kind, BombKind::Planted) {
                    if let Some(h) = ev_i32(ge, "userid_pawn") {
                        if let Ok(p) = ctx.entities().get_by_handle(h as u32 as usize) {
                            x = Some(round1(world_coord(p, "CBodyComponent.m_cellX", "CBodyComponent.m_vecX")));
                            y = Some(round1(world_coord(p, "CBodyComponent.m_cellY", "CBodyComponent.m_vecY")));
                            z = Some(round1(world_coord(p, "CBodyComponent.m_cellZ", "CBodyComponent.m_vecZ")));
                        }
                    }
                }
                self.events.push(RawEvent::Bomb { tick, kind, player, x, y, z });
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
            "buytime_ended" => {
                if !in_warmup(ctx) {
                    self.buytime_ends.push(tick);
                }
            }
            // Warmup pickups (deathmatch guns) are skipped so they don't leak into
            // round 1; the bomb and knife are never buys.
            "item_pickup" if !in_warmup(ctx) => {
                let buyer = ev_i32(ge, "userid_pawn")
                    .and_then(|h| steam_from_pawn_handle(self, ctx, h))
                    .or_else(|| ev_i32(ge, "userid").and_then(|u| self.userid_to_steam.get(&u).cloned()));
                if let Some(steam) = buyer {
                    let raw = ev_str(ge, "item").unwrap_or_default();
                    let label = weapon_label(&raw);
                    if !label.is_empty() && label != "C4" && label != "Faca" {
                        self.purchases.push((tick, steam, label));
                    }
                }
            }
            "player_blind" => {
                let dur = ev_f32(ge, "blind_duration");
                if dur > 0.0 {
                    if let Some(uid) = ev_i32(ge, "userid") {
                        // Flasher: player_blind carries the thrower as `attacker` (a
                        // userid, not a pawn handle, unlike player_hurt), resolved
                        // via the same userid -> steam bridge as the victim.
                        let flasher = ev_i32(ge, "attacker")
                            .and_then(|u| self.userid_to_steam.get(&u).cloned());
                        self.blinds_raw.push((tick, uid, dur, flasher));
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// How many demo ticks between parse-progress callbacks (throttle). At 64 tps a
/// 30-min demo is ~115k ticks, so this yields a couple hundred smooth updates.
const PROGRESS_TICK_INTERVAL: u32 = 512;
