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
  downloadUpdate: (agreed, version) => ipcRenderer.invoke('download-update', { agreed: agreed === true, version }),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },

  // Update channels (stable / beta)
  setUpdateChannel: (channel) => ipcRenderer.invoke('set-update-channel', channel),
  getUpdateChannel: () => ipcRenderer.invoke('get-update-channel'),

  // The versions of the chosen channel; takes no argument, so the page cannot name an address or a repository
  listUpdateVersions: () => ipcRenderer.invoke('list-update-versions'),
  installUpdateVersion: (version, agreed) => ipcRenderer.invoke('install-update-version', { version, agreed }),

  // Why this package cannot update itself, or null
  getSelfUpdateBlocker: () => ipcRenderer.invoke('get-self-update-blocker'),

  // The data file of the app, and showing it in the file manager; neither takes an argument
  getDataFile: () => ipcRenderer.invoke('get-data-file'),
  showDataFile: () => ipcRenderer.invoke('show-data-file'),
  saveExportFile: (name, content) => ipcRenderer.invoke('save-export-file', { name, content }),

  // The lines the desktop app logged after an id, and forgetting them; the page names no file and no process
  getShellLogs: (after) => ipcRenderer.invoke('get-shell-logs', Number.isFinite(after) ? after : 0),
  clearShellLogs: () => ipcRenderer.invoke('clear-shell-logs'),

  // Opens the developer tools of this window; takes no argument, so the page cannot choose another
  openDevTools: () => ipcRenderer.invoke('open-dev-tools'),

  // Platform detection
  platform: process.platform,

  // Check if running in Electron
  isElectron: true
});

// Log that preload script loaded
console.log('Electron preload script loaded');
