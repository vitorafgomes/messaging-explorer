const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  isSafeExternalUrl,
  normalizeUpdateChannel,
  applyUpdateChannel,
  waitForHealth,
  stopProcess,
  applicationMenuTemplate,
  mainWindowOptions,
  shellShortcut,
  selfUpdateBlocker,
  configureAutoUpdate
} = require('./shell-helpers');

test('no File/Edit/View/Window/Help bar: no application menu on win32 and linux', () => {
  assert.equal(applicationMenuTemplate('win32'), null);
  assert.equal(applicationMenuTemplate('linux'), null);
});

test('copy and paste and Cmd+W keep working on macOS: darwin menu is appMenu, editMenu and a Window menu with minimize, zoom, close and front', () => {
  assert.deepEqual(applicationMenuTemplate('darwin'), [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }]
    }
  ]);
});

function key(code, modifiers = {}) {
  return { type: 'keyDown', code, key: code, shift: false, control: false, alt: false, meta: false, isAutoRepeat: false, ...modifiers };
}

const devToolsKeys = {
  win32: [key('F12'), key('KeyI', { control: true, shift: true })],
  linux: [key('F12'), key('KeyI', { control: true, shift: true })],
  darwin: [key('F12'), key('KeyI', { meta: true, alt: true })]
};

test('F11 toggles full screen on win32 and linux, in packaged and development builds', () => {
  for (const platform of ['win32', 'linux']) {
    for (const isDev of [false, true]) {
      assert.equal(shellShortcut(key('F11'), { platform, isDev }), 'toggleFullScreen', `${platform}, isDev ${isDev}`);
    }
  }
});

test('F11 does nothing on darwin, where the zoom button and the system shortcut give full screen', () => {
  for (const isDev of [false, true]) {
    assert.equal(shellShortcut(key('F11'), { platform: 'darwin', isDev }), null, `isDev ${isDev}`);
  }
});

test('a development build opens developer tools with F12 and Ctrl+Shift+I, or Cmd+Alt+I on darwin', () => {
  for (const [platform, inputs] of Object.entries(devToolsKeys)) {
    for (const input of inputs) {
      assert.equal(shellShortcut(input, { platform, isDev: true }), 'toggleDevTools', `${platform} ${input.code}`);
    }
  }
});

test('a packaged build never opens developer tools', () => {
  for (const [platform, inputs] of Object.entries(devToolsKeys)) {
    for (const input of inputs) {
      assert.equal(shellShortcut(input, { platform, isDev: false }), null, `${platform} ${input.code}`);
    }
  }
});

test('the shell leaves every other key to the page: key up, auto-repeat, Ctrl+Shift+I on darwin, Ctrl+Shift+D', () => {
  assert.equal(shellShortcut({ ...key('F11'), type: 'keyUp' }, { platform: 'linux', isDev: true }), null);
  assert.equal(shellShortcut(key('F11', { isAutoRepeat: true }), { platform: 'linux', isDev: true }), null);
  assert.equal(shellShortcut(key('KeyI', { control: true, shift: true }), { platform: 'darwin', isDev: true }), null);
  assert.equal(shellShortcut(key('KeyD', { control: true, shift: true }), { platform: 'win32', isDev: true }), null);
});

const windowPaths = { preload: '/app/electron/preload.js', icon: '/app/assets/icon.png' };

test('window buttons not over the toolbar and the window drags: darwin window options carry no hiddenInset, trafficLightPosition or vibrancy', () => {
  const options = mainWindowOptions({ ...windowPaths, prefersDark: false });
  assert.equal('titleBarStyle' in options, false, 'titleBarStyle must not be set: hiddenInset removes the native title bar');
  assert.equal('trafficLightPosition' in options, false, 'trafficLightPosition must not be set: it moves the window buttons into the page');
  assert.equal('vibrancy' in options, false, 'vibrancy must not be set');
  assert.notEqual(options.frame, false, 'the window keeps its native frame');
  assert.deepEqual(options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: '/app/electron/preload.js'
  });
});

test('no blue flash: background follows the system theme', () => {
  assert.equal(mainWindowOptions({ ...windowPaths, prefersDark: false }).backgroundColor, '#f9f9ff');
  assert.equal(mainWindowOptions({ ...windowPaths, prefersDark: true }).backgroundColor, '#111318');
});

test('openExternal must not accept any URL scheme: http and https URLs are safe', () => {
  assert.equal(isSafeExternalUrl('https://github.com/vitorafgomes/messaging-explorer'), true);
  assert.equal(isSafeExternalUrl('http://localhost:4297/docs'), true);
});

test('openExternal must not accept any URL scheme: file, javascript, custom schemes and garbage are refused', () => {
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('ms-settings:privacy'), false);
  assert.equal(isSafeExternalUrl('smb://host/share'), false);
  assert.equal(isSafeExternalUrl('not a url'), false);
  assert.equal(isSafeExternalUrl(''), false);
  assert.equal(isSafeExternalUrl(undefined), false);
});

test('set-update-channel must reject a channel that is not latest or beta: latest and beta are kept', () => {
  assert.equal(normalizeUpdateChannel('latest'), 'latest');
  assert.equal(normalizeUpdateChannel('beta'), 'beta');
});

