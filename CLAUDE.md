# CS Demo Analyzer

## Workflow rules

- NEVER run `git commit` or `git push` without explicit permission. All code must
  be reviewed first.
- Only commit, push, or open/post a review when the prompt explicitly asks for it.
- NEVER run broad process-killing commands (`pkill -f vite`, `pkill -f node`,
  `killall node`, `kill %1`, etc.). The user keeps their own `pnpm dev` running on
  port 5174, and these patterns terminate it. If you need a dev server to test,
  reuse the one already on 5174 (don't start a second); if you must launch your own,
  capture its exact PID and kill ONLY that PID — never match by name/pattern.

## Project layout

- Monorepo (pnpm workspace + Turbo). Main app: `apps/app` (Vue 3 + Vite, port 5174).
- Run from `apps/app`: `pnpm dev`, `pnpm build`, `pnpm type-check`.
- Everything runs client-side: the demo is parsed in the browser (WASM); nothing
  is uploaded to any server.
- The viewer lives in `apps/app/src/viewer/`, grouped by concern (see its
  `README.md`):
  - `ingest/` — load bytes into a `Replay` (parser worker, decompression,
    `.dca` archive, recent-demos store).
  - `player/` — the replay stage and its parts (`ViewerStage`, `ViewerMap`,
    controls, roster, killfeed, voice playback, timeline markers).
  - `analysis/` — the stat tabs (economy, grenades, heatmap).
  - `comments/` — replay annotations.
  - `domain/` — pure types and data (`schema.ts`, `calibration.ts`, `colors.ts`,
    weapon icons, round outcome).
  - `parser/` — committed WASM artifacts (written by `build.sh`, do not move).
  - `DemoAnalyzerView.vue` is the route entry (`router.ts`).
  - Internal imports use the `@/viewer/<group>/<file>` alias.

## WASM demo parser

- The Rust crate in `packages/parser/` compiles to the wasm the app consumes.
  After ANY change under `packages/parser/src/`, rebuild with
  `bash packages/parser/build.sh` — the artifacts are committed to
  `apps/app/src/viewer/parser/` (no pipeline regenerates them).
- The `wasm-bindgen-cli` version MUST match the `wasm-bindgen` dep in Cargo.toml
  (currently 0.2.125).
- To test the parser without a browser: `initSync({ module })` + `parse_demo(bytes, 8)`
  in Node (see `apps/app/scripts/extract-preview.mjs`).

## Decompression (.zst / .gz / .zip uploads)

- zstd uses `@bokuweb/zstd-wasm` (NOT `fzstd`, which has a Huffman-decoding bug).
  The wasm is copied to `public/zstd.wasm` by `scripts/sync-zstd-wasm.mjs`
  (predev/prebuild hooks) and loaded via an explicit path.
- Decompression runs in a throwaway worker, terminated before parsing, to reclaim
  memory.

## Conventions

- Source-code comments in English.
- i18n: `vue-i18n`. Each locale is a JSON catalog in `src/locales/<code>.json`;
  add every new key to all of them. `src/i18n.ts` wires it up: pt is bundled as the
  fallback, the rest lazy-load on selection. To add a locale, drop a `<code>.json`
  (same shape as `pt.json`) and add an entry to `LOCALES` (with its circle-flag
  country code) plus the `LocaleCode` union.

## Assets

### Map radars
The radar images in `apps/app/public/maps/` come from the **cs2-map-icons** repo:
https://github.com/MurkyYT/cs2-map-icons/tree/main/images/radars

When adding support for a new map, grab its radar from there and add a matching
entry to `MAP_CALIBRATION` in `apps/app/src/viewer/domain/calibration.ts` (using the
official overview `pos_x` / `pos_y` / `scale` values). Without a calibration
entry the viewer falls back to `de_dust2`, so the map renders with the wrong
radar and coordinates.
