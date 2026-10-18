import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-live-queries')) process.exit(0);
const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
assert(lab && fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab')), 'A marked isolated lab is required; missing configuration fails acceptance');
installRuntimeHooks(lab);
const require = createRequire(import.meta.url);
const { serveLiveCorpus, isReadOnlyCorpusQuery } = require('../electron/desktopBridge/liveCorpus.ts');
const { getDb, withVaultDatabase, closeDb } = require('../electron/db/database.ts');
const { getVault } = require('../electron/vaults/vaultRegistry.ts');
const { describeVectorSet } = require('../electron/serverSync/serverVectors.ts');
assert(fs.realpathSync(getVault('default').path).startsWith(fs.realpathSync(lab) + path.sep));
  async function query(route, input) {
    let status, bytes;
    const response = { setHeader(){}, writeHead(value){status=value;}, end(value){bytes=value;} };
    await serveLiveCorpus({method:'POST',headers:{}}, response, new URL('https://lab.invalid/'+route), 'default', route.split('/'), input);
    return { status, value: JSON.parse(String(bytes)) };
  }
const host = setInterval(() => {}, 1000);
try {
  for (const method of ['GET','DELETE','PUT']) assert(!isReadOnlyCorpusQuery(method, 'search/semantic'));
  for (const pathname of ['notes','mutations','context/extra','search/%73emantic','search/../semantic']) assert(!isReadOnlyCorpusQuery('POST',pathname));
  assert(isReadOnlyCorpusQuery('POST','search/semantic')); assert(isReadOnlyCorpusQuery('POST','context'));
  const index = await withVaultDatabase('default', () => {
    const summary = describeVectorSet(getDb(), 'ideas'); assert(summary, 'Real corpus index is required');
    const row = getDb().prepare('SELECT global_id, label, embedding FROM ideas WHERE embedding_provider=? AND embedding_model=? AND embedding_dim=? AND length(embedding)=? LIMIT 1')
      .get(summary.provider, summary.model, summary.dim, summary.dim * 4); assert(row);
    const aligned = Uint8Array.from(row.embedding);
    return { summary, id: row.global_id, label: row.label, vector: [...new Float32Array(aligned.buffer)] };
  });

  const probe = await query('search/semantic', { provider:'identity-probe', model:'identity-probe',dim:0,kind:'ideas',limit:1 });
  assert.equal(probe.status,200); assert.equal(probe.value.reason,'provider_mismatch');
  for (const key of ['provider','model','dim']) assert.equal(probe.value.expected[key],index.summary[key]);
  const matched = await query('search/semantic', { ...index.summary, vector:index.vector,limit:5 });
  assert.equal(matched.status,200); assert.equal(matched.value.indexed,true);
  const self=matched.value.results.find(row=>row.id===index.id);assert(self&&self.score>.98&&self.row.global_id===index.id);
  const invalid = await query('search/semantic', { ...index.summary, vector:[1] });
  assert.equal(invalid.status,400); assert.equal(invalid.value.error,'bad_vector');
  const context = await query('context', {query:index.label,include:['ideas'],budget:4096});
  assert.equal(context.status,200); assert(context.value.stats.matched>0);
  assert(context.value.stats.chars<=4096); assert(context.value.sections.every(row=>row.kind==='ideas'));
  console.log(JSON.stringify({result:'passed',identity:{provider:index.summary.provider,model:index.summary.model,dim:index.summary.dim},indexable:matched.value.indexable,
    cases:['exact read routes','real identity probe','real indexed self-match','invalid vector','bounded source context'],scope:'Actual production read query implementations on marked isolated real vault; native HTTPS authorization and UI are separate',releaseApproved:false}));
} finally {clearInterval(host);closeDb();}
