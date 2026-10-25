import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const marker = '--electron-document-profiles-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-profiles-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const sqlite = new Database(path.join(root, 'profiles.sqlite'));
  runMigrations(sqlite);
  globalThis.__documentProfilesDb = sqlite;
  assert.equal(sqlite.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  // Exercise a real v157 -> current migration as well as a clean install. Never
  // fake an old database by rewinding user_version on a schema that already has
  // later columns: that is not a state any shipped Nodus build can produce.
  const legacy = new Database(path.join(root, 'profiles-v157.sqlite'));
  for (const migration of migrations.filter((entry) => entry.version <= 157)) {
    legacy.transaction(() => {
      legacy.exec(migration.up);
      legacy.pragma(`user_version = ${migration.version}`);
    })();
  }
  runMigrations(legacy);
  assert.equal(legacy.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'works_document_profile_%'").get().n, 2);
  assert.equal(legacy.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='document_index_jobs_campaign_status'").get().n, 1);
  assert.equal(legacy.prepare("SELECT COUNT(*) n FROM pragma_table_info('document_index_jobs') WHERE name='current_unit'").get().n, 1);
  legacy.close();
  for (const table of [
    'document_profile_state', 'document_profile_versions', 'document_profile_fields',
    'document_sections', 'document_profile_support', 'document_vectors',
    'document_profile_overrides', 'document_index_campaigns', 'document_index_jobs',
  ]) assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n, 1, table);

  sqlite.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES('w1','Z1','Modernización española','["Autora Uno"]',2024,'book','pdf',0,'done','done','none')`).run();

  const repo = require(path.join(repoRoot, 'electron/db/documentProfilesRepo.ts'));
  const profileAi = require(path.join(repoRoot, 'electron/ai/documentProfile.ts'));
  assert.deepEqual(profileAi.normalizeSectionAnalysis({
    section_analysis: {
      title: 'Método', summary: 'Describe el entrenamiento.', role: 'method',
      claims: [{ text: 'Usa descenso de gradiente.', support_quote: 'gradient descent', confidence: '0.9' }],
    },
  }, 'Fallback'), {
    title: 'Método', summary: 'Describe el entrenamiento.', role: 'method', concepts: [],
    claims: [{ text: 'Usa descenso de gradiente.', support_quote: 'gradient descent', page: null, confidence: 0.9 }],
  }, 'provider wrappers and omitted empty arrays normalize without discarding supported claims');
  assert.deepEqual(profileAi.normalizeSectionAnalysis({ title: 'Vacía' }, 'Fallback'), {
    title: 'Vacía', summary: '', role: '', concepts: [], claims: [],
  }, 'an incomplete object cannot manufacture claims during normalization');
  const campaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'continuous', includeArchived: false,
    generatorModel: { provider: 'openai', model: 'generator' },
    auditorModel: { provider: 'anthropic', model: 'auditor' },
  });
  const queued = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w1', campaignId: campaign.campaignId,
    priority: 10, reason: 'backfill', generatorModel: null, auditorModel: null,
  });
  const promoted = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w1', campaignId: campaign.campaignId,
    priority: 100, reason: 'research', generatorModel: null, auditorModel: null,
  });
  assert.equal(promoted.jobId, queued.jobId, 'active work is deduplicated');
  assert.equal(promoted.priority, 100, 'interactive request promotes the existing job');
  assert.equal(repo.claimNextDocumentIndexJob().jobId, queued.jobId);

  const fieldId = 'field-thesis';
  const sectionId = 'section-intro';
  const supportId = 'support-thesis';
  sqlite.prepare(`INSERT INTO passages(
    passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at
  ) VALUES('w1#0','w1',0,'El proceso avanzó de manera desigual.','p. 4',37,'source-1',?)`).run(new Date().toISOString());
  const versionId = repo.publishDocumentProfile({
    nodusId: 'w1', sourceFingerprint: 'source-1', pipelineVersion: 'document-profile/1', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Estudia la modernización española.',
    profile: { thesis: 'La modernización fue desigual.' },
    fields: [{ fieldId, kind: 'thesis', ordinal: 0, text: 'La modernización fue desigual.', confidence: 0.96, centrality: 1 }],
    sections: [{
      sectionId, parentSectionId: null, level: 1, ordinal: 0, title: 'Introducción', role: 'planteamiento',
      summary: 'Presenta una modernización territorialmente desigual.', concepts: ['modernización'],
      claims: ['La modernización fue desigual.'], pageStart: 'p. 1', pageEnd: 'p. 12',
      sourceRef: 'zotero:user:0:ATTACH', pageStartNumber: 1, pageEndNumber: 12,
      charStart: 0, charEnd: 1200, contentHash: 'section-hash',
    }],
    supports: [{
      supportId, targetKind: 'field', targetId: fieldId, sectionId, passageId: 'w1#0',
      pageStart: 'p. 4', pageEnd: 'p. 4', quote: 'El proceso avanzó de manera desigual.',
      sourceRef: 'zotero:user:0:ATTACH', pageStartNumber: 4, pageEndNumber: 4,
      supportKind: 'direct', confidence: 0.97, validationStatus: 'valid',
    }],
    ideaLinks: [], vectors: [], generatorModel: null, auditorModel: null,
    promptHash: 'prompt-1', audit: { passed: true, score: 0.95, supportCoverage: 1, structureCoverage: 1, issues: [], repaired: false },
    qualityScore: 0.95,
  });
  repo.updateDocumentIndexJob(queued.jobId, { status: 'completed', phase: 'done', progress: 1 });
  const profile = repo.getDocumentProfile('w1');
  assert.equal(profile.versionId, versionId);
  assert.equal(profile.fields[0].text, 'La modernización fue desigual.');
  // Section and field ids are opaque, but they are scoped to the version that published them:
  // the pipeline derives them from the content, so a second version of the same document would
  // otherwise reuse them and collide with the first (see the re-publication check below).
  assert.equal(profile.sections[0].sectionId, `${versionId}:${sectionId}`);
  assert.equal(profile.sections[0].sourceRef, 'zotero:user:0:ATTACH');
  assert.equal(profile.sections[0].pageStartNumber, 1);
  assert.equal(profile.supports[0].validationStatus, 'valid');
  assert.equal(profile.supports[0].sourceRef, 'zotero:user:0:ATTACH');
  assert.equal(profile.supports[0].pageStartNumber, 4);
  const exactSupport = repo.findDocumentSupportPassages([{
    kind: 'document', nodusId: 'w1', title: 'Modernización española', authors: ['Autora Uno'], year: 2024,
    // A hit's `sourceId` is the id the published version stored for that field — what
    // `findSimilarDocuments` returns from `document_vectors.source_id`, not the pipeline's
    // pre-publication id.
    versionId, sourceId: `${versionId}:${fieldId}`, fieldKind: 'thesis', text: 'La modernización fue desigual.', similarity: 0.8,
    centrality: 1, explanation: 'Coincidencia en tesis', stale: false,
  }], 5);
  assert.equal(exactSupport[0].passage_id, 'w1#0', 'a matched profile field follows its validated support to the original passage');
  assert.equal(exactSupport[0].similarity, 0.776);
  sqlite.prepare("UPDATE works SET resolved_text_hash='replacement-source' WHERE nodus_id='w1'").run();
  assert.equal(repo.findDocumentSupportPassages([{
    kind: 'document', nodusId: 'w1', title: 'Modernización española', authors: ['Autora Uno'], year: 2024,
    versionId, sourceId: fieldId, fieldKind: 'thesis', text: 'La modernización fue desigual.', similarity: 0.8,
    centrality: 1, explanation: 'Coincidencia en tesis', stale: true,
  }], 5).length, 0, 'profile support never revives a passage from a replaced text');
  sqlite.prepare("UPDATE works SET resolved_text_hash=NULL WHERE nodus_id='w1'").run();
  assert.equal(repo.lexicalDocumentSearch('modernización', 5)[0].nodusId, 'w1');
  assert.equal(repo.lexicalDocumentSearch('¿Qué explica la modernización española?', 5)[0].nodusId, 'w1',
    'natural-language punctuation is never interpreted as FTS5 syntax');

  repo.upsertDocumentProfileOverride({
    nodusId: 'w1', fieldPath: 'fields.thesis.0', value: 'La modernización tuvo ritmos regionales desiguales.',
    generatedValue: profile.fields[0].text, baseVersionId: versionId, verified: true,
  });
  const corrected = repo.getDocumentProfile('w1');
  assert.equal(corrected.fields[0].text, 'La modernización tuvo ritmos regionales desiguales.');
  assert.equal(corrected.fields[0].verified, true);
  repo.upsertDocumentProfileOverride({
    nodusId: 'w1', fieldPath: 'overview', value: 'Visión global verificada por la investigadora.',
    generatedValue: corrected.overview, baseVersionId: versionId, verified: true,
  });

  const nextVersionId = repo.publishDocumentProfile({
    nodusId: 'w1', sourceFingerprint: 'source-2', pipelineVersion: 'document-profile/1', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Nueva síntesis generada.',
    profile: { thesis: 'Nueva tesis generada.' },
    fields: [{ fieldId: 'field-thesis-v2', kind: 'thesis', ordinal: 0, text: 'Nueva tesis generada.', confidence: 0.91, centrality: 1 }],
    sections: [], supports: [], ideaLinks: [], vectors: [{
      vectorId: 'captured-vector', kind: 'overview', sourceId: null, text: 'Perfil estable.', weight: 1,
      embedding: [1, 0], embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small',
    }], generatorModel: null, auditorModel: null,
    promptHash: 'prompt-v2', audit: { passed: true, score: 0.9, supportCoverage: 1, structureCoverage: 1, issues: [], repaired: false },
    qualityScore: 0.9,
  });
  assert.deepEqual(
    sqlite.prepare("SELECT embedding_provider provider,embedding_model model FROM embedding_read_document_vectors WHERE vector_id=?")
      .get(`${nextVersionId}:captured-vector`),
    { provider: 'openai', model: 'text-embedding-3-small' },
    'publication records the embedding configuration captured when the vector was generated',
  );
  const preserved = repo.getDocumentProfile('w1');
  assert.equal(preserved.versionId, nextVersionId);
  assert.equal(preserved.fields[0].text, 'La modernización tuvo ritmos regionales desiguales.', 'manual field correction survives rescans');
  assert.equal(preserved.fields[0].conflict, true, 'changed generated text flags the preserved correction for review');
  assert.equal(preserved.overview, 'Visión global verificada por la investigadora.', 'manual overview survives rescans');
  assert.equal(preserved.overviewConflict, true);
  assert.equal(repo.lexicalDocumentSearch('investigadora', 5)[0].nodusId, 'w1', 'search uses the corrected profile text');

  assert.throws(() => repo.publishDocumentProfile({
    nodusId: 'w1', sourceFingerprint: 'source-2', pipelineVersion: 'document-profile/1', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Candidato inválido', profile: {},
    fields: [], sections: [], supports: [], vectors: [], generatorModel: null, auditorModel: null,
    promptHash: 'prompt-2', audit: { passed: false, score: 0.2, supportCoverage: 0, structureCoverage: 0, issues: ['sin apoyo'], repaired: false },
    qualityScore: 0.2,
  }), /auditoría/);
  assert.equal(repo.getDocumentProfile('w1').versionId, nextVersionId, 'failed candidate cannot replace current profile');

  // The acceptance gate publishes a synthesis the auditor did not approve as `partial`, and
  // the model the auditor wrote is what keeps it: the fields all carry literal support and the
  // mode is the caveat. Refusing it here — on the verdict alone — threw away exactly the
  // profiles the gate had just decided to keep, which failed every indexing run whose auditor
  // disliked the prose.
  const degradedVersionId = repo.publishDocumentProfile({
    nodusId: 'w1', sourceFingerprint: 'source-2', pipelineVersion: 'document-profile/1', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Síntesis conservada con su apoyo literal.',
    profile: { thesis: 'La modernización fue desigual.', fallbackMode: 'partial' },
    fields: [{ fieldId: 'field-partial', kind: 'thesis', ordinal: 0, text: 'La modernización fue desigual.', confidence: 0.8, centrality: 1, confidenceSource: 'floor' }],
    sections: [], supports: [], ideaLinks: [], vectors: [], generatorModel: null, auditorModel: null,
    promptHash: 'prompt-3',
    audit: { passed: false, score: 0.79, supportCoverage: 1, structureCoverage: 1, issues: [], repaired: true, fallback: 'partial' },
    qualityScore: 0.79,
  });
  const degraded = repo.getDocumentProfile('w1');
  assert.equal(degraded.versionId, degradedVersionId, 'a declared partial profile is published, not discarded');
  assert.equal(degraded.audit.fallback, 'partial', 'the caveat travels with the published version');
  assert.equal(degraded.audit.passed, false, 'and the semantic verdict is still reported as it was');
  assert.equal(degraded.qualityScore, 0.79);
  assert.equal(degraded.fields[0].text, 'La modernización tuvo ritmos regionales desiguales.', 'a degraded publication preserves the reader correction too');
  assert.equal(repo.listDocumentIndexCampaigns()[0].status, 'completed');

  sqlite.prepare("UPDATE works SET title='Modernización española en el siglo XX' WHERE nodus_id='w1'").run();
  assert.equal(repo.lexicalDocumentSearch('siglo', 5)[0].nodusId, 'w1', 'bibliographic title changes refresh document FTS');
  assert.equal(repo.documentProfileStatuses(['w1'])[0].status, 'current', 'a title-only edit does not force an AI rescan');

  sqlite.prepare("UPDATE works SET zotero_version=2 WHERE nodus_id='w1'").run();
  assert.equal(repo.documentProfileStatuses(['w1'])[0].status, 'stale', 'a changed source revision invalidates the current profile');
  assert.equal(repo.documentProfileStatuses(['w1'])[0].staleReason, 'source_changed');
  sqlite.prepare("UPDATE document_profile_state SET status='current',stale_reason=NULL WHERE nodus_id='w1'").run();
  sqlite.prepare("UPDATE works SET deep_hash='replacement-source' WHERE nodus_id='w1'").run();
  assert.equal(repo.documentProfileStatuses(['w1'])[0].status, 'stale', 'a new deep extraction also invalidates the profile');

  sqlite.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES('w2','Z2','Obra sin ficha','[]',2023,'book','pdf',0,'done','done','none')`).run();
  const cancelCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  const missingJob = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w2', campaignId: cancelCampaign.campaignId,
    priority: 1, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  assert.equal(repo.documentProfileStatuses(['w2'])[0].status, 'queued');
  repo.cancelDocumentIndexJob(missingJob.jobId);
  assert.equal(repo.documentProfileStatuses(['w2'])[0].status, 'missing', 'cancelling a job restores a work without a profile to missing');

  const staleCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w1', campaignId: staleCampaign.campaignId,
    priority: 1, reason: 'stale', generatorModel: null, auditorModel: null,
  });
  assert.equal(repo.documentProfileStatuses(['w1'])[0].status, 'queued');
  repo.setDocumentCampaignStatus(staleCampaign.campaignId, 'cancelled');
  assert.equal(repo.documentProfileStatuses(['w1'])[0].status, 'stale', 'cancelling a campaign preserves a stale current profile');
  assert.equal(repo.documentProfileStatuses(['w1'])[0].staleReason, 'source_changed');

  const emptyCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  assert.doesNotThrow(() => repo.setDocumentCampaignStatus(emptyCampaign.campaignId, 'running'));
  assert.equal(
    repo.listDocumentIndexCampaigns().find((item) => item.campaignId === emptyCampaign.campaignId).status,
    'completed',
    'an empty/all-current campaign terminates instead of becoming a permanent 0/0 run',
  );

  sqlite.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status,resolved_text_hash
  ) VALUES('w3','Z3','Obra pausada','[]',2022,'book','pdf',0,'done','done','none','stable-passages')`).run();
  const pauseCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  const pauseJob = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w3', campaignId: pauseCampaign.campaignId,
    priority: 1, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  assert.equal(repo.claimNextDocumentIndexJob().jobId, pauseJob.jobId);
  assert.equal(
    repo.advanceRunningDocumentIndexJob(pauseJob.jobId, 'analyzing_sections', 0.25, 'analyzing', {
      message: 'Analizando sección 3 de 12…', currentUnit: 3, totalUnits: 12,
    }),
    true,
  );
  const granular = repo.listDocumentIndexJobs().find((job) => job.jobId === pauseJob.jobId);
  assert.equal(granular.progressMessage, 'Analizando sección 3 de 12…');
  assert.equal(granular.currentUnit, 3);
  assert.equal(granular.totalUnits, 12, 'the UI can display real section/chunk progress');
  const granularCampaign = repo.listDocumentIndexCampaigns().find((item) => item.campaignId === pauseCampaign.campaignId);
  assert.equal(granularCampaign.runningJobs, 1);
  assert.equal(granularCampaign.queuedJobs, 0, 'campaign counters are exact and independent of the renderer sample cap');
  repo.updateDocumentIndexJob(pauseJob.jobId, { progress: 0.61, phase: 'analyzing_sections' });
  repo.saveDocumentCheckpoint(pauseJob.jobId, 'section:kept', 'source-hash', { summary: 'Trabajo parcial conservado' });
  repo.setDocumentCampaignStatus(pauseCampaign.campaignId, 'paused');
  assert.equal(repo.listDocumentIndexJobs().find((job) => job.jobId === pauseJob.jobId).status, 'paused');
  assert.equal(repo.documentProfileStatuses(['w3'])[0].status, 'paused', 'work state agrees with the paused campaign');
  assert.equal(
    repo.advanceRunningDocumentIndexJob(pauseJob.jobId, 'embedding', 0.9, 'embedding'),
    false,
    'a late provider progress event cannot advance a paused job',
  );
  assert.equal(repo.documentProfileStatuses(['w3'])[0].status, 'paused', 'late progress cannot overwrite the paused work state');
  assert.equal(repo.claimNextDocumentIndexJob(), null, 'a paused campaign cannot be claimed');

  // Reproduce a process dying between the campaign write and worker teardown.
  sqlite.prepare("UPDATE document_index_jobs SET status='running',phase='analyzing_sections' WHERE job_id=?").run(pauseJob.jobId);
  sqlite.prepare("UPDATE document_profile_state SET status='analyzing' WHERE nodus_id='w3'").run();
  assert.equal(repo.recoverInterruptedDocumentJobs(), 1);
  const recoveredPaused = repo.listDocumentIndexJobs().find((job) => job.jobId === pauseJob.jobId);
  assert.equal(recoveredPaused.status, 'paused');
  assert.equal(recoveredPaused.progress, 0.61, 'recovery preserves granular progress');
  assert.equal(repo.documentProfileStatuses(['w3'])[0].status, 'paused');
  assert.equal(repo.claimNextDocumentIndexJob(), null, 'restart still respects the persisted pause');

  repo.setDocumentCampaignStatus(pauseCampaign.campaignId, 'running');
  const resumed = repo.claimNextDocumentIndexJob();
  assert.equal(resumed.jobId, pauseJob.jobId, 'resume keeps the same job and its checkpoints');
  assert.deepEqual(
    repo.readDocumentCheckpoint(pauseJob.jobId, 'section:kept', 'source-hash'),
    { summary: 'Trabajo parcial conservado' },
    'pause/restart/resume preserves compatible partial analysis checkpoints',
  );
  repo.updateDocumentIndexJob(pauseJob.jobId, { progress: 0.01, phase: 'waiting_source' });
  assert.equal(
    repo.listDocumentIndexJobs().find((job) => job.jobId === pauseJob.jobId).progress,
    0.61,
    'a resumed job never makes the visible progress bar move backwards',
  );
  repo.cancelDocumentIndexJob(pauseJob.jobId);
  const restartAfterStopCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  const restartedAfterStop = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w3', campaignId: restartAfterStopCampaign.campaignId,
    priority: 1, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  assert.notEqual(restartedAfterStop.jobId, pauseJob.jobId, 'stop remains terminal for the old worker identity');
  assert.deepEqual(
    repo.readDocumentCheckpoint(restartedAfterStop.jobId, 'section:kept', 'source-hash'),
    { summary: 'Trabajo parcial conservado' },
    'starting again after stop copies compatible checkpoints without racing the cancelled worker',
  );
  repo.cancelDocumentIndexJob(restartedAfterStop.jobId);

  sqlite.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES
    ('w-retry-1','ZR1','Trabajo recuperable','[]',2024,'journalArticle','pdf',0,'done','done','none'),
    ('w-retry-2','ZR2','Trabajo que mantiene la campaña activa','[]',2024,'journalArticle','pdf',0,'done','done','none')`).run();
  const retryCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  const failedInActiveCampaign = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w-retry-1', campaignId: retryCampaign.campaignId,
    priority: 1, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w-retry-2', campaignId: retryCampaign.campaignId,
    priority: 0, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  assert.equal(repo.claimNextDocumentIndexJob().jobId, failedInActiveCampaign.jobId);
  repo.saveDocumentCheckpoint(failedInActiveCampaign.jobId, 'section:retry', 'same-source', { kept: true });
  repo.updateDocumentIndexJob(failedInActiveCampaign.jobId, { status: 'failed', phase: 'done', error: 'invalid JSON' });
  const retriedInSameCampaign = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w-retry-1', campaignId: retryCampaign.campaignId,
    priority: 2, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  assert.equal(retriedInSameCampaign.jobId, failedInActiveCampaign.jobId,
    'retrying a failed item in an active campaign reuses its row instead of counting a duplicate failure');
  assert.equal(retriedInSameCampaign.attempts, 0);
  assert.deepEqual(repo.readDocumentCheckpoint(retriedInSameCampaign.jobId, 'section:retry', 'same-source'), { kept: true });
  assert.equal(sqlite.prepare(
    'SELECT COUNT(*) n FROM document_index_jobs WHERE campaign_id=? AND nodus_id=?'
  ).get(retryCampaign.campaignId, 'w-retry-1').n, 1);
  repo.setDocumentCampaignStatus(retryCampaign.campaignId, 'cancelled');

  const replayInput = {
    nodusId: 'w3', sourceFingerprint: 'stable-source', pipelineVersion: 'document-profile/4', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Perfil estable.', profile: { thesis: 'Tesis estable.' },
    fields: [{ fieldId: 'stable-field', kind: 'thesis', ordinal: 0, text: 'Tesis estable.', confidence: 1, centrality: 1 }],
    sections: [], supports: [], ideaLinks: [], vectors: [], generatorModel: null, auditorModel: null,
    promptHash: 'stable-prompt', audit: { passed: true, score: 1, supportCoverage: 1, structureCoverage: 1, issues: [], repaired: false },
    qualityScore: 1,
    expectedWorkRevision: {
      zoteroKey: 'Z3', zoteroVersion: null, title: 'Obra pausada', authorsJson: '[]', year: 2022,
      itemType: 'book', doi: null, deepHash: null, resolvedTextHash: 'stable-passages',
    },
    passages: {
      contentHash: 'stable-passages', embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small',
      rows: [{ text: 'Pasaje estable anterior.', pageLabel: 'p. 1', embedding: [0, 1] }],
    },
  };
  const firstReplayVersion = repo.publishDocumentProfile(replayInput);
  assert.deepEqual(
    sqlite.prepare("SELECT embedding_provider provider,embedding_model model FROM embedding_read_passages WHERE nodus_id='w3' LIMIT 1").get(),
    { provider: 'openai', model: 'text-embedding-3-small' },
    'staged passages retain the embedding configuration that produced them',
  );
  sqlite.prepare("UPDATE document_profile_state SET status='stale',stale_reason='source_changed' WHERE nodus_id='w3'").run();
  const secondReplayVersion = repo.publishDocumentProfile(replayInput);
  assert.equal(secondReplayVersion, firstReplayVersion, 'crash replay returns the already-published identical version');
  assert.equal(repo.documentProfileStatuses(['w3'])[0].status, 'current', 'an identical replay restores a stale profile to current');
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM document_profile_versions WHERE nodus_id='w3'").get().n,
    1,
    'crash replay cannot create a duplicate superseded version',
  );
  const invalidAtomicCandidate = {
    ...replayInput,
    sourceFingerprint: 'candidate-source',
    profile: { thesis: 'Candidato que debe revertirse.' },
    fields: [{ fieldId: 'candidate-field', kind: 'thesis', ordinal: 0, text: 'Candidato.', confidence: 1, centrality: 1 }],
    supports: [
      { supportId: 'duplicate-support', targetKind: 'field', targetId: 'candidate-field', sectionId: null, passageId: 'w3#0', pageStart: null, pageEnd: null, quote: 'Pasaje candidato.', supportKind: 'direct', confidence: 1, validationStatus: 'valid' },
      { supportId: 'duplicate-support', targetKind: 'field', targetId: 'candidate-field', sectionId: null, passageId: 'w3#0', pageStart: null, pageEnd: null, quote: 'Pasaje candidato.', supportKind: 'direct', confidence: 1, validationStatus: 'valid' },
    ],
    passages: { contentHash: 'candidate-passages', rows: [{ text: 'Pasaje candidato.', pageLabel: 'p. 2', embedding: null }] },
  };
  assert.throws(() => repo.publishDocumentProfile(invalidAtomicCandidate), /UNIQUE/);
  assert.equal(
    sqlite.prepare("SELECT text FROM passages WHERE nodus_id='w3' ORDER BY chunk_index LIMIT 1").get().text,
    'Pasaje estable anterior.',
    'a failed late publication rolls back the staged passage replacement too',
  );
  sqlite.prepare("UPDATE works SET resolved_text_hash='replacement-source' WHERE nodus_id='w3'").run();
  assert.throws(() => repo.publishDocumentProfile(replayInput), /DOCUMENT_SOURCE_CHANGED/);
  sqlite.prepare("UPDATE works SET resolved_text_hash='stable-passages' WHERE nodus_id='w3'").run();
  sqlite.prepare("UPDATE works SET zotero_version=5 WHERE nodus_id='w3'").run();
  assert.throws(() => repo.publishDocumentProfile(replayInput), /DOCUMENT_SOURCE_CHANGED/);
  assert.equal(repo.getDocumentProfile('w3').versionId, firstReplayVersion, 'a source change during analysis cannot overwrite the accepted profile');

  sqlite.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES('w4','Z4','Fuente inestable','[]',2021,'book','pdf',0,'done','done','none')`).run();
  const unstableCampaign = repo.createDocumentIndexCampaign({
    vaultId: 'vault-a', mode: 'manual', includeArchived: false,
    generatorModel: null, auditorModel: null,
  });
  const unstableJob = repo.enqueueDocumentIndexJob({
    vaultId: 'vault-a', nodusId: 'w4', campaignId: unstableCampaign.campaignId,
    priority: 1, reason: 'manual', generatorModel: null, auditorModel: null,
  });
  assert.equal(repo.claimNextDocumentIndexJob().jobId, unstableJob.jobId);
  sqlite.prepare('UPDATE document_index_jobs SET attempts=max_attempts,progress=0.92 WHERE job_id=?').run(unstableJob.jobId);
  assert.equal(repo.requeueDocumentIndexJobForSourceChange(unstableJob.jobId), 'paused');
  const exhaustedJob = repo.listDocumentIndexJobs().find((job) => job.jobId === unstableJob.jobId);
  assert.equal(exhaustedJob.status, 'paused', 'a perpetually changing source cannot spin forever');
  assert.equal(exhaustedJob.progress, 0, 'a genuine source revision is the only transition that resets progress');
  assert.match(exhaustedJob.error, /cambió repetidamente/);
  assert.equal(
    repo.listDocumentIndexCampaigns().find((item) => item.campaignId === unstableCampaign.campaignId).status,
    'paused',
    'exhausting source-change retries pauses the campaign for explicit user recovery',
  );

  // Re-indexing a document that already has a profile used to die on
  // `UNIQUE constraint failed: document_sections.section_id`: child ids are derived from the
  // content, every one of those tables keys on the id alone, and a superseded version keeps
  // its rows. So no work could ever be re-indexed — not a stale one, not one re-run with
  // another model. Publishing the same content twice, with the same ids, must work.
  const republishedVersionId = repo.publishDocumentProfile({
    nodusId: 'w1', sourceFingerprint: 'source-2', pipelineVersion: 'document-profile/1', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Estudia la modernización española.',
    profile: { thesis: 'La modernización fue desigual.' },
    fields: [{ fieldId, kind: 'thesis', ordinal: 0, text: 'La modernización fue desigual.', confidence: 0.96, centrality: 1 }],
    sections: [{
      sectionId, parentSectionId: null, level: 1, ordinal: 0, title: 'Introducción', role: 'planteamiento',
      summary: 'Presenta una modernización territorialmente desigual.', concepts: ['modernización'],
      claims: ['La modernización fue desigual.'], pageStart: 'p. 1', pageEnd: 'p. 12',
      sourceRef: 'zotero:user:0:ATTACH', pageStartNumber: 1, pageEndNumber: 12,
      charStart: 0, charEnd: 1200, contentHash: 'section-hash',
    }],
    supports: [{
      supportId, targetKind: 'field', targetId: fieldId, sectionId, passageId: 'w1#0',
      pageStart: 'p. 4', pageEnd: 'p. 4', quote: 'El proceso avanzó de manera desigual.',
      sourceRef: 'zotero:user:0:ATTACH', pageStartNumber: 4, pageEndNumber: 4,
      supportKind: 'direct', confidence: 0.97, validationStatus: 'valid',
    }],
    vectors: [{ vectorId: 'vector-overview', kind: 'overview', sourceId: 'overview', text: 'Perfil estable.', weight: 1, embedding: [1, 0] }],
    ideaLinks: [], generatorModel: null, auditorModel: null,
    promptHash: 'prompt-republished',
    audit: { passed: true, score: 0.9, supportCoverage: 1, structureCoverage: 1, issues: [], repaired: false },
    qualityScore: 0.9,
  });
  assert.notEqual(republishedVersionId, versionId, 'a re-index publishes its own version');
  assert.equal(repo.getDocumentProfile('w1').versionId, republishedVersionId, 'and becomes current');
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM document_sections WHERE section_id=?').get(`${versionId}:${sectionId}`).n, 1,
    'the superseded version keeps the section row it published first',
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM document_sections WHERE version_id=?').get(republishedVersionId).n, 1,
    'the new version carries its own copy of the section, not a shared row',
  );
  const republished = repo.getDocumentProfile('w1');
  assert.equal(republished.sections.length, 1, 'and the reader sees exactly one section');
  assert.equal(republished.fields.length, 1, 'and one field');
  const republishedSupport = sqlite.prepare(
    'SELECT target_id, section_id FROM document_profile_support WHERE version_id=?'
  ).get(republishedVersionId);
  assert.notEqual(republishedSupport.target_id, fieldId, 'a support points at the id its own version published');
  assert.equal(
    sqlite.prepare('SELECT version_id FROM document_profile_fields WHERE field_id=?').get(republishedSupport.target_id).version_id,
    republishedVersionId,
    'and that id belongs to the same version',
  );
  assert.equal(
    sqlite.prepare('SELECT version_id FROM document_sections WHERE section_id=?').get(republishedSupport.section_id).version_id,
    republishedVersionId,
    'the section reference is version-scoped too',
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM document_vectors WHERE version_id=? AND source_id='overview'").get(republishedVersionId).n, 1,
    'the overview vector keeps its plain source id',
  );

  sqlite.close();
  console.log('Document profile persistence test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__documentProfilesDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath }, safeStorage: {}, BrowserWindow: class {}, dialog: {}, shell: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    module._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText, filename);
  };
}
