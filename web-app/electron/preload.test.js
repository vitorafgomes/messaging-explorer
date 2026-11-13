const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadPreload() {
  const exposed = {};
  const listened = [];
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: { invoke: () => Promise.resolve(), on: (channel) => { listened.push(channel); } }
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
  return { exposed, listened };
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
