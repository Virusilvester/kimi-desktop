import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  dialog,
  session
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Window state management
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuiting = false

// Default window state
const defaultWindowState: WindowState = {
  width: 1200,
  height: 800,
  isMaximized: false
}

function getWindowState(): WindowState {
  try {
    const state = require('electron-store')?.get('windowState') || defaultWindowState
    return { ...defaultWindowState, ...state }
  } catch {
    return defaultWindowState
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
  try {
    const Store = require('electron-store')
    new Store().set('windowState', state)
  } catch {
    // Store not available
  }
}

function createWindow(): void {
  const windowState = getWindowState()

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
    show: false, // Don't show until ready
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  /* ---------- WINDOW EVENTS ---------- */

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('close', (event) => {
    if (!isQuiting && process.platform === 'darwin') {
      event.preventDefault()
      mainWindow?.hide()
    } else {
      saveWindowState()
    }
  })

  mainWindow.on('resize', () => {
    if (!mainWindow?.isMaximized()) {
      saveWindowState()
    }
  })

  mainWindow.on('move', () => {
    if (!mainWindow?.isMaximized()) {
      saveWindowState()
    }
  })

  // Maximize state events
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized', false)
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Security: Prevent new windows
  mainWindow.webContents.on('new-window', (event) => {
    event.preventDefault()
  })

  /* ---------- LOAD URL ---------- */

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

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

ipcMain.on('minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on('close', () => {
  if (process.platform === 'darwin') {
    mainWindow?.hide()
  } else {
    mainWindow?.close()
  }
})

ipcMain.on('restart-app', () => {
  app.relaunch()
  app.exit(0)
})

// Check for updates (placeholder - integrate with electron-updater)
ipcMain.handle('check-for-updates', async () => {
  // TODO: Implement with electron-updater
  return { updateAvailable: false }
})

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

// Show save dialog for downloads
ipcMain.handle('show-save-dialog', async (_, options) => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, options)
  return result
})

// Handle protocol URLs (deep linking)
app.on('open-url', (_, url) => {
  if (url.startsWith('kimi://')) {
    const path = url.replace('kimi://', '')
    mainWindow?.webContents.send('navigate-to', path)
    mainWindow?.show()
  }
})

/* ---------- APP READY ---------- */

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.kimi.desktop')

  // Set up protocol handler
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('kimi', process.execPath, [process.argv[1]])
    }
  } else {
    app.setAsDefaultProtocolClient('kimi')
  }

  // Security: Set CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' https://kimi.com https://*.kimi.com; script-src 'self' 'unsafe-inline' https://kimi.com; style-src 'self' 'unsafe-inline' https://kimi.com; img-src 'self' data: https: blob:; connect-src 'self' https://kimi.com https://*.kimi.com; frame-src 'self' https://kimi.com;"
        ]
      }
    })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()

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

// Auto-updater events (when integrated)
// autoUpdater.on('update-available', () => {
//   mainWindow?.webContents.send('update-available')
// })
