//! Assembles the accumulated `Collector` samples into the final `Replay`, and
//! packs the voice packets into the `CLV2` blob.

use crate::collector::*;
use crate::props::*;
use crate::schema::*;
use crate::weapons::is_utility_weapon;
use crate::{DEMO_TICK_RATE, GENERATED_BY};
use std::collections::HashMap;

pub(crate) fn build_replay(c: &Collector) -> Replay {
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
            utility_damage: HashMap::new(),
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
                utility_damage: HashMap::new(),
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

    // Advance each freeze_start to the actual respawn moment. The CS2
    // `round_start` event (used as freeze_start above) does not coincide with the
    // respawn: the engine teleports everyone to spawn at 100 HP a few seconds off
    // it (after it when a round ends in a fight, before it when a round ends on
    // the bomb/time with survivors still up). Either way the in-between frames
    // belong to the previous round's post-round (its casualties still lying
    // dead, or its survivors damaged), not to this round. Anchor freeze_start at
    // the first frame where every sampled player is alive at full health, the
    // unambiguous respawn signature, searching from the previous round's
    // decision so a respawn landing before this round's `round_start` is caught.
    // Runs after the knife split so it does not trim a FACEIT knife round (which
    // lives inside round 1's original freeze window) out of view.
    for i in 0..rounds.len() {
        let hi = rounds[i].start_tick;
        // Collapsed (knife) round: nothing to trim.
        if rounds[i].freeze_start_tick >= hi {
            continue;
        }
        let lo = if i > 0 {
            rounds[i - 1].decided_tick
        } else {
            rounds[i].freeze_start_tick
        };
        let respawn = c
            .frames
            .iter()
            .find(|f| {
                f.tick >= lo
                    && f.tick <= hi
                    && !f.players.is_empty()
                    && f.players.iter().all(|p| p.alive && p.health == 100)
            })
            .map(|f| f.tick);
        if let Some(tick) = respawn {
            rounds[i].freeze_start_tick = tick;
        }
    }

    // post_end = the next round's (now respawn-aligned) freeze_start, so the gap
    // after the round ends — the post-round, including the restart delay — belongs
    // to this round. The last round runs to the last sampled tick.
    for i in 0..rounds.len() {
        rounds[i].post_end_tick = if i + 1 < rounds.len() {
            rounds[i + 1].freeze_start_tick
        } else {
            last_tick.max(rounds[i].end_tick) + 1
        };
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
                    primary: p.primary.clone(),
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
            RawEvent::Bomb { kind, player, x, y, z, .. } => {
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
                            z: *z,
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
                            z: None,
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
                            z: None,
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

    // Flash blinds (victim steamId resolved via the userid -> steam map; the
    // flasher steamId is already resolved at event time).
    for (tick, uid, dur, flasher) in &c.blinds_raw {
        if let Some(idx) = round_of(*tick, &rounds) {
            if let Some(steam) = c.userid_to_steam.get(uid) {
                let start = rounds[idx].freeze_start_tick;
                rounds[idx].blinds.push(Blind {
                    t: round1((*tick as f64 - start as f64) / DEMO_TICK_RATE),
                    duration: round1(*dur),
                    steam_id: steam.clone(),
                    flasher_steam_id: flasher.clone(),
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

    // Damage per round and player (for ADR/DMG on the scoreboard). Utility damage
    // (HE + molotov/incendiary) is also tallied separately for the impact view.
    for (tick, steam, dmg, weapon) in &c.hurts {
        if let Some(idx) = round_of(*tick, &rounds) {
            *rounds[idx].damage.entry(steam.clone()).or_insert(0) += *dmg;
            if is_utility_weapon(weapon) {
                *rounds[idx].utility_damage.entry(steam.clone()).or_insert(0) += *dmg;
            }
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
            (Some(k), C4Sample::Ground(x, y, _z)) => {
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
                z: None,
                carrier_steam_id: Some(s.clone()),
            },
            C4Sample::Ground(x, y, z) => BombKeyframe {
                t,
                state: "ground".into(),
                x: Some(*x),
                y: Some(*y),
                z: Some(*z),
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

    // Pauses, plus any pause still open at the end of the demo (closed at the
    // last sampled tick).
    let mut pauses: Vec<Pause> = c
        .pauses
        .iter()
        .map(|(s, e, kind, side)| Pause {
            start_tick: *s,
            end_tick: *e,
            kind: kind.clone(),
            side: side.clone(),
        })
        .collect();
    if let Some((s, kind, side)) = &c.pause_open {
        pauses.push(Pause {
            start_tick: *s,
            end_tick: last_tick.max(*s),
            kind: kind.clone(),
            side: side.clone(),
        });
    }

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
        pauses,
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
pub(crate) fn build_voice_blob(c: &Collector) -> Vec<u8> {
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
