// Copies the libzstd `.wasm` from the installed `@bokuweb/zstd-wasm` into
// `public/` so it is served from a stable URL (`/zstd.wasm`) with the right
// MIME type. We load it via an explicit path (see `decompress.ts`) instead of
// the package's `new URL('./zstd.wasm', import.meta.url)`, which Vite's dev
// server mis-resolves inside a Web Worker (it returns index.html → the wasm
// fails to compile). Runs on `predev`/`prebuild` so it never goes stale.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')

// The package's `exports` map blocks deep subpath resolution, so resolve the
// main entry and walk to the sibling wasm in `dist/web/`.
const mainUrl = import.meta.resolve('@bokuweb/zstd-wasm')
const pkgDist = dirname(dirname(fileURLToPath(mainUrl))) // .../dist
const src = resolve(pkgDist, 'web', 'zstd.wasm')
const dest = resolve(appRoot, 'public', 'zstd.wasm')

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log(`[sync-zstd-wasm] ${src} -> ${dest}`)
