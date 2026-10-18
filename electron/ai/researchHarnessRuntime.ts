import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { ResearchAgenda, researchCanonical, type ResearchRunContext, type ResearchRunSummary, type ResearchRunStatus, type ResearchStopReason } from '@shared/researchHarness';
import { getResearchRun, saveResearchRun, type ResearchRunRecord } from '../db/researchRunsRepo';
import { getDb } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getSettings } from '../db/settingsRepo';
import type { ResolvedResearchScope } from '@shared/researchCorpus';

const active = new AsyncLocalStorage<ResearchHarness>();
const running = new Map<string, ResearchHarness>();
const listeners = new Set<(summary: ResearchRunSummary) => void>();
export function onResearchRunUpdate(listener: (summary: ResearchRunSummary) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export const researchRunIsActive = (id: string) => running.has(id);
const hash = (value: unknown) => createHash('sha256').update(researchCanonical(value)).digest('hex');
export const currentResearchHarness = () => active.getStore();
export function researchHarnessEnabled(request: { harnessVersion?: 'v1' | 'legacy'; runId?: string }): boolean {
  return !!request.runId || (request.harnessVersion ?? getSettings().researchHarnessVersion ?? 'v1') === 'v1';
}

export class ResearchHarness {
  corpus?: import('./researchCorpusRun').ResearchCorpusRun;
  readonly agenda: ResearchAgenda;
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly record: ResearchRunRecord;
  readonly settled: Promise<void>;
  private resolveSettled!: () => void;
  private closed = false;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly validateScope: () => void;
  constructor(record: ResearchRunRecord, signal: AbortSignal | undefined, validate: () => void, readonly emit?: (summary: ResearchRunSummary) => void) {
    this.record = record; this.validateScope = validate;
    this.settled = new Promise(resolve => { this.resolveSettled = resolve; });
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    this.agenda = new ResearchAgenda(record.context.objective);
    const agenda = record.checkpoint.agenda as Parameters<ResearchAgenda['restore']>[0] | undefined;
    if (agenda) this.agenda.restore(agenda);
    this.record.summary.status = 'running'; delete this.record.summary.stopReason;
  }
  validateAuthorization(): void { if (this.closed) throw new Error('research_run_closed'); this.validateScope(); }
  validate(): void { this.signal.throwIfAborted(); this.validateAuthorization(); }
  close(): void { this.closed = true; this.controller.abort(new Error('research_run_closed')); this.resolveSettled(); }
  reserveModelCall(): void {
    this.validate();
    const limit = this.record.context.mode === 'chat' ? 32 : 256;
    const used = this.record.summary.usage.modelCalls ?? 0;
    if (used >= limit) { this.record.summary.stopReason = 'budget'; this.persist(); throw new Error('research_run_budget_exhausted'); }
    this.record.summary.usage.modelCalls = used + 1; this.persist();
  }
  summary(): ResearchRunSummary {
    return { ...this.record.summary, questions: structuredClone(this.agenda.questions), tasks: structuredClone(this.agenda.tasks) };
  }
  persist(): void {
    if (this.closed) throw new Error('research_run_closed');
    this.validateScope();
    this.record.checkpoint.agenda = { tasks: this.agenda.tasks, questions: this.agenda.questions, stagnant: this.agenda.stagnant, strategyChanges: this.agenda.strategyChanges };
    this.record.summary = { ...this.summary(), updatedAt: new Date().toISOString() };
    saveResearchRun(this.record);
    try { this.emit?.(this.summary()); } catch { /* Observers cannot fail research. */ }
    for (const listener of listeners) { try { listener(this.summary()); } catch { /* Best-effort UI events. */ } }
  }
  stop(status: ResearchRunStatus, reason?: ResearchStopReason): void {
    if (status === 'completed') this.agenda.finalize(reason);
    this.record.summary.status = status; this.record.summary.stopReason = reason;
    this.persist();
  }
  /** Exact input lookup for explicitly compatible application-stage contracts.
   * The caller must validate the cached value against its current output contract. */
  cachedStage(name: string, input: unknown): { found: boolean; value?: unknown } {
    this.validate(); const key = `${name}:${hash(input)}`;
    return Object.hasOwn(this.record.stages, key) ? { found: true, value: structuredClone(this.record.stages[key]) } : { found: false };
  }
  /** Cache completed semantic phases, never provider reasoning or half-written output. */
  async stage<T>(name: string, input: unknown, generate: () => Promise<T>): Promise<T> {
    this.validate();
    const key = `${name}:${hash(input)}`;
    const unavailableReview = name.startsWith('coherent-answer-review-') && this.record.checkpoint.validationLimited;
    if (!unavailableReview && Object.hasOwn(this.record.stages, key)) return structuredClone(this.record.stages[key]) as T;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = (async () => {
      const value = await generate(); this.validate();
      // The bounded application stages are JSON data, not executable directives.
      if (!(name.startsWith('coherent-answer-review-') && this.record.checkpoint.validationLimited)) this.record.stages[key] = value === undefined ? null : structuredClone(value);
      this.persist();
      return value;
    })();
    this.inflight.set(key, promise);
    try { return await promise; } finally { this.inflight.delete(key); }
  }
}

export function interruptResearchRun(id: string, cancel = false): ResearchRunSummary | null {
  const live = running.get(id);
  const record = live?.record ?? getResearchRun(id);
  if (!record || record.context.vaultId !== getActiveVault().id) return null;
  if (['completed', 'cancelled'].includes(record.summary.status)) return record.summary;
  if (live) {
    live.stop(cancel ? 'cancelled' : 'paused', 'interrupted');
    live.controller.abort(new Error(cancel ? 'research_run_cancelled' : 'research_run_paused'));
    return live.summary();
  }
  record.summary.status = cancel ? 'cancelled' : 'paused'; record.summary.stopReason = 'interrupted'; saveResearchRun(record);
  return record.summary;
}
export async function waitForResearchRunStop(id: string): Promise<void> { await running.get(id)?.settled; }

export async function withResearchHarness<T extends object>(input: {
  request: { runId?: string; conversationId?: string };
  context: ResearchRunContext;
  scope: ResolvedResearchScope;
  signal?: AbortSignal;
  validate: () => void;
  onUpdate?: (summary: ResearchRunSummary) => void;
}, body: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (active.getStore()) return body(active.getStore()!.signal);
  const { runId, ...requested } = input.request;
  // Freeze the resolved profile in the durable request. Changing a UI preference
  // cannot silently alter an investigation that is subsequently continued.
  const request = { ...requested, ...(input.context.explorationMode ? { explorationMode: input.context.explorationMode } : {}) };
  const requestKey = hash({ request, context: input.context });
  let record = runId ? getResearchRun(runId) : null;
  if (runId && (!record || record.context.vaultId !== input.context.vaultId || record.context.mode !== input.context.mode
    || record.context.entryId !== input.context.entryId
    || record.conversationId !== request.conversationId)) throw new Error('research_run_not_authorized');
  if (record && record.requestKey !== requestKey) {
    if (!['completed', 'cancelled'].includes(record.summary.status)) { record.summary.status = 'paused'; record.summary.stopReason = 'context_changed'; saveResearchRun(record); }
    throw new Error('research_run_context_changed');
  }
  input.validate();
  if (record?.summary.status === 'cancelled') throw new Error('research_run_cancelled');
  // Older preview builds completed even when document verification failed
  // technically. Such a run may retry verification through normal continuation.
  if (record?.summary.status === 'completed' && record.result && !(record.checkpoint.documentReview as { technicalFailure?: string } | undefined)?.technicalFailure) return structuredClone(record.result) as T;
  if (runId && running.has(runId)) throw new Error('research_run_already_running');
  if (input.context.mode === 'dictionary' && [...running.values()].some(run => run.record.context.mode === 'dictionary' && run.record.context.entryId === input.context.entryId)) throw new Error('research_run_already_running');
  record ??= { context: input.context, request, requestKey, conversationId: request.conversationId, checkpoint: {}, stages: {},
    summary: { id: randomUUID(), conversationId: request.conversationId, entryId: input.context.entryId, version: 'v1', mode: input.context.mode, explorationMode: input.context.explorationMode, objective: input.context.objective, status: 'running', questions: [], tasks: [],
      usage: { rounds: 0, evidenceBytes: 0, decisionBytes: 0 }, updatedAt: new Date().toISOString() } };
  const harness = new ResearchHarness(record, input.signal, input.validate, input.onUpdate);
  // scopeId fingerprints the full authorized inventory; keep identities/revisions,
  // not a second copy of a potentially 14,000-document inventory in every checkpoint.
  harness.record.checkpoint.scopeId = input.scope.id;
  running.set(record.summary.id, harness);
  return active.run(harness, async () => {
    try {
      harness.persist();
      if (record.context.model) {
        const { researchModelContextWindow } = await import('./aiClient');
        let window = await researchModelContextWindow(record.context.model);
        if (!window.known) {
          // API/MCP requests need the same real catalogue metadata as the model
          // picker. The fallback operating cap is not the model's actual window.
          const { getApiKey } = await import('../secrets/secretStore');
          const key = getApiKey(record.context.model.provider);
          if (key) {
            try {
              const { listModels } = await import('./providers');
              await listModels(record.context.model.provider, key, AbortSignal.any([harness.signal, AbortSignal.timeout(5000)]));
              window = await researchModelContextWindow(record.context.model);
            } catch { harness.validate(); /* Keep the conservative bound, never invent capacity. */ }
          }
        }
        record.checkpoint.modelContext = window;
      }
      const result = await body(harness.signal);
      if (harness.signal.aborted) harness.stop(record.summary.status === 'cancelled' ? 'cancelled' : 'paused', 'interrupted');
      else {
        const reviewedChat = record.context.mode === 'chat' && (record.checkpoint.answerReview as { status?: string } | undefined)?.status === 'verified';
        const sufficient = !record.checkpoint.validationLimited && (record.checkpoint.direct || reviewedChat || harness.agenda.canFinish());
        const documentFailure = (record.checkpoint.documentReview as { technicalFailure?: string } | undefined)?.technicalFailure;
        const unavailable = Boolean(documentFailure || (record.checkpoint.answerReview as { reviews?: Array<{ attempts?: Array<{ issues: string[] }> }> } | undefined)?.reviews?.some(review => review.attempts?.some(attempt => attempt.issues.includes('verification_unavailable'))));
        const reason = documentFailure ? /budget_exhausted/u.test(documentFailure) ? 'budget' : 'technical' : record.summary.stopReason;
        harness.stop(reason === 'technical' || unavailable ? 'failed' : 'completed', reason === 'sufficient' && !sufficient ? 'sources_exhausted' : reason ?? (sufficient ? 'sufficient' : 'sources_exhausted'));
      }
      const summary = harness.summary();
      // Additive metadata keeps existing result and archive shapes compatible.
      const output = result as T & { researchRun?: ResearchRunSummary; stats?: { researchRun?: ResearchRunSummary }; meta?: { researchRun?: ResearchRunSummary }; draft?: { researchRun?: ResearchRunSummary }; plan?: { researchRun?: ResearchRunSummary } };
      output.researchRun = summary;
      if (output.stats) output.stats.researchRun = summary;
      if (output.meta) output.meta.researchRun = summary;
      if (output.draft) output.draft.researchRun = summary;
      if (output.plan) {
        output.plan.researchRun = summary;
        if (record.artifactId) getDb().prepare('UPDATE immersion_sessions SET plan_json=? WHERE id=?').run(JSON.stringify(output.plan), record.artifactId);
      }
      record.result = output; harness.persist();
      return output;
    } catch (error) {
      const contextChanged = /scope_changed|context_changed|not_authorized|revision_changed/.test(error instanceof Error ? error.message : '');
      try { harness.stop(harness.signal.aborted || contextChanged ? (record.summary.status === 'cancelled' ? 'cancelled' : 'paused') : 'failed', contextChanged ? 'context_changed' : harness.signal.aborted ? 'interrupted' : record.summary.stopReason === 'budget' ? 'budget' : 'technical'); }
      catch {
        // Only metadata is settled after a same-vault revocation. A switched vault
        // must never receive the old run's checkpoint.
        if (contextChanged && getActiveVault().id === record.context.vaultId && getResearchRun(record.summary.id)) saveResearchRun(record);
      }
      throw error;
    } finally { running.delete(record.summary.id); harness.close(); }
  });
}

export const researchHarnessStage = <T>(name: string, input: unknown, body: () => Promise<T>): Promise<T> => currentResearchHarness()?.stage(name, input, body) ?? body();
