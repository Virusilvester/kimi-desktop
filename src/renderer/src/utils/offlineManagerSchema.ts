// Conversation record schema and its pure transformations: stored form
// (what IndexedDB holds), surfaced form (what the UI sees) and the legacy
// migration. No React, no IndexedDB — unit tests compile this module with
// the project's tsc and run it under node:test (see npm run test:unit).

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export interface Attachment {
  name: string
  type: string
  size: number
  data?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number // Creation time, immutable
  attachments?: Attachment[]
  seq?: number // Monotonic within the conversation; ms timestamps may collide, seq must not
  syncStatus?: SyncStatus // Legacy messages without the field count as 'synced'
  queuedAt?: number
  syncedAt?: number
  editedAt?: number // Set on content edits only
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  isOffline: boolean | number // Stored as 1/0, surfaced as boolean
  hasPending?: boolean | number // Stored derivative (1/0), surfaced as boolean
  lastSeq?: number // Per-conversation seq counter, issued by the store
}

// Single definition of "not durably delivered": the hasPending derivative
// counts every conversation holding such a message. A missing status means
// a legacy message, i.e. 'synced'.
export function isUndelivered(status: SyncStatus | undefined): boolean {
  return status === 'pending' || status === 'syncing' || status === 'failed'
}

export function normalizeMessage(message: Message): Message {
  return { ...message, syncStatus: message.syncStatus ?? 'synced' }
}

// Record stored as-is: isOffline/hasPending as 1/0, seq stamped for messages
// without one, lastSeq advanced past every assigned seq, hasPending derived
// from the messages. updatedAt/createdAt/timestamps pass through untouched.
export function toRecord(conversation: Conversation): Record<string, unknown> {
  let lastSeq = conversation.lastSeq ?? 0
  const messages = conversation.messages.map((message) => {
    const normalized = normalizeMessage(message)
    if (normalized.seq === undefined) {
      lastSeq += 1
      return { ...normalized, seq: lastSeq }
    }
    if (normalized.seq > lastSeq) lastSeq = normalized.seq
    return normalized
  })
  const hasPending = messages.some((m) => isUndelivered(m.syncStatus)) ? 1 : 0
  return {
    ...conversation,
    messages,
    isOffline: conversation.isOffline ? 1 : 0,
    hasPending,
    lastSeq
  }
}

export function fromRecord(record: Conversation): Conversation {
  return {
    ...record,
    isOffline: !!record.isOffline,
    hasPending: !!record.hasPending,
    lastSeq: record.lastSeq ?? 0,
    messages: record.messages.map(normalizeMessage)
  }
}

// v1/v2 records predate seq/syncStatus/hasPending/lastSeq and may store
// isOffline as a boolean. Backfill runs inside the upgrade transaction, so it
// is atomic with the version bump and complete before init() resolves. Legacy
// messages count as 'synced', so hasPending is 0 for them.
export function migrateLegacyRecord(record: Conversation): Conversation {
  const messages = record.messages.map((message, index) => ({
    ...message,
    seq: message.seq ?? index,
    syncStatus: message.syncStatus ?? 'synced'
  }))
  return {
    ...record,
    messages,
    isOffline: record.isOffline ? 1 : 0,
    lastSeq: record.lastSeq ?? messages.length,
    hasPending: messages.some((m) => isUndelivered(m.syncStatus)) ? 1 : 0
  }
}
