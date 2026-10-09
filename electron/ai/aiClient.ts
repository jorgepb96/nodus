import { currentResearchRequestBudget, researchPromptUpperBound } from './researchRequestBudget';
import { documentedContextWindow } from '@shared/providerContextWindows';
import { withJobThinking } from './thinkingEffort';
import { researchReasoningBody, researchOmitsTemperature, type ResearchEffort } from '@shared/researchReasoning';
import { getSettings } from '../db/settingsRepo';
import { documentVisualPlanningPrompt } from './documentVisualContext';
import { jobOutputLanguage } from './jobOutputLanguage';
import { recordProviderUsage } from './usageMeter';
import { excludeInvisibleArtifacts } from '../capabilities/modelHistory';
import { getApiKey } from '../secrets/secretStore';
import {
  openAiCompatBase,
  supportsJsonMode,
  reasoningBody,
  samplingTemperatureBody,
  completionTokensBody,
  openRouterRoutingBody,
  OPENROUTER_HEADERS,
  isLocalProvider,
  localContextWindow,
  cachedModelContextWindow,
  localContextCapabilities,
  localBaseUrl,
  customBaseUrl,
  FREE_TIER_PROVIDERS,
  freeTierMaxTokens,
  groqFreeTpm,
  isGroqReasoningModel,
} from './providers';
import { DEFAULT_EMBEDDING_MODELS, isLocalEndpointAddress, normalizeEmbeddingModel, PROVIDER_LABELS } from '@shared/providers';
import type { AiProvider, CodexReasoningEffort, EmbeddingProvider, LocalProvider, ModelRef, PromptLanguage, ReasoningEffort } from '@shared/types';
import { vaultTypePromptPack } from '@shared/vaultTypes';
import { codexReasoningFor } from '@shared/codexReasoning';
import { anthropicVisionContent, openAiVisionContent, type VisionImagePart } from '@shared/imageAnalysis';
import { getActiveVault } from '../vaults/vaultRegistry';
import { jsonrepair } from 'jsonrepair';
import { perfLogNs, startPerf, type PerfContext } from '../perf';
import {
  embedWithNodusLocal,
  ensureNodusLocalServer,
  getNodusLocalSafeSlots,
  withNodusLocalServerLease,
} from './nodusLocalAi';
import { getNodusLocalModel } from '@shared/localAiModels';
import { currentPrivacyScope, type ActivePrivacyScope } from './studentPrivacyContext';
import {
  anonymizeText,
  createStreamDeanonymizer,
  deanonymizeDeep,
  findResidualNames,
} from '@shared/studentPseudonyms';
import { classifyProviderError, isTransientNetworkFailure, rejectsOptionalBodyWithoutNaming, rejectsOptionalTransportField, shouldRetryWithoutOptionalFields } from './providerErrors';
import { temperatureUnsupported } from './samplingSupport';
import { thinkingCatalogFor, withThinkingCompatibility } from './thinkingCompatibility';
import {
  optionalBodyUnsupported,
  reasoningHintUnsupported,
  rememberOptionalBodyUnsupported,
  rememberReasoningHintUnsupported,
} from './optionalFieldsSupport';
import { completeWithChatGptSubscription } from './codexSubscription';
import { completeWithGitHubCopilotSubscription } from './githubCopilotSubscription';
import { completeWithOpenCodeGo, OUTPUT_TRUNCATED_MARKER } from './openCodeGoCompletion';
import { nodusUserAgent, openCodeGoSessionId } from './clientIdentity';
import { recordOpenCodeGoUsage } from './openCodeGoUsage';
import { AI_MODEL_REQUIRED_ERROR_CODE } from '@shared/aiModelRequired';
import { createHash } from 'node:crypto';
import {
  logPipelineFailure,
  logPipelineWarning,
  type PipelineLogCode,
  type PipelineLogSubjectId,
} from '../logging/pipelineLogCore';
import {
  AiRequestScheduler,
  type AiRequestClass,
  type AiRequestDescriptor,
} from './aiRequestGate';
import type { AiConcurrencySnapshot } from '@shared/types';
import { orderedEmbeddingEntries, requestEmbeddingBatchWithBisection, validateEmbeddingVectors } from './strictEmbeddings';
import {
  geminiBatchEmbeddingEndpoint,
  geminiBatchEmbeddingRequest,
  parseGeminiBatchEmbeddingResponse,
} from './geminiEmbeddings';
import { completeGeminiDeterministicJson } from './geminiDeterministicCompletion';
import { withIdleTransportDeadline, withTransportDeadline } from './transportDeadline';
import {
  buildLocalRequestPlan,
  recordLocalAiDiagnostic,
  type LocalAiTask,
  type LocalRequestPlan,
} from './localRequestPlanner';
import { completeLocalNative, LocalNativeUnavailableError, streamLocalNative } from './localNativeCompletion';

const concurrencyListeners = new Set<(snapshots: AiConcurrencySnapshot[]) => void>();
const concurrencyTelemetry = new Map<string, string>();

function concurrencyPolicy(descriptor: AiRequestDescriptor) {
  const settings = getSettings();
  const manualLimit = Math.max(1, Math.min(8, Math.trunc(settings.concurrency || 1)));
  if (settings.aiConcurrencyMode !== 'automatic') {
    return { mode: 'manual' as const, initial: manualLimit, maximum: manualLimit, manualLimit };
  }
  if (settings.providerFreeTier?.[descriptor.provider as AiProvider]) {
    return { mode: 'automatic' as const, initial: 1, maximum: 1, manualLimit };
  }
  // Only providers that pass the release campaign receive the accelerated 4→8
  // policy. Every other remote surface remains serial even though the UI default
  // is Automatic; certification can widen this allowlist in a later release.
  if (descriptor.provider === 'gemini' || descriptor.provider === 'deepseek') {
    return { mode: 'automatic' as const, initial: 4, maximum: 8, manualLimit };
  }
  if (descriptor.provider === 'nodus') {
    return { mode: 'automatic' as const, initial: 1, maximum: getNodusLocalSafeSlots(descriptor.model), manualLimit };
  }
  // Embedding batches are idempotent and metered apart from chat. Serial requests left
  // document indexing waiting on one round trip at a time; the first 429 still halves
  // the limit and holds it there, and any chat request on the account clamps it to 1.
  if (descriptor.requestClass === 'embedding' && descriptor.provider !== 'ollama' && descriptor.provider !== 'lmstudio') {
    return { mode: 'automatic' as const, initial: 2, maximum: 4, manualLimit };
  }
  if (descriptor.provider === 'ollama' || descriptor.provider === 'lmstudio') {
    return { mode: 'automatic' as const, initial: 1, maximum: 1, manualLimit };
  }
  return { mode: 'automatic' as const, initial: 1, maximum: 1, manualLimit };
}

const aiRequestScheduler = new AiRequestScheduler({
  globalLimit: 12,
  policyFor: concurrencyPolicy,
  onSnapshot: (snapshots) => {
    for (const snapshot of snapshots) {
      const key = `${snapshot.provider}\u0000${snapshot.model}`;
      const fingerprint = JSON.stringify({
        currentLimit: snapshot.currentLimit,
        maximumLimit: snapshot.maximumLimit,
        cooldownUntil: snapshot.cooldownUntil,
        lastChangeReason: snapshot.lastChangeReason,
      });
      if (concurrencyTelemetry.get(key) === fingerprint) continue;
      concurrencyTelemetry.set(key, fingerprint);
      perfLogNs('AI concurrency change', 0n, {}, {
        provider: snapshot.provider,
        model: snapshot.model,
        active: snapshot.active,
        queued: snapshot.queued,
        currentLimit: snapshot.currentLimit,
        maximumLimit: snapshot.maximumLimit,
        cooldownUntil: snapshot.cooldownUntil,
        reason: snapshot.lastChangeReason,
      });
    }
    for (const listener of concurrencyListeners) listener(snapshots);
  },
});

export function getAiConcurrencySnapshot(): AiConcurrencySnapshot[] {
  return aiRequestScheduler.snapshots();
}

export function refreshAiConcurrencyPolicy(): void {
  aiRequestScheduler.reconfigure();
}

export function onAiConcurrencySnapshot(listener: (snapshots: AiConcurrencySnapshot[]) => void): () => void {
  concurrencyListeners.add(listener);
  return () => concurrencyListeners.delete(listener);
}

function credentialScope(provider: string, key: string | null, endpoint?: string | null): string {
  return createHash('sha256').update(`${provider}\u0000${key ?? 'subscription'}\u0000${endpoint ?? ''}`).digest('hex').slice(0, 16);
}

function providerRequestDescriptor(
  model: ModelRef,
  opts: CallOpts,
  key: string | null,
  endpoint: string | null | undefined,
): AiRequestDescriptor {
  return {
    provider: model.provider,
    model: model.model,
    credentialScope: credentialScope(model.provider, key, endpoint),
    endpoint,
    requestClass: opts.requestClass ?? 'interactive',
    estimatedInputTokens: estimateLocalTokens(opts.system) + estimateLocalTokens(opts.user),
    estimatedOutputTokens: opts.maxTokens,
    signal: opts.signal,
    jobId: opts.jobId,
  };
}

function observeProviderQuota(
  model: ModelRef,
  opts: CallOpts,
  key: string | null,
  endpoint: string | null | undefined,
  headers: Headers,
): void {
  aiRequestScheduler.observeQuota(providerRequestDescriptor(model, opts, key, endpoint), headers);
}

function scheduleProviderRequest<T>(
  model: ModelRef,
  opts: CallOpts,
  key: string | null,
  endpoint: string | null | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const queuedAt = process.hrtime.bigint();
  const requestHash = providerRequestHash(model, opts);
  return aiRequestScheduler.run(providerRequestDescriptor(model, opts, key, endpoint), async () => {
    const startedAt = process.hrtime.bigint();
    const meta = {
      provider: model.provider,
      model: model.model,
      class: opts.requestClass ?? 'interactive',
      jobId: opts.jobId ?? null,
      requestHash,
    };
    perfLogNs('AI queue wait', startedAt - queuedAt, opts.perf, meta);
    try {
      return await task();
    } finally {
      perfLogNs('AI inference', process.hrtime.bigint() - startedAt, opts.perf, meta);
    }
  });
}

function providerRequestHash(model: ModelRef, opts: CallOpts): string {
  return createHash('sha256').update(JSON.stringify({
    provider: model.provider,
    model: model.model,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature ?? null,
    maxTokens: opts.maxTokens ?? null,
    reasoning: opts.reasoning ?? null,
    ...(opts.researchEffort !== undefined ? { researchEffort: opts.researchEffort } : {}),
    deterministic: opts.deterministic ?? false,
    images: opts.images?.map((part) => ({
      mediaType: part.mediaType,
      sha256: createHash('sha256').update(part.base64).digest('hex'),
    })) ?? [],
  })).digest('hex');
}

export class AiError extends Error {
  /**
   * @param retriable transient provider error (rate limit / 5xx) — worth a backoff retry.
   * @param config    misconfiguration (no model / no key) — the SAME for every job, so the
   *                  queue should pause and surface it once instead of failing every item.
   * @param code      which failure this is. The transport branches below fill it in so the
   *                  processing log can carry a stable, language-neutral badge (and so the
   *                  recovery strategies can match a tag instead of provider prose).
   */
  constructor(
    message: string,
    public retriable = false,
    public config = false,
    public code: 'output_truncated' | 'invalid_json' | 'schema_mismatch' | 'timeout' | 'provider_empty_error'
      | 'context_overflow' | 'rate_limit' | 'provider_5xx' | 'auth' | 'bad_request' | 'connection'
      | typeof AI_MODEL_REQUIRED_ERROR_CODE | null = null,
  ) {
    super(message);
  }
}

/** Subscription providers carry no HTTP status, so `wrapProviderError` cannot read
 *  them. They classify themselves instead — see `providerErrors.ts`. */
function subscriptionError(error: unknown): AiError {
  const { message, retriable, config } = classifyProviderError(error);
  const wrapped = new AiError(message, retriable, config);
  logProviderFailure(wrapped, error);
  return wrapped;
}

/**
 * The subscription runtimes accept no `response_format`, so JSON mode can only be
 * asked for in words. Without this `jsonMode` was silently inert for them and every
 * structured call leaned entirely on the repair round-trip.
 */
function withJsonModeDirective(system: string, jsonMode: boolean): string {
  if (!jsonMode) return system;
  return `${system}\n\nReturn only a single valid JSON value. No prose, no explanation, no Markdown code fences.`;
}

/** Stored key for a provider, or a harmless placeholder for local providers
 *  (Ollama / LM Studio need no key; the OpenAI SDK still requires a non-empty
 *  string). A user-supplied token for a secured local instance takes precedence. */
const CUSTOM_ENDPOINT_MISSING =
  'Falta la dirección del servidor compatible con OpenAI. Configúrala en Ajustes → Proveedores.';

function resolveProviderKey(provider: AiProvider): string | null {
  const stored = getApiKey(provider);
  if (stored) return stored;
  // A gateway on the user's own machine usually authenticates nobody, and the
  // OpenAI SDK refuses to construct without an apiKey — so these providers get the
  // same placeholder bearer the local ones have always sent. A real key, when the
  // user stores one, is returned above and takes its place.
  return isLocalProvider(provider) || provider === 'nodus' || provider === 'custom' ? 'local' : null;
}

// ── Local model context budgeting ────────────────────────────────────────────
// Cloud models expose huge context windows and manage the prompt server-side, so
// Nodus's large prompts (a scan can be tens of thousands of tokens) fit fine. Local
// servers load a model with a small, fixed window (LM Studio defaults to 4096), so
// the same prompt overflows with a cryptic "n_keep >= n_ctx". These helpers size
// max_tokens to the real window and refuse up front with an actionable message.

/** Safety floor for the built-in Nodus runtime only. This is neither a context window
 * nor a task output target; it is the minimum free generation room before refusing a
 * request whose prompt already occupies virtually the entire loaded context. */
const MIN_NODUS_LOCAL_OUTPUT_ROOM_TOKENS = 512;

/**
 * Pessimistic token estimate, used only by the local-model guards below.
 *
 * "~4 chars per token" describes English prose and nothing else, and these guards mostly see
 * the opposite: a database profile is `Fecha (number) · min 1945, max 2024`, ids like
 * `LV001-FG001`, URL-encoded paths like `BD%20Fotograf%C3%ADas`. Measured against qwen2.5,
 * that content runs at **2.4 chars/token** and URL-encoded runs at **1.7** — so the old
 * estimate was 41% low, the guard waved a 5,377-token prompt into a 4,096 window, and Ollama
 * silently dropped the middle. The model then answered a question about 7,172 rows from the
 * handful of sample rows that survived, confidently and wrongly.
 *
 * So this counts BPE-ish units instead of characters — a word run merges into roughly one
 * token per four characters, while punctuation and symbols usually cost one each — and then
 * pads by half. It overshoots plain prose by about 2x, which only ever costs an over-cautious
 * refusal carrying an actionable message; undershooting costs a wrong answer the user cannot
 * detect, which is the trade this exists to make.
 */
