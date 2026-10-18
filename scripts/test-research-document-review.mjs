import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-document-review')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-document-review-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('No external network in document review fixtures'); };
try {
  const db = load('electron/db/database.ts').getDb();
  const vaultId = load('electron/vaults/vaultRegistry.ts').getActiveVault().id;
  const runtime = load('electron/ai/researchHarnessRuntime.ts');
  const ai = load('electron/ai/aiClient.ts');
  const reviewer = load('electron/ai/researchDocumentReview.ts');
  const common = load('shared/researchDocumentReview.ts');
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  const scope = { id: 'fixture-scope', vaultId, notebookId: null, documents: [] };
  const context = { mode: 'deep-research', vaultId, scopeId: scope.id, notebookId: null, objective: 'Explain the documented result.', model, effort: 'off', capabilities: { ideas: true, indexed: true, documents: true, web: false, attachments: [], skills: [], restricted: true } };
  const evidence = [{ id: 'p1', nodus_id: 'w1', label: 'Source', authors: ['Author'], year: 2020, summary: 'The source documents a specific supported result in its own context.', citation: 'nodus://passage/p1', reason: 'source' },
    { id: 'p2', nodus_id: 'w2', label: 'Other', authors: ['Other'], year: 2021, summary: 'A different actor promoted a different proposition.', citation: 'nodus://passage/p2', reason: 'source' }];
  const run = async (parts, mock, records = evidence) => runtime.withResearchHarness({ request: {}, context, scope, validate() {} }, async signal => {
    const h = runtime.currentResearchHarness();
    h.corpus = { evidence: new Map(records.map(item => [item.id, item])), scope, ideas: new Map(), catalogHits: new Map(), catalogLookups: [], readDocuments: new Set(),
      researchLog: () => [], coverage: () => ({ limitations: [] }), checkpoint() {} };
    ai.completeJson = async (options, valid) => {
      const value = await mock(options, JSON.parse(options.user));
      if (!valid(value)) throw Object.assign(new Error('Invalid provider schema'), { code: 'schema_mismatch' });
      return value;
    };
    return reviewer.reviewResearchDocument(parts, model, signal);
  });
  const part = (id, text = 'A supported result.', extra = {}) => ({ id, text, remit: 'Explain this one documented result, not the whole investigation.', ...extra });
  const proof = input => ({ parts: input.parts.map(item => ({ id: item.id, coherent: true, relevant: true, complete: true, issues: [], claims: item.paragraphs.map(paragraph => ({
    index: paragraph.index, kind: 'fact', supported: true, explicitInference: false, reason: 'Fixture entailment decision', unsupportedParts: [],
    premises: [{ text: 'A supported result.', type: 'fact', entailed: true, from: [], evidence: [{ id: item.sourceIds[0], quote: input.sources.find(source => source.id === item.sourceIds[0]).quotes[0].key }] }],
  })) })) });
  const semantic = (input, reject = () => false) => ({ parts: input.parts.map(item => ({ id: item.id, supported: !reject(item), issues: reject(item) ? ['A bibliography is not evidence for the current debate.'] : [] })) });
  {
    let calls = 0;
    const output = await run(Array.from({ length: 8 }, (_, i) => part(`field-${i}`)), (_options, input) => { calls++; return input.parts[0].paragraphs ? proof(input) : semantic(input); });
    assert.equal(calls, 2, 'Eight independent fields share proof and semantic requests');
    assert.equal(output.status, 'verified');
    assert.ok(output.parts.every(item => item.text.includes('nodus://passage/p1')), 'The backend binds real links without buying another proof');
  }
  {
    const original = { ...model };
    Object.assign(model, { provider: 'gemini', model: 'gemini-2.5-flash-lite' });
    const output = await run([part('fixed:field')], (options, input) => {
      assert.ok(options.responseSchema, 'Supported providers receive a native schema');
      assert.deepEqual(Object.keys(options.responseSchema.schema.properties.parts.properties), ['fixed:field']);
      const value = input.parts[0].paragraphs ? proof(input) : semantic(input);
      return { parts: Object.fromEntries(value.parts.map(({ id, claims, ...field }) => [id, { ...field, ...(claims ? { claims: Object.fromEntries(claims.map(({ index, ...claim }) => ['p' + index, claim])) } : {}) }])) };
    });
    assert.equal(output.status, 'verified', 'Fixed native object keys decode to the same runtime proof contract');
    Object.assign(model, original);
  }
  {
    let proofs = 0, semantics = 0, rewrites = 0;
    const output = await run([part('body', 'Today the entire debate follows this footnote.')], (options, input) => {
      if (input.parts[0].paragraphs) { proofs++; return proof(input); }
      if (options.system.startsWith('Revise')) { rewrites++; return { parts: [{ id: 'body', text: 'The source documents a supported result.' }] }; }
      semantics++; return semantic(input, item => item.text.includes('entire debate'));
    });
    assert.equal(output.status, 'verified'); assert.equal(rewrites, 1); assert.equal(proofs, 2); assert.equal(semantics, 2);
    assert.ok(!output.parts[0].text.includes('Today'), 'A changed full fragment is independently checked again');
  }
  {
    let calls = 0;
    const output = await run(Array.from({ length: 24 }, (_, i) => part(`field-${i}`)), (_options, input) => {
      calls++; if (calls === 3) throw Object.assign(new Error('Provider unavailable'), { code: 'provider_unavailable' });
      return input.parts[0].paragraphs ? proof(input) : semantic(input);
    });
    assert.equal(calls, 3, 'A technical failure stops all remaining field fan-out');
    assert.equal(output.parts.filter(item => item.status === 'verified').length, 8, 'Already proved fields survive');
    assert.ok(output.parts.filter(item => item.status === 'limited').every(item => !item.text), 'Unchecked fields never become prose or repeated notices');
    assert.equal(output.technicalFailure, 'provider_unavailable');
    assert.equal(output.researchRun.stopReason, 'technical', 'Technical failure cannot be called sufficient coverage');
  }
  {
    let calls = 0;
    const output = await run([part('field')], (_options, input) => {
      calls++; const value = proof(input); value.parts[0].claims[0].premises[0].evidence[0].id = 'invented'; return value;
    });
    assert.equal(calls, 1); assert.equal(output.status, 'limited'); assert.equal(output.parts[0].text, '');
  }
  {
    const selected = reviewer.researchDocumentSources(part('commentary', 'Other actor.', { evidenceIds: ['p1'], strictEvidence: true }), evidence.map(item => ({ ...item, text: item.summary })));
    assert.deepEqual(selected.map(item => item.id), ['p1'], 'An exact-passage commentary cannot borrow another source');
    assert.equal(common.researchExcerptHasProse('* * * ## Book [![Imagen de portada](cover)](book)'), false);
    assert.equal(common.researchExcerptHasProse('The source contains a substantive discussion of how the actor used a policy.'), true);
    const cover = { ...evidence[0], summary: '* * * ## Book [![Imagen de portada](cover)](book)' };
    const output = await run([part('field', 'A supported result.', { evidenceIds: ['p1'], strictEvidence: true })], (options, input) => options.system.startsWith('Revise') ? { parts: [{ id: 'field', text: 'A supported result.' }] } : proof(input), [cover]);
    assert.equal(output.status, 'limited', 'Even a positive model verdict cannot make a cover into substantive evidence');
  }
  {
    let calls = 0;
    const output = await run([part('field')], (_options, input) => {
      calls++; if (calls === 1) throw Object.assign(new Error('Truncated proof'), { code: 'output_truncated' });
      return input.parts[0].paragraphs ? proof(input) : semantic(input);
    });
    assert.equal(output.status, 'verified'); assert.equal(calls, 3, 'One format recovery still requires independent semantic review');
  }
  {
    let revisions = 0;
    const output = await run(Array.from({ length: 17 }, (_, i) => part(`field-${i}`, 'Unsupported wording.')), (options, input) => {
      if (options.system.startsWith('Revise')) {
        revisions++; assert.ok(input.parts.length <= 8, 'Whole-field revisions also respect batch bounds');
        return { parts: input.parts.map(item => ({ id: item.id, text: 'A supported result.' })) };
      }
      return input.parts[0].paragraphs ? proof(input) : semantic(input, item => item.text.includes('Unsupported'));
    });
    assert.equal(revisions, 3); assert.equal(output.status, 'verified');
  }
  {
    let calls = 0;
    const output = await run([part('stable-id')], (options, input) => {
      calls++;
      if (input.parts[0].paragraphs) return proof(input);
      if (options.system.startsWith('Revise')) return { parts: [{ id: 'other-id', text: 'Changed.' }] };
      return semantic(input, () => true);
    });
    assert.equal(calls, 3); assert.equal(output.status, 'limited'); assert.equal(output.parts[0].id, 'stable-id'); assert.equal(output.parts[0].text, '');
  }
  {
    const original = reviewer.reviewResearchDocument;
    reviewer.reviewResearchDocument = async parts => {
      assert.equal(parts.find(part => part.id.includes(':citation:')).strictEvidence, true);
      return { status: 'limited', parts: parts.map(part => ({ id: part.id, text: part.id === 'station:1:synthesis' || part.id.endsWith('quiz:0') ? '' : part.text,
        status: part.id === 'station:1:synthesis' || part.id.endsWith('quiz:0') ? 'limited' : 'verified', claims: [], issues: [] })) };
    };
    const station = id => ({ id, title: 'Station', question: 'What does the source establish?', context: 'Context.', synthesis: 'Lesson.', ideaIds: ['i1'],
      citations: [{ passageId: 'p1', text: 'A sufficiently long literal source statement.', whyItMatters: 'Relevance.', commentary: 'Meaning.' }], positions: [], takeaways: ['A takeaway.'],
      quiz: [{ id: 'q-' + id, kind: 'choice', question: 'Which?', options: ['a', 'b'], correctIndex: 0, explanation: 'Supported explanation.', expected: '', ideaIds: [] }] });
    const plan = { topic: 'Topic', overview: 'Overview.', language: 'es', stations: [station('s1'), station('s2')], keyTerms: [], contrasts: { rows: [] },
      exam: { questions: [], feynman: 'Explain this.' }, ideaIndex: [{ id: 'i1' }], stats: {}, stoppedReason: null };
    const result = await load('electron/ai/immersionVerification.ts').verifyImmersionPlan(plan, model);
    assert.equal(result.stations.length, 1); assert.equal(result.stations[0].id, 's1');
    assert.equal(result.stations[0].quiz.length, 0, 'An unchecked correct answer never remains in a quiz');
    assert.equal(result.stats.stations, 1); assert.equal(result.stats.quizQuestions, 0); assert.equal(result.stats.citations, 1);
    assert.ok(!result.stations[0].synthesis.includes('No he podido'), 'One top-level limitation replaces repeated field boilerplate');
    reviewer.reviewResearchDocument = original;
  }
  console.log('Document review: batched proofs, independent semantic veto, complete revisions, exact-source comments, literal evidence, stable IDs and technical-stop retention passed.');
  db.close();
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
