import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const require = createRequire(import.meta.url);

async function load(entry, label) {
  const outfile = path.join(os.tmpdir(), `nodus-${label}-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try { return require(outfile); } finally { fs.rmSync(outfile, { force: true }); }
}

const contractTokens = [
  'title', 'abstract', 'sections', 'id', 'purpose', 'keyPoints', 'coverageQuestions', 'sourceIds',
  'preguntas_de_cobertura', 'hallazgos_verificados', 'limitations', 'nextSteps',
  'nodus://archive/<itemId>', 'nodus://work/<nodusId>', '`doc:`/`work:`', '##',
];

test('genealogy prompt pack has all five stages in all supported locales', async () => {
  const packs = await load('shared/genealogyDeepResearchPromptPacks.ts', 'genealogy-packs');
  for (const language of languages) {
    const pack = packs.genealogyDeepResearchPromptPack(language);
    const prompts = [pack.planner(3, 'Ada Example'), pack.writer('Ada Example'), pack.editor, pack.finalizer, pack.auditor];
    for (const prompt of prompts) {
      assert.ok(prompt.trim(), `${language} has an empty genealogy prompt`);
    }
    const all = prompts.join('\n');
    for (const token of contractTokens) assert.match(all, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${language} lost contract token ${token}`);
    assert.match(all, /6(?:-10| à 10|–10)/, `${language} changed the 6-10 line limit`);
    assert.match(pack.planner(7), /7/);
    assert.match(pack.planner(3, 'Ada Example'), /Ada Example/);
    assert.doesNotMatch(pack.planner(3), /Ada Example/);
  }
});

test('Spanish genealogy contract remains complete and shared narrative rules stay byte-identical', async () => {
  const packs = await load('shared/genealogyDeepResearchPromptPacks.ts', 'genealogy-es');
  const core = await load('electron/ai/deepResearchCore.ts', 'genealogy-core');
  const planner = packs.genealogyDeepResearchPromptPack('es').planner(3, 'Ana');
  const writer = packs.genealogyDeepResearchPromptPack('es').writer('Ana');
  const required = [
    'Eres el planificador de un INFORME DE HISTORIA FAMILIAR',
    'pocas secciones LARGAS y de fondo, no muchas cortas',
    'función probatoria distinta',
    'los `sourceIds` que la sostienen',
    'COBERTURA OBLIGATORIA',
    'Hay una PERSONA EN FOCO: Ana',
    'Devuelve SOLO JSON',
    'Eres el redactor de un INFORME DE HISTORIA FAMILIAR',
    'CITAS:',
    'nodus://archive/<itemId>',
    'nodus://work/<nodusId>',
  ];
  for (const clause of required) assert.match(`${planner}\n${writer}`, new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Spanish contract lost: ${clause}`);
  assert.deepEqual(core.deepResearchNarrativeRules('es'), core.deepResearchNarrativeRules(), 'Spanish narrative rules changed');
  assert.equal(core.deepResearchNarrativeRules('es').length, 13);
});

test('genealogy module is wired to the explicit prompt language and pack stages', () => {
  const desktop = fs.readFileSync(path.join(root, 'electron/ai/genealogyDeepResearch.ts'), 'utf8');
  assert.match(desktop,/const genealogyEngine=portableGenealogyDeepResearch\(/);
  assert.match(desktop,/orchestrateGenealogyDeepResearch\(\.\.\.args\)/);
  const source = desktop+'\n'+fs.readFileSync(path.join(root,'shared/portableGenealogyDeepResearch.ts'),'utf8');
  assert.match(source, /genealogyDeepResearchPromptPack/);
  assert.match(source, /genealogyDeepResearchRuntimeCopy/);
  assert.match(source, /normalizePromptLanguage\(request\.language \?\? getSettings\(\)\.promptLanguage \?\? 'es'\)/);
  for (const stage of ['planner', 'writer', 'editor', 'finalizer', 'auditor']) assert.match(source, new RegExp(`copy\\.${stage}`), `missing ${stage} pack wiring`);
  // The section writer normalizes the language once and reuses it for the narrative
  // rules and for the localized length guidance.
  assert.match(source, /const promptLanguage = normalizePromptLanguage\(input\.language\);/);
  assert.match(source, /deepResearchNarrativeRules\(promptLanguage\)/);
  assert.match(source, /deepResearchLengthPromptPack\(promptLanguage\)/);
  assert.match(source, /specializedGenealogyDeps\(model, approach, retrieval, language, signal, companion\)/);
  assert.match(source, /approachRules\(approach, 'genealogy', language\)/);
  for (const legacy of ['Eres el planificador de un INFORME', 'Eres el redactor de un INFORME', 'Eres el editor final de un informe']) {
    assert.doesNotMatch(source, new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `legacy inline prompt remains: ${legacy}`);
  }
});

test('genealogy deterministic runtime copy is complete and language-specific', async () => {
  const packs = await load('shared/genealogyDeepResearchPromptPacks.ts', 'genealogy-runtime');
  for (const language of languages) {
    const copy = packs.genealogyDeepResearchRuntimeCopy(language);
    const samples = [
      copy.document,
      copy.work,
      copy.author,
      copy.snapshotFocus('Ada Example'),
      copy.snapshotFamily,
      copy.planning(4),
      copy.maxSections(4),
      copy.drafting('Life'),
      copy.degraded,
      copy.assembling,
      copy.verificationNextStep,
      copy.doneSingle(5),
      copy.doneSections(4, 5),
      copy.section(2),
      copy.firstSection,
      copy.mentions('Ada Example'),
      copy.archiveOrLibrary,
      copy.primarySource,
      copy.secondarySource,
      copy.focusOrigins('Ada Example'),
      copy.focusOriginsPurpose,
      copy.focusLife('Ada Example'),
      copy.focusLifePurpose,
      copy.synthesis,
      copy.synthesisPurpose,
      copy.familyOverview,
      copy.familyOverviewPurpose,
      copy.documentedLives,
      copy.documentedLivesPurpose,
      copy.focusReport('Ada Example', 'Origins'),
      copy.familyReport('Origins'),
      copy.degradedNoSources,
    ];
    for (const value of samples) assert.ok(value.trim(), `${language} has empty deterministic runtime copy`);
    assert.match(samples.join('\n'), /Ada Example/);
    assert.match(samples.join('\n'), /4/);
  }
  assert.match(packs.genealogyDeepResearchRuntimeCopy('en').planning(3), /Planning 3 sections/);
  assert.doesNotMatch(packs.genealogyDeepResearchRuntimeCopy('en').planning(3), /Planificando|secciones según/);
  assert.match(packs.genealogyDeepResearchRuntimeCopy('pt-BR').section(2), /Seção 2/);
  assert.match(packs.genealogyDeepResearchRuntimeCopy('pt').section(2), /Secção 2/);
  assert.deepEqual(packs.genealogyDeepResearchRuntimeCopy('unknown'), packs.genealogyDeepResearchRuntimeCopy('en'));
});

test('non-Spanish genealogy writers request their own locale instead of Spanish', async () => {
  const packs = await load('shared/genealogyDeepResearchPromptPacks.ts', 'genealogy-native-language');
  for (const language of languages.filter((value) => value !== 'es')) {
    const pack = packs.genealogyDeepResearchPromptPack(language);
    assert.doesNotMatch(`${pack.writer()}\n${pack.finalizer}`, /Write in Spanish|Escribe en español/i, `${language} still requests Spanish output`);
  }
});

console.log(`Genealogy prompt-pack parity passed for ${languages.length} locales.`);
