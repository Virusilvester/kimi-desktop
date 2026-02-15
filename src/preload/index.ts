import { contextBridge, ipcRenderer } from 'electron'

// Expose secure API to renderer
contextBridge.exposeInMainWorld('api', {
  isOnline: () => navigator.onLine,
  minimize: () => ipcRenderer.send('minimize'),
  maximize: () => ipcRenderer.send('maximize'),
  close: () => ipcRenderer.send('close'),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window-maximized', (_, value) => callback(value))
  },

  restartApp: () => ipcRenderer.send('restart-app')
})
