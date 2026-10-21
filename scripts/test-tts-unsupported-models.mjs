// A Ming checkpoint runs on one backend, and each machine has one (MLX on Apple Silicon,
// PyTorch elsewhere). A checkpoint this machine cannot run must never be offered, downloaded
// or loaded; one already on disk (downloaded on another machine, or before it was hidden) is
// listed apart so Settings can delete it. This drives the real TtsService.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-tts-unsupported-models')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-tts-unsupported-'));
const require = createRequire(import.meta.url);
installRuntimeHooks(root);
const load = (file) => require(path.join(repoRoot, file));

try {
  const vaults = load('electron/vaults/vaultRegistry.ts');
  vaults.setActiveVault(vaults.createVault('TTS platform').id);
  const tts = load('shared/ttsModels.ts');
  const { ttsService } = load('electron/tts/service.ts');
  const service = ttsService();

  const offered = tts.ttsModelsForPlatform(process.platform, process.arch).map((model) => model.id);
  const foreign = tts.TTS_MODELS.find((model) => !model.unpublished && model.engine === 'ming' && !offered.includes(model.id));
  assert.ok(foreign, 'every platform leaves one Ming checkpoint out');

  let status = await service.status();
  assert.ok(!status.models.some((model) => model.id === foreign.id), `${foreign.id} is not offered here`);
  assert.deepEqual(status.unsupportedModels, [], 'nothing on disk, nothing to delete');

  // A partial copy left on disk.
  const dir = service.models.dir(foreign.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'model.safetensors'), Buffer.alloc(4096));
  status = await service.status();
  assert.ok(!status.models.some((model) => model.id === foreign.id), 'still not offered for narration');
  assert.equal(status.unsupportedModels.length, 1);
  assert.equal(status.unsupportedModels[0].id, foreign.id);
  assert.equal(status.unsupportedModels[0].downloadedBytes, 4096, 'what it uses on disk, partial or not');

  await assert.rejects(service.downloadModel(foreign.id), /TTS_MODEL_UNAVAILABLE/, 'never downloaded here');
  await assert.rejects(service.load(foreign.id), /TTS_MODEL_UNAVAILABLE/, 'never loaded here');

  await service.deleteModel(foreign.id);
  assert.equal(fs.existsSync(dir), false, 'Settings can delete it');
  assert.deepEqual((await service.status()).unsupportedModels, []);
  console.log(`tts unsupported model tests passed (${process.platform}/${process.arch}: ${foreign.id})`);
} finally {
  try { load('electron/db/database.ts').closeDb(); } catch {}
  await rm(root, { recursive: true, force: true });
}
