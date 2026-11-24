import { useEffect, useState, useCallback, useRef } from 'react'
import '../assets/TitleBar.css'

interface TitleBarProps {
  onOpenSettings: () => void
  onOpenSidebar: () => void
  onToggleEditor: () => void
  editorActive: boolean
  isOffline: boolean
  forceOffline: boolean
}

export default function TitleBar({
  onOpenSettings,
  onOpenSidebar,
  onToggleEditor,
  editorActive,
  isOffline,
  forceOffline
}: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const toggleForceOfflineInFlight = useRef(false)

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

  // Force-offline toggle: flips the persisted setting; App applies the new
  // state via the settings-changed broadcast, so no local state here. The
  // next value comes from the freshly fetched settings, not the prop — the
  // prop may not be resolved yet at startup.
  const handleToggleForceOffline = useCallback(async () => {
    // In-flight guard: a second click while the save is pending would read
    // the same stale state and no-op, making the toggle look stuck.
    if (toggleForceOfflineInFlight.current) return
    toggleForceOfflineInFlight.current = true
    try {
      const settings = (await window.api?.getSettings?.()) || {}
      const nextValue =
        settings.forceOfflineMode === undefined ? !forceOffline : !settings.forceOfflineMode
      const result = await window.api?.saveSettings?.({
        ...settings,
        forceOfflineMode: nextValue
      })
      if (!result?.success) console.error('[TitleBar] Failed to toggle force offline')
    } catch (error) {
      console.error('[TitleBar] Failed to toggle force offline:', error)
    } finally {
      toggleForceOfflineInFlight.current = false
    }
  }, [forceOffline])

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
            Kimi Dock {appVersion && <span className="version">v{appVersion}</span>}
            {forceOffline ? (
              <span className="offline-indicator forced">Forced Offline</span>
            ) : (
              isOffline && <span className="offline-indicator">Offline</span>
            )}
          </div>
        </div>
      </div>

      <div className="window-controls">
        <button
          className={`window-btn editor-toggle${editorActive ? ' active' : ''}`}
          onClick={onToggleEditor}
          title={editorActive ? 'Back to chat' : 'Artifact editor'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </button>

        <button
          className={`window-btn force-offline-toggle${forceOffline ? ' active' : ''}`}
          onClick={handleToggleForceOffline}
          title={forceOffline ? 'Back online (show Kimi webview)' : 'Force offline mode'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4.28 10.04A10.66 10.66 0 0 1 11.99 7c1.74 0 3.4.42 4.86 1.16" />
            <path d="M5.34 13.66a6.97 6.97 0 0 1 2.38-2.37" />
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M8.53 16.39a5 5 0 0 1 6.95 0" />
            <path d="M12 20h.01" />
          </svg>
        </button>

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
