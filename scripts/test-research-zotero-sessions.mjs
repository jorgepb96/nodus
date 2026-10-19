import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-zotero-sessions')) process.exit(0);
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-zotero-sessions-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const gates = [];
const connections = [];
try {
  const db = load('electron/db/database.ts').getDb();
  for (const id of ['SOURCE01', 'SOURCE02']) db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type,zotero_version) VALUES(?,?,?,'[]','book','zotero',1)").run(id, id, id);
  const zotero = load('electron/zotero/zoteroClient.ts');
  zotero.itemChildren = async () => [{ key: 'ATTACH01', contentType: 'text/plain', version: 1, library: { type: 'user', id: '0' } }];
  globalThis.fetch = async url => {
    const key = String(url).split('/').at(-1);
    const parentItem = key === 'ATTACH01' ? 'SOURCE01' : undefined;
    return new Response(JSON.stringify({ key, version: 1, data: { parentItem } }), { headers: { 'Zotero-Server-ID': 'fixture-independent' } });
  };
  class Connection {
    status = { state: 'stopped', mode: 'managed', transport: 'stdio', installed: true, version: 'fixture', error: null };
    closed = false;
    constructor() { connections.push(this); }
    async connectManaged(_runtime, scope) { this.scope = scope; this.status.state = 'connected'; }
    async call(_tool, _args, signal) {
      await new Promise((resolve, reject) => { gates.push(resolve); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      return { structuredContent: { revision: this.scope.items[0].revision, itemKey: 'SOURCE01', attachmentKey: 'ATTACH01', pages: [{ pageNumber: 1, text: 'synthetic' }] } };
    }
    async close() { this.closed = true; this.status.state = 'stopped'; }
  }
  load('electron/mcp/managedZotero.ts').ManagedZoteroConnection = Connection;
  const service = load('electron/mcp/researchZotero.ts');
  const { withResearchActivity } = load('electron/ai/researchActivity.ts');
  const { summarizeResearchActivity, updateResearchActivities } = load('shared/researchActivity.ts');
  const events = [];
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  assert.equal(service.getResearchZoteroStatus().automatic, true, 'managed MCP requires no connect action');
  const firstController = new AbortController();
  const input = { documentId: scope.documents.find(doc => doc.workId === 'SOURCE01').id, from: 1 };
  const first = service.readAutomaticResearchZotero(scope, input, firstController.signal);
  const firstRejected = assert.rejects(first, /abort/i);
  const second = withResearchActivity(event => events.push(event), undefined, () => service.readAutomaticResearchZotero(scope, input));
  for (let i = 0; i < 100 && gates.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(gates.length, 2);
  await assert.rejects(() => service.readAutomaticResearchZotero(scope, input), /session_limit/);
  firstController.abort(); await firstRejected;
  assert.equal(connections[0].closed, true);
  assert.equal(connections[1].closed, false, 'cancelling one run cannot close another');
  gates[1](); await second;
  assert.deepEqual(events.map(event => [event.layer, event.operation, event.status]), [['zotero', 'pages', 'active'], ['zotero', 'pages', 'completed']], 'connection and tool call form one observed read');
  assert.equal(summarizeResearchActivity(events.reduce(updateResearchActivities, [])).find(row => row.layer === 'zotero').state, 'completed');
  assert.equal(service.getResearchZoteroStatus().activeSessions, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'mcp/zotero')), [], 'own ephemeral manifests are removed');
  await service.setResearchZoteroAutomatic(false);
  await assert.rejects(() => service.readAutomaticResearchZotero(scope, input), /disabled/);
  assert.equal(service.getResearchZoteroStatus().state, 'disabled');
  await service.setResearchZoteroAutomatic(true);
  const pins = await service.pinZoteroOriginals({ ...scope, documents: [scope.documents.find(doc => doc.id === input.documentId)] });
  globalThis.fetch = async url => {
    const key = String(url).split('/').at(-1);
    return new Response(JSON.stringify({ key, version: key === 'ATTACH01' ? 2 : 1, data: { parentItem: key === 'ATTACH01' ? 'SOURCE01' : undefined } }), { headers: { 'Zotero-Server-ID': 'fixture-independent' } });
  };
  await assert.rejects(() => service.readAutomaticResearchZotero(scope, input, undefined, pins), /revision_changed/, 'a later attachment revision cannot replace the run snapshot');
  assert.equal(service.getResearchZoteroStatus().activeSessions, 0);
  globalThis.fetch = async () => new Response('{}');
  events.length = 0;
  await assert.rejects(() => withResearchActivity(event => events.push(event), undefined, () => service.readAutomaticResearchZotero(scope, input)), /identity_mismatch/);
  assert.deepEqual(events.map(event => event.status), ['active', 'failed'], 'a startup failure is observed even before the MCP tool can be called');
  assert.equal(summarizeResearchActivity(events.reduce(updateResearchActivities, [])).find(row => row.layer === 'zotero').state, 'failed');
  assert.equal(service.getResearchZoteroStatus().activeSessions, 0, 'failed startup releases its reserved slot');
  console.log('Simulated MCP sessions: default automatic, two-slot reservation, independent cancellation, disabled policy, endpoint identity and owned cleanup passed.');
} finally {
  await load('electron/mcp/researchZotero.ts').closeResearchZotero();
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