test('set-update-channel must reject a channel that is not latest or beta: anything else is null', () => {
  assert.equal(normalizeUpdateChannel('alpha'), null);
  assert.equal(normalizeUpdateChannel('Beta'), null);
  assert.equal(normalizeUpdateChannel('../latest'), null);
  assert.equal(normalizeUpdateChannel(''), null);
  assert.equal(normalizeUpdateChannel(undefined), null);
  assert.equal(normalizeUpdateChannel({ toString: () => 'beta' }), null);
});

function fakeUpdater({ allowPrerelease }) {
  return {
    allowPrerelease,
    allowDowngrade: false,
    _channel: null,
    get channel() {
      return this._channel;
    },
    set channel(value) {
      this._channel = value;
      this.allowDowngrade = true;
    }
  };
}

test('the beta channel must find beta releases: beta turns allowPrerelease on', () => {
  const updater = fakeUpdater({ allowPrerelease: false });
  applyUpdateChannel(updater, 'beta');
  assert.equal(updater.channel, 'beta');
  assert.equal(updater.allowPrerelease, true);
});

test('the beta channel must find beta releases: latest turns allowPrerelease off', () => {
  const updater = fakeUpdater({ allowPrerelease: true });
  applyUpdateChannel(updater, 'latest');
  assert.equal(updater.channel, 'latest');
  assert.equal(updater.allowPrerelease, false);
});

test('choosing an update channel never enables a downgrade', () => {
  for (const channel of ['latest', 'beta']) {
    const updater = fakeUpdater({ allowPrerelease: channel === 'latest' });
    applyUpdateChannel(updater, channel);
    assert.equal(updater.allowDowngrade, false, `allowDowngrade after choosing ${channel}`);
  }
});

test('the window must not open before the API answers /health: healthy once a response is ok, after a rejected and a non-ok attempt', async () => {
  const replies = [
    () => Promise.reject(new Error('ECONNREFUSED')),
    () => Promise.resolve({ ok: false }),
    () => Promise.resolve({ ok: true })
  ];
  const calls = [];
  const result = await waitForHealth({
    url: 'http://127.0.0.1:5917/health',
    timeoutMs: 10_000,
    intervalMs: 1,
    fetchFn: (...args) => {
      calls.push(args);
      return replies[calls.length - 1]();
    },
    hasExited: () => false
  });
  assert.deepEqual(result, { healthy: true });
  assert.deepEqual(calls, [
    ['http://127.0.0.1:5917/health'],
    ['http://127.0.0.1:5917/health'],
    ['http://127.0.0.1:5917/health']
  ]);
});

test('a failed start must be shown to the user: exited as soon as the process has exited', async () => {
  let attempts = 0;
  const result = await waitForHealth({
    url: 'http://127.0.0.1:5917/health',
    timeoutMs: 10_000,
    intervalMs: 1,
    fetchFn: () => {
      attempts += 1;
      return Promise.reject(new Error('ECONNREFUSED'));
    },
    hasExited: () => attempts >= 2
  });
  assert.deepEqual(result, { healthy: false, reason: 'exited' });
  assert.equal(attempts, 2);
});

async function settleOnFakeClock(t, run, stepMs) {
  let settled = false;
  const result = run().finally(() => { settled = true; });
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!settled) t.mock.timers.tick(stepMs);
  }
  return result;
}

test('a failed start must be shown to the user: timeout when /health never answers ok', { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let attempts = 0;
  const result = await settleOnFakeClock(t, () => waitForHealth({
    url: 'http://127.0.0.1:5917/health',
    timeoutMs: 300_000,
    intervalMs: 1_000,
    fetchFn: () => {
      attempts += 1;
      return Promise.resolve({ ok: false });
    },
    hasExited: () => false
  }), 1_000);
  assert.deepEqual(result, { healthy: false, reason: 'timeout' });
  assert.equal(attempts, 300, 'one attempt per interval until the deadline, none after it');
  assert.equal(Date.now(), 300_000, 'resolved at the deadline, not before and not after');
});

test('a failed start must be shown to the user: timeout when a fetch never settles', { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const result = await settleOnFakeClock(t, () => waitForHealth({
    url: 'http://127.0.0.1:5917/health',
    timeoutMs: 300_000,
    intervalMs: 1_000,
    fetchFn: () => new Promise(() => {}),
    hasExited: () => false
  }), 1_000);
  assert.deepEqual(result, { healthy: false, reason: 'timeout' });
  assert.equal(Date.now(), 300_000, 'resolved at the deadline, not before and not after');
});

function fakeChild() {
  return {
    exitCode: null,
    signalCode: null,
    killed: false,
    signals: [],
    kill(signal) {
      this.signals.push(signal);
      this.killed = true;
      return true;
    }
  };
}

function fakeTimer() {
  const timer = { callback: null, delay: null };
  timer.setTimeoutFn = (callback, delay) => {
    timer.callback = callback;
    timer.delay = delay;
    return timer;
  };
  return timer;
}

