import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('citation lookup uses two bounded local queries and resolves details only for selected sources', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-citation-search-'));
  try {
    const file = path.join(directory, 'sources.mjs');
    await build({ entryPoints: ['src/components/editor/academicSources.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm' });
    const { desktopAcademicSources, desktopAcademicSourceDetails } = await import(pathToFileURL(file));
    const metadata = { title: 'Source', itemType: 'book', creators: [{ creatorType: 'editor', lastName: 'Smith', firstName: 'Jane' }], year: 2026, publisher: 'Local press' };
    const queries = [], details = [];
    globalThis.window = { nodus: {
      listEditorReferences: async options => {
        queries.push(['vault', options]);
        return Array.from({ length: 50 }, (_, index) => ({ id: String(index), kind: 'work', title: 'Source ' + index,
          bibliography: { ...metadata, doi: index === 0 ? 'https://doi.org/10.1234/DUPLICATE' : undefined }, href: 'nodus://work/' + index }));
      },
      listGlobalLibraryItems: async options => { queries.push(['global', options]); return { items: [{ id: 'global-one', citationKey: 'Smith2026', metadata: { ...metadata, doi: '10.1234/duplicate' } }] }; },
      getGlobalLibraryItem: async id => { details.push(['global', id]); return { metadata, citationKey: 'Smith2026', aliases: ['previous-id'] }; },
      getWorkMeta: async (id, options) => { details.push(['vault', id, options]); return { publisher: 'Complete press', container: 'Collected research', pages: '10-20', edition: '2' }; },
    } };
    const sources = await desktopAcademicSources('Smith 2026');
    assert.deepEqual(queries, [
      ['vault', { onlyWorks: true, search: 'Smith 2026', limit: 50 }],
      ['global', { search: 'Smith 2026', limit: 50, includeFacets: false }],
    ]);
    assert.deepEqual(details, [], 'fifty results never trigger fifty IPC or Zotero requests');
    assert.equal(sources.length, 50, 'global and vault copies of the same DOI are deduplicated');
    assert.deepEqual(sources[0].metadata, { ...metadata, doi: '10.1234/duplicate' });
    assert.ok(!sources.some(source => source.id === 'vault:0'));
    const global = await desktopAcademicSourceDetails(sources[0]);
    assert.deepEqual(global.aliases, ['previous-id']);
    const vault = await desktopAcademicSourceDetails(sources[1]);
    assert.equal(vault.metadata.publisher, 'Complete press');
    assert.deepEqual(vault.metadata.creators, metadata.creators, 'structured creator roles and names survive hydration');
    assert.deepEqual(details, [['global', 'global-one'], ['vault', '1', { timeoutMs: 1500 }]]);
    window.nodus.getWorkMeta = async () => { throw new Error('Zotero closed'); };
    assert.deepEqual(await desktopAcademicSourceDetails(sources[1]), sources[1], 'local sources remain usable with Zotero closed');
    window.nodus.listGlobalLibraryItems = async () => { throw new Error('Global library unavailable'); };
    assert.equal((await desktopAcademicSources('')).length, 50);
  } finally { delete globalThis.window; await rm(directory, { recursive: true, force: true }); }
});
