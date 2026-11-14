// Contract test for the database Deep Research vertical. This stays static like
// test-ipc-contract: loading Electron would boot the provider stack and a vault.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApiMethods, assertChannelsWired, readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcp = readFileSync(path.join(root, 'electron/mcp/tools.ts'), 'utf8');
const api = readFileSync(path.join(root, 'shared/api/databases.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload/databases.ts'), 'utf8');
const ipc = readFileSync(path.join(root, 'electron/ipc/databases.ts'), 'utf8');
const engine = readFileSync(path.join(root, 'electron/ai/databaseDeepResearch.ts'), 'utf8');
const portableEngine = readFileSync(path.join(root, 'shared/databaseResearchEngine.ts'), 'utf8');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'nodus-db-phases-'));
test.after(() => rmSync(temporary, { recursive: true, force: true }));
const engineBundle = path.join(temporary, 'engine.cjs');
await build({ entryPoints: [path.join(root, 'shared/databaseResearchEngine.ts')], outfile: engineBundle, bundle: true, platform: 'node', format: 'cjs', alias: { '@shared': path.join(root, 'shared') }, logLevel: 'silent' });
const researchEngine = createRequire(import.meta.url)(engineBundle);
const lane = readFileSync(path.join(root, 'electron/ai/databaseDeepResearchLane.ts'), 'utf8');
const exporter = readFileSync(path.join(root, 'electron/export/databaseDeepResearchExport.ts'), 'utf8');
const mcpServer = readFileSync(path.join(root, 'electron/mcp/server.ts'), 'utf8');
const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const names = [
  'nodus_preview_database_deep_research',
  'nodus_enqueue_database_deep_research',
  'nodus_list_database_deep_research_jobs',
  'nodus_get_database_deep_research_job',
  'nodus_cancel_database_deep_research_job',
  'nodus_list_database_deep_research_reports',
  'nodus_get_database_deep_research_reports',
];
const channels = [
  'db:deepResearch:preview', 'db:deepResearch:enqueue', 'db:deepResearch:jobs:list',
  'db:deepResearch:job:get', 'db:deepResearch:job:cancel', 'db:deepResearch:jobs:clear',
  'db:deepResearch:reports:list', 'db:deepResearch:report:get', 'db:deepResearch:report:delete',
  'db:deepResearch:report:export',
];

function toolBlock(name) {
  const start = mcp.indexOf(`'${name}'`);
  const end = mcp.indexOf("server.registerTool(", start + 1);
  return start < 0 ? '' : mcp.slice(start, end < 0 ? undefined : end);
}

