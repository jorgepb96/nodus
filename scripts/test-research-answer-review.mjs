import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--answer-review')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-answer-review-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
globalThis.fetch = () => { throw new Error('Network forbidden in review fixtures'); };
try {
  const review = require(path.join(repoRoot, 'shared/researchAnswerReview.ts'));
  const source = { id: 'p1', label: 'Autor, 2011, p. 2', citation: 'nodus://passage/p1', text: 'El relato de viajes se apoya en un pacto factual.' };
  const paragraph = 'El autor afirma que el relato se apoya en un pacto factual [Autor, 2011, p. 2](nodus://passage/p1).';
  const unrelated = { ...source, id: 'p2', citation: 'nodus://passage/p2' };
  const operationSource = { ...source, id: 'operations', citation: '' };
  const catalogueRecord = { ...source, id: 'record:w1', title: 'Un estudio sobre relatos de viaje', citation: 'nodus://work/w1' };
  assert.equal(review.researchAnswerCatalogueCitationIssues('Localicé *Un estudio sobre relatos de viaje* (2011).', [catalogueRecord]).length, 1);
  assert.deepEqual(review.researchAnswerCatalogueCitationIssues('Localicé [el estudio](nodus://work/w1).', [catalogueRecord]), []);
  assert.equal(review.researchAnswerCatalogueCitationIssues('Un estudio sobre relatos de viaje; [otra obra](nodus://work/w2).', [catalogueRecord]).length, 1, 'An unrelated link does not make the named record navigable');
  assert.deepEqual(review.researchAnswerCatalogueCitationIssues('Un estudio sobre relatos de viaje [pasaje](nodus://passage/p1).', [{ ...catalogueRecord, workId: 'w1' }, { ...source, workId: 'w1', citation: 'nodus://passage/p1' }]), []);
  assert.deepEqual(review.researchAnswerCatalogueCitationIssues('No encontré la publicación ficticia solicitada.', [catalogueRecord]), [], 'A zero-result answer never needs an invented work link');
  assert.deepEqual(review.researchAnswerCatalogueCitationIssues('Un estudio sobre relatos de viaje', [catalogueRecord, { ...catalogueRecord, id: 'record:w2', citation: 'nodus://work/w2' }]), [], 'Ambiguous record identities are not guessed');
  assert.deepEqual(review.researchAnswerProofSources(paragraph, [source, unrelated, operationSource]), [source, operationSource]);
  assert.deepEqual(review.researchAnswerProofSources('Draft without links', [source, unrelated]), [source, unrelated], 'Missing citations can still recover from the frozen evidence');
  const groups = review.researchAnswerReviewSourceGroups(paragraph, [source, unrelated, operationSource]);
  assert.deepEqual(groups.sources, [source, operationSource]);
  assert.deepEqual(groups.coverageSources, [unrelated], 'An uncited counterexample must remain visible for coverage and absence checks');
  assert.deepEqual(groups.cited, [source], 'Coverage evidence never becomes support for a different attached citation');
  const translated = 'Urry sostiene «no hay una única mirada turística» [Urry](nodus://passage/p1).';
  const english = { ...source, text: 'There is no single tourist gaze as such.' };
  assert.equal(review.canonicalResearchUnrequestedQuotes(translated, [english], 'Explica la mirada'), translated.replace('«', '').replace('»', ''));
  assert.equal(review.canonicalResearchUnrequestedQuotes(translated, [english], 'Copia una cita literal'), translated, 'Explicit literal requests must still fail the nonliteral quote gate');
  assert.equal(review.canonicalResearchUnrequestedQuotes(translated, [english], 'Explica con citas Nodus'), translated.replace('«', '').replace('»', ''), 'Bibliographic citation instructions do not demand invented verbatim quotes');
  const wrongBound = 'Dice «There is no single tourist gaze as such» [Other](nodus://passage/other).';
  assert.equal(review.canonicalResearchUnrequestedQuotes(wrongBound, [english, { ...english, id: 'other', citation: 'nodus://passage/other', text: 'An unrelated statement.' }], 'Explica con citas Nodus'), wrongBound.replace('«', '').replace('»', ''), 'An unrequested quote cannot borrow literal wording from a source attached elsewhere; its paraphrase must still be proved');
  const literal = 'Dice «There is no single tourist gaze as such».';
  assert.equal(review.canonicalResearchUnrequestedQuotes(literal, [english], 'Explica la mirada'), literal);
  const labelledTranslation = 'Traducción: «no hay una única mirada turística».';
  assert.equal(review.canonicalResearchUnrequestedQuotes(labelledTranslation, [english], 'Explica'), labelledTranslation);
  const verdict = { index: 0, kind: 'attributed', premises: [{ text: 'El autor afirma el pacto factual', type: 'attribution', entailed: true, evidence: [{ id: 'p1', quote: source.text }], from: [] }], unsupportedParts: [], explicitInference: false, supported: true, reason: 'Literal support' };
  const envelope = claims => ({ claims, coherent: true, relevant: true, complete: true, issues: [] });
  const check = (text, claims = [verdict]) => review.assessResearchAnswer(text, [source], envelope(claims), 'Explica el relato');
  assert.equal(check(paragraph).accepted, true);
  const unsupportedParaphrase = structuredClone(verdict); unsupportedParaphrase.premises[0].entailed = false;
  assert.equal(check(review.canonicalResearchUnrequestedQuotes('Afirma «un resultado ajeno al texto» [Autor](nodus://passage/p1).', [source], 'Explica'), [unsupportedParaphrase]).accepted, false, 'Removing unrequested quotes never turns unsupported content into approval');
  assert.equal(review.validResearchAnswerCoverage(envelope([verdict]), 1), true);
  assert.equal(review.validResearchAnswerCoverage(envelope([verdict]), 1, new Set(['p1'])), true);
  assert.equal(review.validResearchAnswerCoverage(envelope([verdict]), 1, new Set(['other'])), false, 'A guessed alias outside the actual proof input cannot borrow frozen evidence');
  assert.equal(review.validResearchAnswerCoverage(envelope([{ ...verdict, supported: undefined }]), 1), false);
  assert.equal(review.validResearchAnswerCoverage(envelope([verdict, verdict]), 2), false);
  const omittedLocalDependencies = structuredClone(verdict); delete omittedLocalDependencies.premises[0].from;
  // The proof normalizer has always defined an omitted local dependency list as [].
  // The transport guard must not force a paid semantic retry for that same shape.
  assert.equal(review.validResearchAnswerCoverage(envelope([omittedLocalDependencies]), 1), true);
  assert.equal(check(paragraph, [omittedLocalDependencies]).accepted, true);
  const malformedDependencies = structuredClone(verdict); malformedDependencies.premises[0].from = null;
  assert.equal(review.validResearchAnswerCoverage(envelope([malformedDependencies]), 1), false);
  const ungroundedOmission = structuredClone(omittedLocalDependencies);
  Object.assign(ungroundedOmission.premises[0], { type: 'inference', evidence: [] });
  assert.equal(check(paragraph, [ungroundedOmission]).accepted, false, 'An omitted empty list never creates a grounded dependency');
  const deduction = structuredClone(verdict); deduction.premises.push({ text: 'Conclusión necesaria de la premisa', type: 'inference', entailed: true, evidence: [], from: [0] });
  assert.equal(check(paragraph, [deduction]).accepted, true, 'A paragraph kind is derived; valid logical deductions need no ritual label');
  deduction.premises[1].entailed = false;
  assert.equal(check(paragraph, [deduction]).accepted, false, 'A plausible but unsupported deduction remains blocked');
  assert.equal(review.canonicalResearchTitles('Consulté «El relato de viajes: hitos y formas».', ['El relato de viajes: hitos y formas']), 'Consulté *El relato de viajes: hitos y formas*.');
  assert.equal(review.canonicalResearchTitles('Afirma «Un resultado nunca documentado».', ['Otro título']), 'Afirma «Un resultado nunca documentado».');
  const located = { ...source, citationLabel: 'Autor, 2011, pp. 7–8', locator: 'pp. 7–8', text: '[p. 7] Otro contenido. [p. 8] El relato cuenta un pedazo de su vida.' };
  assert.equal(review.canonicalResearchCitationLabels('Idea [Otro, 1999, p. 7](nodus://passage/p1).', [located]), 'Idea [Autor, 2011, pp. 7–8](nodus://passage/p1).');
  assert.equal(review.canonicalResearchCitationLabels('Dice «un pedazo de su vida» ([Otro, 1999, p. 7](nodus://passage/p1)).', [located]), 'Dice «un pedazo de su vida» ([Autor, 2011, p. 8](nodus://passage/p1)).');
  const ambiguousLocator = { ...located, text: '[p. 7] un pedazo de su vida [p. 8] un pedazo de su vida' };
  assert.ok(review.canonicalResearchCitationLabels('Dice «un pedazo de su vida» ([Otro](nodus://passage/p1)).', [ambiguousLocator]).includes('pp. 7–8'));
  const unknownLink = 'Idea [Otro, 1999](nodus://passage/unknown).';
  assert.equal(review.canonicalResearchCitationLabels(unknownLink, [located]), unknownLink);
  const literalLink = '«[Otro, 1999](nodus://passage/p1)»';
  assert.equal(review.canonicalResearchCitationLabels(literalLink, [located]), literalLink, 'Never rewrite a link inside a verbatim quote');
  assert.equal(review.canonicalResearchCitationLabels(paragraph, [located, { ...located, citationLabel: 'Conflicto' }]), paragraph, 'Conflicting metadata cannot be chosen by order');
  const bibliography = [{ title: 'Los relatos de viaje en la literatura hispanoamericana', authors: ['Guzmán Rubio, F.'], documentType: 'thesis' }];
  const misidentified = 'El artículo de Guzmán Rubio, *Los relatos de viaje en la literatura hispanoamericana*, describe el género.';
  assert.equal(review.canonicalResearchDocumentTypes(misidentified, bibliography), misidentified.replace('El artículo', 'La tesis'));
  assert.equal(review.canonicalResearchDocumentTypes('«' + misidentified + '»', bibliography), '«' + misidentified + '»', 'Literal quotations are preserved');
  assert.equal(review.canonicalResearchDocumentTypes(misidentified, [...bibliography, { ...bibliography[0], documentType: 'journalArticle' }]), misidentified, 'Ambiguous identities are not guessed');
  assert.equal(review.canonicalResearchDocumentTypes(misidentified, [{ ...bibliography[0], authors: ['Otro autor'] }]), misidentified);
  assert.equal(review.researchAnswerSemanticFocus('Dos autores discrepan en el criterio.').length, 1);
  assert.equal(review.researchAnswerSemanticFocus('El pasaje expone una definición.').length, 1, 'Single-source prose still needs semantic review');
  assert.deepEqual(review.researchAnswerSemanticFocus('Definición simple.\n\nDos autores discrepan.').map(part => part.index), [1, 0], 'Priority never excludes an ordinary paragraph');
  assert.equal(review.researchAnswerSemanticFocus('El pasaje expone una definición.', true).length, 1, 'Edited-volume credits trigger attribution review');
  assert.equal(review.researchAnswerSemanticFocus('En tensión con ello, el otro autor define al sujeto.').length, 1);
  const citation = '[Autor, 2011](nodus://passage/p1)';
  assert.equal(review.canonicalResearchCitationGroups(`Texto (${citation}; ; ; ) (; ; ).`), `Texto (${citation}).`);
  assert.equal(review.canonicalResearchCitationGroups(`Texto (${citation}; una explicación; ).`), `Texto (${citation}; una explicación; ).`, 'Mixed prose punctuation is preserved');
  assert.equal(review.canonicalResearchCitationGroups(`«Texto (; ; )»`), `«Texto (; ; )»`, 'Literal source punctuation is preserved');
  const french = { ...source, text: 'Le récit est un genre qu’il est difficile de définir.' };
  assert.equal(review.canonicalResearchLiteralQuotes('Afirma «un genre qu\'il est difficile de définir».', [french]), 'Afirma «un genre qu’il est difficile de définir».');
  assert.equal(review.canonicalResearchLiteralQuotes('Afirma «un genre qu\'il est impossible de définir».', [french]), 'Afirma «un genre qu\'il est impossible de définir».', 'No semantic or OCR approximation');
  assert.equal(review.canonicalResearchLiteralQuotes('Afirma «un genre qu\'il est difficile de définir».', [{ ...french, id: 'record:r' }]), 'Afirma «un genre qu\'il est difficile de définir».', 'Metadata is not a literal source');
  const nestedSource = { ...source, text: 'La mirada incluye «signos sociales» y no es neutral.' };
  assert.equal(review.canonicalResearchLiteralQuotes('Dice «La mirada incluye \\"signos sociales\\" y no es neutral».', [nestedSource]), 'Dice «La mirada incluye «signos sociales» y no es neutral».');
  assert.equal(review.canonicalResearchParaphraseStyle('Un *relato real* frente a «ficción realista».', 'Usa paráfrasis en lugar de citas.'), 'Un *relato real* frente a *ficción realista*.');
  assert.equal(review.researchAnswerSemanticFocus('Otro libro se titula X.', false, 'No propongas bibliografía alternativa.').length, 1);

  {
    const heading = '### Intenciones documentadas [Fuente](nodus://passage/p1)';
    const editorial = { ...verdict, kind: 'nonfactual', premises: [], supported: true, unsupportedParts: [] };
    assert.equal(review.assessResearchAnswer(heading + '\n\n' + paragraph, [source], envelope([editorial, { ...verdict, index: 1 }]), 'Describe', false).accepted, true, 'A known navigation citation does not turn a topic heading into a factual assertion');
    assert.equal(review.assessResearchAnswer('### Creció un 25% [Fuente](nodus://passage/p1)', [source], envelope([editorial]), 'Describe', false).accepted, false, 'A quantitative assertion in a heading still needs real proof');
    assert.equal(review.assessResearchAnswer(heading.replace('/p1', '/unknown'), [source], envelope([editorial]), 'Describe', false).accepted, false, 'Editorial labels cannot introduce unknown source targets');
    assert.equal(review.researchAnswerProofUnits('**1.** Intenciones documentadas.').length, 1, 'Bold list ordinals cannot become detached proof fragments');
    assert.equal(review.assessResearchAnswer(heading, [source], envelope([editorial]), 'Describe', true).accepted, false, 'Chat still enforces the user default against unsolicited headings');
  }
  const protocolError = Object.assign(new Error('bad schema'), { code: 'schema_mismatch' });
  let fallbacks = 0;
  const partitioned = await review.researchAnswerVerdictsWithFallback(['a', 'b'], async (paragraphs, independent) => {
    if (!independent) throw protocolError;
    fallbacks++; assert.deepEqual(paragraphs.map(p => p.index), [fallbacks - 1]);
    return envelope([{ ...verdict, index: paragraphs[0].index, supported: false, unsupportedParts: ['Unsupported factual modifier'] }]);
  });
  assert.equal(fallbacks, 2);
  assert.equal(partitioned.claims[1].index, 1);
  assert.equal(partitioned.claims[1].supported, false, 'Fallback never coerces a rejection into approval');
  let freshProofs = 0;
  {
    let batches = 0;
    const many = await review.researchAnswerVerdictsWithFallback(Array.from({ length: 18 }, (_, i) => 'Sentence ' + i), async (units, independent) => {
      assert.equal(independent, true, 'Long answers go directly to bounded proofs');
      batches++; assert.ok(units.length <= 4);
      return envelope(units.map((unit, i) => ({ ...structuredClone(verdict), index: unit.index, premises: [{ ...structuredClone(verdict.premises[0]), ...(unit.index ? { fromParagraphs: [unit.index - 1] } : {}) }] })));
    });
    assert.equal(many.claims.length, 18, 'Longer sentence-based answers recover through bounded smaller checks');
    assert.equal(batches, 5);
    assert.deepEqual(many.claims.map(claim => claim.index), Array.from({ length: 18 }, (_, i) => i));
    assert.deepEqual(many.claims[5].premises[0].fromParagraphs, [4], 'Independent batch dependencies restore their real positions');
  }
  const recoveredProof = await review.researchAnswerVerdictsWithFallback(['a'], async () => { throw protocolError; }, undefined, async () => {
    freshProofs++; return envelope([{ ...verdict, supported: false, unsupportedParts: ['not entailed'] }]);
  });
  assert.equal(freshProofs, 1, 'Malformed JSON gets one fresh proof, rather than identical retries');
  assert.equal(recoveredProof.claims[0].supported, false, 'A fresh proof cannot turn a negative verdict into an automatic approval');
  {
    const negative = review.rejectUnprovidedResearchProofs(envelope([verdict]), new Set(['another-input-source']));
    assert.ok(negative.claims[0].unsupportedParts.includes('source_not_supplied_to_this_proof'));
    assert.equal(review.assessResearchAnswer(paragraph, [source], negative, 'Explica').accepted, false, 'A real but unseen source cannot pass merely because it exists in the frozen pool');
    assert.deepEqual(review.rejectUnprovidedResearchProofs(envelope([verdict]), new Set(['p1'])), envelope([verdict]));
    const shifted = envelope([{ ...structuredClone(verdict), index: 4 }]);
    shifted.claims[0].premises[0].fromParagraphs = [3];
    assert.equal(review.validResearchAnswerCoverage(shifted, 1, undefined, 4), true, 'Stable global dependencies can cross a batch boundary');
    shifted.claims[0].premises[0].fromParagraphs = [4];
    assert.equal(review.validResearchAnswerCoverage(shifted, 1, undefined, 4), false, 'Global numbering never permits a self dependency');
  }
  let forbiddenRecovery = 0;
  await assert.rejects(review.researchAnswerVerdictsWithFallback(['a'], async () => { throw new Error('permission revoked'); }, undefined, async () => { forbiddenRecovery++; return envelope([verdict]); }), /permission/);
  assert.equal(forbiddenRecovery, 0);
  await assert.rejects(review.researchAnswerVerdictsWithFallback(['a'], async () => { throw protocolError; }, undefined, async () => { throw new Error('permission revoked in recheck'); }), /permission/);
  await assert.rejects(review.researchAnswerVerdictsWithFallback(['a', 'b'], async () => { throw Object.assign(new Error('permission denied'), { code: 'permission' }); }), /permission denied/);

  const graphFact = structuredClone(verdict); graphFact.premises[0].type = 'fact';
  assert.equal(review.assessResearchAnswer(paragraph, [{ ...source, attributionOnly: true }], envelope([graphFact]), 'Explica').accepted, false, 'Graph attribution cannot become an independent world fact');
  const transport = review.researchAnswerEvidenceTransport([source]);
  const routed = structuredClone(verdict); routed.premises[0].evidence = [{ id: 'source-1', quote: 'q1' }];
  const restored = transport.restore(envelope([routed]));
  assert.equal(restored.claims[0].premises[0].evidence[0].quote, source.text, 'Evidence copied byte for byte from the source');
  assert.equal(review.assessResearchAnswer(paragraph, [source], restored, 'Explica').accepted, true);
  routed.premises[0].evidence[0].quote = 'q999';
  assert.equal(review.assessResearchAnswer(paragraph, [source], transport.restore(envelope([routed])), 'Explica').accepted, false, 'Unknown quote aliases cannot invent evidence');
  routed.premises[0].evidence[0] = { id: 'source-999', quote: 'q1' };
  assert.equal(review.assessResearchAnswer(paragraph, [source], transport.restore(envelope([routed])), 'Explica').accepted, false, 'Unknown sources cannot route quote aliases');
  assert.equal(review.assessResearchAnswer(paragraph, [source], { ...envelope([verdict]), issues: ['A correctly acknowledged limitation.'] }, 'Explica').accepted, true);
  assert.equal(review.assessResearchAnswer(paragraph, [source], { ...envelope([verdict]), coherent: false, issues: ['Contradictory conclusion.'] }, 'Explica').accepted, false);
  const conclusion = 'De este pasaje deduzco el carácter factual del relato [Autor, 2011, p. 2](nodus://passage/p1).';
  const lemma = { index: 1, kind: 'inference', premises: [{ text: 'Conclusión de la premisa ya verificada', type: 'inference', entailed: true, evidence: [], from: [], fromParagraphs: [0] }], unsupportedParts: [], explicitInference: true, supported: true, reason: 'Derived from paragraph zero' };
  const full = paragraph + '\n\n' + conclusion;
  assert.equal(review.assessResearchAnswer(full, [source], envelope([verdict, lemma]), 'Explica').accepted, true, 'A synthesis can depend on an earlier verified paragraph');
  const uncitedSynthesis = paragraph + '\n\nDe ese pasaje deduzco su carácter factual.';
  assert.equal(review.assessResearchAnswer(uncitedSynthesis, [source], envelope([verdict, lemma]), 'Explica').accepted, true, 'A pure synthesis inherits verified evidence without repeating a citation inventory');
  const newFact = structuredClone(lemma); newFact.premises = structuredClone(verdict.premises);
  assert.equal(review.assessResearchAnswer(uncitedSynthesis, [source], envelope([verdict, newFact]), 'Explica').accepted, false, 'A new factual premise still needs its own citation');
  const badParent = structuredClone(verdict); badParent.premises[0].evidence[0].quote = 'Una frase que no existe en la fuente.';
  assert.equal(review.assessResearchAnswer(full, [source], envelope([badParent, lemma]), 'Explica').accepted, false);
  const circular = structuredClone(lemma); circular.premises[0].fromParagraphs = [1];
  assert.equal(review.assessResearchAnswer(full, [source], envelope([verdict, circular]), 'Explica').accepted, false);
  const forward = structuredClone(lemma); forward.premises[0].fromParagraphs = [2];
  assert.equal(review.assessResearchAnswer(full, [source], envelope([verdict, forward]), 'Explica').accepted, false);
  const fakeInferenceProof = structuredClone(lemma); fakeInferenceProof.premises[0].evidence = [{ id: 'p1', quote: 'Otra cita que no se encuentra en la fuente.' }];
  assert.equal(review.assessResearchAnswer(full, [source], envelope([verdict, fakeInferenceProof]), 'Explica').accepted, false, 'Inference evidence cannot bypass literal source validation');
  const uncited = 'El autor afirma el pacto factual.';
  const uncitedReview = check(uncited);
  assert.equal(uncitedReview.accepted, false);
  const bound = review.bindResearchAnswerCitations(uncited, uncitedReview, [source]);
  assert.ok(bound.includes('[Autor, 2011, p. 2](nodus://passage/p1)'));
  assert.equal(check(bound).accepted, true, 'Recovered links must pass a new complete check');

  assert.equal(review.researchAnswerCitationProjection(bound), review.researchAnswerCitationProjection(uncited));
  assert.notEqual(review.researchAnswerCitationProjection(bound.replace('pacto factual', 'pacto ficcional')), review.researchAnswerCitationProjection(bound), 'A changed factual proposition cannot inherit the earlier proof');


  const otherSource = { id: 'p2', label: 'Otro, 2015, p. 3', citation: 'nodus://passage/p2', text: 'La descripción predomina en el relato de viajes.' };
  const mixedText = paragraph + '\n\nLa descripción predomina; lo relaciono con la factualidad anterior.';
  const mixedVerdict = { ...lemma, premises: [
    { text: 'Predomina la descripción', type: 'fact', entailed: true, evidence: [{ id: 'p2', quote: otherSource.text }], from: [] },
    { text: 'Relaciono ambas premisas', type: 'inference', entailed: true, evidence: [], from: [0], fromParagraphs: [0] },
  ] };
  const mixedReview = review.assessResearchAnswer(mixedText, [source, otherSource], envelope([verdict, mixedVerdict]), 'Explica');
  const mixedBound = review.bindResearchAnswerCitations(mixedText, mixedReview, [source, otherSource]);
  assert.ok(mixedBound.split('\n\n')[1].includes('nodus://passage/p2'));
  assert.ok(!mixedBound.split('\n\n')[1].includes('nodus://passage/p1'), 'Citation repair adds the direct proof, not every inherited proof again');
  assert.equal(review.assessResearchAnswer(mixedBound, [source, otherSource], envelope([verdict, mixedVerdict]), 'Explica').accepted, true);

  const operations = { id: 'ops', label: 'Actual run operations', citation: '', text: 'This run retrieved no saved idea notes.' };
  const operationSynthesis = { ...mixedVerdict, premises: [
    { text: 'No ideas were retrieved', type: 'absence', entailed: true, evidence: [{ id: 'ops', quote: operations.text }], from: [] },
    { text: 'Synthesis of the earlier documentary paragraph', type: 'inference', entailed: true, evidence: [], from: [], fromParagraphs: [0] },
  ] };
  assert.equal(review.assessResearchAnswer(paragraph + '\n\nNo ideas were retrieved; this synthesizes the earlier passage.', [source, operations], envelope([verdict, operationSynthesis]), 'Explica').accepted, true, 'An operational disclosure plus inherited inference does not require a repeated documentary citation');


  {
    const a = { id: 'a', text: 'El centro A abrió en 1901.', label: 'A', citation: 'nodus://passage/a' };
    const b = { id: 'b', text: 'El centro B abrió en 1902.', label: 'B', citation: 'nodus://passage/b' };
    const text = 'El centro A abrió en 1901 y el centro B en 1902 [A](nodus://passage/a).';
    const proof = envelope([{ ...verdict, premises: [a, b].map(s => ({ text: s.text, type: 'fact', entailed: true, evidence: [{ id: s.id, quote: s.text }], from: [] })) }]);
    const diagnose = value => review.assessResearchAnswer(value, [a, b], proof, 'Explica ambas fechas', true, review.researchAnswerProofUnits(value).map(unit => unit.text));
    const diagnosis = diagnose(text);
    assert.equal(diagnosis.accepted, false, 'A compound assertion cannot cite only one of its two directly needed sources');
    const fixed = review.bindResearchAnswerCitations(text, diagnosis, [a, b], review.researchAnswerProofUnits(text));
    assert.ok(fixed.includes('nodus://passage/b'));
    assert.equal(diagnose(fixed).accepted, true, 'Backend binding retains both actual supporting sources without inventing content');
  }
  const corrupted = structuredClone(uncitedReview); corrupted.claims[0].evidence[0].id = 'fake';
  assert.equal(review.bindResearchAnswerCitations(uncited, corrupted, [source]), null);
  assert.deepEqual(review.researchAnswerScopeIssues('Ese rasgo solo aparece en 2015.'), ['unbounded_source_exclusivity']);
  assert.deepEqual(review.researchAnswerScopeIssues('En los fragmentos consultados ese rasgo solo aparece en 2015.'), []);
  assert.deepEqual(review.researchAnswerScopeIssues('Es la única obra del autor que consta.'), ['unbounded_source_exclusivity']);
  assert.deepEqual(review.researchAnswerScopeIssues('No es la única obra del autor.'), []);
  assert.deepEqual(review.researchAnswerScopeIssues('No puedo afirmar que solo aparece en 2015.'), []);
  assert.deepEqual(review.researchAnswerScopeIssues('Vega solo constata que existe un debate.'), [], 'A verb prefix must not become a source exclusivity claim');
  assert.deepEqual(review.researchAnswerScopeIssues('Los extractos no permiten concluir más; solo consta que se publicó.'), []);
  assert.deepEqual(review.researchAnswerScopeIssues('Solo consta que se publicó.'), [], 'An epistemic acknowledgement is not an exhaustive bibliography claim');
  assert.match(review.researchChatPresentationInstruction('Máximo 200 palabras.'), /approximately 200 prose words/);

  assert.equal(review.researchChatRequestedOutputTokens('Máximo 200 palabras.', 60000), 4096);
  assert.equal(review.researchChatRequestedOutputTokens('Máximo 2000 palabras.', 60000), 10048);
  assert.equal(review.researchChatRequestedOutputTokens('Para cada autor, máximo 100 palabras.', 60000), 60000);
  assert.equal(review.researchChatRequestedOutputTokens('Una cita breve y una explicación de hasta 100 palabras.', 60000), 4096);
  assert.equal(review.researchChatRequestedOutputTokens('Explica libremente.', 60000), 60000);
  assert.deepEqual(review.researchAnswerRequestedBudgetIssues('«Primera cita comprobada». «Segunda cita comprobada».', 'Incluye una cita literal breve si puedes comprobarla.'), [], 'An indefinite request to include a quote is not an exclusive count gate');
  assert.equal(review.researchChatRequestedOutputTokens('Máximo 200 palabras.', 1024), 1024);

  assert.deepEqual(review.researchAnswerScopeIssues('La biblioteca no demuestra esa relación causal.'), ['unbounded_corpus_absence']);
  assert.deepEqual(review.researchAnswerScopeIssues('Con los pasajes consultados no puedo establecer esa relación causal.'), []);
  assert.deepEqual(review.researchAnswerRequestedBudgetIssues('Una explicación demasiado larga para este límite.', 'Máximo 3 palabras.'), [], 'An advisory word target cannot reject grounded content');
  assert.deepEqual(review.researchAnswerRequestedBudgetIssues('Breve [Una etiqueta de cita muy larga](nodus://passage/p1).', 'Máximo 2 palabras.'), [], 'Citation labels are not explanation prose');
  assert.deepEqual(review.researchAnswerRequestedBudgetIssues('Este texto tiene más de tres palabras.', 'Para cada autor, máximo 3 palabras.'), [], 'A per-author limit is not a whole-answer limit');
  assert.ok(review.researchAnswerRequestedBudgetIssues('«Primera oración de la fuente». «Segunda oración de la fuente».', 'Una sola cita literal y una explicación de hasta 100 palabras.').some(issue => issue.startsWith('requested_single_literal_excerpt')));
  assert.deepEqual(review.researchAnswerRequestedBudgetIssues('«Una cita literal con sus palabras». Esta explicación contiene demasiadas palabras para el límite.', 'Una cita literal y una explicación de hasta 3 palabras.'), []);
  {
    const text = 'Una afirmación sin enlace. Otra afirmación [Autor, p. 2](nodus://passage/p1).\n\nUna «cita. Con puntuación» se conserva.';
    const units = review.researchAnswerProofUnits(text);
    assert.equal(units.length, 3, 'Citations and quoted punctuation are opaque; sentences get distinct proof slots');
    assert.ok(units.every(unit => text.slice(unit.start, unit.end) === unit.text));
    const first = units[0];
    const diagnosis = { accepted: false, issues: [], claims: units.map((unit, i) => ({ sentence: unit.text, status: 'supported', evidence: [{ id: source.id, quote: source.text }], citationEvidenceIds: [source.id], reason: i ? 'literal_premises' : 'missing_documentary_citation' })) };
    const bound = review.bindResearchAnswerCitations(text, diagnosis, [source], units);
    assert.ok(bound.startsWith(first.text.slice(0, -1) + ' ('), 'A missing link attaches to the exact checked sentence');
    assert.ok(bound.endsWith('\n\nUna «cita. Con puntuación» se conserva.'), 'Binding preserves paragraph layout and other prose verbatim');
  }
  {
    const text = 'Ambos describen el género (2011, p. 1; 2015, pp. 1–2). El contraste se limita al pasaje consultado (véase la edición (2015), pp. 4–6).';
    const units = review.researchAnswerProofUnits(text);
    assert.equal(units.length, 2, 'Parenthetical references, including nested groups and page abbreviations, never become fragments');
    assert.ok(units[0].text.endsWith('pp. 1–2).'));
    assert.ok(units[1].text.endsWith('pp. 4–6).'));
  }
  assert.equal(check(paragraph, []).accepted, false, 'Missing verdicts fail closed');
  assert.equal(check(paragraph, [verdict, verdict]).accepted, false, 'Duplicates fail closed');
  assert.equal(check(paragraph, [{ ...verdict, index: 9 }]).accepted, false);
  const fakeQuote = structuredClone(verdict); fakeQuote.premises[0].evidence[0].quote = 'Todos los relatos son ficción obligatoria.';
  assert.equal(check(paragraph, [fakeQuote]).accepted, false);
  const fakeId = structuredClone(verdict); fakeId.premises[0].evidence[0].id = 'invented';
  assert.equal(check(paragraph, [fakeId]).accepted, false);
  assert.equal(check(paragraph.replace('nodus://passage/p1', 'nodus://passage/fake')).accepted, false);
  assert.equal(check('«Todos los relatos son ficción obligatoria». ' + paragraph).accepted, false, 'Direct quotations must actually be literal');
  assert.equal(check(paragraph, [{ ...verdict, kind: 'nonfactual', premises: [] }]).accepted, false);
  const inferred = structuredClone(verdict); inferred.kind = 'inference'; inferred.premises.push({ text: 'Entonces es una novela', type: 'inference', entailed: true, evidence: [], from: [1] });
  assert.equal(check(paragraph, [inferred]).accepted, false, 'Inference cannot support itself');
  assert.equal(review.researchChatHeadingsRequested('Explica los epígrafes del artículo.'), false);
  assert.equal(review.researchChatHeadingsRequested('Organiza la respuesta en tres apartados.'), true);
  assert.equal(review.researchChatHeadingsRequested('Usa encabezados para comparar.'), true);
  assert.equal(review.researchChatHeadingsRequested('Haz un resumen con apartados.'), true);
  assert.equal(review.researchChatHeadingsRequested('¿Puedes usar encabezados en la respuesta?'), true);
  assert.equal(review.researchChatHeadingsRequested('Analiza el libro con secciones fotográficas.'), false);
  assert.equal(review.researchChatHeadingsRequested('Answer with headings.'), true);
  assert.equal(review.researchChatHeadingsRequested('Sin epígrafes ni listas.'), false);
  assert.deepEqual(review.researchAnswerStructureIssues('## Tema\n\nTexto.', 'Explica'), ['unrequested_headings']);
  assert.deepEqual(review.researchAnswerStructureIssues('**Tema**\n\nTexto.', 'Explica'), ['unrequested_headings']);
  assert.deepEqual(review.researchAnswerStructureIssues('## Tema\n\nTexto.', 'Usa encabezados'), []);
  assert.ok(review.researchAnswerStructureIssues('## A\n\n## B', 'Usa encabezados').includes('empty_heading'));
  assert.ok(review.researchAnswerStructureIssues('| A | B |\n|---|---|', 'Explica').includes('broken_table'));
  let revisions = 0;
  const good = await review.reviewAndReviseResearchAnswer(paragraph, async text => check(text), async () => { revisions++; return ''; }, 'es');
  assert.equal(good.answer, paragraph, 'Validated prose and Nodus labels preserved byte for byte');
  assert.equal(revisions, 0);
  const revised = await review.reviewAndReviseResearchAnswer('Malo y sin respaldo.', async text => text === paragraph ? check(text) : { accepted: false, claims: [], issues: ['unsupported'] }, async () => { revisions++; return paragraph; }, 'es');
  assert.equal(revised.answer, paragraph); assert.equal(revised.attempts.length, 2);
  const failed = await review.reviewAndReviseResearchAnswer('Malo.', async () => ({ accepted: false, claims: [], issues: ['unsupported'] }), async () => 'Otra invención.', 'es');
  assert.equal(failed.attempts.length, 4, 'One no-progress retry remains bounded');
  assert.equal(failed.rewriteAttempts, 3);
  assert.equal(failed.status, 'limited'); assert.ok(!failed.answer.includes('Otra invención'));
  let flowWrites = 0;
  const formatFlow = await review.reviewAndReviseResearchAnswer('first-uncited', async text => ({ accepted: text === 'third-cited', claims: [], issues: text === 'third-cited' ? [] : [text.endsWith('uncited') ? 'citation' : 'needs_content_revision'] }), async () => { flowWrites++; return flowWrites === 1 ? 'second-uncited' : 'third-uncited'; }, 'es', undefined,
    text => text.endsWith('uncited') ? text.replace('uncited', 'cited') : null);
  assert.equal(formatFlow.status, 'verified'); assert.equal(formatFlow.attempts.length, 6);
  assert.equal(formatFlow.contentRevisions, 2); assert.equal(formatFlow.citationRepairs, 3);
  const revisionNumbers = [];
  const unchangedFlow = await review.reviewAndReviseResearchAnswer('unchanged', async text => ({ accepted: text === 'corrected', claims: [], issues: text === 'corrected' ? [] : ['Wrong source for the date'] }), async (text, diagnosis, attempt) => {
    revisionNumbers.push(attempt);
    if (attempt === 1) return text;
    assert.ok(diagnosis.issues.some(issue => issue.startsWith('previous_revision_made_no_change')));
    return 'corrected';
  }, 'es');
  assert.deepEqual(revisionNumbers, [1, 2], 'Distinct rewrite attempts cannot reuse a cached no-op');
  assert.equal(unchangedFlow.status, 'verified'); assert.equal(unchangedFlow.contentRevisions, 1);
  const stalled = await review.reviewAndReviseResearchAnswer('unchanged', async () => ({ accepted: false, claims: [], issues: ['Wrong source'] }), async text => text, 'es');
  assert.equal(stalled.status, 'limited'); assert.equal(stalled.rewriteAttempts, 2, 'An unchanged draft gets only one bounded recovery attempt');
  {
    const seen = [];
    const result = await review.reviewAndReviseResearchAnswer('First overreach.', async text => {
      seen.push(text);
      return text === 'A concise grounded reconstruction.' ? { accepted: true, issues: [], claims: [] } : { accepted: false, issues: ['Unsupported optional conclusion'], claims: [{ sentence: 'Useful supported fact.', status: 'supported', evidence: [{ id: source.id, quote: source.text }] }] };
    }, async (text, diagnosis, attempt) => { if (diagnosis.issues.some(issue => issue.startsWith('verified_core_reconstruction'))) { assert.equal(text, '', 'The rejected draft must not prime reconstruction'); return 'A concise grounded reconstruction.'; } return 'Still overreaching ' + attempt; }, 'es');
    assert.equal(result.status, 'verified', 'Useful verified material can survive an unsuccessful optional interpretation');
    assert.equal(seen.at(-1), result.answer, 'The final coherent reconstruction is checked before publication');
    assert.equal(result.verifiedCoreReconstruction, true);
  }

  {
    let calls = 0;
    const result = await review.reviewAndReviseResearchAnswer('Initial.', async text => text === 'Correctly attributed paraphrase.'
      ? { accepted: true, issues: [], claims: [] }
      : { accepted: false, issues: [], claims: [
        { sentence: 'Supported core.', status: 'supported', evidence: [{ id: source.id, quote: source.text }] },
        { sentence: 'Accidentally nonliteral quotation.', status: 'removed', evidence: [], reason: 'The direct quotation does not match the authorized literal source' },
      ] }, async (_text, diagnosis) => { calls++; return diagnosis.issues.some(issue => issue.startsWith('literal_source_repair')) ? 'Correctly attributed paraphrase.' : 'Candidate ' + calls; }, 'es');
    assert.equal(result.status, 'verified');
    assert.equal(result.answer, 'Correctly attributed paraphrase.');
    assert.equal(result.attempts.length, 5, 'The narrow final quotation repair always receives a complete new review');
  }
  {
    const original = { ...source, text: 'The original source states an actual literal qualification.' };
    const other = { ...source, id: 'other', citation: 'nodus://passage/other', text: 'A different statement.' };
    const text = 'Afirma «an actual literal qualification» [Other](nodus://passage/other).';
    const matches = review.researchLiteralRepairCandidates(text, [original, other]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].candidates[0].id, source.id);
    assert.equal(matches[0].quote, 'an actual literal qualification');
    assert.equal(review.researchLiteralRepairCandidates(text, [other]).length, 0, 'No nearby or invented source is suggested without an exact real excerpt');
  }
  {
    const uncited = 'El autor afirma que el relato se apoya en un pacto factual.';
    const seen = [];
    const diagnosis = { accepted: false, issues: ['Unsupported optional framing'], claims: [{ sentence: paragraph, status: 'supported', evidence: [{ id: source.id, quote: source.text }] }] };
    const result = await review.reviewAndReviseResearchAnswer('Overreach.', async text => {
      seen.push(text);
      return text.startsWith('El autor afirma') ? check(text) : diagnosis;
    }, async (_text, d, attempt) => d.issues.some(issue => issue.startsWith('verified_core_reconstruction')) ? uncited : 'Overreach ' + attempt, 'es', undefined,
    (text, d) => review.bindResearchAnswerCitations(text, d, [source]));
    assert.equal(result.status, 'verified', 'A last reconstruction with proved content can still repair a missing citation');
    assert.ok(result.answer.includes('nodus://passage/p1'));
    assert.equal(seen.at(-1), result.answer, 'The citation correction receives the full review');
    assert.equal(result.citationRepairs, 1);
    const unsafe = await review.reviewAndReviseResearchAnswer('Overreach.', async text => text.startsWith('El autor afirma')
      ? text.includes('Invented result') ? { ...diagnosis, issues: ['unsupported factual addition'] } : check(text) : diagnosis,
    async (_text, d, attempt) => d.issues.some(issue => issue.startsWith('verified_core_reconstruction')) ? uncited : 'Overreach ' + attempt, 'es', undefined,
    (text, d) => { const bound = review.bindResearchAnswerCitations(text, d, [source]); return bound ? bound + ' Invented result.' : null; });
    assert.equal(unsafe.status, 'limited', 'Formatting never authorizes a new or unchecked assertion');
  }
  const wrongLink = paragraph.replace('nodus://passage/p1', 'nodus://passage/wrong');
  const rebound = review.bindResearchAnswerCitations(wrongLink, check(wrongLink), [source]);
  assert.ok(rebound && !rebound.includes('nodus://passage/wrong'));
  assert.equal(check(rebound).accepted, true, 'A wrong link can be rebound only to checked literal evidence');
  const outage = await review.reviewAndReviseResearchAnswer(paragraph, async () => { throw new Error('provider down'); }, async () => { throw new Error('must not rewrite blindly'); }, 'es');
  assert.equal(outage.status, 'limited'); assert.equal(outage.attempts.length, 1);
  await assert.rejects(() => review.reviewAndReviseResearchAnswer(paragraph, async () => { throw new Error('research_run_context_changed'); }, async () => '', 'es'), /context_changed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => review.reviewAndReviseResearchAnswer(paragraph, async () => check(paragraph), async () => '', 'es', controller.signal), /abort/i);
  console.log('Research answer review: evidence, rewrite, citation preservation, formatting and failure guards passed');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
