import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-coverage-requirements')) process.exit(0);
installRuntimeHooks(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-coverage-requirements-')));
const require = createRequire(import.meta.url);
const { validateResearchCoverageComplaintAddressed, validateResearchCoverageRequirementProof: validate } = require(path.join(repoRoot, 'shared/researchCoverageRequirements.ts'));

const sourceId = 'doc:vega';
const sourceQuote = 'Intelligence was not measured.';
const requirement = { id: 'r1', complaint: 'interpretation limits', kind: 'available-fact',
  requiredFact: 'State that intelligence was not measured.', sourceId, quote: sourceQuote };
const supported = (id, sentence, quote, evidenceId = sourceId, kind = 'fact') =>
  ({ id, sentence, kind, evidence: [{ id: evidenceId, quote }] });
const proof = (claimId, answerQuote, requirementId = 'r1') =>
  ({ addressed: [{ requirementId, claimIds: [claimId], answerQuotes: [answerQuote] }], omissions: [] });

test('generic supported answer spans cannot discharge a source-backed outcome qualification', () => {
  const generic = supported('c1', 'Spaced retrieval participants recalled 72%.', 'Spaced retrieval participants recalled 72%.');
  assert.equal(validate(proof('c1', generic.sentence), [requirement], generic.sentence, [generic]), false);
});

test('a separately audited factual atom backed by the required source quote can discharge it', () => {
  const atom = supported('c1', 'Intelligence was not measured.', sourceQuote);
  assert.equal(validate(proof('c1', atom.sentence), [requirement], atom.sentence, [atom]), true);
  const widerEvidence = { ...atom, evidence: [{ id: sourceId, quote: `Vega recall was 72%. ${sourceQuote}` }] };
  assert.equal(validate(proof('c1', atom.sentence), [requirement], atom.sentence, [widerEvidence]), true);
});

test('a multilingual paraphrase passes when the accepted claim retains the unchanged literal source quote', () => {
  const paraphrase = supported('c1', 'La inteligencia no se midió.', sourceQuote);
  assert.equal(validate(proof('c1', paraphrase.sentence), [requirement], paraphrase.sentence, [paraphrase]), true);
});

test('same text from another source, missing evidence, or an unselected claim cannot discharge the requirement', () => {
  const foreign = supported('c1', sourceQuote, sourceQuote, 'doc:other');
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [foreign]), false);
  const absent = { ...supported('c1', sourceQuote, sourceQuote), evidence: [] };
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [absent]), false);
  const selectedElsewhere = supported('c2', sourceQuote, sourceQuote);
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [selectedElsewhere]), false);
});

test('a fully supported multi-premise claim may carry the auditor maximum of 72 evidence entries', () => {
  const evidence = Array.from({ length: 71 }, (_, index) => ({ id: `doc:${index}`, quote: `Supporting premise ${index} is established.` }));
  evidence.push({ id: sourceId, quote: sourceQuote });
  const compound = { id: 'c1', sentence: sourceQuote, kind: 'fact', evidence };
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [compound]), true);
  const missingBinding = { ...compound, evidence: evidence.map(item => item.id === sourceId ? { id: 'doc:foreign', quote: sourceQuote } : item) };
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [missingBinding]), false);
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [{ ...compound, evidence: [...evidence, evidence[0]] }]), false);
});

test('a shorter evidence fragment cannot cover a requirement by dropping negation or quantity', () => {
  const negationClaim = supported('c1', 'Intelligence was measured.', 'Intelligence was measured.');
  assert.equal(validate(proof('c1', negationClaim.sentence), [requirement], negationClaim.sentence, [negationClaim]), false);

  const quantity = { ...requirement, quote: 'The outcome was 72%.' };
  const fragment = supported('c1', 'The outcome was 72%.', 'The outcome was.');
  assert.equal(validate(proof('c1', fragment.sentence), [quantity], fragment.sentence, [fragment]), false);
});

test('terminal sentence punctuation may differ while decimals and interior punctuation remain exact', () => {
  const numeric = { ...requirement, quote: 'The score was 72.5%.' };
  const claim = supported('c1', 'The score was 72.5%.', 'The score was 72.5%');
  assert.equal(validate(proof('c1', claim.sentence), [numeric], claim.sentence, [claim]), true);
  const altered = { ...claim, evidence: [{ id: sourceId, quote: 'The score was 725%.' }] };
  assert.equal(validate(proof('c1', altered.sentence), [numeric], altered.sentence, [altered]), false);
});

test('omissions remain unresolved and rejected-only or empty claim candidates cannot approve', () => {
  assert.equal(validate({ addressed: [], omissions: [{ requirementId: 'r1' }] }, [requirement], 'Anything.', []), true);
  const rejected = { ...supported('c1', sourceQuote, sourceQuote), status: 'removed' };
  assert.equal(validate(proof('c1', sourceQuote), [requirement], sourceQuote, [rejected]), false);
  assert.equal(validate({ addressed: [], omissions: [] }, [requirement], sourceQuote, []), false);
});

