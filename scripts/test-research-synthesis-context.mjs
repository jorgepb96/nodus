// Exercise the actual prompt builder and retrieval against an isolated native database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (requireElectronRuntime(fileURLToPath(import.meta.url), '--native-synthesis-context')) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-synthesis-context-'));
  installRuntimeHooks(scratch);
  const require = createRequire(import.meta.url);
  const load = file => require(path.join(repoRoot, file));
  // Expose private orchestration only in this test; production code is compiled unchanged.
  const originalTs = require.extensions['.ts'];
  require.extensions['.ts'] = (mod, file) => {
    if (file === path.join(repoRoot, 'electron/ai/researchAssistant.ts')) {
      const compile = mod._compile;
      mod._compile = (code, name) => compile.call(mod, code + '\nexports.testBuildPrompt = buildResearchChatPrompt;\nexports.testExecution = skillExecution;\nexports.testFinalizeWithAudit = finalizeWithAudit;\n', name);
    }
    originalTs(mod, file);
  };
  const dbModule = load('electron/db/database.ts');
  const db = dbModule.getDb();
  const ai = load('electron/ai/aiClient.ts');
  ai.embed = async () => null;
  ai.localModelContextWindow = async () => null;
  const molecule = load('electron/ai/moleculeInspection.ts');
  molecule.inspectResearchMolecules = async () => [];
  load('electron/db/settingsRepo.ts').updateSettings({ promptLanguage: 'en', researchWebSearch: 'off' });
  const passages = load('electron/db/passagesRepo.ts');
  load('electron/zotero/zoteroClient.ts').getItem = async () => null;
  load('electron/extraction/textExtractor.ts').resolveWorkText = async () => ({ text: '', sourceType: 'text' });
  for (const id of ['selected', 'outside']) {
    db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,light_status,deep_status,summary_status,summary_hash,deep_hash) VALUES(?,?,?,'[]',2020,'book','text',0,'done','done','done','hash','hash')`).run(id, id, `Organic Chemistry ${id}`);
    const text = `Benzocaine is made by Fischer esterification of a carboxylic acid with an alcohol under acid catalysis. The equilibrium is driven toward the ester by using the alcohol as the solvent and removing the water that forms. Concentrated sulfuric acid usually catalyses the reaction through protonation of the carbonyl group, addition of the alcohol, and elimination of water from the tetrahedral intermediate. Several experimental procedures describe this transformation with practical details about purification and isolation of the desired product. ${id.toUpperCase()}_ONLY evidence.`;
    passages.replaceWorkPassages(id, 'hash', [{ text, pageLabel: '1', embedding: [1, 0] }]);
  }
  globalThis.fetch = () => { throw Error('Network forbidden in synthesis context regression tests'); };
  const research = load('electron/ai/researchAssistant.ts');
  const evidence = load('electron/ai/synthesisEvidence.ts');
  const realGather = evidence.gatherSynthesisEvidence;
  let optionsSeen, questionSeen;
  evidence.gatherSynthesisEvidence = async (question, options) => {
    optionsSeen = options; questionSeen = question;
    return realGather(question, options);
  };
  // Target-level evidence is remembered between a request and its corrections, and every case here
  // asks about the same target. Without this, each test after the first is served the previous
  // one's result and stops exercising the gather at all — which is how the cache was first seen
  // working, and would otherwise read as these tests passing for the wrong reason.
  test.beforeEach(() => evidence.clearSynthesisEvidenceCache());
  const selection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: true, passages: true, graph: false, graphParts: {}, layers: { ideas: false, documents: true }, sourceFilter: { enabled: true, authorIds: [], workIds: ['selected'] } };
  const request = { model: { provider: 'openai', model: 'test' }, messages: [{ role: 'user', content: 'Propose a synthesis of benzocaine (SMILES: CCOC(=O)c1ccc(N)cc1).' }], selection, webSearch: 'off' };
  const skill = { id: 'chemistry-test', name: 'Chemistry', instructions: '', enabled: { assistant: true, nodi: false }, capabilities: ['nodus:chemistry'] };
  const build = async (input = request, signal = new AbortController().signal) => JSON.parse((await research.testBuildPrompt(input, [skill], undefined, signal)).user);

  test.after(() => { dbModule.closeDb(); fs.rmSync(scratch, { recursive: true, force: true }); });

  test('selected works constrain pre-answer chemistry evidence and post-answer options', async () => {
    const controller = new AbortController();
    const payload = await build(request, controller.signal);
    assert.ok(payload.evidencia_para_la_ruta.textbook_passages.some(p => p.text.includes('SELECTED_ONLY')));
    assert.ok(!JSON.stringify(payload.evidencia_para_la_ruta).includes('OUTSIDE_ONLY'));
    assert.equal(optionsSeen.signal, controller.signal);
    assert.deepEqual([...research.testExecution(request).evidenceScope.workIds], ['selected']);
    assert.equal(optionsSeen.evidenceScope.external, false);
  });

  test('documents switched off contribute no chemistry passages, even with selected books', async () => {
    const payload = await build({ ...request, selection: { ...selection, layers: { ideas: false, documents: false } } });
    assert.equal(payload.evidencia_para_la_ruta, undefined);
  });

  test('an empty source selection remains empty instead of searching the full library', async () => {
    const payload = await build({ ...request, selection: { ...selection, sourceFilter: { enabled: true, authorIds: [], workIds: [] } } });
    assert.equal(payload.evidencia_para_la_ruta, undefined);
  });

  test('an authorized notebook limits chemistry to its own works', () => {
    const inventory = load('electron/ai/researchCorpusInventory.ts').researchCorpusInventory();
    const document = inventory.documents.find(document => document.workId === 'selected');
    assert.ok(document);
    const notebooks = load('electron/db/researchNotebooksRepo.ts');
    const notebook = notebooks.saveResearchNotebook({ name: 'Selected chemistry', sources: [{ kind: 'work', id: 'selected' }], exclusions: [], mode: 'fixed' }, [document.id]);
    const scope = load('electron/ai/researchNotebookService.ts').resolveResearchNotebook(notebook.id);
    assert.deepEqual(scope.documents.map(document => document.workId), ['selected']);
    const service = load('electron/ai/researchNotebookService.ts');
    const preparation = load('electron/ai/documentaryPreparation.ts');
    const original = preparation.getResearchPreparationInventory;
    preparation.getResearchPreparationInventory = () => ({ documents: [{ id: document.id, title: document.title, preparation: { status: 'ready', embeddings: 'ready' } }] });
    try {
      const authorized = service.authorizeNotebookRequest({ ...request, selection: { ...selection, notebookId: notebook.id, sourceFilter: { enabled: false } } });
      const grant = research.testExecution(authorized).evidenceScope;
      assert.deepEqual([...grant.workIds], ['selected']);
      assert.equal(grant.external, false);
      assert.deepEqual(evidence.synthesisEvidenceWorkIds(grant), ['selected']);
    } finally { preparation.getResearchPreparationInventory = original; }
  });

  test('automatic academic authorization preserves external chemistry evidence; explicit restrictions do not', () => {
    const service = load('electron/ai/researchNotebookService.ts');
    const full = service.authorizeNotebookRequest({ ...request, selection: { ...selection, sourceFilter: { enabled: false } } });
    const grant = research.testExecution(full).evidenceScope;
    assert.equal(grant.external, true);
    assert.equal(service.hasResearchSourceRestriction(full), false);
    assert.equal(service.hasResearchSourceRestriction(service.authorizeNotebookRequest(full)), false, 'reauthorization preserves the original grant');
    const restricted = service.authorizeNotebookRequest(request);
    assert.equal(research.testExecution(restricted).evidenceScope.external, false);
    assert.equal(service.hasResearchSourceRestriction(restricted), true);
    assert.equal(research.testExecution({ ...full, selection: { ...full.selection, layers: { ideas: false, documents: false } } }).evidenceScope.external, false);
  });

  for (const window of [4096, null]) test(`repeated correction retains the original target beyond the ${window ?? 'cloud'} history window`, async () => {
    ai.localModelContextWindow = async () => window;
    const fix = { role: 'user', content: 'Correction needed for the synthesis route above. Fix the rejected step.' };
    const messages = [request.messages[0]];
    for (let i = 0; i < 8; i++) messages.push({ role: 'assistant', content: 'Step 1 draft' }, fix);
    try {
      const payload = await build({ ...request, messages });
      assert.equal(questionSeen, request.messages[0].content);
      assert.ok(payload.evidencia_para_la_ruta.textbook_passages.some(p => p.text.includes('SELECTED_ONLY')));
    } finally { ai.localModelContextWindow = async () => null; }
  });

  test('retrieval starts once ORD has answered, beside the rest of the gather', async () => {
    // Retrieval reads only ORD's disconnections. The gather's slower phases (the route search's
    // budget, the textbook schemes' second level) used to hold it back for their whole length.
    let retrievalStarted;
    const embedMany = ai.embedMany;
    ai.embed = async () => { retrievalStarted?.(); return null; };
    ai.embedMany = async (texts) => { retrievalStarted?.(); return texts.map(() => null); };
    const recorded = evidence.gatherSynthesisEvidence;
    evidence.gatherSynthesisEvidence = async (question, options) => {
      const retrieving = new Promise(resolve => { retrievalStarted = resolve; });
      options.onDisconnections?.({ target: 'CCOC(=O)c1ccc(N)cc1', startingMaterials: [], disconnections: [], passages: [] });
      let timer;
      await Promise.race([retrieving, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('retrieval waited for the whole gather')), 2000); })])
        .finally(() => clearTimeout(timer));
      retrievalStarted = undefined;
      return recorded(question, options);
    };
    const service = load('electron/ai/researchNotebookService.ts');
    const researchWindow = ai.researchModelContextWindow;
    try {
      const payload = await build(request);
      assert.ok(payload.evidencia_para_la_ruta.textbook_passages.some(p => p.text.includes('SELECTED_ONLY')), 'the whole evidence still reaches the prompt');
      // The academic library's own path: an authorized scope, the corpus run and its window fit,
      // with a window large enough that retrieval has a budget at all.
      ai.researchModelContextWindow = async () => ({ tokens: 400_000, known: true });
      const scoped = await build(service.authorizeNotebookRequest({ ...request, selection: { ...selection, sourceFilter: { enabled: false } } }));
      assert.ok(scoped.evidencia_para_la_ruta.textbook_passages.length, 'the whole evidence reaches the scoped prompt too');
    } finally { evidence.gatherSynthesisEvidence = recorded; ai.embed = async () => null; ai.embedMany = embedMany; ai.researchModelContextWindow = researchWindow; }
  });

  test('a run of corrections keeps the route request in the replayed conversation', async () => {
    // The history window is twelve messages; six correction rounds used to push the request (and
    // every constraint the chips do not repeat: starting materials, scale, stereochemistry) out of it.
    const fix = { role: 'user', content: 'Correction needed for the synthesis route above. Fix the rejected step.' };
    const messages = [request.messages[0]];
    for (let i = 0; i < 8; i++) messages.push({ role: 'assistant', content: 'Step 1 draft' }, fix);
    const payload = await build({ ...request, messages });
    assert.equal(payload.conversacion[0].content, request.messages[0].content);
    assert.equal(payload.conversacion.at(-1).content, fix.content);
  });

  test('a stop during the route check keeps the answer the reader was shown', async () => {
    const original = molecule.resolveNamedRoute;
    const controller = new AbortController();
    molecule.resolveNamedRoute = async (_a, _b, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      queueMicrotask(() => controller.abort());
    });
    const execution = { ...research.testExecution(request), skills: [skill], routeTurn: true };
    const raw = 'Step 1 prose.\n\n```chemistry-plan\n{"version":2,"kind":"structure","species":[]}\n```\n';
    const shown = [];
    const error = console.error; console.error = () => {};
    try {
      const final = await research.testFinalizeWithAudit(raw, execution, controller.signal, text => shown.push(text));
      assert.ok(shown.length, 'the answer was repainted before the stop');
      assert.equal(final, shown.at(-1), 'the stop keeps the repainted answer, not the raw draft');
      assert.doesNotMatch(final, /```chemistry-plan/);
    } finally { molecule.resolveNamedRoute = original; console.error = error; }
  });

  test('a route request that asks for the web is an explicit web request', async () => {
    // The grant's search question on a route turn is the target and its reaction classes; whether
    // the user asked for the web is read from their own words, or a request with the web switched
    // off is never told so.
    const service = load('electron/ai/researchNotebookService.ts');
    const researchWindow = ai.researchModelContextWindow;
    ai.researchModelContextWindow = async () => ({ tokens: 400_000, known: true });
    try {
      const asked = { ...request, webSearch: 'off', messages: [{ role: 'user', content: `${request.messages[0].content} Search the web for recent industrial routes.` }] };
      const payload = await build(service.authorizeNotebookRequest({ ...asked, selection: { ...selection, sourceFilter: { enabled: false } } }));
      assert.equal(payload.contexto_modular_seleccionado.web_search, 'disabled_by_user');
    } finally { ai.researchModelContextWindow = researchWindow; }
  });

  test('a route correction searches its request again without planning or supervising the chip', async () => {
    // The correction's retrieval question is its request's: the target and its reaction classes.
    // Planning the chip's text and running the supervisor again bought the same evidence for a
    // model call per decision, on every correction round.
    const service = load('electron/ai/researchNotebookService.ts');
    const researchWindow = ai.researchModelContextWindow;
    const json = ai.completeJson;
    let calls = 0;
    ai.researchModelContextWindow = async () => ({ tokens: 400_000, known: true });
    ai.completeJson = async () => { calls++; throw Error('no model in this test'); };
    const warn = console.warn; console.warn = () => {};
    try {
      const fix = { role: 'user', content: 'Correction needed for the synthesis route above. Fix the rejected step.' };
      const messages = [request.messages[0], { role: 'assistant', content: 'Step 1 draft' }, fix];
      // The history an earlier answer's provenance would have authorized.
      const payload = await build({ ...service.authorizeNotebookRequest({ ...request, selection: { ...selection, sourceFilter: { enabled: false } } }), messages });
      assert.ok(payload.evidencia_para_la_ruta, 'the route evidence is still there');
      assert.equal(calls, 0, `${calls} planning or supervisor call(s) on a correction`);
    } finally { ai.researchModelContextWindow = researchWindow; ai.completeJson = json; console.warn = warn; }
  });

  test('a correction round inspects no molecules', async () => {
    // The chip's only SMILES-like tokens come from the shared rules text, so inspecting it opens a
    // chemistry worker for nothing on every correction round.
    const shared = load('shared/moleculeInspection.ts');
    const chip = JSON.parse(shared.formatMissingSpeciesPrompt('CCOC(=O)c1ccc(N)cc1').replace(/^```nodus-route-fix\n/, '').replace(/\n```$/, '')).prompt;
    assert.ok(shared.findSmilesCandidates(chip).length, 'the chip does carry SMILES-like tokens');
    let inspected = 0;
    const original = molecule.inspectResearchMolecules;
    molecule.inspectResearchMolecules = async () => { inspected++; return []; };
    try {
      await build({ ...request, messages: [request.messages[0], { role: 'assistant', content: 'Step 1 draft' }, { role: 'user', content: chip }] });
      assert.equal(inspected, 0);
    } finally { molecule.inspectResearchMolecules = original; }
  });

  test('cancelling a prompt interrupts the evidence embedding instead of finishing retrieval', async () => {
    const controller = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    ai.embed = async (_query, signal) => {
      assert.equal(signal, controller.signal);
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    try {
      const pending = build(request, controller.signal);
      pending.catch(() => {});
      let timer;
      try {
        await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('embedding never received the caller signal')), 2000); })]);
      } finally { clearTimeout(timer); }
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
    } finally { ai.embed = async () => null; }
  });

  test('cancellation reaches concurrent route tools, and one gather opens one runner', async () => {
    const registry = load('electron/capabilities/registry.ts');
    const reactions = load('electron/reactionIndex/index.ts');
    const originalRunner = molecule.chemistryRunner;
    const originalRegistry = registry.capabilityRegistry;
    const originalService = reactions.reactionIndexService;
    const controller = new AbortController();
    let running = 0, disposed = 0, opened = 0, started;
    const ready = new Promise(resolve => { started = resolve; });
    registry.capabilityRegistry = () => ({ providers: new Map([['nodus:chemistry', { tools: [{ id: 'search-routes' }, { id: 'propose-disconnections' }] }]]) });
    reactions.reactionIndexService = () => ({ localDirectory: async () => '/isolated-ord' });
    molecule.chemistryRunner = options => {
      // The real contract, mirrored: a supplied runner is handed back with a no-op dispose, so
      // one gather opens ONE worker however many phases ask for it. The stub has to honour that
      // or it counts a reuse as a fresh worker and this stops measuring anything.
      if (options.runner) return { runner: options.runner, dispose: async () => {} };
      opened++;
      return {
        runner: { invoke: async () => {
          assert.equal(options.signal, controller.signal);
          running++;
          if (running === 2) started();
          return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
        } },
        dispose: async () => { disposed++; },
      };
    };
    try {
      const pending = realGather(request.messages[0].content, { signal: controller.signal });
      pending.catch(() => {});
      await ready;
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
      // Two tools ran concurrently on one worker: the phases reuse what the gather opened, and an
      // abort still disposes it. A phase that goes back to opening its own raises both counts.
      assert.equal(running, 2, 'both route tools were reached');
      assert.equal(opened, 1, 'one worker for the whole gather');
      assert.equal(disposed, 1, 'and the gather closes the one it opened');
    } finally {
      molecule.chemistryRunner = originalRunner;
      registry.capabilityRegistry = originalRegistry;
      reactions.reactionIndexService = originalService;
    }
  });

  test('post-answer checks preserve structural verification while respecting the source grant', async () => {
    const registry = load('electron/capabilities/registry.ts');
    const reactions = load('electron/reactionIndex/index.ts');
    const originalRegistry = registry.capabilityRegistry, originalService = reactions.reactionIndexService, originalComplete = ai.completeText;
    registry.capabilityRegistry = () => ({ providers: new Map([['nodus:chemistry', { tools: [
      { id: 'verify-route', inputSchema: { properties: { labels: {} } } }, { id: 'known-reactions' }, { id: 'check-compatibility' }, { id: 'check-stock' },
    ] }]]) });
    reactions.reactionIndexService = () => ({ localDirectory: async () => '/isolated-ord' });
    ai.completeText = async () => '{"issues":[]}';
    const stock = path.join(scratch, 'stock'); fs.mkdirSync(stock); fs.writeFileSync(path.join(stock, 'fixture.u64'), 'fixture');
    process.env.NODUS_STOCK_DIR = stock;
    const labels = [[{ role: 'reactant', name: 'ethanol', smiles: 'CCO' }, { role: 'product', name: 'ethanal', smiles: 'CC=O' }]];
    const steps = ['CCO>>CC=O'];
    const calls = [];
    const runner = { invoke: async ({ toolId, input }) => {
      calls.push({ toolId, input });
      if (toolId === 'verify-route') return { artifacts: [{ artifactType: 'route-audit', data: { continuous: true, links: [], blocked: [], steps: [{ index: 0, reaction: steps[0], ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }] } }] };
      return { artifacts: [] };
    } };
    const prose = 'Step 1: Oxidation\nReagents and conditions: PCC, dichloromethane.';
    try {
      const grant = { workIds: new Set(), external: false, web: false };
      const answer = await molecule.appendRouteReportAndDrawings(prose, prose, { runner, evidenceScope: grant }, { steps, labels });
      assert.match(answer, /Route check/);
      // The compatibility check reads the labels, not the audit, so it runs beside it: which tools
      // ran is the contract here, not their order.
      assert.deepEqual(calls.map(call => call.toolId).sort(), ['check-compatibility', 'verify-route']);
      assert.equal(calls.find(call => call.toolId === 'check-compatibility').input.textbookDir, undefined);
      calls.length = 0;
      await molecule.appendRouteReportAndDrawings(prose, prose, { runner }, { steps, labels });
      assert.ok(calls.some(call => call.toolId === 'known-reactions'), 'ORD still runs with an unrestricted grant');
      assert.ok(calls.some(call => call.toolId === 'check-stock'), 'stock still runs with an unrestricted grant');
    } finally {
      registry.capabilityRegistry = originalRegistry; reactions.reactionIndexService = originalService; ai.completeText = originalComplete;
      delete process.env.NODUS_STOCK_DIR;
    }
  });

  test('the opt-in revision pass honours web-off and propagates web cancellation', async () => {
    const pass = load('electron/ai/routeEvidencePass.ts');
    const web = load('electron/websearch/searxngService.ts');
    const originalResolve = molecule.resolveNamedRoute, originalRunner = molecule.chemistryRunner, originalSearch = web.searchSearxng;
    molecule.resolveNamedRoute = async () => ({ legacy: false, labels: [[{ role: 'reactant', name: 'ethanol', smiles: 'CCO' }, { role: 'product', name: 'ethanal', smiles: 'CC=O' }]] });
    molecule.chemistryRunner = () => ({ runner: {}, dispose: async () => {} });
    let searches = 0;
    web.searchSearxng = async () => { searches++; throw Error('web must be off'); };
    const grant = { workIds: new Set(), external: false, web: false };
    try {
      const found = await pass.gatherRouteEvidence('draft', { evidenceScope: grant });
      assert.equal(searches, 0);
      assert.ok(found.every(step => !step.ord && !step.textbook && !step.web));
      const controller = new AbortController();
      web.searchSearxng = async (_query, _options, signal) => { assert.equal(signal, controller.signal); controller.abort(); throw signal.reason; };
      await assert.rejects(pass.gatherRouteEvidence('draft', { evidenceScope: { ...grant, web: true }, signal: controller.signal }), { name: 'AbortError' });
    } finally { molecule.resolveNamedRoute = originalResolve; molecule.chemistryRunner = originalRunner; web.searchSearxng = originalSearch; }
  });

  test('scheme indexes are searched only when every record and template is in scope', async () => {
    const schemes = load('electron/ai/textbookSchemes.ts');
    const index = path.join(scratch, 'schemes');
    fs.mkdirSync(index);
    for (const name of ['exact.tsv.zst', 'products.tsv.zst', 'reaction-smiles.tsv.zst', 'molecules.tsv.zst', 'reactions.faiss.zst', 'reaction-keys.txt.zst', 'retro-templates.tsv.zst']) fs.writeFileSync(path.join(index, name), 'fixture');
    fs.writeFileSync(path.join(index, 'manifest.json'), JSON.stringify({ source: 'nodus.textbook-schemes' }));
    const id = `tb-${'a'.repeat(32)}`;
    const scope = { workIds: new Set(['selected']), external: false, web: false };
    const record = { nodusId: 'selected', book: 'Organic Chemistry selected', page: 1, kind: 'crop' };
    const write = (records, sources) => {
      fs.writeFileSync(path.join(index, 'records.json'), JSON.stringify(records));
      fs.writeFileSync(path.join(index, 'template-sources.json'), JSON.stringify({ 'a>>b': { sources } }));
    };
    process.env.NODUS_SCHEME_INDEX_DIR = index;
    try {
      write({ [id]: record }, [record]);
      assert.equal(schemes.textbookSchemeDirectory(scope), index, 'an entirely selected index stays usable');
      assert.equal(schemes.textbookCitations([id], index, scope).length, 1);
      write({ [id]: record }, [{ ...record, nodusId: 'outside' }]);
      assert.equal(schemes.textbookSchemeDirectory(scope), null, 'an excluded template is enough to refuse the entire index');
      assert.deepEqual(schemes.textbookTemplateCitations(['a>>b'], index, 2, scope), []);
      write({ [id]: { ...record, nodusId: 'outside' } }, [record]);
      assert.equal(schemes.textbookSchemeDirectory(scope), null);
      assert.deepEqual(schemes.textbookCitations([id], index, scope), []);
      write({ [id]: { ...record, nodusId: 'different-vault-book' } }, [record]);
      assert.equal(schemes.textbookSchemeDirectory({ ...scope, workIds: null }), null, 'the active library cannot read another vault index');
      write({ [id]: record }, [{ book: 'Unattributed', page: 1 }]);
      assert.equal(schemes.textbookSchemeDirectory(scope), null, 'unknown provenance fails closed');
      write({ [id]: record }, [record]);
      assert.equal(schemes.textbookSchemeDirectory({ ...scope, workIds: new Set() }), null);
      db.prepare("UPDATE works SET archived=1 WHERE nodus_id='selected'").run();
      assert.equal(schemes.textbookSchemeDirectory(scope), null, 'archiving invalidates the grant without rebuilding the index');
    } finally {
      db.prepare("UPDATE works SET archived=0 WHERE nodus_id='selected'").run();
      delete process.env.NODUS_SCHEME_INDEX_DIR;
    }
  });
}
