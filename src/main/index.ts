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
import { join, resolve, sep, basename, dirname, isAbsolute } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  startLogin,
  cancelOngoingLogin,
  getStatus as getOAuthStatus,
  logout as oauthLogout,
  selectModel as oauthSelectModel,
  ensureFreshAccessToken,
  forceRefreshAccessToken,
  CODING_API_BASE
} from './kimi-oauth'
import {
  readClipboard,
  writeClipboard,
  CLIPBOARD_READ_FORMATS,
  CLIPBOARD_WRITE_FORMATS
} from './clipboard'
import {
  listEntries,
  listFilesRecursive,
  readTextFile,
  writeTextFile,
  resolveInWorkspace
} from './workspace'
import { resolveRun, substitutePlaceholders } from './runConfig'
import { startProcess, stopProcess, stopAllProcesses } from './runner'

// Google login: GIS only falls back to its OAuth popup flow when FedCM is
// unavailable. Disabling the FedCm feature makes navigator.credentials.get
// reject identity requests natively with NotSupportedError — deterministic,
// no page-JS patching. Merge with any features Electron already disables.
{
  const disabled = new Set(
    app.commandLine
      .getSwitchValue('disable-features')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
  )
  disabled.add('FedCm')
  app.commandLine.appendSwitch('disable-features', [...disabled].join(','))
}

// Origins allowed to open a popup inside the app (login flows); everything
// else is redirected to the system browser.
const AUTH_POPUP_HOSTS = new Set(['accounts.google.com'])
const APP_CALLBACK_HOSTS = new Set(['kimi.ai', 'www.kimi.ai'])

const isAllowedAuthUrl = (rawUrl: string): boolean => {
  try {
    return AUTH_POPUP_HOSTS.has(new URL(rawUrl).host)
  } catch {
    return false
  }
}

const routeWindowOpen = (details: Electron.HandlerDetails): Electron.WindowOpenHandlerResponse => {
  if (isAllowedAuthUrl(details.url)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 480,
        height: 640,
        autoHideMenuBar: true,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      }
    }
  }
  try {
    const protocol = new URL(details.url).protocol
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') {
      shell.openExternal(details.url)
    }
  } catch {
    // unparseable URL: drop it
  }
  return { action: 'deny' }
}

// Global popup lifecycle management for in-app auth popups (their window.open
// routing lives on the embedder — see routeWindowOpen; guest popups never
// reach a per-guest handler).
const isAllowedPopupHost = (host: string): boolean =>
  AUTH_POPUP_HOSTS.has(host) || APP_CALLBACK_HOSTS.has(host)

app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(routeWindowOpen)
  contents.on('did-create-window', (child) => {
    // Match the opener's UA: Google's OAuth can refuse embedded UAs that
    // advertise "Electron".
    child.webContents.setUserAgent(contents.getUserAgent())

    // Contain the popup: it may only ever visit the identity provider or
    // return to the app origin — covers direct navigations and server-side
    // redirects alike.
    const guardNavigation = (event: Electron.Event, url: string): void => {
      try {
        if (!isAllowedPopupHost(new URL(url).host)) {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    }
    child.webContents.on('will-navigate', guardNavigation)
    child.webContents.on('will-redirect', guardNavigation)

    // The popup's job ends when the provider redirects back to the app
    // origin. Close only after the callback page finished loading — its
    // in-page JS finalizes the session (the id_token arrives in the URL
    // fragment, the server never sees it).
    child.webContents.on('did-finish-load', () => {
      const url = child.webContents.getURL()
      try {
        if (!APP_CALLBACK_HOSTS.has(new URL(url).host)) return
      } catch {
        return
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-popup-finished')
      }
      child.close()
    })
  })
})

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
  workspaceRoot: string
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
  cacheSize: 0,
  workspaceRoot: ''
}

// Migrate data from the upstream "kimi-desktop" userData dir (Linux: ~/.config/kimi-desktop)
// to this fork's dir (~/.config/kimi-dock). Runs once at startup, before anything
// reads userData paths.
function migrateLegacyUserData(): void {
  try {
    const current = app.getPath('userData') // e.g. ~/.config/kimi-dock
    const legacy = join(app.getPath('appData'), 'kimi-desktop')
    if (legacy === current || !fs.existsSync(legacy)) return
    const files = [
      'kimi-code.json',
      'device_id',
      'settings.json',
      'window-state.json',
      'conversations.json'
    ]
    fs.mkdirSync(current, { recursive: true })
    for (const file of files) {
      const from = join(legacy, file)
      const to = userDataFile(file)
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.copyFileSync(from, to)
        console.log('[Main] Migrated', file, 'from legacy userData')
      }
    }
  } catch (error) {
    console.error('[Main] Legacy migration failed:', error)
  }
}

