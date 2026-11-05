import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-quality-packs-'));
const bundle = path.join(scratch, 'quality-packs.mjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/deepResearchQualityPromptPacks.ts'),
  '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`,
], { cwd: root, stdio: 'ignore' });
const packsModule = await import(pathToFileURL(bundle).href);
const desktopSource = fs.readFileSync(path.join(root, 'electron/ai/deepResearch.ts'), 'utf8');
const source = fs.readFileSync(path.join(root, 'shared/portableDeepResearchAI.ts'), 'utf8');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const stages = ['editorialReview', 'coherenceCheck', 'citationVerifier', 'candidateJudge', 'claimsAudit'];
const SpanishProse = [
  'Eres el director académico', 'Revisas la coherencia interna', 'Eres el verificador de citas',
  'Comparas dos versiones anónimas', 'Eres el auditor epistemológico previo',
  'Devuelve SOLO JSON válido', 'No inventes evidencia',
];

test('all eight quality prompt languages expose every requested audit stage', () => {
  for (const language of languages) {
    const pack = packsModule.deepResearchQualityPromptPack(language, ['APPROACH_SENTINEL: exact.']);
    assert.deepEqual(Object.keys(pack).sort(), [...stages].sort(), language);
    for (const stage of stages) assert.ok(pack[stage].length > 500, `${language}.${stage} is unexpectedly short`);
  }
});

test('Spanish canonical stages preserve clause counts and their contracts', () => {
  const pack = packsModule.deepResearchQualityPromptPack('es', ['APPROACH_SENTINEL: exact.']);
  assert.equal(pack.editorialReview.split('\n').length, 8);
  assert.equal(pack.coherenceCheck.split('\n').length, 6);
  assert.equal(pack.citationVerifier.split('\n').length, 14);
  assert.equal(pack.candidateJudge.split('\n').length, 5);
  assert.equal(pack.claimsAudit.split('\n').length, 21);
  const contracts = {
    editorialReview: ['diagnostico_global', 'secciones', 'eliminar', 'profundizar', 'cautelas', 'transicion'],
    coherenceCheck: ['tensiones', 'seccion_a', 'cita_a', 'seccion_b', 'cita_b', 'problema'],
    citationVerifier: ['veredictos', 'sostiene|parcial|no_sostiene', '"i":0'],
    candidateJudge: ['ganador', '0|1|2', 'motivo'],
    claimsAudit: ['claims', 'status', 'supported|partial|unsupported', 'reformulacion', 'requisitos', 'evidencias', 'direct|context|irrelevant', '"i":0'],
  };
  for (const stage of stages) {
    for (const marker of contracts[stage]) assert.match(pack[stage], new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${stage} lost ${marker}`);
  }
  assert.match(pack.claimsAudit, /APPROACH_SENTINEL: exact\./);
});

test('non-Spanish quality packs are native and preserve invariant JSON vocabulary', () => {
  for (const language of languages.filter((item) => item !== 'es')) {
    const pack = packsModule.deepResearchQualityPromptPack(language);
    for (const stage of stages) {
      for (const phrase of SpanishProse) assert.doesNotMatch(pack[stage], new RegExp(phrase), `${language}.${stage}`);
    }
    assert.match(pack.citationVerifier, /veredictos/);
    assert.match(pack.claimsAudit, /supported\|partial\|unsupported/);
  }
});

test('production quality stages call the native pack and no longer own Spanish arrays', () => {
  assert.match(source, /from '\.\/deepResearchQualityPromptPacks';/);
  assert.match(desktopSource, /import \{portableDeepResearchAI\} from '@shared\/portableDeepResearchAI'/);
  assert.match(desktopSource, /portableDeepResearchAI\(\{get documentaryEvidence\(\) \{ return getActiveVault\(\)\.type === "academic"; \}, completeJson, completeText\}\)/);
  const ranges = [
    ['async function aiReviewReport', 'function isAiCoherence'],
    ['async function aiCheckCoherence', 'interface AiProbes'],
    ['async function aiVerifyCitations', 'async function aiReviseSection'],
    ['async function aiJudgeSectionRevision', 'interface AiPlan'],
    ['async function aiAuditSectionClaims', 'function isAiSectionEvidencePlan'],
  ];
  for (const [startMarker, endMarker] of ranges) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + 1);
    assert.ok(start >= 0 && end > start, `could not isolate ${startMarker}`);
    const body = source.slice(start, end);
    assert.doesNotMatch(body, /const (?:system|reviewSystem|redTeamSystem) = \[/, `${startMarker} still owns a Spanish array`);
    assert.match(body, /deepResearchQualityPromptPack\(/, `${startMarker} is not wired to the native pack`);
  }
  assert.match(source, /language: PromptLanguage/);
  assert.match(source, /deepResearchQualityPromptPack\(input\.language\)\.editorialReview/);
  assert.match(source, /deepResearchQualityPromptPack\(language\)\.citationVerifier/);
});

test('portable citation verifier sends the localized prompt with exact source evidence and no nested retries', async () => {
  const aiBundle = path.join(scratch, 'portable-quality.mjs');
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'shared/portableDeepResearchAI.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${aiBundle}`], {cwd: root, stdio: 'ignore'});
  const {portableDeepResearchAI} = await import(pathToFileURL(aiBundle).href);
  for (const language of [...languages, 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko']) {
    const calls = [];
    const model = {provider:'openai', model:'fixture-only'};
    const ai = portableDeepResearchAI({documentaryEvidence:true, completeText: async () => { throw new Error('unexpected text call'); }, completeJson: async (request, guard, receivedModel) => {
      calls.push({request, receivedModel});
      const value = {veredictos:[{i:0, veredicto:'unsupported'}]};
      assert.equal(guard(value), true);
      return value;
    }});
    const result = await ai.aiVerifyCitations([{sentence:'Claim to check.',kind:'passage',content:'Exact source evidence.'}], model, language);
    assert.deepEqual(result, ['unsupported'], 'unsupported evidence cannot become a successful citation');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request.system, packsModule.deepResearchQualityPromptPack(language).citationVerifier);
    assert.equal(calls[0].request.noRetry, true);
    assert.equal(calls[0].receivedModel, model);
    assert.deepEqual(JSON.parse(calls[0].request.user).pares, [{i:0, afirmacion:'Claim to check.',tipo_de_fuente:'passage',contenido_de_la_fuente:'Exact source evidence.'}]);
  }
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
