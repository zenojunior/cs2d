# CS Demo Analyzer

Watch and analyze **Counter-Strike 2** demos in 2D, right in your browser.
No install, no database, no Docker, no uploads: drop a `.dem` file and rewatch
the match round by round. Everything is parsed locally on your machine, and not
a single byte of the demo leaves your browser.

## Why

I had been using other tools to analyze demos, but there was always a lot of
bureaucracy to get them running: installing a database, spinning up a Docker
container, configuring all sorts of things. And none of them had a good visual
experience. Over the years I kept improving at UI/UX and front-end development,
so I wanted to build the tool I always wished I had, and make it open source so
it can grow with the community's support.

## Features

- **2D replay** with round-by-round playback of player movement, duels and timing.
- **Heatmaps** for deaths, presence and utility, filterable by side, player and round.
- **Grenade trajectories** for smokes, molotovs, HEs, flashes and decoys, with the
  option to jump straight into the replay from a throw.
- **Player comms**: in-game voice replayed alongside the action.
- **100% client-side**: the demo is read and parsed in a Web Worker; nothing is
  ever sent to a server.
- **Local history** of recently analyzed demos, kept in your browser (reopening
  one does not re-upload it).
- **Multi-language UI**: English, Portuguese and Spanish.

Supported uploads: `.dem`, `.gz`, `.zip` and `.zst` (CS2 / Source 2).

## Tech stack

- [Vue 3](https://vuejs.org), [Vue Router](https://router.vuejs.org) and
  [Vite](https://vite.dev)
- [Tailwind CSS](https://tailwindcss.com), [Reka UI](https://reka-ui.com) and
  [VueUse](https://vueuse.org)
- A custom [Rust](https://www.rust-lang.org) + **WebAssembly** demo parser built
  on top of [`source2-demo`](https://crates.io/crates/source2-demo)
- [`@bokuweb/zstd-wasm`](https://github.com/bokuweb/zstd-wasm) and
  [`fflate`](https://github.com/101arrowz/fflate) for decompressing uploads
- [pnpm](https://pnpm.io) workspaces with [Turborepo](https://turbo.build)

## Getting started

Requirements: **Node.js 20+** and **pnpm**.

```bash
pnpm install
pnpm dev
```

The app runs at the URL printed by Vite (default `http://localhost:5173`).

### Other scripts

```bash
pnpm build        # production build
pnpm preview      # preview the production build
pnpm type-check   # run vue-tsc across the workspace
```

## Project structure

```
apps/app            The web app (Vue 3 + Vite)
packages/parser     Rust crate compiled to WebAssembly (the .dem parser)
```

The WASM parser is an **out-of-band** Rust crate: it is compiled by hand via
`packages/parser/build.sh`, and the resulting `.wasm` is committed under
`apps/app/src/viewer/parser/`. Running or building the app does **not** require
the Rust toolchain; only contributors working on the parser itself do.

## Credits

This project stands on the shoulders of great open-source work:

- [`source2-demo`](https://crates.io/crates/source2-demo): streaming,
  event-driven Source 2 demo parser (Rust) that powers the `.dem` parser.
- [cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) by MurkyYT: radar
  overview images for the CS2 maps.
- [`@bokuweb/zstd-wasm`](https://github.com/bokuweb/zstd-wasm): WebAssembly
  Zstandard decoder for `.zst` demos.
- [`fflate`](https://github.com/101arrowz/fflate): fast, tiny gzip/zip inflate
  used to read compressed demos.

## Contributing

This is an open-source side project and contributions are very welcome.
Suggestions, ideas and bug reports are all appreciated: feel free to open an
issue or a pull request.
