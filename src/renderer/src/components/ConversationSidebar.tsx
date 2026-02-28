import { useState, useEffect } from 'react'
import { Conversation, offlineManager } from '../utils/offlineManager'
import '../assets/ConversationSidebar.css'

interface ConversationSidebarProps {
  isOpen: boolean
  onClose: () => void
  onSelectConversation: (conversation: Conversation) => void
  currentConversationId?: string
}

export default function ConversationSidebar({
  isOpen,
  onClose,
  onSelectConversation,
  currentConversationId
}: ConversationSidebarProps): React.JSX.Element | null {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'all' | 'offline'>('all')

  useEffect(() => {
    if (isOpen) {
      loadConversations()
    }
  }, [isOpen, viewMode])

  const loadConversations = async () => {
    setIsLoading(true)
    try {
      const data =
        viewMode === 'offline'
          ? await offlineManager.getOfflineConversations()
          : await offlineManager.getAllConversations()
      setConversations(data)
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (confirm('Delete this conversation?')) {
      await offlineManager.deleteConversation(id)
      loadConversations()
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

  const filteredConversations = conversations.filter(
    (conv) =>
      conv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.messages.some((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const groupedConversations = filteredConversations.reduce(
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

  const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older']

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
            All
          </button>
          <button
            className={viewMode === 'offline' ? 'active' : ''}
            onClick={() => setViewMode('offline')}
          >
            Offline Available
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
          ) : filteredConversations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <p>No conversations found</p>
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="clear-search">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            groupOrder.map((group) => {
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
                          {conv.isOffline && <span className="offline-badge">Offline</span>}
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
            {conversations.length} conversation{conversations.length !== 1 ? 's' : ''} saved
          </p>
          <button onClick={loadConversations} className="refresh-btn" title="Refresh">
            🔄
          </button>
        </div>
      </div>
    </div>
  )
}
