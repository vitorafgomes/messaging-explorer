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

module.exports = { isSafeExternalUrl, normalizeUpdateChannel, waitForHealth, stopProcess };
