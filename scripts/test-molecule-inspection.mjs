import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'molecule-inspection-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findSmilesCandidates, findAnswerSpecies, normalizeMoleculeDossier, formatMoleculeDossier, formatStructureAudit, MOLECULE_DOSSIER_SYSTEM_RULE, findStepConditions, declaresRacemic, stepDeclaresRacemic, stepDeclaresRearrangement, stepDeclaresRadical, normalizeRouteAudit, formatRouteAudit, ROUTE_CONTINUITY_SYSTEM_RULE, findRequestedTarget, requestedTargetFor, ROUTE_FIX_PROMPT_LEAD, parseRouteReview, buildRouteReviewRequest, ROUTE_REVIEW_SYSTEM, clampReviewDetail, findStepProse, routeLabelNames, countRouteSteps, findStepNamedSpecies, buildRouteSteps, isBareSmilesName, annotateSpeciesSmiles, formatNameCorrectionNote, formatAuthorStructureNote, formatNamedRouteFixPrompts, formatMissingSpeciesPrompt, isRouteFixPrompt, parseNameFeedback, ROUTE_NAME_FEEDBACK_SYSTEM, formatUnresolvedNameClarification, routeReportsForHistory, classifyCoProducts, smilesHasCarbon, routeStepFailure, routeFixPromptForHistory, formatRouteCheckUnavailable, normalizeReactionPrecedent, formatReactionPrecedents, buildPrecedentQueries, similarityBand, precedentDrawingFor, formatResolutionSourceNote, UNBUILT_STEP_ERROR_PREFIX, isPlaceholderSpecies, statedConfiguration, uncheckedRouteNote, routeConversationState, asksForRoute, routeStepSummaries, stripDrawingRequests } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
await build({ entryPoints: ['shared/chatSkills.ts'], outfile: path.join(dir, 'chatSkills.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { splitChatVisuals } = await import(pathToFileURL(path.join(dir, 'chatSkills.mjs')));
await build({ entryPoints: ['shared/synthesisPrompt.ts'], outfile: path.join(dir, 'synthesisPrompt.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { SYNTHESIS_TEMPLATE_ADDENDUM, looksLikeSynthesisRequest } = await import(pathToFileURL(path.join(dir, 'synthesisPrompt.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const WRAPPED = `Here is the smiles string for icotrokinra.
Cc1cccc2c(C[C@H]3C(=O)N[C@@H](CCCCNC(=O)C)C(=O)N[C@H]
(C(=O)N[C@@H](Cc4ccc(cc4)OCCN)C(=O)N[C@@H]
(Cc5ccc6ccccc6c5)C(=O)NC7(CCOCC7)C(=O)N[C@@H]
(CCC(=O)O)C(=O)N[C@@H](CC(=O)N)C(=O)N[C@@H]
(Cc8cccnc8)C(=O)N(C)CC(=O)N)C(C)(C)SSC(C)(C)[C@@H]
(C(=O)N[C@@H](CC(=O)N)C(=O)N[C@@]([H])([C@@H]
(C)O)C(=O)N3)NC(=O)C)c[nH]c12 .Walk me through how you would
synthesize this from standard precursors.`;

test('detects a line-wrapped SMILES and reassembles it', () => {
  const found = findSmilesCandidates(WRAPPED);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith('Cc1cccc2c(C[C@H]3C(=O)N'));
  assert.ok(found[0].endsWith('C)c[nH]c12'));
  assert.ok(!found[0].includes('Walk'));
  assert.ok(!found[0].includes('\n'));
});

test('ignores ordinary prose', () => {
  assert.deepEqual(findSmilesCandidates('Walk me through how you would synthesize this from standard precursors.'), []);
  assert.deepEqual(findSmilesCandidates('aspirin and benzene are aromatic'), []);
});

test('sentence punctuation glued to a SMILES is peeled off, not parsed as part of it', () => {
  const found = findSmilesCandidates('Compare the stereochemistry of C[C@H](N)C(=O)O with the ester CC(=O)Oc1ccccc1C(=O)O.');
  assert.deepEqual(found, ['C[C@H](N)C(=O)O', 'CC(=O)Oc1ccccc1C(=O)O']);
  assert.deepEqual(findSmilesCandidates('The product is "CCO".'), []);
  // An interior dot is a salt or reaction separator: it must survive.
  assert.deepEqual(findSmilesCandidates('Dissolve [Na+].[Cl-] in water.'), ['[Na+].[Cl-]']);
});

test('a verified dossier survives normalization and formats its stereo', () => {
  const dossier = normalizeMoleculeDossier({
    canonicalSmiles: 'C[C@H](N)C(=O)O',
    formula: 'C3H7NO2',
    molecularWeight: 89.09,
    atomCount: 3,
    bondCount: 2,
    atoms: [{ index: 0, element: 'C' }, { index: 1, element: 'C', cip: 'S' }, { index: 2, element: 'O', charge: -1 }],
    bonds: [{ a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1, stereo: 'E' }],
    caveats: ['one unspecified stereocentre'],
  }, 'C[C@H](N)C(=O)O');
  assert.ok(dossier);
  assert.equal(dossier.atoms.length, 3);
  const text = formatMoleculeDossier(dossier);
  assert.match(text, /Canonical isomeric SMILES: C\[C@H\]\(N\)C\(=O\)O/);
  assert.match(text, /#1 C S/);
  assert.match(text, /0-1 1/);
  assert.match(text, /unspecified stereocentre/);
});

test('malformed artifact data is rejected rather than injected', () => {
  assert.equal(normalizeMoleculeDossier(null, 'C'), null);
  assert.equal(normalizeMoleculeDossier({ canonicalSmiles: '', atoms: [], bonds: [] }, 'C'), null);
  assert.equal(normalizeMoleculeDossier({ canonicalSmiles: 'C' }, 'C'), null);
  assert.equal(normalizeMoleculeDossier({ canonicalSmiles: 'C', atoms: [], bonds: [] }, 'C'), null);
});

test('the system rule names the authoritative field', () => {
  assert.match(MOLECULE_DOSSIER_SYSTEM_RULE, /estructura_objetivo_verificada/);
  assert.match(MOLECULE_DOSSIER_SYSTEM_RULE, /RDKit/);
});

test('answer audit extracts every species from backticked reactions and quoted species', () => {
  const answer = [
    'Step 1: ethene adds bromine to give 1,2-dibromoethane.',
    '',
    '`C=C.BrBr>>BrCCBr`',
    '',
    'The chiral intermediate `C[C@H](N)C(=O)O` is carried forward.',
  ].join('\n');
  const species = findAnswerSpecies(answer);
  for (const expected of ['C=C', 'BrBr', 'BrCCBr', 'C[C@H](N)C(=O)O']) {
    assert.ok(species.includes(expected), `missing ${expected}: ${JSON.stringify(species)}`);
  }
});

test('answer audit reads only code spans, never free prose', () => {
  const answer = [
    'The product (Z)-hex-3-ene forms; see Reagents/conditions and [Klein, 2012](nodus://idea/g-15188).',
    '',
    '`C#C.CCBr>>CC#C`',
  ].join('\n');
  assert.deepEqual(findAnswerSpecies(answer), ['C#C', 'CCBr', 'CC#C']);
});

test('a bare bond or stereo fragment is not treated as a species', () => {
  assert.deepEqual(findAnswerSpecies('quoted as `=O` and `/C=C\\` in the prose'), []);
  assert.deepEqual(findSmilesCandidates('the direction /C=C/C=C/C is not a molecule'), []);
});

test('a names-first step backticking its role labels does not report the labels as molecules', () => {
  const answer = [
    '`Reactants:`phenol — `C1=CC=C(C=C1)O`;sodium hydroxide — `[OH-].[Na+]`',
    '`Products:`sodium phenoxide — `[O-]C1=CC=CC=C1.[Na+]`',
    '`Byproducts:`water — `O`',
    '`Agents:`water (solvent)',
  ].join('\n');
  const species = findAnswerSpecies(answer);
  for (const label of ['Reactants:', 'Products:', 'Byproducts:', 'Agents:']) {
    assert.ok(!species.includes(label), `role label leaked into species: ${JSON.stringify(species)}`);
  }
  assert.deepEqual(species, ['C1=CC=C(C=C1)O', '[OH-].[Na+]', '[O-]C1=CC=CC=C1.[Na+]', 'O']);
});

test('answer audit marks verified and unparseable species deterministically', () => {
  const candidates = ['C[C@H](N)C(=O)O', 'notasmiles'];
  const dossier = normalizeMoleculeDossier({
    canonicalSmiles: 'C[C@H](N)C(=O)O',
    atomCount: 6,
    bondCount: 5,
    atoms: [{ index: 1, element: 'C', cip: 'S' }],
    bonds: [{ a: 0, b: 1, order: 1 }],
  }, 'C[C@H](N)C(=O)O');
  const text = formatStructureAudit(candidates, [dossier]);
  assert.match(text, /Structure check \(RDKit\)/);
  assert.match(text, /- OK `C\[C@H\]\(N\)C\(=O\)O`.*1 stereocentres/);
  assert.match(text, /- FAIL `notasmiles` — could not be parsed/);
});

// ---------------------------------------------------------------- synthesis routes

test('step conditions are read from the prose and aligned with the reaction lines', () => {
  const answer = [
    'Step 1 — nitration.',
    'Reagents and conditions: HNO3/H2SO4, 50–55 °C, 1 h.',
    '`c1ccccc1.O[N+](=O)[O-]>OS(=O)(=O)O>O=[N+]([O-])c1ccccc1.O`',
    '',
    'Step 2 — reduction.',
    'Reagents and conditions: Sn/HCl, then NaOH workup.',
    '`O=[N+]([O-])c1ccccc1.[Sn].Cl>>Nc1ccccc1.Cl[Sn]Cl`',
  ].join('\n');
  const conditions = findStepConditions(answer, 2);
  assert.equal(conditions.length, 2);
  assert.match(conditions[0], /HNO3\/H2SO4, 50–55/);
  assert.match(conditions[1], /Sn\/HCl/);
  // A step with no conditions line, or an extra requested slot, is an empty string.
  assert.deepEqual(findStepConditions('no conditions here', 2), ['', '']);
  // A full sentence is reduced to the first clause, and "Reagents/conditions:" (no "and") is read.
  const prose = 'Reagents/conditions: NaNH₂ (sodium amide) in liquid NH₃, then CCBr; the monoalkylated alkyne is the desired product.';
  assert.equal(findStepConditions(prose, 1)[0], 'NaNH₂ in liquid NH₃, then CCBr');
});

test('a malformed route audit degrades to no audit instead of junk', () => {
  assert.equal(normalizeRouteAudit(null), null);
  assert.equal(normalizeRouteAudit({ steps: [] }), null);
  assert.equal(normalizeRouteAudit({ steps: [{}] }), null);
});

test('a long route audit keeps every step (a route of dozens of steps runs past 16)', () => {
  // The package checks up to 96 steps; an audit cut shorter than the route is refused as misaligned,
  // which once left every route over 16 steps unchecked.
  const step = (index) => ({ index, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
    reactants: [{ canonicalSmiles: 'CCO', formula: 'C2H6O', heavyAtoms: 3 }], agents: [], products: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }] });
  const link = (from) => ({ from, to: from + 1, ok: true, reason: 'carried', carried: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }], skeletonOnly: [] });
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: Array.from({ length: 26 }, (_, i) => step(i)), links: Array.from({ length: 25 }, (_, i) => link(i)), isolated: [20] });
  assert.equal(audit.steps.length, 26);
  assert.deepEqual(audit.steps.map((s) => s.index), Array.from({ length: 26 }, (_, i) => i));
  assert.equal(audit.links.length, 25);
  assert.deepEqual(audit.isolated, [20]);
});

test('a route audit is normalized defensively and formatted deterministically', () => {
  const audit = normalizeRouteAudit({
    continuous: false,
    blocked: ['Step 1 is not balanced: H: reactants 6, products 4.'],
    steps: [
      { index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 6, products 4'], unspecifiedStereocentres: 0, reactants: [{ input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O', heavyAtoms: 3 }], agents: [], products: [{ input: 'CC=O', canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }] },
      { index: 1, reaction: 'CC=O.[H][H]>>CCO', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }, { canonicalSmiles: '[H][H]', formula: 'H2', heavyAtoms: 0 }], agents: [], products: [{ canonicalSmiles: 'CCO', formula: 'C2H6O', heavyAtoms: 3 }] },
    ],
    links: [{ from: 0, to: 1, ok: true, reason: 'carried', carried: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }], skeletonOnly: [] }],
  });
  assert.ok(audit);
  assert.equal(audit.continuous, false);
  const text = formatRouteAudit(audit);
  assert.match(text, /Route check \(RDKit\)/);
  assert.match(text, /- Step 1 FAIL — NOT balanced \(H: reactants 6, products 4\)\. C2H6O → C2H4O/);
  assert.match(text, /- Step 2 OK — balanced\./);
  assert.match(text, /- Step 1 → 2 OK — carried C2H4O/);
  assert.match(text, /\*\*Route check failed\*\* — 1 of 2 step\(s\) do not pass \(step 1\)\./);
  assert.match(text, /Check failed: Step 1 is not balanced/);
});

test('a route review blocks the verdict and is shown as a model finding', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [passingStep(0, 'a>>b')], links: [],
  });
  assert.ok(audit);
  const clean = formatRouteAudit(audit);
  assert.match(clean, /\*\*Route checked: balanced and connected\*\*/);
  assert.doesNotMatch(clean, /Route review/);
  const review = parseRouteReview('{"status":"problems","problems":[{"step":1,"severity":"blocking","detail":"the Products line names a different compound than the target."}]}');
  assert.deepEqual(review, { status: 'problems', problems: [{ step: 1, severity: 'blocking', detail: 'the Products line names a different compound than the target.' }] });
  const blockedText = formatRouteAudit(audit, [], review);
  assert.match(blockedText, /\*\*Route check failed\*\* — a route review raised 1 problem\(s\)\./);
  assert.match(blockedText, /### Route review \(model\)/);
  assert.match(blockedText, /- Step 1: the Products line names a different compound than the target\./);
  assert.match(blockedText, /Check failed: The route review raised 1 problem\(s\)\./);
});

test('an advisory review finding is shown but never blocks the route', () => {
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.ok(audit);
  // A finding with no severity is advisory by default: the reviewer cannot fail a route by
  // doubting a transformation.
  const review = parseRouteReview('{"status":"problems","problems":[{"step":1,"detail":"I doubt acid X can give the named product."}]}');
  assert.deepEqual(review, { status: 'problems', problems: [{ step: 1, severity: 'advisory', detail: 'I doubt acid X can give the named product.' }] });
  const text = formatRouteAudit(audit, [], review);
  assert.match(text, /\*\*Route checked: balanced and connected\*\*/);
  assert.doesNotMatch(text, /Route check failed/);
  assert.match(text, /### Route review \(model, advisory\)/);
  assert.match(text, /I doubt acid X can give the named product\./);
  assert.match(formatRouteAudit(audit, [], parseRouteReview('{"status":"problems","problems":[{"step":1,"severity":"advisory","detail":"x"}]}')), /\*\*Route checked: balanced and connected\*\*/);
  assert.match(formatRouteAudit(audit, [], parseRouteReview('{"status":"problems","problems":[{"step":1,"severity":"blocking","detail":"x"}]}')), /\*\*Route check failed\*\*/);
});

test('an unreadable review is not a problem and never blocks', () => {
  assert.equal(parseRouteReview('sorry, I could not read the route'), null);
  assert.equal(parseRouteReview('{"status":"problems","problems":[]}'), null);
  assert.equal(parseRouteReview('{"status":"weird"}'), null);
  assert.deepEqual(parseRouteReview('here it is: {"status":"ok"}'), { status: 'ok', problems: [] });
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.ok(audit);
  assert.match(formatRouteAudit(audit, [], null), /\*\*Route checked: balanced and connected\*\*/);
  // A review of `ok` does not block either.
  assert.match(formatRouteAudit(audit, [], parseRouteReview('{"status":"ok"}')), /\*\*Route checked: balanced and connected\*\*/);
});

test('a review finding is kept whole or cut on a word boundary, never mid-word', () => {
  // A real finding is longer than the old 400-character cap and must survive intact.
  const sentence = 'The product is the requested target, but the step folds bond-forming events together. ';
  const detail = sentence.repeat(7).trim();
  assert.ok(detail.length > 400 && detail.length < 1000);
  const parsed = parseRouteReview(JSON.stringify({ status: 'problems', problems: [{ step: 3, detail }] }));
  assert.equal(parsed.problems[0].detail, detail);

  const short = 'the Products line names a different compound than the target.';
  assert.equal(clampReviewDetail(short), short);
  const long = `${'word '.repeat(300)}tail`;
  const clamped = clampReviewDetail(long);
  assert.ok(clamped.endsWith('…'));
  assert.ok(clamped.length <= 1001, 'kept within the limit plus the ellipsis');
  const body = clamped.slice(0, -1);
  assert.equal(body, body.trimEnd());
  assert.ok(long.startsWith(body), 'the kept text is a prefix of the original, cut at a space');
});

test('the route review is told not to re-check balance and to allow one-pot cascades', () => {
  assert.match(ROUTE_REVIEW_SYSTEM, /already checked that every equation balances/);
  assert.doesNotMatch(ROUTE_REVIEW_SYSTEM, /it has passed/, 'the review is not told a failed route passed');
  assert.match(ROUTE_REVIEW_SYSTEM, /Never report a balance, stoichiometry or "cannot be written as one balanced equation" problem/);
  assert.match(ROUTE_REVIEW_SYSTEM, /one-pot cascade/);
  // A free amine vs its hydrochloride is a protonation-state choice: the review flipped between
  // the two across corrections and blocked each time. It is advisory; a folded workup still blocks.
  assert.match(ROUTE_REVIEW_SYSTEM, /a free amine or its hydrochloride, an acid or its carboxylate — is the author's choice/);
  assert.match(ROUTE_REVIEW_SYSTEM, /never report both forms in turn/);
  assert.match(ROUTE_REVIEW_SYSTEM, /a step that folds a separate workup into a different transformation/, 'the Kolbe–Schmitt workup rule still blocks');
  // The checker owns balance; the reviewer still owns the plan problem it can see.
  assert.match(ROUTE_REVIEW_SYSTEM, /regiochemistry/);
});

test('the continuity rule is names-first, never a reaction SMILES line', () => {
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /same systematic IUPAC name/);
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /stereodescriptors/);
  assert.doesNotMatch(ROUTE_CONTINUITY_SYSTEM_RULE, /isomeric SMILES/);
  assert.doesNotMatch(ROUTE_CONTINUITY_SYSTEM_RULE, /reactants>agents>products/);
});

test('the synthesis template is applied only to chemistry synthesis requests', () => {
  assert.equal(looksLikeSynthesisRequest('Propose a step-by-step laboratory synthesis of (Z)-hex-3-ene (SMILES: CC/C=C\\CC), starting from acetylene (C#C) and bromoethane (CCBr).'), true);
  assert.equal(looksLikeSynthesisRequest('This is a chemistry synthesis question.'), true);
  assert.equal(looksLikeSynthesisRequest('Propose a step-by-step laboratory synthesis of 2-methylbutanoic acid from diethyl malonate.'), true);
  assert.equal(looksLikeSynthesisRequest('the synthesis of factions in this world'), false, 'another vault is not a chemistry question');
  assert.equal(looksLikeSynthesisRequest('hi'), false);
  assert.equal(looksLikeSynthesisRequest('Propose a synthesis.\n\nOutput format — follow exactly.\n1. Number every step.'), false, 'an already-templated message is left alone');
});

