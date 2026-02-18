import { useEffect, useState, useCallback } from 'react'
import '../assets/TitleBar.css'

export default function TitleBar(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    // Listen for maximize state changes
    if (window.api?.onMaximizeChange) {
      window.api.onMaximizeChange((value) => setIsMaximized(value))
    }

    // Get app version
    window.api?.getAppVersion?.().then((version) => {
      setAppVersion(version)
    })

    return () => {
      window.api?.removeAllListeners('window-maximized')
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + R: Reload
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault()
        const webview = document.querySelector('webview') as Electron.WebviewTag
        webview?.reload()
      }

      // Ctrl/Cmd + Shift + R: Force reload
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        const webview = document.querySelector('webview') as Electron.WebviewTag
        webview?.reloadIgnoringCache()
      }

      // Ctrl/Cmd + =: Zoom in
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        const webview = document.querySelector('webview') as Electron.WebviewTag
        const currentZoom = webview?.getZoomLevel() || 0
        webview?.setZoomLevel(currentZoom + 1)
      }

      // Ctrl/Cmd + -: Zoom out
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        const webview = document.querySelector('webview') as Electron.WebviewTag
        const currentZoom = webview?.getZoomLevel() || 0
        webview?.setZoomLevel(currentZoom - 1)
      }

      // Ctrl/Cmd + 0: Reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        const webview = document.querySelector('webview') as Electron.WebviewTag
        webview?.setZoomLevel(0)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleDoubleClick = useCallback(() => {
    window.api?.maximize()
  }, [])

  return (
    <div className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="titlebar-drag-region">
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
        </div>
      </div>

      <div className="window-controls">
        <button
          className="window-btn minimize"
          onClick={() => window.api?.minimize()}
          title="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="window-btn maximize"
          onClick={() => window.api?.maximize()}
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
        <button className="window-btn close" onClick={() => window.api?.close()} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
