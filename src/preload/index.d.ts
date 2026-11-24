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

      // Auth popup finished (login redirect returned to the app origin)
      onAuthPopupFinished: (callback: () => void) => () => void

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
      saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>
      // Fired by main after every successful save-settings (any origin:
      // Settings modal, title bar toggle, e2e)
      onSettingsChanged: (callback: (settings: any) => void) => () => void

      // Data clearing
      clearData: (
        type: 'all' | 'cache' | 'history' | 'cookies'
      ) => Promise<{ success: boolean; error?: string }>

      // Conversation management
      exportConversations: () => Promise<any[]>
      importConversations: (data: any[]) => Promise<{ success: boolean; error?: string }>

      // CRITICAL FIX: API Proxy - Bypass CSP restrictions (Kimi Code OAuth session)
      kimiApiRequest: (requestData: { method: string; path: string; body?: any }) => Promise<{
        success: boolean
        status?: number
        data?: any
        error?: string | null
      }>

      // Kimi Code OAuth (Device Authorization Grant)
      oauthStatus: () => Promise<{
        loggedIn: boolean
        expiresAt?: number
        models: Array<{ id: string; display_name: string | null; context_length: number }>
        selectedModel: string | null
      }>
      oauthLogin: () => Promise<{ started: boolean }>
      oauthCancel: () => Promise<{ success: boolean }>
      oauthLogout: () => Promise<{ success: boolean }>
      oauthSelectModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
      onOAuthEvent: (
        callback: (event: {
          type: 'verification_url' | 'waiting' | 'success' | 'error'
          message: string
          data?: Record<string, unknown>
        }) => void
      ) => () => void

      // Notifications
      showNotification: (options: { title: string; body: string }) => Promise<void>

      // Developer tools
      openDevTools: () => void

      // Network
      isOnline: () => boolean

      // Clipboard bridge (main-process Electron clipboard)
      clipboardRead: (
        format: 'text' | 'html' | 'rich-text' | 'image'
      ) => Promise<{ success: boolean; value?: string | null; error?: string }>
      clipboardWrite: (
        format: 'text' | 'html' | 'image',
        value: string
      ) => Promise<{ success: boolean; error?: string }>

      // Workspace FS gateway (paths relative to the workspace root)
      fsList: (relDir: string) => Promise<{
        success: boolean
        entries?: Array<{ name: string; isDirectory: boolean; size: number; mtimeMs: number }>
        error?: string
      }>
      fsListRecursive: (relDir: string) => Promise<{
        success: boolean
        files?: Array<{ path: string; size: number; mtimeMs: number }>
        error?: string
      }>
      fsRead: (relPath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      fsWrite: (relPath: string, content: string) => Promise<{ success: boolean; error?: string }>

      // Run console (tier 1)
      procResolve: (
        chatId: string,
        relPath: string
      ) => Promise<{
        success: boolean
        resolved?: {
          spec: {
            command: string
            env?: Record<string, string>
            cwd?: string
            timeoutSec?: number
          }
          source: 'builtin' | 'run-json'
          matchedGlob?: string
          hint?: string
        } | null
        runJsonError?: string
        error?: string
      }>
      procStart: (payload: {
        chatId: string
        command: string
        env?: Record<string, string>
        cwd?: string
        timeoutSec?: number
      }) => Promise<{ success: boolean; id?: string; error?: string }>
      procStop: (id: string) => Promise<{ success: boolean }>
      onProcOutput: (
        callback: (event: { id: string; stream: 'stdout' | 'stderr'; data: string }) => void
      ) => () => void
      onProcExit: (
        callback: (event: { id: string; code: number | null; signal: string | null }) => void
      ) => () => void
    }
  }
}

export {}
