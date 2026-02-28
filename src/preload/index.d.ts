import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI & {
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
      saveSettings: (settings: any) => Promise<void>

      // Data clearing
      clearData: (type: 'all' | 'cache' | 'history' | 'cookies') => Promise<void>

      // Conversation management
      exportConversations: () => Promise<any[]>
      importConversations: (data: any[]) => Promise<void>

      // Notifications
      showNotification: (options: { title: string; body: string }) => Promise<void>

      // Auto-updater
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<void>
      onUpdateAvailable: (callback: () => void) => () => void

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
