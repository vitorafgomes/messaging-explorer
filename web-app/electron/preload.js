const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Get API secret for authenticated requests
  getApiSecret: () => ipcRenderer.invoke('get-api-secret'),

  // Get the dynamically-allocated API port from the Electron main process
  getApiPort: () => ipcRenderer.invoke('get-api-port'),

  // Listen for navigation commands from the tray menu
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, route) => callback(route));
  },

  // Listen for connection change from tray menu
  onChangeConnection: (callback) => {
    ipcRenderer.on('change-connection', (event, connectionId) => callback(connectionId));
  },

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },

  // Update channels (stable / beta)
  setUpdateChannel: (channel) => ipcRenderer.invoke('set-update-channel', channel),
  getUpdateChannel: () => ipcRenderer.invoke('get-update-channel'),

  // Why this package cannot update itself, or null
  getSelfUpdateBlocker: () => ipcRenderer.invoke('get-self-update-blocker'),

  // Platform detection
  platform: process.platform,

  // Check if running in Electron
  isElectron: true
});

// Log that preload script loaded
console.log('Electron preload script loaded');
