// Trims the dead leading ticks from each round of an already-parsed `.cs2dv`,
// for replays whose source `.dem` is no longer available (so they cannot be
// re-parsed by the fixed WASM parser). The CS2 `round_start` event used as the
// round's `freezeStartTick` fires before the engine respawns players, so a round
// can open with the previous round's casualties still lying dead. This rebases
// each round to its actual respawn (first frame where every sampled player is
// alive at full health) and drops the earlier frames.
//
// Only rounds that OPEN with dead players are affected (respawn after
// round_start). Rounds that already open clean are left untouched.
//
//   node scripts/trim-dead-start.mjs <file.cs2dv> [...]   (rewrites in place)
//   node scripts/trim-dead-start.mjs --dry <file.cs2dv>   (report only)
import { gunzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeArchive } from './lib/cs2dv.mjs'

const MAGIC = 'CS2DV1'

function readArchive(path) {
  const c = gunzipSync(readFileSync(path))
  if (c.subarray(0, 6).toString('ascii') !== MAGIC) throw new Error(`${path}: bad magic`)
  let o = 6
  const sec = () => {
    const len = c.readUInt32LE(o)
    o += 4
    const buf = c.subarray(o, o + len)
    o += len
    return buf
  }
  const meta = JSON.parse(sec().toString('utf8'))
  const replay = JSON.parse(sec().toString('utf8'))
  const voice = sec()
  const comments = JSON.parse(sec().toString('utf8'))
  return { meta, replay, voice: voice.length ? new Uint8Array(voice) : null, comments }
}

const r1 = (x) => Math.round(x * 10) / 10

// Rebase a state keyframe series that only carries `t` (no tick): shift by
// deltaT, then keep the state in effect at the new t=0 (last keyframe at/under 0,
// clamped to 0) plus everything after it.
function rebaseStateSeries(arr, deltaT) {
  if (!arr || !arr.length) return arr || []
  const reb = arr.map((e) => ({ ...e, t: r1(e.t - deltaT) }))
  const before = reb.filter((e) => e.t <= 0)
  const after = reb.filter((e) => e.t > 0)
  if (before.length) {
    const carried = { ...before[before.length - 1], t: 0 }
    return [carried, ...after]
  }
  return after
}

/** Returns true if the round was trimmed. */
function trimRound(rd, tickRate) {
  const frames = rd.frames || []
  const idx = frames.findIndex(
    (f) => f.players.length > 0 && f.players.every((p) => p.alive && p.health === 100),
  )
  if (idx <= 0) return false // already opens at respawn (or no clean respawn found)

  const newFS = frames[idx].tick
  const oldFS = rd.freezeStartTick
  const deltaT = (newFS - oldFS) / tickRate

  // Collections carrying an absolute `tick`: filter + recompute `t` exactly.
  rd.frames = frames.slice(idx).map((f) => ({ ...f, t: r1((f.tick - newFS) / tickRate) }))
  rd.events = (rd.events || [])
    .filter((e) => e.tick >= newFS)
    .map((e) => ({ ...e, t: r1((e.tick - newFS) / tickRate) }))
  rd.chat = (rd.chat || [])
    .filter((c) => c.tick >= newFS)
    .map((c) => ({ ...c, t: r1((c.tick - newFS) / tickRate) }))

  // `t`-only collections: shift, then drop/clamp what falls before the respawn.
  rd.bomb = rebaseStateSeries(rd.bomb, deltaT)
  rd.grenadePaths = (rd.grenadePaths || [])
    .map((g) => ({ ...g, points: g.points.map((pt) => ({ ...pt, t: r1(pt.t - deltaT) })) }))
    .filter((g) => g.points.some((pt) => pt.t >= 0))
    .map((g) => ({ ...g, points: g.points.filter((pt) => pt.t >= 0) }))
  rd.groundWeapons = (rd.groundWeapons || [])
    .map((w) => ({ ...w, startT: r1(w.startT - deltaT), endT: r1(w.endT - deltaT) }))
    .filter((w) => w.endT >= 0)
    .map((w) => ({ ...w, startT: Math.max(0, w.startT) }))

  // Major GOTV demos never carry blinds/defuses; guard so we notice if that
  // ever changes rather than silently leaving them on the old time base.
  for (const k of ['blinds', 'defuses']) {
    if ((rd[k] || []).length) throw new Error(`round ${rd.number}: unexpected ${k}, needs rebasing`)
  }

  rd.freezeStartTick = newFS
  return true
}

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const files = args.filter((a) => a !== '--dry')
if (!files.length) {
  console.error('usage: node scripts/trim-dead-start.mjs [--dry] <file.cs2dv> [...]')
  process.exit(1)
}

for (const path of files) {
  const { meta, replay, voice, comments } = readArchive(path)
  const tickRate = replay.demoTickRate || 64
  let trimmed = 0
  for (const rd of replay.rounds) if (trimRound(rd, tickRate)) trimmed++
  const open = replay.rounds.filter(
    (rd) => (rd.frames[0]?.players || []).filter((p) => p.alive).length < 10,
  ).length
  console.log(`${path}: trimmed ${trimmed}/${replay.rounds.length} rounds | rounds still opening <10 alive: ${open}`)
  if (!dry) {
    writeFileSync(path, encodeArchive({ replay, fileName: meta.fileName, voice, comments }))
  }
}