export function estimateLocalTokens(text: string): number {
  let units = 0;
  for (const m of text.matchAll(/[A-Za-z0-9]+|[^A-Za-z0-9\s]|\s+/g)) {
    const chunk = m[0];
    if (/\s/.test(chunk[0])) continue; // whitespace mostly merges into the next token
    units += /[A-Za-z0-9]/.test(chunk[0]) ? Math.max(1, Math.ceil(chunk.length / 4)) : 1;
  }
  return Math.ceil(units * 1.5);
}

/** Match llama.cpp's "prompt doesn't fit the context window" runtime error (LM Studio
 *  surfaces it mid-stream or as a 400) — and cloud providers' equivalent — so it can be
 *  reworded into something the user can act on. */
function isContextOverflow(message: string | null | undefined): boolean {
  if (!message) return false;
  return /n_ctx|n_keep|tokens to keep|context length|context window|maximum context/i.test(message);
}

/** Actionable message for a prompt that overflows a model's context window. */
function contextOverflowMessage(provider: AiProvider, model: string, ctx: number | null, promptTokens: number | null): string {
  const label = PROVIDER_LABELS[provider] ?? provider;
  const knob = provider === 'ollama' ? 'num_ctx' : 'Context Length';
  const need = promptTokens ? `~${promptTokens.toLocaleString('es')} tokens` : 'más tokens de los que caben';
  const has = ctx ? ` (ventana actual: ${ctx.toLocaleString('es')} tokens)` : '';
  return `El modelo local «${model}» no tiene suficiente contexto para esta tarea: necesita ${need}${has}. Aumenta el contexto del modelo en ${label} (${knob}), elige un modelo con más contexto, reduce el tamaño de la tarea (menos texto por lote) o usa un proveedor en la nube para tareas grandes.`;
}

/** Neutral variant when the provider/model aren't at hand (error-translation fallback). */
function genericContextOverflowMessage(): string {
  return 'El modelo no tiene suficiente contexto para esta petición. Reduce el tamaño de la tarea, aumenta el contexto del modelo (Context Length / num_ctx si es local) o usa un modelo con más contexto.';
}

/**
 * Output ceiling hit mid-JSON: retrying the same request verbatim reproduces it, so this
 * has to distinguish the task's requested output ceiling from the context window. A
 * larger context only helps when the planner had to clamp that request to make the
 * prompt fit; it never turns a task's 4K output request into 64K output.
 */
function truncatedJsonMessage(model: ModelRef, maxTokens: number): string {
  const label = PROVIDER_LABELS[model.provider] ?? model.provider;
  const cut = `La respuesta de «${model.model}» (${label}) se cortó al alcanzar el límite de ${maxTokens.toLocaleString('es')} tokens de salida y el JSON quedó incompleto.`;
  if (isLocalProvider(model.provider) || model.provider === 'nodus') {
    const knob = model.provider === 'ollama' ? 'num_ctx' : 'Context Length';
    return `${cut} El límite de salida y la ventana de contexto son ajustes distintos. Nodus intentará dividir las tareas estructuradas compatibles; ampliar ${label} (${knob}) solo ayuda cuando el prompt no deja espacio suficiente. Si el error persiste, usa un modelo que siga mejor JSON o un proveedor en la nube para esta tarea.`;
  }
  return `${cut} Usa un modelo con mayor límite de salida o reduce el tamaño de la tarea.`;
}

/** Prose that must not be stored half-written: the same ceiling, without the JSON wording. */
function truncatedOutputMessage(model: ModelRef, maxTokens: number): string {
  const label = PROVIDER_LABELS[model.provider] ?? model.provider;
  return `La respuesta de «${model.model}» (${label}) se cortó al alcanzar el límite de ${maxTokens.toLocaleString('es')} tokens de salida. Un modelo con razonamiento puede gastar ese presupuesto pensando antes de escribir.`;
}

/**
 * How long one non-streaming completion may take before the transport gives up.
 *
 * A cloud provider that has said nothing for three minutes is stuck: it runs the model
 * on hardware sized for it, and the request is billed whether or not we keep waiting.
 * A model on the user's own laptop is a different animal — the wait IS the work. Idea
 * extraction asks for up to 16.000 JSON tokens per chunk, which at the 15-40 tokens/s a
 * quantized 7B reaches on an M-series is 400-1.067 seconds of perfectly healthy
 * generation. Under one shared 180s ceiling that arrived as "timed out waiting for the
 * AI provider" on every chunk, which is why local models could produce Themes (1.500
 * tokens, one call) and never Ideas. Nothing is billed by the second here and the deep
 * scan ticks a heartbeat while it waits, so the local budget is generous; it stays
 * finite because a wedged local server must not hold the scan queue open forever.
 */
const CLOUD_COMPLETION_TIMEOUT_MS = 180_000;
/** The outer bound on one streamed answer; the stream's own deadline is idle time. */
const STREAM_TOTAL_MS = 30 * 60_000;
const ON_DEVICE_COMPLETION_TIMEOUT_MS = 1_200_000;

/**
 * True when the model runs on this machine or the user's own network: the built-in
 * runtime, a local server, or a custom endpoint whose address is local.
 *
 * The custom case has to be read off the address, because `custom` is not a server but a
 * promise that whatever the user runs answers the OpenAI contract — and the setups that
 * promise exists for (a bare llama.cpp, vLLM or LiteLLM on the same laptop) were exactly
 * the ones held to the cloud ceiling. The user said where it is by typing its URL; asking
 * them again in Settings would be asking them to repeat themselves, and there is no
 * question to ask: `isLocalEndpointAddress` knows every shape a local address takes.
 */
function runsOnDevice(provider: AiProvider): boolean {
  return provider === 'nodus' || isLocalProvider(provider) || (provider === 'custom' && isLocalEndpointAddress(customBaseUrl()));
}

export function completionTimeoutMs(model: ModelRef): number {
  return runsOnDevice(model.provider) ? ON_DEVICE_COMPLETION_TIMEOUT_MS : CLOUD_COMPLETION_TIMEOUT_MS;
}

/**
 * Size max_tokens to a local model's real context window, refusing up front when the
 * prompt itself won't fit. Returns the max_tokens to use; throws an actionable AiError
 * (config → the scan queue pauses once instead of failing every item) when there is no
 * room to generate. No-ops (returns the requested value) when the window can't be
 * detected — the runtime-error translation is the safety net for that case.
 */
async function localCompatPlan(model: ModelRef, opts: CallOpts, requestedMax: number): Promise<LocalRequestPlan | null> {
  const provider = model.provider as LocalProvider;
  const key = getApiKey(model.provider);
  const capabilities = await localContextCapabilities(provider, model.model, key);
  const loaded = capabilities.loaded ?? await localContextWindow(provider, model.model, key);
  if (!loaded) return null;
  const promptTokens = estimateLocalTokens(opts.system) + estimateLocalTokens(opts.user) + 16;
  try {
    return buildLocalRequestPlan({
      provider,
      model: model.model,
      task: opts.task ?? 'generic',
      promptTokens,
      requestedOutputTokens: requestedMax,
      contextMode: getSettings().localProviders?.[provider]?.contextMode,
      manualContextTokens: getSettings().localProviders?.[provider]?.manualContextTokens,
      trainedContextTokens: capabilities.trained,
      loadedContextTokens: loaded,
      nativeTransport: false,
    });
  } catch {
    throw new AiError(contextOverflowMessage(model.provider, model.model, loaded, promptTokens), false, true, 'context_overflow');
  }
}

function nodusLocalMaxTokens(model: ModelRef, opts: CallOpts, requestedMax: number): number {
  const ctx = getNodusLocalModel(model.model)?.contextLength ?? 8192;
  const promptTokens = estimateLocalTokens(opts.system) + estimateLocalTokens(opts.user) + 16;
  const reserve = Math.max(256, Math.round(ctx * 0.05));
  const available = ctx - promptTokens - reserve;
  if (available < MIN_NODUS_LOCAL_OUTPUT_ROOM_TOKENS) {
    throw new AiError(contextOverflowMessage(model.provider, model.model, ctx, promptTokens), false, true);
  }
  return Math.min(requestedMax, available);
}

import { withTranscript as __withTranscript, transcriptFetch as __transcriptFetch } from './transcript';

export interface CallOpts {
  /** Backend academic corpus requests only; include all final prompt/output bytes. */
  corpusContext?: boolean;
  /** Set exclusively by Research Assistant; absent preserves every other surface. */
  researchEffort?: ResearchEffort;
  researchModelInfo?: import('@shared/types').ModelInfo;
  /** Image-tool production prompts stay English while visible prose follows the UI language. */
  englishImagePrompts?: boolean;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  perf?: PerfContext;
  /** Reasoning effort. Defaults to `off` for JSON/scan calls and to the configured
   *  `chatReasoning` for conversational calls. */
  reasoning?: ReasoningEffort;
  /** Let Codex use its per-model setting while retaining an explicit portable effort
   * for other providers (used by latency-sensitive conversational surfaces). */
  useConfiguredCodexReasoning?: boolean;
  /** Disable SDK/compatibility retries for explicitly single-attempt workflows. */
  noRetry?: boolean;
  /** Per-request transport timeout override. */
  timeoutMs?: number;
  /** Cooperative cancellation for long-running corpus jobs. */
  signal?: AbortSignal;
  /**
   * A prose caller that PERSISTS the text (the work summary) opts into the JSON
   * contract: a response the provider cut off at the output ceiling is a retryable
   * error instead of a silently stored half-sentence. Conversational prose leaves
   * it off, because a clipped chat answer is still an answer.
   */
  requireCompleteOutput?: boolean;
  /** Images to attach for vision models (base64 + media type). */
  images?: VisionImagePart[];
  /** Skip the vault-type prompt pack (keep only the output-language directive). Used
   *  for tasks that need consistent output regardless of vault type (image analysis). */
  plainContext?: boolean;
  /** Opt out of student pseudonymisation for a call that provably carries no roster
   *  data. Deliberately explicit: see electron/ai/studentPrivacyContext.ts. */
  skipStudentPseudonyms?: true;
  /** Scheduler priority. Background pipelines must opt in explicitly. */
  requestClass?: AiRequestClass;
  /** Stable, content-free identifier used only for diagnostics/checkpoints. */
  jobId?: string;
  /**
   * Ask a provider with a native seed contract to make a best effort at producing
   * the same structured result for the same frozen request. Extraction uses this;
   * creative and conversational calls deliberately do not.
   */
  deterministic?: boolean;
  /** Local request policy. It controls context planning independently from output. */
  task?: LocalAiTask;
  /** Content-free batching metadata for diagnostics and adaptive recovery. */
  batchSize?: number;
  splitDepth?: number;
}

/** Streaming delta. `kind` distinguishes the final answer (`content`, default) from
 *  the model's reasoning/thinking trace (`reasoning`). */
type TextDeltaHandler = (delta: string, kind?: 'content' | 'reasoning') => void;

async function tryLocalNativeCompletion(
  model: ModelRef,
  opts: CallOpts,
  jsonMode: boolean,
  key: string,
): Promise<string | null> {
  if (!isLocalProvider(model.provider) || opts.images?.length) return null;
  const provider = model.provider as LocalProvider;
  const config = getSettings().localProviders?.[provider];
  const requestedOutput = opts.maxTokens ?? 8000;
  const promptTokens = estimateLocalTokens(opts.system) + estimateLocalTokens(opts.user) + 16;
  const capabilities = await localContextCapabilities(provider, model.model, key);
  let plan: LocalRequestPlan;
  try {
    plan = buildLocalRequestPlan({
      provider,
      model: model.model,
      task: opts.task ?? 'generic',
      promptTokens,
      requestedOutputTokens: requestedOutput,
      contextMode: config?.contextMode,
      manualContextTokens: config?.manualContextTokens,
      trainedContextTokens: capabilities.trained,
      loadedContextTokens: capabilities.loaded,
      nativeTransport: true,
    });
  } catch {
    const configured = config?.contextMode === 'manual' ? config.manualContextTokens ?? null : 16384;
    throw new AiError(contextOverflowMessage(provider, model.model, configured, promptTokens), false, true, 'context_overflow');
  }

  const started = Date.now();
  try {
    const result = await scheduleProviderRequest(model, opts, key, `${localBaseUrl(provider)}/native`, () => completeLocalNative({
      provider,
      baseUrl: localBaseUrl(provider),
      key: key === 'local' ? null : key,
      model: model.model,
      system: opts.system,
      user: opts.user,
      temperature: opts.temperature ?? 0.15,
      contextTokens: plan.contextTokens,
      outputTokens: plan.outputTokens,
      jsonMode,
      timeoutMs: opts.timeoutMs ?? completionTimeoutMs(model),
      signal: opts.signal,
      deterministic: opts.deterministic,
      researchBody: opts.researchEffort === undefined ? undefined : researchBody(model, opts),
    }));
    recordLocalAiDiagnostic({
      provider,
      model: model.model,
      task: plan.task,
      transport: 'native',
      contextMode: plan.contextMode,
      requestedContextTokens: config?.contextMode === 'manual' ? config.manualContextTokens : undefined,
      effectiveContextTokens: plan.contextTokens,
      estimatedInputTokens: plan.promptTokens,
      actualInputTokens: result.inputTokens,
      requestedOutputTokens: plan.requestedOutputTokens,
      sentOutputTokens: plan.outputTokens,
      actualOutputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      finishReason: result.finishReason,
      batchSize: opts.batchSize,
      splitDepth: opts.splitDepth,
      elapsedMs: Date.now() - started,
      timestamp: Date.now(),
    });
    if ((jsonMode || opts.requireCompleteOutput) && /length|max_tokens|max_output_tokens/i.test(result.finishReason ?? '')) {
      throw new AiError(
        jsonMode ? truncatedJsonMessage(model, plan.outputTokens) : truncatedOutputMessage(model, plan.outputTokens),
        true,
        false,
        'output_truncated',
      );
    }
    if (!result.text.trim()) {
      throw new AiError(`Respuesta vacía del proveedor de IA (${result.finishReason ?? 'sin finish_reason'}).`, false);
    }
    return result.text;
  } catch (error) {
    if (error instanceof LocalNativeUnavailableError) {
      if (opts.researchEffort !== undefined && Object.keys(researchBody(model, opts)).length) {
        throw new AiError('El servidor local no dispone de la API nativa necesaria para controlar thinking. Actualiza el servidor o elige otro modelo.', false, true);
      }
      return null;
    }
    if (error instanceof AiError) throw error;
    throw wrapProviderError(error);
  }
}