test('an evidentiary-limit requirement accepts supported nonfactual or audited inference claims', () => {
  const limit = { id: 'r-limit', complaint: 'interpretation limits', kind: 'unaddressed-limit',
    requiredFact: 'Acknowledge the limit on establishing causality.', sourceId: null, quote: null };
  const nonfactual = supported('c1', 'These excerpts cannot establish causality.', 'unused source evidence', sourceId, 'nonfactual');
  assert.equal(validate(proof('c1', nonfactual.sentence, limit.id), [limit], nonfactual.sentence, [nonfactual]), true);
  const inference = supported('c2', 'My inference is limited to the measured recall outcome.', 'unused source evidence', sourceId, 'inference');
  assert.equal(validate(proof('c2', inference.sentence, limit.id), [limit], inference.sentence, [inference]), true);
  const fact = supported('c3', 'The recall outcome was 72%.', 'The recall outcome was 72%.', sourceId, 'fact');
  assert.equal(validate(proof('c3', fact.sentence, limit.id), [limit], fact.sentence, [fact]), false);
});

test('an addressed negative complaint must bind its answer span to a supported claim carrying the required source quote', () => {
  const complaint = { complaint: 'what the excerpt says about intelligence', kind: 'available-fact',
    requiredFact: 'State that intelligence was not measured.', sourceId, quote: sourceQuote,
    claimIds: ['c1'], answerQuotes: [sourceQuote] };
  const generic = supported('c1', 'Spaced retrieval participants recalled 72%.', 'Spaced retrieval participants recalled 72%.');
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, answerQuotes: [generic.sentence] }, generic.sentence, [generic]), false);
  const actual = supported('c1', 'La inteligencia no se midió.', sourceQuote);
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, answerQuotes: [actual.sentence] }, actual.sentence, [actual]), true);
});

test('addressed limit complaints accept only selected supported nonfactual or inference claims', () => {
  const complaint = { complaint: 'what can be concluded', kind: 'unaddressed-limit',
    requiredFact: 'Acknowledge that causality cannot be established.', sourceId: null, quote: null,
    claimIds: ['c1'], answerQuotes: ['These excerpts cannot establish causality.'] };
  const limit = supported('c1', complaint.answerQuotes[0], '');
  limit.evidence = [];
  limit.kind = 'nonfactual';
  assert.equal(validateResearchCoverageComplaintAddressed(complaint, limit.sentence, [limit]), true);
  const factual = { ...limit, kind: 'fact' };
  assert.equal(validateResearchCoverageComplaintAddressed(complaint, limit.sentence, [factual]), false);
});

test('addressed complaint rows reject malformed fields and foreign or unknown claim IDs', () => {
  const complaint = { complaint: 'what the excerpt says about intelligence', kind: 'available-fact',
    requiredFact: 'State that intelligence was not measured.', sourceId, quote: sourceQuote,
    claimIds: ['c1'], answerQuotes: [sourceQuote] };
  const claim = supported('c1', sourceQuote, sourceQuote);
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, claimIds: ['c2'] }, sourceQuote, [claim]), false);
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, sourceId: 'doc:foreign' }, sourceQuote, [claim]), false);
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, quote: null }, sourceQuote, [claim]), false);
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, kind: 'mystery' }, sourceQuote, [claim]), false);
  assert.equal(validateResearchCoverageComplaintAddressed({ ...complaint, unexpected: true }, sourceQuote, [claim]), false);
});

test('unknown, duplicate, malformed, and over-bound proof rows fail closed', () => {
  const claim = supported('c1', sourceQuote, sourceQuote);
  assert.equal(validate(proof('unknown', sourceQuote), [requirement], sourceQuote, [claim]), false);
  assert.equal(validate({ addressed: [{ ...proof('c1', sourceQuote).addressed[0], claimIds: ['c1', 'c1'] }], omissions: [] }, [requirement], sourceQuote, [claim]), false);
  assert.equal(validate({ addressed: [], omissions: [{ requirementId: 'unknown' }] }, [requirement], sourceQuote, [claim]), false);
  assert.equal(validate({ addressed: [{ requirementId: 'r1', claimIds: ['c1'], answerQuotes: ['invented sentence'] }], omissions: [] }, [requirement], sourceQuote, [claim]), false);
  const many = Array.from({ length: 13 }, (_, i) => ({ ...requirement, id: `r${i}` }));
  assert.equal(validate({ addressed: [], omissions: many.map(row => ({ requirementId: row.id })) }, many, sourceQuote, [claim]), false);
});
