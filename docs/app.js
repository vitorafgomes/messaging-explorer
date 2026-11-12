'use strict';

const API_URL = 'https://api.github.com/repos/vitorafgomes/messaging-explorer/releases/latest';
const DOWNLOAD_PREFIX = 'https://github.com/vitorafgomes/messaging-explorer/releases/download/';
const CACHE_KEY = 'me-latest-release';
const CACHE_TTL_MS = 10 * 60 * 1000;

// Every pattern is anchored at the end of the name: that is what keeps
// "<file>.blockmap" and the update metadata out.
const SLOTS = [
  { slot: 'windows-installer', platform: 'windows', pattern: /-Setup-.*\.exe$/i },
  { slot: 'windows-portable', platform: 'windows', pattern: /-Portable-.*\.exe$/i },
  { slot: 'macos-arm64', platform: 'macos', pattern: /-arm64\.dmg$/i },
  { slot: 'macos-x64', platform: 'macos', pattern: /-x64\.dmg$/i },
  { slot: 'linux-appimage', platform: 'linux', pattern: /\.AppImage$/i },
  { slot: 'linux-deb', platform: 'linux', pattern: /\.deb$/i },
];

const HERO = {
  windows: { label: 'Download for Windows', slot: 'windows-installer' },
  linux: { label: 'Download for Linux', slot: 'linux-appimage' },
  'macos-arm64': { label: 'Download for macOS (Apple silicon)', slot: 'macos-arm64' },
  'macos-x64': { label: 'Download for macOS (Intel)', slot: 'macos-x64' },
  macos: { label: 'Download for macOS', slot: null },
};

function isAllowedHref(url) {
  if (typeof url !== 'string' || !url.startsWith(DOWNLOAD_PREFIX)) return false;
  try {
    // The parser resolves "../" and "%2e%2e", which the prefix check alone would let through.
    return new URL(url).href.startsWith(DOWNLOAD_PREFIX);
  } catch {
    return false;
  }
}

function pickAssets(assets) {
  const picks = { windows: [], macos: [], linux: [] };
  if (!Array.isArray(assets)) return picks;
  for (const { slot, platform, pattern } of SLOTS) {
    const match = assets.find(
      (a) => a && typeof a.name === 'string' && pattern.test(a.name) && isAllowedHref(a.browser_download_url)
    );
    if (match) {
      picks[platform].push({ slot, name: match.name, url: match.browser_download_url, size: match.size });
    }
  }
  return picks;
}

function detectSystem(input) {
  const { userAgent = '', platform = '', architecture = '' } = input || {};
  const text = `${platform} ${userAgent}`;
  let os = null;
  if (/Android|iPhone|iPad|iPod|CrOS|Chrome OS/i.test(text)) os = null;
  else if (/Windows|Win32|Win64/i.test(text)) os = 'windows';
  else if (/Macintosh|macOS|Mac OS/i.test(text)) os = 'macos';
  else if (/Linux|X11/i.test(text)) os = 'linux';

  let arch = null;
  if (architecture === 'arm') arch = 'arm64';
  else if (architecture === 'x86') arch = 'x64';
  return { os, arch };
}

function heroTarget(system, picks) {
  const key = system.os === 'macos' && system.arch ? `macos-${system.arch}` : system.os;
  const entry = HERO[key] || { label: 'Download', slot: null };
  const all = [...picks.windows, ...picks.macos, ...picks.linux];
  const pick = all.find((p) => p.slot === entry.slot);
  return { label: entry.label, href: pick ? pick.url : '#download' };
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !(bytes > 0)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso) {
  const date = new Date(typeof iso === 'string' && iso ? iso : NaN);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function versionLine(release) {
  const date = formatDate(release.published_at);
  return date ? `${release.tag_name}, released ${date}` : release.tag_name;
}

function slimRelease(data) {
  if (!data || typeof data.tag_name !== 'string' || !Array.isArray(data.assets)) return null;
  return {
    tag_name: data.tag_name,
    published_at: data.published_at,
    assets: data.assets
      .filter((a) => a && typeof a.name === 'string')
      .map((a) => ({ name: a.name, browser_download_url: a.browser_download_url, size: a.size })),
  };
}

function readCache(raw, now) {
  try {
    const parsed = JSON.parse(raw);
    const release = slimRelease(parsed && parsed.data);
    if (!release || typeof parsed.fetchedAt !== 'number') return null;
    const age = now - parsed.fetchedAt;
    return { release, fresh: age >= 0 && age <= CACHE_TTL_MS };
  } catch {
    return null;
  }
}

async function loadRelease({ now, read, write, fetchJson }) {
  let cached = null;
  try {
    cached = readCache(read(), now());
  } catch {
    cached = null;
  }
  if (cached && cached.fresh) return cached.release;

  try {
    const release = slimRelease(await fetchJson());
    if (!release) throw new Error('not a release');
    try {
      write(JSON.stringify({ data: release, fetchedAt: now() }));
    } catch {
      // A full or disabled storage only costs the next visit one more request.
    }
    return release;
  } catch {
    return cached ? cached.release : null;
  }
}

function boot() {
  const uaData = navigator.userAgentData;
  let system = detectSystem({ userAgent: navigator.userAgent, platform: uaData && uaData.platform });
  let picks = pickAssets([]);

  function showSystem() {
    document.querySelectorAll('[data-platform]').forEach((card) => {
      const yours = card.getAttribute('data-platform') === system.os;
      card.classList.toggle('is-yours', yours);
      const badge = card.querySelector('[data-yours]');
      if (badge) badge.hidden = !yours;
    });
    ['arm64', 'x64'].forEach((arch) => {
      const link = document.querySelector(`[data-asset="macos-${arch}"]`);
      if (link) link.classList.toggle('file-primary', !system.arch || system.arch === arch);
    });
    const target = heroTarget(system, picks);
    const cta = document.querySelector('[data-hero-cta]');
    const label = document.querySelector('[data-hero-label]');
    if (cta) cta.setAttribute('href', target.href);
    if (label) label.textContent = target.label;
  }

  function showRelease(release) {
    const found = pickAssets(release.assets);
    const all = [...found.windows, ...found.macos, ...found.linux];
    if (all.length === 0) return;
    picks = found;
    all.forEach((pick) => {
      const link = document.querySelector(`[data-asset="${pick.slot}"]`);
      if (!link) return;
      link.setAttribute('href', pick.url);
      const size = link.querySelector('[data-size]');
      if (size) size.textContent = formatBytes(pick.size);
    });
    document.querySelectorAll('[data-version]').forEach((el) => {
      el.textContent = versionLine(release);
    });
    showSystem();
  }

  showSystem();

  if (system.os === 'macos' && uaData && typeof uaData.getHighEntropyValues === 'function') {
    uaData
      .getHighEntropyValues(['architecture'])
      .then((values) => {
        system = detectSystem({ userAgent: navigator.userAgent, platform: uaData.platform, architecture: values.architecture });
        showSystem();
      })
      .catch(() => {});
  }

  loadRelease({
    now: () => Date.now(),
    read: () => localStorage.getItem(CACHE_KEY),
    write: (raw) => localStorage.setItem(CACHE_KEY, raw),
    fetchJson: async () => {
      const response = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
      return response.json();
    },
  }).then((release) => {
    if (release) showRelease(release);
  });
}

if (typeof document !== 'undefined') {
  boot();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAllowedHref,
    pickAssets,
    detectSystem,
    heroTarget,
    formatBytes,
    formatDate,
    versionLine,
    slimRelease,
    readCache,
    loadRelease,
  };
}