async function tryLocalNativeStreaming(
  model: ModelRef,
  opts: CallOpts,
  key: string,
  signal: AbortSignal | undefined,
  onDelta: TextDeltaHandler,
): Promise<string | null> {
  if (!isLocalProvider(model.provider) || opts.images?.length) return null;
  const provider = model.provider as LocalProvider;
  const config = getSettings().localProviders?.[provider];
  const promptTokens = estimateLocalTokens(opts.system) + estimateLocalTokens(opts.user) + 16;
  const requestedOutput = opts.maxTokens ?? 8000;
  const capabilities = await localContextCapabilities(provider, model.model, key);
  let plan: LocalRequestPlan;
  try {
    plan = buildLocalRequestPlan({
      provider, model: model.model, task: opts.task ?? 'chat', promptTokens,
      requestedOutputTokens: requestedOutput, contextMode: config?.contextMode,
      manualContextTokens: config?.manualContextTokens, trainedContextTokens: capabilities.trained,
      loadedContextTokens: capabilities.loaded, nativeTransport: true,
    });
  } catch {
    throw new AiError(contextOverflowMessage(provider, model.model, config?.manualContextTokens ?? 16384, promptTokens), false, true, 'context_overflow');
  }
  const started = Date.now();
  try {
    const result = await scheduleProviderRequest(model, { ...opts, signal }, key, `${localBaseUrl(provider)}/native-stream`, () => streamLocalNative({
      provider, baseUrl: localBaseUrl(provider), key: key === 'local' ? null : key,
      model: model.model, system: opts.system, user: opts.user,
      temperature: opts.temperature ?? 0.15, contextTokens: plan.contextTokens,
      outputTokens: plan.outputTokens, jsonMode: false,
      researchBody: opts.researchEffort === undefined ? undefined : researchBody(model, opts),
      timeoutMs: opts.timeoutMs ?? completionTimeoutMs(model), signal,
    }, onDelta));
    recordLocalAiDiagnostic({
      provider, model: model.model, task: plan.task, transport: 'native', contextMode: plan.contextMode,
      requestedContextTokens: config?.contextMode === 'manual' ? config.manualContextTokens : undefined,
      effectiveContextTokens: plan.contextTokens, estimatedInputTokens: plan.promptTokens,
      actualInputTokens: result.inputTokens, requestedOutputTokens: plan.requestedOutputTokens,
      sentOutputTokens: plan.outputTokens, actualOutputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens, finishReason: result.finishReason,
      elapsedMs: Date.now() - started, timestamp: Date.now(),
    });
    return result.text;
  } catch (error) {
    if (error instanceof LocalNativeUnavailableError) {
      if (opts.researchEffort !== undefined && Object.keys(researchBody(model, opts)).length) {
        throw new AiError('El servidor local no dispone de la API nativa necesaria para controlar thinking. Actualiza el servidor o elige otro modelo.', false, true);
      }
      return null;
    }
    if (error instanceof AiError) throw error;
    throw wrapProviderError(error);
  }
}

/**
 * Output-language control. The prompts are authored in Spanish, and every prompt language
 * gets a HIGH-PRIORITY directive APPENDED to its system prompt rather than the prompt being
 * rewritten, so all generated free-text fields come back in the configured language. The
 * directive explicitly supersedes whatever language an inline instruction or a document's
 * own language implies — the override mechanism that has always driven the English option,
 * and far safer than a blind find/replace over hand-tuned prompts (that would also corrupt
 * JSON examples and cases where "español" denotes the source text).
 *
 * Spanish used to be the exception: no directive was appended, on the assumption that a
 * prompt written in Spanish brings Spanish output. That held for most prompts and failed for
 * some — the document-profile pack never said which language to write in and two of nine
 * profiles of a live run followed the source document into English instead. A language the
 * user chose is a setting, not a property of the prompt text, so Spanish is now driven by the
 * same directive as the other fourteen.
 *
 * `quote`/verbatim evidence always stays in the source language. Applied at the public entry
 * points only (not the internal JSON-repair call, which must not translate existing content);
 * tasks that must fully control their own output language call `completeTextNeutral`.
 */
const OUTPUT_LANGUAGE_NAME: Record<PromptLanguage, string> = {
  es: 'ESPAÑOL',
  en: 'ENGLISH',
  fr: 'FRANÇAIS',
  tr: 'TÜRKÇE',
  de: 'DEUTSCH',
  pt: 'PORTUGUÊS EUROPEU',
  'pt-BR': 'PORTUGUÊS DO BRASIL',
  it: 'ITALIANO',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  vi: 'TIẾNG VIỆT',
  ja: '日本語',
  ru: 'РУССКИЙ',
  uk: 'УКРАЇНСЬКА',
  ko: '한국어',
};

function outputLanguageDirective(lang: PromptLanguage): string {
  const headings: Record<PromptLanguage, string> = {
    es: 'IDIOMA DE SALIDA — PRIORIDAD MÁXIMA',
    en: 'OUTPUT LANGUAGE — HIGHEST PRIORITY',
    fr: 'LANGUE DE SORTIE — PRIORITÉ ABSOLUE',
    tr: 'ÇIKTI DİLİ — EN YÜKSEK ÖNCELİK',
    de: 'AUSGABESPRACHE — HÖCHSTE PRIORITÄT',
    pt: 'IDIOMA DE SAÍDA — PRIORIDADE MÁXIMA',
    'pt-BR': 'IDIOMA DE SAÍDA — PRIORIDADE MÁXIMA',
    it: 'LINGUA DI OUTPUT — PRIORITÀ MASSIMA',
    'zh-Hans': '输出语言 — 最高优先级',
    'zh-Hant': '輸出語言 — 最高優先級',
    vi: 'NGÔN NGỮ ĐẦU RA — ƯU TIÊN CAO NHẤT',
    ja: '出力言語 — 最優先',
    ru: 'ЯЗЫК ВЫВОДА — НАИВЫСШИЙ ПРИОРИТЕТ',
    uk: 'МОВА ВИВЕДЕННЯ — НАЙВИЩИЙ ПРІОРИТЕТ',
    ko: '출력 언어 — 최우선 순위',
  };
  const directives: Record<PromptLanguage, string> = {
    es: `Prioridad de idioma de salida: redacta TODOS los campos de texto libre en ${OUTPUT_LANGUAGE_NAME[lang]}, sea cual sea el idioma del documento de origen o cualquier instrucción anterior. Incluye etiquetas, enunciados, desarrollos, resúmenes, justificaciones, explicaciones, notas, títulos, cuerpos, motivos y toda la prosa. La ÚNICA excepción son los campos quote/prueba literal, que se copian EXACTAMENTE en el idioma de origen; no traduzcas nunca las citas. Conserva exactamente las claves JSON y los valores de enumeración.`,
    en: `Output-language priority: write EVERY free-text/natural-language output field in ${OUTPUT_LANGUAGE_NAME[lang]}, regardless of source-document language or earlier instructions. This includes labels, statements, development, summaries, rationales, explanations, notes, titles, bodies, reasons, and all prose. The ONLY exception is any quote/verbatim-evidence field, which must be copied EXACTLY in the source language; never translate quotes. Keep JSON keys and enum values exactly as specified.`,
    fr: `Priorité de langue de sortie : rédige TOUS les champs de texte libre en ${OUTPUT_LANGUAGE_NAME[lang]}, quelle que soit la langue du document source ou toute instruction précédente. Cela inclut labels, énoncés, développements, résumés, justifications, explications, notes, titres, corps, raisons et toute prose. SEULE exception : les champs quote/preuve littérale doivent être copiés EXACTEMENT dans la langue source ; ne traduis jamais les citations. Conserve exactement les clés JSON et valeurs d’énumération.`,
    tr: `Çıktı dili önceliği: Kaynak belgenin diline veya önceki talimatlara bakılmaksızın TÜM serbest metin alanlarını ${OUTPUT_LANGUAGE_NAME[lang]} yaz. Buna etiketler, ifadeler, geliştirmeler, özetler, gerekçeler, açıklamalar, notlar, başlıklar ve tüm düzyazı dahildir. TEK istisna quote/aynen kanıt alanlarıdır; bunları kaynak dilinde AYNEN kopyala, alıntıları çevirme. JSON anahtarlarını ve enum değerlerini aynen koru.`,
    de: `Ausgabesprache hat Vorrang: Schreibe ALLE freien Textfelder in ${OUTPUT_LANGUAGE_NAME[lang]}, unabhängig von Quellsprache oder früheren Anweisungen. Dazu gehören Labels, Aussagen, Entwicklungen, Zusammenfassungen, Begründungen, Erklärungen, Notizen, Titel, Textkörper, Gründe und jede Prosa. EINZIGE Ausnahme: quote/wörtliche Belege müssen EXAKT in der Quellsprache kopiert werden; Zitate nie übersetzen. JSON-Schlüssel und Enum-Werte unverändert lassen.`,
    pt: `Prioridade do idioma de saída: escreve TODOS os campos de texto livre em ${OUTPUT_LANGUAGE_NAME[lang]}, independentemente do idioma da fonte ou de instruções anteriores. Inclui etiquetas, afirmações, desenvolvimentos, resumos, justificações, explicações, notas, títulos, corpo, motivos e toda a prosa. ÚNICA exceção: campos quote/evidência literal devem ser copiados EXATAMENTE no idioma da fonte; nunca traduzas citações. Mantém exatamente as chaves JSON e os valores enum.`,
    'pt-BR': `Prioridade do idioma de saída: escreva TODOS os campos de texto livre em ${OUTPUT_LANGUAGE_NAME[lang]}, independentemente do idioma da fonte ou de instruções anteriores. Isso inclui rótulos, afirmações, desenvolvimentos, resumos, justificativas, explicações, notas, títulos, corpo, motivos e toda prosa. ÚNICA exceção: campos quote/evidência literal devem ser copiados EXATAMENTE no idioma da fonte; nunca traduza citações. Mantenha exatamente as chaves JSON e os valores enum.`,
    it: `Priorità della lingua di output: scrivi TUTTI i campi di testo libero in ${OUTPUT_LANGUAGE_NAME[lang]}, indipendentemente dalla lingua della fonte o da istruzioni precedenti. Include etichette, enunciati, sviluppi, riepiloghi, motivazioni, spiegazioni, note, titoli, corpo, ragioni e ogni prosa. UNICA eccezione: i campi quote/prova letterale vanno copiati ESATTAMENTE nella lingua della fonte; non tradurre mai le citazioni. Mantieni esattamente chiavi JSON e valori enum.`,
    'zh-Hans': `输出语言优先：无论源文档的语言或先前的指令如何，所有自由文本/自然语言输出字段都必须用${OUTPUT_LANGUAGE_NAME[lang]}撰写。这包括标签、陈述、展开阐述、摘要、理由、说明、注释、标题、正文、原因以及全部行文。唯一例外是 quote/逐字证据字段，必须严格按源语言原样复制；绝不翻译引文。JSON 键名与枚举值必须完全按指定保留。`,
    'zh-Hant': `輸出語言優先：無論來源文件的語言或先前的指示為何，所有自由文字/自然語言輸出欄位都必須以${OUTPUT_LANGUAGE_NAME[lang]}撰寫。這包括標籤、陳述、闡述、摘要、理由、說明、註釋、標題、正文、原因以及全部行文。唯一例外是 quote/逐字證據欄位，必須嚴格按來源語言原樣複製；絕不翻譯引文。JSON 鍵名與列舉值必須完全按指定保留。`,
    vi: `Ưu tiên ngôn ngữ đầu ra: hãy viết MỌI trường văn bản tự do/ngôn ngữ tự nhiên bằng ${OUTPUT_LANGUAGE_NAME[lang]}, bất kể ngôn ngữ của tài liệu nguồn hay các hướng dẫn trước đó. Điều này bao gồm nhãn, phát biểu, phần triển khai, tóm tắt, lý do, giải thích, ghi chú, tiêu đề, nội dung, căn cứ và toàn bộ văn xuôi. NGOẠI LỆ DUY NHẤT là các trường quote/trích dẫn nguyên văn: phải sao chép NGUYÊN VĂN theo ngôn ngữ nguồn; tuyệt đối không dịch trích dẫn. Giữ nguyên chính xác các khóa JSON và giá trị enum.`,
    ja: `出力言語の優先：ソース文書の言語や以前の指示にかかわらず、すべての自由記述／自然言語の出力フィールドを${OUTPUT_LANGUAGE_NAME[lang]}で書いてください。対象にはラベル、記述、展開、要約、根拠、説明、注記、タイトル、本文、理由、およびすべての文章が含まれます。唯一の例外は quote／逐語証拠フィールドで、ソース言語のまま正確にコピーし、引用を翻訳しないでください。JSON のキーと列挙値は指定どおり正確に保ってください。`,
    ru: `Приоритет языка вывода: пишите ВСЕ поля свободного текста/естественного языка на русском языке (${OUTPUT_LANGUAGE_NAME[lang]}), независимо от языка исходного документа или предыдущих инструкций. Это включает метки, утверждения, развёрнутые пояснения, резюме, обоснования, объяснения, примечания, заголовки, основной текст, причины и всю прозу. ЕДИНСТВЕННОЕ исключение — поля quote/дословных доказательств: их нужно копировать ТОЧНО на языке источника; никогда не переводите цитаты. Сохраняйте ключи JSON и значения перечислений в точности как указано.`,
    uk: `Пріоритет мови виведення: пишіть УСІ поля вільного тексту/природної мови українською мовою (${OUTPUT_LANGUAGE_NAME[lang]}), незалежно від мови вихідного документа чи попередніх інструкцій. Це охоплює мітки, твердження, розгорнуті пояснення, резюме, обґрунтування, пояснення, примітки, заголовки, основний текст, причини та всю прозу. ЄДИНИЙ виняток — поля quote/дослівних доказів: їх потрібно копіювати ТОЧНО мовою джерела; ніколи не перекладайте цитати. Зберігайте ключі JSON і значення переліків точно як указано.`,
    ko: `출력 언어 우선: 원본 문서의 언어나 이전 지시와 관계없이 모든 자유 텍스트/자연어 출력 필드를 ${OUTPUT_LANGUAGE_NAME[lang]}로 작성하십시오. 여기에는 레이블, 진술, 전개, 요약, 근거, 설명, 메모, 제목, 본문, 이유 및 모든 산문이 포함됩니다. 유일한 예외는 quote/축자 증거 필드로, 반드시 원문 언어 그대로 정확히 복사해야 하며 인용문을 절대 번역하지 마십시오. JSON 키와 열거형 값은 지정된 그대로 정확히 유지하십시오.`,
  };
  return `\n\n═══ ${headings[lang]} ═══\n${directives[lang]}`;
}

/** Exported for unit testing: appends the output-language directive per the current
 *  `promptLanguage` setting without mutating the base prompt. */
export function withPromptLanguage<T extends { system: string; englishImagePrompts?: boolean }>(opts: T): T {
  const lang = jobOutputLanguage() ?? getSettings().promptLanguage ?? 'es';
  const toolException = opts.englishImagePrompts ? '\nIMAGE TOOL PROTOCOL EXCEPTION: In nodus-image JSON requests, the prompt field is an internal production instruction and MUST be written in English. Visible prose, title and alt still follow the output language above. Keep JSON keys and aspect-ratio values unchanged.' : '';
  return { ...opts, system: `${opts.system}${outputLanguageDirective(lang)}${toolException}` };
}

/**
 * Appends the active vault type's prompt-pack persona to the system prompt (empty
 * for academic, so a no-op for existing vaults). Applied at the same public entry
 * points as the language directive, but BEFORE it, so the highest-priority
 * output-language directive always stays at the very end of the prompt. Robust to
 * contexts where the vault registry isn't ready (headless/MCP) — falls back to no
 * pack rather than throwing. Exported for unit testing.
 */
