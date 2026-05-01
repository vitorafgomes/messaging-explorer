const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const Store = require('electron-store');

// Generate a per-session API secret for Electron <-> .NET API authentication
const API_SECRET = crypto.randomBytes(32).toString('hex');

// Persistent settings store (update channel preference)
const store = new Store({
  defaults: {
    updateChannel: 'latest'
  }
});

let mainWindow;
let splashWindow;
let tray;
let apiProcess;

// Load port config from repo-root config.json; fall back to defaults if missing
function loadPortConfig() {
  const fs = require('fs');
  const candidates = [
    path.join(__dirname, '..', '..', 'config.json'),
    path.join(process.resourcesPath || '', 'config.json'),
    path.join(__dirname, '..', 'config.json')
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed && typeof parsed.apiPort === 'number' && typeof parsed.frontendPort === 'number') {
          console.log(`[loadPortConfig] Loaded config from ${candidate}`);
          return { apiPort: parsed.apiPort, frontendPort: parsed.frontendPort };
        }
      }
    } catch (err) {
      console.warn(`[loadPortConfig] Failed to parse ${candidate}: ${err.message}`);
    }
  }
  console.warn('[loadPortConfig] config.json not found, using defaults 5917/4297');
  return { apiPort: 5917, frontendPort: 4297 };
}

const portConfig = loadPortConfig();
let apiPort = portConfig.apiPort;
const frontendPort = portConfig.frontendPort;

// Use app.isPackaged for reliable detection - NODE_ENV can be unreliable in packaged apps
const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

// Single instance lock - prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[SingleInstance] Another instance is already running - quitting this one');
  // Show notification that another instance is already running
  const { dialog } = require('electron');
  dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Messaging Explorer',
    message: 'Application Already Running',
    detail: 'Messaging Explorer is already running. Please check your system tray or taskbar.',
    buttons: ['OK']
  });
  app.quit();
} else {
  // Handle second instance attempt - focus the existing window
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[SingleInstance] Second instance detected - focusing existing window');
    // Someone tried to run a second instance, we should focus our window
    if (mainWindow) {
      showAndFocusWindow();

      // Show a subtle notification in the app
      if (!mainWindow.isDestroyed()) {
        const { dialog } = require('electron');
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Messaging Explorer',
          message: 'Application Already Running',
          detail: 'Messaging Explorer is already running in this window.',
          buttons: ['OK']
        });
      }
    }
  });
}

// Create native menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Connection',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            showAndFocusWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('navigate', '/connections');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Clear All Data (Testing)',
          accelerator: 'CmdOrCtrl+Shift+Delete',
          click: () => {
            console.log('[Menu] Clear All Data clicked');
            showAndFocusWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('[Menu] Sending clear-all-data message to renderer');
              mainWindow.webContents.send('clear-all-data');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' }] : []),
        {
          label: 'Developer Mode',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('toggle-dev-mode');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Messaging Explorer',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Messaging Explorer',
              detail: `Version ${app.getVersion()}\n\nA universal multi-platform messaging management tool.\n\nBuilt with Angular + Electron + .NET`
            });
          }
        },
      ]
    }
  ];

  // macOS specific menu
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Get the correct assets path for both dev and packaged modes
function getAssetsPath() {
  // Use app.isPackaged which is more reliable than checking NODE_ENV
  if (!app.isPackaged) {
    return path.join(__dirname, '../src/assets');
  }
  // In packaged app, assets are unpacked to app.asar.unpacked/src/assets
  // __dirname in packaged app: /path/to/resources/app.asar/electron
  // We need: /path/to/resources/app.asar.unpacked/src/assets
  const asarPath = __dirname.replace('app.asar', 'app.asar.unpacked');
  return path.join(asarPath, '../src/assets');
}

// Helper function to properly show and focus window on Linux
function showAndFocusWindow() {
  console.log('[showAndFocusWindow] Called, mainWindow exists:', !!mainWindow, 'destroyed:', mainWindow?.isDestroyed());

  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('[showAndFocusWindow] Creating new window');
    createWindow();
    return;
  }

  console.log('[showAndFocusWindow] Window state - visible:', mainWindow.isVisible(), 'minimized:', mainWindow.isMinimized());

  // If window is already visible and not minimized, just focus it
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    console.log('[showAndFocusWindow] Window is already visible, just focusing');
    mainWindow.focus();
    return;
  }

  // Otherwise, show and focus the window
  forceShowWindow();
}

function forceShowWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  console.log('[forceShowWindow] Forcing window to show');

  // Restore window state
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  // Show window
  mainWindow.show();

  // Move to center to ensure it's on screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowBounds = mainWindow.getBounds();

  mainWindow.setBounds({
    x: Math.floor((width - windowBounds.width) / 2),
    y: Math.floor((height - windowBounds.height) / 2),
    width: windowBounds.width,
    height: windowBounds.height
  });

  // Force to top with multiple techniques
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.moveTop();

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.focus();
      console.log('[forceShowWindow] Final state - visible:', mainWindow.isVisible(), 'focused:', mainWindow.isFocused());
    }
  }, 300);
}

// Create system tray
function createTray() {
  const assetsPath = getAssetsPath();
  // Use tray-icon.png for better tray visibility, fallback to icon.png
  let iconPath = path.join(assetsPath, 'tray-icon.png');

  const fs = require('fs');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(assetsPath, 'icon.png');
  }

  console.log('Tray icon path:', iconPath);
  console.log('Icon exists:', fs.existsSync(iconPath));

  // Create a simple icon if the file doesn't exist
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      console.log('Tray icon is empty, trying alternative paths...');
      // Try alternative path for packaged app
      const altPath = path.join(process.resourcesPath || __dirname, 'app', 'src', 'assets', 'tray-icon.png');
      console.log('Trying alternative path:', altPath);
      if (fs.existsSync(altPath)) {
        trayIcon = nativeImage.createFromPath(altPath);
      }
      if (trayIcon.isEmpty()) {
        trayIcon = nativeImage.createEmpty();
      }
    }
  } catch (e) {
    console.error('Error loading tray icon:', e);
    trayIcon = nativeImage.createEmpty();
  }

  // Resize for tray (16x16 or 22x22 depending on platform)
  const traySize = process.platform === 'darwin' ? 16 : 22;
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: traySize, height: traySize });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Messaging Explorer');

  // Initialize menu with connections
  updateTrayMenu();

  tray.on('click', () => {
    // Show App behavior: only show/focus the window, never hide it
    if (mainWindow && !mainWindow.isDestroyed()) {
      showAndFocusWindow();
    } else {
      createWindow();
    }
  });
}

// Helper function to fetch data from API
async function fetchFromAPI(endpoint) {
  return new Promise((resolve) => {
    const http = require('http');

    const req = http.get(`http://localhost:${apiPort}/api/${endpoint}`, {
      headers: { 'X-Api-Key': API_SECRET }
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            console.error(`Failed to fetch ${endpoint}:`, res.statusCode);
            resolve([]);
          }
        } catch (error) {
          console.error(`Error parsing ${endpoint}:`, error);
          resolve([]);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`Error fetching ${endpoint}:`, error);
      resolve([]);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      console.error(`Request timeout fetching ${endpoint}`);
      resolve([]);
    });
  });
}

// Fetch connections from API
async function fetchConnections() {
  return fetchFromAPI('connections');
}

// Fetch connection groups from API
async function fetchConnectionGroups() {
  return fetchFromAPI('connectiongroups');
}

// Build hierarchical tree structure (same logic as Angular service)
function buildGroupTree(groups, connections) {
  const clients = groups.filter(g => g.type === 'client').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const environments = groups.filter(g => g.type === 'environment');

  return clients.map(client => {
    const clientEnvironments = environments
      .filter(env => env.parentId === client.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const children = clientEnvironments.map(env => ({
      group: env,
      connections: connections.filter(c => c.environmentId === env.id)
    }));

    const ungroupedConnections = connections.filter(
      c => c.clientId === client.id && !c.environmentId
    );

    return {
      group: client,
      children,
      connections: ungroupedConnections
    };
  });
}

// Get ungrouped connections (no client, no environment)
function getUngroupedConnections(connections) {
  return connections.filter(c => !c.clientId && !c.environmentId);
}

// Get active connection from renderer
let activeConnectionId = null;

// Build connection menu item
function buildConnectionMenuItem(connection) {
  return {
    label: connection.name || connection.connectionString?.substring(0, 40) + '...',
    type: 'radio',
    checked: connection.id === activeConnectionId,
    click: () => {
      activeConnectionId = connection.id;
      if (mainWindow && !mainWindow.isDestroyed()) {
        showAndFocusWindow();
        mainWindow.webContents.send('change-connection', connection.id);
        // Navigate to entities view after connection change
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('navigate', '/entities');
          }
        }, 100);
      }
      updateTrayMenu(); // Refresh menu to update checkmarks
    }
  };
}

