/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { useEffect, useState, useRef, useCallback } from 'react'
import { Conversation, offlineManager, Message } from '../utils/offlineManager'
import '../assets/KimiWebView.css'

type ConnectionStatus = 'online' | 'offline' | 'checking' | 'error'

interface KimiWebViewProps {
  currentConversation: Conversation | null
  isOffline: boolean
  hasApiKey: boolean
  onApiKeyRequired: () => void
}

export default function KimiWebView({
  currentConversation,
  isOffline,
  hasApiKey,
  onApiKeyRequired
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
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus('checking')
      setTimeout(() => {
        setConnectionStatus('online')
        setLoadError(null)
        setRetryCount(0)
      }, 1000)
    }

    const handleOffline = () => {
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

  // Auto-save conversations periodically
  useEffect(() => {
    if (!currentConversation) return

    saveIntervalRef.current = setInterval(async () => {
      if (
        currentConversation &&
        (currentConversation.messages.length > 0 || localMessages.length > 0)
      ) {
        await offlineManager.saveConversation({
          ...currentConversation,
          messages: [...currentConversation.messages, ...localMessages],
          isOffline: true,
          updatedAt: Date.now()
        })
      }
    }, 30000)

    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current)
      }
    }
  }, [currentConversation, localMessages])

  // Handle webview load events
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleDidFinishLoad = () => {
      setIsLoading(false)
      setLoadError(null)
      setRetryCount(0)
    }

    const handleDidFailLoad = (event: Electron.DidFailLoadEvent) => {
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

    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
      if (event.level === 3) {
        console.error('Webview console error:', event.message)
      }
    }

    const timer = setTimeout(() => {
      webview.addEventListener('did-finish-load', handleDidFinishLoad)
      webview.addEventListener('did-fail-load', handleDidFailLoad as EventListener)
      webview.addEventListener('console-message', handleConsoleMessage as EventListener)
    }, 100)

    return () => {
      clearTimeout(timer)
      webview.removeEventListener('did-finish-load', handleDidFinishLoad)
      webview.removeEventListener('did-fail-load', handleDidFailLoad as EventListener)
      webview.removeEventListener('console-message', handleConsoleMessage as EventListener)
    }
  }, [retryCount])

  // Handle navigation from main process
  useEffect(() => {
    const handleNavigate = (path: string) => {
      const webview = webviewRef.current
      if (webview && path !== 'settings') {
        const url = path.startsWith('http') ? path : `https://kimi.com${path}`
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

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return

    if (!hasApiKey) {
      onApiKeyRequired()
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
      // Try to use API if online
      if (!isOffline && hasApiKey) {
        const apiData = await window.api?.getApiKey?.()
        if (apiData?.apiKey) {
          const response = await fetch(`${apiData.endpoint}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiData.apiKey}`
            },
            body: JSON.stringify({
              model: 'moonshot-v1-8k',
              messages: [
                ...(currentConversation?.messages || []),
                ...localMessages,
                newMessage
              ].map((m) => ({ role: m.role, content: m.content }))
            })
          })

          if (response.ok) {
            const data = await response.json()
            const assistantMessage: Message = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: data.choices[0].message.content,
              timestamp: Date.now()
            }
            setLocalMessages((prev) => [...prev, assistantMessage])

            // Save to offline storage
            if (currentConversation) {
              await offlineManager.saveConversation({
                ...currentConversation,
                messages: [
                  ...currentConversation.messages,
                  ...localMessages,
                  newMessage,
                  assistantMessage
                ],
                updatedAt: Date.now()
              })
            }
          }
        }
      }
    } catch (error) {
      console.error('API call failed:', error)
      // Add error message
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          "Sorry, I cannot connect to the server. Your message has been saved and will be sent when you're back online.",
        timestamp: Date.now()
      }
      setLocalMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsGenerating(false)
    }
  }

  // Offline view with conversation
  if (isOffline || connectionStatus === 'offline') {
    return (
      <div className="webview-container">
        {currentConversation || localMessages.length > 0 ? (
          <div className="offline-chat-view">
            <div className="offline-header">
              <h2>{currentConversation?.title || 'Offline Chat'}</h2>
              <div className="offline-badges">
                <span className="offline-badge">Offline Mode</span>
                {hasApiKey && <span className="api-ready">API Ready</span>}
              </div>
            </div>

            <div className="messages-container">
              {(currentConversation?.messages || []).map((msg) => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className="message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
                  <div className="message-content">
                    <div className="message-text">{msg.content}</div>
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}

              {localMessages.map((msg) => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className="message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
                  <div className="message-content">
                    <div className="message-text">{msg.content}</div>
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                      {msg.role === 'user' && isOffline && (
                        <span className="pending"> (pending)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

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
                  hasApiKey ? 'Type your message...' : 'Add API key in settings to chat offline'
                }
                disabled={isGenerating}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isGenerating || !hasApiKey}
                className="send-btn"
              >
                {isGenerating ? '⏳' : '➤'}
              </button>
            </div>

            <div className="offline-notice">
              <p>
                {hasApiKey
                  ? "You're in offline mode. Messages will be queued and sent when you're back online."
                  : 'Add your Kimi API key in settings to enable offline chat functionality.'}
              </p>
              <button className="btn-primary" onClick={handleRetry}>
                🔄 Try Reconnecting
              </button>
            </div>
          </div>
        ) : (
          <div className="offline-container">
            <div className="offline-content">
              <div className="offline-icon">📡</div>
              <h2>You're Offline</h2>
              <p>Kimi requires an internet connection for new conversations.</p>
              <p className="offline-subtext">
                {hasApiKey
                  ? 'You can still view saved conversations or add a new message that will be sent later.'
                  : 'Add your API key in settings to enable offline chat functionality.'}
              </p>

              <div className="offline-actions">
                <button className="btn-primary" onClick={handleRetry}>
                  Try Again
                </button>
                <button className="btn-secondary" onClick={() => window.api?.restartApp?.()}>
                  Restart App
                </button>
              </div>

              <div className="offline-tips">
                <h4>Troubleshooting Tips:</h4>
                <ul>
                  <li>Check your Wi-Fi or Ethernet connection</li>
                  <li>Disable VPN or proxy temporarily</li>
                  <li>Check if kimi.com is accessible in your browser</li>
                  {hasApiKey && <li>Your API key is saved and ready for when you reconnect</li>}
                </ul>
              </div>
            </div>
          </div>
        )}
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

      <webview
        ref={webviewRef}
        src="https://kimi.com"
        className="kimi-webview"
        partition="persist:kimi"
        allowpopups
        webpreferences="contextIsolation=yes, nodeIntegration=no, allowRunningInsecureContent=no, javascript=yes, plugins=no, experimentalFeatures=no"
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 KimiDesktop/1.0"
      />
    </div>
  )
}
