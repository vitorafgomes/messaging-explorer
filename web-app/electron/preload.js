const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Get API secret for authenticated requests
  getApiSecret: () => ipcRenderer.invoke('get-api-secret'),

  // Listen for navigation commands from menu
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, route) => callback(route));
  },

  // Listen for new connection command from menu
  onNewConnection: (callback) => {
    ipcRenderer.on('menu-new-connection', () => callback());
  },

  // Listen for connection change from tray menu
  onChangeConnection: (callback) => {
    ipcRenderer.on('change-connection', (event, connectionId) => callback(connectionId));
  },

  // Listen for clear all data command from menu
  onClearAllData: (callback) => {
    ipcRenderer.on('clear-all-data', () => callback());
  },

  // Listen for developer mode toggle from menu
  onToggleDevMode: (callback) => {
    ipcRenderer.on('toggle-dev-mode', () => callback());
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

  // Platform detection
  platform: process.platform,

  // Check if running in Electron
  isElectron: true
});

// Also expose a simpler 'electron' API for convenience
contextBridge.exposeInMainWorld('electron', {
  on: (channel, callback) => {
    // Whitelist channels for security
    const validChannels = ['navigate', 'menu-new-connection', 'change-connection', 'clear-all-data', 'toggle-dev-mode'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event) => callback());
    }
  },
  platform: process.platform,
  isElectron: true
});

// Log that preload script loaded
console.log('Electron preload script loaded');
