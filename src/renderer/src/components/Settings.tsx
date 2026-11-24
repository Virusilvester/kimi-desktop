import { useState, useEffect, useCallback, useRef } from 'react'
import '../assets/Settings.css'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

interface AppSettings {
  forceOfflineMode: boolean
  autoSaveConversations: boolean
  saveHistory: boolean
  maxHistoryDays: number
  launchOnStartup: boolean
  minimizeToTray: boolean
  desktopNotifications: boolean
  theme: 'system' | 'light' | 'dark'
  fontSize: 'small' | 'medium' | 'large'
  spellCheck: boolean
  hardwareAcceleration: boolean
  cacheSize: number
}

interface OAuthStatus {
  loggedIn: boolean
  expiresAt?: number
  models: Array<{ id: string; display_name: string | null; context_length: number }>
  selectedModel: string | null
}

const defaultSettings: AppSettings = {
  forceOfflineMode: false,
  autoSaveConversations: true,
  saveHistory: true,
  maxHistoryDays: 30,
  launchOnStartup: false,
  minimizeToTray: true,
  desktopNotifications: true,
  theme: 'system',
  fontSize: 'medium',
  spellCheck: true,
  hardwareAcceleration: true,
  cacheSize: 0
}

// Available endpoints removed: offline chat now uses the Kimi Code OAuth
// session (https://api.kimi.com/coding/v1) instead of Moonshot API keys.

