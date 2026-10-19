import { randomUUID } from 'node:crypto';
import { RESEARCH_INDEX_CONFIRMATION_THRESHOLD, type ResearchIndexRequestResult } from '@shared/researchCorpus';
import type { ResearchPreparationAction, ResearchPreparationCampaign, ResearchPreparationPolicy, ResearchPreparationPreview, ResearchPreparationProgress } from '@shared/researchCorpus';
import { DocumentaryCampaigns } from '../db/documentaryCampaigns';
import { getActiveVault, getVault, withOwningVault } from '../vaults/vaultRegistry';
import { withVaultDatabase } from '../db/database';
import { preparationPreflight } from './researchPreparationPreflight';
import { effectiveEmbeddingConfig, type EmbeddingExecutionConfig } from './aiClient';
import { documentaryStore, drainDocumentaryRequests, embeddingConfigurationUsable, prepareResearchDocuments, getResearchPreparationInventory, interruptUnusedDocumentaryRequest, setResearchPreparationPaused } from './documentaryPreparation';
import { researchCorpusInventory } from './researchCorpusInventory';
import { notifyDocumentaryPreparation } from './documentaryPreparationEvents';

interface PreviewRecord {
  preview: ResearchPreparationPreview;
  configuration: { embedding: EmbeddingExecutionConfig | null; processingVersion: string; ocrLanguages?: string };
}
function externalEmbedding(config: EmbeddingExecutionConfig): boolean {
  if (config.endpoint === 'nodus-local-runtime') return false;
  try { return !['127.0.0.1', '[::1]', 'localhost'].includes(new URL(config.endpoint).hostname); }
  catch { return true; }
}
function campaigns() { return new DocumentaryCampaigns(documentaryStore().db); }
function academicVault() {
  const vault = getActiveVault();
  if (vault.type !== 'academic') throw new Error('research_academic_vault_required');
  return vault;
}
export function getResearchPreparationPolicy(): ResearchPreparationPolicy {
  const { known: _known, authorized: _authorized, ...policy } = campaigns().policy(academicVault().id);
  return policy;
}
export function setResearchPreparationPolicy(input: { welcomeVersion?: number; decision?: ResearchPreparationPolicy['decision']; futureAdditions?: boolean }): ResearchPreparationPolicy {
  if (!input || typeof input !== 'object' || (input.welcomeVersion !== undefined && (!Number.isSafeInteger(input.welcomeVersion) || input.welcomeVersion < 0 || input.welcomeVersion > 1))
    || (input.decision !== undefined && !['accepted', 'declined', 'pending'].includes(input.decision))
    || (input.futureAdditions !== undefined && typeof input.futureAdditions !== 'boolean')) throw new Error('Invalid preparation policy');
  const repo = campaigns(), vault = academicVault(), policy = repo.policy(vault.id);
  if (input.futureAdditions === true && !policy.futureAdditions) {
    policy.known = researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment).map(document => document.id);
  }
  repo.savePolicy({ ...policy, welcomeVersion: input.welcomeVersion ?? policy.welcomeVersion,
    decision: input.decision ?? policy.decision, futureAdditions: input.futureAdditions ?? (input.decision === 'declined' ? false : policy.futureAdditions), futureAdditionsSetByUser: input.futureAdditions !== undefined || policy.futureAdditionsSetByUser });
  notifyDocumentaryPreparation();
  return getResearchPreparationPolicy();
}
export async function previewResearchPreparation(input: { scope: 'vault' | 'selection'; documentIds?: string[]; inspect?: boolean }): Promise<ResearchPreparationPreview> {
  if (!input || !['vault', 'selection'].includes(input.scope) || (input.inspect !== undefined && typeof input.inspect !== 'boolean')
    || (input.scope === 'selection' && (!Array.isArray(input.documentIds) || input.documentIds.length > 50000 || input.documentIds.some(id => typeof id !== 'string' || id.length > 1000)))) throw new Error('Invalid preparation selection');
  const vault = academicVault(), repo = campaigns();
  const eligible = getResearchPreparationInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment);
  const wanted = new Set(input.documentIds ?? []);
  const documents = input.scope === 'vault' ? eligible : eligible.filter(document => wanted.has(document.id));
  if (input.scope === 'selection' && documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  let config: EmbeddingExecutionConfig | null = null;
  try { config = effectiveEmbeddingConfig(); } catch { /* Text-only remains available. */ }
  const available = !!config && embeddingConfigurationUsable(config);
  const preview: ResearchPreparationPreview = { id: randomUUID(), vaultId: vault.id, createdAt: Date.now(), documents,
    embedding: config ? { provider: config.provider, model: config.modelId, external: externalEmbedding(config) } : null,
    embeddingAvailable: available, block: available ? null : 'no_model' };
  const payload: PreviewRecord = { preview, configuration: { embedding: config, processingVersion: 'nodus-documentary/2' } };
  // The preflight opens every unindexed PDF in a worker, one after another: minutes on a
  // large library. The welcome does not show it and must not wait for it to be clickable.
  if (input.inspect !== false) preview.preflight = await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => preparationPreflight(documents)));
  repo.db.prepare('INSERT INTO documentary_preparation_previews VALUES(?,?,?,?)').run(preview.id, vault.id, JSON.stringify(payload), preview.createdAt);
  // Unconfirmed previews carry no authority and can be reconstructed safely.
  repo.db.prepare('DELETE FROM documentary_preparation_previews WHERE created_at<?').run(Date.now() - 7 * 86400000);
  return preview;
}
export async function startResearchPreparationCampaign(input: { previewId: string; mode: 'embeddings' | 'text'; documentIds?: string[] }): Promise<string> {
  if (!input || typeof input.previewId !== 'string' || !['embeddings', 'text'].includes(input.mode)
    || (input.documentIds !== undefined && (!Array.isArray(input.documentIds) || input.documentIds.some(id => typeof id !== 'string')))) throw new Error('Invalid preparation campaign');
  const vault = academicVault(), repo = campaigns();
  const row = repo.db.prepare('SELECT payload_json FROM documentary_preparation_previews WHERE id=? AND vault_id=?').get(input.previewId, vault.id) as { payload_json: string } | undefined;
  if (!row) throw new Error('research_preparation_preview_expired');
  const record: PreviewRecord = JSON.parse(row.payload_json);
  if (input.mode === 'embeddings' && !record.preview.embeddingAvailable) throw new Error('documentary_embeddings_unavailable');
  const selected = input.documentIds ? new Set(input.documentIds) : null;
  const documents = selected ? record.preview.documents.filter(document => selected.has(document.id)) : record.preview.documents;
  if (selected && documents.length !== selected.size) throw new Error('research_source_not_authorized');
  const current = new Map(researchCorpusInventory().documents.map(document => [document.id, document]));
  for (const document of documents) {
    const now = current.get(document.id);
    if (!now || now.revision !== document.revision || now.permissionRevision !== document.permissionRevision || !now.workId) throw new Error('research_preparation_inventory_changed');
  }
  const id = repo.create(vault.id, vault.name, documents, { ...record.configuration, embedding: input.mode === 'text' ? null : record.configuration.embedding });
  repo.db.prepare('DELETE FROM documentary_preparation_previews WHERE id=?').run(input.previewId);
  notifyDocumentaryPreparation();
  void drainDocumentaryRequests();
  return id;
}
/** Index works of the active vault now, without a dialog: the documents that are not
 * indexed yet are queued for text and embeddings with the configured model. More than
 * RESEARCH_INDEX_CONFIRMATION_THRESHOLD documents come back unqueued, asking for an
 * explicit confirmation first. Nothing is queued without a usable embedding model. */
