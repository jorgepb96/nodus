// Guards the URL that ensureNodusLocalServer hands back, because the two exits of
// that function once disagreed: the exit that spawns llama-server returned the
// OpenAI-compatible base ({root}/v1) while the exit taken when the model was
// already running returned the bare root. The first embedding of a session
// therefore worked and every later one silently produced nothing.
//
// Nothing is mocked at the module boundary: the real function spawns a real
// process and polls it over HTTP. The spawned executable is a stand-in for
// llama-server that reproduces the one behaviour that makes the divergence
// destructive rather than cosmetic — measured against llama.cpp b10002 with
// bge-m3-q8_0 loaded in embedding mode, both endpoints answer HTTP 200 but with
// different bodies:
//
//   POST /v1/embeddings -> { data: [{ embedding: number[1024], index, object }], ... }
//   POST /embeddings    -> [{ index, embedding: number[][] }]           (bare array)
//
// embedWithNodusLocal reads `body.data`, so against the wrong endpoint it returns
// [] with no exception and no failed status code. Asserting on the returned URL
// alone would not catch that, so the vectors are exercised too.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-server-url-'));

// The catalogue is the source of truth for what the manager expects on disk.
const { getNodusLocalModel } = await import(pathToFileURL(path.join(repoRoot, 'shared/localAiModels.ts')).href)
  .catch(async () => {
    const outfile = path.join(tmp, 'catalog.mjs');
    await build({
      entryPoints: [path.join(repoRoot, 'shared/localAiModels.ts')],
      outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    });
    return import(pathToFileURL(outfile).href);
  });

const MODEL_ID = 'bge-m3-q8_0';
const model = getNodusLocalModel(MODEL_ID);
assert.ok(model, `the catalogue still ships ${MODEL_ID}`);
assert.equal(model.runtime, 'llama_cpp', `${MODEL_ID} still runs through the managed server`);

// Keep checksum verification real without manufacturing a 600 MB fixture. The
// bundled manager sees an otherwise identical catalogue entry whose asset is small
// and has a pinned digest known by this test.
const verifiedAssets = model.assets.map((asset, index) => {
  const content = Buffer.from(`verified-${MODEL_ID}-${index}`);
  return { asset: { ...asset, bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }, content };
});
const verifiedModel = { ...model, assets: verifiedAssets.map((entry) => entry.asset) };

// ── A downloaded model, without downloading 600 MB ───────────────────────────
// The manager validates both size and SHA-256 before starting the runtime.
const modelDir = path.join(tmp, 'local-ai', 'models', MODEL_ID);
await mkdir(modelDir, { recursive: true });
for (const { asset, content } of verifiedAssets) {
  await mkdir(path.dirname(path.join(modelDir, asset.file)), { recursive: true });
  await writeFile(path.join(modelDir, asset.file), content);
}

