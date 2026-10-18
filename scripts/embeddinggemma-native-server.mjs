import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';
import { researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { decodeVectorSet, searchVectors, encodeVectorSet } from '../server/lib/core/vectors.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = fs.realpathSync(argument('product-root') ?? ''), marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
assert.equal(marker.root, root); assert.equal(marker.format, 'nodus.isolated-research-profile/1');
assert(!fs.existsSync(path.join(root, 'profile/isolated-instance.lock')), 'Close the isolated product application before exporting');
const product = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/product-report.json'), 'utf8'));
assert.equal(product.profile, 'embeddinggemma-2-text-q8-512-v1');
const exportFile = path.join(root, 'artifacts/native-server-export.json'), binary = path.join(root, 'artifacts/native-server-vectors.bin');
if (process.argv.includes('--export-child')) {
  installRuntimeHooks(path.join(root, 'profile'));
  const require = createRequire(import.meta.url), Database = require('better-sqlite3');
  const vault = product.vaults.find(vault => vault.mode === 'auto'); assert(/^[a-f0-9-]{36}$/.test(vault.id));
  const database = path.join(root, 'profile/vaults', vault.id, 'nodus.sqlite'); assert(fs.realpathSync(database).startsWith(root + path.sep));
  const db = new Database(database, { readonly: true }), { buildVectorSet } = require(path.join(repoRoot, 'electron/serverSync/serverVectors.ts'));
  const exported = buildVectorSet(db, 'ideas'); assert(exported?.summary.count); assert.equal(exported.summary.model, product.profile);
  const ideas = db.prepare('SELECT global_id,type,label,statement,created_at FROM ideas WHERE embedding_model=? ORDER BY global_id').all(product.profile);
  const rows = db.prepare('SELECT global_id,embedding FROM ideas WHERE embedding_model=? ORDER BY global_id').all(product.profile);
  db.close(); fs.writeFileSync(binary, exported.buffer);
  const worker = new Worker(path.join(repoRoot, 'dist-electron/embeddingGemma2Worker.cjs'), { workerData: { directory: path.join(root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1'), threads: 4 } });
  try {
    const query = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native query timeout')), 120000);
      worker.once('error', reject); worker.once('message', message => { clearTimeout(timer); message.ok ? resolve(message.result[0]) : reject(new Error(message.error)); });
      worker.postMessage({ id: 1, operation: 'infer', texts: ['task: search result | query: Which apparatus determines water cloudiness using a visible beam?'], dimensions: 512 });
    });
    const exact = rows.map(row => { const vector = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4); return { id: row.global_id, score: vector.reduce((sum, value, index) => sum + value * query[index], 0) }; }).sort((a, b) => b.score - a.score);
    fs.writeFileSync(exportFile, JSON.stringify({ summary: exported.summary, ideas, query, exact }, null, 2));
  } finally { await worker.terminate(); }
  process.exit(0);
}
const isolation = verifyResearchSandbox(root, fs.readFileSync(path.join(root, 'isolation.sb'), 'utf8'));
const child = spawnSync(path.join(root, 'electron-isolated'), [fileURLToPath(import.meta.url), `--product-root=${root}`, '--export-child'], { env: { ...researchTestEnvironment(root), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 180000 });
assert.equal(child.status, 0, child.stderr);
const native = JSON.parse(fs.readFileSync(exportFile, 'utf8')), payload = fs.readFileSync(binary), decoded = decodeVectorSet(payload), contract = decoded.header.embeddingContract;
const transported = searchVectors(decoded, native.query, { limit: 10, threshold: -1 });
assert.equal(transported[0].id, native.exact[0].id); assert(Math.abs(transported[0].score - native.exact[0].score) < .01);
const report = { format: 'nodus.embedding-native-server/1', root, isolation, source: 'Read-only export from the completed isolated Desktop vault; native ONNX query; actual int8-l2 transport.', summary: native.summary, contract, exact: native.exact, transported, completed: false };
await withServer({ label: 'embeddinggemma-native-export' }, async server => {
  const id = await server.createSpace('Disposable native vector publication'); await server.setPublicationPolicy(id, ['allowVectors']);
  const owner = await server.deviceToken(server.adminEmail, server.adminPassword, id), snapshot = academicSnapshot({ tables: { ideas: native.ideas, idea_occurrences: [], evidence: [], edges: [], gaps: [], idea_theme_links: [], edge_feedback: [] } });
  await publish(server.origin, owner.deviceToken, id, snapshot);
  const upload = body => server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${id}/vectors?kind=ideas`, { body }); assert.equal((await upload(payload)).status, 200);
  const query = embeddingContract => server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${id}/search/semantic`, { json: { kind: 'ideas', vector: native.query, provider: 'nodus', model: product.profile, dim: 512, embeddingContract, limit: 10, threshold: -1 } });
  const compatible = await (await query(contract)).json(); assert.equal(compatible.indexed, true); assert.equal(compatible.results[0].id, native.exact[0].id);
  const changed = { ...contract, task: { ...contract.task, query: 'incompatible' } }; assert.equal((await (await query(changed)).json()).indexed, false);
  const rejected = await upload(encodeVectorSet({ kind: 'ideas', provider: 'nodus', model: product.profile, dim: 512, embeddingContract: changed, entries: [{ id: native.ideas[0].global_id, vector: native.query }] })); assert.equal(rejected.status, 409);
  report.checks = { realDesktopExport: true, realNativeQuery: true, transportNearestPreserved: true, compatibleServerQuery: true, sameDimensionMismatchRejected: true, contractLocked: true }; report.completed = true;
});
fs.writeFileSync(path.join(root, 'artifacts/native-server.json'), JSON.stringify(report, null, 2)); console.log(`Native server: ${root}/artifacts/native-server.json`);
