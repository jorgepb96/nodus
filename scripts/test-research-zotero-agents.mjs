import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-zotero-agents')) process.exit(0);
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-zotero-agents-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const topic = 'medida parcela norte';
const text = 'La medida de la parcela norte es de 41 unidades.';
const calls = [];
try {
  const db = load('electron/db/database.ts').getDb();
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,zotero_version) VALUES('SOURCE01','SOURCE01',?,'[\"Test, Ana\"]',2026,'book','zotero',1)").run('La medida de la parcela norte');
  const notebook = load('electron/ai/researchNotebookService.ts');
  const scope = notebook.resolveAcademicResearchScope();
  const document = scope.documents[0];
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.getResearchPreparationInventory = () => ({ documents: [{ id: document.id, title: document.title,
    preparation: { text: 'missing', lexical: 'missing', embeddings: 'missing', reason: null } }] });
  preparation.retrieveSharedDocumentaryEvidence = async () => ({ evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } });
  const ai = load('electron/ai/aiClient.ts');
  ai.embedQuery = async () => null;
  ai.completeJson = async () => ({ action: 'finish' });
  load('electron/zotero/zoteroClient.ts').itemChildren = async () => [{ key: 'ATTACH01', contentType: 'text/plain', version: 1, library: { type: 'user', id: '0' } }];
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith('http://127.0.0.1:23119/api/'), 'only fixture Zotero metadata is requested');
    const key = String(url).split('/').at(-1);
    return new Response(JSON.stringify({ key, version: 1, data: { parentItem: key === 'ATTACH01' ? 'SOURCE01' : undefined } }), { headers: { 'Zotero-Server-ID': 'fixture-independent' } });
  };
  // Transport is simulated; authorization, research decisions, citation receipts
  // and the three production callers run unchanged in a disposable profile.
  class Connection {
    status = { state: 'stopped', mode: 'managed', transport: 'stdio', installed: true, version: 'fixture', error: null };
    async connectManaged(_runtime, manifest) { this.manifest = manifest; this.status.state = 'connected'; }
    async call(tool, args) {
      calls.push({ tool, args });
      return { structuredContent: { revision: this.manifest.items[0].revision, itemKey: 'SOURCE01', attachmentKey: 'ATTACH01', pages: [{ pageNumber: 1, text }] } };
    }
    async close() { this.status.state = 'stopped'; }
  }
  load('electron/mcp/managedZotero.ts').ManagedZoteroConnection = Connection;
  const { ResearchCorpusRun, bindAcademicCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { RESEARCH_CHAT_AGENT_SETTINGS, RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const { literalResearchTurnPlan } = load('electron/ai/researchTurnPlanner.ts');
  const { withResearchActivity } = load('electron/ai/researchActivity.ts');
  const citations = load('electron/citations/scopedLegacyCitations.ts');

  const chat = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  chat.agent = { plan: literalResearchTurnPlan(topic), question: topic, compact: false, minSources: 1 };
  const events = [];
  await withResearchActivity(event => events.push(event), undefined, () => chat.investigate(topic));
  assert.equal(calls.length, 1, 'Research Chat reaches Zotero MCP for the unindexed original');
  assert.ok(events.some(event => event.layer === 'zotero' && event.status === 'completed'));
  assert.equal([...chat.evidence.values()][0].summary, text);
  assert.match(chat.researchLog().join('\n'), /Original pages returned by Zotero MCP/);
  assert.equal(citations.getScopedLegacyPassageDetail([...chat.evidence.keys()][0]).text, text);

  const deep = bindAcademicCorpusRun({}, { objective: topic, retrieval: RETRIEVAL_PRESETS.balanced });
  const snapshot = await deep.buildSnapshot({ kind: 'deep_research', objective: topic });
  assert.equal(calls.length, 2, 'Deep Research reaches the same managed MCP fallback');
  assert.equal(snapshot.passages[0].summary, text);
  assert.ok((await deep.researchTraversal()).readDocumentIds.includes(document.id));

  // Preserve Immersion's existing profiles, while the original has neither a
  // passage row nor a prepared index. The preview must stay retrieval-only.
  load('electron/ai/writingWorkshop.ts').buildWritingWorkshopSnapshot = async () => ({ ideas: [], passages: [], gaps: [],
    works: [{ id: 'SOURCE01', title: document.title, authors: document.authors, year: 2026, zotero_key: 'SOURCE01', score: 0.5, documentStatus: 'current', documentOverview: 'Existing documentary profile' }] });
  load('electron/graph/graphService.ts').buildIdeaGraph = async () => ({ nodes: [], edges: [] });
  const immersion = load('electron/ai/immersion.ts');
  const preview = await immersion.buildImmersionScope({ topic });
  assert.equal(calls.length, 2, 'preview never starts MCP research or supervising inference');
  assert.equal(preview.passageCount, 0);
  let material;
  load('electron/ai/immersionCore.ts').orchestrateImmersion = async (request, deps) => {
    material = await deps.buildMaterial(request.topic);
    return { topic: request.topic };
  };
  load('electron/db/immersionRepo.ts').saveImmersionSession = plan => ({ id: 'fixture', plan });
  await immersion.generateImmersionSession({ topic, minutes: 60, includeQuiz: false });
  assert.equal(calls.length, 3, 'Immersion generation reaches Zotero MCP for the missing original');
  assert.equal(material.passages[0].text, text);
  assert.equal(material.works[0].orientation, 'Existing documentary profile');
  assert.equal(citations.getScopedLegacyPassageDetail(material.passages[0].id).text, text, 'Immersion can open the original citation without a legacy passage row');
  assert.ok(calls.every(call => call.tool === 'zotero_read_pdf_pages' && call.args.item_key === 'SOURCE01'));

  await load('electron/mcp/researchZotero.ts').setResearchZoteroAutomatic(false);
  const unavailable = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  await unavailable.investigate(topic);
  assert.equal(unavailable.evidence.size, 0);
  assert.ok(unavailable.coverage().limitations.includes('research_read_unavailable'));
  assert.match(unavailable.researchLog().join('\n'), /attempts without readable pages/);
  assert.doesNotMatch(unavailable.researchLog().join('\n'), /Original pages returned/);
  console.log('Research Chat, Deep Research and Immersion: managed Zotero original access, observable calls, resolvable citations, retrieval-only preview and truthful failure logs passed (simulated transport).');
} finally {
  await load('electron/mcp/researchZotero.ts').closeResearchZotero();
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
