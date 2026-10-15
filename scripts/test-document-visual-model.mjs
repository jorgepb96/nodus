// Which engine writes a document's visual resources. The rule is small and the
// consequences of getting it wrong are not: a report that remembers an engine the
// reader has since left behind keeps failing against that engine's quota, and the
// message it shows names a provider the reader never chose for the work.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-visual-model-'));
await build({ entryPoints: ['shared/documentVisualEnrich.ts'], bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'model.mjs') });
const { resolveDocumentVisualModel: resolve, documentVisualModelKey: keyFor, documentVisualModelFromSettings: fromSettings, asDocumentVisualModel: asModel } = await import(pathToFileURL(path.join(temp, 'model.mjs')));

const codex = { provider: 'codex', model: 'gpt-5.6-sol' };
const deepseek = { provider: 'deepseek', model: 'deepseek-flash' };
const gemini = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the reader’s current model outranks the one the report was written with', () => {
  assert.deepEqual(resolve({ configured: deepseek, stored: codex }), deepseek);
  assert.deepEqual(resolve({ general: gemini, stored: codex }), gemini);
  assert.deepEqual(resolve({ requested: gemini, configured: deepseek, stored: codex }), gemini, 'a choice made for this run wins over everything');
  assert.deepEqual(resolve({ stored: codex }), codex, 'with nothing configured, the report is still better than nothing');
  assert.equal(resolve({}), null);
});

test('a task with no model of its own inherits the general one, like every other task', () => {
  assert.deepEqual(fromSettings({ deepResearchModel: null, immersionModel: null, synthesisModel: gemini }, 'deep-research'), gemini);
  assert.equal(fromSettings({ deepResearchModel: null, immersionModel: null, synthesisModel: null }, 'immersion'), null);
});

test('each document kind follows its own task', () => {
  assert.equal(keyFor('deep-research'), 'deepResearchModel');
  assert.equal(keyFor('immersion'), 'immersionModel');
  const settings = { deepResearchModel: deepseek, immersionModel: codex, synthesisModel: gemini };
  assert.deepEqual(fromSettings(settings, 'deep-research'), deepseek);
  assert.deepEqual(fromSettings(settings, 'immersion'), codex, 'an immersion must not borrow the Deep Research engine');
});

test('a model crossing the IPC boundary is validated, and the level assigned to it survives', () => {
  assert.deepEqual(asModel({ provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', junk: 1 }), { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  for (const value of [null, undefined, 'codex', 42, {}, { provider: 'codex' }, { model: 'gpt-5.6-sol' }, { provider: '', model: 'x' }, { provider: 'codex', model: '' }]) {
    assert.equal(asModel(value), null, `${JSON.stringify(value)} is not a model`);
  }
});

test('the enrichment resolves its engine once and every call in the run uses it', () => {
  const source = read('electron/ai/documentVisuals.ts') + '\n' + read('shared/portableDocumentVisuals.ts');
  assert.match(source, /const model = resolveDocumentVisualModel\(\{[\s\S]*?requested: request\.model,[\s\S]*?configured: settings\[documentVisualModelKey\(target\.kind\)\],[\s\S]*?general: settings\.synthesisModel,[\s\S]*?stored: input\.model,/,
    'the run must weigh the request, the setting and the stored model in one place');
  assert.equal(source.includes('request.model ?? input.model'), false, 'no call site may bypass the resolved model');
  for (const pattern of [
    /Array\.isArray\(item\.sources\)\), model\)/,
    /typeof id === 'string'\), model\)/,
    /noRetry: true, signal,\s*\}, model\)/,
    /question: figure\.brief, model,/,
  ]) assert.match(source, pattern, 'every planning and figure call must run on the resolved engine');
});

test('the app reads the task’s model from the vault’s settings, not only from the report', () => {
  assert.match(read('electron/ai/documentVisuals.ts'), /import \{ getSettings \} from '\.\.\/db\/settingsRepo'/);
  assert.match(read('electron/ai/documentVisuals.ts'), /const settings = getSettings\(\)/);
});

test('a figure that fails names the engine that ran it', () => {
  const source = read('electron/ai/documentVisuals.ts') + '\n' + read('shared/portableDocumentVisuals.ts');
  const failures = [...source.matchAll(/logPipelineFailure\(\{[\s\S]*?\n\s*\}\);/g)].map(match => match[0]);
  assert.equal(failures.length, 2, 'both the per-figure and the run-level failure are recorded');
  for (const failure of failures) {
    assert.match(failure, /provider: model\?\.provider \?\? null/, 'the line must say which provider ran the figure');
    assert.match(failure, /model: model\?\.model \?\? null/, 'the line must say which model ran the figure');
  }
});

test('the reader can choose the engine, and the dialog says which one it will use', () => {
  const scope = read('src/components/DocumentVisualScope.tsx');
  assert.match(scope, /documentVisualModelFromSettings\(fresh, kind\)/, 'the picker opens on the task’s current model');
  assert.match(scope, /enrichDocumentVisuals\(target,[\s\S]{0,90}\{ retry, model \}\)/, 'the chosen model must travel with the request');
  assert.match(scope, /<ModelPicker settings=\{settings\} value=\{model\}/);
  assert.match(scope, /SubscriptionQuotaNotice model=\{model\}/, 'a subscription engine must warn before it spends the quota');
  assert.match(scope, /t\('Los recursos se generan con el modelo elegido aquí, no con el del informe\.'\)/);
});

test('the IPC boundary validates the model and the declared API carries it', () => {
  assert.match(read('electron/ipc.ts'), /model: asDocumentVisualModel\(options\?\.model\)/);
  assert.match(read('electron/preload/api.ts'), /enrichDocumentVisuals: \(target, policy, options\)/);
  assert.match(read('shared/types.ts'), /enrichDocumentVisuals\([\s\S]{0,200}options\?: import\('\.\/documentVisualEnrich'\)\.DocumentVisualEnrichOptions\)/);
});

test.after(async () => rm(temp, { recursive: true, force: true }));
