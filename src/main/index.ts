/* eslint-disable @typescript-eslint/explicit-function-return-type */
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  dialog,
  session,
  Notification
} from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// ... (keep all the interfaces and default values from previous version)

// Window state management
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

// Settings interface
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
  kimiApiKey?: string
  kimiApiEndpoint?: string
}

// Global window reference - MUST be global to prevent GC
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuiting = false
let saveWindowStateTimer: NodeJS.Timeout | null = null

// Default window state
const defaultWindowState: WindowState = {
  width: 1200,
  height: 800,
  isMaximized: false
}

// Default settings
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
  cacheSize: 0,
  kimiApiKey: '',
  kimiApiEndpoint: 'https://api.moonshot.cn/v1'
}

// Get paths
function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function getConversationsPath(): string {
  return join(app.getPath('userData'), 'conversations.json')
}

function getApiKeyPath(): string {
  return join(app.getPath('userData'), 'api-key.enc')
}

// Read saved window state
function readSavedWindowState(): Partial<WindowState> | null {
  try {
    const path = getWindowStatePath()
    if (!fs.existsSync(path)) return null
    const contents = fs.readFileSync(path, 'utf-8')
    return JSON.parse(contents) as Partial<WindowState>
  } catch {
    return null
  }
}

function getWindowState(): WindowState {
  try {
    const saved = readSavedWindowState()
    return { ...defaultWindowState, ...(saved ?? {}) }
  } catch {
    return defaultWindowState
  }
}

function writeWindowState(state: WindowState) {
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf-8')
  } catch {
    // Ignore persistence errors
  }
}

function saveWindowState() {
  if (!mainWindow) return
  const bounds = mainWindow.getBounds()
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: mainWindow.isMaximized()
  }
  writeWindowState(state)
}

function scheduleSaveWindowState() {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer)
  saveWindowStateTimer = setTimeout(() => {
    saveWindowStateTimer = null
    saveWindowState()
  }, 250)
}

// Settings management
function loadSettings(): AppSettings {
  try {
    const path = getSettingsPath()
    if (!fs.existsSync(path)) return defaultSettings
    const contents = fs.readFileSync(path, 'utf-8')
    return { ...defaultSettings, ...JSON.parse(contents) }
  } catch {
    return defaultSettings
  }
}

function saveSettingsToFile(settings: AppSettings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')

    // Apply startup setting
    app.setLoginItemSettings({
      openAtLogin: settings.launchOnStartup,
      path: app.getPath('exe')
    })
  } catch {
    // Ignore persistence errors
  }
}

// Create main window
function createWindow(): void {
  const windowState = getWindowState()
  const settings = loadSettings()

  // CRITICAL: Get correct preload path based on environment
  const preloadPath = join(__dirname, '../preload/index.js')

  console.log('[Main] Creating window with preload:', preloadPath)
  console.log('[Main] __dirname:', __dirname)

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 400,
    minHeight: 600,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#111111',
    show: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: settings.spellCheck
    }
  })

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  /* ---------- WINDOW EVENTS ---------- */

  mainWindow.on('ready-to-show', () => {
    console.log('[Main] Window ready to show')
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('close', (event) => {
    if (!isQuiting && process.platform === 'darwin') {
      event.preventDefault()
      saveWindowState()
      mainWindow?.hide()
    } else {
      saveWindowState()
    }
  })

  mainWindow.on('resize', () => {
    if (!mainWindow?.isMaximized()) {
      scheduleSaveWindowState()
    }
  })

  mainWindow.on('move', () => {
    if (!mainWindow?.isMaximized()) {
      scheduleSaveWindowState()
    }
  })

  // Maximize state events
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized', true)
    scheduleSaveWindowState()
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized', false)
    scheduleSaveWindowState()
  })

  /* ---------- EXTERNAL LINKS HANDLING ---------- */
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Log preload errors
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[Main] Preload error:', preloadPath, error)
  })

  /* ---------- LOAD URL ---------- */
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Create tray
function createTray() {
  const trayIcon = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Kimi Desktop',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    {
      label: 'New Chat',
      click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send('navigate-to', '/')
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send('open-settings')
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuiting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Kimi Desktop')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

/* ---------- IPC HANDLERS ---------- */

// Window controls - FIXED: Use proper window reference
ipcMain.on('minimize', () => {
  console.log('[IPC] minimize received')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize()
  }
})

