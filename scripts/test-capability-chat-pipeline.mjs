import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-pipeline-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'pipeline.cjs');
await build({
  stdin: { contents: `export * from './electron/capabilities/chatPipeline';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const { runTrustedChatPipeline } = createRequire(import.meta.url)(bundle);

// ---------------------------------------------------------------- fake providers

const tool = (id, overrides = {}) => ({
  id, description: id, inputSchema: { type: 'object', additionalProperties: true },
  artifactTypes: [`${id}-result`], timeoutMs: 30_000, concurrency: 1, maxPerReply: 1,
  answerMode: 'replace-block', metered: false, ...overrides,
});

function provider({ id, priority, requests = [], legacy = [], hooks = {}, tools = [], artifacts = [] }) {
  return {
    id, version: '2.0.0', description: id, source: 'plugin',
    plugin: { id: id.replace(':', '-'), version: '2.0.0', digest: 'a'.repeat(64) },
    capabilityKey: id.split(':')[1],
    tools, artifacts,
    chat: { priority, requestProtocols: requests, legacyResults: legacy, hooks, pendingLabel: { en: 'Working…' } },
    hasSettings: false,
  };
}

function registryOf(...providers) {
  const map = new Map(providers.map(entry => [entry.id, entry]));
  const fences = new Map();
  for (const entry of providers) {
    for (const protocol of entry.chat.requestProtocols) fences.set(protocol.fence, { provider: entry, kind: 'request' });
    for (const legacy of entry.chat.legacyResults) fences.set(legacy.fence, { provider: entry, kind: 'legacy' });
  }
  return { providers: map, fences, chatOrder: [...providers].sort((a, b) => a.chat.priority - b.chat.priority), problems: [], revision: 1 };
}

/** Records everything the pipeline asked for, so ordering is observable. */
function runnerOf(overrides = {}) {
  const calls = [];
  return {
    calls,
    async invoke({ provider, toolId, input }) {
      calls.push(`invoke:${provider.id}:${toolId}`);
      if (overrides.invoke) return overrides.invoke({ provider, toolId, input });
      return { artifacts: [{ artifactType: `${toolId}-result`, artifactVersion: 1, summary: `${toolId} done`, data: input }] };
    },
    async hook({ provider, hook, nodes }) {
      calls.push(`hook:${provider.id}:${hook}`);
      return overrides.hook ? overrides.hook({ provider, hook, nodes }) : [];
    },
    async persistArtifact({ provider, artifact }) {
      calls.push(`persist:${provider.id}:${artifact.artifactType}`);
      return `\n\n[artifact ${artifact.artifactType} "${artifact.summary}"]\n\n`;
    },
    renderView({ provider, view }) {
      calls.push(`view:${provider.id}`);
      return `\n\n[view ${view.summary}]\n\n`;
    },
    async runCoreStages(answer, options) {
      calls.push(options.suppressSvgRefinement ? 'core:stages(no-svg)' : 'core:stages');
      return overrides.runCoreStages ? overrides.runCoreStages(answer, options) : answer;
    },
  };
}

const noticeView = summary => ({ schemaVersion: 1, summary, nodes: [{ kind: 'notice', tone: 'info', spans: [{ text: summary }] }] });

// ---------------------------------------------------------------- tests

test('a clean install runs the core stages and nothing else', async () => {
  const runner = runnerOf();
  const answer = 'Plain prose with no fences.';
  const output = await runTrustedChatPipeline(answer, { providers: new Map(), fences: new Map(), chatOrder: [], problems: [], revision: 0 }, runner);
  assert.equal(output, answer);
  assert.deepEqual(runner.calls, ['core:stages']);
});

test('a claimed fence becomes an artifact, and the request block does not survive', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf();
  const output = await runTrustedChatPipeline('Before.\n\n```chemistry-plan\n{"draw":"ethanol"}\n```\n\nAfter.', registryOf(chemistry), runner);
  assert.match(output, /Before\./);
  assert.match(output, /\[artifact compile-result "compile done"\]/);
  assert.match(output, /After\./);
  assert.doesNotMatch(output, /chemistry-plan/, 'the request block is consumed, not left for the next turn to read');
  assert.deepEqual(runner.calls, ['core:stages', 'invoke:nodus:chemistry:compile', 'persist:nodus:chemistry:compile-result']);
});

test('a stored result fence is not a request and is never executed', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    legacy: [{ fence: 'chemistry-document', artifactType: 'compile-result', artifactVersion: 1 }],
  });
  const runner = runnerOf();
  const answer = 'Look:\n\n```chemistry-document\n{"cid":702}\n```\n';
  const output = await runTrustedChatPipeline(answer, registryOf(chemistry), runner);
  assert.equal(output, answer, 'a result the model echoed back is left exactly as it is');
  assert.ok(!runner.calls.some(call => call.startsWith('invoke:')), 'and nothing about it is executed');
});

test('providers run in declared priority order, and replace-answer runs before everything', async () => {
  const legal = provider({
    id: 'nodus:legal', priority: 100, tools: [tool('retrieve', { answerMode: 'replace-answer' })],
    artifacts: [{ type: 'retrieve-result', version: 1, label: { en: 'Legal' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'legal-plan', toolId: 'retrieve', maxPerReply: 1, answerMode: 'replace-answer' }],
    hooks: { prepare: true },
  });
  const genomics = provider({
    id: 'nodus:genomics', priority: 200, tools: [tool('predict', { answerMode: 'replace-answer' })],
    artifacts: [{ type: 'predict-result', version: 1, label: { en: 'Genomics' }, modelVisibility: 'none' }],
    requests: [{ fence: 'genomics-plan', toolId: 'predict', maxPerReply: 1, answerMode: 'replace-answer' }],
    hooks: { prepare: true },
  });
  const runner = runnerOf();
  await runTrustedChatPipeline('```genomics-plan\n{}\n```\n\n```legal-plan\n{}\n```', registryOf(genomics, legal), runner);
  const invokes = runner.calls.filter(call => call.startsWith('invoke:'));
  assert.deepEqual(invokes, ['invoke:nodus:legal:retrieve', 'invoke:nodus:genomics:predict'], 'priority 100 before priority 200, regardless of order in the reply');
  const firstHook = runner.calls.findIndex(call => call.startsWith('hook:'));
  assert.ok(runner.calls.indexOf('invoke:nodus:genomics:predict') < firstHook, 'replace-answer requests run before any prepare hook');
});

test('a prepare hook can claim the drawing lane, and the core then leaves SVG alone', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const runner = runnerOf({
    hook: () => [{ op: 'claim', suppressSvgRefinement: true }, { op: 'notice', position: 'before', view: noticeView('Drawing with the verified lane.') }],
  });
  const output = await runTrustedChatPipeline('```chemistry-plan\n{"draw":"benzene"}\n```', registryOf(chemistry), runner);
  assert.ok(runner.calls.includes('core:stages(no-svg)'), 'the core does not second-guess a lane a provider has claimed');
  assert.ok(!runner.calls.includes('core:stages'));
  assert.match(output, /\[view Drawing with the verified lane\.\]/);
});

test('a hook may only address the blocks it claimed', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const problems = [];
  // The reply's prose node is n0; the hook was given it to read, not to delete.
  const runner = runnerOf({ hook: ({ nodes }) => [{ op: 'remove', nodeId: nodes.find(node => node.kind === 'prose').id }] });
  const output = await runTrustedChatPipeline('Keep this prose.\n\n```chemistry-plan\n{}\n```', registryOf(chemistry), runner, {
    onProblem: (provider, error) => problems.push(`${provider.id}: ${error.message}`),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /only address nodes it was given/);
  assert.match(output, /Keep this prose\./, 'the prose the hook tried to remove is still there');
});

test('finalize can add an artifact or a notice, and cannot create a request', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { finalize: true },
  });

  const added = runnerOf({ hook: () => [{ op: 'artifact', position: 'after', artifact: { artifactType: 'compile-result', artifactVersion: 1, summary: 'Appended.', data: {} } }] });
  assert.match(await runTrustedChatPipeline('Prose.', registryOf(chemistry), added), /\[artifact compile-result "Appended\."\]/);

  const problems = [];
  const sneaky = runnerOf({ hook: () => [{ op: 'promote-request', nodeId: 'n0', toolId: 'compile', input: {} }] });
  await runTrustedChatPipeline('Prose.', registryOf(chemistry), sneaky, { onProblem: (provider, error) => problems.push(error.message) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Unsupported final mutation/);
  assert.ok(!sneaky.calls.some(call => call.startsWith('invoke:')), 'a result never becomes the next instruction');
});

test('per-reply limits are enforced by the core, not by the provider', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile', { maxPerReply: 1 })],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf();
  const output = await runTrustedChatPipeline('```chemistry-plan\n{"n":1}\n```\n\n```chemistry-plan\n{"n":2}\n```', registryOf(chemistry), runner);
  assert.equal(runner.calls.filter(call => call.startsWith('invoke:')).length, 1);
  assert.match(output, /At most 1 compile requests are allowed per reply/);
});

test('a failing or truncated request becomes inert text, never a re-readable request', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });

  const failing = runnerOf({ invoke: () => { throw new Error('OPSIN could not resolve `that`\nname'); } });
  const output = await runTrustedChatPipeline('```chemistry-plan\n{}\n```', registryOf(chemistry), failing, { onProblem: () => {} });
  assert.match(output, /Capability error, from the application and not the model: OPSIN could not resolve  that  name/);
  // Attributed on purpose: the failure replaces the directive where it stood, so an unattributed
  // line there reads as the model's own words to a reader, a replay or a blind reviewer.
  assert.match(output, /_Capability error, from the application and not the model: [^\n]*_/);
  assert.doesNotMatch(output, /```/, 'the error carries no fence for the next turn to act on');

  const truncated = runnerOf();
  const cut = await runTrustedChatPipeline('```chemistry-plan\n{"draw":', registryOf(chemistry), truncated, { onProblem: () => {} });
  assert.match(cut, /interrupted/);
  assert.ok(!truncated.calls.some(call => call.startsWith('invoke:')));
});

