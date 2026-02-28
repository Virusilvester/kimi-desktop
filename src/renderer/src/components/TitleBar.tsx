import { useEffect, useState, useCallback } from 'react'
import '../assets/TitleBar.css'

interface TitleBarProps {
  onOpenSettings: () => void
  onOpenSidebar: () => void
  isOffline: boolean
  hasApiKey?: boolean
}

export default function TitleBar({
  onOpenSettings,
  onOpenSidebar,
  isOffline,
  hasApiKey
}: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    // Listen for maximize state changes
    const unsubscribe = window.api?.onMaximizeChange?.((value) => setIsMaximized(value))

    // Get app version
    window.api?.getAppVersion?.().then((version) => {
      setAppVersion(version)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ctrl/Cmd + ,: Open settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        onOpenSettings()
      }

      // Ctrl/Cmd + Shift + S: Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        onOpenSidebar()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenSettings, onOpenSidebar])

  const handleMinimize = useCallback(() => {
    console.log('Minimize clicked')
    window.api?.minimize?.()
  }, [])

  const handleMaximize = useCallback(() => {
    console.log('Maximize clicked')
    window.api?.maximize?.()
  }, [])

  const handleClose = useCallback(() => {
    console.log('Close clicked')
    window.api?.close?.()
  }, [])

  const handleDoubleClick = useCallback((): void => {
    window.api?.maximize?.()
  }, [])

  return (
    <div className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="titlebar-drag-region">
        <div className="app-menu">
          <button className="menu-btn" onClick={onOpenSidebar} title="Conversations (Ctrl+Shift+S)">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          <div className="app-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="10" fill="#4caf50" />
              <path
                d="M8 12L11 15L16 9"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="title">
            Kimi Desktop {appVersion && <span className="version">v{appVersion}</span>}
            {isOffline && <span className="offline-indicator">Offline</span>}
            {hasApiKey && <span className="api-badge">API</span>}
          </div>
        </div>
      </div>

      <div className="window-controls">
        <button
          className="window-btn menu-settings"
          onClick={onOpenSettings}
          title="Settings (Ctrl+,)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.9 17.9l-4.24-4.24M6.34 17.66l-4.24 4.24M23 12h-6m-6 0H1m20.24-4.24l-4.24 4.24M6.34 6.34l-4.24-4.24"></path>
          </svg>
        </button>

        <button className="window-btn minimize" onClick={handleMinimize} title="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          className="window-btn maximize"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2.5 2.5V7.5H7.5V2.5H2.5ZM1 1H9V9H1V1Z" fill="currentColor" />
              <path d="M3 3H8V8H3V3Z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" />
            </svg>
          )}
        </button>

        <button className="window-btn close" onClick={handleClose} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
