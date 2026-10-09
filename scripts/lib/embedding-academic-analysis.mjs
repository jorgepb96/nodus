import assert from 'node:assert/strict';
import { waitFor } from './research-app-harness.mjs';

export async function checkEmbeddingAcademicAnalysis(harness, report, save, live) {
  const page = harness.page, sourceId = report.checks.semanticOnlySource.evidence[0].documentId;
  const automatic = report.vaults.find(vault => vault.mode === 'auto'), manual = report.vaults.find(vault => vault.mode === 'manual');
  await page.evaluate(id => window.nodus.switchVault(id), manual.id);
  try {
    const idea = await page.evaluate(async () => {
      const idea = await window.nodus.createManualIdea({ folderId: null, title: 'QA turbidity and oxygen distinction' });
      const title = 'Turbidity is not dissolved oxygen', summary = 'The Alba device uses green light at 530 nm to measure turbidity and requires calibration every thirty days. It does not measure oxygen.';
      await window.nodus.saveManualIdea({ globalId: idea.globalId, noteId: idea.note.id, title, summary, works: [], evidence: [], connections: [] });
      const result = await window.nodus.autoIndexManualIdea({ globalId: idea.globalId, title, summary });
      return { ...idea, result };
    });
    assert(idea.result.indexed || await waitFor(async () => (await page.evaluate(() => window.nodus.getManualIndexStatus())).state === 'ready', { timeoutMs: 120000 }));
    report.checks.manualIdeaIndex = idea; save();
  } finally { await page.evaluate(id => window.nodus.switchVault(id), automatic.id); }
  if (!live) { report.pending.push('Live academic light/deep/summary/profile analysis'); return; }
  const document = (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === sourceId);
  assert(document.workId, 'the imported source is linked to a vault work');
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  const previous = await page.evaluate(id => window.nodus.getWork(id), document.workId);
  if (!(report.academicProgress && previous?.light_status === 'done' && previous.deep_status === 'done' && previous.summary_status === 'done'))
    await page.evaluate(({ id, model }) => window.nodus.processFull(id, model, { mode: 'refresh' }), { id: document.workId, model });
  const work = await waitFor(async () => {
    const work = await page.evaluate(id => window.nodus.getWork(id), document.workId), queue = await page.evaluate(() => window.nodus.getQueue());
    report.academicProgress = { work, queue }; save();
    if (queue.failed || queue.pausedReason || work?.deep_status === 'failed' || work?.summary_status === 'failed') throw new Error(`Academic analysis failed: ${queue.pausedReason ?? work?.deep_error ?? work?.summary_error ?? 'queue failure'}`);
    // Persisted step statuses precede the chain's final passage publication. Wait
    // for that producer before the profile prepares its own publication token.
    return work?.light_status === 'done' && work.deep_status === 'done' && work.summary_status === 'done'
      && !queue.current && !queue.maintenanceRunning && !queue.items.some(item => ['queued', 'running'].includes(item.state)) && work;
  }, { timeoutMs: 600000, intervalMs: 500 });
  assert(work && work.ideaCount > 0, 'deep analysis persisted ideas');
  const summary = await page.evaluate(id => window.nodus.getWorkSummary(id), document.workId); assert(summary?.summary);
  await page.evaluate(id => window.nodus.enqueueDocumentProfile(id), document.workId);
  const profile = await waitFor(async () => {
    const progress = await page.evaluate(() => window.nodus.getDocumentIndexProgress());
    report.documentProfileProgress = progress; save();
    const latest = progress.jobs.filter(job => job.nodusId === document.workId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest?.status === 'failed') throw new Error(`Document profile failed: ${latest.error}`);
    return page.evaluate(id => window.nodus.getDocumentProfile(id), document.workId);
  }, { timeoutMs: 300000, intervalMs: 500 }); assert(profile);
  report.checks.academicAnalysis = { work, summary, profile }; save();
}
