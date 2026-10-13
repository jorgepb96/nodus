import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { installStaplerRetries, retryStapler } = require('./macos-stapler-retry.cjs');
const lost = () => new Error('Failed to staple your application with code: 68\nError Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."');
const quiet = () => {};

test('lost Apple ticket downloads recover without changing the app or return value', async () => {
  const app = { appPath: '/tmp/Nodus.app' };
  const receiver = {};
  const delays = [];
  let calls = 0;
  const staple = retryStapler(function (options) {
    assert.equal(options, app);
    assert.equal(this, receiver);
    if (++calls < 3) throw lost();
    return 'stapled';
  }, { sleep: async (ms) => delays.push(ms), log: quiet });
  assert.equal(await staple.call(receiver, app), 'stapled');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [15_000, 30_000]);
});

test('missing or invalid tickets and unrelated failures stop immediately', async () => {
  for (const error of [
    new Error('Failed to staple your application with code: 65\nRecord not found'),
    new Error('Failed to staple your application with code: 68\nInvalid ticket'),
    new Error('Notarization status: Invalid'),
    new Error('The network connection was lost.'),
  ]) {
    let calls = 0;
    const staple = retryStapler(() => { calls += 1; throw error; }, {
      sleep: async () => assert.fail('permanent errors must not wait'), log: quiet,
    });
    await assert.rejects(staple(), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test('a lasting Apple outage exhausts bounded retries and fails closed', async () => {
  const error = lost();
  const delays = [];
  let calls = 0;
  const staple = retryStapler(() => { calls += 1; throw error; }, {
    sleep: async (ms) => delays.push(ms), log: quiet,
  });
  await assert.rejects(staple(), (actual) => actual === error);
  assert.equal(calls, 6);
  assert.deepEqual(delays, [15_000, 30_000, 60_000, 120_000, 120_000]);
});

test('the pinned notarize integration retries stapling without resubmitting notarization', async () => {
  const folder = path.dirname(require.resolve('@electron/notarize'));
  const signature = require(path.join(folder, 'check-signature.js'));
  const notary = require(path.join(folder, 'notarytool.js'));
  const spawn = require(path.join(folder, 'spawn.js'));
  const staple = require(path.join(folder, 'staple.js'));
  const original = {
    check: signature.checkSignatures, available: notary.isNotaryToolAvailable,
    submit: notary.notarizeAndWaitForNotaryTool, spawn: spawn.spawn, staple: staple.stapleApp,
  };
  let submissions = 0;
  let downloads = 0;
  let signatures = 0;
  const delays = [];
  try {
    signature.checkSignatures = async () => { signatures += 1; };
    notary.isNotaryToolAvailable = async () => true;
    notary.notarizeAndWaitForNotaryTool = async () => { submissions += 1; };
    spawn.spawn = async (command, args, options) => {
      assert.equal(command, 'xcrun');
      assert.deepEqual(args, ['stapler', 'staple', '-v', 'Nodus.app']);
      assert.equal(options.cwd, '/tmp');
      downloads += 1;
      return downloads === 1 ? { code: 68, output: 'The network connection was lost.' } : { code: 0, output: 'The staple action worked!' };
    };
    const installed = installStaplerRetries({ sleep: async (ms) => delays.push(ms), log: quiet });
    assert.equal(installStaplerRetries(), installed, 'preloading twice must not nest retry loops');
    await require('@electron/notarize').notarize({ appPath: '/tmp/Nodus.app' });
    assert.equal(signatures, 1);
    assert.equal(submissions, 1);
    assert.equal(downloads, 2);
    assert.deepEqual(delays, [15_000]);
  } finally {
    signature.checkSignatures = original.check;
    notary.isNotaryToolAvailable = original.available;
    notary.notarizeAndWaitForNotaryTool = original.submit;
    spawn.spawn = original.spawn;
    staple.stapleApp = original.staple;
  }
});

test('native rebuild forks can preload retries after changing their working directory', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'nodus-stapler-fork-'));
  const childPath = path.join(temporary, 'child.cjs');
  const parentPath = path.join(temporary, 'parent.cjs');
  const staplerPath = path.join(path.dirname(require.resolve('@electron/notarize')), 'staple.js');
  try {
    writeFileSync(childPath, `const staple = require(${JSON.stringify(staplerPath)}).stapleApp;
process.send({ installed: staple[Symbol.for('nodus.macos.staplerRetries')] === true });\n`);
    writeFileSync(parentPath, `const { fork } = require('node:child_process');
const child = fork(${JSON.stringify(childPath)}, { cwd: ${JSON.stringify(temporary)}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
child.stderr.pipe(process.stderr);
child.on('message', (message) => process.stdout.write(JSON.stringify(message)));
child.on('exit', (code) => process.exit(code));\n`);
    const output = execFileSync(process.execPath, [
      '--require', require.resolve('./macos-stapler-retry.cjs'), parentPath,
    ], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, NODUS_RETRY_MACOS_STAPLING: '1' },
    });
    assert.deepEqual(JSON.parse(output), { installed: true });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
