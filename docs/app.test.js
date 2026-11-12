'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./app.js');

const BASE = 'https://github.com/vitorafgomes/messaging-explorer/releases/download/';

function assetsOf(tag, names) {
  return names.map((name, i) => ({
    name,
    browser_download_url: `${BASE}${tag}/${name}`,
    size: 1000 + i,
  }));
}

const V240_NAMES = [
  'Messaging-Explorer-Setup-2.4.0-x64.exe',
  'Messaging-Explorer-Setup-2.4.0-x64.exe.blockmap',
  'Messaging-Explorer-Portable-2.4.0-x64.exe',
  'Messaging-Explorer-2.4.0-arm64.dmg',
  'Messaging-Explorer-2.4.0-arm64.dmg.blockmap',
  'Messaging-Explorer-2.4.0-x64.dmg',
  'Messaging-Explorer-2.4.0-x64.dmg.blockmap',
  'Messaging-Explorer-2.4.0-arm64.zip',
  'Messaging-Explorer-2.4.0-arm64.zip.blockmap',
  'Messaging-Explorer-2.4.0-x64.zip',
  'Messaging-Explorer-2.4.0-x64.zip.blockmap',
  'Messaging-Explorer-2.4.0-x86_64.AppImage',
  'Messaging-Explorer-2.4.0-amd64.deb',
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
];

const names = (items) => items.map((item) => item.name);
const slots = (items) => items.map((item) => item.slot);

test('the v2.4.0 assets yield exactly the six expected files in order', () => {
  const picks = app.pickAssets(assetsOf('v2.4.0', V240_NAMES));
  assert.deepEqual(names(picks.windows), [
    'Messaging-Explorer-Setup-2.4.0-x64.exe',
    'Messaging-Explorer-Portable-2.4.0-x64.exe',
  ]);
  assert.deepEqual(names(picks.macos), [
    'Messaging-Explorer-2.4.0-arm64.dmg',
    'Messaging-Explorer-2.4.0-x64.dmg',
  ]);
  assert.deepEqual(names(picks.linux), [
    'Messaging-Explorer-2.4.0-x86_64.AppImage',
    'Messaging-Explorer-2.4.0-amd64.deb',
  ]);
  assert.deepEqual(
    [...slots(picks.windows), ...slots(picks.macos), ...slots(picks.linux)],
    ['windows-installer', 'windows-portable', 'macos-arm64', 'macos-x64', 'linux-appimage', 'linux-deb']
  );
  assert.equal(picks.windows[0].url, `${BASE}v2.4.0/Messaging-Explorer-Setup-2.4.0-x64.exe`);
  assert.equal(picks.windows[0].size, 1000);
});

test('the asset order in the release does not change which file fills which slot', () => {
  const picks = app.pickAssets(assetsOf('v2.4.0', [...V240_NAMES].reverse()));
  assert.deepEqual(slots(picks.macos), ['macos-arm64', 'macos-x64']);
  assert.equal(picks.macos[0].name, 'Messaging-Explorer-2.4.0-arm64.dmg');
  assert.equal(picks.macos[1].name, 'Messaging-Explorer-2.4.0-x64.dmg');
  assert.equal(picks.windows[0].name, 'Messaging-Explorer-Setup-2.4.0-x64.exe');
});

test('a beta-style release still yields the six files', () => {
  const beta = V240_NAMES
    .filter((name) => !name.endsWith('.yml'))
    .map((name) => name.replace('2.4.0', '2.5.0-beta.1'))
    .concat(['beta.yml', 'beta-mac.yml', 'beta-linux.yml', 'latest.yml']);
  const picks = app.pickAssets(assetsOf('v2.5.0-beta.1', beta));
  assert.deepEqual(names(picks.windows), [
    'Messaging-Explorer-Setup-2.5.0-beta.1-x64.exe',
    'Messaging-Explorer-Portable-2.5.0-beta.1-x64.exe',
  ]);
  assert.deepEqual(names(picks.macos), [
    'Messaging-Explorer-2.5.0-beta.1-arm64.dmg',
    'Messaging-Explorer-2.5.0-beta.1-x64.dmg',
  ]);
  assert.deepEqual(names(picks.linux), [
    'Messaging-Explorer-2.5.0-beta.1-x86_64.AppImage',
    'Messaging-Explorer-2.5.0-beta.1-amd64.deb',
  ]);
});

test('a block map is never picked', () => {
  const picks = app.pickAssets(assetsOf('v2.4.0', V240_NAMES.filter((n) => n.endsWith('.blockmap'))));
  assert.deepEqual(picks, { windows: [], macos: [], linux: [] });
});

