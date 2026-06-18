// Repacks already-parsed replay JSONs into the compressed `.cs2dv` archive,
// without re-parsing the `.dem` (so it needs no demo file). The majors carry no
// voice/comments, so those sections are written empty.
//
//   node scripts/json-to-cs2dv.mjs ../../replays/major-cologne-2026/qf1-nuke.json
//   node scripts/json-to-cs2dv.mjs ../../replays            # recurse a dir
//
// Pass --keep to leave the source .json in place (default removes it).

import { readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { encodeArchive } from './lib/cs2dv.mjs'

function collectJson(paths) {
  const out = []
  for (const p of paths) {
    const st = statSync(p)
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) out.push(...collectJson([join(p, name)]))
    } else if (p.endsWith('.json')) {
      out.push(p)
    }
  }
  return out
}

function encode(jsonPath) {
  const replay = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const base = jsonPath.replace(/\.json$/, '')
  const fileName = `${base.split('/').pop()}.dem`

  const gz = encodeArchive({ replay, fileName })
  writeFileSync(`${base}.cs2dv`, gz)
  return { out: `${base}.cs2dv`, raw: statSync(jsonPath).size, packed: gz.length }
}

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const inputs = args.filter((a) => a !== '--keep')
if (inputs.length === 0) {
  console.error('usage: node scripts/json-to-cs2dv.mjs <file.json|dir> [...] [--keep]')
  process.exit(1)
}

const files = collectJson(inputs)
if (files.length === 0) {
  console.error('no .json files found')
  process.exit(1)
}

for (const f of files) {
  const { out, raw, packed } = encode(f)
  const pct = ((1 - packed / raw) * 100).toFixed(0)
  console.log(`${out}  ${(raw / 1e6).toFixed(1)}MB -> ${(packed / 1e6).toFixed(1)}MB (-${pct}%)`)
  if (!keep) rmSync(f)
}
