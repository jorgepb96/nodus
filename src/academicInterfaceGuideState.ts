import type { ResearchPreparationInventory, ResearchPreparationProgress } from '@shared/researchCorpus';

/** Count only the active vault's library works, excluding notes and chat attachments. */
export function academicPreparationSummary(inventory: ResearchPreparationInventory | null, progress?: ResearchPreparationProgress, vaultId?: string) {
  const documents = inventory?.documents.filter(doc => doc.workId && !doc.noteId && !doc.conversationAttachment) ?? [];
  const ready = documents.filter(doc => doc.preparation.lexical === 'ready' && doc.preparation.embeddings === 'ready').length;
  const ids = new Set(documents.map(doc => doc.id));
  const jobs = progress?.campaigns.filter(campaign => !vaultId || campaign.vaultId === vaultId).flatMap(campaign => campaign.jobs.filter(job => ids.has(job.documentId))) ?? [];
  return {
    total: documents.length, ready,
    failed: documents.filter(doc => ['failed', 'blocked'].includes(doc.preparation.status) || doc.preparation.embeddings === 'failed').length,
    pending: jobs.some(job => ['queued', 'running', 'paused'].includes(job.state)) || documents.some(doc => ['queued', 'running', 'paused'].includes(doc.preparation.status)),
    paused: jobs.some(job => job.state === 'paused') || documents.some(doc => doc.preparation.status === 'paused'),
    noModel: documents.some(doc => doc.preparation.reason === 'no_model'),
  };
}
