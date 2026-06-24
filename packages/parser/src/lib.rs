//! CS2 demo parser in WebAssembly.
//!
//! Reads the bytes of a `.dem` (CS2 / Source 2) and emits the `Replay` JSON in
//! the `replay-schema 2D` format, the same contract the 2D viewer consumes. Runs
//! in the browser inside a Web Worker; no data leaves the machine.
//!
//! Uses `source2-demo` (a streaming, event-driven parser), so memory usage stays
//! well below the wasm32 4 GB ceiling, even on long demos.

use source2_demo::prelude::*;
use std::cell::RefCell;
use std::rc::Rc;

mod assemble;
mod collector;
mod props;
mod schema;
mod weapons;

use assemble::{build_replay, build_voice_blob};
use collector::Collector;

const DEMO_TICK_RATE: f64 = 64.0;
const GENERATED_BY: &str = "cs2-demo-parser-wasm@0.0.0";

/// Parses the bytes of a `.dem` in a single pass and returns `(Replay JSON, voice
/// blob)`. The `Replay` matches `replay-schema 2D`; the blob follows the `CLV2`
/// layout (see `assemble::build_voice_blob`), empty when the demo has no voice.
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
