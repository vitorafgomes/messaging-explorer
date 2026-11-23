const path = require('node:path');

const UPDATE_CHANNELS = ['latest', 'beta'];

/** The file the API keeps connections, clients and environments in, under the user data folder of the app. */
function dataFilePath(userDataPath) {
  return path.join(userDataPath, 'data', 'workspace.json');
}

/**
 * Shows the data file in the file manager of the system. Says why when it cannot: nothing saved yet,
 * or the file manager refused; never throws to the renderer.
 */
function showDataFile(filePath, fileExists, showItemInFolder) {
  if (!fileExists(filePath)) {
    return { status: 'error', message: 'Nothing is saved yet, so there is no file to show.' };
  }
  try {
    showItemInFolder(filePath);
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'The file manager of this computer could not be opened.' };
  }
}

/**
 * Opens the developer tools of the main window, only when the main window's own page asked;
 * does nothing when the window is gone or destroyed, or when any other sender asked.
 */
function openDevTools(sender, win) {
  if (!win || win.isDestroyed()) return;
  if (sender !== win.webContents) return;
  win.webContents.openDevTools();
}

/**
 * The number of automatic resubmits running in the page, as the main window's own page told it:
 * a whole number from 0 to 1000; anything else, or a count from any other sender, keeps the last one.
 */
function acceptActiveRuns(sender, win, count, last) {
  if (!win || win.isDestroyed() || sender !== win.webContents) return last;
  return Number.isInteger(count) && count >= 0 && count <= 1000 ? count : last;
}

/**
 * What to tell the user at start when an update was asked to install and the app came back on another version:
 * the updater can fail to install without any event, and the app must not open as if nothing happened. Null when
 * nothing was asked, when the record names no version, or when that version is the one running.
 */
function failedInstallNotice({ pending, installedVersion }) {
  const version = pending && typeof pending === 'object' ? pending.version : undefined;
  if (typeof version !== 'string' || version === '' || version === installedVersion) return null;
  return {
    type: 'warning',
    title: 'Messaging Explorer',
    message: `The update to ${version} was not installed.`,
    detail: `You are still on ${installedVersion}. Open Settings to install it again, or download it from the release page.`,
    buttons: ['OK'],
    noLink: true
  };
}