test('the template asks for names and roles only, and forbids the model from writing SMILES', () => {
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('systematic IUPAC name ONLY'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Reactants:'), 'the role labels are spelled out');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('semicolons'), 'species are separated by semicolons');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Do not write SMILES'), 'the model is told not to author SMILES');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Every step ends with the four labelled lines'), 'the species lists are mandatory');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('metal-oxo oxidation'), 'redox guidance is present');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('rearrangement or isomerisation'), 'rearrangement guidance is present');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('You never choose coefficients'), 'the equation is the application\'s job');
  // The format example follows its own rules: a released species is a Byproduct, not a Product.
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Products: sodium ethanoate\n\s+Byproducts: water/);
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('chemistry-plan'), 'the target plan is still requested');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('true catalyst'), 'the agents field is for true catalysts only');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('racemic'), 'a racemate can be stated in the prose');
  // It must not invite a reaction line or a per-species SMILES example any more.
  assert.ok(!SYNTHESIS_TEMPLATE_ADDENDUM.includes('BALANCED reaction SMILES'));
  assert.ok(!/backticked/.test(SYNTHESIS_TEMPLATE_ADDENDUM), 'no backticked-SMILES instruction remains');
  for (const blocked of ['nodus-view', 'nodus-artifact', 'nodus-capability-result']) {
    assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes(blocked), `the model must not author ${blocked} results`);
  }
});

test('a declared racemate is formatted as a caveat, not a refusal', () => {
  assert.equal(declaresRacemic('The final product is a racemic mixture.'), true);
  // An open outcome declared as meso/achiral or "not stereodefined" is a stated outcome too.
  assert.equal(declaresRacemic('The bridgehead positions are not stereodefined in this achiral (meso) bicyclic ketone.'), true);
  assert.equal(declaresRacemic('the product is the meso compound'), true);
  assert.equal(declaresRacemic('the stereochemistry is not controlled'), true);
  assert.equal(declaresRacemic('obtained as a single (R) enantiomer'), false);
  const audit = normalizeRouteAudit({
    steps: [{ index: 0, reaction: 'CC(=O)CC.[H][H]>>CCC(C)O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 1, racemic: true }],
    links: [], continuous: true, blocked: [],
  });
  assert.ok(audit);
  const text = formatRouteAudit(audit);
  assert.match(text, /declared racemic/);
  assert.doesNotMatch(text, /unspecified stereocentre/);
});

const fixPayload = (fence) => JSON.parse(fence.replace(/^```nodus-route-fix\n/, '').replace(/\n```$/, ''));
const passingStep = (index, reaction, products = []) => ({ index, reaction, ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products });

test('a step orphaned by a duplicate names the pair, not just the orphan', () => {
  // The chain-3 shape that sent three fix rounds at the wrong step: a protection gave the free acid
  // directly, and a later step "acidified" a salt nothing produces to emit the same free acid. The
  // checker correctly isolates step 1, but the step to delete is step 2.
  const ACID = 'CC(C)(C)OC(=O)NCC(=O)O';
  const SALT = 'CC(C)(C)OC(=O)NCC(=O)[O-].[Na+]';
  const acid = { canonicalSmiles: ACID, name: 'N-(tert-butoxycarbonyl)glycine' };
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1 is disconnected from the rest of the route.'], links: [],
    isolated: [0],
    steps: [
      { ...passingStep(0, 'a>>b', [acid]) },
      { ...passingStep(1, 'c>>b', [acid]), reactants: [{ canonicalSmiles: SALT, name: 'sodium N-(tert-butoxycarbonyl)glycinate' }] },
    ],
  });
  const text = formatNamedRouteFixPrompts([[], []], audit);
  assert.match(text, /Steps 1 and 2 both produce N-\(tert-butoxycarbonyl\)glycine/, 'it names both producers');
  assert.match(text, /step 2 consumes sodium N-\(tert-butoxycarbonyl\)glycinate, which no step makes/, 'and the unmade reactant of the redundant step');
  assert.match(text, /delete the redundant one of step 2/, 'and points at the step to remove, not the orphan');
  // The old advice aimed the author at inserting a step or renaming a carried species, which is
  // the wrong repair when the defect is a duplicate.
  assert.doesNotMatch(text, /Insert the missing step where it belongs/, 'no misdirecting advice when a duplicate explains it');
  // The per-step chip must carry it too: "Fix step 1" pointing at the orphan with no mention of the
  // duplicate is the original bug, just in a different chip.
  const perStep = routeFixChips(text).find((chip) => /^Fix step 1$/.test(chip.label));
  assert.ok(perStep, 'the per-step chip exists');
  assert.match(perStep.prompt, /Steps 1 and 2 both produce/, 'the per-step chip names the pair as well');
  assert.match(perStep.prompt, /delete the redundant one of step 2/);
});

test('a genuinely missing step still gets the original advice', () => {
  // No duplicate producer, so nothing is known about why the step floats free: keep the old wording.
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 2 is disconnected from the rest of the route.'], links: [],
    isolated: [1],
    steps: [
      passingStep(0, 'a>>b', [{ canonicalSmiles: 'CCO', name: 'ethanol' }]),
      passingStep(1, 'c>>d', [{ canonicalSmiles: 'CCCCO', name: 'butan-1-ol' }]),
    ],
  });
  const text = formatNamedRouteFixPrompts([[], []], audit);
  assert.match(text, /Step 2 is disconnected/);
  assert.match(text, /Insert the missing step where it belongs/, 'the original advice is kept when no duplicate explains it');
  assert.doesNotMatch(text, /orphaned by a duplicate/);
});

test('the requested target is read from the synthesis request', () => {
  assert.equal(findRequestedTarget('Propose a synthesis of tropinone (SMILES: CN1C2CCC1CC(=O)C2). You may use methylamine (CN).'), 'CN1C2CCC1CC(=O)C2');
  assert.equal(findRequestedTarget('Propose a step-by-step laboratory synthesis of sulfanilamide (4-aminobenzenesulfonamide, SMILES: Nc1ccc(cc1)S(N)(=O)=O), starting from benzene (c1ccccc1)'), 'Nc1ccc(cc1)S(N)(=O)=O');
  assert.equal(findRequestedTarget('Propose a synthesis of (Z)-hex-3-ene (SMILES: CC/C=C\\CC), starting from acetylene'), 'CC/C=C\\CC');
  assert.equal(findRequestedTarget('Synthesis of cubane, SMILES: `C12C3C4C1C5C2C3C45`.'), 'C12C3C4C1C5C2C3C45');
  // The name wraps, so "SMILES:" lands on the next line.
  assert.equal(
    findRequestedTarget('Propose a step-by-step laboratory synthesis of ibuprofen (2-(4-isobutylphenyl)propanoic acid,\nSMILES: CC(C)Cc1ccc(cc1)C(C)C(=O)O), starting from isobutylbenzene (CC(C)Cc1ccccc1) plus common inorganic reagents and solvents.'),
    'CC(C)Cc1ccc(cc1)C(C)C(=O)O',
    'a line break before SMILES does not lose the target',
  );
  assert.equal(findRequestedTarget('Propose a synthesis of aspirin starting from phenol (SMILES: Oc1ccccc1)'), null, 'a starting material is not the target');
  assert.equal(findRequestedTarget('Compare and contrast to this approach: Step 1 phenol, SMILES: Oc1ccccc1'), null);
  assert.equal(findRequestedTarget('What is the SMILES: of water?'), null);
});

test('a target written bare, the way a person types it, is found', () => {
  // The shape that exposed this, reduced from a real request: no `SMILES:` label anywhere, which
  // is how someone types it by hand. It used to return null, and because the evidence gather
  // returns null on a missing target before it logs anything, every such run went without
  // evidence and left no trace that it had.
  const bare = 'Propose a step-by-step laboratory synthesis of'
    + ' OC([C@H](CC1=CC=C(OCCSC[C@@H](C(O)=O)N)C=C1)NC(OCC2C3=CC=CC=C3C4=C2C=CC=C4)=O)=O'
    + ' starting from natural acids and standard precursors. Number each step.';
  assert.equal(findRequestedTarget(bare), 'OC([C@H](CC1=CC=C(OCCSC[C@@H](C(O)=O)N)C=C1)NC(OCC2C3=CC=CC=C3C4=C2C=CC=C4)=O)=O');
  assert.equal(findRequestedTarget('Propose a step-by-step laboratory synthesis of CC(=O)Oc1ccccc1C(=O)O starting from phenol.'), 'CC(=O)Oc1ccccc1C(=O)O');
  assert.equal(findRequestedTarget('Propose a laboratory synthesis of CC(=O)Oc1ccccc1C(=O)O.'), 'CC(=O)Oc1ccccc1C(=O)O', 'a trailing full stop is not part of the structure');
  // The cut-off still applies, so what follows "starting from" is a precursor, not the target.
  assert.equal(findRequestedTarget('Propose a synthesis of CC(=O)Oc1ccccc1C(=O)O starting from Cc1ccc([N+](=O)[O-])cc1.'), 'CC(=O)Oc1ccccc1C(=O)O');

  // A NAME in that position must not be taken as a structure: the gather would then go looking
  // for a molecule nobody asked for. Every numbered name satisfies the loose `isSmilesLike` shape
  // test because a locant reads as a ring closure, which is why the strict test is used here.
  assert.equal(findRequestedTarget('Propose a step-by-step laboratory synthesis of 4-nitrotoluene starting from toluene.'), null);
  assert.equal(findRequestedTarget('Propose a synthesis of (2S)-2-amino-3-(4-hydroxyphenyl)propanoic acid starting from phenol.'), null);
  assert.equal(findRequestedTarget('Propose a synthesis of aspirin from salicylic acid and ethanoic anhydride.'), null);
  assert.equal(findRequestedTarget('Propose a synthesis of benzene-1,2-diamine from nitrobenzene.'), null, 'a comma-separated locant is a name, never a structure');
  // No request verb, so nothing is a target however structure-shaped it looks.
  assert.equal(findRequestedTarget('What is the molecular formula of CC(=O)Oc1ccccc1C(=O)O?'), null);
  // The documented gap: no branch, bond or aromatic ring, so the strict test refuses it bare. It
  // still resolves through the labelled form, which is the trade this makes on purpose.
  assert.equal(findRequestedTarget('Propose a synthesis of C1COCCO1 starting from ethane-1,2-diol.'), null);
  assert.equal(findRequestedTarget('Propose a synthesis of dioxane (SMILES: C1COCCO1) starting from ethane-1,2-diol.'), 'C1COCCO1');

  const request = 'Propose a synthesis of tropinone (SMILES: CN1C2CCC1CC(=O)C2).';
  const correction = `${ROUTE_FIX_PROMPT_LEAD}\n\nThe route checker rejected these steps: ...`;
  assert.equal(requestedTargetFor([request, correction, correction]), 'CN1C2CCC1CC(=O)C2', 'a correction keeps the target of the request it corrects');
  // A per-step chip does not start with the all-steps lead; it must still be skipped.
  const stepFix = 'Correction needed for step 3 of the synthesis route above.\n\nStep 3 was rejected: not balanced.';
  assert.equal(requestedTargetFor([request, stepFix]), 'CN1C2CCC1CC(=O)C2', 'a per-step correction keeps the target too');
  // A follow-up about the route keeps its target, so a route revised in reply is still checked
  // against it; a new synthesis request ends the search even when it names no SMILES.
  assert.equal(requestedTargetFor([request, 'are you saying the stereochemistry does not matter?']), 'CN1C2CCC1CC(=O)C2', 'a follow-up keeps the target');
  assert.equal(requestedTargetFor([request, 'Now propose a synthesis of cocaine from tropinone.']), null, 'a new route request without a SMILES has no target');
  assert.equal(requestedTargetFor([request, 'Propose a synthesis of ethanol (SMILES: CCO).']), 'CCO', 'a new route request with a SMILES has its own');
  assert.equal(requestedTargetFor([request, 'Why does the synthesis need step 2?']), 'CN1C2CCC1CC(=O)C2', 'a question about the route is not a new request');
  // Other phrasings of the request, and a long systematic name before the SMILES.
  assert.equal(findRequestedTarget('Synthesize acetylsalicylic acid (SMILES: CC(=O)Oc1ccccc1C(=O)O) from phenol.'), 'CC(=O)Oc1ccccc1C(=O)O');
  assert.equal(findRequestedTarget('Suggest a route to 4-aminobenzenesulfonamide (SMILES: Nc1ccc(cc1)S(N)(=O)=O).'), 'Nc1ccc(cc1)S(N)(=O)=O');
  const longName = '(8R,9S,13S,14S)-3-hydroxy-13-methyl-6,7,8,9,11,12,13,14,15,16-decahydro-17H-cyclopenta[a]phenanthren-17-one, the steroid hormone estrone, with its four ring-junction stereocentres defined';
  assert.equal(findRequestedTarget(`Propose a synthesis of ${longName.replace(', with', ',')} (SMILES: CC12CCC3c4ccc(O)cc4CCC3C1CCC2=O).`), 'CC12CCC3c4ccc(O)cc4CCC3C1CCC2=O', 'a long systematic name before the SMILES');
  assert.equal(requestedTargetFor([]), null);
});

test('every generated correction prompt is recognised, a request is not', () => {
  assert.ok(isRouteFixPrompt(ROUTE_FIX_PROMPT_LEAD));
  assert.ok(isRouteFixPrompt('Correction needed for step 3 of the synthesis route above.\nStep 3 was rejected'));
  // The user message is the chip's prompt body, not the fence it is rendered from.
  assert.ok(isRouteFixPrompt('The species names in the synthesis route above do not match the prose, or the prose is ambiguous, and the correction could not be resolved automatically. Please confirm the intended chemistry.\n\nUnresolved species:\n- Step 1 product "x"'), 'a legacy clarification stored in an old chat is still skipped');
  assert.ok(isRouteFixPrompt(fixPayload(formatUnresolvedNameClarification([{ step: 1, role: 'reactant', byproduct: false, name: 'x' }])).prompt));
  assert.ok(isRouteFixPrompt(fixPayload(formatMissingSpeciesPrompt()).prompt));
  assert.ok(!isRouteFixPrompt('Propose a synthesis of tropinone (SMILES: CN1C2CCC1CC(=O)C2).'));
  assert.ok(!isRouteFixPrompt(''));
});

test('the verified verdict only claims a formed target when one was checked', () => {
  const withTarget = normalizeRouteAudit({
    continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [],
    target: { input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O', formedAt: 0, reason: 'formed' },
  });
  assert.match(formatRouteAudit(withTarget), /\*\*Route checked: balanced and connected\*\* — every equation balances and every intermediate is carried over, and the target is formed\./);
  const withoutTarget = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.match(formatRouteAudit(withoutTarget), /\*\*Route checked: balanced and connected\*\* — every equation balances and every intermediate is carried over\./);
  assert.doesNotMatch(formatRouteAudit(withoutTarget), /and the target is formed/);
});

test('the route report shows the solved coefficients and flags a large balance', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [{
      index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      reactants: [{ input: 'citric', canonicalSmiles: 'citric', skeletonSmiles: 'citric', formula: 'C6H8O7', coefficient: 8 }],
      agents: [],
      products: [
        { input: 'adc', canonicalSmiles: 'adc', skeletonSmiles: 'adc', formula: 'C5H6O5', coefficient: 9 },
        { input: 'w', canonicalSmiles: 'w', skeletonSmiles: 'w', formula: 'H2O', coefficient: 5 },
        { input: 'co2', canonicalSmiles: 'co2', skeletonSmiles: 'co2', formula: 'CO2', coefficient: 3 },
      ],
    }],
    links: [],
  });
  const text = formatRouteAudit(audit);
  assert.match(text, /8 C6H8O7/);
  assert.match(text, /9 C5H6O5 \+ 5 H2O \+ 3 CO2/);
  assert.match(text, /carbon compounds balance only with large coefficients \(up to 9\)/);
  // An ordinary 1:1 balance shows the species without coefficients and no note.
  const small = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.doesNotMatch(formatRouteAudit(small), /large coefficients/);
});

test('the route review is given each species structure, not just its name', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' },
    { role: 'product', byproduct: false, name: 'sodium phenoxide', smiles: '[Na+].[O-]c1ccccc1' },
  ]];
  const audit = normalizeRouteAudit({ continuous: false, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  const request = buildRouteReviewRequest('Propose a synthesis of phenol.', labels, audit);
  assert.match(request, /phenol — `Oc1ccccc1`/);
  assert.match(request, /sodium phenoxide — `\[Na\+\]\.\[O-\]c1ccccc1`/);
  assert.match(ROUTE_REVIEW_SYSTEM, /regiochemistry/);
  assert.match(ROUTE_REVIEW_SYSTEM, /wrong ring or epoxide regioisomer/);
});

test('the route review is shown canonical SMILES, so an identical compound reads identically', () => {
  // PubChem writes tropinone as CN1C2CC(CC1CC2)=O; canonical is CN1C2CCC1CC(=O)C2, the target.
  // The review must see the canonical form, or it reads the same compound as a different one.
  const raw = 'CN1C2CC(CC1CC2)=O';
  const canonical = 'CN1C2CCC1CC(=O)C2';
  const step = passingStep(0, 'a>>b', [{ input: raw, canonicalSmiles: canonical, skeletonSmiles: canonical, formula: 'C8H13NO' }]);
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [step], links: [] });
  const labels = [[{ role: 'product', byproduct: false, name: '8-methyl-8-azabicyclo[3.2.1]octan-3-one', smiles: raw }]];
  const request = buildRouteReviewRequest('Propose a synthesis of tropinone.', labels, audit);
  assert.match(request, /8-methyl-8-azabicyclo\[3\.2\.1\]octan-3-one — `CN1C2CCC1CC\(=O\)C2`/);
  assert.doesNotMatch(request, /CN1C2CC\(CC1CC2\)=O/);
});

