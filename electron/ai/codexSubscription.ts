import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  ChatGptSubscriptionLogin,
  ChatGptSubscriptionRateLimits,
  ChatGptSubscriptionStatus,
  CodexReasoningEffort,
  ModelInfo,
  ProviderModelCatalog,
  ReasoningEffort,
} from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';
import { agentRuntimeStatus, ensureAgentRuntime, onAgentRuntimeChanged } from './agentRuntime';
import { CodexAppServerClient } from './codexAppServerClient';
import { resolveCodexReasoningEffort, runIsolatedCodexCompletion } from './codexCompletion';
import { runIsolatedCodexImage } from './codexImage';
import { ProviderRuntimeError } from './providerErrors';

interface CodexAccountResponse {
  account: null | { type: 'apiKey' } | { type: 'chatgpt'; email: string | null; planType: string } | { type: 'amazonBedrock' };
  requiresOpenaiAuth: boolean;
}

interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface CodexRateLimitSnapshot {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
}

interface CodexRateLimitsResponse {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
}

interface CodexModel {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  inputModalities?: string[];
  isDefault: boolean;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: CodexReasoningEffort;
    description: string;
  }>;
  defaultReasoningEffort?: CodexReasoningEffort;
}

interface CodexCompletionOptions {
  model: string;
  system: string;
  user: string;
  reasoning: ReasoningEffort | CodexReasoningEffort | null;
  researchEffort?: import('@shared/researchReasoning').ResearchEffort;
  timeoutMs?: number;
  images?: VisionImagePart[];
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

const STATUS_UNAVAILABLE: ChatGptSubscriptionStatus = {
  available: false,
  connected: false,
  loginPending: false,
  email: null,
  planType: null,
  rateLimits: null,
  error: null,
};

const statusListeners = new Set<(status: ChatGptSubscriptionStatus) => void>();
let client: CodexAppServerClient | null = null;
let clientUnsubscribe: (() => void) | null = null;
let pendingLoginId: string | null = null;
let lastStatus: ChatGptSubscriptionStatus = STATUS_UNAVAILABLE;
let modelCatalog = new Map<string, CodexModel>();

export function onChatGptSubscriptionStatusChanged(
  listener: (status: ChatGptSubscriptionStatus) => void
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function emitStatus(status: ChatGptSubscriptionStatus): void {
  lastStatus = status;
  for (const listener of statusListeners) listener(status);
}

// The Codex CLI is downloaded the first time it is needed (./agentRuntime). Its
// progress travels with the status, and the account is read again once it is ready.
onAgentRuntimeChanged((kind) => {
  if (kind !== 'codex') return;
  const runtime = agentRuntimeStatus('codex');
  if (runtime.state === 'ready') void refreshAndEmitStatus();
  else emitStatus({ ...lastStatus, runtime });
});

function codexHome(): string {
  const dir = path.join(app.getPath('userData'), 'codex-subscription');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows and restrictive filesystems */ }
  return dir;
}

/** The App Server client, downloading the Codex CLI first if this machine lacks it. */
async function getClient(): Promise<CodexAppServerClient> {
  if (client) return client;
  const binaryPath = await ensureAgentRuntime('codex');
  if (client) return client;
  client = new CodexAppServerClient({
    binaryPath,
    codexHome: codexHome(),
    appVersion: app.getVersion(),
  });
  clientUnsubscribe = client.onNotification((method) => {
    if (method === 'account/login/completed') pendingLoginId = null;
    if (method === 'account/login/completed' || method === 'account/updated') modelCatalog = new Map();
    if (
      method === 'account/login/completed' ||
      method === 'account/updated' ||
      method === 'account/rateLimits/updated'
    ) {
      void refreshAndEmitStatus();
    }
  });
  return client;
}

function mapRateLimits(snapshot: CodexRateLimitSnapshot | null): ChatGptSubscriptionRateLimits | null {
  if (!snapshot) return null;
  return {
    primary: snapshot.primary,
    secondary: snapshot.secondary,
    credits: snapshot.credits,
  };
}

async function readStatus(refreshToken = false): Promise<ChatGptSubscriptionStatus> {
  // Reading the status never downloads the CLI: every visit to Providers reads it.
  const runtimeState = agentRuntimeStatus('codex');
  if (runtimeState.state !== 'ready') {
    return { ...STATUS_UNAVAILABLE, available: true, runtime: runtimeState };
  }
  try {
    const runtime = await getClient();
    const response = await runtime.request<CodexAccountResponse>('account/read', { refreshToken });
    if (response.account?.type !== 'chatgpt') {
      return {
        available: true,
        connected: false,
        loginPending: pendingLoginId !== null,
        email: null,
        planType: null,
        rateLimits: null,
        error: response.account
          ? 'Codex está autenticado con un método no permitido. Nodus solo admite el acceso gestionado con ChatGPT.'
          : null,
        runtime: runtimeState,
      };
    }

    let rateLimits: ChatGptSubscriptionRateLimits | null = null;
    try {
      const limits = await runtime.request<CodexRateLimitsResponse>('account/rateLimits/read');
      const codexBucket = limits.rateLimitsByLimitId?.codex ?? limits.rateLimits;
      rateLimits = mapRateLimits(codexBucket);
    } catch {
      // Account status remains useful if a plan has no rate-limit snapshot.
    }
    return {
      available: true,
      connected: true,
      loginPending: pendingLoginId !== null,
      email: response.account.email,
      planType: response.account.planType,
      rateLimits,
      error: null,
      runtime: runtimeState,
    };
  } catch (error) {
    return {
      ...STATUS_UNAVAILABLE,
      error: error instanceof Error ? error.message : String(error),
      runtime: agentRuntimeStatus('codex'),
    };
  }
}

// A connected account stays connected between calls, so re-reading it before every
// single generation cost two extra round trips and a forced network token refresh
// per completion — which a scan pipeline pays hundreds of times. Confirm at most
// once per window instead, and drop the cache whenever the session may have changed.
let connectedAt = 0;
let connectedCached = false;
const CONNECTED_TTL_MS = 60_000;

function invalidateConnectedCache(): void {
  connectedAt = 0;
  connectedCached = false;
}

/** Gate a generation on a connected account, reusing a recent check. Keeps the
 *  forced token refresh, but pays for it once per window rather than per call. */
async function ensureConnectedForCompletion(): Promise<void> {
  if (connectedCached && Date.now() - connectedAt < CONNECTED_TTL_MS) return;
  // Using the provider is what downloads its CLI, so a connected account carried over
  // from an installer that still shipped it keeps working after the update.
  await ensureAgentRuntime('codex');
  const status = await readStatus(true);
  connectedCached = status.connected;
  connectedAt = Date.now();
  if (!status.connected) {
    throw new ProviderRuntimeError(
      'La suscripción de ChatGPT no está conectada. Ábrela en Proveedores y modelos.',
      'auth'
    );
  }
}

/**
 * Fail a multi-step workflow before it starts if its selected Codex model cannot
 * be used. Deep Research deliberately recovers from optional generation stages;
 * without this gate an authentication error would be swallowed by each fallback
 * and the report could appear to advance for minutes without a working model.
 */
export async function assertChatGptSubscriptionConnected(): Promise<void> {
  await ensureConnectedForCompletion();
}

async function refreshAndEmitStatus(): Promise<ChatGptSubscriptionStatus> {
  const status = await readStatus(false);
  emitStatus(status);
  return status;
}

export async function getChatGptSubscriptionStatus(): Promise<ChatGptSubscriptionStatus> {
  return refreshAndEmitStatus();
}

/** Download the Codex CLI now (the Providers button), then read the account again. */
export async function installChatGptSubscriptionRuntime(): Promise<ChatGptSubscriptionStatus> {
  await ensureAgentRuntime('codex');
  return refreshAndEmitStatus();
}

export async function startChatGptSubscriptionLogin(): Promise<ChatGptSubscriptionLogin> {
  const response = await (await getClient()).request<
    { type: 'chatgpt'; loginId: string; authUrl: string } | { type: string }
  >('account/login/start', {
    type: 'chatgpt',
    appBrand: 'chatgpt',
    useHostedLoginSuccessPage: true,
  });
  if (response.type !== 'chatgpt' || !('loginId' in response) || !('authUrl' in response)) {
    throw new Error('Codex no inició el acceso gestionado con ChatGPT.');
  }
  pendingLoginId = response.loginId;
  emitStatus({ ...lastStatus, available: true, loginPending: true, error: null });
  return { loginId: response.loginId, authUrl: response.authUrl };
}

export async function cancelChatGptSubscriptionLogin(loginId: string): Promise<ChatGptSubscriptionStatus> {
  if (pendingLoginId && pendingLoginId !== loginId) throw new Error('El identificador de acceso ya no está activo.');
  await (await getClient()).request('account/login/cancel', { loginId });
  pendingLoginId = null;
  return refreshAndEmitStatus();
}

export async function logoutChatGptSubscription(): Promise<ChatGptSubscriptionStatus> {
  await (await getClient()).request('account/logout');
  pendingLoginId = null;
  modelCatalog = new Map();
  invalidateConnectedCache();
  return refreshAndEmitStatus();
}

async function readModelCatalog(force = false): Promise<CodexModel[]> {
  if (!force && modelCatalog.size > 0) return [...modelCatalog.values()];
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } = await (await getClient()).request('model/list', {
      cursor,
      limit: 100,
      // Keep the full capability catalog for validating an older saved model; the
      // renderer still filters hidden entries out of the visible picker below.
      includeHidden: true,
    });
    models.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  modelCatalog = new Map(models.map((model) => [model.id, model]));
  return models;
}

