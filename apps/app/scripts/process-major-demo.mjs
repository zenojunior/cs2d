// Parses a raw `.dem` into a full-match `Replay` JSON, consumed on demand by the
// Major page's "watch" button. The JSON is committed under the repo-root
// `replays/` folder (NOT public/) so it ships only via GitHub raw, never in the
// app bundle or the PWA precache.
//
//   node scripts/process-major-demo.mjs <demPath> <outPath>
//   e.g. node scripts/process-major-demo.mjs ../../aurora-vs-betboom-m1-nuke.dem \
//          ../../replays/major-cologne-2026/qf1-nuke.json
//
// Large demos need extra heap: `node --max-old-space-size=8192 ...`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initSync, parse_demo } from '../src/viewer/parser/demo_parser.js'

const here = dirname(fileURLToPath(import.meta.url))
const [demArg, outArg] = process.argv.slice(2)
if (!demArg || !outArg) {
  console.error('usage: process-major-demo.mjs <demPath> <outPath>')
  process.exit(1)
}

// Instantiate the wasm parser directly from bytes (no fetch needed in Node).
const wasmBytes = readFileSync(resolve(here, '../src/viewer/parser/demo_parser_bg.wasm'))
initSync({ module: wasmBytes })

const dem = new Uint8Array(readFileSync(resolve(process.cwd(), demArg)))
console.log(`parsing ${demArg} (${(dem.length / 1024 / 1024).toFixed(0)} MB)…`)
const out = parse_demo(dem, 8)
const replayJson = out.replay
out.free()

const replay = JSON.parse(replayJson)

const outPath = resolve(process.cwd(), outArg)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, replayJson)
console.log(
  `wrote ${outArg}: map=${replay.map} rounds=${replay.rounds.length} ` +
    `score=${replay.finalCtName} ${replay.finalScoreCt}-${replay.finalScoreT} ${replay.finalTName} ` +
    `(${(replayJson.length / 1024 / 1024).toFixed(1)} MB)`,
)
