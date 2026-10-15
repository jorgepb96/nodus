// Diagnostic full-PDF -> production chunks -> local Q8 vectors -> production retrieval worker.
// Invoke with `node scripts/research-documentary-pdf-probe.mjs`; it creates a fresh QA root.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createResearchTestRoot, researchTestEnvironment, macResearchSandbox, verifyResearchSandbox } from './research-isolation.mjs';
import { repoRoot } from './lib/tsRuntimeHooks.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const arg = key => process.argv.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3);
const fixture = '/private/tmp/nodus-research-wsZXsg/fixtures/public-QLORA001.pdf';
const sourceCache = '/private/tmp/nodus-research-XnhRol';
const profile = 'embeddinggemma-2-text-q8-512-v1';
const root = arg('root') ? fs.realpathSync(arg('root')) : createResearchTestRoot();
const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
if (marker.root !== root || marker.format !== 'nodus.isolated-research-profile/1') throw Error('isolated QA root marker mismatch');
const pdfBytes = fs.readFileSync(fixture);
if (sha(pdfBytes) !== '33a4e757c19d6ea8d3cca8958fce8fe405e290272e135c99ee66065c775d5bd1') throw Error('pinned PDF digest mismatch');
const modelManifest = JSON.parse(fs.readFileSync(path.join(sourceCache, 'artifacts/model-manifest.json'), 'utf8'));
if (modelManifest.testedProfile !== profile || modelManifest.dimensions !== 512) throw Error('Q8-512 model cache profile mismatch');
const modelSource = fs.realpathSync(modelManifest.directory);
if (!modelSource.startsWith(sourceCache + path.sep)) throw Error('model source is outside approved owned QA cache');
const modelDir = path.join(root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
fs.mkdirSync(path.join(root, 'profile/documentary'), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(root, 'profile/home'), { recursive: true, mode: 0o700 });
fs.cpSync(modelSource, modelDir, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
const verifiedAssets = modelManifest.assets.map(asset => {
  const bytes = fs.readFileSync(path.join(modelDir, asset.file));
  if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw Error(`pinned local model asset mismatch: ${asset.file}`);
  return { file: asset.file, sha256: sha(bytes), bytes: bytes.length };
});
fs.copyFileSync(fixture, path.join(root, 'fixtures/public-QLORA001.pdf'));
const dependencyLink = path.join(root, 'node_modules');
if (!fs.existsSync(dependencyLink)) fs.symlinkSync(path.join(repoRoot, 'node_modules'), dependencyLink, 'dir');
fs.writeFileSync(path.join(root, 'artifacts/safe-storage-gate.json'), JSON.stringify({ safeStorageAvailable: false, storedCredentialCount: 0, config: {}, profileCreatedFromEmptyState: true }, null, 2));
const { build } = await import('esbuild');
await build({ entryPoints: [path.join(repoRoot, 'electron/workers/embeddingGemma2Worker.ts')], outfile: path.join(root, 'embeddingGemma2Worker.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['@nodus/embeddinggemma-transformers'], logLevel: 'silent' });
await build({ entryPoints: [path.join(repoRoot, 'electron/workers/documentaryRetrievalWorker.ts')], outfile: path.join(root, 'documentaryRetrievalWorker.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['better-sqlite3'], alias: { '@shared': path.join(repoRoot, 'shared') }, logLevel: 'silent' });
const sandbox = macResearchSandbox(root);
const childMode = process.argv.includes('--child');
const proof = childMode
  ? JSON.parse(fs.readFileSync(path.join(root, 'artifacts/isolation-verification.json'), 'utf8'))
  : verifyResearchSandbox(root, sandbox);
if (!childMode) fs.writeFileSync(path.join(root, 'artifacts/isolation-verification.json'), JSON.stringify(proof, null, 2));

if (!childMode) {
  // Run the same child under the OS sandbox, which denies every network endpoint and writes outside root.
  const isolated = spawnSync('/usr/bin/sandbox-exec', ['-p', sandbox, requireElectronPath(), fileURLToPath(import.meta.url), '--child', `--root=${root}`], {
    cwd: repoRoot, env: { ...researchTestEnvironment(root), HOME: path.join(root, 'profile/home'), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (isolated.status !== 0) { process.stderr.write(isolated.stderr || isolated.stdout || `probe exit ${isolated.status}\n`); process.exit(isolated.status ?? 1); }
  process.stdout.write(isolated.stdout);
  process.exit(0);
}

function requireElectronPath() { return (awaitlessRequire())('electron'); }
function awaitlessRequire() { return createRequire(import.meta.url); }

// Electron-as-Node child. It uses production extraction, cleanup, chunk planning, the exact
// embedding contract/worker and actual DocumentaryStore + retrieval worker implementations.
const { installRuntimeHooks } = await import('./lib/tsRuntimeHooks.mjs');
const electronStub = installRuntimeHooks(path.join(root, 'profile'));
if (electronStub.safeStorage.isEncryptionAvailable() !== false) throw Error('probe requires unavailable SafeStorage in the test runtime');
const emptyConfig = {};
if (Object.keys(emptyConfig).length !== 0) throw Error('probe config must be empty');
const require = createRequire(import.meta.url);
const { extractPdfStreaming } = require(path.join(repoRoot, 'electron/extraction/textExtractor.ts'));
const { planRetrievalChunks, RETRIEVAL_CHUNKER_VERSION } = require(path.join(repoRoot, 'shared/retrievalChunks.ts'));
const { DocumentaryStore } = require(path.join(repoRoot, 'electron/db/documentaryStore.ts'));
const { documentaryIndexKey } = require(path.join(repoRoot, 'electron/ai/researchCorpusScope.ts'));
const { embeddingGemma2Contract, prepareEmbeddingGemma2Input } = require(path.join(repoRoot, 'shared/embeddingGemma2.ts'));
const { Worker } = require('node:worker_threads');
const { fork } = require('node:child_process');
const artifactDir = path.join(root, 'artifacts');
const storePath = path.join(root, 'profile/documentary/store.sqlite');
const report = { format: 'nodus.documentary-pdf-retrieval-probe/1', root, profile, startedAt: new Date().toISOString(), pdfSha256: sha(pdfBytes), extraction: {}, chunks: {}, embeddings: {}, queries: [], isolation: proof, sources: {} };
report.runtime = { node: process.version, electron: process.versions.electron, platform: process.platform, architecture: process.arch, inference: 'EmbeddingGemma Q8 ONNX CPU; no remote runtime', networkPolicy: 'macOS sandbox denies network-outbound', databaseScope: storePath };
const sourcePaths = ['electron/extraction/textExtractor.ts','electron/extraction/pdfjsLoader.ts','electron/extraction/textCleanup.ts','shared/retrievalChunks.ts','shared/embeddingGemma2.ts','shared/embeddingContract.ts','electron/db/documentaryStore.ts','electron/db/documentaryRetrieval.ts','electron/workers/documentaryRetrievalWorker.ts','electron/workers/embeddingGemma2Worker.ts'];
for (const f of sourcePaths) report.sources[f] = sha(fs.readFileSync(path.join(repoRoot, f)));
const extracted = await extractPdfStreaming(path.join(root, 'fixtures/public-QLORA001.pdf'), { ocr: { enabled: false, languages: ['eng'], maxPages: 0 }, declutter: true });
if (!extracted.text || extracted.analysis?.pageCount !== 26) throw Error(`unexpected extraction result: pages=${extracted.analysis?.pageCount}, chars=${extracted.text?.length}`);
report.extraction = { pages: extracted.analysis.pageCount, chars: extracted.text.length, strategy: extracted.analysis.strategy, notes: extracted.notes ?? null, blockReason: extracted.blockReason ?? null, textSha256: sha(Buffer.from(extracted.text)), p5Present: /CPU.{0,20}GPU|GPU.{0,20}CPU/i.test(extracted.text) && /evict|paging|page back|RAM/i.test(extracted.text) };
const sourceMap = { qlora: 'qa:public-QLORA001' };
const markedText = `[[src:qlora]]\n${extracted.text}`;
const chunks = planRetrievalChunks(markedText, { sourceMap });
if (!chunks.length) throw Error('canonical chunker returned no chunks');
report.chunks = { count: chunks.length, version: RETRIEVAL_CHUNKER_VERSION, sha256: sha(Buffer.from(JSON.stringify(chunks))), p5ChunkOrdinals: chunks.map((c,i)=>c.pageNumber===5||c.pageEnd===5?i:null).filter(x=>x!==null), excerpts: chunks.map((c,i)=>({ ordinal:i, locator:{pageNumber:c.pageNumber,pageEnd:c.pageEnd,pageLabel:c.pageLabel,pageStarts:c.pageStarts}, excerpt:c.text.slice(0,420) })) };

// Keep full vectors inside the isolated process and send them only to the real SQLite store.
const embedWorker = new Worker(path.join(root, 'embeddingGemma2Worker.cjs'), { workerData: { directory: modelDir, dtype: 'q8', threads: 2 } });
let requestId = 0;
const infer = texts => new Promise((resolve,reject)=>{ const id=++requestId; const timeout=setTimeout(()=>reject(Error('local embedding worker timeout')),600000); const onMessage=m=>{if(m.id!==id)return;clearTimeout(timeout);embedWorker.off('message',onMessage);m.ok?resolve(m.result):reject(Error(m.error));};embedWorker.on('message',onMessage);embedWorker.postMessage({id,operation:'infer',texts,dimensions:512}); });
const docInputs = chunks.map(c => prepareEmbeddingGemma2Input(c.text,'document'));
const vectors = [];
for (const text of docInputs) vectors.push(...await infer([text]));
const contract = embeddingGemma2Contract(profile);
const docId = 'qa-public-qlora001', identity = { documentId: docId, revision: 'sha256:'+report.extraction.textSha256, textFingerprint: report.extraction.textSha256, processingVersion: RETRIEVAL_CHUNKER_VERSION, attachmentId: 'qa-pdf', embedding: contract };
const indexKey = documentaryIndexKey(identity);
report.sourceContract = { documentId: docId, revision: identity.revision, attachmentId: identity.attachmentId, indexKey, embeddingContract: contract,
  sourceRef: sourceMap.qlora, citationResolver: 'not-exercised: this standalone actual-store/retrieval-worker probe does not create a product library/notebook scope; use evidence.id plus search.scopeId with documentary:<scopeId>:<evidence.id> in the product harness' };
const store = new DocumentaryStore(storePath);
const now = Date.now();
store.db.prepare('INSERT OR REPLACE INTO documentary_revisions(index_key,document_id,identity_json,text,chunks_json,lexical_ready,embedding_ready,created_at) VALUES (?,?,?,?,?,1,1,?)').run(indexKey,docId,JSON.stringify(identity),extracted.text,JSON.stringify(chunks),now);
store.db.prepare('INSERT INTO documentary_desired VALUES (?,?)').run(docId,indexKey);
store.db.prepare('INSERT INTO documentary_current VALUES (?,?)').run(docId,indexKey);
store.db.prepare('INSERT INTO documentary_attachment_heads(document_id,attachment_id,desired_key,current_key) VALUES (?,?,?,?)').run(docId,'qa-pdf',indexKey,indexKey);
const passage=store.db.prepare('INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json,vector) VALUES (?,?,?,?,?,?,?)');
const fts=store.db.prepare('INSERT INTO documentary_fts(id,text) VALUES (?,?)');
chunks.forEach((c,i)=>{const id=`${indexKey}:${i}`;passage.run(id,indexKey,docId,i,c.text,JSON.stringify({...c, text:undefined}),Buffer.from(Float32Array.from(vectors[i]).buffer));fts.run(id,c.text);});
store.db.prepare('UPDATE documentary_vector_generations SET generation=generation+1 WHERE index_key=?').run(indexKey);
store.close();
report.embeddings = { provider:'nodus-local', model:profile, contract, dimension:512, count:vectors.length, nonzero:true, vectorsSha256:sha(Buffer.from(vectors.flat().join(','))), assetHashes:verifiedAssets };

const worker = fork(path.join(root,'documentaryRetrievalWorker.cjs'),[],{serialization:'advanced',stdio:['ignore','inherit','inherit','ipc'],env:researchTestEnvironment(root)});
const querySet=[
  {label:'original Spanish',query:'¿Cómo logra el artículo trasladar la página GPU a CPU, expulsarla de la memoria y volver a cargarla para el optimizador paginado? ¿Qué mecanismo describe?', expectedPage:5},
  {label:'cross-language paraphrase',query:'Which mechanism moves the optimizer state from GPU to CPU, evicts it to RAM, and pages it back during training?', expectedPage:5},
  {label:'Spanish paraphrase',query:'¿Qué técnica permite liberar memoria de GPU y recuperar después el estado del optimizador durante el entrenamiento?', expectedPage:5},
];
for (const q of querySet) {
  const [vector]=await infer([prepareEmbeddingGemma2Input(q.query,'query')]);
  const run = vectorInput => {
    const id=++requestId;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('retrieval worker timeout')),30000);const cb=m=>{if(m.id!==id||m.type==='activity')return;clearTimeout(timer);worker.off('message',cb);resolve(m)};worker.on('message',cb);worker.send({id,filename:storePath,query:q.query,lexicalKeys:[indexKey],vectorKeys:[indexKey],vector:vectorInput,threshold:-1,settings:{preset:'custom',candidates:40,passagesPerRound:8,evidenceTokens:8000,rounds:1,autoExpand:false,threshold:{mode:'automatic'}}});});
  };
  const [hybrid, lexicalOnly] = await Promise.all([run(vector), run(null)]);
  const summarize = answer => ({ semanticCount:answer.retrievalTrace?.semantic?.length??0,lexicalCount:answer.retrievalTrace?.lexical?.length??0,
    top:answer.passages?.slice(0,8).map(p=>({id:p.id,text:p.text,locator:JSON.parse(p.locator_json)})),retrievalTrace:answer.retrievalTrace });
  report.queries.push({label:q.label,question:q.query,expectedPage:q.expectedPage,hybrid:summarize(hybrid),lexicalOnly:summarize(lexicalOnly),
    hybridMechanismRank:hybrid.passages?.findIndex(p=>/Paged Optimizers[\s\S]{0,650}(?:unified memory|CPU and GPU|page-to-page)/i.test(p.text))??-1,
    lexicalMechanismRank:lexicalOnly.passages?.findIndex(p=>/Paged Optimizers[\s\S]{0,650}(?:unified memory|CPU and GPU|page-to-page)/i.test(p.text))??-1});
}
worker.kill(); await embedWorker.terminate();
report.completedAt=new Date().toISOString();report.database={path:storePath,sha256:sha(fs.readFileSync(storePath)),bytes:fs.statSync(storePath).size,passages:chunks.length};
fs.writeFileSync(path.join(artifactDir,'documentary-pdf-probe.json'),JSON.stringify(report,null,2));
console.log(path.join(artifactDir,'documentary-pdf-probe.json'));
