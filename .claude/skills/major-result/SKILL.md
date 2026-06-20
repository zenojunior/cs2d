---
name: major-result
description: Add or update a major playoff result from an HLTV match. Given the HLTV match URL plus a folder of the extracted GOTV .dem files (one major match, one or more maps, some maps split into p1/p2 halves), it parses each map into a committed .cs2dv replay (merging split maps), then updates the scoreboard (scores + maps) for the right bracket slot in apps/app/src/pages/major/playoffs.ts. Use when the user wants to "add a major result", "process a major demo", "update the bracket/scoreboard" from an HLTV match, or pastes an hltv.org/matches/... URL with a downloaded demo.
---

# Add a major playoff result

Takes an HLTV match (URL + its downloaded GOTV demo) and produces the committed
`.cs2dv` replays plus the scoreboard update for the IEM major bracket.

## What the user provides

1. The **HLTV match URL** (e.g. `https://www.hltv.org/matches/2395000/...`). Used for
   human reference and to confirm teams/score; HLTV is Cloudflare-protected, so do
   NOT try to fetch it from here (curl and WebFetch both get a 403).
2. A **folder with the extracted `.dem` files**. HLTV ships the demo as a `.rar`
   that this environment cannot open (no unrar/7z), so the user extracts it first.
   File names look like `falcons-vs-vitality-m1-anubis-p1.dem` — note that some
   maps come in two halves (`-p1`, `-p2`) that must be merged into one replay.
3. The **bracket slot id** from `playoffs.ts` (`qf1`..`qf4`, `sf1`, `sf2`, `final`).
   If unsure, infer it: the two team names in the file (`<a>-vs-<b>`) match a
   slot's `teamA`/`teamB` (or its `sourceA`/`sourceB` winners for a TBD slot).
   Confirm with the user before writing.

If any of these is missing, ask for it before running anything.

## Steps

### 1. Build the replays

Run the orchestrator (from the repo root). It groups the `.dem` files by map,
parses each (with `--max-old-space-size=8192`), merges split maps, writes the
final `.cs2dv` files into `replays/<dir>/<slot>-<map>.cs2dv`, and prints a JSON
summary.

```bash
node .claude/skills/major-result/build-replays.mjs <slot> <demDir>
# e.g. node .claude/skills/major-result/build-replays.mjs qf4 ~/Downloads/falcons-vs-vitality
```

The replay dir defaults to `major-cologne-2026` (matches `REPLAY_DIR` in
`playoffs.ts`). Override with `--dir=<name>` for a different major.

Each map can take a while (large demos). The trailing `SUMMARY (JSON)` block on
stdout is what you use next: `{ slot, replayDir, maps: [{ mapNum, map, replay,
ctName, tName, scoreCt, scoreT, winnerName }] }`.

### 2. Update the scoreboard in playoffs.ts

Edit `apps/app/src/pages/major/playoffs.ts`, the `MATCHES` entry whose `id`
equals the slot:

- **`maps`**: replace with the summary's maps in `mapNum` order. Each entry is
  `{ map: '<map>', replay: \`${REPLAY_DIR}/<slot>-<slug>.cs2dv\` }` — use the
  `REPLAY_DIR` template literal already used by the other entries, not a raw
  string.
- **`scoreA` / `scoreB`**: count map wins per team. Map each map's `winnerName`
  (a GOTV clan name, e.g. "Team Vitality", "FALCONS") to a `TEAMS` id by matching
  against each team's `name`/`short` (case-insensitive, allow partial match).
  `scoreA` = maps won by the slot's `teamA`, `scoreB` = maps won by `teamB`.
- **`teamA` / `teamB`**: if the slot is still TBD (`null`), fill them from the
  matched team ids (order them so `teamA` is the higher seed, matching how the
  seeded quarterfinals are laid out). If already set, leave them.
- Leave `id`, `round`, `label`, `bestOf`, `date` as they are (only adjust `date`
  if the user gives a corrected one).

Show the user the resulting score (e.g. "Falcons 2-1 Vitality") and the team
mapping you inferred, and ask them to confirm before considering it done.

### 3. Sanity check

- `scoreA + scoreB` should equal the number of maps, and the higher score should
  match the series winner.
- Run `cd apps/app && pnpm type-check` to confirm `playoffs.ts` still compiles.
- The `.cs2dv` files live under the repo-root `replays/` dir (served via GitHub
  raw in prod), NOT under `public/`. Do not move them.

## Notes

- Map slug vs map id: the `.dem` carries a short slug (`dust2`); `playoffs.ts`
  uses the full id (`de_dust2`). The script emits both — use `map` for the field
  and the file name already embeds the slug.
- Do NOT commit or push. Per the repo rules, code is reviewed first; only commit
  when the user explicitly asks.
- If a `.dem` file name doesn't match `-m<N>-<map>[-p<K>].dem`, the script warns
  and skips it. Rename it to the expected pattern or pass a clean folder.
