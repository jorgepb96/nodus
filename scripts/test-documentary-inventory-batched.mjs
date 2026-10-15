// The preparation inventory reads each source's revisions, chunk counts, requests and publication
// in a fixed number of statements, however many sources the library holds, with the same answer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-inventory-batched')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-inventory-batched-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in inventory fixture'); };
try {
  const db = load('electron/db/database.ts').getDb();
  const preparation = load('electron/ai/documentaryPreparation.ts');
  const store = preparation.documentaryStore();
  new (load('electron/db/documentaryRequests.ts').DocumentaryRequests)(store.db);
  const { researchCorpusInventory } = load('electron/ai/researchCorpusInventory.ts');
  const insertWork = db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash) VALUES(?,?,?,'[]',2020,'book','text','h')`);
  const key = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // Every fourth source published with passages, every fourth a request in flight, the rest catalogued.
  function seed(from, to) {
    for (let index = from; index < to; index += 1) insertWork.run(`w${index}`, `k-${index}`, `Work ${index}`);
    const documents = researchCorpusInventory().documents;
    for (const document of documents.filter(item => Number(item.workId.slice(1)) >= from && Number(item.workId.slice(1)) < to)) {
      const index = Number(document.workId.slice(1));
      if (index % 4 === 0) {
        const identity = { documentId: document.id, attachmentId: null, revision: document.revision, textFingerprint: `t${index}`, chunkerVersion: 'c', processingVersion: 'p', embedding: null };
        const indexKey = key(identity);
        store.db.prepare('INSERT INTO documentary_revisions(index_key,document_id,identity_json,chunks_json,lexical_ready,embedding_ready,created_at) VALUES (?,?,?,?,1,0,?)').run(indexKey, document.id, JSON.stringify(identity), '[]', index);
        store.db.prepare("INSERT INTO documentary_jobs(id,document_id,identity_json,payload_json,state,available_at,created_at,updated_at) VALUES (?,?,?,'{}','complete',0,0,0)").run(indexKey, document.id, JSON.stringify(identity));
        for (let ordinal = 0; ordinal < 1 + index % 3; ordinal += 1) store.db.prepare("INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json) VALUES (?,?,?,?,'text','{}')").run(`${indexKey}:${ordinal}`, indexKey, document.id, ordinal);
        store.db.prepare('INSERT INTO documentary_publications VALUES (?,?,?)').run(document.id, JSON.stringify(document), JSON.stringify([indexKey]));
      } else if (index % 4 === 1) {
        store.db.prepare("INSERT INTO documentary_requests(document_id,revision,vault_id,state,error,updated_at,source_id) VALUES (?,?,'v','queued',NULL,?,?)").run(`request-${index}`, document.revision, index, document.id);
      }
    }
  }
  const counted = () => {
    let statements = 0;
    const prepare = store.db.prepare.bind(store.db);
    store.db.prepare = sql => { statements += 1; return prepare(sql); };
    const inventory = preparation.getResearchPreparationInventory();
    store.db.prepare = prepare;
    return { statements, inventory };
  };
  seed(0, 24);
  const small = counted();
  seed(24, 96);
  const large = counted();
  assert.equal(large.inventory.documents.length, 96);
  assert.equal(large.statements, small.statements, `the statements do not grow with the library (${small.statements} for 24 sources, ${large.statements} for 96)`);
  for (const document of large.inventory.documents) {
    const index = Number(document.workId.slice(1));
    const { preparation: state } = document;
    if (index % 4 === 0) assert.deepEqual([state.lexical, state.text, state.passages], ['ready', 'available', 1 + index % 3], `w${index} is published with its passages`);
    else if (index % 4 === 1) assert.deepEqual([state.status, state.lexical, document.indexedSource?.indexKeys], ['queued', 'missing', []], `w${index} is queued and exposes no partial revision`);
    else assert.deepEqual([state.status, state.lexical, document.indexedSource], ['catalogued', 'missing', undefined], `w${index} is only catalogued`);
  }
  console.log(`Preparation inventory: ${large.statements} statements for 24 or 96 sources, each source's state unchanged.`);
} finally {
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation?.();
  fs.rmSync(scratch, { recursive: true, force: true });
}
