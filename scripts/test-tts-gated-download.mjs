// A gated checkpoint (Phonon 40M) downloads only with a Hugging Face token whose account
// accepted the model's terms. Hugging Face answers 401 to a rejected token and 403 to an
// account without access; each must reach the user as a clear error, not "HTTP 403: <url>".
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-tts-gated-download')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-tts-gated-'));
const require = createRequire(import.meta.url);
installRuntimeHooks(root);
const { TtsModelStore } = require(path.join(repoRoot, 'electron/tts/models.ts'));

const answers = { '/rejected/model.bin': 401, '/no-access/model.bin': 403 };
const seen = [];
const server = http.createServer((request, response) => { seen.push(request.headers.authorization); response.writeHead(answers[request.url] ?? 404); response.end(); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const model = (id, gated, file) => ({ id, gated, assets: [{ file: 'model.bin', url: `${base}${file}`, bytes: 10 }] });

try {
  const store = new TtsModelStore(path.join(root, 'models'), () => false);
  await assert.rejects(store.download(model('a', true, '/rejected/model.bin'), undefined, 'hf_test'), /TTS_HF_TOKEN_INVALID/);
  await assert.rejects(store.download(model('b', true, '/no-access/model.bin'), undefined, 'hf_test'), /TTS_HF_ACCESS_DENIED/);
  assert.deepEqual(seen, ['Bearer hf_test', 'Bearer hf_test'], 'the token goes to Hugging Face only as a bearer header');
  // An open checkpoint keeps the plain transport error: no Hugging Face account is involved.
  await assert.rejects(store.download(model('c', false, '/no-access/model.bin')), (error) => !/TTS_HF_/.test(error.message) && /403/.test(error.message));
  console.log('tts gated download tests passed');
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}