// Get paths
function getWindowStatePath(): string {
  return userDataFile('window-state.json')
}

function getSettingsPath(): string {
  return userDataFile('settings.json')
}

function getConversationsPath(): string {
  return userDataFile('conversations.json')
}

// Defense in depth for every file accessed under userData: resolve the final
// path and refuse anything that escapes the directory (e.g. via '..' segments
// if a path ever becomes caller-controlled).
function userDataFile(...segments: string[]): string {
  const base = app.getPath('userData')
  const resolved = resolve(base, ...segments)
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`Refused path outside userData: ${resolved}`)
  }
  return resolved
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    // Tolerant merge (coerceSettings, not sanitizeSettings): keys outside
    // the schema (e.g. the removed offlineMode) never surface, valid fields
    // of a hand-edited file are kept, only invalid/missing ones fall back
    // to defaults.
    return coerceSettings(JSON.parse(contents))
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

// Minimal manual type checks for the renderer-supplied settings payload
// (project rule: no schema-validation dependencies).
const SETTINGS_BOOL_FIELDS = [
  'forceOfflineMode',
  'autoSaveConversations',
  'saveHistory',
  'launchOnStartup',
  'minimizeToTray',
  'desktopNotifications',
  'spellCheck',
  'hardwareAcceleration'
] as const

function sanitizeSettings(input: unknown): AppSettings | null {
  if (!isRecord(input)) return null
  const settings = { ...defaultSettings }

  for (const field of SETTINGS_BOOL_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]
    if (typeof value !== 'boolean') return null
    settings[field] = value
  }

  for (const field of ['maxHistoryDays', 'cacheSize'] as const) {
    if (!(field in input)) continue
    const value = input[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    settings[field] = value
  }

  if ('theme' in input) {
    if (input.theme !== 'system' && input.theme !== 'light' && input.theme !== 'dark') return null
    settings.theme = input.theme
  }
  if ('fontSize' in input) {
    if (input.fontSize !== 'small' && input.fontSize !== 'medium' && input.fontSize !== 'large') {
      return null
    }
    settings.fontSize = input.fontSize
  }
  if ('workspaceRoot' in input) {
    if (typeof input.workspaceRoot !== 'string') return null
    settings.workspaceRoot = input.workspaceRoot
  }

  return settings
}

// Tolerant counterpart of sanitizeSettings, used only by loadSettings:
// strict for saves (a rejected payload stays rejected), tolerant for load
// (a hand-edited settings.json keeps its valid keys; only invalid or
// missing fields fall back to defaults).
function coerceSettings(input: unknown): AppSettings {
  const settings = { ...defaultSettings }
  if (!isRecord(input)) return settings

  for (const field of SETTINGS_BOOL_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]
    if (typeof value === 'boolean') settings[field] = value
  }

  for (const field of ['maxHistoryDays', 'cacheSize'] as const) {
    if (!(field in input)) continue
    const value = input[field]
    if (typeof value === 'number' && Number.isFinite(value)) settings[field] = value
  }

  if (input.theme === 'system' || input.theme === 'light' || input.theme === 'dark') {
    settings.theme = input.theme
  }
  if (input.fontSize === 'small' || input.fontSize === 'medium' || input.fontSize === 'large') {
    settings.fontSize = input.fontSize
  }
  if (typeof input.workspaceRoot === 'string') {
    settings.workspaceRoot = input.workspaceRoot
  }

  return settings
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
  // window.open from ANY content (including the webview guest) is routed
  // through the main window's handler — per-guest handlers never fire for
  // webview guests.
  mainWindow.webContents.setWindowOpenHandler(routeWindowOpen)

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
      label: 'Show Kimi Dock',
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

  tray.setToolTip('Kimi Dock')
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
  if (!isRecord(options)) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, options as Electron.SaveDialogOptions)
  return result
})

ipcMain.handle('show-open-dialog', async (_, options) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true }
  if (!isRecord(options)) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, options as Electron.OpenDialogOptions)
  return result
})

// Settings IPC handlers - FIXED: Proper async handlers
ipcMain.handle('get-settings', async () => {
  console.log('[IPC] get-settings called')
  return loadSettings()
})

