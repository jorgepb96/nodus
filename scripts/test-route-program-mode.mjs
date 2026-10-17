// Program mode replaces the names-first contract outright. The two cannot both be in force: the
// names-first format asks for four labelled lines of species per step, program mode asks for
// operations and NO species at all, so a prompt carrying both would contradict itself — and a
// contradictory prompt is worse than either mode alone.
//
// Why the mode exists, measured on chainL-3 (2026-10-13): the model got all ten assembly steps
// right and then mis-declared ONE formula, which failed two steps and survived three fix rounds
// unchanged — the failure text byte-identical on every turn. In program mode it never writes a
// formula, so that class of error cannot occur.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-program-mode-'));
// Cleaned up at process exit, NOT in an `after` hook. The tests below are registered after the
// top-level awaits that build the shared bundles, so the runner drains the tests it already knows
// about and fires `after` — removing this directory — before the rest have run. The casualty was
// never the directory, which esbuild re-creates for its own output, but a bundle written into it
// beforehand: a test then imported a path that had just been deleted. Which test lost its bundle
// depended on how many had run by then, so it moved whenever the parser test below was skipped,
// which reads like a missing checkout and is not one.
//
// Cleanup stays best-effort: the directory is in the OS temp area, and losing it matters less
// than a green suite reporting itself red. A recursive rmdir racing a last write fails ENOTEMPTY
// on macOS under load, which once failed this whole file while every assertion in it passed.
process.on('exit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // left for the OS to reap
  }
});

/** The rules are read through the environment, and both modules bake it in at import, so each
 *  setting needs its own build and its own module instance. */
async function load(setting, stem) {
  process.env.NODUS_ROUTE_PROGRAM = setting;
  const rules = path.join(dir, `rules-${stem}.mjs`);
  const prompt = path.join(dir, `prompt-${stem}.mjs`);
  await bundleModule('shared/routeRules.ts', rules);
  await bundleModule('shared/synthesisPrompt.ts', prompt);
  return {
    ...(await import(pathToFileURL(rules).href)),
    ...(await import(pathToFileURL(prompt).href)),
  };
}

/** Bundle one module into `dir` and return its path, ready to import.
 *
 *  The directory is re-created on every write, which is not belt-and-braces: this file registers
 *  tests AFTER top-level awaits (the shared bundles below), so the runner drains the tests it
 *  already knows about, fires the `after` hook above — deleting `dir` — and only then runs the
 *  rest. esbuild quietly re-creates the directory for its own output, so the symptom was not a
 *  missing directory but a missing FILE: `rules-note.mjs` written, `dir` removed, then re-created
 *  by the next build. Which test lost its bundle depended on how many ran before the hook, so it
 *  moved whenever the parser test below was skipped — reading like a missing checkout and not
 *  being one.
 *
 *  Writing the bytes here rather than letting esbuild write them also closes a second gap: the
 *  output is produced asynchronously, and an `import()` of a path esbuild has just reported as
 *  written can still fail with ERR_MODULE_NOT_FOUND. */
async function bundleModule(entry, outfile) {
  const built = await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', write: false });
  const [output] = built.outputFiles;
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, output.contents);
  return outfile;
}

/** The extractor is shared, so it is testable without the application. */
const inspection = await (async () => {
  const out = path.join(dir, 'inspection.mjs');
  await bundleModule('shared/moleculeInspection.ts', out);
  return import(pathToFileURL(out).href);
})();

test('the program is taken from its own fence, and only the first', () => {
  const { findRouteProgram } = inspection;
  const answer = [
    'Here is the route.', '',
    '```route-program',
    'start M1 = ethanoic acid',
    '',
    'M2 = apply(M1, acid-to-acyl-chloride, thionyl chloride)',
    '```', '',
    'The target is M2.',
  ].join('\n');
  assert.equal(findRouteProgram(answer), 'start M1 = ethanoic acid\nM2 = apply(M1, acid-to-acyl-chloride, thionyl chloride)');

  // An answer offering two programs has not decided which route it means; the tool takes one.
  const two = `${answer}\n\n\`\`\`route-program\nstart M9 = water\n\`\`\``;
  assert.equal(findRouteProgram(two), 'start M1 = ethanoic acid\nM2 = apply(M1, acid-to-acyl-chloride, thionyl chloride)');

  // No fence, an empty fence, and a different language are all "no program", not an error.
  assert.equal(findRouteProgram('a prose answer with no program'), null);
  assert.equal(findRouteProgram('```route-program\n\n```'), null);
  assert.equal(findRouteProgram('```python\nstart M1 = x\n```'), null);
  assert.equal(findRouteProgram(''), null);
});

const transforms = await (async () => {
  const out = path.join(dir, 'transforms.mjs');
  await bundleModule('shared/routeProgramTransforms.ts', out);
  return import(pathToFileURL(out).href);
})();

