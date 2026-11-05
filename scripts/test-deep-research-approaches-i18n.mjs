import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-approaches-i18n-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

const ioStub = {
  name: 'stub-approach-i18n-io',
  setup(api) {
    api.onResolve({ filter: /\.\/aiClient$/ }, () => ({ path: 'approach-ai', namespace: 'stub' }));
    api.onResolve({ filter: /\.\.\/db\/database$/ }, () => ({ path: 'approach-db', namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.path === 'approach-ai'
        ? 'export const completeJson = async (request) => { globalThis.__approachPromptCalls = [...(globalThis.__approachPromptCalls || []), request]; return { probes: [], comparands: [], axes: [], phases: [] }; };'
        : 'export const getDb = () => ({ prepare: () => ({ all: () => [] }) });',
      loader: 'js',
    }));
  },
};

const outfile = path.join(tmp, 'approaches.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchApproaches.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@shared': path.join(repoRoot, 'shared') },
  plugins: [ioStub],
  logLevel: 'silent',
});
const approaches = await import(`${pathToFileURL(outfile).href}?i18n=${Date.now()}`);
const desktopSource = await readFile(path.join(repoRoot, 'electron/ai/deepResearchApproaches.ts'), 'utf8');
const source = await readFile(path.join(repoRoot, 'shared/portableDeepResearchApproaches.ts'), 'utf8');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const specialized = ['literature_review', 'state_of_art', 'scholarly_debate', 'comparative', 'chronological', 'conceptual'];
const variants = ['academic', 'genealogy', 'study', 'unit', 'client'];
const SpanishRule = /Amplía la |Organiza el |Sintetiza las |Busca diversidad|Da peso adicional|Nunca presentes|Incluye cambios|No inventes|Prioriza obras|Estructura el |Distingue el |Toda comparación|Explicita las|Usa únicamente|No reduzcas|No colapses|Conserva la posición/iu;

test('every localized approach profile preserves ids, facets, rule families and variant shape', () => {
  for (const language of languages) {
    assert.equal(approaches.deepResearchApproachProfile('general', language).id, 'general');
    for (const approach of specialized) {
      const profile = approaches.deepResearchApproachProfile(approach, language);
      assert.equal(profile.id, approach);
      assert.ok(profile.retrievalRules.length > 0, `${language}/${approach} retrieval`);
      assert.ok(profile.plannerRules.length > 0, `${language}/${approach} planner`);
      assert.ok(profile.writerRules.length > 0, `${language}/${approach} writer`);
      assert.ok(profile.finalizerRules.length > 0, `${language}/${approach} finalizer`);
      assert.ok(profile.retrievalFacets.length >= 5, `${language}/${approach} facets`);
      for (const text of [
        ...profile.retrievalRules,
        ...profile.plannerRules,
        ...profile.writerRules,
        ...profile.finalizerRules,
        ...profile.retrievalFacets,
      ]) {
        if (language !== 'es') assert.doesNotMatch(text, SpanishRule, `${language}/${approach}: ${text}`);
      }
      for (const variant of variants) {
        const rules = approaches.approachRules(approach, variant, language);
        for (const stage of ['retrieval', 'planner', 'writer', 'finalizer']) {
          assert.ok(rules[stage].length > 0, `${language}/${approach}/${variant}/${stage}`);
          if (language !== 'es') for (const rule of rules[stage]) assert.doesNotMatch(rule, SpanishRule, `${language}/${approach}/${variant}/${stage}`);
        }
      }
    }
  }
});

test('supplemental retrieval prompt follows request language and keeps JSON contract and limits', async () => {
  for (const language of languages) {
    globalThis.__approachPromptCalls = [];
    await approaches.planApproachRetrieval({
      approach: 'comparative',
      variant: 'academic',
      objective: 'Compare the two documented cases',
      language,
      corpusPreview: { works: [] },
      model: null,
    });
    const call = globalThis.__approachPromptCalls.at(-1);
    assert.ok(call?.system, `${language} prompt missing`);
    assert.match(call.system, /probes/);
    assert.match(call.system, /comparands/);
    assert.match(call.system, /axes/);
    assert.match(call.system, /phases/);
    assert.match(call.system, /7/);
    assert.match(call.system, /6/);
    if (language !== 'es') assert.doesNotMatch(call.system, SpanishRule, `${language} retrieval prompt leaked Spanish`);
  }
});

test('localized retrieval wiring selects language-specific base and dynamic rules', () => {
  assert.match(desktopSource, /import \{planApproachRetrieval as portablePlanApproachRetrieval\} from '@shared\/portableDeepResearchApproaches'/);
  assert.match(desktopSource, /return portablePlanApproachRetrieval\(input,completeJson\)/);
  assert.match(source, /RETRIEVAL_PROMPT_BASE\[input\.language\]/);
  assert.match(source, /approachRules\(input\.approach, input\.variant, input\.language\)/);
  assert.match(source, /deterministicApproachRetrievalPlan\(input\.approach, input\.objective, input\.language\)/);
  assert.match(source, /deepResearchApproachProfile\(value, language\)/);
});