export function withVaultTypeContext<T extends { system: string }>(opts: T): T {
  let pack = '';
  try {
    pack = vaultTypePromptPack(getActiveVault().type, jobOutputLanguage() ?? getSettings().promptLanguage ?? 'es');
  } catch {
    pack = '';
  }
  if (!pack) return opts;
  return { ...opts, system: `${opts.system}${pack}` };
}

/** Compose both context directives: vault-type persona first, then the language
 *  override last (highest priority). `plainContext` skips the vault pack so tasks
 *  that need consistent output (image analysis) aren't steered by the vault type. */
function withPromptContext<T extends { system: string; plainContext?: boolean }>(opts: T): T {
  const visualPlanning = documentVisualPlanningPrompt();
  if (visualPlanning) opts = { ...opts, system: `${opts.system}\n\n${visualPlanning}` };
  return opts.plainContext ? withPromptLanguage(opts) : withPromptLanguage(withVaultTypeContext(opts));
}

/** Measure the same injected instructions and framing that completion will validate.
 * Prompt builders call this before dispatch, while they can still select less evidence. */
export function researchRequestUpperBound(opts: CallOpts): number {
  const contextual = withPromptContext(opts);
  return researchPromptUpperBound(contextual.system, contextual.user, contextual.maxTokens ?? 8000);
}

/** Resolve which model to use: explicit override, else the synthesis workload. */
function resolveModel(override?: ModelRef | null): ModelRef {
  if (override?.provider && override.model) return override;
  const def = getSettings().synthesisModel;
  if (!def?.provider || !def.model) {
    throw new AiError('No hay un modelo de IA configurado. Elige uno en Ajustes.', false, true, AI_MODEL_REQUIRED_ERROR_CODE);
  }
  return def;
}

/** Public wrapper so prompt-assembly code (e.g. the research chat) can resolve the same
 *  effective model the completion calls will use, to size its payload accordingly. */
export function resolveModelRef(override?: ModelRef | null): ModelRef {
  return resolveModel(override);
}

/**
 * The Codex reasoning level this call runs at, or null to leave it to the provider.
 * The role's own choice travels on the `ModelRef` the caller handed us, so the level a
 * user set beside one task's picker cannot leak into another task that happens to run
 * the same model; the Providers tab's per-model entry remains the default underneath.
 */
function configuredCodexReasoning(model: ModelRef): CodexReasoningEffort | null {
  return codexReasoningFor(model, getSettings().codexReasoningEfforts);
}

/**
 * The loaded context window (in tokens) of a model, or null when it is a cloud model or
 * the window can't be detected. Only local servers (LM Studio / Ollama) load a small,
 * fixed window; cloud models manage context server-side, so they return null and callers
 * keep their cloud-sized budget. Lets large-prompt callers fit the payload to what a local
 * model can actually hold instead of overflowing.
 */
export async function localModelContextWindow(model: ModelRef): Promise<number | null> {
  if (model.provider === 'nodus') return getNodusLocalModel(model.model)?.contextLength ?? null;
  if (!isLocalProvider(model.provider)) return null;
  return localContextWindow(model.provider as LocalProvider, model.model, getApiKey(model.provider));
}

/** No catalogue/network discovery is started by retrieval. Unknown windows use
 * a conservative operating cap, not a claim about the provider's model capacity. */
export async function researchModelContextWindow(model: ModelRef): Promise<{ tokens: number; known: boolean }> {
  const local = await localModelContextWindow(model);
  if (local) return { tokens: local, known: true };
  const advertised = cachedModelContextWindow(model.provider, model.model);
  if (advertised) return { tokens: advertised, known: true };
  // Exact provider/model contracts for catalogues that omit token limits.
  const documented = documentedContextWindow(model.provider, model.model);
  if (documented) return { tokens: documented, known: true };
  return { tokens: 32768, known: false };
}
/** Byte sizes of a request's parts, largest payload fields first, for the overflow log. */
function requestSizeBreakdown(opts: CallOpts): string {
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  const parts = [`system ${bytes(opts.system)}`, `user ${bytes(opts.user)}`, `output ${opts.maxTokens ?? 8000}`];
  try {
    const payload = JSON.parse(opts.user) as Record<string, unknown>;
    const fields = Object.entries(payload).map(([key, value]) => [key, bytes(JSON.stringify(value) ?? '')] as const).sort((a, b) => b[1] - a[1]).slice(0, 8);
    parts.push(`user fields: ${fields.map(([key, size]) => `${key}=${size}`).join(', ')}`);
  } catch {
    /* A plain-text user message has no fields to break down. */
  }
  return parts.join('; ');
}

async function assertCorpusRequestFits(model: ModelRef, opts: CallOpts): Promise<void> {
  const active = currentResearchRequestBudget();
  if (!active && !opts.corpusContext) return;
  const effective = await researchModelContextWindow(model);
  const window = Math.min(effective.tokens, active?.window ?? Infinity);
  const needed = researchPromptUpperBound(opts.system, opts.user, opts.maxTokens ?? 8000);
  if (needed > window) {
    // Say what is large: the generic message a cloud model gets carries no numbers.
    console.warn(`[research] request refused before sending: needs ~${needed} (bytes as tokens) > window ${window} for ${model.provider}/${model.model}; ${requestSizeBreakdown(opts)}`);
    active?.onOverflow();
    throw new AiError(isLocalProvider(model.provider) || model.provider === 'nodus'
      ? contextOverflowMessage(model.provider, model.model, window, needed) : genericContextOverflowMessage(), false, true, 'context_overflow');
  }
}

/**
 * Optional, model-specific request-body fields layered onto an OpenAI-compatible
 * call: JSON mode, reasoning control, and OpenRouter throughput routing. These can
 * be rejected by some models, so callers retry once without them on a 400.
 */
function optionalBody(model: ModelRef, jsonMode: boolean, reasoning: ReasoningEffort, opts: CallOpts): Record<string, unknown> {
  // A gateway that already refused this body once keeps the plain one for the rest of the
  // session: rediscovering the refusal per chunk would triple the requests a long scan
  // costs. See optionalFieldsSupport.ts.
  if (optionalBodyUnsupported(model)) return {};
  const auditedOpenRouterProvider = process.env.NODUS_AUDIT_OPENROUTER_PROVIDER?.trim();
  return {
    ...(jsonMode && supportsJsonMode(model.provider) ? { response_format: { type: 'json_object' as const } } : {}),
    ...(opts.researchEffort === undefined && !reasoningHintUnsupported(model) ? reasoningBody(model.provider, reasoning, model.model, opts.requestClass === 'background') : {}),
    // Groq's reasoning models (gpt-oss/qwen3) reason at medium by default, which slows scans and
    // burns tokens. reasoningBody can't send it (no model id), so minimise it here. Groq rejects
    // reasoning_effort:'none' — 'low' is its floor; non-reasoning models 400 and the caller strips it.
    ...(opts.researchEffort === undefined && model.provider === 'groq' && reasoning === 'off' && isGroqReasoningModel(model.model)
      ? { reasoning_effort: 'low' as const }
      : {}),
    ...(model.provider === 'openrouter'
      ? auditedOpenRouterProvider
        ? { provider: { only: [auditedOpenRouterProvider], allow_fallbacks: false } }
        : openRouterRoutingBody(getSettings().openRouterThroughput)
      : {}),
  };
}

function researchBody(model: ModelRef, opts: CallOpts): Record<string, unknown> {
  return opts.researchEffort === undefined ? {} : researchReasoningBody(model, opts.researchEffort, opts.maxTokens ?? 8000, opts.researchModelInfo ?? thinkingCatalogFor(model, openAiCompatBase(model.provider)));
}

function requestSamplingBody(model: ModelRef, opts: CallOpts, reasoning: ReasoningEffort): Record<string, number> {
  if (temperatureUnsupported(model)) return {};
  if (opts.researchEffort !== undefined && researchOmitsTemperature(model, opts.researchEffort, opts.researchModelInfo)) return {};
  return samplingTemperatureBody(model.provider, model.model, opts.temperature ?? 0.15, reasoning);
}

/** Whether the user flagged this provider as free-tier (so requests get shaped to its limits). */
function isProviderFreeTier(provider: AiProvider): boolean {
  return FREE_TIER_PROVIDERS.includes(provider) && getSettings().providerFreeTier?.[provider] === true;
}

/**
 * The max_tokens for a free-tier request, or an actionable error when the prompt alone overflows the
 * provider's per-minute budget (Groq's small models can't hold a full scan chunk). Refusing here — as
 * a config error, so the queue pauses once — beats firing a request that just 413s "Request too large".
 */
function freeTierBudget(model: ModelRef, opts: CallOpts, localMax: number): number {
  const promptTokens = estimateLocalTokens(opts.system) + estimateLocalTokens(opts.user) + 16;
  const budget = freeTierMaxTokens(model.provider, model.model, promptTokens, localMax);
  if (budget <= 0) {
    throw new AiError(
      `El nivel gratuito de ${model.provider} (modelo «${model.model}») limita a ${groqFreeTpm(model.model)} tokens/min y este fragmento ya usa ~${promptTokens}. Elige un modelo con mayor límite (p.ej. llama-3.3-70b) o desmarca «Uso mi plan gratuito» para ese proveedor.`,
      false,
      true,
    );
  }
  return budget;
}

/**
 * Headers every OpenAI-compatible client sends: this one seam covers OpenAI,
 * Groq, Cerebras, DeepSeek, Xiaomi, Gemini's compatible surface and OpenRouter,
 * for chat and embeddings alike.
 *
 * None of them require the User-Agent — unlike OpenCode Go, see
 * electron/ai/clientIdentity.ts — but announcing the app and version costs
 * nothing and beats appearing in their logs as an anonymous "node". It carries no
 * user data, and the API key already identifies the account far more precisely.
 * OpenRouter additionally gets the attribution pair it uses for ranking.
 */
function openAiClientHeaders(model: Pick<ModelRef, 'provider'>): Record<string, string> {
  return {
    'User-Agent': nodusUserAgent(),
    ...(model.provider === 'openrouter' ? OPENROUTER_HEADERS : {}),
  };
}

/**
 * The optional body for the one replay after a provider refused it.
 *
 * A named rejection drops the optional body wholesale, as it always has. A custom
 * gateway that refused the reasoning hint *without* naming it gets everything else
 * back exactly as it was — JSON mode included — so the scan keeps its contract and
 * only the field Nodus added is removed.
 */
function retryOptionalBody(model: ModelRef, extras: Record<string, unknown>, error: unknown, sentReasoning: boolean): Record<string, unknown> {
  const auditedProvider = model.provider === 'openrouter' && process.env.NODUS_AUDIT_OPENROUTER_PROVIDER?.trim()
    ? { provider: (extras as any).provider }
    : {};
  if (sentReasoning && !rejectsOptionalTransportField(error)) {
    const rest = { ...extras };
    delete rest.reasoning_effort;
    return { ...rest, ...auditedProvider };
  }
  return auditedProvider;
}

/**
 * The bodies to try after a refusal, in the order the refusal justifies.
 *
 * A refusal that NAMES a field drops the optional body outright — that is the original
 * contract, and the provider has said what it wants. A refusal that names nothing can only
 * come from a custom gateway, and it is a guess: Nodus answers it with the smallest change
 * first, because when the reasoning hint is what had been sent, dropping just that field
 * keeps JSON mode, which is the contract the scan asked for. A gateway that refuses the
 * smaller body too gets the plain OpenAI body — nothing Nodus added — as the last resort,
 * since a scan that runs in prose still beats one that never starts. The JSON contract
 * survives either way: the prompt asks for JSON, and `extractJson` parses, repairs and
 * validates the reply no matter what the gateway agreed to.
 */
function optionalFieldReplays(
  model: ModelRef,
  extras: Record<string, unknown>,
  error: unknown,
  sentReasoning: boolean,
): Array<Record<string, unknown>> {
  const minimal = retryOptionalBody(model, extras, error, sentReasoning);
  // Only a step that still carries something optional is worth taking: when the reasoning
  // hint was the only field sent, `minimal` is already the plain body and repeating it
  // would spend a request to learn nothing.
  if (sentReasoning && model.provider === 'custom' && rejectsOptionalBodyWithoutNaming(error) && Object.keys(minimal).length > 0) {
    return [minimal, {}];
  }
  return [minimal];
}

/**
 * Remember which optional fields the accepted body had to drop, so the calls that follow
 * start there instead of walking the ladder again.
 */
function rememberAcceptedOptionalBody(model: ModelRef, extras: Record<string, unknown>, accepted: Record<string, unknown>): void {
  if ('reasoning_effort' in extras && !('reasoning_effort' in accepted)) rememberReasoningHintUnsupported(model);
  if ('response_format' in extras && !('response_format' in accepted)) rememberOptionalBodyUnsupported(model);
}

/**
 * Answer a refusal of the optional body by replaying the request without it, from the
 * smallest change to the plainest body. Returns the first accepted attempt, or throws the
 * last failure — which, for a refusal that named nothing, is the gateway's real answer:
 * what is left is the request the caller asked for, and if that fails too, the failure
 * belongs to it and not to the fields Nodus added.
 */
async function replayRefusedOptionalFields<T>(
  model: ModelRef,
  extras: Record<string, unknown>,
  refusal: unknown,
  sentReasoning: boolean,
  attempt: (body: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const unnamed = rejectsOptionalBodyWithoutNaming(refusal);
  const replays = optionalFieldReplays(model, extras, refusal, sentReasoning);
  let lastError: unknown = refusal;
  for (const body of replays) {
    try {
      const value = await attempt(body);
      if (unnamed) rememberAcceptedOptionalBody(model, extras, body);
      return value;
    } catch (next) {
      lastError = next;
      // Only another refusal of the same unnamed kind justifies dropping the next field;
      // a 5xx, a dropped socket or an auth error is the gateway's real answer.
      if (!unnamed || !rejectsOptionalBodyWithoutNaming(next)) throw next;
    }
  }
  throw lastError;
}

/** True for provider throttling. OpenRouter also uses 529 when the selected
 * upstream is temporarily over capacity and can attach the same retry hints. */
function isRateLimited(e: any): boolean {
  const status = e?.status ?? e?.response?.status;
  return status === 429 || status === 529;
}

/** How long to wait after a 429, from Retry-After/reset headers, bounded to 15 minutes. */
function retryAfterMs(e: any): number {
  const h = e?.headers;
  const raw = typeof h?.get === 'function'
    ? h.get('retry-after') ?? h.get('x-ratelimit-reset')
    : h?.['retry-after'] ?? h?.['x-ratelimit-reset'];
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) {
    const duration = secs > 1_000_000_000 ? secs * 1000 - Date.now() : secs * 1000;
    return Math.max(0, Math.min(15 * 60_000, Math.ceil(duration)));
  }
  const parsed = Date.parse(String(raw ?? ''));
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(15 * 60_000, parsed - Date.now()));
  return 3_000; // provider gave no usable hint — a short, bounded pause
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** True for a provider 5xx: the request did not run, so repeating it is not a double charge. */
function isTransientServerError(e: any): boolean {
  const status = e?.status ?? e?.response?.status;
  return typeof status === 'number' && status >= 500 && status < 600;
}

