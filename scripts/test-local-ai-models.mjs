import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-ai-'));

try {
  const outfile = path.join(tmp, 'catalog.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/localAiModels.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const catalog = await import(pathToFileURL(outfile).href);
  const embeddings = catalog.NODUS_LOCAL_MODELS.filter((model) => model.kind === 'embedding');
  const chat = catalog.NODUS_LOCAL_MODELS.filter((model) => model.kind === 'chat');
  assert.deepEqual(embeddings.map((model) => model.label), [
    'EmbeddingGemma 2 Q8 · 512', 'EmbeddingGemma 2 Q8 · 256',
    'BGE-M3 Q8_0', 'GTE Multilingual Base INT8', 'Multilingual E5 Small INT8',
  ]);
  assert.deepEqual(chat.map((model) => model.label), [
    'Qwen3.5-0.8B Q4', 'Gemma 4 E2B Q4', 'Granite 4.0 Micro Q4', 'LFM2.5-VL-1.6B Q4',
  ]);
  // Vision chat models must ship their projector; text-only chat models (Granite) must not need one.
  assert.ok(chat.every((model) => (model.vision ? Boolean(model.projectorFile) : !model.projectorFile)),
    'vision models download a projector; text models do not');
  // The extraction gate that guards the scan roles: after the Windows + RTX validation,
  // only Gemma is trusted to extract. Granite is kept for chat/summary/document profiles.
  assert.deepEqual(chat.filter((model) => model.capabilities.extraction).map((model) => model.label),
    ['Gemma 4 E2B Q4']);
  assert.deepEqual(chat.find((model) => model.id === 'granite-4.0-micro-q4').capabilities,
    { chat: true, vision: false, summary: true, extraction: false, fusion: false, documentProfile: true },
    'Granite stays available for chat, summaries and profiles but is refused for extraction and fusion');
  assert.ok(catalog.NODUS_LOCAL_MODELS.every((model) => model.assets.every((asset) => asset.bytes > 0)), 'every asset has an expected byte size');
  assert.ok(catalog.NODUS_LOCAL_MODELS.every((model) => model.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256))), 'every asset is pinned by SHA-256');
  assert.deepEqual(chat.find((model) => model.id === 'qwen3.5-0.8b-q4').capabilities,
    { chat: true, vision: true, summary: false, extraction: false, fusion: false, documentProfile: false });
  assert.equal(chat.find((model) => model.id === 'granite-4.0-micro-q4').vision, undefined, 'Granite is text-only');

  const [manager, aiClient, ipc, mainProcess, preload, settings, ui, onboarding, providers, studyPolicy] = await Promise.all([
    Promise.resolve(readSource('electron/ai/nodusLocalAi.ts')),
    Promise.resolve(readSource('electron/ai/aiClient.ts')),
    Promise.resolve(readSource('@main')),
    Promise.resolve(readSource('electron/main.ts')),
    Promise.resolve(readSource('@bridge')),
    Promise.resolve(readSource('src/views/Settings.tsx')),
    Promise.resolve(readSource('src/components/LocalAiModelsSettings.tsx')),
    Promise.resolve(readSource('src/views/Onboarding.tsx')),
    Promise.resolve(readSource('shared/providers.ts')),
    Promise.resolve(readSource('shared/studyAi.ts')),
  ]);
  assert.match(manager, /\.download/, 'downloads use partial files before atomic rename');
  assert.match(manager, /fsp\.stat\(`\$\{path\.join\(directory, asset\.file\)\}\.download`\)/, 'status includes bytes from an in-progress partial asset');
  assert.match(manager, /createHash\('sha256'\)/, 'downloads verify SHA-256');
  assert.match(manager, /'--mmproj'/, 'llama-server receives the multimodal projector');
  assert.match(manager, /'--embedding', '--pooling', 'mean'/, 'BGE runs through llama.cpp embedding mode');
  const embeddingArgs = manager.match(/if \(mode === 'embedding'\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.match(embeddingArgs, /'--batch-size', String\(contextPerSlot\)/,
    'the logical embedding batch accepts one complete model-context input');
  assert.match(embeddingArgs, /'--ubatch-size', String\(contextPerSlot\)/,
    'the physical embedding batch accepts inputs above llama.cpp\'s 512-token default');
  assert.doesNotMatch(embeddingArgs, /contextPerSlot \* slots/,
    'the per-input batch limit is not inflated by concurrent slots');
  assert.ok(embeddings.find((model) => model.id === 'bge-m3-q8_0').contextLength > 512,
    'the regression fixture exercises a context larger than the old physical batch');
  assert.match(manager, /pipeline\('feature-extraction'/, 'INT8 ONNX models run through Transformers.js');
  assert.match(manager, /if \(model\.runtime === 'llama_cpp'\) \{\s*await installNodusLocalRuntime/s,
    'llama.cpp is installed (or upgraded) automatically before a dependent model download');
  assert.match(manager, /installNodusLocalRuntime.*downloadModelAssets/s, 'runtime installation continues immediately into the requested model download');
  assert.match(manager, /activeRuntimeDownload.*ActiveLocalAiDownload/s, 'runtime downloads persist in main-process state');
  assert.match(manager, /activeDownloads\.get\(downloadKey\(model\.id\)\)/, 'model status reconnects to a main-process download job');
  assert.match(manager, /return followDownload\(running, onProgress\)/, 'duplicate requests follow the existing download');
  assert.match(manager, /controller: AbortController/, 'every main-process transfer owns an abort controller');
  assert.match(manager, /Range: `bytes=\$\{resumedBytes\}-`/, 'interrupted downloads resume with HTTP Range');
  assert.match(manager, /export async function cancelNodusLocalDownloads/, 'the main process exposes a real cancellation operation');
  assert.match(manager, /Promise\.allSettled\(/, 'cancellation waits until active jobs have stopped');
  assert.match(manager, /withNodusLocalServerLease/, 'model switches cannot stop a runtime with in-flight requests');
  assert.match(manager, /'--parallel', String\(slots\)/, 'llama.cpp slots are explicit');
  assert.match(manager, /String\(contextPerSlot \* slots\)/, 'every slot retains its complete context budget');
  assert.match(manager, /'--metrics'/, 'llama.cpp metrics are enabled');
  assert.match(manager, /for \(const slots of \[2, 4\] as const\)/, 'local calibration tests two slots before four');
  assert.match(manager, /gain < 0\.15 \|\| p95Change > 0\.1/, 'extra slots require the throughput and p95 gates');
  assert.match(manager, /minimumFree >= os\.totalmem\(\) \* 0\.05/, 'local calibration rejects critical memory pressure');
  assert.match(manager, /ensureNodusLocalServerUnlocked\(model\.id, mode, slots\)/, 'calibration starts the full-context runtime at each candidate slot count');
  assert.match(manager, /calibrationTail/, 'a manual calibration still cannot race a live request');
  assert.doesNotMatch(manager, /model\.runtime !== 'llama_cpp' \|\| !await verifyNodusLocalModel/,
    'the downloaded-model wrapper registers calibration before any asynchronous checksum yield');
  assert.match(manager, /export function killNodusLocalServerSync/, 'process shutdown has a forceful local-runtime backstop');
  assert.match(manager, /await stopNodusLocalServerAndWait\(acquired\.server\)/,
    'slot benchmarks wait for the previous runtime to exit before testing the next configuration');
  assert.match(manager, /child\.kill\('SIGKILL'\)/, 'a runtime that ignores graceful shutdown cannot remain orphaned');
  assert.match(manager, /const safe = input\.memorySafe/,
    'a failed one-slot baseline is persisted as unsafe rather than a successful calibration');
  assert.match(manager, /runtime-start-or-transport/,
    'calibration failures persist a content-free diagnostic reason while retaining one safe slot');
  assert.match(manager, /!selectedMemorySafe \? 'memory-gate-failed'/,
    'a failed memory gate is never mislabeled as a successful single-slot calibration');
  assert.match(manager, /max_tokens: 512/,
    'reasoning-capable local models have enough probe budget to emit calibration content');
  assert.match(mainProcess, /killNodusLocalServerSync\(\)/, 'main-process shutdown cannot orphan the integrated llama server');
  assert.doesNotMatch(ipc, /calibrateDownloadedNodusLocalModels/,
    'selecting a local model must not enqueue a benchmark the first inference then waits behind (issue #851)');
  assert.match(ipc, /aiConcurrencyMode/, 'the concurrency policy is still refreshed when the mode changes');
  assert.match(aiClient, /ensureNodusLocalServer\(model\.model, 'chat'\)/, 'chat completions start the managed local server');
  assert.match(aiClient, /embedWithNodusLocal/, 'embedding calls route to the integrated runtime');
  assert.match(ipc, /ai:nodusLocal:downloadModel/, 'main IPC exposes model downloads');
  assert.match(ipc, /ai:nodusLocal:cancelDownloads/, 'main IPC exposes cancellation');
  assert.match(ipc, /if \(!event\.sender\.isDestroyed\(\)\) event\.sender\.send\('ai:nodusLocal:progress'/, 'progress cannot abort a download after its renderer is destroyed');
  assert.match(preload, /ai:nodusLocal:progress/, 'preload forwards download progress safely');
  assert.match(preload, /cancelNodusLocalDownloads: \(\) => ipcRenderer\.invoke\('ai:nodusLocal:cancelDownloads'\)/, 'the renderer can request cancellation');
  assert.match(settings, /Cambiar modelo de embeddings/, 'embedding changes require an explicit compatibility confirmation');
  assert.match(ui, /ConfirmModal/, 'deleting a local model uses the styled confirmation modal');
  assert.match(ui, /no son compatibles y deberán regenerarse/, 'the permanent embedding compatibility reminder is visible');
  assert.match(ui, /nodus-local-embedding-list/, 'embedding models use the shared settings list pattern');
  assert.match(ui, /nodus-local-chat-list/, 'chat models use the shared settings list pattern');
  assert.match(ui, /Preparando motor…/, 'the UI explains the automatic dependency stage');
  assert.match(ui, /status\?\.runtime\.downloading \|\| status\?\.models\.some\(\(model\) => model\.downloading\)/, 'the UI restores active transfers from the status snapshot');
  assert.match(ui, /window\.setInterval\(\(\) => \{[\s\S]*refresh\(\)/, 'a remounted settings view follows the persistent download through completion');
  assert.match(ui, /await window\.nodus\.downloadNodusLocalModel\(model\.id, setProgress\)/, 'one main-process request owns runtime preparation and model download');
  assert.doesNotMatch(ui, /await window\.nodus\.installNodusLocalRuntime\([\s\S]{0,300}await window\.nodus\.downloadNodusLocalModel/, 'the renderer does not split a model transfer into dependent stages');
  assert.match(ui, /nodus-local-download-progress/, 'rehydrated progress has a stable UI hook');
  assert.match(onboarding, /data-testid="onboarding-stop-model-download"/, 'the setup wizard exposes a stop-download action');
  assert.match(onboarding, /await window\.nodus\.cancelNodusLocalDownloads\(\)/, 'the stop action reaches the main-process transfer');
  assert.match(onboarding, /Descarga detenida\. El progreso verificado se conserva para reanudar\./, 'the wizard explains resumable cancellation');
  assert.match(ui, /exposeDownloadedChatModels/, 'downloaded local chat models are exposed to the shared dropdowns');
  assert.doesNotMatch(ui, /SettingsModelDot|selectedEmbedding|selectedGeneral|selectedVision/, 'the download catalog must not present models as active selections');
  assert.doesNotMatch(ui, /onSelectEmbedding|selectChat|Usar para embeddings|Usar como general|Usar para visión|Modelo general|Modelo de visión/, 'model assignment belongs exclusively to the shared dropdowns');
  assert.doesNotMatch(ui, /lg:grid-cols-3/, 'local model catalogs do not regress to card grids');
  assert.match(providers, /nodus: 'Nodus local'/, 'the integrated provider has a user-facing label');
  assert.match(studyPolicy, /model\.provider === 'nodus'/, 'local-only study policy accepts managed Nodus models');

  console.log('Integrated local AI model tests passed!');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
