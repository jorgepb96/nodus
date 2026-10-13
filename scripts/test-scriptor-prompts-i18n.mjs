import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'];
const exports = `
  export { studyStyleDisplay } from './src/components/editor/studyStyleLocalization';
  export { STUDY_IMPROVE_PRESETS, localizedStudyStyleInstruction } from './shared/studyImprove';
  export { STUDY_IMPROVE_TRANSLATIONS } from './src/i18n.studyImprove';
  export { normalizePromptLanguage } from './shared/promptLanguageOptions';
  export { setActiveLang } from './src/i18n';
`;

test('all 13 built-in prompts have native display copy in every interface language', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-scriptor-prompts-'));
  try {
    const outfile = path.join(directory, 'copy.cjs');
    await build({ stdin: { contents: exports, resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const api = createRequire(import.meta.url)(outfile);
    const presets = api.STUDY_IMPROVE_PRESETS;
    const original = JSON.stringify(presets);
    assert.equal(presets.length, 13);
    for (const language of languages) {
      api.setActiveLang(language);
      for (const style of presets) {
        const display = api.studyStyleDisplay(style);
        if (language === 'es') {
          assert.deepEqual(display, { name: style.name, description: style.description, prompt: style.prompt });
        } else {
          const table = api.STUDY_IMPROVE_TRANSLATIONS[language === 'pt-BR' ? 'ptBR' : language];
          const label = table[`${style.name} · ${style.description}`];
          assert.ok(label, `${language}/${style.id}: explicit title and description translation`);
          assert.equal(`${display.name} · ${display.description}`, label.replace(/\s*[·・]\s*/, ' · '));
          assert.notEqual(display.description, style.description, `${language}/${style.id}: translated description`);
          assert.notEqual(display.prompt, style.prompt, `${language}/${style.id}: translated prompt`);
          assert.equal(display.prompt, api.localizedStudyStyleInstruction(style, api.normalizePromptLanguage(language)));
        }
        assert.deepEqual(display.prompt.match(/\{\{\w+\}\}/g), style.prompt.match(/\{\{\w+\}\}/g), 'template variables survive translation');
      }
      const custom = { ...presets[0], builtIn: false, language: 'fr' };
      assert.strictEqual(api.studyStyleDisplay(custom), custom, 'custom copy is untouched even with a built-in ID or title');
      const unknown = { ...presets[0], id: 'builtin:unknown' };
      assert.strictEqual(api.studyStyleDisplay(unknown), unknown);
    }
    assert.equal(JSON.stringify(presets), original, 'localisation never mutates the stored catalogue');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('prompt library, search, AI selector and shortcuts follow language changes without changing saved prompts', { timeout: 120_000 }, async context => {
  const executablePath = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!executablePath) { context.skip('An isolated test browser is required'); return; }
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { StudyImproveDialog } from './src/components/editor/StudyImproveDialog';
      import { ScriptorAiPanel } from './src/components/editor/ScriptorAiPanel';
      import { studyStyleDisplay } from './src/components/editor/studyStyleLocalization';
      import { STUDY_IMPROVE_PRESETS } from './shared/studyImprove';
      import { setActiveLang } from './src/i18n';
      const custom = { ...STUDY_IMPROVE_PRESETS[0], id: 'user:academic', builtIn: false };
      const styles = [...STUDY_IMPROVE_PRESETS, custom];
      window.originalStyles = JSON.stringify(styles);
      window.expectedCopy = () => styles.map(style => ({ id: style.id, ...studyStyleDisplay(style) }));
      window.nodus = {
        listStudyStyles: async () => styles,
        getSettings: async () => ({ studyImproveToolbarStyleIds: ['builtin:academic'] }),
      };
      const noop = () => {};
      function App() {
        const [language, setLanguage] = useState('es');
        const [panel, setPanel] = useState(false);
        setActiveLang(language);
        window.changeLanguage = setLanguage;
        window.changePanel = setPanel;
        return <div data-language={language}>{panel ? <ScriptorAiPanel
          mode="polish" settings={{ favorites: [] }} model={null} onModelChange={noop}
          styles={styles} quickStyles={STUDY_IMPROVE_PRESETS.slice(0, 4)} styleId="builtin:academic" onStyleChange={noop}
          instructions="" onInstructionsChange={noop} imagePrompt="" onImagePromptChange={noop}
          imageModel={{ provider: 'openai', model: 'test' }} imageChoices={[]} onImageModelChange={noop}
          status="compose" error="" warnings={[]} image={null}
          onSubmit={noop} onCancel={noop} onAccept={noop} onReject={noop} onImage={noop} onPolish={noop} onInsert={noop} onClose={noop} onLayout={noop}
        /> : <StudyImproveDialog onClose={noop} onToolbarChanged={noop} onApply={style => { window.applied = style; }} />}</div>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, outdir: 'out', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath, headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.getByTestId('study-style-builtin-academic').waitFor();
    for (const language of languages) {
      await page.evaluate(language => window.changeLanguage(language), language);
      await page.locator('[data-language="' + language + '"]').waitFor({ state: 'attached' });
      const expected = await page.evaluate(() => window.expectedCopy());
      for (const copy of expected) {
        const row = page.getByTestId('study-style-' + copy.id.replace(':', '-'));
        assert.equal(await row.textContent(), copy.name);
        await row.click();
        assert.equal(await page.locator('.study-prompts-identity h3').textContent(), copy.name);
        assert.equal(await page.locator('.study-prompts-description').textContent(), copy.description);
        assert.equal(await page.locator('.study-prompts-text').textContent(), copy.prompt);
      }
      const search = page.getByTestId('study-prompt-search');
      await search.fill(expected[10].prompt);
      assert.deepEqual(await page.locator('.study-prompts-choice').allTextContents(), [expected[10].name], 'search uses translated prompt content');
      await search.fill('');
    }
    // A language switch must also invalidate an existing filtered list.
    await page.evaluate(() => window.changeLanguage('en'));
    await page.locator('[data-language="en"]').waitFor({ state: 'attached' });
    await page.getByTestId('study-prompt-search').fill('Rewrite the selected text');
    assert.equal(await page.locator('.study-prompts-choice').count(), 1);
    await page.evaluate(() => window.changeLanguage('fr'));
    await page.locator('[data-language="fr"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.study-prompts-choice').count(), 0);
    await page.getByTestId('study-prompt-search').fill('');
    await page.getByTestId('study-style-builtin-academic').click();
    await page.getByTestId('study-prompt-apply').click();
    assert.equal(await page.evaluate(() => window.applied.prompt), 'Reescribe el texto seleccionado con registro académico, precisión conceptual y transiciones explícitas.', 'apply receives the original stored style');
    await page.evaluate(() => window.changePanel(true));
    await page.getByTestId('scriptor-ai-panel').waitFor();
    for (const language of languages) {
      await page.evaluate(language => window.changeLanguage(language), language);
      await page.locator('[data-language="' + language + '"]').waitFor({ state: 'attached' });
      const expected = await page.evaluate(() => window.expectedCopy());
      assert.deepEqual(await page.locator('.scriptor-ai-quick').allTextContents(), expected.slice(0, 4).map(copy => copy.name));
      const selector = page.getByTestId('scriptor-ai-style');
      assert.ok((await selector.textContent()).includes(expected[0].name));
      await selector.click();
      const choices = page.getByRole('option');
      assert.equal(await choices.count(), expected.length);
      for (const copy of expected) assert.ok((await choices.allTextContents()).some(label => label.includes(copy.name) && label.includes(copy.description)));
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.evaluate(async () => JSON.stringify(await window.nodus.listStudyStyles()) === window.originalStyles), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
