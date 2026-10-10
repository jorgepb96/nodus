import { openResearchPreparation } from '../components/ResearchPreparationWelcome';
import { MobilePairingSettings } from '../components/MobilePairingSettings';
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from 'react';
import type {
  AppSettings,
  CustomAppTheme,
  AiConcurrencySnapshot,
  BackupCleanupPreview,
  BackupRetentionUnit,
  CopilotServerStatus,
  EmbeddingProvider,
  LocalServerAccess,
  LocalServerPowerStatus,
  LocalServerStatus,
  McpServerStatus,
  McpTunnelStatus,
  MigrationRecoverySnapshot,
  NodusServerConnection,
  NodusServerOverview,
  ReplicaConnectionView,
  ZoteroPluginServerStatus,
  RecoveryHealth,
  StudyDataOverview,
  SupersededEntry,
  VaultSummary,
  VaultType,
} from '@shared/types';
import type { PrimarySourcePolicySettings } from '@shared/primarySourcesTypes';
import { NODUS_SOCIAL_LINKS } from '@shared/socialLinks';
import { recoveryHealthAdvice, recoveryHealthAge, recoveryHealthHeadline } from '../recoveryHealth';
import { ImageGenerationSettings, ProvidersSettings } from './ProvidersSettings';
import { AudioGenerationSettings } from './AudioGenerationSettings';
import { ConnectedVaultsPanel } from '../components/ConnectedVaultsPanel';
import { LocalServerPanel } from '../components/LocalServerPanel';
import { ConfirmModal } from '../components/ConfirmModal';
import { BrowserSettings } from './settings/BrowserSettings';
import { LegalDocModal } from '../components/LegalDocModal';
import { LEGAL_DOCS, type LegalDocId } from '../legalDocs';
import { confirm } from '../components/feedback';
import { GraphHealthPanel } from '../components/GraphHealthPanel';
import { Icon } from '../components/ui';
import { ThemeColourPicker } from '../components/ThemeColourPicker';
import { ThemePalettePicker } from '../components/ThemePalettePicker';
import { ModelPicker, ModelWithReasoning, SubscriptionQuotaNotice, ExtractionCapabilityNotice, SelfAuditNotice } from '../components/ModelPicker';
import { EmbeddingModelControl } from '../components/EmbeddingModelControl';
import { GeneralTextModelControl } from '../components/GeneralTextModelControl';
import { NodiStylePicker } from '../components/nodi/NodiStylePicker';
import { TutorialVideoGrid } from '../components/TutorialVideos';
import { vaultTypeLabel } from '../components/VaultSwitcher';
import { SttSettings } from '../components/SttSettings';
import { LocalAiModelsSettings } from '../components/LocalAiModelsSettings';
import { LocalImageModelSettings } from '../components/LocalImageModelSettings';
import { McpConnectionModal } from '../components/McpConnectionModal';
import { CloudflareDeployModal } from '../components/CloudflareDeployModal';
import { dedicatedVaultNavIds, groupedNav, NAV_GROUPS, navItemLabel, orderSidebarItems, orderedNav } from '../navigation';
import { teachingItemId, TEACHING_GROUPS } from '../components/TeachingSidebar';
import { WORLDBUILDING_GROUPS } from '../components/WorldbuildingSidebar';
import { TESTIMONY_GROUPS } from '../components/TestimonySidebar';
import { ACCESS_LEVELS as TESTIMONY_ACCESS_LEVELS, ATTRIBUTION_MODES as TESTIMONY_ATTRIBUTION_MODES } from '@shared/testimonies';
import { ACCESS_LEVEL_LABEL as TESTIMONY_ACCESS_LEVEL_LABEL, ATTRIBUTION_MODE_LABEL as TESTIMONY_ATTRIBUTION_MODE_LABEL } from '@shared/testimonyLabels';
import { errorText, t, tx } from '../i18n';
import { canInstallUpdate, installUpdateManually, pendingUpdateVersion, updateStatusMessage } from '../updateStatus';
import { useUpdateProgress } from '../useUpdateProgress';
import { ORB_COLOR_CHOICES, orbHue } from '@shared/nodiOrb';
import { NODI_DEFAULT_SCALE, NODI_SIZE_SCALES } from '@shared/nodiSize';
import { effectiveSidebarHidden, isViewAllowedForVaultType } from '@shared/vaultTypes';
import { DOCUMENT_INDEX_CONTINUOUS_AVAILABLE } from '@shared/documentIndexPolicy';
import { validateBackupPassword } from '@shared/backupPasswordPolicy';
import { PROMPT_LANGUAGE_OPTIONS } from '@shared/promptLanguageOptions';
import chromeWebStoreLogo from '../assets/brands/chrome-web-store.svg';
import { contrast, deriveThemeTokens } from '../theme/themes.mjs';
import { applyAppTheme as applyRuntimeAppTheme, applyThemeMode } from '../theme/themeBoot';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function normalizeThemeColour(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return HEX_COLOUR.test(normalized) ? normalized : null;
}

function themeSlug(label: string): string {
  const slug = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `custom-${slug || 'theme'}`;
}

function emptyThemeDraft(): Omit<CustomAppTheme, 'id'> {
  return {
    label: '', accent: '#6366f1', deep: '#1e1b4b', pale: '#eef2ff',
    appBackground: { light: '#f8fafc', dark: '#080a12' },
    lightText: '#171717', darkText: '#f5f5f5', tint: 0.05,
  };
}

function themeDraftFrom(theme?: CustomAppTheme): Omit<CustomAppTheme, 'id'> {
  const defaults = emptyThemeDraft();
  if (!theme) return defaults;
  return {
    label: theme.label,
    accent: normalizeThemeColour(theme.accent) ?? defaults.accent,
    deep: normalizeThemeColour(theme.deep) ?? defaults.deep,
    pale: normalizeThemeColour(theme.pale) ?? defaults.pale,
    appBackground: {
      light: normalizeThemeColour(theme.appBackground?.light) ?? defaults.appBackground.light,
      dark: normalizeThemeColour(theme.appBackground?.dark) ?? defaults.appBackground.dark,
    },
    lightText: normalizeThemeColour(theme.lightText) ?? defaults.lightText,
    darkText: normalizeThemeColour(theme.darkText) ?? defaults.darkText,
    tint: Number.isFinite(theme.tint) ? theme.tint : defaults.tint,
  };
}

type SettingsTabId = 'providers' | 'models' | 'library' | 'extraction' | 'interface' | 'integrations' | 'browser' | 'mobile' | 'server' | 'system' | 'data' | 'about' | 'updates';

const GRAPH_HEALTH_KEYWORDS = 'salud grafo integridad comprobar reparar ideas temas relaciones huérfanas zombis graph health integrity repair';

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: string; keywords: string }[] = [
  { id: 'providers', label: 'Proveedores', icon: 'key', keywords: 'api key keys claves proveedores provider providers modelos favoritos default openai anthropic deepseek gemini google openrouter xiaomi lm studio ollama vault boveda' },
  { id: 'models', label: 'Modelos IA', icon: 'wand', keywords: 'model model id embedding embeddings extraccion sintesis tutor resumen fusion razonamiento openrouter unpaywall contexto concurrencia quimica chemistry stock mcule proveedores comprar' },
  { id: 'library', label: 'Biblioteca', icon: 'book', keywords: 'zotero sincronizacion tag lectura automatizacion cola analisis resumen relaciones' },
  { id: 'extraction', label: 'Texto y OCR', icon: 'search', keywords: 'pdf texto fulltext zotero ocr tesseract paginas idiomas' },
  { id: 'interface', label: 'Interfaz', icon: 'palette', keywords: 'idioma tema claro oscuro animaciones barra lateral menu navegacion accesibilidad contraste escala fuente lectura enfoque' },
  { id: 'integrations', label: 'Integraciones', icon: 'link', keywords: 'mcp servidor token puerto chatgpt openai tunnel tunel word copilot certificado addin' },
  { id: 'browser', label: 'Nodus Browser', icon: 'compass', keywords: 'navegador browser web cookies cache almacenamiento datos permisos sitios descargas privacidad' },
  { id: 'mobile', label: 'Conexión móvil', icon: 'link', keywords: 'movil mobile iphone ipad workspace conectar vincular codigo qr red lan vpn tailscale live escritorio' },
  { id: 'server', label: 'Servidor avanzado', icon: 'globe', keywords: 'servidor avanzado cloud cloudflare docker compartir vault boveda estudiantes investigadores dominio subdominio oauth claude chatgpt reverse proxy caddy nginx publicar sincronizar' },
  { id: 'system', label: 'Tutoriales', icon: 'graduation', keywords: 'sistema ayuda tutorial' },
  { id: 'data', label: 'Backup / copia de seguridad', icon: 'download', keywords: 'datos backup exportar importar demo copia cifrada peligro reinicializar grafo borrar' },
  { id: 'about', label: 'Acerca de Nodus Research', icon: 'info', keywords: 'acerca proyecto codigo abierto open source gratuito privacidad privacy rgpd gdpr datos alumnado inteligencia artificial licencia terceros legal redes sociales social reddit youtube comunidad' },
  { id: 'updates', label: 'Actualizaciones y novedades', icon: 'sync', keywords: 'actualizaciones update actualizar version novedades ultimos cambios latest changes changelog buscar instalar reiniciar beta testers prerelease canal estable' },
];

const SETTINGS_TAB_STORAGE_KEY = 'nodus.settingsTab';

function readRememberedSettingsTab(): SettingsTabId {
  try {
    const remembered = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    return SETTINGS_TABS.some((tab) => tab.id === remembered)
      ? remembered as SettingsTabId
      : 'providers';
  } catch {
    return 'providers';
  }
}

const ZOTERO_FREE_VAULT_TYPES = new Set<VaultType>(['testimonios', 'prosopography', 'worldbuilding']);

const ABOUT_ACTION_BUTTON_CLASS = 'btn btn-ghost w-full min-h-9 shrink-0 justify-center border border-neutral-300 dark:border-neutral-700 sm:h-9 sm:w-auto sm:min-w-56 sm:whitespace-nowrap';
const ABOUT_CARD_CLASS = 'rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50';
const NODUS_REPOSITORY_URL = 'https://github.com/jorgepb96/nodus';
const NODUS_SERVER_GUIDE_URL = `${NODUS_REPOSITORY_URL}/blob/main/server/README.md`;
const NODUS_PRIVACY_URL = `${NODUS_REPOSITORY_URL}/blob/main/PRIVACY.md`;
const NODUS_VERSION_SOURCE_URL = `${NODUS_REPOSITORY_URL}/tree/v${__APP_VERSION__}`;
const NODUS_LICENSE_URL = `${NODUS_REPOSITORY_URL}/blob/v${__APP_VERSION__}/LICENSE`;
const NODUS_SECURITY_REPORT_URL = `${NODUS_REPOSITORY_URL}/security/advisories/new`;
const NODUS_ZOTERO_INSTALL_URL = 'https://nodusresearch.com/zotero-plugin/';
const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/ilcclajjhofhieoljdjmikmfopfbamej?utm_source=item-share-cb';

function normalizeSettingsText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function settingsTabRequested(tab: SettingsTabId, selected: SettingsTabId, query: string): boolean {
  const normalizedQuery = normalizeSettingsText(query);
  if (!normalizedQuery) return selected === tab;
  const metadata = SETTINGS_TABS.find((item) => item.id === tab);
  return metadata
    ? normalizeSettingsText(`${metadata.label} ${t(metadata.label)} ${metadata.keywords}`).includes(normalizedQuery)
    : false;
}

function formatBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function backupRetentionLimit(unit: BackupRetentionUnit): number {
  return unit === 'days' ? 3650 : unit === 'weeks' ? 520 : unit === 'months' ? 120 : 10;
}

function aiConcurrencyReason(entry: AiConcurrencySnapshot): string | null {
  if (entry.cooldownUntil || /quota-reserved/.test(entry.lastChangeReason)) return 'espera por cuota';
  if (/rate-limited|overloaded|repeated-/.test(entry.lastChangeReason)) return 'reducción temporal';
  if (entry.lastChangeReason === 'healthy-saturated-queue') return 'capacidad ampliada';
  if (entry.lastChangeReason === 'quota-window-reset') return 'cuota restablecida';
  if (entry.provider === 'nodus') return 'límite local seguro';
  return null;
}

