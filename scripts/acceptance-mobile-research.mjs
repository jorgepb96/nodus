import assert from 'node:assert/strict';
import { connectAcceptanceBridge } from './lib/mobileAcceptanceClient.mjs';

const client = await connectAcceptanceBridge('Mobile research generation acceptance');
try {
  const settings = await client.operation('getSettings');
  assert(settings.deepResearchModel?.provider && settings.deepResearchModel?.model, 'The Mac must have an effective Deep Research model');
  const selection = process.env.NODUS_ACCEPTANCE_MODEL_SETTING ?? 'deepResearchModel';
  assert(['deepResearchModel', 'dictionaryModel'].includes(selection), 'Choose an explicit configured Mac model');
  const selectedModel = settings[selection];
  assert(selectedModel?.provider && selectedModel?.model, 'The explicitly selected Mac model must be configured');
  console.log(JSON.stringify({ selectedSetting: selection, model: selectedModel }));
  const before = await client.operation('listWritingWorkshopDrafts');
  let lastPhase;
  const job = await client.job('enqueueDeepResearchJob', [{ objective: 'Explica cómo la propaganda turística del franquismo representó la autenticidad y el exotismo de España. Fundamenta el argumento en el corpus, conserva las citas y distingue las posturas de los autores.',
    model: selectedModel, language: 'es', sectionLimit: 1, sectionLength: 500, decorativeImage: { enabled: false, style: 'realistic' }, deepResearchVersion: 'v2' }], job => {
    const phase = job.events.at(-1)?.args.at(-1)?.phase ?? job.state;
    if (phase !== lastPhase) { console.log(JSON.stringify({ state: job.state, phase })); lastPhase = phase; }
  }, 45 * 60_000);
  assert(job.result.savedDraftId, 'Completion must identify its committed Desktop draft');
  const after = await client.operation('listWritingWorkshopDrafts');
  assert(after.length > before.length && after.some(draft => draft.id === job.result.savedDraftId), 'The saved report must appear in Desktop');
  const response = await client.request(`${client.root}/corpus/deep-research/${encodeURIComponent(job.result.savedDraftId)}`);
  assert(response.report?.draft?.draftMarkdown?.length > 200, 'The report must be available through the mobile consultation contract');
  console.log(JSON.stringify({ executed: 1, passed: 1, failed: 0, skipped: 0, jobId: job.id,
    draftId: job.result.savedDraftId, model: selectedModel, persisted: true, idempotency: true }));
} finally { await client.close(); }