test('the transformation list comes from the package, and one bad entry does not cost the rest', () => {
  const { parseRouteTransforms, routeProgramTransformsBlock } = transforms;
  const shipped = {
    transforms: [
      { id: 'amide-formation', summary: 'Couple an acid with an amine.', site: 'carboxylic acid' },
      { id: 'no-summary' },
      { id: '', summary: 'nameless' },
      null,
      { id: 'amide-formation', summary: 'a duplicate id' },
      { id: 'ester-hydrolysis', summary: 'Hydrolyse an ester.', site: 'ester', futureField: 1 },
    ],
  };
  const parsed = parseRouteTransforms(shipped);
  assert.deepEqual(parsed.map((t) => t.id), ['amide-formation', 'ester-hydrolysis'],
    'malformed and duplicate entries are dropped, the rest survive');
  const block = routeProgramTransformsBlock(parsed);
  assert.match(block, /Use the id exactly as written/);
  assert.match(block, /amide-formation \(acts at: carboxylic acid\)/);
  // The site is carried because the contract lets `site:` be omitted only when one place matches,
  // which the model cannot judge without knowing what the transformation looks for.
  assert.match(block, /ester-hydrolysis \(acts at: ester\)/);

  // Nothing readable means no block at all, never a block offering nothing.
  assert.equal(routeProgramTransformsBlock([]), '');
  assert.deepEqual(parseRouteTransforms({}), []);
  assert.deepEqual(parseRouteTransforms(null), []);
  assert.deepEqual(parseRouteTransforms({ transforms: 'not an array' }), []);
});

/** The program parser belongs to the chemistry package, in the other checkout. When it is there,
 *  every example this prompt shows a model is run through it.
 *
 *  Why: measured 2026-10-13. The contract was written from a design sketch rather than from the
 *  implemented grammar, so it taught `start M1 = x` and `apply(M1, an-id, reagent)` when the
 *  language is `M1 = start("x")` and `M2 = apply(M1, named="an-id", reagents=["reagent"])`. The
 *  model followed the contract exactly and every line was refused. An example in a prompt is a
 *  promise about a language; this checks the promise. */
const builtInspection = {};
async function inspectionFor(setting) {
  if (builtInspection[setting]) return builtInspection[setting];
  process.env.NODUS_ROUTE_PROGRAM = setting;
  const out = path.join(dir, `inspection-${setting}.mjs`);
  await bundleModule('shared/moleculeInspection.ts', out);
  builtInspection[setting] = await import(pathToFileURL(out).href);
  return builtInspection[setting];
}

const PARSER = path.resolve('../marketplace/plugins/chemistry-studio/src/engine/routeProgram.ts');
const CAPABILITY = path.resolve('../marketplace/plugins/chemistry-studio/capabilities/chemistry/capability.json');
const parser = await (async () => {
  if (!fs.existsSync(PARSER)) return null;
  try {
    const out = path.join(dir, 'parser.mjs');
    await bundleModule(PARSER, out);
    return import(pathToFileURL(out).href);
  } catch {
    return null;
  }
})();

