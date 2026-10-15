import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-writing-packs-'));
const bundle = path.join(scratch, 'writing-packs.mjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/deepResearchWritingPromptPacks.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`,
], { cwd: root, stdio: 'ignore' });
const module = await import(pathToFileURL(bundle).href);
const desktopSource = readFileSync(path.join(root, 'electron/ai/deepResearch.ts'), 'utf8');
const source = readFileSync(path.join(root, 'shared/portableDeepResearchAI.ts'), 'utf8');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const stages = ['sectionEditor', 'evidencePlan', 'sectionWriter', 'paragraphWriter', 'finalizer', 'finalAudit'];

test('documentary safeguards reach every writing stage in all fifteen languages', () => {
  for (const language of [...languages, 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko']) {
    const base = module.deepResearchWritingPromptPack(language);
    const documentary = module.deepResearchWritingPromptPack(language, { documentaryEvidence: true });
    for (const stage of stages) assert.ok(documentary[stage].length > base[stage].length + 100, `${language}.${stage}`);
  }
  assert.match(module.deepResearchWritingPromptPack('es', { documentaryEvidence: true }).sectionWriter, /Distingue dato ausente, valor cero/);
});

test('all eight writing languages expose all requested stages', () => {
  for (const language of languages) {
    const pack = module.deepResearchWritingPromptPack(language, { approachRules: ['APPROACH_SENTINEL: exact.'], narrativeRules: ['NARRATIVE_SENTINEL: exact.'], isConclusion: true });
    assert.deepEqual(Object.keys(pack).sort(), [...stages].sort(), language);
    for (const stage of stages) assert.ok(pack[stage].length > 500, `${language}.${stage} is too short`);
  }
});

test('Spanish writing stages preserve canonical clause counts, dynamic rules, and contracts', () => {
  const pack = module.deepResearchWritingPromptPack('es', { approachRules: ['APPROACH_SENTINEL: exact.'], narrativeRules: ['NARRATIVE_SENTINEL: exact.'], isConclusion: true });
  assert.equal(pack.sectionEditor.split('\n').length, 23);
  assert.equal(pack.evidencePlan.split('\n').length, 16);
  assert.equal(pack.sectionWriter.split('\n').length, 30);
  assert.equal(pack.paragraphWriter.split('\n').length, 18);
  assert.equal(pack.finalizer.split('\n').length, 9);
  assert.equal(pack.finalAudit.split('\n').length, 9);
  for (const stage of stages) {
    assert.match(pack[stage], /APPROACH_SENTINEL: exact\./);
    if (['sectionEditor', 'sectionWriter', 'paragraphWriter'].includes(stage)) assert.match(pack[stage], /NARRATIVE_SENTINEL: exact\./);
  }
  for (const token of ['proposiciones_a_contrastar', 'auditoria_epistemologica', 'nodus://', 'Markdown', '`direct`', '`context`', '`irrelevant`']) assert.match(pack.sectionWriter, new RegExp(token));
  for (const token of ['tesis', 'vinculos_objetivo', 'exclusiones', 'parrafos', 'rol_probatorio', 'afirmacion', 'evidencias', 'lados_relacion']) assert.match(pack.evidencePlan, new RegExp(token));
  for (const token of ['title', 'abstract', 'limitations', 'nextSteps']) assert.match(pack.finalizer, new RegExp(token));
});

test('non-Spanish packs avoid legacy Spanish prose while retaining contract keys and enums', () => {
  for (const language of languages.filter((item) => item !== 'es')) {
    const pack = module.deepResearchWritingPromptPack(language);
    for (const stage of stages) {
      assert.doesNotMatch(pack[stage], /Eres el |Eres la |Redactas UN SOLO|Cierras un informe|Auditas el título|Escribe en español/iu, `${language}.${stage}`);
    }
    assert.match(pack.sectionWriter, /proposiciones_a_contrastar|nodus:\/\//);
    assert.match(pack.evidencePlan, /supported|partial|unsupported/);
    assert.match(pack.finalAudit, /limitations|nextSteps/);
  }
});

test('runtime section scaffolding and failures are native in all eight languages', () => {
  for (const language of languages) {
    const copy = module.deepResearchWritingRuntimeCopy(language);
    for (const value of Object.values(copy)) assert.ok(value.length > 5, `${language} has an empty runtime value`);
    if (language !== 'es') {
      assert.doesNotMatch(Object.values(copy).join('\n'), /primera sección|inicio de la sección|plan probatorio|Párrafo probatorio|redacción probatoria/iu, `${language} leaks Spanish runtime prose`);
    }
  }
  assert.match(source, /deepResearchWritingRuntimeCopy\(input\.language\)/);
  assert.doesNotMatch(source, /input\.priorSummary \|\| '\(primera sección\)'|input\.priorSummary \|\| '\(esta es la primera sección\)'/);
});

test('production writing stages use the native pack and remain scoped to their original functions', () => {
  assert.match(source, /from '\.\/deepResearchWritingPromptPacks';/);
  assert.match(desktopSource, /import \{portableDeepResearchAI\} from '@shared\/portableDeepResearchAI'/);
  assert.match(desktopSource, /portableDeepResearchAI\(\{get documentaryEvidence\(\) \{ return getActiveVault\(\)\.type === "academic"; \}, completeJson, completeText\}\)/);
  assert.match(desktopSource, /const \{[^}]*aiReviseSection[^}]*aiPlanSectionEvidence[^}]*aiWriteSection[^}]*aiFinalize[^}]*aiAuditFinalSummary\} = canonicalAcademicAI/);
  const ranges = [
    ['async function aiReviseSection', 'interface AiSectionChoice'],
    ['async function aiPlanSectionEvidence', 'async function aiWriteSection'],
    ['async function aiWriteSection', 'async function aiWriteSectionParagraphByParagraph'],
    ['async function aiWriteSectionParagraphByParagraph', 'interface AiFinal'],
    ['async function aiFinalize', '/** A second, colder pass'],
    ['async function aiAuditFinalSummary', null],
  ];
  for (const [startMarker, endMarker] of ranges) {
    const start = source.indexOf(startMarker);
    const end = endMarker ? source.indexOf(endMarker, start + 1) : source.length;
    assert.ok(start >= 0 && end > start, `could not isolate ${startMarker}`);
    const body = source.slice(start, end);
    assert.doesNotMatch(body, /const system = \[/, `${startMarker} still owns a Spanish prompt array`);
    assert.match(body, /deepResearchWritingPromptPack\(/, `${startMarker} is not wired to native writing prompts`);
  }
  assert.match(source, /narrativeRules: deepResearchNarrativeRules\(input\.language\)/);
  assert.match(source, /approachRules: approach\?\.rules\.writer \?\? \[\]/);
  assert.match(source, /approachRules: approach\?\.rules\.finalizer \?\? \[\]/);
});

