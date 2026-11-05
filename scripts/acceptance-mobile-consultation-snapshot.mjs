import assert from 'node:assert/strict';
import fs from 'node:fs';
import { connectAcceptanceBridge } from './lib/mobileAcceptanceClient.mjs';

const client = await connectAcceptanceBridge('Scoped consultation acceptance');
try {
  const root = `${client.root}/corpus/snapshot`;
  const dictionaryBytes = await client.binary(`${root}?projection=dictionary`);
  assert(dictionaryBytes.length < 50 * 1024 * 1024, 'A live dictionary consultation must fit the companion download budget');
  const dictionary = JSON.parse(dictionaryBytes);
  const sourceBytes = await client.binary(`${root}?projection=sources`);
  assert(sourceBytes.length < 50 * 1024 * 1024, 'Source consultations must fit the companion download budget');
  const sources = JSON.parse(sourceBytes);
  assert.equal(dictionary.vault.id, client.vault.id); assert.equal(sources.vault.id, client.vault.id);
  assert(dictionary.tables.dictionary_entries.length > 0, 'A real Dictionary fixture is required');
  const ids = new Set(); let total;
  for (let offset = 0;;) {
    const page = await client.operation('listDictionaryEntries', [{ offset, limit: 7 }]);
    total ??= page.total; assert.equal(page.total, total);
    for (const entry of page.items) ids.add(entry.id);
    offset += page.items.length;
    if (offset >= total) break;
    assert(page.items.length, 'Dictionary pagination must advance');
  }
  assert.deepEqual(new Set(dictionary.tables.dictionary_entries.map(row => row.id)), ids);
  assert.equal(ids.size, total);
  assert(dictionary.tables.dictionary_versions.length > 0);
  assert(sources.tables.ideas.length > 0 && sources.tables.evidence.length > 0);
  assert.equal(sources.tables.passages, undefined);
  for (const snapshot of [dictionary, sources]) {
    assert.deepEqual(snapshot.assets, []); assert.equal(snapshot.library, undefined);
    assert.equal(snapshot.capabilities.hasAssets, false); assert.equal(snapshot.capabilities.includesLibraryDocuments, false);
    for (const name of Object.keys(snapshot.tables)) assert(!/^(teaching_|testimony_|world_|study_recordings$)/.test(name));
  }
  await client.request(`${root}?projection=everything-private`, 'GET', undefined, 400);
  const themes = await client.operation('stellarThemes');
  const theme = themes.filter(row => row.ideaCount >= 3).sort((a, b) => a.ideaCount - b.ideaCount)[0];
  assert(theme, 'A populated theme suitable for the phone canvas inspection is required');
  fs.writeFileSync(`${process.env.NODUS_MOBILE_ACCEPTANCE_LAB}/phone-graph-acceptance-input.json`,
    JSON.stringify({ vaultId: client.vault.id, themeLabel: theme.label, ideas: theme.ideaCount, capturedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log(JSON.stringify({ result: 'passed', transport: 'production pinned HTTPS', dictionaryEntries: total,
    historicalVersions: dictionary.tables.dictionary_versions.length, dictionaryBytes: dictionaryBytes.length,
    sourceIdeas: sources.tables.ideas.length, sourceBytes: sourceBytes.length, invalidProjectionRejected: true, skipped: 0 }));
} finally { await client.close(); }
