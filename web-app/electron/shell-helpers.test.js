const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSafeExternalUrl,
  normalizeUpdateChannel,
  applyUpdateChannel,
  waitForHealth,
  stopProcess
} = require('./shell-helpers');

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
