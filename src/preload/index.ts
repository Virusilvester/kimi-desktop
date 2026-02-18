import { contextBridge, ipcRenderer } from 'electron'

// Expose secure API to renderer
contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('minimize'),
  maximize: () => ipcRenderer.send('maximize'),
  close: () => ipcRenderer.send('close'),
  restartApp: () => ipcRenderer.send('restart-app'),

  // Window state
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window-maximized', (_, value) => callback(value))
  },

  // Navigation (for deep linking)
  onNavigateTo: (callback: (path: string) => void) => {
    ipcRenderer.on('navigate-to', (_, path) => callback(path))
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // File dialogs
  showSaveDialog: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('show-save-dialog', options),

  // Network status (renderer can use navigator.onLine, but this is for consistency)
  isOnline: () => navigator.onLine,

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

// Expose electron API for toolkit
contextBridge.exposeInMainWorld('electron', {
  process: {
    versions: {
      chrome: process.versions.chrome,
      node: process.versions.node,
      electron: process.versions.electron
    }
  }
})
