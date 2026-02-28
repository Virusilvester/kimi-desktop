import { useEffect, useState, useCallback } from 'react'

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  isOffline: boolean
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
const DB_VERSION = 1
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

  async saveConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      const data = {
        ...conversation,
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

      request.onsuccess = () => resolve(request.result || null)
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
          conversations.push(cursor.value)
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
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('isOffline')
      const request = index.openCursor(IDBKeyRange.only(true))

      const conversations: Conversation[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          conversations.push(cursor.value)
          cursor.continue()
        } else {
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
