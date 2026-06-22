// Guards `pnpm zip` (via the prezip hook) against shipping a bad version. A
// stray 0.0.0 once landed in .output; the Chrome Web Store rejects an invalid
// or non-incrementing version, so fail fast before building the upload artifact.
// Checks: the version is valid semver and not the 0.0.0 placeholder.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(here, '..', 'package.json')
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'))

// Plain x.y.z (the Chrome Web Store wants up to four dot-separated integers; we
// keep it to the three we use). Reject 0.0.0, the "unset" placeholder.
const SEMVER = /^\d+\.\d+\.\d+$/

if (!SEMVER.test(version)) {
  console.error(`[check-version] invalid version "${version}" in package.json (expected x.y.z)`)
  process.exit(1)
}
if (version === '0.0.0') {
  console.error('[check-version] version is 0.0.0 — bump it before zipping for the store')
  process.exit(1)
}

console.log(`[check-version] ok: ${version}`)
