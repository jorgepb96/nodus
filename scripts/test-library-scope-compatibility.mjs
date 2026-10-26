// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertChannelsWired, readSource } from './ipc-channel-census.mjs';

test('the single Library screen owns explicit global and vault scopes', async () => {
  const [types, navigation, view, library, registry, styles] = await Promise.all([
    readSource('shared/libraryTypes.ts'),
    readSource('src/navigation.ts'),
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/Library.tsx'),
    readSource('src/app/views/corpus.tsx'),
    readSource('src/index.css'),
  ]);
  assert.match(types, /export type LibraryScope = 'global' \| 'vault'/);
  assert.match(navigation, /scope\?: LibraryScope/);
  assert.match(view, /data-testid="library-scope-switcher"/);
  assert.match(view, /data-testid="library-scope-vault"/);
  assert.match(view, /data-testid="library-scope-global"/);
  assert.match(view, /data-scope-placement="content-header"/);
  assert.match(view, /scopeControls=\{scopeControls\}/, 'both library scopes receive the compact switcher in their own header');
  assert.match(library, /library-vault-header[^\n]+library-header-bar[^\n]+min-h-14[^\n]+border-b[^\n]+px-5 py-3/, 'This vault uses the shared Library header geometry');
  assert.match(view, /global-library-header[^\n]+library-header-bar[^\n]+min-h-14[^\n]+border-b[^\n]+px-5 py-3/, 'Global uses the shared Library header geometry');
  assert.match(styles, /\.library-header-bar \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/, 'equal side columns keep the scope selector at the geometric center');
  assert.match(styles, /\.library-header-bar > \.library-scope-switcher \{[\s\S]*?grid-column: 2;[\s\S]*?justify-self: center/, 'the scope selector owns the center column');
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.library-header-bar > \.library-scope-switcher \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;/, 'narrow headers keep the selector centered on its own row');
  assert.match(library, /<Icon name="book" className="text-indigo-400" \/> \{t\('Biblioteca'\)\}/, 'This vault uses the same Library title treatment as Global');
  assert.match(library, /data-testid="library-vault-search"[\s\S]*?input-with-leading-icon w-full/, 'the traditional corpus gives search the full available row');
  assert.match(library, /data-testid="library-vault-filters-toggle"[\s\S]*?aria-controls="library-vault-filters-panel"/, 'secondary filters are grouped behind one accessible control');
  assert.match(library, /filtersOpen && \([\s\S]*?data-testid="library-vault-filters-panel"/, 'the dense filter controls are progressively disclosed');
  assert.match(library, /data-testid="library-collections-menu-toggle"[\s\S]*?data-testid="open-nodus-collections"[\s\S]*?data-testid="open-zotero-collections"/, 'one coherent collections menu exposes both sources');
  assert.match(view, /onOpenNodusCollections=\{\(\) => void chooseScope\('global'\)\}/, 'the Nodus collection selector opens the editable Global hierarchy');
  assert.doesNotMatch(view, /className="library-theme-bar[^"]*min-h-12/, 'scope selection must not consume a separate full-width row');
  assert.match(view, /<Library[\s\S]*target=\{target\}/, 'the vault scope renders the complete traditional Library');
  assert.match(registry, /activeVault[\s\S]*setCollectionsOpen[\s\S]*GlobalLibraryView/);
});

test('v3 upgrades stay in the vault corpus until Global is explicitly enabled', async () => {
  const [types, settings, prefs, view] = await Promise.all([
    readSource('shared/types.ts'),
    readSource('shared/defaultAppSettings.ts'),
    readSource('electron/db/appPrefs.ts'),
    readSource('src/views/GlobalLibraryView.tsx'),
  ]);
  for (const field of ['libraryGlobalEnabled', 'libraryScope', 'libraryScopeOnboardingVersion']) {
    assert.match(types, new RegExp(`${field}:`));
    assert.match(settings, new RegExp(`${field}:`));
    assert.match(prefs, new RegExp(`'${field}'`), `${field} must follow users across vaults`);
  }
  assert.match(settings, /libraryGlobalEnabled: false/);
  assert.match(settings, /libraryScope: 'vault'/);
  assert.match(view, /settings\.libraryGlobalEnabled[^\n]+settings\.autoBackupFolder/);
  assert.match(view, /Activa la Biblioteca global cuando quieras/);
  assert.match(view, /updateSettings\(\{[\s\S]*libraryGlobalEnabled: next === 'global' \? true[\s\S]*libraryScope: next/);
});

test('health navigation always enters the exact traditional corpus filter', async () => {
  const [app, library] = await Promise.all([
    readSource('@shell'),
    readSource('src/views/Library.tsx'),
  ]);
  assert.match(app, /setLibraryTarget\(\{ scope: 'vault', healthBucket, nonce: Date\.now\(\) \}\)/);
  assert.match(library, /setFilter\(target\.healthBucket \? \{ healthBucket: target\.healthBucket \} : \{\}\)/);
});

test('legacy Zotero collections and corpus IPC remain available unchanged', async () => {
  const [app, library] = await Promise.all([readSource('@shell'), readSource('src/views/Library.tsx')]);
  assert.match(app, /label: t\('Colecciones de Zotero'\)/);
  assert.match(library, /t\('Colecciones de Zotero'\)/);
  assertChannelsWired(assert, [
    'works:listPage', 'works:listZoteroTags', 'works:collectionFacets', 'works:rescan',
    'works:processFullBulk', 'works:summarizeBulk', 'embeddings:workStatuses',
    'passages:workStatuses', 'queue:get',
  ]);
});

test('Zotero reader links enter Global without changing ordinary Library defaults', async () => {
  const app = await readSource('@shell');
  assert.match(app, /setLibraryTarget\(\{ scope: 'global', readerItemId: target\.id, nonce: Date\.now\(\) \}\)/);
});
