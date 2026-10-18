import type {
  DictionaryGenerationRequest,
  DictionaryProgress,
  DictionaryVersion,
} from "@shared/dictionary";

export type DictionaryGenerationProgressReporter = (
  progress: DictionaryProgress,
) => void;

export type DictionaryGenerationExecutor = (
  request: DictionaryGenerationRequest,
  report: DictionaryGenerationProgressReporter,
) => Promise<DictionaryVersion | void>;

const isRunning = (progress: DictionaryProgress): boolean =>
  !["done", "degraded", "failed", "paused", "cancelled"].includes(progress.phase);

const MAX_TRANSIENT_RETRIES = 2;

function retriable(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { retriable?: unknown }).retriable === true;
}

const retryDelay = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));

/**
 * Owns the lifetime of background Dictionary work independently from any
 * renderer. Every entry gets its own scheduled execution, so starting a batch
 * does not serialize retrieval or synthesis behind the preceding entry.
 */
export class DictionaryGenerationQueue {
  readonly #jobs = new Map<string, DictionaryProgress>();
  readonly #tokens = new Map<string, symbol>();

  constructor(
    private readonly execute: DictionaryGenerationExecutor,
    private readonly publish: DictionaryGenerationProgressReporter,
  ) {}

  start(request: DictionaryGenerationRequest): DictionaryProgress {
    const running = this.#jobs.get(request.entryId);
    if (running && isRunning(running)) return running;

    const token = Symbol(request.entryId);
    const queued: DictionaryProgress = {
      entryId: request.entryId,
      mode: request.mode,
      phase: "queued",
      message: "En cola",
    };
    this.#tokens.set(request.entryId, token);
    this.#set(queued, token);

    setImmediate(() => {
      void this.#run(request, token).catch(() => { /* The terminal progress is already published. */ });
    });
    return queued;
  }

  list(): DictionaryProgress[] {
    return [...this.#jobs.values()];
  }

  /** Continuation uses the same owner, progress events and per-entry queue as
   * initial generation. The stopped worker's late events cannot replace it. */
  async run(request: DictionaryGenerationRequest): Promise<DictionaryVersion | void> {
    const current = this.#jobs.get(request.entryId);
    if (current && isRunning(current) && (!request.runId || current.researchRun?.id !== request.runId)) throw new Error('research_run_already_running');
    const token = Symbol(request.entryId);
    this.#tokens.set(request.entryId, token);
    this.#set({ entryId: request.entryId, mode: request.mode, phase: 'queued', message: 'En cola' }, token);
    return this.#run(request, token);
  }

  delete(entryIds: Iterable<string>): void {
    for (const entryId of entryIds) {
      this.#tokens.delete(entryId);
      this.#jobs.delete(entryId);
    }
  }

  async #run(
    request: DictionaryGenerationRequest,
    token: symbol,
  ): Promise<DictionaryVersion | void> {
    let researchRun: DictionaryProgress['researchRun'];
    const report = (progress: DictionaryProgress) => {
      researchRun = progress.researchRun ?? researchRun;
      this.#set({ ...progress, mode: request.mode, ...(researchRun ? { researchRun } : {}) }, token);
    };
    for (let attempt = 0; ; attempt += 1) {
      try {
        if (this.#tokens.get(request.entryId) !== token) return;
        const result = await this.execute({ ...request, ...(researchRun ? { runId: researchRun.id } : {}) }, report);
        researchRun = result?.researchRun ?? researchRun;
        if (result?.outcome === "degraded") {
          report({
            entryId: request.entryId,
            mode: request.mode,
            phase: "degraded",
            message: "La síntesis necesita revisión",
            error: result.generationProblems.join(" · "),
            degradationReason: result.degradationReason ?? undefined,
            attempts: result.generationAttempts,
          });
          return result;
        }
        report({
          entryId: request.entryId,
          mode: request.mode,
          phase: "done",
          message: "Definición generada",
        });
        return result;
      } catch (error) {
        if (this.#tokens.get(request.entryId) !== token) return;
        const interrupted = researchRun?.status === 'paused' || researchRun?.status === 'cancelled';
        if (!interrupted && retriable(error) && attempt < MAX_TRANSIENT_RETRIES) {
          report({
            entryId: request.entryId,
            mode: request.mode,
            phase: "queued",
            message: "En cola",
          });
          await retryDelay(attempt);
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        if (!interrupted) console.error(
          `[dictionary] background generation failed for ${request.entryId}`,
          error,
        );
        report({
          entryId: request.entryId,
          mode: request.mode,
          phase: interrupted ? researchRun!.status as 'paused' | 'cancelled' : "failed",
          message: interrupted ? researchRun!.status === 'paused' ? 'En pausa' : 'Cancelada' : "Error al generar",
          ...(!interrupted ? { error: detail } : {}),
        });
        throw error;
      }
    }
  }

  #set(progress: DictionaryProgress, token: symbol): void {
    if (this.#tokens.get(progress.entryId) !== token) return;
    this.#jobs.set(progress.entryId, progress);
    this.publish(progress);
  }
}