// Build hierarchical connection menu
async function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const connections = await fetchConnections();
  const groups = await fetchConnectionGroups();

  let connectionSubmenu = [];

  if (connections.length === 0) {
    connectionSubmenu = [{ label: 'No connections available', enabled: false }];
  } else {
    // Build tree structure
    const tree = buildGroupTree(groups, connections);
    const ungrouped = getUngroupedConnections(connections);

    // Add grouped connections
    tree.forEach(clientNode => {
      const clientSubmenu = [];

      // Add environments under client
      clientNode.children.forEach(envNode => {
        if (envNode.connections.length > 0) {
          clientSubmenu.push({
            label: envNode.group.name,
            submenu: envNode.connections.map(buildConnectionMenuItem)
          });
        } else {
          clientSubmenu.push({
            label: envNode.group.name,
            submenu: [{ label: 'No connections', enabled: false }]
          });
        }
      });

      // Add ungrouped connections directly under client
      if (clientNode.connections.length > 0) {
        if (clientSubmenu.length > 0) {
          clientSubmenu.push({ type: 'separator' });
        }
        clientNode.connections.forEach(conn => {
          clientSubmenu.push(buildConnectionMenuItem(conn));
        });
      }

      // Add client to main menu
      if (clientSubmenu.length > 0) {
        connectionSubmenu.push({
          label: clientNode.group.name,
          submenu: clientSubmenu
        });
      }
    });

    // Add ungrouped connections at root level
    if (ungrouped.length > 0) {
      if (connectionSubmenu.length > 0) {
        connectionSubmenu.push({ type: 'separator' });
      }
      ungrouped.forEach(conn => {
        connectionSubmenu.push(buildConnectionMenuItem(conn));
      });
    }

    // If no items were added, show message
    if (connectionSubmenu.length === 0) {
      connectionSubmenu = [{ label: 'No connections available', enabled: false }];
    }
  }

  // Build Connections submenu with hierarchy
  const connectionsMenu = [
    {
      label: 'Manage Connections...',
      click: () => {
        showAndFocusWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('navigate', '/connections');
        }
      }
    }
  ];

  // Add separator if there are connections
  if (connectionSubmenu.length > 0 && connectionSubmenu[0].label !== 'No connections available') {
    connectionsMenu.push({ type: 'separator' });
    connectionsMenu.push(...connectionSubmenu);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        showAndFocusWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Connections',
      submenu: connectionsMenu
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// Create splash screen
function createSplashScreen() {
  splashWindow = new BrowserWindow({
    width: 450,
    height: 450,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'), {
    query: { version: app.getVersion() }
  });
  splashWindow.center();

  // Disable window highlighting on Linux
  if (process.platform === 'linux') {
    splashWindow.setSkipTaskbar(true);
    splashWindow.setFocusable(false);
  }
}

// Get platform-specific window configuration options
function getPlatformWindowOptions() {
  switch (process.platform) {
    case 'darwin':
      // macOS - Hidden inset title bar with vibrancy effects
      return {
        titleBarStyle: 'hiddenInset',
        vibrancy: 'sidebar',
        trafficLightPosition: { x: 15, y: 15 }
      };
    case 'linux':
      // Linux - Use native frame decorations (compositor handles rounded corners)
      return {
        frame: true
      };
    case 'win32':
    default:
      // Windows - Native frame (Windows 11 auto-applies rounded corners)
      return {
        frame: true
      };
  }
}

function createWindow() {
  // Build base window options
  const baseOptions = {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(getAssetsPath(), 'icon.png'),
    title: 'Messaging Explorer',
    backgroundColor: '#4A90E2'
  };

  // Merge with platform-specific options
  const windowOptions = {
    ...baseOptions,
    ...getPlatformWindowOptions()
  };

  mainWindow = new BrowserWindow(windowOptions);

  // Content Security Policy
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Skip CSP for file:// protocol — 'self' doesn't work reliably with ASAR archives
    if (details.url.startsWith('file://')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http://localhost:*; img-src 'self' data:;"
        ]
      }
    });
  });

  // Create native menu
  createMenu();

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${frontendPort}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/web-app/browser/index.html'));
  }

  // Show main window when ready and close splash
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, isDev ? 500 : 1500);
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    console.log('Close event triggered, app.isQuitting:', app.isQuitting);
    if (!app.isQuitting) {
      event.preventDefault();
      // On Linux, minimize instead of hide - works better with window managers
      if (process.platform === 'linux') {
        mainWindow.minimize();
        // Hide from taskbar after minimizing
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setSkipTaskbar(true);
          }
        }, 100);
      } else {
        mainWindow.hide();
      }
      console.log('Window minimized/hidden, isVisible:', mainWindow.isVisible());
      return false;
    }
    return true;
  });

  mainWindow.on('closed', () => {
    console.log('Window closed event - setting mainWindow to null');
    mainWindow = null;
  });

  // Log when window is hidden/shown
  mainWindow.on('hide', () => {
    console.log('Window hide event fired');
  });

  mainWindow.on('show', () => {
    console.log('Window show event fired');
  });
}

