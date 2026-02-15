import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      minimize: () => void
      maximize: () => void
      close: () => void
      restartApp: () => void
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => void
    }
  }
}