test('update metadata (.yml) is never picked', () => {
  const picks = app.pickAssets(
    assetsOf('v2.4.0', ['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'beta.yml', 'Setup-x64.exe.yml', 'arm64.dmg.yml'])
  );
  assert.deepEqual(picks, { windows: [], macos: [], linux: [] });
});

test('a .zip is never picked', () => {
  const picks = app.pickAssets(
    assetsOf('v2.4.0', ['Messaging-Explorer-2.4.0-arm64.zip', 'Messaging-Explorer-2.4.0-x64.zip', 'Messaging-Explorer-2.4.0-mac.zip'])
  );
  assert.deepEqual(picks, { windows: [], macos: [], linux: [] });
});

test('a release with a platform missing yields an empty pick for it', () => {
  const noMac = V240_NAMES.filter((n) => !n.includes('.dmg') && !n.includes('.zip'));
  const picks = app.pickAssets(assetsOf('v2.4.0', noMac));
  assert.deepEqual(picks.macos, []);
  assert.equal(picks.windows.length, 2);
  assert.equal(picks.linux.length, 2);
});

test('a release with only the Intel dmg leaves the Apple silicon slot unfilled', () => {
  const picks = app.pickAssets(assetsOf('v2.4.0', ['Messaging-Explorer-2.4.0-x64.dmg']));
  assert.deepEqual(slots(picks.macos), ['macos-x64']);
});

test('an asset whose URL is not a download of this repository is not picked', () => {
  const picks = app.pickAssets([
    { name: 'Messaging-Explorer-Setup-2.4.0-x64.exe', browser_download_url: 'https://example.org/Setup-x64.exe', size: 1 },
    { name: 'Messaging-Explorer-2.4.0-x86_64.AppImage', browser_download_url: 'javascript:alert(1)', size: 1 },
  ]);
  assert.deepEqual(picks, { windows: [], macos: [], linux: [] });
});

test('pickAssets survives input that is not a list of assets', () => {
  const empty = { windows: [], macos: [], linux: [] };
  assert.deepEqual(app.pickAssets(undefined), empty);
  assert.deepEqual(app.pickAssets('nope'), empty);
  assert.deepEqual(app.pickAssets([null, 7, {}, { name: 5 }]), empty);
});

test('the allow-list accepts only release downloads of this repository', () => {
  assert.equal(app.isAllowedHref(`${BASE}v2.4.0/Messaging-Explorer-2.4.0-x64.dmg`), true);
  assert.equal(app.isAllowedHref('javascript:alert(1)'), false);
  assert.equal(app.isAllowedHref('https://example.org/releases/download/v1/a.exe'), false);
  assert.equal(app.isAllowedHref('https://github.com/someone-else/messaging-explorer/releases/download/v1/a.exe'), false);
  assert.equal(app.isAllowedHref('https://github.com.example.org/vitorafgomes/messaging-explorer/releases/download/v1/a.exe'), false);
  assert.equal(app.isAllowedHref(BASE.replace('https:', 'http:') + 'v1/a.exe'), false);
  assert.equal(app.isAllowedHref(` ${BASE}v1/a.exe`.replace(' https', ' javascript:https')), false);
  assert.equal(app.isAllowedHref(undefined), false);
  assert.equal(app.isAllowedHref(null), false);
  assert.equal(app.isAllowedHref({ toString: () => `${BASE}v1/a.exe` }), false);
});

test('the allow-list refuses a path that climbs out of the downloads folder', () => {
  assert.equal(app.isAllowedHref(`${BASE}../../../../someone-else/repo/releases/download/v1/a.exe`), false);
  assert.equal(app.isAllowedHref(`${BASE}%2e%2e/%2e%2e/%2e%2e/%2e%2e/someone-else/a.exe`), false);
});

test('system detection: Windows', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  assert.deepEqual(app.detectSystem({ userAgent: ua }), { os: 'windows', arch: null });
  assert.deepEqual(app.detectSystem({ platform: 'Windows', userAgent: '' }), { os: 'windows', arch: null });
});

test('system detection: macOS, with the architecture only when the browser tells it', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  assert.deepEqual(app.detectSystem({ userAgent: safari }), { os: 'macos', arch: null });
  assert.deepEqual(app.detectSystem({ userAgent: safari, platform: 'macOS', architecture: 'arm' }), { os: 'macos', arch: 'arm64' });
  assert.deepEqual(app.detectSystem({ userAgent: safari, platform: 'macOS', architecture: 'x86' }), { os: 'macos', arch: 'x64' });
  assert.deepEqual(app.detectSystem({ userAgent: safari, platform: 'macOS', architecture: '' }), { os: 'macos', arch: null });
});

