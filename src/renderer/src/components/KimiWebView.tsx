import { useEffect, useState, useRef, useCallback } from 'react'
import '../assets/KimiWebView.css'

type ConnectionStatus = 'online' | 'offline' | 'checking' | 'error'

export default function KimiWebView(): React.JSX.Element {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    navigator.onLine ? 'online' : 'offline'
  )
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Network status monitoring with retry logic
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

    // IMPORTANT: Delay to ensure webview is fully created
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

  // Handle navigation from main process (deep linking)
  useEffect(() => {
    const handleNavigate = (path: string) => {
      const webview = webviewRef.current
      if (webview) {
        const url = path.startsWith('http') ? path : `https://kimi.com${path}`
        webview.src = url
      }
    }

    if (window.api?.onNavigateTo) {
      window.api.onNavigateTo(handleNavigate)
    }

    return () => {
      window.api?.removeAllListeners('navigate-to')
    }
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

  // Offline UI
  if (connectionStatus === 'offline') {
    return (
      <div className="offline-container">
        <div className="offline-content">
          <div className="offline-icon">📡</div>
          <h2>You're Offline</h2>
          <p>Kimi requires an internet connection to work.</p>
          <p className="offline-subtext">Please check your connection and try again.</p>

          <div className="offline-actions">
            <button className="btn-primary" onClick={handleRetry}>
              Try Again
            </button>
            <button className="btn-secondary" onClick={() => window.api?.restartApp()}>
              Restart App
            </button>
          </div>

          <div className="offline-tips">
            <h4>Troubleshooting Tips:</h4>
            <ul>
              <li>Check your Wi-Fi or Ethernet connection</li>
              <li>Disable VPN or proxy temporarily</li>
              <li>Check if kimi.com is accessible in your browser</li>
            </ul>
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
            <button className="btn-secondary" onClick={() => window.api?.restartApp()}>
              Restart App
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="webview-container">
      {/* Loading overlay */}
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

      {/* 
        CRITICAL FIXES:
        1. partition="persist:kimi" - persistent session for cookies/storage
        2. allowpopups="" - correct syntax (empty string = true)
        3. webpreferences - comma-separated format with yes/no values
        4. Removed sandbox=yes (incompatible with contextIsolation)
      */}
      <webview
        ref={webviewRef}
        src="https://kimi.com"
        className="kimi-webview"
        partition="persist:kimi"
        allowpopups=""
        webpreferences="contextIsolation=yes, nodeIntegration=no, allowRunningInsecureContent=no, javascript=yes, plugins=no, experimentalFeatures=no"
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 KimiDesktop/1.0"
      />
    </div>
  )
}
