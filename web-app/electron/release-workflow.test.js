const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/release.yml'), 'utf8');

function uploadGlobs(os) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: Upload ${os} artifacts`);
  assert.notEqual(start, -1, `no "Upload ${os} artifacts" step in release.yml`);
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('if-no-files-found:')) break;
    if (line.trim().startsWith('web-app/release/')) globs.push(line.trim());
  }
  assert.ok(globs.length > 0, `no web-app/release/ paths in "Upload ${os} artifacts"`);
  return globs;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function uploaded(os, files) {
  const patterns = uploadGlobs(os).map(globToRegExp);
  return files.filter((name) => patterns.some((pattern) => pattern.test(`web-app/release/${name}`))).sort();
}

const DEBUG_FILES = ['builder-debug.yml', 'builder-effective-config.yaml'];

const BUILDS = {
  Linux: (version, channel) => [
    `Messaging-Explorer-${version}-x86_64.AppImage`,
    `Messaging-Explorer-${version}-amd64.deb`,
    `${channel}-linux.yml`
  ],
  Windows: (version, channel) => [
    `Messaging-Explorer-Setup-${version}-x64.exe`,
    `Messaging-Explorer-Setup-${version}-x64.exe.blockmap`,
    `Messaging-Explorer-Portable-${version}-x64.exe`,
    `${channel}.yml`
  ],
  macOS: (version, channel) => [
    `Messaging-Explorer-${version}-arm64.dmg`,
    `Messaging-Explorer-${version}-arm64.dmg.blockmap`,
    `Messaging-Explorer-${version}-x64.dmg`,
    `Messaging-Explorer-${version}-x64.dmg.blockmap`,
    `Messaging-Explorer-${version}-arm64.zip`,
    `Messaging-Explorer-${version}-arm64.zip.blockmap`,
    `Messaging-Explorer-${version}-x64.zip`,
    `Messaging-Explorer-${version}-x64.zip.blockmap`,
    `${channel}-mac.yml`
  ]
};

const RELEASES = [
  { kind: 'stable', version: '2.4.0', channel: 'latest' },
  { kind: 'beta', version: '2.4.0-beta.1', channel: 'beta' }
];

function releaseDir(os, { version, channel }) {
  return [...BUILDS[os](version, channel), ...DEBUG_FILES];
}

test('a stable release uploads latest*.yml and the packages for every OS', () => {
  const stable = RELEASES[0];
  for (const os of Object.keys(BUILDS)) {
    assert.deepEqual(uploaded(os, releaseDir(os, stable)), BUILDS[os](stable.version, stable.channel).sort(), `${os} stable`);
  }
});

test('a beta release uploads beta*.yml for every OS', () => {
  const beta = RELEASES[1];
  for (const os of Object.keys(BUILDS)) {
    assert.deepEqual(uploaded(os, releaseDir(os, beta)), BUILDS[os](beta.version, beta.channel).sort(), `${os} beta`);
  }
});

test('a release uploads the .blockmap files of the Windows installer and the macOS packages', () => {
  for (const release of RELEASES) {
    for (const os of ['Windows', 'macOS']) {
      const blockmaps = BUILDS[os](release.version, release.channel).filter((name) => name.endsWith('.blockmap')).sort();
      const uploadedBlockmaps = uploaded(os, releaseDir(os, release)).filter((name) => name.endsWith('.blockmap'));
      assert.deepEqual(uploadedBlockmaps, blockmaps, `${os} ${release.kind}`);
    }
  }
});

test('builder debug files are never uploaded', () => {
  for (const release of RELEASES) {
    for (const os of Object.keys(BUILDS)) {
      const leaked = uploaded(os, releaseDir(os, release)).filter((name) => DEBUG_FILES.includes(name));
      assert.deepEqual(leaked, [], `${os} ${release.kind}`);
    }
  }
});
