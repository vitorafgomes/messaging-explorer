const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadPreload() {
  const exposed = {};
  const listened = [];
  const invoked = [];
  const invokedArgs = [];
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: { invoke: (channel, ...args) => { invoked.push(channel); invokedArgs.push(args); return Promise.resolve(); }, on: (channel) => { listened.push(channel); } }
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? fakeElectron : originalLoad.call(this, request, ...rest);
  };
  const preloadPath = path.join(__dirname, 'preload.js');
  delete require.cache[preloadPath];
  const originalLog = console.log;
  console.log = () => {};
  try {
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    console.log = originalLog;
  }
  return { exposed, listened, invoked, invokedArgs };
}

test('the preload exposes only window.electronAPI, with no generic channel listener', () => {
  const { exposed } = loadPreload();
  assert.deepEqual(Object.keys(exposed), ['electronAPI']);
});

test('the preload exposes no listener for a channel the removed menu sent', () => {
  const { exposed, listened } = loadPreload();
  const api = exposed.electronAPI;
  for (const member of Object.keys(api).filter((k) => typeof api[k] === 'function' && k.startsWith('on'))) {
    api[member](() => {});
  }
  assert.deepEqual(listened.sort(), ['change-connection', 'navigate', 'update-status']);
  assert.equal('onToggleDevMode' in api, false);
  assert.equal('onClearAllData' in api, false);
  assert.equal('onNewConnection' in api, false);
});

test('getSelfUpdateBlocker reads the get-self-update-blocker channel and sends nothing with it', () => {
  const { exposed, invoked } = loadPreload();
  exposed.electronAPI.getSelfUpdateBlocker();
  assert.deepEqual(invoked, ['get-self-update-blocker']);
});

test('getDataFile and showDataFile read their channels and send no argument, so the renderer cannot name a path', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.getDataFile('/etc/passwd');
  exposed.electronAPI.showDataFile('/etc/passwd');
  assert.deepEqual(invoked, ['get-data-file', 'show-data-file']);
  assert.deepEqual(invokedArgs, [[], []]);
});

test('openDevTools reads the open-dev-tools channel and sends no argument, so the renderer cannot choose which window', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.openDevTools('another-window');
  assert.deepEqual(invoked, ['open-dev-tools'], 'openDevTools must invoke open-dev-tools');
  assert.deepEqual(invokedArgs, [[]], 'openDevTools must send no argument');
});

test('listUpdateVersions reads the list-update-versions channel and sends no argument, so the renderer cannot name an address or a repository', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.listUpdateVersions('https://example.org/releases', 'someone/else');
  assert.deepEqual(invoked, ['list-update-versions']);
  assert.deepEqual(invokedArgs, [[]]);
});

test('installUpdateVersion sends only a version and the agreement on the install-update-version channel, so the renderer cannot name an address', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.installUpdateVersion('2.4.3', true, 'https://example.org/package');
  assert.deepEqual(invoked, ['install-update-version']);
  assert.deepEqual(invokedArgs, [[{ version: '2.4.3', agreed: true }]]);
});

test('saveExportFile sends a file name and the text on the save-export-file channel, and no path', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.saveExportFile('export.json', '{}', '/etc/passwd');
  assert.deepEqual(invoked, ['save-export-file']);
  assert.deepEqual(invokedArgs, [[{ name: 'export.json', content: '{}' }]]);
});


test('getShellLogs sends only a number on the get-shell-logs channel, and clearShellLogs sends nothing', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.getShellLogs(7, 'extra');
  exposed.electronAPI.getShellLogs({ evil: true });
  exposed.electronAPI.clearShellLogs('extra');
  assert.deepEqual(invoked, ['get-shell-logs', 'get-shell-logs', 'clear-shell-logs']);
  assert.deepEqual(invokedArgs, [[7], [0], []]);
});

test('downloadUpdate sends the agreement as true only when it was given as true, with the version it was given for', () => {
  const { exposed, invoked, invokedArgs } = loadPreload();
  exposed.electronAPI.downloadUpdate(true, '2.5.0');
  exposed.electronAPI.downloadUpdate();
  exposed.electronAPI.downloadUpdate('yes', '2.5.0');
  assert.deepEqual(invoked, ['download-update', 'download-update', 'download-update']);
  assert.deepEqual(invokedArgs, [[{ agreed: true, version: '2.5.0' }], [{ agreed: false, version: undefined }], [{ agreed: false, version: '2.5.0' }]]);
});