function getApiPath() {
  if (isDev) {
    console.log('[getApiPath] Running in development mode - API should be started separately');
    return null;
  }

  // Try multiple possible paths for the API
  const possiblePaths = [
    path.join(process.resourcesPath, 'api'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'api'),
    path.join(__dirname, '..', 'resources', 'api'),
    path.join(__dirname, '..', '..', 'src', 'ServiceBusExplorer.Api', 'bin', 'Release', 'net10.0', 'publish')
  ];

  console.log('[getApiPath] process.resourcesPath:', process.resourcesPath);
  console.log('[getApiPath] __dirname:', __dirname);
  console.log('[getApiPath] Checking possible API paths...');

  const fs = require('fs');
  const exeName = process.platform === 'win32' ? 'ServiceBusExplorer.Api.exe' : 'ServiceBusExplorer.Api';
  for (const apiPath of possiblePaths) {
    console.log(`[getApiPath] Checking: ${apiPath}`);
    const executablePath = path.join(apiPath, exeName);
    if (fs.existsSync(executablePath)) {
      console.log(`[getApiPath] ✅ Found API at: ${apiPath}`);
      return apiPath;
    }
  }

  console.error('[getApiPath] ❌ API not found in any expected location');
  return null;
}

function startApi() {
  const fs = require('fs');
  const userDataPath = app.getPath('userData');
  const serviceBusDataPath = path.join(userDataPath, 'data');
  if (!fs.existsSync(serviceBusDataPath)) {
    fs.mkdirSync(serviceBusDataPath, { recursive: true });
  }

  if (isDev) {
    console.log('[startApi] Development mode: spawning dotnet run on port', apiPort);
    const apiProjectDir = path.resolve(__dirname, '..', '..', 'src', 'ServiceBusExplorer.Api');
    try {
      apiProcess = spawn('dotnet', ['run', '--no-launch-profile'], {
        cwd: apiProjectDir,
        env: {
          ...process.env,
          ASPNETCORE_URLS: `http://localhost:${apiPort}`,
          ASPNETCORE_ENVIRONMENT: 'Development',
          SERVICEBUS_DATA_PATH: serviceBusDataPath,
          DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
          API_SECRET: API_SECRET
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      console.log(`[startApi] ✅ Dev API process spawned with PID: ${apiProcess.pid}`);
      apiProcess.stdout.on('data', (d) => console.log(`[API] ${d.toString().trim()}`));
      apiProcess.stderr.on('data', (d) => console.error(`[API ERROR] ${d.toString().trim()}`));
      apiProcess.on('exit', (code, signal) => {
        console.log(`[startApi] Dev API exited code=${code} signal=${signal}`);
      });
    } catch (err) {
      console.error('[startApi] ❌ Failed to spawn dev API:', err.message);
    }
    return;
  }

  console.log('[startApi] Starting API in production mode on port', apiPort);

  const apiPath = getApiPath();
  if (!apiPath) {
    console.error('[startApi] ❌ API path not found - API will not start');
    return;
  }

  let executable;
  if (process.platform === 'win32') {
    executable = path.join(apiPath, 'ServiceBusExplorer.Api.exe');
  } else {
    executable = path.join(apiPath, 'ServiceBusExplorer.Api');
  }

  // Check if executable exists
  if (!fs.existsSync(executable)) {
    console.error(`[startApi] ❌ Executable not found at: ${executable}`);
    return;
  }

  // Check if executable has execute permissions
  try {
    fs.accessSync(executable, fs.constants.X_OK);
    console.log('[startApi] ✅ Executable has execute permissions');
  } catch (err) {
    console.error('[startApi] ❌ Executable does not have execute permissions, attempting to fix...');
    try {
      fs.chmodSync(executable, 0o755);
      console.log('[startApi] ✅ Fixed execute permissions');
    } catch (chmodErr) {
      console.error('[startApi] ❌ Failed to fix permissions:', chmodErr.message);
      return;
    }
  }

  console.log(`[startApi] Starting API executable: ${executable}`);
  console.log(`[startApi] Working directory: ${apiPath}`);
  console.log(`[startApi] Data path: ${serviceBusDataPath}`);

  try {
    apiProcess = spawn(executable, [], {
      cwd: apiPath,
      env: {
        ...process.env,
        ASPNETCORE_URLS: `http://localhost:${apiPort}`,
        SERVICEBUS_DATA_PATH: serviceBusDataPath,
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', // Helps with some Linux environments
        API_SECRET: API_SECRET
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    console.log(`[startApi] ✅ API process spawned with PID: ${apiProcess.pid}`);

    apiProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      console.log(`[API] ${message}`);
    });

    apiProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      console.error(`[API ERROR] ${message}`);
    });

    apiProcess.on('error', (err) => {
      console.error(`[startApi] ❌ Failed to start API process: ${err.message}`);
      console.error('[startApi] Error details:', err);
    });

    apiProcess.on('exit', (code, signal) => {
      console.log(`[startApi] API process exited with code ${code} and signal ${signal}`);
      if (code !== 0 && code !== null) {
        console.error('[startApi] API crashed or exited unexpectedly');
      }
    });
  } catch (err) {
    console.error('[startApi] ❌ Exception while spawning API:', err.message);
    console.error('[startApi] Stack trace:', err.stack);
  }

}

app.whenReady().then(() => {
  createSplashScreen();
  startApi();
  createTray();

  // Small delay to show splash screen
  setTimeout(() => {
    createWindow();
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      showAndFocusWindow();
    }
  });
});

// Quit properly
app.on('before-quit', () => {
  app.isQuitting = true;
  if (apiProcess && !apiProcess.killed) {
    console.log('[beforeQuit] Terminating API process with PID:', apiProcess.pid);
    apiProcess.kill('SIGTERM');
    // Force kill after 5 seconds if process doesn't exit gracefully
    setTimeout(() => {
      if (apiProcess && !apiProcess.killed) {
        console.log('[beforeQuit] Forcing API process termination with SIGKILL');
        apiProcess.kill('SIGKILL');
      }
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  // On Linux, quit the app when all windows are closed
  // On macOS, keep the app in the tray (standard macOS behavior)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle IPC messages from renderer
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-api-secret', () => API_SECRET);

ipcMain.handle('get-api-port', () => apiPort);

// === Auto Updater ===
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.channel = store.get('updateChannel', 'latest');

function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...data });
  }
}

autoUpdater.on('checking-for-update', () => {
  console.log('[Updater] Checking for updates...');
  sendUpdateStatus('checking');
});

autoUpdater.on('update-available', (info) => {
  console.log('[Updater] Update available:', info.version);
  sendUpdateStatus('available', { version: info.version, releaseNotes: info.releaseNotes });
});

autoUpdater.on('update-not-available', () => {
  console.log('[Updater] No updates available');
  sendUpdateStatus('up-to-date');
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
  sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Updater] Update downloaded:', info.version);
  sendUpdateStatus('downloaded', { version: info.version });
});

autoUpdater.on('error', (err) => {
  console.error('[Updater] Error:', err.message);
  sendUpdateStatus('error', { message: err.message });
});

// IPC: Check for updates
ipcMain.handle('check-for-updates', async () => {
  if (isDev) return { status: 'dev-mode' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'ok', version: result?.updateInfo?.version };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

// IPC: Download update
ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

// IPC: Install update (restart)
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// IPC: Set update channel (latest or beta)
ipcMain.handle('set-update-channel', (event, channel) => {
  store.set('updateChannel', channel);
  autoUpdater.channel = channel;
  console.log(`[Updater] Channel changed to: ${channel}`);
  return { status: 'ok', channel };
});

// IPC: Get current update channel
ipcMain.handle('get-update-channel', () => {
  return store.get('updateChannel', 'latest');
});

// Check for updates shortly after launch and then on a fixed interval so
// long-running sessions (the app is often left open all day) still pick up
// new releases without requiring a restart.
const UPDATE_CHECK_INITIAL_DELAY_MS = 5_000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function scheduleUpdateChecks() {
  if (isDev) return;
  const runCheck = () => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('[Updater] Auto-check failed (offline?):', err.message);
    });
  };
  setTimeout(runCheck, UPDATE_CHECK_INITIAL_DELAY_MS);
  setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(scheduleUpdateChecks);

// Handle active connection updates from renderer
ipcMain.on('set-active-connection', (event, connectionId) => {
  console.log('Active connection changed to:', connectionId);
  activeConnectionId = connectionId;
  updateTrayMenu();
});

// Handle connection list updates
ipcMain.on('connections-updated', () => {
  console.log('Connections list updated, refreshing tray menu');
  updateTrayMenu();
});
