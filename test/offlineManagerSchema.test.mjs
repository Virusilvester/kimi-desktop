/*
 * Unit tests for the conversation schema transformations (Block 2).
 * Run: npm run test:unit
 *
 * These cover the pure logic of the v3 schema: seq issuance on save,
 * lastSeq advancement, the hasPending derivative, the stored/surfaced
 * conversions and the legacy migration backfill. The IndexedDB paths
 * themselves are covered by scripts/e2e-migration.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fromRecord,
  isUndelivered,
  migrateLegacyRecord,
  toRecord
} from '../.tmp/unit-build/renderer/src/utils/offlineManagerSchema.js'

const legacyConversation = {
  id: 'conv-1',
  title: 'Legacy',
  messages: [
    { id: 'a', role: 'user', content: 'hello', timestamp: 111 },
    { id: 'b', role: 'assistant', content: 'hi', timestamp: 222 }
  ],
  createdAt: 100,
  updatedAt: 300,
  isOffline: 1
}

test('isUndelivered treats pending/syncing/failed as undelivered', () => {
  assert.equal(isUndelivered('pending'), true)
  assert.equal(isUndelivered('syncing'), true)
  assert.equal(isUndelivered('failed'), true)
  assert.equal(isUndelivered('synced'), false)
  assert.equal(isUndelivered(undefined), false)
})

test('toRecord stamps seq from lastSeq+1 for messages without one', () => {
  const record = toRecord({ ...legacyConversation, lastSeq: 10 })
  assert.deepEqual(
    record.messages.map((m) => m.seq),
    [11, 12]
  )
  assert.equal(record.lastSeq, 12)
})

test('toRecord keeps supplied seqs and advances lastSeq past them', () => {
  const record = toRecord({
    ...legacyConversation,
    messages: [
      { id: 'a', role: 'user', content: 'x', timestamp: 1, seq: 7 },
      { id: 'b', role: 'assistant', content: 'y', timestamp: 2 }
    ],
    lastSeq: 7
  })
  assert.deepEqual(
    record.messages.map((m) => m.seq),
    [7, 8]
  )
  assert.equal(record.lastSeq, 8)
})

test('toRecord derives hasPending for pending/syncing/failed only', () => {
  for (const status of ['pending', 'syncing', 'failed']) {
    const record = toRecord({
      ...legacyConversation,
      messages: [{ id: 'a', role: 'user', content: 'x', timestamp: 1, syncStatus: status }]
    })
    assert.equal(record.hasPending, 1, status)
  }
  const synced = toRecord({
    ...legacyConversation,
    messages: [{ id: 'a', role: 'user', content: 'x', timestamp: 1, syncStatus: 'synced' }]
  })
  assert.equal(synced.hasPending, 0)
  const implicit = toRecord(legacyConversation)
  assert.equal(implicit.hasPending, 0)
})

test('toRecord normalizes isOffline and leaves every timestamp untouched', () => {
  const record = toRecord({ ...legacyConversation, isOffline: true })
  assert.equal(record.isOffline, 1)
  assert.equal(record.createdAt, 100)
  assert.equal(record.updatedAt, 300)
  assert.deepEqual(
    record.messages.map((m) => m.timestamp),
    [111, 222]
  )
})

test('save -> read -> save is stable (no seq re-stamping)', () => {
  const first = toRecord(legacyConversation)
  const second = toRecord(fromRecord(first))
  assert.deepEqual(
    second.messages.map((m) => m.seq),
    first.messages.map((m) => m.seq)
  )
  assert.equal(second.lastSeq, first.lastSeq)
  assert.equal(second.hasPending, first.hasPending)
})

test('fromRecord surfaces booleans and defaults lastSeq', () => {
  const surfaced = fromRecord({ ...legacyConversation, hasPending: 1 })
  assert.equal(surfaced.isOffline, true)
  assert.equal(surfaced.hasPending, true)
  assert.equal(surfaced.lastSeq, 0)
  assert.equal(surfaced.messages[0].syncStatus, 'synced')
})

test('migrateLegacyRecord backfills seq by position and synced status', () => {
  const migrated = migrateLegacyRecord(legacyConversation)
  assert.deepEqual(
    migrated.messages.map((m) => m.seq),
    [0, 1]
  )
  assert.deepEqual(
    migrated.messages.map((m) => m.syncStatus),
    ['synced', 'synced']
  )
  assert.equal(migrated.lastSeq, 2)
  assert.equal(migrated.hasPending, 0)
  assert.equal(migrated.updatedAt, 300)
})

test('migrateLegacyRecord preserves issued seqs/lastSeq and pending status', () => {
  const migrated = migrateLegacyRecord({
    ...legacyConversation,
    messages: [
      { id: 'a', role: 'user', content: 'x', timestamp: 1, seq: 5, syncStatus: 'pending' },
      { id: 'b', role: 'assistant', content: 'y', timestamp: 2, seq: 7, syncStatus: 'synced' }
    ],
    lastSeq: 9,
    hasPending: 1
  })
  assert.deepEqual(
    migrated.messages.map((m) => m.seq),
    [5, 7]
  )
  assert.equal(migrated.lastSeq, 9)
  assert.equal(migrated.hasPending, 1)
})

test('migrateLegacyRecord normalizes boolean isOffline to the indexed 1/0 form', () => {
  const migrated = migrateLegacyRecord({ ...legacyConversation, isOffline: true })
  assert.equal(migrated.isOffline, 1)
})