/**
 * Run a provider call, absorbing the two failures that are not the caller's fault.
 *
 * · 429 (rate limit): sólo en las capas gratuitas se espera el Retry-After, hasta cuatro
 *   veces. En una cuenta de pago el error sube y lo gestiona el backoff de la cola.
 * · 5xx: se reintenta SIEMPRE, dos veces con espera creciente. Un 503 puntual del
 *   proveedor no debe tumbar una operación larga —corregir una transcripción de trescientos
 *   tramos, indexar un corpus— cuando la petición ni siquiera llegó a ejecutarse. Y por eso
 *   mismo no es doble facturación: no hubo primera.
 */
async function withProviderRetries<T>(
  freeTier: boolean,
  make: () => Promise<T>,
  signal?: AbortSignal,
  allowRetries = true,
): Promise<T> {
  // Automatic mode owns rate recovery for paid providers too. Each `make` call
  // reacquires the scheduler, so these waits never consume useful capacity.
  const maxRateWaits = allowRetries && (freeTier || getSettings().aiConcurrencyMode === 'automatic') ? 4 : 0;
  const maxServerRetries = allowRetries ? 2 : 0;
  let serverRetries = 0;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await make();
    } catch (e) {
      if (attempt < maxRateWaits && isRateLimited(e)) {
        // Recovered, but worth recording: a provider capping the run is the first thing
        // anyone looks for when indexing crawls, and the wait itself explains the delay.
        logPipelineWarning({
          subject: 'subjectModelCall',
          code: 'rate_limit',
          message: {
            id: 'logRetry',
            params: { subject: { id: 'subjectModelCall' }, attempt: attempt + 2, max: maxRateWaits + 1 },
          },
          detail: e instanceof Error ? e.message : String(e),
        });
        await sleep(retryAfterMs(e), signal);
        continue;
      }
      if (serverRetries < maxServerRetries && isTransientServerError(e)) {
        logPipelineWarning({
          subject: 'subjectModelCall',
          code: 'provider_5xx',
          message: {
            id: 'logRetry',
            params: { subject: { id: 'subjectModelCall' }, attempt: serverRetries + 2, max: maxServerRetries + 1 },
          },
          detail: e instanceof Error ? e.message : String(e),
        });
        await sleep(500 * (serverRetries + 1) ** 2, signal);
        serverRetries += 1;
        continue;
      }
      throw e;
    }
  }
}

/**
 * Swaps student names for opaque codes when a teaching feature has opened a privacy
 * scope. Sits at the very top of both transports, ABOVE the provider branch, so local
 * and cloud are covered by the same code — the two diverge further down, and the
 * fallback model can flip a request from one to the other mid-flight.
 *
 * FAILS CLOSED. If anonymisation throws, or if a name that should have gone is still
 * in the payload, nothing is sent. The costs are wildly asymmetric: failing open turns
 * a bug into an undetectable, irreversible disclosure of minors' names to a third
 * party, while failing closed costs a blocked action with an obvious way out. A
 * privacy layer that silently degrades to no privacy is worse than none, because it
 * manufactures confidence.
 *
 * The residual check is what gives "fails closed" any teeth: the likely bug is not an
 * exception but a silent no-op — an empty scope, a regex that matched nothing — and a
 * no-op is indistinguishable from success without it.
 */
function anonymizeCallOpts(opts: CallOpts): { sent: CallOpts; privacy: ActivePrivacyScope | null } {
  if (opts.skipStudentPseudonyms) return { sent: opts, privacy: null };
  const privacy = currentPrivacyScope();
  if (!privacy) return { sent: opts, privacy: null };

  // Text substitution cannot redact a name written on a scanned exam, and silently
  // exempting images is exactly the leak this layer claims to prevent.
  if (opts.images?.length) {
    throw new AiError(
      'No se pueden enviar imágenes mientras la seudonimización del alumnado está activa: ' +
        'el nombre escrito en una imagen no se puede sustituir. Desactívala en Ajustes si aceptas el riesgo.',
      false
    );
  }

  const system = anonymizeText(opts.system, privacy.scope);
  const user = anonymizeText(opts.user, privacy.scope);
  privacy.warnings.push(...system.warnings, ...user.warnings);

  const residual = [
    ...findResidualNames(system.text, privacy.scope),
    ...findResidualNames(user.text, privacy.scope),
  ];
  if (residual.length) {
    throw new AiError(
      'No se pudo anonimizar el nombre del alumnado; la solicitud no se ha enviado. ' +
        'Revisa el listado del grupo o desactiva la seudonimización en Ajustes si aceptas el riesgo.',
      false
    );
  }

  return { sent: { ...opts, system: system.text, user: user.text }, privacy };
}

/**
 * Maps codes back to real names on the way in.
 *
 * FAILS OPEN, unlike the outbound half: by this point the payload has already been
 * transmitted, so withholding the answer protects nothing and destroys a result the
 * user has already paid for. An unresolvable code renders raw rather than being
 * guessed at.
 */
function deanonymizeResult<T>(value: T): T {
  const privacy = currentPrivacyScope();
  if (!privacy) return value;
  try {
    return deanonymizeDeep(value, privacy.scope);
  } catch {
    return value;
  }
}

async function rawComplete(
  model: ModelRef,
  opts: CallOpts,
  jsonMode = true,
  reasoning: ReasoningEffort = 'off',
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  // A Deep Research or Immersion job carries the thinking level chosen in its form.
  return rawCompleteTransport(model, withJobThinking(model, opts), jsonMode, reasoning, codexReasoning);
}

async function rawCompleteTransport(
  model: ModelRef,
  opts: CallOpts,
  jsonMode = true,
  reasoning: ReasoningEffort = 'off',
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  // Student names must leave before any provider-specific branch. Subscription
  // providers do not use API keys, so this deliberately precedes key resolution.
  // The public entry points map the opaque codes back after parsing/repair.
  opts = anonymizeCallOpts({ ...opts, system: excludeInvisibleArtifacts(opts.system), user: excludeInvisibleArtifacts(opts.user) }).sent;
  await assertCorpusRequestFits(model, opts);

  if (model.provider === 'codex') {
    try {
      return await scheduleProviderRequest(model, opts, null, 'codex-subscription', () => completeWithChatGptSubscription({
        model: model.model,
        system: withJsonModeDirective(opts.system, jsonMode),
        user: opts.user,
        reasoning: opts.researchEffort !== undefined
          ? opts.researchEffort === 'standard' || opts.researchEffort === 'on' ? 'off' : opts.researchEffort
          : codexReasoning === undefined ? reasoning : codexReasoning,
        researchEffort: opts.researchEffort,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal: opts.signal,
      }));
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  if (model.provider === 'github-copilot') {
    try {
      return await scheduleProviderRequest(model, opts, null, 'github-copilot-subscription', () => completeWithGitHubCopilotSubscription({
        model: model.model,
        system: withJsonModeDirective(opts.system, jsonMode),
        user: opts.user,
        reasoning,
        researchEffort: opts.researchEffort,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal: opts.signal,
      }));
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);
  // Refuse an unconfigured custom endpoint here: further down the base URL becomes
  // `baseURL ?? undefined`, and an undefined baseURL sends the request to
  // api.openai.com — the user's prompt would leave for a provider they never chose.
  if (model.provider === 'custom' && !customBaseUrl()) {
    throw new AiError(CUSTOM_ENDPOINT_MISSING, false, true);
  }

  if (model.provider === 'opencode-go') {
    try {
      const result = await scheduleProviderRequest(model, opts, key, 'opencode-go', () => completeWithOpenCodeGo({
        apiKey: key,
        model: model.model,
        system: opts.system,
        user: opts.user,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        reasoning,
        researchEffort: opts.researchEffort,
        noRetry: opts.noRetry,
        jsonMode,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal: opts.signal,
        sessionId: openCodeGoSessionId(opts.jobId),
      }));
      await recordOpenCodeGoUsage(model.model, result.usage);
      return result.text;
    } catch (error: any) {
      throw wrapProviderError(error);
    }
  }

  // Local background/JSON calls use the providers' native contracts so context
  // allocation and output allowance remain two independent parameters. Old
  // servers are detected by endpoint availability and continue below through the
  // OpenAI-compatible seam.
  if (isLocalProvider(model.provider)) {
    const native = await tryLocalNativeCompletion(model, opts, jsonMode, key);
    if (native !== null) return native;
  }

  if (model.provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({
      apiKey: key,
      ...(opts.noRetry ? { maxRetries: 0 } : {}),
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    });
    const body = {
      model: model.model,
      max_tokens: opts.maxTokens ?? 8000,
      ...requestSamplingBody(model, opts, reasoning),
      ...researchBody(model, opts),
      system: opts.system,
      messages: [{ role: 'user', content: opts.images?.length ? (anthropicVisionContent(opts.user, opts.images) as any) : opts.user }],
    };
    try {
      const res = await withThinkingCompatibility(model, body,
        request => scheduleProviderRequest(model, opts, key, 'anthropic', () => client.messages.create(request as any, { signal: opts.signal })),
        { info: opts.researchModelInfo, noRetry: opts.noRetry, signal: opts.signal });
      const block = res.content.find((b: any) => b.type === 'text');
      // A safety refusal returns no text and its own stop reason; without this it read as an
      // empty response. Checked before the text is read so the reason is never lost.
      if ((res as any).stop_reason === 'refusal') {
        throw new AiError('El modelo se negó a responder a esta solicitud.', false, false, null);
      }
      if ((jsonMode || opts.requireCompleteOutput) && (res as any).stop_reason === 'max_tokens') {
        throw new AiError(
          jsonMode ? truncatedJsonMessage(model, opts.maxTokens ?? 8000) : truncatedOutputMessage(model, opts.maxTokens ?? 8000),
          true,
          false,
          'output_truncated',
        );
      }
      return (block as any)?.text ?? '';
    } catch (e: any) {
      throw wrapProviderError(e);
    }
  }

  // OpenAI-compatible providers: openai, openrouter, deepseek, gemini, local servers.
  const baseURL = model.provider === 'nodus'
    ? await ensureNodusLocalServer(model.model, 'chat')
    : openAiCompatBase(model.provider);
  // Local models load a small, fixed context window; size the request to it (and bail
  // early with an actionable error) instead of overflowing with a cryptic llama.cpp error.
  const requestedMax = opts.maxTokens ?? 8000;
  const compatLocalPlan = isLocalProvider(model.provider)
    ? await localCompatPlan(model, opts, requestedMax)
    : null;
  const localMax = model.provider === 'nodus'
    ? nodusLocalMaxTokens(model, opts, requestedMax)
    : compatLocalPlan?.outputTokens ?? requestedMax;
  // On a flagged free tier, shrink max_tokens so prompt + output fits the provider's per-minute
  // token budget (Groq) — otherwise the request 400s with "Request too large". No-op off free tier.
  const freeTier = isProviderFreeTier(model.provider);
  const maxTokens = freeTier ? freeTierBudget(model, opts, localMax) : localMax;
  const schedulerEndpoint = model.provider === 'nodus' ? 'nodus-local-runtime' : baseURL;

  // Google's OpenAI compatibility layer does not expose GenerationConfig.seed. For
  // extraction, use the native endpoint so identical manual/automatic requests do not
  // receive a fresh random seed merely because they were dispatched at a different
  // time. Seed is documented as best-effort, so schema validation and fail-closed
  // chunk recovery remain mandatory.
  if (model.provider === 'gemini' && jsonMode && opts.deterministic) {
    const requestHash = providerRequestHash(model, opts);
    const seed = Number.parseInt(requestHash.slice(0, 8), 16) & 0x7fffffff;
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/native';
    try {
      const result = await scheduleProviderRequest(model, opts, key, endpoint, () =>
        completeGeminiDeterministicJson({
          apiKey: key,
          model: model.model,
          system: opts.system,
          user: opts.user,
          temperature: opts.temperature ?? 0.15,
          maxTokens,
          seed,
          timeoutMs: opts.timeoutMs ?? completionTimeoutMs(model),
          signal: opts.signal,
          images: opts.images,
        }));
      if (result.headers) observeProviderQuota(model, opts, key, endpoint, result.headers);
      recordProviderUsage(model, result.inputTokens ?? null, result.outputTokens ?? null);
      perfLogNs('AI response metadata', 0n, opts.perf, {
        provider: model.provider,
        model: model.model,
        class: opts.requestClass ?? 'interactive',
        jobId: opts.jobId ?? null,
        requestHash,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        deterministicSeed: seed,
      });
      if (result.finishReason === 'MAX_TOKENS') {
        throw new AiError(truncatedJsonMessage(model, maxTokens), true, false, 'output_truncated');
      }
      if (!result.text.trim()) {
        throw new AiError(`Respuesta vacía del proveedor de IA (${result.finishReason ?? 'sin finish_reason'}).`, false);
      }
      return result.text;
    } catch (error: any) {
      if (error instanceof AiError) throw error;
      throw wrapProviderError(error);
    }
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseURL ?? undefined,
    timeout: opts.timeoutMs ?? completionTimeoutMs(model),
    maxRetries: 0,
    defaultHeaders: openAiClientHeaders(model),
  });
  const createCompletion = (body: any) => model.provider === 'nodus'
    ? withNodusLocalServerLease(model.model, 'chat', async (apiUrl) => {
      const timeoutMs = opts.timeoutMs ?? completionTimeoutMs(model);
      const result = await withTransportDeadline(timeoutMs, opts.signal, (signal) => new OpenAI({
          apiKey: key,
          baseURL: apiUrl,
          timeout: timeoutMs,
          maxRetries: 0,
        }).chat.completions.create(body, { signal }).withResponse());
      observeProviderQuota(model, opts, key, schedulerEndpoint, result.response.headers);
      return result.data;
    })
    : withTransportDeadline(opts.timeoutMs ?? completionTimeoutMs(model), opts.signal, (signal) =>
      client.chat.completions.create(body, { signal }).withResponse()).then((result) => {
      observeProviderQuota(model, opts, key, schedulerEndpoint, result.response.headers);
      return result.data;
    });
  const baseBody = {
    model: model.model,
    ...requestSamplingBody(model, opts, reasoning),
    ...researchBody(model, opts),
    ...completionTokensBody(model.provider, model.model, maxTokens),
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.images?.length ? (openAiVisionContent(opts.user, opts.images) as any) : opts.user },
    ],
  };
  const extras = optionalBody(model, jsonMode, reasoning, opts);
  const compatStarted = Date.now();
  /** One replay, dispatched through the same retry/scheduler seam as the first attempt. */
  const replayBody = (body: Record<string, unknown>) => withThinkingCompatibility(model, { ...baseBody, ...body },
    request => withProviderRetries(freeTier, () => scheduleProviderRequest(
      model, opts, key, schedulerEndpoint, () => createCompletion(request as any),
    ), opts.signal, !opts.noRetry),
    { info: opts.researchModelInfo, endpoint: baseURL, noRetry: opts.noRetry, signal: opts.signal });
  try {
    let res;
    try {
      res = await replayBody(extras);
    } catch (e: any) {
      // The optional reasoning/JSON/routing params may be unsupported by this model, so the
      // request is replayed without them before the error is surfaced: see
      // `optionalFieldReplays` for the order and `replayRefusedOptionalFields` for how far a
      // custom gateway is allowed to push the request back to the plain OpenAI body.
      const sentReasoning = (extras as any).reasoning_effort !== undefined;
      if (!opts.noRetry && Object.keys(extras).length > 0 && shouldRetryWithoutOptionalFields(e, { provider: model.provider })) {
        res = await replayRefusedOptionalFields(model, extras, e, sentReasoning, replayBody);
      } else {
        throw e;
      }
    }
    const choice = res.choices[0];
    if (isLocalProvider(model.provider) && compatLocalPlan) {
      const config = getSettings().localProviders?.[model.provider];
      recordLocalAiDiagnostic({
        provider: model.provider,
        model: model.model,
        task: compatLocalPlan.task,
        transport: 'openai-compatible',
        contextMode: compatLocalPlan.contextMode,
        requestedContextTokens: config?.contextMode === 'manual' ? config.manualContextTokens : undefined,
        effectiveContextTokens: compatLocalPlan.contextTokens,
        estimatedInputTokens: compatLocalPlan.promptTokens,
        actualInputTokens: Number((res as any).usage?.prompt_tokens) || undefined,
        requestedOutputTokens: compatLocalPlan.requestedOutputTokens,
        sentOutputTokens: maxTokens,
        actualOutputTokens: Number((res as any).usage?.completion_tokens) || undefined,
        finishReason: choice?.finish_reason ?? undefined,
        batchSize: opts.batchSize,
        splitDepth: opts.splitDepth,
        elapsedMs: Date.now() - compatStarted,
        timestamp: Date.now(),
      });
    }
    recordProviderUsage(model, Number((res as any).usage?.prompt_tokens) || null, Number((res as any).usage?.completion_tokens) || null);
    perfLogNs('AI response metadata', 0n, opts.perf, {
      provider: model.provider,
      model: model.model,
      class: opts.requestClass ?? 'interactive',
      jobId: opts.jobId ?? null,
      requestHash: providerRequestHash(model, opts),
      backend: typeof (res as any).provider === 'string' ? (res as any).provider : null,
      inputTokens: Number((res as any).usage?.prompt_tokens) || null,
      outputTokens: Number((res as any).usage?.completion_tokens) || null,
    });
    const content = choice?.message?.content ?? '';
    // A structured response cut off at the output ceiling is not partial data, it is
    // broken data: extractJson's jsonrepair pass closes the dangling braces without a
    // word, so the caller silently stores a fraction of the ideas — or trips the schema
    // guard and reports "el JSON no cumple el esquema esperado", which sends the reader
    // hunting for a prompt bug that isn't there. Refuse instead. Plain prose is kept
    // as-is unless the caller opts into the same contract, because a chat answer cut
    // short is still usable while a persisted summary must not be stored clipped.
    const cutOff = /^(length|max_tokens|max_output_tokens)$/i.test(choice?.finish_reason ?? '');
    if (cutOff && (jsonMode || opts.requireCompleteOutput)) {
      throw new AiError(
        jsonMode ? truncatedJsonMessage(model, maxTokens) : truncatedOutputMessage(model, maxTokens),
        true,
        false,
        'output_truncated',
      );
    }
    // Some mandatory-reasoning models can spend the complete output allowance before
    // emitting the first JSON character. Test `finish_reason` before the generic empty
    // response guard so chunk-aware callers can recover by bisecting the input instead
    // of treating a recoverable truncation as a terminal provider failure.
    if (!content.trim()) {
      if ((choice as any)?.finish_reason === 'content_filter') {
        // A filtered completion is a refusal, not an outage; naming it keeps the user from
        // retrying a request the provider will keep declining.
        throw new AiError('El modelo se negó a responder a esta solicitud.', false);
      }
      if ((choice as any)?.finish_reason === 'error') {
        // OpenRouter can surface an upstream failure as a syntactically successful
        // HTTP response with an empty choice. Unlike an ambiguous timeout, the server
        // has explicitly said that no completion was produced, so an exact bounded
        // replay is safe and cannot duplicate a usable result.
        throw new AiError('El backend de IA terminó la solicitud sin producir respuesta.', true, false, 'provider_empty_error');
      }
      throw new AiError(`Respuesta vacía del proveedor de IA (${choice?.finish_reason ?? 'sin finish_reason'}).`, false);
    }
    return content;
  } catch (e: any) {
    // A caller abort (pause/cancel/stop) surfaces from the OpenAI SDK as
    // APIUserAbortError ("Request was aborted."). It must stay a cancellation:
    // wrapping it here would record a permanent, scary-looking job failure
    // instead of letting the queue settle the job as cancelled/paused.
    if (opts.signal?.aborted) throw opts.signal.reason ?? e;
    if (e instanceof AiError) throw e;
    throw wrapProviderError(e);
  }
}