test('database Deep Research IPC methods and channels are wired', () => {
  assertApiMethods(assert, [
    'previewDatabaseDeepResearch', 'enqueueDatabaseDeepResearch', 'listDatabaseDeepResearchJobs',
    'getDatabaseDeepResearchJob', 'cancelDatabaseDeepResearchJob', 'clearFinishedDatabaseDeepResearchJobs',
    'listDatabaseDeepResearchReports', 'getDatabaseDeepResearchReport', 'deleteDatabaseDeepResearchReport',
    'exportDatabaseDeepResearchReport', 'onDatabaseDeepResearchProgress',
  ]);
  assertChannelsWired(assert, channels);
  assert.match(readSource('@main'), /['"]db:deepResearch:progress['"]/);
  assert.match(readSource('@bridge'), /['"]db:deepResearch:progress['"]/);
});

test('MCP exposes only the database-scoped async research surface', () => {
  for (const name of names) {
    assert.match(mcp, new RegExp(`server\\.registerTool\\(\\s*['"]${name}['"]`), `${name} is not registered`);
    assert.match(mcp, new RegExp(`\\b${name}: DATABASE_VAULTS\\b`), `${name} is not restricted to DATABASE_VAULTS`);
    assert.doesNotMatch(toolBlock(name), /writer\s*[:=].*client|writer\s*=\s*["']client/i, `${name} exposes writer=client`);
  }
});

test('MCP jobs and reports are paginated', () => {
  for (const name of ['nodus_list_database_deep_research_jobs', 'nodus_list_database_deep_research_reports']) {
    const block = toolBlock(name);
    assert.match(block, /limit:\s*compactLimitSchema/);
    assert.match(block, /offset:\s*z\.number\(\)\.int\(\)\.min\(0\)/);
  }
});

test('the public bridge exposes only the canonical database research contract', () => {
  for (const source of [api, preload, ipc]) {
    assert.doesNotMatch(source, /createDatabaseResearchRun|startDatabaseResearchRun|createDatabaseDeepResearchJob|db:research:job:create/);
  }
  assert.match(ipc, /enqueueDatabaseDeepResearch\(vault\.id, input,\{bridgeJobId:host\.mobileBridgeJobId,requireExisting:host\.mobileBridgeRecovery\}\)/, 'IPC uses the shared durable lane');
  assert.match(mcp, /enqueueDatabaseDeepResearch\(getActiveVault\(\)\.id, input\)/, 'MCP uses the same durable lane');
});

test('durable lane resumes at startup and previews expose localized constrained plans', () => {
  assert.match(main, /if \(startupVault\.type === 'databases'\) ensureDatabaseDeepResearchLane\(startupVault\.id\)/);
  assert.match(lane, /status:\s*'stale'/);
  const preview = toolBlock('nodus_preview_database_deep_research');
  assert.match(preview, /roles:\s*z\.record\(z\.union\(\[z\.string\(\), z\.array\(z\.string\(\)\)\]\)\)/);
  assert.match(preview, /buildDatabaseDeepResearchPreviewSections/);
  assert.match(preview, /getDatabaseDeepResearchAnalysisRequirements/);
  assert.match(toolBlock('nodus_enqueue_database_deep_research'), /maxCostUsd:\s*z\.number\(\)/);
  assert.match(ipc, /requiredAnalyses:\s*analyses\.required/);
  assert.match(ipc, /optionalAnalyses:\s*analyses\.optional/);
});

test('engine has exactly eight durable phases and no web/SQL model surface', () => {
  const phases = ['snapshot', 'semantic_profile', 'planning', 'calculations', 'sensitivity', 'adversarial_review', 'verification', 'assembly'];
  assert.match(engine, /export \* from '@shared\/databaseResearchEngine'/);
  assert.deepEqual(researchEngine.DATABASE_RESEARCH_PHASES, phases);
  const snapshot = { databaseId: 'fixture', revision: 1, rows: [], rowCount: 0, totalRowCount: 0, relationEdges: [], hash: 'a'.repeat(64) };
  const result = researchEngine.runDatabaseDeepResearch({ databaseId: 'fixture', plan: { steps: [] } }, { readSnapshot: () => snapshot, readColumns: () => [], now: () => '2026-10-15T00:00:00.000Z' });
  assert.deepEqual(result.phaseLog.map(item => item.phase), phases);
  assert.doesNotMatch(portableEngine, /fetch\(|https?:\/\/|child_process|exec\(|spawn\(/);
  assert.doesNotMatch(engine, /fetch\(|https?:\/\/|child_process|exec\(|spawn\(/);
  assert.doesNotMatch(lane, /synthesisModel|extractionModel|chatModel/, 'selected Deep Research model has no silent fallback');
  assert.match(lane, /model:\s*run\.model|model:\s*selectedModel/);
});

test('exports include Markdown, Word, professional PDF and reproducible ZIP with opt-in snapshot', () => {
  assert.match(exporter, /format === 'markdown'/);
  assert.match(exporter, /format === 'pdf'/);
  assert.match(exporter, /format === 'docx'/);
  assert.match(exporter, /markdownToDocx\(redactDatabaseResearchMarkdown\(report\.markdown\)\)/, 'the Word export is redacted like the Markdown one');
  assert.match(exporter, /new AdmZip/);
  assert.match(exporter, /if \(options\.includeSnapshot\)/);
  assert.match(ipc, /\['markdown', 'pdf', 'docx', 'zip'\]/);
});

test('MCP database research authorization is fail-closed and resource-scoped', () => {
  assert.match(mcpServer, /refusing session/);
  assert.doesNotMatch(mcpServer, /serving full surface/);
  assert.match(toolBlock('nodus_enqueue_database_deep_research'), /for \(const databaseId of databaseIds\).*canMcpView/s);
  assert.match(mcp, /function canMcpViewDatabaseResearchRun/);
  assert.match(mcp, /databaseIds\.every\(\(databaseId\) => canMcpView\('database', databaseId\)\)/);
  assert.match(toolBlock('nodus_get_database_deep_research_reports'), /canMcpViewDatabaseResearchRun\(run\)/);
});
