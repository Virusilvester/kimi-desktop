import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose secure API to renderer
contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('minimize'),
  maximize: () => ipcRenderer.send('maximize'),
  close: () => ipcRenderer.send('close'),
  restartApp: () => ipcRenderer.send('restart-app'),

  // Window state
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, value: boolean): void => callback(value)
    ipcRenderer.on('window-maximized', listener)
    return () => ipcRenderer.removeListener('window-maximized', listener)
  },

  // Navigation (for deep linking)
  onNavigateTo: (callback: (path: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('navigate-to', listener)
    return () => ipcRenderer.removeListener('navigate-to', listener)
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
  ...electronAPI,
  process: {
    versions: {
      chrome: process.versions.chrome,
      node: process.versions.node,
      electron: process.versions.electron
    }
  }
})
