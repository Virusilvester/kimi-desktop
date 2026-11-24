/*
 * Verify that expected strings reached the packaged app (AI.md #24:
 * shipped JS is checked inside app.asar, not in out/).
 *
 *   npm run verify:artifact -- forceOfflineMode "Forced Offline"
 *
 * Extracts out/main/index.js, out/preload/index.js and the renderer
 * bundle from dist/linux-arm64-unpacked/resources/app.asar into a temp
 * dir, greps every extracted file for each expected string, then removes
 * the temp dir in a finally block. Exits 1 on any miss.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const asarPath = path.join(repoRoot, 'dist/linux-arm64-unpacked/resources/app.asar')
const expected = process.argv.slice(2)

if (expected.length === 0) {
  console.error('usage: verify-artifact.mjs <string> [<string>...]')
  process.exit(1)
}
if (!fs.existsSync(asarPath)) {
  console.error(`[verify-artifact] app.asar not found: ${asarPath} — run "npm run release" first`)
  process.exit(1)
}

const asar = (args) => execFileSync('npx', ['--yes', 'asar', ...args], { encoding: 'utf-8' })

// asar's hashed asset names differ from out/: locate the renderer bundle
// inside the archive instead of guessing the name. list prefixes entries
// with "/", but extract-file wants the bare relative path.
const entries = asar(['list', asarPath])
const rendererEntry = entries
  .split('\n')
  .map((line) => line.trim().replace(/^\//, ''))
  .find((line) => /^out\/renderer\/assets\/index-[^/]+\.js$/.test(line))
if (!rendererEntry) throw new Error('renderer bundle not found inside app.asar')

const targets = ['out/main/index.js', 'out/preload/index.js', rendererEntry]
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-verify-asar-'))
const bundles = []
let failed = false

try {
  for (const entry of targets) {
    // extract-file writes basename into the CURRENT directory — chdir per
    // target so main/index.js and preload/index.js do not collide.
    const dir = path.join(tempDir, entry.replace(/\//g, '_').replace(/\.js$/, ''))
    fs.mkdirSync(dir)
    process.chdir(dir)
    asar(['extract-file', asarPath, entry])
    bundles.push({
      name: entry,
      text: fs.readFileSync(path.join(dir, path.basename(entry)), 'utf-8')
    })
  }

  // A token "shipped" if it reached at least one bundle (e.g. the
  // settings-changed event name lives in main + preload, never renderer).
  for (const needle of expected) {
    const hits = bundles.filter((b) => b.text.includes(needle)).map((b) => b.name)
    console.log(
      `[verify-artifact] "${needle}" → ${hits.length ? `OK (${hits.join(', ')})` : 'MISS'}`
    )
    if (hits.length === 0) failed = true
  }
  if (!failed) console.log('[verify-artifact] PASS')
} finally {
  process.chdir(repoRoot)
  fs.rmSync(tempDir, { recursive: true, force: true })
}

// Single exit point, after the finally above has cleaned up the temp dir.
process.exit(failed ? 1 : 0)
