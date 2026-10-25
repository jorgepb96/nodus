import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

const SEARCH_VIEWS = [
  'src/views/ArgumentMapView.tsx',
  'src/views/GraphView.tsx',
  'src/stellarGraph/source.ts',
  'src/views/NotesView.tsx',
  'src/components/nodi/NodiCompanion.tsx',
  'src/views/DeepResearchView.tsx',
  'src/views/ImmersionView.tsx',
  'src/views/ProjectsView.tsx',
  'src/views/RubricsView.tsx',
  'src/components/VaultSwitcher.tsx',
  'src/components/dbGrid.tsx',
  'src/components/ArchiveFilterBar.tsx',
  'src/components/world/WorldFilterBar.tsx',
  'src/views/CollectionsModal.tsx',
  'src/components/world/mapTimeline.tsx',
  'src/views/MapView.tsx',
  'src/components/PersonLinkPicker.tsx',
  'src/views/ManualIdeaEditor.tsx',
  'src/views/NarrationSettings.tsx',
  'src/views/DatabasesView.tsx',
  'src/views/ProvidersSettings.tsx',
];

test('view searches never lowercase nullable payload fields directly', async () => {
  const unsafe = /\.(?:statement|label|title|content|name|personName|displayName|objective|id)\.toLowerCase\(\)/;
  for (const file of SEARCH_VIEWS) {
    const source = await readSource(file);
    assert.doesNotMatch(source, unsafe, `${file} must normalize persisted or imported text before searching it`);
  }
});

test('search result ordering never compares nullable payload fields directly', async () => {
  const unsafe = /\.(?:label|title|name|personName|displayName|provider|updatedAt)\.localeCompare\(/;
  for (const file of SEARCH_VIEWS) {
    const source = await readSource(file);
    assert.doesNotMatch(source, unsafe, `${file} must normalize persisted or imported text before sorting it`);
  }
});
