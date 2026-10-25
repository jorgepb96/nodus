// The reasoning level a Codex model runs at, chosen from either the Providers tab (a
// row per model, a default for everything that model runs) or the Models tab (beside
// the picker of each role, and binding on that role alone). The two must not collapse
// into one another: raising Immersion once turned every other task up with it, because
// a single map keyed by MODEL was the only place a level could live. A role's level now
// rides on the role's own selection. Drives the real shared module.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-codex-reasoning-'));
const outfile = path.join(outDir, 'codexReasoning.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'shared/codexReasoning.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
});
const {
  codexReasoningCatalog,
  codexReasoningFor,
  modelRefWithReasoning,
  reasoningChoiceFor,
  withCodexReasoning,
} = await import(pathToFileURL(outfile).href);

// Shaped like what listModels('codex') actually returns, taken from the live catalogue.
const MODELS = [
  {
    id: 'gpt-5.6-luna',
    name: 'gpt-5.6-luna',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
      { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth' },
      { reasoningEffort: 'high', description: 'Greater reasoning depth' },
    ],
    defaultReasoningEffort: 'medium',
  },
  { id: 'sin-niveles', name: 'sin-niveles', supportedReasoningEfforts: [] },
  { id: 'sin-campo', name: 'sin-campo' },
];

test('only models that publish levels enter the catalogue', () => {
  const catalog = codexReasoningCatalog(MODELS);
  assert.deepEqual(Object.keys(catalog), ['gpt-5.6-luna'], 'a model without levels must not get an entry');
  assert.equal(catalog['gpt-5.6-luna'].fallback, 'medium', 'the default level is what «Predeterminado» resolves to');
  assert.equal(catalog['gpt-5.6-luna'].supported.length, 3);
});

test('a selector is offered only where a level can actually be chosen', () => {
  const catalog = codexReasoningCatalog(MODELS);
  assert.ok(reasoningChoiceFor(catalog, { provider: 'codex', model: 'gpt-5.6-luna' }));
  assert.equal(reasoningChoiceFor(catalog, { provider: 'codex', model: 'sin-niveles' }), null);
  assert.equal(reasoningChoiceFor(catalog, { provider: 'codex', model: 'desconocido' }), null);
  assert.equal(reasoningChoiceFor(catalog, { provider: 'gemini', model: 'gemini-3.1-flash-lite' }), null,
    'no other provider publishes reasoning levels, so no other provider gets a selector');
  assert.equal(reasoningChoiceFor(catalog, null), null);
  assert.equal(reasoningChoiceFor(null, { provider: 'codex', model: 'gpt-5.6-luna' }), null,
    'before the catalogue loads there is nothing to offer');
});

test('the Providers tab writes one default per model', () => {
  const stored = withCodexReasoning({}, 'gpt-5.6-luna', 'low');
  assert.deepEqual(stored, { 'gpt-5.6-luna': 'low' });

  // Back to «Predeterminado» clears the entry instead of storing a sentinel, so the
  // model keeps following its own recommendation when Codex changes it.
  assert.deepEqual(withCodexReasoning(stored, 'gpt-5.6-luna', null), {});
  assert.deepEqual(withCodexReasoning(undefined, 'otro', 'max'), { otro: 'max' }, 'an unset map is not a crash');

  const before = { a: 'low' };
  withCodexReasoning(before, 'b', 'high');
  assert.deepEqual(before, { a: 'low' }, 'the stored settings object is never mutated in place');
});

test('a role keeps its own level even when another role runs the same model', () => {
  // This is the whole bug: Inmersión and Deep Research pointed at one model, and
  // raising one raised the other, because the level had nowhere to live but a map
  // keyed by model id.
  const model = { provider: 'codex', model: 'gpt-5.6-luna' };
  const immersion = modelRefWithReasoning(model, 'high');
  const deepResearch = modelRefWithReasoning(model, 'low');

  assert.deepEqual(immersion, { provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'high' });
  assert.deepEqual(deepResearch, { provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'low' });
  assert.deepEqual(model, { provider: 'codex', model: 'gpt-5.6-luna' },
    'the stored selection is never mutated in place');

  // «Predeterminado» drops the property rather than storing a sentinel, so the role
  // falls back instead of pinning whatever level was current when it was cleared.
  const cleared = modelRefWithReasoning(immersion, null);
  assert.deepEqual(cleared, { provider: 'codex', model: 'gpt-5.6-luna' });
  assert.equal('reasoningEffort' in cleared, false, 'clearing removes the key, it does not set undefined');
});

test('the level a call runs at: the role first, then the model, then the provider', () => {
  const perModel = { 'gpt-5.6-luna': 'medium' };
  const plain = { provider: 'codex', model: 'gpt-5.6-luna' };

  assert.equal(codexReasoningFor(modelRefWithReasoning(plain, 'high'), perModel), 'high',
    "the role's own choice wins over the model-wide default");
  assert.equal(codexReasoningFor(plain, perModel), 'medium',
    'without one, the Providers tab default applies');
  assert.equal(codexReasoningFor(plain, {}), null,
    'without either, null lets the provider use its recommended level');
  assert.equal(codexReasoningFor(plain, undefined), null, 'an unset map is not a crash');
  assert.equal(codexReasoningFor(null, perModel), null);
  assert.equal(codexReasoningFor({ provider: 'openai', model: 'gpt-5.6-luna' }, perModel), null,
    'no other provider takes a Codex level, even for a model of the same name');
});

