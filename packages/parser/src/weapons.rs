//! Weapon name resolution and inventory helpers.
//!
//! The parser only ever exposes the short display labels the 2D viewer knows
//! (its `weaponIconPath` FILE table), so every raw Source 2 classname is mapped
//! to a label here, in one place. The lookup tables are plain `const` slices so
//! adding a weapon is a one-line change with no logic to touch.

use crate::collector::GrenadeKind;
use crate::props::prop_u32;
use source2_demo::prelude::*;

/// Single display label every knife skin collapses to (CS2 ships dozens).
const KNIFE_LABEL: &str = "Faca";

/// Classname substrings that identify a knife, regardless of skin.
const KNIFE_NEEDLES: &[&str] = &[
    "knife", "bayonet", "karambit", "huntsman", "falchion", "bowie", "butterfly", "daggers",
    "navaja", "stiletto", "ursus", "talon", "paracord", "survival", "nomad", "skeleton", "kukri",
    "flip", "gut",
];

/// (classname substring -> grenade label). Labels must match the ones the viewer
/// filters/draws; checked before guns.
const GRENADE_LABELS: &[(&str, &str)] = &[
    ("hegrenade", "HE"),
    ("smokegrenade", "Smoke"),
    ("flashbang", "Flash"),
    ("incendiary", "Molotov"),
    ("incgrenade", "Molotov"),
    ("molotov", "Molotov"),
    ("decoy", "Decoy"),
];

/// (classname substring -> gun display name). Order matters: specific variants
/// come before the generic ones (e.g. `usp_silencer` before `usp`).
const GUN_LABELS: &[(&str, &str)] = &[
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

/// Pistol labels (secondary weapons), used to rank a player's inventory.
const PISTOL_LABELS: &[&str] = &[
    "Deagle",
    "R8 Revolver",
    "Dual Berettas",
    "Five-SeveN",
    "Glock-18",
    "USP-S",
    "P2000",
    "P250",
    "Tec-9",
    "CZ75-Auto",
];

/// Throwable labels held in the pawn inventory (no firearm).
const GRENADE_INVENTORY_LABELS: &[&str] = &["HE", "Smoke", "Flash", "Molotov", "Decoy"];

/// Inventory labels that are not a firearm, skipped when picking the main gun.
const NON_GUN_LABELS: &[&str] = &[KNIFE_LABEL, "HE", "Smoke", "Flash", "Molotov", "Decoy", "C4", "Zeus x27"];

/// Short weapon label from a raw name (entity class or event name). Covers knives
/// (-> "Faca"), grenades and the most common weapons; the rest returns empty.
pub(crate) fn weapon_label(raw: &str) -> String {
    let s = raw.to_lowercase();
    if KNIFE_NEEDLES.iter().any(|k| s.contains(k)) {
        return KNIFE_LABEL.into();
    }
    for (needle, label) in GRENADE_LABELS {
        if s.contains(needle) {
            return (*label).into();
        }
    }
    for (needle, label) in GUN_LABELS {
        if s.contains(needle) {
            return (*label).into();
        }
    }
    String::new()
}

/// Whether a `player_hurt` weapon classname is a damaging grenade: HE grenade or
/// molotov/incendiary (burn damage reports as "inferno"). Smokes/flashes/decoys
/// deal no health damage, so they never reach here.
pub(crate) fn is_utility_weapon(weapon: &str) -> bool {
    weapon.contains("hegrenade")
        || weapon.contains("inferno")
        || weapon.contains("molotov")
        || weapon.contains("incgrenade")
}

/// Grenade type from the in-flight projectile entity class.
pub(crate) fn proj_kind(class: &str) -> Option<GrenadeKind> {
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
pub(crate) fn grenade_inventory(ctx: &Context, pawn: &Entity) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Ok(it) = pawn.get_iter("m_pWeaponServices.m_hMyWeapons") {
        for h in it.flatten() {
            let hv: usize = match h.try_into() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Ok(w) = ctx.entities().get_by_handle(hv) {
                let label = weapon_label(w.class().name());
                if GRENADE_INVENTORY_LABELS.contains(&label.as_str()) && !out.contains(&label) {
                    out.push(label);
                }
            }
        }
    }
    out
}

/// Resolves a pawn active weapon into the short label.
pub(crate) fn active_weapon_label(ctx: &Context, pawn: &Entity) -> String {
    let handle = prop_u32(pawn, "m_pWeaponServices.m_hActiveWeapon");
    if handle == 0 || handle == u32::MAX {
        return String::new();
    }
    match ctx.entities().get_by_handle(handle as usize) {
        Ok(w) => disambiguate_usp(&w, weapon_label(w.class().name())),
        Err(_) => String::new(),
    }
}

/// The player's main gun from the inventory: a primary (rifle/SMG/sniper/shotgun/MG)
/// wins outright, otherwise the first pistol carried. Empty if they only hold a
/// knife/grenades/C4/Zeus. Used to surface the stowed weapon while the knife is out.
pub(crate) fn primary_weapon(ctx: &Context, pawn: &Entity) -> String {
    let mut pistol = String::new();
    if let Ok(it) = pawn.get_iter("m_pWeaponServices.m_hMyWeapons") {
        for h in it.flatten() {
            let hv: usize = match h.try_into() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Ok(w) = ctx.entities().get_by_handle(hv) {
                let label = disambiguate_usp(&w, weapon_label(w.class().name()));
                if label.is_empty() || NON_GUN_LABELS.contains(&label.as_str()) {
                    continue;
                }
                if is_pistol(&label) {
                    if pistol.is_empty() {
                        pistol = label;
                    }
                } else {
                    return label;
                }
            }
        }
    }
    pistol
}

/// USP-S and P2000 share the CWeaponHKP2000 class; the item definition index
/// disambiguates them (61 = USP-S, 32 = P2000). Rewrites a raw P2000 label.
fn disambiguate_usp(w: &Entity, label: String) -> String {
    if label == "P2000" && prop_u32(w, "m_iItemDefinitionIndex") == 61 {
        "USP-S".into()
    } else {
        label
    }
}

/// Whether a weapon label is a pistol (secondary), as opposed to a primary gun.
fn is_pistol(label: &str) -> bool {
    PISTOL_LABELS.contains(&label)
}