// ── A stand-in for llama-server ──────────────────────────────────────────────
// Serves /health at the root and mirrors llama.cpp's split between the bare and
// the OpenAI-compatible embedding endpoints. It ignores every flag except --port.
const runtimeDir = path.join(tmp, 'local-ai', 'runtime', 'b10002');
await mkdir(runtimeDir, { recursive: true });
const serverScript = path.join(runtimeDir, 'fake-llama-server.mjs');
await writeFile(
  serverScript,
  `import http from 'node:http';
   const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
   const vector = Array.from({ length: 8 }, (_, i) => (i + 1) / 10);
   http.createServer((req, res) => {
     let body = '';
     req.on('data', (chunk) => { body += chunk; });
     req.on('end', () => {
       const count = (() => {
         try {
           const input = JSON.parse(body || '{}').input;
           return Array.isArray(input) ? input.length : 1;
         } catch { return 1; }
       })();
       const json = (payload) => {
         res.writeHead(200, { 'content-type': 'application/json' });
         res.end(JSON.stringify(payload));
       };
       if (req.url === '/health') return json({ status: 'ok' });
       // OpenAI envelope — what embedWithNodusLocal parses.
       if (req.url === '/v1/embeddings') {
         return json({
           model: 'stub', object: 'list', usage: { prompt_tokens: count, total_tokens: count },
           data: Array.from({ length: count }, (_, index) => ({ object: 'embedding', index, embedding: vector })),
         });
       }
       // llama.cpp's native endpoint: a bare array, vectors nested per token.
       if (req.url === '/embeddings') {
         return json(Array.from({ length: count }, (_, index) => ({ index, embedding: [vector] })));
       }
       res.writeHead(404, { 'content-type': 'application/json' });
       res.end(JSON.stringify({ error: { code: 404, message: 'not found' } }));
     });
   }).listen(port, '127.0.0.1');\n`
);
const executable = path.join(runtimeDir, 'llama-server');
await writeFile(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverScript)} "$@"\n`);
await chmod(executable, 0o755);

let manager;
try {
  // Bundle the real manager. The unused Gemma utility path must fail if invoked;
  // this regression still exercises the real llama.cpp child and HTTP transport.
  const electronStub = path.join(tmp, 'electron-stub.mjs');
  const catalogueStub = path.join(tmp, 'local-models-stub.mjs');
  await writeFile(
    electronStub,
    `export const app = { getPath: () => ${JSON.stringify(tmp)}, once: () => {} };\nexport const utilityProcess = { fork: () => { throw new Error('Unexpected Gemma utility process in llama.cpp URL regression'); } };\nexport default { app, utilityProcess };\n`
  );
  await writeFile(catalogueStub, `
    const model = ${JSON.stringify(verifiedModel)};
    export const NODUS_LOCAL_MODELS = [model];
    export const getNodusLocalModel = (id) => id === model.id ? model : undefined;
    export const nodusLocalModelBytes = (entry) => entry.assets.reduce((sum, asset) => sum + asset.bytes, 0);
  `);
  const outfile = path.join(tmp, 'nodusLocalAi.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/nodusLocalAi.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: path.join(repoRoot, 'electron/tsconfig.json'),
    // Only the Transformers.js runtime reaches for it, and it ships native .node
    // binaries esbuild cannot inline. This test drives the llama.cpp path.
    external: ['@huggingface/transformers'],
    // adm-zip is CommonJS and requires Node builtins at load time; an ESM bundle
    // has no require of its own to hand it.
    banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
    plugins: [{
      name: 'stub-electron',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }));
        b.onResolve({ filter: /^@shared\/localAiModels$/ }, () => ({ path: catalogueStub }));
      },
    }],
  });
  manager = await import(pathToFileURL(outfile).href);

  // ── The contract: both exits agree ────────────────────────────────────────
  const cold = await manager.ensureNodusLocalServer(MODEL_ID, 'embedding');
  const warm = await manager.ensureNodusLocalServer(MODEL_ID, 'embedding');

  assert.match(cold, /^http:\/\/127\.0\.0\.1:\d+\/v1$/, 'a freshly spawned server is addressed on its OpenAI-compatible base');
  assert.equal(
    warm,
    cold,
    'reaching an already-running server must return the same URL as starting one — a bare root sends callers to llama.cpp native endpoints'
  );

  // A third call keeps the invariant no matter how many times the cache is hit.
  assert.equal(await manager.ensureNodusLocalServer(MODEL_ID, 'embedding'), cold, 'the URL is stable across repeated calls');

  // ── The consequence: vectors keep arriving after the first call ───────────
  const first = await manager.embedWithNodusLocal(MODEL_ID, ['una frase']);
  const second = await manager.embedWithNodusLocal(MODEL_ID, ['otra frase', 'y una tercera']);

  assert.equal(first.length, 1, 'the first embedding call returns one vector per input');
  assert.equal(
    second.length,
    2,
    'later calls reuse the running server and must still return one vector per input — the native endpoint answers 200 with no .data, which reads as an empty result'
  );
  for (const vectors of [first, second]) {
    for (const vector of vectors) {
      assert.ok(Array.isArray(vector) && vector.length > 0, 'every returned vector has components');
      assert.ok(vector.every(Number.isFinite), 'vectors are flat lists of numbers, not per-token matrices');
    }
  }

  // ── The server really was reused ──────────────────────────────────────────
  const status = await manager.getNodusLocalAiStatus();
  assert.equal(status.activeModelId, MODEL_ID, 'the manager reports the running model');
} finally {
  manager?.stopNodusLocalServer();
  // The stand-in exits with its parent handle closed; make sure nothing survives.
  spawnSync('pkill', ['-f', serverScript], { stdio: 'ignore' });
  await rm(tmp, { recursive: true, force: true });
}
