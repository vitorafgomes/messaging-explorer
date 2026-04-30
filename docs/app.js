(() => {
  const REPO = 'vitorafgomes/messaging-explorer';
  const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
  const CACHE_KEY = 'me-latest-release';
  const CACHE_TTL_MS = 10 * 60 * 1000;

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const platformBuckets = {
    windows: {
      patterns: [
        { regex: /Setup.*\.exe$/i, label: 'Installer (.exe)', primary: true },
        { regex: /\.exe$/i, label: 'Portable (.exe)' },
      ],
    },
    macos: {
      patterns: [
        { regex: /\.dmg$/i, label: 'Disk image (.dmg)', primary: true },
        { regex: /mac.*\.zip$/i, label: 'Archive (.zip)' },
      ],
    },
    linux: {
      patterns: [
        { regex: /\.AppImage$/i, label: 'AppImage', primary: true },
        { regex: /\.deb$/i, label: 'Debian package (.deb)' },
      ],
    },
  };

  function formatBytes(bytes) {
    if (!bytes) return '';
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
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }

  function getCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.fetchedAt || !parsed.data) return null;
      if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  function setCached(data) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data, fetchedAt: Date.now() })
      );
    } catch {
      // noop
    }
  }

  async function fetchLatestRelease() {
    const cached = getCached();
    if (cached) return cached;

    const response = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      throw new Error(`GitHub API responded ${response.status}`);
    }
    const data = await response.json();
    setCached(data);
    return data;
  }

  function pickAssets(assets, patterns) {
    const used = new Set();
    return patterns
      .map(({ regex, label, primary }) => {
        const match = assets.find(
          (a) => !used.has(a.name) && regex.test(a.name)
        );
        if (match) {
          used.add(match.name);
          return { ...match, label, primary: !!primary };
        }
        return null;
      })
      .filter(Boolean);
  }

  function renderPlatform(platformKey, assets) {
    const container = document.querySelector(`[data-downloads="${platformKey}"]`);
    if (!container) return;

    const matched = pickAssets(assets, platformBuckets[platformKey].patterns);

    if (matched.length === 0) {
      container.innerHTML =
        '<p class="empty">No download available for this platform yet.</p>';
      return;
    }

    container.innerHTML = matched
      .map(
        (asset) => `
          <a class="btn btn-download" href="${asset.browser_download_url}" rel="noopener">
            <span class="download-label">
              <span class="download-name">${asset.label}</span>
              <span class="download-size">${formatBytes(asset.size)}</span>
            </span>
            <span class="download-arrow" aria-hidden="true">↓</span>
          </a>
        `
      )
      .join('');
  }

  function renderVersion(release) {
    const tag = release.tag_name || release.name || '';
    const date = formatDate(release.published_at);

    document.querySelectorAll('[data-latest-version]').forEach((el) => {
      el.textContent = tag || 'unreleased';
    });

    const dateEl = document.querySelector('[data-latest-date]');
    if (dateEl && date) {
      dateEl.textContent = `(released ${date})`;
    }
  }

  function renderError(message) {
    document.querySelectorAll('[data-latest-version]').forEach((el) => {
      el.textContent = 'see GitHub';
    });
    document.querySelectorAll('.platform-downloads').forEach((el) => {
      el.innerHTML = `<p class="empty">${message}<br />
        <a href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">View all releases</a></p>`;
    });
  }

  async function init() {
    try {
      const release = await fetchLatestRelease();
      if (!release || !Array.isArray(release.assets)) {
        renderError('No releases yet — check back soon.');
        return;
      }
      renderVersion(release);
      Object.keys(platformBuckets).forEach((p) =>
        renderPlatform(p, release.assets)
      );
    } catch (err) {
      console.error('Failed to load latest release:', err);
      renderError('Could not load downloads. Visit GitHub Releases for assets.');
    }
  }

  init();
})();