test('the route review is told SMILES identity is canonical and the target check is deterministic', () => {
  assert.match(ROUTE_REVIEW_SYSTEM, /canonical isomeric SMILES/);
  assert.match(ROUTE_REVIEW_SYSTEM, /Two identical SMILES strings are the same compound/);
  assert.match(ROUTE_REVIEW_SYSTEM, /do not report that step's product as a different compound/);
});

test('each step heading and its prose are read for the review, not just the species', () => {
  const answer = [
    '**Step 1 — Hydrolysis of 2,5-dimethoxytetrahydrofuran to succinaldehyde**',
    '',
    'The acetal opens under acid to give the dialdehyde.',
    '',
    'Reactants: 2,5-dimethoxytetrahydrofuran; water',
    '',
    '**Step 2 — Dehydration of citric acid to aconitic acid**',
    '',
    'Citric acid loses water to give the unsaturated triacid.',
    '',
    'Reactants: citric acid',
    '',
    '### Notes',
    '',
    'A closing paragraph that is not a step.',
  ].join('\n');
  const prose = findStepProse(answer, 2);
  assert.match(prose[0], /Hydrolysis of 2,5-dimethoxytetrahydrofuran to succinaldehyde/);
  assert.match(prose[0], /acetal opens under acid/);
  assert.doesNotMatch(prose[0], /Reactants/);
  assert.match(prose[1], /Dehydration of citric acid to aconitic acid/);
  assert.match(prose[1], /loses water/);
  assert.doesNotMatch(prose[1], /closing paragraph/);
});

test('the route review request carries each step description and says a named reaction is possible', () => {
  const labels = [[{ role: 'product', byproduct: false, name: 'aconitic acid', smiles: 'O=C(O)/C=C(C(=O)O)C(=O)O' }]];
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  const request = buildRouteReviewRequest('Propose a synthesis of tropinone.', labels, audit, ['Dehydration of citric acid to aconitic acid — citric acid loses water']);
  assert.match(request, /Step 1:/);
  assert.match(request, /Dehydration of citric acid to aconitic acid/);
  assert.match(request, /aconitic acid — `/);
  assert.match(ROUTE_REVIEW_SYSTEM, /dehydration, decarboxylation/);
});

test('a step that cannot be assembled is FAIL and named in the verdict', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1: the equation can only balance by taking more product molecules than the substrate molecules can form.'],
    steps: [{
      index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      assemblyProblem: 'the equation can only balance by taking more product molecules than the substrate molecules can form: 9 × C5H6O5 need 9 substrate molecules, but only 8 can each supply one',
      reactants: [], agents: [], products: [],
    }],
    links: [],
  });
  const text = formatRouteAudit(audit);
  assert.match(text, /\*\*Route check failed\*\* — [^.]*cannot be assembled from a single substrate molecule \(step 1\)/);
  assert.match(text, /- Step 1 FAIL — balanced\. .*need 9 substrate molecules/);
  // The large-coefficient note is redundant once the assembly reason is shown.
  assert.doesNotMatch(text, /large coefficients/);
  // The one-click prompts must name the same failure the report and verdict do, not only the
  // model review, or the chips point at a different step than the checker did.
  const labels = [[{ role: 'product', byproduct: false, name: '3-oxopentanedioic acid', smiles: 'O=C(O)CC(=O)CC(=O)O' }]];
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.match(chips[0].prompt, /The route checker rejected these steps:/);
  assert.match(chips[0].prompt, /- Step 1: the equation can only balance by taking more product molecules/);
  const stepChip = chips.find(chip => chip.label === 'Fix step 1');
  assert.ok(stepChip, 'the assembly step gets its own fix chip');
  assert.match(stepChip.prompt, /Step 1 was rejected: the equation can only balance/);
});

test('the rules say a consumed species is a Reactant, never an Agent', () => {
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /A[\s\S]*species the step consumes is a Reactant, never an Agent/);
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'butanedial', smiles: 'O=CCCC=O' },
    { role: 'product', byproduct: false, name: 'tropinone', smiles: 'CN1C2CCC1CC(=O)C2' },
  ]];
  const audit = normalizeRouteAudit({ continuous: false, blocked: ['Step 1 is not balanced.'], steps: [{ index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true, differences: ['x'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.match(chips[0].prompt, /A species the step consumes is a Reactant, never an Agent/);
  assert.match(chips[0].prompt, /lists every consumed species under Reactants and every released species under Byproducts/);
});

// ---------------------------------------------------------------- IUPAC names in the route

test('the route report shows the IUPAC names the answer gave', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [{ index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      reactants: [{ input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O' }],
      agents: [],
      products: [{ input: 'CC=O', canonicalSmiles: 'CC=O', formula: 'C2H4O' }] }],
    links: [],
  });
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' },
    { role: 'product', byproduct: false, name: 'ethanal', smiles: 'CC=O' },
  ]];
  const text = formatRouteAudit(audit, labels);
  assert.match(text, /ethanol \(C2H6O\) → ethanal \(C2H4O\)/);
  assert.equal(routeLabelNames(labels).get('CC=O'), 'ethanal');
});

test('a name that denotes another structure is reported, not silently accepted', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: [],
    steps: [{ index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      reactants: [{ canonicalSmiles: 'CCO', formula: 'C2H6O', name: 'ethanal', nameOk: false }], agents: [], products: [] }],
    links: [],
  });
  const text = formatRouteAudit(audit);
  assert.match(text, /Species names that do not match their structure/);
  assert.match(text, /reactant "ethanal" denotes a different structure than `CCO`/);
});

test('a step whose supplied name denotes another structure fails the check and is not drawn', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1: the IUPAC name "ethanal" denotes a different structure than `CCO` (C2H6O).'],
    steps: [{ index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      nameProblems: ['the IUPAC name "ethanal" denotes a different structure than `CCO` (C2H6O)'],
      reactants: [{ input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O', name: 'ethanal', nameOk: false }], agents: [], products: [] }],
    links: [],
  });
  assert.deepEqual(audit.steps[0].nameProblems, ['the IUPAC name "ethanal" denotes a different structure than `CCO` (C2H6O)']);
  const text = formatRouteAudit(audit);
  assert.match(text, /- Step 1 FAIL — balanced\. name check failed: the IUPAC name "ethanal"/);
});

test('the template asks for a systematic IUPAC name for every species and all four roles', () => {
  for (const role of ['Reactants:', 'Products:', 'Byproducts:', 'Agents:']) assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes(role));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('systematic IUPAC name'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('stereodescriptors'));
  // A worked multi-component example shows the roles, including two byproducts.
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('propanedioic acid'), 'the worked example is present');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('carbon dioxide; water'), 'and shows a step with two byproducts');
});

// ---------------------------------------------------------------- name-first derivation

const NAMED_ANSWER = [
  '**Step 1 — Monoalkylation of acetylene**',
  'Reactants: acetylene; sodium amide; bromoethane',
  'Products: but-1-yne',
  'Byproducts: ammonia; sodium bromide',
  'Agents: none',
  '',
  '**Step 2 — Lindlar semihydrogenation**',
  'Reactants: hex-3-yne; hydrogen',
  'Products: (Z)-hex-3-ene',
  'Agents: Lindlar catalyst',
].join('\n');

test('the step count comes from the headings or the role cycle', () => {
  assert.equal(countRouteSteps(NAMED_ANSWER), 2);
  assert.equal(countRouteSteps('Reactants: ethanol\nProducts: ethanal\nByproducts: hydrogen'), 1);
  assert.equal(countRouteSteps('Reactants: a\nProducts: b\nReactants: b\nProducts: c'), 2);
  assert.equal(countRouteSteps('no steps here'), 0);
});

test('a non-step section such as an alternative is neither counted nor grouped as a step', () => {
  const answer = [
    '**Step 1 — a**', 'Reactants: acetylene', 'Products: but-1-yne',
    '**Step 2 — b**', 'Reactants: but-1-yne', 'Products: hex-3-yne',
    '**Step 3 — c**', 'Reactants: hex-3-yne; hydrogen', 'Products: (Z)-hex-3-ene',
    '## Alternative for Step 3', 'Reactants: hex-3-yne; benzenesulfonylhydrazide', 'Products: (Z)-hex-3-ene',
  ].join('\n');
  assert.equal(countRouteSteps(answer), 3, 'the alternative does not become step 4');
  const species = findStepNamedSpecies(answer, 3);
  assert.deepEqual(species[2].map((entry) => entry.name), ['hex-3-yne', 'hydrogen', '(Z)-hex-3-ene'], 'the alternative\'s species are not merged into step 3');
});

test('a prose summary heading and a species-list heading for the same step are one step', () => {
  const answer = [
    '**Step 1 — Oxidation**', 'Product: cyclohexanone.', '',
    '### Species lists', '',
    '**Step 1**',
    '- Reactants: cyclohexanol',
    '- Products: cyclohexanone',
    '- Byproducts: chromium(III) sulfate; water',
    '- Agents: none', '',
    '**Step 2**',
    '- Reactants: cyclohexanone',
    '- Products: cyclohexanone oxime',
    '- Byproducts: none (the salt is removed; the product is neutralised)',
    '- Agents: none',
  ].join('\n');
  assert.equal(countRouteSteps(answer), 2, 'the prose heading does not create a phantom step');
  const species = findStepNamedSpecies(answer, 2);
  assert.deepEqual(species[0].map((entry) => entry.name), ['cyclohexanol', 'cyclohexanone', 'chromium(III) sulfate', 'water']);
  assert.deepEqual(species[1].map((entry) => entry.name), ['cyclohexanone', 'cyclohexanone oxime'], 'the "none (…; …)" byproduct yields nothing');
});

test('named species are read per step, per role, without any SMILES', () => {
  const species = findStepNamedSpecies(NAMED_ANSWER, 2);
  assert.deepEqual(species[0].map((entry) => [entry.role, entry.name]), [
    ['reactant', 'acetylene'], ['reactant', 'sodium amide'], ['reactant', 'bromoethane'],
    ['product', 'but-1-yne'], ['product', 'ammonia'], ['product', 'sodium bromide'],
  ]);
  assert.ok(species[0].filter((entry) => entry.byproduct).every((entry) => entry.byproduct === true), 'byproducts are flagged');
  // "Agents: none" yields no agent entries.
  assert.equal(species[0].filter((entry) => entry.role === 'agent').length, 0);
  assert.deepEqual(species[1].map((entry) => entry.name), ['hex-3-yne', 'hydrogen', '(Z)-hex-3-ene', 'Lindlar catalyst']);
  // A legacy `name — `smiles`` pair keeps the name and the declared SMILES as a fallback.
  const legacy = findStepNamedSpecies('Reactants: ethanol — `CCO`\nProducts: ethanal — `CC=O`', 1);
  assert.equal(legacy[0][0].name, 'ethanol');
  assert.equal(legacy[0][0].declaredSmiles, 'CCO');
  // A prose sentence that begins with a singular "Product:" is not a species label.
  const prose = findStepNamedSpecies('Reactants: acetylene\nProducts: but-1-yne\nProduct: but-1-yne is the product formed.', 1);
  assert.deepEqual(prose[0].map((entry) => entry.name), ['acetylene', 'but-1-yne']);
});

test('in-place annotation does not split a longer name or touch headings and prose', () => {
  const answer = [
    '**Step 1 — Oxidation of cyclohexanol**',
    'Reactants: cyclohexanol',
    'Products: cyclohexanone oxime',
  ].join('\n');
  const species = [[
    { role: 'reactant', byproduct: false, name: 'cyclohexanol', status: 'resolved', smiles: 'C1CCC(CC1)O' },
    { role: 'product', byproduct: false, name: 'cyclohexanone oxime', status: 'resolved', smiles: 'C1CCC(=NO)CC1' },
  ]];
  const out = annotateSpeciesSmiles(answer, species);
  assert.match(out, /Products: cyclohexanone oxime — `C1CCC\(=NO\)CC1`/);
  assert.doesNotMatch(out, /cyclohexanone — /, 'the product name is not split');
  assert.match(out, /\*\*Step 1 — Oxidation of cyclohexanol\*\*/, 'the heading is untouched');
});

test('a species written as a bare SMILES is recognised, but a systematic name is never mistaken for one', () => {
  // Only ever asked of a name that already failed to resolve. Some species have no resolvable
  // name, so under load the model gives the structure alone and the step was being discarded
  // over the formatting while the structure sat right there.
  assert.ok(isBareSmilesName('O=C(O)[C@@H](CCCCNC(C)=O)NC(=O)OCC1c2ccccc2-c2ccccc21'), 'a protected intermediate');
  assert.ok(isBareSmilesName('C=C1c2ccccc2-c2ccccc21'), 'dibenzofulvene');
  assert.ok(isBareSmilesName('*OC(=O)CN'), 'a species on a solid support, written with *');
  // A real systematic name passes the shape test too, which is why this is only consulted after
  // resolution has failed — never to pre-empt it.
  assert.ok(!isBareSmilesName('ethanol'), 'no structural characters');
  assert.ok(!isBareSmilesName('2-methylbutanoic acid'), 'a name with a space is never a SMILES');
  assert.ok(!isBareSmilesName('=O'), 'a quoted fragment is not a species');
  // Numbered systematic names all satisfy the looser shape test used to find candidates in prose,
  // because a locant digit reads as a ring closure. They must not reach the declared-structure
  // path: when a reference service is merely unreachable, adopting the name as its own structure
  // replaces a precise "this name could not be resolved" with a route of unparseable steps.
  for (const name of ['2-methylbutan-2-ol', 'cyclohex-2-en-1-one', 'benzene-1,2-diamine',
    '4-nitrophenol', 'bornan-2-ol', 'N,N-dimethylformamide', '2,3-dibromobutane',
    '(1R,5R)-2,6,6-trimethylbicyclo[3.1.1]hept-2-ene']) {
    assert.ok(!isBareSmilesName(name), `a systematic name is not a structure: ${name}`);
  }
  // A hyphen is an explicit single bond, not a locant: a biaryl linkage is still a structure.
  assert.ok(isBareSmilesName('C=C1c2ccccc2-c2ccccc21'));
  assert.ok(isBareSmilesName('[Na+].[Cl-]'), 'a charge inside a bracket atom is not punctuation');
});

test('reaction lines are derived from resolved species, never the model', () => {
  const resolved = [[
    { role: 'reactant', byproduct: false, name: 'acetylene', status: 'resolved', smiles: 'C#C', source: 'pubchem' },
    { role: 'reactant', byproduct: false, name: 'sodium amide', status: 'resolved', smiles: '[NH2-].[Na+]', source: 'pubchem' },
    { role: 'product', byproduct: false, name: 'but-1-yne', status: 'resolved', smiles: 'CCC#C', source: 'pubchem' },
    { role: 'product', byproduct: true, name: 'ammonia', status: 'resolved', smiles: 'N', source: 'pubchem' },
    { role: 'agent', byproduct: false, name: 'tetrahydrofuran', status: 'resolved', smiles: 'C1CCOC1', source: 'pubchem' },
  ]];
  assert.deepEqual(buildRouteSteps(resolved), ['C#C.[NH2-].[Na+]>C1CCOC1>CCC#C.N']);
  // A step with no resolvable reactant cannot form an equation; it stays as an empty line so the
  // steps after it keep their numbers.
  assert.deepEqual(buildRouteSteps([[{ role: 'product', byproduct: false, name: 'x', status: 'unresolved' }]]), ['']);
  // One unresolved reactant or product empties the whole step, rather than leaving the rest to be
  // checked as an equation nobody wrote: a ring closure whose precursor and product were name-only
  // came back as "oxygen -> water" and failed for want of H2.
  const partial = [[
    { role: 'reactant', byproduct: false, name: 'the long precursor', status: 'unresolved' },
    { role: 'reactant', byproduct: false, name: 'oxygen', status: 'resolved', smiles: '[O]', source: 'pubchem' },
    { role: 'product', byproduct: false, name: 'the macrocycle', status: 'resolved', smiles: 'C1CCCCC1', source: 'pubchem' },
    { role: 'product', byproduct: true, name: 'water', status: 'resolved', smiles: 'O', source: 'pubchem' },
  ]];
  assert.deepEqual(buildRouteSteps(partial), ['']);
  // An agent that does not resolve is still only a condition: it is dropped and the step checked.
  const unresolvedAgent = [[
    { role: 'reactant', byproduct: false, name: 'acetylene', status: 'resolved', smiles: 'C#C', source: 'pubchem' },
    { role: 'product', byproduct: false, name: 'but-1-yne', status: 'resolved', smiles: 'CCC#C', source: 'pubchem' },
    { role: 'agent', byproduct: false, name: 'aqueous buffer, pH 8', status: 'unresolved' },
  ]];
  assert.deepEqual(buildRouteSteps(unresolvedAgent), ['C#C>>CCC#C']);
});

test('precedent queries leave byproducts out, as the Open Reaction Database records the main product', () => {
  const labels = [
    [
      { role: 'reactant', byproduct: false, name: 'salicylic acid', smiles: 'O=C(O)c1ccccc1O' },
      { role: 'reactant', byproduct: false, name: 'acetic anhydride', smiles: 'CC(=O)OC(C)=O' },
      { role: 'agent', byproduct: false, name: 'sulfuric acid', smiles: 'OS(=O)(=O)O' },
      { role: 'product', byproduct: false, name: 'aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
      { role: 'product', byproduct: true, name: 'acetic acid', smiles: 'CC(=O)O' },
    ],
    // Every product marked a byproduct: keep them rather than lose the step.
    [
      { role: 'reactant', byproduct: false, name: 'a', smiles: 'CCO' },
      { role: 'product', byproduct: true, name: 'b', smiles: 'CC=O' },
    ],
  ];
  assert.deepEqual(buildPrecedentQueries(labels), [
    { step: 0, query: 'O=C(O)c1ccccc1O.CC(=O)OC(C)=O>OS(=O)(=O)O>CC(=O)Oc1ccccc1C(=O)O' },
    { step: 1, query: 'CCO>>CC=O' },
  ]);
  // An unusable step is left out without renumbering the steps after it.
  const gap = [[{ role: 'product', byproduct: false, name: 'x', smiles: 'C' }], labels[1]];
  assert.deepEqual(buildPrecedentQueries(gap), [{ step: 1, query: 'CCO>>CC=O' }]);
});

test('two salts sharing an ion each keep their own stoichiometry', () => {
  // This used to write each distinct ion once and leave the counts to the solver, so that a
  // shared ion could not appear twice on one side. It read as tidy and it threw away what the
  // author had actually declared: chromium(III) sulfate's own 2:3 ratio became one chromium and
  // one sulfate, and the solver re-derived whatever numbers balanced. The same freedom let a
  // wrong equation balance elsewhere -- a hydrolysis one hydrogen short came back balanced by
  // taking two of one reagent -- because a free ion's coefficient is the solver's to choose.
  //
  // Now every fragment of every species is written out, and the package regroups them from the
  // labels so each DECLARED species takes one coefficient. The ratio the author wrote survives.
  const sulfate = 'S(=O)(=O)([O-])[O-]';
  const chromiumSulfate = `${sulfate}.[Cr+3].${sulfate}.${sulfate}.[Cr+3]`;
  const sodiumSulfate = `${sulfate}.[Na+].[Na+]`;
  const resolved = [[
    { role: 'reactant', byproduct: false, name: 'sodium dichromate', status: 'resolved', smiles: '[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-].[Na+].[Na+]' },
    { role: 'reactant', byproduct: false, name: 'cyclohexanol', status: 'resolved', smiles: 'C1CCC(CC1)O' },
    { role: 'product', byproduct: false, name: 'chromium(III) sulfate', status: 'resolved', smiles: chromiumSulfate },
    { role: 'product', byproduct: false, name: 'sodium sulfate', status: 'resolved', smiles: sodiumSulfate },
  ]];
  const [step] = buildRouteSteps(resolved);
  assert.equal(step.split('>')[2], `${chromiumSulfate}.${sodiumSulfate}`, 'each salt contributes its own fragments, in order');
  const products = step.split('>')[2].split('.');
  assert.equal(products.filter((part) => part === sulfate).length, 4, 'three sulfates from one salt and one from the other');
  assert.equal(products.filter((part) => part === '[Cr+3]').length, 2);
  assert.equal(products.filter((part) => part === '[Na+]').length, 2);
});

test('the resolved SMILES is attached to the name in place, replacing any declared one', () => {
  const species = [[
    { role: 'reactant', byproduct: false, name: 'but-1-yne', status: 'resolved', smiles: 'CCC#C' },
    { role: 'product', byproduct: false, name: '(Z)-hex-3-ene', status: 'resolved', smiles: 'CC/C=C\\CC' },
  ]];
  const bare = annotateSpeciesSmiles('Reactants: but-1-yne\nProducts: (Z)-hex-3-ene', species);
  assert.match(bare, /but-1-yne — `CCC#C`/);
  assert.match(bare, /\(Z\)-hex-3-ene — `CC\/C=C\\CC`/);
  const legacy = annotateSpeciesSmiles('Reactants: but-1-yne — `C#CC`', species);
  assert.match(legacy, /but-1-yne — `CCC#C`/);
  assert.doesNotMatch(legacy, /C#CC/);
});

test('corrections are summarized for the user, and the feedback prompt parses', () => {
  assert.equal(formatNameCorrectionNote([]), '', 'nothing corrected prints nothing');
  assert.equal(formatNameCorrectionNote(['sodium but-1-ynide → sodium but-1-yn-1-ide']), 'Name corrections: sodium but-1-ynide → sodium but-1-yn-1-ide');
  assert.equal(formatNameCorrectionNote(['tropinone → tropinone']), '', 'a name corrected to itself is not shown');
  // A name corrected over two attempts reads once, as the first name to the final one.
  assert.equal(
    formatNameCorrectionNote(['aconitic acid → trans-aconitic acid', 'trans-aconitic acid → (E)-prop-1-ene-1,2,3-tricarboxylic acid']),
    'Name corrections: aconitic acid → (E)-prop-1-ene-1,2,3-tricarboxylic acid');
  // A reply that smuggled SVG or JSON syntax into a "name" is not echoed to the user.
  assert.equal(formatNameCorrectionNote(['</text> <text x="130" class="label">citric acid</text> → 2-hydroxypropane-1,2,3-tricarboxylic acid']), '');

  const parsed = parseNameFeedback('{"names":[{"from":"sodium but-1-ynide","to":"sodium but-1-yn-1-ide"}]}');
  assert.deepEqual(parsed, [{ from: 'sodium but-1-ynide', to: 'sodium but-1-yn-1-ide', kind: 'name' }]);
  // The model may answer with a structure when it cannot name the species.
  assert.deepEqual(
    parseNameFeedback('{"names":[{"from":"Eaton photodimer","smiles":"BrC12CCC(OCCO1)C1(Br)CCC3(OCCO3)C21"}]}'),
    [{ from: 'Eaton photodimer', to: 'BrC12CCC(OCCO1)C1(Br)CCC3(OCCO3)C21', kind: 'structure' }]);
  assert.deepEqual(parseNameFeedback(JSON.stringify({ names: [{ from: '</text>\\n <text x="130">citric acid</text>', to: 'citric acid' }] })), [], 'markup is not a name');
  assert.deepEqual(parseNameFeedback('not json'), []);
  assert.ok(ROUTE_NAME_FEEDBACK_SYSTEM.includes('sodium but-1-yn-1-ide'), 'the systematic salt example is in the prompt');

  const fence = formatUnresolvedNameClarification([{ step: 1, role: 'reactant', byproduct: false, name: 'sodium but-1-ynide', feedback: 'PubChem has no exact match.' }]);
  const payload = fixPayload(fence);
  assert.equal(payload.label, 'Confirm the intended structure');
  assert.match(payload.prompt, /sodium but-1-ynide/);
});

test('an author-supplied structure is disclosed, and the feedback prompt offers the fallback', () => {
  assert.equal(formatAuthorStructureNote([]), '', 'nothing supplied prints nothing');
  assert.match(formatAuthorStructureNote(['Eaton photodimer — `BrC12CCC1`']), /Author-supplied structures.*Eaton photodimer/);
  // The prompt tells the model it may answer with a structure when it cannot name the species.
  assert.match(ROUTE_NAME_FEEDBACK_SYSTEM, /Give the STRUCTURE instead/);
  assert.match(ROUTE_NAME_FEEDBACK_SYSTEM, /"smiles"/);
});

const routeFixChips = (text) => splitChatVisuals(text).filter((part) => part.kind === 'route-fix').map((part) => JSON.parse(part.content));

test('a route derived from names is corrected with a names-only chip set, never a SMILES', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' },
    { role: 'reactant', byproduct: false, name: 'sodium hydroxide', smiles: '[Na+].[OH-]' },
    { role: 'product', byproduct: false, name: 'sodium phenoxide', smiles: '[Na+].[O-]c1ccccc1' },
    { role: 'agent', byproduct: false, name: 'water', smiles: 'O' },
  ]];
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1 is not balanced.'],
    steps: [{ index: 0, reaction: 'x', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 7, products 8'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }],
    links: [],
  });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.deepEqual(chips.map((chip) => chip.label), ['Ask the model to fix the failed steps', 'Fix from the target backwards', 'Fix step 1']);
  for (const chip of chips) {
    assert.match(chip.prompt, /Do not write SMILES/);
    assert.doesNotMatch(chip.prompt, /oc1ccccc1|\[Na\+\]\.\[OH-\]/, 'no derived SMILES is shown to the model');
  }
  assert.match(chips[0].prompt, /Reactants: phenol; sodium hydroxide/);
  assert.match(chips[0].prompt, /Products: sodium phenoxide/);
  assert.match(chips[0].prompt, /You may split a rejected step, combine it with a neighbour \(see the rules below\), insert a missing step, or remove a step/, 'fix-all may re-plan');
  for (const chip of chips) {
    assert.match(chip.prompt, /What may change:/, `${chip.label} states what it may change`);
    assert.doesNotMatch(chip.prompt, /\bmerg/i, `${chip.label} says "combine", never "merge"`);
  }
  assert.match(chips[1].prompt, /the one correction that may rename a species in a step that already passes/);
  assert.match(chips[2].prompt, /What may change: only step 1\./);
  assert.match(chips[1].prompt, /Work backwards from the final step/);
  assert.match(chips[2].prompt, /Step 1 was rejected: not balanced/);
  assert.match(chips[2].prompt, /You may split step 1 into consecutive steps, or combine it with an adjacent step/);
  // A route whose steps all pass yields no chip.
  const clean = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'x')], links: [] });
  assert.equal(formatNamedRouteFixPrompts(labels, clean), '');
});

