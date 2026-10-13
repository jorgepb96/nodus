import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('the 2.4.0 update queues a one-off toolkit guide behind release notes', async () => {
  const [guide, app] = await Promise.all([read('src/components/ToolkitBetaGuide.tsx'), read('src/App.tsx')]);
  assert.match(guide, /TOOLKIT_BETA_GUIDE_RELEASE = '2\.4\.0'/);
  assert.match(guide, /TOOLKIT_BETA_GUIDE_TUTORIAL_VERSION = 4/);
  assert.match(guide, /nodus\.toolkitBetaGuideSeen/);
  assert.match(guide, /previousTutorialVersion <= 0/);
  assert.match(guide, /previousTutorialVersion >= TOOLKIT_BETA_GUIDE_TUTORIAL_VERSION/);
  assert.match(app, /<ToolkitBetaUpdateTour/);
  assert.match(app, /previousTutorialVersion=\{settings\.basicsTutorialVersion\}/);
  assert.match(app, /whatsNewSettled && pdfPresenterTutorialSettled && mobileTeaserSettled && platformHighlightsSettled && !toolkitBetaTourSettled/);
  assert.match(app, /whatsNewSettled && pdfPresenterTutorialSettled && mobileTeaserSettled && platformHighlightsSettled && toolkitBetaTourSettled/);
  assert.ok(app.indexOf('<WhatsNewModal') < app.indexOf('<ToolkitBetaUpdateTour'));
  assert.ok(app.indexOf('<ToolkitBetaUpdateTour') < app.indexOf('<NodiStyleModal'));
});

test('the guide covers all five tools, extraction choices, performance and subscriptions', async () => {
  const guide = await read('src/components/ToolkitBetaGuide.tsx');
  const navigation = await read('src/navigation.ts');
  for (const tool of ['Nodus Convert', 'Nodus Protect', 'Nodus Translate', 'Nodus Presenter', 'OCR Workspace']) assert.ok(navigation.includes(tool));
  for (const expected of [
    'Gemma 4 E2B Q4',
    '20 ejecuciones correctas de 20',
    'IBM Granite 4.0 Micro Q4',
    '1.800 palabras',
    'Gemini 2.5 Flash-Lite',
    'Gemini 3.1 Flash-Lite',
    'DeepSeek V4 Flash',
    'MiMo 2.5',
    'Codex App Server',
    'GitHub Copilot',
    'OpenCode Go',
    'Anthropic prohíbe que terceros',
  ]) assert.ok(guide.includes(expected), `missing guide copy: ${expected}`);
  for (const asset of ['openai.svg', 'github-copilot.svg', 'opencode.svg', 'claude.svg']) {
    assert.match(guide, new RegExp(asset.replace('.', '\\.')));
    assert.match(await read(`src/assets/brands/${asset}`), /<svg/);
  }
  assert.match(guide, /\.\.\.BETA_TOOLS\.map/, 'the versioned guide cannot index newer catalogue entries');
  assert.match(guide, /BETA · \{index \+ 1\} \/ \{BETA_TOOLS\.length\}/);
  assert.match(guide, /data-testid="toolkit-beta-update-tour"/);
  assert.match(guide, /data-testid="toolkit-beta-tour-complete"/);
  assert.match(guide, /disabled=\{itemIndex > index\}/);
});