test('an exclusive claim stands down every other provider for that reply', async () => {
  const legal = provider({
    id: 'nodus:legal', priority: 100, tools: [tool('retrieve')],
    artifacts: [{ type: 'retrieve-result', version: 1, label: { en: 'Legal' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'legal-plan', toolId: 'retrieve', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const runner = runnerOf({ hook: ({ provider }) => provider.id === 'nodus:legal' ? [{ op: 'claim', exclusive: true }] : [] });
  await runTrustedChatPipeline('```legal-plan\n{}\n```\n\n```chemistry-plan\n{}\n```', registryOf(legal, chemistry), runner);
  assert.ok(runner.calls.includes('invoke:nodus:legal:retrieve'));
  assert.ok(!runner.calls.includes('invoke:nodus:chemistry:compile'), 'the reply belongs to the provider that claimed it');
  assert.ok(!runner.calls.includes('hook:nodus:chemistry:prepare'));
});

test('a claim on the drawing lane retires a hand-drawn SVG from the same reply', async () => {
  // The case that started this: a cartography package exists, the model answers a map request by
  // drawing one itself, and the reply shows a map nobody checked. A hook cannot remove a node it
  // does not own, so the pipeline drops the hand-drawn block when the claim is honoured.
  const cartography = provider({
    id: 'example:cartography', priority: 400, tools: [tool('render')],
    artifacts: [{ type: 'research-map', version: 1, label: { en: 'Map' }, modelVisibility: 'none' }],
    requests: [{ fence: 'research-map-request', toolId: 'render', maxPerReply: 4, answerMode: 'replace-block' }],
    hooks: { prepare: true },
  });
  const claiming = runnerOf({
    hook: ({ provider, nodes }) => provider.id === 'example:cartography' && nodes.some(node => node.fence === 'svg')
      ? [{ op: 'claim', suppressSvgRefinement: true }] : [],
  });
  const drawn = 'Prose about 1940.\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"><title>Hand-drawn Spain</title></svg>\n```\n';
  const answer = await runTrustedChatPipeline(drawn, registryOf(cartography), claiming);
  assert.doesNotMatch(answer, /Hand-drawn Spain/, 'the hand-drawn map is not shown');
  assert.match(answer, /Prose about 1940/, 'and the prose around it stays');
  // A claim without the drawing lane leaves a diagram alone: this is about the lane, not about SVG.
  const quiet = runnerOf({ hook: () => [{ op: 'claim' }] });
  const kept = await runTrustedChatPipeline(drawn, registryOf(cartography), quiet);
  assert.match(kept, /Hand-drawn Spain/, 'a claim that does not take the lane leaves the drawing');
});

test('a nested mistake in a tool input is named by path', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile', { inputSchema: { type: 'object', properties: { plan: { type: 'string' }, source: { type: 'object', properties: { label: { type: 'string', maxLength: 5 }, license: { type: 'string' } }, required: ['label', 'license'], additionalProperties: false } }, required: ['plan', 'source'], additionalProperties: false } })],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf({});
  const refusals = [];
  for (const input of [
    { plan: 'x', source: { label: 'Ethanol' } },
    { plan: 'x', source: { label: 'Ethanol', license: 'CC0', extra: 1 } },
    { plan: 'x', source: { label: 'Ethanol', license: 'CC0' }, period: {} },
  ]) {
    const answer = await runTrustedChatPipeline('```chemistry-plan\n' + JSON.stringify(input) + '\n```', registryOf(chemistry), runner, { onProblem: () => {} });
    refusals.push(/Capability error, from the application and not the model: ([^\n]+)/.exec(answer)?.[1] ?? 'no refusal');
  }
  assert.match(refusals[0], /the input\.source is missing required property "license"/, refusals[0]);
  assert.match(refusals[1], /the input\.source has unknown property "extra"; allowed: label, license/, refusals[1]);
  assert.match(refusals[2], /the input has unknown property "period"/, refusals[2]);
  assert.ok(!runner.calls.some(call => call.startsWith('invoke:')), 'nothing was dispatched');
});

test('cancellation propagates instead of being swallowed as a provider problem', async () => {
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, tools: [tool('compile')],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const runner = runnerOf({ invoke: () => { throw new DOMException('Cancelled.', 'AbortError'); } });
  await assert.rejects(
    runTrustedChatPipeline('```chemistry-plan\n{}\n```', registryOf(chemistry), runner, { onProblem: () => {} }),
    error => error.name === 'AbortError',
  );
});

test('a refusal over a size limit names the size that arrived, not the type', async () => {
  // B46. "the input.question must be a string of at most 8000 characters (received string)" is
  // true, tautological and unactionable — it restates the rule and says nothing about the value.
  // B45 hid behind exactly that sentence for a whole 30-target sweep: 58 refused calls, and no
  // line anywhere said whether the string was 8001 characters or 80000, which is the difference
  // between a clamp and a design problem.
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300,
    tools: [tool('compile', {
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'string', maxLength: 64_000 }, question: { type: 'string', maxLength: 8_000 } },
        required: ['plan'], additionalProperties: false,
      },
    })],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const question = 'x'.repeat(8_461);
  const answer = `\`\`\`chemistry-plan\n${JSON.stringify({ plan: '{"version":2}', question })}\n\`\`\``;
  const output = await runTrustedChatPipeline(answer, registryOf(chemistry), runnerOf());

  assert.match(output, /the input\.question is 8461 characters; at most 8000 are allowed/,
    'the measured length comes first, then the rule it broke');
  assert.doesNotMatch(output, /received string/, 'and the sentence that said nothing is gone');
  // The offending text is never echoed back: it can be enormous and it is the user's own writing.
  assert.ok(!output.includes('x'.repeat(100)), 'the content itself is not quoted into the answer');

  // A string inside its limits still passes, so this did not turn into a new refusal.
  const ok = `\`\`\`chemistry-plan\n${JSON.stringify({ plan: '{"version":2}', question: 'Draw ethanol.' })}\n\`\`\``;
  assert.doesNotMatch(await runTrustedChatPipeline(ok, registryOf(chemistry), runnerOf()), /was not run/);
});

test('a too-short string and an out-of-range number are reported the same way', async () => {
  // The same defect class: a minimum and a numeric range both used to report only the type.
  const widgets = provider({
    id: 'nodus:widgets', priority: 100,
    tools: [tool('make', {
      inputSchema: {
        type: 'object',
        properties: { colour: { type: 'string', minLength: 7 }, count: { type: 'integer', minimum: 1, maximum: 12 } },
        required: ['colour'], additionalProperties: false,
      },
    })],
    requests: [{ fence: 'widget-plan', toolId: 'make', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const short = await runTrustedChatPipeline('```widget-plan\n{"colour":"#abc"}\n```', registryOf(widgets), runnerOf());
  assert.match(short, /the input\.colour is 4 characters; at least 7 are required/);

  const high = await runTrustedChatPipeline('```widget-plan\n{"colour":"#abcdef","count":17}\n```', registryOf(widgets), runnerOf());
  assert.match(high, /the input\.count must be an integer between 1 and 12 \(received 17\)/,
    'a number reports the value that arrived');
});

test('a reply cannot hand a tool the directories the application supplies', async () => {
  // The chemistry tools accept local reference directories (a PubChem mirror, an OPSIN
  // install that the package RUNS, reaction indexes, stock lists). The application fills
  // them on its own calls; a reply that names one would point the package at a folder of
  // the reply's choosing. Reached whenever a request fence outlives the prepare hook, for
  // example because the hook failed.
  const chemistry = provider({
    id: 'nodus:chemistry', priority: 300, hooks: { prepare: true },
    tools: [tool('compile', { inputSchema: { type: 'object', properties: { plan: { type: 'string' }, opsinDir: { type: 'string' }, pubchemDir: { type: 'string' } }, additionalProperties: false } })],
    artifacts: [{ type: 'compile-result', version: 1, label: { en: 'Compiled' }, modelVisibility: 'projection' }],
    requests: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
  });
  const inputs = [];
  const runner = runnerOf({
    hook: () => { throw new Error('worker restarting'); },
    invoke: ({ input }) => { inputs.push(input); return { artifacts: [] }; },
  });
  const fence = '```chemistry-plan\n{"plan":"{}","opsinDir":"/Users/someone/Downloads/kit"}\n```';
  const output = await runTrustedChatPipeline(`Here.\n\n${fence}\n`, registryOf(chemistry), runner, { onProblem: () => {} });
  assert.deepEqual(inputs, [], 'the tool is not run with a directory the reply chose');
  assert.match(output, /opsinDir/, 'and the refusal names the field');

  // A promoted request is held to the same rule: the plugin built it, but from the reply.
  const promoted = [];
  const promoting = runnerOf({
    hook: ({ nodes }) => [{ op: 'promote-request', nodeId: nodes.find(node => node.kind === 'fence').id, toolId: 'compile', input: { plan: '{}', pubchemDir: '/tmp/elsewhere' } }],
    invoke: ({ input }) => { promoted.push(input); return { artifacts: [] }; },
  });
  await runTrustedChatPipeline(`Here.\n\n${fence}\n`, registryOf(chemistry), promoting, { onProblem: () => {} });
  assert.deepEqual(promoted, []);
});