test('every flagged step gets a chip, emitted last-first, and passing steps get none', () => {
  const labels = Array.from({ length: 6 }, (_, index) => [
    { role: 'reactant', byproduct: false, name: `reactant ${index + 1}`, smiles: `C${index + 1}` },
    { role: 'product', byproduct: false, name: `product ${index + 1}`, smiles: `O${index + 1}` },
  ]);
  const audit = normalizeRouteAudit({
    continuous: false, isolated: [1],
    steps: [
      passingStep(0, 'a>>b'),
      { index: 1, reaction: 'b>>c', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
      passingStep(2, 'c>>d'),
      { index: 3, reaction: 'd>>e', ok: true, balanced: false, chargeBalanced: true, differences: ['C: reactants 9, products 8'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
      passingStep(4, 'e>>f'),
      { index: 5, reaction: 'f>>g', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 8, products 10'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
    ],
    links: [],
  });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.deepEqual(chips.map((chip) => chip.label), [
    'Ask the model to fix the failed steps',
    'Fix from the target backwards',
    'Fix step 6',
    'Fix step 4',
    'Fix step 2',
  ]);
  // The disconnected-but-balanced step 2 is offered; passing steps 3 and 5 are not.
  assert.match(chips[4].prompt, /Step 2 was rejected: disconnected from the rest of the route/);
  assert.match(chips[2].prompt, /Step 6 was rejected: not balanced/);
  assert.match(chips[2].prompt, /Step 5 Products: product 5/, 'the previous step is given as context');
  assert.match(chips[2].prompt, /It is the last step/, 'the last step is told to name the target');
  assert.match(chips[3].prompt, /Step 5 Reactants: reactant 5/, 'the next step is given as context');
});

test('a review-only block still offers chips, with the review findings folded in', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: '2-hydroxybenzoic acid', smiles: 'O=C(O)c1ccccc1O' },
    { role: 'product', byproduct: false, name: '2-acetylsalicylic acid', smiles: 'CC(=O)C1(O)C=CC=CC1C(=O)O' },
  ], [
    { role: 'reactant', byproduct: false, name: 'starting material', smiles: 'C' },
    { role: 'product', byproduct: false, name: 'final product', smiles: 'CC' },
  ]];
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b'), passingStep(1, 'b>>c')], links: [] });
  const review = parseRouteReview(JSON.stringify({ status: 'problems', problems: [
    { step: 1, severity: 'blocking', detail: '"2-acetylsalicylic acid" is a different compound than the requested target.' },
    { step: 0, severity: 'advisory', detail: 'the route methylates and then demethylates without need.' },
  ] }));
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit, review));
  assert.deepEqual(chips.map((chip) => chip.label), ['Ask the model to fix the failed steps', 'Fix from the target backwards', 'Fix step 1']);
  assert.match(chips[0].prompt, /A model review of the route plan also reported:/);
  assert.match(chips[0].prompt, /Step 1: "2-acetylsalicylic acid" is a different compound/);
  assert.doesNotMatch(chips[0].prompt, /demethylates without need/, 'an advisory finding never joins a fix request');
  assert.match(chips[2].prompt, /Step 1 was rejected: review: "2-acetylsalicylic acid" is a different compound/);
});