ipcMain.on('maximize', () => {
  console.log('[IPC] maximize received')
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.on('close', () => {
  console.log('[IPC] close received')
  const settings = loadSettings()
  if (process.platform === 'darwin' || settings.minimizeToTray) {
    mainWindow?.hide()
  } else {
    mainWindow?.close()
  }
})

ipcMain.on('restart-app', () => {
  app.relaunch()
  app.exit(0)
})

// Check for updates
ipcMain.handle('check-for-updates', async () => {
  return { updateAvailable: false, version: app.getVersion() }
})

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

// Dialogs
ipcMain.handle('show-save-dialog', async (_, options) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, options)
  return result
})

ipcMain.handle('show-open-dialog', async (_, options) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, options)
  return result
})

// Settings IPC handlers - FIXED: Proper async handlers
ipcMain.handle('get-settings', async () => {
  console.log('[IPC] get-settings called')
  return loadSettings()
})

ipcMain.handle('save-settings', async (_, settings: AppSettings) => {
  console.log('[IPC] save-settings called', settings)
  saveSettingsToFile(settings)

  // Apply settings that need immediate effect
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.session.setSpellCheckerEnabled(settings.spellCheck)
  }
  return { success: true }
})

// Clear data handlers
ipcMain.handle('clear-data', async (_, type: 'all' | 'cache' | 'history' | 'cookies') => {
  console.log('[IPC] clear-data called', type)
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'No window' }

  const ses = mainWindow.webContents.session

  try {
    switch (type) {
      case 'cache':
        await ses.clearCache()
        await ses.clearCodeCaches({})
        break
      case 'cookies':
        await ses.clearStorageData({ storages: ['cookies', 'localstorage'] })
        break
      case 'history':
        // Clear conversations file
        try {
          const convPath = getConversationsPath()
          if (fs.existsSync(convPath)) {
            fs.unlinkSync(convPath)
          }
        } catch (error) {
          console.error('Failed to clear conversations:', error)
        }
        await ses.clearStorageData({ storages: ['indexdb'] })
        break
      case 'all':
        await ses.clearStorageData()
        await ses.clearCache()
        await ses.clearCodeCaches({})
        await ses.clearAuthCache()
        // Clear settings
        try {
          const settingsPath = getSettingsPath()
          if (fs.existsSync(settingsPath)) {
            fs.unlinkSync(settingsPath)
          }
          const convPath = getConversationsPath()
          if (fs.existsSync(convPath)) {
            fs.unlinkSync(convPath)
          }
        } catch (error) {
          console.error('Failed to clear files:', error)
        }
        break
    }
    return { success: true }
  } catch (error) {
    console.error('Error clearing data:', error)
    return { success: false, error: String(error) }
  }
})

