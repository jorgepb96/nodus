import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createResearchTestRoot, researchTestEnvironment, macResearchSandbox, verifyResearchSandbox } from './research-isolation.mjs';
import { prepareEmbeddingCorpus } from './embeddinggemma-corpus.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionProfiles = ['multilingual-e5-small-int8', 'gte-multilingual-base-int8', 'bge-m3-q8_0', 'embeddinggemma-2-text-q8-512-v1', 'embeddinggemma-2-text-q8-256-v1'];
const controls = ['embeddinggemma-2-text-q4-512-lab', 'embeddinggemma-2-text-q4-256-lab', 'embeddinggemma-2-text-q8-768-lab'];
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const mode = process.argv[2] ?? 'runtime';
const rootArgument = process.argv.find(value => value.startsWith('--root='))?.slice(7);
const root = rootArgument ? syncFs.realpathSync(rootArgument) : createResearchTestRoot();
const marker = JSON.parse(await fs.readFile(path.join(root, 'isolation.json'), 'utf8'));
if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== root) throw new Error('Required isolation manifest is missing or inconsistent');
const compiled = path.join(root, 'tmp', 'models.mjs');
await build({ entryPoints: [path.join(repo, 'shared/localAiModels.ts')], outfile: compiled, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { NODUS_LOCAL_MODELS } = await import(pathToFileURL(compiled));
if (mode !== 'child') await build({ entryPoints: [path.join(repo, 'electron/workers/embeddingGemma2Worker.ts')], outfile: path.join(repo, 'dist-electron/embeddingGemma2Worker.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['@nodus/embeddinggemma-transformers'], logLevel: 'silent' });

async function download(asset, directory) {
  const target = path.join(directory, asset.file); await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await fs.readFile(target).catch(() => null);
  if (existing && existing.length === asset.bytes && hash(existing) === asset.sha256) return;
  const partial = `${target}.download`; let offset = (await fs.stat(partial).catch(() => null))?.size ?? 0;
  const response = await fetch(asset.url, { headers: offset ? { Range: `bytes=${offset}-` } : {} });
  if (!response.ok) throw new Error(`Download ${asset.file}: HTTP ${response.status}`);
  if (response.status !== 206) offset = 0;
  const handle = await fs.open(partial, offset ? 'a' : 'w');
  try { for await (const chunk of response.body) await handle.write(chunk); } finally { await handle.close(); }
  const buffer = await fs.readFile(partial);
  if (buffer.length !== asset.bytes || hash(buffer) !== asset.sha256) throw new Error(`Invalid size/SHA256: ${asset.file}`);
  await fs.rename(partial, target);
}
async function laboratoryAssets(model) {
  const response = await fetch('https://huggingface.co/api/models/onnx-community/embeddinggemma-2-ONNX/revision/daa72c51243991dfcaf9f9137d2c573d8f7790c0?blobs=true');
  if (!response.ok) throw new Error('Laboratory asset metadata unavailable');
  const metadata = await response.json();
  return model.assets.filter(asset => !asset.file.startsWith('onnx/')).concat(['onnx/model_q4.onnx', 'onnx/model_q4.onnx_data'].map(file => {
    const sibling = metadata.siblings.find(entry => entry.rfilename === file);
    if (!sibling?.lfs?.sha256) throw new Error(`Missing laboratory hash: ${file}`);
    return { file, bytes: sibling.size, sha256: sibling.lfs.sha256, url: `https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/${metadata.sha}/${file}` };
  }));
}
async function prepareModel(modelId) {
  const model = NODUS_LOCAL_MODELS.find(model => model.id === modelId) ?? NODUS_LOCAL_MODELS.find(model => model.id === 'embeddinggemma-2-text-q8-512-v1');
  const directory = path.join(root, 'profile', 'local-ai', 'models', model.assetFamily ?? model.id);
  const assets = modelId.includes('-q4-') ? await laboratoryAssets(model) : model.assets;
  console.log(`Preparing ${modelId} (${root})`);
  for (const asset of assets) await download(asset, directory);
  let executable;
  if (modelId === 'bge-m3-q8_0') {
    const runtimeModule = path.join(root, 'tmp/runtime.mjs');
    await build({ entryPoints: [path.join(repo, 'shared/localAiRuntime.ts')], outfile: runtimeModule, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    const { runtimeAssetCatalog } = await import(pathToFileURL(runtimeModule));
    const asset = runtimeAssetCatalog()[`${process.platform}-${process.arch}`]?.[0];
    if (!asset || asset.archive !== 'tar.gz') throw new Error('BGE native QA runtime requires this platform’s tar archive');
    const runtimeDirectory = path.join(root, 'profile/local-ai/runtime'); await fs.mkdir(runtimeDirectory, { recursive: true });
    await download({ ...asset, file: asset.name }, runtimeDirectory);
    const extracted = spawnSync('tar', ['-xzf', path.join(runtimeDirectory, asset.name), '-C', runtimeDirectory]);
    if (extracted.status !== 0) throw new Error('Runtime extraction failed');
    async function find(folder) { for (const entry of await fs.readdir(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); if (entry.isFile() && entry.name === 'llama-server') return file; if (entry.isDirectory()) { const nested = await find(file); if (nested) return nested; } } }
    executable = await find(runtimeDirectory); if (!executable) throw new Error('Missing llama-server');
    await fs.chmod(executable, 0o700);
  }
  await fs.writeFile(path.join(root, 'artifacts', 'model-manifest.json'), JSON.stringify({ ...model, testedProfile: modelId, assets, directory, executable }, null, 2));
  return { model, directory };
}

function inferenceWorker(modelId, directory) {
  const eg2 = modelId.startsWith('embeddinggemma-2-');
  const file = eg2 ? path.join(repo, 'dist-electron/embeddingGemma2Worker.cjs') : path.join(repo, 'scripts/embeddinggemma-legacy-worker.cjs');
  const worker = new Worker(file, { workerData: { directory, dtype: modelId.includes('-q4-') ? 'q4' : 'q8', threads: Math.max(1, Math.min(4, os.availableParallelism() - 1)) } });
  let next = 0; const pending = new Map();
  worker.on('message', reply => { const request = pending.get(reply.id); if (!request) return; pending.delete(reply.id); reply.ok ? request.resolve(reply.result) : request.reject(new Error(reply.error)); });
  const fail = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  worker.on('error', fail); worker.on('exit', code => fail(new Error(`Worker exit ${code}`)));
  function request(operation, texts, dimensions) {
    return new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); worker.postMessage({ id, operation, texts, dimensions }); });
  }
  async function embed(texts, role = 'document', titles = [], lane = 'recommended') {
    const prepared = texts.map((text, index) => eg2 ? role === 'query' ? `task: search result | query: ${text}` : `title: ${titles[index] || 'none'} | text: ${text}`
      : lane === 'recommended' && modelId.startsWith('multilingual-e5') ? `${role === 'query' ? 'query' : 'passage'}: ${text}` : text);
    const dimensions = eg2 ? Number(modelId.match(/-(256|512|768)-/)[1]) : undefined;
    if (!eg2) return request('infer', prepared, dimensions);
    const groups = await request('plan', prepared, dimensions); const vectors = [];
    for (const group of groups) vectors.push(...await request('infer', group.map(index => prepared[index]), dimensions));
    return vectors;
  }
  return { worker, embed, request };
}
function cosine(a, b) { let dot = 0, aa = 0, bb = 0; for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; } return dot / Math.sqrt(aa * bb); }
function scores(ranked, relevant) {
  const wanted = new Set(relevant); const ranks = ranked.map((id, index) => wanted.has(id) ? index + 1 : 0).filter(Boolean);
  const recall = k => ranks.filter(rank => rank <= k).length / wanted.size;
  const dcg = ranks.filter(rank => rank <= 10).reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
  const ideal = Array.from({ length: Math.min(10, wanted.size) }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
  return { recall5: recall(5), recall10: recall(10), mrr10: ranks[0] && ranks[0] <= 10 ? 1 / ranks[0] : 0, ndcg10: dcg / ideal };
}
function aggregate(rows) { const positive = rows.filter(row => row.split === 'evaluation' && row.relevant.length); return { queries: positive.length, ...Object.fromEntries(['recall5', 'recall10', 'mrr10', 'ndcg10'].map(key => [key, positive.length ? positive.reduce((sum, row) => sum + row.metrics[key], 0) / positive.length : null])) }; }
const terms = text => text.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
function lexicalScores(question, chunks) {
  const documents = chunks.map(chunk => terms(chunk.text)), counts = documents.map(words => { const count = new Map(); for (const word of words) count.set(word, (count.get(word) ?? 0) + 1); return count; });
  const average = documents.reduce((sum, words) => sum + words.length, 0) / documents.length;
  return counts.map((count, index) => [...new Set(terms(question))].reduce((score, word) => {
    const frequency = count.get(word) ?? 0, df = counts.filter(row => row.has(word)).length;
    return score + Math.log(1 + (counts.length - df + .5) / (df + .5)) * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * documents[index].length / average));
  }, 0));
}
function absenceThreshold(rows) {
  const development = rows.filter(row => row.split === 'development');
  const candidates = [...new Set(development.map(row => row.candidates[0]?.score ?? 0))].sort((a, b) => a - b);
  const accuracy = (set, threshold) => { const positives = set.filter(row => row.relevant.length), negatives = set.filter(row => !row.relevant.length);
    const recall = positives.filter(row => (row.candidates[0]?.score ?? 0) >= threshold).length / positives.length;
    const rejection = negatives.filter(row => (row.candidates[0]?.score ?? 0) < threshold).length / negatives.length;
    return { balancedAccuracy: (recall + rejection) / 2, positiveAccepted: recall, insufficientEvidenceRejected: rejection }; };
  const threshold = candidates.reduce((best, value) => accuracy(development, value).balancedAccuracy > accuracy(development, best).balancedAccuracy ? value : best, 0);
  return { threshold, chosenUsing: 'development only', evaluation: accuracy(rows.filter(row => row.split === 'evaluation'), threshold), limitation: 'Similarity threshold is not a factual evidence verifier; Research Chat grounding is evaluated separately.' };
}
async function runChild(modelId, directory, audit) {
  const start = performance.now();
  let runtime;
  if (modelId === 'bge-m3-q8_0') {
    const metadata = JSON.parse(await fs.readFile(path.join(root, 'artifacts/model-manifest.json'), 'utf8'));
    const port = Number(process.argv.find(value => value.startsWith('--local-port='))?.slice(13));
    const child = spawn(metadata.executable, ['--model', path.join(directory, metadata.modelFile), '--host', '127.0.0.1', '--port', String(port), '--ctx-size', '8192', '--batch-size', '8192', '--ubatch-size', '8192', '--embedding', '--pooling', 'mean', '--threads', '4', '--parallel', '1', '--n-gpu-layers', '999', '--no-webui'], { cwd: path.dirname(metadata.executable), stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', bytes => syncFs.appendFileSync(path.join(root, 'artifacts/llama-runtime.log'), bytes));
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(`llama-server exited: ${child.exitCode}`); if (await fetch(`http://127.0.0.1:${port}/health`).then(response => response.ok).catch(() => false)) break; await new Promise(resolve => setTimeout(resolve, 200)); }
    runtime = { worker: { terminate: async () => { child.kill('SIGTERM'); } }, embed: async texts => {
      const output = [];
      for (let offset = 0; offset < texts.length; offset += 8) {
        const response = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: texts.slice(offset, offset + 8), model: modelId }) });
        if (!response.ok) throw new Error(`llama embeddings HTTP ${response.status}`);
        const body = await response.json(); output.push(...body.data.sort((a, b) => a.index - b.index).map(entry => entry.embedding));
      }
      return output;
    } };
  } else runtime = inferenceWorker(modelId, directory);
  try {
    const vector = (await runtime.embed(['La biblioteca abrió en 1912.'], 'document', ['Historia']))[0];
    const coldMs = performance.now() - start;
    if (!vector.every(Number.isFinite) || Math.abs(Math.hypot(...vector) - 1) > .0001) throw new Error('Invalid native result');
    const warm = []; for (let n = 0; n < 5; n++) { const before = performance.now(); await runtime.embed(['When was the school library opened?'], 'query'); warm.push(performance.now() - before); }
    const report = { profile: modelId, platform: process.platform, architecture: process.arch, node: process.version, cpu: os.cpus()[0].model, memoryBytes: os.totalmem(), dimensions: vector.length, coldMs, warmMs: warm,
      maxRssKiB: process.resourceUsage().maxRSS, network: 'OS sandbox denies all external inference traffic', runtime: modelId.startsWith('embeddinggemma') ? 'Transformers.js 4.3.1 / CPU' : modelId === 'bge-m3-q8_0' ? 'llama.cpp b10002 / native' : 'Transformers.js 3.8.1 / CPU', results: [] };
    if (modelId.startsWith('embeddinggemma')) {
      try { await runtime.embed(['token '.repeat(10000)], 'query'); throw new Error('Oversized input was silently accepted'); }
      catch (error) { if (!/8192 tokens/.test(error.message)) throw error; report.oversizeRejected = true; }
      if (process.argv.includes('--context')) {
        const { AutoTokenizer, env } = await import('@nodus/embeddinggemma-transformers');
        env.allowRemoteModels = false; env.allowLocalModels = true;
        const tokenizer = await AutoTokenizer.from_pretrained(directory, { local_files_only: true });
        const prefix = 'title: Context QA | text: ', context = [];
        for (const target of [2048, 8192]) {
          let low = 0, high = target * 2;
          while (low < high) { const middle = Math.ceil((low + high) / 2);
            const tokens = tokenizer(prefix + 'water '.repeat(middle), { truncation: false, padding: false }).input_ids.dims.at(-1);
            if (tokens <= target) low = middle; else high = middle - 1;
          }
          const text = 'water '.repeat(low), tokens = tokenizer(prefix + text, { truncation: false, padding: false }).input_ids.dims.at(-1);
          const began = performance.now();
          const [result] = await runtime.embed([text], 'document', ['Context QA']);
          context.push({ targetTokens: target, tokensIncludingPrefixAndSpecial: tokens, elapsedMs: performance.now() - began,
            maxRssKiB: process.resourceUsage().maxRSS, dimensions: result.length, norm: Math.hypot(...result) });
          await fs.writeFile(path.join(root, 'artifacts/context-report.json'), JSON.stringify({ profile: modelId, context, note: 'Long-context CPU measurements, distinct from the ordinary memory/latency acceptance gate.' }, null, 2));
        }
        report.context = context;
      }
    }
    if (audit) {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'artifacts/corpus-manifest.json'), 'utf8'));
      const queries = JSON.parse(await fs.readFile(path.join(root, 'artifacts/queries-gold.json'), 'utf8'));
      const chunks = manifest.documents.flatMap(document => document.controlChunks.map(chunk => ({ ...chunk, documentId: document.id, language: document.language, format: document.format })));
      for (const lane of modelId.startsWith('embeddinggemma') ? ['recommended'] : ['current', 'recommended']) {
        const vectors = await runtime.embed(chunks.map(chunk => chunk.text), 'document', chunks.map(chunk => chunk.title), lane);
        const queryVectors = await runtime.embed(queries.map(query => query.question), 'query', [], lane);
        for (const retrieval of ['semantic', 'lexical', 'hybrid']) {
          const rows = queries.map((query, index) => {
            const eligible = chunks.filter(chunk => !query.filterLanguage || chunk.language === query.filterLanguage);
            const lexical = lexicalScores(query.question, eligible);
            const semantic = eligible.map(chunk => ({ id: chunk.documentId, score: cosine(queryVectors[index], vectors[chunks.indexOf(chunk)]) })).sort((a, b) => b.score - a.score);
            const rankedLexical = eligible.map((chunk, row) => ({ id: chunk.documentId, score: lexical[row] })).sort((a, b) => b.score - a.score);
            const candidates = retrieval === 'semantic' ? semantic : retrieval === 'lexical' ? rankedLexical : eligible.map(chunk => ({ id: chunk.documentId,
              score: 1 / (60 + semantic.findIndex(row => row.id === chunk.documentId) + 1) + 1 / (60 + rankedLexical.findIndex(row => row.id === chunk.documentId) + 1) })).sort((a, b) => b.score - a.score);
            return { ...query, lane, retrieval, candidates: candidates.slice(0, 10), metrics: query.relevant.length ? scores(candidates.map(row => row.id), query.relevant) : null };
          });
          report.results.push({ lane, retrieval, metrics: aggregate(rows), queries: rows, absence: absenceThreshold(rows),
            byLanguage: Object.fromEntries([...new Set(queries.map(query => query.language))].map(language => [language, aggregate(rows.filter(row => row.language === language))])),
            byFormat: Object.fromEntries([...new Set(chunks.map(chunk => chunk.format))].map(format => [format, aggregate(rows.filter(row => row.relevant.some(id => chunks.find(chunk => chunk.documentId === id)?.format === format)))])),
            byDifficulty: Object.fromEntries([...new Set(queries.map(query => query.kind))].map(kind => [kind, aggregate(rows.filter(row => row.kind === kind))])) });
        }
        report.corpus = { format: manifest.format, sha256: hash(await fs.readFile(path.join(root, 'artifacts/corpus-manifest.json'))), queriesSha256: hash(await fs.readFile(path.join(root, 'artifacts/queries-gold.json'))), limitations: manifest.limitations };
      }
    }
    if (process.argv.includes('--capacity')) {
      const sizes = [1000, 10000]; const capacity = [];
      let vectors = [];
      for (const count of sizes) {
        const began = performance.now(), previous = vectors.length;
        const texts = Array.from({ length: count - previous }, (_, index) => `QA archive record ${index + previous}. In the survey at village ${index % 173}, ${240 + index % 41} participants compared spaced recall with rereading. The median observation was ${18 + index % 11} and the mean ${24 + index % 7}. The water sensor used green light, with calibration after thirty days. Record date: ${1900 + index % 120}.`);
        for (let offset = 0; offset < texts.length; offset += 8) {
          vectors.push(...await runtime.embed(texts.slice(offset, offset + 8)));
          if (vectors.length % 1000 === 0 || vectors.length === count) {
            await fs.writeFile(path.join(root, 'artifacts/capacity-progress.json'), JSON.stringify({ target: count, embedded: vectors.length, elapsedMs: performance.now() - began }));
            console.log(`Capacity ${modelId}: ${vectors.length}/${count} real vectors`);
          }
        }
        if (process.argv.includes('--persist-capacity')) {
          await fs.appendFile(path.join(root, 'artifacts/capacity-texts.jsonl'), texts.map(text => JSON.stringify(text)).join('\n') + '\n');
          const data = new Float32Array(vectors.length * vectors[0].length);
          vectors.forEach((vector, index) => data.set(vector, index * vector.length));
          await fs.writeFile(path.join(root, `artifacts/capacity-${count}.f32`), Buffer.from(data.buffer));
        }
        const indexMs = performance.now() - began, queryMs = [], scanMs = [], totalMs = [];
        for (let round = 0; round < 20; round++) {
          const before = performance.now(); const [query] = await runtime.embed(['What device detects water cloudiness using visible green light?'], 'query');
          const embeddedAt = performance.now(); let best = -Infinity;
          for (const vector of vectors) best = Math.max(best, cosine(query, vector));
          const finished = performance.now(); queryMs.push(embeddedAt - before); scanMs.push(finished - embeddedAt); totalMs.push(finished - before);
        }
        const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
        capacity.push({ count, newlyEmbedded: count - previous, indexMs, chunksPerSecond: (count - previous) / (indexMs / 1000), queryMs, scanMs, totalMs,
          p50: percentile(totalMs, .5), p95: percentile(totalMs, .95), maxRssKiB: process.resourceUsage().maxRSS, floatIndexBytes: count * vector.length * 4 });
        await fs.writeFile(path.join(root, 'artifacts/capacity-report.json'), JSON.stringify({ profile: modelId, capacity, note: 'Real generated text embeddings; capacity scan in JS. Desktop/SQLite UI latency requires the product runner.' }, null, 2));
      }
      const [query] = await runtime.embed(['Which trial measured recall?'], 'query'); const began = performance.now();
      for (let index = 0; index < 50000; index++) cosine(query, vectors[index % vectors.length]);
      report.scan50kMs = performance.now() - began; report.capacity = capacity;
    }
    report.maxRssKiB = process.resourceUsage().maxRSS;
    await fs.writeFile(path.join(root, 'artifacts/runtime-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ profile: modelId, dimensions: vector.length, coldMs, warmMs: warm, report: path.join(root, 'artifacts/runtime-report.json') }));
  } finally { await runtime.worker.terminate(); }
}
if (mode === 'child') {
  const modelId = process.argv[3]; const metadata = JSON.parse(await fs.readFile(path.join(root, 'artifacts/model-manifest.json'), 'utf8'));
  await runChild(modelId, metadata.directory, process.argv.includes('--audit'));
} else if (mode === 'prepare-child') {
  const modelId = process.argv.find(value => value.startsWith('--profile='))?.slice(10);
  if (!productionProfiles.includes(modelId) && !controls.includes(modelId)) throw new Error('Unknown QA profile');
  await prepareModel(modelId);
  if (process.argv.includes('--audit')) {
    const source = process.argv.find(value => value.startsWith('--corpus-root='))?.slice(14);
    if (source) {
      const canonical = syncFs.realpathSync(source), sourceMarker = JSON.parse(await fs.readFile(path.join(canonical, 'isolation.json'), 'utf8'));
      if (sourceMarker.root !== canonical || sourceMarker.format !== marker.format) throw new Error('Only a marked QA corpus may be copied');
      await fs.cp(path.join(canonical, 'fixtures/corpus'), path.join(root, 'fixtures/corpus'), { recursive: true });
      const manifest = JSON.parse(await fs.readFile(path.join(canonical, 'artifacts/corpus-manifest.json'), 'utf8'));
      manifest.documents = manifest.documents.map(document => ({ ...document, file: path.join(root, 'fixtures/corpus', path.basename(document.file)) }));
      await fs.writeFile(path.join(root, 'artifacts/corpus-manifest.json'), JSON.stringify(manifest, null, 2));
      await fs.copyFile(path.join(canonical, 'artifacts/queries-gold.json'), path.join(root, 'artifacts/queries-gold.json'));
    } else await prepareEmbeddingCorpus(root);
  }
  if (process.platform !== 'darwin') throw new Error('Native audit requires a disposable OS/container with enforced isolation on this platform');
  const localPort = modelId === 'bge-m3-q8_0' ? await new Promise(resolve => { const server = http.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }) : null;
  const policy = macResearchSandbox(root, localPort ? [localPort] : []);
  const isolation = verifyResearchSandbox(root, policy);
  await fs.writeFile(path.join(root, 'artifacts/isolation-verification.json'), JSON.stringify(isolation, null, 2));
  if (process.argv.includes('--persist-capacity')) await fs.writeFile(path.join(root, 'artifacts/capacity-texts.jsonl'), '');
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, fileURLToPath(import.meta.url), 'child', modelId, `--root=${root}`, ...(localPort ? [`--local-port=${localPort}`] : []), ...['audit', 'capacity', 'context', 'persist-capacity'].filter(flag => process.argv.includes(`--${flag}`)).map(flag => `--${flag}`)], { stdio: 'inherit', env: researchTestEnvironment(root) });
  process.exitCode = await new Promise(resolve => child.once('exit', resolve));
} else if (mode === 'replay-corpus') {
  const file = process.argv.find(value => value.startsWith('--manifest='))?.slice(11);
  if (!file) throw new Error('Provide an archived campaign --manifest');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  if (manifest.format !== 'nodus.embedding-corpus/2' || manifest.documents.length !== 40) throw new Error('Invalid archived corpus');
  const archive = await fs.realpath(path.dirname(file));
  const publicSources = JSON.parse(await fs.readFile(path.join(repo, 'audit/adaptive-concurrency/corpus.json'), 'utf8')).papers;
  const ids = new Set();
  const folder = path.join(root, 'fixtures/corpus'); await fs.mkdir(folder, { recursive: true });
  for (const document of manifest.documents) {
    if (ids.has(document.id)) throw new Error('Duplicate archived document'); ids.add(document.id);
    if (!/^fixtures\/(?:fixture-\d{2}\.(?:pdf|docx|epub|md|txt|csv|xlsx)|public-[A-Z0-9]+\.pdf)$/.test(document.file)) throw new Error('Invalid archived fixture path');
    const target = path.join(folder, path.basename(document.file));
    if (document.id.startsWith('fixture-')) {
      const source = await fs.realpath(path.join(archive, document.file));
      if (!source.startsWith(`${archive}${path.sep}`)) throw new Error('Archived fixture escapes the campaign');
      await fs.copyFile(source, target);
    }
    else {
      if (!publicSources.some(source => document.id === `public-${source.key}` && document.provenance === source.url && document.sha256 === source.sha256)) throw new Error('Unapproved archived public source');
      const response = await fetch(document.provenance); if (!response.ok) throw new Error('Archived public PDF unavailable');
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
    }
    if (hash(await fs.readFile(target)) !== document.sha256) throw new Error(`Archived corpus hash mismatch: ${document.id}`);
    document.file = target;
  }
  await fs.writeFile(path.join(root, 'artifacts/corpus-manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.copyFile(path.join(path.dirname(file), 'queries-gold.json'), path.join(root, 'artifacts/queries-gold.json'));
  console.log(`Replayed corpus: ${root}`);
} else if (mode === 'corpus') {
  const { manifest } = await prepareEmbeddingCorpus(root, { publicPdfs: !process.argv.includes('--no-public-download') }); console.log(JSON.stringify({ root, totals: manifest.totals }));
} else {
  const profiles = process.argv.includes('--all') ? [...productionProfiles, ...controls] : [process.argv.find(value => value.startsWith('--profile='))?.slice(10) ?? productionProfiles[3]];
  const campaign = { format: 'nodus.embedding-campaign/1', root, startedAt: new Date().toISOString(), budgetUsd: 5, spendUsd: 0, profiles: [], pending: ['Windows x64 native/package', 'Linux x64 native/package', 'macOS Intel native/package', 'Manual review of 20 Research Chat answers', 'Full product quality gates'] };
  for (const modelId of profiles) {
    const isolated = createResearchTestRoot();
    try {
      // Every profile owns its own caches and databases, even when testing the same weights.
      const command = [process.execPath, fileURLToPath(import.meta.url), 'prepare-child', `--root=${isolated}`, `--profile=${modelId}`, ...(mode === 'audit' ? ['--audit'] : [])];
      const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: researchTestEnvironment(isolated) });
      const code = await new Promise(resolve => child.once('exit', resolve));
      const report = await fs.readFile(path.join(isolated, 'artifacts/runtime-report.json'), 'utf8').then(JSON.parse).catch(() => null);
      campaign.profiles.push({ id: modelId, root: isolated, status: code === 0 ? 'executed' : 'failed', report });
    } catch (error) { campaign.profiles.push({ id: modelId, root: isolated, status: 'failed', error: error.message }); }
  }
  await fs.writeFile(path.join(root, 'artifacts/campaign.json'), JSON.stringify(campaign, null, 2)); console.log(`Campaign: ${root}/artifacts/campaign.json`);
  if (campaign.profiles.some(profile => profile.status !== 'executed')) process.exitCode = 1;
}