test('every model picker that drives a role carries its reasoning level', async () => {
  const [settings, providers, picker, generalModel] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/settings/ModelSettings.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProvidersSettings.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/ModelPicker.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/GeneralTextModelControl.tsx'), 'utf8'),
  ]);

  // The basic-mode general model moved into its own control when that row gained a
  // provider catalogue of its own. What this guards is that a role's level sits beside
  // that role's model — not which file the row happens to live in.
  const roleRows = `${settings}\n${generalModel}`;
  // Per-tool models are picked inside each tool now; Settings keeps the roles that have
  // no picker of their own.
  for (const role of ['synthesisModel', 'extractionModel', 'visionModel', 'summaryModel', 'fusionModel', 'relationModel']) {
    const row = roleRows.match(new RegExp(`<ModelWithReasoning[^>]*settings\\.${role}[^>]*>`, 's'));
    assert.ok(row, `the ${role} picker must offer the reasoning level next to it`);
  }
  assert.match(settings, /<ModelWithReasoning[^>]*settings\[item\.key\]/, 'the study vault overrides carry it too');

  // Providers owns the per-model map; Models must not touch it, or one role's level
  // lands on every other role running that model — the bug this file guards.
  assert.match(providers, /withCodexReasoning\(settings\.codexReasoningEfforts, model, effort\)/);
  assert.equal(/function codexReasoningLabel/.test(providers), false,
    'the level labels must come from the shared component, not a second private copy');
  assert.equal(/withCodexReasoning/.test(picker), false,
    'a role picker must never write the per-model map: that is what made the levels move together');
  assert.match(picker, /onChange\(modelRefWithReasoning\(/,
    "a role's level is written through the role's own onChange, beside its model");
});

test('the level a role chose is the one the completion call sends', async () => {
  const client = await readFile(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');

  // Reading the per-model map directly here would ignore the role's own choice.
  assert.equal(/codexReasoningEfforts\?\.\[/.test(client), false,
    'the client must resolve through codexReasoningFor, not read the per-model map itself');
  assert.match(client, /function configuredCodexReasoning\(model: ModelRef\)/);
  assert.match(client, /return codexReasoningFor\(model, getSettings\(\)\.codexReasoningEfforts\)/);

  // completeJson drives the scans. It ignored the setting entirely, so the selector
  // beside the extraction and scan pickers governed nothing at all.
  const completeJson = client.slice(client.indexOf('export async function completeJson'));
  const body = completeJson.slice(0, completeJson.indexOf('\n}\n'));
  assert.match(body, /const codexReasoning = configuredCodexReasoning\(resolved\) \?\? undefined/);
  assert.match(body, /rawComplete\(resolved, langOpts, true, reasoning, codexReasoning\)/);
});

test('two roles on one model render their own levels, not a shared one', async () => {
  // A regular expression over the source cannot tell "each row reads its own value" from
  // "each row reads the same map entry" — both look alike. So render the real component.
  const bundle = path.join(outDir, 'rows.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'visual-tests/reasoning-picker-entry.tsx')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    // react-dom/server reaches for node:stream through CommonJS, and an ESM bundle has no
    // `require` to give it. This is esbuild's documented interop shim.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    alias: { '@shared': path.join(repoRoot, 'shared') },
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const { renderRoles } = await import(pathToFileURL(bundle).href);

  /** The level the row's dropdown is actually sitting on. */
  const selected = (html) => html.match(/<select[^>]*model-reasoning[\s\S]*?<\/select>/)[0]
    .match(/<option value="([^"]*)"[^>]*\sselected/)?.[1] ?? null;

  const rows = renderRoles({ immersion: 'high', deepResearch: undefined });
  assert.equal(selected(rows.immersion), 'high', 'the role that was raised shows its level');
  assert.equal(selected(rows.deepResearch), '', 'the role beside it, on the same model, did not move');

  // «Predeterminado» has to name what the role would really fall back to, or the label
  // promises a level the completion call would not use.
  assert.match(rows.deepResearch, /Medio \(predeterminado\)/,
    "with nothing set in Providers, an unset role inherits the model's own recommendation");
  const inherited = renderRoles({ deepResearch: undefined }, { 'gpt-5.6-luna': 'low' });
  assert.match(inherited.deepResearch, /Bajo \(predeterminado\)/,
    "a level set in Providers is what an unset role inherits instead");
});

test('basic mode levels the reasoning too, not just the model', async () => {
  // Basic mode shows one picker for every text task. If it synchronised the model but
  // left a per-task level behind, that level would keep running with nothing on screen
  // to reveal it.
  const repo = await readFile(path.join(repoRoot, 'electron/db/settingsRepo.ts'), 'utf8');
  assert.match(repo, /differsFromGeneral = current\?\.provider !== general\?\.provider[\s\S]{0,200}current\?\.reasoningEffort !== general\?\.reasoningEffort/);
});

await rm(outDir, { recursive: true, force: true });
