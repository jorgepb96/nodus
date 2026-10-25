// Release-scale gate for the document-level route: a 2,000-work vault with
// several macro/section vectors per work must remain interactive. The production
// repository and production paged scanner are bundled against a real SQLite DB;
// only model configuration and the database singleton are replaced.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const marker = '--electron-document-profile-scale';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const Database = require('better-sqlite3');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'nodus-document-profile-scale-'));
try {
  const databaseShim = path.join(scratch, 'database.js');
  writeFileSync(databaseShim, `
    let db=null,query=null;
    exports.__setDb=(value)=>{db=value};
    exports.getDb=()=>db;
    exports.setVectorScanQuery=(value)=>{query=value};
    exports.__query=()=>query;
  `);
  writeFileSync(path.join(scratch, 'ideasRepo.js'), `
    exports.currentEmbeddingConfig=()=>({provider:'openai',model:'document-scale'});
    exports.encodeEmbedding=(values)=>{const v=Float32Array.from(values);return Buffer.from(v.buffer,v.byteOffset,v.byteLength)};
  `);
  const entry = path.join(scratch, 'scale-entry.ts');
  writeFileSync(entry, `
    export * from ${JSON.stringify(path.join(repoRoot, 'electron/db/documentProfilesRepo.ts'))};
    export { runMigrations } from ${JSON.stringify(path.join(repoRoot, 'electron/db/migrations.ts'))};
    export { ensureInitialEmbeddingIndex, embeddingProfile } from ${JSON.stringify(path.join(repoRoot, 'electron/db/embeddingIndexesRepo.ts'))};
  `);
  const bundle = path.join(scratch, 'documentProfilesRepo.cjs');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    '--external:./database', '--external:./ideasRepo', `--outfile=${bundle}`,
  ], { cwd: repoRoot, stdio: 'pipe' });

  const db = new Database(':memory:');
  require(databaseShim).__setDb(db);
  db.function('vec_scan', (stored) => {
    const query = require(databaseShim).__query();
    if (!stored || !query || stored.byteLength !== query.length * 4) return 0;
    const vector = new Float32Array(stored.buffer, stored.byteOffset, stored.byteLength / 4);
    let dot = 0, norm = 0;
    for (let index = 0; index < query.length; index += 1) {
      dot += vector[index] * query[index];
      norm += vector[index] * vector[index];
    }
    return norm === 0 ? 0 : dot / Math.sqrt(norm);
  });
  const repo = require(bundle);
  repo.runMigrations(db);
  repo.ensureInitialEmbeddingIndex(db, repo.embeddingProfile({ embeddingProvider: 'openai', embeddingModel: 'document-scale' }));

  const DIM = 128;
  const WORKS = 2_000;
  const VECTORS_PER_WORK = 8;
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  const encode = (values) => {
    const vector = Float32Array.from(values);
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  };
  const query = Array.from({ length: DIM }, (_, index) => index === 0 ? 1 : 0);
  const insertWork = db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,archived) VALUES(?, ?, ?, ?, ?, 0)");
  const insertState = db.prepare("INSERT INTO document_profile_state(nodus_id,current_version_id,status,source_fingerprint,updated_at) VALUES(?,?,'current','scale-source','2026-10-19')");
  const insertVersion = db.prepare(`INSERT INTO document_profile_versions(version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,presentation_language,overview,profile_json,prompt_hash,created_at) VALUES(?,?,'current','scale-source','scale',1,'en','Scale overview','{}','scale','2026-10-19')`);
  const insertVector = db.prepare(`INSERT INTO document_vectors(vector_id,nodus_id,version_id,kind,source_id,text,weight,embedding,embedding_provider,embedding_model,embedding_dim,text_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'2026-10-19')`);
  const insertFts = db.prepare('INSERT INTO document_profiles_fts VALUES(?,?,?,?,?)');
  db.transaction(() => {
    for (let workIndex = 0; workIndex < WORKS; workIndex += 1) {
      const workId = `work-${workIndex}`;
      const versionId = `version-${workIndex}`;
      insertWork.run(workId, workId, `Synthetic work ${workIndex}`, '["Scale Author"]', 2000 + (workIndex % 25));
      insertVersion.run(versionId, workId);
      insertState.run(workId, versionId);
      insertFts.run(workId, versionId, `Synthetic work ${workIndex}`, `Overview uniqueprofile${workIndex}`, 'scale corpus');
      for (let vectorIndex = 0; vectorIndex < VECTORS_PER_WORK; vectorIndex += 1) {
        const values = workIndex === WORKS - 1 && vectorIndex === 0
          ? query
          : Array.from({ length: DIM }, random);
        insertVector.run(
          `vector-${workIndex}-${vectorIndex}`, workId, versionId,
          vectorIndex === 0 ? 'overview' : 'section', `source-${vectorIndex}`,
          `Document orientation ${workIndex}/${vectorIndex}`, vectorIndex === 0 ? 1 : 0.8,
          encode(values), 'openai', 'document-scale', DIM, `text-${workIndex}-${vectorIndex}`,
        );
      }
    }
  })();

  assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values').get().n, WORKS * VECTORS_PER_WORK);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM document_vectors WHERE embedding IS NOT NULL').get().n, 0, 'vectors use the common repository');
  // Inspect the actual production statements, not a copied query. Both the
  // paged scan and winner hydration must look up profile state by its work key.
  const prepare = db.prepare.bind(db);
  const profilePlans = [];
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (/JOIN document_profile_state dps/.test(sql)) {
      const all = statement.all.bind(statement);
      statement.all = (...params) => {
        profilePlans.push(prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params));
        return all(...params);
      };
    }
    return statement;
  };
  let ticks = 0;
  const tick = () => { ticks += 1; timer = setImmediate(tick); };
  let timer = setImmediate(tick);
  const semanticCpuStart = process.cpuUsage();
  const semanticStart = performance.now();
  const semantic = await repo.findSimilarDocuments(query, -1, 20);
  const semanticMs = performance.now() - semanticStart;
  const semanticCpu = process.cpuUsage(semanticCpuStart);
  const semanticCpuMs = (semanticCpu.user + semanticCpu.system) / 1_000;
  clearImmediate(timer);
  assert.ok(profilePlans.length > 1, 'inspect paged scanning and winner hydration');
  for (const plan of profilePlans) {
    assert.ok(plan.some((row) => /SEARCH dps USING INDEX .*\(nodus_id=\?\)/.test(row.detail)),
      `profile state must use its work-key index: ${JSON.stringify(plan)}`);
    assert.ok(!plan.some((row) => /SCAN dps\b/.test(row.detail)), 'never rescan all profile states per vector');
  }
  assert.ok(semantic.some((hit) => hit.nodusId === `work-${WORKS - 1}`), 'the strongest document survives the 16k-vector scan');
  assert.equal(semantic.length, 20);
  assert.equal(semantic[0].nodusId, `work-${WORKS - 1}`);
  assert.equal(semantic[0].similarity, 1);
  assert.ok(ticks >= 5, `the semantic scan yielded only ${ticks} times`);
  // `npm test` runs hundreds of files concurrently. Wall time there includes
  // time this isolated Electron child was not scheduled, so keep the release
  // budget strict on this process's own CPU and retain a generous wall-time
  // guard only to catch a true stall.
  assert.ok(semanticCpuMs < 3_000, `16k document vectors used ${semanticCpuMs.toFixed(1)} ms of CPU`);
  assert.ok(semanticMs < 15_000, `16k document vectors stalled for ${semanticMs.toFixed(1)} ms wall time`);

  const lexicalCpuStart = process.cpuUsage();
  const lexicalStart = performance.now();
  const lexical = repo.lexicalDocumentSearch('uniqueprofile1999', 20);
  const lexicalMs = performance.now() - lexicalStart;
  const lexicalCpu = process.cpuUsage(lexicalCpuStart);
  const lexicalCpuMs = (lexicalCpu.user + lexicalCpu.system) / 1_000;
  assert.equal(lexical[0]?.nodusId, 'work-1999');
  assert.ok(lexicalCpuMs < 500, `2k-profile FTS used ${lexicalCpuMs.toFixed(1)} ms of CPU`);
  assert.ok(lexicalMs < 5_000, `2k-profile FTS stalled for ${lexicalMs.toFixed(1)} ms wall time`);

  const statusCpuStart = process.cpuUsage();
  const statusStart = performance.now();
  const statuses = repo.documentProfileStatuses();
  const statusMs = performance.now() - statusStart;
  const statusCpu = process.cpuUsage(statusCpuStart);
  const statusCpuMs = (statusCpu.user + statusCpu.system) / 1_000;
  assert.equal(statuses.length, WORKS);
  assert.ok(statusCpuMs < 1_000, `2k profile statuses used ${statusCpuMs.toFixed(1)} ms of CPU`);
  assert.ok(statusMs < 5_000, `2k profile statuses stalled for ${statusMs.toFixed(1)} ms wall time`);

  // The indexed join still filters archived works and superseded versions,
  // and cannot borrow another work's current-version pointer.
  db.prepare('UPDATE works SET archived=1 WHERE nodus_id=?').run(`work-${WORKS - 1}`);
  assert.ok(!(await repo.findSimilarDocuments(query, -1, 20))
    .some((hit) => hit.nodusId === `work-${WORKS - 1}`));
  db.prepare('UPDATE works SET archived=0 WHERE nodus_id=?').run(`work-${WORKS - 1}`);
  db.prepare('UPDATE document_profile_state SET current_version_id=? WHERE nodus_id=?')
    .run('superseding-version', `work-${WORKS - 1}`);
  db.prepare('UPDATE document_profile_state SET current_version_id=? WHERE nodus_id=?')
    .run(`version-${WORKS - 1}`, 'work-0');
  assert.ok(!(await repo.findSimilarDocuments(query, -1, 20))
    .some((hit) => hit.nodusId === `work-${WORKS - 1}`), 'a different work cannot activate an obsolete version');
  db.close();
  console.log(`document profile scale passed: ${WORKS} works/${WORKS * VECTORS_PER_WORK} vectors; semantic ${semanticMs.toFixed(1)} ms wall/${semanticCpuMs.toFixed(1)} ms CPU, FTS ${lexicalMs.toFixed(1)}/${lexicalCpuMs.toFixed(1)} ms, statuses ${statusMs.toFixed(1)}/${statusCpuMs.toFixed(1)} ms`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