test('the SIGKILL fallback must be able to fire: no SIGKILL when the child exits within the grace period', () => {
  const child = fakeChild();
  const timer = fakeTimer();
  const returned = stopProcess(child, { graceMs: 5000, setTimeoutFn: timer.setTimeoutFn });
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(timer.delay, 5000);
  assert.equal(returned, timer);
  child.signalCode = 'SIGTERM';
  timer.callback();
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('the SIGKILL fallback must be able to fire: SIGKILL when the child is still running after the grace period', () => {
  const child = fakeChild();
  const timer = fakeTimer();
  stopProcess(child, { graceMs: 5000, setTimeoutFn: timer.setTimeoutFn });
  assert.equal(child.killed, true);
  timer.callback();
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('a macOS build cannot update itself, because it is not signed', () => {
  assert.equal(selfUpdateBlocker('darwin', {}), 'macos-unsigned');
});

test('the portable Windows build cannot update itself; the installed one can', () => {
  assert.equal(selfUpdateBlocker('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\apps\\Messaging Explorer.exe' }), 'windows-portable');
  assert.equal(selfUpdateBlocker('win32', {}), null);
});

test('on Linux the AppImage can update itself; the deb package cannot', () => {
  assert.equal(selfUpdateBlocker('linux', { APPIMAGE: '/home/user/Messaging-Explorer.AppImage' }), null);
  assert.equal(selfUpdateBlocker('linux', {}), 'linux-package');
});

test('the data file is data/workspace.json under the user data folder', () => {
  const { dataFilePath } = require('./shell-helpers');
  assert.equal(dataFilePath('/home/u/.config/Messaging Explorer'), path.join('/home/u/.config/Messaging Explorer', 'data', 'workspace.json'));
});

test('Show in folder shows the file when it exists', () => {
  const { showDataFile } = require('./shell-helpers');
  const shown = [];
  assert.deepEqual(showDataFile('/d/workspace.json', () => true, (f) => shown.push(f)), { status: 'ok' });
  assert.deepEqual(shown, ['/d/workspace.json']);
});

test('Show in folder says nothing is saved yet when the file does not exist, and opens nothing', () => {
  const { showDataFile } = require('./shell-helpers');
  const shown = [];
  assert.deepEqual(showDataFile('/d/workspace.json', () => false, (f) => shown.push(f)),
    { status: 'error', message: 'Nothing is saved yet, so there is no file to show.' });
  assert.deepEqual(shown, []);
});

test('Show in folder says the file manager could not be opened when the system call throws, never throws itself', () => {
  const { showDataFile } = require('./shell-helpers');
  assert.deepEqual(showDataFile('/d/workspace.json', () => true, () => { throw new Error('no desktop'); }),
    { status: 'error', message: 'The file manager of this computer could not be opened.' });
});

test('Ctrl+N, or Cmd+N on darwin, opens the Connections screen, in packaged and development builds', () => {
  const newConnection = { win32: key('KeyN', { control: true }), linux: key('KeyN', { control: true }), darwin: key('KeyN', { meta: true }) };
  for (const [platform, input] of Object.entries(newConnection)) {
    for (const isDev of [false, true]) {
      assert.equal(shellShortcut(input, { platform, isDev }), 'openConnections', `${platform}, isDev ${isDev}: Ctrl N or Cmd N must open the Connections screen`);
    }
  }
});

test('Ctrl+N on darwin, Ctrl+Shift+N and Ctrl+Alt+N are left to the page', () => {
  assert.equal(shellShortcut(key('KeyN', { control: true }), { platform: 'darwin', isDev: false }), null, 'on darwin the shortcut is Cmd N, not Ctrl N');
  assert.equal(shellShortcut(key('KeyN', { control: true, shift: true }), { platform: 'linux', isDev: false }), null, 'Ctrl Shift N is not the new connection shortcut');
  assert.equal(shellShortcut(key('KeyN', { control: true, alt: true }), { platform: 'win32', isDev: false }), null, 'Ctrl Alt N is not the new connection shortcut');
});

function fakeWindow({ destroyed = false } = {}) {
  const opened = [];
  const webContents = { openDevTools: () => opened.push('open') };
  const win = {
    isDestroyed: () => destroyed,
    get webContents() {
      if (destroyed) throw new TypeError('Object has been destroyed');
      return webContents;
    }
  };
  return { win, webContents, opened };
}

test('Open developer tools opens them for the main window when the main window asks', () => {
  const { openDevTools } = require('./shell-helpers');
  const { win, webContents, opened } = fakeWindow();
  openDevTools(webContents, win);
  assert.deepEqual(opened, ['open'], 'the main window asking must open its own developer tools, once');
});

test('Open developer tools does nothing when another page asks, so no sender can choose a target', () => {
  const { openDevTools } = require('./shell-helpers');
  const { win, opened } = fakeWindow();
  const otherPage = { openDevTools: () => opened.push('other') };
  openDevTools(otherPage, win);
  assert.deepEqual(opened, [], 'a sender other than the main window webContents must open no developer tools');
});

test('Open developer tools does nothing and does not throw when the window is gone or destroyed', () => {
  const { openDevTools } = require('./shell-helpers');
  const { win, webContents, opened } = fakeWindow({ destroyed: true });
  assert.doesNotThrow(() => openDevTools(webContents, null), 'a closed main window must not make the handler throw');
  assert.doesNotThrow(() => openDevTools(webContents, undefined), 'a main window never created must not make the handler throw');
  assert.doesNotThrow(() => openDevTools(webContents, win), 'a destroyed main window must not make the handler throw');
  assert.deepEqual(opened, [], 'no developer tools open when the window is gone');
});

test('an update never downloads on its own, and what the user agreed to download installs on quit only where the package can replace itself', () => {
  const cases = [
    ['the Windows installer', 'win32', {}, true],
    ['the AppImage', 'linux', { APPIMAGE: '/home/user/Messaging-Explorer.AppImage' }, true],
    ['macOS, unsigned', 'darwin', {}, false],
    ['the Windows portable exe', 'win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\apps\\Messaging Explorer.exe' }, false],
    ['the deb', 'linux', {}, false]
  ];
  for (const [name, platform, env, expected] of cases) {
    const updater = { autoDownload: true, autoInstallOnAppQuit: !expected };
    configureAutoUpdate(updater, platform, env);
    assert.equal(updater.autoDownload, false, `${name}: autoDownload`);
    assert.equal(updater.autoInstallOnAppQuit, expected, `${name}: autoInstallOnAppQuit`);
  }
});

test('the update found by the check downloads only with the agreement of the user to that version, and a failed download says why', async () => {
  const { downloadAgreedUpdate } = require('./shell-helpers');
  for (const agreed of [undefined, false, 'true', 1, {}]) {
    const updater = fakeUpdater();
    assert.deepEqual(await downloadAgreedUpdate({ agreed, version: '2.5.0', found: '2.5.0', updater }), { status: 'error', message: 'Nothing is downloaded without your agreement.' });
    assert.deepEqual(updater.calls, []);
  }
  for (const [version, found] of [['2.5.0', '2.5.1'], [undefined, '2.5.0'], ['2.5.0', null], [undefined, undefined], [{}, {}]]) {
    const updater = fakeUpdater();
    assert.deepEqual(await downloadAgreedUpdate({ agreed: true, version, found, updater }),
      { status: 'error', message: 'The version found is not the one you agreed to. Check again and agree to the version shown.' });
    assert.deepEqual(updater.calls, []);
  }
  const updater = fakeUpdater();
  assert.deepEqual(await downloadAgreedUpdate({ agreed: true, version: '2.5.0', found: '2.5.0', updater }), { status: 'ok' });
  assert.deepEqual(updater.calls, [['download']]);
  assert.deepEqual(await downloadAgreedUpdate({ agreed: true, version: '2.5.0', found: '2.5.0', updater: fakeUpdater({ downloadFails: true }) }), { status: 'error', message: 'disk full' });
});

test('main.js never writes the text or the stack of an error to its console, only the error itself, of which the shell log keeps the name', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, 'main.js'), 'utf8');
  const calls = main.match(/console\.(log|warn|error)\([^;]*;/g) ?? [];
  assert.deepEqual(calls.filter(call => /\.message|\.stack/.test(call)), []);
});

