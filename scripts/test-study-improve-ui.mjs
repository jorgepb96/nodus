import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('pinned prompt stars stay filled across selection, hover, toggles and reopening in both themes', { timeout: 120_000 }, async t => {
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome) { t.skip('An isolated test browser is required'); return; }
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { StudyImproveDialog } from './src/components/editor/StudyImproveDialog';
      import { setActiveLang } from './src/i18n';
      const styles = ['academic', 'clear', 'concise', 'formal', 'custom'].map(id => ({
        id: 'builtin:' + id, name: id, prompt: 'Improve clarity.', description: '', icon: 'sparkles', active: true,
      }));
      let settings = { studyImproveToolbarStyleIds: ['builtin:academic'] };
      window.toolbar = [];
      window.nodus = {
        listStudyStyles: async () => styles,
        getSettings: async () => settings,
        updateSettings: async patch => { settings = { ...settings, ...patch }; return settings; },
      };
      function App() {
        const [open, setOpen] = useState(true);
        return <><button id="reopen" onClick={() => setOpen(true)}>Reopen</button>{open &&
          <StudyImproveDialog onClose={() => setOpen(false)} onToolbarChanged={styles => { window.toolbar = styles.map(style => style.id); }} />}</>;
      }
      setActiveLang('es');
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, outdir: 'out', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  const errors = [];
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<html class="${theme}"><body><div id="root"></div></body></html>`);
      await page.addStyleTag({ content: await readFile(componentStyles(), 'utf8') });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
      const pin = id => page.getByTestId('study-style-toolbar-builtin-' + id);
      const choose = id => page.getByTestId('study-style-builtin-' + id);
      const footer = page.locator('.study-prompts-shortcut-toggle');
      async function expectStar(control, pressed) {
        assert.equal(await control.getAttribute('aria-pressed'), String(pressed));
        const visual = await control.locator('svg polygon').evaluate(el => {
          const style = getComputedStyle(el);
          return { fill: style.fill, stroke: style.stroke };
        });
        assert.equal(visual.fill, pressed ? visual.stroke : 'none', `${theme}: ${pressed ? 'pinned stars are solid' : 'unpinned stars are outlined'}`);
      }
      await pin('academic').waitFor();
      if (process.env.NODUS_PROMPT_STAR_SCREENSHOTS) {
        await mkdir(process.env.NODUS_PROMPT_STAR_SCREENSHOTS, { recursive: true });
        await page.locator('.study-prompts-dialog').screenshot({ path: path.join(process.env.NODUS_PROMPT_STAR_SCREENSHOTS, theme + '.png') });
      }
      await expectStar(pin('academic'), true);
      await expectStar(footer, true);
      await expectStar(pin('clear'), false);
      await choose('clear').click();
      await expectStar(pin('academic'), true); // Pinning is independent of the selected row.
      await expectStar(pin('clear'), false);
      await expectStar(footer, false);
      await pin('academic').hover();
      await expectStar(pin('academic'), true);
      await pin('clear').focus();
      await page.keyboard.press('Space');
      await expectStar(pin('clear'), true);
      await expectStar(footer, true);
      await footer.click();
      await expectStar(pin('clear'), false);
      await expectStar(footer, false);
      for (const id of ['clear', 'concise', 'formal']) await pin(id).click();
      await pin('custom').click();
      await page.getByRole('status').getByText('Puedes mostrar un máximo de cuatro prompts en la barra.').waitFor();
      await expectStar(pin('custom'), false);
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await page.locator('#reopen').click();
      await pin('academic').waitFor();
      for (const id of ['academic', 'clear', 'concise', 'formal']) await expectStar(pin(id), true);
      await expectStar(pin('custom'), false);
      assert.deepEqual(await page.evaluate(async () => ({ saved: (await window.nodus.getSettings()).studyImproveToolbarStyleIds, toolbar: window.toolbar })), {
        saved: ['builtin:academic', 'builtin:clear', 'builtin:concise', 'builtin:formal'],
        toolbar: ['builtin:academic', 'builtin:clear', 'builtin:concise', 'builtin:formal'],
      });
      await page.close();
    }
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('study improvement previews the selection and commits it to the editor history', async () => {
  const [editor, dialog, stylesheet] = await Promise.all([
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/editor/StudyImproveDialog.tsx'),
    read('src/index.css'),
  ]);
  assert.match(editor, /testId: 'study-improve-toggle'/);
  assert.match(editor, /resolveImproveSelection/);
  assert.match(editor, /createPortal/);
  assert.match(editor, /selectionToolbar/);
  assert.match(editor, /data-testid="study-selection-tools-divider"/);
  assert.match(editor, /data-testid="study-selection-text-color"/);
  assert.match(editor, /data-testid="study-selection-heading"/);
  assert.doesNotMatch(editor, /data-testid="study-improve-selection-toolbar"/);
  assert.match(editor, /data-testid=\{`study-quick-improve-/);
  assert.match(editor, /runQuickImprovement/);
  assert.match(editor, /requestAnimationFrame\(flush\)/);
  assert.match(editor, /addToHistory: commitToHistory/);
  assert.match(editor, /if \(improveCancelled\.current\) return;/);
  assert.match(editor, /replaceImprovedSelection\(base, target, result\.text, true\)/);
  assert.match(editor, /closeHistory: commitToHistory/);
  assert.match(editor, /data-testid="study-improve-streaming"/);
  assert.match(editor, /testId: 'study-editor-undo'/);
  assert.match(editor, /testId: 'study-editor-redo'/);
  assert.match(editor, /data-testid="study-synonyms-toggle"/);
  assert.match(editor, /name="aiSynonyms"/);
  assert.doesNotMatch(stylesheet, /\.study-milkdown \.milkdown-toolbar \.study-synonyms-trigger\s*\{[^}]*\b(?:border|background)\s*:/, 'the idle synonyms action must not have persistent framed styling');
  assert.match(editor, /studyStyleIcon/);
  assert.doesNotMatch(editor, /style\.icon\s*\|\|\s*['"]✦|fontSize:\s*size/);
  assert.match(editor, /data-testid="study-synonyms-panel"/);
  assert.match(editor, /study-synonyms-option/);
  assert.match(editor, /data-testid="study-synonyms-regenerate"/);
  assert.match(editor, /Historial de esta apertura/);
  assert.match(editor, /previousAlternatives/);
  assert.match(editor, /studySentenceContext/);
  assert.match(editor, /suggestStudySynonyms/);
  assert.match(editor, /study-improve-undo[^]*runEditorHistory\('undo'\)/);
  assert.doesNotMatch(editor, /improveUndo|undoImprovement/);
  assert.doesNotMatch(editor, /event\.key\.toLowerCase\(\) === 'z'/);
  assert.match(editor, /El original permanece intacto/);
  assert.doesNotMatch(dialog, /Transformación libre/);
  assert.doesNotMatch(dialog, /Conservar significado/);
});

