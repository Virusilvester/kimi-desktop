/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Component, ReactNode } from 'react'
import KimiWebView from './components/KimiWebView'
import TitleBar from './components/TitleBar'

// Error Boundary for catching React errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo)
  }

  render() {
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
        <TitleBar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <KimiWebView />
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default App
