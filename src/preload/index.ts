import { contextBridge, ipcRenderer } from 'electron'

// NOTE: In sandboxed preload scripts, external packages like @electron-toolkit/preload
// cannot be used via require/import. They must be bundled into the script.
// This standalone version only uses Electron built-in modules.

// Expose secure API to renderer
contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('minimize'),
  maximize: () => ipcRenderer.send('maximize'),
  close: () => ipcRenderer.send('close'),
  restartApp: () => ipcRenderer.send('restart-app'),

  // Window state
  onMaximizeChange: (callback) => {
    const listener = (_, value) => callback(value)
    ipcRenderer.on('window-maximized', listener)
    return () => ipcRenderer.removeListener('window-maximized', listener)
  },

  // Navigation (for deep linking)
  onNavigateTo: (callback) => {
    const listener = (_, path) => callback(path)
    ipcRenderer.on('navigate-to', listener)
    return () => ipcRenderer.removeListener('navigate-to', listener)
  },

  // Open settings
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => ipcRenderer.removeListener('open-settings', listener)
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // File dialogs
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // Settings management
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Data clearing
  clearData: (type) => ipcRenderer.invoke('clear-data', type),

  // Conversation management
  exportConversations: () => ipcRenderer.invoke('export-conversations'),
  importConversations: (data) => ipcRenderer.invoke('import-conversations', data),

  // API Key management for offline mode
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  saveApiKey: (apiKey, endpoint) => ipcRenderer.invoke('save-api-key', apiKey, endpoint),

  // Notifications
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),

  // Developer tools
  openDevTools: () => ipcRenderer.send('open-dev-tools'),

  // Network status (renderer can use navigator.onLine, but this is for consistency)
  isOnline: () => navigator.onLine,

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

// Expose electron versions (safe info)
contextBridge.exposeInMainWorld('electron', {
  process: {
    versions: {
      chrome: process.versions.chrome,
      node: process.versions.node,
      electron: process.versions.electron
    }
  }
})

// Log that preload script loaded successfully
console.log('[Preload] Script loaded successfully')
