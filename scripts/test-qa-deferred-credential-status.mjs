// The startup theme reads settings before the first BrowserWindow exists. In an
// explicitly isolated QA profile, credential availability metadata may be
// deferred there; provider reads must still use the real secret-store path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
import { createResearchTestRoot } from './research-isolation.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--native-qa-deferred-credential-status')) process.exit(0);

const root = createResearchTestRoot();
const profile = path.join(root, 'profile');
const secrets = path.join(profile, 'secrets');
fs.mkdirSync(secrets, { recursive: true });
fs.writeFileSync(path.join(secrets, 'ai_key_openrouter.bin'), 'synthetic-ciphertext', { mode: 0o600 });
const calls = { available: 0, decrypt: 0 };
const safeStorage = {
  isEncryptionAvailable() { calls.available++; return true; },
  encryptString(value) { return Buffer.from(`synthetic:${value}`); },
  decryptString(value) {
    calls.decrypt++;
    assert.equal(Buffer.from(value).toString(), 'synthetic-ciphertext');
    return 'sk-or-v1-synthetic-test-key';
  },
};
const electronStub = installRuntimeHooks(profile, { safeStorage });
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const store = load('electron/secrets/secretStore.ts');
const settings = load('electron/db/settingsRepo.ts');
const database = load('electron/db/database.ts');
const originalGetPath = electronStub.app.getPath;
const envNames = ['NODUS_QA_DEFER_CREDENTIAL_STATUS', 'NODUS_QA_ROOT', 'NODUS_ISOLATED_ROOT', 'NODUS_QA_DATABASE_AUDIT_LOG', 'NODUS_USERDATA'];
const envSnapshot = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const restoreEnv = () => {
  for (const name of envNames) {
    if (envSnapshot[name] === undefined) delete process.env[name];
    else process.env[name] = envSnapshot[name];
  }
};

try {
  process.env.NODUS_ISOLATED_ROOT = root;
  process.env.NODUS_QA_ROOT = root;
  process.env.NODUS_QA_DATABASE_AUDIT_LOG = path.join(profile, 'database-access.jsonl');
  process.env.NODUS_USERDATA = profile;
  process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS = '1';

  const deferred = settings.getSettings();
  assert.equal(deferred.providerKeys.openrouter, false, 'startup settings do not attempt crypto and report no key as ready');
  assert.deepEqual(deferred.lockedProviderKeys, [], 'locked-key status is pending until a provider read');
  assert.deepEqual(calls, { available: 0, decrypt: 0 }, 'getSettings performs zero Safe Storage calls in deferred QA mode');

  assert.equal(store.getApiKey('openrouter'), 'sk-or-v1-synthetic-test-key', 'actual provider reads still decrypt normally');
  assert.ok(calls.available > 0 && calls.decrypt > 0, 'the live key reader still reaches the Safe Storage implementation');
  assert.equal(store.apiKeyStorageState('openrouter'), 'available', 'the direct storage-state API also retains its ordinary reader');

  const afterProviderRead = { ...calls };
  process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS = 'true';
  assert.throws(() => settings.getSettings(), /Invalid NODUS_QA_DEFER_CREDENTIAL_STATUS/);
  assert.deepEqual(calls, afterProviderRead, 'invalid flag values fail before crypto');

  process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS = '1';
  delete process.env.NODUS_ISOLATED_ROOT;
  assert.throws(() => settings.getSettings(), /isolated QA profile/);
  process.env.NODUS_ISOLATED_ROOT = root;
  process.env.NODUS_QA_ROOT = path.join(root, 'other-root');
  assert.throws(() => settings.getSettings(), /does not match its QA manifest/);
  process.env.NODUS_QA_ROOT = root;

  const manifestFile = path.join(root, 'isolation.json');
  const validManifest = fs.readFileSync(manifestFile, 'utf8');
  fs.writeFileSync(manifestFile, JSON.stringify({ format: 'invalid', root }));
  assert.throws(() => settings.getSettings(), /Invalid isolated profile manifest/);
  fs.writeFileSync(manifestFile, validManifest);

  electronStub.app.getPath = () => path.join(root, 'wrong-profile');
  assert.throws(() => settings.getSettings(), /does not match its QA manifest/);
  electronStub.app.getPath = originalGetPath;
  assert.deepEqual(calls, afterProviderRead, 'bad manifests and profile mismatches never touch Safe Storage');

  delete process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS;
  const ordinary = settings.getSettings();
  assert.equal(ordinary.providerKeys.openrouter, true, 'without the QA flag settings retain normal key availability');
  assert.deepEqual(ordinary.lockedProviderKeys, []);
  assert.ok(calls.decrypt > afterProviderRead.decrypt, 'ordinary metadata continues to use the encrypted key reader');
  console.log('QA deferred credential status: startup metadata bypass is isolated; provider decryption and ordinary settings remain unchanged.');
} finally {
  electronStub.app.getPath = originalGetPath;
  restoreEnv();
  try { database.closeDb(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