ipcMain.handle('save-settings', async (_, settings: unknown) => {
  const sanitized = sanitizeSettings(settings)
  if (!sanitized) {
    console.log('[IPC] save-settings rejected: invalid payload')
    return { success: false, error: 'Invalid settings payload' }
  }
  console.log('[IPC] save-settings called', sanitized)
  saveSettingsToFile(sanitized)

  // Apply settings that need immediate effect
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.session.setSpellCheckerEnabled(sanitized.spellCheck)
    mainWindow.webContents.send('settings-changed', sanitized)
  }
  return { success: true }
})

// Clear data handlers
ipcMain.handle('clear-data', async (_, type: 'all' | 'cache' | 'history' | 'cookies') => {
  console.log('[IPC] clear-data called', type)
  if (type !== 'all' && type !== 'cache' && type !== 'history' && type !== 'cookies') {
    return { success: false, error: 'Invalid clear-data type' }
  }
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
        oauthLogout()
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

ipcMain.handle('import-conversations', async (_, data: unknown) => {
  if (!Array.isArray(data) || data.some((item) => !isRecord(item))) {
    return { success: false, error: 'Invalid conversations payload' }
  }
  try {
    fs.writeFileSync(getConversationsPath(), JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('[IPC] import-conversations failed:', error)
    return { success: false, error: (error as Error).message }
  }
})

// API Proxy through the Kimi Code OAuth session (main process bypasses renderer CSP).
// The renderer must never turn this into a generic HTTP proxy: only the coding
// API endpoints and GET/POST are allowed.
const API_PROXY_ALLOWED_PATHS = new Set(['/chat/completions'])
const API_PROXY_ALLOWED_METHODS = new Set(['GET', 'POST'])

ipcMain.handle(
  'kimi-api-request',
  async (
    _,
    requestData: {
      method: string
      path: string
      body?: any
    }
  ) => {
    try {
      if (!isRecord(requestData)) {
        return { success: false, error: 'Invalid request payload' }
      }
      const method = typeof requestData.method === 'string' ? requestData.method.toUpperCase() : ''
      const path = requestData.path
      if (!API_PROXY_ALLOWED_METHODS.has(method)) {
        return { success: false, error: `Method not allowed: ${method || '(none)'}` }
      }
      if (typeof path !== 'string' || !API_PROXY_ALLOWED_PATHS.has(path)) {
        return {
          success: false,
          error: `Path not allowed: ${typeof path === 'string' ? path : '(none)'}`
        }
      }
      // Bodies are only meaningful for POST; GET never carries one.
      const body = method === 'POST' ? requestData.body : undefined

      let accessToken = await ensureFreshAccessToken()
      if (!accessToken) {
        return { success: false, error: 'Not logged in to Kimi account' }
      }

      const url = `${CODING_API_BASE}${path}`
      const doFetch = async (): Promise<Response> =>
        fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
          },
          body: body !== undefined ? JSON.stringify(body) : undefined
        })

      let response = await doFetch()

      // On 401 try one forced token refresh and retry the request
      if (response.status === 401) {
        accessToken = await forceRefreshAccessToken()
        if (!accessToken) {
          return { success: false, status: 401, error: 'Session expired, please log in again' }
        }
        response = await doFetch()
      }

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

// Kimi Code OAuth (Device Authorization Grant) handlers
ipcMain.handle('kimi-oauth-status', async () => {
  return getOAuthStatus()
})

ipcMain.handle('kimi-oauth-login', async () => {
  void startLogin((event) => {
    mainWindow?.webContents.send('kimi-oauth-event', event)
  })
  return { started: true }
})

ipcMain.handle('kimi-oauth-cancel', async () => {
  cancelOngoingLogin()
  return { success: true }
})

ipcMain.handle('kimi-oauth-logout', async () => {
  oauthLogout()
  return { success: true }
})

ipcMain.handle('kimi-oauth-select-model', async (_, modelId: string) => {
  if (typeof modelId !== 'string' || modelId.length === 0) {
    return { success: false, error: 'Invalid model id' }
  }
  return oauthSelectModel(modelId)
})

// Notification handler
ipcMain.handle('show-notification', (_, options: { title: string; body: string }) => {
  if (!isRecord(options) || typeof options.title !== 'string' || typeof options.body !== 'string') {
    return
  }
  if (Notification.isSupported()) {
    new Notification({
      title: options.title,
      body: options.body,
      icon: icon
    }).show()
  }
})

// Clipboard bridge: the sandboxed renderer has no Node clipboard access, so
// reads/writes go through the main process. Formats are restricted to the
// enum; callers ask for exactly one format per call.
ipcMain.handle('clipboard-read', async (_, format: unknown) => {
  if (
    typeof format !== 'string' ||
    !(CLIPBOARD_READ_FORMATS as readonly string[]).includes(format)
  ) {
    return { success: false, error: 'Invalid clipboard format' }
  }
  const value = await readClipboard(format as (typeof CLIPBOARD_READ_FORMATS)[number])
  return { success: true, value }
})

ipcMain.handle('clipboard-write', async (_, format: unknown, value: unknown) => {
  if (
    typeof format !== 'string' ||
    !(CLIPBOARD_WRITE_FORMATS as readonly string[]).includes(format)
  ) {
    return { success: false, error: 'Invalid clipboard format' }
  }
  if (typeof value !== 'string') {
    return { success: false, error: 'Invalid clipboard value' }
  }
  if (format === 'image' && !value.startsWith('data:image/')) {
    return { success: false, error: 'Image value must be a data:image/ URL' }
  }
  const CLIPBOARD_WRITE_MAX_BYTES = 64 * 1024 * 1024
  if (Buffer.byteLength(value, 'utf8') > CLIPBOARD_WRITE_MAX_BYTES) {
    return { success: false, error: 'Clipboard value too large' }
  }
  const written = writeClipboard(format as (typeof CLIPBOARD_WRITE_FORMATS)[number], value)
  if (!written) {
    return { success: false, error: 'Unsupported or invalid clipboard data' }
  }
  return { success: true }
})

// Developer tools
ipcMain.on('open-dev-tools', () => {
  mainWindow?.webContents.openDevTools()
})

/* ---------- WORKSPACE FS GATEWAY + RUN CONSOLE ---------- */

// The workspace root is a user setting; every handler refuses to work
// without it (the renderer shows a "choose folder" prompt in that state).
// Normalized once here: a hand-edited trailing slash or a relative path
// must not break the containment check downstream.
function getWorkspaceRoot(): string {
  const root = loadSettings().workspaceRoot
  if (!root) throw new Error('Workspace folder is not set')
  return resolve(root)
}

// The chat directory is exactly one level under the workspace root.
function resolveChatDir(root: string, chatId: unknown): string {
  if (
    typeof chatId !== 'string' ||
    !/^[^/\\]+$/.test(chatId) ||
    chatId === '.' ||
    chatId === '..'
  ) {
    throw new Error('Invalid chat id')
  }
  return resolveInWorkspace(root, chatId)
}

ipcMain.handle('fs-list', async (_, relDir: unknown) => {
  try {
    if (typeof relDir !== 'string') throw new Error('Invalid path')
    return { success: true, entries: listEntries(getWorkspaceRoot(), relDir) }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('fs-list-recursive', async (_, relDir: unknown) => {
  try {
    if (typeof relDir !== 'string') throw new Error('Invalid path')
    return { success: true, files: listFilesRecursive(getWorkspaceRoot(), relDir) }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('fs-read', async (_, relPath: unknown) => {
  try {
    if (typeof relPath !== 'string') throw new Error('Invalid path')
    return { success: true, content: readTextFile(getWorkspaceRoot(), relPath) }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('fs-write', async (_, relPath: unknown, content: unknown) => {
  try {
    if (typeof relPath !== 'string') throw new Error('Invalid path')
    if (typeof content !== 'string') throw new Error('Invalid content')
    writeTextFile(getWorkspaceRoot(), relPath, content)
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

// Resolve the command for a file: built-in table < run.json (free-form input
// in the run panel is the third, later level). Placeholders are substituted
// here, in main, so the panel shows the exact command that will run.
ipcMain.handle('proc-resolve', async (_, chatId: unknown, relPath: unknown) => {
  try {
    const root = getWorkspaceRoot()
    const chatDir = resolveChatDir(root, chatId)
    if (typeof relPath !== 'string' || relPath.length === 0) throw new Error('Invalid path')
    const absFile = resolveInWorkspace(chatDir, relPath)

    let runJsonText: string | null = null
    try {
      runJsonText = readTextFile(chatDir, 'run.json')
    } catch {
      // no readable run.json — built-in table decides
    }

    const { resolved, runJsonError } = resolveRun({ relPath, runJsonText })
    if (!resolved) {
      return { success: true, resolved: null, runJsonError }
    }

    const base = basename(absFile)
    const ctx = {
      file: absFile,
      dir: dirname(absFile),
      name: base.replace(/\.[^.]+$/, ''),
      base
    }
    const spec = {
      ...resolved.spec,
      command: substitutePlaceholders(resolved.spec.command, ctx),
      ...(resolved.spec.cwd !== undefined
        ? { cwd: substitutePlaceholders(resolved.spec.cwd, ctx) }
        : {})
    }
    return {
      success: true,
      resolved: { ...resolved, spec },
      runJsonError
    }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

const PROC_COMMAND_MAX_LENGTH = 4000
const PROC_ENV_MAX_ENTRIES = 50
const PROC_TIMEOUT_MAX_SEC = 3600

ipcMain.handle('proc-start', async (_, payload: unknown) => {
  try {
    const root = getWorkspaceRoot()
    if (!isRecord(payload)) throw new Error('Invalid payload')
    const chatDir = resolveChatDir(root, payload.chatId)
    if (typeof payload.command !== 'string' || payload.command.trim().length === 0) {
      throw new Error('Empty command')
    }
    if (payload.command.length > PROC_COMMAND_MAX_LENGTH) {
      throw new Error('Command too long')
    }
    if (!fs.existsSync(chatDir) || !fs.statSync(chatDir).isDirectory()) {
      throw new Error('Chat directory does not exist')
    }

    // cwd: default the chat directory; a run.json cwd must stay inside it.
    let cwd = chatDir
    if (payload.cwd !== undefined) {
      if (typeof payload.cwd !== 'string') throw new Error('Invalid cwd')
      cwd = isAbsolute(payload.cwd)
        ? resolve(payload.cwd)
        : resolveInWorkspace(chatDir, payload.cwd)
      if (cwd !== chatDir && !cwd.startsWith(chatDir + sep)) {
        throw new Error('Refused cwd outside the chat directory')
      }
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error('cwd does not exist')
      }
    }

    let env: Record<string, string> | undefined
    if (payload.env !== undefined) {
      if (!isRecord(payload.env)) throw new Error('Invalid env')
      const entries = Object.entries(payload.env)
      if (entries.length > PROC_ENV_MAX_ENTRIES) throw new Error('Too many env entries')
      env = {}
      for (const [key, value] of entries) {
        if (typeof value !== 'string') throw new Error('Invalid env value')
        env[key] = value
      }
    }

    let timeoutSec: number | undefined
    if (payload.timeoutSec !== undefined) {
      if (
        typeof payload.timeoutSec !== 'number' ||
        !Number.isFinite(payload.timeoutSec) ||
        payload.timeoutSec <= 0 ||
        payload.timeoutSec > PROC_TIMEOUT_MAX_SEC
      ) {
        throw new Error('Invalid timeoutSec')
      }
      timeoutSec = payload.timeoutSec
    }

    const id = startProcess({
      command: payload.command,
      cwd,
      env,
      timeoutSec,
      onOutput: (stream, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('proc-output', { id, stream, data })
        }
      },
      onExit: (code, signal) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('proc-exit', { id, code, signal })
        }
      }
    })
    return { success: true, id }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('proc-stop', async (_, id: unknown) => {
  if (typeof id !== 'string') return { success: false, error: 'Invalid id' }
  return { success: stopProcess(id) }
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
  migrateLegacyUserData()
  electronApp.setAppUserModelId('io.github.heni.kimi-dock')

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

  // CRITICAL FIX: Updated CSP to allow Kimi AI web app and Kimi Code API
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    console.log('[CSP] Setting CSP for:', details.url)

    // Define allowed sources
    const defaultSrc =
      "'self' https://kimi.ai https://*.kimi.ai https://kimi.com https://*.kimi.com"
    const scriptSrc =
      "'self' 'unsafe-inline' https://kimi.ai https://*.kimi.ai https://kimi.com https://*.kimi.com"
    const styleSrc =
      "'self' 'unsafe-inline' https://kimi.ai https://*.kimi.ai https://kimi.com https://*.kimi.com"
    const imgSrc = "'self' data: blob: https:"
    const fontSrc = "'self' https://kimi.ai https://*.kimi.ai https://kimi.com https://*.kimi.com"
    const frameSrc = "'self' https://kimi.ai https://kimi.com"

    // connect-src must include the Kimi Code API
    const connectSrc =
      "'self' https://kimi.ai https://*.kimi.ai wss://*.kimi.ai https://kimi.com https://*.kimi.com wss://*.kimi.com https://api.kimi.com"

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

  // (window.open routing is on the main window — see createWindow; popup
  // lifecycle management is global — see the app.on('web-contents-created')
  // handler at module level)

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

app.on('before-quit', () => {
  stopAllProcesses()
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
