// Extracts a single round from a raw `.dem` into a landing-page preview fixture
// (a `Replay` trimmed to one round), consumed by `DemoPreviewLoop.vue`.
//
//   node scripts/extract-preview.mjs <demPath> <roundNumber> <outPath>
//   e.g. node scripts/extract-preview.mjs ../../betboom-vs-furia-m2-dust2.dem 11 public/replays/dust2-preview.json
//
// Run with extra heap for large demos: `node --max-old-space-size=4096 ...`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initSync, parse_demo } from '../src/viewer/parser/demo_parser.js'

const here = dirname(fileURLToPath(import.meta.url))
const [demArg, roundArg, outArg] = process.argv.slice(2)
if (!demArg || !roundArg || !outArg) {
  console.error('usage: extract-preview.mjs <demPath> <roundNumber> <outPath>')
  process.exit(1)
}
const roundNumber = Number(roundArg)

// Instantiate the wasm parser directly from bytes (no fetch needed in Node).
const wasmBytes = readFileSync(resolve(here, '../src/viewer/parser/demo_parser_bg.wasm'))
initSync({ module: wasmBytes })

const dem = new Uint8Array(readFileSync(resolve(process.cwd(), demArg)))
console.log(`parsing ${demArg} (${(dem.length / 1024 / 1024).toFixed(0)} MB)…`)
const out = parse_demo(dem, 8)
const replay = JSON.parse(out.replay)
out.free()

const round = replay.rounds.find((r) => r.number === roundNumber)
if (!round) {
  console.error(
    `round ${roundNumber} not found (demo has rounds ${replay.rounds[0]?.number}..${replay.rounds.at(-1)?.number})`,
  )
  process.exit(1)
}

// Keep everything but trim to the single round so the preview loops just it.
const fixture = {
  ...replay,
  rounds: [round],
  generatedBy: `extract-preview.mjs ${demArg} round ${roundNumber}`,
}

const outPath = resolve(process.cwd(), outArg)
writeFileSync(outPath, JSON.stringify(fixture))
console.log(
  `wrote ${outArg}: map=${replay.map} round=${roundNumber} frames=${round.frames.length} ` +
    `(${(JSON.stringify(fixture).length / 1024).toFixed(0)} KB)`,
)
