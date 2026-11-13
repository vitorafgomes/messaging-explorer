const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'generate-icons.js');

function runWithSharp(toFile) {
  const stub = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'sharp') {
        return () => {
          const chain = { resize: () => chain, png: () => chain, toFile: ${toFile} };
          return chain;
        };
      }
      return load.call(this, request, ...rest);
    };
    require(${JSON.stringify(script)});
  `;
  return spawnSync(process.execPath, ['-e', stub], { encoding: 'utf8' });
}

test('a failed icon generation exits with a non-zero status', () => {
  const run = runWithSharp(`() => Promise.reject(new Error('disk full'))`);
  assert.notEqual(run.status, 0, `exited ${run.status} although no icon was written`);
  assert.match(run.stderr, /disk full/);
});

test('a successful icon generation exits with status 0', () => {
  const run = runWithSharp(`() => Promise.resolve()`);
  assert.equal(run.status, 0, run.stderr);
});
