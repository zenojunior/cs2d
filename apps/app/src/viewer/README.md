# `viewer/`

The CS2 demo viewer: load a `.dem` (or compressed/archived demo), parse it
client-side into a `Replay`, and play it back on a 2D radar with stat tabs and
annotations. Nothing is uploaded; the demo is parsed in the browser via WASM.

## Data flow

```
router.ts
  └─ DemoAnalyzerView.vue        route entry: file picker, recent demos, tabs
       │
       ├─ ingest/                bytes ──► Replay
       │    decompress(.worker)  unwrap .zst/.gz/.zip in a throwaway worker
       │    demoArchive          read/write the .dca archive (replay + comments + voice)
       │    demoParser.worker    run the WASM parser off-thread
       │    useDemoParser        orchestrates the two workers, exposes progress
       │    useRecentDemos       IndexedDB store of recently opened demos
       │
       ├─ domain/                the parsed data, as pure types/constants
       │    schema.ts            Replay, Round, PlayerState, VoiceData, comments…
       │    calibration.ts       MAP_CALIBRATION + world↔radar coordinate math
       │    colors / weaponIcons / roundOutcome
       │
       ├─ player/                play the Replay back
       │    ViewerStage          orchestrator: wires the pieces below together
       │    ViewerMap            the 2D radar canvas (players, grenades, shots…)
       │    ViewerControls       transport bar (+ ViewerTimeline, markers)
       │    ViewerRoster / ViewerScoreboard / ViewerKillfeed / ViewerChat
       │    useReplay            playback clock, tick state, speed
       │    useVoicePlayback / voiceCodec   in-game comms audio
       │
       ├─ analysis/              stat tabs computed from the Replay
       │    EconomyView (roundEconomy) · GrenadesView · HeatmapView (HeatmapPlot)
       │
       └─ comments/              replay annotations
            CommentsPanel / CommentPopover · useComments · commentAnchor / commentKinds

parser/   committed WASM artifacts (built by packages/parser/build.sh — do NOT move)
```

## Conventions

- Internal imports use the `@/viewer/<group>/<file>` alias, not relative paths.
- `parser/` is generated output: rebuild via `bash packages/parser/build.sh`
  after changing the Rust crate; never edit by hand and never relocate (the
  build script writes to this exact path).
- Adding a map? Drop its radar in `public/maps/` and add a `MAP_CALIBRATION`
  entry in `domain/calibration.ts` (see the root `CLAUDE.md`).
- New module? Give it a one-line header comment saying what it does.