export async function indexResearchWorks(input: { workIds?: string[]; confirmed?: boolean }): Promise<ResearchIndexRequestResult> {
  if (!input || (input.workIds !== undefined && (!Array.isArray(input.workIds) || input.workIds.length > 50000 || input.workIds.some(id => typeof id !== 'string')))
    || (input.confirmed !== undefined && typeof input.confirmed !== 'boolean')) throw new Error('Invalid index request');
  academicVault();
  const wanted = input.workIds ? new Set(input.workIds) : null;
  const documents = getResearchPreparationInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment
    && (!wanted || wanted.has(document.workId)));
  const pending = documents.filter(document => !(document.preparation.lexical === 'ready' && document.preparation.embeddings === 'ready'));
  let config: EmbeddingExecutionConfig | null = null;
  try { config = effectiveEmbeddingConfig(); } catch { /* reported as unavailable */ }
  const embeddingAvailable = !!config && embeddingConfigurationUsable(config);
  const result = { requested: documents.length, queued: 0, alreadyIndexed: documents.length - pending.length, embeddingAvailable };
  if (!embeddingAvailable || !pending.length) return result;
  if (pending.length > RESEARCH_INDEX_CONFIRMATION_THRESHOLD && !input.confirmed) return { ...result, confirmationRequired: pending.length };
  await prepareResearchDocuments(pending.map(document => document.id), 'embeddings');
  return { ...result, queued: pending.length };
}
export function getResearchPreparationProgress(): ResearchPreparationProgress {
  const repo = campaigns();
  const results = repo.list().map(campaign => {
    const configuration = JSON.parse(campaign.configuration_json) as PreviewRecord['configuration'];
    const rows = repo.db.prepare(`SELECT m.*,r.state request_state,r.stage,r.completed_passages,r.total_passages,r.unknown_requests,r.current_page,r.total_pages,r.error
      FROM documentary_campaign_members m JOIN documentary_requests r ON r.document_id=m.job_id WHERE m.campaign_id=? ORDER BY m.title,m.document_id`).all(campaign.id) as Array<{
        job_id: string; document_id: string; title: string; state: string; request_state: ResearchPreparationCampaign['jobs'][number]['state'];
        stage: ResearchPreparationCampaign['jobs'][number]['stage']; completed_passages: number; total_passages: number | null; unknown_requests: number; current_page: number | null; total_pages: number | null; error: string | null;
      }>;
    return { id: campaign.id, vaultId: campaign.vault_id, vaultName: getVault(campaign.vault_id)?.name ?? campaign.vault_name,
      createdAt: campaign.created_at, updatedAt: campaign.updated_at, state: campaign.state, audit: repo.audit(campaign.id),
      embedding: configuration.embedding ? { provider: configuration.embedding.provider, model: configuration.embedding.modelId, external: externalEmbedding(configuration.embedding) } : null,
      jobs: rows.map(row => ({ id: row.job_id, documentId: row.document_id, title: row.title,
        state: row.state !== 'active' ? row.state as ResearchPreparationCampaign['jobs'][number]['state'] : campaign.state !== 'active' ? campaign.state : row.request_state,
        stage: row.stage, completedPassages: row.completed_passages, totalPassages: row.total_passages, unknownRequests: row.unknown_requests, currentPage: row.current_page, totalPages: row.total_pages, error: row.error })) };
  });
  return { paused: documentaryStore().preference('paused'), campaigns: results };
}
/** A retry must be able to succeed. A campaign freezes the embedding model configured
 * when it was created; when that model can no longer run (typically the default remote
 * model before any key existed) and the one configured now can, the retry adopts the
 * current model for the campaign and its unfinished jobs. A frozen model that still runs
 * is never replaced behind the user's back. */
