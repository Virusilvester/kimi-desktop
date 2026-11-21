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
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [hasSession, setHasSession] = useState(false)

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
    const handleOnline = (): void => setIsOffline(false)
    const handleOffline = (): void => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribeSettings?.()
      unsubscribeNavigate?.()
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