// Conversation export/import
ipcMain.handle('export-conversations', async () => {
  try {
    const convPath = getConversationsPath()
    if (!fs.existsSync(convPath)) return []
    const data = fs.readFileSync(convPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
})

ipcMain.handle('import-conversations', async (_, data) => {
  const convPath = getConversationsPath()
  fs.writeFileSync(convPath, JSON.stringify(data, null, 2), 'utf-8')
  return { success: true }
})

// CRITICAL FIX: API Proxy - Make API calls from main process to bypass CSP
ipcMain.handle(
  'kimi-api-request',
  async (
    _,
    requestData: {
      endpoint: string
      apiKey: string
      method: string
      path: string
      body?: any
    }
  ) => {
    console.log('[API Proxy] Request to:', requestData.path)

    try {
      const url = `${requestData.endpoint}${requestData.path}`

      // Use fetch from the main process to bypass CSP
      const response = await fetch(url, {
        method: requestData.method,
        headers: {
          Authorization: `Bearer ${requestData.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: requestData.body ? JSON.stringify(requestData.body) : undefined
      })

      const data = await response.json()

      return {
        success: response.ok,
        status: response.status,
        data: data,
        error: response.ok ? null : data.error?.message || `HTTP ${response.status}`
      }
    } catch (error) {
      console.error('[API Proxy] Error:', error)
      return {
        success: false,
        error: (error as Error).message
      }
    }
  }
)

// API Key management
ipcMain.handle('get-api-key', async () => {
  try {
    const keyPath = getApiKeyPath()
    if (!fs.existsSync(keyPath)) return { apiKey: '', endpoint: defaultSettings.kimiApiEndpoint }
    const encrypted = fs.readFileSync(keyPath, 'utf-8')
    // Simple obfuscation - in production use proper encryption
    const decrypted = Buffer.from(encrypted, 'base64').toString('utf-8')
    const data = JSON.parse(decrypted)
    return data
  } catch {
    return { apiKey: '', endpoint: defaultSettings.kimiApiEndpoint }
  }
})

ipcMain.handle('save-api-key', async (_, apiKey: string, endpoint: string) => {
  try {
    const keyPath = getApiKeyPath()
    // Simple obfuscation - in production use proper encryption
    const data = JSON.stringify({ apiKey, endpoint, savedAt: Date.now() })
    const encrypted = Buffer.from(data).toString('base64')
    fs.writeFileSync(keyPath, encrypted, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

// Notification handler
ipcMain.handle('show-notification', (_, options: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: options.title,
      body: options.body,
      icon: icon
    }).show()
  }
})

// Developer tools
ipcMain.on('open-dev-tools', () => {
  mainWindow?.webContents.openDevTools()
})

// Handle protocol URLs (deep linking)
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('kimi://')) {
    const path = url.replace('kimi://', '')
    mainWindow?.webContents.send('navigate-to', path)
    mainWindow?.show()
  }
})

/* ---------- APP READY ---------- */

app.whenReady().then(() => {
  console.log('[Main] App ready')
  electronApp.setAppUserModelId('com.kimi.desktop')

  // Set up protocol handler
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('kimi', process.execPath, [process.argv[1]])
    }
  } else {
    app.setAsDefaultProtocolClient('kimi')
  }

  // Apply hardware acceleration setting
  const settings = loadSettings()
  if (!settings.hardwareAcceleration) {
    app.disableHardwareAcceleration()
  }

  // CRITICAL FIX: Updated CSP to allow Moonshot API
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    console.log('[CSP] Setting CSP for:', details.url)

    // Define allowed sources
    const defaultSrc = "'self' https://kimi.com https://*.kimi.com https://api.moonshot.cn"
    const scriptSrc = "'self' 'unsafe-inline' https://kimi.com https://*.kimi.com"
    const styleSrc = "'self' 'unsafe-inline' https://kimi.com https://*.kimi.com"
    const imgSrc = "'self' data: blob: https:"
    const fontSrc = "'self' https://kimi.com https://*.kimi.com"
    const frameSrc = "'self' https://kimi.com"

    // CRITICAL: connect-src must include the Moonshot API
    const connectSrc =
      "'self' https://kimi.com https://*.kimi.com wss://*.kimi.com https://api.moonshot.cn https://*.moonshot.cn"

    const cspString = [
      `default-src ${defaultSrc}`,
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      `img-src ${imgSrc}`,
      `connect-src ${connectSrc}`,
      `font-src ${fontSrc}`,
      `frame-src ${frameSrc}`
    ].join('; ')

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspString]
      }
    })
  })

  // Global handler for all webContents (including webviews)
  app.on('web-contents-created', (_, contents) => {
    contents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()

  // Apply startup setting
  app.setLoginItemSettings({
    openAtLogin: settings.launchOnStartup,
    path: app.getPath('exe')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle second instance (deep linking from browser)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()

      // Handle protocol URL from second instance
      const url = commandLine.find((arg) => arg.startsWith('kimi://'))
      if (url) {
        const path = url.replace('kimi://', '')
        mainWindow.webContents.send('navigate-to', path)
      }
    }
  })
}
