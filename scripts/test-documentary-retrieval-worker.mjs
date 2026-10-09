// Documentary retrieval runs in one long-lived process that keeps the store open and its vectors
// cached. Two contracts: the process answers every request it is sent (it answered one, then sat
// on the rest), and the cached semantic ranking is exactly the statement's, including after a
// revision's vectors are rewritten in place.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-retrieval-worker')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-documentary-retrieval-worker-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
let child = null;
// A request the process never answers must fail this test, not hang it.
const REPLY_TIMEOUT_MS = 20_000;
try {
  const { DocumentaryStore } = require(path.join(repoRoot, 'electron/db/documentaryStore.ts'));
  const { DocumentaryVectorCache } = require(path.join(repoRoot, 'electron/db/documentaryVectorCache.ts'));
  const file = path.join(scratch, 'store.sqlite');
  const writer = new DocumentaryStore(file);
  let seed = 3;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const DIM = 24;
  const vectorOf = () => Array.from({ length: DIM }, random);
  const blob = values => Buffer.from(Float32Array.from(values).buffer);
  const revision = writer.db.prepare("INSERT INTO documentary_revisions(index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at) VALUES (?,?,'{}',1,1,0)");
  const passage = writer.db.prepare('INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json,vector,vector_json) VALUES (?,?,?,?,?,?,?,?)');
  const fts = writer.db.prepare('INSERT INTO documentary_fts(id,text) VALUES (?,?)');
  // k0-k3 ordinary; k4 holds a legacy JSON vector; k5 vectors of two lengths; k6 NaN and Infinity;
  // k7 two passages with the very same vector (a tie, ranked by id).
  for (let key = 0; key < 8; key += 1) {
    revision.run(`k${key}`, `d${key}`);
    const shared = vectorOf();
    for (let ordinal = 0; ordinal < 40; ordinal += 1) {
      const id = `k${key}:${ordinal}`;
      let values = key === 7 && ordinal < 2 ? shared : vectorOf();
      if (key === 5 && ordinal % 3 === 0) values = values.slice(0, DIM - 4);
      if (key === 6 && ordinal % 5 === 0) values[ordinal % DIM] = ordinal % 2 ? Infinity : NaN;
      const legacy = key === 4 && ordinal === 7;
      const text = `passage ${ordinal} of source ${key} about esters and amides`;
      passage.run(id, `k${key}`, `d${key}`, ordinal, text, JSON.stringify({ pageNumber: ordinal + 1 }), legacy || (key === 3 && ordinal === 39) ? null : blob(values),
        legacy ? JSON.stringify(values.map(value => Number.isFinite(value) ? value : null)) : null);
      fts.run(id, text);
    }
  }
  const store = new DocumentaryStore(file, true);
  const cache = new DocumentaryVectorCache(store);
  const keys = Array.from({ length: 8 }, (_, key) => `k${key}`);
  const check = label => {
    for (const threshold of [-3, -1, 0, 0.3]) for (const limit of [1, 7, 60, 400]) for (const subset of [keys, keys.slice(0, 3), ['k4', 'k7'], ['k5', 'k6', 'k6']]) {
      const query = vectorOf();
      assert.deepEqual(cache.semanticSearch(query, subset, limit, threshold), store.semanticSearch(query, subset, limit, threshold), `${label}: threshold ${threshold}, limit ${limit}, ${subset.join(',')}`);
    }
    const tie = writer.db.prepare("SELECT vector FROM documentary_passages WHERE id='k7:0'").get().vector;
    const query = Array.from(new Float32Array(tie.buffer, tie.byteOffset, DIM));
    assert.deepEqual(cache.semanticSearch(query, ['k7'], 3).map(row => row.id), store.semanticSearch(query, ['k7'], 3).map(row => row.id), `${label}: tied vectors rank by id`);
  };
  check('cold');
  check('warm');
  // Rewritten in place: an update keeps every rowid and id, so only the write counter shows it.
  const rewrite = writer.db.prepare('UPDATE documentary_passages SET vector=? WHERE id=?');
  for (let ordinal = 0; ordinal < 40; ordinal += 2) rewrite.run(blob(vectorOf()), `k1:${ordinal}`);
  writer.db.prepare("UPDATE documentary_passages SET vector=?,vector_json=NULL WHERE id='k4:7'").run(blob(vectorOf()));
  writer.db.prepare("DELETE FROM documentary_passages WHERE id='k2:5'").run();
  check('after in-place writes');
  store.close();

  // ---- the process: every request answered, writes seen between them
  const bundle = path.join(scratch, 'documentaryRetrievalWorker.cjs');
  await build({ entryPoints: [path.join(repoRoot, 'electron/workers/documentaryRetrievalWorker.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs',
    external: ['better-sqlite3'], alias: { '@shared': path.join(repoRoot, 'shared') }, logLevel: 'silent' });
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(scratch, 'node_modules'), 'dir');
  child = fork(bundle, [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const replies = new Map();
  child.on('message', message => { if (message?.type !== 'activity') replies.set(message.id, message); });
  const ask = (id, query, vector) => new Promise((resolve, reject) => {
    const poll = setInterval(() => { if (replies.has(id)) { clearTimeout(deadline); clearInterval(poll); resolve(replies.get(id)); } }, 5);
    const deadline = setTimeout(() => { clearInterval(poll); reject(new Error(`request ${id} got no reply in ${REPLY_TIMEOUT_MS / 1000} s: the process answered only part of what it was sent`)); }, REPLY_TIMEOUT_MS);
    child.send({ id, filename: file, query, lexicalKeys: keys.slice(0, 4), vectorKeys: keys, vector, threshold: -1,
      settings: { preset: 'custom', candidates: 60, passagesPerRound: 12, evidenceTokens: 8000, rounds: 1, autoExpand: false, threshold: { mode: 'automatic' } } });
  });
  const query = vectorOf();
  const first = await ask(1, 'esters', query);
  assert.ok(!first.error && first.passages.length, `first request answered: ${first.error ?? first.passages.length}`);
  const second = await ask(2, 'amides', query);
  assert.ok(!second.error && second.passages.length, 'a second request to the same process is answered');
  // A revision rewritten between requests: the next answer ranks by the new vectors.
  const target = vectorOf();
  writer.db.prepare("UPDATE documentary_passages SET vector=? WHERE id='k0:3'").run(blob(target));
  const third = await ask(3, 'nothing-lexical-matches-this', target);
  assert.equal(third.passages[0]?.id, 'k0:3', 'the process sees vectors rewritten since its last request');
  writer.close();
  console.log('Documentary retrieval worker: one process answers every request; cached ranking identical to the statement, after in-place writes too.');
} finally {
  if (child) child.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
}