function adoptRunnableEmbedding(repo: DocumentaryCampaigns, campaignId: string, documentId?: string): void {
  const row = repo.db.prepare('SELECT configuration_json FROM documentary_campaigns WHERE id=?').get(campaignId) as { configuration_json: string } | undefined;
  if (!row) return;
  const configuration = JSON.parse(row.configuration_json) as PreviewRecord['configuration'];
  if (!configuration.embedding || embeddingConfigurationUsable(configuration.embedding)) return;
  let current: EmbeddingExecutionConfig;
  try { current = effectiveEmbeddingConfig(); } catch { return; }
  if (!embeddingConfigurationUsable(current)) return;
  repo.db.transaction(() => {
    repo.db.prepare('UPDATE documentary_campaigns SET configuration_json=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...configuration, embedding: current }), Date.now(), campaignId);
    const jobs = repo.db.prepare('SELECT job_id FROM documentary_campaign_members WHERE campaign_id=? AND (? IS NULL OR document_id=?)').all(campaignId, documentId ?? null, documentId ?? null) as { job_id: string }[];
    for (const { job_id } of jobs) {
      const request = repo.db.prepare("SELECT configuration_json FROM documentary_requests WHERE document_id=? AND state IN ('failed','blocked','cancelled','paused','queued')").get(job_id) as { configuration_json: string | null } | undefined;
      if (!request?.configuration_json) continue;
      const frozen = JSON.parse(request.configuration_json) as PreviewRecord['configuration'];
      if (frozen.embedding && !embeddingConfigurationUsable(frozen.embedding)) repo.db.prepare('UPDATE documentary_requests SET configuration_json=? WHERE document_id=?').run(JSON.stringify({ ...frozen, embedding: current }), job_id);
    }
  })();
}
export async function controlResearchPreparationCampaign(input: { campaignId: string; action: ResearchPreparationAction; documentId?: string }): Promise<void> {
  if (!input || typeof input.campaignId !== 'string' || !['pause', 'resume', 'cancel', 'retry'].includes(input.action)
    || (input.documentId !== undefined && typeof input.documentId !== 'string')) throw new Error('Invalid preparation action');
  const repo = campaigns();
  if (input.action === 'retry') adoptRunnableEmbedding(repo, input.campaignId, input.documentId);
  repo.control(input.campaignId, input.action, input.documentId);
  interruptUnusedDocumentaryRequest();
  notifyDocumentaryPreparation();
  void drainDocumentaryRequests();
}

export async function controlAllResearchPreparation(action: ResearchPreparationAction): Promise<void> {
  if (!['pause', 'resume', 'cancel', 'retry'].includes(action)) throw new Error('Invalid preparation action');
  if (action === 'pause' || action === 'resume') { setResearchPreparationPaused(action === 'pause'); return; }
  const repo = campaigns();
  const progress = getResearchPreparationProgress();
  repo.db.transaction(() => {
    for (const campaign of progress.campaigns) {
      if (action === 'cancel') repo.control(campaign.id, action);
      else if (campaign.state === 'active') for (const job of campaign.jobs) {
        if (['failed', 'blocked'].includes(job.state)) { adoptRunnableEmbedding(repo, campaign.id, job.documentId); repo.control(campaign.id, 'retry', job.documentId); }
      }
    }
  }).immediate();
  interruptUnusedDocumentaryRequest(); notifyDocumentaryPreparation(); void drainDocumentaryRequests();
}
