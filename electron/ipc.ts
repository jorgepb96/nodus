import { registerStudyFocusIpc } from './ipc/studyFocus';
import { synchronizeFocusVault } from './study/focusRuntime';
import { scheduleManualIndex } from './ai/manualIdeaIndex';
import { getDocumentVisuals, enrichDocumentVisuals, cancelDocumentVisuals, undoVisualEnrichment, removeDocumentFigure } from './ai/documentVisuals';
import { dialogTitle } from './dialogTitles';
import { listDocumentSkills } from './capabilities/documentCatalog';
import { getSkillMarketplace, addSkillSource, removeSkillSource, updateSkillSource, installMarketplaceSkill, installMarketplacePlugin } from './skillMarketplace';
import { listChatSkills, saveChatSkill, deleteChatSkill, restoreChatSkills, importSkillDirectory, exportSkillDirectory, approvePendingChatPlugin, rollbackChatPlugin, removeChatPlugin, installChatPluginPackage, restorePluginSkillAuthorVersion } from './chatSkills';
import { configurePluginSecret, discardInboxPlugin, listInboxPlugins, listInstalledPlugins, readInboxPlugin, readPluginDirectory, setPluginAutoUpdate } from './skillPlugins';
import { mergedPluginPermissions } from '../skill-capabilities/pluginPackage';
import { getCapabilityFile } from './chatAssets';
import { validateModelAsset } from '../packages/capability-api/src/models';
import { validateMediaAsset } from '../packages/capability-api/src/media';
import { getChatImageMetadata } from './chatAssets';
import { originalImagePayloadFromUrl } from './imageProtocol';
import path from 'node:path';
import fs from 'node:fs';
import { ipcMain, BrowserWindow, dialog, app, nativeTheme, clipboard, nativeImage } from 'electron';

import {
  showImportOpenDialog,
} from './privacy';
import type {
  AppLanguage,
  AppSettings,
  RecoveryRestoreProgress,
  UpdateCheckResponse,
  CreateVaultInput,
  VaultSummary,
  VaultSwitchOptions,
  VaultSwitchResult,
  VaultType,
} from '@shared/types';

