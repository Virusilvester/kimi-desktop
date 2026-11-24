import { useEffect, useState, useRef, useCallback } from 'react'
import { Conversation, offlineManager } from '../utils/offlineManager'
import {
  appendUserMessage,
  applyAssistantReply,
  pendingUserMessages,
  toApiMessages
} from '../utils/chatFlow'
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
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  // The conversation the serial queue is currently working on — the typing
  // indicator and send errors render only when it matches the viewed chat.
  const [queueConvId, setQueueConvId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<{ convId: string | null; message: string } | null>(
    null
  )
  const webviewRef = useRef<WebviewTag | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // The queue reads the stored record on every pass; this mirror only answers
  // "is the queue's conversation still the one on screen".
  const conversationRef = useRef<Conversation | null>(null)
  const processingRef = useRef(false)
  // Flush calls dropped by the processingRef guard, by conversation id: the
  // draining pass hands the queue to the next one recorded here.
  const pendingConvIdsRef = useRef<Set<string>>(new Set())
  // A repeated submit during the append window would queue the same text
  // twice: the input is cleared only after the record write lands.
  const sendingRef = useRef(false)
  // Serializes read-modify-write cycles on the stored record: the send path
  // (append) and the queue (apply reply) both merge onto a fresh read, and
  // this chain keeps the two merges from overwriting each other.
  const recordChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const withRecordLock = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = recordChainRef.current.then(fn)
    recordChainRef.current = run.catch(() => {})
    return run
  }, [])

  // Initialize active conversation from props. The sidebar's "New Chat"
  // sentinel ('new') means "no conversation yet": the first send mints a
  // real id, so fresh chats never share one record.
  useEffect(() => {
    if (currentConversation) {
      setActiveConversation(currentConversation.id === 'new' ? null : currentConversation)
      setSendError(null)
    }
  }, [currentConversation])

  useEffect(() => {
    conversationRef.current = activeConversation
  }, [activeConversation])

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

  // Serial send queue. Each pass reads the stored record fresh, sends the
  // full history (each message exactly once) and, on success, marks exactly
  // the sent messages 'synced' and appends the reply — re-read before
  // writing, so a message queued while the request was in flight is neither
  // lost nor re-sent. Failures leave messages 'pending': the next send or
  // the network coming back retries them.
  const processQueue = useCallback(async (conversationId: string): Promise<void> => {
    if (processingRef.current) {
      pendingConvIdsRef.current.add(conversationId)
      return
    }
    processingRef.current = true
    setIsGenerating(true)
    setQueueConvId(conversationId)
    let failed = false
    try {
      for (;;) {
        const current = await offlineManager.getConversation(conversationId)
        if (!current) break
        const pending = pendingUserMessages(current)
        if (pending.length === 0) break

        const status = await window.api?.oauthStatus?.()
        const model = status?.selectedModel || status?.models?.[0]?.id
        if (!model) {
          setSendError({
            convId: conversationId,
            message: 'No model available. Please log in again.'
          })
          failed = true
          break
        }

        const result = await window.api?.kimiApiRequest?.({
          method: 'POST',
          path: '/chat/completions',
          body: { model, messages: toApiMessages(current.messages) }
        })

        if (!result?.success) {
          setSendError({ convId: conversationId, message: result?.error || 'API request failed' })
          failed = true
          break
        }

        const content = result.data?.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
          setSendError({ convId: conversationId, message: 'Unexpected API response' })
          failed = true
          break
        }

        const sentIds = pending.map((m) => m.id)
        const next = await withRecordLock(async () => {
          const fresh = await offlineManager.getConversation(conversationId)
          if (!fresh) return null
          const updated = applyAssistantReply(fresh, sentIds, {
            id: (Date.now() + 1).toString(),
            content,
            now: Date.now()
          })
          await offlineManager.saveConversation(updated)
          return updated
        })
        if (!next) break
        setSendError((prev) => (prev && prev.convId === conversationId ? null : prev))
        if (conversationRef.current?.id === conversationId) {
          setActiveConversation(next)
        }
      }
    } catch (error) {
      setSendError({ convId: conversationId, message: (error as Error).message })
      failed = true
    } finally {
      processingRef.current = false
      setIsGenerating(false)
      setQueueConvId(null)
      // Flushes dropped by the guard above wait in the set; hand the queue
      // to the next one — its own finally continues the chain. A failed
      // pass deletes only its own id: a persistent failure must not
      // retry-storm, but other conversations' flushes still run.
      if (failed) {
        pendingConvIdsRef.current.delete(conversationId)
      }
      const nextId = pendingConvIdsRef.current.values().next().value
      if (nextId !== undefined) {
        pendingConvIdsRef.current.delete(nextId)
        void processQueue(nextId)
      }
    }
  }, [])

  // Flush queued messages when the network (or the viewed conversation)
  // makes delivery possible again.
  useEffect(() => {
    if (
      connectionStatus === 'online' &&
      activeConversation &&
      pendingUserMessages(activeConversation).length > 0
    ) {
      void processQueue(activeConversation.id)
    }
  }, [connectionStatus, activeConversation, processQueue])

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

  // Auto-grow the multiline input up to a few lines.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [inputValue])

  const handleRetry = useCallback(() => {
    setLoadError(null)
    setIsLoading(true)
    setRetryCount(0)
    const webview = webviewRef.current
    if (webview) {
      webview.reload()
    }
  }, [])

  // Queue the message as 'pending' and let the serial queue deliver it. The
  // input is never blocked: typing and queueing work while a reply is
  // pending.
  const handleSendMessage = async (): Promise<void> => {
    if (sendingRef.current) return
    const text = inputValue.trim()
    if (!text) return

    if (!hasSession) {
      onAuthRequired()
      return
    }

    sendingRef.current = true
    try {
      const now = Date.now()
      const next = await withRecordLock(async () => {
        const stored = activeConversation
          ? await offlineManager.getConversation(activeConversation.id)
          : null
        const base: Conversation = stored ?? {
          id: now.toString(),
          title: '',
          messages: [],
          createdAt: now,
          updatedAt: now,
          isOffline: true
        }
        const updated = appendUserMessage(base, { id: now.toString(), content: text, now })
        await offlineManager.saveConversation(updated)
        return updated
      })

      setActiveConversation(next)
      setInputValue('')
      setSendError(null)
      void processQueue(next.id)
    } catch {
      // The append never landed: keep the typed text and say so.
      setSendError({
        convId: activeConversation?.id ?? null,
        message: 'Could not save the message locally'
      })
    } finally {
      sendingRef.current = false
    }
  }

  // Start new conversation
  const handleNewConversation = (): void => {
    setActiveConversation(null)
    setInputValue('')
    setSendError(null)
  }

  const allMessages = activeConversation?.messages ?? []
  // Queue activity is keyed by conversation: a reply generating for another
  // chat must not show a typing indicator or an error under this one's
  // messages.
  const queueBusyHere =
    isGenerating && queueConvId !== null && queueConvId === activeConversation?.id
  const visibleSendError =
    sendError && (sendError.convId === null || sendError.convId === activeConversation?.id)
      ? sendError
      : null

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
                      {msg.role === 'user' && msg.syncStatus === 'pending' && (
                        <span className="pending"> (queued)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}

            {queueBusyHere && (
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

          {visibleSendError && (
            <div className="send-error">
              <span>
                ⚠️ {visibleSendError.message} Queued messages retry on the next send or reconnect.
              </span>
              <button className="send-error-dismiss" onClick={() => setSendError(null)}>
                ×
              </button>
            </div>
          )}

          <div className="input-area">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSendMessage()
                }
              }}
              placeholder={
                hasSession
                  ? 'Type your message... (Shift+Enter for a new line)'
                  : 'Log in with your Kimi account in settings to chat'
              }
              rows={1}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || !hasSession}
              className="send-btn"
            >
              {queueBusyHere ? '⏳' : '➤'}
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