test('the compact prompt manager creates prompts and limits the toolbar to four', async () => {
  const dialog = await read('src/components/editor/StudyImproveDialog.tsx');
  assert.match(dialog, /const TOOLBAR_LIMIT = 4/);
  assert.match(dialog, /studyImproveToolbarStyleIds/);
  assert.match(dialog, /createStudyStyle/);
  assert.match(dialog, /validateStudyStylePrompt/);
  assert.match(dialog, /study-style-editor/);
  assert.match(dialog, /study-prompt-title/);
  assert.match(dialog, /study-prompt-text/);
  assert.match(dialog, /IconEmojiPicker/);
  assert.match(dialog, /allowEmoji=\{false\}/);
  assert.match(dialog, /studyStyleIcon/);
  assert.match(dialog, /selected\.description/);
  assert.match(dialog, /máximo de cuatro prompts/);
  assert.doesNotMatch(dialog, /diffWordsWithSpace/);
  assert.doesNotMatch(dialog, /duplicateStudyStyle|archiveStudyStyle|importStudyStyles|exportStudyStyles/);
});

test('only user prompts can be edited or deleted, and deleting asks first', async () => {
  const [dialog, repo] = await Promise.all([
    read('src/components/editor/StudyImproveDialog.tsx'),
    read('electron/db/studyStylesRepo.ts'),
  ]);
  // Controls stay visible, but presets remain read-only.
  for (const action of ['edit', 'delete']) {
    assert.match(dialog, new RegExp(`data-testid="study-prompt-${action}"[^>]*disabled=\\{busy \\|\\| selected\\.builtIn\\}`));
  }
  assert.match(dialog, /data-testid="study-prompt-edit"/);
  assert.match(dialog, /data-testid="study-prompt-delete"/);
  assert.match(dialog, /updateStudyStyle\(editing\.id/);
  // Deleting goes through the confirmation modal, never straight from the button.
  assert.match(dialog, /setPendingDeletion\(selected\)/);
  assert.match(dialog, /<ConfirmModal[^]*danger[^]*onConfirm=\{\(\) => void deletePrompt\(pendingDeletion\)\}/);
  assert.doesNotMatch(dialog, /onClick=\{\(\) => void deletePrompt\(selected\)\}/);
  // A deleted prompt cannot stay pinned to the writing toolbar.
  assert.match(dialog, /deleteStudyStyle\(style\.id\)[^]*studyImproveToolbarStyleIds: nextIds/);
  // The presets are the app's own, so the repository refuses to touch them at all.
  assert.match(repo, /if \(current\.builtIn\) throw new Error\('Los estilos predefinidos se duplican antes de editarlos\.'\)/);
  assert.match(repo, /export function deleteStudyStyle[^]*current\.builtIn[^]*Solo se pueden eliminar estilos personalizados/);
  // Editing must not be a way around the prompt guard that creation enforces.
  assert.match(repo, /export function updateStudyStyle[^]*validateStudyStylePrompt[^]*sustituir las reglas/);
});
