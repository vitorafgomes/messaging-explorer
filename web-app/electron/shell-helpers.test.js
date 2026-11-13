const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSafeExternalUrl,
  normalizeUpdateChannel,
  applyUpdateChannel,
  waitForHealth,
  stopProcess,
  applicationMenuTemplate,
  mainWindowOptions,
  shellShortcut
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