/**
 * Wrap a provider/transport failure and record it in the processing log.
 *
 * This is the choke point for every model failure in the app: the classifier below is the
 * only place that knows which branch a provider error took, and it runs once per FINAL
 * failure (`withProviderRetries` retries the raw error before anything is wrapped). Logging
 * here rather than at each of the ~16 raise sites is why a provider outage is reported with
 * its real code — timeout, rate_limit, auth, invalid_json — instead of a generic "AI error".
 */
function wrapProviderError(e: any): AiError {
  const wrapped = classifyToAiError(e);
  logProviderFailure(wrapped, e);
  return wrapped;
}

/** Record one provider failure, with the code the classifier just decided. */
function logProviderFailure(wrapped: AiError, original: unknown): void {
  const code = providerLogCode(wrapped);
  logPipelineFailure({
    error: wrapped,
    code,
    subject: providerLogSubject(code),
    attempts: null,
    // The provider's own words, which our Spanish re-wording above replaces: that is what a
    // maintainer needs in a GitHub issue, and the log line is the translation on top of it.
    detail: original instanceof Error && original.message ? original.message : wrapped.message,
  });
}

/** The log code that matches the AiError the classifier produced. */
function providerLogCode(error: AiError): PipelineLogCode {
  switch (error.code) {
    case 'invalid_json': return 'invalid_json';
    case 'schema_mismatch': return 'schema_mismatch';
    case 'output_truncated': return 'output_truncated';
    case 'timeout': return 'timeout';
    case 'context_overflow': return 'context_overflow';
    case 'provider_empty_error': return 'provider_empty';
    case 'rate_limit': return 'rate_limit';
    case 'provider_5xx': return 'provider_5xx';
    case 'auth': return 'auth';
    case 'bad_request': return 'bad_request';
    case 'connection': return 'connection';
    default: break;
  }
  if (error.code === AI_MODEL_REQUIRED_ERROR_CODE || error.config) return 'model_missing';
  return 'unknown';
}

/** The sentence the log will show, so a JSON failure does not read as a model failure. */
function providerLogSubject(code: PipelineLogCode): PipelineLogSubjectId {
  if (code === 'invalid_json' || code === 'schema_mismatch' || code === 'output_truncated') return 'subjectJsonResponse';
  if (code === 'embedding_failed' || code === 'embedding_count_mismatch') return 'subjectEmbeddings';
  return 'subjectModelCall';
}

/**
 * Map one provider/transport failure onto our own error taxonomy. Pure: it decides, the
 * wrapper above records. (`classifyProviderError` in providerErrors.ts is the subscription
 * runtimes' OWN classifier — same idea, different providers.)
 */
function classifyToAiError(e: any): AiError {
  // Only OUR OWN cutoff errors are re-typed. Matching prose used to catch anything that
  // said "truncated" — an upstream gateway timeout was enough to send a deep scan
  // doubling its budget and splitting a chunk to chase a network hiccup.
  const message: string = e?.message ?? '';
  if (message.includes(OUTPUT_TRUNCATED_MARKER)) {
    return new AiError(message.replace(new RegExp(`^${OUTPUT_TRUNCATED_MARKER}:\\s*`), '') || 'La respuesta JSON quedó truncada.', true, false, 'output_truncated');
  }
  const status = e?.status ?? e?.response?.status;
  // A prompt that overflows the model's context window can arrive at various statuses
  // (400 from local servers, 400/413 from cloud). Reword it before status-based mapping
  // so the user gets an actionable message instead of a raw "n_keep >= n_ctx".
  if (isContextOverflow(e?.error?.message ?? e?.message)) {
    return new AiError(genericContextOverflowMessage(), false, true, 'context_overflow');
  }
  // Tagged, not merely worded: the deep scan answers a timeout by splitting the chunk
  // (less to generate → it fits), which it must not do for an unrelated failure.
  if (e?.name?.includes('Timeout') || /timeout|timed out/i.test(e?.message ?? '')) {
    return new AiError('Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.', false, false, 'timeout');
  }
  if (status === 429 || status === 529) return new AiError('Límite de tasa del proveedor de IA', true, false, 'rate_limit');
  if (status >= 500) return new AiError(`Error del proveedor (${status})`, true, false, 'provider_5xx');
  if (status === 401 || status === 403) return new AiError('Clave de IA inválida. Revísala en Ajustes.', false, true, 'auth');
  if (status === 400) {
    const detail = e?.error?.message ?? e?.message;
    const readable = detail && !/no body/i.test(detail) ? detail : null;
    // Not every provider answers a bad key with 401: Gemini returns 400 "Invalid Auth key.".
    if (readable && /invalid auth|api[ _-]?key|API_KEY_INVALID|unauthenticated|invalid credential/i.test(readable)) {
      return new AiError('Clave de IA inválida. Revísala en Ajustes.', false, true, 'auth');
    }
    // With a readable reason, say it. Without one, say only what we know: Gemini returns its
    // error as a JSON array that the OpenAI SDK cannot parse, so its 400s arrive as "no body"
    // — and blaming the context size there sends someone with a mistyped key off to trim their
    // data. A 400 we cannot explain should name the likely causes, not pick one.
    if (readable) return new AiError(`El proveedor rechazó la solicitud (400). Detalle: ${readable}`, false, false, 'bad_request');
    return new AiError(
      'El proveedor rechazó la solicitud (400) sin explicar el motivo. Suele ser la clave de IA (revísala en Ajustes) o, con mucho contexto, una petición que supera el límite del modelo.',
      false,
      false,
      'bad_request'
    );
  }
  // A dropped socket has no status, so nothing above classified it and it used to
  // be marked permanent. One gateway hiccup must not fail the whole work: mark it
  // retriable and let each caller's bounded retry ride it out (4 attempts in the
  // scan queue, 5 document attempts), so a dead endpoint still gives up.
  if (isTransientNetworkFailure(e)) {
    return new AiError(message || 'Error de conexión con el proveedor de IA.', true, false, 'connection');
  }
  return new AiError(message || 'Error de IA', false);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * True when the text ends inside an unclosed JSON structure — the response was cut off.
 *
 * The provider's own signal is checked first everywhere it exists (`finish_reason`,
 * `stop_reason`), but the subscription runtimes (codex, github-copilot) return a bare
 * string with no signal at all. Without this, `extractJson` slices to the last `}` — the
 * end of the last COMPLETE inner object — and jsonrepair closes the remains into
 * something the schema guard happily accepts, so a chunk cut in half is checkpointed as
 * a success and its ideas are lost with no error anywhere.
 */
function endsMidJson(text: string): boolean {
  const start = text.indexOf('{');
  if (start === -1) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let closed = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) closed = true;
    }
  }
  return inString || depth > 0 || !closed;
}

/** Strip code fences and locate the outermost JSON object. */
function extractJson(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1) throw new AiError('La respuesta no contiene JSON', false, false, 'invalid_json');
  const candidate = t.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

async function parseOrRepair<T>(
  model: ModelRef,
  text: string,
  guard: (v: unknown) => v is T,
  maxTokens?: number,
): Promise<T> {
  if (endsMidJson(text)) {
    throw new AiError(truncatedJsonMessage(model, maxTokens ?? 0), true, false, 'output_truncated');
  }
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (parseError) {
    // extractJson already attempts deterministic local repair. Anything still invalid
    // must be resampled from the frozen request; a remote repair prompt could invent
    // fields and would invalidate manual-versus-automatic comparisons.
    console.warn(`[ai] structured reply is not JSON (${errorMessage(parseError)}): ${String(text).slice(0, 400)}`);
    throw new AiError(`JSON inválido: ${errorMessage(parseError)}`, false, false, 'invalid_json');
  }
  if (guard(parsed)) return parsed;
  // Well-formed JSON that misses the schema is also resampled without changing the
  // prompt, model, temperature, context or output budget. The caller only ever sees
  // "invalid JSON", which hides *which* field the model got wrong: without this line
  // the reason a smaller local model's structured calls fail is unreadable from
  // outside, and a report can only guess at it.
  console.warn(`[ai] structured reply rejected by its guard: ${JSON.stringify(parsed).slice(0, 400)}`);
  throw new AiError('El JSON no cumple el esquema esperado', false, false, 'schema_mismatch');
}

/**
 * JSON completion retries the exact same request only when text came back but failed
 * validation. It never changes prompt, temperature, JSON mode, context, output budget,
 * model or provider as a hidden recovery strategy. Provider/transport failures
 * (timeout, empty, etc.) abort on the first attempt so an ambiguous request is not
 * blindly replayed.
 * Uses the given model override or the configured synthesis model.
 */
export async function completeJson<T>(
  opts: CallOpts,
  guard: (v: unknown) => v is T,
  model?: ModelRef | null
): Promise<T> {
  const resolved = resolveModel(model);
  const langOpts = withPromptContext(opts);
  // JSON/structured calls (scans, extraction) default to reasoning off for speed.
  const reasoning = langOpts.reasoning ?? 'off';
  // An explicit level chosen for this role (or for the model in Providers) is honoured
  // here too, or the selector beside the extraction and scan pickers would silently
  // govern nothing. Absent a choice this stays undefined and `off` keeps driving, so
  // the fast default for a corpus-wide run is unchanged.
  const codexReasoning = configuredCodexReasoning(resolved) ?? undefined;
  let lastErr: unknown;
  const attempts = langOpts.noRetry ? 1 : 3;
  for (let i = 0; i < attempts; i++) {
    langOpts.signal?.throwIfAborted();
    const retryDone = startPerf('JSON retry', langOpts.perf, { attempt: i + 1, jsonMode: true, invariantRequest: true });
    let text: string;
    try {
      text = await rawComplete(resolved, langOpts, true, reasoning, codexReasoning);
    } catch (e) {
      const explicitEmptyProviderFailure = e instanceof AiError && e.code === 'provider_empty_error';
      if (explicitEmptyProviderFailure && i < attempts - 1) {
        retryDone({ status: 'error', error: errorMessage(e), retry: true });
        lastErr = e;
        continue;
      }
      // Provider/transport failure (timeout, empty response, rate limit, 5xx, bad key).
      // Each call can burn the full 180s timeout, so looping here would let a hung
      // provider stall for minutes. The JSON retries below only help when text DID come
      // back but failed to parse — so on a transport failure, abort immediately.
      retryDone({ status: 'error', error: errorMessage(e), retry: false });
      throw e;
    }
    try {
      // A different repair prompt would violate the invariant request contract and
      // could invent data. Reject and resample the frozen request instead.
      const parsed = await parseOrRepair(resolved, text, guard, langOpts.maxTokens);
      if (i > 0) retryDone({ status: 'ok' });
      return deanonymizeResult(parsed);
    } catch (e) {
      // Replaying a response that already consumed the full output budget cannot
      // make it fit. Surface it immediately so chunk-aware callers can bisect the
      // input; invariant resampling remains useful only for malformed/schema JSON.
      const outputTruncated = e instanceof AiError && e.code === 'output_truncated';
      retryDone({ status: 'error', error: errorMessage(e), retry: !outputTruncated && i < attempts - 1 });
      if (outputTruncated) {
        logJsonFailure(e);
        throw e;
      }
      // A resample is worth seeing: the model produced malformed JSON and the frozen
      // request was replayed unchanged. `logRetry` carries the attempt pair.
      if (i < attempts - 1) {
        logPipelineWarning({
          subject: 'subjectJsonResponse',
          code: e instanceof AiError && e.code ? e.code : 'invalid_json',
          message: {
            id: 'logRetry',
            params: {
              subject: { id: 'subjectJsonResponse' },
              attempt: i + 2,
              max: attempts,
            },
          },
          detail: errorMessage(e),
        });
      }
      lastErr = e;
    }
  }
  logJsonFailure(lastErr);
  throw lastErr instanceof Error ? lastErr : new AiError('Fallo de parseo JSON');
}