export default function Settings({ isOpen, onClose }: SettingsProps): React.JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [activeTab, setActiveTab] = useState<'general' | 'kimi' | 'privacy' | 'advanced'>('general')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearType, setClearType] = useState<'all' | 'cache' | 'history' | 'cookies'>('all')
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 0 })
  const [isClearing, setIsClearing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({
    loggedIn: false,
    models: [],
    selectedModel: null
  })
  const [oauthPhase, setOauthPhase] = useState<'idle' | 'waiting' | 'error'>('idle')
  // Bumped on every settings-changed broadcast; snapshots fetched with an
  // older epoch must not overwrite the broadcast merge.
  const settingsEpochRef = useRef(0)
  const [oauthMessage, setOauthMessage] = useState<string | null>(null)
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null)
  const [userCode, setUserCode] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  // Subscribe to OAuth flow events from the main process
  useEffect(() => {
    const unsubscribe = window.api?.onOAuthEvent?.((event) => {
      switch (event.type) {
        case 'verification_url':
          setOauthPhase('waiting')
          setVerificationUrl(String(event.data?.verification_url || ''))
          setUserCode(String(event.data?.user_code || ''))
          setOauthMessage(null)
          break
        case 'waiting':
          setOauthMessage(event.message)
          break
        case 'success':
          setOauthPhase('idle')
          setOauthMessage(null)
          setVerificationUrl(null)
          setUserCode(null)
          void refreshOAuthStatus()
          break
        case 'error':
          setOauthPhase('error')
          setOauthMessage(event.message)
          break
      }
    })
    return () => unsubscribe?.()
  }, [])

  // Subscribe to settings saves from any origin (title bar toggle, other
  // windows): the modal loads once on open and would otherwise save back a
  // stale snapshot, reverting changes made while it was open.
  useEffect(() => {
    const unsubscribe = window.api?.onSettingsChanged?.((incoming) => {
      settingsEpochRef.current += 1
      setSettings((prev) => ({ ...prev, ...incoming }))
    })
    return () => unsubscribe?.()
  }, [])

  const refreshOAuthStatus = async (): Promise<void> => {
    try {
      const status = await window.api?.oauthStatus?.()
      if (status) setOauthStatus(status)
    } catch (error) {
      console.error('Failed to load OAuth status:', error)
    }
  }

  const loadData = async (): Promise<void> => {
    setIsLoading(true)
    const epoch = settingsEpochRef.current
    try {
      // Load settings
      const savedSettings = await window.api?.getSettings?.()
      if (savedSettings) {
        if (settingsEpochRef.current !== epoch) {
          await loadData()
          return
        }
        setSettings({ ...defaultSettings, ...savedSettings })
      }

      // Load OAuth status
      await refreshOAuthStatus()

      // Load storage info
      await loadStorageInfo()
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadStorageInfo = async (): Promise<void> => {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate()
        setStorageInfo({
          used: estimate.usage || 0,
          quota: estimate.quota || 0
        })
      }
    } catch (error) {
      console.error('Failed to get storage info:', error)
    }
  }

  const saveSettings = useCallback(async (newSettings: AppSettings): Promise<void> => {
    setSaveStatus('saving')
    try {
      const result = await window.api?.saveSettings?.(newSettings)
      if (result?.success) {
        setSettings(newSettings)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        setSaveStatus('error')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      setSaveStatus('error')
    }
  }, [])

  const handleSettingChange = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings) // Optimistic update
    await saveSettings(newSettings)
  }

  const handleOAuthLogin = async (): Promise<void> => {
    setOauthPhase('waiting')
    setOauthMessage('Starting login...')
    setVerificationUrl(null)
    setUserCode(null)
    try {
      await window.api?.oauthLogin?.()
    } catch (error) {
      setOauthPhase('error')
      setOauthMessage((error as Error).message)
    }
  }

  const handleOAuthLogout = async (): Promise<void> => {
    try {
      await window.api?.oauthLogout?.()
      setOauthStatus({ loggedIn: false, models: [], selectedModel: null })
      setOauthPhase('idle')
      setOauthMessage(null)
    } catch (error) {
      console.error('Failed to log out:', error)
    }
  }

  const handleModelSelect = async (modelId: string): Promise<void> => {
    const result = await window.api?.oauthSelectModel?.(modelId)
    if (result?.success) {
      setOauthStatus((prev) => ({ ...prev, selectedModel: modelId }))
    }
  }

  const handleClearData = async (): Promise<void> => {
    setIsClearing(true)
    try {
      const result = await window.api?.clearData?.(clearType)
      if (result?.success) {
        setShowClearConfirm(false)
        await loadStorageInfo()

        // Show success notification
        if (window.api?.showNotification) {
          window.api.showNotification({
            title: 'Data Cleared',
            body: `Successfully cleared ${clearType} data.`
          })
        }
      } else {
        alert('Failed to clear data: ' + (result?.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to clear data:', error)
      alert('Failed to clear data')
    } finally {
      setIsClearing(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const exportConversations = async (): Promise<void> => {
    try {
      const data = await window.api?.exportConversations?.()
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `kimi-conversations-${new Date().toISOString().split('T')[0]}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('Failed to export conversations:', error)
      alert('Failed to export conversations')
    }
  }

  const importConversations = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await window.api?.importConversations?.(data)

      if (result?.success) {
        if (window.api?.showNotification) {
          window.api.showNotification({
            title: 'Import Successful',
            body: 'Conversations imported successfully.'
          })
        }
      } else {
        alert('Failed to import conversations')
      }
    } catch (error) {
      console.error('Failed to import conversations:', error)
      alert('Failed to import conversations. Invalid file format.')
    }
  }

  if (!isOpen) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <div className="header-actions">
            {saveStatus === 'saving' && <span className="status saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="status saved">✓ Saved</span>}
            {saveStatus === 'error' && <span className="status error">✗ Error</span>}
            <button className="close-btn" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="settings-loading">
            <div className="spinner"></div>
            <p>Loading settings...</p>
          </div>
        ) : (
          <div className="settings-content">
            <div className="settings-sidebar">
              <button
                className={activeTab === 'general' ? 'active' : ''}
                onClick={() => setActiveTab('general')}
              >
                <span>⚙️</span> General
              </button>
              <button
                className={activeTab === 'kimi' ? 'active' : ''}
                onClick={() => setActiveTab('kimi')}
              >
                <span>🤖</span> Kimi Account
              </button>
              <button
                className={activeTab === 'privacy' ? 'active' : ''}
                onClick={() => setActiveTab('privacy')}
              >
                <span>🔒</span> Privacy
              </button>
              <button
                className={activeTab === 'advanced' ? 'active' : ''}
                onClick={() => setActiveTab('advanced')}
              >
                <span>⚡</span> Advanced
              </button>
            </div>

            <div className="settings-panel">
              {activeTab === 'general' && (
                <div className="settings-section">
                  <h3>General Settings</h3>

                  <div className="setting-item">
                    <label>
                      <span>Launch on Startup</span>
                      <small>Start Kimi Dock when you log in</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.launchOnStartup}
                        onChange={(e) => handleSettingChange('launchOnStartup', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Minimize to Tray</span>
                      <small>Keep app running in system tray when closed</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.minimizeToTray}
                        onChange={(e) => handleSettingChange('minimizeToTray', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Desktop Notifications</span>
                      <small>Show notifications for new messages</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.desktopNotifications}
                        onChange={(e) =>
                          handleSettingChange('desktopNotifications', e.target.checked)
                        }
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Auto-save Conversations</span>
                      <small>Automatically save conversations for offline access</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.autoSaveConversations}
                        onChange={(e) =>
                          handleSettingChange('autoSaveConversations', e.target.checked)
                        }
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Theme</span>
                      <small>Choose your preferred appearance</small>
                    </label>
                    <select
                      value={settings.theme}
                      onChange={(e) => handleSettingChange('theme', e.target.value as any)}
                    >
                      <option value="system">System Default</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Font Size</span>
                      <small>Adjust text size throughout the app</small>
                    </label>
                    <select
                      value={settings.fontSize}
                      onChange={(e) => handleSettingChange('fontSize', e.target.value as any)}
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>

                  <div className="storage-info">
                    <h4>Storage Usage</h4>
                    <div className="storage-bar">
                      <div
                        className="storage-used"
                        style={{
                          width: `${Math.min((storageInfo.used / storageInfo.quota) * 100, 100)}%`
                        }}
                      ></div>
                    </div>
                    <p>
                      {formatBytes(storageInfo.used)} used of {formatBytes(storageInfo.quota)}
                    </p>
                  </div>

                  <div className="data-actions">
                    <h4>Data Management</h4>
                    <div className="action-buttons">
                      <button className="btn-secondary" onClick={exportConversations}>
                        📥 Export Conversations
                      </button>
                      <label className="btn-secondary file-input-label">
                        📤 Import Conversations
                        <input
                          type="file"
                          accept=".json"
                          onChange={importConversations}
                          style={{ display: 'none' }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'kimi' && (
                <div className="settings-section">
                  <h3>Kimi Account</h3>

                  <div className="api-info">
                    <p>
                      Connect your <strong>Kimi Code Plan</strong> subscription to enable offline
                      chat. Authorization uses the same device login flow as the official Kimi CLI.
                    </p>
                  </div>

                  {!oauthStatus.loggedIn ? (
                    <>
                      <div className="setting-item vertical">
                        <label>
                          <span>Status</span>
                          <small>Not connected</small>
                        </label>
                        <div className="api-actions">
                          <button
                            className="btn-primary"
                            onClick={handleOAuthLogin}
                            disabled={oauthPhase === 'waiting'}
                          >
                            {oauthPhase === 'waiting'
                              ? 'Waiting for authorization...'
                              : '🔐 Log in with Kimi'}
                          </button>
                        </div>
                      </div>

                      {verificationUrl && (
                        <div className="oauth-verify">
                          <p>
                            Open this URL in your browser to authorize (code:{' '}
                            <code>{userCode}</code>):
                          </p>
                          <a href={verificationUrl} target="_blank" rel="noopener noreferrer">
                            {verificationUrl}
                          </a>
                        </div>
                      )}

                      {oauthMessage && (
                        <div className={oauthPhase === 'error' ? 'api-error' : 'api-help'}>
                          <p>{oauthMessage}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="setting-item vertical">
                        <label>
                          <span>Status</span>
                          <small>
                            Connected
                            {oauthStatus.expiresAt
                              ? ` (session renews ${new Date(oauthStatus.expiresAt * 1000).toLocaleString()})`
                              : ''}
                          </small>
                        </label>
                        <div className="api-actions">
                          <button className="btn-secondary" onClick={handleOAuthLogout}>
                            🚪 Log out
                          </button>
                        </div>
                      </div>

                      {oauthStatus.models.length > 0 && (
                        <div className="setting-item vertical">
                          <label>
                            <span>Model</span>
                            <small>Used for offline chat</small>
                          </label>
                          <select
                            value={oauthStatus.selectedModel || ''}
                            onChange={(e) => handleModelSelect(e.target.value)}
                            className="endpoint-select"
                          >
                            {oauthStatus.models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.display_name || model.id}
                                {model.context_length
                                  ? ` (${Math.round(model.context_length / 1024)}k ctx)`
                                  : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}

                  <div className="api-help">
                    <h4>About Offline Mode</h4>
                    <ul>
                      <li>Tokens are stored locally with restricted file permissions</li>
                      <li>Sessions auto-refresh in the background before expiry</li>
                      <li>
                        API calls are proxied through the main process to bypass CSP restrictions
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {activeTab === 'privacy' && (
                <div className="settings-section">
                  <h3>Privacy & Security</h3>

                  <div className="privacy-warning">
                    <strong>⚠️ Warning:</strong> Clearing data cannot be undone. Make sure to export
                    any important conversations first.
                  </div>

                  <div className="clear-data-section">
                    <h4>Clear Data</h4>

                    <div className="clear-options">
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="clearType"
                          value="cache"
                          checked={clearType === 'cache'}
                          onChange={(e) => setClearType(e.target.value as any)}
                        />
                        <div>
                          <strong>Clear Cache</strong>
                          <small>Remove cached images and temporary files</small>
                        </div>
                      </label>

                      <label className="radio-label">
                        <input
                          type="radio"
                          name="clearType"
                          value="cookies"
                          checked={clearType === 'cookies'}
                          onChange={(e) => setClearType(e.target.value as any)}
                        />
                        <div>
                          <strong>Clear Cookies & Session</strong>
                          <small>Sign out and remove session data</small>
                        </div>
                      </label>

                      <label className="radio-label">
                        <input
                          type="radio"
                          name="clearType"
                          value="history"
                          checked={clearType === 'history'}
                          onChange={(e) => setClearType(e.target.value as any)}
                        />
                        <div>
                          <strong>Clear Conversation History</strong>
                          <small>Remove all saved conversations</small>
                        </div>
                      </label>

                      <label className="radio-label danger">
                        <input
                          type="radio"
                          name="clearType"
                          value="all"
                          checked={clearType === 'all'}
                          onChange={(e) => setClearType(e.target.value as any)}
                        />
                        <div>
                          <strong>Clear All Data</strong>
                          <small>Remove everything including settings and API key</small>
                        </div>
                      </label>
                    </div>

                    <button className="btn-danger" onClick={() => setShowClearConfirm(true)}>
                      🗑️ Clear Selected Data
                    </button>
                  </div>

                  {showClearConfirm && (
                    <div className="confirm-dialog">
                      <div className="confirm-content">
                        <h4>Are you sure?</h4>
                        <p>
                          This will permanently delete {clearType === 'all' ? 'all' : clearType}{' '}
                          data.
                        </p>
                        <div className="confirm-actions">
                          <button
                            className="btn-secondary"
                            onClick={() => setShowClearConfirm(false)}
                            disabled={isClearing}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn-danger"
                            onClick={handleClearData}
                            disabled={isClearing}
                          >
                            {isClearing ? 'Clearing...' : 'Yes, Clear Data'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="settings-section">
                  <h3>Advanced Settings</h3>

                  <div className="setting-item">
                    <label>
                      <span>Force Offline Mode</span>
                      <small>
                        Show the offline chat UI regardless of network state (debugging aid)
                      </small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.forceOfflineMode}
                        onChange={(e) => handleSettingChange('forceOfflineMode', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Hardware Acceleration</span>
                      <small>Use GPU for better performance (requires restart)</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.hardwareAcceleration}
                        onChange={(e) =>
                          handleSettingChange('hardwareAcceleration', e.target.checked)
                        }
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="setting-item">
                    <label>
                      <span>Spell Check</span>
                      <small>Enable spell checking in text inputs</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.spellCheck}
                        onChange={(e) => handleSettingChange('spellCheck', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="info-section">
                    <h4>Application Info</h4>
                    <div className="info-grid">
                      <div className="info-item">
                        <span>Version</span>
                        <span id="app-version">Loading...</span>
                      </div>
                      <div className="info-item">
                        <span>Electron</span>
                        <span>{window.electron?.process?.versions?.electron || 'N/A'}</span>
                      </div>
                      <div className="info-item">
                        <span>Chrome</span>
                        <span>{window.electron?.process?.versions?.chrome || 'N/A'}</span>
                      </div>
                      <div className="info-item">
                        <span>Node.js</span>
                        <span>{window.electron?.process?.versions?.node || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="advanced-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => window.api?.checkForUpdates?.()}
                    >
                      🔍 Check for Updates
                    </button>
                    <button className="btn-secondary" onClick={() => window.api?.restartApp?.()}>
                      🔄 Restart Application
                    </button>
                    <button className="btn-secondary" onClick={() => window.api?.openDevTools?.()}>
                      🛠️ Open Developer Tools
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
