import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('academic Library walkthrough is opt-in; other Auto libraries retain one-time guidance', async () => {
  const [modal, shell, library] = await Promise.all([
    read('src/components/LibraryTutorialModal.tsx'),
    read('src/views/GlobalLibraryView.tsx'),
    read('src/views/Library.tsx'),
  ]);

  // Seen once is seen for good, and the flag is written on presentation rather than
  // on dismissal so closing the window does not queue the same greeting again.
  assert.match(modal, /LIBRARY_TUTORIAL_SEEN_KEY = 'nodus\.libraryTutorialSeen\.v1'/);
  assert.match(modal, /localStorage\.setItem\(LIBRARY_TUTORIAL_SEEN_KEY, '1'\)/);
  assert.match(modal, /catch \{ return true; \}/, 'unavailable storage must not reopen the guide forever');
  assert.match(shell, /useState\(\(\) => vaultType !== 'academic' && settings\.academicMode !== 'manual' && !libraryTutorialSeen\(\)\)/);
  assert.match(shell, /if \(autoPresented\.current\) markLibraryTutorialSeen\(\);/);
  assert.match(shell, /<LibraryTutorialModal/);

  // The «?» lives beside Colecciones and Ficha documental, and ignores the flag.
  assert.match(library, /data-testid="library-open-tutorial"[\s\S]*?onClick=\{academicMode === 'manual' \? \(\) => toast\([\s\S]*?: onOpenTutorial\}/);
  assert.match(library, /data-testid="library-open-tutorial"[\s\S]*?<Icon name="help"/);
  // Glyph-only among labelled buttons, so it wears the vault's accent to be findable.
  assert.match(library, /data-testid="library-open-tutorial"[\s\S]*?'--library-help-accent'[^\n]*vaultTypeColor\(vaultType\)/);
  assert.match(library, /import \{ vaultTypeColor \} from '@shared\/vaultTypes';/);
  assert.match(shell, /onOpenTutorial=\{\(\) => openTutorial\('analysis'\)\}/);
});

test('the guide has two tabs: the vault pipeline and the standalone manager', async () => {
  const modal = await read('src/components/LibraryTutorialModal.tsx');
  // The strip is generated, so the ids live in the tab table, not as literals.
  assert.match(modal, /data-testid=\{`library-tutorial-tab-\$\{entry\.key\}`\}/);
  // The tabs borrow the scope switcher's own names so the guide and the interface
  // speak one vocabulary: «Este vault» and «Global».
  assert.match(modal, /key: 'analysis', icon: 'compass', label: t\('Este vault'\)/);
  assert.match(modal, /key: 'manager', icon: 'library', label: t\('Global'\)/);
  assert.match(modal, /data-testid="library-tutorial-panel-analysis"/);
  assert.match(modal, /data-testid="library-tutorial-panel-manager"/);
  assert.match(modal, /role="tablist"/);
  assert.match(modal, /aria-selected=\{tab === entry\.key\}/);
  assert.match(modal, /role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(modal, /event\.key === 'Escape'/);
  // Cinematic shell, shared with the other guides so light mode is already solved.
  assert.match(modal, /toolkit-guide-backdrop/);
  assert.match(modal, /toolkit-guide-cinema library-tutorial-cinema/);
});

test('the first tab walks the collections → monitor → process route', async () => {
  const modal = await read('src/components/LibraryTutorialModal.tsx');
  for (const key of [
    'Abre «Colecciones»',
    'Colecciones de Nodus',
    'Colecciones de Zotero',
    'Recomendado',
    'En Zotero, pulsa «Monitorizar» en cada colección que quieras traer.',
    'Analizar las seleccionadas',
    'Procesar biblioteca',
    'Para qué sirve la «Ficha documental»',
  ]) assert.ok(modal.includes(key), `missing guide copy: ${key}`);
  // Whole-document understanding is beta wherever it is named.
  assert.match(modal, /title=\{t\('Para qué sirve la «Ficha documental»'\)\} badge="BETA"/);
  assert.ok(modal.includes('Está en beta: en documentos muy largos puede tardar bastante'));
  // Nodus Library is beta on both sides of the fork.
  assert.match(modal, /badge="BETA" badgeTone="beta"/);
  assert.match(modal, /badge=\{t\('Recomendado'\)\} badgeTone="recommended"/);
});

test('the second tab presents the reference manager as beta, with Word and Chrome', async () => {
  const modal = await read('src/components/LibraryTutorialModal.tsx');
  assert.match(modal, /data-testid="library-tutorial-beta-notice"/);
  assert.ok(modal.includes('Esta función está en beta: puede tener errores o comportamientos inesperados.'));
  for (const key of ['Importar desde Zotero', 'Añadir a mano', 'Organizar y citar']) {
    assert.ok(modal.includes(key), `missing manager copy: ${key}`);
  }
  for (const asset of ['microsoft-word.svg', 'chrome-web-store.svg']) {
    assert.match(modal, new RegExp(asset.replace('.', '\\.')));
    assert.match(await read(`src/assets/brands/${asset}`), /<svg/);
  }
  assert.match(modal, /data-testid="library-tutorial-word"/);
  assert.match(modal, /data-testid="library-tutorial-chrome"/);
});

test('the two library sources carry the same badges in the guide, the menu and the wizard', async () => {
  const [library, onboarding] = await Promise.all([read('src/views/Library.tsx'), read('src/views/Onboarding.tsx')]);
  assert.match(library, /data-testid="nodus-collections-beta"[^>]*>BETA</);
  assert.match(library, /data-testid="document-index-beta"[^>]*>BETA</);
  assert.match(library, /data-testid="zotero-collections-recommended"[^>]*>\{t\('Recomendado'\)\}</);
  assert.match(onboarding, /data-testid="onboarding-library-nodus-beta"[^>]*>BETA</);
  assert.match(onboarding, /data-testid="onboarding-library-zotero-recommended"/);
});

test('every guide string is translated into every interface language', async () => {
  const [modal, table] = await Promise.all([
    read('src/components/LibraryTutorialModal.tsx'),
    read('src/i18n.libraryTutorial.ts'),
  ]);
  // Keys the guide introduces must live in this table; keys it borrows from the rest
  // of the interface must NOT be redeclared here, or one of the two copies goes stale.
  const asked = [...modal.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map((match) => match[1]);
  assert.ok(asked.length > 25, `the guide looked wrong (${asked.length} keys parsed)`);
  const declared = new Set([...table.matchAll(/^ {2}'((?:[^'\\]|\\.)*)':/gm)].map((match) => match[1]));
  const borrowed = new Set(['Colecciones de Nodus', 'Colecciones de Zotero', 'Recomendado', 'Colecciones', 'Monitorizar', 'Procesar biblioteca', 'Importar desde Zotero', 'Cerrar', 'Empezar', 'Este vault', 'Global']);
  const researchFile = await read('src/i18n.researchNotebooks.ts');
  const research = JSON.parse(researchFile.slice(researchFile.indexOf('{'), researchFile.lastIndexOf('}') + 1));
  for (const key of asked) {
    if (declared.has(key) || borrowed.has(key)) continue;
    for (const [language, translations] of Object.entries(research)) assert.ok(translations[key], `untranslated guide string (${language}): ${key}`);
  }
  for (const lang of ['en', 'fr', 'de', 'pt', "'pt-BR'", 'it', 'tr', "'zh-CN'", "'zh-TW'"]) {
    assert.ok(table.includes(`${lang}: `) || table.includes(`const ${lang} =`), `missing language: ${lang}`);
  }
  const exported = /export const LIBRARY_TUTORIAL_TRANSLATIONS = \{([\s\S]*?)\}/.exec(table);
  assert.ok(exported, 'the tutorial catalogue is exported as one object');
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW']) {
    assert.ok(exported[1].includes(`'${language}'`) || new RegExp(`\\b${language.replace('-', '\\-')}\\b`).test(exported[1]), `the exported catalogue omits ${language}`);
  }
});
