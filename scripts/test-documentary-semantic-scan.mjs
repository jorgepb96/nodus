// The documentary semantic search, as the retrieval worker opens the store: read-only and mapped,
// ranking exactly as it did, non-finite vectors still rejected on both storage formats.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-semantic-scan')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-semantic-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
try {
  const { DocumentaryStore } = require(path.join(repoRoot, 'electron/db/documentaryStore.ts'));
  const file = path.join(scratch, 'store.sqlite');
  const writer = new DocumentaryStore(file);
  let seed = 11;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const DIM = 32;
  const vectors = new Map();
  writer.db.prepare("INSERT INTO documentary_revisions(index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at) VALUES ('k','d','{}',1,1,0)").run();
  const insert = writer.db.prepare("INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json,vector,vector_json) VALUES (?,'k','d',?,?,'{}',?,?)");
  for (let ordinal = 0; ordinal < 400; ordinal += 1) {
    const values = Array.from({ length: DIM }, random);
    if (ordinal % 37 === 0) values[ordinal % DIM] = NaN;
    if (ordinal % 41 === 0) values[(ordinal + 1) % DIM] = ordinal % 2 ? Infinity : -Infinity;
    const legacy = ordinal % 5 === 0;
    vectors.set(`p${ordinal}`, values);
    insert.run(`p${ordinal}`, ordinal, `text ${ordinal}`, legacy ? null : Buffer.from(Float32Array.from(values).buffer), legacy ? JSON.stringify(values.map(value => Number.isFinite(value) ? Math.fround(value) : null)) : null);
  }
  writer.close();
  const store = new DocumentaryStore(file, true);
  assert.ok(Number(store.db.pragma('mmap_size', { simple: true })) > 0, 'the read-only store is memory-mapped');
  // The ranking as it was computed: every element tested before the products.
  const reference = (query, threshold) => {
    const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
    const rows = store.db.prepare('SELECT id,vector,vector_json FROM documentary_passages').all().map(row => {
      const vector = row.vector ? new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4) : JSON.parse(row.vector_json);
      if (vector.length !== query.length || [...vector].some(value => !Number.isFinite(value))) return { id: row.id, similarity: -2 };
      let dot = 0, magnitude = 0;
      for (let index = 0; index < vector.length; index += 1) { dot += vector[index] * query[index]; magnitude += vector[index] ** 2; }
      return { id: row.id, similarity: magnitude ? dot / (norm * Math.sqrt(magnitude)) : -2 };
    });
    return rows.filter(row => row.similarity >= threshold).sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : 1)).map(row => row.id);
  };
  for (const threshold of [-1, -3, 0.2]) {
    const query = Array.from({ length: DIM }, random);
    const found = store.semanticSearch(query, ['k'], 1000, threshold).map(row => row.id);
    assert.deepEqual(found, reference(query, threshold), `threshold ${threshold}`);
    if (threshold === -3) assert.ok(found.length === 400, 'rejected vectors score -2, below every real similarity');
  }
  store.close();
  console.log('Documentary semantic search: mapped read-only store, identical ranking, non-finite vectors rejected.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
