# CS2 2D Demo Viewer extension (Faceit)

Browser extension (built with [WXT](https://wxt.dev/)) that downloads Faceit CS2
match demos, parses them locally into the light `.cs2dv` format, and manages a
local library, all inside the extension. Nothing is uploaded to any server.

## Why in-extension (and not a redirect to the web app)

Demos are large (~500 MB) and only the extension's privileged contexts can fetch
them from Faceit's CDN (no CORS). Crucially, `chrome.runtime` messaging
serializes payloads as JSON, which **corrupts binary** (a `Uint8Array` becomes a
plain object). So the bytes must never cross a runtime message. The fix: the
context that downloads also parses. An **offscreen document** (extension origin)
does fetch + decompress + WASM parse + store, and only small JSON progress
crosses `chrome.runtime`.

## Architecture

```
Faceit page
 ├─ faceit-intercept (MAIN world): captures the signed demo URL from the page's
 │     own download request (no API key)
 └─ faceit (overlay): a Vue app in a Shadow DOM (Tailwind v4 + shadcn-vue, fully
       isolated from Faceit's CSS). Draggable library panel — in-progress jobs,
       stored demos, disk usage, map-art cards; "Download this match" on /room/
            │ ENQUEUE { matchId, url } (small JSON)
            ▼
 background (service worker): job queue + state; keeps the offscreen alive
            │ PROCESS { job }
            ▼
 offscreen document (our CSP, wasm-unsafe-eval):
   fetch (CORS-exempt) → decompress (.gz) → WASM parser (Web Worker)
   → .cs2dv → IndexedDB → discard the 500 MB raw
```

State and bytes:

- **IndexedDB** (`cs2dv-ext`, extension origin) holds the `.cs2dv` blob + light
  metadata; shared by the offscreen (writes) and background (reads).
- Only `.cs2dv` is kept; the raw demo is discarded after parsing.

## Shared pipeline (`@cs2/replay-core`) + vendored `lib/`

The framework-free demo pipeline (schema types, `.cs2dv` codec, voice codec) is
shared from the `@cs2/replay-core` workspace package and imported by name, so the
app and the extension build from one source.

What still lives under `lib/` is what can't be shared cleanly: the parser worker
shell and the committed WASM artifacts (`lib/parser/`). The wasm is bundled via a
`?url` import and its URL is passed into the worker (`new URL(..., import.meta.url)`
isn't emitted in the WXT build). **Keep `lib/parser/` in sync when the app's
parser changes.**

## Develop / test

```bash
pnpm install            # from the repo root
cd apps/extension && pnpm build
```

Load `apps/extension/.output/chrome-mv3` unpacked (`chrome://extensions` →
Developer mode → Load unpacked). Test with a **production build**, not `pnpm dev`
(its HMR handshake is flaky for content scripts).

Open a Faceit CS2 match room: the library panel shows a **Download this match**
button. If the URL can't be resolved from the API, click Faceit's own
**Download demo** once (the interceptor captures it), then download again.

To watch the pipeline: `chrome://extensions` → the extension → **service worker**
and **offscreen.html** consoles.

## Current limitations

- Jobs run one at a time (parsing is memory-heavy); the queue shows others as
  queued. Concurrent downloads can be raised later.
- Only `.dem.gz` and raw `.dem` are handled; `.zst` is not wired up yet.
- Viewing a stored `.cs2dv` isn't built yet (Phase 2: a viewer inside the
  extension, reusing the app's components, so demos play without the site).
- `host_permissions` is scoped to the shipping/next sources (`*.faceit.com`,
  `*.faceit-cdn.net`, `*.hltv.org`, `*.gamersclub.com.br`); later sources
  (`valve.net`, `5eplay.com`, `renown.gg`) are `optional_host_permissions`
  requested at runtime (see `utils/permissions.ts`). A demo served from an
  unlisted CDN host (e.g. HLTV's 302 redirect target) fails with a CORS error
  until that host is added.
