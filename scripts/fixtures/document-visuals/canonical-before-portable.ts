import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { blockSources, documentBlocks, documentSkillCatalog, DocumentSkillBudget, DOCUMENT_VISUAL_DISCARD_REASONS, DOCUMENT_VISUAL_RULES, documentVisualDiscardTally, documentVisualDiscardText, repairableDocumentVisualDiscard, validateDocumentSkillPolicy, type DocumentSkillPolicy, type DocumentVisualDiscard, type DocumentVisualDiscardReason, type DocumentVisualManifest, type DocumentVisualSuggestion, type DocumentVisualTarget } from '../../shared/documentSkills';
import { researchVisualFields, immersionVisualFields } from '../../shared/documentVisualContent';
import type { ModelRef } from '../../shared/types';
import { buildChatSkillsPrompt, splitChatVisuals } from '../../shared/chatSkills';
import { getWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { getImmersionSession } from '../db/immersionRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { listDocumentSkills } from '../capabilities/documentCatalog';
import { capabilityRegistry, pinCapabilitiesForTurn, type CapabilityRegistrySnapshot } from '../capabilities/registry';
import { executeSkillResources } from '../capabilities/resourceExecution';
import { readDocumentVisuals, readDocumentVisualUsage, retainPreviousVisuals, visualContentHash, writeDocumentVisuals, undoDocumentVisuals } from '../capabilities/documentStore';
import { snapshotDocumentFigure } from '../capabilities/documentSnapshot';
import { chatAssetOwner, chatAssetVersion } from '../chatAssets';
import { documentVisualModelKey, resolveDocumentVisualModel, type DocumentVisualEnrichOptions } from '../../shared/documentVisualEnrich';
import { getSettings } from '../db/settingsRepo';
import { completeJson, completeText } from './aiClient';
import { normalizeCapabilityId } from '../../skill-capabilities/contracts';
import { logPipelineFailure, logPipelineInfo, logPipelineWarning } from '../logging/pipelineLogCore';
import { pipelineLogText } from '../../shared/pipelineLogMessages';

const running = new Map<string, AbortController>();
const keyFor = (target: DocumentVisualTarget) => JSON.stringify([getActiveVault().id, target.kind, target.id]);
export function visualDocumentInput(target: DocumentVisualTarget) {
  if (!target || !['deep-research', 'immersion'].includes(target.kind) || typeof target.id !== 'string') throw new Error('Invalid document.');
  if (target.kind === 'deep-research') {
    const saved = getWritingWorkshopDraft(target.id); if (!saved) throw new Error('Document no longer exists.');
    return { title: saved.draft.title, language: saved.draft.brief.language || 'en', model: saved.model, fields: researchVisualFields(saved.draft) };
  }
  const saved = getImmersionSession(target.id); if (!saved) throw new Error('Document no longer exists.');
  return { title: saved.plan.title, language: saved.plan.language, model: saved.model, fields: immersionVisualFields(saved.plan) };
}
export function getDocumentVisuals(target: DocumentVisualTarget): DocumentVisualManifest | null {
  const input = visualDocumentInput(target);
  const manifest = readDocumentVisuals(getActiveVault().id, target);
  if (manifest && ['planning', 'generating'].includes(manifest.state) && !running.has(keyFor(target))) {
    manifest.state = 'cancelled';
    for (const figure of manifest.figures) if (figure.state === 'running') { figure.state = 'failed'; figure.error = 'Interrupted request; retry explicitly.'; }
    writeDocumentVisuals(manifest);
  }
  return manifest?.contentHash === visualContentHash(input.fields) ? manifest : null;
}
const notify = (target: DocumentVisualTarget) => BrowserWindow.getAllWindows().forEach(win => { if (!win.isDestroyed()) win.webContents.send('documentVisuals:changed', target); });

/**
 * One line per motive, with its count — and louder when nothing survived.
 *
 * A run that refused every proposal used to leave no trace at all, so the reader's
 * "no figures were needed" was the same sentence as "the app discarded what the model
 * proposed". A run that kept some figures is a normal success and logs quietly; one
 * that kept none is a warning, because that is the outcome somebody has to explain.
 */
function logDiscards(discarded: readonly DocumentVisualDiscard[], figures: number, target: DocumentVisualTarget): void {
  if (!discarded.length) return;
  const record = figures > 0 ? logPipelineInfo : logPipelineWarning;
  for (const { reason, count } of documentVisualDiscardTally(discarded)) {
    record({
      code: 'figure_skipped',
      subject: 'subjectFigureAnalysis',
      context: { scope: 'extraction', nodusId: `${target.kind}:${target.id}` },
      message: pipelineLogText('figuresDiscarded', { count, reason: { id: DOCUMENT_VISUAL_DISCARD_REASONS[reason] } }),
    });
  }
}

export function cancelDocumentVisuals(target: DocumentVisualTarget): void { running.get(keyFor(target))?.abort(); }
export function undoVisualEnrichment(target: DocumentVisualTarget): DocumentVisualManifest | null {
  if (running.has(keyFor(target))) throw new Error('Cancel the current visual task first.');
  visualDocumentInput(target);
  const restored = undoDocumentVisuals(getActiveVault().id, target); notify(target); return restored;
}
export function removeDocumentFigure(target: DocumentVisualTarget, figureId: string): DocumentVisualManifest | null {
  if (running.has(keyFor(target))) throw new Error('Cancel the current visual task first.');
  const manifest = getDocumentVisuals(target); if (!manifest) return null;
  retainPreviousVisuals(manifest.vaultId, target);
  manifest.figures = manifest.figures.filter(figure => figure.id !== figureId);
  manifest.revision = randomUUID(); writeDocumentVisuals(manifest); notify(target); return manifest;
}

/** Early opportunities are optional, cheap and do not execute a skill. */
export async function prepareDocumentVisualHints(policy: DocumentSkillPolicy | undefined, objective: string, model?: ModelRef | null, signal?: AbortSignal): Promise<string[]> {
  if (!policy?.enabled || !policy.skills.some(skill => skill.enabled)) return [];
  const options = listDocumentSkills();
  const validated = validateDocumentSkillPolicy(policy, options);
  try {
    return await completeJson<string[]>({ system: `${DOCUMENT_VISUAL_RULES}\nYou are planning a document. Return a JSON array of brief possible visual opportunities, not finished figures. Zero opportunities is valid.`,
      user: JSON.stringify({ objective, skills: JSON.parse(documentSkillCatalog(options, validated)) }), maxTokens: 1200, temperature: 0.2, noRetry: true, signal,
    }, (value): value is string[] => Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.length < 1000), model);
  } catch { signal?.throwIfAborted(); return []; }
}