import { getSettings, updateSettings } from './db/settingsRepo';
import { getAiConcurrencySnapshot, onAiConcurrencySnapshot, refreshAiConcurrencyPolicy } from './ai/aiClient';
import * as protect from './protect/protectService';
import { createIpcContext } from './ipc/context';
import { registerProsopographyIpc } from './ipc/prosopography';
import { registerTestimoniesIpc } from './ipc/testimonies';
import { registerToolkitIpc } from './ipc/toolkit';
import { registerCapabilitiesIpc } from './ipc/capabilities';
import { registerTeachingIpc } from './ipc/teaching';
import { registerDatabasesIpc } from './ipc/databases';
import { registerPagesIpc } from './ipc/pages';
import { registerPrimarySourcesIpc } from './ipc/primarySources';
import { registerArchiveIpc } from './ipc/archive';
import { registerWorldbuildingIpc } from './ipc/worldbuilding';
import { registerPlatformIpc } from './ipc/platform';
import { registerRecordsIpc } from './ipc/records';
import { registerAcademicIpc } from './ipc/academic';
import { registerChatHistoryIpc } from './ipc/chatHistory';
import { registerLibraryIpc } from './ipc/library';
import { registerBrowserIpc } from './ipc/browser';
import { registerRadarIpc } from './ipc/radar';
import { registerReactionIndexIpc } from './ipc/reactionIndex';
import { registerCompassIpc } from './ipc/compass';
import { registerLogsIpc } from './ipc/logs';
import { registerDriftIpc } from './ipc/drift';
import { setBrowserTheme } from './browser/tabs';
import { browserHistoryRepository } from './browser/history';
import { applyPipelineLogLimits, initPipelineLogs } from './logging/pipelineLogHost';
import {
  restartMcpServer,
  startMcpServer,
  startMcpTunnelIfConfigured,
  stopMcpServer,
  stopMcpTunnel,
} from './mcp';
import { restartCopilotServer, startCopilotServer, stopCopilotServer } from './copilot/server';
import {
  restartZoteroPluginServer,
  startZoteroPluginServer,
  stopZoteroPluginServer,
} from './zotero-plugin/server';
import {
  applyMascotWindow,
  beginMascotWindowDrag,
  dragMascotWindow,
  endMascotWindowDrag,
  getMascotWindowPlacement,
  setMascotTutorialVisible,
  setMascotWindowExpanded,
} from './mascotWindow';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
  setNotificationsNotifier,
} from './notifications';
import { radarService } from './radar/radarService';
import {
  clearAnnouncements,
  listAnnouncements,
  markAnnouncementRead,
  refreshAnnouncements,
  setAnnouncementsNotifier,
} from './announcements';
import { consumeNodiQuoteSelection, getNodiViewContext, setNodiQuoteSelection, setNodiViewContext, streamNodiChat } from './ai/nodiChat';
import type { NodiChatRequest } from '@shared/types';
import { clearNodiConversations, deleteNodiConversation, getNodiConversation, listNodiConversations, saveNodiConversation } from './nodiConversations';
import { deleteNodiNote, listNodiNotes, saveNodiNote } from './nodiNotes';
import { copyApiKeysBetweenVaults, listApiKeyProvidersForVault, setBackupPassword, clearBackupPassword, hasBackupPassword, getBackupPassword, getBackupRecoveryKey } from './secrets/secretStore';
import {
  previewBackupCleanup,
  retentionCutoff,
  runAutoBackupNow,
  runBackupCleanupNow,
} from './export/autoBackup';
import { validateBackupPassword } from '@shared/backupPasswordPolicy';
import { asDocumentVisualModel } from '@shared/documentVisualEnrich';
import { isPipelineLogMaxEntries, isPipelineLogRetention } from '@shared/pipelineLogs';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import {
  onChatGptSubscriptionStatusChanged,
} from './ai/codexSubscription';
import {
  onGitHubCopilotSubscriptionStatusChanged,
} from './ai/githubCopilotSubscription';
import { onOpenCodeGoUsageStatusChanged } from './ai/openCodeGoUsage';
import {
  interruptDecorativeImageGenerations,
} from './ai/decorativeImages';
import { reconcileAuthorLayerOnce, reconcileAuthorRolesOnce } from './db/authorsRepo';
import { repairGraphIntegrityOnce } from './db/graphIntegrityRepair';
import { repairDocumentSupportPassagesOnce } from './ai/documentSupportRepair';
import { getSyncLog } from './db/syncRepo';
import { fullSync, startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import {
  restartNodusServerSync,
  startNodusServerSync,
  stopNodusServerSync,
} from './serverSync/serverSyncService';
import { startInboxPolling, stopInboxPolling } from './serverSync/inboxPoller';
import { setServerProfilePreferencesAppliedHandler, syncActiveServerProfilePreferences } from './serverSync/profilePreferencesSync';
import {
  createConnectedVault,
  detachReplica,
  getReplicaOverview,
  listReplicaPresence,
  signInToNodusServer,
  startReplicaSync,
  stopReplicaSync,
  syncReplicaNow,
  updateReplicaPresence,
  type RemoteSpaceOption,
} from './serverSync/replicaService';
import { restartLocalServer } from './localServer/process';
import { forwardOutlivedSetting, stopTailscaleServe } from './localServer/tailscale';
import { scanQueue } from './pipeline/scanQueue';
import {
  getRecoveryStatus,
  initializeRecoveryFolder,
  inspectRecoveryFolderSafely,
  restoreRecoverySnapshot,
} from './recovery/recoveryManager';
import { getTutorialCatalogue } from './tutorialCatalogue';
import { clearSuperseded, countSuperseded, listSuperseded, restoreSuperseded } from './db/syncSupersededRepo';
import { clearSyncPassphrase, getSyncPassphrase, hasSyncPassphrase, setSyncPassphrase } from './secrets/secretStore';
import {
  upgradeWorldbuildingDemoDynasties,
  upgradeWorldbuildingDemoImageQuality,
  upgradeWorldbuildingDemoNarrativeDepth,
  relocalizeWorldbuildingDemoData,
} from './db/worldbuildingDemoData';
import { getEmbeddingSnapshot } from './ai/embeddingPipeline';
import {
  getPassageSnapshot,
} from './ai/passageEmbeddingPipeline';
import { isSemanticBridgeRunning } from './ai/semanticBridges';
import { cancelDeepResearchJobsForOtherVaults, isDeepResearchLaneBusy } from './ai/deepResearchQueue';
import { closeDb, getDb, withVaultDatabase } from './db/database';
import {
  createVault,
  createVaultFromDatabaseFile,
  deleteVault,
  getActiveVault,
  getVault,
  listVaults,
  renameVault,
  resetVaultDatabase,
  setActiveVault,
  setVaultType,
} from './vaults/vaultRegistry';
import { reuseVaultAnalysisForWorks } from './vaults/vaultAnalysisImport';
import { initializeVaultInterfaceProfile, initializeVaultModelSelection, validateVaultModelSelection } from './vaults/vaultCreationSettings';
import { setPersistentDockIcon } from './dockIcon';
import { closeCrossVaultConnections } from './db/crossVault';
import { assertNotBrowserIpcSender } from './ipc/trust';
import {
  listMigrationRecoverySnapshotsInUtility,
  withMigrationRecoverySnapshotsInUtility,
} from './db/migrationRecoveryUtilityHost';
import { documentIndexQueue } from './pipeline/documentIndexQueue';
import {isLearningWorkspace,learningWorkspaceInfo,learningWorkspaceReady,openLearningWorkspace,closeLearningWorkspace} from './learning/learningWorkspace';
import { ensureDatabaseDeepResearchLane } from './ai/databaseDeepResearchLane';


function withVaultKeyProviders(vault: VaultSummary): VaultSummary {
  return { ...vault, ...(isLearningWorkspace()?{learningWorkspace:true}:{}), apiKeyProviders: listApiKeyProvidersForVault(vault.id) };
}

function vaultBusyMessage(): string | null {
  if (scanQueue.isBusy()) {
    return 'No se puede cambiar de bóveda con la cola de análisis activa. Pausa o termina los trabajos pendientes antes de cargar otra bóveda.';
  }
  if (getEmbeddingSnapshot().running) {
    return 'No se puede cambiar de bóveda mientras se están indexando embeddings de ideas.';
  }
  if (getPassageSnapshot().running) {
    return 'No se puede cambiar de bóveda mientras se están indexando pasajes.';
  }
  if (isSemanticBridgeRunning()) {
    return 'No se puede cambiar de bóveda mientras se descubren relaciones semánticas.';
  }
  // A report in flight reads the corpus for minutes. Switching closes the database
  // under it — and a report can now be running because an MCP client asked for it,
  // with nothing on screen unless the user is looking at Deep Research.
  if (isDeepResearchLaneBusy()) {
    return 'No se puede cambiar de bóveda mientras se genera un informe de Deep Research. Espera a que termine; en Deep Research puedes quitar de la cola los que aún no han empezado.';
  }
  return null;
}

function vaultSwitchMessage(base: string, copiedProviders: VaultSwitchResult['copiedProviders']): string {
  const parts = [base];
  if (copiedProviders.length > 0) parts.push(`Claves API copiadas: ${copiedProviders.length}.`);
  return parts.join(' ');
}






/** Register every IPC channel backing the window.nodus API. */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  checkForUpdates: () => Promise<UpdateCheckResponse>,
  installUpdate: () => Promise<UpdateCheckResponse>,
  updateChannelChanged: (betaUpdates: boolean) => void,
  getUpdateStatus: () => UpdateCheckResponse | null,
): void {
  const context = createIpcContext(getWindow);
  const { h } = context;

  // Domains extracted from this file, each owning its own channels and repo
  // imports. What remains below is everything not yet split out.
  registerProsopographyIpc(context);
  registerAcademicIpc(context);
  registerStudyFocusIpc(context);
  registerChatHistoryIpc(context);
  registerLibraryIpc(context);
  registerBrowserIpc(context);
  registerRadarIpc(context);
  registerReactionIndexIpc(context);
  registerCompassIpc(context);
  registerRecordsIpc(context);
  registerPlatformIpc(context);
  registerWorldbuildingIpc(context);
  registerArchiveIpc(context);
  registerPrimarySourcesIpc(context);
  registerDatabasesIpc(context);
  registerPagesIpc(context);
  registerTeachingIpc(context);
  registerToolkitIpc(context);
  registerCapabilitiesIpc(context);
  registerTestimoniesIpc(context);
  registerLogsIpc(context);
  registerDriftIpc(context);
  // The processing log has to be listening before any pipeline can run: this wires the
  // sink, prunes what the previous session left behind and arms the idle prune timer.
  initPipelineLogs();

  const nodiChatAborters = new Map<string, AbortController>();

  onChatGptSubscriptionStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:chatgptSubscription:statusChanged', status);
    }
  });
  onGitHubCopilotSubscriptionStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:githubCopilotSubscription:statusChanged', status);
    }
  });
  onOpenCodeGoUsageStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:openCodeGo:usageChanged', status);
    }
  });
  onAiConcurrencySnapshot((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:concurrency:changed', snapshot);
    }
  });

  setServerProfilePreferencesAppliedHandler((next) => {
    setBrowserTheme(next.theme);
    getWindow()?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:changed', next);
    }
  });

  const emitVaultChanged = () => {
    synchronizeFocusVault();
    const payload = withVaultKeyProviders(getActiveVault());
    // Broadcast to every window (main + the Nodi overlay) so Nodi's per-vault look
    // updates live wherever it is shown.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('vaults:changed', payload);
    }
  };

  const switchVaultSafely = async (id: string, options?: VaultSwitchOptions): Promise<VaultSwitchResult> => {
    const target = getVault(id);
    if (!target) {
      return { ok: false, message: 'Bóveda no encontrada.', copiedProviders: [] };
    }

    const sourceVaultId = options?.copyApiKeysFromVaultId?.trim() || null;
    if (sourceVaultId && sourceVaultId !== id && !getVault(sourceVaultId)) {
      return { ok: false, message: 'No se encontró la bóveda de origen de las claves API.', copiedProviders: [] };
    }

    let copiedProviders: VaultSwitchResult['copiedProviders'] = [];
    if (getActiveVault().id === id) {
      if (sourceVaultId && sourceVaultId !== id) {
        copiedProviders = copyApiKeysBetweenVaults(sourceVaultId, id);
      }
      const activeVault = withVaultKeyProviders(getActiveVault());
      emitVaultChanged();
      return {
        ok: true,
        message: vaultSwitchMessage('Esta bóveda ya está cargada.', copiedProviders),
        activeVault,
        copiedProviders,
      };
    }

    const busy = vaultBusyMessage();
    if (busy) return { ok: false, message: busy, copiedProviders: [] };

    if (sourceVaultId && sourceVaultId !== id) {
      if (!getVault(sourceVaultId)) {
        return { ok: false, message: 'No se encontró la bóveda de origen de las claves API.', copiedProviders: [] };
      }
      copiedProviders = copyApiKeysBetweenVaults(sourceVaultId, id);
    }

    stopRealtimeSync();
    stopNodusServerSync();
    stopInboxPolling();
  stopReplicaSync();
    await stopMcpTunnel();
    await stopMcpServer();
    await stopCopilotServer();
    await stopZoteroPluginServer();
    interruptDecorativeImageGenerations();
    protect.invalidateProtectVaultReferences();
    closeCrossVaultConnections(); // drop read-only handles to sibling vaults before switching
    closeDb();
    setActiveVault(id);
    getDb();
    if (target.type === 'databases') ensureDatabaseDeepResearchLane(target.id);
    // Wake the durable lane for this vault. Work belonging to another vault remains
    // queued against that corpus and resumes when its owner returns to it.
    cancelDeepResearchJobsForOtherVaults(id);
    upgradeWorldbuildingDemoDynasties();
    upgradeWorldbuildingDemoImageQuality();
    upgradeWorldbuildingDemoNarrativeDepth();
    relocalizeWorldbuildingDemoData();
    reconcileAuthorLayerOnce();
    reconcileAuthorRolesOnce();
    repairGraphIntegrityOnce();
    repairDocumentSupportPassagesOnce();

    const settings = getSettings();
    if (settings.syncMode === 'realtime') startRealtimeSync();
    startNodusServerSync();
    // The new vault has its own inbox and its own ledger; the first tick lands within
    // seconds, so switching vaults collects whatever was waiting for that one.
    startInboxPolling();
  startReplicaSync();
    if (settings.mcpEnabled) void startMcpServer().then(() => startMcpTunnelIfConfigured());
    if (settings.copilotEnabled) void startCopilotServer();
    if (settings.zoteroPluginEnabled || settings.browserConnectorEnabled) void startZoteroPluginServer();

    const activeVault = withVaultKeyProviders(getActiveVault());
    emitVaultChanged();
    return {
      ok: true,
      message: vaultSwitchMessage('Bóveda cargada.', copiedProviders),
      activeVault,
      copiedProviders,
    };
  };

  // settings + secrets
  h('settings:get', async () => { const settings = getSettings(); if (settings.academicMode === 'manual') scheduleManualIndex(); return settings; });
  h('ai:concurrency:get', async () => getAiConcurrencySnapshot());
  h('settings:update', async (_e, patch: Partial<AppSettings>) => {
    if(isLearningWorkspace())patch={...patch,autoBackupEnabled:false,autoBackupFolder:path.join(app.getPath('userData'),'storage')};
    const previous = getSettings();
    if (
      patch.browserHistoryRetention !== undefined
      && !['none', '7d', '30d', '90d', '1y', 'forever'].includes(patch.browserHistoryRetention)
    ) {
      throw new Error('The Browser history retention period is not valid.');
    }
    if (patch.browserClearHistoryOnClose !== undefined && typeof patch.browserClearHistoryOnClose !== 'boolean') {
      throw new Error('The Browser history close policy is not valid.');
    }
    if (patch.pipelineLogRetention !== undefined && !isPipelineLogRetention(patch.pipelineLogRetention)) {
      throw new Error('The processing log retention period is not valid.');
    }
    if (patch.pipelineLogMaxEntries !== undefined && !isPipelineLogMaxEntries(patch.pipelineLogMaxEntries)) {
      throw new Error('The processing log entry limit is not valid.');
    }
    if (
      patch.pipelineLogLanguage !== undefined
      && normalizeUiLanguage(patch.pipelineLogLanguage) !== patch.pipelineLogLanguage
    ) {
      throw new Error('The processing log language is not valid.');
    }
    if (patch.backupCleanupEnabled !== undefined && typeof patch.backupCleanupEnabled !== 'boolean') {
      throw new Error('El estado de la limpieza automática no es válido.');
    }
    if (patch.backupRetentionValue !== undefined || patch.backupRetentionUnit !== undefined) {
      const value = patch.backupRetentionValue ?? previous.backupRetentionValue;
      const unit = patch.backupRetentionUnit ?? previous.backupRetentionUnit;
      if (!retentionCutoff(value, unit)) throw new Error('La antigüedad de limpieza no es válida.');
    }
    if (patch.backupCleanupEnabled === true) {
      const folder = patch.autoBackupFolder ?? previous.autoBackupFolder;
      if (!folder || !hasBackupPassword()) {
        throw new Error('Configura primero la carpeta de Recuperación y la contraseña maestra.');
      }
    }
    const next = updateSettings(patch);
    if (next.academicMode === 'manual' && (patch.embeddingProvider !== undefined || patch.embeddingModel !== undefined)) scheduleManualIndex(true);
    if (patch.aiConcurrencyMode !== undefined || patch.concurrency !== undefined) {
      refreshAiConcurrencyPolicy();
    }
    // Concurrency is deliberately NOT calibrated here. Selecting a local model used
    // to enqueue a blocking synthetic benchmark that every later local request had
    // to wait behind, which on a CPU fallback looked like a frozen app (issue #851).
    // The conservative single slot stays in force until the user asks for a
    // measurement from Settings → Modelos IA.
    if (patch.documentIndexingEnabled !== undefined || patch.documentIndexIncludeArchived !== undefined) {
      await documentIndexQueue.configureContinuous(getActiveVault().id, next.documentIndexingEnabled);
    }
    if (patch.browserHistoryRetention !== undefined) {
      await browserHistoryRepository().list(next.browserHistoryRetention);
    }
    // The reader chooses these while looking at the log, so the new horizon has to apply on
    // the spot instead of at the next scheduled prune.
    if (patch.pipelineLogRetention !== undefined || patch.pipelineLogMaxEntries !== undefined) {
      applyPipelineLogLimits();
    }
    if (patch.theme !== undefined && next.theme !== previous.theme) {
      setBrowserTheme(next.theme);
      getWindow()?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff');
    }
    if (patch.uiLanguage !== undefined && next.uiLanguage !== previous.uiLanguage) {
      relocalizeWorldbuildingDemoData(next.uiLanguage);
    }
    if (patch.syncMode) {
      if (next.syncMode === 'realtime') startRealtimeSync();
      else stopRealtimeSync();
    }
    if (patch.mcpEnabled !== undefined || patch.mcpPort !== undefined || patch.mcpToken !== undefined) {
      await stopMcpTunnel();
      if (next.mcpEnabled) {
        await restartMcpServer();
        void startMcpTunnelIfConfigured();
      } else await stopMcpServer();
    }
    if (
      patch.nodusServerEnabled !== undefined ||
      patch.nodusServerAutoSync !== undefined ||
      patch.nodusServerUrl !== undefined ||
      patch.nodusServerSpaceId !== undefined ||
      patch.nodusServerIncludeUserContent !== undefined ||
      patch.nodusServerIncludePassages !== undefined ||
      patch.nodusServerIncludePrimarySources !== undefined ||
      patch.nodusServerIncludeTestimonies !== undefined ||
      patch.nodusServerIncludeLibraryDocuments !== undefined ||
      patch.nodusServerIncludeVectors !== undefined
    ) {
      restartNodusServerSync();
      // The pause switch and the space id both change what the poller may ask for.
      startInboxPolling();
    }
    // The port and the access path decide which addresses the local server binds and whether it
    // presents a certificate at all, so a running one has to come back up under the new setting.
    // Without this a switch to the local-network path would leave it quietly loopback-only.
    if (patch.localServerPort !== undefined || patch.localServerAccess !== undefined) {
      // Leaving Tailscale — or moving to another port while on it — has to take the forward down
      // with it, against the port it was actually configured for, which is the previous one.
      const before = { access: previous.localServerAccess, port: previous.localServerPort };
      const after = { access: next.localServerAccess, port: next.localServerPort };
      if (forwardOutlivedSetting(before, after)) {
        void stopTailscaleServe(before.port).catch(() => undefined);
      }
      if (next.localServerEnabled) void restartLocalServer();
    }
    if (patch.copilotEnabled !== undefined || patch.copilotPort !== undefined) {
      if (next.copilotEnabled) await restartCopilotServer();
      else await stopCopilotServer();
    }
    if (
      patch.zoteroPluginEnabled !== undefined ||
      patch.zoteroPluginPort !== undefined ||
      patch.zoteroPluginToken !== undefined ||
      patch.browserConnectorEnabled !== undefined ||
      patch.browserConnectorToken !== undefined
    ) {
      if (next.zoteroPluginEnabled || next.browserConnectorEnabled) await restartZoteroPluginServer();
      else await stopZoteroPluginServer();
    }
    if (patch.mascotEnabled !== undefined || patch.mascotAlwaysOnTop !== undefined || patch.mascotScale !== undefined) {
      applyMascotWindow();
    }
    // Turning announcements back on asks straight away. The alternative is a panel that
    // stays empty for up to four hours after the user opted in, which reads as broken.
    if (patch.announcementsEnabled === true) void refreshAnnouncements('setting enabled');
    if (patch.betaUpdates !== undefined && next.betaUpdates !== previous.betaUpdates) {
      updateChannelChanged(next.betaUpdates);
    }
    // Let other windows (the Nodi overlay) react to setting changes, e.g. costumes.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:changed', next);
    }
    // Persist portable profile changes without putting an offline Server on the critical
    // path of the local Settings screen. The replica poller retries after reconnection.
    void syncActiveServerProfilePreferences(next).catch(() => undefined);
    return next;
  });

  // Nodi companion: notifications, chat, and overlay-window helpers.
  h('nodi:tutorialVisible', (_e, visible: boolean) => setMascotTutorialVisible(Boolean(visible)));
  setNotificationsNotifier(() => {
    const list = listNotifications();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('nodi:notifications:changed', list);
    }
  });
  h('nodi:notifications:list', async () => listNotifications());
  h('nodi:notifications:refresh', async () => {
    const refresh = await refreshAnnouncements('manual');
    await radarService().check({ reason: 'manual' }).catch(() => null);
    const notifications = listNotifications();
    const announcements = listAnnouncements();
    // Refresh every renderer, not only the button that initiated the check. Nodi can
    // live in its own always-on-top window, and the header must update at the same time.
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('nodi:notifications:changed', notifications);
      win.webContents.send('announcements:changed', announcements);
    }
    return { notifications, announcements, refresh };
  });
  h('nodi:notifications:markRead', async () => {
    markAllNotificationsRead();
    return listNotifications();
  });
  h('nodi:notifications:clear', async () => {
    clearNotifications();
    clearAnnouncements();
    return listNotifications();
  });
  h('nodi:notifications:open', async (_event, id: string) => {
    const notification = listNotifications().find((candidate) => candidate.id === String(id));
    if (!notification) return;
    markNotificationRead(notification.id);
    const win = getWindow();
    if (!win || !notification.action) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (notification.action.type === 'radar') {
      win.webContents.send('nodi:navigate', { view: 'radar', updateId: notification.action.updateId });
    }
  });
  setAnnouncementsNotifier(() => {
    const list = listAnnouncements();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('announcements:changed', list);
    }
  });
  h('announcements:list', async () => listAnnouncements());
  h('announcements:markRead', async (_e, id: string) => markAnnouncementRead(String(id)));
  const skillsChanged = (skills: ReturnType<typeof listChatSkills>) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('chatSkills:changed');
    return skills;
  };
  h('skillMarketplace:get', async () => getSkillMarketplace());
  const marketplaceChanged = (state: ReturnType<typeof getSkillMarketplace>) => { skillsChanged(listChatSkills()); return state; };
  h('skillMarketplace:add', async (_e, url: string) => marketplaceChanged(addSkillSource(url)));
  h('skillMarketplace:remove', async (_e, id: string) => marketplaceChanged(removeSkillSource(id)));
  h('skillMarketplace:update', async (_e, id: string) => marketplaceChanged(await updateSkillSource(id)));
  h('skillMarketplace:install', async (_e, sourceId: string, packagePath: string, commit: string) => skillsChanged(installMarketplaceSkill(sourceId, packagePath, commit)));
  h('skillMarketplace:installPlugin', async (_e, sourceId: string, packagePath: string, commit: string, approvePermissions: boolean) => skillsChanged(installMarketplacePlugin(sourceId, packagePath, commit, approvePermissions === true)));
  h('skillMarketplace:import', async () => {
    const result = await showImportOpenDialog({ title: dialogTitle('importSkillPackageDirectory', getSettings().uiLanguage), properties: ['openDirectory'] });
    if (result.canceled) return listChatSkills();
    const directory = result.filePaths[0];
    if (!fs.existsSync(path.join(directory, 'plugin.json'))) return skillsChanged(importSkillDirectory(directory));
    const pkg = readPluginDirectory(directory), permissions = mergedPluginPermissions(pkg);
    const consent = await dialog.showMessageBox({ type: 'question', title: `Install ${pkg.manifest.name}?`, message: `${pkg.manifest.name} ${pkg.manifest.version}`, detail: `Skills: ${pkg.skills.length}\nCapabilities: ${pkg.capabilities.length}\nHTTPS endpoints: ${permissions.network?.map(item => item.origin).join(', ') || 'none'}\nSecrets: ${permissions.secrets?.map(item => item.label).join(', ') || 'none'}\nStorage: ${permissions.storage?.maxBytes ?? 0} bytes\n\nCapability code runs only in the Nodus Chromium sandbox.`, buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0 });
    return consent.response === 1 ? skillsChanged(installChatPluginPackage(pkg, { sourceId: 'local', sourcePath: directory, approvePermissions: true, autoUpdate: false })) : listChatSkills();
  });
  h('skillMarketplace:export', async (_e, id: string) => {
    const result = await showImportOpenDialog({ title: dialogTitle('exportSkillPackageDirectory', getSettings().uiLanguage), properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : exportSkillDirectory(id, result.filePaths[0]);
  });
  h('chatSkills:list', async () => listChatSkills());
  h('documentSkills:list', async () => listDocumentSkills());
  h('documentVisuals:get', async (_event, target) => getDocumentVisuals(target));
  h('documentVisuals:enrich', async (_event, target, policy, options) => enrichDocumentVisuals(target, policy, { retry: options?.retry === true, model: asDocumentVisualModel(options?.model) }));
  h('documentVisuals:cancel', async (_event, target) => cancelDocumentVisuals(target));
  h('documentVisuals:undo', async (_event, target) => undoVisualEnrichment(target));
  h('documentVisuals:remove', async (_event, target, id) => removeDocumentFigure(target, id));
  h('chatSkills:save', async (_e, skill) => skillsChanged(saveChatSkill(skill)));
  h('chatSkills:delete', async (_e, id: string) => skillsChanged(deleteChatSkill(id)));
  h('chatSkills:restore', async () => skillsChanged(restoreChatSkills()));
  h('plugins:list', async () => listInstalledPlugins());
  h('plugins:inbox', async () => listInboxPlugins());
  h('plugins:approveInbox', async (_e, directory: string) => {
    // Inbox content is inert until the user reads these permissions and accepts them.
    const pkg = readInboxPlugin(String(directory)), permissions = mergedPluginPermissions(pkg);
    const consent = await dialog.showMessageBox({ type: 'question', title: `Install ${pkg.manifest.name}?`, message: `${pkg.manifest.name} ${pkg.manifest.version}`, detail: `Skills: ${pkg.skills.length}\nCapabilities: ${pkg.capabilities.length}\nHTTPS endpoints: ${permissions.network?.map(item => item.origin).join(', ') || 'none'}\nSecrets: ${permissions.secrets?.map(item => item.label).join(', ') || 'none'}\nStorage: ${permissions.storage?.maxBytes ?? 0} bytes\n\nCapability code runs only in the Nodus Chromium sandbox.`, buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0 });
    if (consent.response !== 1) return listChatSkills();
    const skills = skillsChanged(installChatPluginPackage(pkg, { sourceId: 'inbox', sourcePath: String(directory), approvePermissions: true, autoUpdate: false }));
    discardInboxPlugin(String(directory));
    return skills;
  });
  h('plugins:discardInbox', async (_e, directory: string) => { discardInboxPlugin(String(directory)); return listInboxPlugins(); });
  h('plugins:approve', async (_e, id: string) => skillsChanged(approvePendingChatPlugin(String(id))));
  h('plugins:autoUpdate', async (_e, id: string, enabled: boolean) => setPluginAutoUpdate(String(id), enabled === true));
  h('plugins:rollback', async (_e, id: string) => skillsChanged(rollbackChatPlugin(String(id))));
  h('plugins:remove', async (_e, id: string) => skillsChanged(removeChatPlugin(String(id))));
  h('plugins:secret', async (_e, pluginId: string, capabilityId: string, secretId: string, value: string) => configurePluginSecret(String(pluginId), String(capabilityId), String(secretId), String(value)));
  h('plugins:restoreSkill', async (_e, id: string) => skillsChanged(restorePluginSkillAuthorVersion(String(id))));
  h('chatImages:metadata', async (_e, source: string) => getChatImageMetadata(source));
  h('chatImages:copy', async (_e, source: string) => {
    if (!source.startsWith('nodus-image://chat/')) throw new Error('Invalid chat image.');
    const payload = originalImagePayloadFromUrl(source);
    if (!payload) throw new Error('The image is no longer available.');
    const image = nativeImage.createFromBuffer(payload.blob);
    if (image.isEmpty()) throw new Error('The image could not be copied.');
    clipboard.writeImage(image);
  });
  /** The bytes of a stored 3D model, for the built-in viewer.
   *
   *  Read back through the same validation the capability's asset passed on the way in.
   *  The file has not changed since, so this is not about distrusting it — it is that a
   *  viewer should never be the first thing to look at bytes it is about to parse, and a
   *  profile restored from a mismatched backup is a real way for that to happen. */
  h('capabilityFiles:model', async (_e, source: string) => {
    const payload = getCapabilityFile(String(source));
    if (!payload) throw new Error('The 3D model is no longer available.');
    const info = validateModelAsset(new Uint8Array(payload.blob), payload.mimeType);
    return { bytes: payload.blob, mimeType: payload.mimeType, name: payload.name, info };
  });

  /** The bytes of a stored image or sound file, checked again on the way out for the same
   *  reason a model is: a viewer should not be the first thing to look at bytes it is
   *  about to decode. */
  h('capabilityFiles:media', async (_e, source: string) => {
    const payload = getCapabilityFile(String(source));
    if (!payload) throw new Error('That file is no longer available.');
    const info = validateMediaAsset(new Uint8Array(payload.blob), payload.mimeType);
    return { bytes: payload.blob, mimeType: payload.mimeType, name: payload.name, info };
  });

  h('capabilityFiles:download', async (_e, source: string) => {
    const payload = getCapabilityFile(String(source)); if (!payload) throw new Error('The capability file is no longer available.');
    const result = await dialog.showSaveDialog({ title: dialogTitle('saveCapabilityFile', getSettings().uiLanguage), defaultPath: path.join(app.getPath('downloads'), payload.name) });
    if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, payload.blob, { mode: 0o600 });
  });
  h('nodi:conversations:list', async () => listNodiConversations());
  h('nodi:conversations:get', async (_e, id: string) => getNodiConversation(id));
  h('nodi:conversations:save', async (_e, input) => saveNodiConversation(input));
  h('nodi:conversations:delete', async (_e, id: string) => deleteNodiConversation(id));
  h('nodi:conversations:clear', async () => clearNodiConversations());
  h('nodi:notes:list', async () => listNodiNotes());
  h('nodi:notes:save', async (_e, input) => saveNodiNote(input));
  h('nodi:notes:delete', async (_e, id: string) => deleteNodiNote(id));
  h('nodi:chatStream', async (e, requestId: string, request: NodiChatRequest) => {
    const controller = new AbortController();
    nodiChatAborters.set(requestId, controller);
    try {
      return await streamNodiChat(request, (delta) => e.sender.send('nodi:chatStream:delta', requestId, delta), controller.signal);
    } finally {
      nodiChatAborters.delete(requestId);
    }
  });
  h('nodi:chatStream:cancel', async (_e, requestId: string) => {
    nodiChatAborters.get(requestId)?.abort();
  });
  h('nodi:viewContext:set', async (_e, context) => setNodiViewContext(context));
  h('nodi:viewContext:get', async () => getNodiViewContext());
  h('nodi:quoteSelection:set', async (_e, text: string) => {
    const selection = setNodiQuoteSelection(text);
    if (!selection) return null;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('nodi:quoteSelection', selection);
    }
    return selection;
  });
  h('nodi:quoteSelection:consume', async () => consumeNodiQuoteSelection());
  // The overlay's mouse hit-test transition. Asynchronous on purpose: the flag is
  // applied when the main process next reaches its event loop, which is exactly
  // when a `sendSync` would have been serviced too — the synchronous form only
  // added a stall of Nodi's own renderer while heavy work held the loop.
  ipcMain.on('nodi:setMouseIgnore:async', (e, ignore: boolean) => {
    assertNotBrowserIpcSender(e);
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });
  h('nodi:overlayPlacement:get', async () => getMascotWindowPlacement());
  h('nodi:setExpanded', async (e, expanded: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    const nextPlacement = setMascotWindowExpanded(win, Boolean(expanded));
    return nextPlacement;
  });
  h('nodi:openMainWindow', async () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  h('nodi:openSettings', async () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('nodi:navigate', 'settings');
    }
  });
  h('nodi:openWorldEntry', async (_e, kind: string, id: string) => {
    const viewByKind: Record<string, string> = {
      character: 'characters',
      place: 'places',
      group: 'factions',
      scene: 'scenes',
      article: 'encyclopedia',
      map: 'map',
      rule: 'rules',
      conflict: 'conflicts',
    };
    const view = viewByKind[kind];
    const win = getWindow();
    if (!view || !win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('nodi:navigate', { view, kind, id });
  });
  h('nodi:windowDrag:begin', async (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    return beginMascotWindowDrag(win, screenX, screenY);
  });
  h('nodi:windowDrag:move', async (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    return dragMascotWindow(win, screenX, screenY);
  });
  h('nodi:windowDrag:end', async () => {
    endMascotWindowDrag();
  });
  h('vaults:list', async () => isLearningWorkspace()?[]:listVaults().map(withVaultKeyProviders));
  h('learning:workspace',async()=>learningWorkspaceInfo());
  h('learning:workspace:open',async(event,lessonId)=>openLearningWorkspace(lessonId,BrowserWindow.fromWebContents(event.sender)));
  h('learning:workspace:ready',async()=>learningWorkspaceReady());
  h('learning:workspace:close',async(_event,discard)=>closeLearningWorkspace(discard===true));
  h('learning:update', async (_event, vaultId, input) => {
    const target=getVault(vaultId);
    if(!target || target.type!=='academic')throw new Error('Invalid learning scope.');
    const patch: Partial<AppSettings> = {};
    if (Object.prototype.hasOwnProperty.call(input ?? {}, 'academicLearningProgress')) patch.academicLearningProgress = input.academicLearningProgress;
    if (Object.prototype.hasOwnProperty.call(input ?? {}, 'academicPracticeSession')) {
      if (input.academicPracticeSession && input.academicPracticeSession.vaultId !== vaultId) throw new Error('Invalid learning scope.');
      patch.academicPracticeSession = input.academicPracticeSession;
    }
    const next = await withVaultDatabase(vaultId,()=>updateSettings(patch));
    getWindow()?.webContents.send('settings:changed');
    return getActiveVault().id===vaultId ? next : null;
  });
  h('vaults:getActive', async () => withVaultKeyProviders(getActiveVault()));
  h('vaults:create', async (_e, input: CreateVaultInput) => {
    const modelSelection = validateVaultModelSelection(input);
    const vault = createVault(input.name, input.type);
    try {
      if (modelSelection) initializeVaultModelSelection(vault.path, modelSelection);
      if (vault.type === 'academic') initializeVaultInterfaceProfile(vault.path);
    } catch (cause) {
      deleteVault(vault.id, true);
      throw cause;
    }
    return { vault: withVaultKeyProviders(vault) };
  });
  // ── Connected vaults ──────────────────────────────────────────────────────
  // Two steps by design: the user knows their server address, email and password, but not
  // the space ids, so signing in returns a short-lived ticket plus the spaces the account
  // can actually reach, and the app shows a picker before anything is created on disk.
  h('vaults:remoteSignIn', async (_e, url: string, email: string, password: string) => signInToNodusServer(url, email, password));
  h('vaults:createConnected', async (_e, input: {
    url: string; ticket: string; space: RemoteSpaceOption; userEmail: string; serverName: string; serverKind?: 'classic' | 'cloudflare';
  }) => ({ vault: withVaultKeyProviders(await createConnectedVault(input)) }));
  h('vaults:replicaOverview', async () => getReplicaOverview());
  h('vaults:replicaSyncNow', async (_e, vaultId: string) => syncReplicaNow(vaultId));
  h('vaults:replicaPresence', async (_e, vaultId: string) => listReplicaPresence(vaultId));
  h('vaults:replicaUpdatePresence', async (_e, vaultId: string, input) => updateReplicaPresence(vaultId, input));
  h('vaults:replicaDetach', async (_e, vaultId: string) => detachReplica(vaultId));

  h('vaults:rename', async (_e, id: string, name: string) => withVaultKeyProviders(renameVault(id, name)));
  h('vaults:setType', async (_e, id: string, type: VaultType) => withVaultKeyProviders(setVaultType(id, type)));
  h('vaults:switch', async (_e, id: string, options?: VaultSwitchOptions) => switchVaultSafely(id, options));
  h('vaults:duplicate', async (_e, id: string, name: string, options?: VaultSwitchOptions) => {
    const source = getVault(id);
    if (!source) throw new Error('Bóveda no encontrada.');
    const tmp = path.join(app.getPath('temp'), `nodus-vault-copy-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      if (source.active) {
        await getDb().backup(tmp);
      } else {
        fs.copyFileSync(source.path, tmp);
      }
      const vault = createVaultFromDatabaseFile(tmp, name, source.type);
      const hasExplicitSource = options && Object.prototype.hasOwnProperty.call(options, 'copyApiKeysFromVaultId');
      const keySource = hasExplicitSource ? options.copyApiKeysFromVaultId ?? null : id;
      const copiedProviders = keySource && keySource !== vault.id ? copyApiKeysBetweenVaults(keySource, vault.id) : [];
      return { vault: withVaultKeyProviders(vault), copiedProviders };
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
  h('migrationRecovery:list', async () => listMigrationRecoverySnapshotsInUtility(getActiveVault().path));
  h('migrationRecovery:open', async (_e, id: string) => {
    const source = getActiveVault();
    return withMigrationRecoverySnapshotsInUtility(source.path, (snapshots) => {
      const snapshot = snapshots.find((candidate) => candidate.id === id);
      if (!snapshot) throw new Error('La copia previa a la migración no existe o ya no supera la validación.');
      const name = `${source.name} · antes de v${snapshot.targetVersion}`;
      const vault = createVaultFromDatabaseFile(snapshot.databasePath, name, source.type);
      return { vault: withVaultKeyProviders(vault) };
    });
  });
  h('vaults:delete', async (_e, id: string, deleteFiles?: boolean) => {
    deleteVault(id, Boolean(deleteFiles));
  });
  h('vaults:reset', async (_e, id: string) => {
    const target = getVault(id);
    if (!target) throw new Error('Bóveda no encontrada.');
    if (target.active) {
      const busy = vaultBusyMessage();
      if (busy) throw new Error(busy);
    }
    await documentIndexQueue.pauseVaultAndDrain(id);
    try {
      if (target.active) {
      stopRealtimeSync();
      stopNodusServerSync();
      stopInboxPolling();
      stopReplicaSync();
      await stopMcpTunnel();
      await stopMcpServer();
      await stopCopilotServer();
      await stopZoteroPluginServer();
      interruptDecorativeImageGenerations();
      closeDb();
      const reset = resetVaultDatabase(id);
      getDb();
      reconcileAuthorLayerOnce();
      reconcileAuthorRolesOnce();
      repairGraphIntegrityOnce();
      repairDocumentSupportPassagesOnce();
      const settings = getSettings();
      if (settings.syncMode === 'realtime') startRealtimeSync();
      startNodusServerSync();
      startInboxPolling();
  startReplicaSync();
      if (settings.mcpEnabled) void startMcpServer().then(() => startMcpTunnelIfConfigured());
      if (settings.copilotEnabled) void startCopilotServer();
      if (settings.zoteroPluginEnabled) void startZoteroPluginServer();
      emitVaultChanged();
      return withVaultKeyProviders(reset);
      }
      return withVaultKeyProviders(resetVaultDatabase(id));
    } finally {
      await documentIndexQueue.resumeVaultAfterMaintenance(id);
    }
  });
  const analysisReuseControllers = new Map<string, AbortController>();
  h('vaults:reuseAnalysis', async (_e, nodusIds: string[], operationId?: string) => {
    const busy = vaultBusyMessage();
    if (busy) throw new Error(busy);
    const id = operationId?.trim();
    const controller = new AbortController();
    if (id) analysisReuseControllers.set(id, controller);
    try {
      return await reuseVaultAnalysisForWorks(nodusIds, { signal: controller.signal });
    } finally {
      if (id && analysisReuseControllers.get(id) === controller) analysisReuseControllers.delete(id);
    }
  });
  h('vaults:cancelReuseAnalysis', async (_e, operationId: string) => {
    const controller = analysisReuseControllers.get(operationId.trim());
    if (!controller) return false;
    controller.abort();
    return true;
  });
  h('vaults:copyApiKeys', async (_e, sourceVaultId: string, targetVaultId: string) => ({
    copiedProviders: copyApiKeysBetweenVaults(sourceVaultId, targetVaultId),
  }));




  // ── Core: sync, backups, recovery, updates ─────────────────────────────────
  // Regrouped here so the academic and study channels above form one range. They
  // used to sit inside it, which is why extracting that range needed this first.
  h('sync:now', async (_e, options?: { catalogOnly?: boolean }) => fullSync('manual', {
    catalogOnly: options?.catalogOnly === true,
  }));
  h('sync:log', async () => getSyncLog());
  // automatic encrypted backups (master password lives in the OS keychain)
  h('sync:hasPassphrase', async () => hasSyncPassphrase());
  h('sync:setPassphrase', async (_e, passphrase: string) => {
    const validation = validateBackupPassword(passphrase);
    if (!validation.valid) {
      throw new Error('La frase de sincronización debe tener al menos 8 caracteres.');
    }
    setSyncPassphrase(validation.normalized);
  });
  h('sync:clearPassphrase', async () => clearSyncPassphrase());
  h('backup:setPassword', async (_e, password: string) => {
    const validation = validateBackupPassword(password);
    if (!validation.valid) {
      throw new Error('La contraseña maestra debe tener al menos 8 caracteres.');
    }
    setBackupPassword(validation.normalized);
  });
  h('backup:clearPassword', async () => clearBackupPassword());
  h('backup:hasPassword', async () => hasBackupPassword());
  h('backup:chooseFolder', async () => {
    const { canceled, filePaths } = await showImportOpenDialog({
      title: dialogTitle('chooseBackupFolder', getSettings().uiLanguage),
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });
  h('backup:runNow', async () => runAutoBackupNow(app.getVersion()));
  h('backup:cleanupPreview', async () => previewBackupCleanup());
  h('backup:cleanupRunNow', async (_e, scopeToken: string) => {
    if (!/^[a-f0-9]{64}$/.test(scopeToken)) throw new Error('La confirmación de limpieza no es válida. Revisa de nuevo el alcance.');
    return runBackupCleanupNow(new Date(), scopeToken);
  });
  h('backup:saveRecoveryKit', async () => {
    const password = getBackupPassword();
    const recoveryKey = getBackupRecoveryKey();
    const language = getSettings().uiLanguage;
    const es = language === 'es';
    if (!password) return { ok: false, message: es ? 'No hay contraseña maestra configurada.' : 'No master password is configured.' };
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogTitle('saveRecoveryKit', getSettings().uiLanguage),
      defaultPath: path.join(app.getPath('documents'), es ? 'nodus-kit-de-recuperacion.txt' : 'nodus-recovery-kit.txt'),
      filters: [{ name: es ? 'Texto' : 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, message: es ? 'Cancelado' : 'Cancelled' };
    fs.writeFileSync(
      filePath,
      (es ? [
        'NODUS — KIT DE RECUPERACIÓN DE COPIAS DE SEGURIDAD', '',
        `Contraseña maestra: ${password}`,
        `Clave de recuperación independiente: ${recoveryKey ?? 'No disponible en copias antiguas'}`,
        `Frase de sincronización (.nodussync): ${getSyncPassphrase() ?? 'No configurada'}`, '',
        'Puedes restaurar las copias nuevas con cualquiera de las dos credenciales.',
        'Guárdalas fuera de este dispositivo, preferiblemente en un gestor de contraseñas',
        'o impresas en un lugar seguro. Las copias cifradas incluyen todo Nodus,',
        'también las claves API. El token MCP local nunca se exporta.',
        `Generado: ${new Date().toISOString()}`,
      ] : [
        'NODUS — BACKUP RECOVERY KIT', '',
        `Master password: ${password}`,
        `Independent recovery key: ${recoveryKey ?? 'Not available for legacy snapshots'}`,
        `Sync passphrase (.nodussync): ${getSyncPassphrase() ?? 'Not configured'}`, '',
        'New snapshots can be restored with either credential.',
        'Store them away from this device, preferably in a password manager or',
        'printed in a safe place. Encrypted snapshots include all of Nodus, including',
        'API keys. The local MCP token is never exported.',
        `Generated: ${new Date().toISOString()}`,
      ]).join('\n')
    );
    return { ok: true, message: filePath };
  });
  // Never rejects: the built-in list is always a complete answer (see tutorialCatalogue).
  h('tutorials:catalogue', async () => getTutorialCatalogue());
  h('recovery:status', async () => getRecoveryStatus());
  h('recovery:chooseFolder', async (_e, mode: 'create' | 'restore', language: AppLanguage = 'es') => {
    const titles: Record<AppLanguage, string> = {
      en: mode === 'restore' ? 'Select a Nodus recovery folder' : 'Select an empty folder to protect Nodus',
      es: mode === 'restore' ? 'Seleccionar una carpeta de recuperación de Nodus' : 'Seleccionar una carpeta vacía para proteger Nodus',
      fr: mode === 'restore' ? 'Sélectionner un dossier de récupération Nodus' : 'Sélectionner un dossier vide pour protéger Nodus',
      de: mode === 'restore' ? 'Nodus-Wiederherstellungsordner auswählen' : 'Leeren Ordner zum Schutz von Nodus auswählen',
      pt: mode === 'restore' ? 'Selecionar uma pasta de recuperação do Nodus' : 'Selecionar uma pasta vazia para proteger o Nodus',
      'pt-BR': mode === 'restore' ? 'Selecionar uma pasta de recuperação do Nodus' : 'Selecionar uma pasta vazia para proteger o Nodus',
      it: mode === 'restore' ? 'Seleziona una cartella di ripristino Nodus' : 'Seleziona una cartella vuota per proteggere Nodus',
      tr: mode === 'restore' ? 'Bir Nodus kurtarma klasörü seçin' : 'Nodus\'u korumak için boş bir klasör seçin',
      'zh-CN': mode === 'restore' ? '选择 Nodus 恢复文件夹' : '选择一个空文件夹以保护 Nodus',
      'zh-TW': mode === 'restore' ? '選擇 Nodus 恢復資料夾' : '選擇一個空資料夾以保護 Nodus',
      ja: mode === 'restore' ? 'Nodus の復元フォルダを選択' : 'Nodus を保護する空のフォルダを選択',
      ko: mode === 'restore' ? 'Nodus 복구 폴더 선택' : 'Nodus를 보호할 빈 폴더 선택',
    };
    const { canceled, filePaths } = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: titles[language],
      properties: mode === 'restore' ? ['openDirectory'] : ['openDirectory', 'createDirectory'],
    });
    return canceled || filePaths.length === 0
      ? null
      : inspectRecoveryFolderSafely(filePaths[0], language, 'deep');
  });
  h('recovery:initialize', async (_e, folder: string, password: string, language: AppLanguage = 'es') =>
    initializeRecoveryFolder(folder, password, app.getVersion(), language)
  );
  h('recovery:restore', async (event, root: string, fileName: string, password: string, language: AppLanguage = 'es', requestId = '') => {
    let lastSentAt = 0;
    let lastPhase: RecoveryRestoreProgress['phase'] | null = null;
    const report = (progress: RecoveryRestoreProgress) => {
      if (!requestId || event.sender.isDestroyed()) return;
      const now = Date.now();
      const phaseChanged = progress.phase !== lastPhase;
      const phaseComplete = progress.totalBytes > 0 && progress.completedBytes >= progress.totalBytes;
      if (!phaseChanged && !phaseComplete && now - lastSentAt < 80) return;
      lastSentAt = now;
      lastPhase = progress.phase;
      event.sender.send('recovery:restore:progress', requestId, progress);
    };
    const result = await restoreRecoverySnapshot(root, fileName, password, app.getVersion(), language, report);
    if (result.ok) {
      stopNodusServerSync();
      stopInboxPolling();
      stopReplicaSync();
      await stopMcpTunnel();
      await stopMcpServer();
    }
    return result;
  });
  // Versions a merge discarded. Read/restore only — nothing here deletes on a timer.
  h('sync:supersededCount', async () => countSuperseded());
  h('sync:supersededList', async (_e, limit?: number, offset?: number) => listSuperseded(limit, offset));
  h('sync:supersededRestore', async (_e, id: string) => restoreSuperseded(id));
  h('sync:supersededClear', async (_e, ids?: string[]) => clearSuperseded(ids));

  h('updates:check', async () => checkForUpdates());
  h('updates:install', async () => installUpdate());
  h('updates:status', async () => getUpdateStatus());

  // Dynamic macOS dock icon. The renderer rasterises a themed, vault-coloured
  // Nodus mark to a PNG data URL and pushes it here; only macOS exposes
  // app.dock. No-op (and never throws) on Windows/Linux.
  h('dock:setIcon', async (_e, pngDataUrl: string) => {
    setPersistentDockIcon(pngDataUrl);
  });
  const activeVault = getActiveVault();
  if (activeVault.type === 'databases') ensureDatabaseDeepResearchLane(activeVault.id);
}
