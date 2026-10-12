import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'harness-keys-'));
test.after(() => rm(dir, { recursive: true, force: true }));

// A credential store that fails the test the moment anything touches it.
const stub = path.join(dir, 'electron-stub.mjs');
await writeFile(stub, `
const touched = () => { throw new Error('the OS credential store was touched in harness mode'); };
export const safeStorage = { isEncryptionAvailable: touched, encryptString: touched, decryptString: touched };
export const app = { getPath: () => ${JSON.stringify(dir)}, getAppPath: () => process.cwd(), isPackaged: false };
export default { safeStorage, app };
`);

async function load(name) {
  const outfile = path.join(dir, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, 'electron/secrets/safeStorageGate.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    alias: { electron: stub, '@shared': path.join(root, 'shared') } });
  return import(pathToFileURL(outfile).href);
}

test('harness mode reads API keys from the file and never reaches the credential store', async () => {
  const keys = path.join(dir, 'keys.json');
  await writeFile(keys, JSON.stringify({ deepseek: ' sk-deep ', anthropic: 'sk-ant', empty: '  ', bad: 3 }), { mode: 0o600 });
  process.env.NODUS_HARNESS_KEYS_FILE = keys;
  const gate = await load('on');
  assert.equal(gate.harnessKeysMode(), true);
  assert.equal(gate.harnessApiKey('deepseek'), 'sk-deep');
  assert.equal(gate.harnessApiKey('anthropic'), 'sk-ant');
  assert.equal(gate.harnessApiKey('openai'), null);
  assert.equal(gate.harnessApiKey('empty'), null);
  // Every existing caller treats "unavailable" as "no stored secret": nothing reaches the stub.
  assert.equal(gate.safeStorage.isEncryptionAvailable(), false);
  assert.throws(() => gate.safeStorage.decryptString(Buffer.from('x')), /disabled in harness mode/);
  assert.throws(() => gate.safeStorage.encryptString('x'), /disabled in harness mode/);
});

test('outside harness mode the gate is Electron safeStorage, unchanged', async () => {
  delete process.env.NODUS_HARNESS_KEYS_FILE;
  const gate = await load('off');
  assert.equal(gate.harnessKeysMode(), false);
  assert.equal(gate.harnessApiKey('deepseek'), null);
  assert.throws(() => gate.safeStorage.isEncryptionAvailable(), /credential store was touched/);
});