test('main.js configures the updater through configureAutoUpdate, sets autoDownload nowhere else, and downloads only through the agreement', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, 'main.js'), 'utf8');
  assert.match(main, /^configureAutoUpdate\(autoUpdater, process\.platform, process\.env\);$/m);
  assert.doesNotMatch(main, /autoUpdater\.(autoDownload|autoInstallOnAppQuit)\s*=/);
  assert.match(main, /ipcMain\.handle\('download-update', \(event, request\) => downloadAgreedUpdate\(\{ agreed: request\?\.agreed, version: request\?\.version, found: foundVersion, updater: autoUpdater \}\)\);/);
  assert.match(main, /autoUpdater\.on\('update-available', \(info\) => \{\n  foundVersion = info\.version;/);
  assert.equal(main.match(/autoUpdater\.downloadUpdate\(/g), null, 'main.js itself never starts a download');
});


const { updateVersions, readUpdateVersions, RELEASES_API_URL } = require('./shell-helpers');

const release = (tag, extra = {}) => ({ tag_name: tag, published_at: '2026-11-15T20:12:48Z', body: `notes of ${tag}`, draft: false, ...extra });

test('Stable lists the releases that are not betas and Beta lists only the betas, newest first as the release page gives them', () => {
  const releases = [release('v2.4.5-beta.7'), release('v2.4.4'), release('v2.4.5-beta.6'), release('v2.4.3')];

  assert.deepEqual(updateVersions(releases, 'latest', '2.4.3').map(v => v.version), ['2.4.4', '2.4.3']);
  assert.deepEqual(updateVersions(releases, 'beta', '2.4.3').map(v => v.version), ['2.4.5-beta.7', '2.4.5-beta.6']);
});

test('each version carries its date, its notes as the text the release holds, and whether it is the installed one', () => {
  const [newer, installed] = updateVersions([release('v2.4.4', { body: '<script>alert(1)</script>\n- a fix' }), release('v2.4.3')], 'latest', '2.4.3');

  assert.deepEqual(newer, { version: '2.4.4', date: '2026-11-15T20:12:48Z', notes: '<script>alert(1)</script>\n- a fix', installed: false, older: false, installable: false });
  assert.equal(installed.installed, true);
});

test('a release whose tag is not a version of this app, a draft, and an entry that is not a release are left out', () => {
  const releases = [release('nightly'), release('v2.4'), release('v2.4.4-rc.1'), release('v2.4.4', { draft: true }), null, 'text', { tag_name: 7 }, release('v2.4.2')];

  assert.deepEqual(updateVersions(releases, 'latest', '').map(v => v.version), ['2.4.2']);
});

test('at most 30 versions are listed and notes longer than 20000 characters are cut', () => {
  const many = Array.from({ length: 40 }, (_, i) => release(`v1.0.${40 - i}`, { body: 'x'.repeat(30000) }));

  const versions = updateVersions(many, 'latest', '');

  assert.equal(versions.length, 30);
  assert.equal(versions[0].version, '1.0.40');
  assert.equal(versions[0].notes.length, 20000);
});

test('an answer that is not a list of releases is no list at all, never an empty one', () => {
  for (const answer of [null, undefined, { message: 'API rate limit exceeded' }, 'text']) {
    assert.equal(updateVersions(answer, 'latest', ''), null);
  }
});

test('the release list is read from the fixed address of this repository, and the versions come back for the channel', async () => {
  const asked = [];
  const fetchFn = async url => { asked.push(url); return { ok: true, status: 200, json: async () => [release('v2.4.4'), release('v2.4.5-beta.7')] }; };

  const answer = await readUpdateVersions({ fetchFn, channel: 'beta', installedVersion: '2.4.5-beta.7' });

  assert.deepEqual(asked, [RELEASES_API_URL]);
  assert.equal(RELEASES_API_URL, 'https://api.github.com/repos/vitorafgomes/messaging-explorer/releases?per_page=100');
  assert.deepEqual(answer, { status: 'ok', channel: 'beta', versions: [{ version: '2.4.5-beta.7', date: '2026-11-15T20:12:48Z', notes: 'notes of v2.4.5-beta.7', installed: true, older: false, installable: false }] });
});

test('a release list that cannot be read says why: no answer, a request limit, another status, a body that is not a list', async () => {
  const read = fetchFn => readUpdateVersions({ fetchFn, channel: 'latest', installedVersion: '2.4.3' });

  assert.deepEqual(await read(async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }),
    { status: 'error', message: 'The release list could not be reached. Check the connection to the internet.' });
  for (const status of [403, 429]) {
    assert.deepEqual(await read(async () => ({ ok: false, status, json: async () => ({}) })),
      { status: 'error', message: 'The release page is limiting requests from this address. Try again in an hour.' });
  }
  assert.deepEqual(await read(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    { status: 'error', message: 'The release page answered 503.' });
  assert.deepEqual(await read(async () => ({ ok: true, status: 200, json: async () => ({ message: 'unexpected' }) })),
    { status: 'error', message: 'The release page answered something that is not a list of releases.' });
  assert.deepEqual(await read(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })),
    { status: 'error', message: 'The release page answered something that is not a list of releases.' });
});

