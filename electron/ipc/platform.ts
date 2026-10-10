import { localizeRuntimeError } from '@shared/uiLanguage';
// platform channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import { dialogTitle } from '../dialogTitles';
import { localizedForUi, type IpcContext } from './context';
import { BrowserWindow } from 'electron';
import { originalImagePayloadFromUrl } from '../imageProtocol';
import { openPrivacyPolicy } from '../privacy';
import type { AudioEntityKind, AudioProvider, AudioSegmentRequest, AiProvider, LocalProvider, ZoteroLibrary, EmbeddingProvider, TranslationEntityKind, GenerateTranslationRequest, DecorativeImageActionRequest, DecorativeImageEntityKind, DecorativeImageStyle, StudyPronunciationEntry } from '@shared/types';
import { connectMcpTunnel, disconnectMcpTunnel, forgetMcpTunnel, getMcpStatus, getMcpTunnelStatus, regenerateMcpToken, restartMcpTunnelIfConfigured } from '../mcp';
import { getCopilotStatus, regenerateCopilotToken } from '../copilot/server';
import { getZoteroPluginStatus, regenerateBrowserConnectorToken, regenerateZoteroPluginToken, resolveBrowserConnectorPairingRequest } from '../zotero-plugin/server';
import { exportZoteroPluginXpi, getZoteroInstallInfo, installZoteroPlugin } from '../zotero-plugin/install';
import { exportBrowserConnectorZip } from '../browser-connector/install';
import { ensureCopilotCert } from '../copilot/certs';
import { installCopilotAddin, installLibreOfficeCopilot } from '../copilot/install';
import { setApiKey, clearApiKey, getApiKey, getLocalServerAdminPassword } from '../secrets/secretStore';
import { recoverLegacyApiKeys } from '../secrets/legacySecretRecovery';
import { listEmbeddingModels, listModels, testCustomProvider, testLocalProvider } from '../ai/providers';
import { getModelCatalog } from '../ai/modelCatalog';
import { cancelChatGptSubscriptionLogin, getChatGptSubscriptionStatus, listChatGptSubscriptionModels, logoutChatGptSubscription, startChatGptSubscriptionLogin } from '../ai/codexSubscription';
import { cancelGitHubCopilotSubscriptionLogin, getGitHubCopilotSubscriptionStatus, listGitHubCopilotSubscriptionModels, logoutGitHubCopilotSubscription, startGitHubCopilotSubscriptionLogin } from '../ai/githubCopilotSubscription';
import { getOpenCodeGoUsageStatus } from '../ai/openCodeGoUsage';
import { listImageModels } from '../ai/imageModels';
import { deleteDecorativeImage, queueDecorativeImageGeneration, revertDecorativeImage, saveCustomDecorativeImage, streamDecorativeImageContext } from '../ai/decorativeImages';
import { getDecorativeImage, getDecorativeImageData } from '../db/decorativeImagesRepo';
import { clearEntityClips, deleteClip as deleteAudioClip, deleteEntityClips, getEntitySegments, audioClipPath, createStudyAudioBookmark, deleteStudyAudioBookmark, getStudyPronunciations, listStudyAudioBookmarks, listStudyAudioPlaylist, listEntityClips, readClipBytes, saveClip, setStudyPronunciations } from '../audio/audioService';
import { clearHumeKey, humeHasKey, listHumeVoices, setHumeKey, synthesizeHume } from '../audio/hume';
import { disconnectNodusServerVault, getNodusServerOverview, pairNodusServer, setNodusServerLanguage, syncNodusServerVaultNow } from '../serverSync/serverSyncService';
import { clearServerInbox, clearServerInboxEntry, listServerInbox, markServerInboxRead } from '../db/serverInboxRepo';
import { localServerStatusAsync, restartLocalServer, startLocalServer, stopLocalServer } from '../localServer/process';
import { connectActiveVaultToLocalServer } from '../localServer/connect';
import { startTailscaleServe, stopTailscaleServe } from '../localServer/tailscale';
import { holdAwake, holdLid, powerStatus, recordPowerError, releaseAwake, releaseLid } from '../localServer/power';
import { getAcademicHomeStats } from '../db/homeRepo';
import { calibrateNodusLocalRuntimeConcurrency, cancelNodusLocalDownloads, deleteNodusLocalModel, downloadNodusLocalModel, getNodusLocalAiStatus, installNodusLocalRuntime, recheckNodusLocalRuntime } from '../ai/nodusLocalAi';
import { deleteNodusLocalImageModel, downloadNodusLocalImageModel, getNodusLocalImageStatus, installNodusLocalImageRuntime } from '../ai/nodusLocalImages';
import { TRANSLATION_LANGUAGES } from '@shared/types';
import { listLocalAiDiagnostics } from '../ai/localRequestPlanner';
import { translateMarkdown, titleFromMarkdown } from '../ai/translate';
import {mobileTranslationContext, beginMobileTranslation, saveMobileTranslation, failMobileTranslation} from '../ai/mobileTranslation';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { shell, dialog, app } from 'electron';
import type { AppLanguage } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { stopMcpTunnel } from '../mcp';
import { restartCopilotServer } from '../copilot/server';
import { runAutoBackupNow } from '../export/autoBackup';
import * as zotero from '../zotero/zoteroClient';
import { getSyncLog } from '../db/syncRepo';
import { scanQueue } from '../pipeline/scanQueue';
import { getCorpusHealth } from '../db/corpusHealthRepo';
import * as translationsRepo from '../db/translationsRepo';
import { completeCloudflareDirectDeployment, getCloudflareDeployState, prepareCloudflareDirectDeployment, previewCloudflareDeployment } from '../cloudflare/deployment';
import { createDesktopBridgeOffer, desktopBridgeStatus, revokeDesktopBridgePairing } from '../desktopBridge/server';
import type { DesktopBridgeDomain } from '@shared/types';

