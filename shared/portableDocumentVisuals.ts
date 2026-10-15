import { blockSources, documentBlocks, documentSkillCatalog, DocumentSkillBudget, DOCUMENT_VISUAL_DISCARD_REASONS, DOCUMENT_VISUAL_RULES, documentVisualDiscardTally, documentVisualDiscardText, repairableDocumentVisualDiscard, validateDocumentSkillPolicy, type DocumentSkillOption, type DocumentSkillUsage, type DocumentSkillPolicy, type DocumentVisualDiscard, type DocumentVisualDiscardReason, type DocumentVisualManifest, type DocumentVisualSuggestion, type DocumentVisualTarget } from './documentSkills';
import { buildChatSkillsPrompt, splitChatVisuals, type ChatSkill } from './chatSkills';
import type { ModelRef } from './types';
import type { ViewDocumentV1 } from '../packages/capability-api/src/views';
import { normalizeCapabilityId } from '../skill-capabilities/contracts';
import { pipelineLogText, type PipelineLogText } from './pipelineLogMessages';
import type { DocumentVisualEnrichOptions } from './documentVisualEnrich';

export interface PortableDocumentVisualCall { system: string; user: string; maxTokens: number; temperature?: number; noRetry: true; signal?: AbortSignal }
export interface PortableDocumentVisualCompletion {
  completeJson<T>(options: PortableDocumentVisualCall, guard: (value: unknown) => value is T, model?: ModelRef | null): Promise<T>;
  completeText(options: PortableDocumentVisualCall, model?: ModelRef | null): Promise<string>;
}
export interface PortableVisualRegistry<Provider extends { id: string }> {
  providers: ReadonlyMap<string, Provider>;
  fences: ReadonlyMap<string, { provider: Provider; kind: 'request' | 'legacy' }>;
  chatOrder: readonly Provider[];
  problems: ReadonlyArray<{ pluginId: string; detail: string }>;
  revision: number;
}
export interface PortableDocumentVisualExecution<Provider extends { id: string }, Pins> {
  skills: ChatSkill[]; question: string; model: ModelRef | null; owner: string; version: number;
  isCurrent: () => boolean; locale: string; pins: Pins; registry: PortableVisualRegistry<Provider>;
  beforeInvoke: () => void; beforePaidCall: () => void; beforeRepair: () => void; maxSvgRepairs: number;
  /** After each budget callback, the resource host must flush before starting its effect. */
  flushPersist: () => Promise<void>;
}
export interface PortableDocumentVisualLog {
  error?: unknown; code: 'figure_skipped' | 'extract_failed' | 'cancelled'; subject: 'subjectFigureAnalysis';
  context: { scope: 'extraction'; nodusId: string; documentTitle?: string | null; jobId?: string; provider?: string | null; model?: string | null };
  message?: PipelineLogText; detail?: string;
}
export interface PortableDocumentVisualHost<Provider extends { id: string }, Pins> extends PortableDocumentVisualCompletion {
  input: { title: string; language: string; model?: ModelRef | null; fields: Record<string, string> };
  vaultId: string; model: ModelRef | null;
  catalog: () => DocumentSkillOption[];
  previous: DocumentVisualManifest | null;
  usage: Record<string, DocumentSkillUsage>;
  registryPins: () => { registry: PortableVisualRegistry<Provider>; pins: Pins };
  contentHash: (fields: Record<string, string>) => string;
  current: (manifest: DocumentVisualManifest) => boolean;
  /** Synchronous checkpoint staging; reservations must be staged before any provider effect. */
  persist: (manifest: DocumentVisualManifest) => void;
  /** Resolves only when every staged checkpoint is durable. Rejects on storage failure. */
  flushPersist: () => Promise<void>;
  retainPrevious: () => void;
  notify: (target: DocumentVisualTarget) => void;
  owner: (surface: string, conversationId: string, vaultId: string) => string;
  assetVersion: (owner: string) => number;
  executeResources: (answer: string, execution: PortableDocumentVisualExecution<Provider, Pins>, signal: AbortSignal) => Promise<{ view: ViewDocumentV1; artifactSources: string[] }>;
  snapshot: (view: ViewDocumentV1, owner: string, signal: AbortSignal) => Promise<string>;
  clock: () => string; id: () => string;
  logPipelineInfo: (record: PortableDocumentVisualLog) => void;
  logPipelineWarning: (record: PortableDocumentVisualLog) => void;
  logPipelineFailure: (record: PortableDocumentVisualLog) => void;
}

/** The same orientation text is injected before prose generation on both hosts. */
export function documentVisualPlanningText(catalog: string, hints: string[]): string {
  return catalog === '[]' ? '' : `${DOCUMENT_VISUAL_RULES}\nThe document has a later visual enrichment stage. While planning and writing, consider these optional capabilities and opportunities. Preserve the requested prose schema; do not execute resources, add placeholders, or promise a figure. The later editor may choose none.\nPermitted capabilities: ${catalog}\nOptional opportunities: ${JSON.stringify(hints)}`;
}

