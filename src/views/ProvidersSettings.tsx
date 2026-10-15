import { useEffect, useMemo, useState } from 'react';
import type {
  AgentRuntimeStatus,
  AiProvider,
  AppSettings,
  ChatGptSubscriptionRateLimitWindow,
  ChatGptSubscriptionStatus,
  CodexReasoningEffort,
  GitHubCopilotSubscriptionQuotaWindow,
  GitHubCopilotSubscriptionStatus,
  ImageModelInfo,
  LocalProvider,
  LocalProviderTestResult,
  ModelInfo,
  ModelRef,
  OpenCodeGoUsageStatus,
} from '@shared/types';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import {
  DEFAULT_LOCAL_BASE_URLS,
  normalizeCustomBaseUrl,
  normalizeCustomModels,
  supportsFreeTierShaping,
} from '@shared/providers';
import { AI_PROVIDERS, PROVIDER_LABELS, Icon, isLocalAiProvider, sameModel } from '../components/ui';
import { IMAGE_PROVIDER_LABELS } from '@shared/providers';
import { SettingsModelDot, SettingsModelList, settingsModelRowClass } from '../components/SettingsModelList';
import { codexReasoningLabel } from '../components/ModelPicker';
import { withCodexReasoning } from '@shared/codexReasoning';
import { t, tx } from '../i18n';
import { FavoriteModelAvailability } from '../components/FavoriteModelAvailability';

export function ProvidersSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState<AiProvider | null>(null);
  const [recoveringKeys, setRecoveringKeys] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  const favorites = settings.favorites ?? [];
  const isFav = (m: ModelRef) => favorites.some((f) => sameModel(f, m));
  const [catalogRevision, setCatalogRevision] = useState(0);
  const refreshProviders = async () => {
    setCatalogRevision((value) => value + 1);
    await onChange();
  };

  const toggleFav = async (m: ModelRef) => {
    const currentlyFav = isFav(m);
    const next = currentlyFav ? favorites.filter((f) => !sameModel(f, m)) : [...favorites, m];
    await window.nodus.updateSettings({ favorites: next });
    await onChange();
  };

  return (
    <>
    <section className="card p-4 mb-4">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">{t('Proveedores de IA y modelos')}</h2>
      <p className="mb-4 text-xs leading-5 text-neutral-500">
        {t('Las claves de API y los modelos configurados se comparten entre todas tus bóvedas.')}
      </p>

      {(settings.lockedProviderKeys?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-100" data-testid="locked-api-key-recovery">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <b>{t('Nodus ha encontrado claves de API cifradas que todavía no puede leer.')}</b>
              <p className="mt-1 leading-5 text-amber-800 dark:text-neutral-400">
                {t('No se han borrado. Pulsa recuperar y autoriza el acceso al Llavero de macOS si el sistema lo solicita.')}
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={recoveringKeys}
              onClick={async () => {
                setRecoveringKeys(true);
                setRecoveryMessage(null);
                try {
                  const result = await window.nodus.recoverApiKeys();
                  await refreshProviders();
                  setRecoveryMessage(result.remainingLockedProviders.length === 0
                    ? t('Claves recuperadas y protegidas de nuevo correctamente.')
                    : t('Algunas claves siguen bloqueadas. Vuelve a intentarlo y acepta el acceso al Llavero.'));
                } catch (error) {
                  setRecoveryMessage(error instanceof Error ? error.message : String(error));
                } finally {
                  setRecoveringKeys(false);
                }
              }}
            >
              {recoveringKeys ? t('Recuperando…') : t('Recuperar claves')}
            </button>
          </div>
          {recoveryMessage && <p className="mt-2 text-amber-800 dark:text-neutral-300">{recoveryMessage}</p>}
        </div>
      )}

      {/* Favorites feed every independent workload/feature selector. */}
      <FavoriteModelAvailability settings={settings} revision={catalogRevision} toggleFav={toggleFav} onChange={refreshProviders} />

      <div className="space-y-2">
        {AI_PROVIDERS.map((p) =>
          p === 'codex' ? (
            <ChatGptSubscriptionRow
              key={p}
              settings={settings}
              expanded={open === p}
              onToggle={() => setOpen(open === p ? null : p)}
              onChange={refreshProviders}
              isFav={isFav}
              toggleFav={toggleFav}
            />
          ) : p === 'github-copilot' ? (
            <GitHubCopilotSubscriptionRow
              key={p}
              expanded={open === p}
              onToggle={() => setOpen(open === p ? null : p)}
              isFav={isFav}
              toggleFav={toggleFav}
            />
          ) : p === 'custom' ? (
            <CustomProviderRow
              key={p}
              settings={settings}
              expanded={open === p}
              onToggle={() => setOpen(open === p ? null : p)}
              onChange={refreshProviders}
              isFav={isFav}
              toggleFav={toggleFav}
            />
          ) : isLocalAiProvider(p) ? (
            <LocalProviderRow
              key={p}
              provider={p as LocalProvider}
              settings={settings}
              expanded={open === p}
              onToggle={() => setOpen(open === p ? null : p)}
              onChange={refreshProviders}
              isFav={isFav}
              toggleFav={toggleFav}
            />
          ) : (
            <ProviderRow
              key={p}
              provider={p}
              settings={settings}
              expanded={open === p}
              onToggle={() => setOpen(open === p ? null : p)}
              onChange={refreshProviders}
              isFav={isFav}
              toggleFav={toggleFav}
            />
          )
        )}
      </div>
    </section>
    </>
  );
}

