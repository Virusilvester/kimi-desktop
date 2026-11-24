/*
 * Migration e2e for the IndexedDB v3 schema (Block 2, ROADMAP step 5a).
 *
 * Characterization test for the destructive-upgrade defect: seeds a pre-v3
 * KimiOfflineDB with two legacy conversations, boots the app against it,
 * then asserts the conversations survived with byte-identical timestamps,
 * the hasPending index exists, and the backfill fields
 * (seq/syncStatus/lastSeq/hasPending) are in place. Also exercises the
 * renderer's own read path by listing the seeded conversations in the
 * sidebar, and the fresh-profile create path in a second launch.
 *
 * The seed runs in a throwaway minimal Electron app (generated below) that
 * shares the target --user-data-dir and writes a v1-shaped database, then
 * exits before the real app starts — deterministic, no init-script races.
 * file:// pages share one origin ('file://') for DOM storage, so the
 * seeder's database is the same database the app opens. The seed version
 * is 1 so that both the pre-fix code (DB_VERSION 2, upgrade deletes the
 * store) and the fixed code (DB_VERSION 3, additive) exercise their
 * upgrade path on the same seed: the old code loses the conversations,
 * the new code keeps them.
 *
 * Both real-app launches use throwaway --user-data-dir profiles; the real
 * ~/.config/kimi-dock is never touched.
 */
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SHOTS = '/tmp/kimi-desktop-e2e'
fs.mkdirSync(SHOTS, { recursive: true })

