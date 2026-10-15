import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const copy = value => JSON.parse(JSON.stringify(value));
const withoutOwnerRevision = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'ownerRevision' ? undefined : item));
const portable = await build({ entryPoints: ['shared/portableDocumentVisuals.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'visuals', write: false, metafile: true });
const stubs = {
  'node:crypto': 'export const randomUUID=()=>globalThis.fixture.id();',
  electron: 'export const BrowserWindow={getAllWindows:()=>[]};',
  writingDraftsRepo: 'export const getWritingWorkshopDraft=()=>globalThis.fixture.saved;',
  immersionRepo: 'export const getImmersionSession=()=>null;',
  vaultRegistry: 'export const getActiveVault=()=>({id:"vault"});',
  documentCatalog: 'export const listDocumentSkills=()=>globalThis.fixture.catalog();',
  registry: 'export const capabilityRegistry=()=>globalThis.fixture.registryPins().registry; export const pinCapabilitiesForTurn=()=>globalThis.fixture.registryPins().pins;',
  resourceExecution: 'export const executeSkillResources=(...a)=>globalThis.fixture.executeResources(...a);',
  documentStore: 'export const readDocumentVisuals=()=>globalThis.fixture.manifest;export const readDocumentVisualUsage=()=>globalThis.fixture.usage;export const retainPreviousVisuals=()=>globalThis.fixture.retainPrevious();export const visualContentHash=x=>globalThis.fixture.contentHash(x);export const writeDocumentVisuals=x=>globalThis.fixture.persist(x);export const undoDocumentVisuals=()=>null;',
  documentSnapshot: 'export const snapshotDocumentFigure=(...a)=>globalThis.fixture.snapshot(...a);',
  chatAssets: 'export const chatAssetOwner=(...a)=>globalThis.fixture.owner(...a);export const chatAssetVersion=(...a)=>globalThis.fixture.assetVersion(...a);',
  settingsRepo: 'export const getSettings=()=>({deepResearchModel:globalThis.fixture.model,synthesisModel:null});',
  aiClient: 'export const completeJson=(...a)=>globalThis.fixture.completeJson(...a);export const completeText=(...a)=>globalThis.fixture.completeText(...a);',
  pipelineLogCore: 'export const logPipelineInfo=(...a)=>globalThis.fixture.logPipelineInfo(...a);export const logPipelineWarning=(...a)=>globalThis.fixture.logPipelineWarning(...a);export const logPipelineFailure=(...a)=>globalThis.fixture.logPipelineFailure(...a);',
};
const hostStubs = { name: 'desktop-only-host-boundaries', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => {
    const name = args.path.split('/').at(-1);
    if (args.importer.endsWith('/electron/ai/documentVisuals.ts') && (stubs[args.path] || stubs[name])) return { path: stubs[args.path] ? args.path : name, namespace: 'host' };
  });
  builder.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: stubs[args.path], loader: 'js' }));
} };
const desktop = await build({ entryPoints: ['electron/ai/documentVisuals.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'desktop', write: false, plugins: [hostStubs] });
// Frozen verbatim electron/ai/documentVisuals.ts from 378df6dab3808f862005c45191de1006a57c4e2c.
// Its hash below and independent execution protect the extraction, not just delegation.
const canonicalSource = fs.readFileSync('scripts/fixtures/document-visuals/canonical-before-portable.ts', 'utf8');
const canonical = await build({ stdin: { contents: canonicalSource, sourcefile: path.resolve('electron/ai/documentVisuals.ts'), resolveDir: path.resolve('electron/ai'), loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', globalName: 'canonical', write: false, plugins: [hostStubs] });
function realm(code, name, fixture) {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-15T00:00:00.000Z'])); } }
  const context = vm.createContext({ AbortController, AbortSignal, DOMException, structuredClone, Date: Clock, fixture, Buffer: undefined });
  vm.runInContext(code.outputFiles[0].text, context);
  assert.equal(context.Buffer, undefined);
  return context[name];
}
function fixture({ body = 'Evidence [work](nodus://works/one).', max = 3, plan, paidTwice = false, posterFails = false, invalidateAfterText = false, failedFlush = false, previous = null } = {}) {
  const trace = [], model = { provider: 'openai', model: 'test-model' };
  const skill = { id: 'svg', name: 'SVG Studio', description: 'Draw an evidence diagram', instructions: 'Return a diagram', enabled: { assistant: true, nodi: true }, capabilities: ['svg'], builtin: 'svg' };
  const policy = { enabled: true, skills: [{ skillId: skill.id, enabled: true, maxCalls: max }] };
  let next = 0, planning = 0, durable = null, valid = true;
  const f = {
    policy, trace, model, input: { title: 'Research', language: 'en', model, fields: { body } }, vaultId: 'vault', previous, manifest: previous, usage: copy(previous?.usage ?? {}),
    saved: { draft: { title: 'Research', brief: { language: 'en' }, abstract: '', draftMarkdown: body }, model },
    catalog: () => [{ skill, billing: 'none', available: true }], registryPins: () => ({ registry: { providers: new Map([['nodus:svg', { id: 'nodus:svg' }], ['nodus:image', { id: 'nodus:image' }]]), fences: new Map([['svg', { provider: { id: 'nodus:svg' }, kind: 'request' }]]), chatOrder: [{ id: 'nodus:svg' }, { id: 'nodus:image' }], problems: [], revision: 7 }, pins: { test: 'exact-pins' } }),
    id: () => `id-${++next}`, clock: () => '2026-10-15T00:00:00.000Z', contentHash: fields => JSON.stringify(fields),
    current: m => valid && f.manifest?.revision === m.revision,
    retainPrevious: () => trace.push(['retainPrevious']), notify: () => {},
    persist: m => { f.manifest = copy(m); trace.push(['persist', copy(m)]); },
    flushPersist: async () => { if (failedFlush) throw new Error('durable storage failed'); durable = copy(f.manifest); },
    owner: (...args) => JSON.stringify(args), assetVersion: () => 0,
    completeJson: async (opts, guard, chosen) => {
      assert.deepEqual(chosen, model); assert.equal(opts.noRetry, true);
      const payload = JSON.parse(opts.user); trace.push(['json', opts.system, payload]);
      let result;
      if ('objective' in payload) result = ['Consider a diagram'];
      else if ('proposals' in payload) result = payload.proposals.slice(0, 1).map(p => p.id);
      else result = plan ? plan(payload, ++planning) : payload.blocks.filter(b => !b.markdown.startsWith('#')).map(b => ({ blockId: b.id, skillId: 'svg', brief: 'Draw only supplied evidence', caption: 'Evidence', sources: [], layout: 'wide' }));
      assert.equal(guard(result), true, 'scripted response must obey the actual provider guard'); return result;
    },
    completeText: async (opts, chosen) => { assert.deepEqual(chosen, model); assert.equal(opts.noRetry, true); if (durable) assert.ok(durable.usage.svg.attempts >= 1 && durable.usage.svg.attempts <= max); trace.push(['text', opts]); if (invalidateAfterText) valid = false; return '```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```'; },
    executeResources: async (_answer, execution) => {
      assert.deepEqual([...execution.registry.providers.keys()], ['nodus:svg']); assert.deepEqual(execution.pins, { test: 'exact-pins' });
      execution.beforeInvoke(); await execution.flushPersist?.();
      execution.beforePaidCall(); await execution.flushPersist?.();
      trace.push(['paid-resource']);
      if (paidTwice) { execution.beforePaidCall(); await execution.flushPersist?.(); trace.push(['unexpected-second-paid-resource']); }
      return { view: { schemaVersion: 1, summary: 'Evidence diagram', nodes: [] }, artifactSources: ['source:exact'] };
    },
    snapshot: async (view, owner) => { assert.ok(f.manifest.figures.some(figure => figure.owner === owner && figure.view)); trace.push(['snapshot', view, owner]); if (posterFails) throw new Error('poster failed'); return 'poster:stored'; },
    logPipelineInfo: event => trace.push(['info', copy(event)]), logPipelineWarning: event => trace.push(['warning', copy(event)]), logPipelineFailure: event => trace.push(['failure', { ...copy(event), error: String(event.error) }]),
  };
  return f;
}
const target = { kind: 'deep-research', id: 'report' };
async function run(f, request = {}) { return realm(portable, 'visuals', f).enrichPortableDocumentVisuals(target, f.policy, f, request); }

test('the canonical reference is the exact pre-extraction Desktop implementation', () => {
  assert.equal(createHash('sha256').update(canonicalSource).digest('hex'), '12c8637b1ea38b046205b9c3d42113b5fbcc115511103a364ec24dd4d83c419a');
});

test('browser bundle is Node-free and Desktop delegates the exact planning/enrichment loop', async () => {
  for (const input of Object.keys(portable.metafile.inputs)) assert.doesNotMatch(input, /(?:^|\/)(electron|node_modules)\//);
  assert.doesNotMatch(portable.outputFiles[0].text, /\brequire\(|\bBuffer\b|node:/);
  const body = '## Heading\n\n' + 'First evidence. '.repeat(1700) + '\n\nSecond evidence [source](nodus://works/one).';
  const browserFixture = fixture({ body }), desktopFixture = fixture({ body }), canonicalFixture = fixture({ body });
  const browserAPI = realm(portable, 'visuals', browserFixture), desktopAPI = realm(desktop, 'desktop', desktopFixture), canonicalAPI = realm(canonical, 'canonical', canonicalFixture);
  assert.deepEqual(await browserAPI.preparePortableDocumentVisualHints(browserFixture, browserFixture.policy, 'objective', browserFixture.model), await desktopAPI.prepareDocumentVisualHints(desktopFixture.policy, 'objective', desktopFixture.model));
  await canonicalAPI.prepareDocumentVisualHints(canonicalFixture.policy, 'objective', canonicalFixture.model);
  const a = await browserAPI.enrichPortableDocumentVisuals(target, browserFixture.policy, browserFixture, { hints: ['Consider a diagram'] });
  const b = await desktopAPI.enrichDocumentVisuals(target, desktopFixture.policy, { hints: ['Consider a diagram'] });
  const c = await canonicalAPI.enrichDocumentVisuals(target, canonicalFixture.policy, { hints: ['Consider a diagram'] });
  assert.deepEqual(copy(a), copy(b));
  assert.deepEqual(withoutOwnerRevision(a), copy(c));
  assert.equal(a.figures[0].ownerRevision, a.revision);
  const normalTrace = f => copy(f.trace).map(row => row[0] === 'text' ? ['text', { ...row[1], signal: undefined }] : row);
  assert.deepEqual(normalTrace(browserFixture), normalTrace(desktopFixture));
  assert.deepEqual(withoutOwnerRevision(normalTrace(browserFixture)), withoutOwnerRevision(normalTrace(canonicalFixture)));
  assert.equal(a.figures.length, 1); assert.ok(a.discarded.some(d => d.reason === 'not-selected'));
  const calls = browserFixture.trace.filter(e => e[0] === 'json');
  assert.equal(calls.filter(c => c[2].blocks).length, 3, 'a block over 24k stays whole between its heading and the final block');
  assert.equal(calls.filter(c => c[2].proposals).length, 1, 'one global selection across batches');
});

test('one exact refusal repair keeps its explanation and never silently buys another resource', async () => {
  const f = fixture({ plan: (payload, attempt) => [{ blockId: payload.blocks[0].id, skillId: 'svg', brief: 'Evidence only', caption: 'Caption', sources: attempt === 1 ? ['nodus://works/absent'] : [], layout: 'wide' }] });
  const result = await run(f);
  const plans = f.trace.filter(e => e[0] === 'json');
  assert.equal(plans.length, 2); assert.equal(plans[1][2].refused[0].reason.length > 0, true);
  assert.equal(result.figures.length, 1); assert.equal(result.discarded.length, 0); assert.equal(result.state, 'ready');
  assert.equal(f.trace.filter(e => e[0] === 'paid-resource').length, 1);
});

test('paid ceilings persist before effects and reject a second paid invocation', async () => {
  const f = fixture({ max: 1, paidTwice: true }); const result = await run(f);
  assert.equal(result.state, 'partial'); assert.equal(result.usage.svg.attempts, 1); assert.equal(result.usage.svg.paidCalls, 1);
  assert.equal(f.trace.filter(e => e[0] === 'paid-resource').length, 1);
  assert.equal(f.trace.filter(e => e[0] === 'unexpected-second-paid-resource').length, 0);
});

test('a poster retry preserves the paid resource and makes no planning/text/resource call', async () => {
  const first = fixture({ posterFails: true }); const failed = await run(first);
  assert.equal(failed.state, 'partial'); assert.ok(failed.figures[0].view && failed.figures[0].owner);
  const second = fixture({ previous: copy(failed) }); const recovered = await run(second, { retry: true });
  assert.equal(recovered.state, 'ready'); assert.deepEqual(copy(recovered.usage), copy(failed.usage));
  assert.equal(recovered.figures[0].ownerRevision, failed.figures[0].ownerRevision);
  assert.equal(recovered.figures[0].owner, failed.figures[0].owner);
  assert.equal(second.trace.filter(e => ['json', 'text', 'paid-resource'].includes(e[0])).length, 0);
  assert.equal(second.trace.filter(e => e[0] === 'snapshot').length, 1);
});

test('stale revision and failed durable flush cannot execute resources or publish success', async () => {
  const stale = fixture({ invalidateAfterText: true }); const result = await run(stale);
  assert.equal(result.state, 'failed'); assert.equal(stale.trace.filter(e => e[0] === 'paid-resource').length, 0);
  const diskFailure = fixture({ failedFlush: true });
  await assert.rejects(run(diskFailure), /durable storage failed/);
  assert.equal(diskFailure.trace.filter(e => ['json', 'text', 'paid-resource'].includes(e[0])).length, 0);
});

test('Desktop figure removal advances the manifest while preserving surviving owner birth', async () => {
  const f = fixture({ body: 'First evidence.\n\nSecond evidence.' });
  const api = realm(desktop, 'desktop', f);
  const original = await api.enrichDocumentVisuals(target, f.policy);
  assert.equal(original.figures.length, 2);
  const survivor = copy(original.figures[1]);
  const removed = api.removeDocumentFigure(target, original.figures[0].id);
  assert.equal(removed.figures.length, 1);
  assert.notEqual(removed.revision, original.revision);
  assert.equal(removed.figures[0].owner, survivor.owner);
  assert.equal(removed.figures[0].ownerRevision, survivor.ownerRevision);
});

test('cancellation checkpoints the actual cancelled state without any provider or resource call', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  const result = await run(f, { signal: controller.signal });
  assert.equal(result.state, 'cancelled');
  assert.equal(f.manifest.state, 'cancelled');
  assert.equal(f.trace.filter(e => ['json', 'text', 'paid-resource'].includes(e[0])).length, 0);
});

test('orientation stays byte-identical and disabled hints perform no call', async () => {
  const api = realm(portable, 'visuals', {});
  const contextSource = fs.readFileSync('electron/ai/documentVisualContext.ts', 'utf8');
  assert.match(contextSource, /planning\.run\(documentVisualPlanningText\(catalog, hints\), run\)/);
  assert.equal(api.documentVisualPlanningText('[]', ['x']), '');
  assert.match(api.documentVisualPlanningText('[{"id":"svg"}]', ['x']), /Preserve the requested prose schema; do not execute resources, add placeholders, or promise a figure\./);
  const f = fixture(); assert.deepEqual(copy(await api.preparePortableDocumentVisualHints(f, undefined, 'objective')), []);
  assert.equal(f.trace.length, 0);
});
