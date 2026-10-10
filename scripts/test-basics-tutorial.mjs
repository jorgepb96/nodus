import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (file) => readSource(file);

test('essential tutorial is global, seen-once, skippable with confirmation and replayable', async () => {
  const [tutorial, app, types, defaults, prefs, settings, modal] = await Promise.all([
    read('src/views/BasicsTutorial.tsx'),
    read('src/App.tsx'),
    read('@api'),
    read('shared/defaultAppSettings.ts'),
    read('electron/db/appPrefs.ts'),
    read('src/views/Settings.tsx'),
    read('src/components/ConfirmModal.tsx'),
  ]);

  assert.match(types, /basicsTutorialVersion: number/);
  assert.match(defaults, /basicsTutorialVersion: 0/);
  assert.match(prefs, /'basicsTutorialVersion'/);
  assert.match(tutorial, /BASICS_TUTORIAL_VERSION = PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION/);
  assert.match(tutorial, /ModelGuidanceSlides/);
  assert.match(tutorial, /platformHighlightSlides/);
  assert.match(tutorial, /IdeaExtractionPanel/);
  assert.match(tutorial, /LocalPerformancePanel/);
  assert.match(tutorial, /SubscriptionAccessPanel/);
  const startup = await read('src/app/StartupGate.tsx');
  assert.match(startup, /settings\.basicsTutorialVersion === 0/);
  assert.doesNotMatch(startup, /settings\.basicsTutorialVersion < BASICS_TUTORIAL_VERSION/);
  assert.match(startup, /preferencesForTutorialLanguage\(language\)/);
  assert.match(startup, /updateSettings\(\{ basicsTutorialVersion: BASICS_TUTORIAL_VERSION \}\)/);
  assert.match(settings, /Guía esencial de Nodus e IA/);
  assert.match(settings, /patch\(\{ basicsTutorialVersion: 0 \}\)/);
  assert.match(tutorial, /ConfirmModal zIndex=\{220\}/);
  assert.match(tutorial, /onLanguageChosen\(code\)/);
  assert.match(tutorial, /Esta guía explica los espacios de trabajo/);
  assert.match(modal, /zIndex = 120/);
  const css = await read('src/index.css');
  assert.match(css, /\.tutorial-cinema\.tutorial-language-screen/);
  assert.match(css, /place-items: center/);
  assert.match(css, /\.tutorial-language-option/);
  assert.match(css, /\.tutorial-language-card > \.nodi-svg,\s*\.tutorial-language-card > \.nodi-orb\s*\{[^}]*margin-inline: auto/s, 'classic and orbital Nodi are both centred on the language screen');
  assert.match(css, /\.tutorial-language-grid \{[^}]*flex-wrap: wrap;[^}]*justify-content: center/s, 'a short last row of languages stays centred');
  assert.match(css, /\.tutorial-language-grid > \.tutorial-language-option \{ flex: 0 0 145px; \}/);
  assert.match(css, /height: 3\.5rem/);
  assert.match(css, /width: 100%/);
  assert.match(css, /var\(--tutorial-flag\)/);
  assert.match(css, /text-shadow/);
  assert.match(settings, /label: 'Tutoriales', icon: 'graduation'/);
  assert.match(settings, /label: 'Backup \/ copia de seguridad', icon: 'download'/);
});