/**
 * A response that came back but could not be used. Logged once, after the resamples are
 * exhausted, so a JSON failure is not silently reported as just another failed job.
 */
function logJsonFailure(error: unknown): void {
  const code: PipelineLogCode = error instanceof AiError && error.code === 'output_truncated'
    ? 'output_truncated'
    : error instanceof AiError && error.code === 'schema_mismatch'
      ? 'schema_mismatch'
      : 'invalid_json';
  logPipelineFailure({ error, code, subject: 'subjectJsonResponse' });
}

/** Plain-text completion for conversational assistant responses. */
export async function completeText(opts: CallOpts, model?: ModelRef | null): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  const codexReasoning = opts.reasoning === undefined || opts.useConfiguredCodexReasoning
    ? configuredCodexReasoning(resolved)
    : undefined;
  return __withTranscript(resolved, opts, async () => deanonymizeResult(await rawComplete(resolved, withPromptContext(opts), false, reasoning, codexReasoning)));
}

/**
 * Plain-text completion that does NOT apply the output-language directive. Use this
 * for tasks that must fully control their own output language (e.g. translation),
 * where forcing English/Spanish would defeat the purpose.
 */
export async function completeTextNeutral(opts: CallOpts, model?: ModelRef | null): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? 'off';
  return deanonymizeResult(await rawComplete(resolved, opts, false, reasoning));
}

/** Plain-text streaming completion. The returned string is the full accumulated answer. */
export async function completeTextStream(
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  model?: ModelRef | null,
  signal?: AbortSignal
): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  const codexReasoning = opts.reasoning === undefined || opts.useConfiguredCodexReasoning
    ? configuredCodexReasoning(resolved)
    : undefined;
  return __withTranscript(resolved, opts, () => rawCompleteStream(resolved, withPromptContext(opts), onDelta, reasoning, signal, codexReasoning));
}

/**
 * Streaming completion that leaves the output language entirely to the caller.
 * Conversational surfaces whose language follows the latest user turn use this
 * instead of inheriting the vault-wide promptLanguage override.
 */
export async function completeTextStreamNeutral(
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  model?: ModelRef | null,
  signal?: AbortSignal
): Promise<string> {
  const resolved = resolveModel(model);
  const reasoning = opts.reasoning ?? getSettings().chatReasoning ?? 'off';
  const codexReasoning = opts.reasoning === undefined || opts.useConfiguredCodexReasoning
    ? configuredCodexReasoning(resolved)
    : undefined;
  return rawCompleteStream(resolved, opts, onDelta, reasoning, signal, codexReasoning);
}

async function rawCompleteStream(
  model: ModelRef,
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  reasoning: ReasoningEffort = 'off',
  signal?: AbortSignal,
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  return rawCompleteStreamTransport(model, withJobThinking(model, opts), onDelta, reasoning, signal, codexReasoning);
}

async function rawCompleteStreamTransport(
  model: ModelRef,
  opts: CallOpts,
  onDelta: TextDeltaHandler,
  reasoning: ReasoningEffort = 'off',
  signal?: AbortSignal,
  codexReasoning?: CodexReasoningEffort | null
): Promise<string> {
  const { sent, privacy } = anonymizeCallOpts({ ...opts, system: excludeInvisibleArtifacts(opts.system), user: excludeInvisibleArtifacts(opts.user) });
  opts = sent;
  await assertCorpusRequestFits(model, opts);
  const scheduleOpts = { ...opts, signal: signal ?? opts.signal };

  let full = '';
  // Placeholders arrive split across chunk boundaries ("STU_" + "7K3Q"), so the reverse
  // mapping has to buffer rather than rewrite each delta on its own. Content and
  // reasoning are independent streams and MUST NOT share a rewriter.
  let contentRw = privacy ? createStreamDeanonymizer(privacy.scope) : null;
  let reasoningRw = privacy ? createStreamDeanonymizer(privacy.scope) : null;
  // A replay is a new generation. Any privacy rewriter tail belongs to the failed
  // attempt and must be discarded rather than prepended to the replay.
  const resetStreamRewriters = () => {
    contentRw = privacy ? createStreamDeanonymizer(privacy.scope) : null;
    reasoningRw = privacy ? createStreamDeanonymizer(privacy.scope) : null;
  };

  // Content deltas accumulate into the returned answer; reasoning deltas are streamed
  // for live display only and never become part of the saved answer.
  const emitContent = (delta: string | null | undefined) => {
    if (!delta) return;
    const text = contentRw ? contentRw.push(delta) : delta;
    if (!text) return; // the rewriter is holding a partial placeholder
    full += text;
    onDelta(text, 'content');
  };
  const emitReasoning = (delta: string | null | undefined) => {
    if (!delta) return;
    const text = reasoningRw ? reasoningRw.push(delta) : delta;
    if (!text) return;
    onDelta(text, 'reasoning');
  };

  /**
   * Drains both rewriters. This MUST run on every exit path, including the abort
   * returns below: an interrupted stream would otherwise silently lose its last few
   * characters. A `finally` block cannot do this job — `return full` evaluates before
   * `finally` runs, so the flushed text would never reach the caller.
   */
  const finish = (): string => {
    const restContent = contentRw?.flush();
    if (restContent) {
      full += restContent;
      onDelta(restContent, 'content');
    }
    const restReasoning = reasoningRw?.flush();
    if (restReasoning) onDelta(restReasoning, 'reasoning');
    return full;
  };

  if (model.provider === 'codex') {
    try {
      const answer = await scheduleProviderRequest(model, scheduleOpts, null, 'codex-subscription', () => completeWithChatGptSubscription({
        model: model.model,
        system: opts.system,
        user: opts.user,
        reasoning: opts.researchEffort !== undefined
          ? opts.researchEffort === 'standard' || opts.researchEffort === 'on' ? 'off' : opts.researchEffort
          : codexReasoning === undefined ? reasoning : codexReasoning,
        researchEffort: opts.researchEffort,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
      }));
      if (!full && answer) emitContent(answer);
      return finish();
    } catch (error) {
      if (signal?.aborted) return finish();
      throw subscriptionError(error);
    }
  }

  if (model.provider === 'github-copilot') {
    try {
      const answer = await scheduleProviderRequest(model, scheduleOpts, null, 'github-copilot-subscription', () => completeWithGitHubCopilotSubscription({
        model: model.model,
        system: opts.system,
        user: opts.user,
        reasoning,
        researchEffort: opts.researchEffort,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
        onReasoningDelta: emitReasoning,
      }));
      if (!full && answer) emitContent(answer);
      return finish();
    } catch (error) {
      if (signal?.aborted) return finish();
      throw subscriptionError(error);
    }
  }

  const key = resolveProviderKey(model.provider);
  if (!key) throw new AiError(`Falta la clave de IA para ${model.provider}. Configúrala en Ajustes.`, false, true);
  // Refuse an unconfigured custom endpoint here: further down the base URL becomes
  // `baseURL ?? undefined`, and an undefined baseURL sends the request to
  // api.openai.com — the user's prompt would leave for a provider they never chose.
  if (model.provider === 'custom' && !customBaseUrl()) {
    throw new AiError(CUSTOM_ENDPOINT_MISSING, false, true);
  }

  if (isLocalProvider(model.provider)) {
    const native = await tryLocalNativeStreaming(model, opts, key, scheduleOpts.signal, (delta, kind) => {
      if (kind === 'reasoning') emitReasoning(delta);
      else emitContent(delta);
    });
    if (native !== null) return finish();
  }

  if (model.provider === 'opencode-go') {
    try {
      const result = await scheduleProviderRequest(model, scheduleOpts, key, 'opencode-go', () => completeWithOpenCodeGo({
        apiKey: key,
        model: model.model,
        system: opts.system,
        user: opts.user,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        reasoning,
        researchEffort: opts.researchEffort,
        noRetry: opts.noRetry,
        jsonMode: false,
        timeoutMs: opts.timeoutMs,
        images: opts.images,
        signal,
        onDelta: emitContent,
        onReasoningDelta: emitReasoning,
        sessionId: openCodeGoSessionId(opts.jobId),
      }));
      await recordOpenCodeGoUsage(model.model, result.usage);
      if (!full && result.text) emitContent(result.text);
      return finish();
    } catch (error: any) {
      if (signal?.aborted) return finish();
      throw wrapProviderError(error);
    }
  }

  if (model.provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const __fetch = __transcriptFetch(key);
    const client = new Anthropic({ apiKey: key, ...(__fetch ? { fetch: __fetch } : {}), ...(opts.noRetry ? { maxRetries: 0 } : {}), ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}) });
    // `message_delta` is the final event and the only one carrying `stop_reason`; the thinking
    // token breakdown rides along with it. Kept outside `streamOnce` so a replay (temperature or
    // thinking recovery) overwrites rather than inherits the previous attempt's outcome.
    let stopReason: string | undefined;
    let outputTokens: number | undefined;
    let thinkingTokens: number | undefined;
    let textDeltas = 0;
    let thinkingDeltas = 0;
    const body = {
      model: model.model,
      max_tokens: opts.maxTokens ?? 8000,
      ...requestSamplingBody(model, opts, reasoning),
      ...researchBody(model, opts),
      system: opts.system,
      stream: true,
      messages: [{ role: 'user', content: opts.images?.length ? anthropicVisionContent(opts.user, opts.images) : opts.user }],
    };
    const streamOnce = (request: Record<string, unknown>) => scheduleProviderRequest(model, scheduleOpts, key, 'anthropic', async () => {
      const stream = await (client.messages.create as any)(request, { signal });
      for await (const event of stream as AsyncIterable<any>) {
        if (event?.type === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          if (typeof event.usage?.output_tokens === 'number') outputTokens = event.usage.output_tokens;
          const breakdown = event.usage?.output_tokens_details;
          if (typeof breakdown?.thinking_tokens === 'number') thinkingTokens = breakdown.thinking_tokens;
        } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') { textDeltas += 1; emitContent(event.delta.text); }
        else if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') { thinkingDeltas += 1; emitReasoning(event.delta.thinking); }
        else if (event?.type === 'text') emitContent(event.text);
      }
    });
    try {
      await withThinkingCompatibility(model, body, streamOnce, {
        info: opts.researchModelInfo, noRetry: opts.noRetry, signal,
        canReplay: () => textDeltas === 0 && thinkingDeltas === 0,
      });
    } catch (e: any) {
      // A user-triggered stop surfaces as an abort here — keep the partial answer
      // that already streamed instead of failing the whole turn.
      if (signal?.aborted) return finish();
      throw wrapProviderError(e);
    }
    // Flush before the emptiness check: the held tail can be the whole answer.
    const answer = finish();
    // An adaptive-thinking Claude spends output tokens thinking before it writes, so a long
    // turn can hit the ceiling with next to no visible text. The stream does not say so on its
    // own — `stop_reason` is the only signal — and silently storing the fragment is how a
    // two-line "answer" reached the user. Surface it like the non-streaming paths do.
    // A safety refusal comes back as `stop_reason: 'refusal'` with a thinking block and no text.
    // Without this branch it fell through to "empty response", which reads as a provider outage.
    if (stopReason === 'refusal') {
      console.error(`[anthropic-stream] stop_reason=refusal output_tokens=${outputTokens ?? '?'} thinking_tokens=${thinkingTokens ?? '?'} text_deltas=${textDeltas} model=${model.model}`);
      throw new AiError('El modelo se negó a responder a esta solicitud.', false, false, null);
    }
    if (stopReason === 'max_tokens') {
      console.error(`[anthropic-stream] stop_reason=max_tokens output_tokens=${outputTokens ?? '?'} thinking_tokens=${thinkingTokens ?? '?'} text_deltas=${textDeltas} max_tokens=${opts.maxTokens ?? 8000} model=${model.model}`);
      throw new AiError(truncatedOutputMessage(model, opts.maxTokens ?? 8000), false, false, 'output_truncated');
    }
    if (!answer.trim()) {
      console.error(`[anthropic-stream] empty answer stop_reason=${stopReason ?? 'none'} output_tokens=${outputTokens ?? '?'} thinking_tokens=${thinkingTokens ?? '?'} text_deltas=${textDeltas} thinking_deltas=${thinkingDeltas} max_tokens=${opts.maxTokens ?? 8000} model=${model.model}`);
      throw new AiError('Respuesta vacía del proveedor de IA.', false);
    }
    return answer;
  }

  const baseURL = model.provider === 'nodus'
    ? await ensureNodusLocalServer(model.model, 'chat')
    : openAiCompatBase(model.provider);
  // See rawComplete: fit the request to a local model's real context window.
  const requestedMax = opts.maxTokens ?? 8000;
  const compatLocalPlan = isLocalProvider(model.provider)
    ? await localCompatPlan(model, opts, requestedMax)
    : null;
  const localMax = model.provider === 'nodus'
    ? nodusLocalMaxTokens(model, opts, requestedMax)
    : compatLocalPlan?.outputTokens ?? requestedMax;
  const freeTier = isProviderFreeTier(model.provider);
  const maxTokens = freeTier ? freeTierBudget(model, opts, localMax) : localMax;
  const streamTimeoutMs = opts.timeoutMs ?? completionTimeoutMs(model);
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseURL ?? undefined,
    timeout: streamTimeoutMs,
    maxRetries: 0,
    defaultHeaders: openAiClientHeaders(model),
  });
  const baseBody = {
    model: model.model,
    ...requestSamplingBody(model, opts, reasoning),
    ...researchBody(model, opts),
    ...completionTokensBody(model.provider, model.model, maxTokens),
    stream: true as const,
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.images?.length ? (openAiVisionContent(opts.user, opts.images) as any) : opts.user },
    ],
  };
  // Streaming is plain text (no JSON mode); only reasoning + routing apply.
  const extras = optionalBody(model, false, reasoning, opts);
  const schedulerEndpoint = model.provider === 'nodus' ? 'nodus-local-runtime' : baseURL;
  const compatStarted = Date.now();
  // The last chunk's `finish_reason` is the only truncation signal on this transport; capture it
  // so a stream cut at the output ceiling is reported instead of silently stored as the answer.
  let finishReason: string | undefined;
  let streamChunks = 0;
  let streamReasoningChars = 0;
  const streamStarted = Date.now();
  const consumeStream = async (
    streamClient: InstanceType<typeof OpenAI>,
    body: any,
    transportSignal: AbortSignal,
    touch: () => void = () => {},
  ): Promise<void> => {
    const contentBefore = full.length;
    try {
      const result = await streamClient.chat.completions.create(body, { signal: transportSignal }).withResponse();
      observeProviderQuota(model, scheduleOpts, key, schedulerEndpoint, result.response.headers);
      const stream = result.data;
      for await (const chunk of stream as any) {
        if (chunk?.error) {
          const msg = chunk.error.message ?? 'Error del proveedor durante el streaming.';
          if (isLocalProvider(model.provider) && isContextOverflow(msg)) {
            throw new AiError(contextOverflowMessage(model.provider, model.model, null, null), false, true);
          }
          throw new AiError(msg, false);
        }
        touch();
        const choice = chunk?.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        streamChunks += 1;
        streamReasoningChars += String(delta?.reasoning ?? delta?.reasoning_content ?? '').length;
        emitReasoning(delta?.reasoning ?? delta?.reasoning_content);
        emitContent(delta?.content);
      }
    } catch (error) {
      // A timeout after deltas is ambiguous: retrying would duplicate already emitted
      // content. Re-type it without raw status so the retry layer cannot repeat it.
      if (full.length > contentBefore && !(error instanceof AiError)) throw wrapProviderError(error);
      throw error;
    }
  };
  // Idle, not total: a reasoning stream that keeps sending chunks is working, however long it
  // thinks. STREAM_TOTAL_MS still bounds a provider that never finishes.
  const executeStream = (body: any) => withIdleTransportDeadline(
    streamTimeoutMs,
    Math.max(streamTimeoutMs, STREAM_TOTAL_MS),
    signal ?? opts.signal,
    (transportSignal, touch) => model.provider === 'nodus'
      ? withNodusLocalServerLease(model.model, 'chat', (apiUrl) => consumeStream(new OpenAI({
          apiKey: key, baseURL: apiUrl, timeout: streamTimeoutMs, maxRetries: 0,
        }), body, transportSignal, touch))
      : consumeStream(client, body, transportSignal, touch),
  );
  /** One replay, dispatched through the same retry/scheduler seam as the first attempt. */
  const replayStream = (body: Record<string, unknown>) => withThinkingCompatibility(model, { ...baseBody, ...body },
    request => withProviderRetries(freeTier, () => scheduleProviderRequest(
      model, scheduleOpts, key, schedulerEndpoint, () => executeStream(request),
    ), signal, !opts.noRetry),
    { info: opts.researchModelInfo, endpoint: baseURL, noRetry: opts.noRetry, signal, canReplay: () => streamChunks === 0 });
  try {
    try {
      await replayStream(extras);
    } catch (e: any) {
      const sentReasoning = (extras as any).reasoning_effort !== undefined;
      if (!opts.noRetry && !signal?.aborted && streamChunks === 0 && Object.keys(extras).length > 0 && shouldRetryWithoutOptionalFields(e, { provider: model.provider })) {
        await replayRefusedOptionalFields(model, extras, e, sentReasoning, replayStream);
      } else if (!opts.noRetry && !signal?.aborted && full.length === 0 && isTransientNetworkFailure(e)) {
        // The connection dropped before any answer text (a long reasoning stream lost after
        // 84 KB of thinking: "read ETIMEDOUT"): nothing was shown that a replay could repeat,
        // so ask once more. Once answer text has streamed, the error stands.
        console.warn(`[compat-stream] connection lost before the answer (${e instanceof Error ? e.message : String(e)}); retrying once`);
        resetStreamRewriters();
        await replayStream(extras);
      } else {
        throw e;
      }
    }
  } catch (e: any) {
    // A user-triggered stop surfaces as an abort here — keep the partial answer.
    if (signal?.aborted) return finish();
    if (e instanceof AiError) throw e;
    throw wrapProviderError(e);
  }
  if (isLocalProvider(model.provider) && compatLocalPlan) {
    const config = getSettings().localProviders?.[model.provider];
    recordLocalAiDiagnostic({
      provider: model.provider,
      model: model.model,
      task: compatLocalPlan.task,
      transport: 'openai-compatible',
      contextMode: compatLocalPlan.contextMode,
      requestedContextTokens: config?.contextMode === 'manual' ? config.manualContextTokens : undefined,
      effectiveContextTokens: compatLocalPlan.contextTokens,
      estimatedInputTokens: compatLocalPlan.promptTokens,
      requestedOutputTokens: compatLocalPlan.requestedOutputTokens,
      sentOutputTokens: maxTokens,
      elapsedMs: Date.now() - compatStarted,
      timestamp: Date.now(),
    });
  }
  // Flush before the emptiness check: the held tail can be the whole answer.
  const answer = finish();
  if (/^content_filter$/i.test(finishReason ?? '')) {
    throw new AiError('El modelo se negó a responder a esta solicitud.', false);
  }
  if (/^(length|max_tokens|max_output_tokens)$/i.test(finishReason ?? '')) {
    throw new AiError(truncatedOutputMessage(model, maxTokens), false, false, 'output_truncated');
  }
  if (!answer.trim()) {
    // Say what came back: a stream that ended after reasoning only, with no finish reason, reads
    // the same to the user as an outage (hard synthesis routes on deepseek-flash, thinking high).
    console.error(`[compat-stream] empty answer finish_reason=${finishReason ?? 'none'} chunks=${streamChunks} reasoning_chars=${streamReasoningChars} max_tokens=${maxTokens} elapsed_ms=${Date.now() - streamStarted} model=${model.provider}/${model.model}`);
    throw new AiError('Respuesta vacía del proveedor de IA.', false);
  }
  return answer;
}

