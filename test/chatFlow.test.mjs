/*
 * Unit tests for the offline-chat send-flow transformations.
 * Run: npm run test:unit
 *
 * These cover the logic the serial send queue relies on: messages enter as
 * 'pending', the request body carries each message exactly once, and a reply
 * marks exactly the messages that were sent — the regression behind "already
 * answered messages are re-sent" is pinned by the interleaved scenario.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendUserMessage,
  applyAssistantReply,
  pendingUserMessages,
  toApiMessages
} from '../.tmp/unit-build/renderer/src/utils/chatFlow.js'

const emptyConversation = {
  id: 'conv-1',
  title: '',
  messages: [],
  createdAt: 100,
  updatedAt: 100,
  isOffline: true
}

test('appendUserMessage queues the message as pending with queuedAt', () => {
  const conv = appendUserMessage(emptyConversation, { id: 'm1', content: 'hello', now: 200 })
  assert.equal(conv.messages.length, 1)
  const [message] = conv.messages
  assert.equal(message.role, 'user')
  assert.equal(message.syncStatus, 'pending')
  assert.equal(message.queuedAt, 200)
  assert.equal(message.timestamp, 200)
  assert.equal(conv.updatedAt, 200)
})

test('appendUserMessage titles a fresh conversation from the first message', () => {
  const long = 'x'.repeat(80)
  const conv = appendUserMessage(emptyConversation, { id: 'm1', content: long, now: 200 })
  assert.equal(conv.title, 'x'.repeat(50))
  const titled = appendUserMessage(conv, { id: 'm2', content: 'second', now: 300 })
  assert.equal(titled.title, 'x'.repeat(50))
})

test('toApiMessages carries each message exactly once, role/content only', () => {
  const conv = appendUserMessage(emptyConversation, { id: 'm1', content: 'hello', now: 200 })
  const api = toApiMessages(conv.messages)
  assert.deepEqual(api, [{ role: 'user', content: 'hello' }])
  assert.deepEqual(Object.keys(api[0]).sort(), ['content', 'role'])
})

test('pendingUserMessages returns only undelivered user messages, in order', () => {
  let conv = appendUserMessage(emptyConversation, { id: 'm1', content: 'a', now: 200 })
  conv = applyAssistantReply(conv, ['m1'], { id: 'r1', content: 'A', now: 300 })
  conv = appendUserMessage(conv, { id: 'm2', content: 'b', now: 400 })
  assert.deepEqual(
    pendingUserMessages(conv).map((m) => m.id),
    ['m2']
  )
})

test('applyAssistantReply marks exactly the sent messages and appends one reply', () => {
  let conv = appendUserMessage(emptyConversation, { id: 'm1', content: 'a', now: 200 })
  conv = applyAssistantReply(conv, ['m1'], { id: 'r1', content: 'A', now: 300 })
  const [sent, reply] = conv.messages
  assert.equal(sent.syncStatus, 'synced')
  assert.equal(sent.syncedAt, 300)
  assert.equal(reply.role, 'assistant')
  assert.equal(reply.content, 'A')
  assert.equal(reply.syncStatus, undefined)
  assert.equal(conv.isOffline, false)
  assert.equal(conv.updatedAt, 300)
})

test('a message queued while a request is in flight is neither lost nor re-sent', () => {
  // Pass 1 reads the record and sends m1.
  let conv = appendUserMessage(emptyConversation, { id: 'm1', content: 'a', now: 200 })
  const sentIds = pendingUserMessages(conv).map((m) => m.id)

  // While the request is in flight the user queues m2 (fresh read + append).
  conv = appendUserMessage(conv, { id: 'm2', content: 'b', now: 250 })

  // The reply to pass 1 is applied to the fresh record: m1 synced, m2 stays
  // pending, nothing is duplicated or overwritten.
  conv = applyAssistantReply(conv, sentIds, { id: 'r1', content: 'A', now: 300 })
  assert.deepEqual(
    conv.messages.map((m) => [m.id, m.role, m.syncStatus ?? 'synced']),
    [
      ['m1', 'user', 'synced'],
      ['m2', 'user', 'pending'],
      ['r1', 'assistant', 'synced']
    ]
  )

  // Pass 2 sends the full history once and only m2 remains to be marked.
  const api = toApiMessages(conv.messages)
  assert.deepEqual(
    api.map((m) => m.content),
    ['a', 'b', 'A']
  )
  assert.deepEqual(
    pendingUserMessages(conv).map((m) => m.id),
    ['m2']
  )
})