test('essential tutorial teaches the complete novice AI and Nodus foundation in both languages', async () => {
  const tutorial = await read('src/views/BasicsTutorial.tsx');
  for (const concept of [
    '¿Qué es una bóveda?',
    'Modelos que funcionan en tu equipo',
    'Cómo conectar un proveedor',
    'OpenRouter',
    'Groq',
    'Cerebras',
    'Gemini 3.1 Flash-Lite',
    'DeepSeek V4 Flash',
    'MiMo 2.5',
    'Encontrar ideas relacionadas',
    'BGE-M3 Q8_0',
    'text-embedding-3-small',
    'Pasar audio a texto',
    'Escuchar documentos',
    'Crear y comprender imágenes',
    'La generación suele utilizar un servicio externo y puede tener coste',
    'Gracias por usar Nodus',
  ]) assert.match(tutorial, new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(tutorial, /Esta representación se llama embedding/);
  assert.match(tutorial, /tendrás que volver a procesar tus materiales/);
  assert.match(tutorial, /Los modelos más grandes necesitan más memoria/);
  assert.match(tutorial, /function EnglishSlides\(\): Slide\[\]/);
  assert.match(tutorial, /What is an API key\?/);
  assert.match(tutorial, /If you change the embedding provider or model, old vectors are unusable/);
  const spanish = tutorial.slice(tutorial.indexOf('function SpanishSlides'), tutorial.indexOf('function EnglishSlides'));
  const english = tutorial.slice(tutorial.indexOf('function EnglishSlides'), tutorial.indexOf('const COMPACT_SLIDES'));
  assert.match(english, /Create and understand images/);
  assert.equal((spanish.match(/nodi:/g) ?? []).length, 13, 'Spanish guide keeps thirteen core slides plus the shared supplements');
  assert.equal((english.match(/nodi:/g) ?? []).length, 13, 'English guide keeps thirteen core slides plus the shared supplements');
  assert.doesNotMatch(spanish, /local-first|VRAM|cuantizaci[oó]n|inferencia|Speech-to-text|Text-to-speech/);
  for (const language of ['fr', 'tr', 'de', 'it', 'pt', 'zh', 'ja', 'ru', 'uk']) assert.match(tutorial, new RegExp(`${language}: \\[`));
  assert.match(tutorial, /'pt-BR': \[/);
  for (const code of ['es', 'en', 'fr', 'tr', 'de', 'it', 'pt', 'pt-BR', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'uk']) {
    assert.match(tutorial, new RegExp(`code: '${code}'`));
  }
  for (const label of ['Português do Brasil', '简体中文', '繁體中文', '日本語', '한국어', 'Русский', 'Українська']) assert.match(tutorial, new RegExp(label));
  for (const nodiTitle of ['Conoce a Nodi', 'Meet Nodi', 'Découvrez Nodi', 'Nodi ile tanışın', 'Lernen Sie Nodi kennen', 'Conosci Nodi', 'Conheça o Nodi', '认识 Nodi', '認識 Nodi', 'Nodiを紹介します', 'Nodi를 소개합니다', 'Познакомьтесь с Nodi', 'Познайомтеся з Nodi']) {
    assert.match(tutorial, new RegExp(nodiTitle));
  }
  assert.match(tutorial, /data-testid="basics-tutorial-language"/);
  assert.match(tutorial, /<h1 id="tutorial-language-title">Choose the language for the tutorial<\/h1>/);
  assert.doesNotMatch(tutorial, /Elige el idioma del tutorial/);
  assert.match(tutorial, /tutorial-language-brand/);
  assert.match(tutorial, /linear-gradient\(#009c3b, #009c3b\)/);
  assert.match(tutorial, /linear-gradient\(#f4f4f4, #f4f4f4\)/);
  assert.match(tutorial, /index === 2 \? 'thinking'/, 'slide 3 receives the former slide 4 thinking animation');
  assert.match(tutorial, /index >= 3 \? 'idle'/, 'Nodi remains standing from slide 4 onward');
  assert.match(tutorial, /last \? 'celebrating'/, 'the final slide keeps the joyful jumps');
  assert.match(tutorial, /setNodiTutorialVisible\(true\)/);
  assert.match(tutorial, /setNodiTutorialVisible\(false\)/);
  assert.match(tutorial, /'celebrating'/);
  assert.match(tutorial, /motionProfiles = \[/);

  const [mascot, ipc, preload, types] = await Promise.all([
    read('electron/mascotWindow.ts'), read('@main'), read('@bridge'), read('@api'),
  ]);
  assert.match(mascot, /tutorialVisible/);
  assert.match(mascot, /mascotWindow\.hide\(\)/);
  assert.match(mascot, /setMascotTutorialVisible/);
  assert.match(ipc, /nodi:tutorialVisible/);
  assert.match(preload, /setNodiTutorialVisible/);
  assert.match(types, /setNodiTutorialVisible\(visible: boolean\)/);
});

test('study analysis exposes chat, review and the question bank without obsolete locked routes', async () => {
  const [app, navigation] = await Promise.all([read('src/App.tsx'), read('src/navigation.ts')]);
  assert.match(navigation, /id: 'studyQuestions'/);
  assert.match(navigation, /id: 'studyChat'/);
  assert.match(navigation, /id: 'studyReview'/);
  for (const removed of ['studyTests', 'studyExams', 'studyProgress', 'studyPlanner']) {
    assert.doesNotMatch(navigation, new RegExp(removed));
  }
  assert.doesNotMatch(app, /LOCKED_STUDY_VIEWS/);
  // Every grouped section is a plain nav button — no route is filtered out,
  // locked or expanded into a second level of navigation.
  assert.match(app, /group\.items\.map\(\(n\) => navButton\(n\)\)/);
  assert.doesNotMatch(app, /toolkitSubNav/);
});

test('every tutorial language gets a complete, renderable deck in its own language', async () => {
  const [tutorial, ui, guidance, vaultTypes] = await Promise.all([
    read('src/views/BasicsTutorial.tsx'),
    read('src/components/ui.tsx'),
    read('src/components/modelGuidanceCopy.ts'),
    read('shared/vaultTypes.ts'),
  ]);
  const iconBlock = ui.slice(ui.indexOf('const ICON_PATHS'), ui.indexOf('export const ICON_NAMES'));
  const icons = new Set([...iconBlock.matchAll(/^\s{2}([A-Za-z0-9]+):/gm)].map((match) => match[1]));
  // An icon name the table does not know renders nothing, silently: the Korean deck
  // once shipped with its icon names translated.
  for (const [, icon] of tutorial.matchAll(/icon: '([^']+)'/g)) assert.ok(icons.has(icon), `icon '${icon}' exists`);

  // The three model-guidance slides used to fall back to English mid-deck.
  const compact = tutorial.slice(tutorial.indexOf('const COMPACT_SLIDES'), tutorial.indexOf('function CompactSlides'));
  const compactLanguages = [...compact.matchAll(/^ {2}'?([a-zA-Z-]+)'?: \[/gm)].map((match) => match[1]);
  assert.ok(compactLanguages.length >= 13);
  for (const language of compactLanguages) {
    assert.match(guidance, new RegExp(`^ {2}'?${language}'?: `, 'm'), `${language} translates the model-guidance slides`);
    const block = compact.slice(compact.search(new RegExp(`^ {2}'?${language}'?: \\[`, 'm')));
    assert.equal((block.slice(0, block.indexOf('\n  ],')).match(/eyebrow:/g) ?? []).length, 13, `${language} keeps thirteen core slides`);
  }

  // The vault slide names every type a new vault can be created as, in both full decks.
  const available = [...vaultTypes.matchAll(/id: '([a-z_]+)',\s*available: (true|PRIMARY_SOURCES_RELEASE_ENABLED)/g)].map((match) => match[1]);
  assert.equal(available.length, 9);
  const spanish = tutorial.slice(tutorial.indexOf('function SpanishSlides'), tutorial.indexOf('function EnglishSlides'));
  const english = tutorial.slice(tutorial.indexOf('function EnglishSlides'), tutorial.indexOf('const COMPACT_SLIDES'));
  assert.equal((spanish.match(/tutorial-vault-grid">[\s\S]*?<\/div><p>/)[0].match(/<b>/g) ?? []).length, available.length);
  assert.equal((english.match(/tutorial-vault-grid">[\s\S]*?<\/div><p>/)[0].match(/<b>/g) ?? []).length, available.length);
  assert.doesNotMatch(tutorial, /Llegará en una versión futura|coming in a future version/);
});