function extensionForOriginalImage(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/bmp': return 'bmp';
    case 'image/tiff': return 'tiff';
    case 'image/svg+xml': return 'svg';
    case 'image/avif': return 'avif';
    default: return 'jpg';
  }
}
function originalImageFileName(label: string | null | undefined, mime: string): string {
  const base =
    (label ?? '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 120)
    || 'imagen';
  return `${base}.${extensionForOriginalImage(mime)}`;
}

export function registerPlatformIpc({ h, getWindow }: IpcContext): void {
  h('mcp:status', async () => getMcpStatus());
  h('mcp:regenerateToken', async () => {
    await stopMcpTunnel();
    const token = await regenerateMcpToken();
    void restartMcpTunnelIfConfigured();
    return token;
  });
  h('mcp:tunnel:status', async () => getMcpTunnelStatus());
  h('mcp:tunnel:connect', async (_e, input) => connectMcpTunnel(input));
  h('mcp:tunnel:disconnect', async () => disconnectMcpTunnel());
  h('mcp:tunnel:forget', async () => forgetMcpTunnel());
  h('nodusServer:overview', async () => getNodusServerOverview());
  h('nodusServer:pair', async (_e, url: string, code: string) => pairNodusServer(url, code));
  h('nodusServer:setLanguage', async (_e, language: AppLanguage, vaultId?: string) => setNodusServerLanguage(language, vaultId));
  h('nodusServer:syncVaultNow', async (_e, vaultId: string) => syncNodusServerVaultNow(vaultId));
  h('nodusServer:disconnectVault', async (_e, vaultId: string) => disconnectNodusServerVault(vaultId));
  h('cloudflare:preview', async (_e, activity) => previewCloudflareDeployment(activity));
  h('cloudflare:prepare', async () => prepareCloudflareDirectDeployment());
  h('cloudflare:complete', async (_e, input) => completeCloudflareDirectDeployment(input));
  h('cloudflare:state', async () => getCloudflareDeployState());
  h('cloudflare:openDeploy', async (_e, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'deploy.workers.cloudflare.com') throw new Error('Nodus solo abre el despliegue oficial de Cloudflare.');
    await shell.openExternal(parsed.toString());
  });
  // The Inbox is per-vault: it reads the open vault's own server_inbox, so switching vaults
  // shows a different one. The mutators return the fresh list rather than making the caller
  // ask again, the same shape as nodi:notifications:markRead.
  h('nodusServer:inbox:list', async () => listServerInbox());
  h('nodusServer:inbox:markRead', async (_e, id?: string) => { markServerInboxRead(id); return listServerInbox(); });
  h('nodusServer:inbox:clear', async (_e, id?: string) => {
    if (id) clearServerInboxEntry(id);
    else clearServerInbox();
    return listServerInbox();
  });
  h('localServer:status', async () => localServerStatusAsync());
  h('localServer:start', async () => {
    updateSettings({ localServerEnabled: true });
    await startLocalServer();
    return localServerStatusAsync();
  });
  h('localServer:stop', async () => {
    const before = getSettings();
    updateSettings({ localServerEnabled: false });
    await stopLocalServer();
    // Off has to mean off. The `tailscale serve` forward is held by the daemon and survives both
    // this application and a reboot, so leaving it would hand the tailnet to whatever binds that
    // port next — including this same server the next time somebody starts it expecting privacy.
    if (before.localServerAccess === 'tailscale') {
      await stopTailscaleServe(before.localServerPort).catch(() => undefined);
    }
    return localServerStatusAsync();
  });
  // Read on demand rather than carried in the status object, which is polled every few seconds
  // and would put the password on that wire whether or not anybody is looking at it.
  h('localServer:adminPassword', async () => getLocalServerAdminPassword());
  h('localServer:restart', async () => {
    await restartLocalServer();
    return localServerStatusAsync();
  });
  h('localServer:connectVault', async () => connectActiveVaultToLocalServer());
  h('localServer:tailscaleServe', async (_e, enable: boolean) => {
    const port = getSettings().localServerPort;
    return enable ? startTailscaleServe(port) : stopTailscaleServe(port);
  });
  h('localServer:power', async () => powerStatus());
  h('localServer:setKeepAwake', async (_e, enable: boolean) => {
    updateSettings({ localServerKeepAwake: enable });
    if (enable) holdAwake(); else releaseAwake();
    return powerStatus();
  });
  h('localServer:setLidServing', async (_e, enable: boolean) => {
    // The system dialog this raises is the user's own; a refusal there is an answer, not a fault,
    // so it is reported back rather than thrown into an error toast.
    try {
      if (enable) await holdLid(); else await releaseLid();
      updateSettings({ localServerKeepServingOnLidClose: enable });
      recordPowerError(null);
    } catch (error) {
      recordPowerError(error instanceof Error ? error.message : String(error));
    }
    return powerStatus();
  });
  h('desktopBridge:status', async () => desktopBridgeStatus());
  h('desktopBridge:offer', async (_e, vaultIds: string[], domains: DesktopBridgeDomain[], renewalPairingId?: string, transport?: 'direct' | 'automatic') =>
    createDesktopBridgeOffer(vaultIds, domains, renewalPairingId, transport));
  h('desktopBridge:revoke', async (_e, id: string) => {
    revokeDesktopBridgePairing(id);
    return desktopBridgeStatus();
  });
  h('copilot:status', async () => getCopilotStatus());
  h('copilot:regenerateToken', async () => regenerateCopilotToken());
  h('copilot:ensureCert', async () => {
    const result = await ensureCopilotCert(getSettings().uiLanguage);
    if (result.ok && getSettings().copilotEnabled) await restartCopilotServer();
    return result;
  });
  h('copilot:installAddin', async () => installCopilotAddin(app.getAppPath(), app.getVersion()));
  h('copilot:installLibreOffice', async () => installLibreOfficeCopilot(app.getAppPath()));
  h('zoteroPlugin:status', async () => getZoteroPluginStatus());
  h('zoteroPlugin:regenerateToken', async () => regenerateZoteroPluginToken());
  h('zoteroPlugin:installInfo', async () => getZoteroInstallInfo());
  h('zoteroPlugin:install', async () => installZoteroPlugin());
  h('zoteroPlugin:downloadXpi', async () => exportZoteroPluginXpi());
  h('browserConnector:downloadZip', async () => exportBrowserConnectorZip());
  h('browserConnector:regenerateToken', async () => { await regenerateBrowserConnectorToken(); });
  h('browserConnector:pairing:resolve', async (event, requestId: string, allow: boolean) => {
    resolveBrowserConnectorPairingRequest(event.sender.id, requestId, allow);
  });
  h('app:info', async () => {
    const osName =
      process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : process.platform;
    return {
      version: app.getVersion(),
      platform: process.platform,
      osName,
      osVersion: os.release(),
      arch: process.arch,
      electron: process.versions.electron ?? '',
    };
  });
  h('settings:setApiKey', async (_e, provider: AiProvider, key: string) => setApiKey(provider, key));
  h('settings:clearApiKey', async (_e, provider: AiProvider) => clearApiKey(provider));
  h('settings:recoverApiKeys', async (event) => {
    const result = await recoverLegacyApiKeys();
    if (result.recoveredProviders.length > 0) {
      const settings = getSettings();
      if (settings.autoBackupEnabled && settings.autoBackupFolder) await runAutoBackupNow(app.getVersion());
    }
    event.sender.send('settings:apiKeysRecovered', result);
    return result;
  });

  h('ai:chatgptSubscription:status', async () => getChatGptSubscriptionStatus());
  h('ai:chatgptSubscription:login', async () => startChatGptSubscriptionLogin());
  h('ai:chatgptSubscription:cancelLogin', async (_event, loginId: string) =>
    cancelChatGptSubscriptionLogin(loginId)
  );
  h('ai:chatgptSubscription:logout', async () => logoutChatGptSubscription());
  h('ai:githubCopilotSubscription:status', async () => getGitHubCopilotSubscriptionStatus());
  h('ai:githubCopilotSubscription:login', async () => startGitHubCopilotSubscriptionLogin());
  h('ai:githubCopilotSubscription:cancelLogin', async () => cancelGitHubCopilotSubscriptionLogin());
  h('ai:githubCopilotSubscription:logout', async () => logoutGitHubCopilotSubscription());
  h('ai:openCodeGo:usage', async () => getOpenCodeGoUsageStatus());

  // AI model discovery (OpenRouter needs no key; others use the stored key).
  h('ai:listModels', async (_e, provider: AiProvider) => {
    if (provider === 'codex') return listChatGptSubscriptionModels();
    if (provider === 'github-copilot') return listGitHubCopilotSubscriptionModels();
    return listModels(provider, getApiKey(provider));
  });
  h('ai:modelCatalog', async (_e, provider: AiProvider) => getModelCatalog(provider));
  h('ai:listEmbeddingModels', async (_e, provider: EmbeddingProvider) =>
    listEmbeddingModels(provider, getApiKey(provider))
  );
  h('ai:testLocalProvider', async (_e, provider: LocalProvider) => testLocalProvider(provider, getApiKey(provider)));
  h('ai:testCustomProvider', async () => testCustomProvider(getApiKey('custom')));
  h('ai:localDiagnostics', async () => listLocalAiDiagnostics());
  h('ai:listImageModels', async () => listImageModels());
  h('ai:nodusLocal:status', async () => getNodusLocalAiStatus());
  h('ai:nodusLocal:installRuntime', async (event, requestId: string) =>
    installNodusLocalRuntime((fraction) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:nodusLocal:progress', requestId, fraction);
    }));
  h('ai:nodusLocal:downloadModel', async (event, requestId: string, model: string) => {
    const status = await downloadNodusLocalModel(model, (fraction) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:nodusLocal:progress', requestId, fraction);
    });
    // No automatic calibration: the first local request must never wait behind a
    // synthetic benchmark (issue #851). The user can measure concurrency on demand.
    return status;
  });
  h('ai:nodusLocal:recheckRuntime', async () => recheckNodusLocalRuntime());
  h('ai:nodusLocal:calibrate', async (_event, model: string) => calibrateNodusLocalRuntimeConcurrency(model));
  h('ai:nodusLocal:cancelDownloads', async () => cancelNodusLocalDownloads());
  h('ai:nodusLocal:deleteModel', async (_event, model: string) => deleteNodusLocalModel(model));
  h('ai:nodusLocalImage:status', async () => getNodusLocalImageStatus());
  h('ai:nodusLocalImage:installRuntime', async (event, requestId: string) =>
    installNodusLocalImageRuntime((fraction) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:nodusLocalImage:progress', requestId, fraction);
    }));
  h('ai:nodusLocalImage:downloadModel', async (event, requestId: string, model: string) =>
    downloadNodusLocalImageModel(model, (fraction) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:nodusLocalImage:progress', requestId, fraction);
    }));
  h('ai:nodusLocalImage:deleteModel', async (_event, model: string) => deleteNodusLocalImageModel(model));
  h('images:get', async (_e, entityKind: DecorativeImageEntityKind, entityId: string) =>
    getDecorativeImage(entityKind, entityId)
  );
  h('images:data', async (_e, entityKind: DecorativeImageEntityKind, entityId: string, thumbnail?: boolean) => {
    const data = getDecorativeImageData(entityKind, entityId, thumbnail);
    return data ? `data:${data.mimeType};base64,${data.bytes.toString('base64')}` : null;
  });
  h('images:queue', async (e, request: DecorativeImageActionRequest) =>
    queueDecorativeImageGeneration(request, (image) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:changed', localizedForUi(image));
    })
  );
  h('images:suggestContext', async (
    e,
    requestId: string,
    entityKind: DecorativeImageEntityKind,
    entityId: string
  ) =>
    streamDecorativeImageContext(entityKind, entityId, (delta) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:suggestContext:delta', requestId, delta);
    })
  );
  h('images:upload', async (
    e,
    entityKind: DecorativeImageEntityKind,
    entityId: string,
    bytes: Uint8Array,
    mimeType?: string,
    style?: DecorativeImageStyle
  ) => {
    const image = await saveCustomDecorativeImage(entityKind, entityId, Buffer.from(bytes), mimeType, style);
    if (!e.sender.isDestroyed()) e.sender.send('images:changed', localizedForUi(image));
    return image;
  });
  h('images:revert', async (e, entityKind: DecorativeImageEntityKind, entityId: string) => {
    const image = revertDecorativeImage(entityKind, entityId);
    if (!e.sender.isDestroyed()) e.sender.send('images:changed', localizedForUi(image));
    return image;
  });
  h('images:delete', async (_e, entityKind: DecorativeImageEntityKind, entityId: string) =>
    deleteDecorativeImage(entityKind, entityId)
  );
  h('images:downloadOriginal', async (_e, source: string, label?: string | null) => {
    const image = originalImagePayloadFromUrl(source);
    if (!image) throw new Error('No se encontró la imagen original.');
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: localizeRuntimeError('Download original image', getSettings().uiLanguage),
      defaultPath: originalImageFileName(label, image.mime),
      filters: [{
        name: localizeRuntimeError('Original image', getSettings().uiLanguage),
        extensions: [extensionForOriginalImage(image.mime)],
      }],
    });
    if (picked.canceled || !picked.filePath) return { canceled: true, path: null };
    fs.writeFileSync(picked.filePath, image.blob);
    return { canceled: false, path: picked.filePath };
  });

  // audio / text-to-speech. Synthesis runs in the renderer (Piper via WebAssembly);
  // the main process supplies the speakable segments and persists the resulting WAVs.
  h('audio:segments', async (_e, entityKind: AudioEntityKind, entityId: string, request?: AudioSegmentRequest) =>
    getEntitySegments(entityKind, entityId, request)
  );
  h('audio:listClips', async (_e, entityKind: AudioEntityKind, entityId: string) =>
    listEntityClips(entityKind, entityId)
  );
  h('audio:clearClips', async (_e, entityKind: AudioEntityKind, entityId: string) => {
    clearEntityClips(entityKind, entityId);
  });
  h('audio:saveClip', async (
    _e,
    entityKind: AudioEntityKind,
    entityId: string,
    input: { segmentIndex: number; segmentLabel: string; provider: AudioProvider; voice: string; language: string; bytes: Uint8Array }
  ) => saveClip(entityKind, entityId, { ...input, bytes: input.bytes }));
  h('audio:clipData', async (_e, clipId: string) => {
    const data = readClipBytes(clipId);
    return data ? `data:${data.mime};base64,${data.bytes.toString('base64')}` : null;
  });
  h('audio:deleteClip', async (_e, clipId: string) => {
    deleteAudioClip(clipId);
  });
  h('audio:deleteEntityClips', async (_e, entityKind: AudioEntityKind, entityId: string) => {
    deleteEntityClips(entityKind, entityId);
  });
  h('audio:exportClip', async (_e, clipId: string) => {
    const source = audioClipPath(clipId); if (!source) return null;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, { title: dialogTitle('saveAudio', getSettings().uiLanguage), defaultPath: path.basename(source), filters: [{ name: 'Audio WAV', extensions: ['wav'] }] });
    if (picked.canceled || !picked.filePath) return null; fs.copyFileSync(source, picked.filePath); return { path: picked.filePath };
  });
  h('audio:study:bookmarks', async (_e, kind: AudioEntityKind, id: string) => listStudyAudioBookmarks(kind, id));
  h('audio:study:bookmark:create', async (_e, kind: AudioEntityKind, id: string, segmentIndex: number, label: string) => createStudyAudioBookmark(kind, id, segmentIndex, label));
  h('audio:study:bookmark:delete', async (_e, id: string) => deleteStudyAudioBookmark(id));
  h('audio:study:pronunciations', async (_e, subjectId: string) => getStudyPronunciations(subjectId));
  h('audio:study:pronunciations:set', async (_e, subjectId: string, entries: StudyPronunciationEntry[]) => setStudyPronunciations(subjectId, entries));
  h('audio:study:playlist', async (_e, subjectId: string) => listStudyAudioPlaylist(subjectId));

  // Hume (cloud TTS): key stays in the main process; the renderer only sees
  // whether a key exists, the voice list, and the resulting audio bytes.
  h('audio:humeStatus', async () => ({ hasKey: humeHasKey() }));
  h('audio:humeSetKey', async (_e, key: string) => {
    setHumeKey(key);
    return { hasKey: humeHasKey() };
  });
  h('audio:humeClearKey', async () => {
    clearHumeKey();
    return { hasKey: humeHasKey() };
  });
  h('audio:humeVoices', async (_e, language?: string) => listHumeVoices(language));
  h('audio:humeSynthesize', async (_e, voiceId: string, provider: 'HUME_AI' | 'CUSTOM_VOICE', text: string) => {
    const bytes = await synthesizeHume(voiceId, provider, text);
    return new Uint8Array(bytes);
  });

  // AI translations. The renderer assembles an entity's Markdown and passes it in;
  // the main process translates it (chunked, preserving citations) and stores one
  // copy per language.
  h('translations:list', async (_e, entityKind: TranslationEntityKind, entityId: string) =>
    translationsRepo.listContentTranslations(entityKind, entityId)
  );
  h('translations:get', async (_e, id: string) => translationsRepo.getContentTranslation(id));
  h('translations:mobile:context', async (_e, request: GenerateTranslationRequest) => mobileTranslationContext(request));
  h('translations:mobile:begin', async (_e, request: GenerateTranslationRequest) => beginMobileTranslation(request));
  h('translations:mobile:save', async (_e, input) => saveMobileTranslation(input));
  h('translations:mobile:fail', async (_e, request: GenerateTranslationRequest, issue: string) => failMobileTranslation(request, issue));
  h('translations:generate', async (_e, request: GenerateTranslationRequest) => {
    const language = TRANSLATION_LANGUAGES.find((l) => l.code === request.language);
    if (!language) throw new Error(`Idioma de traducción no soportado: ${request.language}`);
    const source = request.sourceMarkdown.trim();
    if (!source) throw new Error('No hay contenido para traducir.');
    const pending = translationsRepo.beginContentTranslation({ entityKind: request.entityKind, entityId: request.entityId, language: language.code, languageLabel: language.nativeName, sourceTitle: request.sourceTitle, model: request.model ?? null });
    try {
      const markdown = await translateMarkdown({ markdown: source, language, model: request.model });
      const saved = translationsRepo.upsertContentTranslation({
        entityKind: request.entityKind, entityId: request.entityId, language: language.code, languageLabel: language.nativeName,
        title: titleFromMarkdown(markdown, request.sourceTitle), markdown, model: request.model ?? null,
      });
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('translations:changed', [request.entityKind, request.entityId]);
      return saved;
    } catch (cause) {
      translationsRepo.failContentTranslation(pending.id, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  });
  h('translations:delete', async (_e, id: string) => {
    const current = translationsRepo.getContentTranslation(id);
    translationsRepo.deleteContentTranslation(id);
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('translations:changed', [current?.entityKind ?? null, current?.entityId ?? null]);
  });

  // zotero
  h('zotero:ping', async () => {
    const res = await zotero.ping();
    // Local API always uses users/0; persist that so all later calls address it correctly.
    if (res.ok) updateSettings({ zoteroUserId: zotero.LOCAL_USER_ID });
    return res;
  });
  h('zotero:libraries', async () => zotero.libraries());
  h('zotero:collections', async (_e, library?: ZoteroLibrary) => {
    const { zoteroUserId } = getSettings();
    return zotero.topCollections(zoteroUserId, library);
  });
  h('zotero:childCollections', async (_e, parentKey: string, library?: ZoteroLibrary) => {
    const { zoteroUserId } = getSettings();
    return zotero.childCollections(zoteroUserId, parentKey, library);
  });
  h('zotero:collectionItems', async (_e, collectionKey: string, opts?: { query?: string; recursive?: boolean; library?: ZoteroLibrary }) => {
    const { zoteroUserId } = getSettings();
    return opts?.recursive
      ? zotero.collectionItemsRecursive(zoteroUserId, collectionKey, opts)
      : zotero.collectionItems(zoteroUserId, collectionKey, opts);
  });
  h('zotero:searchItems', async (_e, library: ZoteroLibrary, query: string) => zotero.searchItems(library, query));
  h('zotero:itemAttachments', async (_e, itemKey: string, library?: ZoteroLibrary) => {
    const { zoteroUserId } = getSettings();
    return zotero.itemAttachments(zoteroUserId, itemKey, library);
  });

  // works / library
  h('home:academicSnapshot', async () => {
    const stats = getAcademicHomeStats();
    return {
      stats,
      health: getCorpusHealth(),
      queue: scanQueue.snapshot(),
      latestSync: getSyncLog(1)[0] ?? null,
    };
  });
  h('shell:openExternal', async (_e, url: string) => {
    // Only follow web/mail links rendered from Markdown — never arbitrary schemes.
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url.trim())) {
      await shell.openExternal(url.trim());
    }
  });
  h('shell:openThirdPartyNotices', async () => {
    const noticesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'legal', 'THIRD_PARTY_NOTICES.md')
      : path.join(app.getAppPath(), 'THIRD_PARTY_NOTICES.md');
    if (!fs.existsSync(noticesPath)) throw new Error('No se encontraron los avisos de terceros de Nodus.');
    const error = await shell.openPath(noticesPath);
    if (error) throw new Error(error);
  });
  h('shell:openPrivacyPolicy', async () => openPrivacyPolicy());
}