test('main.js lists the versions only through readUpdateVersions, with the stored channel and the installed version, and takes nothing from the renderer', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('list-update-versions', async \(\) => \{\n  const result = await readUpdateVersions\(\{/);
  assert.doesNotMatch(main, /api\.github\.com/);
  const handler = main.slice(main.indexOf("ipcMain.handle('list-update-versions'"), main.indexOf('// Check for updates shortly after launch'));
  assert.match(handler, /signal: AbortSignal\.timeout\(15000\)/, 'the request gives up after 15 seconds');
  assert.match(handler, /headers: \{ Accept: 'application\/vnd\.github\+json', 'User-Agent': 'messaging-explorer' \}/, 'the headers are fixed and carry nothing of the user or the machine');
  assert.match(handler, /channel: normalizeUpdateChannel\(store\.get\('updateChannel', 'latest'\)\) \?\? 'latest'/, 'the channel is the stored one');
  assert.match(handler, /installedVersion: app\.getVersion\(\)/);
});

const { installUpdateVersion, isOlderVersion, backupDataFile, UPDATE_FEED_FILES } = require('./shell-helpers');

const listedVersions = [
  { version: '2.4.5-beta.7', installed: true, installable: true },
  { version: '2.4.5-beta.8', installed: false, installable: true },
  { version: '2.4.3', installed: false, installable: true },
  { version: '2.4.2', installed: false, installable: false }
];

function fakeUpdater({ checkFails, downloadFails, found = '2.4.3' } = {}) {
  const calls = [];
  return {
    calls,
    channel: 'beta', allowPrerelease: true, allowDowngrade: false, autoDownload: true, autoInstallOnAppQuit: true,
    setFeedURL(feed) { calls.push(['setFeedURL', feed]); },
    async checkForUpdates() {
      calls.push(['check', { allowDowngrade: this.allowDowngrade, autoDownload: this.autoDownload, channel: this.channel }]);
      if (checkFails) throw new Error('feed not found');
      return { updateInfo: { version: found } };
    },
    async downloadUpdate() { calls.push(['download']); if (downloadFails) throw new Error('disk full'); }
  };
}

const installRequest = (overrides = {}) => ({
  updater: fakeUpdater(), version: '2.4.3', agreed: true, listed: listedVersions, installedVersion: '2.4.5-beta.7',
  channel: 'beta', platform: 'linux', env: { APPIMAGE: '/opt/app.AppImage' }, backup: () => ({ status: 'ok' }), ...overrides
});

test('a version is older than another by its numbers, and a beta is older than the release of the same number', () => {
  assert.equal(isOlderVersion('2.4.3', '2.4.5-beta.7'), true);
  assert.equal(isOlderVersion('2.4.5-beta.7', '2.4.5'), true);
  assert.equal(isOlderVersion('2.4.5-beta.6', '2.4.5-beta.7'), true);
  assert.equal(isOlderVersion('2.4.10', '2.4.9'), false);
  assert.equal(isOlderVersion('2.4.5', '2.4.5'), false);
  assert.equal(isOlderVersion('2.4.5-beta.8', '2.4.5-beta.7'), false);
});

test('a listed version says whether its release holds the update file of this platform', () => {
  const releases = [
    { tag_name: 'v2.4.3', assets: [{ name: 'latest-linux.yml' }, { name: 'latest.yml' }] },
    { tag_name: 'v2.4.2', assets: [{ name: 'latest-mac.yml' }] },
    { tag_name: 'v2.4.1' }
  ];
  assert.deepEqual(updateVersions(releases, 'latest', '2.4.0', 'linux').map(v => [v.version, v.installable]), [['2.4.3', true], ['2.4.2', false], ['2.4.1', false]]);
  assert.deepEqual(updateVersions(releases, 'latest', '2.4.0', 'darwin').map(v => v.installable), [false, true, false]);
  assert.deepEqual(UPDATE_FEED_FILES, { linux: 'latest-linux.yml', win32: 'latest.yml', darwin: 'latest-mac.yml' });
});

test('installing a picked version points the updater at that release alone, allows the downgrade for that one install, downloads, and puts the updater back as it was', async () => {
  const request = installRequest();
  const result = await installUpdateVersion(request);

  assert.deepEqual(result, { status: 'ok', version: '2.4.3' });
  assert.deepEqual(request.updater.calls, [
    ['setFeedURL', { provider: 'generic', url: 'https://github.com/vitorafgomes/messaging-explorer/releases/download/v2.4.3' }],
    ['check', { allowDowngrade: true, autoDownload: false, channel: 'latest' }],
    ['download'],
    ['setFeedURL', { provider: 'github', owner: 'vitorafgomes', repo: 'messaging-explorer' }]
  ]);
  const { channel, allowPrerelease, allowDowngrade, autoDownload, autoInstallOnAppQuit } = request.updater;
  assert.deepEqual({ channel, allowPrerelease, allowDowngrade, autoDownload, autoInstallOnAppQuit },
    { channel: 'beta', allowPrerelease: true, allowDowngrade: false, autoDownload: false, autoInstallOnAppQuit: true },
    'after a picked version was downloaded nothing else downloads by itself in this run, and it installs on quit');
});

test('a picked version that cannot be read or downloaded says why, installs nothing, and the updater is put back as it was', async () => {
  for (const [failure, message] of [[{ checkFails: true }, 'feed not found'], [{ downloadFails: true }, 'disk full']]) {
    const request = installRequest({ updater: fakeUpdater(failure) });
    const result = await installUpdateVersion(request);

    assert.deepEqual(result, { status: 'error', message: `Version 2.4.3 was not installed: ${message}` });
    assert.deepEqual(request.updater.calls.at(-1), ['setFeedURL', { provider: 'github', owner: 'vitorafgomes', repo: 'messaging-explorer' }]);
    assert.equal(request.updater.allowDowngrade, false);
    assert.equal(request.updater.autoDownload, false);
    assert.equal(request.updater.channel, 'beta');
  }
});

test('a check that answers another version, as one already running for the newest would, downloads nothing and says so', async () => {
  const request = installRequest({ updater: fakeUpdater({ found: '2.4.5-beta.8' }) });

  assert.deepEqual(await installUpdateVersion(request), { status: 'error', message: 'Version 2.4.3 was not installed: the updater answered version 2.4.5-beta.8. Try again in a moment.' });
  assert.equal(request.updater.calls.some(call => call[0] === 'download'), false, 'nothing was downloaded');
  assert.equal(request.updater.allowDowngrade, false);
});

test('a version is installed only when it is a version of the last list, has the package of this platform, is not the installed one, and the user agreed; anything else never reaches the updater', async () => {
  const refused = [
    [{ version: 'https://example.net/evil' }, 'That is not a version of this app.'],
    [{ version: '../v2.4.3' }, 'That is not a version of this app.'],
    [{ version: undefined }, 'That is not a version of this app.'],
    [{ version: '2.4.4' }, 'Version 2.4.4 is not in the list that was read. Read the versions again.'],
    [{ listed: [] }, 'Version 2.4.3 is not in the list that was read. Read the versions again.'],
    [{ agreed: false }, 'Nothing is installed without your agreement.'],
    [{ agreed: 'true' }, 'Nothing is installed without your agreement.'],
    [{ version: '2.4.5-beta.7' }, 'Version 2.4.5-beta.7 is the one you have.'],
    [{ version: '2.4.2' }, 'The release of version 2.4.2 holds no package this app can install here. Download it from the release page.'],
    [{ env: {} }, 'This package cannot replace itself. Download the version from the release page.']
  ];
  for (const [overrides, message] of refused) {
    const request = installRequest(overrides);
    assert.deepEqual(await installUpdateVersion(request), { status: 'error', message }, JSON.stringify(overrides));
    assert.deepEqual(request.updater.calls, [], `the updater was called for ${JSON.stringify(overrides)}`);
  }
});

test('before an older version is installed the connections file is copied beside the original, and a copy that fails stops the install', async () => {
  const backups = [];
  const older = installRequest({ backup: () => { backups.push('older'); return { status: 'ok' }; } });
  await installUpdateVersion(older);
  const newer = installRequest({ updater: fakeUpdater({ found: '2.4.5-beta.8' }), version: '2.4.5-beta.8', backup: () => { backups.push('newer'); return { status: 'ok' }; } });
  await installUpdateVersion(newer);
  assert.deepEqual(backups, ['older'], 'only a downgrade copies the file');

  const failing = installRequest({ backup: () => ({ status: 'error', message: 'The connections file could not be copied: EACCES' }) });
  assert.deepEqual(await installUpdateVersion(failing), { status: 'error', message: 'Version 2.4.3 was not installed: The connections file could not be copied: EACCES' });
  assert.deepEqual(failing.updater.calls, []);
});

test('the copy of the connections file is named with the version left, and no file yet is no failure', () => {
  const copies = [];
  const copy = (from, to) => copies.push([from, to]);
  assert.deepEqual(backupDataFile('/data/workspace.json', '2.4.5-beta.7', { exists: () => true, copy }), { status: 'ok', file: '/data/workspace.before-downgrade-from-2.4.5-beta.7.json' });
  assert.deepEqual(copies, [['/data/workspace.json', '/data/workspace.before-downgrade-from-2.4.5-beta.7.json']]);
  assert.deepEqual(backupDataFile('/data/workspace.json', '2.4.5-beta.7', { exists: () => false, copy }), { status: 'ok', file: null });
  assert.deepEqual(backupDataFile('/data/workspace.json', '2.4.5-beta.7', { exists: () => true, copy: () => { throw new Error('EACCES'); } }),
    { status: 'error', message: 'The connections file could not be copied: EACCES' });
});

test('main.js installs a picked version only through installUpdateVersion, with the versions of the last list it read, and the automatic check stands aside once one was downloaded', () => {
  const main = require('node:fs').readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const handler = main.slice(main.indexOf("ipcMain.handle('install-update-version'"), main.indexOf('// Check for updates shortly after launch'));
  assert.match(handler, /ipcMain\.handle\('install-update-version', async \(event, request\) => \{/);
  assert.match(handler, /version: request\?\.version, agreed: request\?\.agreed, listed: lastListedVersions,/);
  assert.match(handler, /if \(result\.status === 'ok'\) \{\n      pickedVersionDownloaded = true;\n    \}/);
  assert.match(handler, /if \(installingPickedVersion\) return \{ status: 'error', message: 'A version is already being downloaded\.' \};\n  installingPickedVersion = true;\n  try \{/, 'one install at a time');
  assert.match(handler, /\} finally \{\n    installingPickedVersion = false;\n  \}/);
  assert.match(main, /if \(pickedVersionDownloaded\) return;\n\s+autoUpdater\.checkForUpdates\(\)/);
  assert.doesNotMatch(main, /releases\/download/);
});

const { saveExportFile } = require('./shell-helpers');

test('an export is written where the user chose in the save dialog, which is offered only the file name', async () => {
  const offered = [];
  const written = [];
  const result = await saveExportFile({
    name: '../../etc/servicebus-full-config-2026-11-19.json', content: '{"connections":[]}',
    showSaveDialog: async (options) => { offered.push(options); return { canceled: false, filePath: '/home/user/Documents/export.json' }; },
    writeFile: async (file, text) => { written.push([file, text]); }
  });

  assert.deepEqual(result, { status: 'saved', file: 'export.json' });
  assert.deepEqual(offered, [{ title: 'Save the export', defaultPath: 'servicebus-full-config-2026-11-19.json', filters: [{ name: 'JSON', extensions: ['json'] }] }]);
  assert.deepEqual(written, [['/home/user/Documents/export.json', '{"connections":[]}']]);
});

test('a save dialog the user cancels writes nothing and is no error', async () => {
  let wrote = false;
  const result = await saveExportFile({ name: 'a.json', content: '{}', showSaveDialog: async () => ({ canceled: true }), writeFile: async () => { wrote = true; } });

  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(wrote, false);
});

test('an export that cannot be written says why, and what is not a text of a sane size is refused before the dialog opens', async () => {
  const failing = await saveExportFile({
    name: 'a.json', content: '{}', showSaveDialog: async () => ({ canceled: false, filePath: '/readonly/a.json' }),
    writeFile: async () => { const err = new Error('EACCES: permission denied'); err.code = 'EACCES'; throw err; }
  });
  assert.deepEqual(failing, { status: 'error', message: 'The file could not be written (EACCES).' });

  let opened = 0;
  const dialog = async () => { opened++; return { canceled: true }; };
  for (const content of [undefined, 42, { a: 1 }, 'x'.repeat(20 * 1024 * 1024 + 1)]) {
    assert.deepEqual(await saveExportFile({ name: 'a.json', content, showSaveDialog: dialog, writeFile: async () => {} }),
      { status: 'error', message: 'There is nothing to write, or it is too large.' });
  }
  assert.equal(opened, 0);
});

test('main.js saves an export only through saveExportFile and the system save dialog', () => {
  const main = require('node:fs').readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('save-export-file', \(event, request\) => saveExportFile\(\{\n  name: request\?\.name, content: request\?\.content,\n  showSaveDialog: \(options\) => dialog\.showSaveDialog\(mainWindow, options\),/);
});


const { createShellLog, captureConsole } = require('./shell-helpers');

test('the shell log keeps a line with its time, level, category and words, and answers only what came after an id', () => {
  const log = createShellLog({ now: () => new Date('2026-11-19T10:40:11Z') });
  log.add('Info', ['[startApi] API process spawned with PID:', 4242]);
  log.add('Warning', ['config.json not found']);

  assert.deepEqual(log.after(0), [
    { id: 1, time: '2026-11-19T10:40:11.000Z', level: 'Info', category: 'startApi', text: 'API process spawned with PID: 4242' },
    { id: 2, time: '2026-11-19T10:40:11.000Z', level: 'Warning', category: '', text: 'config.json not found' }
  ]);
  assert.deepEqual(log.after(1).map(line => line.id), [2]);
  assert.deepEqual(log.after('not a number').map(line => line.id), [1, 2]);

  log.clear();
  assert.deepEqual(log.after(0), []);
  log.add('Info', ['again']);
  assert.deepEqual(log.after(0).map(line => line.id), [3]);
});

test('the shell log never keeps what the API process wrote, the API secret, the home folder, an error text or an object', () => {
  const log = createShellLog({ hidden: [['/home/someone', '~'], ['SENTINEL-SECRET', '***']] });
  log.add('Info', ['[API] info: connection string Endpoint=sb://x;SharedAccessKey=SENTINEL']);
  log.add('Error', ['[API ERROR] Unhandled exception SENTINEL']);
  log.add('Info', ['[startApi] Data path: /home/someone/.config/app key SENTINEL-SECRET']);
  const failure = Object.assign(new Error('SENTINEL in the text'), { code: 'ENOENT' });
  log.add('Error', ['[startApi] Error details:', failure, { password: 'SENTINEL' }]);

  const kept = log.after(0);
  assert.deepEqual(kept.map(line => line.text), ['Data path: ~/.config/app key ***', 'Error details: Error (ENOENT) [object]']);
  assert.doesNotMatch(JSON.stringify(kept), /SENTINEL|someone/);
});

test('the shell log is bounded and cuts a long line', () => {
  const log = createShellLog({ limit: 3 });
  for (let i = 1; i <= 5; i++) log.add('Info', [`line ${i}`]);
  log.add('Info', ['x'.repeat(5000)]);

  const kept = log.after(0);
  assert.deepEqual(kept.map(line => line.id), [4, 5, 6]);
  assert.equal(kept[2].text.length, 1000);
});

test('capturing the console keeps each call at its level and still writes it where it went before', () => {
  const written = [];
  const target = { log: (...args) => written.push(['log', ...args]), warn: (...args) => written.push(['warn', ...args]), error: (...args) => written.push(['error', ...args]) };
  const log = createShellLog();
  captureConsole(target, log);

  target.log('one');
  target.warn('two');
  target.error('three');

  assert.deepEqual(log.after(0).map(line => [line.level, line.text]), [['Info', 'one'], ['Warning', 'two'], ['Error', 'three']]);
  assert.deepEqual(written, [['log', 'one'], ['warn', 'two'], ['error', 'three']]);
});

test('a shell log that fails to keep a line never breaks the console call that carried it', () => {
  const target = { log: () => {}, warn: () => {}, error: () => {} };
  captureConsole(target, { add: () => { throw new Error('full'); } });
  assert.doesNotThrow(() => target.error('still written'));
});

test('main.js asks the API for the tray menu only once the API is healthy, and refreshes the menu when it becomes so', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, 'main.js'), 'utf8');
  assert.match(main, /async function fetchFromAPI\(endpoint\) \{\n  if \(!apiHealthy\) return \[\];/);
  assert.match(main, /apiHealthy = result\.healthy;\n    if \(apiHealthy\) updateTrayMenu\(\);/);
});

test('main.js captures its console into the shell log and answers the two log channels without trusting an argument', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, 'main.js'), 'utf8');
  assert.match(main, /captureConsole\(console, shellLog\)/);
  assert.match(main, /hidden: \[\[app\.getPath\('home'\), '~'\], \[API_SECRET, '\*\*\*'\]\]/);
  assert.match(main, /ipcMain\.handle\('get-shell-logs', \(event, after\) => shellLog\.after\(after\)\)/);
  assert.match(main, /ipcMain\.handle\('clear-shell-logs', \(\) => shellLog\.clear\(\)\)/);
});