function embeddingConfig(): { provider: EmbeddingProvider; modelId: string } {
  const settings = getSettings();
  const provider = settings.embeddingProvider ?? 'openai';
  return {
    provider,
    modelId: normalizeEmbeddingModel(provider, settings.embeddingModel || DEFAULT_EMBEDDING_MODELS[provider]),
  };
}

export interface EmbeddingExecutionConfig {
  provider: EmbeddingProvider;
  modelId: string;
  endpoint: string;
}

/** Capture before dispatch; never persist credentials in a job. */
export function effectiveEmbeddingConfig(): EmbeddingExecutionConfig {
  const config = embeddingConfig();
  const endpoint = config.provider === 'nodus' ? 'nodus-local-runtime'
    : config.provider === 'gemini' ? geminiBatchEmbeddingEndpoint(config.modelId) : openAiCompatBase(config.provider);
  if (!endpoint) throw new AiError('Falta el endpoint del proveedor de embeddings.', false, true);
  return { ...config, endpoint };
}

export interface EmbeddingRequestOptions {
  config?: EmbeddingExecutionConfig;
  perf?: PerfContext;
  jobId?: string;
}

async function requestEmbeddings(
  provider: EmbeddingProvider,
  key: string,
  modelId: string,
  input: string | string[],
  signal?: AbortSignal,
  options: EmbeddingRequestOptions = {},
): Promise<number[][]> {
  const expected = Array.isArray(input) ? input.length : 1;
  const validate = (vectors: number[][]): number[][] => {
    try { return validateEmbeddingVectors(vectors, expected, modelId); }
    catch (error) { throw new AiError(error instanceof Error ? error.message : String(error), false); }
  };
  signal?.throwIfAborted();
  const endpoint = options.config?.endpoint ?? (provider === 'nodus'
    ? 'nodus-local-runtime'
    : provider === 'gemini'
      ? geminiBatchEmbeddingEndpoint(modelId)
      : openAiCompatBase(provider) ?? undefined);
  if (!endpoint) throw new AiError('Falta el endpoint del proveedor de embeddings.', false, true);
  const descriptor: AiRequestDescriptor = {
    provider,
    model: modelId,
    credentialScope: credentialScope(provider, key, endpoint),
    endpoint,
    requestClass: 'embedding',
    estimatedInputTokens: (Array.isArray(input) ? input : [input]).reduce((sum, value) => sum + estimateLocalTokens(value), 0),
    signal,
    jobId: options.jobId,
  };
  const runEmbeddingRequest = <T>(task: () => Promise<T>): Promise<T> => {
    const queuedAt = process.hrtime.bigint();
    const requestHash = createHash('sha256').update(JSON.stringify({
      provider,
      model: modelId,
      input: Array.isArray(input) ? input : [input],
    })).digest('hex');
    return aiRequestScheduler.run(descriptor, async () => {
      const startedAt = process.hrtime.bigint();
      const meta = { provider, model: modelId, class: 'embedding', inputs: expected, jobId: options.jobId ?? null, requestHash };
      perfLogNs('AI queue wait', startedAt - queuedAt, options.perf, meta);
      try { return await task(); }
      finally { perfLogNs('AI inference', process.hrtime.bigint() - startedAt, options.perf, meta); }
    });
  };
  if (provider === 'nodus') {
    return validate(await runEmbeddingRequest(() => embedWithNodusLocal(modelId, input, signal)));
  }
  const freeTier = isProviderFreeTier(provider);
  if (provider === 'gemini') {
    const texts = Array.isArray(input) ? input : [input];
    const nativeEndpoint = endpoint!;
    try {
      const vectors = await withProviderRetries(freeTier, () => runEmbeddingRequest(async () => {
        const timeoutController = new AbortController();
        const timeout = setTimeout(
          () => timeoutController.abort(new DOMException('Gemini embedding request timed out.', 'TimeoutError')),
          completionTimeoutMs({ provider, model: modelId }),
        );
        const abortFromCaller = () => timeoutController.abort(signal?.reason);
        signal?.addEventListener('abort', abortFromCaller, { once: true });
        try {
          const response = await fetch(nativeEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
            body: JSON.stringify(geminiBatchEmbeddingRequest(modelId, texts)),
            signal: timeoutController.signal,
          });
          aiRequestScheduler.observeQuota(descriptor, response.headers);
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            const detail = body && typeof body === 'object'
              ? (body as any).error?.message ?? JSON.stringify(body)
              : `HTTP ${response.status}`;
            const error = new Error(String(detail || `HTTP ${response.status}`)) as Error & {
              status: number;
              headers: Headers;
              error?: { message: string };
            };
            error.status = response.status;
            error.headers = response.headers;
            error.error = { message: String(detail || '') };
            throw error;
          }
          return parseGeminiBatchEmbeddingResponse(body);
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abortFromCaller);
        }
      }), signal);
      return validate(vectors);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AiError) throw error;
      throw wrapProviderError(error);
    }
  }
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: key,
    baseURL: endpoint,
    defaultHeaders: openAiClientHeaders({ provider }),
  });
  try {
    const res = await withProviderRetries(freeTier, () => runEmbeddingRequest(async () => {
      const result = await client.embeddings.create({ model: modelId, input }, { signal }).withResponse();
      aiRequestScheduler.observeQuota(descriptor, result.response.headers);
      return result.data;
    }), signal);
    return orderedEmbeddingEntries(res.data.map((entry) => ({ index: entry.index, embedding: entry.embedding })), expected, modelId);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof AiError) throw error;
    const wrapped = wrapProviderError(error);
    if (wrapped.config || wrapped.retriable || wrapped.code === 'timeout') throw wrapped;
    throw new AiError(error instanceof Error ? error.message : String(error), false);
  }
}

/**
 * Embeddings for idea fusion. Uses the embedding provider selected in Settings.
 * Returns null only when no embedding credential exists. Once configured, errors
 * are explicit: callers must checkpoint/retry rather than degrade silently.
 */
export async function embed(text: string, signal?: AbortSignal, options: EmbeddingRequestOptions = {}): Promise<number[] | null> {
  signal?.throwIfAborted();
  const config = options.config ?? effectiveEmbeddingConfig();
  options = { ...options, config };
  const { provider, modelId } = config;
  const key = resolveProviderKey(provider);
  if (!key) return null;
  const vectors = await requestEmbeddings(provider, key, modelId, text.slice(0, 8000), signal, options);
  return vectors[0] ?? null;
}

function embeddingBatchSize(provider: EmbeddingProvider, modelId: string): number {
  if (provider === 'nodus') return 64;
  if (provider === 'gemini' && /embedding-2/i.test(modelId)) return 1;
  if (provider === 'gemini') return 32;
  return 64;
}

async function embedBatchBisect(
  provider: EmbeddingProvider,
  key: string,
  modelId: string,
  texts: string[],
  signal?: AbortSignal,
  options: EmbeddingRequestOptions = {},
): Promise<number[][]> {
  return requestEmbeddingBatchWithBisection(
    texts,
    (batch) => requestEmbeddings(provider, key, modelId, batch, signal, options),
    signal,
    (error) => !(error instanceof AiError && (error.config || error.retriable)),
  );
}

/** Strict, ordered embedding batches. No configured input may disappear. */
export async function embedManyStrict(texts: string[], signal?: AbortSignal, options: EmbeddingRequestOptions = {}): Promise<number[][]> {
  signal?.throwIfAborted();
  if (texts.length === 0) return [];
  const clipped = texts.map((t) => t.slice(0, 8000));
  const config = options.config ?? effectiveEmbeddingConfig();
  options = { ...options, config };
  const { provider, modelId } = config;
  const key = resolveProviderKey(provider);
  if (!key) throw new AiError(`Falta la clave de IA para embeddings (${provider}). Configúrala en Ajustes o usa el modo léxico.`, false, true);

  const size = embeddingBatchSize(provider, modelId);
  const batches: string[][] = [];
  for (let index = 0; index < clipped.length; index += size) batches.push(clipped.slice(index, index + size));
  const vectors = (await Promise.all(batches.map((batch, index) => embedBatchBisect(
    provider,
    key,
    modelId,
    batch,
    signal,
    { ...options, jobId: options.jobId ? `${options.jobId}:batch:${index}` : undefined },
  )))).flat();
  if (vectors.length !== texts.length) {
    // One missing vector publishes a broken index, so this aborts the work — and it is the
    // kind of provider misbehaviour that is impossible to diagnose without the counts.
    logPipelineFailure({
      subject: 'subjectEmbeddings',
      code: 'embedding_count_mismatch',
      detail: `expected ${texts.length} vectors, received ${vectors.length}`,
    });
    throw new AiError(`La indexación produjo ${vectors.length} embeddings para ${texts.length} entradas; no se publicará un índice incompleto.`, false);
  }
  return vectors;
}

export async function embedMany(texts: string[], signal?: AbortSignal, options: EmbeddingRequestOptions = {}): Promise<(number[] | null)[]> {
  signal?.throwIfAborted();
  if (texts.length === 0) return [];
  const { provider } = options.config ?? effectiveEmbeddingConfig();
  if (!resolveProviderKey(provider)) return texts.map(() => null);
  return embedManyStrict(texts, signal, options);
}
