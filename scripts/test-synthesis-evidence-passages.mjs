// The textbook passages of a route request: the dense lane must not score the library in the
// main process, and the queries' embeddings are requested together rather than one at a time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--synthesis-evidence-passages')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-synthesis-passages-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in synthesis passages fixture'); };
try {
  const db = load('electron/db/database.ts').getDb();
  const passages = load('electron/db/passagesRepo.ts');
  const { currentEmbeddingConfig } = load('electron/db/ideasRepo.ts');
  const config = currentEmbeddingConfig();
  const axis = index => Array.from({ length: 8 }, (_, at) => (at === index ? 1 : 0.01));
  // Long enough to count as prose evidence, and sharing no word with the queries below, so only
  // the dense lane can find them.
  const prose = 'The mixture was heated under reflux for two hours, cooled to room temperature, poured onto ice and the solid collected by filtration, washed with cold water and dried in air before recrystallisation from ethanol gave the product as pale needles.';
  const texts = [`First account. ${prose}`, `Second account. ${prose}`, `Third account. ${prose}`];
  for (const [index, text] of texts.entries()) {
    const id = `organic-${index}`;
    db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash)
      VALUES(?,?,?,'[]',2020,'book','text','hash')`).run(id, id, `Organic Synthesis ${index}`);
    passages.replaceWorkPassages(id, 'hash', [{ text, pageLabel: String(index + 1), embedding: axis(index) }]);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM passages WHERE embedding_provider=? AND embedding_model=?').get(config.provider, config.model).n, 3);

  const ai = load('electron/ai/aiClient.ts');
  const queries = ['zeta', 'kappa', 'omega'];
  let inFlight = 0, widest = 0;
  ai.embed = async query => {
    inFlight += 1; widest = Math.max(widest, inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    inFlight -= 1;
    return axis(queries.indexOf(query));
  };
  const synchronous = passages.findSimilarPassages;
  let synchronousScans = 0;
  passages.findSimilarPassages = (...args) => { synchronousScans += 1; return synchronous(...args); };
  const synthesis = load('electron/ai/synthesisEvidence.ts');
  const found = await synthesis.textbookPassages(queries, synthesis.synthesisEvidenceWorkIds());
  passages.findSimilarPassages = synchronous;
  assert.equal(synchronousScans, 0, 'the dense lane never scores the library in the main process');
  assert.equal(widest, queries.length, 'every query\'s embedding is requested before the first one is answered');
  for (const [index, query] of queries.entries()) {
    assert.ok(found.some(passage => passage.retrievedFor === query && passage.text.startsWith(texts[index].slice(0, 14))), `the dense lane still finds the passage for "${query}"`);
  }
  // The paged scan ranks exactly as the synchronous one it replaces.
  for (const index of [0, 1, 2]) {
    const paged = await passages.findSimilarPassagesPaged(axis(index), 0.3, 6, { nodusIds: ['organic-0', 'organic-1', 'organic-2'] });
    const direct = synchronous(axis(index), 0.3, 6, { nodusIds: ['organic-0', 'organic-1', 'organic-2'] });
    assert.deepEqual(paged.map(hit => hit.passage_id), direct.map(hit => hit.passage_id));
  }
  console.log('Synthesis textbook passages: dense lane off the main process, embeddings requested together, same passages.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
