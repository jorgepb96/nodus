import { researchReasoningProfile, resolveResearchEffort, type ResearchEffort } from '@shared/researchReasoning';
import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CopilotClient, ModelInfo as CopilotModelInfo } from '@github/copilot-sdk';
let CopilotClientCtor: typeof import('@github/copilot-sdk').CopilotClient;
let RuntimeConnection: typeof import('@github/copilot-sdk').RuntimeConnection;
try {
  const req = createRequire(__filename);
  const sdk = req('@github/copilot-sdk');
  CopilotClientCtor = sdk.CopilotClient;
  RuntimeConnection = sdk.RuntimeConnection;
} catch {
  CopilotClientCtor = class {} as any;
  RuntimeConnection = { forStdio: () => ({}) } as any;
}
import { agentRuntimeStatus, ensureAgentRuntime, onAgentRuntimeChanged } from './agentRuntime';
import { ProviderRuntimeError } from './providerErrors';
import type {
  GitHubCopilotSessionUsage,
  GitHubCopilotSubscriptionQuotaWindow,
  GitHubCopilotSubscriptionStatus,
  ModelInfo,
  ReasoningEffort,
} from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';
import { runIsolatedGitHubCopilotCompletion } from './githubCopilotCompletion';
import { rememberModelContextWindows } from './modelContextCache';

interface CompletionOptions {
  model: string;
  system: string;
  user: string;
  reasoning: ReasoningEffort;
  researchEffort?: ResearchEffort;
  timeoutMs?: number;
  images?: VisionImagePart[];
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

const EMPTY_STATUS: GitHubCopilotSubscriptionStatus = {
  available: false,
  connected: false,
  loginPending: false,
  login: null,
  authType: null,
  statusMessage: null,
  canLogout: false,
  quota: [],
  lastSession: null,
  error: null,
};

const listeners = new Set<(status: GitHubCopilotSubscriptionStatus) => void>();
let client: CopilotClient | null = null;
let loginProcess: ChildProcessWithoutNullStreams | null = null;
let loginDiagnostic = '';
let lastSession: GitHubCopilotSessionUsage | null = null;
let modelCache: CopilotModelInfo[] | null = null;
let modelCacheAt = 0;
let activeRuntimeRequests = 0;
let idleTimer: NodeJS.Timeout | null = null;
let lifetimeTimer: NodeJS.Timeout | null = null;
/** The catalogue follows the GitHub plan, so a tier change or a newly released model
 *  has to become visible without making the user sign out or restart Nodus. */
const MODEL_CACHE_TTL_MS = 10 * 60_000;
// Keep the authenticated runtime warm between nearby requests, but never let a
// vendor subprocess live for days just because Electron's main process does.
const COPILOT_IDLE_TIMEOUT_MS = 2 * 60_000;
const COPILOT_MAX_LIFETIME_MS = 30 * 60_000;

function copilotHome(): string {
  const dir = path.join(app.getPath('userData'), 'github-copilot-subscription');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows */ }
  return dir;
}

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // `SESSION` is deliberately absent: it matched DBUS_SESSION_BUS_ADDRESS,
    // XDG_SESSION_* and macOS SECURITYSESSIONID, which are desktop-integration
    // handles rather than credentials — and the CLI needs them to open a browser
    // and reach the keyring during login. Real session credentials still match
    // TOKEN/SECRET.
    if (/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE)/i.test(name)) continue;
    env[name] = value;
  }
  delete env.NODE_OPTIONS;
  env.COPILOT_HOME = copilotHome();
  return env;
}

/** The SDK client, downloading the Copilot CLI first if this machine lacks it. */
async function getClient(): Promise<CopilotClient> {
  if (client) return client;
  const executable = await ensureAgentRuntime('copilot');
  if (client) return client;
  const home = copilotHome();
  client = new CopilotClientCtor({
    connection: RuntimeConnection.forStdio({ path: executable, env: sanitizedEnv() }),
    mode: 'empty',
    baseDirectory: home,
    workingDirectory: home,
    useLoggedInUser: true,
    logLevel: 'none',
  });
  if (lifetimeTimer) clearTimeout(lifetimeTimer);
  lifetimeTimer = setTimeout(() => {
    lifetimeTimer = null;
    forceStopClient();
  }, COPILOT_MAX_LIFETIME_MS);
  lifetimeTimer.unref?.();
  return client;
}

function clearIdleTimer(): void {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function armIdleTimer(): void {
  clearIdleTimer();
  if (!client || activeRuntimeRequests > 0) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void stopClient();
  }, COPILOT_IDLE_TIMEOUT_MS);
  idleTimer.unref?.();
}

async function withCopilotRuntime<T>(work: (runtime: CopilotClient) => Promise<T>): Promise<T> {
  clearIdleTimer();
  activeRuntimeRequests += 1;
  try {
    return await work(await getClient());
  } finally {
    activeRuntimeRequests = Math.max(0, activeRuntimeRequests - 1);
    armIdleTimer();
  }
}

let lastStatus: GitHubCopilotSubscriptionStatus = EMPTY_STATUS;

