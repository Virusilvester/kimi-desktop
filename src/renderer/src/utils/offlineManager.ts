import { useEffect, useState, useCallback } from 'react'
import {
  fromRecord,
  migrateLegacyRecord,
  toRecord,
  type Conversation
} from './offlineManagerSchema'

export type { Attachment, Conversation, Message, SyncStatus } from './offlineManagerSchema'

const DB_NAME = 'KimiOfflineDB'
const DB_VERSION = 3
const STORE_NAME = 'conversations'

class OfflineManager {
  private db: IDBDatabase | null = null
  private listeners: Set<() => void> = new Set()

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt', { unique: false })
          store.createIndex('isOffline', 'isOffline', { unique: false })
          store.createIndex('hasPending', 'hasPending', { unique: false })
          return
        }

        const store = request.transaction!.objectStore(STORE_NAME)
        if (!store.indexNames.contains('hasPending')) {
          store.createIndex('hasPending', 'hasPending', { unique: false })
        }

        if (event.oldVersion < 3) {
          const cursorRequest = store.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            cursor.update(migrateLegacyRecord(cursor.value as Conversation))
            cursor.continue()
          }
        }
      }
    })
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb())
  }

  private async putRecord(data: Record<string, unknown>): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite')
      const request = tx.objectStore(STORE_NAME).put(data)
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => {
        this.notify()
        resolve()
      }
    })
  }

  // Writes the conversation as given: updatedAt means "last user-visible
  // activity" and is the caller's responsibility — operational writes must
  // not bump it.
  async saveConversation(conversation: Conversation): Promise<void> {
    await this.putRecord(toRecord(conversation))
  }

  async getConversation(id: string): Promise<Conversation | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly')
      const request = tx.objectStore(STORE_NAME).get(id)

      request.onsuccess = () => {
        const result = request.result as Conversation | undefined
        resolve(result ? fromRecord(result) : null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getAllConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly')
      const index = tx.objectStore(STORE_NAME).index('updatedAt')
      const request = index.openCursor(null, 'prev')

      const conversations: Conversation[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          conversations.push(fromRecord(cursor.value as Conversation))
          cursor.continue()
        } else {
          resolve(conversations)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getOfflineConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly')
      const index = tx.objectStore(STORE_NAME).index('isOffline')

      // Use 1 instead of true for IndexedDB compatibility
      const request = index.openCursor(IDBKeyRange.only(1))

      const conversations: Conversation[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          conversations.push(fromRecord(cursor.value as Conversation))
          cursor.continue()
        } else {
          // Sort by updatedAt descending
          conversations.sort((a, b) => b.updatedAt - a.updatedAt)
          resolve(conversations)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite')
      const request = tx.objectStore(STORE_NAME).delete(id)
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => {
        this.notify()
        resolve()
      }
    })
  }

  async clearOldConversations(maxAgeDays: number): Promise<void> {
    if (!this.db) await this.init()

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const conversations = await this.getAllConversations()

    const toDelete = conversations.filter((c) => c.updatedAt < cutoff)

    for (const conv of toDelete) {
      await this.deleteConversation(conv.id)
    }
  }

  async exportAll(): Promise<Conversation[]> {
    return this.getAllConversations()
  }

  async importAll(conversations: Conversation[]): Promise<void> {
    for (const conv of conversations) {
      await this.saveConversation(conv)
    }
  }

  async clearAll(): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite')
      const request = tx.objectStore(STORE_NAME).clear()
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => {
        this.notify()
        resolve()
      }
    })
  }

  async getStorageSize(): Promise<number> {
    const conversations = await this.getAllConversations()
    const json = JSON.stringify(conversations)
    return new Blob([json]).size
  }
}

export const offlineManager = new OfflineManager()

// React Hook for using offline manager
export function useOfflineConversations(options?: { enabled?: boolean }): {
  conversations: Conversation[]
  isLoading: boolean
  refresh: () => Promise<void>
  saveConversation: (conversation: Conversation) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
} {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const enabled = options?.enabled ?? true

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await offlineManager.getAllConversations()
      setConversations(data)
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    setIsLoading(true)
    refresh()
    const unsubscribe = offlineManager.subscribe(refresh)
    return unsubscribe
  }, [enabled, refresh])

  const saveConversation = useCallback(async (conversation: Conversation): Promise<void> => {
    await offlineManager.saveConversation(conversation)
  }, [])

  const deleteConversation = useCallback(async (id: string): Promise<void> => {
    await offlineManager.deleteConversation(id)
  }, [])

  return {
    conversations,
    isLoading,
    refresh,
    saveConversation,
    deleteConversation
  }
}

export default offlineManager
