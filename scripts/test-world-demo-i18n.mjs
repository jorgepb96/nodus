import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-world-demo-i18n-'));
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'];

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'ignore' }
  );
  return require(bundle);
}

const { WORLD_DEMO_TRANSLATIONS } = loadModule('shared/worldbuildingDemoTranslations.generated.ts');
const {
  relocalizeWorldbuildingDemoText,
  worldbuildingDemoLocalized,
  worldbuildingDemoText,
  worldbuildingDemoVariants,
} = loadModule('shared/worldbuildingDemoI18n.ts');

test.after(() => rm(outDir, { recursive: true, force: true }));

test('every shipped demo string has a non-empty value in every interface language', () => {
  const entries = Object.entries(WORLD_DEMO_TRANSLATIONS);
  assert.ok(entries.length >= 600, `expected the complete demo corpus, received ${entries.length} strings`);
  for (const [source, translations] of entries) {
    assert.deepEqual(Object.keys(translations).sort(), [...languages].sort(), `language set for ${source}`);
    for (const language of languages) {
      assert.equal(typeof translations[language], 'string', `${language}: ${source}`);
      assert.ok(translations[language].trim(), `${language} is empty for ${source}`);
    }
    assert.equal(translations.es, source, `Spanish source mismatch for ${source}`);
  }
});

test('every literal routed through a demo localization helper is present in the generated catalog', async () => {
  const helperNames = new Set(['text', 'localized', 'demoText', 'demoLiteral']);
  for (const relative of [
    'electron/db/worldbuildingDemoData.ts',
    'electron/db/worldbuildingDemoNarrative.ts',
  ]) {
    const source = await readFile(path.join(repoRoot, relative), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.type !== 'Identifier' || !helperNames.has(path.node.callee.name)) return;
        const first = path.node.arguments[0];
        if (first?.type !== 'StringLiteral') return;
        assert.ok(WORLD_DEMO_TRANSLATIONS[first.value], `${relative} misses ${JSON.stringify(first.value)}`);
        const second = path.node.arguments[1];
        if (second?.type === 'StringLiteral') {
          assert.equal(
            WORLD_DEMO_TRANSLATIONS[first.value].en,
            second.value,
            `${relative} has a stale English translation for ${JSON.stringify(first.value)}`
          );
        }
      },
    });
  }
});

test('localized demo links retain one resolvable marker in every language', () => {
  for (const [source, translations] of Object.entries(WORLD_DEMO_TRANSLATIONS)) {
    const expected = [...source.matchAll(/\[\[[^\]\n]+\]\]/g)].length;
    if (!expected) continue;
    for (const language of languages) {
      assert.equal(
        [...translations[language].matchAll(/\[\[[^\]\n]+\]\]/g)].length,
        expected,
        `${language} changed the wiki-link structure in ${source}`
      );
    }
  }
});

test('demo helper exposes all locales, distinct Portuguese variants and safe relocalization', () => {
  const localized = worldbuildingDemoLocalized(
    'Calendario de las Mareas',
    'Calendar of Tides'
  );
  assert.deepEqual(Object.keys(localized).sort(), [...languages].sort());
  assert.equal(worldbuildingDemoText('de', 'Calendario de las Mareas'), localized.de);
  assert.notEqual(localized.pt, localized['pt-BR']);
  assert.ok(worldbuildingDemoVariants('Calendario de las Mareas').includes(localized.tr));

  const edited = 'Mi calendario completamente personalizado';
  assert.equal(relocalizeWorldbuildingDemoText(edited, 'fr'), edited);
  assert.equal(
    relocalizeWorldbuildingDemoText('Calendar of Tides', 'fr'),
    localized.fr
  );

  const linkedSource = Object.keys(WORLD_DEMO_TRANSLATIONS).find((value) => value.includes('[[Lúmina]]'));
  assert.ok(linkedSource, 'expected a stock demo sentence linked to Lúmina');
  const linkedEnglish = WORLD_DEMO_TRANSLATIONS[linkedSource].en.replace(
    /\[\[([^\]\n]+)\]\]/,
    '[$1](nodus://world/place/demo-world-place-lumina)'
  );
  const linkedFrench = relocalizeWorldbuildingDemoText(linkedEnglish, 'fr');
  assert.match(linkedFrench, /\[[^\]\n]+\]\(nodus:\/\/world\/place\/demo-world-place-lumina\)/);
});

test('demo locale is not reduced to an English/Spanish binary', async () => {
  const source = await readFile(path.join(repoRoot, 'electron/db/worldbuildingDemoData.ts'), 'utf8');
  const narrative = await readFile(path.join(repoRoot, 'electron/db/worldbuildingDemoNarrative.ts'), 'utf8');
  assert.doesNotMatch(source, /\bL\s*===\s*['"]es['"]/);
  assert.doesNotMatch(source, /locale\(\)\s*===\s*['"]es['"]/);
  assert.match(source, /type DemoLocale = AppLanguage/);
  assert.match(source, /export function relocalizeWorldbuildingDemoData/);
  assert.match(narrative, /type WorldbuildingDemoLocalized/);
});

test('all Worldbuilding AI entry points use a native operation prompt in the selected prompt language', async () => {
  for (const relative of [
    'electron/ai/worldArticleDraft.ts',
    'electron/ai/worldChat.ts',
    'electron/ai/worldMissingEntries.ts',
    'electron/ai/worldProseReview.ts',
    'electron/ai/worldQuestionOptions.ts',
    'electron/ai/worldRules.ts',
    'electron/ai/characterInterview.ts',
    'electron/ai/characterBiography.ts',
  ]) {
    const source = await readFile(path.join(repoRoot, relative), 'utf8');
    assert.match(source, /world(?:OperationSystemPrompt|CharacterInterviewPrompt)\(/, `${relative} misses the native prompt contract`);
    if (relative === 'electron/ai/worldProseReview.ts') {
      assert.match(source, /requestedLanguage\?:PromptLanguage/);
      assert.match(source, /const language = requestedLanguage \?\? getSettings\(\)\.promptLanguage \?\? 'es'/, 'portable capture uses its explicit language or the configured fallback');
      assert.match(source, /worldOperationSystemPrompt\('proseReview', language\)/);
    } else {
      assert.match(source, /settings\.promptLanguage/, `${relative} ignores the selected prompt language`);
    }
  }
  const helper = await readFile(path.join(repoRoot, 'shared/worldOperationPrompts.ts'), 'utf8');
  // Prompt packs are keyed by PromptLanguage, a wider union than the interface: the
  // Simplified Chinese prompt catalogue is `zh-Hans`, and `zh-CN` (the interface code)
  // normalizes to it, so it has no key of its own here.
  for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant']) {
    assert.match(helper, new RegExp(`['"]?${language.replace('-', '\\-')}['"]?\\s*:`));
  }
});
