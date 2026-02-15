import KimiWebView from './components/KimiWebView'
import TitleBar from './components/TitleBar'

function App(): React.JSX.Element {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        <TitleBar />
        <KimiWebView />
      </div>
    </div>
  )
}

export default App
