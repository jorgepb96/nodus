import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--idea-retheme-reembed')) process.exit(0);

// An idea is embedded with its theme labels, so a reprocess pass that re-themes it leaves
// its vector stale. The refresh must touch those ideas only: in a real library every idea
// was embedded with an earlier model than the one now configured, and a library-wide pass
// (startEmbedding() with no scope) would re-embed all of them.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-retheme-reembed-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  const settingsRepo = load('electron/db/settingsRepo.ts');
  settingsRepo.updateSettings({ embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' });
  const baseSettings = settingsRepo.getSettings;
  settingsRepo.getSettings = () => ({ ...baseSettings(), embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', providerKeys: { ...baseSettings().providerKeys, openai: true } });
  const themes = load('electron/db/themesRepo.ts');
  const { embeddingTextForIdea, embeddingTextHash } = load('electron/db/ideaEmbeddingText.ts');
  for (const id of ['w1', 'w2']) {
    db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type,deep_status) VALUES(?,?,?,'[]','book','text','done')").run(id, id.toUpperCase(), `Work ${id}`);
  }
  // `shared` occurs in both works; every vector comes from an older embedding model.
  const ideas = { shared: ['w1', 'w2'], kept: ['w1'], other: ['w2'] };
  for (const [id, works] of Object.entries(ideas)) {
    db.prepare("INSERT INTO ideas(global_id,type,label,statement) VALUES(?,'claim',?,?)").run(id, id, `Statement of ${id}`);
    for (const work of works) db.prepare('INSERT INTO idea_occurrences(global_id,nodus_id,role,confidence) VALUES(?,?,\'principal\',1)').run(id, work);
    themes.replaceIdeaThemeLinks(id, works, ['Tema original'], 0.8, 'explicit');
    const text = embeddingTextForIdea({ type: 'claim', label: id, statement: `Statement of ${id}`, themes: ['tema original'] });
    db.prepare("UPDATE ideas SET embedding=?,embedding_provider='openrouter',embedding_model='baai/bge-m3',embedding_dim=3,embedding_text_hash=? WHERE global_id=?")
      .run(Buffer.from(new Float32Array([1, 0, 0]).buffer), embeddingTextHash(text), id);
  }

  const indexes = load('electron/db/embeddingIndexesRepo.ts');
  const oldIndex = indexes.activeEmbeddingIndex(db);
  const nextIndex = indexes.createIndex(db, indexes.embeddingProfile({ ...baseSettings(), embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' }));
  db.prepare('UPDATE embedding_index_state SET pending_id=?').run(nextIndex.id);
  indexes.commitEmbeddingIndex(db, indexes.indexContext(db, nextIndex));

  // The model moves `shared` to a new theme and leaves the others where they were.
  load('electron/ai/structuredHeadroom.ts').completeJsonWithHeadroom = async request => {
    const input = JSON.parse(request.user);
    return { assignments: input.ideas.map(idea => ({ id: idea.id, themes: [idea.id === 'shared' ? 'Tema nuevo' : 'Tema original'] })) };
  };
  const { reprocessConnections } = load('electron/ai/reprocessConnections.ts');
  const result = await reprocessConnections({ relations: false });
  assert.deepEqual(result.rethemedIdeaIds, ['shared'], 'only the idea whose embedded labels changed is reported');

  const embedded = [];
  load('electron/ai/aiClient.ts').embedManyStrict = async texts => { embedded.push(...texts); return texts.map(() => [0, 1, 0]); };
  const pipeline = load('electron/ai/embeddingPipeline.ts');
  await pipeline.refreshRethemedIdeaEmbeddings(result.rethemedIdeaIds);
  assert.equal(embedded.length, 1, 'the shared idea is embedded once although two works hold it');
  assert.match(embedded[0], /etiqueta: shared/);
  assert.match(embedded[0], /temas: tema nuevo/i, 'it is embedded with its new theme');
  const row = id => db.prepare('SELECT embedding_provider p, embedding_model m FROM embedding_read_ideas WHERE global_id=?').get(id);
  assert.deepEqual({ ...row('shared') }, { p: 'openai', m: 'text-embedding-3-small' });
  assert.deepEqual({ ...indexes.withEmbeddingIndexContext(oldIndex, () => row('kept')) }, { p: 'openrouter', m: 'baai/bge-m3' }, 'an untouched idea keeps its vector, even from an older model');
  assert.deepEqual({ ...indexes.withEmbeddingIndexContext(oldIndex, () => row('other')) }, { p: 'openrouter', m: 'baai/bge-m3' });
  await pipeline.refreshRethemedIdeaEmbeddings([]);
  assert.equal(embedded.length, 1, 'nothing re-themed, nothing embedded');

  // What the unscoped pass would have done: re-embed every idea of the old model too.
  embedded.length = 0;
  await pipeline.startEmbedding();
  assert.equal(embedded.length, 2, 'a library-wide pass re-embeds the two untouched ideas');
  console.log('Re-themed ideas are re-embedded once each, and nothing else is.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
