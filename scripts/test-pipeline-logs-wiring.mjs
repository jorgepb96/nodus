// The wiring, pinned by reading the sources.
//
// The classification, the grouping, the retention and the file are all asserted behaviourally
// elsewhere. What no unit test can reach is whether the pipeline actually CALLS the log — and
// `aiClient.ts` in particular cannot be imported outside Electron (it pulls the database and
// the native SQLite driver), which is why scripts/test-ai-transient-network.mjs pins its
// wiring the same static way.
//
// Each assertion below names the user-visible guarantee it protects. Deleting a call site
// would otherwise be invisible: the feature would keep working and simply stop recording the
// failures it exists for.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

test('every provider, JSON and connection failure passes through the log', () => {
  const client = read('electron/ai/aiClient.ts');
  // The single choke point: the classifier decides, the wrapper records, so all ~16 raise
  // sites report with the branch's real code instead of a generic "AI error".
  assert.match(client, /function wrapProviderError\(e: any\): AiError \{\s*const wrapped = classifyToAiError\(e\);\s*logProviderFailure\(wrapped, e\);/);
  assert.match(client, /function subscriptionError\(error: unknown\): AiError \{[\s\S]*?logProviderFailure\(wrapped, error\);/);
  assert.match(client, /function logProviderFailure\(wrapped: AiError, original: unknown\): void \{/);
  // The codes the transport branches must set, so the badge is precise.
  for (const code of ["'rate_limit'", "'provider_5xx'", "'auth'", "'bad_request'", "'connection'", "'context_overflow'"]) {
    assert.ok(client.includes(code), `the classifier must tag ${code}`);
  }
  assert.ok(client.includes("case 'schema_mismatch':"), 'a schema failure must not read as invalid JSON');
  // JSON failures are logged once, after the frozen-request resamples are exhausted.
  assert.match(client, /function logJsonFailure\(error: unknown\): void \{/);
  assert.ok(client.includes('logJsonFailure(lastErr);'), 'a JSON failure must be recorded when it escapes');
  assert.ok(client.includes("code: e instanceof AiError && e.code ? e.code : 'invalid_json',"), 'a resample must be recorded as a warning');
  // Embeddings: a partial batch is the failure that silently publishes a broken index.
  assert.ok(client.includes("code: 'embedding_count_mismatch'"), 'a vector count mismatch must be recorded');
  // Recovered rate limits and 5xx are the first thing anyone looks for when indexing crawls.
  assert.ok(client.includes('logPipelineWarning({'), 'recovered provider failures must be recorded as warnings');
});

test('the document index queue attributes every line to its vault, document and job', () => {
  const queue = read('electron/pipeline/documentIndexQueue.ts');
  assert.match(queue, /withPipelineLogScope\(\{[\s\S]*?scope: 'indexing',[\s\S]*?vaultId: vault\.id,[\s\S]*?nodusId: job\.nodusId,[\s\S]*?jobId: job\.jobId,/);
  // Every outcome the job can end in has its own line: cancelled, paused, source changed,
  // no text, retry, failed — plus the campaign summary.
  for (const code of ["'cancelled'", "'queue_paused'", "'source_changed'", "'no_legible_text'", "'index_failed'"]) {
    assert.ok(queue.includes(code), `the queue must record ${code}`);
  }
  assert.match(queue, /private logCampaignOutcome\(vault: VaultSummary, campaignId: string \| null \| undefined\): void \{/);
  assert.ok(queue.includes("id: 'logRetry'"), 'a retry must be visible');
  // The per-document green line lives where the counts are known.
  assert.ok(!queue.includes("logPipelineSuccess({ subject: 'subjectIndexing', detail: work.title })"),
    'the success line belongs to the profile scan, which knows the section and vector counts');
});

test('the document profile records the green line with its counts', () => {
  const profile = read('electron/ai/documentProfile.ts');
  assert.ok(profile.includes("id: 'documentIndexed'"), 'an indexed document must leave a green line');
  assert.ok(profile.includes('sections: sections.length') && profile.includes('vectors: vectors.length'),
    'the line must carry the numbers a reader cannot recover later');
  assert.ok(profile.includes('const scanStartedAt = Date.now();'), 'the line must carry its duration');
});

test('library extraction records its outcome and what it actually extracted', () => {
  const queue = read('electron/library/libraryExtractionQueue.ts');
  assert.ok(queue.includes("id: 'documentExtracted'"), 'a completed extraction must record its counts');
  assert.ok(queue.includes("id: 'documentExtractedReview'"), 'a needs-review extraction must record its warnings');
  assert.ok(queue.includes("code: 'extract_failed'"), 'a failed extraction must be recorded');
  assert.ok(queue.includes("reason: 'reasonCancelled'"), 'a cancelled extraction must be recorded');
  assert.match(queue, /private logContext\(job: LibraryExtractionJob\)/,
    'the Library is not vault-scoped, so the item id and title are the attribution');
  // The vision call is the one AI step per page: without a scope its failures are anonymous.
  const service = read('electron/library/libraryService.ts');
  assert.match(service, /withPipelineLogScope\(\{[\s\S]*?scope: 'ocr',[\s\S]*?provider: model\.provider,[\s\S]*?model: model\.model,/);
});

test('both embedding runs record how they ended', () => {
  for (const file of ['electron/ai/embeddingPipeline.ts', 'electron/ai/passageEmbeddingPipeline.ts']) {
    const source = read(file);
    assert.ok(source.includes("code: 'embedding_failed'"), `${file} must record a failed run`);
    assert.ok(source.includes("code: 'cancelled'"), `${file} must record a stopped run`);
    assert.match(source, /logPipelineSuccess\(\{[\s\S]*?scope: 'embeddings'/, `${file} must record a completed run`);
  }
  assert.ok(read('electron/ai/embeddingPipeline.ts').includes("id: 'ideasEmbedded'"));
  assert.ok(read('electron/ai/passageEmbeddingPipeline.ts').includes("id: 'passagesEmbedded'"));
});

test('the scan queue, the text extractor and the figure analysis all report', () => {
  const scan = read('electron/pipeline/scanQueue.ts');
  assert.ok(scan.includes("code: 'queue_paused'"), 'a paused scan queue must be recorded');
  assert.ok(scan.includes("code: 'index_failed'"), 'a failed scan must be recorded');
  assert.ok(scan.includes("id: 'logRetry'"), 'a scan retry must be recorded');

  const extractor = read('electron/extraction/textExtractor.ts');
  assert.match(extractor, /function reasonForBlockReason\(reason: TextBlockReason\): PipelineLogReasonId \{\s*switch \(reason\) \{/);
  for (const reason of ["'reasonNoAttachment'", "'reasonUnreadable'", "'reasonAbstractOnly'", "'reasonZoteroUnavailable'"]) {
    assert.ok(extractor.includes(reason), `the extractor must record ${reason}`);
  }

  const adapter = read('electron/ai/documentVisuals.ts');
  assert.match(adapter, /return await enrichPortableDocumentVisuals\(target, policy, \{[\s\S]*?logPipelineInfo, logPipelineWarning, logPipelineFailure,/,
    'the Desktop adapter must wire the real pipeline log into the canonical visual loop');
  const visuals = read('shared/portableDocumentVisuals.ts');
  assert.match(visuals, /host\.logPipelineFailure\(\{\s*error,\s*code: 'extract_failed',\s*subject: 'subjectFigureAnalysis',/,
    'a figure that fails must say which brief and which document');
  assert.match(visuals, /documentTitle: figure\.caption \?\? null, jobId: figure\.id,[\s\S]*?detail: figure\.brief,/,
    'the canonical figure failure must retain its document, figure identity and brief');
});

test('uncaught failures are recorded too, and the log is wired into the app’s lifecycle', () => {
  const safety = read('electron/util/processSafety.ts');
  assert.ok(safety.includes("code: 'uncaught'"), 'an uncaught fault must be recorded, not just echoed');
  assert.ok(safety.includes('stack,'), 'an uncaught fault must keep its stack');

  const ipc = read('electron/ipc.ts');
  assert.ok(ipc.includes('initPipelineLogs();'), 'the log must be listening before any pipeline runs');
  assert.ok(ipc.includes('applyPipelineLogLimits();'), 'changing retention must take effect on the spot');
  assert.ok(ipc.includes('registerLogsIpc(context);'), 'the log channels must be registered');

  const main = read('electron/main.ts');
  assert.ok(main.includes('flushPipelineLogs();'), 'the coalesced writes must be flushed on quit');
  const quitBlock = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('flushPipelineLogs();'));
  assert.ok(quitBlock.includes('closeDb();') === false && main.indexOf('flushPipelineLogs();') < main.indexOf('closeDb();', main.indexOf("app.on('before-quit'")),
    'the flush must happen before the database is closed');
});
