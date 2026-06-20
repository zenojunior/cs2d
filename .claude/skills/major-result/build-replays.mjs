// Turns a folder of HLTV `.dem` files (one major match, one or more maps, some
// maps split into p1/p2 halves) into the committed `.cs2dv` replays for a bracket
// slot, then prints a JSON summary the skill uses to update the scoreboard in
// `apps/app/src/pages/major/playoffs.ts`.
//
//   node .claude/skills/major-result/build-replays.mjs <slot> <demDir> [--dir=major-cologne-2026]
//   e.g. node .claude/skills/major-result/build-replays.mjs qf4 ~/Downloads/falcons-vs-vitality
//
// It reuses the existing scripts (no parsing logic duplicated here):
//   - apps/app/scripts/process-major-demo.mjs  (parse one .dem -> .cs2dv)
//   - apps/app/scripts/merge-replay-parts.mjs  (concat p1+p2 -> one .cs2dv)
// Large demos need heap headroom, so every parse runs with
// --max-old-space-size=8192.
import { readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const scriptsDir = resolve(repoRoot, 'apps/app/scripts')

const argv = process.argv.slice(2)
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')),
)
const [slot, demDirArg] = argv.filter((a) => !a.startsWith('--'))
if (!slot || !demDirArg) {
  console.error('usage: build-replays.mjs <slot> <demDir> [--dir=major-cologne-2026]')
  console.error('  <slot>   bracket slot id from playoffs.ts (qf1, sf1, final, ...)')
  console.error('  <demDir> folder with the extracted .dem files for this match')
  process.exit(1)
}
const replayDir = flags.dir || 'major-cologne-2026'
const demDir = resolve(process.cwd(), demDirArg)
const outDir = resolve(repoRoot, 'replays', replayDir)
mkdirSync(outDir, { recursive: true })

// Group .dem files by map. HLTV names them like
//   <a>-vs-<b>-m<N>-<map>[-p<K>].dem
// Key on the map slug (its halves p1/p2 share it); m<N> only orders the maps.
const DEM_RE = /-m(\d+)-([a-z0-9_]+?)(?:-p(\d+))?\.dem$/i
const maps = new Map() // slug -> { mapNum, slug, parts: [{ part, path }] }
for (const name of readdirSync(demDir)) {
  if (!name.toLowerCase().endsWith('.dem')) continue
  const m = name.match(DEM_RE)
  if (!m) {
    console.error(`! skipping unrecognized file name: ${name}`)
    continue
  }
  const mapNum = Number(m[1])
  const slug = m[2].toLowerCase().replace(/^de_/, '') // store short slug (dust2, anubis)
  const part = m[3] ? Number(m[3]) : 1
  if (!maps.has(slug)) maps.set(slug, { mapNum, slug, parts: [] })
  const entry = maps.get(slug)
  entry.mapNum = Math.min(entry.mapNum, mapNum) // halves can carry the same m<N>
  entry.parts.push({ part, path: join(demDir, name) })
}
if (maps.size === 0) {
  console.error(`no .dem files found in ${demDir}`)
  process.exit(1)
}

const node = process.execPath
const heap = ['--max-old-space-size=8192']
function run(script, args) {
  // Inherit stderr so parser progress is visible; capture stdout to scrape the score line.
  return execFileSync(node, [...heap, resolve(scriptsDir, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

// Pulls "<ctName> <a>-<b> <tName>" out of either script's final log line.
function parseScore(stdout) {
  const m = stdout.match(/(?:score|final)=(.+?) (\d+)-(\d+) (.+?) \(/)
  if (!m) return null
  return { ctName: m[1].trim(), scoreCt: Number(m[2]), scoreT: Number(m[3]), tName: m[4].trim() }
}

const summary = []
for (const { mapNum, slug, parts } of [...maps.values()].sort((a, b) => a.mapNum - b.mapNum)) {
  parts.sort((a, b) => a.part - b.part)
  const outName = `${slot}-${slug}.cs2dv`
  const outPath = join(outDir, outName)
  let score

  if (parts.length === 1) {
    console.error(`\n=== map ${mapNum} (${slug}): 1 part ===`)
    score = parseScore(run('process-major-demo.mjs', [parts[0].path, outPath]))
  } else {
    console.error(`\n=== map ${mapNum} (${slug}): ${parts.length} parts, will merge ===`)
    const tmpParts = []
    for (const { part, path } of parts) {
      const tmp = join(tmpdir(), `${slot}-${slug}-p${part}.cs2dv`)
      run('process-major-demo.mjs', [path, tmp])
      tmpParts.push(tmp)
    }
    score = parseScore(run('merge-replay-parts.mjs', [outPath, ...tmpParts]))
    for (const t of tmpParts) if (existsSync(t)) rmSync(t)
  }

  const winnerName = score && (score.scoreCt > score.scoreT ? score.ctName : score.tName)
  summary.push({
    mapNum,
    map: `de_${slug}`,
    replay: `${replayDir}/${outName}`,
    ...(score ?? {}),
    winnerName: winnerName || null,
  })
}

// Machine-readable block for the skill to update playoffs.ts. Team names come
// straight from the demo (GOTV clan names); the skill maps them to TEAMS ids and
// counts map wins into scoreA/scoreB.
console.error('\n----- SUMMARY (JSON) -----')
console.log(JSON.stringify({ slot, replayDir, maps: summary }, null, 2))
