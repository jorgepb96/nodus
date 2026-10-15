import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-deep-research-prompts-'));
const outfile = path.join(tmp, 'packs.mjs');
await build({
  entryPoints: [path.join(root, 'shared/studyDeepResearchPromptPacks.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const module = await import(pathToFileURL(outfile).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const fields = ['fixedOutlineRule', 'sectionFocusRule', 'plannerRules', 'writerRules', 'finalizerRules', 'finalAuditRules', 'reviseStudySection'];

test('all fifteen languages have the same complete study-deep-research contract', () => {
  const packs = languages.map((language) => module.studyDeepResearchPromptPack(language));
  for (const [index, pack] of packs.entries()) {
    const language = languages[index];
    for (const field of fields) assert.ok(pack[field], `${language}.${field} is missing`);
    assert.equal(pack.plannerRules.length, 3, `${language}: planner clauses were condensed`);
    assert.equal(pack.writerRules.length, 3, `${language}: writer clauses were condensed`);
    assert.equal(pack.finalizerRules.length, 1, `${language}: finalizer clauses were condensed`);
    assert.equal(pack.finalAuditRules.length, 4, `${language}: final-audit clauses were condensed`);
    assert.equal(pack.reviseStudySection(false).split('\n').length, 7, `${language}: revision clauses were condensed`);
    assert.equal(pack.reviseStudySection(true).split('\n').length, 7, `${language}: teaching revision clauses were condensed`);
    assert.match(pack.fixedOutlineRule, /fixedSections/);
    assert.match(pack.sectionFocusRule, /teacherFocus/);
    assert.equal(typeof pack.progress.snapshot(true), 'string');
    assert.equal(typeof pack.progress.planning(true, true, true, 2), 'string');
    assert.equal(typeof pack.progress.section(true, 'X'), 'string');
    assert.equal(typeof pack.progress.assembling(true, true), 'string');
    assert.equal(typeof pack.progress.done(true, true, false, 2, 3), 'string');
    assert.equal(typeof pack.progress.noSources(true), 'string');
    assert.ok(pack.progress.stoppedReason.length > 8);
    assert.ok(pack.progress.noCitations.length > 3);
  }
});

test('language lookup falls back to Spanish and preserves all dynamic values', () => {
  assert.equal(module.studyDeepResearchPromptPack('invalid').fixedOutlineRule, module.studyDeepResearchPromptPack('es').fixedOutlineRule);
  for (const language of languages) {
    const pack = module.studyDeepResearchPromptPack(language);
    assert.match(pack.progress.planning(true, false, true, 9), /9/);
    assert.match(pack.progress.section(false, 'Section title'), /Section title/);
    assert.match(pack.progress.done(false, false, false, 4, 7), /4/);
    assert.match(pack.progress.done(false, false, false, 4, 7), /7/);
    assert.match(pack.progress.noSources(false), /./);
  }
});

test('the Electron Study engine wires the requested language pack into every phase', async () => {
  const source = await readFile(path.join(root, 'shared/portableStudyDeepResearch.ts'), 'utf8');
  const binding=await readFile(path.join(root,'electron/ai/studyDeepResearch.ts'),'utf8');
  assert.match(binding,/portableStudyDeepResearch\(\{completeJson,completeText,retrieveStudyAssistantEntries,listStudyIdeasForSources\}\)/);
  assert.match(source, /from ['"]@shared\/studyDeepResearchPromptPacks['"]/);
  assert.match(source, /studyDeepResearchRulesPromptPack\(language\)/);
  assert.match(source, /\.\.\.copy\.plannerRules/);
  assert.match(source, /\.\.\.copy\.writerRules/);
  assert.match(source, /\.\.\.copy\.finalizerRules/);
  assert.match(source, /\.\.\.copy\.finalAuditRules/);
  assert.match(source, /studyDeepResearchRulesPromptPack\(input\.language\)\.reviseStudySection\(input\.teacherPlan\)/);
  assert.match(source, /copy\.progress\.snapshot/);
  assert.match(source, /copy\.progress\.planning/);
  assert.match(source, /copy\.progress\.section/);
  assert.match(source, /copy\.progress\.assembling/);
  assert.match(source, /copy\.progress\.done/);
  assert.match(source, /copy\.progress\.noSources/);
  assert.match(source, /copy\.progress\.stoppedReason/);
});
