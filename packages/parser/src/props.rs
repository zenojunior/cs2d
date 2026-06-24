//! Low-level readers over Source 2 entities, game rules, teams and game events.

use source2_demo::prelude::*;

pub(crate) fn side_of(team: i32) -> Option<&'static str> {
    match team {
        3 => Some("CT"),
        2 => Some("T"),
        _ => None,
    }
}

pub(crate) fn round1(n: f64) -> f64 {
    (n * 10.0).round() / 10.0
}

pub(crate) fn prop_i32(e: &Entity, name: &str) -> i32 {
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

pub(crate) fn prop_bool(e: &Entity, name: &str) -> bool {
    matches!(e.get_property_by_name(name), Ok(FieldValue::Boolean(true)))
}

pub(crate) fn prop_u64(e: &Entity, name: &str) -> u64 {
    match e.get_property_by_name(name) {
        Ok(FieldValue::Unsigned64(v)) => *v,
        Ok(FieldValue::Unsigned32(v)) => *v as u64,
        _ => 0,
    }
}

pub(crate) fn prop_u32(e: &Entity, name: &str) -> u32 {
    match e.get_property_by_name(name) {
        Ok(FieldValue::Unsigned32(v)) => *v,
        Ok(FieldValue::Unsigned16(v)) => *v as u32,
        _ => 0,
    }
}

/// World coordinate from the pawn cell + offset pair (CS2).
pub(crate) fn world_coord(e: &Entity, cell: &str, vec: &str) -> f64 {
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
pub(crate) fn pawn_yaw(e: &Entity) -> f64 {
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

/// Reads an i32 property from the game rules (CCSGameRulesProxy entity).
pub(crate) fn gamerules_i32(ctx: &Context, name: &str) -> Option<i32> {
    let proxy = ctx.entities().get_by_class_name("CCSGameRulesProxy").ok()?;
    match proxy.get_property_by_name(name) {
        Ok(FieldValue::Signed32(v)) => Some(*v),
        Ok(FieldValue::Unsigned32(v)) => Some(*v as i32),
        _ => None,
    }
}

/// Per-TEAM score (CT, T) read from the CCSTeam entities. m_iScore is the team
/// total (follows side switches), so slot 3 = current CT, slot 2 = current T.
pub(crate) fn team_scores(ctx: &Context) -> (i32, i32) {
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
pub(crate) fn team_names(ctx: &Context) -> (String, String) {
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

/// Current pause state from the game rules, or None when the match is live (or
/// in warmup). A tactical timeout reports the side that called it; an admin or
/// technical pause (match waiting for resume) reports no side.
pub(crate) fn pause_state(ctx: &Context) -> Option<(&'static str, Option<String>)> {
    let proxy = ctx.entities().get_by_class_name("CCSGameRulesProxy").ok()?;
    let flag = |name: &str| {
        matches!(
            proxy.get_property_by_name(name),
            Ok(FieldValue::Boolean(true))
        )
    };
    if flag("m_pGameRules.m_bWarmupPeriod") {
        return None;
    }
    if flag("m_pGameRules.m_bCTTimeOutActive") {
        Some(("tactical", Some("CT".to_string())))
    } else if flag("m_pGameRules.m_bTerroristTimeOutActive") {
        Some(("tactical", Some("T".to_string())))
    } else if flag("m_pGameRules.m_bMatchWaitingForResume") || flag("m_pGameRules.m_bGamePaused") {
        Some(("technical", None))
    } else {
        None
    }
}

/// Whether the game is in the warmup period.
pub(crate) fn in_warmup(ctx: &Context) -> bool {
    let proxy = match ctx.entities().get_by_class_name("CCSGameRulesProxy") {
        Ok(p) => p,
        Err(_) => return false,
    };
    matches!(
        proxy.get_property_by_name("m_pGameRules.m_bWarmupPeriod"),
        Ok(FieldValue::Boolean(true))
    )
}

pub(crate) fn ev_i32(ge: &GameEvent, key: &str) -> Option<i32> {
    ge.get_value(key).ok().and_then(|v| v.try_into().ok())
}

pub(crate) fn ev_f32(ge: &GameEvent, key: &str) -> f64 {
    ge.get_value(key)
        .ok()
        .and_then(|v| TryInto::<f32>::try_into(v).ok())
        .map(|f| f as f64)
        .unwrap_or(0.0)
}

pub(crate) fn ev_str(ge: &GameEvent, key: &str) -> Option<String> {
    ge.get_value(key)
        .ok()
        .and_then(|v| TryInto::<String>::try_into(v).ok())
}

pub(crate) fn ev_bool(ge: &GameEvent, key: &str) -> bool {
    ge.get_value(key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .unwrap_or(false)
}

/// Player name from the controller.
pub(crate) fn ev_name(ctrl: &Entity) -> String {
    match ctrl.get_property_by_name("m_iszPlayerName") {
        Ok(FieldValue::String(s)) => s.clone(),
        _ => String::new(),
    }
}