function ChatGptSubscriptionRow({
  settings,
  expanded,
  onToggle,
  onChange,
  isFav,
  toggleFav,
}: {
  settings: AppSettings;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => Promise<unknown>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const [status, setStatus] = useState<ChatGptSubscriptionStatus | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try { setStatus(await window.nodus.getChatGptSubscriptionStatus()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void refresh();
    return window.nodus.onChatGptSubscriptionStatusChanged((next) => {
      setStatus(next);
      if (!next.loginPending) setLoginId(null);
    });
  }, []);

  const connect = async () => {
    setError(null);
    try {
      // One click: an installer without the Codex CLI downloads it first (its progress
      // arrives as status), and an account it already knows needs no new login.
      if (status?.runtime && status.runtime.state !== 'ready') {
        const ready = await window.nodus.installChatGptSubscriptionRuntime();
        setStatus(ready);
        if (ready.connected) return;
      }
      const login = await window.nodus.startChatGptSubscriptionLogin();
      setLoginId(login.loginId);
      await window.nodus.openExternal(login.authUrl);
    } catch (e) { setError(ipcErrorText(e)); }
  };

  const cancelLogin = async () => {
    if (!loginId) return;
    setError(null);
    try { setStatus(await window.nodus.cancelChatGptSubscriptionLogin(loginId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoginId(null); }
  };

  const logout = async () => {
    setError(null);
    try {
      setStatus(await window.nodus.logoutChatGptSubscription());
      setModels(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setError(null);
    try { setModels(await window.nodus.listModels('codex')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingModels(false); }
  };

  const setReasoning = async (model: string, effort: CodexReasoningEffort | null) => {
    // Same writer the Models tab uses: the level belongs to the model, so choosing it
    // in either screen is choosing it for every task that runs that model.
    await window.nodus.updateSettings({
      codexReasoningEfforts: withCodexReasoning(settings.codexReasoningEfforts, model, effort),
    });
    await onChange();
  };

  const filtered = (models ?? []).filter((model) => {
    const query = search.toLowerCase();
    return !query || (model.id ?? '').toLowerCase().includes(query) || (model.name ?? '').toLowerCase().includes(query);
  });

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 dark:border-indigo-700/50 dark:bg-indigo-950/10" data-testid="chatgpt-subscription-provider">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={onToggle}>
        <span className="text-neutral-500">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{PROVIDER_LABELS.codex}</span>
        {loading ? (
          <span className="text-xs text-neutral-600">{t('comprobando…')}</span>
        ) : (
          <span className={status?.connected ? 'text-emerald-400 text-xs' : 'text-neutral-600 text-xs'}>
            {status?.connected ? `● ${t('suscripción conectada')}` : `○ ${t('sin conectar')}`}
          </span>
        )}
        {status?.planType && <span className="ml-auto text-[10px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{status.planType}</span>}
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs leading-5 text-neutral-600 dark:border-indigo-800/60 dark:bg-indigo-950/20 dark:text-neutral-400">
            <p>{t('Conexión mediante el protocolo oficial Codex App Server y el acceso gestionado de ChatGPT. Nodus no lee ni almacena tus credenciales.')}</p>
            <p className="mt-1">{t('Nodus es una aplicación independiente y no está afiliada, certificada ni respaldada por OpenAI.')}</p>
            <p className="mt-1">{t('El uso consume la cuota o los créditos de Codex incluidos en tu plan de ChatGPT; no consume saldo de la API de OpenAI.')}</p>
            <p className="mt-1">{t('Funciona como motor de Nodi, análisis y Deep Research de Nodus. No es el producto Deep Research de la web de ChatGPT.')}</p>
            <p className="mt-1">{t('Cada petición usa un hilo efímero aislado, sin acceso de escritura, sin red de herramientas y sin cargar tus MCP, plugins o instrucciones personales.')}</p>
            <button className="mt-1 text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200" onClick={() => window.nodus.openExternal('https://learn.chatgpt.com/docs/app-server')}>
              {t('Documentación oficial de Codex App Server ↗')}
            </button>
          </div>

          {status?.connected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">{t('Conectado')}</span>
                {status.email && <span className="text-neutral-600 dark:text-neutral-400">{status.email}</span>}
                <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void refresh()} disabled={loading}>
                  {t('Actualizar estado')}
                </button>
                <button className="btn btn-ghost text-red-600 dark:text-red-400" onClick={() => void logout()}>{t('Cerrar sesión')}</button>
              </div>
              {status.rateLimits && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <RateLimitCard label={t('Límite principal')} window={status.rateLimits.primary} />
                    <RateLimitCard label={t('Límite secundario')} window={status.rateLimits.secondary} />
                  </div>
                  {status.rateLimits.credits && (
                    <div className="rounded-lg border border-neutral-200 p-2 text-[11px] text-neutral-500 dark:border-neutral-800">
                      <div className="flex justify-between gap-3">
                        <span>{t('Créditos adicionales')}</span>
                        <span className="text-neutral-700 dark:text-neutral-300">
                          {status.rateLimits.credits.unlimited
                            ? t('Ilimitados')
                            : status.rateLimits.credits.balance ?? (status.rateLimits.credits.hasCredits ? t('Disponibles') : t('Sin créditos'))}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2 items-center">
                <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void loadModels()} disabled={loadingModels}>
                  {loadingModels ? t('Cargando…') : t('Cargar modelos de Codex')}
                </button>
                {models && <input className="input flex-1" placeholder={t('Buscar modelo…')} value={search} onChange={(e) => setSearch(e.target.value)} />}
                {models && <span className="text-xs text-neutral-500">{filtered.length}</span>}
              </div>
              {models && (
                <>
                  <p className="text-[11px] leading-5 text-neutral-500">
                    {t('Cada modelo muestra únicamente los niveles de razonamiento publicados por Codex. Lo que elijas aquí es el predeterminado del modelo: cada tarea puede fijar el suyo propio en Modelos.')}
                  </p>
                  <SettingsModelList className="max-h-72 overflow-y-auto" data-testid="provider-model-list-codex">
                    <ModelList
                      provider="codex"
                      models={filtered.slice(0, 300)}
                      isFav={isFav}
                      toggleFav={toggleFav}
                      codexReasoningEfforts={settings.codexReasoningEfforts}
                      onCodexReasoningChange={setReasoning}
                    />
                  </SettingsModelList>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {status?.runtime && status.runtime.state !== 'ready' && <AgentRuntimeNotice runtime={status.runtime} />}
              <button className="btn btn-primary" onClick={() => void connect()} disabled={status?.loginPending || status?.runtime?.state === 'installing'}>
                {status?.runtime?.state === 'installing' ? runtimeProgressLabel(status.runtime)
                  : status?.loginPending ? t('Esperando acceso en el navegador…') : t('Conectar suscripción de ChatGPT')}
              </button>
              {status?.loginPending && loginId && (
                <button className="btn btn-ghost" onClick={() => void cancelLogin()}>{t('Cancelar acceso')}</button>
              )}
              <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void refresh()} disabled={loading}>{t('Comprobar estado')}</button>
            </div>
          )}

          {(error || status?.error) && <div className="text-xs text-red-600 dark:text-red-400">{error || status?.error}</div>}
        </div>
      )}
    </div>
  );
}

const ipcErrorText = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');

/** Download progress of a vendor CLI, as a percentage once its size is known. */
function runtimePercent(runtime: AgentRuntimeStatus): number | null {
  return runtime.state === 'installing' && runtime.totalBytes
    ? Math.min(100, Math.floor((runtime.receivedBytes / runtime.totalBytes) * 100))
    : null;
}

function runtimeProgressLabel(runtime: AgentRuntimeStatus): string {
  const percent = runtimePercent(runtime);
  return `${t('Descargando el motor oficial…')}${percent === null ? '' : ` ${percent} %`}`;
}

/**
 * Installers no longer carry the Codex and Copilot CLIs: connecting downloads the
 * vendor's own package from npm, checked against the hash pinned at build time.
 */
function AgentRuntimeNotice({ runtime }: { runtime: AgentRuntimeStatus }) {
  const percent = runtimePercent(runtime);
  return (
    <div className="w-full space-y-2 text-xs" data-testid="agent-runtime-download" data-state={runtime.state}>
      <p className="leading-5 text-neutral-600 dark:text-neutral-400">
        {t('Nodus descarga el motor oficial la primera vez que lo necesitas, desde el registro de npm, y comprueba su huella antes de usarlo.')}
      </p>
      {runtime.state === 'failed' && (
        <p className="text-red-600 dark:text-red-400">{t('La descarga del motor oficial ha fallado.')}</p>
      )}
      {percent !== null && (
        <div className="h-1 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function RateLimitCard({ label, window }: { label: string; window: ChatGptSubscriptionRateLimitWindow | null }) {
  if (!window) return null;
  const used = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
  const remaining = 100 - used;
  const reset = window.resetsAt ? new Date(window.resetsAt * 1_000).toLocaleString() : null;
  return (
    <div className="rounded-lg border border-neutral-200 p-2 text-[11px] text-neutral-500 dark:border-neutral-800">
      <div className="flex justify-between"><span>{label}</span><span>{tx('{n}% restante', { n: remaining })}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-emerald-500" style={{ width: `${remaining}%` }} /></div>
      <div className="mt-1">{tx('{n}% usado', { n: used })}</div>
      {reset && <div className="mt-1">{tx('Se restablece: {time}', { time: reset })}</div>}
    </div>
  );
}

function GitHubCopilotSubscriptionRow({
  expanded,
  onToggle,
  isFav,
  toggleFav,
}: {
  expanded: boolean;
  onToggle: () => void;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const [status, setStatus] = useState<GitHubCopilotSubscriptionStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try { setStatus(await window.nodus.getGitHubCopilotSubscriptionStatus()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void refresh();
    return window.nodus.onGitHubCopilotSubscriptionStatusChanged(setStatus);
  }, []);

  const connect = async () => {
    setError(null);
    try {
      // One click: an installer without the Copilot CLI downloads it first (its progress
      // arrives as status), and a session it already finds needs no new login.
      if (status?.runtime && status.runtime.state !== 'ready') {
        const ready = await window.nodus.installGitHubCopilotSubscriptionRuntime();
        setStatus(ready);
        if (ready.connected) return;
      }
      setStatus(await window.nodus.startGitHubCopilotSubscriptionLogin());
    }
    catch (reason) { setError(ipcErrorText(reason)); }
  };

  const cancel = async () => {
    setError(null);
    try { setStatus(await window.nodus.cancelGitHubCopilotSubscriptionLogin()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const logout = async () => {
    setError(null);
    try {
      setStatus(await window.nodus.logoutGitHubCopilotSubscription());
      setModels(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setError(null);
    try { setModels(await window.nodus.listModels('github-copilot')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoadingModels(false); }
  };

  const filtered = (models ?? []).filter((model) => {
    const query = search.toLowerCase();
    return !query || (model.id ?? '').toLowerCase().includes(query) || (model.name ?? '').toLowerCase().includes(query);
  });

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 dark:border-sky-700/50 dark:bg-sky-950/10" data-testid="github-copilot-subscription-provider">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={onToggle}>
        <span className="text-neutral-500">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{PROVIDER_LABELS['github-copilot']}</span>
        {loading ? <span className="text-xs text-neutral-600">{t('comprobando…')}</span> : (
          <span className={status?.connected ? 'text-emerald-400 text-xs' : 'text-neutral-600 text-xs'}>
            {status?.connected ? `● ${t('suscripción conectada')}` : `○ ${t('sin conectar')}`}
          </span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-sky-700 dark:text-sky-300">{t('SDK oficial · preview')}</span>
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-neutral-600 dark:border-sky-800/60 dark:bg-sky-950/20 dark:text-neutral-400">
            <p>{t('Nodus usa el SDK y el runtime oficiales de GitHub Copilot. Cada petición se factura a la suscripción de GitHub del usuario; no requiere claves de los modelos.')}</p>
            <p className="mt-1">{t('La integración oficial está en public preview. Nodus es independiente y no está afiliada, certificada ni respaldada por GitHub.')}</p>
            <p className="mt-1">{t('Cada petición se ejecuta en una sesión efímera sin herramientas, MCP, memoria, acceso a archivos, GitHub ni instrucciones del proyecto.')}</p>
            <button className="mt-1 text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200" onClick={() => window.nodus.openExternal('https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate')}>
              {t('Documentación oficial del SDK de Copilot ↗')}
            </button>
          </div>

          {status?.connected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">{t('Conectado')}</span>
                {status.login && <span className="text-neutral-700 dark:text-neutral-300">@{status.login}</span>}
                {status.authType && <span className="text-neutral-500">{status.authType}</span>}
                <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void refresh()} disabled={loading}>{t('Actualizar cuota')}</button>
                {status.canLogout && <button className="btn btn-ghost text-red-600 dark:text-red-400" onClick={() => void logout()}>{t('Cerrar sesión')}</button>}
              </div>
              {status.quota.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {status.quota.map((quota) => <GitHubQuotaCard key={quota.id} quota={quota} />)}
                </div>
              ) : <div className="text-xs text-neutral-500">{t('GitHub no devolvió un contador de cuota para esta cuenta.')}</div>}
              {status.lastSession && (
                <div className="rounded-lg border border-neutral-200 p-2 text-[11px] text-neutral-500 dark:border-neutral-800">
                  {tx('Última petición en Nodus: {cost} créditos/solicitudes premium · {input} tokens de entrada · {output} de salida', {
                    cost: status.lastSession.premiumRequestCost.toLocaleString(),
                    input: status.lastSession.inputTokens.toLocaleString(),
                    output: status.lastSession.outputTokens.toLocaleString(),
                  })}
                </div>
              )}
              <div className="flex gap-2 items-center">
                <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void loadModels()} disabled={loadingModels}>
                  {loadingModels ? t('Cargando…') : t('Cargar modelos de Copilot')}
                </button>
                {models && <input className="input flex-1" placeholder={t('Buscar modelo…')} value={search} onChange={(event) => setSearch(event.target.value)} />}
                {models && <span className="text-xs text-neutral-500">{filtered.length}</span>}
              </div>
              {models && (
                <SettingsModelList className="max-h-64 overflow-y-auto" data-testid="provider-model-list-github-copilot">
                  <ModelList provider="github-copilot" models={filtered.slice(0, 300)} isFav={isFav} toggleFav={toggleFav} />
                </SettingsModelList>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {status?.runtime && status.runtime.state !== 'ready' && <AgentRuntimeNotice runtime={status.runtime} />}
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary" onClick={() => void connect()} disabled={status?.loginPending || status?.runtime?.state === 'installing'}>
                  {status?.runtime?.state === 'installing' ? runtimeProgressLabel(status.runtime)
                    : status?.loginPending ? t('Esperando acceso de GitHub en el navegador…') : t('Conectar GitHub Copilot')}
                </button>
                {status?.loginPending && <button className="btn btn-ghost" onClick={() => void cancel()}>{t('Cancelar acceso')}</button>}
                <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void refresh()} disabled={loading}>{t('Comprobar estado')}</button>
              </div>
              <p className="text-[11px] leading-4 text-neutral-500">{t('El runtime oficial abre el flujo OAuth de dispositivo y guarda su credencial en el almacén seguro del sistema. Si ya usas GitHub CLI, puede reutilizar esa sesión sin modificarla.')}</p>
            </div>
          )}
          {(error || status?.error) && <div className="text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{error || status?.error}</div>}
        </div>
      )}
    </div>
  );
}

function GitHubQuotaCard({ quota }: { quota: GitHubCopilotSubscriptionQuotaWindow }) {
  const label = quota.id === 'premium_interactions'
    ? t('Créditos / solicitudes premium')
    : quota.id === 'chat' ? t('Chat') : quota.id === 'completions' ? t('Completado') : quota.id;
  const remaining = Math.max(0, Math.min(100, Math.round(quota.remainingPercentage)));
  const reset = quota.resetDate ? new Date(quota.resetDate).toLocaleString() : null;
  const detail = quota.unlimited
    ? t('Ilimitado según GitHub')
    : tx('{remaining} de {total} restantes · {used} usadas', {
        remaining: (quota.remainingRequests ?? 0).toLocaleString(),
        total: quota.entitlementRequests.toLocaleString(),
        used: quota.usedRequests.toLocaleString(),
      });
  return (
    <div className="rounded-lg border border-neutral-200 p-2 text-[11px] text-neutral-500 dark:border-neutral-800">
      <div className="flex justify-between gap-2"><span>{label}</span><span className="text-neutral-700 dark:text-neutral-300">{quota.unlimited ? '∞' : tx('{n}% restante', { n: remaining })}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-emerald-500" style={{ width: `${quota.unlimited ? 100 : remaining}%` }} /></div>
      <div className="mt-1">{detail}</div>
      {quota.overage > 0 && <div className="mt-1 text-amber-700 dark:text-amber-400">{tx('{n} de uso adicional', { n: quota.overage })}</div>}
      {reset && <div className="mt-1">{tx('Se restablece: {time}', { time: reset })}</div>}
    </div>
  );
}

type ImageSort = 'provider' | 'alpha' | 'price_asc' | 'price_desc';

export function ImageGenerationSettings({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<unknown> }) {
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ImageSort>('provider');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await window.nodus.listImageModels());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = models.filter((model) =>
      !q || `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(q)
    );
    return [...filtered].sort((a, b) => {
      if (sort === 'provider') return (a.provider ?? '').localeCompare(b.provider ?? '') || (a.name ?? '').localeCompare(b.name ?? '');
      if (sort === 'alpha') return (a.name ?? '').localeCompare(b.name ?? '') || (a.provider ?? '').localeCompare(b.provider ?? '');
      // Providers publish unlike sizes/units. Price order is therefore scoped
      // to one provider and never implies a false cross-provider comparison.
      const providerOrder = (a.provider ?? '').localeCompare(b.provider ?? '');
      if (providerOrder !== 0) return providerOrder;
      const aPrice = a.imagePriceUsd;
      const bPrice = b.imagePriceUsd;
      if (aPrice == null && bPrice == null) return (a.name ?? '').localeCompare(b.name ?? '');
      if (aPrice == null) return 1;
      if (bPrice == null) return -1;
      return sort === 'price_asc' ? aPrice - bPrice : bPrice - aPrice;
    });
  }, [models, search, sort]);

  const select = async (model: ImageModelInfo) => {
    await window.nodus.updateSettings({ imageProvider: model.provider, imageModel: model.id });
    await onChange();
  };

  const money = (value: number | null) => value == null ? t('No disponible') : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} / 1M`;

  return (
    <section className="card p-4 mb-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">{t('Generación de imágenes')}</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {t('Configuración independiente para las imágenes decorativas opcionales. OpenAI usa su API oficial de imágenes y reutiliza la clave de OpenAI; Google reutiliza la clave de Gemini.')}
          </p>
        </div>
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void load()} disabled={loading}>
          <span className={loading ? 'animate-spin' : ''}>↻</span> {t('Actualizar modelos')}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)] gap-3 max-md:grid-cols-1">
        <label className="text-xs text-neutral-500">
          {t('Estilo predeterminado')}
          <select
            className="input mt-1 w-full"
            value={settings.imageStyle}
            onChange={(event) => {
              void window.nodus.updateSettings({ imageStyle: event.target.value as AppSettings['imageStyle'] }).then(onChange);
            }}
          >
            {DECORATIVE_IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{t(style.label)}</option>)}
          </select>
        </label>
        <div className="text-xs text-neutral-500">
          {t('Selección actual')}
          <div className="mt-1 rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-300">
            {IMAGE_PROVIDER_LABELS[settings.imageProvider]} · {settings.imageModel}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          className="input min-w-[16rem] flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Buscar por proveedor, nombre o identificador…')}
        />
        <select className="input" value={sort} onChange={(event) => setSort(event.target.value as ImageSort)}>
          <option value="provider">{t('Proveedor y nombre')}</option>
          <option value="alpha">{t('Orden alfabético')}</option>
          <option value="price_asc">{t('Precio por imagen: menor a mayor (por proveedor)')}</option>
          <option value="price_desc">{t('Precio por imagen: mayor a menor (por proveedor)')}</option>
        </select>
      </div>

      <p className="mt-2 text-[11px] leading-4 text-neutral-600">
        {t('Como los proveedores publican tamaños y métricas diferentes, la ordenación por precio se aplica por separado dentro de cada proveedor. Los modelos sin precio directo quedan al final; no se estiman costes.')}
      </p>
      {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
      {loading && <div className="mt-4 text-sm text-neutral-500">{t('Consultando catálogos oficiales…')}</div>}
      {!loading && (
        <SettingsModelList className="mt-3 max-h-[32rem] overflow-y-auto" data-testid="image-generation-model-list">
          {shown.map((model) => {
            const selected = settings.imageProvider === model.provider && settings.imageModel === model.id;
            const favorite = settings.imageFavorites?.some(ref => ref.provider === model.provider && ref.model === model.id) ?? false;
            return (
              <div key={`${model.provider}:${model.id}`} className="flex items-center gap-1">
              <button
                key={`${model.provider}:${model.id}`}
                className={settingsModelRowClass(selected, true, 'grid w-full grid-cols-[minmax(14rem,1.5fr)_repeat(3,minmax(7rem,1fr))] gap-3 text-left text-xs max-xl:grid-cols-2')}
                onClick={() => void select(model)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <SettingsModelDot selected={selected} />
                  <div className="min-w-0">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{model.name}</span>
                    <div className="mt-1 truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-600" title={model.id}>{IMAGE_PROVIDER_LABELS[model.provider]} · {model.id}</div>
                  </div>
                </div>
                <PriceCell label={t('Entrada')} value={model.provider === 'nodus' ? t('Local') : money(model.inputPriceUsdPerMillion)} />
                <PriceCell label={t('Salida')} value={model.provider === 'nodus' ? t('Local') : money(model.outputPriceUsdPerMillion)} />
                <PriceCell label={t('Imagen')} value={model.imagePriceLabel ?? t('No disponible')} />
              </button>
              <button type="button" className="btn btn-ghost shrink-0" aria-label={`${favorite ? t('Quitar de favoritos') : t('Guardar en favoritos')}: ${model.name}`} aria-pressed={favorite} data-testid={`image-favorite-${model.provider}-${model.id}`} onClick={() => void window.nodus.updateSettings({ imageFavorites: favorite ? (settings.imageFavorites ?? []).filter(ref => !(ref.provider === model.provider && ref.model === model.id)) : [...(settings.imageFavorites ?? []), { provider: model.provider, model: model.id }] }).then(onChange)}><Icon name="star" size={15} className={favorite ? 'fill-current text-amber-500' : ''} /></button>
              </div>
            );
          })}
          {shown.length === 0 && <div className="p-4 text-sm text-neutral-500">{t('No hay modelos compatibles que coincidan.')}</div>}
        </SettingsModelList>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-600">
        <span>{tx('{n} modelos compatibles con salida de imagen', { n: shown.length })}</span>
        <button className="hover:text-indigo-300" onClick={() => window.nodus.openExternal('https://openrouter.ai/models?output_modalities=image&order=pricing-low-to-high')}>{t('Ver catálogo de OpenRouter')}</button>
      </div>
    </section>
  );
}

function PriceCell({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-600">{label}</div><div className="mt-1 text-neutral-600 dark:text-neutral-400">{value}</div></div>;
}

function ProviderRow({
  provider,
  settings,
  expanded,
  onToggle,
  onChange,
  isFav,
  toggleFav,
}: {
  provider: AiProvider;
  settings: AppSettings;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => Promise<unknown>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const hasKey = settings.providerKeys?.[provider];

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    await window.nodus.setApiKey(provider, keyInput.trim());
    setKeyInput('');
    await onChange();
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await window.nodus.listModels(provider));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const filtered = (models ?? []).filter((m) => {
    const q = search.toLowerCase();
    return !q || (m.id ?? '').toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q);
  });
  const shown = filtered.slice(0, 300);

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800" data-testid={`provider-${provider}`}>
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={onToggle}>
        <span className="text-neutral-500">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
        <span className={hasKey ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'text-xs text-neutral-500 dark:text-neutral-600'}>
          {hasKey ? `● ${t('clave guardada')}` : `○ ${t('sin clave')}`}
        </span>
        {provider === 'openrouter' && <span className="text-neutral-600 text-xs">{t('(modelos públicos)')}</span>}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex gap-2 items-center">
            <input
              type="password"
              className="input flex-1"
              placeholder={hasKey ? t('•••••••• (guardada)') : t('clave del proveedor')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="btn btn-primary" onClick={saveKey}>
              {t('Guardar')}
            </button>
            {hasKey && (
              <button className="btn btn-ghost text-red-600 dark:text-red-400" onClick={() => window.nodus.clearApiKey(provider).then(onChange)}>
                {t('Borrar')}
              </button>
            )}
          </div>

          {supportsFreeTierShaping(provider) && (
            <label className="flex items-start gap-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400" data-testid={`free-tier-${provider}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.providerFreeTier?.[provider] === true}
                onChange={(e) => window.nodus.updateSettings({
                  providerFreeTier: { ...settings.providerFreeTier, [provider]: e.target.checked },
                }).then(onChange)}
              />
              <span>
                {t('Uso mi plan gratuito de este proveedor')}
                <span className="block text-neutral-500 dark:text-neutral-500">
                  {t('Ajusta las peticiones a los límites del nivel gratuito (recorta la longitud de salida y espera si se alcanza el límite por minuto) para que el análisis no falle. Déjalo desmarcado si pagas por uso.')}
                </span>
              </span>
            </label>
          )}

          {provider === 'opencode-go' && <OpenCodeGoUsagePanel />}

          {provider === 'anthropic' && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs leading-5 text-neutral-400">
              <p>{t('Anthropic no permite que aplicaciones de terceros ofrezcan inicio de sesión de Claude.ai ni utilicen credenciales de suscripciones Free, Pro o Max. Por ello Claude se conecta aquí únicamente mediante la API oficial.')}</p>
              <button className="mt-1 text-amber-300 hover:text-amber-200" onClick={() => window.nodus.openExternal('https://code.claude.com/docs/en/legal-and-compliance')}>
                {t('Política oficial de Anthropic ↗')}
              </button>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={loadModels} disabled={loading}>
              {loading ? t('Cargando…') : t('Cargar modelos')}
            </button>
            {models && (
              <input className="input flex-1" placeholder={t('Buscar modelo…')} value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
            {models && <span className="text-xs text-neutral-500">{filtered.length}</span>}
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}

          {models && (
            <SettingsModelList className="max-h-64 overflow-y-auto" data-testid={`provider-model-list-${provider}`}>
              <ModelList provider={provider} models={shown} isFav={isFav} toggleFav={toggleFav} />
              {filtered.length > shown.length && (
                <div className="text-xs text-neutral-600 p-2">{tx('Mostrando {n}; refina la búsqueda para ver más.', { n: shown.length })}</div>
              )}
            </SettingsModelList>
          )}
        </div>
      )}
    </div>
  );
}

function OpenCodeGoUsagePanel() {
  const [usage, setUsage] = useState<OpenCodeGoUsageStatus | null>(null);
  useEffect(() => {
    void window.nodus.getOpenCodeGoUsageStatus().then(setUsage);
    return window.nodus.onOpenCodeGoUsageStatusChanged(setUsage);
  }, []);

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-neutral-600 dark:border-violet-800/60 dark:bg-violet-950/20 dark:text-neutral-400" data-testid="opencode-go-usage">
      <p>{t('OpenCode documenta el uso directo de la suscripción Go mediante esta clave y sus endpoints oficiales. Nodus es independiente y no está afiliada, certificada ni respaldada por OpenCode.')}</p>
      <p className="mt-1">{t('Límites generales publicados: 12 USD cada 5 horas, 30 USD por semana y 60 USD por mes. Algunos modelos tienen un límite mensual efectivo inferior (15 USD); el número de peticiones depende del modelo y puede cambiar.')}</p>
      <p className="mt-1 text-amber-700 dark:text-amber-300">{t('Saldo restante oficial: OpenCode solo lo publica en Console; no ofrece una API de cuota compatible con la clave de usuario. Nodus no usa cookies ni endpoints privados.')}</p>
      {usage && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <OpenCodeObservedCard label={t('Últimas 5 horas')} period={usage.observed.fiveHours} cap={usage.limitsUsd.fiveHours} />
          <OpenCodeObservedCard label={t('Últimos 7 días')} period={usage.observed.week} cap={usage.limitsUsd.week} />
          <OpenCodeObservedCard label={t('Últimos 30 días')} period={usage.observed.month} cap={usage.limitsUsd.month} />
        </div>
      )}
      <p className="mt-2 text-[11px] text-neutral-500">{t('El gasto observado es una estimación local de las peticiones hechas por Nodus con precios oficiales; no incluye otros clientes y no equivale al saldo restante.')}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button className="text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200" onClick={() => window.nodus.openExternal(usage?.officialUsageUrl ?? 'https://opencode.ai/auth')}>
          {t('Ver saldo restante oficial en OpenCode Console ↗')}
        </button>
        <button className="text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200" onClick={() => window.nodus.openExternal('https://opencode.ai/docs/go/')}>
          {t('Documentación oficial de OpenCode Go ↗')}
        </button>
      </div>
    </div>
  );
}

function OpenCodeObservedCard({
  label,
  period,
  cap,
}: {
  label: string;
  period: OpenCodeGoUsageStatus['observed']['fiveHours'];
  cap: number;
}) {
  const spend = period.estimatedCostUsd;
  return (
    <div className="rounded border border-neutral-200 p-2 text-[11px] dark:border-neutral-800">
      <div className="text-neutral-700 dark:text-neutral-300">{label}</div>
      <div>{tx('{requests} peticiones · ~${spent} observados · ${cap} de tope general de referencia', {
        requests: period.requests,
        spent: spend.toFixed(spend < 0.01 ? 4 : 2),
        cap: cap.toFixed(0),
      })}</div>
      {period.unpricedRequests > 0 && <div className="text-amber-700 dark:text-amber-400">{tx('{n} sin precio estimable', { n: period.unpricedRequests })}</div>}
    </div>
  );
}

/**
 * The user's own OpenAI-compatible endpoint.
 *
 * Not a LocalProviderRow: that one owns a context-window planner and a diagnostics
 * panel that only mean something for Ollama/LM Studio, and it appends nothing to the
 * URL — whereas the whole point here is that Nodus must not guess the path. What
 * this row adds instead is the hand-written model list, which is what keeps a
 * gateway without GET /models usable.
 */
function CustomProviderRow({
  settings,
  expanded,
  onToggle,
  onChange,
  isFav,
  toggleFav,
}: {
  settings: AppSettings;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => Promise<unknown>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const config = settings.customProvider ?? { baseUrl: '', models: [] };
  const savedUrl = config.baseUrl ?? '';
  const manualModels = config.models ?? [];
  const [urlInput, setUrlInput] = useState(savedUrl);
  const [modelInput, setModelInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<LocalProviderTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const hasKey = settings.providerKeys?.custom;

  // Keep the field in sync when the saved value changes elsewhere (vault switch).
  useEffect(() => setUrlInput(savedUrl), [savedUrl]);

  const persist = async (patch: { baseUrl?: string; models?: string[] }) => {
    await window.nodus.updateSettings({
      customProvider: {
        baseUrl: normalizeCustomBaseUrl(patch.baseUrl ?? savedUrl),
        models: normalizeCustomModels(patch.models ?? manualModels),
      },
    });
    await onChange();
  };

  const persistUrl = async () => {
    const next = normalizeCustomBaseUrl(urlInput);
    setUrlInput(next);
    if (next !== savedUrl) await persist({ baseUrl: next });
  };

  const addModel = async () => {
    const id = modelInput.trim();
    if (!id) return;
    setModelInput('');
    await persist({ models: [...manualModels, id] });
  };

  const removeModel = async (id: string) => {
    await persist({ models: manualModels.filter((model) => model !== id) });
  };

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    await window.nodus.setApiKey('custom', keyInput.trim());
    setKeyInput('');
    await onChange();
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      await persistUrl();
      setTest(await window.nodus.testCustomProvider());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      await persistUrl();
      setModels(await window.nodus.listModels('custom'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = (models ?? []).filter((m) => {
    const q = search.toLowerCase();
    return !q || (m.id ?? '').toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q);
  });
  const shown = filtered.slice(0, 300);

  return (
    <div className="border border-neutral-800 rounded-lg" data-testid="provider-row-custom">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={onToggle}>
        <span className="text-neutral-500">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{PROVIDER_LABELS.custom}</span>
        <span className="text-xs text-neutral-600">{t('(tu servidor)')}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-neutral-500" title={savedUrl}>{savedUrl}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs leading-5 text-neutral-500">
            {t('Conecta Nodus con cualquier servidor que hable la API de OpenAI: LiteLLM, vLLM, el servidor de llama.cpp o un proxy propio.')}
          </p>

          <label className="block text-xs text-neutral-500">
            {t('Dirección del servidor (URL completa)')}
            <div className="mt-1 flex gap-2 items-center">
              <input
                className="input flex-1 font-mono"
                data-testid="custom-provider-url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={() => void persistUrl()}
                placeholder="http://localhost:8317/v1"
                spellCheck={false}
              />
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void runTest()} disabled={testing}>
                {testing ? t('Probando…') : t('Probar conexión')}
              </button>
            </div>
          </label>
          <p className="text-xs leading-5 text-neutral-500">
            {t('Nodus no añade "/v1" por su cuenta: escribe la ruta exacta que sirve tu servidor.')}
          </p>

          {test && (
            <div className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`} data-testid="custom-provider-test">
              {test.ok
                ? tx('Conectado{version} · {n} modelos disponibles', { version: '', n: test.modelCount ?? 0 })
                : tx('Sin conexión: {msg}', { msg: test.message ?? '' })}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <input
              type="password"
              className="input flex-1"
              placeholder={hasKey ? t('•••••••• clave guardada (opcional)') : t('clave de API (opcional)')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="btn btn-primary" onClick={saveKey}>{t('Guardar')}</button>
            {hasKey && (
              <button className="btn btn-ghost text-red-400" onClick={() => window.nodus.clearApiKey('custom').then(onChange)}>
                {t('Borrar')}
              </button>
            )}
          </div>

          <div className="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-500">
            <div className="font-medium text-neutral-300">{t('Modelos escritos a mano')}</div>
            <p className="mt-1 leading-5">
              {t('Si tu servidor no publica catálogo, escribe aquí los identificadores. Quedan guardados y se pueden elegir en cualquier selector de modelo.')}
            </p>
            <div className="mt-2 flex gap-2 items-center">
              <input
                className="input flex-1 font-mono"
                data-testid="custom-provider-model-input"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addModel(); } }}
                placeholder={t('identificador del modelo')}
                spellCheck={false}
              />
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void addModel()}>{t('Añadir')}</button>
            </div>
            {manualModels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1" data-testid="custom-provider-manual-models">
                {manualModels.map((id) => (
                  <span key={id} className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                    <span className="font-mono">{id}</span>
                    <button
                      className="ml-0.5 grid h-4 w-4 shrink-0 place-items-center rounded text-neutral-500 hover:bg-neutral-700 hover:text-red-400"
                      title={t('Quitar modelo')}
                      aria-label={t('Quitar modelo')}
                      onClick={() => void removeModel(id)}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 items-center">
            <button className="btn btn-ghost border border-neutral-700" onClick={loadModels} disabled={loading}>
              {loading ? t('Cargando…') : t('Cargar modelos')}
            </button>
            {models && (
              <input className="input flex-1" placeholder={t('Buscar modelo…')} value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
            {models && <span className="text-xs text-neutral-500">{filtered.length}</span>}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          {models && (
            <SettingsModelList className="max-h-64 overflow-y-auto" data-testid="provider-model-list-custom">
              <ModelList provider="custom" models={shown} isFav={isFav} toggleFav={toggleFav} />
              {models.length === 0 && (
                <div className="p-3 text-xs text-neutral-500">{t('Ni el servidor publica modelos ni has escrito ninguno todavía.')}</div>
              )}
              {filtered.length > shown.length && (
                <div className="text-xs text-neutral-600 p-2">{tx('Mostrando {n}; refina la búsqueda para ver más.', { n: shown.length })}</div>
              )}
            </SettingsModelList>
          )}

          <p className="text-xs leading-5 text-neutral-500">
            {t('Este proveedor genera texto, no embeddings. Para la búsqueda semántica elige otro proveedor en Ajustes.')}
          </p>
        </div>
      )}
    </div>
  );
}

function LocalProviderRow({
  provider,
  settings,
  expanded,
  onToggle,
  onChange,
  isFav,
  toggleFav,
}: {
  provider: LocalProvider;
  settings: AppSettings;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => Promise<unknown>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const savedUrl = settings.localProviders?.[provider]?.baseUrl ?? '';
  const [urlInput, setUrlInput] = useState(savedUrl);
  const [tokenInput, setTokenInput] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<LocalProviderTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const hasToken = settings.providerKeys?.[provider];
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof window.nodus.getLocalAiDiagnostics>>>([]);
  const localConfig = settings.localProviders?.[provider] ?? { baseUrl: savedUrl, contextMode: 'auto' as const };

  const persistLocalConfig = async (patch: Partial<typeof localConfig>) => {
    await window.nodus.updateSettings({
      localProviders: {
        ...settings.localProviders,
        [provider]: { ...localConfig, ...patch },
      },
    });
    await onChange();
  };

  // Keep the URL field in sync if the saved value changes elsewhere (e.g. vault switch).
  useEffect(() => setUrlInput(savedUrl), [savedUrl]);

  const persistUrl = async () => {
    const next = urlInput.trim() || DEFAULT_LOCAL_BASE_URLS[provider];
    if (next !== savedUrl) {
      await persistLocalConfig({ baseUrl: next });
    }
  };

  const saveToken = async () => {
    if (!tokenInput.trim()) return;
    await window.nodus.setApiKey(provider, tokenInput.trim());
    setTokenInput('');
    await onChange();
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      await persistUrl();
      setTest(await window.nodus.testLocalProvider(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      await persistUrl();
      setModels(await window.nodus.listModels(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = (models ?? []).filter((m) => {
    const q = search.toLowerCase();
    return !q || (m.id ?? '').toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q);
  });
  const shown = filtered.slice(0, 300);

  return (
    <div className="border border-neutral-800 rounded-lg">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={onToggle}>
        <span className="text-neutral-500">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
        <span className="text-xs text-neutral-600">{t('(local)')}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-neutral-500" title={savedUrl}>{savedUrl}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs leading-5 text-neutral-500">
            {provider === 'ollama'
              ? t('Ollama debe estar en marcha y los modelos descargados con "ollama pull". No requiere clave.')
              : t('Activa el servidor local en LM Studio (Developer → Start Server) y carga al menos un modelo. No requiere clave.')}
          </p>

          <label className="block text-xs text-neutral-500">
            {t('Dirección del servidor (IP y puerto)')}
            <div className="mt-1 flex gap-2 items-center">
              <input
                className="input flex-1 font-mono"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={() => void persistUrl()}
                placeholder={DEFAULT_LOCAL_BASE_URLS[provider]}
                spellCheck={false}
              />
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void runTest()} disabled={testing}>
                {testing ? t('Probando…') : t('Probar conexión')}
              </button>
            </div>
          </label>

          <div className="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-500">
            <div className="flex flex-wrap items-center gap-2">
              <label className="font-medium text-neutral-300">{t('Ventana de contexto')}</label>
              <select
                className="input"
                value={localConfig.contextMode === 'manual' ? String(localConfig.manualContextTokens ?? 16384) : 'auto'}
                onChange={(event) => {
                  const value = event.target.value;
                  void persistLocalConfig(value === 'auto'
                    ? { contextMode: 'auto', manualContextTokens: undefined }
                    : { contextMode: 'manual', manualContextTokens: Number(value) as 4096 | 8192 | 16384 | 32768 | 65536 | 131072 });
                }}
              >
                <option value="auto">{t('Auto (recomendado, hasta 32K)')}</option>
                <option value="4096">4K</option>
                <option value="8192">8K</option>
                <option value="16384">16K</option>
                <option value="32768">32K</option>
                <option value="65536">65K</option>
                <option value="131072">128K</option>
              </select>
            </div>
            <p className="mt-2 leading-5">
              {t('El contexto contiene prompt y respuesta. El máximo de salida se calcula por separado para cada tarea. Auto puede usar 32K en el análisis profundo y divide los lotes que no caben.')}
            </p>
            {localConfig.contextMode === 'manual' && Number(localConfig.manualContextTokens) >= 32768 && (
              <p className="mt-1 text-amber-400">
                {t('32K–128K puede aumentar mucho el uso de RAM/VRAM y la latencia; no mejora por sí solo la longitud de salida.')}
              </p>
            )}
          </div>

          {test && (
            <div className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {test.ok
                ? tx('Conectado{version} · {n} modelos disponibles', {
                    version: test.version ? ` (v${test.version})` : '',
                    n: test.modelCount ?? 0,
                  })
                : tx('Sin conexión: {msg}', { msg: test.message ?? '' })}
            </div>
          )}

          <div className="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-500">
            <div className="flex items-center justify-between gap-2">
              <span>{t('Última petición local')}</span>
              <button className="btn btn-ghost" onClick={() => void window.nodus.getLocalAiDiagnostics().then(setDiagnostics)}>{t('Actualizar')}</button>
            </div>
            {diagnostics.filter((entry) => entry.provider === provider).slice(-1).map((entry) => (
              <div key={entry.timestamp} className="mt-2 font-mono text-[10px] leading-5 text-neutral-400">
                {entry.transport} · {entry.task} · ctx {entry.effectiveContextTokens} · entrada {entry.actualInputTokens ?? `~${entry.estimatedInputTokens}`} · salida {entry.actualOutputTokens ?? '?'} / {entry.sentOutputTokens} · {Math.round(entry.elapsedMs / 100) / 10}s
              </div>
            ))}
            {!diagnostics.some((entry) => entry.provider === provider) && <p className="mt-2">{t('Todavía no hay peticiones registradas en esta sesión.')}</p>}
          </div>

          <div className="flex gap-2 items-center">
            <input
              type="password"
              className="input flex-1"
              placeholder={hasToken ? t('•••••••• token guardado (opcional)') : t('token de acceso (opcional)')}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button className="btn btn-primary" onClick={saveToken}>{t('Guardar')}</button>
            {hasToken && (
              <button className="btn btn-ghost text-red-400" onClick={() => window.nodus.clearApiKey(provider).then(onChange)}>
                {t('Borrar')}
              </button>
            )}
          </div>

          <div className="flex gap-2 items-center">
            <button className="btn btn-ghost border border-neutral-700" onClick={loadModels} disabled={loading}>
              {loading ? t('Cargando…') : t('Cargar modelos')}
            </button>
            {models && (
              <input className="input flex-1" placeholder={t('Buscar modelo…')} value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
            {models && <span className="text-xs text-neutral-500">{filtered.length}</span>}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          {models && (
            <SettingsModelList className="max-h-64 overflow-y-auto" data-testid={`provider-model-list-${provider}`}>
              <ModelList provider={provider} models={shown} isFav={isFav} toggleFav={toggleFav} />
              {models.length === 0 && (
                <div className="p-3 text-xs text-neutral-500">{t('El servidor no reporta modelos. Descarga o carga uno primero.')}</div>
              )}
              {filtered.length > shown.length && (
                <div className="text-xs text-neutral-600 p-2">{tx('Mostrando {n}; refina la búsqueda para ver más.', { n: shown.length })}</div>
              )}
            </SettingsModelList>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

/** Secondary line for a local model row: params · quant · context · size. */
function modelMetaParts(m: ModelInfo): string[] {
  const parts: string[] = [];
  if (m.paramSize) parts.push(m.paramSize);
  if (m.quantization) parts.push(m.quantization);
  const trained = m.trainedContextLength ?? m.contextLength;
  if (trained) parts.push(`${Math.round(trained / 1000)}${t('K ctx máx.')}`);
  if (m.loadedContextLength) parts.push(`${Math.round(m.loadedContextLength / 1000)}K cargado`);
  const size = formatBytes(m.sizeBytes);
  if (size) parts.push(size);
  return parts;
}

function ModelList({
  provider,
  models,
  isFav,
  toggleFav,
  codexReasoningEfforts,
  onCodexReasoningChange,
}: {
  provider: AiProvider;
  models: ModelInfo[];
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
  codexReasoningEfforts?: Record<string, CodexReasoningEffort>;
  onCodexReasoningChange?: (model: string, effort: CodexReasoningEffort | null) => Promise<void>;
}) {
  // OpenRouter: render grouped by upstream provider.
  const rows: JSX.Element[] = [];
  let lastGroup: string | null = null;
  for (const m of models) {
    const ref: ModelRef = { provider, model: m.id };
    if (provider === 'openrouter' && m.group && m.group !== lastGroup) {
      lastGroup = m.group;
      rows.push(
        <div key={`g-${m.group}`} className="sticky top-0 border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          {m.group}
        </div>
      );
    }
    const fav = isFav(ref);
    const meta = modelMetaParts(m);
    rows.push(
      <div key={m.id} className={settingsModelRowClass(false, true, 'flex items-center gap-2 !px-3 !py-2 text-xs')}>
        <button
          className={`grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 ${fav ? 'text-amber-500 dark:text-amber-400' : 'text-neutral-500 hover:text-amber-500 dark:text-neutral-600 dark:hover:text-amber-300'}`}
          title={t(fav ? 'Quitar de favoritos' : 'Marcar como favorito')}
          aria-label={t(fav ? 'Quitar de favoritos' : 'Marcar como favorito')}
          aria-pressed={fav}
          onClick={() => toggleFav(ref)}
        >
          <Icon name="star" size={13} className={fav ? 'fill-current' : ''} />
        </button>
        {m.loaded && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title={t('Cargado en memoria')} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate" title={m.name ?? m.id}>{m.id}</span>
          {meta.length > 0 && <span className="truncate text-[10px] text-neutral-500">{meta.join(' · ')}</span>}
        </span>
        {m.vision && (
          <span
            className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300/90"
            title={t('Acepta imágenes: apto como modelo de visión.')}
          >
            {t('visión')}
          </span>
        )}
        {m.reasoning && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-700 dark:bg-amber-950/60 dark:text-amber-400/90"
            title={t('Modelo de razonamiento: más lento para escanear.')}
          >
            {t('razona')}
          </span>
        )}
        {provider === 'codex' && (m.supportedReasoningEfforts?.length ?? 0) > 0 && (
          <select
            className="input h-7 w-36 shrink-0 py-0 text-[10px]"
            data-testid={`codex-reasoning-${m.id}`}
            aria-label={tx('Razonamiento de {model}', { model: m.name ?? m.id })}
            value={codexReasoningEfforts?.[m.id] ?? ''}
            onChange={(event) => void onCodexReasoningChange?.(
              m.id,
              event.target.value ? event.target.value as CodexReasoningEffort : null
            )}
          >
            <option value="">
              {m.defaultReasoningEffort
                ? tx('{level} (predeterminado)', { level: codexReasoningLabel(m.defaultReasoningEffort) })
                : t('Predeterminado')}
            </option>
            {(m.supportedReasoningEfforts ?? []).map((option) => (
              <option key={option.reasoningEffort} value={option.reasoningEffort} title={option.description}>
                {codexReasoningLabel(option.reasoningEffort)}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }
  return <div>{rows}</div>;
}
