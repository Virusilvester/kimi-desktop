import { useDeferredValue, useMemo, useState } from 'react'
import { Conversation, useOfflineConversations } from '../utils/offlineManager'
import '../assets/ConversationSidebar.css'

interface ConversationSidebarProps {
  isOpen: boolean
  onClose: () => void
  onSelectConversation: (conversation: Conversation) => void
  currentConversationId?: string
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'] as const

function isOfflineConversation(conversation: Conversation): boolean {
  return conversation.isOffline === true || conversation.isOffline === 1
}

export default function ConversationSidebar({
  isOpen,
  onClose,
  onSelectConversation,
  currentConversationId
}: ConversationSidebarProps): React.JSX.Element | null {
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'all' | 'offline'>('all')
  const deferredQuery = useDeferredValue(searchQuery.trim().toLowerCase())

  const {
    conversations: allConversations,
    isLoading,
    refresh,
    deleteConversation
  } = useOfflineConversations({ enabled: isOpen })

  const visibleConversations = useMemo((): Conversation[] => {
    let result = allConversations

    if (viewMode === 'offline') {
      result = result.filter(isOfflineConversation)
    }

    if (deferredQuery) {
      result = result.filter((conv) => {
        if (conv.title.toLowerCase().includes(deferredQuery)) return true
        return conv.messages.some((m) => m.content.toLowerCase().includes(deferredQuery))
      })
    }

    return result
  }, [allConversations, deferredQuery, viewMode])

  const offlineCount = useMemo((): number => {
    return allConversations.reduce(
      (count, conv) => count + (isOfflineConversation(conv) ? 1 : 0),
      0
    )
  }, [allConversations])

  const handleDelete = async (id: string, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (confirm('Delete this conversation?')) {
      try {
        await deleteConversation(id)
      } catch (error) {
        console.error('[Sidebar] Failed to delete conversation:', error)
      }
    }
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString([], { weekday: 'short' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  const groupedConversations = useMemo((): Record<string, Conversation[]> => {
    return visibleConversations.reduce(
      (groups, conv) => {
        const date = new Date(conv.updatedAt)
        const now = new Date()
        const diff = now.getTime() - date.getTime()

        let group = 'Older'
        if (diff < 24 * 60 * 60 * 1000) group = 'Today'
        else if (diff < 2 * 24 * 60 * 60 * 1000) group = 'Yesterday'
        else if (diff < 7 * 24 * 60 * 60 * 1000) group = 'This Week'
        else if (diff < 30 * 24 * 60 * 60 * 1000) group = 'This Month'

        if (!groups[group]) groups[group] = []
        groups[group].push(conv)
        return groups
      },
      {} as Record<string, Conversation[]>
    )
  }, [visibleConversations])

  if (!isOpen) return null

  return (
    <div className="sidebar-overlay" onClick={onClose}>
      <div className="conversation-sidebar" onClick={(e) => e.stopPropagation()}>
        <div className="sidebar-header">
          <h3>Conversations</h3>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sidebar-search">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="sidebar-filters">
          <button className={viewMode === 'all' ? 'active' : ''} onClick={() => setViewMode('all')}>
            All ({allConversations.length})
          </button>
          <button
            className={viewMode === 'offline' ? 'active' : ''}
            onClick={() => setViewMode('offline')}
          >
            Offline ({offlineCount})
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            className="new-chat-btn"
            onClick={() => {
              onSelectConversation({
                id: 'new',
                title: 'New Conversation',
                messages: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isOffline: false
              })
              onClose()
            }}
          >
            <span>+</span> New Chat
          </button>
        </div>

        <div className="conversations-list">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading conversations...</p>
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <p>{searchQuery ? 'No matches found' : 'No conversations found'}</p>
              {viewMode === 'offline' && (
                <p className="empty-subtitle">No offline conversations saved yet</p>
              )}
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="clear-search">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const groupConvs = groupedConversations[group]
              if (!groupConvs || groupConvs.length === 0) return null

              return (
                <div key={group} className="conversation-group">
                  <h4>{group}</h4>
                  {groupConvs.map((conv) => (
                    <div
                      key={conv.id}
                      className={`conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
                      onClick={() => {
                        onSelectConversation(conv)
                        onClose()
                      }}
                    >
                      <div className="conversation-info">
                        <div className="conversation-title">
                          {conv.title || 'Untitled Conversation'}
                          {(conv.isOffline === true || conv.isOffline === 1) && (
                            <span className="offline-badge">Offline</span>
                          )}
                        </div>
                        <div className="conversation-preview">
                          {conv.messages[conv.messages.length - 1]?.content.substring(0, 50) ||
                            'No messages'}
                          ...
                        </div>
                        <div className="conversation-meta">
                          <span>{conv.messages.length} messages</span>
                          <span>{formatDate(conv.updatedAt)}</span>
                        </div>
                      </div>
                      <button
                        className="delete-btn"
                        onClick={(e) => handleDelete(conv.id, e)}
                        title="Delete conversation"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>

        <div className="sidebar-footer">
          <p>
            {visibleConversations.length} shown • {allConversations.length} saved
          </p>
          <button onClick={refresh} className="refresh-btn" title="Refresh">
            🔄
          </button>
        </div>
      </div>
    </div>
  )
}
