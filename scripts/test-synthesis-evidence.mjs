import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-synthesis-evidence-'));
const outfile = path.join(tmp, 'synthesisEvidence.mjs');
await build({ entryPoints: [path.join(root, 'shared/synthesisEvidence.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const evidence = await import(pathToFileURL(outfile).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

test('the textbook scope is synthetic-chemistry titles and chemistry collections', () => {
  const { isSynthesisEvidenceWork } = evidence;
  assert.equal(isSynthesisEvidenceWork('Organic Chemistry 9th Ed'), true);
  assert.equal(isSynthesisEvidenceWork('Advanced Organic Chemistry: Part B: Reaction and Synthesis'), true);
  assert.equal(isSynthesisEvidenceWork('Lehninger Principles of Biochemistry 8th Ed.', ['Chemistry']), true, 'a chemistry collection brings a work into scope');
  assert.equal(isSynthesisEvidenceWork('Dissolution Testing of Oral Dosage Forms'), false);
  assert.equal(isSynthesisEvidenceWork(''), false);
});

test('each evidence phase is timed from when it starts, not from when it is awaited', async () => {
  const { evidencePhases } = evidence;
  let clock = 0;
  const phases = evidencePhases(() => clock);

  // Two of the real phases are launched early and awaited last. Timing them at the await would
  // report only the sliver of time left by then and make a slow parallel phase look instant,
  // which is the whole reason the 394s block was undiagnosable.
  let release;
  const slow = phases.track('route search', new Promise(resolve => { release = resolve; }));
  clock = 5_000;
  const quick = phases.track('passages', Promise.resolve('p'));
  assert.equal(await quick, 'p');
  clock = 9_000;
  release('r');
  assert.equal(await slow, 'r');

  // Settle order, and each phase's OWN span: passages started and finished at 5s; the route
  // search started at 0 and ran the full 9s beside it.
  assert.equal(phases.line(), 'passages 0.0s · route search 9.0s');
});

test('a phase that fails is still timed, because how long it ran before giving up is the point', async () => {
  const { evidencePhases } = evidence;
  let clock = 0;
  const phases = evidencePhases(() => clock);
  const doomed = phases.track('ORD disconnections', Promise.reject(new Error('index unavailable')));
  clock = 2_500;
  await assert.rejects(doomed, /index unavailable/, 'the failure still propagates');
  assert.equal(phases.line(), 'ORD disconnections 2.5s', 'the time it ran before failing is recorded');
});

test('no phases means an empty line, not a stray separator', () => {
  assert.equal(evidence.evidencePhases(() => 0).line(), '');
});

test('starting materials are the SMILES after "starting from", never the target', () => {
  const { findStartingSmiles, findTargetName } = evidence;
  const hexene = 'Propose a step-by-step laboratory synthesis of (Z)-hex-3-ene (SMILES: CC/C=C\\CC),\nstarting from acetylene (C#C) and bromoethane (CCBr) plus common inorganic reagents and solvents.';
  assert.deepEqual(findStartingSmiles(hexene, 'CC/C=C\\CC'), ['C#C', 'CCBr']);
  assert.equal(findTargetName(hexene), '(Z)-hex-3-ene');
  const aspirin = 'Propose a step-by-step laboratory synthesis of acetylsalicylic acid (aspirin, SMILES:\nCC(=O)Oc1ccccc1C(=O)O), starting from phenol (Oc1ccccc1), carbon dioxide, and acetic\nanhydride plus common inorganic reagents.';
  assert.deepEqual(findStartingSmiles(aspirin, 'CC(=O)Oc1ccccc1C(=O)O'), ['Oc1ccccc1']);
  assert.equal(findTargetName(aspirin), 'acetylsalicylic acid');
  const ibuprofen = 'Propose a step-by-step laboratory synthesis of ibuprofen (2-(4-isobutylphenyl)propanoic\nacid, SMILES: CC(C)Cc1ccc(cc1)C(C)C(=O)O), starting from isobutylbenzene (CC(C)Cc1ccccc1).';
  assert.equal(findTargetName(ibuprofen), 'ibuprofen');
  assert.deepEqual(findStartingSmiles(ibuprofen, 'CC(C)Cc1ccc(cc1)C(C)C(=O)O'), ['CC(C)Cc1ccccc1']);
  assert.deepEqual(findStartingSmiles('Propose a synthesis of tropinone (SMILES: CN1C2CCC1CC(=O)C2).'), [], 'no "from" clause, no starting materials');
  assert.deepEqual(findStartingSmiles('Synthesis of X (SMILES: CCO) from benzene (1 equiv) and toluene (Cc1ccccc1).'), ['Cc1ccccc1'], 'an amount is not a structure');
});

const artifact = {
  disconnections: [{
    input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1',
    madeBy: { count: 40, asReactant: 900, reactions: [
      { key: 'k1', count: 12, samples: ['ord-1'], reaction: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1>>CCOC(=O)c1ccc(N)cc1', uses: {} },
      { key: 'k2', count: 3, samples: [], reaction: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1>>CCOC(=O)c1ccc(N)cc1', uses: {} },
    ] },
    proposals: [
      { precursors: 'CCO.Nc1ccc(C(=O)O)cc1', templateCount: 90, rdchiral: 1, recorded: 1, samples: [], availability: 5000, available: true, uses: {}, classes: ['Fischer esterification'], fromStarts: false },
      { precursors: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1', templateCount: 400, rdchiral: 1, recorded: 0, samples: [], availability: 300, available: true, uses: {}, classes: ['nitro group reduction to amine'], fromStarts: false },
    ],
    proposalsConsidered: 9,
  }],
};

test('the ORD brief keeps what the model needs and drops the rest', () => {
  const { normalizeDisconnections, disconnectionClasses, secondLevelTargets, synthesisEvidencePayload, SYNTHESIS_EVIDENCE_KEY } = evidence;
  const briefs = normalizeDisconnections(artifact);
  assert.equal(briefs.length, 1);
  assert.deepEqual(briefs[0].recordedRoutes, [{ precursors: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1', count: 12 }], 'one entry per distinct precursor set');
  assert.deepEqual(briefs[0].proposals[0], { precursors: 'CCO.Nc1ccc(C(=O)O)cc1', classes: ['Fischer esterification'], recorded: 1, available: true, fromStarts: false });
  assert.deepEqual(disconnectionClasses(briefs), ['Fischer esterification', 'nitro group reduction to amine']);
  assert.deepEqual(secondLevelTargets(briefs, []), ['Nc1ccc(C(=O)O)cc1', 'CCOC(=O)c1ccc([N+](=O)[O-])cc1'], 'ethanol is a reagent, not a second-level target');
  assert.deepEqual(secondLevelTargets(briefs, ['Nc1ccc(C(=O)O)cc1']), ['CCOC(=O)c1ccc([N+](=O)[O-])cc1'], 'a starting material is not disconnected again');
  assert.deepEqual(normalizeDisconnections(null), []);
  assert.deepEqual(normalizeDisconnections({ disconnections: [{ target: '' }] }), []);
  assert.equal(synthesisEvidencePayload(null), null);
  assert.equal(synthesisEvidencePayload({ target: 'C', startingMaterials: [], disconnections: [], passages: [] }), null, 'nothing found adds nothing');
  const payload = synthesisEvidencePayload({ target: 'CCOC(=O)c1ccc(N)cc1', startingMaterials: [], disconnections: briefs, passages: [] });
  assert.equal(payload.ord_disconnections[0].molecule, 'CCOC(=O)c1ccc(N)cc1');
  assert.ok(!('textbook_passages' in payload) && !('starting_materials' in payload));
  assert.equal(SYNTHESIS_EVIDENCE_KEY, 'evidencia_para_la_ruta');
});

test('textbook queries use textbook reaction names and skip classes with none', () => {
  const { synthesisEvidenceQueries, isIndexLikePassage } = evidence;
  assert.deepEqual(
    synthesisEvidenceQueries('benzocaine', ['Fischer esterification', 'intramolecular aldol condensation (Robinson annulation)', 'rearrangement or isomerization']),
    ['benzocaine synthesis', 'Fischer esterification', 'Robinson annulation'],
  );
  assert.deepEqual(synthesisEvidenceQueries(null, []), []);
  assert.equal(isIndexLikePassage('reduction by dissolving metals, 439 LiAlH4, 423–425 synthesis from boranes by homologation, 796–797 Allene addition reactions, 333–334'), true);
  assert.equal(isIndexLikePassage('Mechanism of Fischer esterification. The reaction is an acid-catalyzed nucleophilic acyl substitution of a carboxylic acid.'), false);
});

test('the research chat adds the evidence only to a new route request and reserves room for it', async () => {
  const source = await readFile(path.join(root, 'electron/ai/researchAssistant.ts'), 'utf8');
  // The template goes with a request, not with a correction: the chip carries the same rules.
  assert.match(source, /const routeRequest = chemistryRoute && !isRouteFixPrompt\(question\);/);
  assert.match(source, /routeEvidence \? SYNTHESIS_EVIDENCE_SYSTEM_RULE : ''/);
  assert.match(source, /routeEvidence \? JSON\.stringify\(routeEvidence\)\.length : 0/, 'the budget reserves the evidence');
  const app = await readFile(path.join(root, 'electron/ai/synthesisEvidence.ts'), 'utf8');
  assert.match(app, /isSynthesisEvidenceWork\(/, 'retrieval is scoped to chemistry texts');
});

test('a route request retrieves corpus context for its chemistry, not its output rules', async () => {
  const { synthesisRetrievalQuery, normalizeDisconnections } = evidence;
  const request = 'Propose a step-by-step laboratory synthesis of benzocaine (SMILES: CCOC(=O)c1ccc(N)cc1), starting from 4-nitrotoluene (Cc1ccc([N+](=O)[O-])cc1). Number each step; for each, give the reagents/conditions.';
  const gathered = { target: 'CCOC(=O)c1ccc(N)cc1', startingMaterials: [], disconnections: normalizeDisconnections(artifact), passages: [] };
  assert.equal(synthesisRetrievalQuery(request, gathered), 'benzocaine synthesis; Fischer esterification; reduction of nitro compounds to arylamines');
  assert.equal(synthesisRetrievalQuery(request, null), 'benzocaine synthesis');
  assert.equal(synthesisRetrievalQuery('Make CCO somehow', null), 'Make CCO somehow', 'no target name: the request itself');
  const source = await readFile(path.join(root, 'electron/ai/researchAssistant.ts'), 'utf8');
  assert.match(source, /contradictions: false, gaps: false \}, question, contextBudget, promptLanguage, \{ retrievalQuery: retrievalQuestion \}/);
});


test('a route correction keeps Chemistry Studio and gets chemistry-focused corpus context', async () => {
  const source = await readFile(path.join(root, 'electron/ai/researchAssistant.ts'), 'utf8');
  // The fix chip's turn gets the chemistry skill back even in an academic vault (no standing skills).
  // Any route turn, not only a fix chip: an academic vault has no standing skills, so a route
  // started with @ lost the capability the moment the author typed a follow-up of their own, and
  // the turn came back with no checks and no notice (the notice needs the skill to be present).
  assert.match(source, /const fixSkills = routeTurn \? capabilityChatSkills\('nodus:chemistry'\) : \[\];/);
  // Route requests and corrections both count as chemistry turns; the correction searches with
  // the original request's chemistry, not the fix prompt's text.
  // Whether a route was asked for is read from the conversation, not from the latest message: a
  // human follow-up is neither a fresh request nor a fix chip, and deciding from the latest
  // message alone dropped the route lane exactly when the author pushed back.
  assert.match(source, /const chemistryRoute = chemistryEnabled && !genealogy && asksForRoute\(turns\);/);
  assert.match(source, /message\.role === 'user' && !isRouteFixPrompt\(message\.content\)/);
  // And the evidence is anchored to the conversation's own request ahead of `originalRequest`,
  // which a human follow-up satisfies and would otherwise become the anchor for.
  assert.match(source, /const routeQuestion = route\.request \?\? originalRequest \?\? question;/);
  // The audit must agree with the prompt, or a turn asked for a route goes unreported.
  assert.match(source, /const routeTurn = asksForRoute\(request\.messages\);/);
  // The corpus path (5.7 academic chat) uses it too, and drops library-wide gaps and contradictions.
  assert.match(source, /await run\.investigate\(chemistryRoute \? retrievalQuestion : plan\.goal, request\.model\)/);
  assert.match(source, /contradicciones: request\.selection\.contradictions && !chemistryRoute/);
  assert.match(source, /huecos: request\.selection\.gaps && !chemistryRoute/);
  const skills = await readFile(path.join(root, 'electron/chatSkills.ts'), 'utf8');
  assert.match(skills, /export function capabilityChatSkills\(capability: string\)/);
  assert.match(skills, /skillActive\(skill\) && runnable\(skill\) && \(skill\.capabilities \?\? \[\]\)\.includes\(capability\)/, 'a skill the user disabled is not brought back');
});

test('a textbook passage must actually discuss the reaction class, and is quoted where it does', () => {
  const { passageFitsClass, passageFitsQuery, relevantExcerpt } = evidence;
  // Suite critiques: an enzyme page offered for a thermal decarboxylation.
  const enzyme = 'Pyridoxine (vitamin B 6) is the cofactor for l-aromatic amino acid decarboxylase. In high doses, vitamin B 6 can reverse the therapeutic effects of l-DOPA by increasing its decarboxylation.';
  assert.equal(passageFitsClass('decarboxylation', enzyme), false);
  assert.equal(passageFitsClass('decarboxylation', 'On heating, a malonic acid loses CO2: decarboxylation of the β-diacid gives a substituted acetic acid.'), true);
  // Terms far apart do not count: an acid chloride here, a reduction 600 characters later.
  const apart = `Thionyl chloride is a reagent. ${'Filler text about something else entirely. '.repeat(15)} The carboxylic acid was reduced.`;
  assert.equal(passageFitsClass('acid chloride formation with thionyl chloride', apart), false);
  const together = `${'The previous problem asked about Grignard reagents. '.repeat(6)}Subsequent reaction with thionyl chloride results in the conversion of the carboxylic acid to the desired acid chloride.`;
  assert.equal(passageFitsClass('acid chloride formation with thionyl chloride', together), true);
  // The excerpt opens on the sentence that discusses the class, not the passage's first words.
  assert.match(relevantExcerpt('acid chloride formation with thionyl chloride', together, 120), /^…Subsequent reaction with thionyl chloride/);
  assert.equal(passageFitsClass('nitro group reduction to amine', 'Arylamines are prepared by nitration of an aromatic ring followed by reduction.'), true);
  // Queries map back to their class; the target query needs the target named.
  assert.equal(passageFitsQuery('Beckmann rearrangement', 'Entry 10 uses the Pb(OAc)4 conditions for an herbicide intermediate.'), false);
  assert.equal(passageFitsQuery('malonic ester synthesis acetoacetic ester synthesis', 'The malonic ester synthesis alkylates the enolate of diethyl malonate.'), true);
  assert.equal(passageFitsQuery('caprolactam synthesis', 'Nylon 6 is made by ring-opening polymerisation.'), false);
});

test('starting materials that imply a textbook method add its textbook search', () => {
  const { requestMethodClasses, synthesisEvidenceQueries } = evidence;
  const malonic = 'Propose a synthesis of 2-methylbutanoic acid (SMILES: CCC(C)C(=O)O), starting from diethyl malonate (CCOC(=O)CC(=O)OCC), iodomethane and bromoethane.';
  assert.deepEqual(requestMethodClasses(malonic), ['enolate alkylation (malonic or acetoacetic ester synthesis)']);
  assert.ok(synthesisEvidenceQueries('2-methylbutanoic acid', requestMethodClasses(malonic)).includes('malonic ester synthesis acetoacetic ester synthesis'));
  // By SMILES alone, and for methyl vinyl ketone → Robinson annulation.
  assert.deepEqual(requestMethodClasses('Make X (SMILES: CC) from COC(=O)CC(C)=O.'), ['enolate alkylation (malonic or acetoacetic ester synthesis)']);
  assert.deepEqual(requestMethodClasses('…starting from 2-methylcyclohexane-1,3-dione and but-3-en-2-one (C=CC(C)=O)…'), ['intramolecular aldol condensation (Robinson annulation)']);
  assert.deepEqual(requestMethodClasses('Propose a synthesis of benzocaine from 4-nitrotoluene.'), []);
});

test('starting materials are organic reactants no earlier step makes, in first-use order', () => {
  const { routeStartingMaterials } = evidence;
  const label = (role, name, smiles, byproduct = false) => ({ role, name, smiles, byproduct });
  const labels = [
    [label('reactant', '4-nitrotoluene', 'Cc1ccc([N+](=O)[O-])cc1'), label('reactant', 'potassium permanganate', 'O=[Mn](=O)(=O)[O-].[K+]'), label('product', '4-nitrobenzoic acid', 'O=C(O)c1ccc([N+](=O)[O-])cc1')],
    [label('reactant', '4-nitrobenzoic acid', 'O=C(O)c1ccc([N+](=O)[O-])cc1'), label('reactant', 'ethanol', 'CCO'), label('product', 'ethyl 4-nitrobenzoate', 'CCOC(=O)c1ccc([N+](=O)[O-])cc1'), label('product', 'water', 'O', true)],
  ];
  assert.deepEqual(routeStartingMaterials(labels).map((entry) => entry.name), ['4-nitrotoluene', 'ethanol']);
  // Inorganic reagents are not starting materials, even with a C in an element symbol.
  const dichromate = [[label('reactant', 'sodium dichromate', 'O=[Cr](=O)([O-])O[Cr](=O)(=O)[O-].[Na+].[Na+]'), label('reactant', 'thionyl chloride', 'O=S(Cl)Cl'), label('reactant', 'benzene', 'c1ccccc1'), label('product', 'x', 'CC')]];
  assert.deepEqual(routeStartingMaterials(dichromate).map((entry) => entry.name), ['benzene']);
  const { hasCarbon } = evidence;
  assert.deepEqual(['CCO', 'c1ccccc1', 'O=C=O', '[Cu+2]', 'ClCl', '[Ca+2]', '[Sc+3]', 'C'].map(hasCarbon), [true, true, true, false, false, false, false, true]);
});

test('the stock line names each starting material and the lists that hold it; no lists, no line', () => {
  const { formatStartingMaterialStock } = evidence;
  const starting = [{ name: '4-nitrotoluene', smiles: 'A' }, { name: 'ethanol', smiles: 'B' }];
  assert.equal(formatStartingMaterialStock(starting, { A: ['mcule'], B: [] }, ['enamine', 'mcule']),
    '**Starting materials:** 1 of 2 in stock (enamine, mcule) — 4-nitrotoluene (in stock: mcule); ethanol (not on your stock lists).');
  assert.equal(formatStartingMaterialStock(starting, { A: [], B: [] }, ['mcule'], { B: ['mcule-full'] }, ['mcule-full']),
    '**Starting materials:** 0 of 2 in stock (mcule, mcule-full (make-on-demand)) — 4-nitrotoluene (not on your stock lists); ethanol (orderable, make-on-demand: mcule-full).');
  assert.equal(formatStartingMaterialStock(starting, {}, []), '');
});

test('a purchasable disconnection keeps the vendors that stock every precursor', () => {
  const { normalizeDisconnections } = evidence;
  const [entry] = normalizeDisconnections({ disconnections: [{ target: 'T', input: 'T', proposals: [
    { precursors: 'A.B', recorded: 0, available: false, purchasable: true, inStock: { A: ['mcule', 'enamine'], B: ['mcule'] } },
    { precursors: 'C', recorded: 2, available: true },
  ] }] });
  assert.equal(entry.proposals[0].purchasable, true);
  assert.deepEqual(entry.proposals[0].vendors, ['mcule']);
  assert.equal('purchasable' in entry.proposals[1], false);
});