export async function listChatGptSubscriptionModels(): Promise<ModelInfo[]> {
  return (await listChatGptSubscriptionModelCatalog()).selectableModels;
}

export async function listChatGptSubscriptionModelCatalog(): Promise<ProviderModelCatalog> {
  await ensureAgentRuntime('codex');
  const status = await readStatus(false);
  if (!status.connected) {
    throw new ProviderRuntimeError('Conecta primero una suscripción de ChatGPT en Proveedores y modelos.', 'auth');
  }
  const models = await readModelCatalog(true);
  // Resolved once: finding it inside the comparator re-scanned the catalogue on
  // every comparison.
  const defaultId = models.find((model) => model.isDefault)?.id;
  const describe = (model: CodexModel): ModelInfo => ({
    id: model.id,
    name: model.displayName || model.id,
    vision: (model.inputModalities ?? ['text', 'image']).includes('image'),
    reasoning: (model.supportedReasoningEfforts?.length ?? 0) > 0,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
  });
  return {
    models: models.map(describe),
    selectableModels: models.filter((model) => !model.hidden).map(describe)
      .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.id.localeCompare(b.id)),
  };
}

/** Text/vision completion backed by an ephemeral, isolated Codex thread. */
export async function completeWithChatGptSubscription(options: CodexCompletionOptions): Promise<string> {
  await ensureConnectedForCompletion();

  const runtime = await getClient();
  const catalog = await readModelCatalog(false);
  const selected = catalog.find((model) => model.id === options.model) ?? null;
  // Research Assistant's standard is the minimum, even when a saved choice was
  // removed from the live catalogue. Other surfaces keep their existing fallback.
  const requested = options.researchEffort === undefined ? options.reasoning
    : !selected?.supportedReasoningEfforts?.length ? null
    : selected.supportedReasoningEfforts.some(option => option.reasoningEffort === options.researchEffort)
      ? options.researchEffort as CodexReasoningEffort : 'off';
  const reasoning = resolveCodexReasoningEffort(selected, requested);
  const tempRoot = path.join(app.getPath('temp') || os.tmpdir(), 'nodus-codex-');
  const workdir = await fs.promises.mkdtemp(tempRoot);
  try { await fs.promises.chmod(workdir, 0o700); } catch { /* Windows */ }

  try {
    return await runIsolatedCodexCompletion(runtime, { ...options, reasoning, workdir });
  } catch (error) {
    // The cached check can outlive the session it vouched for (revoked, expired,
    // signed out elsewhere). Any failure re-arms the full check for the next call
    // so a stale "connected" cannot pin the provider in a broken state.
    invalidateConnectedCache();
    throw error;
  } finally {
    await fs.promises.rm(workdir, { recursive: true, force: true });
  }
}

