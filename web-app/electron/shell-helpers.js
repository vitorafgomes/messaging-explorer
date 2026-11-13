const UPDATE_CHANNELS = ['latest', 'beta'];

/** True only for a parseable http: or https: URL. */
function isSafeExternalUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Returns 'latest' or 'beta' for exactly those strings, otherwise null. */
function normalizeUpdateChannel(channel) {
  return UPDATE_CHANNELS.includes(channel) ? channel : null;
}

/** Sets the updater channel, looks at prereleases only on beta, and never allows a downgrade. */
function applyUpdateChannel(updater, channel) {
  updater.channel = channel;
  updater.allowPrerelease = channel === 'beta';
  updater.allowDowngrade = false;
}

function delay(ms) {
  let timer;
  const promise = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Polls fetchFn(url) until a response with ok === true. Resolves { healthy: true },
 * { healthy: false, reason: 'exited' } once hasExited() is true, or
 * { healthy: false, reason: 'timeout' } after timeoutMs. A rejected fetch counts as not yet.
 */
async function waitForHealth({ url, timeoutMs, intervalMs, fetchFn, hasExited }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (hasExited()) return { healthy: false, reason: 'exited' };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { healthy: false, reason: 'timeout' };

    const limit = delay(remaining);
    const attempt = Promise.resolve()
      .then(() => fetchFn(url))
      .then((response) => response?.ok === true, () => false);
    const healthy = await Promise.race([attempt, limit.promise.then(() => false)]);
    limit.cancel();
    if (healthy) return { healthy: true };

    if (hasExited()) return { healthy: false, reason: 'exited' };
    if (Date.now() >= deadline) return { healthy: false, reason: 'timeout' };
    const pause = delay(Math.min(intervalMs, deadline - Date.now()));
    await pause.promise;
  }
}

/**
 * Sends SIGTERM, then SIGKILL after graceMs if the child has not exited.
 * Returns the timer so the caller can unref it.
 */
function stopProcess(child, { graceMs, setTimeoutFn = setTimeout }) {
  child.kill('SIGTERM');
  return setTimeoutFn(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, graceMs);
}

/**
 * The application menu: on macOS the application, Edit and Window menus, because the clipboard
 * shortcuts are delivered through Edit and Cmd+M and Cmd+W through Window; null elsewhere, which
 * removes the menu bar.
 */
function applicationMenuTemplate(platform) {
  if (platform !== 'darwin') return null;
  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }]
    }
  ];
}

/**
 * The shortcut the shell handles for a before-input-event input, with no menu: 'toggleFullScreen'
 * for F11 off macOS; 'toggleDevTools' for F12 and Ctrl+Shift+I (Cmd+Alt+I on macOS) in a
 * development build only; otherwise null, and the key goes to the page.
 */
function shellShortcut(input, { platform, isDev }) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null;
  if (input.code === 'F11' && platform !== 'darwin') return 'toggleFullScreen';
  if (!isDev) return null;
  if (input.code === 'F12') return 'toggleDevTools';
  const inspect = platform === 'darwin'
    ? input.meta && input.alt
    : input.control && input.shift;
  return inspect && input.code === 'KeyI' ? 'toggleDevTools' : null;
}

/**
 * Options of the main window: the native frame and title bar on every platform, a background in
 * the surface colour of the system theme, and a sandboxed renderer with the given preload.
 */
function mainWindowOptions({ preload, icon, prefersDark }) {
  return {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload
    },
    icon,
    title: 'Messaging Explorer',
    backgroundColor: prefersDark ? '#111318' : '#f9f9ff'
  };
}

module.exports = {
  isSafeExternalUrl,
  normalizeUpdateChannel,
  applyUpdateChannel,
  waitForHealth,
  stopProcess,
  applicationMenuTemplate,
  mainWindowOptions,
  shellShortcut
};
