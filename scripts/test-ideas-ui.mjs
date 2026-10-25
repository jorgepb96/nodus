import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('Ideas opens as a library-style metadata catalogue', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  for (const marker of ['ideas-workspace', 'ideas-table-scroll', 'ideas-catalog-table', 'ideas-search']) {
    assert.match(view, new RegExp(marker));
  }
  for (const field of ['Idea', 'Tipo', 'Nº de obras', 'Nº de conexiones', 'Confianza', 'Temas']) {
    assert.match(view, new RegExp(field), `catalogue shows ${field}`);
  }
  for (const metadata of ['node.statement', 'node.workCount', 'node.connectionCount', 'node.maxConfidence', 'node.themes']) {
    assert.match(view, new RegExp(metadata.replace('.', '\\.')), `${metadata} is visible in the catalogue`);
  }
});

test('idea type markers stay circular beside long labels', async () => {
  const ui = await readSource('src/components/ui.tsx');
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(
    ui,
    /function TypeDot[\s\S]*className="[^"]*h-2\.5[^"]*w-2\.5[^"]*shrink-0[^"]*rounded-full"/,
    'the flex row must not squeeze a type dot into an oval',
  );
  assert.match(
    view,
    /className="flex min-w-0 items-center gap-2 pr-5">\s*<TypeDot type=\{node\.type\}/,
    'the type dot must stay vertically centered against the complete idea row',
  );
});

test('idea rows keep the same breathing room as the argument catalogue', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(
    view,
    /data-anchor-id=\{node\.id\}[\s\S]{0,220}min-h-\[88px\][^\"]*px-4 py-3/,
    'each idea row keeps a visible vertical inset around its title and statement',
  );
  assert.match(view, /className="mt-1 block line-clamp-2 text-\[11px\] leading-relaxed[^\"]*">\{node\.statement\}/);
});

test('Ideas catalogue can be searched, filtered and sorted', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /data-testid="ideas-filters-toggle"/);
  assert.match(view, /data-testid="ideas-type-filter"/);
  assert.match(view, /data-testid="ideas-sort"/);
  for (const sort of ['label', 'type', 'works', 'connections', 'confidence']) {
    assert.match(view, new RegExp(`sort="${sort}"|value="${sort}"`), `catalogue supports ${sort} sorting`);
  }
  assert.match(view, /data-testid="ideas-filters-panel"[\s\S]{0,160}role="dialog"/, 'the filters open as a balloon instead of an inline strip');
  assert.match(view, /group: 'ideas-filter-balloon'/, 'the filter balloon closes on outside click and Escape');
});

test('clicking ideas opens independent persistent detail tabs', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /setOpenIdeas\(\(current\) => \([\s\S]*current\.some\(\(open\) => open\.id === idea\.id\)[\s\S]*\[\.\.\.current, idea\][\s\S]*setActiveIdeaId\(idea\.id\);[\s\S]*setSurface\('idea'\)/, 'a new idea gets its own tab and an existing one is focused');
  assert.match(view, /data-testid="ideas-tab-catalog"/);
  assert.match(view, /data-testid="ideas-tab-idea"/);
  assert.match(view, /openIdeas\.map\(\(idea\) =>/, 'all open idea details remain mounted');
  assert.match(view, /surface === 'catalog' \? 'flex h-full min-h-0 flex-col' : 'hidden'/, 'catalogue stays mounted behind the detail tab');
  assert.match(view, /surface === 'idea' && activeIdeaId === idea\.id \? 'h-full' : 'hidden'/, 'each idea detail is rendered as its own workspace tab');
});

test('idea detail keeps evidence, works and expandable connected ideas', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /detail\.occurrences\.map/);
  assert.match(view, /detail\.evidence\.map/);
  assert.match(view, /data-testid="idea-connections"/);
  assert.match(view, /<ConnectedIdeaRow/);
  assert.match(view, /aria-expanded=\{open\}/, 'connected ideas remain expandable inline');
});

test('Ideas catalogue and detail explicitly support light and dark themes', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  assert.match(view, /bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100/);
  assert.match(view, /border-neutral-200[^\n]*dark:border-neutral-800/);
  assert.match(view, /hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900\/55/);
  assert.match(view, /border-indigo-100 bg-indigo-50\/80[^\n]*dark:border-neutral-800 dark:bg-neutral-900\/35/);
});

test('academic, generic, study and teaching idea routes share the academic Ideas surface', async () => {
  const corpus = await readSource('src/app/views/corpus.tsx');
  const studyRegistry = await readSource('src/app/views/study.tsx');
  const study = await readSource('src/views/StudyIdeasView.tsx');
  assert.match(corpus, /ideas:[\s\S]*<IdeasView/);
  assert.match(studyRegistry, /studyIdeas:[\s\S]*<StudyIdeasView/);
  assert.match(study, /import \{ IdeasView \} from '\.\/IdeasView'/);
  assert.match(study, /return <IdeasView/);
  assert.doesNotMatch(study, /if \(!workspace\.subjects\.length\) return/, 'an empty study or teaching vault must not replace the catalogue with a bespoke empty screen');
});

test('study and teaching preserve the academic catalogue when there are no subjects', async () => {
  const study = await readSource('src/views/StudyIdeasView.tsx');
  const source = await readSource('src/views/studyKnowledgeViewSource.ts');
  assert.match(study, /emptyMessage=\{!hasSubjects/);
  assert.match(study, /disabled=\{!hasSubjects\}/);
  assert.match(study, /<option value="">\{t\('Asignatura'\)\}<\/option>/);
  assert.match(source, /if \(!subjectId\) return \{ items: \[\], total: 0/);
});