test('system detection: Linux', () => {
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
  assert.deepEqual(app.detectSystem({ userAgent: firefox }), { os: 'linux', arch: null });
  assert.deepEqual(app.detectSystem({ platform: 'Linux' }), { os: 'linux', arch: null });
});

test('system detection: unknown and mobile systems get no platform', () => {
  const none = { os: null, arch: null };
  assert.deepEqual(app.detectSystem(undefined), none);
  assert.deepEqual(app.detectSystem({}), none);
  assert.deepEqual(app.detectSystem({ userAgent: 'curl/8.5.0' }), none);
  assert.deepEqual(app.detectSystem({ userAgent: 'Mozilla/5.0 (Unknown; Darwin) Something/1.0' }), none);
  assert.deepEqual(
    app.detectSystem({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' }),
    none
  );
  assert.deepEqual(
    app.detectSystem({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }),
    none
  );
  assert.deepEqual(
    app.detectSystem({ platform: 'Chrome OS', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' }),
    none
  );
});

test('the hero button names the system and points at its primary file', () => {
  const picks = app.pickAssets(assetsOf('v2.4.0', V240_NAMES));
  assert.deepEqual(app.heroTarget({ os: 'windows', arch: null }, picks), {
    label: 'Download for Windows',
    href: `${BASE}v2.4.0/Messaging-Explorer-Setup-2.4.0-x64.exe`,
  });
  assert.deepEqual(app.heroTarget({ os: 'linux', arch: null }, picks), {
    label: 'Download for Linux',
    href: `${BASE}v2.4.0/Messaging-Explorer-2.4.0-x86_64.AppImage`,
  });
  assert.deepEqual(app.heroTarget({ os: 'macos', arch: 'arm64' }, picks), {
    label: 'Download for macOS (Apple silicon)',
    href: `${BASE}v2.4.0/Messaging-Explorer-2.4.0-arm64.dmg`,
  });
  assert.deepEqual(app.heroTarget({ os: 'macos', arch: 'x64' }, picks), {
    label: 'Download for macOS (Intel)',
    href: `${BASE}v2.4.0/Messaging-Explorer-2.4.0-x64.dmg`,
  });
});

test('the hero button sends the visitor to the download section when one file cannot be chosen', () => {
  const picks = app.pickAssets(assetsOf('v2.4.0', V240_NAMES));
  const none = { windows: [], macos: [], linux: [] };
  assert.deepEqual(app.heroTarget({ os: 'macos', arch: null }, picks), { label: 'Download for macOS', href: '#download' });
  assert.deepEqual(app.heroTarget({ os: null, arch: null }, picks), { label: 'Download', href: '#download' });
  assert.deepEqual(app.heroTarget({ os: 'windows', arch: null }, none), { label: 'Download for Windows', href: '#download' });
  assert.deepEqual(app.heroTarget({ os: 'macos', arch: 'arm64' }, none), {
    label: 'Download for macOS (Apple silicon)',
    href: '#download',
  });
});

test('formatBytes', () => {
  assert.equal(app.formatBytes(0), '');
  assert.equal(app.formatBytes(undefined), '');
  assert.equal(app.formatBytes('12'), '');
  assert.equal(app.formatBytes(-5), '');
  assert.equal(app.formatBytes(512), '512 B');
  assert.equal(app.formatBytes(1536), '1.5 KB');
  assert.equal(app.formatBytes(98 * 1024 * 1024), '98 MB');
  assert.equal(app.formatBytes(1.25 * 1024 * 1024 * 1024), '1.3 GB');
});

test('formatDate', () => {
  assert.equal(app.formatDate('2026-11-12T09:30:00Z'), '12 Nov 2026');
  assert.equal(app.formatDate('2026-01-01T00:00:00Z'), '1 Jan 2026');
  assert.equal(app.formatDate('not a date'), '');
  assert.equal(app.formatDate(''), '');
  assert.equal(app.formatDate(undefined), '');
});

test('the version line states the version and the date when both are known', () => {
  assert.equal(app.versionLine({ tag_name: 'v2.4.0', published_at: '2026-11-12T09:30:00Z' }), 'v2.4.0, released 12 Nov 2026');
  assert.equal(app.versionLine({ tag_name: 'v2.4.0', published_at: null }), 'v2.4.0');
});

test('slimRelease keeps only the fields the page uses and refuses what is not a release', () => {
  const slim = app.slimRelease({
    tag_name: 'v2.4.0',
    published_at: '2026-11-12T09:30:00Z',
    body: 'notes',
    assets: [{ name: 'a.deb', browser_download_url: `${BASE}v2.4.0/a.deb`, size: 5, uploader: { login: 'x' } }, null],
  });
  assert.deepEqual(slim, {
    tag_name: 'v2.4.0',
    published_at: '2026-11-12T09:30:00Z',
    assets: [{ name: 'a.deb', browser_download_url: `${BASE}v2.4.0/a.deb`, size: 5 }],
  });
  assert.equal(app.slimRelease(null), null);
  assert.equal(app.slimRelease('<html>'), null);
  assert.equal(app.slimRelease({ message: 'API rate limit exceeded' }), null);
  assert.equal(app.slimRelease({ tag_name: 'v1', assets: 'none' }), null);
  assert.equal(app.slimRelease({ tag_name: 7, assets: [] }), null);
});

const RELEASE = {
  tag_name: 'v2.4.0',
  published_at: '2026-11-12T09:30:00Z',
  assets: [{ name: 'a.deb', browser_download_url: `${BASE}v2.4.0/a.deb`, size: 5 }],
};
const NOW = 1_800_000_000_000;
const cacheEntry = (ageMs) => JSON.stringify({ data: RELEASE, fetchedAt: NOW - ageMs });

test('a cached answer is fresh for ten minutes and stale after', () => {
  assert.deepEqual(app.readCache(cacheEntry(0), NOW), { release: RELEASE, fresh: true });
  assert.deepEqual(app.readCache(cacheEntry(10 * 60 * 1000), NOW), { release: RELEASE, fresh: true });
  assert.deepEqual(app.readCache(cacheEntry(10 * 60 * 1000 + 1), NOW), { release: RELEASE, fresh: false });
  assert.deepEqual(app.readCache(cacheEntry(-60 * 1000), NOW), { release: RELEASE, fresh: false });
});

test('a cache entry that cannot be read is ignored', () => {
  assert.equal(app.readCache(null, NOW), null);
  assert.equal(app.readCache('', NOW), null);
  assert.equal(app.readCache('{not json', NOW), null);
  assert.equal(app.readCache(JSON.stringify({ data: RELEASE }), NOW), null);
  assert.equal(app.readCache(JSON.stringify({ data: { message: 'rate limited' }, fetchedAt: NOW }), NOW), null);
});

function fakeDeps(overrides) {
  const calls = { fetch: 0, written: [] };
  const deps = {
    now: () => NOW,
    read: () => null,
    write: (raw) => calls.written.push(raw),
    fetchJson: async () => {
      calls.fetch += 1;
      return RELEASE;
    },
    ...overrides,
  };
  return { deps, calls };
}

test('a fresh cached answer is used without a request', async () => {
  const { deps, calls } = fakeDeps({ read: () => cacheEntry(60 * 1000) });
  deps.fetchJson = async () => {
    calls.fetch += 1;
    throw new Error('must not be called');
  };
  assert.deepEqual(await app.loadRelease(deps), RELEASE);
  assert.equal(calls.fetch, 0);
});

test('a successful request is cached with the time it was made', async () => {
  const { deps, calls } = fakeDeps({});
  assert.deepEqual(await app.loadRelease(deps), RELEASE);
  assert.equal(calls.fetch, 1);
  assert.deepEqual(JSON.parse(calls.written[0]), { data: RELEASE, fetchedAt: NOW });
});

test('when the request fails a stale cached answer is used, after exactly one request', async () => {
  const { deps, calls } = fakeDeps({ read: () => cacheEntry(3 * 60 * 60 * 1000) });
  deps.fetchJson = async () => {
    calls.fetch += 1;
    throw new TypeError('Failed to fetch');
  };
  assert.deepEqual(await app.loadRelease(deps), RELEASE);
  assert.equal(calls.fetch, 1);
  assert.deepEqual(calls.written, []);
});

test('when the request fails and nothing is cached there is no release, after exactly one request', async () => {
  const { deps, calls } = fakeDeps({});
  deps.fetchJson = async () => {
    calls.fetch += 1;
    throw new TypeError('Failed to fetch');
  };
  assert.equal(await app.loadRelease(deps), null);
  assert.equal(calls.fetch, 1);
});

test('an answer that is not a release (rate limit body, HTML) counts as a failure', async () => {
  const stale = fakeDeps({ read: () => cacheEntry(3 * 60 * 60 * 1000), fetchJson: async () => ({ message: 'API rate limit exceeded' }) });
  assert.deepEqual(await app.loadRelease(stale.deps), RELEASE);
  assert.deepEqual(stale.calls.written, []);
  const empty = fakeDeps({ fetchJson: async () => '<html>' });
  assert.equal(await app.loadRelease(empty.deps), null);
});

test('a storage that throws does not stop the release from loading', async () => {
  const { deps } = fakeDeps({
    read: () => {
      throw new Error('SecurityError');
    },
    write: () => {
      throw new Error('QuotaExceededError');
    },
  });
  assert.deepEqual(await app.loadRelease(deps), RELEASE);
});
