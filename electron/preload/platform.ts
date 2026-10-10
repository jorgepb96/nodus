// platform half of the renderer bridge, paired with electron/ipc/platform.ts.
// Typed as PlatformApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { PlatformApi } from '@shared/api/platform';

export const platformApi: PlatformApi = {
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
  getMcpTunnelStatus: () => ipcRenderer.invoke('mcp:tunnel:status'),
  connectMcpTunnel: (input) => ipcRenderer.invoke('mcp:tunnel:connect', input),
  disconnectMcpTunnel: () => ipcRenderer.invoke('mcp:tunnel:disconnect'),
  forgetMcpTunnel: () => ipcRenderer.invoke('mcp:tunnel:forget'),
  getNodusServerOverview: () => ipcRenderer.invoke('nodusServer:overview'),
  pairNodusServer: (url, code) => ipcRenderer.invoke('nodusServer:pair', url, code),
  setNodusServerLanguage: (language, vaultId) => ipcRenderer.invoke('nodusServer:setLanguage', language, vaultId),
  syncNodusServerVaultNow: (vaultId) => ipcRenderer.invoke('nodusServer:syncVaultNow', vaultId),
  disconnectNodusServerVault: (vaultId) => ipcRenderer.invoke('nodusServer:disconnectVault', vaultId),
  previewCloudflareDeployment: (activity) => ipcRenderer.invoke('cloudflare:preview', activity),
  prepareCloudflareDirectDeployment: () => ipcRenderer.invoke('cloudflare:prepare'),
  completeCloudflareDirectDeployment: (input) => ipcRenderer.invoke('cloudflare:complete', input),
  getCloudflareDeployState: () => ipcRenderer.invoke('cloudflare:state'),
  openCloudflareDeployment: (url) => ipcRenderer.invoke('cloudflare:openDeploy', url),
  listServerInbox: () => ipcRenderer.invoke('nodusServer:inbox:list'),
  markServerInboxRead: (id) => ipcRenderer.invoke('nodusServer:inbox:markRead', id),
  clearServerInbox: (id) => ipcRenderer.invoke('nodusServer:inbox:clear', id),
  onServerInboxChanged: (cb) => {
    const listener = (_e: unknown, entries: Parameters<typeof cb>[0]) => cb(entries);
    ipcRenderer.on('nodusServer:inbox:changed', listener);
    return () => ipcRenderer.removeListener('nodusServer:inbox:changed', listener);
  },
  getLocalServerStatus: () => ipcRenderer.invoke('localServer:status'),
  startLocalServer: () => ipcRenderer.invoke('localServer:start'),
  stopLocalServer: () => ipcRenderer.invoke('localServer:stop'),
  restartLocalServer: () => ipcRenderer.invoke('localServer:restart'),
  connectVaultToLocalServer: () => ipcRenderer.invoke('localServer:connectVault'),
  setLocalServerTailscaleServe: (enable) => ipcRenderer.invoke('localServer:tailscaleServe', enable),
  getLocalServerAdminPassword: () => ipcRenderer.invoke('localServer:adminPassword'),
  getLocalServerPower: () => ipcRenderer.invoke('localServer:power'),
  setLocalServerKeepAwake: (enable) => ipcRenderer.invoke('localServer:setKeepAwake', enable),
  setLocalServerLidServing: (enable) => ipcRenderer.invoke('localServer:setLidServing', enable),
  getDesktopBridgeStatus: () => ipcRenderer.invoke('desktopBridge:status'),
  createDesktopBridgeOffer: (vaultIds, domains, renewalPairingId, transport) => ipcRenderer.invoke('desktopBridge:offer', vaultIds, domains, renewalPairingId, transport),
  revokeDesktopBridgePairing: (id) => ipcRenderer.invoke('desktopBridge:revoke', id),
  getCopilotStatus: () => ipcRenderer.invoke('copilot:status'),
  regenerateCopilotToken: () => ipcRenderer.invoke('copilot:regenerateToken'),
  getZoteroPluginStatus: () => ipcRenderer.invoke('zoteroPlugin:status'),
  regenerateZoteroPluginToken: () => ipcRenderer.invoke('zoteroPlugin:regenerateToken'),
  getZoteroInstallInfo: () => ipcRenderer.invoke('zoteroPlugin:installInfo'),
  installZoteroPlugin: () => ipcRenderer.invoke('zoteroPlugin:install'),
  downloadZoteroPluginXpi: () => ipcRenderer.invoke('zoteroPlugin:downloadXpi'),
  downloadBrowserConnectorZip: () => ipcRenderer.invoke('browserConnector:downloadZip'),
  regenerateBrowserConnectorToken: () => ipcRenderer.invoke('browserConnector:regenerateToken'),
  onBrowserConnectorPairingRequest: (cb) => {
    const listener = (_event: unknown, request: Parameters<typeof cb>[0]) => cb(request);
    ipcRenderer.on('browserConnector:pairing:request', listener);
    return () => ipcRenderer.removeListener('browserConnector:pairing:request', listener);
  },
  resolveBrowserConnectorPairingRequest: (requestId, allow) =>
    ipcRenderer.invoke('browserConnector:pairing:resolve', requestId, allow).then(() => undefined),
  ensureCopilotCert: () => ipcRenderer.invoke('copilot:ensureCert'),
  installCopilotAddin: () => ipcRenderer.invoke('copilot:installAddin'),
  installLibreOfficeCopilot: () => ipcRenderer.invoke('copilot:installLibreOffice'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onCopilotOpenIdea: (cb) => {
    const listener = (_e: unknown, target: import('@shared/types').CopilotOpenIdeaTarget) => cb(target);
    ipcRenderer.on('copilot:openIdea', listener);
    return () => ipcRenderer.removeListener('copilot:openIdea', listener);
  },
  onZoteroPluginOpen: (cb) => {
    const listener = (_event: unknown, target: import('@shared/types').ZoteroPluginOpenTarget) => cb(target);
    ipcRenderer.on('zoteroPlugin:open', listener);
    return () => ipcRenderer.removeListener('zoteroPlugin:open', listener);
  },
  setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke('settings:clearApiKey', provider),
  recoverApiKeys: () => ipcRenderer.invoke('settings:recoverApiKeys'),
  onApiKeysRecovered: (cb) => {
    const listener = (_e: unknown, result: { recoveredProviders: import('@shared/types').AiProvider[]; remainingLockedProviders: import('@shared/types').AiProvider[] }) => cb(result);
    ipcRenderer.on('settings:apiKeysRecovered', listener);
    return () => ipcRenderer.removeListener('settings:apiKeysRecovered', listener);
  },

  getChatGptSubscriptionStatus: () => ipcRenderer.invoke('ai:chatgptSubscription:status'),
  startChatGptSubscriptionLogin: () => ipcRenderer.invoke('ai:chatgptSubscription:login'),
  cancelChatGptSubscriptionLogin: (loginId) => ipcRenderer.invoke('ai:chatgptSubscription:cancelLogin', loginId),
  logoutChatGptSubscription: () => ipcRenderer.invoke('ai:chatgptSubscription:logout'),
  onChatGptSubscriptionStatusChanged: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('ai:chatgptSubscription:statusChanged', listener);
    return () => ipcRenderer.removeListener('ai:chatgptSubscription:statusChanged', listener);
  },
  getGitHubCopilotSubscriptionStatus: () => ipcRenderer.invoke('ai:githubCopilotSubscription:status'),
  startGitHubCopilotSubscriptionLogin: () => ipcRenderer.invoke('ai:githubCopilotSubscription:login'),
  cancelGitHubCopilotSubscriptionLogin: () => ipcRenderer.invoke('ai:githubCopilotSubscription:cancelLogin'),
  logoutGitHubCopilotSubscription: () => ipcRenderer.invoke('ai:githubCopilotSubscription:logout'),
  onGitHubCopilotSubscriptionStatusChanged: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('ai:githubCopilotSubscription:statusChanged', listener);
    return () => ipcRenderer.removeListener('ai:githubCopilotSubscription:statusChanged', listener);
  },
  getOpenCodeGoUsageStatus: () => ipcRenderer.invoke('ai:openCodeGo:usage'),
  onOpenCodeGoUsageStatusChanged: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('ai:openCodeGo:usageChanged', listener);
    return () => ipcRenderer.removeListener('ai:openCodeGo:usageChanged', listener);
  },

  listModels: (provider) => ipcRenderer.invoke('ai:listModels', provider),
  getModelCatalog: (provider) => ipcRenderer.invoke('ai:modelCatalog', provider),
  listEmbeddingModels: (provider) => ipcRenderer.invoke('ai:listEmbeddingModels', provider),
  testLocalProvider: (provider) => ipcRenderer.invoke('ai:testLocalProvider', provider),
  testCustomProvider: () => ipcRenderer.invoke('ai:testCustomProvider'),
  getLocalAiDiagnostics: () => ipcRenderer.invoke('ai:localDiagnostics'),
  listImageModels: () => ipcRenderer.invoke('ai:listImageModels'),
  getNodusLocalAiStatus: () => ipcRenderer.invoke('ai:nodusLocal:status'),
  installNodusLocalRuntime: async (onProgress) => {
    const requestId = `nodus-local-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocal:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocal:installRuntime', requestId); }
    finally { ipcRenderer.removeListener('ai:nodusLocal:progress', listener); }
  },
  downloadNodusLocalModel: async (model, onProgress) => {
    const requestId = `nodus-local-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocal:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocal:downloadModel', requestId, model); }
    finally { ipcRenderer.removeListener('ai:nodusLocal:progress', listener); }
  },
  cancelNodusLocalDownloads: () => ipcRenderer.invoke('ai:nodusLocal:cancelDownloads'),
  deleteNodusLocalModel: (model) => ipcRenderer.invoke('ai:nodusLocal:deleteModel', model),
  recheckNodusLocalRuntime: () => ipcRenderer.invoke('ai:nodusLocal:recheckRuntime'),
  calibrateNodusLocalModel: (model) => ipcRenderer.invoke('ai:nodusLocal:calibrate', model),
  getNodusLocalImageStatus: () => ipcRenderer.invoke('ai:nodusLocalImage:status'),
  installNodusLocalImageRuntime: async (onProgress) => {
    const requestId = `nodus-local-image-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocalImage:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocalImage:installRuntime', requestId); }
    finally { ipcRenderer.removeListener('ai:nodusLocalImage:progress', listener); }
  },
  downloadNodusLocalImageModel: async (model, onProgress) => {
    const requestId = `nodus-local-image-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocalImage:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocalImage:downloadModel', requestId, model); }
    finally { ipcRenderer.removeListener('ai:nodusLocalImage:progress', listener); }
  },
  deleteNodusLocalImageModel: (model) => ipcRenderer.invoke('ai:nodusLocalImage:deleteModel', model),
  getDecorativeImage: (entityKind, entityId) => ipcRenderer.invoke('images:get', entityKind, entityId),
  getDecorativeImageDataUrl: (entityKind, entityId, thumbnail) =>
    ipcRenderer.invoke('images:data', entityKind, entityId, thumbnail),
  queueDecorativeImage: (request) => ipcRenderer.invoke('images:queue', request),
  suggestDecorativeImageContext: async (entityKind, entityId, onDelta) => {
    const requestId = `images-context-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_e: unknown, id: string, delta: string) => { if (id === requestId) onDelta(delta); };
    ipcRenderer.on('images:suggestContext:delta', listener);
    try { return await ipcRenderer.invoke('images:suggestContext', requestId, entityKind, entityId); }
    finally { ipcRenderer.removeListener('images:suggestContext:delta', listener); }
  },
  uploadDecorativeImage: (entityKind, entityId, bytes, mimeType, style) =>
    ipcRenderer.invoke('images:upload', entityKind, entityId, bytes, mimeType, style),
  revertDecorativeImage: (entityKind, entityId) => ipcRenderer.invoke('images:revert', entityKind, entityId),
  deleteDecorativeImage: (entityKind, entityId) => ipcRenderer.invoke('images:delete', entityKind, entityId),
  downloadOriginalImage: (source, label) => ipcRenderer.invoke('images:downloadOriginal', source, label),
  onDecorativeImageChanged: (cb) => {
    const listener = (_e: unknown, image: import('@shared/types').DecorativeImage) => cb(image);
    ipcRenderer.on('images:changed', listener);
    return () => ipcRenderer.removeListener('images:changed', listener);
  },

  // audio / text-to-speech (synthesis runs in the renderer; main persists WAVs)
  getAudioSegments: (entityKind, entityId, request) => ipcRenderer.invoke('audio:segments', entityKind, entityId, request),
  listAudioClips: (entityKind, entityId) => ipcRenderer.invoke('audio:listClips', entityKind, entityId),
  clearAudioClips: (entityKind, entityId) =>
    ipcRenderer.invoke('audio:clearClips', entityKind, entityId).then(() => undefined),
  saveAudioClip: (entityKind, entityId, input) => ipcRenderer.invoke('audio:saveClip', entityKind, entityId, input),
  getAudioClipDataUrl: (clipId) => ipcRenderer.invoke('audio:clipData', clipId),
  deleteAudioClip: (clipId) => ipcRenderer.invoke('audio:deleteClip', clipId).then(() => undefined),
  deleteEntityAudioClips: (entityKind, entityId) =>
    ipcRenderer.invoke('audio:deleteEntityClips', entityKind, entityId).then(() => undefined),
  exportAudioClip: (clipId) => ipcRenderer.invoke('audio:exportClip', clipId),
  listStudyAudioBookmarks: (entityKind, entityId) => ipcRenderer.invoke('audio:study:bookmarks', entityKind, entityId),
  createStudyAudioBookmark: (entityKind, entityId, segmentIndex, label) => ipcRenderer.invoke('audio:study:bookmark:create', entityKind, entityId, segmentIndex, label),
  deleteStudyAudioBookmark: (id) => ipcRenderer.invoke('audio:study:bookmark:delete', id).then(() => undefined),
  getStudyPronunciations: (subjectId) => ipcRenderer.invoke('audio:study:pronunciations', subjectId),
  setStudyPronunciations: (subjectId, entries) => ipcRenderer.invoke('audio:study:pronunciations:set', subjectId, entries),
  listStudyAudioPlaylist: (subjectId) => ipcRenderer.invoke('audio:study:playlist', subjectId),
  humeStatus: () => ipcRenderer.invoke('audio:humeStatus'),
  humeSetKey: (key) => ipcRenderer.invoke('audio:humeSetKey', key),
  humeClearKey: () => ipcRenderer.invoke('audio:humeClearKey'),
  humeVoices: (language) => ipcRenderer.invoke('audio:humeVoices', language),
  humeSynthesize: (voiceId, provider, text) =>
    ipcRenderer.invoke('audio:humeSynthesize', voiceId, provider, text),

  listContentTranslations: (entityKind, entityId) =>
    ipcRenderer.invoke('translations:list', entityKind, entityId),
  getContentTranslation: (id) => ipcRenderer.invoke('translations:get', id),
  generateContentTranslation: (request) => ipcRenderer.invoke('translations:generate', request),
  deleteContentTranslation: (id) => ipcRenderer.invoke('translations:delete', id).then(() => undefined),
  onContentTranslationsChanged: (cb) => {
    const listener = (_event: unknown, payload: [import('@shared/types').TranslationEntityKind | null, string | null]) => cb(payload?.[0] ?? null, payload?.[1] ?? null);
    ipcRenderer.on('translations:changed', listener);
    return () => ipcRenderer.removeListener('translations:changed', listener);
  },

  zoteroPing: () => ipcRenderer.invoke('zotero:ping'),
  zoteroLibraries: () => ipcRenderer.invoke('zotero:libraries'),
  zoteroCollections: (library) => ipcRenderer.invoke('zotero:collections', library),
  zoteroChildCollections: (parentKey, library) => ipcRenderer.invoke('zotero:childCollections', parentKey, library),
  zoteroCollectionItems: (collectionKey, opts) =>
    ipcRenderer.invoke('zotero:collectionItems', collectionKey, opts),
  zoteroSearchItems: (library, query) => ipcRenderer.invoke('zotero:searchItems', library, query),
  zoteroItemAttachments: (itemKey, library) => ipcRenderer.invoke('zotero:itemAttachments', itemKey, library),

  getAcademicHomeSnapshot: () => ipcRenderer.invoke('home:academicSnapshot'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url).then(() => undefined),
  openThirdPartyNotices: () => ipcRenderer.invoke('shell:openThirdPartyNotices').then(() => undefined),
  openPrivacyPolicy: () => ipcRenderer.invoke('shell:openPrivacyPolicy').then(() => undefined),
};
