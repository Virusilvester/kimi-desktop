import { useEffect, useState } from 'react'

export default function TitleBar(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (window.api && typeof window.api.onMaximizeChange === 'function') {
      window.api.onMaximizeChange((value) => setIsMaximized(value))
    } else {
      console.warn('window.api is not available yet')
    }
  }, [])

  return (
    <div className="titlebar" onDoubleClick={() => window.api?.maximize()}>
      <div className="title">Kimi Desktop</div>

      <div className="window-controls">
        <button onClick={() => window.api?.minimize()}>—</button>
        <button onClick={() => window.api?.maximize()}>{isMaximized ? '🗗' : '☐'}</button>
        <button onClick={() => window.api?.close()}>✕</button>
      </div>
    </div>
  )
}