/**
 * One line per motive, with its count — and louder when nothing survived.
 *
 * A run that refused every proposal used to leave no trace at all, so the reader's
 * "no figures were needed" was the same sentence as "the app discarded what the model
 * proposed". A run that kept some figures is a normal success and logs quietly; one
 * that kept none is a warning, because that is the outcome somebody has to explain.
 */
function logDiscards(discarded: readonly DocumentVisualDiscard[], figures: number, target: DocumentVisualTarget, host: Pick<PortableDocumentVisualHost<{ id: string }, unknown>, 'logPipelineInfo' | 'logPipelineWarning'>): void {
  if (!discarded.length) return;
  const record = figures > 0 ? host.logPipelineInfo : host.logPipelineWarning;
  for (const { reason, count } of documentVisualDiscardTally(discarded)) {
    record({
      code: 'figure_skipped',
      subject: 'subjectFigureAnalysis',
      context: { scope: 'extraction', nodusId: `${target.kind}:${target.id}` },
      message: pipelineLogText('figuresDiscarded', { count, reason: { id: DOCUMENT_VISUAL_DISCARD_REASONS[reason] } }),
    });
  }
}

/** Early opportunities are optional, cheap and do not execute a skill. */
export async function preparePortableDocumentVisualHints(host: Pick<PortableDocumentVisualHost<{ id: string }, unknown>, 'catalog' | 'completeJson' | 'flushPersist'>, policy: DocumentSkillPolicy | undefined, objective: string, model?: ModelRef | null, signal?: AbortSignal): Promise<string[]> {
  if (!policy?.enabled || !policy.skills.some(skill => skill.enabled)) return [];
  const options = host.catalog();
  const validated = validateDocumentSkillPolicy(policy, options);
  try {
    await host.flushPersist();
    return await host.completeJson<string[]>({ system: `${DOCUMENT_VISUAL_RULES}\nYou are planning a document. Return a JSON array of brief possible visual opportunities, not finished figures. Zero opportunities is valid.`,
      user: JSON.stringify({ objective, skills: JSON.parse(documentSkillCatalog(options, validated)) }), maxTokens: 1200, temperature: 0.2, noRetry: true, signal,
    }, (value): value is string[] => Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.length < 1000), model);
  } catch { signal?.throwIfAborted(); return []; }
}