export function Settings({
  settings,
  vaults: _vaults,
  activeVault,
  recoveryHealth,
  onChange,
  onVaultsChanged: _onVaultsChanged,
  onOpenWhatsNew,
  onOpenRoadmap,
}: {
  settings: AppSettings;
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  /** Assessed in the main process (it alone can reach the destination folder). */
  recoveryHealth: RecoveryHealth | null;
  onChange: () => Promise<unknown>;
  onVaultsChanged: () => Promise<unknown>;
  onOpenWhatsNew: () => void;
  /** The roadmap left the header rail for this section; the modal still lives in App. */
  onOpenRoadmap: () => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [aiConcurrency, setAiConcurrency] = useState<AiConcurrencySnapshot[]>([]);
  const [supersededReloadKey, setSupersededReloadKey] = useState(0);
  const [syncHasPassphrase, setSyncHasPassphrase] = useState(true);
  const [importSyncPassphrase, setImportSyncPassphrase] = useState('');
  const [importSyncPromptOpen, setImportSyncPromptOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(readRememberedSettingsTab);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [openLegalDoc, setOpenLegalDoc] = useState<LegalDocId | null>(null);
  // Reset-graph flow: a confirm() dialog, then a modal that requires typing a
  // freshly generated 4-digit code so it can't be triggered by accident.
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState<Omit<CustomAppTheme, 'id'>>(emptyThemeDraft);
  const [themeError, setThemeError] = useState<string | null>(null);

  useEffect(() => {
    if (!themeEditorOpen) return;
    applyRuntimeAppTheme('custom-preview', [{ id: 'custom-preview', ...themeDraft }]);
  }, [themeEditorOpen, themeDraft]);
  useEffect(() => {
    if (themeEditorOpen) return;
    applyRuntimeAppTheme(settings.appTheme, settings.customThemes ?? []);
  }, [settings.appTheme, settings.customThemes]);
  const [updateProgress, setUpdateProgress] = useUpdateProgress();
  const [requestingInstall, setRequestingInstall] = useState(false);
  const [confirmBetaUpdates, setConfirmBetaUpdates] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);
  const [pendingModelSettingsMode, setPendingModelSettingsMode] = useState<AppSettings['modelSettingsMode'] | null>(null);
  const [pendingEmbeddingChange, setPendingEmbeddingChange] = useState<{ provider: EmbeddingProvider; model: string } | null>(null);
  const [backupResult, setBackupResult] = useState<{ path: string; password: string; recoveryKey: string } | null>(null);
  const [backupCopied, setBackupCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [primarySourcePolicy, setPrimarySourcePolicy] = useState<PrimarySourcePolicySettings | null>(null);
  const hasZoteroLibraryWorkflow = !activeVault || !ZOTERO_FREE_VAULT_TYPES.has(activeVault.type);
  const dataTabRequested = settingsTabRequested('data', settingsTab, settingsQuery);
  const integrationsTabRequested = settingsTabRequested('integrations', settingsTab, settingsQuery);
  const modelsTabRequested = settingsTabRequested('models', settingsTab, settingsQuery);
  const serverTabRequested = settingsTabRequested('server', settingsTab, settingsQuery);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, settingsTab);
    } catch {
      // Settings should remain usable when storage is unavailable or blocked.
    }
  }, [settingsTab]);

  useEffect(() => {
    void window.nodus.getAiConcurrencySnapshot().then(setAiConcurrency);
    return window.nodus.onAiConcurrencySnapshot(setAiConcurrency);
  }, []);

  useEffect(() => {
    const target = localStorage.getItem('nodus.settingsTarget');
    if (target !== 'nodi' && target !== 'models') return;
    localStorage.removeItem('nodus.settingsTarget');
    if (target === 'models') {
      setSettingsTab('models');
      setSettingsQuery('');
    } else {
      setSettingsTab('interface');
      setSettingsQuery('Nodi');
    }
  }, []);

  useEffect(() => {
    if (activeVault?.type !== 'primary_sources' || !modelsTabRequested) {
      setPrimarySourcePolicy(null);
      return;
    }
    let cancelled = false;
    void window.nodus.getPrimarySourceGovernanceWorkspace().then((workspace) => {
      if (!cancelled) setPrimarySourcePolicy(workspace.policy);
    });
    return () => { cancelled = true; };
  }, [activeVault?.id, activeVault?.type, modelsTabRequested]);

  useEffect(() => {
    if (!hasZoteroLibraryWorkflow && settingsTab === 'library') {
      // Preserve a direct navigation target queued by the effect above.
      setSettingsTab((current) => current === 'library' ? 'providers' : current);
    }
  }, [hasZoteroLibraryWorkflow, settingsTab]);
  const [importPassword, setImportPassword] = useState('');
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [autoBackupHasPassword, setAutoBackupHasPassword] = useState(false);
  const [autoBackupPasswordInput, setAutoBackupPasswordInput] = useState('');
  const [showAutoBackupPassword, setShowAutoBackupPassword] = useState(false);
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);
  const [migrationRecoverySnapshots, setMigrationRecoverySnapshots] = useState<MigrationRecoverySnapshot[]>([]);
  const [migrationRecoveryBusy, setMigrationRecoveryBusy] = useState<string | null>(null);
  const [backupCleanupPreview, setBackupCleanupPreview] = useState<BackupCleanupPreview | null>(null);
  const [backupCleanupRunning, setBackupCleanupRunning] = useState(false);
  const [confirmBackupCleanupEnable, setConfirmBackupCleanupEnable] = useState(false);
  const [confirmBackupCleanupNow, setConfirmBackupCleanupNow] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>({ running: false, port: null, url: null, error: null });
  const [mcpTunnelStatus, setMcpTunnelStatus] = useState<McpTunnelStatus | null>(null);
  const [nodusServerOverview, setNodusServerOverview] = useState<NodusServerOverview>({
    connections: [],
    activeVault: { id: '', name: '', type: 'academic', connected: false },
    transport: 'outbound-https',
  });
  const [nodusServerUrlInput, setNodusServerUrlInput] = useState(settings.nodusServerUrl);
  const [nodusServerPairCode, setNodusServerPairCode] = useState('');
  const [nodusServerBusy, setNodusServerBusy] = useState(false);
  const [nodusServerMessage, setNodusServerMessage] = useState<string | null>(null);
  const [nodusServerGuideOpen, setNodusServerGuideOpen] = useState(false);
  const [cloudflareDeployOpen, setCloudflareDeployOpen] = useState(false);
  // A connected vault is the mirror image of a published one: this machine PULLS it. Its
  // state had no screen at all, so a revoked replica simply stopped updating in silence.
  const [replicas, setReplicas] = useState<ReplicaConnectionView[]>([]);
  const [replicaBusy, setReplicaBusy] = useState<string | null>(null);
  // Basic mode: Nodus Server running on this very computer. Its own state because it is a
  // process this application owns, unlike every connection above, which points somewhere else.
  const [localServerStatus, setLocalServerStatus] = useState<LocalServerStatus | null>(null);
  const [localServerPower, setLocalServerPower] = useState<LocalServerPowerStatus | null>(null);
  const [localServerBusy, setLocalServerBusy] = useState(false);
  const [localServerMessage, setLocalServerMessage] = useState<string | null>(null);
  // Deliberately not part of the status object above: that one is polled on a timer, and this is
  // a password. Fetched only while the server is actually up, which is when it exists at all.
  const [localServerPassword, setLocalServerPassword] = useState<string | null>(null);
  // Read through a ref so the poll below can tell "already have it" from "never asked" without
  // re-subscribing every time it changes — one fetch per run of the server, not one every tick.
  const localServerPasswordRef = useRef<string | null>(null);
  // Which of the two server modes this section shows. Somebody already publishing to a Docker
  // deployment opens on that one; everybody else opens on the one that needs no Docker.
  const [serverMode, setServerMode] = useState<'cloudflare' | 'basic' | 'advanced'>(
    settings.nodusServerKind === 'cloudflare' || !settings.nodusServerUrl ? 'cloudflare' : settings.localServerEnabled ? 'basic' : 'advanced',
  );
  const [copilotStatus, setCopilotStatus] = useState<CopilotServerStatus>({ running: false, port: null, addinUrl: null, certReady: false, error: null });
  const [zoteroStatus, setZoteroStatus] = useState<ZoteroPluginServerStatus>({ running: false, port: null, url: null, error: null });
  const [zoteroInstallBusy, setZoteroInstallBusy] = useState(false);
  const [browserConnectorBusy, setBrowserConnectorBusy] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotInstallBusy, setCopilotInstallBusy] = useState(false);
  const [copilotInstallMessage, setCopilotInstallMessage] = useState<string | null>(null);
  const [libreOfficeInstallBusy, setLibreOfficeInstallBusy] = useState(false);
  const [libreOfficeInstallMessage, setLibreOfficeInstallMessage] = useState<string | null>(null);
  const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcpPort));
  const [mcpHelpOpen, setMcpHelpOpen] = useState(false);
  const [mcpCopied, setMcpCopied] = useState<'url' | 'token' | null>(null);

  useEffect(() => {
    if (!updateProgress) return;
    setUpdateMessage(updateStatusMessage(updateProgress));
    setCheckingUpdate(updateProgress.status === 'checking');
  }, [updateProgress, settings.uiLanguage]);

  useEffect(() => {
    if (!dataTabRequested) return;
    let active = true;
    void window.nodus.hasBackupPassword().then((has) => {
      if (active) setAutoBackupHasPassword(has);
    });
    return () => {
      active = false;
    };
  }, [dataTabRequested]);

  useEffect(() => {
    let active = true;
    setMigrationRecoverySnapshots([]);
    if (!dataTabRequested || !activeVault) return () => { active = false; };
    void window.nodus.listMigrationRecoverySnapshots()
      .then((snapshots) => { if (active) setMigrationRecoverySnapshots(snapshots); })
      .catch(() => { if (active) setMigrationRecoverySnapshots([]); });
    return () => { active = false; };
  }, [activeVault?.id, dataTabRequested]);

  useEffect(() => {
    let active = true;
    setBackupCleanupPreview(null);
    if (!dataTabRequested || !settings.autoBackupFolder) {
      return () => { active = false; };
    }
    void window.nodus.previewBackupCleanup().then((preview) => {
      if (active) setBackupCleanupPreview(preview);
    });
    return () => { active = false; };
  }, [
    dataTabRequested,
    settings.autoBackupFolder,
    settings.backupRetentionUnit,
    settings.backupRetentionValue,
    settings.lastAutoBackupAt,
    settings.lastBackupCleanupAt,
  ]);

  useEffect(() => {
    if (!integrationsTabRequested) return;
    let active = true;
    const refresh = async () => {
      const [next, tunnel] = await Promise.all([window.nodus.getMcpStatus(), window.nodus.getMcpTunnelStatus()]);
      if (active) {
        setMcpStatus(next);
        setMcpTunnelStatus(tunnel);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [integrationsTabRequested, settings.mcpEnabled, settings.mcpPort, settings.mcpToken]);

  useEffect(() => setMcpPortInput(String(settings.mcpPort)), [settings.mcpPort]);

  // Basic mode polls on a slow tick, unlike MCP's 1.5s: the answers here involve running the
  // Tailscale CLI, and a status read should not cost a subprocess every second and a half.
  useEffect(() => {
    if (!serverTabRequested) return;
    let active = true;
    const refresh = async () => {
      try {
        const [status, power] = await Promise.all([
          window.nodus.getLocalServerStatus(),
          window.nodus.getLocalServerPower(),
        ]);
        if (!active) return;
        setLocalServerStatus(status);
        setLocalServerPower(power);
        // The account only exists once the server has run, and the password never changes while
        // it is up, so this asks once per run rather than on every tick.
        if (status.phase !== 'running') {
          localServerPasswordRef.current = null;
          setLocalServerPassword(null);
        } else if (!localServerPasswordRef.current) {
          const password = await window.nodus.getLocalServerAdminPassword();
          if (!active) return;
          localServerPasswordRef.current = password;
          setLocalServerPassword(password);
        }
      } catch {
        // Transient during startup; the next tick retries.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 6000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [serverTabRequested, settings.localServerAccess, settings.localServerPort]);

  useEffect(() => setNodusServerUrlInput(settings.nodusServerUrl), [settings.nodusServerUrl]);

  useEffect(() => {
    if (!serverTabRequested) return;
    let cancelled = false;
    const load = async () => {
      try {
        const value = await window.nodus.replicaOverview();
        if (!cancelled) setReplicas(value);
      } catch {
        // The panel is informational; a failed poll simply leaves the last state showing.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [serverTabRequested]);

  const syncReplica = async (vaultId: string) => {
    setReplicaBusy(vaultId);
    try { setReplicas(await window.nodus.replicaSyncNow(vaultId)); }
    catch (error) { setNodusServerMessage(errorText(error)); }
    finally { setReplicaBusy(null); }
  };

  const detachReplica = async (vaultId: string, vaultName: string) => {
    if (!window.confirm(t('¿Desconectar «{name}» del servidor? La bóveda y todo su contenido se quedan en este equipo; solo deja de sincronizarse.').replace('{name}', vaultName))) return;
    setReplicaBusy(vaultId);
    try { setReplicas(await window.nodus.replicaDetach(vaultId)); }
    catch (error) { setNodusServerMessage(errorText(error)); }
    finally { setReplicaBusy(null); }
  };

  useEffect(() => {
    if (!serverTabRequested) return;
    let active = true;
    const refresh = async () => {
      const next = await window.nodus.getNodusServerOverview();
      if (active) setNodusServerOverview(next);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [serverTabRequested, settings.nodusServerEnabled, settings.nodusServerUrl, settings.nodusServerSpaceId]);

  useEffect(() => {
    if (!integrationsTabRequested) return;
    let active = true;
    const refresh = async () => {
      const next = await window.nodus.getCopilotStatus();
      if (active) setCopilotStatus(next);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [integrationsTabRequested, settings.copilotEnabled, settings.copilotPort, settings.copilotToken]);

  useEffect(() => {
    if (!integrationsTabRequested) return;
    let active = true;
    const refresh = async () => {
      const next = await window.nodus.getZoteroPluginStatus();
      if (active) setZoteroStatus(next);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [integrationsTabRequested, settings.zoteroPluginEnabled, settings.browserConnectorEnabled, settings.zoteroPluginPort, settings.zoteroPluginToken, settings.browserConnectorToken]);

  useEffect(() => {
    if (!mcpHelpOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMcpHelpOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mcpHelpOpen]);

  const patch = async (p: Partial<AppSettings>) => {
    if (p.theme !== undefined) applyThemeMode(p.theme);
    let next: AppSettings;
    try {
      next = await window.nodus.updateSettings(p);
    } catch (error) {
      if (p.theme !== undefined) applyThemeMode(settings.theme);
      throw error;
    }
    // Apply palette changes from the authoritative IPC response immediately.
    // This keeps the desktop renderer from showing the preview/default palette
    // while the parent shell performs its asynchronous settings refresh.
    if (p.appTheme !== undefined || p.customThemes !== undefined) {
      applyRuntimeAppTheme(next.appTheme, next.customThemes ?? []);
    }
    await onChange();
  };

  const customThemes = settings.customThemes ?? [];
  const closeThemeEditor = () => {
    applyRuntimeAppTheme(settings.appTheme, customThemes);
    setThemeEditorOpen(false);
  };
  const selectTheme = (id: string) => {
    // Keep the definition alongside the selected id. This is important for a
    // custom palette: a settings refresh that only carries the id cannot derive
    // its runtime tokens and would correctly fall back to the default palette.
    applyRuntimeAppTheme(id, customThemes);
    void patch({ appTheme: id, customThemes });
  };
  const openThemeEditor = (theme?: CustomAppTheme) => {
    setEditingThemeId(theme?.id ?? null);
    setThemeDraft(themeDraftFrom(theme));
    setThemeError(null);
    setThemeEditorOpen(true);
  };

  const saveTheme = async () => {
    const label = themeDraft.label.trim();
    if (!label) return setThemeError(t('Escribe un nombre para el tema.'));
    const accent = normalizeThemeColour(themeDraft.accent);
    const deep = normalizeThemeColour(themeDraft.deep);
    const pale = normalizeThemeColour(themeDraft.pale);
    const appBackgroundLight = normalizeThemeColour(themeDraft.appBackground.light);
    const appBackgroundDark = normalizeThemeColour(themeDraft.appBackground.dark);
    const lightText = normalizeThemeColour(themeDraft.lightText);
    const darkText = normalizeThemeColour(themeDraft.darkText);
    if (!accent || !deep || !pale || !appBackgroundLight || !appBackgroundDark || !lightText || !darkText) {
      return setThemeError(t('Usa colores hexadecimales completos, por ejemplo #6366f1.'));
    }
    const id = editingThemeId ?? themeSlug(label);
    const duplicate = customThemes.some((theme) => theme.id !== editingThemeId && theme.id === id);
    if (duplicate) return setThemeError(t('Ya existe un tema con ese nombre.'));
    const normalizedDraft = {
      ...themeDraft,
      label,
      accent,
      deep,
      pale,
      appBackground: { light: appBackgroundLight, dark: appBackgroundDark },
      lightText,
      darkText,
    };
    const tokens = deriveThemeTokens({ anchors: normalizedDraft });
    const readable = contrast(tokens.text.dark, tokens.n[950]) >= 4.5
      && contrast(tokens.text.light, tokens.n[50]) >= 4.5
      && contrast(tokens.text.dark, tokens.appBackground.dark) >= 4.5
      && contrast(tokens.text.light, tokens.appBackground.light) >= 4.5
      && contrast(tokens.a.light[300], '#ffffff') >= 4.5
      && contrast(tokens.a.dark[300], tokens.n[950]) >= 4.5;
    if (!readable) return setThemeError(t('Ajusta los colores para alcanzar el contraste mínimo de lectura.'));
    const nextTheme: CustomAppTheme = { id, ...normalizedDraft };
    const nextThemes = customThemes.some((theme) => theme.id === id)
      ? customThemes.map((theme) => theme.id === id ? nextTheme : theme)
      : [...customThemes, nextTheme];
    await patch({ customThemes: nextThemes, appTheme: id });
    setThemeEditorOpen(false);
    setEditingThemeId(null);
    setThemeError(null);
  };

  const deleteTheme = async (id: string) => {
    const nextThemes = customThemes.filter((theme) => theme.id !== id);
    await patch({ customThemes: nextThemes, appTheme: settings.appTheme === id ? 'default' : settings.appTheme });
    if (editingThemeId === id) setThemeEditorOpen(false);
  };

  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(null), 2000);
  };

  const activeChunkWords =
    settings.deepContextMode === 'long' ? settings.deepLongChunkWords : settings.deepStandardChunkWords;
  const patchActiveChunkWords = (value: string) => {
    const min = settings.deepContextMode === 'long' ? 5000 : 500;
    const max = settings.deepContextMode === 'long' ? 50000 : 5000;
    const parsed = Math.min(max, Math.max(min, parseInt(value, 10) || min));
    void patch(
      settings.deepContextMode === 'long'
        ? { deepLongChunkWords: parsed }
        : { deepStandardChunkWords: parsed }
    );
  };

  const patchPrimarySourcePolicy = async (value: Partial<PrimarySourcePolicySettings>) => {
    const next = await window.nodus.updatePrimarySourcePolicySettings(value);
    setPrimarySourcePolicy(next);
  };

  const startReset = async () => {
    const ok = await confirm({
      title: t('Reinicializar el grafo'),
      message: t('Reinicializar el grafo borrará TODAS las ideas, temas, conexiones, autores y huecos, y dejará cada obra sin analizar. Tu biblioteca de Zotero y tus ajustes se conservan. Esta acción no se puede deshacer.'),
      confirmLabel: t('Continuar'),
      danger: true,
    });
    if (!ok) return;
    setResetInput('');
    setResetCode(String(Math.floor(1000 + Math.random() * 9000)));
  };

  const confirmReset = async () => {
    if (resetInput !== resetCode) return;
    setResetting(true);
    try {
      await window.nodus.resetGraph();
      setResetCode(null);
      setResetInput('');
      flash(t('Grafo reinicializado. Vuelve a analizar tus obras para reconstruirlo.'));
    } finally {
      setResetting(false);
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateMessage(null);
    try {
      const result = await window.nodus.checkForUpdates();
      setUpdateProgress({ ...result, at: new Date().toISOString() });
      setUpdateMessage(updateStatusMessage(result));
    } catch {
      setUpdateProgress((current) => ({ status: 'error', errorCode: 'update-check-failed', message: '', downloadedVersion: pendingUpdateVersion(current), version: current?.version, at: new Date().toISOString() }));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    if (requestingInstall) return;
    setRequestingInstall(true);
    const result = await installUpdateManually(updateProgress);
    setUpdateProgress(result);
    setUpdateMessage(updateStatusMessage(result));
    setRequestingInstall(false);
  };

  const enableBetaUpdates = async () => {
    setConfirmBetaUpdates(false);
    await patch({ betaUpdates: true });
    await checkForUpdates();
  };

  const refreshBackupCleanupPreview = async () => {
    const preview = await window.nodus.previewBackupCleanup();
    setBackupCleanupPreview(preview);
    return preview;
  };

  const runBackupCleanup = async () => {
    setConfirmBackupCleanupNow(false);
    setBackupCleanupRunning(true);
    try {
      if (!backupCleanupPreview?.ok || !backupCleanupPreview.scopeToken) {
        flash(t('La vista previa ya no está disponible. Revísala de nuevo antes de limpiar.'));
        return;
      }
      const result = await window.nodus.runBackupCleanupNow(backupCleanupPreview.scopeToken);
      flash(result.ok
        ? result.quarantinedCount > 0
          ? tx('{count} copia(s) se movió/movieron a la papelera de seguridad.', { count: result.quarantinedCount })
          : result.purgedCount > 0
            ? tx('{count} copia(s) se eliminó/eliminaron definitivamente tras siete días.', { count: result.purgedCount })
            : t('No hay copias que superen la antigüedad configurada.')
        : errorText(result.message));
      await onChange();
      await refreshBackupCleanupPreview();
    } catch (error) {
      flash(errorText(error));
    } finally {
      setBackupCleanupRunning(false);
    }
  };

  const enableBackupCleanup = async () => {
    setConfirmBackupCleanupEnable(false);
    setBackupCleanupRunning(true);
    let enabled = false;
    try {
      if (!backupCleanupPreview?.ok || !backupCleanupPreview.scopeToken) {
        flash(t('La vista previa ya no está disponible. Revísala de nuevo antes de limpiar.'));
        return;
      }
      await patch({ backupCleanupEnabled: true });
      enabled = true;
      // Enabling is also an explicit catch-up: do not wait for the 30-minute
      // maintenance heartbeat when the user has just confirmed the exact scope.
      const result = await window.nodus.runBackupCleanupNow(backupCleanupPreview.scopeToken);
      if (!result.ok) {
        // A failed first run must not leave a destructive background policy armed.
        await patch({ backupCleanupEnabled: false });
        enabled = false;
      }
      flash(result.ok
        ? result.quarantinedCount > 0
          ? tx('{count} copia(s) se movió/movieron a la papelera de seguridad.', { count: result.quarantinedCount })
          : result.purgedCount > 0
            ? tx('{count} copia(s) se eliminó/eliminaron definitivamente tras siete días.', { count: result.purgedCount })
            : t('No hay copias que superen la antigüedad configurada.')
        : errorText(result.message));
      await onChange();
      await refreshBackupCleanupPreview();
    } catch (error) {
      if (enabled) {
        try {
          await patch({ backupCleanupEnabled: false });
        } catch {
          // The original error is more useful; the backend still fails closed.
        }
      }
      flash(errorText(error));
    } finally {
      setBackupCleanupRunning(false);
    }
  };

  const exportBackup = async () => {
    const result = await window.nodus.exportData();
    if (!result) return;
    setBackupCopied(false);
    setBackupResult(result);
    flash(`${t('Exportado')}: ${result.path}`);
  };

  const copyBackupPassword = async () => {
    if (!backupResult) return;
    await navigator.clipboard.writeText(`${t('Contraseña')}: ${backupResult.password}\n${t('Clave de recuperación')}: ${backupResult.recoveryKey}`);
    setBackupCopied(true);
  };

  const commitMcpPort = () => {
    const parsed = Math.min(65535, Math.max(1024, parseInt(mcpPortInput, 10) || 4319));
    setMcpPortInput(String(parsed));
    if (parsed !== settings.mcpPort) void patch({ mcpPort: parsed });
  };

  const regenerateMcpToken = async () => {
    await window.nodus.regenerateMcpToken();
    await onChange();
    setMcpStatus(await window.nodus.getMcpStatus());
    flash(t('Token MCP regenerado. Reconecta los clientes con el nuevo token.'));
  };

  const copyMcpValue = async (kind: 'url' | 'token', value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setMcpCopied(kind);
    setTimeout(() => setMcpCopied(null), 1500);
  };

  const pairWithNodusServer = async () => {
    setNodusServerBusy(true);
    setNodusServerMessage(null);
    try {
      const result = await window.nodus.pairNodusServer(nodusServerUrlInput, nodusServerPairCode);
      setNodusServerPairCode('');
      await onChange();
      setNodusServerOverview(await window.nodus.getNodusServerOverview());
      setNodusServerMessage(`${t('Conectado a')} ${result.serverName} · ${result.spaceName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodusServerMessage(message);
    } finally {
      setNodusServerBusy(false);
    }
  };

  const syncNodusServerVault = async (vaultId: string) => {
    setNodusServerBusy(true);
    setNodusServerMessage(null);
    try {
      const next = await window.nodus.syncNodusServerVaultNow(vaultId);
      setNodusServerOverview(next);
      const conn = next.connections.find((c) => c.vaultId === vaultId);
      setNodusServerMessage(conn?.lastError || t('Vault publicado correctamente.'));
    } finally {
      setNodusServerBusy(false);
    }
  };

  const changeNodusServerLanguage = async (vaultId: string, language: AppSettings['nodusServerLanguage']) => {
    setNodusServerBusy(true);
    setNodusServerMessage(null);
    try {
      const next = await window.nodus.setNodusServerLanguage(language, vaultId);
      setNodusServerOverview(next);
      await onChange();
      setNodusServerMessage(t('Idioma del servidor actualizado.'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodusServerMessage(message);
    } finally {
      setNodusServerBusy(false);
    }
  };

  const disconnectNodusServerVault = async (vaultId: string, vaultName: string) => {
    const accepted = await confirm({
      title: t('Desconectar Nodus Server'),
      message: `${vaultName} · ${t('Nodus dejará de publicar este vault. La última copia seguirá en el servidor hasta que su administrador la elimine.')}`,
      confirmLabel: t('Desconectar'),
      danger: true,
    });
    if (!accepted) return;
    setNodusServerBusy(true);
    try {
      const next = await window.nodus.disconnectNodusServerVault(vaultId);
      setNodusServerOverview(next);
      setNodusServerMessage(t('Servidor desconectado.'));
      await onChange();
    } finally {
      setNodusServerBusy(false);
    }
  };

  // ── Basic mode: the server running on this computer ──────────────────────
  // Every action here does the same three things — mark busy, run, refresh both status and
  // power — so they share one wrapper rather than repeating the try/finally eight times.
  const refreshLocalServer = async () => {
    const [status, power] = await Promise.all([
      window.nodus.getLocalServerStatus(),
      window.nodus.getLocalServerPower(),
    ]);
    setLocalServerStatus(status);
    setLocalServerPower(power);
    if (status.phase !== 'running') {
      localServerPasswordRef.current = null;
      setLocalServerPassword(null);
      return;
    }
    if (localServerPasswordRef.current) return;
    const password = await window.nodus.getLocalServerAdminPassword();
    localServerPasswordRef.current = password;
    setLocalServerPassword(password);
  };

  const runLocalServerAction = async (action: () => Promise<unknown>, success?: string) => {
    setLocalServerBusy(true);
    setLocalServerMessage(null);
    try {
      await action();
      if (success) setLocalServerMessage(success);
    } catch (error) {
      setLocalServerMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await refreshLocalServer().catch(() => undefined);
      setLocalServerBusy(false);
    }
  };

  const connectVaultToLocalServer = () => runLocalServerAction(async () => {
    await window.nodus.connectVaultToLocalServer();
    setNodusServerOverview(await window.nodus.getNodusServerOverview());
    await onChange();
  }, t('Vault conectado al servidor de este ordenador.'));

  // Just the setting: the main process restarts a running server when this changes, because the
  // access path decides which addresses it binds and whether it presents a certificate. Asking
  // for the restart here as well would race the one already under way.
  const chooseLocalServerAccess = (access: LocalServerAccess) =>
    runLocalServerAction(() => patch({ localServerAccess: access }));

  const importBackup = async () => {
    if (!importPassword.trim()) {
      flash(t('Introduce la contraseña de la copia.'));
      return;
    }
    setImportingBackup(true);
    try {
      const result = await window.nodus.importData(importPassword);
      flash(result.message);
      if (result.ok) {
        setImportOpen(false);
        setImportPassword('');
        await onChange();
      }
    } finally {
      setImportingBackup(false);
    }
  };

  const updatePct =
    updateProgress?.progress != null ? Math.max(0, Math.min(100, updateProgress.progress)) : null;
  const updateBusy = updateProgress?.status === 'downloading'
    || updateProgress?.status === 'backing-up'
    || updateProgress?.status === 'installing';
  const updateDownloaded = canInstallUpdate(updateProgress);
  const normalizedSettingsQuery = normalizeSettingsText(settingsQuery);
  const settingsSearchActive = normalizedSettingsQuery.length > 0;
  const visibleSettingsSection = (tab: SettingsTabId, title: string, keywords: string): boolean => {
    if (tab === 'library' && !hasZoteroLibraryWorkflow) return false;
    if (!settingsSearchActive) return settingsTab === tab;
    const tabMeta = SETTINGS_TABS.find((item) => item.id === tab);
    return normalizeSettingsText(`${title} ${t(title)} ${tabMeta?.label ?? ''} ${t(tabMeta?.label ?? '')} ${tabMeta?.keywords ?? ''} ${keywords}`).includes(normalizedSettingsQuery);
  };
  const visibleSettingsCount = [
    visibleSettingsSection('providers', 'Proveedores de IA y modelos', 'api claves proveedor favoritos predeterminado vault boveda cargar claves'),
    visibleSettingsSection('library', 'Zotero y sincronización', 'zotero sincronizacion manual tiempo real storage tag lectura'),
    visibleSettingsSection('library', 'Automatización de análisis', 'analizar temas profundo resumen cola relaciones reanudar'),
    visibleSettingsSection('interface', 'Idioma', 'interfaz prompts idioma español english citas'),
    visibleSettingsSection('interface', 'Apariencia', 'tema claro oscuro animaciones velocidad'),
    visibleSettingsSection('interface', 'Accesibilidad y lectura', 'escala zoom fuente legible contraste movimiento animaciones enfoque lectura teclado lector pantalla'),
    visibleSettingsSection('interface', 'Mascota Nodi', 'nodi mascota mascot flotante superpuesta always on top encima escritorio companion acompanante'),
    activeVault?.type === 'testimonios' && visibleSettingsSection('interface', 'Testimonios', 'historia oral entrevistas acuerdo acceso embargo narrador repositorio conservacion transcripcion proveedor externo'),
    visibleSettingsSection('interface', 'Barra lateral', 'menu lateral ordenar ocultar mostrar navegacion'),
    visibleSettingsSection('system', 'Ayuda', 'tutorial uso avanzado actualizaciones version update reiniciar'),
    visibleSettingsSection('integrations', 'Servidor MCP', 'mcp servidor puerto token cliente conexion chatgpt openai tunnel tunel'),
    visibleSettingsSection('browser', 'Nodus Browser', 'navegador browser web cookies cache almacenamiento datos permisos sitios descargas privacidad'),
    visibleSettingsSection('mobile', 'Conexión móvil', 'movil mobile iphone ipad codigo qr lan vpn tailscale live workspace escritorio'),
    visibleSettingsSection('server', 'Nodus Server', 'docker compartir vault boveda estudiantes investigadores dominio oauth reverse proxy caddy nginx sincronizacion remota'),
    visibleSettingsSection('integrations', 'Copiloto de escritura Word', 'word copilot addin certificado token localhost'),
    visibleSettingsSection('integrations', 'Copiloto de escritura LibreOffice', 'libreoffice copilot macro python install instalacion instalando'),
    visibleSettingsSection('integrations', 'Nodus para Zotero', 'zotero plugin sidebar chat servidor puerto token pagina citas conexiones'),
    visibleSettingsSection('integrations', 'Nodus Research Connector', 'chrome navegador browser extension conector captura metadatos colecciones etiquetas pdf doi isbn'),
    visibleSettingsSection('data', 'Backup / copia de seguridad', 'datos demo exportar importar copia backup cifrada contraseña'),
    visibleSettingsSection('models', 'Modelos de IA', 'basico avanzado modelo general extraccion sintesis tutor resumen fusion embeddings transcripcion voz imagen quimica chemistry stock mcule proveedores comprar'),
    visibleSettingsSection('extraction', 'Extracción de texto PDFs grandes', 'pdf texto zotero ocr tesseract paginas idiomas esquemas figuras'),
    activeVault?.type === 'academic' && visibleSettingsSection('data', 'Salud del grafo', GRAPH_HEALTH_KEYWORDS),
    visibleSettingsSection('data', 'Zona de peligro', 'reinicializar grafo borrar ideas temas conexiones autores huecos'),
    visibleSettingsSection('about', 'Acerca de Nodus Research', 'proyecto independiente codigo abierto open source gratuito privacidad privacy rgpd gdpr datos alumnado licencia roadmap hoja de ruta futuro redes sociales social reddit youtube comunidad'),
    visibleSettingsSection('updates', 'Actualizaciones y novedades', 'actualizaciones update version novedades ultimos cambios latest changes changelog buscar instalar reiniciar avisos anuncios encuestas noticias beta testers prerelease canal estable'),
  ].filter(Boolean).length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-4 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('Ajustes')}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {t('Busca un ajuste o entra por una sección temática.')}
          </p>
          <p className="text-xs text-neutral-600 mt-1">Nodus v{__APP_VERSION__}</p>
        </div>
        <div className="flex-1" />
        <label className="relative w-full sm:w-80">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className="input input-with-leading-icon w-full"
            value={settingsQuery}
            onChange={(e) => setSettingsQuery(e.target.value)}
            placeholder={t('Buscar en ajustes…')}
          />
        </label>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {SETTINGS_TABS.filter((tab) => tab.id !== 'library' || hasZoteroLibraryWorkflow).map((tab) => (
          <SettingsTabButton
            key={tab.id}
            active={!settingsSearchActive && settingsTab === tab.id}
            icon={tab.icon}
            onClick={() => {
              setSettingsTab(tab.id);
              setSettingsQuery('');
            }}
          >
            {t(tab.label)}
          </SettingsTabButton>
        ))}
        {settingsSearchActive && (
          <div className="ml-auto self-center text-xs text-neutral-500">
            {visibleSettingsCount === 1 ? t('1 sección encontrada') : `${visibleSettingsCount} ${t('secciones encontradas')}`}
          </div>
        )}
      </div>

      {visibleSettingsCount === 0 && (
        <div className="card p-5 text-sm text-neutral-500">
          {t('No hay ajustes que coincidan con la búsqueda.')}
        </div>
      )}
      {visibleSettingsSection('providers', 'Proveedores de IA y modelos', 'api claves proveedor favoritos predeterminado vault boveda cargar claves') && (
        <ProvidersSettings
            settings={settings}
            onChange={onChange}
          />
      )}

      {visibleSettingsSection('library', 'Zotero y sincronización', 'zotero sincronizacion manual tiempo real storage tag lectura') && (
          <Section title={t('Zotero y sincronización')}>
            <Row label={t('Modo de sincronización')}>
              <select className="input" value={settings.syncMode} onChange={(e) => patch({ syncMode: e.target.value as any })}>
                <option value="manual">{t('Manual')}</option>
                <option value="realtime">{t('Tiempo real')}</option>
              </select>
            </Row>
            <Row label={t('Tag de lectura')}>
              <input className="input" value={settings.readTag} onChange={(e) => patch({ readTag: e.target.value })} />
            </Row>
            <Row label={t('Ruta de storage de Zotero')}>
              <input
                className="input w-full"
                value={settings.zoteroStoragePath}
                onChange={(e) => patch({ zoteroStoragePath: e.target.value })}
              />
            </Row>
          </Section>
      )}

      {activeVault?.type === 'academic' && visibleSettingsSection('library', 'Preparar fuentes', 'documentos embeddings biblioteca consentimiento') && (
        <Section title={t('Preparar fuentes')}>
          <button className="btn" onClick={() => openResearchPreparation(undefined, true)}>{t('Preparar fuentes')}</button>
        </Section>
      )}

      {settings.academicMode !== 'manual' && visibleSettingsSection('library', 'Automatización de análisis', 'analizar temas profundo resumen cola relaciones reanudar') && (
          <Section title={t('Automatización de análisis')}>
            <Row label={t('Analizar temas al sincronizar')}>
              <input type="checkbox" checked={settings.autoLightScan} onChange={(e) => patch({ autoLightScan: e.target.checked })} />
            </Row>
            <Row label={t('Analizar a fondo obras con tag')}>
              <input
                type="checkbox"
                checked={settings.autoDeepScanOnReadTag}
                onChange={(e) => patch({ autoDeepScanOnReadTag: e.target.checked })}
              />
            </Row>
            <Row label={t('Resumir tras análisis profundo')}>
              <input
                type="checkbox"
                checked={settings.autoSummaryAfterDeep}
                onChange={(e) => patch({ autoSummaryAfterDeep: e.target.checked })}
              />
            </Row>
            <Row label={t('Descubrir relaciones al vaciar la cola')}>
              <input
                type="checkbox"
                checked={settings.autoBridgeAfterQueue}
                onChange={(e) => patch({ autoBridgeAfterQueue: e.target.checked })}
              />
            </Row>
            <Row label={t('Reanudar cola al abrir')}>
              <input type="checkbox" checked={settings.autoResumeQueue} onChange={(e) => patch({ autoResumeQueue: e.target.checked })} />
            </Row>
            {activeVault?.type === 'academic' && <>
              <div className="mt-4 border-t border-neutral-800 pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Ficha documental')}</h3>
                <p className="mb-3 text-xs leading-5 text-neutral-500">{t('Crea una ficha jerárquica auditada de cada obra completa para orientar chat, Nodi, Deep Research e Immersion. Las citas siguen apuntando al texto original.')}</p>
              </div>
              {DOCUMENT_INDEX_CONTINUOUS_AVAILABLE && <>
                <Row label={t('Indexar obras nuevas automáticamente')} hint={t('Continúa en segundo plano y entre vaults. Las obras actuales no se vuelven a procesar.') }>
                  <input type="checkbox" checked={settings.documentIndexingEnabled} onChange={async (event) => {
                    const enabled = event.target.checked;
                    await patch({ documentIndexingEnabled: enabled });
                  }} />
                </Row>
                <Row label={t('Incluir obras archivadas')}>
                  <input type="checkbox" checked={settings.documentIndexIncludeArchived} onChange={(event) => void patch({ documentIndexIncludeArchived: event.target.checked })} />
                </Row>
              </>}
              <Row label={t('Concurrencia documental')} hint={t('Automático usa dos trabajadores; reduce el valor si el proveedor limita las solicitudes.') }>
                <select className="input" value={settings.documentIndexConcurrency} onChange={(event) => void patch({ documentIndexConcurrency: Number(event.target.value) })}>
                  <option value={0}>{t('Automática')}</option>
                  {[1, 2, 3, 4, 6, 8].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Row>
            </>}
            <p className="text-xs text-neutral-500">
              {t('Apagado por defecto: sincronizar solo incorpora metadatos. Los análisis manuales desde Biblioteca o Colecciones se ejecutan siempre.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Idioma', 'interfaz prompts idioma español english citas') && (
          <Section title={t('Idioma')}>
            <Row label={t('Idioma de la interfaz')}>
              <select
                className="input w-full md:w-64"
                value={settings.uiLanguage}
                onChange={(e) => patch({ uiLanguage: e.target.value as AppSettings['uiLanguage'] })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="pt">Português (Portugal)</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="it">Italiano</option>
                <option value="tr">Türkçe</option>
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </Row>
            <Row label={t('Idioma de los prompts (idioma de las ideas generadas)')}>
              <select
                className="input w-full md:w-64"
                value={settings.promptLanguage}
                onChange={(e) => patch({ promptLanguage: e.target.value as AppSettings['promptLanguage'] })}
              >
                {PROMPT_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </Row>
            <p className="text-xs text-neutral-500">
              {t('El idioma de los prompts determina en qué idioma la IA genera ideas, temas, narrativa del tutor y borradores. Las citas textuales siempre conservan el idioma original de la fuente.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Apariencia', 'tema claro oscuro animaciones velocidad paleta color colores teal ocean forest sunset violet mint amber berry indigo rose') && (
          <Section title={t('Apariencia')}>
            <Row label={t('Modo de color')} hint={t('Elige entre modo claro, oscuro o seguir el sistema operativo.')}>
              <select className="input" value={settings.theme} onChange={(e) => patch({ theme: e.target.value as any })}>
                <option value="system">{t('Sistema')}</option>
                <option value="dark">{t('Oscuro')}</option>
                <option value="light">{t('Claro')}</option>
              </select>
            </Row>
            <Row label={t('Tema')} hint={t('Paletas de color. El modo claro u oscuro se ajusta arriba.')} stacked>
              <div className="w-full space-y-3">
                <ThemePalettePicker
                  value={settings.appTheme}
                  customThemes={customThemes}
                  onSelect={selectTheme}
                  onEditCustom={openThemeEditor}
                  onDeleteCustom={(id) => void deleteTheme(id)}
                />
                <button type="button" className="theme-action-button btn-ghost border-neutral-300 dark:border-neutral-700" onClick={() => openThemeEditor()}>
                  + {t('Crear tema')}
                </button>
                {themeEditorOpen && <div className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900/50 p-3" data-testid="theme-editor">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">{editingThemeId ? t('Editar tema') : t('Crear tema')}</h4>
                  <label className="block text-xs text-neutral-400">
                    {t('Nombre del tema personalizado')}
                    <input className="input mt-1 w-full" value={themeDraft.label} onChange={(event) => setThemeDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder={t('Mi tema')} />
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { key: 'accent', label: 'Acento', value: themeDraft.accent, update: (value: string) => setThemeDraft((draft) => ({ ...draft, accent: value })) },
                      { key: 'app-background-light', label: 'Fondo de la aplicación (modo claro)', value: themeDraft.appBackground.light, update: (value: string) => setThemeDraft((draft) => ({ ...draft, appBackground: { ...draft.appBackground, light: value } })) },
                      { key: 'app-background-dark', label: 'Fondo de la aplicación (modo oscuro)', value: themeDraft.appBackground.dark, update: (value: string) => setThemeDraft((draft) => ({ ...draft, appBackground: { ...draft.appBackground, dark: value } })) },
                      { key: 'pale', label: 'Superficie clara', value: themeDraft.pale, update: (value: string) => setThemeDraft((draft) => ({ ...draft, pale: value })) },
                      { key: 'deep', label: 'Superficie oscura', value: themeDraft.deep, update: (value: string) => setThemeDraft((draft) => ({ ...draft, deep: value })) },
                      { key: 'light-text', label: 'Texto en modo claro', value: themeDraft.lightText, update: (value: string) => setThemeDraft((draft) => ({ ...draft, lightText: value })) },
                      { key: 'dark-text', label: 'Texto en modo oscuro', value: themeDraft.darkText, update: (value: string) => setThemeDraft((draft) => ({ ...draft, darkText: value })) },
                    ].map(({ key, label, value, update }) => (
                      <ThemeColourPicker key={key} labelText={t(label)} hexLabel={t('Hexadecimal')} value={value} onChange={update} />
                    ))}
                  </div>
                  <label className="block text-xs text-neutral-400">
                    {t('Tintado de superficies')}
                    <input className="mt-1 w-full" type="range" min="0" max="0.2" step="0.01" value={themeDraft.tint} onChange={(event) => setThemeDraft((draft) => ({ ...draft, tint: Number(event.target.value) }))} />
                  </label>
                  {themeError && <p className="text-xs text-red-300">{themeError}</p>}
                  <div className="flex items-center gap-2" data-testid="theme-editor-actions">
                    <button type="button" className="theme-action-button btn-ghost border-neutral-300 dark:border-neutral-700" onClick={closeThemeEditor}>
                      {t('Cancelar')}
                    </button>
                    <button
                      type="button"
                      className="theme-action-button border-transparent bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-600 dark:text-white dark:hover:bg-indigo-500"
                      onClick={() => void saveTheme()}
                    >
                      {t('Guardar tema')}
                    </button>
                  </div>
                </div>}
              </div>
            </Row>
            <Row
              label={t('Usar la misma paleta en todas las bóvedas')}
              hint={t('Activado, todas las bóvedas comparten la paleta. Desactivado, cada una recuerda la suya y las nuevas empiezan con la predeterminada. El modo claro u oscuro es común en ambos casos.')}
            >
              <input
                type="checkbox"
                data-testid="share-app-theme"
                checked={settings.shareAppThemeAcrossVaults}
                onChange={(e) => patch({ shareAppThemeAcrossVaults: e.target.checked })}
              />
            </Row>
            <Row label={t('Velocidad de animaciones')}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.animationSpeed}
                onChange={(e) => patch({ animationSpeed: parseFloat(e.target.value) })}
              />
            </Row>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Accesibilidad y lectura', 'escala zoom fuente legible contraste movimiento animaciones enfoque lectura teclado lector pantalla') && (
          <Section title={t('Accesibilidad y lectura')}>
            <div data-testid="accessibility-settings" className="space-y-3">
              <Row label={t('Tamaño de la interfaz')} hint={t('Ajusta menús, botones y texto sin cambiar el contenido de los documentos.') }>
                <div className="flex w-full max-w-md items-center gap-3">
                  <input
                    className="min-w-0 flex-1"
                    type="range"
                    min={0.85}
                    max={1.3}
                    step={0.05}
                    value={settings.interfaceScale}
                    aria-label={t('Tamaño de la interfaz')}
                    onChange={(e) => void patch({ interfaceScale: Math.max(0.85, Math.min(1.3, Number(e.target.value))) })}
                  />
                  <output className="w-12 text-right text-xs text-neutral-400">{Math.round(settings.interfaceScale * 100)}%</output>
                </div>
              </Row>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                <span><span className="block text-sm text-neutral-300">{t('Fuente de alta legibilidad')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Usa una fuente de sistema más ancha y clara, también sin conexión.')}</span></span>
                <input data-testid="accessibility-font" type="checkbox" checked={settings.accessibleFont} onChange={(e) => void patch({ accessibleFont: e.target.checked })} />
              </label>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                <span><span className="block text-sm text-neutral-300">{t('Contraste reforzado')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Refuerza bordes, foco de teclado y separación entre fondo y texto.')}</span></span>
                <input data-testid="accessibility-contrast" type="checkbox" checked={settings.highContrast} onChange={(e) => void patch({ highContrast: e.target.checked })} />
              </label>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                <span><span className="block text-sm text-neutral-300">{t('Reducir animaciones')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Elimina movimiento no esencial; la preferencia del sistema siempre se respeta.')}</span></span>
                <input data-testid="accessibility-motion" type="checkbox" checked={settings.reduceMotion} onChange={(e) => void patch({ reduceMotion: e.target.checked })} />
              </label>
              {activeVault?.type === 'estudio' && (
                <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                  <span><span className="block text-sm text-neutral-300">{t('Modo de lectura')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Da al editor una medida más cómoda y reduce el ruido visual del área de lectura.')}</span></span>
                  <input data-testid="accessibility-reading" type="checkbox" checked={settings.readingFocusMode} onChange={(e) => void patch({ readingFocusMode: e.target.checked })} />
                </label>
              )}
              <p className="text-xs text-neutral-500">{t('Puedes recorrer los controles con Tab, activar botones con Intro o Espacio y abrir la paleta global con Ctrl/⌘ K.')}</p>
            </div>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Mascota Nodi', 'nodi mascota mascot flotante superpuesta always on top encima escritorio companion acompanante aspecto orbe esfera color') && (
          <Section title={t('Mascota Nodi')}>
            <p className="text-xs text-neutral-500 -mt-1">
              {t('Nodi es el nodo que acompaña la app, flotando abajo a la derecha. Haz clic en Nodi para abrir el chat, tus notificaciones y la ayuda.')}
            </p>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-300">{t('Mostrar a Nodi')}</label>
              <input type="checkbox" checked={settings.mascotEnabled} onChange={(e) => void patch({ mascotEnabled: e.target.checked })} />
            </div>
            <div data-testid="nodi-size-setting">
              <label className="text-sm text-neutral-300" htmlFor="nodi-size-slider">{t('Tamaño de Nodi')}</label>
              <p className="mt-0.5 text-xs text-neutral-500">
                {t('El 100 % conserva el tamaño original de Nodi y es el máximo. Puedes reducirlo hasta el 40 %.')}
              </p>
              <div className="mt-2 flex w-full max-w-md items-start gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    id="nodi-size-slider"
                    className="block w-full"
                    type="range"
                    min={NODI_SIZE_SCALES[0]}
                    max={NODI_SIZE_SCALES[NODI_SIZE_SCALES.length - 1]}
                    step={0.1}
                    value={settings.mascotScale}
                    aria-label={t('Tamaño de Nodi')}
                    onChange={(e) => void patch({ mascotScale: Number(e.target.value) })}
                  />
                  <div className="mt-1 flex justify-between px-1" aria-label={t('Tamaños predeterminados')}>
                    {NODI_SIZE_SCALES.map((scale) => {
                      const selected = settings.mascotScale === scale;
                      const isDefault = scale === NODI_DEFAULT_SCALE;
                      const label = isDefault
                        ? `${Math.round(scale * 100)}% · ${t('Predeterminado')}`
                        : `${Math.round(scale * 100)}%`;
                      return (
                        <button
                          key={scale}
                          type="button"
                          className={`h-3 w-3 rounded-full border transition-colors ${selected ? 'border-amber-300 bg-amber-300' : isDefault ? 'border-neutral-300 bg-neutral-500' : 'border-neutral-600 bg-neutral-800 hover:border-neutral-400'}`}
                          aria-label={label}
                          aria-pressed={selected}
                          title={label}
                          onClick={() => void patch({ mascotScale: scale })}
                        />
                      );
                    })}
                  </div>
                </div>
                <output className="w-12 pt-0.5 text-right text-xs text-neutral-400" htmlFor="nodi-size-slider">
                  {Math.round(settings.mascotScale * 100)}%
                </output>
              </div>
            </div>
            <div>
              <label className="text-sm text-neutral-300">{t('Aspecto de Nodi')}</label>
              <p className="mt-0.5 mb-2 text-xs text-neutral-500">{t('Elige el Nodi que te acompaña. El cambio se aplica en toda la app.')}</p>
              <NodiStylePicker
                value={settings.mascotStyle}
                orbHue={orbHue(settings, activeVault?.type ?? null)}
                height={110}
                labels={{
                  classicTitle: t('Nodi clásico'),
                  classicBody: t('El personaje de siempre, con sus gestos y sus trajes según la bóveda.'),
                  orbTitle: t('Nodi orbe'),
                  orbBody: t('Una esfera de cristal con una constelación dentro, que se tiñe del color de tu bóveda.'),
                }}
                onPick={(mascotStyle) => void patch({ mascotStyle, mascotStyleChosen: true })}
              />
            </div>
            {settings.mascotStyle === 'orb' && (
              <>
                <label className="block text-sm text-neutral-300">
                  {t('Color del orbe')}
                  <span className="mt-0.5 block text-xs font-normal text-neutral-500">
                    {settings.mascotOrbColorMode === 'auto'
                      ? t('El orbe toma el color de la bóveda activa y cambia contigo al cambiar de bóveda.')
                      : t('El orbe mantiene siempre el color que elijas, sea cual sea la bóveda.')}
                  </span>
                  <select
                    className="input mt-2 max-w-md"
                    value={settings.mascotOrbColorMode}
                    onChange={(e) => void patch({ mascotOrbColorMode: e.target.value as AppSettings['mascotOrbColorMode'] })}
                  >
                    <option value="auto">{t('Automático: según la bóveda activa')}</option>
                    <option value="manual">{t('Manual: un color fijo')}</option>
                  </select>
                </label>
                {settings.mascotOrbColorMode === 'manual' && (
                  <div className="flex flex-wrap items-center gap-2" data-testid="nodi-orb-palette">
                    {ORB_COLOR_CHOICES.map(({ hex, type }) => {
                      const label = type ? vaultTypeLabel(type) : t('Azul Nodi');
                      const selected = settings.mascotOrbColor.toLowerCase() === hex.toLowerCase();
                      return (
                        <button
                          key={hex}
                          type="button"
                          title={label}
                          aria-label={label}
                          aria-pressed={selected}
                          onClick={() => void patch({ mascotOrbColor: hex })}
                          className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${selected ? 'border-white ring-2 ring-white/30' : 'border-white/20'}`}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <label className="block text-sm text-neutral-300">
              {t('Modelo del chat de Nodi')}
              <span className="mt-0.5 block text-xs font-normal text-neutral-500">{t('Este selector es independiente del asistente de investigación y del resto de funciones de IA.')}</span>
              <div className="mt-2 max-w-md"><ModelPicker settings={settings} value={settings.nodiModel ?? settings.synthesisModel} onChange={(nodiModel) => void patch({ nodiModel })} compact menu emptyLabel="Usar modelo de síntesis" /></div>
            </label>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <label className="text-sm text-neutral-300">{t('Mantener siempre visible sobre otras apps')}</label>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {t('Abre a Nodi en una pequeña ventana flotante del escritorio, por encima del resto de aplicaciones (en los sistemas operativos que lo permiten). Puedes arrastrarla para moverla.')}
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.mascotAlwaysOnTop}
                disabled={!settings.mascotEnabled}
                onChange={(e) => void patch({ mascotAlwaysOnTop: e.target.checked })}
              />
            </div>
            {/* Costumes are a classic-Nodi idea: the orb wears its vault as a colour. */}
            {settings.mascotStyle === 'classic' && (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label className="text-sm text-neutral-300">{t('Trajes de Nodi según la bóveda')}</label>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {t('Nodi lleva un pequeño accesorio según el modo de la bóveda (birrete, brote, gafas de estudio). Desactívalo para ver el Nodi normal en todas.')}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.mascotVaultCostumes}
                  disabled={!settings.mascotEnabled}
                  onChange={(e) => void patch({ mascotVaultCostumes: e.target.checked })}
                />
              </div>
            )}
          </Section>
      )}

      {activeVault?.type === 'testimonios' && visibleSettingsSection('interface', 'Testimonios', 'historia oral entrevistas acuerdo acceso embargo narrador repositorio conservacion transcripcion proveedor externo') && (
          <Section title={t('Testimonios')}>
            {/* Valores PREDETERMINADOS del proyecto, no decisiones irrevocables: cada
                entrevista puede acordarse de otra manera y el programa no puede impedirlo.
                Solo hay uno que manda por encima del acuerdo, y solo para CERRAR: los
                proveedores externos. */}
            <Row
              label={t('Propósito del proyecto')}
              hint={t('Se muestra en Inicio. Para qué se recoge esta memoria.')}
            >
              <textarea
                className="input w-full md:w-96"
                rows={2}
                defaultValue={settings.testimonyProjectPurpose}
                onBlur={(e) => patch({ testimonyProjectPurpose: e.target.value })}
              />
            </Row>
            <Row label={t('Idioma habitual de las entrevistas')}>
              <input
                className="input w-full md:w-40"
                placeholder="es"
                defaultValue={settings.testimonyDefaultLanguage}
                onBlur={(e) => patch({ testimonyDefaultLanguage: e.target.value })}
              />
            </Row>
            <Row
              label={t('Acceso predeterminado')}
              hint={t('El nivel con el que nace el acuerdo de una entrevista nueva.')}
            >
              <select
                className="input w-full md:w-64"
                data-testid="testimony-default-access"
                value={settings.testimonyDefaultAccess}
                onChange={(e) => patch({ testimonyDefaultAccess: e.target.value as AppSettings['testimonyDefaultAccess'] })}
              >
                {TESTIMONY_ACCESS_LEVELS.map((level) => (
                  <option key={level} value={level}>{t(TESTIMONY_ACCESS_LEVEL_LABEL[level])}</option>
                ))}
              </select>
            </Row>
            <Row label={t('Nombre de atribución predeterminado')}>
              <select
                className="input w-full md:w-64"
                value={settings.testimonyDefaultAttribution}
                onChange={(e) => patch({ testimonyDefaultAttribution: e.target.value as AppSettings['testimonyDefaultAttribution'] })}
              >
                {TESTIMONY_ATTRIBUTION_MODES.map((mode) => (
                  <option key={mode} value={mode}>{t(TESTIMONY_ATTRIBUTION_MODE_LABEL[mode])}</option>
                ))}
              </select>
            </Row>
            <Row
              label={t('El narrador revisa por norma')}
              hint={t('En este proyecto, la transcripción se envía al narrador antes de darla por buena.')}
            >
              <input
                type="checkbox"
                className="mt-2"
                checked={settings.testimonyNarratorReviewDefault}
                onChange={(e) => patch({ testimonyNarratorReviewDefault: e.target.checked })}
              />
            </Row>
            <Row label={t('Repositorio de destino')}>
              <input
                className="input w-full md:w-96"
                defaultValue={settings.testimonyRepositoryName}
                onBlur={(e) => patch({ testimonyRepositoryName: e.target.value })}
              />
            </Row>
            <Row
              label={t('Política de conservación')}
              hint={t('Dónde se depositará y cada cuánto se hace una copia fuera de este equipo.')}
            >
              <textarea
                className="input w-full md:w-96"
                rows={2}
                defaultValue={settings.testimonyRetentionPolicy}
                onBlur={(e) => patch({ testimonyRetentionPolicy: e.target.value })}
              />
            </Row>
            <Row
              label={t('Plantilla de acuerdo')}
              hint={t('El nombre o la dirección del modelo de consentimiento que usa el proyecto.')}
            >
              <input
                className="input w-full md:w-96"
                defaultValue={settings.testimonyAgreementTemplate}
                onBlur={(e) => patch({ testimonyAgreementTemplate: e.target.value })}
              />
            </Row>
            <Row
              label={t('Permitir proveedores externos')}
              hint={t('Desactivado por omisión. Este ajuste puede CERRAR lo que un acuerdo abre, pero nunca al revés: el acuerdo de cada entrevista sigue mandando.')}
            >
              <input
                type="checkbox"
                className="mt-2"
                data-testid="testimony-allow-external"
                checked={settings.testimonyAllowExternalProviders}
                onChange={(e) => patch({ testimonyAllowExternalProviders: e.target.checked })}
              />
            </Row>
            <p className="text-xs leading-5 text-neutral-500">
              {t('El motor de transcripción, los modelos descargados y el espacio que ocupan se configuran en Proveedores de IA. Las copias de seguridad, en Recuperación.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Barra lateral', 'menu lateral ordenar ocultar mostrar navegacion') && (
          <Section title={t('Barra lateral')}>
            <p className="text-xs text-neutral-500 -mt-1">
              {t('Reordena u oculta las secciones del menú lateral. «Inicio» queda siempre la primera y «Ajustes» la última; ninguna de las dos puede moverse ni ocultarse.')}
            </p>
            <SidebarOrderEditor
              sidebarOrder={settings.sidebarOrder}
              sidebarHidden={effectiveSidebarHidden(settings.sidebarHidden, settings.sidebarCustomized, activeVault?.type)}
              toolkitPinnedPages={settings.toolkitPinnedPages}
              vaultType={activeVault?.type}
              onReorder={(ids) => void patch({ sidebarOrder: ids })}
              onToggleHidden={(hidden) => void patch({ sidebarHidden: hidden, sidebarCustomized: true })}
            />
          </Section>
      )}

      {visibleSettingsSection('system', 'Ayuda', 'tutorial uso avanzado') && (
          <Section title={t('Ayuda')}>
            {/* The videos come first: for most people they are the fastest way in. Their
                copy comes from shared/tutorialVideos.ts rather than t() because that
                table covers the tutorial's twelve languages, not the interface's seven.
                This is the one place that holds the WHOLE catalogue — the first-run guide
                shows only the introduction and each vault's tour offers its own video —
                so it is also the only one with the tabs and the search box. */}
            <TutorialVideoGrid language={settings.uiLanguage} variant="panel" showFilters />
            <div className="border-t border-neutral-800 pt-4 flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Guía esencial de Nodus e IA')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">{t('Bóvedas, modelos locales, API keys, costes, embeddings y voz explicados desde cero.')}</p>
              </div>
              <button
                data-testid="basics-tutorial-replay"
                className="btn btn-primary"
                onClick={() => patch({ basicsTutorialVersion: 0 }).then(() => flash(t('Se mostrará la guía esencial.')))}
              >
                <Icon name="play" /> {t('Empezar')}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Tutorial de uso')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">{t('Lo básico: sincronizar, escanear y moverte por el grafo.')}</p>
              </div>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => patch({ tourComplete: false }).then(() => flash(t('Se mostrará el tutorial.')))}
              >
                <Icon name="help" /> {t('Ver de nuevo')}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Tutorial avanzado de investigación')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">{t('El flujo completo: leer con criterio, comprender el corpus, encontrar tu aportación y escribir.')}</p>
              </div>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => patch({ advancedTourComplete: false }).then(() => flash(t('Se mostrará el tutorial avanzado.')))}
              >
                <Icon name="route" /> {t('Empezar')}
              </button>
            </div>
            {activeVault?.type === 'genealogy' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de genealogía')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('El árbol, las fichas con evidencia, los parentescos sugeridos, la línea temporal, el archivo y el mapa.')}</p>
                </div>
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ genealogyTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de genealogía.')))}
                >
                  <Icon name="tree" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'primary_sources' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Recorrido de fuentes primarias')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('Seis pasos: importar con procedencia, preservar originales, revisar propuestas y volver de la conclusión a la evidencia.')}</p>
                </div>
                <button
                  data-testid="primary-sources-tour-replay"
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ primarySourcesTourComplete: false }).then(() => flash(t('Se mostrará el recorrido de fuentes primarias.')))}
                >
                  <Icon name="archive" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'databases' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de bases de datos')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('La lista de bases de datos, la tabla con columnas tipadas, la edición de celdas y las secciones de análisis y chat.')}</p>
                </div>
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ databasesTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de bases de datos.')))}
                >
                  <Icon name="table" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'testimonios' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de testimonios')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('Las entrevistas, los participantes, las sesiones y su audio, la codificación, los contrastes y el acuerdo.')}</p>
                </div>
                <button
                  data-testid="testimony-tour-replay"
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ testimonyTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de testimonios.')))}
                >
                  <Icon name="microphone" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'estudio' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de estudio')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('Cursos, horarios, materiales, grabaciones, chat, ideas, preguntas y repaso.')}</p>
                </div>
                <button
                  data-testid="study-tour-replay"
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ studyTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de estudio.')))}
                >
                  <Icon name="graduation" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'docencia' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de docencia')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('Cursos, grupos, horarios, materiales, rúbricas, exámenes y calificaciones.')}</p>
                </div>
                <button
                  data-testid="teaching-tour-replay"
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ docenciaTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de docencia.')))}
                >
                  <Icon name="presentation" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
          </Section>
      )}

      {visibleSettingsSection('about', 'Acerca de Nodus Research', 'proyecto independiente codigo abierto open source gratuito privacidad privacy rgpd gdpr datos alumnado licencia terceros legal actualizaciones update version novedades roadmap hoja de ruta futuro redes sociales social reddit youtube comunidad') && (
        <Section title={t('Acerca de Nodus Research')}>
          <div className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <Icon name="network" size={22} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Nodus Research</h2>
                <p className="mt-0.5 text-xs text-neutral-500">v{__APP_VERSION__}</p>
              </div>
            </div>

            <div className="mt-5 max-w-3xl space-y-3 text-sm leading-6 text-neutral-700 dark:text-neutral-300">
              <p>
                {t('Nodus es un proyecto independiente de código abierto, desarrollado y mantenido principalmente por una sola persona. No es un servicio comercial ni un producto de pago: la aplicación seguirá siendo gratuita y su código permanecerá abierto.')}
              </p>
              <p>
                {t('Si Nodus te ayuda a estudiar, investigar o escribir y quieres contribuir voluntariamente a su desarrollo, puedes apoyar el proyecto mediante PayPal o Ko-fi. La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación.')}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                data-testid="support-nodus-paypal"
                className="btn btn-paypal"
                onClick={() => void window.nodus.openExternal('https://paypal.me/Jorgepb96')}
              >
                <Icon name="paypal" size={17} /> {t('Apoyar con PayPal')}
                <Icon name="external" size={13} className="opacity-70" />
              </button>
              <button
                data-testid="support-nodus-kofi"
                className="btn btn-kofi"
                onClick={() => void window.nodus.openExternal('https://ko-fi.com/nodus_app')}
              >
                <Icon name="kofi" size={17} /> {t('Apoyar con Ko-fi')}
                <Icon name="external" size={13} className="opacity-70" />
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {t('El enlace se abrirá en tu navegador. Nodus no procesa pagos ni recibe información de pago.')}
            </p>
          </div>
          <div data-testid="about-social" className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                <Icon name="share" size={19} />
              </div>
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Sigue a Nodus')}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('Cada versión, los tutoriales nuevos y las dudas de otras personas se comentan en los perfiles públicos del proyecto.')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {NODUS_SOCIAL_LINKS.map((link) => (
                <button
                  key={link.id}
                  data-testid={`about-social-${link.id}`}
                  className={`btn btn-social btn-social-${link.id}`}
                  aria-label={link.label}
                  title={link.label}
                  onClick={() => void window.nodus.openExternal(link.url)}
                >
                  <Icon name={link.icon} size={17} />
                  {!link.glyphIsWordmark && link.label}
                  <Icon name="external" size={13} className="opacity-70" />
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {t('El enlace se abrirá en tu navegador. Seguir el proyecto es opcional y la aplicación no envía nada a estas redes.')}
            </p>
          </div>
          <div data-testid="about-privacy" className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Icon name="shield" size={19} />
              </div>
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Privacidad y control de datos')}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('Nodus funciona principalmente en el dispositivo: no requiere una cuenta, no incluye publicidad, telemetría ni analítica remota y no opera un backend propio. Los archivos solo salen del equipo cuando el usuario activa de forma expresa un servicio externo identificado.')}
                </p>
                <p className="mt-2 text-xs font-medium leading-5 text-emerald-700 dark:text-emerald-300">
                  {t('La IA no recibe listados, notas ni respuestas del alumnado y no puede calificar, perfilar ni evaluar estudiantes.')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                data-testid="open-privacy-policy"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => setOpenLegalDoc('privacy')}
              >
                <Icon name="book" /> {t('Leer política de privacidad')}
              </button>
              <button
                data-testid="open-privacy-policy-github"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => void window.nodus.openExternal(NODUS_PRIVACY_URL)}
              >
                <Icon name="external" /> {t('Ver archivo en GitHub')}
              </button>
            </div>
          </div>

          <div data-testid="about-gdpr" className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                <Icon name="globe" size={19} />
              </div>
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Cómo facilita Nodus el cumplimiento del RGPD')}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('El diseño aplica minimización, privacidad por defecto y avisos justo antes de grabar. Distingue el tratamiento local de las conexiones opcionales y deja al responsable decidir la base jurídica, conservación, acceso y proveedores.')}
                </p>
                <p className="mt-2 text-xs leading-5 text-neutral-500">
                  {t('Esta arquitectura facilita el cumplimiento del RGPD, pero no es una certificación: cada organización debe documentar su tratamiento y completar la lista de implantación.')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                data-testid="open-gdpr-checklist"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => setOpenLegalDoc('gdpr')}
              >
                <Icon name="check" /> {t('Ver lista RGPD')}
              </button>
              <button
                data-testid="open-official-gdpr"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => void window.nodus.openExternal('https://eur-lex.europa.eu/eli/reg/2016/679/oj')}
              >
                <Icon name="external" /> {t('RGPD oficial')}
              </button>
            </div>
          </div>

          <div data-testid="about-third-party-licenses" className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Icon name="book" size={19} />
              </div>
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Licencias y atribuciones')}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('Nodus se publica exclusivamente con GNU AGPL v3. El código fuente exacto de esta versión y las licencias, atribuciones y textos exigidos por cada componente de terceros se incluyen con cada versión.')}
                </p>
                <p className="mt-2 text-xs text-neutral-500">Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                data-testid="open-third-party-licenses"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => setOpenLegalDoc('licenses')}
              >
                <Icon name="book" /> {t('Ver licencias')}
              </button>
              <button
                data-testid="open-nodus-license-github"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => void window.nodus.openExternal(NODUS_LICENSE_URL)}
              >
                <Icon name="external" /> {t('Licencia AGPL-3.0')}
              </button>
              <button
                data-testid="source-code"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => void window.nodus.openExternal(NODUS_VERSION_SOURCE_URL)}
              >
                <Icon name="code" /> {t('Código fuente de esta versión')}
              </button>
            </div>
          </div>

          <div data-testid="about-roadmap" className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                <Icon name="route" size={19} />
              </div>
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Roadmap')}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                data-testid="open-roadmap"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={onOpenRoadmap}
              >
                <Icon name="route" /> {t('Ver roadmap de Nodus')}
              </button>
            </div>
          </div>

          <div data-testid="about-transparency-security" className={ABOUT_CARD_CLASS}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                <Icon name="lock" size={19} />
              </div>
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Transparencia y seguridad')}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('El código, el historial y los documentos legales son públicos y auditables. Las vulnerabilidades pueden comunicarse de forma privada mediante GitHub Security Advisories.')}
                </p>
                <p className="mt-2 text-xs leading-5 text-neutral-500">
                  {t('La exclusión de garantías de GNU AGPL v3 se aplica solo en la medida permitida por la ley y no elimina obligaciones legales imperativas.')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                data-testid="open-nodus-repository"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => void window.nodus.openExternal(NODUS_REPOSITORY_URL)}
              >
                <Icon name="external" /> {t('Ver repositorio')}
              </button>
              <button
                data-testid="report-security-vulnerability"
                className={ABOUT_ACTION_BUTTON_CLASS}
                onClick={() => void window.nodus.openExternal(NODUS_SECURITY_REPORT_URL)}
              >
                <Icon name="shield" /> {t('Informar de una vulnerabilidad')}
              </button>
            </div>
          </div>

        </Section>
      )}

      {visibleSettingsSection('updates', 'Actualizaciones y novedades', 'actualizaciones update version novedades ultimos cambios latest changes changelog buscar instalar reiniciar avisos anuncios encuestas noticias beta testers prerelease canal estable') && (
        <Section title={t('Actualizaciones y novedades')}>
          <div data-testid="about-latest-changes" className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Últimos cambios')}</label>
              <p className="mt-0.5 text-xs text-neutral-500">{t('Consulta las novedades de la versión actual cuando quieras.')}</p>
            </div>
            <button
              data-testid="open-latest-changes"
              className={ABOUT_ACTION_BUTTON_CLASS}
              onClick={onOpenWhatsNew}
            >
              <Icon name="star" /> {t('Ver últimos cambios')}
            </button>
          </div>
          <div data-testid="about-announcements" className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Avisos de Nodus')}</label>
              <p className="mt-0.5 text-xs text-neutral-500">
                {t('Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.')}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                data-testid="toggle-announcements"
                type="checkbox"
                checked={settings.announcementsEnabled}
                onChange={(e) => void patch({ announcementsEnabled: e.target.checked })}
              />
              {t('Recibir avisos')}
            </label>
          </div>
          <div data-testid="about-updates" className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Actualizaciones')}</label>
              <p className="mt-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                {settings.betaUpdates ? t('Canal Beta') : t('Canal estable')}
              </p>
              {updateMessage && <p className="mt-0.5 text-xs text-neutral-500">{updateMessage}</p>}
              {(updatePct != null || updateBusy) && (
                <div className="mt-2 w-72 max-w-full">
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${updatePct ?? 100}%` }}
                    />
                  </div>
                  {updateProgress?.bytesPerSecond != null && updateProgress.status === 'downloading' && (
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {Math.round(updateProgress.bytesPerSecond / 1024)} KiB/s
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {updateDownloaded && (
                <button className="btn btn-primary" onClick={installUpdate} disabled={requestingInstall}>
                  <Icon name="refresh" /> {t('Instalar y reiniciar')}
                </button>
              )}
              <button className={ABOUT_ACTION_BUTTON_CLASS} onClick={checkForUpdates} disabled={checkingUpdate || updateBusy}>
                <Icon name="sync" className={checkingUpdate || updateBusy ? 'animate-spin' : ''} />
                {checkingUpdate ? t('Buscando…') : updateBusy ? t('Actualizando…') : t('Buscar actualización')}
              </button>
            </div>
          </div>
          <div data-testid="beta-updates-setting" className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Beta updates')}</label>
              <p className="mt-0.5 text-xs text-neutral-500">
                {t('Recibe versiones de prueba además de las actualizaciones estables. Es una opción voluntaria y está desactivada de forma predeterminada.')}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {t('Antes de instalar una beta, Nodus exige una copia completa y verificada en tu carpeta de Recuperación.')}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                data-testid="toggle-beta-updates"
                type="checkbox"
                checked={settings.betaUpdates}
                onChange={(event) => {
                  if (event.target.checked) setConfirmBetaUpdates(true);
                  else void patch({ betaUpdates: false });
                }}
              />
              {settings.betaUpdates ? t('Activadas') : t('Desactivadas')}
            </label>
          </div>
        </Section>
      )}

      {visibleSettingsSection('integrations', 'Servidor MCP', 'mcp servidor puerto token cliente conexion chatgpt openai tunnel tunel') && (
          <Section title={t('Servidor MCP')}>
            <div data-testid="mcp-settings-card" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/70 dark:bg-indigo-950/20">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${mcpTunnelStatus?.phase === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'}`}>
                    <Icon name={mcpTunnelStatus?.phase === 'connected' ? 'check' : 'globe'} />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">ChatGPT</h3>
                    <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                      {mcpTunnelStatus?.phase === 'connected'
                        ? t('Conectado mediante el túnel seguro de OpenAI.')
                        : t('Configúralo con un asistente guiado, sin abrir puertos ni publicar tu biblioteca.')}
                    </p>
                  </div>
                </div>
                <button className="btn btn-primary shrink-0" onClick={() => setMcpHelpOpen(true)}>
                  <Icon name="link" />{mcpTunnelStatus?.phase === 'connected' ? t('Administrar conexión') : t('Conectar con ChatGPT')}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Activar servidor MCP')}</label>
                <button
                  type="button"
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
                  aria-label={t('Ayuda para conectar un cliente MCP')}
                  title={t('Ayuda para conectar un cliente MCP')}
                  onClick={() => setMcpHelpOpen(true)}
                >
                  <Icon name="help" size={15} />
                </button>
              </div>
              <input type="checkbox" checked={settings.mcpEnabled} onChange={(e) => void patch({ mcpEnabled: e.target.checked })} />
            </div>
            <Row label={t('Puerto local')}>
              <input
                className="input w-24"
                type="number"
                min={1024}
                max={65535}
                value={mcpPortInput}
                onChange={(e) => setMcpPortInput(e.target.value)}
                onBlur={commitMcpPort}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </Row>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-950/50">
              {mcpStatus.running ? (
                <span className="text-emerald-700 dark:text-emerald-400">{t('Activo')}: {mcpStatus.url}</span>
              ) : mcpStatus.error ? (
                <span className="text-red-700 dark:text-red-400">{t('Error del servidor MCP')}: {errorText(mcpStatus.error)}</span>
              ) : (
                <span className="text-neutral-500">{t('Apagado')}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void setMcpHelpOpen(true)}>
                <Icon name="link" /> {t('Ver datos de conexión')}
              </button>
              <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void regenerateMcpToken()}>
                <Icon name="refresh" /> {t('Regenerar token')}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              {t('Solo escucha en este ordenador. Las herramientas de escritura están activas mientras el servidor esté encendido.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('browser', 'Nodus Browser', 'navegador browser web cookies cache almacenamiento datos permisos sitios descargas privacidad') && (
        <Section title={t('Nodus Browser')}>
          <BrowserSettings settings={settings} onChange={onChange} />
        </Section>
      )}

      {visibleSettingsSection('mobile', 'Conexión móvil', 'movil mobile iphone ipad codigo qr lan vpn tailscale live workspace escritorio') && (
        <Section title={t('Conexión móvil')}>
          <MobilePairingSettings />
          <button className="btn btn-ghost mt-3 text-sm" onClick={() => { setSettingsTab('server'); setSettingsQuery(''); }}>{t('Servidor avanzado')}</button>
        </Section>
      )}
      {visibleSettingsSection('server', 'Nodus Server', 'docker compartir vault boveda estudiantes investigadores dominio oauth reverse proxy caddy nginx sincronizacion remota') && (
        <Section title={t('Nodus Server')}>
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            {t('Versión experimental recomendada solo para testers. Guarda copias de seguridad y reporta cualquier error desde el botón superior.')}
          </p>

          {/* Three transports share the same vault settings. Cloudflare is the guided,
              no-server path; the two existing modes remain available without migration. */}
          {/* Written out rather than mapped over a table: a key reached through a variable is
              invisible to scripts/test-i18n-coverage.mjs, and an untranslated string that no
              test can see is exactly how the Spanish sidebar labels once shipped. */}
          <div className="grid gap-2 sm:grid-cols-3" data-testid="nodus-server-mode-switch">
            <button
              data-testid="nodus-server-mode-cloudflare"
              aria-pressed={serverMode === 'cloudflare'}
              onClick={() => setServerMode('cloudflare')}
              className={`rounded-xl border p-3 text-left transition ${serverMode === 'cloudflare' ? 'border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-950/30' : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Icon name="globe" /> Cloudflare</span>
              <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('Disponible siempre, sin servidor, Docker, dominio ni conocimientos técnicos.')}</span>
            </button>
            <button
              data-testid="nodus-server-mode-basic"
              aria-pressed={serverMode === 'basic'}
              onClick={() => setServerMode('basic')}
              className={`rounded-xl border p-3 text-left transition ${serverMode === 'basic' ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30' : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon name="home" /> {t('Básico · este ordenador')}
              </span>
              <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                {t('Nodus arranca el servidor aquí. Sin Docker, sin dominio y sin tocar el router.')}
              </span>
            </button>
            <button
              data-testid="nodus-server-mode-advanced"
              aria-pressed={serverMode === 'advanced'}
              onClick={() => setServerMode('advanced')}
              className={`rounded-xl border p-3 text-left transition ${serverMode === 'advanced' ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30' : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon name="tools" /> {t('Avanzado · Docker y dominio propio')}
              </span>
              <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                {t('Un servidor independiente que sigue disponible aunque apagues este ordenador.')}
              </span>
            </button>
          </div>

          {serverMode === 'cloudflare' && (
            <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 dark:border-sky-900 dark:from-sky-950/30 dark:to-indigo-950/20">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-2xl">
                  <h3 className="font-semibold">{t('Tu propio Nodus Cloud, dentro de tu cuenta')}</h3>
                  <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{t('Nodus calcula el coste real y abre el despliegue oficial. Cloudflare crea los servicios directamente en tu cuenta; Nodus no recibe permisos ni credenciales de Cloudflare.')}</p>
                </div>
                <button className="btn btn-primary shrink-0 justify-center" onClick={() => setCloudflareDeployOpen(true)}><Icon name="globe" />Deploy to Cloudflare</button>
              </div>
            </div>
          )}

          {serverMode === 'basic' && localServerStatus && localServerPower && (
            <>
              <LocalServerPanel
                status={localServerStatus}
                power={localServerPower}
                busy={localServerBusy}
                vaultConnected={nodusServerOverview.activeVault.connected}
                adminPassword={localServerPassword}
                onStart={() => void runLocalServerAction(() => window.nodus.startLocalServer())}
                onStop={() => void runLocalServerAction(() => window.nodus.stopLocalServer())}
                onChooseAccess={(access) => void chooseLocalServerAccess(access)}
                onTailscaleServe={(enable) => void runLocalServerAction(() => window.nodus.setLocalServerTailscaleServe(enable))}
                onConnectVault={() => void connectVaultToLocalServer()}
                onKeepAwake={(enable) => void runLocalServerAction(() => window.nodus.setLocalServerKeepAwake(enable))}
                onLidServing={(enable) => void runLocalServerAction(() => window.nodus.setLocalServerLidServing(enable))}
                onCopy={(value) => void navigator.clipboard.writeText(value)}
                onOpenExternal={(url) => void window.nodus.openExternal(url)}
              />
              {localServerMessage && (
                <p className="text-xs text-neutral-600 dark:text-neutral-400" data-testid="local-server-message">{localServerMessage}</p>
              )}
            </>
          )}

          {(serverMode === 'advanced' || serverMode === 'cloudflare') && (
          <>
          {serverMode === 'advanced' && (
          <button
            className="btn btn-ghost w-full justify-center border border-indigo-300 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300 sm:w-auto"
            onClick={() => setNodusServerGuideOpen(true)}
          >
            <Icon name="graduation" /> {t('Guía de instalación paso a paso')}
          </button>
          )}
          <div
            data-testid="nodus-server-settings-card"
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/70 dark:bg-indigo-950/20"
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${nodusServerOverview.connections.some((c) => c.phase === 'ok') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'}`}>
                <Icon name={nodusServerOverview.connections.some((c) => c.phase === 'ok') ? 'check' : 'globe'} />
              </span>
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {t('Vault compartido, siempre actualizado')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                  {t('Nodus publica una copia lógica y filtrada de este vault mediante HTTPS saliente. No abre ningún puerto en tu ordenador y no comparte listener, puerto ni token con el MCP local.')}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/50 dark:text-neutral-400">
            <strong className="text-neutral-800 dark:text-neutral-200">{t('Cómo funciona')}:</strong>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>{t('Cada vault se conecta por separado y sigue publicándose en segundo plano aunque estés trabajando en otro vault.')}</li>
              <li>{t(serverMode === 'cloudflare' ? 'Nodus solo necesita estar abierto para enviar cambios; después Cloudflare los mantiene disponibles aunque apagues el ordenador.' : 'Tu ordenador es quien publica: mantenlo encendido y con Nodus abierto para enviar las novedades.')}</li>
              <li>{t(serverMode === 'cloudflare' ? 'D1 guarda los datos, R2 los archivos y Workers atiende a Desktop, Mobile y clientes MCP.' : 'El servidor Docker sirve la última copia a ChatGPT o Claude aunque tu ordenador esté apagado.')}</li>
            </ul>
          </div>

          <ConnectedVaultsPanel
            replicas={replicas}
            busyVaultId={replicaBusy}
            onSync={(vaultId) => void syncReplica(vaultId)}
            onDetach={(vaultId, vaultName) => void detachReplica(vaultId, vaultName)}
          />

          {nodusServerOverview.connections.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t('Vaults conectados')}</h3>
              {nodusServerOverview.connections.map((conn: NodusServerConnection) => (
                <div key={conn.vaultId} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${conn.phase === 'ok' ? 'bg-emerald-500' : conn.phase === 'error' ? 'bg-red-500' : conn.phase === 'syncing' ? 'bg-indigo-500' : 'bg-neutral-400'}`} />
                        <h4 className="text-sm font-medium">{conn.vaultName}</h4>
                        {conn.isActiveVault && (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{t('Vault actual')}</span>
                        )}
                        {!conn.enabled && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{t('En pausa')}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">{conn.spaceName || t('Espacio compartido')}</p>
                      <p className="mt-0.5 break-all text-xs text-neutral-500">{conn.url}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {conn.phase === 'syncing'
                          ? t('Publicando cambios…')
                          : conn.phase === 'error'
                            ? `${t('Error')}: ${conn.lastError}`
                            : conn.lastSyncAt
                              ? `${t('Última publicación')}: ${new Date(conn.lastSyncAt).toLocaleString()}${conn.lastBytes != null ? ` · ${Math.max(1, Math.round(conn.lastBytes / 1024))} KiB` : ''}`
                              : t('Pendiente de la primera publicación.')}
                      </p>
                      {/* What the ledger drain last did. It only means something now that
                          there is an Inbox to open; before, it was written and never read. */}
                      {conn.lastInbox && (
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {tx('Recibido de otros dispositivos: {applied} aplicados, {kept} conservados, {refused} rechazados', {
                            applied: String(conn.lastInbox.applied + conn.lastInbox.deleted),
                            kept: String(conn.lastInbox.keptLocal),
                            refused: String(conn.lastInbox.refused),
                          })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn btn-primary"
                        disabled={nodusServerBusy || !conn.enabled}
                        onClick={() => void syncNodusServerVault(conn.vaultId)}
                      >
                        <Icon name="sync" className={conn.phase === 'syncing' ? 'animate-spin' : ''} />
                        {t('Publicar ahora')}
                      </button>
                      {conn.url && (
                        <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void window.nodus.openExternal(conn.url)}>
                          <Icon name="external" /> {t('Administrar')}
                        </button>
                      )}
                      <button className="btn btn-ghost border border-red-300 text-red-700 dark:border-red-900 dark:text-red-300" disabled={nodusServerBusy} onClick={() => void disconnectNodusServerVault(conn.vaultId, conn.vaultName)}>
                        <Icon name="x" /> {t('Desconectar')}
                      </button>
                    </div>
                  </div>

                  {conn.isActiveVault ? (
                    <div className="mt-4 space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                      <Row
                        label={t('Idioma de la interfaz del servidor')}
                        hint={t('Cambia la administración web y las pantallas de acceso para todos los usuarios. El idioma inicial es inglés.')}
                      >
                        <select
                          className="input w-full sm:w-64"
                          value={conn.language}
                          disabled={nodusServerBusy}
                          onChange={(event) => void changeNodusServerLanguage(conn.vaultId, event.target.value as AppSettings['nodusServerLanguage'])}
                        >
                          <option value="en">English</option>
                          <option value="es">Español</option>
                          <option value="fr">Français</option>
                          <option value="de">Deutsch</option>
                          <option value="pt">Português (Portugal)</option>
                          <option value="pt-BR">Português (Brasil)</option>
                          <option value="it">Italiano</option>
                          <option value="tr">Türkçe</option>
                        </select>
                      </Row>

                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Publicar este vault')}</label>
                          <p className="mt-0.5 text-xs text-neutral-500">{t('Detiene o reanuda los envíos sin borrar la configuración.')}</p>
                        </div>
                        <input type="checkbox" checked={settings.nodusServerEnabled} onChange={(event) => void patch({ nodusServerEnabled: event.target.checked })} />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Mantener actualizado en segundo plano')}</label>
                          <p className="mt-0.5 text-xs text-neutral-500">{t('Comprueba un contador ligero cada 30 segundos y solo publica tras cambios y un minuto de reposo.')}</p>
                        </div>
                        <input type="checkbox" checked={settings.nodusServerAutoSync} onChange={(event) => void patch({ nodusServerAutoSync: event.target.checked })} />
                      </div>

                      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
                        <h3 className="text-sm font-medium">{t('Qué se publica')}</h3>
                        <p className="mt-1 text-xs text-neutral-500">
                          {t('Siempre: referencias, autores, temas, ideas, evidencias, conexiones y preguntas. Nunca: archivos PDF, audio, claves API, contraseñas, rutas locales, listas de alumnos, grupos, calificaciones, asistencia, resultados de evaluación ni la base SQLite original.')}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Incluir contenido creado por mí')}</label>
                          <p className="mt-0.5 text-xs text-neutral-500">{t('Incluye notas, proyectos, borradores y contenido de docencia o estudio.')}</p>
                        </div>
                        <input type="checkbox" checked={settings.nodusServerIncludeUserContent} onChange={(event) => void patch({ nodusServerIncludeUserContent: event.target.checked })} />
                      </div>
                      {conn.vaultType === 'primary_sources' && (
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Publicar fuentes primarias revisadas')}</label>
                            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{t('Incluye metadatos, extractos y análisis; nunca archivos originales, rutas locales ni datos privados.')}</p>
                          </div>
                          <input type="checkbox" checked={settings.nodusServerIncludePrimarySources} onChange={(event) => void patch({ nodusServerIncludePrimarySources: event.target.checked })} />
                        </div>
                      )}
                      {conn.vaultType === 'testimonios' && (
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Publicar testimonios textuales')}</label>
                            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{t('Incluye entrevistas, transcripciones y análisis; participantes, acuerdos y archivos multimedia permanecen privados.')}</p>
                          </div>
                          <input type="checkbox" checked={settings.nodusServerIncludeTestimonies} onChange={(event) => void patch({ nodusServerIncludeTestimonies: event.target.checked })} />
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Incluir pasajes extraídos')}</label>
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{t('Puede incluir texto protegido por derechos de autor. Actívalo solo si tienes permiso para compartirlo.')}</p>
                        </div>
                        <input type="checkbox" checked={settings.nodusServerIncludePassages} onChange={(event) => void patch({ nodusServerIncludePassages: event.target.checked })} />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Publicar biblioteca y documentos')}</label>
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{t('Publica el catálogo global completo, el Clean Markdown y sus figuras para leerlos sin conexión en Nodus Mobile. Los documentos originales nunca se envían.')}</p>
                        </div>
                        <input type="checkbox" checked={settings.nodusServerIncludeLibraryDocuments} onChange={(event) => void patch({ nodusServerIncludeLibraryDocuments: event.target.checked })} />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Incluir vectores semánticos')}</label>
                          <p className="mt-0.5 text-xs text-neutral-500">{t('Permite buscar por significado desde el móvil o una réplica. Sin ellos solo se puede buscar por texto literal. Se derivan de ideas que ya viajan y no se pueden revertir al texto original.')}</p>
                          <p className="mt-0.5 text-xs text-neutral-500">{t('Incluye las representaciones auditadas de documentos; los vectores de pasajes solo viajan si también compartes los pasajes.')}</p>
                        </div>
                        <input type="checkbox" checked={settings.nodusServerIncludeVectors} onChange={(event) => void patch({ nodusServerIncludeVectors: event.target.checked })} />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
                      {t('Cámbiate a este vault para editar su idioma y qué se publica.')}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-xs text-neutral-500">
                {t('Los estudiantes e investigadores inician sesión por OAuth desde ChatGPT o Claude; solo ven los espacios que el administrador les haya asignado.')}
              </p>
            </div>
          )}

          {serverMode === 'advanced' && !nodusServerOverview.activeVault.connected && (
            <div className="space-y-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div>
                <h3 className="text-sm font-medium">{nodusServerOverview.connections.length > 0 ? t('Conectar también este vault') : t('Conectar este vault')}</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  {t('Entra en la administración web del servidor, crea un espacio y genera un código de conexión de un solo uso.')}
                </p>
              </div>
              <Row label={t('Dirección del servidor')}>
                <input
                  className="input w-full sm:w-96"
                  type="url"
                  value={nodusServerUrlInput}
                  onChange={(event) => setNodusServerUrlInput(event.target.value)}
                  placeholder="https://nodus.ejemplo.es"
                  autoComplete="url"
                />
              </Row>
              <Row label={t('Código temporal')}>
                <input
                  className="input w-52 font-mono uppercase tracking-wider"
                  value={nodusServerPairCode}
                  onChange={(event) => setNodusServerPairCode(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && nodusServerUrlInput.trim() && nodusServerPairCode.trim()) void pairWithNodusServer();
                  }}
                  placeholder="ABCD-EFGH"
                  autoComplete="one-time-code"
                />
              </Row>
              <button
                className="btn btn-primary"
                disabled={nodusServerBusy || !nodusServerUrlInput.trim() || !nodusServerPairCode.trim()}
                onClick={() => void pairWithNodusServer()}
              >
                <Icon name={nodusServerBusy ? 'sync' : 'link'} className={nodusServerBusy ? 'animate-spin' : ''} />
                {nodusServerBusy ? t('Conectando…') : t('Conectar vault')}
              </button>
            </div>
          )}

          {nodusServerMessage && (
            <p className={`text-xs ${nodusServerOverview.connections.some((c) => c.phase === 'error') ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
              {nodusServerMessage}
            </p>
          )}

          {serverMode === 'advanced' && <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/50 dark:text-neutral-400">
            <strong className="text-neutral-800 dark:text-neutral-200">{t('Instalación del servidor')}:</strong>{' '}
            {t('se ejecuta con Docker en otro equipo o VPS. Puede usar el Caddy incluido o tu Caddy/Nginx existente con un dominio o subdominio y HTTPS. La configuración inicial y la gestión de usuarios se hacen desde el navegador.')}
          </div>}
          </>
          )}
        </Section>
      )}

      {visibleSettingsSection('integrations', 'Copiloto de escritura Word', 'word copilot addin certificado token localhost') && (
          <Section title={`${t('Copiloto de escritura (Word)')} · beta`}>
            <p className="text-xs text-neutral-500">
              {t('1) Genera el certificado local · 2) Activa el copiloto · 3) Instálalo en Word y ábrelo desde la pestaña Nodus.')}
            </p>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-300">{t('Activar Nodus Copilot para Word')}</label>
              <input type="checkbox" checked={settings.copilotEnabled} onChange={(e) => void patch({ copilotEnabled: e.target.checked })} />
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs">
              {copilotStatus.running ? (
                <span className="text-emerald-400">{t('Activo')}: {copilotStatus.addinUrl}</span>
              ) : copilotStatus.error ? (
                <span className="text-red-400">{t('Error')}: {copilotStatus.error}</span>
              ) : (
                <span className="text-neutral-500">{t('Apagado')}</span>
              )}
              {zoteroStatus.compatibilityWarning && <p role="status" className="mt-2 text-amber-300">{t(zoteroStatus.compatibilityWarning)}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-ghost border border-neutral-700"
                disabled={copilotBusy}
                onClick={async () => {
                  setCopilotBusy(true);
                  try {
                    const r = await window.nodus.ensureCopilotCert();
                    flash(r.message);
                  } finally {
                    setCopilotBusy(false);
                  }
                }}
              >
                <Icon name={copilotStatus.certReady ? 'check' : 'lock'} /> {copilotStatus.certReady ? t('Certificado listo') : t('Generar certificado')}
              </button>
              <button
                className="btn btn-primary"
                disabled={copilotInstallBusy}
                onClick={async () => {
                  setCopilotInstallBusy(true);
                  setCopilotInstallMessage(null);
                  try {
                    const result = await window.nodus.installCopilotAddin();
                    setCopilotInstallMessage(result.message);
                    flash(result.message);
                  } finally {
                    setCopilotInstallBusy(false);
                  }
                }}
              >
                <Icon name={copilotInstallBusy ? 'sync' : 'download'} className={copilotInstallBusy ? 'animate-spin' : ''} />
                {copilotInstallBusy ? t('Instalando…') : t('Instalar/actualizar en Word')}
              </button>
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.regenerateCopilotToken().then(() => flash(t('Token del copiloto regenerado.')))}>
                <Icon name="refresh" /> {t('Regenerar token')}
              </button>
            </div>
            {copilotInstallMessage && <p className="text-xs text-emerald-400">{copilotInstallMessage}</p>}
            <p className="text-xs text-neutral-500">
              {t('Sirve Nodus Copilot en https://localhost, busca ideas del corpus, muestra conexiones y permite insertar una idea con la IA configurada en Nodus.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('integrations', 'Nodus para Zotero', 'zotero plugin sidebar chat servidor puerto token pagina citas conexiones') && (
          <Section title={`${t('Nodus para Zotero')} · beta`}>
            <p className="text-xs text-neutral-500">
              {t('Chat de Nodus dentro de Zotero: pregunta sobre el ítem abierto con el contexto de tu biblioteca (resumen, ideas, conexiones). Instala el plugin en Zotero; se conecta a Nodus automáticamente.')}
            </p>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-300">{t('Activar el servidor de Nodus para Zotero')}</label>
              <input type="checkbox" checked={settings.zoteroPluginEnabled} onChange={(e) => void patch({ zoteroPluginEnabled: e.target.checked })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-300">{t('Puerto')}</label>
              <input
                type="number"
                className="input w-28"
                defaultValue={settings.zoteroPluginPort}
                onBlur={(e) => {
                  const p = Math.min(65535, Math.max(1024, Number(e.target.value) || 4321));
                  if (p !== settings.zoteroPluginPort) void patch({ zoteroPluginPort: p });
                }}
              />
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs">
              {zoteroStatus.running ? (
                <span className="text-emerald-400">{t('Activo')}: {zoteroStatus.url}</span>
              ) : zoteroStatus.error ? (
                <span className="text-red-400">{t('Error')}: {zoteroStatus.error}</span>
              ) : (
                <span className="text-neutral-500">{t('Apagado')}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={zoteroInstallBusy}
                onClick={async () => {
                  setZoteroInstallBusy(true);
                  try {
                    const r = await window.nodus.downloadZoteroPluginXpi();
                    if (r.ok && r.path) flash(`${t('XPI verificado guardado en:')} ${r.path}. ${t('En Zotero: Herramientas → Complementos → ⚙ → Instalar complemento desde archivo.')}`);
                    else if (r.message) flash(r.message);
                  } finally {
                    setZoteroInstallBusy(false);
                  }
                }}
              >
                <Icon name={zoteroInstallBusy ? 'sync' : 'download'} className={zoteroInstallBusy ? 'animate-spin' : ''} />
                {zoteroInstallBusy ? t('Guardando…') : t('Guardar .xpi para Zotero')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => void window.nodus.openExternal(NODUS_ZOTERO_INSTALL_URL)}
              >
                <Icon name="external" /> {t('Ver instrucciones de instalación')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => void navigator.clipboard.writeText(settings.zoteroPluginToken).then(() => flash(t('Token copiado.')))}
              >
                <Icon name="copy" /> {t('Copiar token')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => void window.nodus.regenerateZoteroPluginToken().then(() => flash(t('Token regenerado.')))}
              >
                <Icon name="refresh" /> {t('Regenerar token')}
              </button>
            </div>
          </Section>
      )}

      {visibleSettingsSection('integrations', 'Nodus Research Connector', 'chrome navegador browser extension conector captura metadatos colecciones etiquetas pdf doi isbn') && (
          <Section title={t('Nodus Research Connector')}>
            <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400">
              {t('Guarda la página o documento abierto en la Biblioteca de Nodus con metadatos, archivos, colección y etiquetas. Solo lee la pestaña cuando pulsas el icono.')}
            </p>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Activar Nodus Research Connector')}</label>
              <input type="checkbox" checked={settings.browserConnectorEnabled} onChange={(event) => void patch({ browserConnectorEnabled: event.target.checked })} />
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-950/50">
              {settings.browserConnectorEnabled && zoteroStatus.running ? (
                <span className="text-emerald-700 dark:text-emerald-400">{t('Listo para emparejar')}: {zoteroStatus.url}</span>
              ) : zoteroStatus.error ? (
                <span className="text-red-700 dark:text-red-400">{t('Error')}: {zoteroStatus.error}</span>
              ) : (
                <span className="text-neutral-600 dark:text-neutral-500">{t('Actívalo y deja Nodus abierto mientras guardas desde Chrome.')}</span>
              )}
            </div>
            <div
              data-testid="browser-connector-store-install"
              className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/70 dark:bg-blue-950/20"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-blue-200 bg-white shadow-sm dark:border-blue-900/70 dark:bg-neutral-950">
                  <img src={chromeWebStoreLogo} alt="" className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Chrome Web Store</p>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                      {t('Recomendado')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                    {t('Instalación sencilla y actualizaciones automáticas.')}
                  </p>
                </div>
                <button
                  data-testid="browser-connector-install-store"
                  className="btn btn-primary shrink-0"
                  onClick={() => void window.nodus.openExternal(CHROME_WEB_STORE_URL)}
                >
                  <Icon name="external" /> {t('Instalar desde Chrome Web Store')}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                data-testid="browser-connector-download-zip"
                className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
                disabled={browserConnectorBusy}
                onClick={async () => {
                  setBrowserConnectorBusy(true);
                  try {
                    const result = await window.nodus.downloadBrowserConnectorZip();
                    if (result.ok && result.path) flash(`${t('Extensión guardada en:')} ${result.path}`);
                    else if (result.message) flash(result.message);
                  } finally {
                    setBrowserConnectorBusy(false);
                  }
                }}
              >
                <Icon name={browserConnectorBusy ? 'sync' : 'download'} className={browserConnectorBusy ? 'animate-spin' : ''} />
                {browserConnectorBusy ? t('Preparando…') : t('Descargar ZIP')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
                onClick={async () => {
                  await window.nodus.regenerateBrowserConnectorToken();
                  flash(t('Se ha revocado el acceso de los navegadores emparejados.'));
                }}
              >
                <Icon name="refresh" /> {t('Revocar navegadores emparejados')}
              </button>
            </div>
            <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-500">
              {t('Alternativa manual para desarrollo o pruebas. Descomprime el ZIP y cárgalo desde chrome://extensions.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('integrations', 'Copiloto de escritura LibreOffice', 'libreoffice copilot macro python install instalacion instalando') && (
          <Section title={t('Copiloto de escritura (LibreOffice)')}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={libreOfficeInstallBusy}
                onClick={async () => {
                  setLibreOfficeInstallBusy(true);
                  setLibreOfficeInstallMessage(null);
                  try {
                    const result = await window.nodus.installLibreOfficeCopilot();
                    setLibreOfficeInstallMessage(result.message);
                    flash(result.message);
                  } catch (err: any) {
                    setLibreOfficeInstallMessage(err.message || String(err));
                    flash(err.message || String(err));
                  } finally {
                    setLibreOfficeInstallBusy(false);
                  }
                }}
              >
                <Icon name={libreOfficeInstallBusy ? 'sync' : 'download'} className={libreOfficeInstallBusy ? 'animate-spin' : ''} />
                {libreOfficeInstallBusy ? t('Instalando…') : t('Instalar macro en LibreOffice')}
              </button>
            </div>
            {libreOfficeInstallMessage && <p className="text-xs text-emerald-400">{libreOfficeInstallMessage}</p>}
            <p className="text-xs text-neutral-500">
              {t('Copia el macro nodus_copilot.py en la carpeta de macros de LibreOffice. Para usarlo en LibreOffice Writer, ve a Herramientas -> Macros -> Ejecutar macro -> Mis macros -> nodus_copilot -> start_nodus_copilot.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('data', 'Backup / copia de seguridad', 'datos demo exportar importar copia backup cifrada contraseña') && (
          <Section title={t('Backup / copia de seguridad')}>
            {settings.demoMode && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/20">
                <div>
                  <label className="text-sm text-amber-700 dark:text-amber-300">{t('Modo demo activo')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Estás viendo un corpus de ejemplo. Sal del modo demo para empezar con tu propia biblioteca.')}
                  </p>
                </div>
                <button
                  className="btn border border-amber-300 text-amber-700 hover:bg-amber-100 shrink-0 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/50"
                  onClick={async () => {
                    await window.nodus.clearDemoData();
                    await onChange();
                    flash(t('Datos de demostración eliminados.'));
                  }}
                >
                  <Icon name="trash" /> {t('Salir del modo demo')}
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost border border-neutral-700" onClick={exportBackup}>
                <Icon name="download" /> {t('Exportar (.nodus)')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => {
                  setImportPassword('');
                  setImportOpen(true);
                }}
              >
                <Icon name="upload" /> {t('Importar (.nodus)')}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              {t('La copia incluye todos los datos de Nodus: textos extraídos, embeddings de ideas, resúmenes y pasajes, modelos seleccionados, grafo, ajustes y claves API, dentro de un archivo cifrado.')}
            </p>
            <div className="mt-2 border-t border-neutral-800 pt-3">
              <label className="text-sm">{t('Sincronización entre equipos')}</label>
              <SyncPassphrase onChange={setSyncHasPassphrase} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="btn btn-ghost border border-neutral-700"
                  disabled={!syncHasPassphrase}
                  title={syncHasPassphrase ? undefined : t('Configura primero una frase de sincronización.')}
                  onClick={async () => {
                    try {
                      const result = await window.nodus.exportSyncPackage();
                      if (result) flash(`${t('Exportado')}: ${result.path}`);
                    } catch (e) {
                      flash(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <Icon name="download" /> {t('Exportar paquete de sync (.nodussync)')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={async () => {
                    try {
                      const summary = await window.nodus.importSyncPackage(importSyncPassphrase.trim() || undefined);
                      if (!summary) return;
                      setImportSyncPassphrase('');
                      const applied = Object.values(summary.groups).reduce((sum, c) => sum + c.inserted + c.updated, 0);
                      // Anything that did NOT apply is stated outright. A bare success
                      // count let users believe a module had travelled when it had not.
                      const notApplied = summary.conflicts.reduce((sum, c) => sum + c.rows, 0);
                      const parts = [`${t('Sincronización fusionada')}: ${applied} ${t('cambios aplicados (nada local se ha borrado).')}`];
                      if (notApplied > 0) {
                        parts.push(`${notApplied} ${t('fila(s) no se pudieron aplicar:')} ${[...new Set(summary.conflicts.map((c) => c.table))].join(', ')}.`);
                      }
                      if (summary.unknownTables.length > 0) {
                        parts.push(`${t('Datos no reconocidos por esta versión:')} ${summary.unknownTables.join(', ')}.`);
                      }
                      if (summary.deletionsApplied > 0) {
                        parts.push(`${summary.deletionsApplied} ${t('elemento(s) borrado(s) en el otro equipo se han eliminado aquí.')}`);
                      }
                      if (summary.supersededKept > 0) {
                        parts.push(`${summary.supersededKept} ${t('versión(es) sustituida(s) se han conservado y puedes recuperarlas abajo.')}`);
                      }
                      if (summary.predatesTombstoneHorizon) {
                        parts.push(t('Aviso: el paquete es muy antiguo, así que algunos elementos borrados pueden haber reaparecido.'));
                      }
                      if (summary.clockSkewAheadMs > 60_000) {
                        // Only the "sender ahead" direction is detectable, and it is the
                        // one that silently wins every conflict.
                        parts.push(
                          `${t('Aviso: el reloj del otro equipo va adelantado unos')} ${Math.round(summary.clockSkewAheadMs / 60_000)} ${t('minuto(s), así que sus versiones ganan siempre. Revisa la hora en ese equipo.')}`
                        );
                      }
                      setSupersededReloadKey((key) => key + 1);
                      flash(parts.join(' '));
                    } catch (e) {
                      const message = e instanceof Error ? e.message : String(e);
                      // A package from a machine set up separately needs ITS passphrase,
                      // not this one's; ask instead of leaving the user stuck.
                      if (/frase|descifrar|cifrado/i.test(message)) setImportSyncPromptOpen(true);
                      flash(message);
                    }
                  }}
                >
                  <Icon name="upload" /> {t('Importar paquete de sync (.nodussync)')}
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {t('Lleva tus notas, datos de estudio, materiales y grabaciones, borradores, búsquedas guardadas, auditorías de relaciones y bases de datos a otro equipo. Al importar se fusiona: gana la versión más reciente y los borrados se propagan, pero todo lo sustituido o eliminado se conserva y puedes recuperarlo.')}{' '}
                {t('Las Copias protegidas también viajan y conservan su borrado lógico.')}
              </p>
              {importSyncPromptOpen && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    className="input w-72"
                    placeholder={t('Frase de sincronización del equipo que generó el paquete')}
                    value={importSyncPassphrase}
                    onChange={(event) => setImportSyncPassphrase(event.target.value)}
                  />
                  <span className="text-xs text-neutral-500">{t('Vuelve a pulsar Importar con esta frase.')}</span>
                </div>
              )}
              <SupersededVersions reloadKey={supersededReloadKey} />
            </div>
            <div className="mt-2 border-t border-neutral-800 pt-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm">{t('Copias de seguridad automáticas')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Copias cifradas periódicas en una carpeta a tu elección. Cada copia incluye todo Nodus; puedes usar iCloud Drive, Google Drive o Dropbox para mantenerla fuera de este equipo.')}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-indigo-500"
                  checked={settings.autoBackupEnabled}
                  onChange={(e) => void patch({ autoBackupEnabled: e.target.checked })}
                />
              </div>
              {settings.autoBackupEnabled && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-ghost border border-neutral-700"
                      onClick={() => void patch({ recoverySetupVersion: 0 })}
                    >
                      <Icon name="folder" /> {settings.autoBackupFolder ? t('Cambiar carpeta o recuperar') : t('Configurar carpeta segura')}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-400" title={settings.autoBackupFolder}>
                      {settings.autoBackupFolder || t('Sin carpeta elegida')}
                    </span>
                  </div>

                  <div data-testid="automatic-backup-scope" className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/15 dark:text-emerald-200">
                    <Icon name="lock" className="mt-0.5 shrink-0" />
                    <div><span className="font-medium">{t('Cada copia protege todo Nodus automáticamente.')}</span><p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-400">{t('Incluye todas las bóvedas, documentos, preferencias, historiales, archivos generados y claves API. No existen exclusiones configurables.')}</p></div>
                  </div>

                  {/* Schedule: which day(s) of the week + at what time. If the machine
                      was off at the scheduled time, the backup runs at the next launch. */}
                  <div className="space-y-2 rounded-md border border-neutral-800 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-neutral-500">{t('Días')}</span>
                      {[
                        { d: 1, label: t('L') },
                        { d: 2, label: t('M') },
                        { d: 3, label: t('X') },
                        { d: 4, label: t('J') },
                        { d: 5, label: t('V') },
                        { d: 6, label: t('S') },
                        { d: 0, label: t('D') },
                      ].map(({ d, label }) => {
                        const days = settings.autoBackupDays ?? [];
                        const on = days.length === 0 || days.includes(d);
                        return (
                          <button
                            key={d}
                            className={`h-7 w-7 rounded-md border text-xs ${on ? 'border-indigo-600 bg-indigo-600/25 text-indigo-200' : 'border-neutral-700 text-neutral-500'}`}
                            title={on ? t('Activo') : t('Inactivo')}
                            onClick={() => {
                              // From "every day" (empty), first click selects a single explicit day.
                              const base = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : [...days];
                              const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d];
                              void patch({ autoBackupDays: next.length === 7 ? [] : next.sort((a, b) => a - b) });
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {(settings.autoBackupDays ?? []).length === 0 && (
                        <span className="text-[11px] text-neutral-500">{t('todos los días')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500">{t('Hora')}</span>
                      <input
                        type="time"
                        className="input w-auto text-xs"
                        value={`${String(settings.autoBackupHour ?? 3).padStart(2, '0')}:${String(settings.autoBackupMinute ?? 0).padStart(2, '0')}`}
                        onChange={(e) => {
                          const [h, m] = e.target.value.split(':').map(Number);
                          if (Number.isFinite(h) && Number.isFinite(m)) void patch({ autoBackupHour: h, autoBackupMinute: m });
                        }}
                      />
                      <span className="text-[11px] text-neutral-500">
                        {t('Si el equipo estaba apagado, la copia se hace al arrancar la app.')}
                      </span>
                    </div>
                  </div>
                  {autoBackupHasPassword ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-emerald-400">{t('Contraseña maestra y clave de recuperación configuradas.')}</span>
                      <button
                        className="btn btn-ghost border border-neutral-700 text-xs"
                        onClick={async () => {
                          const result = await window.nodus.saveBackupRecoveryKit();
                          flash(result.ok ? `${t('Kit de recuperación guardado en')} ${result.message}` : result.message);
                        }}
                      >
                        {t('Guardar kit de recuperación')}
                      </button>
                      <button
                        className="btn btn-ghost border border-neutral-700 text-xs"
                        onClick={async () => {
                          await window.nodus.clearBackupPassword();
                          setAutoBackupHasPassword(false);
                          flash(t('Contraseña maestra eliminada. Las copias automáticas quedan en pausa.'));
                        }}
                      >
                        {t('Cambiar contraseña')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex w-64 flex-col gap-1">
                        <div className="relative">
                          <input
                            type={showAutoBackupPassword ? 'text' : 'password'}
                            className="input w-full pr-10"
                            placeholder={t('Contraseña maestra (mín. 8 caracteres)')}
                            value={autoBackupPasswordInput}
                            onChange={(e) => setAutoBackupPasswordInput(e.target.value)}
                            aria-describedby="settings-backup-password-requirement"
                            aria-invalid={autoBackupPasswordInput.length > 0 && !validateBackupPassword(autoBackupPasswordInput).valid}
                          />
                          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-100" onClick={() => setShowAutoBackupPassword((value) => !value)} aria-label={t(showAutoBackupPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')} title={t(showAutoBackupPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}><Icon name={showAutoBackupPassword ? 'eyeOff' : 'eye'} size={17} /></button>
                        </div>
                        <small id="settings-backup-password-requirement" className={validateBackupPassword(autoBackupPasswordInput).valid ? 'text-emerald-400' : autoBackupPasswordInput.length > 0 ? 'text-red-400' : 'text-neutral-500'}>
                          {validateBackupPassword(autoBackupPasswordInput).valid
                            ? t('La contraseña cumple el mínimo de 8 caracteres.')
                            : t('La contraseña debe tener al menos 8 caracteres. Los números y símbolos son opcionales.')}
                        </small>
                      </div>
                      <button
                        className="btn btn-ghost border border-neutral-700"
                        onClick={async () => {
                          try {
                            await window.nodus.setBackupPassword(autoBackupPasswordInput);
                            setAutoBackupPasswordInput('');
                            setAutoBackupHasPassword(true);
                            flash(t('Contraseña maestra guardada. Descarga el kit: permite recuperar incluso si olvidas la contraseña.'));
                          } catch (e) {
                            flash(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        {t('Guardar contraseña')}
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-ghost border border-neutral-700"
                      disabled={autoBackupRunning || !settings.autoBackupFolder || !autoBackupHasPassword}
                      onClick={async () => {
                        setAutoBackupRunning(true);
                        try {
                          const result = await window.nodus.runBackupNow();
                          flash(result.message);
                          await onChange();
                        } finally {
                          setAutoBackupRunning(false);
                        }
                      }}
                    >
                      <Icon name="download" /> {autoBackupRunning ? t('Copiando…') : t('Hacer copia ahora')}
                    </button>
                  </div>
                  {recoveryHealth && (
                    <div data-testid="backup-health" data-level={recoveryHealth.level} className="backup-health">
                      <div className="backup-health-title">
                        <Icon name={recoveryHealth.level === 'ok' ? 'check' : 'alert'} size={14} />
                        {recoveryHealthHeadline(recoveryHealth)}
                      </div>
                      {recoveryHealthAdvice(recoveryHealth) && (
                        <p className="backup-health-advice">{recoveryHealthAdvice(recoveryHealth)}</p>
                      )}
                      <p className="backup-health-age">
                        {[
                          recoveryHealthAge(recoveryHealth),
                          settings.lastAutoBackupAt ? new Date(settings.lastAutoBackupAt).toLocaleString() : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                      {recoveryHealth.detail && <p className="backup-health-detail">{recoveryHealth.detail}</p>}
                    </div>
                  )}
                </div>
              )}
              <div data-testid="backup-cleanup-setting" className="mt-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/15">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Limpieza automática de copias antiguas')}</label>
                    <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                      {t('Usa el mismo día y hora que las copias automáticas. Si Nodus estaba cerrado, la limpieza pendiente se ejecuta al volver a abrirlo.')}
                    </p>
                  </div>
                  <input
                    data-testid="toggle-backup-cleanup"
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-amber-600"
                    checked={settings.backupCleanupEnabled}
                    disabled={backupCleanupRunning || !settings.autoBackupFolder || !autoBackupHasPassword || !backupCleanupPreview?.ok || !backupCleanupPreview.scopeToken}
                    onChange={(event) => {
                      if (event.target.checked) setConfirmBackupCleanupEnable(true);
                      else void patch({ backupCleanupEnabled: false });
                    }}
                  />
                </div>

                {(!settings.autoBackupFolder || !autoBackupHasPassword) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300/70 bg-white/60 p-2.5 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-neutral-950/30 dark:text-amber-200">
                    <Icon name="alert" size={14} />
                    <span>{t('Configura primero la carpeta de Recuperación y la contraseña maestra para poder verificar una copia superviviente.')}</span>
                    <button className="btn btn-ghost ml-auto text-xs" onClick={() => void patch({ recoverySetupVersion: 0 })}>
                      <Icon name="folder" /> {t('Configurar Recuperación')}
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">{t('Mover copias con más de')}</span>
                  <input
                    data-testid="backup-retention-value"
                    type="number"
                    min={1}
                    max={backupRetentionLimit(settings.backupRetentionUnit)}
                    className="input w-24 text-sm"
                    value={settings.backupRetentionValue}
                    disabled={backupCleanupRunning || settings.backupCleanupEnabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      const limit = backupRetentionLimit(settings.backupRetentionUnit);
                      if (Number.isInteger(value) && value >= 1 && value <= limit) void patch({ backupRetentionValue: value });
                    }}
                  />
                  <select
                    data-testid="backup-retention-unit"
                    className="input w-36 text-sm"
                    value={settings.backupRetentionUnit}
                    disabled={backupCleanupRunning || settings.backupCleanupEnabled}
                    onChange={(event) => {
                      const unit = event.target.value as BackupRetentionUnit;
                      void patch({
                        backupRetentionUnit: unit,
                        backupRetentionValue: Math.min(settings.backupRetentionValue, backupRetentionLimit(unit)),
                      });
                    }}
                  >
                    <option value="days">{t('días')}</option>
                    <option value="weeks">{t('semanas')}</option>
                    <option value="months">{t('meses')}</option>
                    <option value="years">{t('años')}</option>
                  </select>
                </div>

                {settings.backupCleanupEnabled && (
                  <p className="text-[11px] text-neutral-500">
                    {t('Para cambiar la antigüedad, desactiva primero la limpieza y vuelve a activarla para confirmar el nuevo alcance.')}
                  </p>
                )}

                {backupCleanupPreview && (
                  <div data-testid="backup-cleanup-preview" data-ok={backupCleanupPreview.ok ? 'true' : 'false'} className="rounded-md border border-neutral-200 bg-white/70 p-3 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/30 dark:text-neutral-300">
                    {backupCleanupPreview.ok ? (
                      <p>{tx('{count} copia(s), {size}, supera(n) ahora la antigüedad configurada.', {
                        count: backupCleanupPreview.candidateCount,
                        size: formatBackupBytes(backupCleanupPreview.candidateBytes),
                      })}</p>
                    ) : <p>{errorText(backupCleanupPreview.message)}</p>}
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {t('Siempre se conservan al menos las tres copias normales más recientes. Las copias de otros equipos y los snapshots pre-update nunca entran en esta limpieza.')}
                    </p>
                    {backupCleanupPreview.trashCount > 0 && (
                      <p className="mt-1 text-[11px] text-neutral-500">
                        {tx('{count} copia(s) permanece(n) en la papelera de seguridad.', { count: backupCleanupPreview.trashCount })}
                      </p>
                    )}
                    {backupCleanupPreview.purgeReadyCount > 0 && (
                      <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                        {tx('{count} copia(s) ({size}) ya cumplió/cumplieron siete días en la papelera de seguridad y se eliminará(n) definitivamente en esta limpieza.', {
                          count: backupCleanupPreview.purgeReadyCount,
                          size: formatBackupBytes(backupCleanupPreview.purgeReadyBytes),
                        })}
                      </p>
                    )}
                  </div>
                )}

                <p className="text-[11px] leading-5 text-neutral-500">
                  {t('Las copias seleccionadas se mueven primero a una papelera privada dentro de la carpeta de Recuperación. Solo se eliminan definitivamente después de siete días y tras verificar otra copia válida.')}
                </p>
                <p className="text-[11px] leading-5 text-neutral-500">
                  {t('Al activar esta opción, el límite de antigüedad sustituye la rotación compacta anterior para las nuevas copias de este equipo.')}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-ghost border border-amber-400 text-xs dark:border-amber-800"
                    disabled={backupCleanupRunning || !settings.autoBackupFolder || !autoBackupHasPassword || !backupCleanupPreview?.ok || !backupCleanupPreview.scopeToken}
                    onClick={() => setConfirmBackupCleanupNow(true)}
                  >
                    <Icon name="trash" /> {backupCleanupRunning ? t('Limpiando…') : t('Revisar y limpiar ahora')}
                  </button>
                  {settings.lastBackupCleanupAt && (
                    <span className="text-[11px] text-neutral-500">
                      {t('Última limpieza')}: {new Date(settings.lastBackupCleanupAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {settings.lastBackupCleanupStatus?.startsWith('error:') && (
                  <p className="text-xs text-rose-600 dark:text-rose-300">{errorText(settings.lastBackupCleanupStatus.slice('error:'.length).trim())}</p>
                )}
              </div>
              {migrationRecoverySnapshots.length > 0 && (
                <div data-testid="migration-recovery-snapshots" className="mt-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/15">
                  <div className="flex items-start gap-3">
                    <Icon name="shield" className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-300" />
                    <div>
                      <label className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Copias previas a migraciones')}</label>
                      <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                        {t('Antes de cambiar el esquema, Nodus conserva una copia inmutable y verificada. Puedes abrirla como un vault separado sin sustituir el actual.')}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {migrationRecoverySnapshots.map((snapshot) => (
                      <div key={snapshot.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-white/80 p-3 dark:border-indigo-900/70 dark:bg-neutral-950/40">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                            v{snapshot.fromVersion} → v{snapshot.targetVersion} · {new Date(snapshot.createdAt).toLocaleString()}
                          </p>
                          <p className="mt-1 truncate font-mono text-[10px] text-neutral-500" title={snapshot.sha256}>
                            SHA-256 {snapshot.sha256} · {formatBackupBytes(snapshot.bytes)} · quick_check {snapshot.quickCheck}
                          </p>
                        </div>
                        <button
                          className="btn btn-ghost w-full min-w-0 shrink-0 whitespace-normal border border-indigo-300 text-center text-xs dark:border-indigo-800 sm:w-auto"
                          disabled={migrationRecoveryBusy !== null}
                          onClick={async () => {
                            setMigrationRecoveryBusy(snapshot.id);
                            try {
                              const created = await window.nodus.openMigrationRecoverySnapshot(snapshot.id);
                              await _onVaultsChanged();
                              const switched = await window.nodus.switchVault(created.vault.id);
                              if (!switched.ok) throw new Error(switched.message);
                              flash(t('La copia previa se abrió como un vault separado.'));
                            } catch (error) {
                              flash(error instanceof Error ? error.message : String(error));
                            } finally {
                              setMigrationRecoveryBusy(null);
                            }
                          }}
                        >
                          <Icon name="external" /> {migrationRecoveryBusy === snapshot.id ? t('Abriendo…') : t('Abrir como vault separado')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {activeVault?.type === 'estudio' && <StudyDataAdministration />}
          </Section>
      )}

      {visibleSettingsSection('models', 'Modelos de IA', 'basico avanzado modelo general extraccion sintesis tutor resumen fusion embeddings transcripcion voz imagen quimica chemistry stock mcule proveedores comprar') && (<>
          <Section title={t('Selección de modelos')}>
            <p className="mb-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
              {t('Solo puede haber un modo de configuración activo. Cambiar de modo modifica qué selección de modelos utiliza Nodus, no solo la vista de este formulario.')}
            </p>
            <div className="mb-5 flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-950" data-testid="model-settings-mode">
              {(['basic', 'advanced'] as const).map((mode) => <button
                key={mode}
                className={`flex-1 rounded-md px-3 py-2 text-sm ${settings.modelSettingsMode === mode ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'}`}
                aria-pressed={settings.modelSettingsMode === mode}
                onClick={() => {
                  if (settings.modelSettingsMode !== mode) setPendingModelSettingsMode(mode);
                }}
              >{t(mode === 'basic' ? 'Configuración básica' : 'Configuración avanzada')}</button>)}
            </div>
            <p className="mb-4 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
              {settings.modelSettingsMode === 'basic'
                ? t('Un modelo general atiende conversación, análisis, resúmenes y las demás tareas de texto. Las capacidades especializadas se configuran debajo.')
                : t('Cada tarea utiliza el modelo concreto seleccionado. Los modelos de las herramientas se guardan solo en el vault actual.')}
            </p>
            {settings.modelSettingsMode === 'basic' && <>
              <Row label={t('Modelo general de texto')} hint={t('Conversación, análisis, resúmenes y demás tareas de texto.')}>
                <GeneralTextModelControl settings={settings} patch={patch} />
              </Row>
              {/* In basic mode this one model runs the scans too, so it is the single
                  most expensive place to pick a subscription-billed provider — and it must be able
                  to extract ideas, so vision-only local models are blocked here. */}
              <ExtractionCapabilityNotice model={settings.synthesisModel} />
              <SubscriptionQuotaNotice model={settings.synthesisModel} />
            </>}
            <Row
              label={t('Modelo de embeddings (similitud semántica multilingüe)')}
              hint={t('Representa el significado del texto para la búsqueda semántica y la recuperación por similitud.')}
            >
              <EmbeddingModelControl
                settings={settings}
                onEmbeddingChange={(provider, model) => setPendingEmbeddingChange({ provider, model })}
              />
            </Row>
            {activeVault?.type === 'estudio' && <Row
              label={t('Procesamiento de materiales nuevos con IA')}
              hint={t('Controla si Nodus crea automáticamente conceptos, citas y relaciones para el mapa de Ideas y el grafo de estudio.')}
            >
              <select
                data-testid="study-knowledge-auto-process"
                className="input"
                value={settings.studyKnowledgeAutoProcess}
                onChange={(event) => void patch({ studyKnowledgeAutoProcess: event.target.value as AppSettings['studyKnowledgeAutoProcess'] })}
              >
                <option value="ask">{t('Preguntar cada vez')}</option>
                <option value="always">{t('Procesar automáticamente')}</option>
                <option value="never">{t('No procesar automáticamente')}</option>
              </select>
            </Row>}
            {settings.modelSettingsMode === 'advanced' && <>
              <div className="mt-5 space-y-3 border-t border-neutral-800 pt-4" data-testid="common-model-overrides">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Ajustes avanzados comunes')}</h3>
                {/* The four selectors below drive the scan pipeline: one run covers a
                    whole corpus, so a subscription plan's quota is the real limit. */}
                <Row label={t('Extracción de temas, ideas y evidencias')} hint={t('Extrae temas, ideas, evidencias y relaciones cuando Nodus analiza el corpus.')}><ModelWithReasoning allowEmpty={false} settings={settings} value={settings.extractionModel} onChange={(extractionModel) => void patch({ extractionModel })} emptyLabel="Seleccionar modelo" requireExtraction menu /></Row>
                <ExtractionCapabilityNotice model={settings.extractionModel} />
                <SubscriptionQuotaNotice model={settings.extractionModel} />
                <Row label={t('Visión y OCR de imágenes')} hint={t('Interpreta imágenes y páginas escaneadas y obtiene su texto cuando hace falta.')}><ModelWithReasoning allowEmpty={false} settings={settings} value={settings.visionModel} onChange={(visionModel) => void patch({ visionModel })} emptyLabel="Seleccionar modelo" menu /></Row>
                <SubscriptionQuotaNotice model={settings.visionModel} />
                <Row label={t('Resúmenes de obras')} hint={t('Redacta resúmenes breves de cada obra para orientar la navegación y la recuperación.')}><ModelWithReasoning allowEmpty={false} settings={settings} value={settings.summaryModel} onChange={(summaryModel) => void patch({ summaryModel })} emptyLabel="Seleccionar modelo" requiredCapability="summary" menu /></Row>
                <SubscriptionQuotaNotice model={settings.summaryModel} />
                {activeVault?.type === 'academic' && <>
                  <Row label={t('Comprensión de documentos completos')} hint={t('Analiza todas las secciones y sintetiza la arquitectura global de cada obra.')}><ModelWithReasoning settings={settings} value={settings.documentProfileModel} onChange={(documentProfileModel) => void patch({ documentProfileModel })} emptyLabel="Usar modelo de resúmenes" requiredCapability="documentProfile" menu /></Row>
                  <ExtractionCapabilityNotice model={settings.documentProfileModel ?? settings.summaryModel} />
                  <SubscriptionQuotaNotice model={settings.documentProfileModel ?? settings.summaryModel} />
                  <Row label={t('Auditor de fichas documentales')} hint={t('Revisa soporte, cobertura y fidelidad antes de publicar una versión nueva.')}><ModelWithReasoning settings={settings} value={settings.documentAuditModel} onChange={(documentAuditModel) => void patch({ documentAuditModel })} emptyLabel="Usar modelo de comprensión documental" requiredCapability="documentProfile" menu /></Row>
                  <SelfAuditNotice generator={settings.documentProfileModel ?? settings.summaryModel} auditor={settings.documentAuditModel} />
                  <SubscriptionQuotaNotice model={settings.documentAuditModel ?? settings.documentProfileModel ?? settings.summaryModel} />
                </>}
                <Row label={t('Fusión y deduplicación')} hint={t('Combina resultados equivalentes y elimina duplicados sin perder su evidencia.')}><ModelWithReasoning allowEmpty={false} settings={settings} value={settings.fusionModel} onChange={(fusionModel) => void patch({ fusionModel })} emptyLabel="Seleccionar modelo" requiredCapability="fusion" menu /></Row>
                <ExtractionCapabilityNotice model={settings.fusionModel} />
                <SubscriptionQuotaNotice model={settings.fusionModel} />
                <Row label={t('Relaciones semánticas')} hint={t('Valida pares de ideas y genera las relaciones del grafo.')}><ModelWithReasoning allowEmpty settings={settings} value={settings.relationModel} onChange={(relationModel) => void patch({ relationModel })} emptyLabel="Usar modelo de fusión" requiredCapability="fusion" menu /></Row>
                <ExtractionCapabilityNotice model={settings.relationModel ?? settings.fusionModel} />
                <SubscriptionQuotaNotice model={settings.relationModel ?? settings.fusionModel} />
                <Row label={t('Asistente Nodi')} hint={t('Responde en el asistente Nodi y usa el contexto de la vista cuando lo autorizas.')}><ModelWithReasoning allowEmpty={false} settings={settings} value={settings.nodiModel} onChange={(nodiModel) => void patch({ nodiModel })} emptyLabel="Seleccionar modelo" menu /></Row>
              </div>
              <VaultModelOverrides settings={settings} vaultType={activeVault?.type ?? 'academic'} vaultName={activeVault?.name ?? t('Vault actual')} patch={patch} />
            </>}
            {activeVault?.type === 'primary_sources' && primarySourcePolicy && (
              <div className="mt-5 space-y-3 border-t border-neutral-800 pt-4" data-testid="primary-sources-ai-policy">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Política de IA de Fuentes primarias')}</h3>
                <p className="text-xs leading-5 text-neutral-500">
                  {t('Las fuentes restringidas o embargadas nunca salen del dispositivo. Nodi solo recibe fuentes abiertas y no altamente sensibles; las notas privadas y las propuestas pendientes quedan excluidas.')}
                </p>
                <Row
                  label={t('Confirmar cada envío externo')}
                  hint={t('Si está activo, la indexación externa en segundo plano no enviará documentos. Desactívalo solo si autorizas el procesamiento de fuentes abiertas con el proveedor configurado.')}
                >
                  <input
                    type="checkbox"
                    checked={primarySourcePolicy.requireExternalConfirmation}
                    onChange={(event) => void patchPrimarySourcePolicy({ requireExternalConfirmation: event.target.checked })}
                  />
                </Row>
                <Row
                  label={t('Permitir IA externa con fuentes privadas')}
                  hint={t('Cada fuente privada seguirá necesitando consentimiento explícito. Las fuentes restringidas y embargadas continúan bloqueadas.')}
                >
                  <input
                    type="checkbox"
                    checked={primarySourcePolicy.allowPrivateExternalAi}
                    onChange={(event) => void patchPrimarySourcePolicy({ allowPrivateExternalAi: event.target.checked })}
                  />
                </Row>
                <Row
                  label={t('Permitir IA local con fuentes restringidas')}
                  hint={t('Solo se aplica a modelos que se ejecutan en tu equipo; nunca autoriza un proveedor remoto.')}
                >
                  <input
                    type="checkbox"
                    checked={primarySourcePolicy.allowRestrictedLocalAi}
                    onChange={(event) => void patchPrimarySourcePolicy({ allowRestrictedLocalAi: event.target.checked })}
                  />
                </Row>
              </div>
            )}
            <Row label={t('Indexación de embeddings')} hint={t('Genera los vectores pendientes para que la búsqueda semántica use el modelo actual.')}>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost border border-cyan-800 text-cyan-300"
                  title={t(activeVault?.type === 'primary_sources'
                    ? 'Indexa el texto revisado de las fuentes permitido por la política del vault.'
                    : 'Genera embeddings solo para ideas que aún no los tienen.')}
                  onClick={() => {
                    if (activeVault?.type === 'primary_sources') {
                      void window.nodus.indexArchive().then((result) => {
                        flash(result.indexed > 0
                          ? tx('{n} fuentes indexadas.', { n: result.indexed })
                          : t('No hay fuentes autorizadas pendientes de indexación.'));
                      });
                    } else {
                      void window.nodus.startEmbedding();
                    }
                  }}
                >
                  <Icon name="search" /> {t('Indexar pendientes')}
                </button>
                {activeVault?.type !== 'primary_sources' && <button
                  className="btn btn-ghost border border-cyan-800 text-cyan-300"
                  title={t('Borra todos los embeddings y los regenera desde cero. Útil tras cambiar de modelo.')}
                  onClick={() => setConfirmReindex(true)}
                >
                  <Icon name="search" /> {t('Reindexar todo')}
                </button>}
              </div>
            </Row>
            <Row label={t('Llamadas simultáneas')} hint={t('Automático se adapta por proveedor y modelo; Manual conserva un límite fijo entre 1 y 8.')}>
              <div className="flex items-center gap-2">
                <select
                  className="input"
                  value={settings.aiConcurrencyMode}
                  onChange={(e) => patch({
                    aiConcurrencyMode: e.target.value as AppSettings['aiConcurrencyMode'],
                    aiConcurrencyVersion: 1,
                  })}
                >
                  <option value="automatic">{t('Automático')}</option>
                  <option value="manual">{t('Manual')}</option>
                </select>
                {settings.aiConcurrencyMode === 'manual' && <input
                  type="number"
                  min={1}
                  max={8}
                  className="input w-20"
                  value={settings.concurrency}
                  onChange={(e) => patch({ concurrency: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) })}
                />}
              </div>
            </Row>
            {settings.aiConcurrencyMode === 'automatic' && aiConcurrency.length > 0 && (
              <div className="-mt-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-400">
                {aiConcurrency.map((entry) => {
                  const reason = aiConcurrencyReason(entry);
                  return <div key={`${entry.provider}:${entry.model}`}>
                    {entry.provider} · {entry.model}: {t('Automático')} · {entry.currentLimit}/{entry.maximumLimit} {t('ahora')}
                    {reason ? ` · ${t(reason)}` : ''}
                  </div>;
                })}
              </div>
            )}
            <Row
              label={t('Razonamiento (chat/tutor/escritura)')}
              hint={t('Los escaneos van sin razonamiento para ir más rápido; esto solo afecta a las respuestas conversacionales. En Codex, el nivel que fijes a cada tarea en Modelos manda también en sus escaneos.')}
            >
              <select
                className="input"
                value={settings.chatReasoning}
                onChange={(e) => patch({ chatReasoning: e.target.value as AppSettings['chatReasoning'] })}
              >
                <option value="off">{t('Desactivado (más rápido)')}</option>
                <option value="low">{t('Bajo')}</option>
                <option value="medium">{t('Medio')}</option>
                <option value="high">{t('Alto (más lento)')}</option>
              </select>
            </Row>
            <Row
              label={t('IA y datos del alumnado')}
              hint={t('La IA de Nodus no recibe listados, notas ni respuestas del alumnado y no puede calificar, perfilar ni evaluar estudiantes. Solo puede generar o estructurar contenido docente que no contenga datos del alumnado.')}
            >
              <span data-testid="settings-no-ai-student-evaluation" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                <Icon name="shield" size={12} /> {t('Bloqueado por diseño')}
              </span>
            </Row>
            <Row
              label={t('OpenRouter: priorizar velocidad')}
              hint={t('Enruta hacia el proveedor más rápido disponible. Puede aumentar ligeramente el coste.')}
            >
              <input
                type="checkbox"
                checked={settings.openRouterThroughput}
                onChange={(e) => patch({ openRouterThroughput: e.target.checked })}
              />
            </Row>
            <Row label={t('Email Unpaywall (fallback de texto)')} hint={t('Se usa para recuperar texto académico cuando el documento no está disponible por otras vías.')}>
              <input className="input" value={settings.unpaywallEmail} onChange={(e) => patch({ unpaywallEmail: e.target.value })} />
            </Row>
            <Row label={t('Modo de contexto deep scan')} hint={t('Elige cuánto texto conserva cada análisis profundo antes de dividirlo.')}>
              <select
                className="input"
                value={settings.deepContextMode}
                onChange={(e) => patch({ deepContextMode: e.target.value as AppSettings['deepContextMode'] })}
              >
                <option value="standard">{t('Estándar')}</option>
                <option value="long">{t('Contexto largo')}</option>
              </select>
            </Row>
            <Row label={t('Palabras por fragmento')} hint={t('Define el tamaño de cada fragmento según el modo de contexto seleccionado.')}>
              <input
                type="number"
                min={settings.deepContextMode === 'long' ? 5000 : 500}
                max={settings.deepContextMode === 'long' ? 50000 : 5000}
                step={settings.deepContextMode === 'long' ? 1000 : 100}
                className="input w-28"
                value={activeChunkWords}
                onChange={(e) => patchActiveChunkWords(e.target.value)}
              />
            </Row>
          </Section>
          <LocalAiModelsSettings
            settings={settings}
            patch={patch}
          />
          <SttSettings settings={settings} patch={patch} />
          <LocalImageModelSettings settings={settings} patch={patch} />
          <ImageGenerationSettings settings={settings} onChange={onChange} />
          <AudioGenerationSettings settings={settings} onChange={onChange} />
          <Section title={t('Química (Chemistry Studio)')}>
            <Row
              label={t('Usar listas de stock comerciales')}
              hint={t('La búsqueda de rutas se detiene en los precursores que tus listas de proveedores tienen en stock, y el informe indica qué materiales de partida, o el propio objetivo, se pueden comprar. Desactívalo para planificar rutas sin tener en cuenta lo que se vende. Solo actúa si has importado alguna lista.')}
            >
              <input
                type="checkbox"
                checked={settings.chemistryUseStockLists !== false}
                onChange={(e) => patch({ chemistryUseStockLists: e.target.checked })}
              />
            </Row>
          </Section>
      </>)}

      {visibleSettingsSection('extraction', 'Extracción de texto PDFs grandes', 'pdf texto zotero ocr tesseract paginas idiomas') && (
          <Section title={t('Extracción de texto (PDFs grandes)')}>
            <Row label={t('Reusar texto indexado por Zotero')}>
              <input
                type="checkbox"
                checked={settings.preferZoteroFulltext}
                onChange={(e) => patch({ preferZoteroFulltext: e.target.checked })}
              />
            </Row>
            <Row label={t('OCR para PDFs escaneados')}>
              <input type="checkbox" checked={settings.ocrEnabled} onChange={(e) => patch({ ocrEnabled: e.target.checked })} />
            </Row>
            <Row label={t('Idiomas de OCR (Tesseract)')}>
              <input
                className="input"
                value={settings.ocrLanguages}
                onChange={(e) => patch({ ocrLanguages: e.target.value })}
                placeholder="spa+eng"
              />
            </Row>
            <Row label={t('Máx. páginas a OCR por obra')}>
              <input
                type="number"
                min={1}
                max={2000}
                className="input w-24"
                value={settings.ocrMaxPages}
                onChange={(e) => patch({ ocrMaxPages: parseInt(e.target.value) || 1 })}
              />
            </Row>
            <p className="text-xs text-neutral-500">
              {t('El OCR es local pero descarga los datos de idioma de Tesseract la primera vez. Desactivado por defecto.')}
            </p>
            <Row
              label={t('Simplificar esquemas y figuras en PDFs nuevos')}
              hint={t('Las etiquetas sueltas de esquemas de reacción, figuras y tablas se sustituyen por «[scheme]» y se quitan los encabezados de página. Solo se aplica a obras cuyo texto aún no se ha usado; la elección se conserva para cada obra.')}
            >
              <input
                type="checkbox"
                checked={settings.declutterNewDocuments !== false}
                onChange={(e) => patch({ declutterNewDocuments: e.target.checked })}
              />
            </Row>
          </Section>
      )}

      {activeVault?.type === 'academic' && visibleSettingsSection('data', 'Salud del grafo', GRAPH_HEALTH_KEYWORDS) && (
        <GraphHealthPanel manualMode={settings.academicMode === 'manual'} />
      )}

      {visibleSettingsSection('data', 'Zona de peligro', 'reinicializar grafo borrar ideas temas conexiones autores huecos') && (
          <section className="card p-4 mb-4 border border-red-200 dark:border-red-900/60">
            <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3 dark:text-red-400">{t('Zona de peligro')}</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Reinicializar grafo')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {t('Borra todas las ideas, temas, conexiones, autores y huecos, y deja cada obra sin analizar. La biblioteca y los ajustes se conservan.')}
                </p>
              </div>
              <button className="btn border border-red-300 text-red-700 hover:bg-red-50 shrink-0 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50" onClick={startReset}>
                <Icon name="trash" /> {t('Reinicializar…')}
              </button>
            </div>
          </section>
      )}

      {resetCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => !resetting && setResetCode(null)}>
          <div className="card p-5 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-600 dark:text-red-400">{t('Confirmación final')}</h3>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {t('Esto borrará todo el grafo de forma permanente. Para confirmar, escribe este código:')}
            </p>
            <div className="text-center text-3xl font-mono tracking-[0.5em] text-neutral-900 bg-neutral-100 rounded-lg py-3 select-none dark:text-neutral-100 dark:bg-neutral-950">
              {resetCode}
            </div>
            <input
              autoFocus
              inputMode="numeric"
              maxLength={4}
              className="input w-full text-center text-xl tracking-[0.4em] font-mono"
              placeholder="····"
              value={resetInput}
              onChange={(e) => setResetInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && resetInput === resetCode) void confirmReset();
              }}
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" disabled={resetting} onClick={() => setResetCode(null)}>
                {t('Cancelar')}
              </button>
              <button
                className="btn border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
                disabled={resetInput !== resetCode || resetting}
                onClick={() => void confirmReset()}
              >
                {resetting ? t('Borrando…') : t('Borrar grafo')}
              </button>
            </div>
          </div>
        </div>
      )}

      {saved && <div className="fixed bottom-20 right-6 card px-4 py-2 text-sm text-emerald-400">{saved}</div>}
      {mcpHelpOpen && (
        <McpConnectionModal
          url={mcpStatus.url ?? `http://127.0.0.1:${settings.mcpPort}/mcp`}
          token={settings.mcpToken}
          copied={mcpCopied}
          onCopy={copyMcpValue}
          onSettingsChanged={onChange}
          onClose={() => setMcpHelpOpen(false)}
        />
      )}
      {nodusServerGuideOpen && (
        <NodusServerGuideModal
          onOpenGuide={() => void window.nodus.openExternal(NODUS_SERVER_GUIDE_URL)}
          onClose={() => setNodusServerGuideOpen(false)}
        />
      )}
      {cloudflareDeployOpen && (
        <CloudflareDeployModal
          onClose={() => setCloudflareDeployOpen(false)}
          onComplete={() => { void window.nodus.getNodusServerOverview().then(setNodusServerOverview); }}
        />
      )}
      {backupResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-6" onClick={() => setBackupResult(null)}>
          <div className="card w-full max-w-lg p-5" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-2">{t('Credenciales de recuperación de la copia')}</h2>
            <p className="text-sm text-neutral-400 mb-4">
              {t('Guarda ambas fuera de este dispositivo. Podrás importar la copia con cualquiera de ellas.')}
            </p>
            <div className="mb-1 text-xs font-medium text-neutral-400">{t('Contraseña')}</div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 font-mono text-sm break-all">
              {backupResult.password}
            </div>
            <div className="mb-1 mt-3 text-xs font-medium text-neutral-400">{t('Clave de recuperación')}</div>
            <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-3 font-mono text-sm break-all text-emerald-300">
              {backupResult.recoveryKey}
            </div>
            <div className="mt-2 text-xs text-neutral-500 truncate">{backupResult.path}</div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setBackupResult(null)}>
                {t('Cerrar')}
              </button>
              <button className="btn btn-primary" onClick={() => void copyBackupPassword()}>
                <Icon name={backupCopied ? 'check' : 'copy'} /> {backupCopied ? t('Copiadas') : t('Copiar credenciales')}
              </button>
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-6" onClick={() => setImportOpen(false)}>
          <div className="card w-full max-w-md p-5" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-2">{t('Importar copia cifrada')}</h2>
            <p className="text-sm text-neutral-400 mb-4">
              {t('Introduce la contraseña o la clave de recuperación. Después selecciona el archivo .nodus.')}
            </p>
            <div className="relative">
              <input
                className="input w-full pr-10"
                type={showImportPassword ? 'text' : 'password'}
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void importBackup();
                }}
                autoFocus
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-100" onClick={() => setShowImportPassword((value) => !value)} aria-label={t(showImportPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')} title={t(showImportPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}><Icon name={showImportPassword ? 'eyeOff' : 'eye'} size={17} /></button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setImportOpen(false)} disabled={importingBackup}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary" onClick={() => void importBackup()} disabled={importingBackup}>
                <Icon name={importingBackup ? 'sync' : 'upload'} className={importingBackup ? 'animate-spin' : ''} />
                {importingBackup ? t('Importando…') : t('Seleccionar archivo')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmReindex && (
        <ConfirmModal
          title={t('Reindexar todos los embeddings')}
          message={t('Se borrarán TODOS los embeddings existentes y se regenerarán desde cero. Esto consumirá tokens del proveedor de embeddings configurado. ¿Continuar?')}
          confirmLabel={t('Reindexar todo')}
          danger
          onConfirm={() => {
            setConfirmReindex(false);
            void window.nodus.reindexAll();
          }}
          onCancel={() => setConfirmReindex(false)}
        />
      )}

      {pendingModelSettingsMode && (
        <ConfirmModal
          title={t(pendingModelSettingsMode === 'basic' ? '¿Cambiar a la configuración básica?' : '¿Cambiar a la configuración avanzada?')}
          message={pendingModelSettingsMode === 'basic' ? (
            <div data-testid="confirm-model-settings-mode" className="space-y-2">
              <p>{t('Solo un modo puede estar activo. El modelo general pasará a utilizarse en las tareas de texto y las selecciones avanzadas dejarán de aplicarse.')}</p>
              <p>{t('Después del cambio, revisa y completa «Modelo general de texto» antes de utilizar las funciones de IA. Una configuración incompleta puede hacer que esas funciones fallen.')}</p>
            </div>
          ) : (
            <div data-testid="confirm-model-settings-mode" className="space-y-2">
              <p>{t('Solo un modo puede estar activo. Cada tarea pasará a utilizar el modelo seleccionado en su propio campo en lugar de depender únicamente del modelo general.')}</p>
              <p>{t('Después del cambio, revisa y completa los modelos de «Ajustes avanzados comunes» y del vault actual. Una tarea sin un modelo válido puede fallar.')}</p>
            </div>
          )}
          confirmLabel={t(pendingModelSettingsMode === 'basic' ? 'Cambiar a configuración básica' : 'Cambiar a configuración avanzada')}
          onConfirm={() => {
            const mode = pendingModelSettingsMode;
            setPendingModelSettingsMode(null);
            void patch({ modelSettingsMode: mode });
          }}
          onCancel={() => setPendingModelSettingsMode(null)}
        />
      )}
      {pendingEmbeddingChange && (
        <ConfirmModal
          title={t('Cambiar modelo de embeddings')}
          message={t('Los embeddings creados con el modelo anterior no son compatibles con el nuevo. Nodus conservará los datos, pero tendrás que reindexar para que la búsqueda semántica y las relaciones usen el nuevo modelo. ¿Cambiar de todos modos?')}
          confirmLabel={t('Cambiar modelo')}
          onConfirm={() => {
            const next = pendingEmbeddingChange;
            setPendingEmbeddingChange(null);
            void patch({ embeddingProvider: next.provider, embeddingModel: next.model });
          }}
          onCancel={() => setPendingEmbeddingChange(null)}
        />
      )}
      {confirmBetaUpdates && (
        <ConfirmModal
          title={t('¿Activar Beta updates?')}
          message={(
            <div data-testid="confirm-beta-updates" className="space-y-2">
              <p>{t('Este canal está recomendado únicamente para testers.')}</p>
              <p>{t('Las versiones beta pueden contener errores o ser inestables.')}</p>
              <p>{t('Si continúas, Nodus comprobará y recibirá versiones beta además de las actualizaciones estables.')}</p>
              <p>{t('Antes de instalar una beta, Nodus creará y verificará una copia completa. Si Recuperación no está configurada o la copia falla, la beta no se instalará.')}</p>
            </div>
          )}
          confirmLabel={t('Activar Beta updates')}
          onConfirm={() => void enableBetaUpdates()}
          onCancel={() => setConfirmBetaUpdates(false)}
        />
      )}
      {confirmBackupCleanupEnable && (
        <ConfirmModal
          title={t('¿Activar la limpieza automática?')}
          message={(
            <div data-testid="confirm-backup-cleanup-enable" className="space-y-2">
              <p>{t('Esta opción puede retirar copias antiguas automáticamente. Comprueba con atención la antigüedad seleccionada antes de continuar.')}</p>
              <p>{backupCleanupPreview?.ok
                ? tx('Con la configuración actual, {count} copia(s) ({size}) pasaría(n) a la papelera de seguridad.', {
                  count: backupCleanupPreview.candidateCount,
                  size: formatBackupBytes(backupCleanupPreview.candidateBytes),
                })
                : backupCleanupPreview ? errorText(backupCleanupPreview.message) : null}</p>
              <p>{t('Las tres copias normales más recientes, las copias de otros equipos y los snapshots pre-update quedan protegidos.')}</p>
              <p>{t('Ninguna copia que se mueva en esta ejecución se eliminará definitivamente: permanecerá siete días en la papelera de seguridad.')}</p>
              {backupCleanupPreview?.ok && backupCleanupPreview.purgeReadyCount > 0 && (
                <p className="text-rose-300">{tx('{count} copia(s) ({size}) ya cumplió/cumplieron siete días en la papelera de seguridad y se eliminará(n) definitivamente en esta limpieza.', {
                  count: backupCleanupPreview.purgeReadyCount,
                  size: formatBackupBytes(backupCleanupPreview.purgeReadyBytes),
                })}</p>
              )}
            </div>
          )}
          confirmLabel={t('Activar y ejecutar limpieza')}
          danger
          onConfirm={() => void enableBackupCleanup()}
          onCancel={() => setConfirmBackupCleanupEnable(false)}
        />
      )}
      {confirmBackupCleanupNow && (
        <ConfirmModal
          title={t('¿Revisar y limpiar copias antiguas?')}
          message={(
            <div data-testid="confirm-backup-cleanup-now" className="space-y-2">
              <p>{backupCleanupPreview?.ok
                ? tx('{count} copia(s) ({size}) cumple(n) ahora la regla de antigüedad.', {
                  count: backupCleanupPreview.candidateCount,
                  size: formatBackupBytes(backupCleanupPreview.candidateBytes),
                })
                : backupCleanupPreview ? errorText(backupCleanupPreview.message) : null}</p>
              <p>{t('Nodus volverá a calcular y verificar todo justo antes de mover archivos. Si algo no coincide, la operación se cancela sin borrar datos.')}</p>
              <p>{t('Las copias pasarán primero a la papelera de seguridad durante siete días.')}</p>
              {backupCleanupPreview?.ok && backupCleanupPreview.purgeReadyCount > 0 && (
                <p className="text-rose-300">{tx('{count} copia(s) ({size}) ya cumplió/cumplieron siete días en la papelera de seguridad y se eliminará(n) definitivamente en esta limpieza.', {
                  count: backupCleanupPreview.purgeReadyCount,
                  size: formatBackupBytes(backupCleanupPreview.purgeReadyBytes),
                })}</p>
              )}
            </div>
          )}
          confirmLabel={t('Ejecutar limpieza segura')}
          danger
          onConfirm={() => void runBackupCleanup()}
          onCancel={() => setConfirmBackupCleanupNow(false)}
        />
      )}
      {openLegalDoc && (
        <LegalDocModal
          doc={LEGAL_DOCS[openLegalDoc]}
          language={settings.uiLanguage}
          onClose={() => setOpenLegalDoc(null)}
        />
      )}
    </div>
  );
}

const NODUS_SERVER_GUIDE_STEPS = [
  ['1. Prepara el equipo', 'Instala Docker Desktop en Windows o macOS, o Docker Engine en Linux. También puedes usar un VPS y administrar el Stack desde Portainer. El equipo debe permanecer encendido.'],
  ['2. Elige una dirección', 'Crea un dominio o subdominio para Nodus. Haz que su DNS apunte a la IP pública del servidor; si la IP cambia, configura DDNS. Caddy obtiene HTTPS, pero no crea el registro DNS.'],
  ['3. Despliega el Stack', 'En Portainer abre Stacks, crea uno nuevo y pega el Stack oficial. Define NODUS_DOMAIN, NODUS_ADMIN_EMAIL y una NODUS_ADMIN_PASSWORD única de al menos 12 caracteres. Las dos credenciales deben configurarse juntas.'],
  ['4. Publica HTTPS de forma segura', 'Si no tienes proxy, el Stack con Caddy utiliza los puertos 80 y 443. Si ya usas Caddy o Nginx, despliega solo Nodus Server y dirige el proxy a 127.0.0.1:7443 o nodus-server:7443. Cloudflare Tunnel también puede apuntar a ese destino. Nunca expongas 7443 directamente a Internet.'],
  ['5. Inicia sesión', 'Abre https://tu-dominio: el servidor habrá creado o actualizado la cuenta y mostrará directamente el login. Para rotar las credenciales, cambia las variables y vuelve a desplegar. Como alternativa puedes dejar ambas vacías y utilizar /setup con un NODUS_SETUP_TOKEN temporal.'],
  ['6. Crea usuarios y espacios', 'En la administración web crea un espacio, crea las cuentas lectoras y concede a cada persona únicamente los espacios que debe consultar. El administrador puede restablecer contraseñas temporales.'],
  ['7. Conecta este vault', 'En el servidor genera un código para Nodus. Aquí, en Ajustes → Servidor, escribe la dirección HTTPS y ese código de un solo uso. Nodus enviará una copia filtrada y la mantendrá actualizada mientras la aplicación esté abierta.'],
  ['8. Conecta ChatGPT o Claude', 'Añade https://tu-dominio/mcp como servidor MCP remoto. El cliente abrirá OAuth: cada persona inicia sesión, autoriza la lectura y solo puede consultar los espacios que tenga asignados.'],
  ['9. Mantén el servidor', 'Actualiza periódicamente la imagen main, limita el acceso administrativo a Docker o Portainer, protege las variables de entorno y conserva copias probadas del volumen nodus_data. Las credenciales y la base SQLite original no se publican desde el vault.'],
] as const;

function NodusServerGuideModal({ onOpenGuide, onClose }: { onOpenGuide: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div
        className="card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nodus-server-guide-title"
        data-testid="nodus-server-guide-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-neutral-200 p-5 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <h2 id="nodus-server-guide-title" className="text-lg font-semibold">{t('Cómo instalar y conectar Nodus Server')}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t('Sigue estos pasos en orden. No necesitas abrir puertos en el ordenador donde utilizas Nodus Desktop.')}</p>
          </div>
          <button className="btn btn-ghost shrink-0" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <ol className="space-y-3">
            {NODUS_SERVER_GUIDE_STEPS.map(([title, description]) => (
              <li key={title} className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t(title)}</h3>
                <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t(description)}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <strong>{t('Regla de seguridad')}:</strong>{' '}
            {t('Solo el reverse proxy o el túnel debe ser público y siempre con HTTPS. Restringe el acceso a Docker o Portainer, protege las variables de credenciales y no compartas contraseñas por mensajes sin cifrar.')}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 p-4 dark:border-neutral-800 sm:flex-row sm:justify-end">
          <button className="btn btn-ghost" onClick={onClose}>{t('Cerrar')}</button>
          <button className="btn btn-primary" onClick={onOpenGuide}><Icon name="external" /> {t('Abrir guía completa')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Reorder and show/hide the sidebar sections, grouped like the sidebar itself
 * (Explorar · Analizar · Escribir). Home (pinned first) and Settings (pinned
 * last) can neither be moved nor hidden, so they are not shown here. Reordering
 * is constrained to within a group; the saved order is the flat list of the
 * remaining view ids, from which {@link groupedNav} derives each group's order.
 */
function SidebarOrderEditor({
  sidebarOrder,
  sidebarHidden,
  toolkitPinnedPages,
  vaultType,
  onReorder,
  onToggleHidden,
}: {
  sidebarOrder: string[];
  sidebarHidden: string[];
  toolkitPinnedPages: AppSettings['toolkitPinnedPages'];
  vaultType: VaultType | undefined;
  onReorder: (ids: string[]) => void;
  onToggleHidden: (hidden: string[]) => void;
}) {
  type EditorItem = { id: string; label: string; icon: string; group: string };
  type EditorGroup = { id: string; label: string; items: EditorItem[] };

  // Use the exact same resolved Tools group as the real sidebar. Pinned Toolkit
  // pages therefore inherit the catalogue's icon/name and can be hidden, dragged,
  // or moved with the arrow controls like every other sidebar entry.
  const universalTools = groupedNav(sidebarOrder, [], toolkitPinnedPages)
    .find((group) => group.id === 'tools');
  let groups: EditorGroup[];
  if (vaultType === 'docencia') {
    groups = TEACHING_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      items: orderSidebarItems(
        group.items.map((item) => ({ ...item, id: teachingItemId(item) })),
        sidebarOrder,
      ).map((item) => ({ ...item, group: group.id })),
    }));
  } else if (vaultType === 'testimonios') {
    groups = TESTIMONY_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      items: orderSidebarItems(
        group.items.map((item) => ({ ...item, id: item.view })),
        sidebarOrder,
      ).map((item) => ({ ...item, group: group.id })),
    }));
  } else if (vaultType === 'worldbuilding') {
    groups = WORLDBUILDING_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      items: orderSidebarItems(
        group.items.map((item) => ({ ...item, id: item.view })),
        sidebarOrder,
      ).map((item) => ({ ...item, group: group.id })),
    }));
  } else {
    const dedicatedIds = dedicatedVaultNavIds(vaultType);
    const dedicated = dedicatedIds ? new Set(dedicatedIds) : null;
    const orderedAll = orderedNav(sidebarOrder).filter(
      (item) => item.id !== 'home'
        && item.id !== 'settings'
        && isViewAllowedForVaultType(item.id, vaultType)
        && (!dedicated || dedicated.has(item.id)),
    );
    groups = NAV_GROUPS.map((group) => ({
      ...group,
      items: orderedAll
        .filter((item) => item.group === group.id)
        .map((item) => ({ ...item, label: navItemLabel(item, vaultType), group: group.id })),
    }));
  }
  groups = groups.filter((group) => group.id !== 'tools');
  if (universalTools?.items.length) {
    groups.push({
      id: universalTools.id,
      label: universalTools.label,
      items: universalTools.items.map((item) => ({ ...item, group: universalTools.id })),
    });
  }
  groups = groups.filter((group) => group.items.length > 0);
  const orderedAll = groups.flatMap((group) => group.items);
  const hidden = new Set(sidebarHidden);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const move = (id: string, dir: -1 | 1) => {
    const group = groups.find((g) => g.items.some((n) => n.id === id));
    if (!group) return;
    const gi = group.items.findIndex((n) => n.id === id);
    const target = gi + dir;
    if (target < 0 || target >= group.items.length) return;
    const ids: string[] = orderedAll.map((n) => n.id);
    const ia = ids.indexOf(id);
    const ib = ids.indexOf(group.items[target].id);
    [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
    onReorder(ids);
  };

  const toggleHidden = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onToggleHidden([...next]);
  };

  // Drag-and-drop only rearranges within the same group; cross-group drops are ignored.
  const drop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const src = orderedAll.find((n) => n.id === draggingId);
    const tgt = orderedAll.find((n) => n.id === targetId);
    if (!src || !tgt || src.group !== tgt.group) return;
    const ids: string[] = orderedAll.map((n) => n.id);
    const from = ids.indexOf(draggingId);
    if (from < 0) return;
    ids.splice(from, 1);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, draggingId);
    onReorder(ids);
  };

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            {t(group.label)}
          </div>
          <ul className="space-y-1">
            {group.items.map((item, gi) => (
              <li
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item.id);
                  setDraggingId(item.id);
                }}
                onDragEnter={() => setDragOverId(item.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(item.id);
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                className={`flex items-center gap-2 rounded-md border bg-neutral-900/40 px-3 py-1.5 transition-colors ${
                  draggingId === item.id ? 'opacity-40' : ''
                } ${
                  dragOverId === item.id && draggingId !== item.id
                    ? 'border-indigo-500 border-dashed'
                    : 'border-neutral-800'
                }`}
              >
                <Icon name="list" size={13} className="shrink-0 cursor-grab text-neutral-600" />
                <Icon
                  name={item.icon}
                  size={15}
                  className={`shrink-0 ${hidden.has(item.id) ? 'text-neutral-700' : 'text-neutral-500'}`}
                />
                <span
                  className={`flex-1 min-w-0 truncate text-sm ${
                    hidden.has(item.id) ? 'text-neutral-600 line-through' : 'text-neutral-200'
                  }`}
                >
                  {t(item.label)}
                </span>
                <button
                  className={`p-1 rounded hover:bg-neutral-800 ${
                    hidden.has(item.id)
                      ? 'text-neutral-600 hover:text-neutral-300'
                      : 'text-neutral-500 hover:text-neutral-100'
                  }`}
                  title={hidden.has(item.id) ? t('Mostrar') : t('Ocultar')}
                  onClick={() => toggleHidden(item.id)}
                >
                  <Icon name={hidden.has(item.id) ? 'eyeOff' : 'eye'} size={14} />
                </button>
                <button
                  className="p-1 rounded text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500"
                  title={t('Subir')}
                  disabled={gi === 0}
                  onClick={() => move(item.id, -1)}
                >
                  <Icon name="arrowUp" size={14} />
                </button>
                <button
                  className="p-1 rounded text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500"
                  title={t('Bajar')}
                  disabled={gi === group.items.length - 1}
                  onClick={() => move(item.id, 1)}
                >
                  <Icon name="arrowDown" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type VaultModelKey = 'chatModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel' | 'argumentMapModel' | 'authorModel' | 'dictionaryModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel';

const VAULT_MODEL_FIELDS: Record<VaultModelKey, string> = {
  chatModel: 'Chat con el corpus',
  deepResearchModel: 'Deep Research',
  immersionModel: 'Inmersión',
  writingModel: 'Nodus Scriptor',
  argumentMapModel: 'Mapa argumental',
  authorModel: 'Autores y biografías',
  dictionaryModel: 'Diccionario',
  studyModel: 'Guías de estudio',
  tutorModel: 'Tutor',
  hypothesisModel: 'Laboratorio de hipótesis',
};

const VAULT_MODEL_HINTS: Record<VaultModelKey, string> = {
  chatModel: 'Responde preguntas sobre el corpus y cita la evidencia utilizada.',
  deepResearchModel: 'Planifica y redacta informes extensos a partir de fuentes y relaciones.',
  immersionModel: 'Genera sesiones guiadas de lectura y trabajo con las fuentes.',
  writingModel: 'Redacta, organiza y revisa artículos, tesis, notas y documentos.',
  argumentMapModel: 'Construye mapas de tesis, razones, objeciones y evidencias.',
  authorModel: 'Sintetiza perfiles de autor y redacta biografías basadas en el corpus.',
  dictionaryModel: 'Genera y actualiza definiciones del Diccionario desde la evidencia.',
  studyModel: 'Prepara guías y materiales de repaso a partir del contenido del vault.',
  tutorModel: 'Adapta explicaciones, preguntas y rutas de aprendizaje en el Tutor.',
  hypothesisModel: 'Propone, contrasta y desarrolla hipótesis de investigación.',
};

function vaultModelKeys(type: VaultType): VaultModelKey[] {
  if (type === 'genealogy') return ['chatModel', 'deepResearchModel', 'authorModel'];
  if (type === 'databases') return ['chatModel'];
  if (type === 'estudio') return [];
  return Object.keys(VAULT_MODEL_FIELDS) as VaultModelKey[];
}

function VaultModelOverrides({ settings, vaultType, vaultName, patch }: {
  settings: AppSettings;
  vaultType: VaultType;
  vaultName: string;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const keys = vaultModelKeys(vaultType);
  return <div className="mt-5 border-t border-neutral-800 pt-4" data-testid="vault-model-overrides">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{tx('Ajustes avanzados del vault {vault}', { vault: vaultName })}</h3>
    <p className="mb-3 mt-1 text-xs text-neutral-600">{t('Estos cambios no modifican los demás vaults.')}</p>
    {vaultType === 'estudio' ? <StudyVaultModelOverrides settings={settings} patch={patch} /> : <div className="space-y-3">
      {keys.map((key) => <Row key={key} label={t(VAULT_MODEL_FIELDS[key])} hint={t(VAULT_MODEL_HINTS[key])}>
        <ModelWithReasoning allowEmpty={false} settings={settings} value={settings[key] ?? null} onChange={(model) => void patch({ [key]: model })} emptyLabel="Seleccionar modelo" menu />
      </Row>)}
    </div>}
  </div>;
}

const STUDY_VAULT_MODEL_FIELDS = [
  { task: 'chat', label: 'Chat con el corpus', hint: 'Responde preguntas sobre el corpus y cita la evidencia utilizada.', key: 'chatModel' },
  { task: 'improve', label: 'Mejora de texto', hint: 'Revisa, amplía y transforma borradores en el Taller de escritura.', key: 'improveModel' },
  { task: 'questions', label: 'Generación de preguntas', hint: 'Adapta explicaciones, preguntas y rutas de aprendizaje en el Tutor.', key: 'questionGenModel' },
  { task: 'flashcards', label: 'Generación de flashcards', hint: 'Prepara guías y materiales de repaso a partir del contenido del vault.', key: 'flashcardModel' },
] as const;

function StudyVaultModelOverrides({ settings, patch }: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  return <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(11rem,1fr)_minmax(11rem,1fr)] gap-x-4 gap-y-3 text-xs">
    <b className="text-neutral-600">{t('Tarea')}</b>
    <b className="text-neutral-600">{t('Principal')}</b>
    <b className="text-neutral-600">{t('Alternativo ante error')}</b>
    {STUDY_VAULT_MODEL_FIELDS.map((item) => <div key={item.task} className="contents">
      <span className="self-center text-neutral-300">
        {t(item.label)}
        <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{t(item.hint)}</span>
      </span>
      <ModelWithReasoning compact allowEmpty={false} settings={settings} value={settings[item.key]} onChange={(model) => void patch({ [item.key]: model })} emptyLabel="Seleccionar modelo" menu />
      <ModelWithReasoning compact settings={settings} value={settings.studyAiFallbackModels[item.task] ?? null} onChange={(model) => void patch({ studyAiFallbackModels: { ...settings.studyAiFallbackModels, [item.task]: model } })} emptyLabel="Sin modelo alternativo" menu />
    </div>)}
  </div>;
}

function formatDataBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function StudyDataAdministration() {
  const [overview, setOverview] = useState<StudyDataOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => setOverview(await window.nodus.getStudyDataOverview());
  useEffect(() => { void refresh(); }, []);
  const run = async (action: 'rebuild-indexes' | 'clear-embeddings' | 'empty-trash' | 'repair', destructive = false) => {
    if (destructive && !window.confirm(t('Esta acción elimina datos de forma permanente. ¿Quieres continuar?'))) return;
    setBusy(true); setMessage('');
    try { const result = await window.nodus.maintainStudyData(action); setMessage(result.message); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 border-t border-neutral-800 pt-4" data-testid="study-data-admin">
    <div className="flex flex-wrap items-start gap-3"><div className="mr-auto"><label className="text-sm">{t('Administración del vault de estudio')}</label><p className="mt-0.5 text-xs text-neutral-500">{t('Comprobaciones locales de SQLite, almacenamiento, índices, huérfanos y papelera.')}</p></div><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />{t('Comprobar')}</button></div>
    {overview && <><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[
      [t('Base del vault'), formatDataBytes(overview.databaseBytes)], [t('Materiales'), formatDataBytes(overview.materialBytes)],
      [t('Grabaciones'), formatDataBytes(overview.recordingBytes)], [t('Índices vectoriales'), formatDataBytes(overview.embeddingBytes)],
    ].map(([label, value]) => <div key={label} className="rounded-lg bg-neutral-900 p-3"><span className="block text-[10px] uppercase tracking-wider text-neutral-600">{label}</span><b className="mt-1 block text-sm text-neutral-300">{value}</b></div>)}</div>
      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${overview.integrityOk && overview.foreignKeyErrors.length === 0 ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300' : 'border-red-900/60 bg-red-950/20 text-red-300'}`}>
        {overview.integrityOk && overview.foreignKeyErrors.length === 0 ? t('Integridad correcta: sin referencias huérfanas.') : `${overview.integrityMessages.join('; ')} · ${overview.foreignKeyErrors.length} ${t('referencias huérfanas')}`} · schema v{overview.schemaVersion}/{overview.expectedSchemaVersion} · {overview.studyRows} {t('filas de estudio')} · {overview.trashRows} {t('en papelera')}
      </div></>}
    <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void run('repair')}><Icon name="settings" />{t('Verificar y optimizar')}</button><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void run('rebuild-indexes')}><Icon name="refresh" />{t('Reconstruir índices')}</button><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void run('clear-embeddings', true)}>{t('Limpiar índices vectoriales')}</button><button className="btn btn-ghost border border-red-900 text-red-400" disabled={busy || !overview?.trashRows} onClick={() => void run('empty-trash', true)}><Icon name="trash" />{t('Vaciar papelera')}</button><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={async () => { const result = await window.nodus.exportStudyDiagnostic(); if (result) setMessage(result.path); }}><Icon name="download" />{t('Exportar diagnóstico')}</button></div>
    {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 mb-4">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children, hint, stacked = false }: { label: string; children: React.ReactNode; hint?: string; stacked?: boolean }) {
  // A control that is itself a grid of options reads better under its own label
  // than beside it: the two-column shape would leave the label column empty for
  // the height of the grid and push the options into the narrow right side.
  if (stacked) {
    return (
      <div className="grid gap-3">
        <label className="text-sm text-neutral-300">
          {label}
          {hint && <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>}
        </label>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(13rem,0.85fr)_minmax(0,1.55fr)] md:items-start">
      <label className="pt-2 text-sm text-neutral-300">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>}
      </label>
      <div className="min-w-0 md:flex md:justify-end">{children}</div>
    </div>
  );
}

function SettingsTabButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm shadow-indigo-950/20'
          : 'border-neutral-800 bg-neutral-900/40 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
      }`}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      {children}
    </button>
  );
}


/**
 * Versions a sync merge discarded, and the way back.
 *
 * Merging resolves conflicts by comparing wall-clock timestamps, so a machine whose
 * clock is behind loses every comparison it takes part in. Whatever lost used to be
 * overwritten with no trace; it is kept now, and this is where it can be put back.
 *
 * Defined at module level on purpose: a component declared inside another is a new type
 * on every render, which remounts it and throws away its state on each keystroke.
 */
function SupersededVersions({ reloadKey }: { reloadKey: number }) {
  const [entries, setEntries] = useState<SupersededEntry[] | null>(null);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reload = async () => {
    const next = await window.nodus.countSupersededVersions();
    setCount(next);
    if (next === 0) {
      setEntries([]);
      setOpen(false);
      return;
    }
    setEntries(await window.nodus.listSupersededVersions(100, 0));
  };

  useEffect(() => {
    void reload();
    // Intentionally keyed only on reloadKey: `reload` is recreated every render, and this
    // project has no exhaustive-deps rule that would flag the omission.
  }, [reloadKey]);

  // Nothing was ever discarded: say nothing rather than showing an empty panel.
  if (count === 0) return null;

  const originLabel = (origin: SupersededEntry['origin']) =>
    origin === 'local-overwritten'
      ? t('Tu versión fue reemplazada por la del otro equipo')
      : origin === 'incoming-lost'
        ? t('La versión del otro equipo no se aplicó')
        : origin === 'deleted-remotely'
          ? t('Se borró en el otro equipo y se eliminó aquí')
          : t('Sustituida al restaurar otra versión');

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-testid="superseded-versions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <label className="text-sm">{t('Versiones sustituidas')}</label>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('Al fusionar gana la versión más reciente y los borrados del otro equipo se aplican aquí. Se guarda lo que no se aplicó y lo que se eliminó, por si la resolución no fue la correcta (por ejemplo, si un equipo tiene la hora mal).')}
          </p>
        </div>
        <button className="btn btn-ghost shrink-0 border border-neutral-300 text-xs dark:border-neutral-700" onClick={() => setOpen((value) => !value)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} /> {count} {t('guardadas')}
        </button>
      </div>

      {note && <p className="mt-2 text-xs text-neutral-500">{note}</p>}

      {open && (
        <div className="mt-3 space-y-2">
          {(entries ?? []).map((entry) => (
            <div key={entry.id} className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{originLabel(entry.origin)}</span>
                <span className="text-neutral-500">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-neutral-500">
                {entry.tableName} · {entry.rowKey.join(' / ')}
              </p>
              <ul className="mt-1 space-y-0.5">
                {entry.fields
                  .filter((field) => field.name !== 'updated_at' && field.name !== 'created_at')
                  .slice(0, 6)
                  .map((field) => (
                    <li key={field.name} className="truncate text-neutral-500" title={`${field.name}: ${field.value}`}>
                      <span className="text-neutral-400">{field.name}:</span> {field.value}
                    </li>
                  ))}
              </ul>
              {entry.hasOmittedBlobs && (
                <p className="mt-1 text-amber-600 dark:text-amber-400">
                  {t('Los archivos adjuntos no se guardaron: al restaurar se conservan los actuales.')}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(entry.id);
                    try {
                      const result = await window.nodus.restoreSupersededVersion(entry.id);
                      setNote(result.message);
                      await reload();
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Icon name="undo" /> {busy === entry.id ? t('Restaurando…') : t('Restaurar esta versión')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('Descartar versión guardada'),
                      message: t('Esta copia de la versión que no se aplicó se eliminará y no podrás recuperarla.'),
                      confirmLabel: t('Descartar'),
                      danger: true,
                    });
                    if (!ok) return;
                    await window.nodus.clearSupersededVersions([entry.id]);
                    await reload();
                  }}
                >
                  <Icon name="trash" /> {t('Descartar')}
                </button>
              </div>
            </div>
          ))}
          {count > (entries?.length ?? 0) && (
            <p className="text-xs text-neutral-500">
              {t('Se muestran las más recientes.')} {count - (entries?.length ?? 0)} {t('más guardadas.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * The passphrase that encrypts sync packages.
 *
 * Deliberately its own secret rather than the backup master password: restoring with the
 * recovery key mints a NEW random master password, so two machines would silently end up
 * with different ones and sync would fail for no visible reason. And deliberately not a
 * fresh key per export — syncing is recurrent, and a secret you must copy every time is
 * a secret people stop using.
 *
 * Module-level, like the panel below it: a component declared inside another is a new
 * type on every render and loses its state on each keystroke.
 */
function SyncPassphrase({ onChange }: { onChange: (has: boolean) => void }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void window.nodus.hasSyncPassphrase().then((next) => {
      setHas(next);
      onChange(next);
    });
    // Runs once: the callback only reports the initial state upward.
  }, []);

  if (has === null) return null;

  return (
    <div className="mt-2" data-testid="sync-passphrase">
      {has ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            {t('Frase de sincronización configurada. Los paquetes se exportan cifrados.')}
          </span>
          <button
            className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
            onClick={async () => {
              await window.nodus.clearSyncPassphrase();
              setHas(false);
              onChange(false);
              setNote(t('Los paquetes ya exportados siguen necesitando la frase anterior.'));
            }}
          >
            {t('Cambiar frase')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <input
              type={reveal ? 'text' : 'password'}
              className="input w-full pr-10"
              placeholder={t('Frase de sincronización (mín. 8 caracteres)')}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-100"
              onClick={() => setReveal((current) => !current)}
              aria-label={t(reveal ? 'Ocultar contraseña' : 'Mostrar contraseña')}
            >
              <Icon name={reveal ? 'eyeOff' : 'eye'} size={17} />
            </button>
          </div>
          <button
            className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
            disabled={value.trim().length < 8}
            onClick={async () => {
              try {
                await window.nodus.setSyncPassphrase(value);
                setValue('');
                setHas(true);
                onChange(true);
                setNote(t('Escribe la misma frase en el otro equipo. Queda incluida en el kit de recuperación.'));
              } catch (e) {
                setNote(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {t('Guardar frase')}
          </button>
        </div>
      )}
      <p className="mt-1 text-xs text-neutral-500">
        {note ?? t('Los paquetes de sincronización van cifrados con esta frase. Tendrás que escribir la misma en el otro equipo.')}
      </p>
    </div>
  );
}
