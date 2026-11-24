import { useEffect, useState, useRef, useCallback } from 'react'
import { Conversation, offlineManager, Message } from '../utils/offlineManager'
import '../assets/KimiWebView.css'

type ConnectionStatus = 'online' | 'offline' | 'checking' | 'error'

type WebviewTag = HTMLElement & {
  src: string
  reload: () => void
  executeJavaScript: (code: string) => Promise<unknown>
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
}

type WebviewDidFailLoadEvent = Event & {
  errorCode: number
  errorDescription: string
}

type WebviewConsoleMessageEvent = Event & {
  level: number
  message: string
}

interface KimiWebViewProps {
  currentConversation: Conversation | null
  isOffline: boolean
  forceOffline: boolean
  hasSession: boolean
  onAuthRequired: () => void
}

export default function KimiWebView({
  currentConversation,
  isOffline,
  forceOffline,
  hasSession,
  onAuthRequired
}: KimiWebViewProps): React.JSX.Element {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    navigator.onLine ? 'online' : 'offline'
  )
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [localMessages, setLocalMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const webviewRef = useRef<WebviewTag | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize active conversation from props
  useEffect(() => {
    if (currentConversation) {
      setActiveConversation(currentConversation)
      setLocalMessages([])
    }
  }, [currentConversation])

  // Reload the webview after an in-app auth popup returns to the app origin,
  // so the logged-in UI replaces the login screen.
  useEffect(() => {
    const unsubscribe = window.api?.onAuthPopupFinished?.(() => {
      webviewRef.current?.reload()
    })
    return () => unsubscribe?.()
  }, [])

  // Network status monitoring
  useEffect(() => {
    const handleOnline = (): void => {
      setConnectionStatus('checking')
      setTimeout(() => {
        setConnectionStatus('online')
        setLoadError(null)
        setRetryCount(0)
      }, 1000)
    }

    const handleOffline = (): void => {
      setConnectionStatus('offline')
      setIsLoading(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const checkInterval = setInterval(() => {
      if (navigator.onLine && connectionStatus === 'offline') {
        handleOnline()
      }
    }, 5000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(checkInterval)
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [connectionStatus])

  // CRITICAL FIX: Auto-save conversations every 10 seconds
  useEffect(() => {
    const saveConversation = async (): Promise<void> => {
      const allMessages = [...(activeConversation?.messages || []), ...localMessages]

      if (allMessages.length === 0) return

      // Create or update conversation
      const conversation: Conversation = {
        id: activeConversation?.id || Date.now().toString(),
        title:
          activeConversation?.title ||
          allMessages[0]?.content.substring(0, 50) ||
          'New Conversation',
        messages: allMessages,
        createdAt: activeConversation?.createdAt || Date.now(),
        updatedAt: Date.now(),
        isOffline: true
      }

      try {
        await offlineManager.saveConversation(conversation)
        console.log('[KimiWebView] Conversation saved:', conversation.id, conversation.title)

        // Update active conversation reference if it's new
        if (!activeConversation) {
          setActiveConversation(conversation)
        }
      } catch (error) {
        console.error('[KimiWebView] Failed to save conversation:', error)
      }
    }

    // Save immediately when messages change
    saveConversation()

    // And periodically
    saveIntervalRef.current = setInterval(saveConversation, 10000)

    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current)
      }
    }
  }, [activeConversation, localMessages])

  // Handle webview load events
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleDidFinishLoad = (): void => {
      setIsLoading(false)
      setLoadError(null)
      setRetryCount(0)
    }

    const handleDidFailLoad = (event: WebviewDidFailLoadEvent): void => {
      if (event.errorCode !== -3) {
        console.error('Webview failed to load:', event.errorDescription)
        setLoadError(event.errorDescription)
        setIsLoading(false)

        if (retryCount < 3 && navigator.onLine) {
          retryTimeoutRef.current = setTimeout(
            () => {
              setRetryCount((prev) => prev + 1)
              setIsLoading(true)
              webview.reload()
            },
            3000 * (retryCount + 1)
          )
        }
      }
    }

    const handleConsoleMessage = (event: WebviewConsoleMessageEvent): void => {
      if (event.level === 3) {
        console.error('Webview console error:', event.message)
      }
    }

    webview.addEventListener('did-finish-load', handleDidFinishLoad)
    webview.addEventListener('did-fail-load', handleDidFailLoad as EventListener)
    webview.addEventListener('console-message', handleConsoleMessage as EventListener)

    return () => {
      webview.removeEventListener('did-finish-load', handleDidFinishLoad)
      webview.removeEventListener('did-fail-load', handleDidFailLoad as EventListener)
      webview.removeEventListener('console-message', handleConsoleMessage as EventListener)
    }
  }, [retryCount])

  // Handle navigation from main process
  useEffect(() => {
    const handleNavigate = (path: string): void => {
      const webview = webviewRef.current
      if (webview && path !== 'settings') {
        const url = path.startsWith('http') ? path : `https://kimi.ai${path}`
        webview.src = url
      }
    }

    const unsubscribe = window.api?.onNavigateTo?.(handleNavigate)
    return () => unsubscribe?.()
  }, [])

  const handleRetry = useCallback(() => {
    setLoadError(null)
    setIsLoading(true)
    setRetryCount(0)
    const webview = webviewRef.current
    if (webview) {
      webview.reload()
    }
  }, [])

  // CRITICAL FIX: Use API proxy (Kimi Code OAuth session) to bypass CSP restrictions
  const handleSendMessage = async (): Promise<void> => {
    if (!inputValue.trim()) return

    if (!hasSession) {
      onAuthRequired()
      return
    }

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: Date.now()
    }

    setLocalMessages((prev) => [...prev, newMessage])
    setInputValue('')
    setIsGenerating(true)

    try {
      // Resolve the selected model from the OAuth session
      const status = await window.api?.oauthStatus?.()
      const model = status?.selectedModel || status?.models?.[0]?.id
      if (!model) {
        throw new Error('No model available. Please log in again.')
      }

      // CRITICAL: Use main process proxy to bypass CSP
      const result = await window.api?.kimiApiRequest?.({
        method: 'POST',
        path: '/chat/completions',
        body: {
          model,
          messages: [...(activeConversation?.messages || []), ...localMessages, newMessage].map(
            (m) => ({ role: m.role, content: m.content })
          )
        }
      })

      if (result?.success) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.data.choices[0].message.content,
          timestamp: Date.now()
        }
        setLocalMessages((prev) => [...prev, assistantMessage])

        // Save conversation immediately after receiving response
        const allMessages = [
          ...(activeConversation?.messages || []),
          ...localMessages,
          newMessage,
          assistantMessage
        ]

        const conversation: Conversation = {
          id: activeConversation?.id || Date.now().toString(),
          title:
            activeConversation?.title ||
            allMessages[0]?.content.substring(0, 50) ||
            'New Conversation',
          messages: allMessages,
          createdAt: activeConversation?.createdAt || Date.now(),
          updatedAt: Date.now(),
          isOffline: false // Mark as online since we got a response
        }

        await offlineManager.saveConversation(conversation)
        setActiveConversation(conversation)
      } else {
        throw new Error(result?.error || 'API request failed')
      }
    } catch (error) {
      console.error('API call failed:', error)
      // Add error message
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I cannot connect to the server: ${(error as Error).message}. Your message has been saved locally.`,
        timestamp: Date.now()
      }
      setLocalMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsGenerating(false)
    }
  }

  // CRITICAL FIX: Start new conversation
  const handleNewConversation = (): void => {
    setActiveConversation(null)
    setLocalMessages([])
    setInputValue('')
  }

  // Combine all messages for display
  const allMessages = [...(activeConversation?.messages || []), ...localMessages]

  // Offline view
  if (isOffline || connectionStatus === 'offline') {
    return (
      <div className="webview-container">
        <div className="offline-chat-view">
          <div className="offline-header">
            <div className="header-left">
              <h2>{activeConversation?.title || 'New Conversation'}</h2>
              {allMessages.length > 0 && (
                <span className="message-count">{allMessages.length} messages</span>
              )}
            </div>
            <div className="offline-badges">
              <span className="offline-badge">Offline Mode</span>
              {hasSession && <span className="api-ready">Kimi Code Ready</span>}
            </div>
          </div>

          <div className="messages-container">
            {allMessages.length === 0 ? (
              <div className="empty-chat">
                <div className="empty-icon">💬</div>
                <p>No messages yet</p>
                <p className="empty-subtitle">Type a message to start a conversation</p>
              </div>
            ) : (
              allMessages.map((msg) => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className="message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
                  <div className="message-content">
                    <div className="message-text">{msg.content}</div>
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                      {msg.role === 'user' && isOffline && (
                        <span className="pending"> (saved locally)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}

            {isGenerating && (
              <div className="message assistant">
                <div className="message-avatar">🤖</div>
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="input-area">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={
                hasSession
                  ? 'Type your message...'
                  : 'Log in with your Kimi account in settings to chat'
              }
              disabled={isGenerating}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isGenerating || !hasSession}
              className="send-btn"
            >
              {isGenerating ? '⏳' : '➤'}
            </button>
          </div>

          <div className="offline-notice">
            <p>
              {forceOffline
                ? 'Offline mode is forced — flip the title bar toggle (or Settings → Advanced) to return to the webview. Messages are still saved locally.'
                : hasSession
                  ? "You're in offline mode. Messages are saved locally and will persist."
                  : 'Log in with your Kimi account (Settings → Kimi Account) to enable chat functionality.'}
            </p>
            <div className="notice-actions">
              <button className="btn-secondary" onClick={handleNewConversation}>
                📝 New Chat
              </button>
              {!forceOffline && (
                <button className="btn-primary" onClick={handleRetry}>
                  🔄 Try Reconnecting
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error UI
  if (loadError && !isLoading) {
    return (
      <div className="error-container">
        <div className="error-content">
          <div className="error-icon">⚠️</div>
          <h2>Failed to Load</h2>
          <p className="error-message">{loadError}</p>
          {retryCount > 0 && <p className="retry-count">Retry attempt {retryCount}/3</p>}

          <div className="error-actions">
            <button className="btn-primary" onClick={handleRetry}>
              Reload Page
            </button>
            <button className="btn-secondary" onClick={() => window.api?.restartApp?.()}>
              Restart App
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="webview-container">
      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner">
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
          </div>
          <p className="loading-text">
            {connectionStatus === 'checking' ? 'Reconnecting...' : 'Loading Kimi...'}
          </p>
          {retryCount > 0 && <p className="loading-retry">Attempt {retryCount + 1}</p>}
        </div>
      )}

      {/* eslint-disable react/no-unknown-property */}
      <webview
        ref={webviewRef}
        src="https://kimi.ai"
        // allowpopups must be present at guest-attach time: a webview that
        // gains the attribute later still drops every window.open from the
        // guest (observed Electron 39) — the login popup never surfaces.
        // Runtime wants a string (React drops boolean true for non-boolean
        // attributes); @types/react declares boolean — cast to satisfy TS.
        allowpopups={'true' as unknown as boolean}
        className="kimi-webview"
        partition="persist:kimi"
        webpreferences="contextIsolation=yes, nodeIntegration=no, allowRunningInsecureContent=no, javascript=yes, plugins=no, experimentalFeatures=no"
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 KimiDesktop/1.0"
      />
      {/* eslint-enable react/no-unknown-property */}
    </div>
  )
}