test('portable finalizer sends localized documentary and approach rules through the injected host', async () => {
  const aiBundle = path.join(scratch, 'portable-ai.mjs');
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'shared/portableDeepResearchAI.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${aiBundle}`], {cwd: root, stdio: 'ignore'});
  const {portableDeepResearchAI} = await import(pathToFileURL(aiBundle).href);
  for (const language of languages) {
    let captured;
    const ai = portableDeepResearchAI({documentaryEvidence: true, completeText: async () => { throw new Error('unexpected text completion'); }, completeJson: async (request, guard, model) => {
      captured = {request, model};
      const result = {title: 'Grounded title', abstract: 'Grounded summary', limitations: [], nextSteps: []};
      assert.equal(guard(result), true);
      return result;
    }});
    const model = {provider: 'openai', model: 'fixture-only'};
    const result = await ai.aiFinalize({language, objective: 'Fixture objective', planTitle: 'Fixture', sectionTitles: [], ideasCovered: 0, ideasConsidered: 0, uncoveredSamples: []}, model, {approach: 'comparative', rules: {planner: [], writer: [], finalizer: ['FINALIZER_SENTINEL']}, retrieval: {probes: [], comparands: [], axes: [], phases: []}, relationships: []});
    assert.equal(captured.request.system, module.deepResearchWritingPromptPack(language, {documentaryEvidence: true, approachRules: ['FINALIZER_SENTINEL']}).finalizer);
    assert.equal(JSON.parse(captured.request.user).idioma, language);
    assert.equal(captured.model, model);
    assert.equal(result.title, 'Grounded title');
  }
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
