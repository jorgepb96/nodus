import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-retrieval-scale')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-retrieval-scale-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const { DocumentaryStore } = require('../electron/db/documentaryStore.ts');
const { runDocumentaryRetrieval } = require('../electron/db/documentaryRetrieval.ts');
const count = 100_000, dimensions = 128, perDocument = 100;
const filename = path.join(root, 'store.sqlite');
const store = new DocumentaryStore(filename);
let child;
try {
  const insertRevision = store.db.prepare("INSERT INTO documentary_revisions(index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at) VALUES (?,?,'{}',1,1,0)");
  const insert = store.db.prepare('INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json,vector) VALUES(?,?,?,?,?,?,?)');
  const fts = store.db.prepare('INSERT INTO documentary_fts(id,text) VALUES(?,?)');
  let seed = 97;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 - 0.5; };
  const vector = () => Float32Array.from({ length: dimensions }, random);
  const keys = [];
  store.db.transaction(() => {
    for (let index = 0; index < count; index++) {
      const document = Math.floor(index / perDocument), key = `index-${document}`, id = `${key}:${index % perDocument}`;
      if (index % perDocument === 0) { insertRevision.run(key, `source-${document}`); keys.push(key); }
      const text = `Fuente histórica ${document}. Pasaje ${index}: educación, legislación y organización social de la Segunda República.`;
      insert.run(id, key, `source-${document}`, index % perDocument, text, JSON.stringify({ pageNumber: index % perDocument + 1 }), Buffer.from(vector().buffer));
      fts.run(id, text);
    }
  })();
  const worker = path.join(root, 'retrieval.cjs');
  await build({ entryPoints: [path.join(repoRoot, 'electron/workers/documentaryRetrievalWorker.ts')], outfile: worker, bundle: true, platform: 'node', format: 'cjs',
    external: ['better-sqlite3'], alias: { '@shared': path.join(repoRoot, 'shared') }, logLevel: 'silent' });
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  child = fork(worker, [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  let next = 0;
  const pending = new Map();
  child.on('message', message => { const request = pending.get(message.id); if (request) { pending.delete(message.id); clearTimeout(request.deadline); request.resolve(message); } });
  const ask = input => new Promise((resolve, reject) => {
    const id = ++next;
    const deadline = setTimeout(() => { pending.delete(id); reject(new Error('Large-corpus retrieval exceeded 30 seconds')); }, 30_000);
    pending.set(id, { resolve, deadline }); child.send({ ...input, id, filename });
  });
  const settings = { preset: 'custom', candidates: 60, passagesPerRound: 10, evidenceTokens: 8000, rounds: 1, autoExpand: false, threshold: { mode: 'automatic' } };
  const cases = [];
  let maximumLagMs = 0, heartbeats = 0, lastTick = performance.now();
  for (const size of [10_000, 50_000, 100_000]) {
    const selected = keys.slice(0, size / perDocument);
    const input = { query: 'unmatched-scale-probe', lexicalKeys: selected, vectorKeys: selected, vector: Array.from(vector()), threshold: -1, settings };
    const expected = runDocumentaryRetrieval(store, input);
    const elapsed = [];
    let rss = 0;
    for (let repeat = 0; repeat < 6; repeat++) {
      lastTick = performance.now();
      const timer = setInterval(() => { const now = performance.now(); maximumLagMs = Math.max(maximumLagMs, now - lastTick - 10); lastTick = now; heartbeats++; }, 10);
      const started = performance.now();
      let result;
      try { result = await ask(input); } finally { clearInterval(timer); }
      elapsed.push(performance.now() - started);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.passages, expected.passages, 'cached production worker preserves the exact SQL/FTS ranking and citation locations');
      rss = Math.max(rss, result.workerRssBytes);
    }
    const warm = elapsed.slice(1).sort((a, b) => a - b);
    cases.push({ passages: size, dimensions, coldMs: elapsed[0], warmP50Ms: warm[Math.floor(warm.length / 2)], warmP95Ms: warm[Math.ceil(warm.length * 0.95) - 1], workerRssBytes: rss, exactRankingAgreement: true });
  }
  assert.ok(heartbeats > 0, 'the calling event loop remains live while retrieval runs in the worker');
  const report = { format: 'nodus.retrieval-scale/1', createdAt: new Date().toISOString(), corpus: 'synthetic Spanish history passages; seeded vectors, not a model-quality benchmark', cases, maximumCallerEventLoopLagMs: maximumLagMs };
  const output = process.env.NODUS_RETRIEVAL_BENCHMARK_REPORT ?? path.join(os.tmpdir(), `nodus-retrieval-scale-${process.pid}.json`);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: output, cases, maximumCallerEventLoopLagMs: maximumLagMs }));
} finally { child?.kill(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