/** The question asked before a quit that would stop the given number of running resubmits. */
function quitQuestion(activeRuns) {
  return {
    type: 'warning',
    title: 'Messaging Explorer',
    message: activeRuns === 1 ? 'A resubmit is still running.' : `${activeRuns} resubmits are still running.`,
    detail: 'Quitting stops it. Messages already resubmitted stay where they are; the rest stay in the dead-letter queue.',
    buttons: ['Keep running', 'Quit and stop'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
}

/**
 * Whether a quit goes on: 'quit' with no resubmit running, for the quit that installs an update,
 * and for a quit already agreed to; otherwise asks once through <code>ask</code>, which answers the
 * index of the button chosen, and only 'Quit and stop' quits; anything else is 'cancel'.
 */
function quitDecision({ activeRuns, forUpdate, alreadyQuitting, ask }) {
  if (forUpdate || alreadyQuitting || !(activeRuns > 0)) return 'quit';
  return ask(quitQuestion(activeRuns)) === 1 ? 'quit' : 'cancel';
}

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
 * for F11 off macOS; 'openConnections' for Ctrl+N (Cmd+N on macOS) in every build;
 * 'toggleDevTools' for F12 and Ctrl+Shift+I (Cmd+Alt+I on macOS) in a development build only;
 * otherwise null, and the key goes to the page.
 */
function shellShortcut(input, { platform, isDev }) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null;
  if (input.code === 'F11' && platform !== 'darwin') return 'toggleFullScreen';
  const command = platform === 'darwin' ? input.meta : input.control;
  if (input.code === 'KeyN' && command && !input.shift && !input.alt) return 'openConnections';
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

/**
 * Why this package cannot replace itself with an update, or null when it can: 'macos-unsigned'
 * (the macOS build is not signed and the macOS updater installs only into a signed app),
 * 'windows-portable' (the portable launcher sets PORTABLE_EXECUTABLE_FILE; there is no installed
 * copy to replace), 'linux-package' (anything but the AppImage, which sets APPIMAGE, and the deb, whose updater
 * installs the new deb and asks for the administrator password; an rpm, a pacman package or an unknown one was never
 * tried).
 */
function selfUpdateBlocker(platform, env, packageType) {
  if (platform === 'darwin') return 'macos-unsigned';
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'windows-portable' : null;
  if (platform === 'linux') return env.APPIMAGE || packageType === 'deb' ? null : 'linux-package';
  return null;
}

/** The type electron-builder wrote in resources/package-type, trimmed, or null when the file is absent, unreadable or empty. */
function readPackageType(read) {
  try {
    return String(read()).trim() || null;
  } catch {
    return null;
  }
}

/** The kind of package the page may be told: 'deb', 'appimage' or null for anything else. */
function packageKind(platform, env, packageType) {
  if (platform !== 'linux') return null;
  if (env.APPIMAGE) return 'appimage';
  return packageType === 'deb' ? 'deb' : null;
}

const RELEASES_API_URL = 'https://api.github.com/repos/vitorafgomes/messaging-explorer/releases?per_page=100';
const RELEASE_TAG = /^v(\d+\.\d+\.\d+(-beta\.\d+)?)$/;
const MAX_UPDATE_VERSIONS = 30;
const MAX_NOTES_LENGTH = 20000;
const UPDATE_FEED_FILES = { linux: 'latest-linux.yml', win32: 'latest.yml', darwin: 'latest-mac.yml' };
const RELEASE_DOWNLOAD_URL = 'https://github.com/vitorafgomes/messaging-explorer/releases/download';
const RELEASE_FEED = { provider: 'github', owner: 'vitorafgomes', repo: 'messaging-explorer' };
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

/**
 * The versions of a channel out of what the release page answered, newest first as it gives them, at most 30:
 * 'latest' lists the releases whose tag is vX.Y.Z, 'beta' only those whose tag is vX.Y.Z-beta.N. A draft, a tag
 * of any other form and an entry that is not a release are left out. The notes are the text of the release, cut
 * at 20000 characters; they come from outside the app and are for display as text only. Null when the answer is
 * not a list.
 */
function updateVersions(releases, channel, installedVersion, platform) {
  if (!Array.isArray(releases)) return null;
  const versions = [];
  for (const release of releases) {
    const tag = typeof release?.tag_name === 'string' ? RELEASE_TAG.exec(release.tag_name) : null;
    if (!tag || release.draft === true || (channel === 'beta') !== (tag[2] !== undefined)) continue;
    versions.push({
      version: tag[1],
      date: typeof release.published_at === 'string' ? release.published_at : '',
      notes: typeof release.body === 'string' ? release.body.slice(0, MAX_NOTES_LENGTH) : '',
      installed: tag[1] === installedVersion,
      older: isOlderVersion(tag[1], installedVersion),
      installable: Array.isArray(release.assets) && release.assets.some(asset => asset?.name === UPDATE_FEED_FILES[platform])
    });
    if (versions.length === MAX_UPDATE_VERSIONS) break;
  }
  return versions;
}

/**
 * Reads the versions of a channel from the release page of this repository, whose address is fixed here. Never
 * throws: a list that could not be read answers status 'error' with a sentence that says why.
 */
async function readUpdateVersions({ fetchFn, channel, installedVersion, platform }) {
  const notAList = { status: 'error', message: 'The release page answered something that is not a list of releases.' };
  let response;
  try {
    response = await fetchFn(RELEASES_API_URL);
  } catch {
    return { status: 'error', message: 'The release list could not be reached. Check the connection to the internet.' };
  }
  if (!response.ok) {
    return response.status === 403 || response.status === 429
      ? { status: 'error', message: 'The release page is limiting requests from this address. Try again in an hour.' }
      : { status: 'error', message: `The release page answered ${response.status}.` };
  }
  let versions;
  try {
    versions = updateVersions(await response.json(), channel, installedVersion, platform);
  } catch {
    return notAList;
  }
  return versions ? { status: 'ok', channel, versions } : notAList;
}

const MAX_EXPORT_LENGTH = 20 * 1024 * 1024;

/**
 * Writes an export where the user chooses in the system's save dialog. The renderer gives the text and a file name
 * to suggest, of which only the last segment is used; it never names a folder. Cancelling writes nothing. Never
 * throws: a write that fails says why by its error code, never by a path.
 */
async function saveExportFile({ name, content, showSaveDialog, writeFile }) {
  if (typeof content !== 'string' || content.length === 0 || content.length > MAX_EXPORT_LENGTH) {
    return { status: 'error', message: 'There is nothing to write, or it is too large.' };
  }
  const suggested = path.basename(typeof name === 'string' && name ? name : 'export.json').replace(/[^A-Za-z0-9._-]/g, '_');
  const chosen = await showSaveDialog({ title: 'Save the export', defaultPath: suggested, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!chosen || chosen.canceled || !chosen.filePath) return { status: 'cancelled' };
  try {
    await writeFile(chosen.filePath, content);
    return { status: 'saved', file: path.basename(chosen.filePath) };
  } catch (err) {
    return { status: 'error', message: `The file could not be written (${err?.code ?? 'unknown'}).` };
  }
}

/** Whether a version comes before another: by its three numbers, then a beta before the release of the same number, then by the beta's number. */
function isOlderVersion(version, than) {
  const a = VERSION.exec(version);
  const b = VERSION.exec(than);
  if (!a || !b) return false;
  const rank = parts => [Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4] === undefined ? Infinity : Number(parts[4])];
  const [left, right] = [rank(a), rank(b)];
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
}

/**
 * Copies the connections file beside the original, named with the version being left, before an older version is
 * installed. No file yet is no failure; a copy that fails says why and never throws.
 */
function backupDataFile(filePath, installedVersion, { exists, copy }) {
  if (!exists(filePath)) return { status: 'ok', file: null };
  const file = filePath.replace(/\.json$/, `.before-downgrade-from-${installedVersion}.json`);
  try {
    copy(filePath, file);
    return { status: 'ok', file };
  } catch (err) {
    return { status: 'error', message: `The connections file could not be copied: ${err.message}` };
  }
}

/**
 * Downloads one version the user picked and agreed to, ready to install on restart. Only a version of the last
 * list read, with the package of this platform, other than the installed one, on a package that can replace itself.
 * The address is built here from the fixed repository. The updater reads that release alone and may go back to an
 * older version for this one download; whatever happens it is put back as it was. Never throws.
 */
async function installUpdateVersion({ updater, version, agreed, listed, installedVersion, channel, platform, env, packageType, backup }) {
  const refuse = message => ({ status: 'error', message });
  if (typeof version !== 'string' || !VERSION.test(version)) return refuse('That is not a version of this app.');
  const picked = Array.isArray(listed) ? listed.find(entry => entry?.version === version) : undefined;
  if (!picked) return refuse(`Version ${version} is not in the list that was read. Read the versions again.`);
  if (agreed !== true) return refuse('Nothing is installed without your agreement.');
  if (version === installedVersion) return refuse(`Version ${version} is the one you have.`);
  if (selfUpdateBlocker(platform, env, packageType) !== null) return refuse('This package cannot replace itself. Download the version from the release page.');
  if (picked.installable !== true) return refuse(`The release of version ${version} holds no package this app can install here. Download it from the release page.`);
  const notInstalled = reason => refuse(`Version ${version} was not installed: ${reason}`);
  if (isOlderVersion(version, installedVersion)) {
    const copied = backup();
    if (copied?.status !== 'ok') return notInstalled(copied?.message ?? 'The connections file could not be copied.');
  }
  try {
    updater.setFeedURL({ provider: 'generic', url: `${RELEASE_DOWNLOAD_URL}/v${version}` });
    updater.channel = 'latest';
    updater.allowPrerelease = true;
    updater.allowDowngrade = true;
    updater.autoDownload = false;
    const found = (await updater.checkForUpdates())?.updateInfo?.version;
    if (found !== version) return notInstalled(`the updater answered version ${found}. Try again in a moment.`);
    await updater.downloadUpdate();
    return { status: 'ok', version };
  } catch (err) {
    return notInstalled(err?.message ?? 'the updater did not say why');
  } finally {
    updater.setFeedURL(RELEASE_FEED);
    applyUpdateChannel(updater, channel);
    configureAutoUpdate(updater, platform, env, packageType);
  }
}

/**
 * An update never downloads on its own: a check only announces it. What the user agreed to download installs on quit
 * only where this package can replace itself without asking: a deb asks for the administrator password, so it
 * installs only on Restart to Update, never when the user only quits.
 */
function configureAutoUpdate(updater, platform, env, packageType) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = selfUpdateBlocker(platform, env, packageType) === null && packageKind(platform, env, packageType) !== 'deb';
}

/**
 * Follows the checks of the updater and answers the version an agreement can be given for: the one last announced,
 * and none while a check runs, after a check that found nothing newer, or after an error. The updater replaces the
 * update it holds only when it announces one, so the answer is never a version other than the one it would download.
 */
function followFoundVersion(updater) {
  let found = null;
  updater.on('checking-for-update', () => { found = null; });
  updater.on('update-available', (info) => { found = info.version; });
  updater.on('update-not-available', () => { found = null; });
  updater.on('error', () => { found = null; });
  return () => found;
}

/** Downloads the update the last check found, only with the user's agreement to that very version. Never throws. */
async function downloadAgreedUpdate({ agreed, version, found, updater }) {
  if (agreed !== true) return { status: 'error', message: 'Nothing is downloaded without your agreement.' };
  if (typeof found !== 'string') return { status: 'error', message: 'No update is on offer right now: a check is running or the last one found none. Check again and agree to the version shown.' };
  if (version !== found) {
    return { status: 'error', message: 'The version found is not the one you agreed to. Check again and agree to the version shown.' };
  }
  try {
    await updater.downloadUpdate();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err?.message ?? 'the updater did not say why' };
  }
}