test('every program example in the prompt parses against the real grammar', { skip: parser ? false : 'the chemistry package checkout is not beside this one' }, async () => {
  const on = await load('on', 'examples');
  // The worked example the output format shows, taken from the prompt itself rather than restated.
  const fenced = /```route-program\r?\n([\s\S]*?)```/.exec(on.SYNTHESIS_TEMPLATE_ADDENDUM);
  assert.ok(fenced, 'the output format shows a program example');
  const example = fenced[1].split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  const parsed = parser.parseRouteProgram(example);
  assert.deepEqual(parsed.diagnostics.map((d) => d.message), [], 'the worked example must parse');
  assert.deepEqual(parsed.program.lines.map((l) => l.kind), ['start', 'apply', 'apply', 'target']);

  // EVERY argument the main program rules show must be one the parser takes. The check above
  // scans ROUTE_PROGRAM_DOMAIN_RULES and the addendum, and only snippets shaped like a whole
  // `M2 = apply(...)` statement — so an argument taught as a bare fragment in ROUTE_PROGRAM_RULES
  // was never validated. That gap cost a run twice on 2026-10-14: `carry=` was taught to the
  // contract and the engine before the parser knew it, and chainP-4 wrote a correct eight-step
  // tetrapeptide using it and was refused after 888 s; and a first draft of the marks rule taught
  // `site={mark: 1}` when the grammar takes `site=@M3`. Each fragment is wrapped in the smallest
  // program that can hold it and parsed.
  const argumentForms = new Set();
  // routeProgramRules() rather than the array: ROUTE_PROGRAM_RULES is an unexported const, so an
  // export walk sees nothing and the loop below would pass by checking zero fragments. The
  // function returns exactly what the model is given, which is the right thing to validate.
  for (const rule of on.routeProgramRules()) {
    for (const quoted of [...rule.matchAll(/`([^`]+)`/g)].map((m) => m[1])) {
      // The WHOLE backticked snippet when it is an argument, never a sub-match. A bracket regex
      // like /\[[^\]]*\]/ stops at the first "]", and a SMILES is full of them — `[C@H]` cuts
      // `reagents=[smiles="O=C(O)[C@H](...)"]` in half and the fragment no longer parses. This
      // file already warned about that below and the warning was not enough, so: no sub-matching.
      // A value is required after the `=`: the rules also name a bare `site=` when telling the
      // author when to OMIT it, and that is prose about the argument, not an example of one.
      if (/^(?:site|carry|reagents|markAs)\s*=\s*\S/.test(quoted)) argumentForms.add(quoted);
    }
  }
  assert.ok(argumentForms.size >= 4, `the rules should show several arguments, found ${argumentForms.size}`);
  for (const form of argumentForms) {
    // Placeholders like site="<site phrase>" are templates, not examples: the angle brackets say
    // so. They still have to parse as syntax, which is what is checked.
    const program = ['M1 = start("ethanoic acid")', `M2 = apply(M1, named="ester-formation", ${form})`, 'target = M2'].join('\n');
    const result = parser.parseRouteProgram(program);
    const syntax = result.diagnostics.filter((d) => d.code === 'syntax');
    assert.deepEqual(syntax.map((d) => d.message), [],
                     `the rules show \`${form}\` but the parser rejects it as syntax`);
  }

  // A domain rule may carry its own worked statement; those must parse in a program too. The
  // hook is empty by default, so this checks whatever a deployment has added rather than a
  // fixed count — and the loop below still runs for the addendum.
  const snippets = on.ROUTE_PROGRAM_DOMAIN_RULES
    .flatMap((rule) => [...rule.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
    .filter((text) => /^M\d+ = (start|apply)\(/.test(text));
  for (const snippet of snippets) {
    const result = parser.parseRouteProgram([snippet.replace(/^M\d+ = /, 'M1 = '), 'target = M1'].join('\n'));
    assert.deepEqual(result.diagnostics.filter((d) => d.code === 'syntax').map((d) => d.message), [],
                     `a domain rule shows \`${snippet}\` but the parser rejects it as syntax`);
  }
  // Parsing is not enough: a bare quoted string is read as a NAME, so a SMILES written without
  // smiles= parses fine and then fails at resolve time. That cost a whole run (2026-10-13): every
  // generated step came back UNBUILT because the reagent was looked up as a name.
  // Scanned quote-by-quote, NOT by matching the brackets of reagents=[...]: a SMILES contains "]"
  // characters, so a bracket regex stops inside the structure and the guard silently checks
  // nothing. That mistake was made here first and caught by re-introducing the bug.
  const looksLikeSmiles = /[=#@\\]|\[[A-Za-z]/;
  const texts = [...snippets, on.SYNTHESIS_TEMPLATE_ADDENDUM, ...on.ROUTE_PROGRAM_DOMAIN_RULES];
  for (const text of texts) {
    for (const match of text.matchAll(/(smiles\s*=\s*)?"([^"]+)"/g)) {
      const [, keyed, quoted] = match;
      if (!looksLikeSmiles.test(quoted)) continue;
      assert.ok(keyed, `a structure must be given as smiles="...", not as a bare name: ${quoted.slice(0, 48)}`);
    }
  }
});

test('an answer with no program is told to write a program, not to use the names-first format', async () => {
  // Found 2026-10-14. The note is what the model reads when its answer carried no route. In program
  // mode the names-first text ("numbered Step N headings with Reactants:, Products: ...") describes
  // a format this run does not accept, so an answer that merely forgot the program was pushed
  // further from it and never recovered.
  const { uncheckedRouteNote } = inspection;
  const prose = 'A discussion of the coupling, with no program and no numbered steps.';
  const withProgram = 'Here it is.\n\n```route-program\nM1 = start("ethanoic acid")\ntarget = M1\n```';

  process.env.NODUS_ROUTE_PROGRAM = 'on';
  const on = await load('on', 'note');
  // Rebuilt against the same setting so the bundled module reads it.
  assert.equal(on.routeProgramMode(), true);
  const noteOn = await inspectionFor('on');
  assert.ok(noteOn, 'module built for program mode');
  assert.match(noteOn.uncheckedRouteNote(prose, { correction: false }), /route-program/);
  assert.doesNotMatch(noteOn.uncheckedRouteNote(prose, { correction: false }), /Reactants:/);
  assert.match(noteOn.uncheckedRouteNote(prose, { correction: true }), /route-program/);
  // An answer that DID carry a program is not nagged at all.
  assert.equal(noteOn.uncheckedRouteNote(withProgram, { correction: false }), '');

  // A refused PROGRAM must offer a fix chip. Without one the harness reports "no fix chip in the
  // answer" and ends the run: measured 2026-10-14, every program-mode failure on record took
  // exactly one turn in suites that asked for three fixes, so the fix loop had never run and the
  // diagnostics were never read.
  const { formatNamedRouteFixPrompts, formatRouteProgramFixPrompt } = noteOn;
  const refused = {
    continuous: false, steps: [], links: [],
    blocked: ["Line 28: The carried molecule has 2 places matching 'ester'; name a narrower site or a mark. Later lines were not executed."],
  };
  const chipText = formatRouteProgramFixPrompt(refused);
  assert.match(chipText, /```nodus-route-fix/, 'a refused program renders a chip fence');
  const parsed = JSON.parse(chipText.split('\n').slice(1, -1).join('\n'));
  assert.equal(parsed.label, 'Fix from the target backwards', 'the label the harness looks for');
  assert.match(parsed.prompt, /Line 28/, 'the refusal is quoted so the model knows what failed');
  assert.match(parsed.prompt, /site=@M3|site=@last/, 'and the mark syntax that resolves an ambiguous site');
  assert.match(parsed.prompt, /carry="largest"/, 'and the way to say which fragment continues');
  // It reaches the model through the same entry point the names-first arm uses, which is the one
  // the report calls — a chip that only a new function produces would never be rendered.
  assert.ok(formatNamedRouteFixPrompts([], refused).includes('nodus-route-fix'),
            'the shared entry point returns the program chip');
  // An audit with no program refusal is untouched, so the names-first arm keeps its own chips.
  assert.equal(formatRouteProgramFixPrompt({ continuous: true, blocked: [], steps: [], links: [] }), '');
  assert.equal(formatRouteProgramFixPrompt(null), '', 'and a missing audit is not a crash');

  // A program in the WRONG FENCE gets the one piece of advice that fixes it. Measured 2026-10-13 on
  // condense-solution: a correct program inside a plain ``` fence was answered with instructions on
  // how to write a program, which reads as wrong to an author who has just written one.
  const misfenced = 'Here it is.\n\n```\nM1 = start("ethanoic acid")\nM2 = apply(M1, named="x")\ntarget = M2\n```';
  const advice = noteOn.uncheckedRouteNote(misfenced, { correction: false });
  assert.match(advice, /its fence is not labelled/, 'the misfence is named outright');
  assert.match(advice, /```route-program/, 'and the fence that would have worked is shown');
  assert.doesNotMatch(advice, /M1 = start\(\.\.\.\)/, 'it does not re-explain the format the model already used');
  // Narrow on purpose: prose that merely mentions the syntax is not accused, and a reply with a
  // proper fence is never misread as misfenced however much it also discusses programs.
  assert.equal(noteOn.misfencedRouteProgram('I could write M1 = start(...) but let us discuss first.'), false);
  assert.equal(noteOn.misfencedRouteProgram(withProgram + '\n\nand `M1 = start("x")` is the first line.'), false);
  assert.equal(noteOn.misfencedRouteProgram(misfenced), true);

  // With the mode off the names-first note is unchanged.
  const noteOff = await inspectionFor('off');
  assert.match(noteOff.uncheckedRouteNote(prose, { correction: false }), /Reactants:/);
  assert.doesNotMatch(noteOff.uncheckedRouteNote(prose, { correction: false }), /route-program/);
  void uncheckedRouteNote;
});

test('the forward-step rule describes the fence the package actually answers', async () => {
  // The tool is reachable through a `forward-steps` fence, but a model only calls what the
  // contract mentions. The rule and the capability must agree on the fence name and the field
  // names, or the model emits a block the package rejects.
  const { FORWARD_STEPS_SYSTEM_RULE } = inspection;
  assert.match(FORWARD_STEPS_SYSTEM_RULE, /`forward-steps` block/);
  for (const field of ['molecule', 'reagents', 'limit']) {
    assert.match(FORWARD_STEPS_SYSTEM_RULE, new RegExp(`"${field}"`), `${field} is named`);
  }
  // It must say an empty list is an answer: the failure mode this guards against is a model that
  // invents a transformation when the record offers none.
  assert.match(FORWARD_STEPS_SYSTEM_RULE, /empty list/);
  // And that frequency is precedent, not suitability.
  assert.match(FORWARD_STEPS_SYSTEM_RULE, /precedent, not suitability/);

});

// The half that reads the chemistry package's own manifest, which lives in a SEPARATE repository.
// Skipped when that checkout is not beside this one, as the grammar test above is: this repository
// cannot gate another's data, and a test that reads across the boundary unconditionally fails for
// everyone who has only this one.
test('the package declares the fence the rule names, with the fields the rule names',
     { skip: fs.existsSync(CAPABILITY) ? false : 'the chemistry package checkout is not beside this one' }, async () => {
  const { FORWARD_STEPS_SYSTEM_RULE } = inspection;
  const capability = JSON.parse(await readFile(CAPABILITY, 'utf8'));
  const protocol = capability.chat.requestProtocols.find((entry) => entry.fence === 'forward-steps');
  assert.ok(protocol, 'the package declares the fence the rule names');
  const tool = capability.tools.find((entry) => entry.id === protocol.toolId);
  assert.ok(tool, 'the fence names a tool that exists');
  const fields = Object.keys(tool.inputSchema.properties).sort();
  assert.deepEqual(fields, ['indexDir', 'limit', 'molecule', 'reagents'], 'the schema holds the fields the rule names');
  assert.deepEqual(tool.inputSchema.required, ['molecule']);
  // The rule and the schema must name the same fields, which is the agreement this test is for.
  for (const field of fields.filter((name) => name !== 'indexDir')) {
    assert.match(FORWARD_STEPS_SYSTEM_RULE, new RegExp(`"${field}"`), `${field} is named by the rule`);
  }
});

test('forced is the same search made obligatory, and off unless asked for', async () => {
  // Two arms of one measurement. The optional wording was declined at every chain length run so
  // far, so "needs no precedent" and "never reaches for it" are indistinguishable; the forced arm
  // separates them. Both must describe the SAME fence, or the arms differ in more than one thing.
  const { FORWARD_STEPS_REQUIRED_RULE, FORWARD_STEPS_SYSTEM_RULE, forwardStepsRequired } = inspection;
  for (const field of ['molecule', 'reagents', 'limit']) {
    assert.match(FORWARD_STEPS_REQUIRED_RULE, new RegExp(`"${field}"`), `${field} is named`);
  }
  assert.match(FORWARD_STEPS_REQUIRED_RULE, /`forward-steps` block/);
  assert.match(FORWARD_STEPS_REQUIRED_RULE, /precedent, not suitability/);
  // The one sentence that differs, and only that one.
  assert.match(FORWARD_STEPS_REQUIRED_RULE, /required, not optional/);
  assert.doesNotMatch(FORWARD_STEPS_REQUIRED_RULE, /Nothing obliges you to ask/);
  assert.doesNotMatch(FORWARD_STEPS_SYSTEM_RULE, /required, not optional/);
  // Forcing the lookup must not force the ANSWER: a route that takes the top row every time
  // measures the index's ranking, not the author's chemistry.
  assert.match(FORWARD_STEPS_REQUIRED_RULE, /You may still write a step the list does not contain/);

  const before = process.env.NODUS_FORWARD_STEPS;
  try {
    delete process.env.NODUS_FORWARD_STEPS;
    assert.equal(forwardStepsRequired(), false, 'optional unless asked for');
    process.env.NODUS_FORWARD_STEPS = 'offer';
    assert.equal(forwardStepsRequired(), false, 'only "force" forces it');
    process.env.NODUS_FORWARD_STEPS = 'force';
    assert.equal(forwardStepsRequired(), true);
  } finally {
    if (before === undefined) delete process.env.NODUS_FORWARD_STEPS;
    else process.env.NODUS_FORWARD_STEPS = before;
  }
});

test('off by default: the contract is names-first and says nothing about a program', async () => {
  const off = await load('off', 'off');
  assert.equal(off.routeProgramMode(), false);
  const rules = off.routeSpeciesRules();
  assert.ok(rules.some((rule) => rule.includes('systematic IUPAC name ONLY')));
  assert.ok(!rules.some((rule) => rule.includes('apply(')));
  assert.match(off.SYNTHESIS_TEMPLATE_ADDENDUM, /under these four labels/);
  assert.doesNotMatch(off.SYNTHESIS_TEMPLATE_ADDENDUM, /route-program/);
});

test('on: the species rules give way to the program contract, in the request AND in corrections', async () => {
  const on = await load('on', 'on');
  assert.equal(on.routeProgramMode(), true);
  const rules = on.routeSpeciesRules();
  // The one source both the first request and every correction read, so a run cannot hold the
  // answer to one contract and its fixes to the other.
  assert.ok(rules.some((rule) => rule.includes('apply(')), 'the apply form is offered');
  assert.ok(rules.some((rule) => rule.startsWith('Write the route as a PROGRAM')));
  assert.ok(!rules.some((rule) => rule.includes('systematic IUPAC name ONLY')), 'names-first is withdrawn');
  assert.ok(!rules.some((rule) => rule.includes('Reactants (consumed)')), 'the role rules go with it');
});

test('on: the output format is the program block, and the names-first format is gone', async () => {
  const on = await load('on', 'fmt');
  assert.match(on.SYNTHESIS_TEMPLATE_ADDENDUM, /route-program/);
  assert.match(on.SYNTHESIS_TEMPLATE_ADDENDUM, /M1 = start\(/);
  assert.match(on.SYNTHESIS_TEMPLATE_ADDENDUM, /target = M3/);
  assert.doesNotMatch(on.SYNTHESIS_TEMPLATE_ADDENDUM, /under these four labels/,
    'the two formats must never both be present');
  // "Draw nothing" still applies: the application draws the route either way.
  assert.match(on.SYNTHESIS_TEMPLATE_ADDENDUM, /emit no chemistry-plan/);
});

test('the program vocabulary stays generic, and a domain rule is appended whole', async () => {
  const on = await load('on', 'vocab');
  const text = on.routeSpeciesRules().join(' ');
  for (const word of ['start', 'apply', 'site']) assert.ok(text.includes(word), `${word} is the vocabulary`);
  // A domain rule says which FORM to write a species in, so it is APPENDED after the grammar
  // rather than replacing any of it. Asserted against the generic contract, whatever the hook
  // holds: the rules a deployment adds are the last entries and every grammar rule survives.
  const rules = on.routeProgramRules();
  const domain = on.ROUTE_PROGRAM_DOMAIN_RULES;
  assert.deepEqual(rules.slice(rules.length - domain.length), domain,
                   'the domain rules are the last entries of the contract');
  assert.ok(rules.length > domain.length, 'they are appended, not the whole contract');
  for (const grammar of ['Write the route as a PROGRAM', 'The last statement is `target = M<n>`']) {
    assert.ok(rules.some((rule) => rule.includes(grammar)), `the grammar rule "${grammar}" survives`);
  }
});

// A program failure has to come back as a fix CHIP, not only as report prose. Before this, the
// program report path returned the audit and nothing else, so `no fix chip in the answer` ended
// the run at turn 0 with every fix round unspent — twice on 2026-10-14, on messages that named
// exactly what to change.
const audit = (blocked, steps) => ({ blocked, steps, links: [], continuous: !blocked.length });
// Shaped like a real audited step, not the three fields this once asserted on: the builder now
// asks the shared failure predicate, which reads `differences` and the species lists. A fixture
// thinner than the real thing passed until the production path grew one more question.
const step = (index, ok, error) => ({
  index, ok, reaction: '', reactants: [], agents: [], products: [],
  balanced: ok ? true : null, chargeBalanced: ok ? true : null, differences: [],
  unspecifiedStereocentres: 0, ...(error ? { error } : {}),
});
const chip = (fence) => JSON.parse(fence.replace(/^```nodus-route-fix\n/, '').replace(/\n```$/, ''));

test('a refused statement becomes a fix chip carrying the toolkit message', () => {
  const { formatRouteProgramReportFix } = inspection;
  // chainQ-8, verbatim: the toolkit named the verb that would have worked and nobody read it.
  const line = 'Line 4: The carried molecule has no boc carbamate. Curated transformations that DO'
    + ' apply to this molecule with the reagents given: tert-butyl-ester-removal. Later lines were'
    + ' not executed.';
  const fence = formatRouteProgramReportFix(audit([line], [step(0, true), step(1, true)]));
  assert.ok(fence, 'a refused program must offer a correction');
  const { label, prompt } = chip(fence);
  assert.equal(label, 'Fix from the target backwards');
  assert.ok(prompt.includes('tert-butyl-ester-removal'), 'the verb that applies must reach the model');
  assert.match(prompt, /route-program/, 'it must ask for the whole program back');
});

test('a program refused before any audit still offers the correction', () => {
  const { formatRouteProgramReportFix, isRouteFixPrompt } = inspection;
  const fence = formatRouteProgramReportFix(null, ['Line 2: That reaction SMARTS is not a reaction RDKit can run forward.']);
  assert.ok(fence, 'no audit is not the same as nothing to fix');
  assert.match(chip(fence).prompt, /Line 2:/);
  assert.ok(isRouteFixPrompt(chip(fence).prompt));
});

test('a refusal with no line number is correctable too', () => {
  const { formatRouteProgramReportFix, isRouteFixPrompt } = inspection;
  // chainQ-8, verbatim, 2026-10-14: a WHOLE-PROGRAM refusal. It carries no `Line n:`, so the
  // shared builder's filter skipped it and the run ended at turn 0 with three rounds unspent.
  const fence = formatRouteProgramReportFix(null, ['A route program may execute at most 24 transformations.']);
  assert.ok(fence, 'a refusal without a line number is still a refusal');
  const { prompt } = chip(fence);
  assert.match(prompt, /at most 24 transformations/, 'the model must be told what was refused');
  assert.ok(isRouteFixPrompt(prompt), 'and it must come back as a route turn');
  // It must say how to get shorter, or the model can only resend the same length.
  assert.match(prompt, /n-deprotect/);
  assert.match(prompt, /site="every/);
});

test('no audit and nothing blocked offers nothing', () => {
  const { formatRouteProgramReportFix } = inspection;
  assert.equal(formatRouteProgramReportFix(null, []), '');
});

test('a program that ran but left steps unbuilt offers the correction too', () => {
  const { formatRouteProgramReportFix, UNBUILT_STEP_ERROR_PREFIX } = inspection;
  const unbuilt = `${UNBUILT_STEP_ERROR_PREFIX}: a species it names has no resolved structure.`;
  const fence = formatRouteProgramReportFix(audit([], [step(0, true), step(1, false, unbuilt), step(2, false, unbuilt)]));
  assert.ok(fence, 'a part-executed program must not be a dead end');
  const { prompt } = chip(fence);
  assert.match(prompt, /step 2/, 'it names the FIRST statement that produced nothing');
  // The verdict's own words now, from the shared predicate, so the chip and the report agree.
  assert.match(prompt, /step 2, step 3/, 'and lists every step left without an input');
  assert.match(prompt, /one wrong line accounts for all of them/);
  assert.match(prompt, /could not be built/, 'it carries the reason the check gives');
});

test('a clean audit offers no correction', () => {
  const { formatRouteProgramReportFix } = inspection;
  assert.equal(formatRouteProgramReportFix(audit([], [step(0, true), step(1, true)])), '');
});

test('the shared builder stays narrow, so names-first keeps its own correction', () => {
  const { formatRouteProgramFixPrompt, UNBUILT_STEP_ERROR_PREFIX } = inspection;
  // formatNamedRouteFixPrompts returns THIS the moment it is non-empty. If it widened to unbuilt
  // steps, every names-first route with an unresolved species would get the program correction.
  const unbuilt = `${UNBUILT_STEP_ERROR_PREFIX}: a species it names has no resolved structure.`;
  assert.equal(formatRouteProgramFixPrompt(audit([], [step(0, false, unbuilt)])), '');
  assert.equal(formatRouteProgramFixPrompt(audit(['Step 3 leaves nothing behind'], [step(0, true)])), '');
});

// The classes that were silently uncovered. Each of these ended a real run at turn 0 with every
// fix round unspent, because the builder enumerated failure kinds instead of asking the verdict.
test('the not-formed correction says what the program ended at', () => {
  const { formatRouteProgramReportFix } = inspection;
  // chainQ-2 drew "no step forms the requested target" four turns running, byte-identical, and
  // spent every fix round on it. The sentence names the problem; what the model needs is the GAP.
  const ran = audit([], [
    { ...step(0, true), products: [{ formula: 'C6H13NO2', canonicalSmiles: 'CC(C)C[C@H](N)C(=O)O' }] },
    { ...step(1, true), products: [{ formula: 'C13H19NO2', canonicalSmiles: 'CC(C)C[C@H](N)C(=O)OCc1ccccc1' }] },
  ]);
  ran.target = { input: 'CCN', canonicalSmiles: 'CCN', formula: 'C2H7N', reason: 'not-formed' };
  const { prompt } = chip(formatRouteProgramReportFix(ran));
  assert.match(prompt, /The program ends at/, 'it must say where the route actually stopped');
  assert.match(prompt, /C13H19NO2/, 'naming the LAST product that ran, not the first');
  assert.match(prompt, /C2H7N/, 'and what was wanted, so the gap is visible');
});

test('a long structure is shortened rather than pasted whole', () => {
  const { formatRouteProgramReportFix } = inspection;
  const long = `C${'C'.repeat(400)}O`;
  const ran = audit([], [{ ...step(0, true), products: [{ formula: 'C401H804O', canonicalSmiles: long }] }]);
  ran.target = { input: 'CCN', canonicalSmiles: 'CCN', formula: 'C2H7N', reason: 'not-formed' };
  const { prompt } = chip(formatRouteProgramReportFix(ran));
  assert.ok(!prompt.includes(long), 'a chain SMILES runs to thousands of characters; the point is the comparison');
  assert.match(prompt, /…/);
});

test('a program that forms no target offers the correction', () => {
  const { formatRouteProgramReportFix } = inspection;
  // chainQ-8's re-run, 2026-10-14: 0 failing, 0 unbuilt, and no chip — it ran clean and ended
  // somewhere other than the target.
  const clean = audit([], [step(0, true), step(1, true)]);
  clean.target = { input: 'CCO', canonicalSmiles: 'CCO', reason: 'not-formed' };
  const fence = formatRouteProgramReportFix(clean);
  assert.ok(fence, 'a program that reaches nothing must not be a dead end');
  assert.match(chip(fence).prompt, /no step forms the requested target/);
});

test('a broken intermediate link offers the correction', () => {
  const { formatRouteProgramReportFix } = inspection;
  // chainQ-2, 2026-10-14: "1 intermediate link(s) do not carry the same structure (step 2 → 3)".
  const linked = audit([], [step(0, true), step(1, true), step(2, true)]);
  linked.links = [{ from: 1, to: 2, same: false }];
  const fence = formatRouteProgramReportFix(linked);
  assert.ok(fence, 'a route that loses its intermediate must not be a dead end');
  assert.match(chip(fence).prompt, /intermediate link/);
});

test('a review problem offers the correction', () => {
  const { formatRouteProgramReportFix } = inspection;
  // chainQ-4, 2026-10-14: it spent all three rounds and ended on "a route review raised 1 problem".
  // `blocking` is the only severity that refuses a route the deterministic checker passed;
  // advisory findings are shown and never block, so they must NOT produce a correction.
  const fence = formatRouteProgramReportFix(audit([], [step(0, true)]), [],
    { status: 'problems', problems: [{ step: 1, severity: 'blocking', detail: 'the named structure is wrong for the step' }] });
  assert.ok(fence, 'a blocking review must be correctable too');
  assert.match(chip(fence).prompt, /route review raised/);
});

test('the correction points at the affordances that prevent the common errors', () => {
  const { formatRouteProgramReportFix } = inspection;
  const clean = audit([], [step(0, true)]);
  clean.target = { input: 'CCO', canonicalSmiles: 'CCO', reason: 'not-formed' };
  const { prompt } = chip(formatRouteProgramReportFix(clean));
  assert.match(prompt, /n-deprotect/, 'the verb that cannot disagree with what was installed');
  assert.match(prompt, /site="every/, 'the form for acting at several places at once');
});

test('an advisory review finding does not offer a correction', () => {
  const { formatRouteProgramReportFix } = inspection;
  // Advisory findings are shown and never block a route the deterministic checker passed, so
  // offering a correction for one would ask the model to fix something that is not wrong.
  assert.equal(formatRouteProgramReportFix(audit([], [step(0, true)]), [],
    { status: 'problems', problems: [{ step: 1, severity: 'advisory', detail: 'unusual conditions' }] }), '');
});

// The joining check. Every piece above worked and the run still died: the chip was emitted, the
// harness sent it, and `isRouteFixPrompt` did not recognise it — so the next turn was not a route
// turn, carried no chemistry skill, and audited nothing. Three runs on 2026-10-14 each spent a fix
// round, wrote a well-formed program and never had it checked.
test('a program correction is recognised as a route fix prompt', () => {
  const { formatRouteProgramReportFix, formatRouteProgramFixPrompt, isRouteFixPrompt } = inspection;
  const refused = chip(formatRouteProgramFixPrompt(audit(['Line 4: nothing applies here.'], [step(0, true)])));
  assert.ok(isRouteFixPrompt(refused.prompt),
    'a refused program must come back as a ROUTE turn, or nothing audits the reply');
  const ranBad = audit([], [step(0, true)]);
  ranBad.target = { input: 'CCO', canonicalSmiles: 'CCO', reason: 'not-formed' };
  const didNotPass = chip(formatRouteProgramReportFix(ranBad));
  assert.ok(isRouteFixPrompt(didNotPass.prompt),
    'a program that ran and failed must come back as a ROUTE turn too');
  // Both must still say what to do, not merely be recognisable.
  for (const { prompt } of [refused, didNotPass]) assert.match(prompt, /route-program/);
});

// A refused program's untried statements must not be reported as unresolved species. Measured on
// chainQ-2, 2026-10-14: refused at line 2, and every turn's verdict read "7 step(s) could not be
// built because a species they name has no resolved structure" — seven species that do not exist,
// with the one real cause buried. The chip carried the truth; the verdict, which is what the
// harness records and the matrix shows, did not.
test('a refused program names the refusal and calls the rest untried', () => {
  const { routeAuditFailureReasons } = inspection;
  const refused = audit(
    ['Line 2: This transformation does not apply at the free amine of the carried molecule. Later lines were not executed.'],
    [{ ...step(0, false, 'This step could not be built: a species it names has no resolved structure.') },
     { ...step(1, false, 'This step could not be built: a species it names has no resolved structure.') }],
  );
  const reasons = routeAuditFailureReasons(refused);
  assert.match(reasons[0], /^Line 2:/, 'the refusal leads, because it is the cause');
  assert.match(reasons.join(' '), /never run/, 'the untried statements are called untried');
  assert.doesNotMatch(reasons.join(' '), /no resolved structure/,
    'and are NOT reported as unresolved species, which would be a fault that does not exist');
});

test('without a refusal an unbuilt step still reports the species', () => {
  const { routeAuditFailureReasons } = inspection;
  // The names-first path never carries `Line n:` entries, so its wording must be untouched.
  const reasons = routeAuditFailureReasons(audit([],
    [{ ...step(0, false, 'This step could not be built: a species it names has no resolved structure.') }]));
  assert.match(reasons.join(' '), /no resolved structure/);
  assert.doesNotMatch(reasons.join(' '), /never run/);
});
