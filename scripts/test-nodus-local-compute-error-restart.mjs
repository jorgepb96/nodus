// A llama.cpp server that has answered «Compute error.» stays broken: measured against
// b10002 with Harrier on Metal, after a command buffer was refused under GPU memory
// pressure every later request failed the same way, a one-word query included, while a
// freshly started process with identical arguments served the same load. The manager
// must therefore retire that process once its leases drain, so the next request (batch
// bisection retries, or the next indexing pass) reaches a clean server instead of
// failing for the rest of the session.
//
// Like test-nodus-local-server-url.mjs, nothing is mocked at the module boundary: the
// real manager spawns a stand-in executable and talks to it over HTTP. The stand-in
// records its argv, so the same run also proves Harrier is launched with last-token
// pooling rather than llama.cpp's mean default for BGE-M3.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-compute-error-'));

const catalogFile = path.join(tmp, 'catalog.mjs');
await build({ entryPoints: [path.join(repoRoot, 'shared/localAiModels.ts')], outfile: catalogFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { getNodusLocalModel } = await import(pathToFileURL(catalogFile).href);

const MODEL_ID = 'harrier-oss-v1-0.6b-q8_0';
const model = getNodusLocalModel(MODEL_ID);
assert.equal(model?.runtime, 'llama_cpp', `${MODEL_ID} runs through the managed server`);

// Real size + SHA-256 verification against a small pinned stand-in for the GGUF.
const verifiedAssets = model.assets.map((asset, index) => {
  const content = Buffer.from(`verified-${MODEL_ID}-${index}`);
  return { asset: { ...asset, bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }, content };
});
const verifiedModel = { ...model, assets: verifiedAssets.map((entry) => entry.asset) };
const modelDir = path.join(tmp, 'local-ai', 'models', MODEL_ID);
await mkdir(modelDir, { recursive: true });
for (const { asset, content } of verifiedAssets) await writeFile(path.join(modelDir, asset.file), content);

// The first process becomes the broken one; every later process is healthy.
const runtimeDir = path.join(tmp, 'local-ai', 'runtime', 'b10002');
await mkdir(runtimeDir, { recursive: true });
const launches = path.join(tmp, 'launches.jsonl');
const serverScript = path.join(runtimeDir, 'fake-llama-server.mjs');
await writeFile(serverScript, `import http from 'node:http';
import fs from 'node:fs';
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const instance = fs.existsSync(${JSON.stringify(launches)}) ? fs.readFileSync(${JSON.stringify(launches)}, 'utf8').trim().split('\\n').length + 1 : 1;
fs.appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ instance, pid: process.pid, args }) + '\\n');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    if (req.url !== '/v1/embeddings') { res.statusCode = 404; return res.end('{}'); }
    if (instance === 1) { res.statusCode = 500; return res.end(JSON.stringify({ error: { code: 500, message: 'Compute error.', type: 'server_error' } })); }
    const input = JSON.parse(body).input;
    const count = Array.isArray(input) ? input.length : 1;
    res.end(JSON.stringify({ object: 'list', data: Array.from({ length: count }, (_, index) => ({ object: 'embedding', index, embedding: [0.6, 0.8] })) }));
  });
}).listen(port, '127.0.0.1');
`);
const executable = path.join(runtimeDir, 'llama-server');
await writeFile(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverScript)} "$@"\n`);
await chmod(executable, 0o755);

let manager;
try {
  const electronStub = path.join(tmp, 'electron-stub.mjs');
  const catalogueStub = path.join(tmp, 'local-models-stub.mjs');
  await writeFile(electronStub, `export const app = { getPath: () => ${JSON.stringify(tmp)}, once: () => {} };\nexport const utilityProcess = { fork: () => { throw new Error('Unexpected Gemma utility process'); } };\nexport default { app, utilityProcess };\n`);
  await writeFile(catalogueStub, `
    const model = ${JSON.stringify(verifiedModel)};
    export const NODUS_LOCAL_MODELS = [model];
    export const getNodusLocalModel = (id) => id === model.id ? model : undefined;
    export const nodusLocalModelBytes = (entry) => entry.assets.reduce((sum, asset) => sum + asset.bytes, 0);
  `);
  const outfile = path.join(tmp, 'nodusLocalAi.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/nodusLocalAi.ts')],
    outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    tsconfig: path.join(repoRoot, 'electron/tsconfig.json'),
    external: ['@huggingface/transformers'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
    plugins: [{ name: 'stub-electron', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }));
      b.onResolve({ filter: /^@shared\/localAiModels$/ }, () => ({ path: catalogueStub }));
    } }],
  });
  manager = await import(pathToFileURL(outfile).href);

  await assert.rejects(manager.embedWithNodusLocal(MODEL_ID, ['primera frase']), /Compute error/,
    'the backend failure reaches the caller instead of producing empty vectors');
  const vectors = await manager.embedWithNodusLocal(MODEL_ID, ['segunda frase', 'tercera frase']);
  assert.deepEqual(vectors, [[0.6, 0.8], [0.6, 0.8]], 'the next request is served by a fresh, healthy process');

  const started = (await readFile(launches, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(started.length, 2, 'exactly one replacement process was started');
  assert.notEqual(started[0].pid, started[1].pid);
  for (const { args } of started) {
    assert.equal(args[args.indexOf('--pooling') + 1], 'last', 'Harrier pools the appended end-of-text token');
    assert.equal(args[args.indexOf('--ubatch-size') + 1], '8192', 'one complete 8k input fits the physical batch');
  }
  await manager.embedWithNodusLocal(MODEL_ID, ['cuarta frase']);
  assert.equal((await readFile(launches, 'utf8')).trim().split('\n').length, 2, 'a healthy server is reused, not restarted per request');
  console.log('Local compute-error restart tests passed!');
} finally {
  manager?.stopNodusLocalServer();
  spawnSync('pkill', ['-f', serverScript], { stdio: 'ignore' });
  await rm(tmp, { recursive: true, force: true });
}
