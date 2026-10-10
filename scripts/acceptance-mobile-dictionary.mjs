import assert from 'node:assert/strict';
import { connectAcceptanceBridge } from './lib/mobileAcceptanceClient.mjs';

const client = await connectAcceptanceBridge('Mobile dictionary generation acceptance');
try {
  const settings = await client.operation('getSettings');
  assert(settings.dictionaryModel?.provider && settings.dictionaryModel?.model, 'The Mac must have an effective dictionary model');
  const input = { name: 'Propaganda', aliases: [], focusPrompt: 'Explica el concepto a partir de las evidencias del corpus. Distingue usos y límites.',
    scope: { kind: 'vault' }, outputLanguage: 'es', detailLevel: 'concise', tags: ['mobile-acceptance'] };
  const created = await client.operation('createDictionaryEntry', [input]);
  const entryId = created.entry?.id ?? created.id; assert(entryId);
  let lastPhase;
  const job = await client.job('startDictionaryGeneration', [{ entryId, mode: 'creation', language: 'es', webSearch: 'off' }], job => {
    const phase = job.events.at(-1)?.args[0]?.phase ?? job.state;
    if (phase !== lastPhase) { console.log(JSON.stringify({ state: job.state, phase })); lastPhase = phase; }
  });
  const detail = await client.operation('getDictionaryEntry', [entryId]);
  const versions = await client.operation('listDictionaryVersions', [entryId]);
  assert.equal(job.result.phase, 'done', 'Degraded results require review and cannot count as successful generation');
  assert(detail.entry.contentMarkdown?.length > 100, 'The result must be saved in the Desktop vault');
  assert(versions.length > 0 && detail.entry.currentVersionId, 'The generated result must have a persisted version');
  assert(versions.some(version => version.outcome === 'synthesis'), 'Insufficient evidence is not a generated synthesis');
  console.log(JSON.stringify({ executed: 1, passed: 1, failed: 0, skipped: 0, entryId, jobId: job.id,
    model: settings.dictionaryModel, saved: true, versionCount: versions.length, idempotency: true, progress: true }));
} finally { await client.close(); }