const SHELL_LOG_LINE_LENGTH = 1000;

/**
 * The lines the desktop app wrote to its console since it opened, kept in memory for the Logs screen. What the API
 * process wrote is left out: the backend keeps its own lines, without the text of an exception. Of an Error only its
 * name and code are kept, of any other object nothing, and each pair of `hidden` is replaced in the words.
 */
function createShellLog({ limit = 500, hidden = [], now = () => new Date() } = {}) {
  let lines = [];
  let lastId = 0;
  const word = (arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.code ? `${arg.name} (${arg.code})` : arg.name;
    return arg !== null && typeof arg === 'object' ? '[object]' : String(arg);
  };
  return {
    add(level, args) {
      let text = args.map(word).join(' ');
      if (/^\[API( ERROR)?\]/.test(text)) return;
      for (const [secret, shown] of hidden) {
        if (secret) text = text.split(secret).join(shown);
      }
      const category = /^\[([^\]]+)\]\s*/.exec(text);
      lines.push({
        id: ++lastId, time: now().toISOString(), level, category: category ? category[1] : '',
        text: (category ? text.slice(category[0].length) : text).slice(0, SHELL_LOG_LINE_LENGTH)
      });
      if (lines.length > limit) lines = lines.slice(-limit);
    },
    after(id) {
      const from = Number.isFinite(id) ? id : 0;
      return lines.filter(line => line.id > from);
    },
    clear() {
      lines = [];
    }
  };
}

