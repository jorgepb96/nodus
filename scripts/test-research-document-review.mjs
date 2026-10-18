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
    let proofs = 0, semantics = 0;
    const seen = [];
    const output = await run([part('long-field', Array.from({ length: 17 }, (_, i) => `A supported result number ${i}.`).join(' '))], (_options, input) => {
      if (!input.parts[0].paragraphs) { semantics++; assert.ok(input.parts[0].text.includes('number 16'), 'The semantic veto receives the complete field'); return semantic(input); }
      proofs++; const field = input.parts[0];
      assert.ok(field.paragraphs.length <= 4, 'A long field is proved in bounded sentence batches');
      assert.equal(JSON.parse(field.context).answerContext.length, 17, 'Unverified whole-field context remains available');
      seen.push(...field.paragraphs.map(p => p.index));
      return proof(input);
    });
    assert.equal(output.status, 'verified'); assert.equal(proofs, 5); assert.equal(semantics, 1);
    assert.deepEqual(seen, Array.from({ length: 17 }, (_, i) => i), 'Stable indices cover every span exactly once');
  }
  {
    let revisions = 0;
    const output = await run([part('long-rejected', Array.from({ length: 17 }, (_, i) => `A supported result number ${i}.`).join(' '))], (options, input) => {
      if (options.system.startsWith('Revise')) { revisions++; return { parts: [{ id: 'long-rejected', text: 'A supported result.' }] }; }
      if (!input.parts[0].paragraphs) { assert.equal(revisions, 1, 'A bad proof in a later batch cannot approve the original field'); return semantic(input); }
      const result = proof(input);
      const bad = result.parts[0].claims.find(claim => claim.index === 12);
      if (bad && !revisions) bad.premises[0].fromParagraphs = [12];
      return result;
    });
    assert.equal(output.status, 'verified'); assert.equal(revisions, 1);
    assert.ok(!output.parts[0].text.includes('number'), 'The complete replacement receives fresh proof after a rejected cross-batch dependency');
  }
  {
    const records = [{ ...evidence[0], authors: ['Editor, A. (ed.)'] }];
    const output = await run([part('edited-volume', 'The chapter describes a supported result.')], (_options, input) => {
      assert.equal(input.sources[0].collectiveCredits, true, 'Document proof and semantic review retain explicit editor roles');
      return input.parts[0].paragraphs ? proof(input) : semantic(input);
    }, records);
    assert.equal(output.status, 'verified', 'A volume citation is allowed without claiming that the editor wrote the chapter');
  }
  {
    const prior = context.effort;
    try {
      for (const effort of ['standard', 'off']) {
        context.effort = effort;
        const output = await run([part('reasoning-room-' + effort)], (options, input) => {
          const visible = input.parts[0].paragraphs ? 8000 : 1800;
          if (effort === 'standard' && !input.parts[0].paragraphs) assert.ok(options.maxTokens >= visible + 16_384, 'Only the final semantic veto enables bounded reasoning by default');
          else assert.equal(options.maxTokens, visible, 'Ordinary proof and explicit off do not acquire a reasoning allowance');
          return input.parts[0].paragraphs ? proof(input) : semantic(input);
        });
        assert.equal(output.status, 'verified');
      }
    } finally { context.effort = prior; }
  }
  {
    let firstProof = true;
    const output = await run([part('compound', 'A supported result. A different, unsupported causal claim.')], (options, input) => {
      if (options.system.startsWith('Revise')) return { parts: [{ id: 'compound', text: 'The source documents a supported result.' }] };
      if (!input.parts[0].paragraphs) return semantic(input);
      const result = proof(input);
      if (firstProof) {
        firstProof = false;
        assert.equal(input.parts[0].paragraphs.length, 2, 'Each sentence requires its own proof, even inside one paragraph');
        result.parts[0].claims[1].supported = false;
        result.parts[0].claims[1].unsupportedParts = ['The source does not establish this cause.'];
        result.parts[0].claims[1].premises[0].entailed = false;
      }
      return result;
    });
    assert.equal(output.status, 'verified');
    assert.ok(!output.parts[0].text.includes('unsupported causal'), 'The full field must be revised and rechecked');
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
    const output = await run([part('unavailable')], () => { throw Object.assign(new Error('Provider failure'), { code: null }); });
    assert.equal(output.technicalFailure, 'verification_unavailable', 'A null provider code is not a diagnostic or a budget reason');
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
    for (const authoredKind of ['user-note', 'generated-report']) {
      scope.documents.push({ id: 'authored', workId: 'w1', title: 'Saved note/report', authors: [], year: null, origin: { kind: 'nodus', id: 'authored' }, authoredKind });
      try {
        const output = await run([part('authored-fact')], (options, input) => {
          if (options.system.startsWith('Revise')) return { parts: [{ id: 'authored-fact', text: 'An independently established fact.' }] };
          assert.equal(input.sources[0].attributionOnly, true, 'Indexing a saved note/report cannot turn it into independent documentary evidence');
          return proof(input);
        });
        assert.equal(output.status, 'limited', 'A fact verdict cannot launder authored interpretations');
      } finally { scope.documents.pop(); }
    }
  }
  {
    let calls = 0;
    const output = await run([part('field')], (options, input) => {
      calls++;
      if (options.system.startsWith('Revise')) return { parts: [{ id: 'field', text: 'A still unverified assertion.' }] };
      const value = proof(input); value.parts[0].claims[0].premises[0].evidence[0].id = 'invented'; return value;
    });
    assert.ok(calls > 1); assert.equal(output.status, 'limited'); assert.equal(output.parts[0].text, '');
    assert.equal(output.technicalFailure, undefined, 'A forged source never passes, but it is a local unverified proof rather than a whole-lesson outage');
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
      if (parts.some(part => part.id.includes(':citation:'))) {
        assert.equal(parts.find(part => part.id.includes(':citation:')).strictEvidence, true);
        assert.ok(!parts.some(part => part.id.startsWith('station:1:')), 'Optional review never spends on a rejected station');
        assert.equal(JSON.parse(parts.find(part => part.id === 'overview').context).retainedOutline.length, 1, 'Orientation is scoped to the retained lesson');
      }
      return { status: 'limited', parts: parts.map(part => ({ id: part.id, text: part.id === 'station:1:synthesis' || part.id.endsWith('quiz:0') ? '' : part.text,
        status: part.id === 'station:1:synthesis' || part.id.endsWith('quiz:0') ? 'limited' : 'verified', claims: [{ sentence: part.text, kind: 'attributed', status: 'supported', evidence: [{ id: 'p1', quote: 'A sufficiently long literal source statement.' }], reason: 'fixture' }], issues: [] })) };
    };
    const station = id => ({ id, title: 'Station', question: 'What does the source establish?', context: 'Context.', synthesis: 'Lesson.', ideaIds: ['i1'],
      citations: [{ passageId: 'p1', text: 'A sufficiently long literal source statement.', whyItMatters: 'Relevance.', commentary: 'Meaning.' }], positions: [], takeaways: ['A takeaway.'],
      quiz: [{ id: 'q-' + id, kind: 'choice', question: 'Which?', options: ['a', 'b'], correctIndex: 0, explanation: 'Supported explanation.', expected: '', ideaIds: [] }] });
    const plan = { topic: 'Topic', overview: 'Overview.', language: 'es', stations: [station('s1'), station('s2')], keyTerms: [], contrasts: { authors: [], rows: [] },
      exam: { questions: [], feynman: 'Explain this.' }, ideaIndex: [{ id: 'i1' }], stats: {}, stoppedReason: null };
    const result = await load('electron/ai/immersionVerification.ts').verifyImmersionPlan(plan, model);
    assert.equal(result.stations.length, 1); assert.equal(result.stations[0].id, 's1');
    assert.equal(result.stations[0].quiz.length, 0, 'An unchecked correct answer never remains in a quiz');
    assert.equal(result.stats.stations, 1); assert.equal(result.stats.quizQuestions, 0); assert.equal(result.stats.citations, 1);
    assert.ok(!result.stations[0].synthesis.includes('No he podido'), 'One top-level limitation replaces repeated field boilerplate');
    reviewer.reviewResearchDocument = original;
  }

  {
    const source = { ...evidence[0], id: 'documentary:' + 'a'.repeat(64) + ':' + 'b'.repeat(64) + ':14', citation: 'nodus://passage/' + encodeURIComponent('documentary:' + 'a'.repeat(64) + ':' + 'b'.repeat(64) + ':14') };
    let rewrite = false;
    const output = await run([part('bound-field', 'A supported result with an overreach.')], (options, input) => {
      if (options.system.startsWith('Revise')) {
        rewrite = true;
        assert.equal(input.sources[0].id, 'source-1');
        assert.equal(input.sources[0].citation, 'nodus://passage/nr-1');
        return { parts: [{ id: 'bound-field', text: 'The source documents a specific supported result [Author](nodus://passage/nr-1).' }] };
      }
      if (!input.parts[0].paragraphs) return semantic(input);
      const result = proof(input);
      if (!rewrite) { result.parts[0].claims[0].supported = false; result.parts[0].claims[0].unsupportedParts = ['Remove overreach']; }
      return result;
    }, [source]);
    assert.equal(output.status, 'verified');
    assert.ok(output.parts[0].text.includes('](' + source.citation + ')'), 'Only the original granted destination survives the checked rewrite');
    assert.ok(!output.parts[0].text.includes('nr-1'));
  }
  {
    const { researchWriterCitationTransport } = load('shared/researchClaimAudit.ts');
    const sources = [{ id: 'p1', citation: 'nodus://passage/nr-1', text: 'Verbatim text', label: 'Original' }, { id: 'p2', citation: 'nodus://passage/opaque%3Aidentity', text: 'Second source', label: 'Second' }];
    const transport = researchWriterCitationTransport(sources);
    const text = '[Original](nodus://passage/nr-1) and [Second](nodus://passage/opaque%3Aidentity).';
    assert.deepEqual(transport.restore(transport.project(text)), text);
    assert.equal(transport.sources[0].citation, 'nodus://passage/_nr-1', 'A real source identity cannot collide with a request-local alias');
    assert.equal(transport.restore('[Unknown](nodus://passage/_nr-99)'), '[Unknown](nodus://passage/_nr-99)', 'Unknown aliases never resolve to guessed sources');
    assert.equal(transport.sources[0].text, sources[0].text, 'The source excerpt is never rewritten by citation transport');
  }

  {
    const original = { ...model };
    Object.assign(model, { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017' });
    try {
      const output = await run([part('closed-source')], (options, input) => {
        if (input.parts[0].paragraphs) {
          const idSchema = options.responseSchema.schema.properties.parts.properties['closed-source'].properties.claims.properties.p0.properties.premises.items.properties.evidence.items.properties.id;
          assert.deepEqual(idSchema.enum, input.parts[0].sourceIds, 'Supported native decoders constrain each field to its own source aliases');
        }
        const value = input.parts[0].paragraphs ? proof(input) : semantic(input);
        return { parts: Object.fromEntries(value.parts.map(({ id, claims, ...field }) => [id, { ...field, ...(claims ? { claims: Object.fromEntries(claims.map(({ index, ...claim }) => ['p' + index, claim])) } : {}) }])) };
      });
      assert.equal(output.status, 'verified');
    } finally { Object.assign(model, original); }
  }
  {
    let proofCalls = 0;
    await run([part('large-overview', Array(16).fill('A supported result.').join(' ')), part('short-term')], (_options, input) => {
      if (input.parts[0].paragraphs) { proofCalls++; assert.equal(input.parts.length, 1, 'A long single paragraph consumes its actual sentence-proof budget'); }
      return input.parts[0].paragraphs ? proof(input) : semantic(input);
    });
    assert.equal(proofCalls, 5, 'Four bounded long-field batches plus one independent short-field proof');
  }

  {
    let corrected = false;
    const output = await run([part('local-bad-proof'), part('unrelated-good-field')], (options, input) => {
      if (options.system.startsWith('Revise')) { corrected = true; return { parts: input.parts.map(item => ({ id: item.id, text: 'A supported result.' })) }; }
      if (!input.parts[0].paragraphs) return semantic(input);
      const value = proof(input);
      if (!corrected) value.parts.find(item => item.id === 'local-bad-proof').claims[0].premises[0].fromParagraphs = [0];
      return value;
    });
    assert.equal(output.status, 'verified'); assert.equal(output.technicalFailure, undefined, 'A self-dependent proof is rejected locally, revised and rechecked without cancelling unrelated fields');
  }

  {
    let reconstructions = 0;
    const output = await run([part('core-rebuild', 'A supported result. A rejected opening.')], (options, input) => {
      if (options.system.startsWith('Revise')) {
        const field = input.parts[0];
        if (field.verifiedCore) { reconstructions++; assert.equal(field.text, undefined, 'The rejected draft cannot prime core reconstruction'); assert.ok(field.verifiedCore.length); return { parts: [{ id: field.id, text: 'A supported result.' }] }; }
        return { parts: [{ id: field.id, text: 'A supported result. A rejected opening.' }] };
      }
      if (!input.parts[0].paragraphs) return semantic(input);
      const value = proof(input), bad = value.parts[0].claims[1];
      if (bad) { bad.supported = false; bad.unsupportedParts = ['Rejected opening']; }
      return value;
    });
    assert.equal(output.status, 'verified'); assert.equal(reconstructions, 1);
  }
  {
    const previousObjective = context.objective; context.objective = 'Copia una cita literal y explica el resultado.';
    try {
      let revisions = 0;
      const wrong = 'A supported result [Author](nodus://passage/p1). Afirma «a completely invented quotation» [Author](nodus://passage/p1).';
      const output = await run([part('literal-recovery', wrong)], (options, input) => {
        if (options.system.startsWith('Revise')) {
          revisions++;
          return { parts: [{ id: 'literal-recovery', text: revisions === 4 ? 'A supported result [Author](nodus://passage/p1). Afirma «a specific supported result in its own context» [Author](nodus://passage/p1).' : wrong }] };
        }
        return input.parts[0].paragraphs ? proof(input) : semantic(input);
      });
      assert.equal(output.status, 'verified'); assert.equal(revisions, 4, 'Only a remaining literal-binding failure receives one final whole-field repair');
      assert.ok(!output.parts[0].text.includes('invented quotation'));
    } finally { context.objective = previousObjective; }
  }
  console.log('Document review: batched proofs, independent semantic veto, complete revisions, exact-source comments, literal evidence, stable IDs and technical-stop retention passed.');
  db.close();
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