test('the backwards correction names the requested target with its structure', () => {
  const smiles = 'CC(C)Cc1ccc(cc1)C(C)C(=O)O';
  const labels = [[
    { role: 'reactant', byproduct: false, name: '1-(2-methylpropyl)benzene', smiles: 'CC(C)Cc1ccccc1' },
    { role: 'product', byproduct: false, name: '2-[4-(2-methylpropyl)phenyl]propanoic acid', smiles },
  ]];
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1 is not balanced.'],
    steps: [{
      index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 1, products 2'], unspecifiedStereocentres: 0,
      reactants: [], agents: [],
      products: [{ input: smiles, canonicalSmiles: smiles, skeletonSmiles: smiles, formula: 'C13H18O2', charge: 0, heavyAtoms: 15, stereocentres: 0, unspecifiedStereocentres: 0, name: '2-[4-(2-methylpropyl)phenyl]propanoic acid', nameOk: true }],
    }],
    target: { input: smiles, canonicalSmiles: smiles, formula: 'C13H18O2', formedAt: 0, reason: 'formed' },
    links: [],
  });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  const back = chips.find((chip) => chip.label === 'Fix from the target backwards');
  assert.match(back.prompt, /name the requested target \(2-\[4-\(2-methylpropyl\)phenyl\]propanoic acid, canonical SMILES `/);
  assert.ok(back.prompt.includes('`' + smiles + '`'), 'the target SMILES anchors the name');
  assert.match(back.prompt, /\) as a Product\./);
  assert.match(chips[0].prompt, /The route must still reach the requested target \(2-\[4-\(2-methylpropyl\)phenyl\]propanoic acid, canonical SMILES `/);
  // With no target in the audit the sentence is unchanged.
  const bare = normalizeRouteAudit({ continuous: false, blocked: ['Step 1 is not balanced.'], steps: [{ index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true, differences: ['x'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  const plain = routeFixChips(formatNamedRouteFixPrompts(labels, bare)).find((chip) => chip.label === 'Fix from the target backwards');
  assert.match(plain.prompt, /name the requested target as a Product\./);
  // The target drawing quotes the request's own target, so the drawing tool accepts it; with no
  // target the correction asks for no drawing rather than one that would be refused.
  assert.ok(back.prompt.includes(`The requested target, exactly as the original request gave it: \`${smiles}\`.`));
  assert.ok(back.prompt.includes(`"input":{"kind":"smiles","value":"${smiles}"}`));
  assert.match(plain.prompt, /Do not emit a chemistry-plan block in this correction/);
});

test('the first request and every correction carry the same species rules, once', () => {
  const rules = SYNTHESIS_TEMPLATE_ADDENDUM.split('\n').filter((line) => line.startsWith('   - ')).map((line) => line.slice(5));
  assert.ok(rules.length >= 10, 'the contract lists the shared rules');
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' },
    { role: 'product', byproduct: false, name: 'sodium phenoxide', smiles: '[Na+].[O-]c1ccccc1' },
  ]];
  const audit = normalizeRouteAudit({ continuous: false, blocked: ['Step 1 is not balanced.'], steps: [{ index: 0, reaction: 'x', ok: true, balanced: false, chargeBalanced: true, differences: ['x'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  const prompts = [
    ...routeFixChips(formatNamedRouteFixPrompts(labels, audit)).map((chip) => chip.prompt),
    fixPayload(formatMissingSpeciesPrompt('CCO')).prompt,
    fixPayload(formatUnresolvedNameClarification([{ step: 1, role: 'reactant', byproduct: false, name: 'x' }], 'CCO')).prompt,
  ];
  for (const prompt of prompts) {
    for (const rule of rules) {
      const count = prompt.split(rule).length - 1;
      assert.equal(count, 1, `each rule appears exactly once in: ${prompt.slice(0, 60)}`);
    }
  }
  // The two prompts without an audit still quote the request's target for the drawing.
  assert.ok(prompts.at(-2).includes('exactly as the original request gave it: `CCO`'));
  assert.ok(prompts.at(-1).includes('exactly as the original request gave it: `CCO`'));
  assert.match(prompts.at(-1), /What may change: only those names/);
});

test('a route with no species lists offers a one-click prompt to add them', () => {
  const fence = formatMissingSpeciesPrompt();
  const payload = fixPayload(fence);
  assert.equal(payload.label, 'Ask the model to list the species');
  assert.match(payload.prompt, /Reactants:/);
  assert.match(payload.prompt, /systematic IUPAC name/);
  assert.ok(splitChatVisuals(fence).some((part) => part.kind === 'route-fix'), 'the interface can render it');
});

test('replayed history keeps the app route reports for the latest answer only', () => {
  const answer = [
    '## Route', 'Step 1 prose.', '',
    '### Structure check (RDKit)', '', 'Every SMILES below was parsed.', '',
    '### Route check (RDKit)', '', '- Step 1 FAIL — not balanced', '',
    '### Route drawings (RDKit)', '', '**Step 1**', '', 'Not drawn:', '- Step 2 — not balanced', '',
    '### Known reactions (Open Reaction Database)', '', '- ✔ Exact match', '',
    'Name corrections: salicylic acid → 2-hydroxybenzoic acid',
  ].join('\n');
  const latest = routeReportsForHistory(answer, true);
  assert.match(latest, /### Route check/, 'the latest route report is kept');
  assert.match(latest, /### Structure check/);
  assert.doesNotMatch(latest, /Route drawings|\*\*Step 1\*\*|Not drawn/, 'drawing leftovers are never replayed');
  assert.match(latest, /### Known reactions/);
  assert.match(latest, /Name corrections: salicylic acid/, 'the app note after the reports survives');
  const earlier = routeReportsForHistory(answer, false);
  assert.doesNotMatch(earlier, /Route check|Structure check|FAIL/, 'a superseded report is not re-sent');
  assert.match(earlier, /Step 1 prose\./, 'the model\'s own prose is kept');
  assert.match(earlier, /Name corrections:/);
});

test('carbon is found only where the SMILES has a carbon atom', () => {
  for (const smiles of ['C', 'c1ccccc1', '[C@@H](O)F', '[cH]1ccccc1', 'O=C=O', '[13CH4]']) assert.ok(smilesHasCarbon(smiles), smiles);
  for (const smiles of ['[Na+].[Cl-]', 'O', 'Cl', '[Ca+2]', '[Cs+]', 'O=S(=O)(O)O', '[Co]', 'Br', '[Na+].[OH-]']) assert.ok(!smilesHasCarbon(smiles), smiles);
});

test('an inorganic co-product listed as a Product becomes a byproduct, and the equation is unchanged', () => {
  // The fix-turn step the model wrote: NaCl beside salicylic acid under Products.
  const step = [
    { role: 'reactant', byproduct: false, name: 'sodium phenoxide', smiles: '[Na+].[O-]c1ccccc1' },
    { role: 'reactant', byproduct: false, name: 'carbon dioxide', smiles: 'O=C=O' },
    { role: 'reactant', byproduct: false, name: 'hydrogen chloride', smiles: 'Cl' },
    { role: 'product', byproduct: false, name: 'salicylic acid', smiles: 'O=C(O)c1ccccc1O' },
    { role: 'product', byproduct: false, name: 'sodium chloride', smiles: '[Cl-].[Na+]' },
    { role: 'agent', byproduct: false, name: 'water', smiles: 'O' },
  ];
  const classified = classifyCoProducts(step);
  assert.equal(classified.find((entry) => entry.name === 'sodium chloride').byproduct, true, 'NaCl is a byproduct');
  assert.equal(classified.find((entry) => entry.name === 'salicylic acid').byproduct, false, 'the organic product stays the product');
  assert.equal(classified.find((entry) => entry.name === 'water').byproduct, false, 'an agent is untouched');
  // Balancing reads roles only: the equation handed to the checker is byte-identical.
  assert.deepEqual(buildRouteSteps([classified]), buildRouteSteps([step]));
  // A step whose only product is inorganic keeps it: there is nothing else to call the product.
  const inorganic = [{ role: 'reactant', byproduct: false, name: 'x', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'water', smiles: 'O' }];
  assert.equal(classifyCoProducts(inorganic)[1].byproduct, false);
});

test('a checker message reaches the correction prompt whole', () => {
  const message = 'The declared species cannot be balanced: "Na", "OH", "H2O" take(s) no part (coefficient 0), so the equation balances only if those molecules are removed. Delete the molecule the step neither consumes nor produces — water and a solvent are the usual ones.';
  const audit = normalizeRouteAudit({ continuous: false, blocked: ['x'], steps: [{ index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true, differences: [message], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  assert.equal(audit.steps[0].differences[0], message, 'no truncation at 200 characters');
  const labels = [[{ role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' }, { role: 'product', byproduct: false, name: 'salicylic acid', smiles: 'O=C(O)c1ccccc1O' }]];
  const chip = routeFixChips(formatNamedRouteFixPrompts(labels, audit)).find((entry) => entry.label === 'Fix step 1');
  assert.ok(chip.prompt.includes('water and a solvent are the usual ones.'), 'the instruction at the end survives');
});

test('the route review blocks a workup folded into another transformation', () => {
  assert.match(ROUTE_REVIEW_SYSTEM, /folds a separate workup into a different transformation/);
  assert.match(ROUTE_REVIEW_SYSTEM, /Kolbe–Schmitt carboxylation and the acidification/);
  assert.match(ROUTE_REVIEW_SYSTEM, /one-pot cascade such as the Robinson tropinone synthesis is one step/, 'true cascades stay allowed');
});

test('the first request draws the target from its SMILES when the request gives one', () => {
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /If my request gives the\s+target's SMILES, use it \(kind "smiles"\)/);
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('"input":{"kind":"smiles","value":"EXACT TARGET SMILES FROM MY REQUEST"}'));
});

test('an unbuildable step keeps every later step on its own number', () => {
  const species = (reactant, product) => [
    { role: 'reactant', byproduct: false, name: reactant, smiles: reactant },
    { role: 'product', byproduct: false, name: product, smiles: product },
  ];
  const resolved = [species('CCO', 'CC=O'), [{ role: 'product', byproduct: false, name: 'unknown', status: 'unresolved' }], species('CC=O', 'CC(=O)O')];
  const steps = buildRouteSteps(resolved);
  assert.equal(steps.length, 3, 'one line per step');
  assert.equal(steps[1], '', 'the unbuilt step is an empty line');
  assert.equal(steps[2], 'CC=O>>CC(=O)O', 'step 3 is still at index 2');
});

test('the report, the drawings and the corrections share one step verdict', () => {
  const assembled = { index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [], assemblyProblem: 'the equation can only balance by taking more product molecules' };
  assert.equal(routeStepFailure(assembled), assembled.assemblyProblem, 'an assembly problem fails the step (so it is not drawn)');
  assert.equal(routeStepFailure(passingStep(0, 'a>>b')), null);
  assert.match(routeStepFailure({ ...passingStep(0, 'a>>b'), ok: false, error: 'This step could not be built' }), /could not be built/);
});

test('the shared rules keep a workup as its own step, as the review requires', () => {
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /A workup — an acidification, basification or quench .* is always its own step/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /except in the single structure fallback below and the one target chemistry-plan/);
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /In a route, do not write a reaction SMILES/, 'single-reaction drawings stay allowed');
});

test('history drops the review and known reactions of superseded answers, and repeated correction rules', () => {
  const answer = ['## Route', 'prose', '', '### Route check (RDKit)', '- Step 1 OK', '', '### Route review (model)', '- Step 1: folded workup', '', 'Not verified: The route review raised 1 problem(s).', '', '### Known reactions (Open Reaction Database)', '- ✔ Exact match'].join('\n');
  const earlier = routeReportsForHistory(answer, false);
  assert.doesNotMatch(earlier, /Route review|folded workup|Not verified|Known reactions/);
  const latest = routeReportsForHistory(answer, true);
  assert.match(latest, /Route review/);
  assert.match(latest, /Known reactions/);
  const correction = 'Correction needed for step 2 of the synthesis route above.\n\nStep 2 was rejected: x\n\nWhat may change: only step 2.\nRules for every step:\n- rule one\n- rule two';
  const replayed = routeFixPromptForHistory(correction);
  assert.match(replayed, /Step 2 was rejected: x/);
  assert.match(replayed, /What may change: only step 2\./);
  assert.doesNotMatch(replayed, /rule one/);
  assert.equal(routeFixPromptForHistory('Why is step 2 slow?'), 'Why is step 2 slow?', 'an ordinary message is untouched');
});

test('the interim report says checks passed, not verified, while the review runs', () => {
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.match(formatRouteAudit(audit, [], null, true), /\*\*Route checks passed\*\*.*The model review is still running\./);
  assert.doesNotMatch(formatRouteAudit(audit, [], null, true), /Route checked: balanced/);
  assert.match(formatRouteAudit(audit, [], null), /\*\*Route checked: balanced and connected\*\*/);
  assert.match(formatRouteCheckUnavailable('worker crashed'), /Route check unavailable: worker crashed\. The route above has not been checked\./);
});

test('conditions and prose are read inside each step, not by position', () => {
  const answer = [
    '## Summary', '', 'Reaction conditions: see each step.', '',
    '### Step 1 — Oxidation of ethanol', 'Ethanol is oxidised to ethanal.', '',
    'Reactants: ethanol; oxygen', 'Products: ethanal', 'Byproducts: water', 'Agents: none', '',
    '### Step 2 — Oxidation of ethanal', 'Ethanal is oxidised further.', 'Reagents and conditions: KMnO4, H2O, 25 °C', '',
    'Reactants: ethanal; oxygen', 'Products: ethanoic acid', 'Byproducts: none', 'Agents: none',
  ].join('\n');
  // Step 1 has no conditions line; the summary line above it must not be taken for step 1, and
  // step 2's line must stay on step 2.
  const conditions = findStepConditions(answer, 2);
  assert.equal(conditions[0], '', 'step 1 has no conditions of its own');
  assert.match(conditions[1], /KMnO4/, 'step 2 keeps its own conditions');
  const prose = findStepProse(answer, 2);
  assert.match(prose[0], /^Step 1 — Oxidation of ethanol — Ethanol is oxidised to ethanal\./);
  assert.match(prose[1], /^Step 2 — Oxidation of ethanal/);
});

test('a named new route never inherits a different target, including Spanish requests', () => {
  const aspirin = 'Propose a synthesis of aspirin (SMILES: CC(=O)Oc1ccccc1C(=O)O).';
  const correction = `${ROUTE_FIX_PROMPT_LEAD}\nFix step 1.`;
  for (const request of [
    'Now a synthesis of paracetamol.', 'A preparation of paracetamol, please.',
    'What about a route to paracetamol?', 'I need a synthesis of paracetamol.',
    'Ahora quiero una ruta de síntesis de paracetamol.', 'Preparación de paracetamol.',
    'Quiero sintetizar paracetamol.', 'Ahora una ruta para paracetamol.',
  ]) {
    assert.equal(requestedTargetFor([aspirin, request]), null, request);
    assert.equal(requestedTargetFor([aspirin, request, correction]), null, `a correction must not cross the new request: ${request}`);
  }
  assert.equal(requestedTargetFor([aspirin, 'Propón una síntesis de etanol (SMILES: CCO).']), 'CCO');
  assert.equal(findRequestedTarget('Síntesis de paracetamol a partir de fenol (SMILES: Oc1ccccc1).'), null);
  for (const followup of ['Why does the synthesis need step 2?', '¿Por qué es necesario el paso 2?', 'What temperature should step 1 use?']) {
    assert.equal(requestedTargetFor([aspirin, followup]), 'CC(=O)Oc1ccccc1C(=O)O');
  }
});

test('correction drawing plans preserve backslashes in stereochemical SMILES', () => {
  const target = 'C/C=C\\C';
  const prompt = fixPayload(formatMissingSpeciesPrompt(target)).prompt;
  const json = prompt.match(/chemistry-plan with (\{.*\}), copying/)[1];
  assert.equal(JSON.parse(json).species[0].input.value, target);
});

const ORD_A = 'ord-72c311ce8dea41689de4d74d72468e40';
const ORD_B = 'ord-67c6c6df753946089bb72c3d48ece67a';

test('reaction precedent is normalized defensively', () => {
  const precedent = normalizeReactionPrecedent({
    reactions: [
      { input: 'a>>b', key: 'k', count: 3, samples: [ORD_A, 'not-an-id', ORD_B], reaction: 'CC(=O)OC(C)=O.O=C(O)c1ccccc1O>>CC(=O)Oc1ccccc1C(=O)O' },
      { input: '', count: 1 }, 'junk',
      { input: 'c>>d', count: 1, form: 'rm -rf', reaction: 'rm -rf / >> x' },
    ],
    products: [{ input: 'b', count: 5, keys: ['k1', 'k2'] }],
    similar: [{ input: 'a>>b', neighbors: [
      { key: 'k1', distance: 4, count: 2, similarity: 0.82, reaction: 'CO>>C=O', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      { count: 1 },
      { key: 'k2', distance: 9, count: 1, similarity: 7 },
    ] }],
  });
  assert.ok(precedent);
  assert.equal(precedent.reactions.length, 2, 'an empty input and a non-object are dropped');
  assert.deepEqual(precedent.reactions[0].samples, [ORD_A, ORD_B], 'only Open Reaction Database ids survive');
  assert.equal(precedent.reactions[0].reaction, 'CC(=O)OC(C)=O.O=C(O)c1ccccc1O>>CC(=O)Oc1ccccc1C(=O)O');
  assert.equal(precedent.reactions[1].form, undefined, 'an unknown form is dropped');
  assert.equal(precedent.reactions[1].reaction, undefined, 'a reaction that is not SMILES is dropped');
  assert.equal(precedent.products[0].count, 5);
  assert.equal(precedent.similar[0].neighbors.length, 2, 'a neighbor without a key is dropped');
  assert.equal(precedent.similar[0].neighbors[0].similarity, 0.82);
  assert.equal(precedent.similar[0].neighbors[1].similarity, undefined, 'a similarity outside 0..1 is dropped');
  assert.ok(precedent.similar[0].neighbors[0].svg.startsWith('<svg'), 'a drawing is kept with its reaction');
  const oddSvg = normalizeReactionPrecedent({ similar: [{ input: 'a>>b', neighbors: [
    { key: 'k', distance: 1, count: 1, reaction: 'CO>>C=O', svg: '<script>alert(1)</script>' },
    { key: 'k', distance: 1, count: 1, svg: '<svg/>' },
  ] }] });
  assert.equal(oddSvg.similar[0].neighbors[0].svg, undefined, 'a drawing that is not an svg is dropped');
  assert.equal(oddSvg.similar[0].neighbors[1].svg, undefined, 'nor is a drawing without the reaction it shows');

  assert.equal(normalizeReactionPrecedent({}), null, 'an empty payload is not a precedent');
  assert.equal(normalizeReactionPrecedent({ reactions: [] }), null, 'nor is a payload with nothing usable');
});

test('similarity reads as a plain-language band', () => {
  assert.equal(similarityBand(1), 'same bond changes, on different molecules');
  assert.equal(similarityBand(0.998), 'same transformation, different substrate');
  assert.equal(similarityBand(0.7), 'same transformation, different substrate');
  assert.equal(similarityBand(0.69), 'shares some of the bond changes');
  assert.equal(similarityBand(0.4), 'shares some of the bond changes');
  assert.equal(similarityBand(0.39), 'loosely related');
});

test('only a step without an exact match gets its closest known reaction drawn', () => {
  const drawn = { key: 'b', distance: 4, count: 1, reaction: 'CO>>C=O', svg: '<svg/>' };
  const near = { input: 'x', neighbors: [{ key: 'a', distance: 3, count: 1, reaction: 'CC>>C=C' }, drawn] };
  assert.equal(precedentDrawingFor({ input: 'x', count: 2, reaction: 'CCO>>CC=O' }, near), null, 'an exact match is the step itself');
  assert.equal(precedentDrawingFor({ input: 'x', count: 0 }, near), drawn, 'the neighbour the package drew');
  assert.equal(precedentDrawingFor({ input: 'x', count: 0 }, undefined), null);
});

test('the precedent section is titled by route step, names the target and explains similarity', () => {
  const labels = [
    [
      { role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' },
      { role: 'reactant', byproduct: false, name: 'carbon dioxide', smiles: 'O=C=O' },
      { role: 'product', byproduct: false, name: '2-hydroxybenzoic acid', smiles: 'O=C(O)c1ccccc1O' },
    ],
    [
      { role: 'reactant', byproduct: false, name: '2-hydroxybenzoic acid', smiles: 'O=C(O)c1ccccc1O' },
      { role: 'reactant', byproduct: false, name: 'acetic anhydride', smiles: 'CC(=O)OC(C)=O' },
      { role: 'agent', byproduct: false, name: 'sulfuric acid', smiles: 'OS(=O)(=O)O' },
      { role: 'product', byproduct: false, name: '2-acetoxybenzoic acid', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
      { role: 'product', byproduct: true, name: 'acetic acid', smiles: 'CC(=O)O' },
    ],
    [
      { role: 'reactant', byproduct: false, name: '2-acetoxybenzoic acid', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
      { role: 'product', byproduct: false, name: '2-acetoxybenzoic acid', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
    ],
  ];
  const queries = buildPrecedentQueries(labels);
  const precedent = normalizeReactionPrecedent({
    reactions: [
      { input: queries[0].query, count: 0 },
      { input: queries[1].query, count: 4, samples: [ORD_A, ORD_B], reaction: 'CC(=O)OC(C)=O.O=C(O)c1ccccc1O>>CC(=O)Oc1ccccc1C(=O)O' },
      { input: queries[2].query, count: 0, unchanged: true },
    ],
    products: [{ input: 'CC(=O)Oc1ccccc1C(=O)O', count: 23 }],
    similar: [
      { input: queries[0].query, neighbors: [{ key: 'n', distance: 12, count: 1, similarity: 0.625, reaction: 'CO>>C=O' }] },
      { input: queries[1].query, neighbors: [{ key: 'm', distance: 0, count: 4, similarity: 1 }] },
      { input: queries[2].query, neighbors: [], unchanged: true },
    ],
  });
  const text = formatReactionPrecedents(precedent, {
    queries, labels,
    target: { smiles: 'CC(=O)Oc1ccccc1C(=O)O', name: '2-acetoxybenzoic acid' },
    drawings: new Map([[0, '<drawing of step 1 neighbour>']]),
  });
  assert.match(text, /Target: \*\*2-acetoxybenzoic acid\*\* — `CC\(=O\)Oc1ccccc1C\(=O\)O` · 23 recorded route\(s\) to it in this local snapshot\./);
  assert.match(text, /\*\*Step 1\*\* — phenol \+ carbon dioxide → 2-hydroxybenzoic acid\n`Oc1ccccc1\.O=C=O>>O=C\(O\)c1ccccc1O`/);
  assert.match(text, /Not recorded in this snapshot\. Closest recorded reaction: 63% similar — shares some of the bond changes\./);
  assert.match(text, /\n\*\*Step 2\*\* — 2-hydroxybenzoic acid \+ acetic anhydride → 2-acetoxybenzoic acid \(sulfuric acid\)\n/, 'agents shown, the acetic acid byproduct left out');
  assert.match(text, new RegExp(`✔ Exact match — 4 recorded precedent\\(s\\): \`${ORD_A}\`, \`${ORD_B}\`\\.`));
  assert.match(text, /_The closest known reaction, as recorded in the database \(species as listed, not a balanced equation\):_\n\n<drawing of step 1 neighbour>/);
  assert.match(text, /\*\*Step 3\*\* — [^\n]*\n`[^`]+`\n- Changes no structure \(a purification or salt step\), so it is not looked up\./);
  assert.match(text, /_Similarity compares which bonds and groups change in a reaction/);

  // Without a context the steps are numbered in query order and nothing is named.
  const bare = formatReactionPrecedents(normalizeReactionPrecedent({ reactions: [{ input: 'CCO>>CC=O', count: 2 }] }));
  assert.match(bare, /\*\*Step 1\*\*\n`CCO>>CC=O`\n- ✔ Exact match — 2 recorded precedent\(s\)\./);
  assert.ok(!bare.includes('_Similarity compares'), 'no footnote when no similarity is shown');
});

test('replayed history keeps the app route reports for the latest answer only', () => {
  const answer = [
    '## Route', 'Step 1 prose.', '',
    '### Structure check (RDKit)', '', 'Every SMILES below was parsed.', '',
    '### Route check (RDKit)', '', '- Step 1 FAIL — not balanced', '',
    '### Route drawings (RDKit)', '', '**Step 1**', '', 'Not drawn:', '- Step 2 — not balanced', '',
    '### Known reactions (Open Reaction Database)', '', '- ✔ Exact match', '',
    'Name corrections: salicylic acid → 2-hydroxybenzoic acid',
  ].join('\n');
  const latest = routeReportsForHistory(answer, true);
  assert.match(latest, /### Route check/, 'the latest route report is kept');
  assert.match(latest, /### Structure check/);
  assert.doesNotMatch(latest, /Route drawings|\*\*Step 1\*\*|Not drawn/, 'drawing leftovers are never replayed');
  assert.match(latest, /### Known reactions/);
  assert.match(latest, /Name corrections: salicylic acid/, 'the app note after the reports survives');
  const earlier = routeReportsForHistory(answer, false);
  assert.doesNotMatch(earlier, /Route check|Structure check|FAIL/, 'a superseded report is not re-sent');
  assert.match(earlier, /Step 1 prose\./, 'the model\'s own prose is kept');
  assert.match(earlier, /Name corrections:/);
});

test('carbon is found only where the SMILES has a carbon atom', () => {
  for (const smiles of ['C', 'c1ccccc1', '[C@@H](O)F', '[cH]1ccccc1', 'O=C=O', '[13CH4]']) assert.ok(smilesHasCarbon(smiles), smiles);
  for (const smiles of ['[Na+].[Cl-]', 'O', 'Cl', '[Ca+2]', '[Cs+]', 'O=S(=O)(O)O', '[Co]', 'Br', '[Na+].[OH-]']) assert.ok(!smilesHasCarbon(smiles), smiles);
});

test('an inorganic co-product listed as a Product becomes a byproduct, and the equation is unchanged', () => {
  // The fix-turn step the model wrote: NaCl beside salicylic acid under Products.
  const step = [
    { role: 'reactant', byproduct: false, name: 'sodium phenoxide', smiles: '[Na+].[O-]c1ccccc1' },
    { role: 'reactant', byproduct: false, name: 'carbon dioxide', smiles: 'O=C=O' },
    { role: 'reactant', byproduct: false, name: 'hydrogen chloride', smiles: 'Cl' },
    { role: 'product', byproduct: false, name: 'salicylic acid', smiles: 'O=C(O)c1ccccc1O' },
    { role: 'product', byproduct: false, name: 'sodium chloride', smiles: '[Cl-].[Na+]' },
    { role: 'agent', byproduct: false, name: 'water', smiles: 'O' },
  ];
  const classified = classifyCoProducts(step);
  assert.equal(classified.find((entry) => entry.name === 'sodium chloride').byproduct, true, 'NaCl is a byproduct');
  assert.equal(classified.find((entry) => entry.name === 'salicylic acid').byproduct, false, 'the organic product stays the product');
  assert.equal(classified.find((entry) => entry.name === 'water').byproduct, false, 'an agent is untouched');
  // Balancing reads roles only: the equation handed to the checker is byte-identical.
  assert.deepEqual(buildRouteSteps([classified]), buildRouteSteps([step]));
  // The looked-up reaction drops it with the other byproducts.
  assert.equal(buildPrecedentQueries([classified])[0].query, '[Na+].[O-]c1ccccc1.O=C=O.Cl>O>O=C(O)c1ccccc1O');
  // A step whose only product is inorganic keeps it: there is nothing else to call the product.
  const inorganic = [{ role: 'reactant', byproduct: false, name: 'x', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'water', smiles: 'O' }];
  assert.equal(classifyCoProducts(inorganic)[1].byproduct, false);
});

test('a checker message reaches the correction prompt whole', () => {
  const message = 'The declared species cannot be balanced: "Na", "OH", "H2O" take(s) no part (coefficient 0), so the equation balances only if those molecules are removed. Delete the molecule the step neither consumes nor produces — water and a solvent are the usual ones.';
  const audit = normalizeRouteAudit({ continuous: false, blocked: ['x'], steps: [{ index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true, differences: [message], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  assert.equal(audit.steps[0].differences[0], message, 'no truncation at 200 characters');
  const labels = [[{ role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' }, { role: 'product', byproduct: false, name: 'salicylic acid', smiles: 'O=C(O)c1ccccc1O' }]];
  const chip = routeFixChips(formatNamedRouteFixPrompts(labels, audit)).find((entry) => entry.label === 'Fix step 1');
  assert.ok(chip.prompt.includes('water and a solvent are the usual ones.'), 'the instruction at the end survives');
});

test('the route review blocks a workup folded into another transformation', () => {
  assert.match(ROUTE_REVIEW_SYSTEM, /folds a separate workup into a different transformation/);
  assert.match(ROUTE_REVIEW_SYSTEM, /Kolbe–Schmitt carboxylation and the acidification/);
  assert.match(ROUTE_REVIEW_SYSTEM, /one-pot cascade such as the Robinson tropinone synthesis is one step/, 'true cascades stay allowed');
});

test('the first request draws the target from its SMILES when the request gives one', () => {
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /If my request gives the\s+target's SMILES, use it \(kind "smiles"\)/);
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('"input":{"kind":"smiles","value":"EXACT TARGET SMILES FROM MY REQUEST"}'));
});

test('an unbuildable step keeps every later step on its own number', () => {
  const species = (reactant, product) => [
    { role: 'reactant', byproduct: false, name: reactant, smiles: reactant },
    { role: 'product', byproduct: false, name: product, smiles: product },
  ];
  const resolved = [species('CCO', 'CC=O'), [{ role: 'product', byproduct: false, name: 'unknown', status: 'unresolved' }], species('CC=O', 'CC(=O)O')];
  const steps = buildRouteSteps(resolved);
  assert.equal(steps.length, 3, 'one line per step');
  assert.equal(steps[1], '', 'the unbuilt step is an empty line');
  assert.equal(steps[2], 'CC=O>>CC(=O)O', 'step 3 is still at index 2');
});

test('the report, the drawings and the corrections share one step verdict', () => {
  const assembled = { index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [], assemblyProblem: 'the equation can only balance by taking more product molecules' };
  assert.equal(routeStepFailure(assembled), assembled.assemblyProblem, 'an assembly problem fails the step (so it is not drawn)');
  assert.equal(routeStepFailure(passingStep(0, 'a>>b')), null);
  assert.match(routeStepFailure({ ...passingStep(0, 'a>>b'), ok: false, error: 'This step could not be built' }), /could not be built/);
});

test('the shared rules keep a workup as its own step, as the review requires', () => {
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /A workup — an acidification, basification or quench .* is always its own step/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /except in the single structure fallback below and the one target chemistry-plan/);
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /In a route, do not write a reaction SMILES/, 'single-reaction drawings stay allowed');
});

test('history drops the review and known reactions of superseded answers, and repeated correction rules', () => {
  const answer = ['## Route', 'prose', '', '### Route check (RDKit)', '- Step 1 OK', '', '### Route review (model)', '- Step 1: folded workup', '', 'Not verified: The route review raised 1 problem(s).', '', '### Known reactions (Open Reaction Database)', '- ✔ Exact match'].join('\n');
  const earlier = routeReportsForHistory(answer, false);
  assert.doesNotMatch(earlier, /Route review|folded workup|Not verified|Known reactions/);
  const latest = routeReportsForHistory(answer, true);
  assert.match(latest, /Route review/);
  assert.match(latest, /Known reactions/);
  const correction = 'Correction needed for step 2 of the synthesis route above.\n\nStep 2 was rejected: x\n\nWhat may change: only step 2.\nRules for every step:\n- rule one\n- rule two';
  const replayed = routeFixPromptForHistory(correction);
  assert.match(replayed, /Step 2 was rejected: x/);
  assert.match(replayed, /What may change: only step 2\./);
  assert.doesNotMatch(replayed, /rule one/);
  assert.equal(routeFixPromptForHistory('Why is step 2 slow?'), 'Why is step 2 slow?', 'an ordinary message is untouched');
});

test('the interim report says checks passed, not verified, while the review runs', () => {
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.match(formatRouteAudit(audit, [], null, true), /\*\*Route checks passed\*\*.*The model review is still running\./);
  assert.doesNotMatch(formatRouteAudit(audit, [], null, true), /Route checked: balanced/);
  assert.match(formatRouteAudit(audit, [], null), /\*\*Route checked: balanced and connected\*\*/);
  assert.match(formatRouteCheckUnavailable('worker crashed'), /Route check unavailable: worker crashed\. The route above has not been checked\./);
});

test('conditions and prose are read inside each step, not by position', () => {
  const answer = [
    '## Summary', '', 'Reaction conditions: see each step.', '',
    '### Step 1 — Oxidation of ethanol', 'Ethanol is oxidised to ethanal.', '',
    'Reactants: ethanol; oxygen', 'Products: ethanal', 'Byproducts: water', 'Agents: none', '',
    '### Step 2 — Oxidation of ethanal', 'Ethanal is oxidised further.', 'Reagents and conditions: KMnO4, H2O, 25 °C', '',
    'Reactants: ethanal; oxygen', 'Products: ethanoic acid', 'Byproducts: none', 'Agents: none',
  ].join('\n');
  // Step 1 has no conditions line; the summary line above it must not be taken for step 1, and
  // step 2's line must stay on step 2.
  const conditions = findStepConditions(answer, 2);
  assert.equal(conditions[0], '', 'step 1 has no conditions of its own');
  assert.match(conditions[1], /KMnO4/, 'step 2 keeps its own conditions');
  const prose = findStepProse(answer, 2);
  assert.match(prose[0], /^Step 1 — Oxidation of ethanol — Ethanol is oxidised to ethanal\./);
  assert.match(prose[1], /^Step 2 — Oxidation of ethanal/);
});

test('a step carries its reaction class, a textbook passage and the index alternatives', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: '4-nitrobenzoic acid', smiles: 'O=C(O)c1ccc([N+](=O)[O-])cc1' },
    { role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' },
    { role: 'product', byproduct: false, name: 'ethyl 4-nitrobenzoate', smiles: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1' },
    { role: 'product', byproduct: true, name: 'water', smiles: 'O' },
  ]];
  const queries = buildPrecedentQueries(labels);
  const precedent = normalizeReactionPrecedent({ reactions: [{ input: queries[0].query, count: 0, classes: ['Fischer esterification', 42] }], products: [], similar: [] });
  assert.deepEqual(precedent.reactions[0].classes, ['Fischer esterification'], 'a non-string class is dropped');
  const support = new Map([[0, {
    passage: { title: 'Organic Chemistry 9th Ed', location: 'pp. 954', citation: 'nodus://passage/w1%230', excerpt: 'Mechanism of Fischer esterification…', about: 'Fischer esterification' },
    alternatives: { product: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1', proposals: [
      { precursors: 'CCO.O=C(Cl)c1ccc([N+](=O)[O-])cc1', classes: ['acylation of an alcohol or phenol'], recorded: 7 },
      { precursors: 'CCI.O=C(O)c1ccc([N+](=O)[O-])cc1', classes: [], recorded: 0 },
    ] },
  }]]);
  const text = formatReactionPrecedents(precedent, { queries, labels, support });
  assert.match(text, /- Reaction class: Fischer esterification\./);
  assert.match(text, /- Textbook, on Fischer esterification: \[Organic Chemistry 9th Ed, pp\. 954\]\(nodus:\/\/passage\/w1%230\) — “Mechanism of Fischer esterification…”/);
  assert.match(text, /- Other ways to make `CCOC\(=O\)c1ccc\(\[N\+\]\(=O\)\[O-\]\)cc1` \(Open Reaction Database\): `CCO\.O=C\(Cl\)[^`]+` \(acylation of an alcohol or phenol; recorded 7×\) · `CCI\.[^`]+` \(template only\)\./);

  const audit = normalizeRouteAudit({ continuous: false, blocked: ['Step 1 is not balanced.'], steps: [{ index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true, differences: ['x'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit, null, support));
  assert.match(chips[0].prompt, /Evidence, not an instruction — the Open Reaction Database makes `CCOC\(=O\)[^`]+` from: `CCO\.O=C\(Cl\)[^`]+` \(acylation of an alcohol or phenol; recorded 7×\)[^\n]*Write any species you take from it by name\./);
  assert.match(chips.find((chip) => chip.label === 'Fix step 1').prompt, /Textbook, on Fischer esterification: Organic Chemistry 9th Ed, pp\. 954 \(nodus:\/\/passage\/w1%230\)\./);
  // Without support the chips are unchanged.
  assert.doesNotMatch(routeFixChips(formatNamedRouteFixPrompts(labels, audit))[0].prompt, /Evidence, not an instruction/);
});

test('the route rules agree with each other and with what the checker does', () => {
  // Agents are what a step does not consume; the old "never a species that takes no part" said
  // the opposite of a catalyst's definition.
  assert.doesNotMatch(SYNTHESIS_TEMPLATE_ADDENDUM, /never a species that takes no part|true catalysts or solvents only/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Agents \(catalysts, solvents and other conditions the step does not consume\)/);
  // Solvent water that is also formed has a home, and salts sharing an ion are named whole.
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /goes under Agents as the solvent and under Byproducts as the amount formed, never under Reactants/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Name each salt whole \(sodium sulfate, chromium\(III\) sulfate\) even when two salts share an ion/);
  assert.doesNotMatch(SYNTHESIS_TEMPLATE_ADDENDUM, /do not repeat an ion that two salts share/);
  // The checker files an idle reagent under Agents, so only an unformed product is removed.
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /A reagent listed under Reactants that takes no part is treated as an Agent by the checker/);
  // One definition of a folded workup, in the author's rules and the reviewer's, and the
  // product's isolated form is a naming choice in both.
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /folds a workup when it lists the workup's acid or base together with the transformation's reagents/);
  assert.match(ROUTE_REVIEW_SYSTEM, /folds a workup only when its species include the workup's acid or base alongside the transformation's reagents/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Which form a product is written in \(an amine or its hydrochloride, an acid or its salt\) is your choice/);
  // The reviewer does not re-litigate what the checker derived from the structures.
  assert.match(ROUTE_REVIEW_SYSTEM, /Never dispute what a SMILES denotes \(`Cl` is hydrogen chloride; chloride is `\[Cl-\]`\)/);
  assert.match(ROUTE_REVIEW_SYSTEM, /tin\(II\) or tin\(IV\) chloride/);
});

test('a target requested without stereochemistry is racemic by the request', async () => {
  const { implyRacemicTarget } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
  const product = (smiles, open) => ({ input: smiles, canonicalSmiles: smiles, skeletonSmiles: smiles, formula: '', charge: 0, heavyAtoms: 0, stereocentres: open, unspecifiedStereocentres: open });
  const step = (index, products) => ({ index, reaction: 'x', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: products.reduce((s, p) => s + p.unspecifiedStereocentres, 0), reactants: [], agents: [], products });
  const audit = () => normalizeRouteAudit({ continuous: true, blocked: ['Step 2 leaves 1 stereocentre(s) or double bond(s) unspecified.'], links: [], target: { input: 'CCC(C)C(=O)O', canonicalSmiles: 'CCC(C)C(=O)O', formula: 'C5H10O2', formedAt: 1, reason: 'formed' },
    steps: [step(0, [product('CCC(C)(C(=O)O)C(=O)O', 0)]), step(1, [product('CCC(C)C(=O)O', 1), product('O=C=O', 0)])] });
  // Decarboxylation to 2-methylbutanoic acid, requested as CCC(C)C(=O)O: no stereo asked for.
  const excused = implyRacemicTarget(audit(), 'CCC(C)C(=O)O');
  assert.equal(excused.steps[1].racemic, true);
  assert.equal(routeStepFailure(excused.steps[1]), null);
  assert.deepEqual(excused.blocked, [], 'the checker sentence about the excused step is dropped');
  // A target requested with stereo is still held to it.
  assert.notEqual(implyRacemicTarget(audit(), 'CC[C@H](C)C(=O)O').steps[1].racemic, true);
  // An intermediate with an open centre is not excused by the target rule.
  const intermediate = normalizeRouteAudit({ continuous: true, blocked: [], links: [], target: { input: 'CCC(C)C(=O)O', canonicalSmiles: 'CCC(C)C(=O)O', formula: '', formedAt: 1, reason: 'formed' },
    steps: [step(0, [product('CC(O)CC', 1)])] });
  assert.notEqual(implyRacemicTarget(intermediate, 'CCC(C)C(=O)O').steps[0].racemic, true);
});

test('a racemic outcome is declared per step, and "achiral" is not a declaration', () => {
  assert.equal(declaresRacemic('The decarboxylation gives racemic 2-methylbutanoic acid.'), true);
  assert.equal(declaresRacemic('Its stereochemistry is not controlled.'), true);
  assert.equal(declaresRacemic('Benzocaine is achiral, so no descriptors are needed.'), false, 'an achiral product has nothing to excuse');
});

test('a fix chip names the species that did not resolve, not only the balance it broke', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'diethyl malonate', smiles: 'CCOC(=O)CC(=O)OCC' },
    { role: 'reactant', byproduct: false, name: 'sodium ethoxide', smiles: 'CC[O-].[Na+]' },
    { role: 'product', byproduct: true, name: 'ethanol', smiles: 'CCO' },
  ]];
  const audit = normalizeRouteAudit({ continuous: false, blocked: ['Step 1 is not balanced.'], steps: [{ index: 0, reaction: 'a>>b', ok: false, balanced: false, chargeBalanced: true, differences: ['C: reactants 9, products 2'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  const unresolved = [{ step: 1, role: 'product', byproduct: false, name: 'sodium diethyl malonate enolate' }];
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit, null, undefined, unresolved));
  const backwards = chips.find(chip => chip.label === 'Fix from the target backwards');
  assert.match(backwards.prompt, /“sodium diethyl malonate enolate” \(Product\) could not be resolved to a structure, so the checker built this step without it/);
  assert.match(chips.find(chip => chip.label === 'Fix step 1').prompt, /could not be resolved/);
  // Without unresolved names the chips are unchanged.
  assert.doesNotMatch(routeFixChips(formatNamedRouteFixPrompts(labels, audit))[0].prompt, /could not be resolved/);
});

test('an unresolved species in a step that otherwise passes still gets a fix chip', () => {
  const labels = [[{ role: 'product', byproduct: false, name: 'x', smiles: 'C' }]];
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [{ index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], links: [] });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit, null, undefined, [{ step: 1, role: 'reactant', byproduct: false, name: 'the enolate' }]));
  assert.ok(chips.length);
  assert.match(chips[0].prompt, /- Step 1: a species did not resolve to a structure\n  - “the enolate” \(Reactant\)/);
});

test('a salt is shown whole with its count, and water at 7 in a dichromate oxidation is not called suspicious', () => {
  const sp = (input, formula, coefficient) => ({ input, canonicalSmiles: input, skeletonSmiles: input, formula, charge: 0, heavyAtoms: 1, stereocentres: 0, unspecifiedStereocentres: 0, coefficient });
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], links: [], steps: [{ index: 0, reaction: 'x', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
    reactants: [sp('OC1CCCCC1', 'C6H12O', 3), sp('[Na+]', 'Na', 2), sp('[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]', 'Cr2O7', 1), sp('OS(=O)(=O)O', 'H2O4S', 4)],
    agents: [],
    products: [sp('O=C1CCCCC1', 'C6H10O', 3), sp('[O-]S(=O)(=O)[O-]', 'O4S', 4), sp('[Cr+3]', 'Cr', 2), sp('[Na+]', 'Na', 2), sp('O', 'H2O', 7)] }] });
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'cyclohexanol', smiles: 'OC1CCCCC1' },
    { role: 'reactant', byproduct: false, name: 'sodium dichromate', smiles: '[Na+].[Na+].[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]' },
    { role: 'reactant', byproduct: false, name: 'sulfuric acid', smiles: 'OS(=O)(=O)O' },
    { role: 'product', byproduct: false, name: 'cyclohexanone', smiles: 'O=C1CCCCC1' },
    { role: 'product', byproduct: true, name: 'chromium(III) sulfate', smiles: '[Cr+3].[Cr+3].[O-]S(=O)(=O)[O-].[O-]S(=O)(=O)[O-].[O-]S(=O)(=O)[O-]' },
    { role: 'product', byproduct: true, name: 'sodium sulfate', smiles: '[Na+].[Na+].[O-]S(=O)(=O)[O-]' },
    { role: 'product', byproduct: true, name: 'water', smiles: 'O' },
  ]];
  const line = formatRouteAudit(audit, labels).split('\n').find((entry) => entry.startsWith('- Step 1'));
  assert.equal(line, '- Step 1 OK — balanced. 3 cyclohexanol (C6H12O) + 4 sulfuric acid (H2O4S) + sodium dichromate (Cr2Na2O7) → 3 cyclohexanone (C6H10O) + 7 water (H2O) + chromium(III) sulfate (Cr2O12S3) + sodium sulfate (Na2O4S)');
  // A disodium salt whose sodium was sent once is shown with both sodiums, not "Na".
  const disodium = normalizeRouteAudit({ continuous: true, blocked: [], links: [], steps: [{ index: 0, reaction: 'x', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
    reactants: [sp('CC(C(=O)[O-])C(=O)[O-]', 'C4H4O4', 1), sp('[Na+]', 'Na', 2), sp('Cl', 'HCl', 2)], agents: [],
    products: [sp('CC(C(=O)O)C(=O)O', 'C4H6O4', 1), sp('[Na+]', 'Na', 2), sp('[Cl-]', 'Cl', 2)] }] });
  const disodiumLabels = [[
    { role: 'reactant', byproduct: false, name: 'disodium 2-methylpropanedioate', smiles: '[Na+].[Na+].CC(C(=O)[O-])C(=O)[O-]' },
    { role: 'reactant', byproduct: false, name: 'hydrogen chloride', smiles: 'Cl' },
    { role: 'product', byproduct: false, name: '2-methylpropanedioic acid', smiles: 'CC(C(=O)O)C(=O)O' },
    { role: 'product', byproduct: true, name: 'sodium chloride', smiles: '[Na+].[Cl-]' },
  ]];
  assert.match(formatRouteAudit(disodium, disodiumLabels), /2 hydrogen chloride \(HCl\) \+ disodium 2-methylpropanedioate \(C4H4Na2O4\) → 2-methylpropanedioic acid \(C4H6O4\) \+ 2 sodium chloride \(ClNa\)/);
});

test('a spectator ion the solver left at 1:1 still lets the salts show whole (caprolactam, Suite 2b)', () => {
  const sp = (input, formula, coefficient) => ({ input, canonicalSmiles: input, skeletonSmiles: input, formula, charge: 0, heavyAtoms: 1, stereocentres: 0, unspecifiedStereocentres: 0, coefficient });
  const dichromate = '[O]=[Cr](=[O])([O-])[O][Cr](=[O])(=[O])[O-]';
  const sulfate = 'O=S(=O)([O-])[O-]';
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], links: [], steps: [{ index: 0, reaction: 'x', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
    reactants: [sp('OC1CCCCC1', 'C6H12O', 3), sp('[Na+]', 'Na', 1), sp(dichromate, 'Cr2O7', 1), sp('O=S(=O)(O)O', 'H2O4S', 4)], agents: [],
    products: [sp('O=C1CCCCC1', 'C6H10O', 3), sp(sulfate, 'O4S', 4), sp('[Cr+3]', 'Cr', 2), sp('[Na+]', 'Na', 1), sp('O', 'H2O', 7)] }] });
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'cyclohexanol', smiles: 'OC1CCCCC1' },
    { role: 'reactant', byproduct: false, name: 'sodium dichromate', smiles: `[Na+].[Na+].${dichromate}` },
    { role: 'reactant', byproduct: false, name: 'sulfuric acid', smiles: 'O=S(=O)(O)O' },
    { role: 'product', byproduct: false, name: 'cyclohexanone', smiles: 'O=C1CCCCC1' },
    { role: 'product', byproduct: true, name: 'chromium(III) sulfate', smiles: `${sulfate}.${sulfate}.${sulfate}.[Cr+3].[Cr+3]` },
    { role: 'product', byproduct: true, name: 'sodium sulfate', smiles: `${sulfate}.[Na+].[Na+]` },
    { role: 'product', byproduct: true, name: 'water', smiles: 'O' },
  ]];
  const line = formatRouteAudit(audit, labels).split('\n').find((entry) => entry.startsWith('- Step 1'));
  assert.match(line, /3 cyclohexanol \(C6H12O\) \+ 4 sulfuric acid \(H2O4S\) \+ sodium dichromate \(Cr2Na2O7\) → 3 cyclohexanone \(C6H10O\) \+ 7 water \(H2O\) \+ chromium\(III\) sulfate \(Cr2O12S3\) \+ sodium sulfate \(Na2O4S\)$/);
});


test('a stereo declaration counts wherever it sits in the step, and a bold lead-in keeps its prose (Sonnet 5.5, hard suite)', () => {
  const lead = 'Treat the triketone with pyrrolidine in methanol at room temperature. The methyl ketone enolate attacks one ring carbonyl and closes the second six-membered ring. The step is an isomerization with no gain or loss of atoms. It creates two stereocentres, the carbon bearing the OH and the methyl-bearing quaternary carbon. No chiral catalyst is used, so the stereochemistry of this step is not controlled and the ketol is racemic.';
  const answer = [
    '# Wieland–Miescher ketone', '',
    '**Step 1: Michael addition.** Heat the dione with but-3-en-2-one in water.', '',
    'Reactants: 2-methylcyclohexane-1,3-dione; but-3-en-2-one', 'Products: 2-methyl-2-(3-oxobutyl)cyclohexane-1,3-dione', '',
    `**Step 2: intramolecular aldol addition.** ${lead}`, '',
    'Reactants: 2-methyl-2-(3-oxobutyl)cyclohexane-1,3-dione', 'Products: 4a-hydroxy-8a-methyloctahydronaphthalene-1,6(2H,5H)-dione', '',
  ].join('\n');
  assert.ok(lead.indexOf('racemic') > 360, 'the declaration sits past the reviewer\'s 360-character prose');
  assert.deepEqual(stepDeclaresRacemic(answer, 2), [false, true]);
  const prose = findStepProse(answer, 2);
  assert.match(prose[1], /^Step 2: intramolecular aldol addition\. — Treat the triketone with pyrrolidine/);
  // "of this step" no longer hides the phrase; a species name never counts as a declaration.
  assert.equal(declaresRacemic('The stereochemistry of this step is not controlled.'), true);
  assert.deepEqual(stepDeclaresRacemic('**Step 1: x.** Heat it.\n\nProducts: rac-2-methylbutanoic acid (racemic)\n', 1), [false]);
});

test('an unspecified-stereo failure names the product that carries the open centres', () => {
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], links: [], steps: [{ index: 0, reaction: 'x', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 2,
    reactants: [], agents: [], products: [{ input: 'p', canonicalSmiles: 'CC12CCC(=O)CC1(O)CCCC2=O', skeletonSmiles: 'p', formula: 'C11H16O3', charge: 0, heavyAtoms: 14, stereocentres: 0, unspecifiedStereocentres: 2, name: '4a-hydroxy-8a-methyloctahydronaphthalene-1,6(2H,5H)-dione' }] }] });
  assert.match(routeStepFailure(audit.steps[0]), /2 unspecified stereocentre\(s\) or double bond\(s\) in “4a-hydroxy-8a-methyloctahydronaphthalene-1,6\(2H,5H\)-dione” \(2\) — name the stereoisomer formed .* in this step's own paragraph/);
});

test('steps written as a numbered list are found, and a numbered list inside one step is not (Opus 4.8, camphor)', () => {
  const answer = [
    'Camphor from α-pinene in three steps.', '',
    '1. **Acid-catalysed rearrangement.** α-Pinene is treated with acetic acid and catalytic sulfuric acid. A Wagner–Meerwein shift gives the bornyl cation. The stereochemistry of this step is not controlled: the acetate is racemic.', '',
    'Reactants: 2,6,6-trimethylbicyclo[3.1.1]hept-2-ene; acetic acid', 'Products: 1,7,7-trimethylbicyclo[2.2.1]heptan-2-yl acetate', '',
    '2. **Ester hydrolysis.** The acetate is hydrolysed. Conditions:', '   1. reflux 2 h', '   2. cool', 'The alcohol is racemic.', '',
    'Reactants: 1,7,7-trimethylbicyclo[2.2.1]heptan-2-yl acetate; water', 'Products: 1,7,7-trimethylbicyclo[2.2.1]heptan-2-ol', '',
  ].join('\n');
  assert.deepEqual(stepDeclaresRacemic(answer, 2), [true, true]);
  assert.match(findStepProse(answer, 2)[0], /^Acid-catalysed rearrangement\. — α-Pinene is treated/);
  assert.match(findStepProse(answer, 2)[1], /^Ester hydrolysis\. — The acetate is hydrolysed/);
  // Without labelled species under the items, a numbered list is not taken for the route.
  assert.deepEqual(stepDeclaresRacemic('1. First, it is racemic.\n2. Second.\n', 2), [false, false]);
});

test('a route request asks for backwards, one-step planning without hand-balancing or mechanisms, before the format', () => {
  const method = SYNTHESIS_TEMPLATE_ADDENDUM.indexOf('How to plan the route:');
  const format = SYNTHESIS_TEMPLATE_ADDENDUM.indexOf('Output format — follow exactly.');
  assert.ok(method >= 0 && format > method, 'the method comes first, the output format after it');
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Work backwards from the target, one step at a time/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Once a step is written, do not revisit or re-derive it/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Do not count atoms, track hydrogens or balance equations in your reasoning/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Do not work out reaction mechanisms/);
  assert.match(SYNTHESIS_TEMPLATE_ADDENDUM, /Present the finished route in forward order, step 1 first/);
  // The addendum is still recognised as already applied, so it is never appended twice.
  assert.equal(looksLikeSynthesisRequest(`Propose a synthesis of benzocaine.\n${SYNTHESIS_TEMPLATE_ADDENDUM}`), false);
});

test('open stereocentres that cannot reach the target pass, and say so', () => {
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], links: [], steps: [{ index: 0, reaction: 'x', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 2, stereoNotRequired: true,
    reactants: [], agents: [], products: [{ input: 'd', canonicalSmiles: 'CN1C2CCC1C(C(=O)O)C(=O)C2C(=O)O', skeletonSmiles: 'd', formula: 'C10H13NO5', charge: 0, heavyAtoms: 16, stereocentres: 0, unspecifiedStereocentres: 2 }] }] });
  assert.equal(audit.steps[0].stereoNotRequired, true);
  assert.equal(routeStepFailure(audit.steps[0]), null);
  assert.match(formatRouteAudit(audit), /- Step 1 OK — balanced, 2 open stereocentre\(s\) not required \(lost before the target\)/);
  // Without the flag the same step still fails.
  const strict = normalizeRouteAudit({ ...audit, steps: [{ ...audit.steps[0], stereoNotRequired: false }] });
  assert.match(routeStepFailure(strict.steps[0]) ?? '', /2 unspecified stereocentre/);
});

test('a step whose bond changes cannot happen is FAIL, and the fix prompt carries the checker\'s sentence', () => {
  const problem = 'a new C–Br bond forms at a carbon nothing activates — no leaving group, metal, heteroatom or multiple bond on it, and not next to a carbonyl, alkene or arene — so the product does not follow from the reactants as written. Check which carbon reacts (the regiochemistry: an enol or enolate reacts only at the α-carbon)';
  const audit = normalizeRouteAudit({
    continuous: false, blocked: [`Step 1: ${problem}.`],
    steps: [{
      index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      skeleton: { change: 'none', formed: 0, cleaved: 0, ringSizes: [], migration: false, unactivated: 0, unactivatedHetero: 2, heteroElements: ['Br'] },
      skeletonProblem: problem, reactants: [], agents: [], products: [],
    }],
    links: [],
  });
  assert.equal(audit.steps[0].skeleton.unactivatedHetero, 2);
  const text = formatRouteAudit(audit);
  assert.match(text, /\*\*Route check failed\*\* — [^.]*makes or breaks a bond its reactants cannot \(step 1\)/);
  assert.match(text, /- Step 1 FAIL — balanced\. a new C–Br bond forms at a carbon nothing activates/);
  assert.equal(routeStepFailure(audit.steps[0]), problem);
  const labels = [[{ role: 'product', byproduct: false, name: '2,3,4-tribromocyclopentan-1-one', smiles: 'O=C1CC(Br)C(Br)C1Br' }]];
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.match(chips[0].prompt, /- Step 1: a new C–Br bond forms at a carbon nothing activates/);
  const stepChip = chips.find(chip => chip.label === 'Fix step 1');
  assert.ok(stepChip, 'the step gets its own fix chip');
  assert.match(stepChip.prompt, /the regiochemistry: an enol or enolate reacts only at the α-carbon/);
});

test('a passing step states the bonds it forms, so the reviewer reads the checker\'s facts', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [
      { index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
        skeleton: { change: 'formed', formed: 1, cleaved: 0, ringSizes: [6], migration: false, unactivated: 0, unactivatedHetero: 0, heteroElements: [] }, bonds: { 'C–C': 1, 'C–O': -1 } },
      { index: 1, reaction: 'b>>c', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
        skeleton: { change: 'formed+cleaved', formed: 1, cleaved: 1, ringSizes: [], migration: true, reorganised: false, unactivated: 1, unactivatedHetero: 0, heteroElements: [] }, rearrangement: true },
      { index: 2, reaction: 'c>>d', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
        skeleton: { change: 'none', formed: 0, cleaved: 0, ringSizes: [], migration: false, unactivated: 0, unactivatedHetero: 0, heteroElements: [] } },
      { index: 3, reaction: 'd>>e', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
        skeleton: { change: 'none', formed: 0, cleaved: 0, ringSizes: [], migration: false, unactivated: 0, unactivatedHetero: 0, heteroElements: [] }, bonds: { 'N–O': 1, 'O–O': -1 } },
    ],
    links: [],
  });
  const text = formatRouteAudit(audit);
  assert.match(text, /- Step 1 OK — balanced\. Bonds made \(\+\) and broken \(−\): \+1 C–C \(closing a 6-membered ring\), −1 C–O\./);
  assert.match(text, /- Step 2 OK — balanced\. Bonds made \(\+\) and broken \(−\): \+1 C–C, −1 C–C — a 1,2-shift; declared a rearrangement\./);
  assert.doesNotMatch(text, /- Step 3 OK — balanced\. Bonds made/);
  // Every bond type, not only those at carbon: an N-oxidation by a peroxide.
  assert.match(text, /- Step 4 OK — balanced\. Bonds made \(\+\) and broken \(−\): \+1 N–O, −1 O–O\./);
});

test('rearrangement and radical declarations are read per step, and a negated mention is not one', () => {
  const answer = [
    '**Step 1 — Acid-catalysed isomerisation of α-pinene to camphene.** The pinane skeleton reorganises.',
    'Reactants: (1R,5R)-2,6,6-trimethylbicyclo[3.1.1]hept-2-ene',
    'Products: camphene',
    '',
    '**Step 2 — Hydroboration–oxidation.** Boron adds to the less substituted carbon; no rearrangement occurs.',
    'Reactants: camphene; borane',
    '',
    'Products: bornan-2-ol',
    '',
    '**Step 3 — Wagner–Meerwein shift to isobornyl acetate.**',
    'Reactants: camphene; acetic acid',
    'Products: isobornyl acetate',
    '',
    '**Step 4 — Allylic bromination with NBS under light.**',
    'Reactants: cyclohexene; N-bromosuccinimide',
    'Products: 3-bromocyclohexene',
    '',
    '**Step 5 — Bromination of the ketone.** This is not a radical reaction.',
    'Reactants: cyclopentanone; bromine',
    'Products: radical-free 2-bromocyclopentanone',
  ].join('\n');
  assert.deepEqual(stepDeclaresRearrangement(answer, 5), [true, false, true, false, false]);
  assert.deepEqual(stepDeclaresRadical(answer, 5), [false, false, false, true, false]);
});

test('step prose stays aligned when bold lead-in steps and full-line step headings are mixed', () => {
  const answer = [
    '**Step 1 — Acid-catalysed isomerisation of α-pinene to camphene.** The pinane skeleton reorganises.',
    'Reactants: (1R,5R)-2,6,6-trimethylbicyclo[3.1.1]hept-2-ene',
    'Products: camphene',
    '',
    '**Step 2 — Hydroboration–oxidation.** Boron adds to the less substituted carbon.',
    'Reactants: camphene; borane',
    'Products: bornan-2-ol',
    '',
    '**Step 3 — Wagner–Meerwein shift to isobornyl acetate.**',
    'Reactants: camphene; acetic acid',
    'Products: isobornyl acetate',
  ].join('\n');
  const prose = findStepProse(answer, 3);
  assert.match(prose[0], /isomerisation of α-pinene/);
  assert.match(prose[1], /Hydroboration/);
  assert.match(prose[2], /Wagner–Meerwein/);
});

test('a route the model draws in a capability fence does not turn its own labels into species', () => {
  // Seen on a long route: the model emitted its own picture through the `nodus-view`
  // fence and hand-wrote the SVG inside it, repeating the role labels in its `<text>` elements,
  // and the drawing ran out before `</svg>`. One `Byproducts:` inside the picture claimed the
  // rest of the answer, and two fragments of markup became species of that step that no resolver
  // could turn into structures — so the step was emptied and reported as unbuilt although the
  // author's own list was complete.
  const answer = [
    '**Step 1 — Coupling**',
    'Reactants: ethanol; ethanoic acid',
    'Products: ethyl ethanoate',
    'Byproducts: water',
    'Agents: sulfuric acid',
    '',
    '**Step 2 — Hydrolysis**',
    'Reactants: ethyl ethanoate; water',
    'Products: ethanol',
    'Byproducts: ethanoic acid',
    'Agents: none',
    '',
    '```nodus-view',
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">',
    '  <text x="60" y="40" font-size="16">Step 1 — Coupling</text>',
    '  <text x="80" y="65" font-size="13">Byproducts: water, carbon dioxide, etc.</text>',
    '  <text x="80" y="90" font-size="13">Product: ethyl ethanoate, purified.</text>',
    '```',
    '',
    'Caveats: the conditions are a proposal.',
  ].join('\n');
  assert.equal(countRouteSteps(answer), 2, 'the picture does not add a step');
  const species = findStepNamedSpecies(answer, 2);
  assert.deepEqual(species[0].map((entry) => entry.name), ['ethanol', 'ethanoic acid', 'ethyl ethanoate', 'water', 'sulfuric acid']);
  assert.deepEqual(species[1].map((entry) => entry.name), ['ethyl ethanoate', 'water', 'ethanol', 'ethanoic acid'],
    'no fragment of the drawing is read as a species');
  // Every species still resolves, so both steps are built rather than reported unbuilt.
  const steps = buildRouteSteps([
    species[0].map((entry) => ({ role: entry.role, smiles: 'CCO' })),
    species[1].map((entry) => ({ role: entry.role, smiles: 'CCO' })),
  ]);
  assert.ok(steps.every((step) => step.length > 0), 'a step is not emptied by the drawing');
});

test('a closed inline SVG is masked too, and a species name that is markup is dropped', () => {
  const answer = [
    '**Step 1 — Oxidation**',
    'Reactants: cyclohexanol',
    'Products: cyclohexanone',
    'Byproducts: water; <text x="80" y="745">Product: something</text>',
    'Agents: none',
    '<svg width="10" height="10"><text>Reactants: benzene</text></svg>',
  ].join('\n');
  const species = findStepNamedSpecies(answer, 1);
  assert.deepEqual(species[0].map((entry) => entry.name), ['cyclohexanol', 'cyclohexanone', 'water'],
    'markup is not a species name, and the closed picture contributes nothing');
});

test('a step the application could not build is reported as UNBUILT and names the species', () => {
  // Nothing was checked on such a step, so calling it a failed check both overstates the route's
  // problems and hides what the author has to fix. The old line read
  // "Step 2 FAIL — This step could not be built: a species it names has no resolved structure."
  // and named nothing, which made a real diagnosis slow.
  const audit = normalizeRouteAudit({
    steps: [
      { index: 0, reaction: 'CCO>>CC=O', ok: true, reactants: [], agents: [], products: [], balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0 },
      { index: 1, reaction: '', ok: false, error: 'This step could not be built: a species it names has no resolved structure.', reactants: [], agents: [], products: [], balanced: null, chargeBalanced: null, differences: [], unspecifiedStereocentres: 0 },
    ],
  });
  const report = formatRouteAudit(audit, [[], []], null, false, [
    { step: 2, role: 'reactant', byproduct: false, name: 'the supported intermediate' },
  ]);
  assert.match(report, /- Step 2 UNBUILT — nothing was checked: no structure resolved for reactant "the supported intermediate"/);
  assert.doesNotMatch(report, /Step 2 FAIL/, 'an unbuilt step is not reported as a failed check');
  assert.match(report, /1 step\(s\) could not be built because a species they name has no resolved structure \(step 2\)/);
  assert.doesNotMatch(report, /1 of 2 step\(s\) do not pass/, 'it is not counted among the steps that do not pass');
});

test('the resolution source of every structure is reported', () => {
  assert.equal(formatResolutionSourceNote([
    { status: 'resolved', source: 'builtin' }, { status: 'resolved', source: 'builtin' },
    { status: 'resolved', source: 'pubchem' }, { status: 'resolved', source: 'opsin' },
    { status: 'fallback', source: 'declared' },
    { status: 'unresolved' },
  ]), 'Structures resolved: 2 from the built-in dictionary · 1 from PubChem · 1 from OPSIN · 1 from the answer itself.');
  assert.equal(formatResolutionSourceNote([]), '', 'nothing resolved is no note');
  assert.equal(formatResolutionSourceNote([{ status: 'unresolved' }]), '', 'an unresolved species is not a source');
});

test('a placeholder where a species belongs is called a placeholder, not an unresolvable name', () => {
  // Seen live: a step whose Byproducts line read "see prose". Asking for "its structure" invites
  // the author to invent one; the fault is that the species were never listed.
  for (const name of ['see prose', 'see prose (protected building blocks)', 'as above', 'see step 2', 'as described in the text', 'various', 'etc.']) {
    assert.equal(isPlaceholderSpecies(name), true, name);
  }
  for (const name of ['water', 'sodium bromide', '9H-fluoren-9-ylidenemethanone', 'propan-2-ol', 'the supported intermediate', 'Seebach amide']) {
    assert.equal(isPlaceholderSpecies(name), false, name);
  }
  const audit = normalizeRouteAudit({
    steps: [{ index: 0, reaction: '', ok: false, error: 'This step could not be built: a species it names has no resolved structure.', reactants: [], agents: [], products: [], balanced: null, chargeBalanced: null, differences: [], unspecifiedStereocentres: 0 }],
  });
  const placeholder = formatRouteAudit(audit, [[]], null, false, [{ step: 1, role: 'product', byproduct: true, name: 'see prose' }]);
  assert.match(placeholder, /no structure resolved for byproduct "see prose"\. That is a placeholder, not a species: list each one by name, or write "none"\./);
  const ordinary = formatRouteAudit(audit, [[]], null, false, [{ step: 1, role: 'reactant', byproduct: false, name: 'bornan-2-ol' }]);
  assert.match(ordinary, /Give that species a name a reference resolves, or its structure\./);
  assert.doesNotMatch(ordinary, /placeholder/);
});

test('every fragment of every species reaches the equation, including repeated counterions', () => {
  // The components of one species are written out because a reaction SMILES cannot carry the
  // boundary; the package regroups them from the labels. Dropping a repeated token to avoid an
  // ambiguous balance used to cost atoms, which is the worse failure: calcium chloride lost a
  // chloride, so any salt with repeated counterions could never balance.
  const salt = buildRouteSteps([[
    { role: 'reactant', smiles: 'CC(=O)O' }, { role: 'reactant', smiles: '[Ca+2].[Cl-].[Cl-]' },
    { role: 'product', smiles: 'CC(=O)[O-]' },
  ]]);
  assert.equal(salt[0], 'CC(=O)O.[Ca+2].[Cl-].[Cl-]>>CC(=O)[O-]', 'both chlorides survive');

  const shared = buildRouteSteps([[
    { role: 'reactant', smiles: 'C[Mg]Br' }, { role: 'reactant', smiles: '[Na+].[Br-]' },
    { role: 'product', smiles: 'C' }, { role: 'product', smiles: '[Mg+2].[Br-]' }, { role: 'product', smiles: '[Na+].[Br-]' },
  ]]);
  assert.equal(shared[0], 'C[Mg]Br.[Na+].[Br-]>>C.[Mg+2].[Br-].[Na+].[Br-]', 'two salts sharing an ion keep both');

  // Unchanged: agents are still dropped from the equation, and a step missing a side is unbuilt.
  const agents = buildRouteSteps([[
    { role: 'reactant', smiles: 'CCO' }, { role: 'agent', smiles: 'O=S(=O)(O)O' }, { role: 'product', smiles: 'CC=O' },
  ]]);
  assert.equal(agents[0], 'CCO>O=S(=O)(O)O>CC=O');
  assert.equal(buildRouteSteps([[{ role: 'reactant', smiles: 'CCO' }]])[0], '', 'no product is still unbuilt');
});

test('the configuration report names each block, what was measured, and what the name asserts', () => {
  // The user-visible half of the configuration work. A block of the opposite configuration has
  // the same formula, atom counts and constitution as the intended one, so the report is the only
  // place a reader can see the difference — and it must never imply a verdict, because which
  // letter belongs to a series flips when a sulfur-bearing branch outranks the carboxyl.
  const species = (input, name, alphaConfiguration) => ({
    input, canonicalSmiles: input, skeletonSmiles: input, formula: 'C9H11NO2', charge: 0,
    heavyAtoms: 12, stereocentres: 1, unspecifiedStereocentres: 0, name, alphaConfiguration,
  });
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [{
      index: 0, reaction: 'a.b>>c', ok: true, balanced: true, chargeBalanced: true, differences: [],
      unspecifiedStereocentres: 0, links: [],
      reactants: [
        species('N[C@@H](C)C(=O)O', 'Fmoc-3-(2-naphthyl)-L-Ala-OH', '(R)'),
        species('N[C@H](C)C(=O)O', 'Fmoc-Asn(Trt)-OH', '(S)'),
        species('CC(=O)O', 'acetic acid', undefined),
        species('N[C@H](C)C(=O)O', '(2S)-2-amino-3-phenylpropanoic acid', '(S)'),
        species('N[C@@H](C)C(=O)O', '(2S)-2-amino-4-methylpentanoic acid', '(R)'),
      ],
      agents: [], products: [species('CCO', 'ethanol', undefined)],
    }],
  });
  const text = formatRouteAudit(audit, [[]], null, false, []);
  assert.match(text, /Building blocks, alpha configuration as measured \(2 \(R\), 2 \(S\)\)/, 'it tallies what it measured');
  assert.match(text, /a block of the wrong configuration balances exactly like the right one/, 'and says why it is reported at all');
  // What the name asserts is shown beside the measurement, never resolved into a verdict.
  assert.match(text, /Fmoc-3-\(2-naphthyl\)-L-Ala-OH \(R\), name says L/, 'an L- name beside an (R) measurement');
  assert.match(text, /Fmoc-Asn\(Trt\)-OH \(S\)(?! ?, name says)/, 'a name that asserts nothing gets no claim');
  // Two CIP statements CAN be compared directly, with no L/D mapping involved.
  assert.match(text, /\(2S\)-2-amino-3-phenylpropanoic acid \(S\), name agrees/, 'matching descriptors agree');
  // The asserted descriptor is normalised to the measured one's form, so the two read side by side.
  assert.match(text, /\(2S\)-2-amino-4-methylpentanoic acid \(R\), NAME SAYS \(S\)/, 'conflicting descriptors are called out');
  // A species with no such centre is left out of the configuration line rather than reported as
  // unknown. It still appears in the step's equation, which is where every species belongs.
  const alphaLine = text.split('\n').find((line) => line.includes('alpha configuration as measured'));
  assert.ok(alphaLine, 'the configuration line is present');
  assert.doesNotMatch(alphaLine, /acetic acid/, 'a reactant with no alpha centre is not in it');
  assert.doesNotMatch(alphaLine, /ethanol/, 'nor is a product');
  assert.match(text, /acetic acid/, 'but it is still in the step equation');
});

test('what a name asserts about configuration is read, and only when it says something', () => {
  for (const [name, expected] of [
    ['Fmoc-3-(2-naphthyl)-L-Ala-OH', 'L'],
    ['N-acetyl-S-trityl-beta,beta-dimethyl-D-glucosamine', 'D'],
    ['(2R)-2-(9H-fluoren-9-ylmethoxycarbonylamino)propanoic acid', '(R)'],
    ['(2S)-2-aminopropanoic acid', '(S)'],
    ['(S)-naproxen', '(S)'],
    ['Fmoc-Asn(Trt)-OH', null],
    ['benzocaine', null],
    ['cyclohexanol', null],
    // A lone capital L or D inside a word must not read as a configuration.
    ['LDA', null],
    ['DMF', null],
  ]) {
    assert.equal(statedConfiguration(name), expected, name);
  }
  assert.equal(statedConfiguration(undefined), null, 'no name asserts nothing');
});

test('a systematic name with braces is a species, not markup', () => {
  // Braces are standard IUPAC punctuation for a nested substituent prefix, and every protected
  // building block carries them. They used to be treated as a sign of markup, so a step that
  // declared such a species BY NAME lost it: the step kept its other reactant, the equation was
  // solved on something the author never wrote, and the report told the author a species it had
  // declared was missing from Reactants. Ten steps of one route failed that way, through three
  // fix rounds, with no unresolved-name message anywhere.
  const named = '(2R)-2-{[(9H-fluoren-9-yl)methoxycarbonyl]amino}-3-(pyridin-3-yl)propanoic acid';
  const answer = [
    '**Step 1 — Couple the building block.** One amide forms.',
    '',
    `Reactants: the chain on the support — \`*NC(=O)CNC\`;${named}`,
    'Products: the extended chain — `*NC(=O)CN(C)C(=O)[C@H](Cc1cccnc1)NC(=O)OCC1c2ccccc2-c2ccccc21`',
    'Byproducts: water — `O`',
    'Agents: N,N-dimethylformamide',
  ].join('\n');
  const species = findStepNamedSpecies(answer, 1);
  const reactants = species[0].filter((entry) => entry.role === 'reactant');
  assert.equal(reactants.length, 2, 'the named building block must be one of the reactants');
  assert.ok(reactants.some((entry) => entry.name === named), 'the braced name must survive verbatim');

  // And markup still does not become a species: angle brackets, quotes and pipes remain tells.
  const markup = [
    '**Step 1 — A drawing, not a declaration.**',
    '',
    'Reactants: <text x="10">Reactants: ethanol</text>;ethanol — `CCO`',
    'Products: ethanal — `CC=O`',
  ].join('\n');
  const scraped = findStepNamedSpecies(markup, 1)[0].filter((entry) => entry.role === 'reactant');
  assert.ok(!scraped.some((entry) => entry.name.includes('<text')), 'markup must still be rejected');
});

test('one fault repeated across steps is stated once, as a pattern', () => {
  // Ten copies of the same sentence read as ten problems and invite ten local edits. One route
  // failed ten coupling steps identically and three correction rounds edited them one at a time
  // without addressing the pattern, so the repeat is now named up front.
  // ok: true with balanced: false is the real shape of a step that parsed and failed its
  // equation; ok: false short-circuits to "could not be parsed" and would group everything.
  const step = (index, missing) => ({
    index, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true,
    differences: [`The declared species cannot be balanced: N: reactants 2, products ${missing}.`],
    unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
  });
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [step(0, 4), step(2, 5), step(4, 6)],
    links: [],
  });
  const labels = [[], [], [], [], []];
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  const backwards = chips.find((chip) => chip.label === 'Fix from the target backwards');
  assert.ok(backwards, 'the whole-route backwards chip exists');
  for (const chip of [chips[0], backwards]) {
    assert.match(chip.prompt, /One fault repeats below, so this is one mistake made several times/);
    assert.match(chip.prompt, /step 1, step 3, step 5 all fail the same way/);
    // and it must quote the real failure, not a generic parse message
    assert.match(chip.prompt, /all fail the same way: not balanced \(The declared species cannot be balanced/);
  }
  // A per-step chip must NOT carry the pattern line: it is scoped to one step by design.
  const single = chips.find((chip) => chip.label === 'Fix step 1');
  if (single) assert.doesNotMatch(single.prompt, /One fault repeats below/);
});

test('distinct faults are not collapsed into a false pattern', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [
      { index: 0, reaction: 'a>>b', ok: true, balanced: false, chargeBalanced: true,
        differences: ['The declared species cannot be balanced: N: reactants 2, products 4.'],
        unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
      { index: 1, reaction: 'c>>d', ok: true, balanced: false, chargeBalanced: true,
        differences: ['This step inverts a stereocentre: its reactants carry 1 (S) and 0 (R).'],
        unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
    ],
    links: [],
  });
  const chips = routeFixChips(formatNamedRouteFixPrompts([[], []], audit));
  assert.doesNotMatch(chips[0].prompt, /One fault repeats below/);
});

test('a bond check that could not run is said out loud, and does not fail the route', () => {
  // The bond-edit search is budgeted and gives up on a hard graph. Until this was reported, a
  // route whose bonds were never examined read exactly like one whose bonds were sound — the
  // fourth instance in one session of a check that did not run looking like a check that passed.
  const facts = (change, reason) => ({
    change, formed: 0, cleaved: 0, ringSizes: [], migration: false, reorganised: false,
    unactivated: 0, unactivatedHetero: 0, heteroElements: [], ...(reason ? { reason } : {}),
  });
  const step = (index, skeleton) => ({
    index, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [],
    unspecifiedStereocentres: 0, reactants: [], agents: [], products: [], skeleton,
  });
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [step(0, facts('none')), step(1, facts('unchecked', 'the search ran out of budget'))],
    links: [{ from: 0, to: 1, reason: 'carried' }],
  });
  const text = formatRouteAudit(audit);
  // The verdict is unchanged: a step whose bonds could not be examined has done nothing wrong.
  assert.match(text, /\*\*Route checked: balanced and connected\*\*/);
  // But the gap in coverage is stated, naming the step and the reason.
  assert.match(text, /Not examined: the bond-edit check could not settle 1 of 2 step\(s\) \(step 2\)/);
  assert.match(text, /gap in coverage, not a finding about the chemistry/);
  assert.match(text, /the search ran out of budget/);

  // And when every step was examined, nothing extra is said.
  const clean = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [step(0, facts('none')), step(1, facts('formed'))],
    links: [{ from: 0, to: 1, reason: 'carried' }],
  });
  assert.doesNotMatch(formatRouteAudit(clean), /could not settle/);
});

test('a replayed answer carries its text, never its drawings', () => {
  // A drawing has already been rendered and read; replaying its markup only spends the window.
  // Dropping the route-drawings section was not enough, because the precedent section is KEPT
  // for the latest answer and carries drawings of its own. Measured on a real route: 652,000
  // characters of answer, 604,000 of it SVG, after which the model said the preceding answer was
  // not in its history and rebuilt the route from scratch instead of correcting it.
  const answer = [
    '**Step 1 — Protect the amine.**',
    'Reactants: glycine; di-tert-butyl dicarbonate',
    'Products: N-(tert-butoxycarbonyl)glycine',
    '',
    '### Route check (RDKit)',
    '- Step 1 OK — balanced.',
    '',
    '### Known reactions (Open Reaction Database)',
    'A precedent worth keeping: amide formation by acylation of an amine.',
    // a realistic size: a real route drawing runs to tens of thousands of characters
    `<svg xmlns="http://www.w3.org/2000/svg" width="300">${'<path d="M 1 2 L 3 4"/>'.repeat(400)}</svg>`,
    'Another precedent line.',
    '',
    '### Route drawings (RDKit)',
    `<svg xmlns="http://www.w3.org/2000/svg">${'<circle r="2"/>'.repeat(400)}</svg>`,
  ].join('\n');

  const replayed = routeReportsForHistory(answer, true);
  assert.ok(!replayed.includes('<svg'), 'no drawing markup survives');
  assert.ok(!replayed.includes('<path'), 'nor its contents');
  // The text around the drawings is what the next turn reasons from, so it must survive.
  assert.match(replayed, /amide formation by acylation of an amine/);
  assert.match(replayed, /Another precedent line/);
  assert.match(replayed, /Reactants: glycine/);
  assert.ok(replayed.length < answer.length / 10, 'and it is far smaller: measured 94-97% on real answers');

  // A truncated drawing must not claim the rest of the answer.
  const unterminated = 'Keep this.\n### Known reactions (Open Reaction Database)\nprecedent\n<svg width="9"><path d="M 1';
  const cut = routeReportsForHistory(unterminated, true);
  assert.ok(!cut.includes('<svg'), 'an unterminated drawing is removed too');
  assert.match(cut, /Keep this/);
});

test('a correction that re-states no route says so, instead of returning prose in silence', () => {
  const correction = `${ROUTE_FIX_PROMPT_LEAD}\n\n- Step 4: not balanced (…)`;

  // Verbatim from the reply that exposed this: the model declined to re-state the route, on the
  // false premise that the earlier steps were missing from its context. Whatever its reason, the
  // round produced nothing checkable and the application said nothing.
  // The decisive sentence, verbatim. The reply's opening line is left out deliberately: it
  // names the chemistry, and what matters here is only that the reply carries no route.
  const refusedReply = "I cannot faithfully re-output the **complete route while preserving passing steps**,"
    + " because the supplied conversation contains only the rejected steps 4 and 5\u2014not the original"
    + " steps 1\u20133, their prose and species lists, or any later workup.";
  assert.match(uncheckedRouteNote(refusedReply, { correction: true }), /re-stated no route/);
  assert.match(uncheckedRouteNote(refusedReply, { correction: true }), /last checked route is the one above/);

  // A correction that DID re-state a route is left alone.
  const withRoute = ['**Step 1 — Something.** Prose.', 'Reactants: ethanol — `CCO`', 'Products: ethanal — `CC=O`'].join('\n');
  assert.equal(uncheckedRouteNote(withRoute, { correction: true }), '', 'a route was re-stated, so there is nothing to report');
  assert.equal(uncheckedRouteNote(withRoute, { correction: false }), '', 'and the same holds for a first answer');
  // An empty answer has no route either, and on a route turn that is worth saying. Whether the
  // note is said at all is the caller's decision, through `asksForRoute`.
  assert.match(uncheckedRouteNote('', { correction: false }), /Nothing in this reply was checked/);
  // The caller's half of this is checked below, on the real pair of turns.
});

test('a route answer the checker cannot read says nothing was checked', () => {
  // Verbatim shape from the answer that exposed this: nine numbered steps with balanced equations
  // and library citations, written with `### 1.` headings and display-maths arrows instead of the
  // contract. `countRouteSteps` reads 0 — no `Step N` heading, no role label — so not one step was
  // resolved, balanced or drawn, and the reply used to be returned exactly as written.
  const offContract = [
    '## Numbered synthesis',
    '',
    '### 1. Prepare the ester hydrochloride — A',
    '',
    String.raw`\[ \mathrm{X + CH_2=C(CH_3)_2 + HCl \rightarrow A} \]`,
    '',
    '**Proposed conditions:** dry dioxane, 0 °C then room temperature.',
    '',
    '### 2. Install the carbamate — B',
    '',
    String.raw`\[ \mathrm{A + ClCO_2CH_2Ph + 2NaHCO_3 \rightarrow B + 2NaCl + 2CO_2 + 2H_2O} \]`,
  ].join('\n');
  assert.equal(countRouteSteps(offContract), 0, 'the premise: the parser finds no step at all');

  const note = uncheckedRouteNote(offContract, { correction: false });
  assert.match(note, /Nothing in this reply was checked/);
  assert.match(note, /Step N/, 'it names the heading the parser reads');
  assert.match(note, /Reactants:/, 'and the labelled lines');
  assert.match(note, /unverified prose/);
  // Not the correction wording: nothing was re-stated here, this was the first answer.
  assert.ok(!note.includes('re-stated no route'));

  // The sibling case is left to ROUTE_MISSING_SPECIES_LEAD, which needs steps to exist. Headings
  // without labels count as steps, so this note must stay out of its way.
  const headingsOnly = '### Step 1 — Something.\nProse only.\n\n### Step 2 — Something else.\nMore prose.';
  assert.ok(countRouteSteps(headingsOnly) > 0, 'headings alone are steps');
  assert.equal(uncheckedRouteNote(headingsOnly, { correction: false }), '', 'that case has its own chip');
});

test('a route conversation stays one when the author types a follow-up', () => {
  // The real pair of turns, reduced to what the predicates read. The request opens the lane; the
  // answer asks a question instead of delivering a route; the author answers the question.
  const request = 'Propose a step-by-step laboratory synthesis of CC(=O)Oc1ccccc1C(=O)O starting from'
    + ' standard precursors. Number each step; for each, give the reagents/conditions and the name'
    + ' of the product formed.';
  const asked = 'Before proposing the route, I need to resolve one stereochemical ambiguity that'
    + ' affects the starting material. Which of the two do you intend?';
  const followUp = 'the alpha carbon will not have stereochemistry so i think you can solve this directly.';

  assert.ok(looksLikeSynthesisRequest(request), 'the premise: the first message reads as a request');
  assert.ok(!looksLikeSynthesisRequest(followUp), 'and the follow-up does not');
  assert.ok(!isRouteFixPrompt(followUp), 'nor is it one of our own chips');

  const opening = [{ role: 'user', content: request }];
  assert.equal(routeConversationState(opening).request, request);
  assert.equal(routeConversationState(opening).delivered, false);
  assert.ok(asksForRoute(opening), 'the request itself asks for a route');

  // The turn that used to fall out of the lane: no contract was sent, no evidence gathered, and
  // the answer that then carried the route was the one turn nothing was asked of.
  const pushedBack = [...opening, { role: 'assistant', content: asked }, { role: 'user', content: followUp }];
  assert.equal(routeConversationState(pushedBack).request, request, 'the anchor is the request, not the follow-up');
  assert.equal(routeConversationState(pushedBack).delivered, false, 'a question is not a delivered route');
  assert.ok(asksForRoute(pushedBack), 'so this turn still asks for a route');

  // Once an answer carries a readable route the contract stops being re-sent: a correction brings
  // its own rules, and an ordinary question after a finished route is not answered with a route.
  const delivered = [...opening, { role: 'assistant', content: ['**Step 1 — Esterification.** Prose.',
    'Reactants: salicylic acid; ethanoic anhydride', 'Products: acetylsalicylic acid', 'Byproducts: ethanoic acid', 'Agents: none'].join('\n') }];
  assert.equal(routeConversationState(delivered).delivered, true);
  assert.ok(!asksForRoute([...delivered, { role: 'user', content: 'what does the anhydride do here?' }]),
    'a question after a finished route is just a question');

  // A conversation that never asked for a route is never in the lane, however much chemistry it
  // talks about — otherwise every molecule question would be told its prose went unchecked.
  const neverAsked = [{ role: 'user', content: 'what is the molecular formula of benzene?' },
    { role: 'assistant', content: 'C6H6.' }, { role: 'user', content: 'and its boiling point?' }];
  assert.equal(routeConversationState(neverAsked).request, null);
  assert.ok(!asksForRoute(neverAsked));

  // A fix chip always asks, whatever the history looks like.
  assert.ok(asksForRoute([{ role: 'user', content: `${ROUTE_FIX_PROMPT_LEAD}\n\n- Step 2: not balanced` }]));
  assert.ok(!asksForRoute([]), 'and an empty conversation asks for nothing');
});

test('the report starts the step support before it waits on the final report', async () => {
  // The two largest costs in a route report were running end to end: measured on one route,
  // drawings 52.9s then step support 41.0s inside a 96.7s total, where the precedent lookup they
  // both wait on took 6.4s. The support needs the lookup's classes and nothing else — in
  // particular not the drawings — so it belongs beside them, not behind them.
  const source = await readFile(new URL('../electron/ai/moleculeInspection.ts', import.meta.url), 'utf8');
  const support = source.indexOf("timed('step support'");
  // Renamed when every diagram moved into one gated final report; the ordering it guards is the
  // same, since that report is still the phase the drawings happen inside.
  const drawings = source.indexOf("await timed('final report'");
  const review = source.indexOf("timed('review'");
  assert.ok(support > 0 && drawings > 0 && review > 0, 'all three phases are present');
  assert.ok(support > review, 'the support follows the review, which starts the precedent lookup chain');
  assert.ok(support < drawings, 'and is started before the final report is awaited, not after');
});

test('a step that balanced only by refiling a declared reactant is a failing step', () => {
  // One error class took two paths, and only one of them reached the model. When the solver gives
  // a listed species coefficient 0 and no refiling rescues the balance, the step reports NOT
  // balanced and names it — measured on a real run, five such instances were all five fixed by the
  // correction round. When refiling DOES rescue it, the step reported balanced and the finding
  // went to the report only; the one instance of that survived its correction round untouched.
  const refiled = '"trifluoroacetic acid" was listed under Reactants, and the step balances only if'
    + ' it takes no part, so the check treated it as a condition. If that is right, list it under'
    + ' Agents. If it is genuinely consumed, then the product it becomes is missing from this step,'
    + ' and naming it is what makes the equation close.';
  const base = {
    index: 0, reaction: 'a>>b', ok: true, reactants: [], agents: [], products: [],
    balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
  };
  // The step balances — that is not in dispute and is not what is reported.
  assert.equal(routeStepFailure({ ...base, refiledReactant: refiled }), refiled);
  // Which path it takes turns on how far the rescue search reaches, not on the chemistry, so a
  // step with nothing refiled is still clean.
  assert.equal(routeStepFailure(base), null);
  // The ordering matters: a step that does not balance at all reports that first, because the
  // refiled note presumes a balance was reached.
  assert.match(routeStepFailure({ ...base, balanced: false, differences: ['O: reactants 2, products 1'], refiledReactant: refiled }), /not balanced/);
});

test('a route answer draws only through the final report', () => {
  // The route lane decides what is drawn and when. A `chemistry-plan` fence let the model draw on
  // any turn whatever the verdict; on the 30-target cascade all 58 of them failed the capability's
  // 8000-character limit and printed a raw application error into the answer instead (B45).
  const answer = 'Step 1 is the bromination.\n\n```chemistry-plan\n{"draw":"bromobenzene","question":"…"}\n```\n\nStep 2 follows.';
  const { text, removed } = stripDrawingRequests(answer);
  assert.equal(removed, 1);
  assert.doesNotMatch(text, /chemistry-plan/, 'the directive cannot survive, or the pipeline runs it');
  assert.match(text, /the final report draws them all/, 'and the gap says why nothing was drawn');
  // The prose on both sides is the model's answer and is kept.
  assert.match(text, /Step 1 is the bromination\./);
  assert.match(text, /Step 2 follows\./);
  // Ordinary chat is untouched: nothing here runs unless the turn asked for a route.
  assert.equal(stripDrawingRequests('Draw me aspirin.').removed, 0);
});

test('every step of a passing route is summarised the same way the check reports it', () => {
  // The final report prints a summary per step beside its diagram. It shares its formatting with
  // the route check block so the two cannot drift — which is the B44 failure mode, one step
  // described two different ways in one answer.
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [], links: [],
    steps: [{
      index: 0, reaction: 'c1ccccc1.BrBr>>Brc1ccccc1.Br', ok: true, balanced: true, chargeBalanced: true,
      differences: [], unspecifiedStereocentres: 0,
      reactants: [{ canonicalSmiles: 'c1ccccc1', formula: 'C6H6', heavyAtoms: 6 }, { canonicalSmiles: 'BrBr', formula: 'Br2', heavyAtoms: 2 }],
      agents: [], products: [{ canonicalSmiles: 'Brc1ccccc1', formula: 'C6H5Br', heavyAtoms: 7 }, { canonicalSmiles: 'Br', formula: 'HBr', heavyAtoms: 1 }],
    }],
  });
  const [first] = routeStepSummaries(audit, [[]]);
  assert.equal(first.index, 0);
  assert.match(first.summary, /C6H6/);
  assert.match(first.summary, /→/, 'both sides of the equation are shown');
  assert.match(first.summary, /C6H5Br/);
  // No verdict in the line: the report only prints when every step already passed.
  assert.doesNotMatch(first.summary, /\bOK\b|\bFAIL\b/);
});

test('the step line and the route verdict cannot disagree about which step failed', () => {
  // B44, found on the 30-target small-molecule cascade: 27 of 90 failing turns printed
  // "- Step N OK — balanced" directly under "Route check failed — 1 of N step(s) do not pass
  // (step N)". The header asked `routeStepFailure`; the step line re-listed the causes by hand and
  // did not know about `monatomicSpecies` or `refiledReactant`. 4-bromoaniline and fluorobenzene
  // each spent every fix round at three separate rungs being told the step was fine and not fine
  // at once, and neither ever recovered. Both verdicts now come from the one predicate.
  const base = {
    index: 0, reaction: 'a>>b', ok: true, reactants: [], agents: [], products: [],
    balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
  };
  const lone = '`[Br]` should be `BrBr`. A lone atom of that element is not a species a route uses:'
    + ' its free form is diatomic.';
  for (const [cause, step] of [['monatomicSpecies', { ...base, monatomicSpecies: lone }],
    ['refiledReactant', { ...base, refiledReactant: 'water was listed under Reactants.' }]]) {
    const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [step], links: [] });
    const text = formatRouteAudit(audit);
    const named = /do not pass \(step 1\)/.test(text);
    const line = text.split('\n').find((entry) => entry.startsWith('- Step 1'));
    assert.equal(named, line.startsWith('- Step 1 FAIL'),
      `${cause}: the header and the step line must agree — header named it: ${named}, line: ${line}`);
    // And the line has to say WHY. A lone atom printed no sentence at all, so the step failed
    // while naming no fault, which is the half of the bug the model could not work around.
    assert.ok(line.includes(cause === 'monatomicSpecies' ? 'diatomic' : 'listed under Reactants'),
      `${cause}: the step line names the fault it failed on — got: ${line}`);
  }
});
