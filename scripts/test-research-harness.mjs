import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-harness')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-harness-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in harness fixtures'); };
try {
  const { ResearchAgenda } = load('shared/researchHarness.ts');
  const { validResearchAction } = load('shared/researchActions.ts');
  const agenda = new ResearchAgenda('Compare the evidence');
  const first = agenda.enqueue({ action: 'search', query: 'First question' }, 'How much?', 1);
  agenda.enqueue({ action: 'search', query: '  FIRST   question ' }, 'How much?', 3);
  assert.equal(agenda.tasks.length, 1); assert.equal(agenda.next().priority, 3);
  const second = agenda.enqueue({ action: 'search', query: 'Other source' }, 'Independent evidence?', 2);
  agenda.complete(first, []); agenda.complete(second, []);
  assert.equal(agenda.stagnant, 2);
  agenda.assess([{ question: 'How much?', status: 'supported', evidenceIds: ['invented'] }], new Set());
  assert.equal(agenda.questions[0].status, 'partial'); assert.equal(agenda.canFinish(), false);
  agenda.assess(agenda.questions.map(q => ({ ...q, status: 'supported', evidenceIds: ['actual'] })), new Set(['actual']));
  assert.equal(agenda.canFinish(), true);

  const unknownCount = agenda.questions.length;
  agenda.assess([{ question: 'A fabricated new objective', status: 'supported', evidenceIds: ['actual'] }], new Set(['actual']));
  assert.equal(agenda.questions.length, unknownCount, 'Coverage cannot invent an agenda question or duplicate the root');
  const closing = new ResearchAgenda('Root');
  const found = closing.enqueue({ action: 'search', query: 'evidence' }, 'Facet');
  const pending = closing.enqueue({ action: 'search', query: 'untried' }, 'Other facet');
  closing.complete(found, ['authorized']);
  assert.equal(closing.questions[0].status, 'partial', 'Retrieved evidence is progress, not an automatic proof of the answer');
  closing.finalize('diminishing_returns');
  assert.equal(found.status, 'completed'); assert.equal(pending.status, 'deferred');
  assert.ok(closing.questions.every(question => question.status !== 'pending'));
  assert.equal(closing.questions[0].status, 'partial'); assert.equal(closing.questions[1].status, 'unresolved');

  assert.equal(validResearchAction({ action: 'enqueue', queries: [{ question: 'Why?', query: 'new evidence', priority: 3 }] }), false);
  assert.equal(validResearchAction({ action: 'enqueue', queries: [{ question: 'Why?', query: 'new evidence', priority: 3 }] }, false, false, true), true);
  assert.equal(validResearchAction({ action: 'finish', reason: 'sufficient', coverage: [{ question: 'Why?', status: 'supported', evidenceIds: ['p1'] }] }, false, false, true), true);
  assert.equal(validResearchAction({ action: 'enqueue', queries: [{ question: 'Why?', query: 'new evidence', priority: 3, command: 'touch file' }] }, false, false, true), false);

  const db = load('electron/db/database.ts').getDb();
  const { SCHEMA_VERSION, migrations } = load('electron/db/migrations.ts');
  assert.equal(SCHEMA_VERSION, Math.max(...migrations.map(migration => migration.version)), 'The declared schema must include the harness migration');
  const chats = load('electron/db/chatRepo.ts');
  const conversation = chats.createConversation({ title: 'Harness recovery' });
  const { getActiveVault } = load('electron/vaults/vaultRegistry.ts');
  const vaultId = getActiveVault().id;
  const scope = { id: 'scope-fixture', vaultId, notebookId: null, notebookRevision: null, documents: [], resolvedAt: '2026-10-18', permissionFingerprint: 'permissions', changes: { added: [], removed: [] } };
  const context = { mode: 'chat', vaultId, scopeId: scope.id, notebookId: null, objective: 'Compare the evidence', model: null, effort: 'standard', capabilities: { ideas: true, indexed: true, documents: true, web: false, attachments: [], skills: [], restricted: true } };
  const { withResearchHarness, currentResearchHarness, interruptResearchRun } = load('electron/ai/researchHarnessRuntime.ts');
  const runs = load('electron/db/researchRunsRepo.ts');
  const request = { conversationId: conversation.id };
  const input = { request, context, scope, validate: () => {} };
  let id, calls = 0;
  await assert.rejects(() => withResearchHarness(input, async signal => {
    const h = currentResearchHarness(); id = h.record.summary.id;
    await h.stage('completed-reading', { page: 1 }, async () => { calls++; h.reserveModelCall(); return { text: 'Durable evidence' }; });
    const task = h.agenda.enqueue({ action: 'search', query: 'Next step' }); task.status = 'running'; h.persist();
    interruptResearchRun(id); signal.throwIfAborted();
  }), /research_run_paused/);
  assert.equal(runs.getResearchRun(id).summary.status, 'paused');
  assert.equal(runs.getResearchRun(id).summary.usage.modelCalls, 1);
  const output = await withResearchHarness({ ...input, request: { ...request, runId: id } }, async () => {
    const h = currentResearchHarness();
    assert.equal(h.agenda.next().status, 'pending', 'a partially executed task is resumable');
    const reading = await h.stage('completed-reading', { page: 1 }, async () => { calls++; return {}; });
    assert.equal(reading.text, 'Durable evidence');
    return { answer: 'Done', stats: {} };
  });
  assert.equal(calls, 1, 'completed phases do not spend again after resume');
  assert.equal(output.researchRun.status, 'completed');
  assert.equal(output.stats.researchRun.id, id);
  const again = await withResearchHarness({ ...input, request: { ...request, runId: id } }, async () => { throw new Error('completed run must not execute'); });
  assert.equal(again.answer, 'Done');
  await assert.rejects(() => withResearchHarness({ ...input, request: { conversationId: 'other', runId: id } }, async () => ({})), /not_authorized/);
  await assert.rejects(() => withResearchHarness({ ...input, context: { ...context, scopeId: 'changed' }, request: { ...request, runId: id } }, async () => ({})), /context_changed/);
  assert.equal(runs.getResearchRun(id).summary.status, 'completed', 'a rejected replay does not rewrite a completed execution');
  let writes = 0;
  const retryInput = { ...input, request: { ...request, fixture: 'technical-review' } };
  const incomplete = await withResearchHarness(retryInput, async () => {
    const h = currentResearchHarness();
    await h.stage('writer', {}, async () => { writes++; return 'Preserved draft'; });
    h.record.checkpoint.documentReview = { technicalFailure: 'output_truncated' };
    h.record.checkpoint.validationLimited = true;
    return { answer: '' };
  });
  assert.equal(incomplete.researchRun.status, 'failed');
  // Compatibility with earlier preview checkpoints that completed incorrectly.
  const old = runs.getResearchRun(incomplete.researchRun.id); old.summary.status = 'completed'; runs.saveResearchRun(old);
  const recovered = await withResearchHarness({ ...retryInput, request: { ...retryInput.request, runId: incomplete.researchRun.id } }, async () => {
    const h = currentResearchHarness();
    const answer = await h.stage('writer', {}, async () => { writes++; return 'New draft'; });
    h.record.checkpoint.documentReview = { status: 'verified' };
    h.record.checkpoint.validationLimited = false;
    return { answer };
  });
  assert.equal(recovered.answer, 'Preserved draft'); assert.equal(writes, 1);
  assert.equal(recovered.researchRun.status, 'completed', 'A technical verification failure retries without regenerating completed stages');

  {
    let checks = 0;
    const budgetInput = { ...input, request: { ...request, fixture: 'chat-review-budget' } };
    const stopped = await withResearchHarness(budgetInput, async () => {
      const h = currentResearchHarness(); h.reserveModelCall();
      return h.stage('coherent-answer-review-fixture', {}, async () => {
        checks++; h.record.checkpoint.validationLimited = true;
        h.record.checkpoint.answerReview = { status: 'limited', reviews: [{ attempts: [{ issues: ['verification_unavailable'], notes: ['budget_exhausted'] }] }] };
        h.record.summary.stopReason = 'budget'; return { answer: 'Limited' };
      });
    });
    assert.equal(stopped.researchRun.status, 'failed'); assert.equal(stopped.researchRun.stopReason, 'budget');
    const continued = await withResearchHarness({ ...budgetInput, request: { ...budgetInput.request, runId: stopped.researchRun.id } }, async () => {
      const h = currentResearchHarness(); assert.equal(h.record.summary.usage.modelCalls, 1, 'Continuation never renews consumed model allowance');
      return h.stage('coherent-answer-review-fixture', {}, async () => {
        checks++; h.reserveModelCall(); h.record.checkpoint.validationLimited = false;
        h.record.checkpoint.answerReview = { status: 'verified' }; return { answer: 'Verified after credit became available' };
      });
    });
    assert.equal(checks, 2, 'An unavailable review cannot freeze a cached fallback forever');
    assert.equal(continued.researchRun.status, 'completed'); assert.equal(continued.researchRun.usage.modelCalls, 2);
  }
  chats.deleteConversation(conversation.id);
  assert.equal(runs.getResearchRun(id), null, 'owner deletion removes checkpoints');

  let revoked = false, revokedId;
  await assert.rejects(() => withResearchHarness({ ...input, request: {}, validate: () => { if (revoked) throw new Error('research_scope_changed'); } }, async () => {
    const h = currentResearchHarness(); revokedId = h.record.summary.id;
    await h.stage('authorized-read', {}, async () => 'authorized text');
    revoked = true;
    await h.stage('revoked-read', {}, async () => { throw new Error('must not read revoked material'); });
    return {};
  }), /research_scope_changed/);
  assert.equal(runs.getResearchRun(revokedId).summary.status, 'paused');
  assert.equal(runs.getResearchRun(revokedId).summary.stopReason, 'context_changed');
  let cappedId;
  await assert.rejects(() => withResearchHarness({ ...input, request: {} }, async () => {
    const h = currentResearchHarness(); cappedId = h.record.summary.id;
    for (let i = 0; i < 33; i++) h.reserveModelCall();
    return {};
  }), /budget_exhausted/);
  assert.equal(runs.getResearchRun(cappedId).summary.usage.modelCalls, 32);
  assert.equal(runs.getResearchRun(cappedId).summary.stopReason, 'budget');

  const { decideResearchVerdict } = load('shared/researchClaimAudit.ts');
  const quoted = 'The surface was twenty-three units.';
  const source = { id: 'attachment', text: quoted, label: 'Evidence', citation: '', attributionOnly: true };
  const verdict = { index: 0, kind: 'fact', supported: true, explicitInference: false, unsupportedParts: [], reason: '',
    premises: [{ text: quoted, type: 'fact', entailed: true, evidence: [{ id: source.id, quote: quoted }], from: [] }] };
  assert.equal(decideResearchVerdict(quoted, verdict, [source]).valid, false, 'an interpretation cannot independently corroborate a fact');
  verdict.kind = 'attributed'; verdict.premises[0].type = 'attribution';
  assert.equal(decideResearchVerdict(quoted, verdict, [source]).valid, true);

  // The public continuation service replaces a partial assistant answer once,
  // and must preserve a new user turn arriving while the model is working.
  const continuationChat = chats.createConversation({ title: 'Continue latest turn' });
  const userTurn = { id: 'user-fixture', role: 'user', content: 'Compare evidence' };
  chats.saveMessages(continuationChat.id, [userTurn, { id: 'partial-fixture', role: 'assistant', content: 'Partial' }]);
  let continuationId;
  await assert.rejects(() => withResearchHarness({ ...input, request: { conversationId: continuationChat.id, messages: [userTurn] } }, async signal => {
    continuationId = currentResearchHarness().record.summary.id;
    interruptResearchRun(continuationId); signal.throwIfAborted(); return {};
  }), /research_run_paused/);
  const assistant = load('electron/ai/researchAssistant.ts');
  const previousStream = assistant.streamResearchChat;
  assistant.streamResearchChat = async () => ({ answer: 'Completed answer', stats: {} });
  const controls = load('electron/ai/researchHarnessControls.ts');
  await controls.resumeResearchRun(continuationId);
  await controls.resumeResearchRun(continuationId);
  assert.equal(chats.getConversation(continuationChat.id).messages.length, 2, 'continuation does not duplicate the assistant message');
  assert.equal(chats.getConversation(continuationChat.id).messages.at(-1).content, 'Completed answer');
  assistant.streamResearchChat = async () => {
    chats.saveMessages(continuationChat.id, [...chats.getConversation(continuationChat.id).messages, { id: 'new-user', role: 'user', content: 'A new question' }]);
    return { answer: 'Stale answer', stats: {} };
  };
  await assert.rejects(() => controls.resumeResearchRun(continuationId), /context_changed/);
  assert.equal(chats.getConversation(continuationChat.id).messages.at(-1).id, 'new-user');
  interruptResearchRun(continuationId, true);
  await assert.rejects(() => controls.resumeResearchRun(continuationId), /cancelled/);
  assistant.streamResearchChat = previousStream;
  chats.deleteConversation(continuationChat.id);

  const { ResearchRetrievalBudget } = load('shared/researchRetrievalBudget.ts');
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const budget = new ResearchRetrievalBudget(RETRIEVAL_PRESETS.deep);
  budget.phaseRoundLimit = 2;
  assert.ok(budget.nextRound()); assert.ok(budget.nextRound()); assert.equal(budget.nextRound(), false);
  budget.phaseRoundLimit = Infinity;
  assert.ok(budget.nextRound(), 'discovery leaves the reserved rounds to later sections');

  // Drive the real shared supervisor: it must see web findings, queue a new query,
  // execute it, then justify its stop using the resulting evidence IDs.
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('harness-work','harness-work','Measured evidence','[]','book','text')").run();
  const realScope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();

  const { researchHarnessContext } = load('electron/ai/researchHarnessContext.ts');
  const selected = { layers: { ideas: true, documents: true, indexed: true, web: false }, themes: true };
  const contextRequest = { messages: [{ role: 'user', content: 'Compare the sources' }], selection: selected, model: { provider: 'deepseek', model: 'fixture' }, skillIds: ['selected-skill'] };
  const selectedContext = researchHarnessContext('chat', contextRequest, realScope);
  const changedContext = researchHarnessContext('chat', { ...contextRequest, selection: { ...selected, themes: false } }, realScope);
  assert.notEqual(selectedContext.policyKey, changedContext.policyKey, 'A context toggle invalidates old stages even when the three source layers remain the same');
  selected.themes = false;
  assert.equal(selectedContext.options.selection.themes, true, 'The agent receives an immutable snapshot of selected options');
  assert.deepEqual(selectedContext.options.skillIds, ['selected-skill']);

  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.getResearchPreparationInventory = () => ({ documents: realScope.documents.map(doc => ({ id: doc.id, preparation: { text: 'available', lexical: 'ready', embeddings: 'ready' } })) });
  preparation.retrieveSharedDocumentaryEvidence = async (scope, query) => ({ evidence: ['new measured evidence', 'later complementary facet'].includes(query) ? [{
    id: `${'e'.repeat(64)}:0`, documentId: realScope.documents[0].id, workId: 'harness-work', revision: realScope.documents[0].revision,
    text: query === 'later complementary facet' ? 'New facet evidence. '.repeat(160) : 'The measured surface was twenty-three units.', locator: { pageNumber: 1, pageLabel: '1', sourceRef: null }, provenance: 'source', limitations: [],
  }] : [], traversal: { rounds: 1, candidates: 1, partial: false } });
  const ai = load('electron/ai/aiClient.ts'); ai.embed = async () => null;
  let decisions = 0;
  ai.completeJson = async (options, guard) => {
    const payload = JSON.parse(options.user);
    if (Array.isArray(payload.paragraphs)) throw new Error('Verifier unavailable in supervisor fixture');
    decisions++;
    const webEvidence = payload.evidence.find(p => p.text.includes('external finding'));
    assert.ok(webEvidence && /^e\d+$/.test(webEvidence.id), 'web text informs the next decision through a bound short ID');
    assert.equal(payload.context.capabilities.web, true);
    const decision = decisions === 1 ? { action: 'enqueue', queries: [{ question: 'How much?', query: 'new measured evidence', priority: 3 }] }
      : { action: 'finish', reason: 'sufficient', coverage: payload.agenda.map(q => ({ ...q, status: 'supported', evidenceIds: [webEvidence.id] })) };
    assert.ok(guard(decision)); return decision;
  };
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  await withResearchHarness({ request: {}, context: { ...context, scopeId: realScope.id }, scope: realScope, validate: () => {} }, async signal => {
    const run = new ResearchCorpusRun(realScope, { ...RETRIEVAL_PRESETS.deep, evidenceTokens: 16000 }, signal);
    run.agent = { plan: { authors: [] } };
    assert.equal(run.budget.accept('opening evidence', 'x'.repeat(8000)), true);
    assert.equal(run.stepAllowance(), 4096);
    await run.retrieve('later complementary facet', 1, run.stepAllowance(), null);
    assert.ok([...run.evidence.values()].some(evidence => evidence.summary === 'New facet evidence. '.repeat(160)), 'Later queries must admit a complete prepared chunk instead of losing the facet to a 2 KB share');
    assert.ok(run.budget.usedEvidenceTokens <= 16000, 'The global allowance never grows');
    return { answer: 'Evidence collected' };
  });
  let interruptedId;
  await assert.rejects(() => withResearchHarness({ ...input, request: {}, context: { ...context, scopeId: realScope.id }, scope: realScope }, async signal => {
    const h = currentResearchHarness(); interruptedId = h.record.summary.id;
    const run = new ResearchCorpusRun(realScope, RETRIEVAL_PRESETS.deep, signal);
    await run.perform({ action: 'search', query: 'interrupted read' }, async () => {
      run.budget.evidenceTokenLimit = 1234;
      run.budget.decisionTokenLimit = 12345;
      run.budget.decisionTokens = 2345;
      run.budget.nextRound(); interruptResearchRun(interruptedId); signal.throwIfAborted();
    });
    return {};
  }), /research_run_paused/);
  await withResearchHarness({ ...input, request: { runId: interruptedId }, context: { ...context, scopeId: realScope.id }, scope: realScope }, async signal => {
    const run = new ResearchCorpusRun(realScope, RETRIEVAL_PRESETS.deep, signal);
    assert.equal(run.budget.rounds, 1, 'an interrupted action retains the round it consumed');
    assert.equal(run.budget.evidenceTokenLimit, 1234, 'continuation cannot enlarge a narrowed allowance');
    assert.equal(run.budget.decisionTokenLimit, 12345, 'continuation also preserves a narrowed decision allowance');
    assert.equal(run.budget.decisionTokens, 2345, 'continuation retains consumed supervisor bytes');
    assert.equal(currentResearchHarness().agenda.next().status, 'pending');
    run.budget.rounds = run.budget.roundLimit;
    const { ResearchWebGrant } = load('electron/ai/researchWebStep.ts');
    const web = new ResearchWebGrant('auto', 'balanced', 'A concrete research question', signal, null, 2000);
    assert.equal(await web.search([], 'fallback', 'fallback', ''), null, 'fallback web cannot bypass the shared round limit');
    assert.equal(web.used, 0, 'an exhausted run starts no external lookup');
    return {};
  });

  const reportOutput = await withResearchHarness({ ...input, request: {}, context: { ...context, mode: 'deep-research', scopeId: realScope.id }, scope: realScope }, async signal => {
    const run = new ResearchCorpusRun(realScope, RETRIEVAL_PRESETS.deep, signal);
    const { repairResearchDraft } = load('electron/ai/researchHarnessVerification.ts');
    const unsupported = 'An unsupported empirical finding is established.';
    assert.notEqual(await repairResearchDraft(unsupported, null, signal), unsupported, 'an empty corpus cannot silently pass unsupported prose');
    run.web = { contextPassages: () => [{ id: 'web-late', title: 'Late finding', site: 'Example', text: 'A finding collected after discovery.', citation: 'nodus://passage/web-late' }] };
    run.syncWebEvidence();
    const section = await run.section({ excludeIdeaIds: [], excludePassageIds: [], limits: { ideas: 2, passages: 2 } }, false);
    assert.equal(section.passages[0].id, 'web-late', 'later web findings reach section writing and auditing');
    assert.equal(section.passages[0].reason, 'web');
    assert.ok(!run.snapshotFromEvidence({ objective: 'test' }).works.some(work => work.id.startsWith('web:')), 'web receipts never become fake local works');
    return { draft: { title: 'Fixture report', brief: { kind: 'deep_research', objective: 'Evidence' }, selection: { workIds: [] },
      draftMarkdown: 'Fixture report.', abstract: '', outline: [], matrix: [], bibliography: [], nextSteps: [], limitations: [], stats: {} } };
  });
  const drafts = load('electron/db/writingDraftsRepo.ts');
  const savedDraft = drafts.saveWritingWorkshopDraft({ draft: reportOutput.draft, model: null });
  assert.equal(drafts.saveWritingWorkshopDraft({ draft: reportOutput.draft, model: null }).id, savedDraft.id, 'replayed report saving is idempotent');
  drafts.deleteWritingWorkshopDraft(savedDraft.id);
  assert.equal(runs.getResearchRun(reportOutput.researchRun.id), null, 'deleting a report removes its run checkpoint');
  const researched = await withResearchHarness({ request: {}, context: { ...context, scopeId: realScope.id, capabilities: { ...context.capabilities, web: true } }, scope: realScope, validate: () => {} }, async signal => {
    const run = new ResearchCorpusRun(realScope, { ...RETRIEVAL_PRESETS.deep, evidenceTokens: 16000 }, signal);
    run.budget.decisionTokenLimit = 128000;
    run.web = { available: true, enabled: true, used: 1, explicit: false, contextPassages: () => [{ id: 'web:known', title: 'External source', text: 'An external finding changes the investigation.', url: 'https://example.com/evidence' }] };
    await run.investigate(context.objective);
    assert.ok(run.evidence.size > 0);
    return { answer: 'Evidence collected' };
  });
  assert.equal(decisions, 2);
  assert.equal(researched.researchRun.stopReason, 'sufficient');
  assert.ok(researched.researchRun.tasks.some(t => t.action.query === 'new measured evidence' && t.status === 'completed'));
  // Malformed decision recovery is bounded and reserves another shared decision;
  // authorization/transport errors must never be turned into blind retries.
  for (const mode of ['recover', 'repeated-invalid', 'auth', 'duplicate-envelope']) {
    let calls = 0;
    ai.completeJson = async (options, guard) => {
      calls++;
      if (mode === 'auth') throw new ai.AiError('Permission refused', false, true, 'auth');
      if (mode === 'repeated-invalid' || mode === 'recover' && calls === 1) throw new ai.AiError('Malformed action', false, false, 'schema_mismatch');
      const payload = JSON.parse(options.user);
      if (mode === 'recover') assert.match(payload.coordinator_note, /previous reply did not satisfy/);
      const decision = { action: 'finish', reason: 'sufficient', coverage: payload.agenda.map(q => ({ ...q, status: 'supported', evidenceIds: [payload.evidence.find(p => p.text.includes('external finding')).id] })) };
      const response = mode === 'duplicate-envelope' ? [decision, structuredClone(decision)] : decision;
      assert.equal(guard(response), true); return response;
    };
    const result = await withResearchHarness({ request: {}, context: { ...context, scopeId: realScope.id, capabilities: { ...context.capabilities, web: true } }, scope: realScope, validate: () => {} }, async signal => {
      const run = new ResearchCorpusRun(realScope, RETRIEVAL_PRESETS.deep, signal);
      run.budget.decisionTokenLimit = 128000;
      run.web = { available: true, enabled: true, used: 1, explicit: false, contextPassages: () => [{ id: 'web:known', title: 'External source', text: 'An external finding.', url: 'https://example.com/evidence' }] };
      await run.investigate(context.objective);
      assert.ok(run.budget.decisionTokens > 0);
      return { answer: 'Evidence collected' };
    });
    assert.equal(calls, ['recover', 'repeated-invalid'].includes(mode) ? 2 : 1, mode);
    assert.equal(result.researchRun.stopReason, ['recover', 'duplicate-envelope'].includes(mode) ? 'sufficient' : 'technical', mode);
  }
  // A refused tool argument executes nothing and can be corrected once. It
  // cannot widen the grant or mark a successfully produced artifact as an outage.
  for (const repeat of [false, true]) {
    let calls = 0, reads = 0;
    ai.completeJson = async (options, guard) => {
      const payload = JSON.parse(options.user);
      if (++calls === 2) assert.match(payload.coordinator_note, /action was refused/);
      const decision = calls === 1 || repeat
        ? { action: 'read', documentId: 'outside-the-grant', operation: { kind: 'pages', from: 1 } }
        : { action: 'finish', reason: 'sufficient', coverage: payload.agenda.map(q => ({ ...q, status: 'supported', evidenceIds: [payload.evidence.find(p => p.text.includes('external finding')).id] })) };
      assert.equal(guard(decision), true); return decision;
    };
    const result = await withResearchHarness({ request: {}, context: { ...context, scopeId: realScope.id, capabilities: { ...context.capabilities, documents: true, web: true } }, scope: realScope, validate() {} }, async signal => {
      const run = new ResearchCorpusRun(realScope, RETRIEVAL_PRESETS.deep, signal);
      run.budget.decisionTokenLimit = 128000;
      run.web = { available: true, enabled: true, used: 1, explicit: false, contextPassages: () => [{ id: 'web:known', title: 'External source', text: 'An external finding.', url: 'https://example.com/evidence' }] };
      run.readDocument = async () => { reads++; throw new Error('Unauthorized read must never execute'); };
      await run.investigate(context.objective);
      return { answer: 'Evidence collected' };
    });
    assert.equal(calls, 2); assert.equal(reads, 0);
    assert.equal(result.researchRun.status, 'completed');
    assert.equal(result.researchRun.stopReason, repeat ? 'diminishing_returns' : 'sufficient');
  }
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  console.log('Research harness: agenda, source-backed coverage, bounded actions, checkpoints, pause/resume, budgets, ownership and deletion passed.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