export async function enrichPortableDocumentVisuals<Provider extends { id: string }, Pins>(target: DocumentVisualTarget, policy: DocumentSkillPolicy, host: PortableDocumentVisualHost<Provider, Pins>, request: DocumentVisualEnrichOptions & { hints?: string[]; signal?: AbortSignal } = {}): Promise<DocumentVisualManifest> {
  const { input, vaultId, model } = host;
  const options = host.catalog(), validated = validateDocumentSkillPolicy(policy, options);
  const skills = options.filter(option => validated.enabled && validated.skills.some(item => item.enabled && item.skillId === option.skill.id)).map(option => option.skill);
  const previous = host.previous;
  const signal = request.signal ?? new AbortController().signal;
  const { registry, pins } = host.registryPins();
  const now = host.clock();
  const manifest: DocumentVisualManifest = {
    schemaVersion: 1, target, vaultId, revision: host.id(), contentHash: host.contentHash(input.fields), createdAt: now, updatedAt: now,
    state: 'planning', policy: validated, usage: host.usage, blocks: documentBlocks(input.fields),
    figures: request.retry ? structuredClone(previous?.figures ?? []).map(figure => figure.state === 'running' ? { ...figure, state: 'failed' as const, error: 'Interrupted request; retry explicitly.' } : figure) : structuredClone(previous?.figures.filter(figure => figure.state === 'ready') ?? []),
    // Kept across a retry: the refusals that explain why a block has no figure are still
    // the reason, and a retry only re-runs the figures it did not finish.
    discarded: request.retry ? structuredClone(previous?.discarded ?? []) : [],
  };
  const current = () => host.current(manifest);
  const persist = () => { if (!current()) throw new DOMException('The document was deleted or changed.', 'AbortError'); host.persist(manifest); host.notify(target); };
  const flushPersist = async () => {
    await host.flushPersist();
    signal.throwIfAborted();
    if (!current()) throw new DOMException('The document was deleted or changed.', 'AbortError');
  };
  const budget = new DocumentSkillBudget(validated, manifest.usage, persist);
  try {
    host.retainPrevious(); host.persist(manifest); host.notify(target);
    await flushPersist();
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
        await flushPersist();
        const suggested = await host.completeJson<DocumentVisualSuggestion[]>({
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
          proposals.push({ ...item, id: host.id(), layout: ['wide', 'compact', 'side'].includes(item.layout) ? item.layout : 'wide' });
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
        await flushPersist();
        const ids = await host.completeJson<string[]>({ system: `${DOCUMENT_VISUAL_RULES}\nSelect only non-redundant, worthwhile figures across the whole document. Return a JSON array of supplied proposal ids, including [] when appropriate.`, user: JSON.stringify({ title: input.title, proposals }), maxTokens: 2000, noRetry: true, signal }, (value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string'), model);
        const kept = new Set(ids.filter(id => typeof id === 'string'));
        for (const proposal of proposals) if (!kept.has(proposal.id)) discarded.push({ blockId: proposal.blockId, skillId: proposal.skillId, reason: 'not-selected' });
        selected = proposals.filter(proposal => kept.has(proposal.id));
      }
      manifest.discarded = discarded;
      manifest.figures.push(...selected.map(item => ({ ...item, state: 'pending' as const })));
      logDiscards(discarded, manifest.figures.length, target, host);
    }
    manifest.state = 'generating'; persist();
    for (const figure of manifest.figures) {
      if (figure.state === 'ready') continue;
      signal.throwIfAborted();
      // A failed screenshot never requires buying the resource again. Its validated
      // view and attachment owner are checkpointed separately from its poster.
      if (request.retry && figure.view && figure.owner) {
        try {
          await flushPersist();
          figure.poster = await host.snapshot(figure.view, figure.owner, signal);
          figure.state = 'ready'; delete figure.error;
        } catch (error) { signal.throwIfAborted(); figure.state = 'failed'; figure.error = String(error); }
        persist(); continue;
      }
      const skill = skills.find(item => item.id === figure.skillId);
      if (!skill || !budget.remaining(figure.skillId)) { figure.state = 'failed'; figure.error = 'The skill is disabled or has reached its maximum.'; persist(); continue; }
      try {
        budget.reserve(skill.id);
        figure.state = 'running'; figure.owner = host.owner('document-figure', `${target.kind}:${target.id}:${manifest.revision}:${figure.id}`, vaultId); persist();
        const block = manifest.blocks.find(item => item.id === figure.blockId)!;
        await flushPersist();
        const answer = await host.completeText({ system: `${buildChatSkillsPrompt([skill])}\n${DOCUMENT_VISUAL_RULES}\nProduce exactly ONE insertable resource for the requested figure. Only this skill is enabled. Return its complete output protocol; no additional figures or commentary. Use the supplied evidence only.`,
          user: JSON.stringify({ figure: figure.brief, caption: figure.caption, language: input.language, evidence: block.markdown }), maxTokens: 10_000, temperature: 0.2, noRetry: true, signal,
        }, model);
        const ids = new Set((skill.capabilities ?? []).map(normalizeCapabilityId));
        const allowed: PortableVisualRegistry<Provider> = { ...registry, providers: new Map([...registry.providers].filter(([id]) => ids.has(id))), fences: new Map([...registry.fences].filter(([, value]) => ids.has(value.provider.id))), chatOrder: registry.chatOrder.filter(provider => ids.has(provider.id)) };
        if (splitChatVisuals(answer).filter(part => part.kind === 'svg' || part.kind === 'image-request' || part.kind === 'capability-request').length > 1) throw new Error('One generation may only request one resource.');
        let invocations = 0;
        await flushPersist();
        const result = await host.executeResources(answer, { skills: [skill], question: figure.brief, model, owner: figure.owner, version: host.assetVersion(figure.owner), isCurrent: current, locale: input.language, pins, registry: allowed,
          beforeInvoke: () => { if (invocations++ > 0) budget.reserve(skill.id); }, beforePaidCall: () => budget.reserve(skill.id, 'paidCalls'), beforeRepair: () => budget.reserve(skill.id), maxSvgRepairs: 1, flushPersist,
        }, signal);
        figure.view = result.view; figure.artifactSources = result.artifactSources;
        persist();
        await flushPersist();
        figure.poster = await host.snapshot(result.view, figure.owner, signal);
        figure.state = 'ready'; delete figure.error; persist();
      } catch (error) {
        signal.throwIfAborted();
        figure.state = 'failed'; figure.error = error instanceof Error ? error.message : String(error); persist();
        // Per figure, not per document: a run that produced 38 of 40 figures is only
        // diagnosable if the two that failed say which brief and which model produced them.
        host.logPipelineFailure({
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
    host.logPipelineFailure({
      error,
      code: signal.aborted ? 'cancelled' : 'extract_failed',
      subject: 'subjectFigureAnalysis',
      context: { scope: 'extraction', nodusId: `${target.kind}:${target.id}`, provider: model?.provider ?? null, model: model?.model ?? null },
      detail: manifest.error,
    });
    if (current()) persist();
  }
  await host.flushPersist();
  return manifest;
}
