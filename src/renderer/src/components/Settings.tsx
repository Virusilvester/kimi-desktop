import { useState, useEffect, useCallback } from 'react'
import '../assets/Settings.css'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

interface AppSettings {
  offlineMode: boolean
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

interface ApiConfig {
  apiKey: string
  endpoint: string
}

const defaultSettings: AppSettings = {
  offlineMode: true,
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

export default function Settings({ isOpen, onClose }: SettingsProps): React.JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    apiKey: '',
    endpoint: 'https://api.moonshot.cn/v1'
  })
  const [activeTab, setActiveTab] = useState<'general' | 'api' | 'privacy' | 'advanced'>('general')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearType, setClearType] = useState<'all' | 'cache' | 'history' | 'cookies'>('all')
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 0 })
  const [isClearing, setIsClearing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  const loadData = async () => {
    setIsLoading(true)
    try {
      // Load settings
      const savedSettings = await window.api?.getSettings?.()
      if (savedSettings) {
        setSettings({ ...defaultSettings, ...savedSettings })
      }

      // Load API key
      const apiData = await window.api?.getApiKey?.()
      if (apiData) {
        setApiConfig(apiData)
      }

      // Load storage info
      await loadStorageInfo()
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadStorageInfo = async () => {
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

  const saveSettings = useCallback(async (newSettings: AppSettings) => {
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
  ) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings) // Optimistic update
    await saveSettings(newSettings)
  }

  const handleSaveApiKey = async () => {
    setSaveStatus('saving')
    try {
      const result = await window.api?.saveApiKey?.(apiConfig.apiKey, apiConfig.endpoint)
      if (result?.success) {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        setSaveStatus('error')
      }
    } catch (error) {
      console.error('Failed to save API key:', error)
      setSaveStatus('error')
    }
  }

  const handleClearData = async () => {
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

  const exportConversations = async () => {
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

  const importConversations = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const testApiConnection = async () => {
    if (!apiConfig.apiKey) {
      alert('Please enter an API key first')
      return
    }

    setSaveStatus('saving')
    try {
      // Simple test request to Kimi API
      const response = await fetch(`${apiConfig.endpoint}/models`, {
        headers: {
          Authorization: `Bearer ${apiConfig.apiKey}`
        }
      })

      if (response.ok) {
        alert('API connection successful!')
        setSaveStatus('saved')
      } else {
        alert('API connection failed: ' + response.statusText)
        setSaveStatus('error')
      }
    } catch (error) {
      alert('API connection failed: ' + (error as Error).message)
      setSaveStatus('error')
    }
    setTimeout(() => setSaveStatus('idle'), 2000)
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
                className={activeTab === 'api' ? 'active' : ''}
                onClick={() => setActiveTab('api')}
              >
                <span>🔑</span> API Key
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
                      <small>Start Kimi Desktop when you log in</small>
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
                      <span>Enable Offline Mode</span>
                      <small>Access saved conversations without internet</small>
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settings.offlineMode}
                        onChange={(e) => handleSettingChange('offlineMode', e.target.checked)}
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

              {activeTab === 'api' && (
                <div className="settings-section">
                  <h3>Kimi API Configuration</h3>

                  <div className="api-info">
                    <p>Configure your Kimi API key to enable offline chat functionality.</p>
                    <a
                      href="https://platform.moonshot.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Get API key from Moonshot AI →
                    </a>
                  </div>

                  <div className="setting-item vertical">
                    <label>
                      <span>API Endpoint</span>
                      <small>The Kimi API endpoint URL</small>
                    </label>
                    <input
                      type="text"
                      value={apiConfig.endpoint}
                      onChange={(e) => setApiConfig({ ...apiConfig, endpoint: e.target.value })}
                      placeholder="https://api.moonshot.cn/v1"
                      className="text-input"
                    />
                  </div>

                  <div className="setting-item vertical">
                    <label>
                      <span>API Key</span>
                      <small>Your Kimi API key (stored securely)</small>
                    </label>
                    <input
                      type="password"
                      value={apiConfig.apiKey}
                      onChange={(e) => setApiConfig({ ...apiConfig, apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="text-input"
                    />
                  </div>

                  <div className="api-actions">
                    <button
                      className="btn-primary"
                      onClick={handleSaveApiKey}
                      disabled={saveStatus === 'saving'}
                    >
                      {saveStatus === 'saving' ? 'Saving...' : '💾 Save API Key'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={testApiConnection}
                      disabled={!apiConfig.apiKey || saveStatus === 'saving'}
                    >
                      🧪 Test Connection
                    </button>
                  </div>

                  <div className="api-help">
                    <h4>About Offline Mode with API</h4>
                    <ul>
                      <li>Your API key is stored locally and encrypted</li>
                      <li>When offline, the app will use cached conversations</li>
                      <li>New messages can be queued and sent when back online</li>
                      <li>API calls are made directly from the app, not the webview</li>
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