/**
 * Generate one image through the built-in tool of an ephemeral Codex thread.
 *
 * Unlike the image APIs of the other providers this one takes no size, quality or
 * format: the agent decides them from the prompt, and the bytes come back inline.
 */
export async function generateImageWithChatGptSubscription(options: {
  model: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  await ensureConnectedForCompletion();

  const runtime = await getClient();
  // A stored model that left the catalog would fail deep inside `thread/start` with a
  // protocol error. Say plainly what happened and where to fix it instead.
  const catalog = await readModelCatalog(false);
  if (!catalog.some((model) => model.id === options.model)) {
    // Fixed wording, not interpolated: this reason is stored beside a failed image and
    // read back later in the interface language, and the design modal already shows
    // which provider and model produced it.
    throw new ProviderRuntimeError(
      'El modelo de imagen elegido ya no está en el catálogo de ChatGPT. Elige otro en Proveedores y modelos.',
      'unavailable'
    );
  }

  const tempRoot = path.join(app.getPath('temp') || os.tmpdir(), 'nodus-codex-image-');
  const workdir = await fs.promises.mkdtemp(tempRoot);
  try { await fs.promises.chmod(workdir, 0o700); } catch { /* Windows */ }

  try {
    const generated = await runIsolatedCodexImage(runtime, { ...options, workdir });
    return { bytes: generated.bytes, mimeType: generated.mimeType };
  } catch (error) {
    // Same reasoning as the completion path: a failure re-arms the connection check
    // so a stale "connected" cannot pin the provider in a broken state.
    invalidateConnectedCache();
    throw error;
  } finally {
    await fs.promises.rm(workdir, { recursive: true, force: true });
  }
}

/**
 * Shut the runtime down from Electron's quit handlers.
 *
 * Synchronous on purpose: `before-quit` cannot await, so the graceful drain — which
 * only escalates to a signal after a 1.5s timer — was abandoned half-way and left
 * the runtime alive as an orphan holding a keyring session. Killing outright is the
 * only teardown that actually completes in a synchronous handler, and nothing is
 * lost by it: credentials are written at login, not at shutdown.
 */
export function killChatGptSubscriptionServer(): void {
  clientUnsubscribe?.();
  clientUnsubscribe = null;
  invalidateConnectedCache();
  const current = client;
  client = null;
  current?.killNow();
}