// Legacy-shaped records: no seq/syncStatus/hasPending/lastSeq, timestamps
// from 2023 so any bump by the migration is observable. The third record is
// already in v3 stored form (non-dense seqs, a pending message) to verify
// the migration preserves issued seqs/lastSeq and derives hasPending.
const LEGACY_CONVERSATIONS = [
  {
    id: 'legacy-conv-1',
    title: 'Migration Probe Alpha',
    messages: [
      { id: 'm1', role: 'user', content: 'legacy user message one', timestamp: 1700000000001 },
      { id: 'm2', role: 'assistant', content: 'legacy assistant reply', timestamp: 1700000000002 }
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000000003,
    isOffline: 1,
    seqs: [0, 1],
    syncStatuses: ['synced', 'synced'],
    lastSeq: 2,
    hasPending: 0
  },
  {
    id: 'legacy-conv-2',
    title: 'Migration Probe Beta',
    messages: [{ id: 'm3', role: 'user', content: 'second legacy chat', timestamp: 1700000100000 }],
    createdAt: 1700000099999,
    updatedAt: 1700000100001,
    isOffline: true, // v1 stored booleans; migration must normalize to the indexed 1/0 form
    isOfflineStored: 1,
    seqs: [0],
    syncStatuses: ['synced'],
    lastSeq: 1,
    hasPending: 0
  },
  {
    id: 'legacy-conv-3',
    title: 'Migration Probe Gamma',
    messages: [
      {
        id: 'm4',
        role: 'user',
        content: 'queued while offline',
        timestamp: 1700000200000,
        seq: 5,
        syncStatus: 'pending'
      },
      {
        id: 'm5',
        role: 'assistant',
        content: 'earlier reply',
        timestamp: 1700000200001,
        seq: 7,
        syncStatus: 'synced'
      }
    ],
    createdAt: 1700000199999,
    updatedAt: 1700000200002,
    isOffline: 1,
    hasPending: 1,
    lastSeq: 9,
    seqs: [5, 7],
    syncStatuses: ['pending', 'synced']
  }
]

// Minimal Electron app that writes the legacy database and exits. The page
// reports success/failure via its title; main maps it to the exit code.
const SEEDER_MAIN = `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false })
  win.on('page-title-updated', (event, title) => {
    if (title === 'seed-done' || title.startsWith('seed-error')) {
      console.log('[seeder] ' + title)
      // let the log line flush before exiting
      setTimeout(() => app.exit(title === 'seed-done' ? 0 : 1), 100)
    }
  })
  win.loadFile('seed.html')
})
setTimeout(() => {
  console.log('[seeder] timeout waiting for the seed page')
  app.exit(2)
}, 20000)
`

// The page is self-contained: only browser APIs, status via document.title.
const SEEDER_HTML = `<!doctype html>
<meta charset="utf-8">
<title>seeding</title>
<script>
  window.onerror = (event) => {
    document.title = 'seed-error: ' + String(event)
  }
  ;(async () => {
    const conversations = ${JSON.stringify(LEGACY_CONVERSATIONS)}
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('KimiOfflineDB', 1)
      open.onerror = () => reject(open.error)
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('conversations', { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('isOffline', 'isOffline', { unique: false })
      }
      open.onsuccess = () => resolve(open.result)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite')
      const store = tx.objectStore('conversations')
      for (const conversation of conversations) store.put(conversation)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    document.title = 'seed-done'
  })().catch((error) => {
    document.title = 'seed-error: ' + String(error)
  })
</script>
`

const assert = (condition, message) => {
  if (!condition) throw new Error(`migration e2e: ${message}`)
}

// Reads the on-disk schema and records as-is (stored form, no fromRecord).
// Self-contained: runs in the renderer, no module scope available.
const probeDatabase = async () => {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('KimiOfflineDB')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const version = db.version
  const indexNames = []
  let records = []
  try {
    const tx = db.transaction('conversations', 'readonly')
    const store = tx.objectStore('conversations')
    for (const name of store.indexNames) indexNames.push(name)
    records = await new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
  return { version, indexNames, records }
}

// Polls until the app has migrated the seeded data. Self-contained: runs in
// the renderer, no module scope available.
const migrationCompleted = async (expectedCount) => {
  try {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('KimiOfflineDB')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      if (db.version !== 3) return false
      const count = await new Promise((resolve, reject) => {
        const tx = db.transaction('conversations', 'readonly')
        const request = tx.objectStore('conversations').count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return count === expectedCount
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

const assertMigrated = (probe) => {
  assert(
    probe.records.length === LEGACY_CONVERSATIONS.length,
    `expected ${LEGACY_CONVERSATIONS.length} conversations after migration, got ${probe.records.length} (db version ${probe.version})`
  )
  for (const legacy of LEGACY_CONVERSATIONS) {
    const record = probe.records.find((r) => r.id === legacy.id)
    assert(record, `conversation "${legacy.id}" did not survive the migration`)
    assert(record.title === legacy.title, `"${legacy.id}" title changed: ${record.title}`)
    assert(
      record.createdAt === legacy.createdAt,
      `"${legacy.id}" createdAt moved: ${record.createdAt} != ${legacy.createdAt}`
    )
    assert(
      record.updatedAt === legacy.updatedAt,
      `"${legacy.id}" updatedAt bumped: ${record.updatedAt} != ${legacy.updatedAt}`
    )
    assert(
      record.isOffline === (legacy.isOfflineStored ?? legacy.isOffline),
      `"${legacy.id}" isOffline changed: ${record.isOffline} != ${legacy.isOfflineStored ?? legacy.isOffline}`
    )
    assert(
      record.hasPending === legacy.hasPending,
      `"${legacy.id}" hasPending ${record.hasPending}, expected ${legacy.hasPending}`
    )
    assert(
      record.lastSeq === legacy.lastSeq,
      `"${legacy.id}" lastSeq ${record.lastSeq}, expected ${legacy.lastSeq}`
    )
    assert(
      Array.isArray(record.messages) && record.messages.length === legacy.messages.length,
      `"${legacy.id}" message count changed: ${record.messages?.length}`
    )
    legacy.messages.forEach((message, i) => {
      const actual = record.messages[i]
      assert(
        actual &&
          actual.id === message.id &&
          actual.role === message.role &&
          actual.content === message.content &&
          actual.timestamp === message.timestamp,
        `"${legacy.id}" message ${i} changed content`
      )
      assert(
        actual.seq === legacy.seqs[i],
        `"${legacy.id}" message ${i}: seq ${actual.seq}, expected ${legacy.seqs[i]}`
      )
      assert(
        actual.syncStatus === legacy.syncStatuses[i],
        `"${legacy.id}" message ${i}: syncStatus ${actual.syncStatus}, expected "${legacy.syncStatuses[i]}"`
      )
    })
  }
  assert(probe.version === 3, `expected DB version 3, got ${probe.version}`)
  for (const index of ['updatedAt', 'isOffline', 'hasPending']) {
    assert(
      probe.indexNames.includes(index),
      `missing index "${index}" (have: ${probe.indexNames.join(', ') || 'none'})`
    )
  }
}

const noSandbox = process.argv.includes('--no-sandbox')
const profileA = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-mig-seed-'))
const profileB = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-mig-fresh-'))
const seederAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-seeder-app-'))
let app = null
let appFresh = null
let ok = false

try {
  // Seed a v1-shaped database into profileA using a throwaway seeder app
  // that shares the profile dir, then exits before the real app starts.
  fs.writeFileSync(path.join(seederAppDir, 'package.json'), JSON.stringify({ main: 'main.cjs' }))
  fs.writeFileSync(path.join(seederAppDir, 'main.cjs'), SEEDER_MAIN)
  fs.writeFileSync(path.join(seederAppDir, 'seed.html'), SEEDER_HTML)
  const seeder = await electron.launch({
    args: [seederAppDir, `--user-data-dir=${profileA}`],
    chromiumSandbox: !noSandbox
  })
  if (seeder.process().stdout) {
    seeder.process().stdout.on('data', (chunk) => process.stdout.write(`[seeder] ${chunk}`))
  }
  const seederExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seeder app did not exit in time')), 30000)
    seeder.process().on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  if (seederExit !== 0) {
    let detail = ''
    try {
      detail = await (await seeder.firstWindow()).title()
    } catch {
      detail = '(window already gone)'
    }
    throw new Error(`seeder app exited with code ${seederExit}: ${detail}`)
  }

  // Launch 1: the app's open must migrate the seeded database.
  app = await electron.launch({
    args: ['.', `--user-data-dir=${profileA}`],
    chromiumSandbox: !noSandbox
  })
  const window = await app.firstWindow()
  await window.waitForFunction(migrationCompleted, LEGACY_CONVERSATIONS.length, {
    timeout: 15000,
    polling: 500
  })

  const probe = await window.evaluate(probeDatabase)
  assertMigrated(probe)
  console.log(
    '[e2e] Migration probe OK: version',
    probe.version,
    '| indexes:',
    probe.indexNames.join(', ')
  )

  // The renderer's own read path: sidebar must list the migrated
  // conversations (rows render after an async IndexedDB fetch — wait, don't
  // snapshot).
  await window.click('button.menu-btn')
  await window.waitForSelector('.conversation-sidebar', { timeout: 5000 })
  for (const legacy of LEGACY_CONVERSATIONS) {
    await window.waitForSelector(`text=${legacy.title}`, { timeout: 5000 })
  }
  await window.screenshot({ path: `${SHOTS}/mig-sidebar.png` })
  console.log('[e2e] Sidebar lists migrated conversations')
  await app.close()
  app = null

  // Launch 2: empty profile -> the app must create the v3 store directly.
  appFresh = await electron.launch({
    args: ['.', `--user-data-dir=${profileB}`],
    chromiumSandbox: !noSandbox
  })
  const freshWindow = await appFresh.firstWindow()
  await freshWindow.waitForFunction(
    async () => (await indexedDB.databases()).some((db) => db.name === 'KimiOfflineDB'),
    null,
    { timeout: 15000 }
  )
  const fresh = await freshWindow.evaluate(probeDatabase)
  assert(fresh.version === 3, `fresh profile: expected DB version 3, got ${fresh.version}`)
  for (const index of ['updatedAt', 'isOffline', 'hasPending']) {
    assert(
      fresh.indexNames.includes(index),
      `fresh profile: missing index "${index}" (have: ${fresh.indexNames.join(', ') || 'none'})`
    )
  }
  assert(
    fresh.records.length === 0,
    `fresh profile: expected 0 records, got ${fresh.records.length}`
  )
  console.log('[e2e] Fresh-profile create OK: version', fresh.version)
  await appFresh.close()
  appFresh = null

  ok = true
  console.log('[e2e] PASS')
} finally {
  for (const instance of [app, appFresh]) {
    if (instance) await instance.close().catch(() => {})
  }
  fs.rmSync(seederAppDir, { recursive: true, force: true })
  if (ok) {
    fs.rmSync(profileA, { recursive: true, force: true })
    fs.rmSync(profileB, { recursive: true, force: true })
  } else {
    console.log('[e2e] FAIL — profiles kept for debugging:', profileA, profileB)
  }
}
