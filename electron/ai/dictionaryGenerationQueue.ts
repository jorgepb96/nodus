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
  !["done", "degraded", "failed"].includes(progress.phase);

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
    private readonly bindExecution: (work: () => Promise<void>) => () => Promise<void> = work => work,
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

    const execute = this.bindExecution(() => this.#run(request, token));
    setImmediate(() => { void execute(); });
    return queued;
  }

  list(): DictionaryProgress[] {
    return [...this.#jobs.values()];
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
  ): Promise<void> {
    const report = (progress: DictionaryProgress) =>
      this.#set({ ...progress, mode: request.mode }, token);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.execute(request, report);
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
          return;
        }
        report({
          entryId: request.entryId,
          mode: request.mode,
          phase: "done",
          message: "Definición generada",
        });
        return;
      } catch (error) {
        if (retriable(error) && attempt < MAX_TRANSIENT_RETRIES) {
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
        console.error(
          `[dictionary] background generation failed for ${request.entryId}`,
          error,
        );
        report({
          entryId: request.entryId,
          mode: request.mode,
          phase: "failed",
          message: "Error al generar",
          error: detail,
        });
        return;
      }
    }
  }

  #set(progress: DictionaryProgress, token: symbol): void {
    if (this.#tokens.get(progress.entryId) !== token) return;
    this.#jobs.set(progress.entryId, progress);
    this.publish(progress);
  }
}
