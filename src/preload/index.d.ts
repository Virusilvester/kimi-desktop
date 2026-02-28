declare global {
  interface Window {
    electron: {
      process: {
        versions: {
          chrome: string
          node: string
          electron: string
        }
      }
    }
    api: {
      // Window controls
      minimize: () => void
      maximize: () => void
      close: () => void
      restartApp: () => void

      // Window state
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void

      // Navigation
      onNavigateTo: (callback: (path: string) => void) => () => void

      // Settings
      onOpenSettings: (callback: () => void) => () => void

      // App info
      getAppVersion: () => Promise<string>
      checkForUpdates: () => Promise<{ updateAvailable: boolean; version?: string }>

      // File dialogs
      showSaveDialog: (
        options: Electron.SaveDialogOptions
      ) => Promise<Electron.SaveDialogReturnValue>
      showOpenDialog: (
        options: Electron.OpenDialogOptions
      ) => Promise<Electron.OpenDialogReturnValue>

      // Settings management
      getSettings: () => Promise<any>
      saveSettings: (settings: any) => Promise<{ success: boolean }>

      // Data clearing
      clearData: (
        type: 'all' | 'cache' | 'history' | 'cookies'
      ) => Promise<{ success: boolean; error?: string }>

      // Conversation management
      exportConversations: () => Promise<any[]>
      importConversations: (data: any[]) => Promise<{ success: boolean }>

      // CRITICAL FIX: API Proxy - Bypass CSP restrictions
      kimiApiRequest: (requestData: {
        endpoint: string
        apiKey: string
        method: string
        path: string
        body?: any
      }) => Promise<{
        success: boolean
        status?: number
        data?: any
        error?: string
      }>

      // API Key management for Kimi API
      getApiKey: () => Promise<{ apiKey: string; endpoint: string }>
      saveApiKey: (
        apiKey: string,
        endpoint: string
      ) => Promise<{ success: boolean; error?: string }>

      // Notifications
      showNotification: (options: { title: string; body: string }) => Promise<void>

      // Developer tools
      openDevTools: () => void

      // Network
      isOnline: () => boolean

      // Cleanup
      removeAllListeners: (channel: string) => void
    }
  }
}

export {}
