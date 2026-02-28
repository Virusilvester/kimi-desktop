import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// Expose secure API to renderer
contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: (): void => ipcRenderer.send('minimize'),
  maximize: (): void => ipcRenderer.send('maximize'),
  close: (): void => ipcRenderer.send('close'),
  restartApp: (): void => ipcRenderer.send('restart-app'),

  // Window state
  onMaximizeChange: (callback: (value: boolean) => void): (() => void) => {
    const listener: (event: IpcRendererEvent, value: boolean) => void = (_, value) =>
      callback(value)
    ipcRenderer.on('window-maximized', listener)
    return () => ipcRenderer.removeListener('window-maximized', listener)
  },

  // Navigation (for deep linking)
  onNavigateTo: (callback: (path: string) => void): (() => void) => {
    const listener: (event: IpcRendererEvent, path: string) => void = (_, path) => callback(path)
    ipcRenderer.on('navigate-to', listener)
    return () => ipcRenderer.removeListener('navigate-to', listener)
  },

  // Open settings
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener: () => void = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => ipcRenderer.removeListener('open-settings', listener)
  },

  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke('check-for-updates'),

  // File dialogs
  showSaveDialog: (options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> =>
    ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> =>
    ipcRenderer.invoke('show-open-dialog', options),

  // Settings management
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: unknown): Promise<unknown> =>
    ipcRenderer.invoke('save-settings', settings),

  // Data clearing
  clearData: (type: string): Promise<unknown> => ipcRenderer.invoke('clear-data', type),

  // Conversation management
  exportConversations: (): Promise<unknown> => ipcRenderer.invoke('export-conversations'),
  importConversations: (data: unknown): Promise<unknown> =>
    ipcRenderer.invoke('import-conversations', data),

  // CRITICAL FIX: API Proxy - Bypass CSP by making requests in main process
  kimiApiRequest: (requestData: unknown): Promise<unknown> =>
    ipcRenderer.invoke('kimi-api-request', requestData),

  // API Key management for offline mode
  getApiKey: (): Promise<unknown> => ipcRenderer.invoke('get-api-key'),
  saveApiKey: (apiKey: string, endpoint: string): Promise<unknown> =>
    ipcRenderer.invoke('save-api-key', apiKey, endpoint),

  // Notifications
  showNotification: (options: Electron.NotificationConstructorOptions): Promise<unknown> =>
    ipcRenderer.invoke('show-notification', options),

  // Developer tools
  openDevTools: (): void => ipcRenderer.send('open-dev-tools'),

  // Network status (renderer can use navigator.onLine, but this is for consistency)
  isOnline: (): boolean => navigator.onLine,

  // Remove listeners
  removeAllListeners: (channel: string): void => {
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