export async function enrichDocumentVisuals(target: DocumentVisualTarget, policy: DocumentSkillPolicy, request: DocumentVisualEnrichOptions & { hints?: string[]; signal?: AbortSignal } = {}): Promise<DocumentVisualManifest> {
  const key = keyFor(target);
  if (running.has(key)) throw new Error('This document already has a visual task.');
  const input = visualDocumentInput(target), vaultId = getActiveVault().id;
  // Resolved once, before any call: every planning and figure call in a run must run on
  // the same engine, and the reader must be able to see which one from the log if it fails.
  const settings = getSettings();
  const model = resolveDocumentVisualModel({
    requested: request.model,
    configured: settings[documentVisualModelKey(target.kind)],
    general: settings.synthesisModel,
    stored: input.model,
  });
  const options = listDocumentSkills(), validated = validateDocumentSkillPolicy(policy, options);
  const skills = options.filter(option => validated.enabled && validated.skills.some(item => item.enabled && item.skillId === option.skill.id)).map(option => option.skill);
  const previous = getDocumentVisuals(target);
  const controller = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  const registry = capabilityRegistry(), pins = pinCapabilitiesForTurn();
  const now = new Date().toISOString();
  const manifest: DocumentVisualManifest = {
    schemaVersion: 1, target, vaultId, revision: randomUUID(), contentHash: visualContentHash(input.fields), createdAt: now, updatedAt: now,
    state: 'planning', policy: validated, usage: readDocumentVisualUsage(vaultId, target), blocks: documentBlocks(input.fields),
    figures: request.retry ? structuredClone(previous?.figures ?? []).map(figure => figure.state === 'running' ? { ...figure, state: 'failed' as const, error: 'Interrupted request; retry explicitly.' } : figure) : structuredClone(previous?.figures.filter(figure => figure.state === 'ready') ?? []),
    // Kept across a retry: the refusals that explain why a block has no figure are still
    // the reason, and a retry only re-runs the figures it did not finish.
    discarded: request.retry ? structuredClone(previous?.discarded ?? []) : [],
  };
  const current = () => {
    if (getActiveVault().id !== vaultId) return false;
    try { return visualContentHash(visualDocumentInput(target).fields) === manifest.contentHash && readDocumentVisuals(vaultId, target)?.revision === manifest.revision; } catch { return false; }
  };
  const persist = () => { if (!current()) throw new DOMException('The document was deleted or changed.', 'AbortError'); writeDocumentVisuals(manifest); notify(target); };
  const budget = new DocumentSkillBudget(validated, manifest.usage, persist);
  running.set(key, controller);
  try {
    retainPreviousVisuals(vaultId, target); writeDocumentVisuals(manifest); notify(target);
    // A retry with nothing to retry plans again rather than doing nothing: a reader
    // pressing Retry on a document whose every figure was refused is asking for another
    // attempt, and there is no finished resource that a fresh plan could waste.
    if ((!request.retry || !manifest.figures.length) && skills.length) {
      // Partition whole blocks: every section is considered, never silently clipped.
      const batches: typeof manifest.blocks[] = []; let batch: typeof manifest.blocks = [], size = 0;
      for (const block of manifest.blocks) {
        if (size + block.markdown.length > 24_000 && batch.length) { batches.push(batch); batch = []; size = 0; }
        batch.push(block); size += block.markdown.length;
      }
      if (batch.length) batches.push(batch);
      const proposals: DocumentVisualSuggestion[] = [];
      // A proposal the document refuses is kept, with its motive. Dropping it silently is
      // what made a run that discarded everything read exactly like a document that
      // needed no figures at all — same state, same sentence, nothing anywhere.
      const discarded: DocumentVisualDiscard[] = [];
      // One entry per proposal the document refused, not per attempt: a repaired attempt
      // that repeats the same mistake is the same proposal refused again, and counting it
      // twice would tell the reader two proposals were discarded when only one was offered.
      const refuse = (item: DocumentVisualSuggestion, refused: DocumentVisualDiscard[], reason: DocumentVisualDiscardReason) => {
        const entry = { blockId: item.blockId, skillId: item.skillId, reason };
        const existing = refused.findIndex(candidate => candidate.blockId === entry.blockId && candidate.skillId === entry.skillId);
        if (existing < 0) refused.push(entry); else refused[existing] = entry;
      };
      /** Plan one batch and keep only what the document accepts. A repaired attempt is
       *  handed back the refusals it made, so the correction is specific. */
      const planBatch = async (blocks: typeof manifest.blocks, refused: DocumentVisualDiscard[], charged: readonly DocumentVisualDiscard[] = []) => {
        const suggested = await completeJson<DocumentVisualSuggestion[]>({
          system: `${DOCUMENT_VISUAL_RULES}\nReturn a JSON array. Each item: {blockId,skillId,brief,caption,sources:[],layout:"wide"|"compact"|"side"}. Choose exact supplied block and skill ids. Each block lists in sources the exact nodus:// links it may cite: use only those, or [] for explicitly illustrative constructions. Caption and labels must use the document language. Do not duplicate existing figures. Return [] if nothing is useful.${charged.length ? '\nA previous attempt at these blocks was refused. Correct exactly what each refusal names, using only the supplied evidence.' : ''}`,
          user: JSON.stringify({ title: input.title, language: input.language, skills: JSON.parse(documentSkillCatalog(options, validated)), opportunities: request.hints ?? [], existing: manifest.figures.map(({ blockId, caption }) => ({ blockId, caption })), blocks: blocks.map(block => ({ ...block, sources: blockSources(block) })), ...(charged.length ? { refused: charged.map(item => ({ blockId: item.blockId, skillId: item.skillId, reason: documentVisualDiscardText(item.reason) })) } : {}) }),
          temperature: 0.2, maxTokens: 4000, noRetry: true, signal,
        }, (value): value is DocumentVisualSuggestion[] => Array.isArray(value) && value.length <= blocks.length && value.every(item => item && typeof item.blockId === 'string' && typeof item.skillId === 'string' && typeof item.brief === 'string' && item.brief.length < 6000 && typeof item.caption === 'string' && item.caption.length < 1200 && Array.isArray(item.sources)), model);
        for (const item of suggested) {
          const block = blocks.find(candidate => candidate.id === item.blockId);
          if (!block) { refuse(item, refused, 'unknown-block'); continue; }
          if (/^\s*#{1,6}\s+[^\n]+$/.test(block.markdown)) { refuse(item, refused, 'heading-block'); continue; }
          if (!skills.some(skill => skill.id === item.skillId)) { refuse(item, refused, 'skill-not-enabled'); continue; }
          if (budget.remaining(item.skillId) <= proposals.filter(proposal => proposal.skillId === item.skillId).length) { refuse(item, refused, 'ceiling-reached'); continue; }
          const sources = blockSources(block);
          if (item.sources.some(source => typeof source !== 'string' || !sources.includes(source))) { refuse(item, refused, 'source-not-in-block'); continue; }
          if (manifest.figures.some(figure => figure.blockId === item.blockId) || proposals.some(proposal => proposal.blockId === item.blockId)) { refuse(item, refused, 'block-already-has-figure'); continue; }
          proposals.push({ ...item, id: randomUUID(), layout: ['wide', 'compact', 'side'].includes(item.layout) ? item.layout : 'wide' });
        }
      };
      for (const blocks of batches) { signal.throwIfAborted(); await planBatch(blocks, discarded); }
      // One repaired attempt, and only when the document would otherwise keep nothing: a
      // report that already has its figures does not need another call bought for it, and
      // the editorial selection deserves the last word. A planner that repeats the same
      // mistake ends here — this round rescues work, it does not keep asking.
      if (!proposals.length && discarded.some(item => repairableDocumentVisualDiscard(item.reason))) {
        const firstAttempt = [...discarded];
        const rescued = new Set<string>();
        for (const blocks of batches) {
          signal.throwIfAborted();
          const refused = firstAttempt.filter(item => blocks.some(block => block.id === item.blockId));
          if (!refused.length) continue;
          const before = proposals.length;
          await planBatch(blocks, discarded, refused);
          if (proposals.length > before) for (const item of refused) rescued.add(item.blockId);
        }
        // A figure the second attempt produced replaces the refusal that explained its
        // absence: telling the reader it was discarded would contradict the figure.
        for (let index = discarded.length - 1; index >= 0; index--) {
          if (firstAttempt.includes(discarded[index]) && rescued.has(discarded[index].blockId)) discarded.splice(index, 1);
        }
      }
      // A global selection sees all proposals for long documents without repeating prose.
      let selected = proposals;
      if (batches.length > 1 && proposals.length) {
        const ids = await completeJson<string[]>({ system: `${DOCUMENT_VISUAL_RULES}\nSelect only non-redundant, worthwhile figures across the whole document. Return a JSON array of supplied proposal ids, including [] when appropriate.`, user: JSON.stringify({ title: input.title, proposals }), maxTokens: 2000, noRetry: true, signal }, (value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string'), model);
        const kept = new Set(ids.filter(id => typeof id === 'string'));
        for (const proposal of proposals) if (!kept.has(proposal.id)) discarded.push({ blockId: proposal.blockId, skillId: proposal.skillId, reason: 'not-selected' });
        selected = proposals.filter(proposal => kept.has(proposal.id));
      }
      manifest.discarded = discarded;
      manifest.figures.push(...selected.map(item => ({ ...item, state: 'pending' as const })));
      logDiscards(discarded, manifest.figures.length, target);
    }
    manifest.state = 'generating'; persist();
    for (const figure of manifest.figures) {
      if (figure.state === 'ready') continue;
      signal.throwIfAborted();
      // A failed screenshot never requires buying the resource again. Its validated
      // view and attachment owner are checkpointed separately from its poster.
      if (request.retry && figure.view && figure.owner) {
        try {
          figure.poster = await snapshotDocumentFigure(figure.view, figure.owner, signal);
          figure.state = 'ready'; delete figure.error;
        } catch (error) { signal.throwIfAborted(); figure.state = 'failed'; figure.error = String(error); }
        persist(); continue;
      }
      const skill = skills.find(item => item.id === figure.skillId);
      if (!skill || !budget.remaining(figure.skillId)) { figure.state = 'failed'; figure.error = 'The skill is disabled or has reached its maximum.'; persist(); continue; }
      try {
        budget.reserve(skill.id);
        figure.state = 'running'; figure.owner = chatAssetOwner('document-figure', `${target.kind}:${target.id}:${manifest.revision}:${figure.id}`, vaultId); persist();
        const block = manifest.blocks.find(item => item.id === figure.blockId)!;
        const answer = await completeText({ system: `${buildChatSkillsPrompt([skill])}\n${DOCUMENT_VISUAL_RULES}\nProduce exactly ONE insertable resource for the requested figure. Only this skill is enabled. Return its complete output protocol; no additional figures or commentary. Use the supplied evidence only.`,
          user: JSON.stringify({ figure: figure.brief, caption: figure.caption, language: input.language, evidence: block.markdown }), maxTokens: 10_000, temperature: 0.2, noRetry: true, signal,
        }, model);
        const ids = new Set((skill.capabilities ?? []).map(normalizeCapabilityId));
        const allowed: CapabilityRegistrySnapshot = { ...registry, providers: new Map([...registry.providers].filter(([id]) => ids.has(id))), fences: new Map([...registry.fences].filter(([, value]) => ids.has(value.provider.id))), chatOrder: registry.chatOrder.filter(provider => ids.has(provider.id)) };
        if (splitChatVisuals(answer).filter(part => part.kind === 'svg' || part.kind === 'image-request' || part.kind === 'capability-request').length > 1) throw new Error('One generation may only request one resource.');
        let invocations = 0;
        const result = await executeSkillResources(answer, { skills: [skill], question: figure.brief, model, owner: figure.owner, version: chatAssetVersion(figure.owner), isCurrent: current, locale: input.language, pins, registry: allowed,
          beforeInvoke: () => { if (invocations++ > 0) budget.reserve(skill.id); }, beforePaidCall: () => budget.reserve(skill.id, 'paidCalls'), beforeRepair: () => budget.reserve(skill.id), maxSvgRepairs: 1,
        }, signal);
        figure.view = result.view; figure.artifactSources = result.artifactSources;
        persist();
        figure.poster = await snapshotDocumentFigure(result.view, figure.owner, signal);
        figure.state = 'ready'; delete figure.error; persist();
      } catch (error) {
        signal.throwIfAborted();
        figure.state = 'failed'; figure.error = error instanceof Error ? error.message : String(error); persist();
        // Per figure, not per document: a run that produced 38 of 40 figures is only
        // diagnosable if the two that failed say which brief and which model produced them.
        logPipelineFailure({
          error,
          code: 'extract_failed',
          subject: 'subjectFigureAnalysis',
          // A figure that fails says which engine ran it: without this the line named a
          // quota or a provider the reader had not chosen, with nothing to explain it.
          context: { scope: 'extraction', nodusId: `${target.kind}:${target.id}`, documentTitle: figure.caption ?? null, jobId: figure.id, provider: model?.provider ?? null, model: model?.model ?? null },
          detail: figure.brief,
        });
      }
    }
    manifest.state = manifest.figures.some(figure => figure.state !== 'ready') ? 'partial' : 'ready'; persist();
  } catch (error) {
    manifest.state = signal.aborted ? 'cancelled' : 'failed'; manifest.error = error instanceof Error ? error.message : String(error);
    logPipelineFailure({
      error,
      code: signal.aborted ? 'cancelled' : 'extract_failed',
      subject: 'subjectFigureAnalysis',
      context: { scope: 'extraction', nodusId: `${target.kind}:${target.id}`, provider: model?.provider ?? null, model: model?.model ?? null },
      detail: manifest.error,
    });
    if (current()) persist();
  } finally { running.delete(key); }
  return manifest;
}
