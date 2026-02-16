import KimiWebView from './components/KimiWebView'
import TitleBar from './components/TitleBar'

function App(): React.JSX.Element {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <TitleBar />
      <div style={{ flex: 1, position: 'relative' }}>
        <KimiWebView />
      </div>
    </div>
  )
}

export default App
