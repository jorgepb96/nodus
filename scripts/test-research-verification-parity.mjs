// Exercise the real chat service: V1 adds research actions, not response audits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--verification-parity')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-verification-parity-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('No network in verification parity fixture'); };
try {
  const db = load('electron/db/database.ts').getDb();
  db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash)
    VALUES('source','source','Measure source','["Author"]',2020,'book','text','hash')`).run();
  load('electron/db/passagesRepo.ts').replaceWorkPassages('source', 'hash', [{ text: 'Measure: institution A preceded institution B. Their directors were the same person.', pageLabel: '1', embedding: null }]);
  const settings = load('electron/db/settingsRepo.ts');
  settings.updateSettings({ researchWebSearch: 'off', promptLanguage: 'en' });
  const ai = load('electron/ai/aiClient.ts');
  ai.embedQuery = async () => null;
  load('electron/ai/thinkingEffort.ts').thinkingCatalogInfo = async () => undefined;
  load('electron/ai/researchTurnPlanner.ts').planResearchTurn = async () => load('electron/ai/researchTurnPlanner.ts').literalResearchTurnPlan('measure');
  load('electron/ai/documentaryPreparation.ts').retrieveSharedDocumentaryEvidence = async () => ({ evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } });
  const { ResearchCorpusRun, bindAcademicCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  ResearchCorpusRun.prototype.investigate = async function(query) { await this.retrieve(query, 1); };
  const runtime = load('electron/ai/researchHarnessRuntime.ts');
  const chats = load('electron/ai/researchAssistant.ts');
  let writes = 0, audits = 0, additionalCalls = 0, prose = '';
  ai.completeJson = async () => { additionalCalls++; throw new Error('Unexpected extra model review'); };
  ai.completeText = async () => { additionalCalls++; throw new Error('Unexpected extra rewrite'); };
  ai.completeTextStream = async (opts, delta) => {
    writes++;
    const source = JSON.parse(opts.user).contexto_modular_seleccionado.pasajes_relevantes[0];
    assert.ok(source?.citation, 'Real retrieval supplies a receipt-bound citation');
    prose = `The shared director suggests personnel continuity, although it does not establish identical policy [Author, 2020, p. 1](${source.citation}).`;
    delta(prose, 'content'); return prose;
  };
  load('electron/ai/researchChatGrounding.ts').groundResearchChatAnswer = async (answer, context, _question, _model, _language, _signal, options) => {
    audits++; assert.ok(JSON.parse(context).contexto_modular_seleccionado.pasajes_relevantes.length);
    if (options?.structured) return 'A structured answer [Author](nodus://work/source).';
    return answer;
  };
  for (const verification of ['off', 'legacy', 'structured']) for (const harnessVersion of ['legacy', 'v1']) {
    writes = 0; audits = 0; additionalCalls = 0;
    settings.updateSettings({ researchAnswerVerification: verification });
    const deltas = [];
    const response = await chats.streamResearchChat({ harnessVersion, model: { provider: 'deepseek', model: 'deepseek-flash' }, thinkingEffort: 'standard', webSearch: 'off',
      messages: [{ role: 'user', content: 'Compare measure institutions and their continuity.' }],
      selection: { layers: { ideas: false, documents: false, indexed: true }, retrieval: { ...load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep, rounds: 2, passagesPerRound: 8, autoExpand: false } },
    }, (text, kind) => deltas.push({ text, kind }));
    assert.equal(additionalCalls, 0, 'No implicit proof, semantic veto or rewrite');
    assert.equal(audits, verification === 'off' ? 0 : 1, 'Both versions honor exactly the same verification setting');
    assert.equal(writes, verification === 'structured' ? 0 : 1);
    if (verification === 'off') {
      assert.equal(response.answer, prose, 'A cited, qualified inference survives intact');
      assert.ok(deltas.some(d => d.kind === 'content' && d.text === prose), 'Ordinary answers stream without waiting for an unrequested audit');
    }
    if (harnessVersion === 'v1') assert.ok(response.researchRun);
  }
  // Deep Research keeps deterministic source/citation guards without post-hoc
  // model pruning or rewrite loops. Binding starts no model call.
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  await runtime.withResearchHarness({ request: {}, context: { mode: 'deep-research', vaultId: scope.vaultId, scopeId: scope.id, objective: 'Measure', model: null, effort: 'standard', capabilities: {} }, scope, validate() {} }, async () => {
    const marker = async () => 'existing check';
    const deps = bindAcademicCorpusRun({ verifyCitations: marker, reviseSection: marker, auditSectionClaims: marker, auditFinalSummary: marker, judgeSectionRevision: marker, checkCoherence: marker, finalize: marker }, { objective: 'Measure' });
    assert.equal(deps.finalDocumentReview, undefined);
    for (const key of ['verifyCitations', 'reviseSection', 'auditFactualProse', 'auditReportConsistency', 'auditSectionClaims', 'auditPlanCoverage', 'auditFinalSummary', 'judgeSectionRevision', 'reviewReport', 'checkCoherence', 'repairSectionCoverage', 'checkSectionCoverage']) assert.equal(deps[key], undefined);
    assert.equal(await deps.finalize({}), 'existing check', 'Keep the established final writer');
    return {};
  });
  console.log('Verification parity: real Chat dispatch, streaming, inference, optional checks and report wiring passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation?.();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
