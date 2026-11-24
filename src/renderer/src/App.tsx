import { Component, ReactNode, useState, useEffect, useCallback } from 'react'
import KimiWebView from './components/KimiWebView'
import TitleBar from './components/TitleBar'
import Settings from './components/Settings'
import ConversationSidebar from './components/ConversationSidebar'
import { Conversation, offlineManager } from './utils/offlineManager'

// Error Boundary for catching React errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('App Error:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#111',
            color: 'white',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: 40,
            textAlign: 'center'
          }}
        >
          <h1 style={{ color: '#ff6b6b', marginBottom: 16 }}>Something went wrong</h1>
          <p style={{ color: '#888', marginBottom: 24 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => window.api?.restartApp()}
            style={{
              padding: '12px 24px',
              background: '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Restart Application
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

function App(): React.JSX.Element {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [isNetworkOffline, setIsNetworkOffline] = useState(!navigator.onLine)
  const [forceOffline, setForceOffline] = useState(false)
  const [hasSession, setHasSession] = useState(false)

  // Effective offline: network down, or the user forced offline mode
  // (title bar toggle / Settings → Advanced) — e.g. for debugging.
  const isOffline = isNetworkOffline || forceOffline

  const checkSession = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api?.oauthStatus?.()
      setHasSession(!!status?.loggedIn)
    } catch (error) {
      console.error('Failed to check OAuth session:', error)
    }
  }, [])

  useEffect(() => {
    // Initialize offline manager
    offlineManager.init().catch(console.error)

    // Check for Kimi Code OAuth session
    void checkSession()

    // Listen for settings shortcut from main process
    const unsubscribeSettings = window.api?.onOpenSettings?.(() => {
      setIsSettingsOpen(true)
    })

    const unsubscribeNavigate = window.api?.onNavigateTo?.((path) => {
      if (path === 'settings') setIsSettingsOpen(true)
    })

    // Network status
    const handleOnline = (): void => setIsNetworkOffline(false)
    const handleOffline = (): void => setIsNetworkOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Force-offline flag (settings.json): initial load + live updates from
    // any settings save (Settings modal, title bar toggle)
    window.api
      ?.getSettings?.()
      .then((settings) => setForceOffline(!!settings?.forceOfflineMode))
      .catch(console.error)
    const unsubscribeSettingsChanged = window.api?.onSettingsChanged?.((settings) => {
      setForceOffline(!!settings?.forceOfflineMode)
    })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribeSettings?.()
      unsubscribeNavigate?.()
      unsubscribeSettingsChanged?.()
    }
  }, [checkSession])

  const handleSelectConversation = useCallback((conversation: Conversation) => {
    setCurrentConversation(conversation)
  }, [])

  return (
    <ErrorBoundary>
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#111'
        }}
      >
        <TitleBar
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          isOffline={isOffline}
          forceOffline={forceOffline}
        />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
          <ConversationSidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            onSelectConversation={handleSelectConversation}
            currentConversationId={currentConversation?.id}
          />

          <div style={{ flex: 1, position: 'relative' }}>
            <KimiWebView
              currentConversation={currentConversation}
              isOffline={isOffline}
              forceOffline={forceOffline}
              hasSession={hasSession}
              onAuthRequired={() => setIsSettingsOpen(true)}
            />
          </div>
        </div>

        <Settings
          isOpen={isSettingsOpen}
          onClose={() => {
            setIsSettingsOpen(false)
            checkSession() // Refresh OAuth session status
          }}
        />
      </div>
    </ErrorBoundary>
  )
}

export default App
