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

function job(name) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `no "${name}" job in release.yml`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z][\w-]*:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('a release runs by hand from main, as a release or a beta, with the version computed from the commits', () => {
  assert.match(workflow, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}kind:/m, 'Run workflow offers the kind of release');
  assert.match(workflow, /options: \[release, prerelease\]/);
  assert.match(job('check'), /bash tools\/release\/next-version\.sh "\$\{args\[@\]\}"/, 'the version comes from tools/release/next-version.sh');
  assert.match(job('check'), /args=\(prerelease beta\)/, 'a prerelease is a beta, so the updater writes beta*.yml');
});

test('every build stamps the computed version into package.json before electron-builder runs', () => {
  for (const [name, os] of [['build-linux', 'linux'], ['build-windows', 'win'], ['build-mac', 'mac']]) {
    const steps = job(name);
    const stamp = steps.indexOf('npm pkg set version="$VERSION"');
    const build = steps.indexOf(`npm run electron:build:${os}`);
    assert.notEqual(stamp, -1, `${name} does not set the version, so electron-builder writes the version of main into ${os} metadata`);
    assert.ok(stamp < build, `${name} sets the version after packaging`);
    assert.match(steps, /VERSION: \$\{\{ needs\.check\.outputs\.version \}\}/, `${name} takes the version from the check job`);
  }
});

test('only the publish job can write, and it creates the tag on the commit it built', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read$/m, 'the workflow token is read-only');
  assert.match(job('publish'), /permissions:\n {6}contents: write/);
  assert.match(job('publish'), /gh release create "\$TAG" --target "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /secrets\.(?!GITHUB_TOKEN)/, 'no secret other than the workflow token: a tag pushed with a personal token would start a second release');
});

test('a beta is published as a prerelease, so stable updaters keep reading the latest stable release', () => {
  const check = job('check');
  assert.match(check, /prerelease\) args=\(prerelease beta\); prerelease=true;/, 'a dispatched prerelease is flagged');
  assert.equal((check.match(/prerelease=true/g) || []).length, 1, 'only the prerelease kind sets the flag');
  assert.match(check, /shape='\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+-beta\\\.\[0-9\]\+\$'/, 'a prerelease override must be X.Y.Z-beta.N: the updater has no other channel');
  assert.match(check, /=~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-beta\\\.\[0-9\]\+\)\?\$ \]\]/, 'a pushed tag must be vX.Y.Z or vX.Y.Z-beta.N');
  const publish = job('publish');
  assert.match(publish, /if \[ "\$PRERELEASE" = true \]; then flags\+=\(--prerelease\); fi/, 'a dispatched beta is created as a prerelease');
  assert.match(publish, /if \[\[ "\$TAG" == \*-\* \]\]; then flags\+=\(--prerelease\); fi/, 'a pushed beta tag is created as a prerelease');
});