function emit(status: GitHubCopilotSubscriptionStatus): void {
  lastStatus = status;
  for (const listener of listeners) listener(status);
}

// The Copilot CLI is downloaded the first time it is needed (./agentRuntime). Its
// progress travels with the status, and the account is read again once it is ready.
onAgentRuntimeChanged((kind) => {
  if (kind !== 'copilot') return;
  const runtime = agentRuntimeStatus('copilot');
  if (runtime.state === 'ready') void refresh();
  else emit({ ...lastStatus, runtime });
});

export function onGitHubCopilotSubscriptionStatusChanged(
  listener: (status: GitHubCopilotSubscriptionStatus) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function mapQuota(id: string, raw: any): GitHubCopilotSubscriptionQuotaWindow {
  const entitlement = Number(raw?.entitlementRequests ?? 0);
  const used = Number(raw?.usedRequests ?? 0);
  const unlimited = Boolean(raw?.isUnlimitedEntitlement);
  return {
    id,
    unlimited,
    entitlementRequests: entitlement,
    usedRequests: used,
    remainingRequests: unlimited ? null : Math.max(0, entitlement - used),
    remainingPercentage: Math.max(0, Math.min(100, Number(raw?.remainingPercentage ?? 0))),
    overage: Number(raw?.overage ?? 0),
    overageAllowed: Boolean(raw?.overageAllowedWithExhaustedQuota),
    usageAllowedAfterExhaustion: Boolean(raw?.usageAllowedWithExhaustedQuota),
    resetDate: typeof raw?.resetDate === 'string' ? raw.resetDate : null,
    tokenBasedBilling: Boolean(raw?.tokenBasedBilling),
    hasQuota: raw?.hasQuota === undefined ? unlimited || entitlement > used : Boolean(raw.hasQuota),
  };
}

async function readStatus(): Promise<GitHubCopilotSubscriptionStatus> {
  // Reading the status never downloads the CLI: every visit to Providers reads it.
  const runtimeState = agentRuntimeStatus('copilot');
  if (runtimeState.state !== 'ready') {
    return { ...EMPTY_STATUS, available: true, loginPending: loginProcess !== null, lastSession, runtime: runtimeState };
  }
  try {
    return await withCopilotRuntime(async (runtime) => {
      await runtime.start();
      const auth = await runtime.getAuthStatus();
      if (!auth.isAuthenticated) {
        return {
          ...EMPTY_STATUS,
          available: true,
          loginPending: loginProcess !== null,
          statusMessage: auth.statusMessage ?? null,
          lastSession,
          error: loginDiagnostic || null,
          runtime: runtimeState,
        };
      }
      let quota: GitHubCopilotSubscriptionQuotaWindow[] = [];
      try {
        const response = await runtime.rpc.account.getQuota({});
        quota = Object.entries(response.quotaSnapshots ?? {})
          .flatMap(([id, value]) => value ? [mapQuota(id, value)] : [])
          .sort((a, b) => Number(b.id === 'premium_interactions') - Number(a.id === 'premium_interactions') || a.id.localeCompare(b.id));
      } catch { /* authentication/catalogue still useful without a quota snapshot */ }
      return {
        available: true,
        connected: true,
        loginPending: loginProcess !== null,
        login: auth.login ?? null,
        authType: auth.authType ?? null,
        statusMessage: auth.statusMessage ?? null,
        // Never log the user out of GitHub CLI or revoke environment credentials.
        canLogout: auth.authType === 'user',
        quota,
        lastSession,
        error: null,
        runtime: runtimeState,
      };
    });
  } catch (error) {
    return {
      ...EMPTY_STATUS,
      loginPending: loginProcess !== null,
      lastSession,
      error: error instanceof Error ? error.message : String(error),
      runtime: agentRuntimeStatus('copilot'),
    };
  }
}

async function refresh(): Promise<GitHubCopilotSubscriptionStatus> {
  const status = await readStatus();
  emit(status);
  return status;
}

export async function getGitHubCopilotSubscriptionStatus(): Promise<GitHubCopilotSubscriptionStatus> {
  return refresh();
}

/** Download the Copilot CLI now (the Providers button), then read the account again. */
export async function installGitHubCopilotSubscriptionRuntime(): Promise<GitHubCopilotSubscriptionStatus> {
  await ensureAgentRuntime('copilot');
  return refresh();
}

export async function startGitHubCopilotSubscriptionLogin(): Promise<GitHubCopilotSubscriptionStatus> {
  const executable = await ensureAgentRuntime('copilot');
  const current = await readStatus();
  if (current.connected || loginProcess) return current;
  loginDiagnostic = '';
  const child = spawn(executable, ['login', '--host', 'https://github.com'], {
    env: sanitizedEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  loginProcess = child;
  child.stdin.end();
  const capture = (chunk: Buffer | string) => {
    loginDiagnostic = `${loginDiagnostic}${String(chunk)}`
      .replace(/(?:gh[oupsr]_|github_pat_)[A-Za-z0-9_]+/g, '[credencial ocultada]')
      .slice(-2_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => {
    loginDiagnostic = error.message;
    if (loginProcess === child) loginProcess = null;
    void refresh();
  });
  child.once('exit', (code) => {
    if (loginProcess === child) loginProcess = null;
    if (code === 0) loginDiagnostic = '';
    void stopClient().finally(() => refresh());
  });
  emit({ ...current, available: true, loginPending: true, error: null });
  return { ...current, available: true, loginPending: true, error: null };
}

export async function cancelGitHubCopilotSubscriptionLogin(): Promise<GitHubCopilotSubscriptionStatus> {
  const child = loginProcess;
  loginProcess = null;
  if (child && child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  loginDiagnostic = '';
  return refresh();
}

export async function logoutGitHubCopilotSubscription(): Promise<GitHubCopilotSubscriptionStatus> {
  await withCopilotRuntime(async (runtime) => {
    await runtime.start();
    const auth = await runtime.getAuthStatus();
    if (auth.authType !== 'user') {
      throw new Error('Esta conexión procede de GitHub CLI o del entorno. Nodus no cerrará una sesión global de GitHub; gestiónala en GitHub CLI.');
    }
    const current = await runtime.rpc.account.getCurrentAuth();
    if (current.authInfo) await runtime.rpc.account.logout({ authInfo: current.authInfo });
  });
  await stopClient();
  return refresh();
}

async function copilotModels(): Promise<CopilotModelInfo[]> {
  if (modelCache && Date.now() - modelCacheAt < MODEL_CACHE_TTL_MS) return modelCache;
  return withCopilotRuntime(async (runtime) => {
    await runtime.start();
    const auth = await runtime.getAuthStatus();
    if (!auth.isAuthenticated) {
      throw new ProviderRuntimeError('Conecta primero tu cuenta de GitHub Copilot en Proveedores y modelos.', 'auth');
    }
    const models = await runtime.listModels();
    rememberModelContextWindows('github-copilot', models.map(model => ({
      id: model.id, contextLength: model.capabilities?.limits?.max_context_window_tokens,
    })));
    modelCache = models;
    modelCacheAt = Date.now();
    return models;
  });
}

export async function listGitHubCopilotSubscriptionModels(): Promise<ModelInfo[]> {
  return (await copilotModels()).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    contextLength: model.capabilities?.limits?.max_context_window_tokens,
    vision: model.capabilities?.supports?.vision,
    reasoning: model.capabilities?.supports?.reasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts?.map(reasoningEffort => ({ reasoningEffort, description: '' })),
  }));
}

export async function completeWithGitHubCopilotSubscription(options: CompletionOptions): Promise<string> {
  const models = await copilotModels();
  const selected = models.find((model) => model.id === options.model);
  if (!selected) throw new Error(`El modelo «${options.model}» no está disponible en tu suscripción de GitHub Copilot.`);
  if (options.images?.length && selected.capabilities?.supports?.vision === false) {
    throw new Error(`El modelo «${options.model}» de GitHub Copilot no admite imágenes.`);
  }

  const workdir = await fs.promises.mkdtemp(path.join(app.getPath('temp') || os.tmpdir(), 'nodus-github-copilot-'));
  try { await fs.promises.chmod(workdir, 0o700); } catch { /* Windows */ }
  try {
    const result = await withCopilotRuntime((runtime) => runIsolatedGitHubCopilotCompletion(runtime, {
        ...options,
        researchNativeEffort: options.researchEffort === undefined ? undefined : resolveResearchEffort(
          researchReasoningProfile({ provider: 'github-copilot', model: options.model }, {
            id: selected.id,
            supportedReasoningEfforts: selected.supportedReasoningEfforts?.map(reasoningEffort => ({ reasoningEffort, description: '' })),
          }), options.researchEffort),
        supportsReasoning: Boolean(selected.capabilities?.supports?.reasoningEffort),
        workdir,
      }));
    if (result.usage) lastSession = result.usage;
    void refresh();
    return result.text;
  } finally {
    await fs.promises.rm(workdir, { recursive: true, force: true });
  }
}

async function stopClient(): Promise<void> {
  clearIdleTimer();
  if (lifetimeTimer) clearTimeout(lifetimeTimer);
  lifetimeTimer = null;
  const current = client;
  client = null;
  modelCache = null;
  modelCacheAt = 0;
  if (current) await current.stop();
}

export async function stopGitHubCopilotSubscription(): Promise<void> {
  const child = loginProcess;
  loginProcess = null;
  if (child && child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  await stopClient();
}

function forceStopClient(): void {
  clearIdleTimer();
  if (lifetimeTimer) clearTimeout(lifetimeTimer);
  lifetimeTimer = null;
  const current = client;
  client = null;
  modelCache = null;
  modelCacheAt = 0;
  if (current) void current.forceStop();
}

/** before-quit cannot await. Detach the SDK first, then issue its synchronous
 * SIGKILL path so neither Copilot nor a pending login can outlive Electron. */
export function killGitHubCopilotSubscriptionServer(): void {
  clearIdleTimer();
  if (lifetimeTimer) clearTimeout(lifetimeTimer);
  lifetimeTimer = null;
  const child = loginProcess;
  loginProcess = null;
  if (child && child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
  forceStopClient();
}