/** Makes `log`, `warn` and `error` of a console also keep their line in the shell log; the call itself never fails for it. */
function captureConsole(target, shellLog) {
  for (const [method, level] of [['log', 'Info'], ['warn', 'Warning'], ['error', 'Error']]) {
    const original = target[method].bind(target);
    target[method] = (...args) => {
      try {
        shellLog.add(level, args);
      } catch {}
      original(...args);
    };
  }
}

/** .NET host status codes: 0x80008083, the host library was not found; 0x80008096, the framework was not found. */
const RUNTIME_MISSING_EXIT_CODES = [0x80008083, 0x80008096];

/** Why the API process ended, as the end of the sentence "The local API did not start: ...". */
function describeApiExit(exit) {
  if (exit.error) return `it could not be launched (${exit.error})`;
  if (RUNTIME_MISSING_EXIT_CODES.includes(exit.code)) {
    return 'the .NET runtime it needs was not found. Reinstall Messaging Explorer; if it still fails, install the ASP.NET Core Runtime 10 from https://dotnet.microsoft.com/download/dotnet/10.0';
  }
  if (exit.code !== null) return `it exited with code ${exit.code}`;
  return `it was stopped by signal ${exit.signal}`;
}

module.exports = {
  failedInstallNotice,
  describeApiExit,
  downloadAgreedUpdate,
  followFoundVersion,
  createShellLog,
  captureConsole,
  saveExportFile,
  installUpdateVersion,
  isOlderVersion,
  backupDataFile,
  UPDATE_FEED_FILES,
  dataFilePath,
  showDataFile,
  openDevTools,
  acceptActiveRuns,
  quitDecision,
  configureAutoUpdate,
  isSafeExternalUrl,
  normalizeUpdateChannel,
  applyUpdateChannel,
  waitForHealth,
  stopProcess,
  applicationMenuTemplate,
  mainWindowOptions,
  shellShortcut,
  selfUpdateBlocker,
  readPackageType,
  packageKind,
  updateVersions,
  readUpdateVersions,
  RELEASES_API_URL
};
