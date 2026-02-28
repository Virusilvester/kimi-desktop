import { useEffect, useState, useCallback } from 'react'

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  isOffline: boolean | number // Changed to support both boolean and number (1/0)
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachments?: Attachment[]
}

export interface Attachment {
  name: string
  type: string
  size: number
  data?: string
}

const DB_NAME = 'KimiOfflineDB'
const DB_VERSION = 2 // Incremented to trigger schema update
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

        // Delete old store if exists to recreate with proper schema
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME)
        }

        // Create new store with proper indexes
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })

        // Index for updatedAt (number)
        store.createIndex('updatedAt', 'updatedAt', { unique: false })

        // Index for isOffline - use number (1/0) instead of boolean
        store.createIndex('isOffline', 'isOffline', { unique: false })
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

  async saveConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      // Convert boolean to number for IndexedDB compatibility
      const data = {
        ...conversation,
        isOffline: conversation.isOffline ? 1 : 0,
        updatedAt: Date.now()
      }

      const request = store.put(data)
      request.onsuccess = () => {
        this.notify()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getConversation(id: string): Promise<Conversation | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => {
        const result = request.result
        if (result) {
          // Convert number back to boolean
          result.isOffline = !!result.isOffline
        }
        resolve(result || null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getAllConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('updatedAt')
      const request = index.openCursor(null, 'prev')

      const conversations: Conversation[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const data = cursor.value
          // Convert number back to boolean
          data.isOffline = !!data.isOffline
          conversations.push(data)
          cursor.continue()
        } else {
          resolve(conversations)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  // CRITICAL FIX: Use number (1) instead of boolean (true) for IndexedDB query
  async getOfflineConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('isOffline')

      // Use 1 instead of true for IndexedDB compatibility
      const request = index.openCursor(IDBKeyRange.only(1))

      const conversations: Conversation[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const data = cursor.value
          // Convert number back to boolean
          data.isOffline = !!data.isOffline
          conversations.push(data)
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
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => {
        this.notify()
        resolve()
      }
      request.onerror = () => reject(request.error)
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
      const store = tx.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => {
        this.notify()
        resolve()
      }
      request.onerror = () => reject(request.error)
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
export function useOfflineConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
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
    refresh()
    const unsubscribe = offlineManager.subscribe(refresh)
    return unsubscribe
  }, [refresh])

  const saveConversation = useCallback(async (conversation: Conversation) => {
    await offlineManager.saveConversation(conversation)
  }, [])

  const deleteConversation = useCallback(async (id: string) => {
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
