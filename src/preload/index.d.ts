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
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => void

      // Navigation
      onNavigateTo: (callback: (path: string) => void) => void

      // App info
      getAppVersion: () => Promise<string>
      checkForUpdates: () => Promise<{ updateAvailable: boolean }>

      // File dialogs
      showSaveDialog: (
        options: Electron.SaveDialogOptions
      ) => Promise<Electron.SaveDialogReturnValue>

      // Network
      isOnline: () => boolean

      // Cleanup
      removeAllListeners: (channel: string) => void
    }
  }
}

export {}
