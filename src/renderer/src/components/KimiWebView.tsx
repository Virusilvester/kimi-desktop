import { useEffect, useState, useRef, useCallback } from 'react'

export default function KimiWebView(): React.JSX.Element {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [loading, setLoading] = useState(true)
  const webviewRef = useRef<Electron.WebviewTag>(null)

  // Listen for online/offline
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Reset loading when back online
  useEffect(() => {
    if (isOnline) setLoading(true)
  }, [isOnline])

  // Stable callback for load handler
  const handleLoad = useCallback(() => setLoading(false), [])

  // Attach did-finish-load listener properly
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const timer = setTimeout(() => {
      webview.addEventListener('did-finish-load', handleLoad)
    }, 50)

    return () => {
      clearTimeout(timer)
      webview.removeEventListener('did-finish-load', handleLoad)
    }
  }, [handleLoad, isOnline])

  if (!isOnline) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#111',
          color: 'white'
        }}
      >
        <h2>No Internet Connection</h2>
        <p>Kimi requires an internet connection.</p>
        <button
          style={{
            marginTop: 20,
            padding: '8px 16px',
            fontSize: 14,
            cursor: 'pointer',
            borderRadius: 4,
            border: 'none',
            background: '#4caf50',
            color: 'white'
          }}
          onClick={() => window.api?.restartApp()}
        >
          Restart
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Loading overlay */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#111',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
            color: 'white',
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <span className="dot"></span>
            <span className="dot"></span>
            <span className="dot"></span>
          </div>
          <h2>Loading Kimi...</h2>
        </div>
      )}

      {/* WebView */}
      <webview
        ref={webviewRef}
        src="https://kimi.com"
        style={{ flex: 1, width: '100%', height: '100%', border: 'none', margin: 0, padding: 0 }}
        allowpopups="true"
      />

      {/* Animated dots */}
      <style>{`
        .dot {
          width: 12px;
          height: 12px;
          background: #4caf50;
          border-radius: 50%;
          animation: bounce 1.2s infinite ease-in-out;
        }
        .dot:nth-child(1) { animation-delay: 0s; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
