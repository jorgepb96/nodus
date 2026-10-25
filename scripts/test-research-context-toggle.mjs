import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'nodus-context-toggle-'));
const bundle = path.join(tmp, 'layers.cjs');
buildSync({ entryPoints: ['shared/researchContextLayers.ts'], outfile: bundle, bundle: true, format: 'cjs', platform: 'node' });
const { toggleResearchContext, withResearchContextLayers, researchContextLayers, researchContextWeb } = createRequire(import.meta.url)(bundle);
rmSync(tmp, { recursive: true, force: true });
const base = {
  ideas: true, themes: false, contradictions: true, gaps: false, readingPath: false, authors: false,
  documents: false, passages: true, graph: false,
  graphParts: { ideaNodes: true, themeNodes: false, ideaEdges: false, authorGraph: false },
  sourceFilter: { enabled: true, authorIds: ['author-1'], workIds: ['work-1'] }, notebookId: 'notebook-1',
  layers: { ideas: true, documents: false, indexed: true, web: false },
};

test('pausing disables every layer and section, restores a partial selection exactly, and does not mutate it', () => {
  const original = structuredClone(base);
  const paused = toggleResearchContext(base, true);
  assert.deepEqual(researchContextLayers(paused, true), { ideas: false, documents: false, indexed: false });
  assert.equal(researchContextWeb(paused, true), false);
  for (const key of ['ideas', 'themes', 'contradictions', 'gaps', 'readingPath', 'authors', 'documents', 'passages', 'graph']) assert.equal(paused[key], false, key);
  assert.ok(Object.values(paused.graphParts).every(value => !value));
  assert.deepEqual(toggleResearchContext(paused, true), base);
  assert.deepEqual(base, original);
  assert.deepEqual(toggleResearchContext(toggleResearchContext(paused, true), true), paused, 'repeated cycles do not nest snapshots');
});

test('the remembered selection survives serialization, keeping web on or off independently of preferences', () => {
  for (const web of [false, true]) {
    const selection = { ...base, layers: { ...base.layers, web } };
    const paused = JSON.parse(JSON.stringify(toggleResearchContext(selection, !web)));
    assert.equal(researchContextWeb(paused, true), false);
    assert.deepEqual(toggleResearchContext(paused, !web), selection);
  }
});

test('legacy academic selections remember implicit full documents and the inherited web choice', () => {
  const { layers: _layers, ...legacy } = base;
  const paused = toggleResearchContext(legacy, true, true);
  const restored = toggleResearchContext(paused, false, true);
  assert.deepEqual(researchContextLayers(restored, true), { ideas: true, documents: true, indexed: true });
  assert.equal(researchContextWeb(restored, false), true);
  assert.equal(restored.themes, false, 'individual legacy section choices are preserved');
});

test('manual layer changes leave the pause, and an empty selection never enables all layers', () => {
  const paused = toggleResearchContext(base, false);
  const manual = withResearchContextLayers(paused, { ideas: false, documents: false, indexed: true, web: false });
  assert.equal(manual.contextBeforePause, undefined);
  const empty = withResearchContextLayers(base, { ideas: false, documents: false, indexed: false, web: false });
  assert.equal(toggleResearchContext(empty, true), empty);
});
