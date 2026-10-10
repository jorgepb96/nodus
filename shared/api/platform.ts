// The platform slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { NodusLocalAiStatus } from '../localAiModels';
import type { NodusLocalImageStatus } from '../localImageModels';
import type { CloudflareCompleteDirectDeployInput, CloudflareDeployState, CloudflareDirectDeployPreparation, CloudflareVaultInventory } from '../cloudflare';
import type { BrowserConnectorPairingPrompt } from '../browserConnector';
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  AcademicHomeSnapshot,
  AiProvider,
  AppInfo,
  AppLanguage,
  AudioClip,
  AudioEntityKind,
  AudioProvider,
  AudioSegment,
  AudioSegmentRequest,
  BrowserConnectorExportResult,
  ChatGptSubscriptionLogin,
  ChatGptSubscriptionStatus,
  ContentTranslation,
  ContentTranslationSummary,
  CopilotInstallResult,
  CopilotOpenIdeaTarget,
  CopilotServerStatus,
  DecorativeImage,
  DecorativeImageActionRequest,
  DecorativeImageEntityKind,
  DecorativeImageStyle,
  DesktopBridgeDomain,
  DesktopBridgeOffer,
  DesktopBridgeStatus,
  EmbeddingProvider,
  GenerateTranslationRequest,
  GitHubCopilotSubscriptionStatus,
  HumeVoiceInfo,
  ImageModelInfo,
  LocalProvider,
  LocalAiRequestDiagnostic,
  LocalProviderTestResult,
  McpServerStatus,
  McpTunnelConnectInput,
  McpTunnelStatus,
  ModelInfo,
  ModelCatalogResult,
  NodusServerOverview,
  NodusServerPairResult,
  ServerInboxEntry,
  LocalServerStatus,
  LocalServerTailscale,
  LocalServerPowerStatus,
  OpenCodeGoUsageStatus,
  StudyAudioBookmark,
  StudyAudioPlaylistItem,
  StudyPronunciationEntry,
  TranslationEntityKind,
  ZoteroAttachmentInfo,
  ZoteroCollection,
  ZoteroExportResult,
  ZoteroInstallInfo,
  ZoteroInstallResult,
  ZoteroItem,
  ZoteroLibrary,
  ZoteroPingResult,
  ZoteroPluginServerStatus,
  ZoteroPluginOpenTarget,
} from '../types';

export interface PlatformApi {
  getMcpStatus(): Promise<McpServerStatus>;
  regenerateMcpToken(): Promise<string>;
  getMcpTunnelStatus(): Promise<McpTunnelStatus>;
  connectMcpTunnel(input: McpTunnelConnectInput): Promise<McpTunnelStatus>;
  disconnectMcpTunnel(): Promise<McpTunnelStatus>;
  forgetMcpTunnel(): Promise<McpTunnelStatus>;
  getNodusServerOverview(): Promise<NodusServerOverview>;
  /** Pairs the currently open vault to a server space using a single-use code. */
  pairNodusServer(url: string, code: string): Promise<NodusServerPairResult>;
  setNodusServerLanguage(language: AppLanguage, vaultId?: string): Promise<NodusServerOverview>;
  syncNodusServerVaultNow(vaultId: string): Promise<NodusServerOverview>;
  disconnectNodusServerVault(vaultId: string): Promise<NodusServerOverview>;
  previewCloudflareDeployment(activity?: Partial<CloudflareVaultInventory['activity']>): Promise<CloudflareDeployState>;
  prepareCloudflareDirectDeployment(): Promise<CloudflareDirectDeployPreparation>;
  completeCloudflareDirectDeployment(input: CloudflareCompleteDirectDeployInput): Promise<CloudflareDeployState>;
  getCloudflareDeployState(): Promise<CloudflareDeployState>;
  openCloudflareDeployment(url: string): Promise<void>;
  /**
   * What has arrived from other devices, newest first. PER VAULT: this reads the open
   * vault's own record, unlike the phone's outbox, which is deliberately global.
   */
  listServerInbox(): Promise<ServerInboxEntry[]>;
  /** Mark one entry read, or all of them when no id is given. Returns the fresh list. */
  markServerInboxRead(id?: string): Promise<ServerInboxEntry[]>;
  /** Remove one entry, or empty the inbox when no id is given. Returns the fresh list. */
  clearServerInbox(id?: string): Promise<ServerInboxEntry[]>;
  /** Push: the poller applied a batch that produced entries. Returns its own unsubscribe. */
  onServerInboxChanged(cb: (entries: ServerInboxEntry[]) => void): () => void;
  // ── Nodus Server, basic mode: the server runs on this computer ──────────
  getLocalServerStatus(): Promise<LocalServerStatus>;
  /** Start it and remember the preference, so it comes back with the app. */
  startLocalServer(): Promise<LocalServerStatus>;
  stopLocalServer(): Promise<LocalServerStatus>;
  /** Re-launch with the current port and access path. */
  restartLocalServer(): Promise<LocalServerStatus>;
  /** Give the open vault a space on the local server and pair with it, in one step. */
  connectVaultToLocalServer(): Promise<NodusServerPairResult>;
  /** Ask Tailscale to publish (or stop publishing) the local server to the tailnet. */
  setLocalServerTailscaleServe(enable: boolean): Promise<LocalServerTailscale>;
  /**
   * The generated password for the local server's own web administration.
   *
   * Its own call rather than a field on the status object: that one is polled on a timer, and a
   * password has no business riding a wire nobody asked to open.
   */
  getLocalServerAdminPassword(): Promise<string | null>;
  getLocalServerPower(): Promise<LocalServerPowerStatus>;
  setLocalServerKeepAwake(enable: boolean): Promise<LocalServerPowerStatus>;
  /** Disable system sleep so a closed lid keeps serving. Raises the system's own admin dialog. */
  setLocalServerLidServing(enable: boolean): Promise<LocalServerPowerStatus>;
  getDesktopBridgeStatus(): Promise<DesktopBridgeStatus>;
  createDesktopBridgeOffer(vaultIds: string[], domains: DesktopBridgeDomain[], renewalPairingId?: string, transport?: 'direct' | 'automatic'): Promise<DesktopBridgeOffer>;
  revokeDesktopBridgePairing(id: string): Promise<DesktopBridgeStatus>;
  getCopilotStatus(): Promise<CopilotServerStatus>;
  regenerateCopilotToken(): Promise<string>;
  /** Runtime state of the opt-in local server for the Nodus-for-Zotero plugin. */
  getZoteroPluginStatus(): Promise<ZoteroPluginServerStatus>;
  regenerateZoteroPluginToken(): Promise<string>;
  /** Detect Zotero + profile, and whether Zotero is currently running. */
  getZoteroInstallInfo(): Promise<ZoteroInstallInfo>;
  /** Install/update the Nodus-for-Zotero plugin (closes + reopens Zotero if running). */
  installZoteroPlugin(): Promise<ZoteroInstallResult>;
  /** Save the packaged .xpi to a chosen location for manual installation. */
  downloadZoteroPluginXpi(): Promise<ZoteroExportResult>;
  /** Save the Chrome Web Store-ready connector ZIP to a chosen location. */
  downloadBrowserConnectorZip(): Promise<BrowserConnectorExportResult>;
  /** Revoke every browser pairing without exposing the replacement secret. */
  regenerateBrowserConnectorToken(): Promise<void>;
  /** Present and resolve the just-in-time desktop confirmation for a browser origin. */
  onBrowserConnectorPairingRequest(cb: (request: BrowserConnectorPairingPrompt) => void): () => void;
  resolveBrowserConnectorPairingRequest(requestId: string, allow: boolean): Promise<void>;
  /** Generate + trust a localhost TLS cert for the copilot server (idempotent). */
  ensureCopilotCert(): Promise<{ ok: boolean; message: string }>;
  /** Copy a port-aware Nodus Copilot manifest into Word's local add-in catalog. */
  installCopilotAddin(): Promise<CopilotInstallResult>;
  /** Runtime version + platform info for the feedback / PR form. */
  getAppInfo(): Promise<AppInfo>;
  /** Copy the Nodus Copilot macro into LibreOffice's user script directory. */
  installLibreOfficeCopilot(): Promise<CopilotInstallResult>;
  /** Fired when the Word add-in asks Nodus to reveal an idea or its CSL style manager. */
  onCopilotOpenIdea(cb: (target: CopilotOpenIdeaTarget) => void): () => void;
  /** Fired when Zotero asks the desktop app to reveal a clean Library item. */
  onZoteroPluginOpen(cb: (target: ZoteroPluginOpenTarget) => void): () => void;
  setApiKey(provider: AiProvider, key: string): Promise<void>;
  clearApiKey(provider: AiProvider): Promise<void>;
  recoverApiKeys(): Promise<{ recoveredProviders: AiProvider[]; remainingLockedProviders: AiProvider[] }>;
  onApiKeysRecovered(
    cb: (result: { recoveredProviders: AiProvider[]; remainingLockedProviders: AiProvider[] }) => void
  ): () => void;

  // Managed ChatGPT subscription login through the official Codex App Server.
  // Credentials remain in Codex's OS-keychain-backed store and never cross IPC.
  getChatGptSubscriptionStatus(): Promise<ChatGptSubscriptionStatus>;
  startChatGptSubscriptionLogin(): Promise<ChatGptSubscriptionLogin>;
  cancelChatGptSubscriptionLogin(loginId: string): Promise<ChatGptSubscriptionStatus>;
  logoutChatGptSubscription(): Promise<ChatGptSubscriptionStatus>;
  onChatGptSubscriptionStatusChanged(cb: (status: ChatGptSubscriptionStatus) => void): () => void;

  // GitHub Copilot subscription access through GitHub's official SDK/CLI.
  getGitHubCopilotSubscriptionStatus(): Promise<GitHubCopilotSubscriptionStatus>;
  startGitHubCopilotSubscriptionLogin(): Promise<GitHubCopilotSubscriptionStatus>;
  cancelGitHubCopilotSubscriptionLogin(): Promise<GitHubCopilotSubscriptionStatus>;
  logoutGitHubCopilotSubscription(): Promise<GitHubCopilotSubscriptionStatus>;
  onGitHubCopilotSubscriptionStatusChanged(cb: (status: GitHubCopilotSubscriptionStatus) => void): () => void;

  // OpenCode Go exposes inference/models by API key, but live remaining quota in Console.
  getOpenCodeGoUsageStatus(): Promise<OpenCodeGoUsageStatus>;
  onOpenCodeGoUsageStatusChanged(cb: (status: OpenCodeGoUsageStatus) => void): () => void;

  // AI model discovery
  listModels(provider: AiProvider): Promise<ModelInfo[]>;
  getModelCatalog(provider: AiProvider): Promise<ModelCatalogResult>;
  listEmbeddingModels(provider: EmbeddingProvider): Promise<ModelInfo[]>;
  listImageModels(): Promise<ImageModelInfo[]>;
  getNodusLocalAiStatus(): Promise<NodusLocalAiStatus>;
  installNodusLocalRuntime(onProgress?: (fraction: number) => void): Promise<NodusLocalAiStatus>;
  downloadNodusLocalModel(model: string, onProgress?: (fraction: number) => void): Promise<NodusLocalAiStatus>;
  cancelNodusLocalDownloads(): Promise<NodusLocalAiStatus>;
  deleteNodusLocalModel(model: string): Promise<NodusLocalAiStatus>;
  /** Probe the installed runtime again and install the best build this machine can use. */
  recheckNodusLocalRuntime(): Promise<NodusLocalAiStatus>;
  /** Explicitly measure safe concurrency for a downloaded model (never runs on its own). */
  calibrateNodusLocalModel(model: string): Promise<NodusLocalAiStatus>;
  getNodusLocalImageStatus(): Promise<NodusLocalImageStatus>;
  installNodusLocalImageRuntime(onProgress?: (fraction: number) => void): Promise<NodusLocalImageStatus>;
  downloadNodusLocalImageModel(model: string, onProgress?: (fraction: number) => void): Promise<NodusLocalImageStatus>;
  deleteNodusLocalImageModel(model: string): Promise<NodusLocalImageStatus>;
  /** Ping a local provider (Ollama / LM Studio) to verify its base URL is reachable. */
  testLocalProvider(provider: LocalProvider): Promise<LocalProviderTestResult>;
  /** Ping the user's own OpenAI-compatible endpoint. Reuses LocalProviderTestResult:
   *  the question ("is it reachable, how many models?") is the same one. */
  testCustomProvider(): Promise<LocalProviderTestResult>;
  getLocalAiDiagnostics(): Promise<LocalAiRequestDiagnostic[]>;
  getDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): Promise<DecorativeImage | null>;
  getDecorativeImageDataUrl(entityKind: DecorativeImageEntityKind, entityId: string, thumbnail?: boolean): Promise<string | null>;
  queueDecorativeImage(request: DecorativeImageActionRequest): Promise<DecorativeImage>;
  /**
   * Stream a scene description derived from the owner content (a report's summary, an
   * immersion's plan) into the design modal, so the user can read it appear and decide
   * whether to keep it. Nothing is persisted; it becomes the image's context only if
   * the user generates with it. Resolves to the cleaned, single-line description.
   */
  suggestDecorativeImageContext(
    entityKind: DecorativeImageEntityKind,
    entityId: string,
    onDelta: (delta: string) => void
  ): Promise<string>;
  /** Store a user-supplied image without altering its source bytes. */
  uploadDecorativeImage(
    entityKind: DecorativeImageEntityKind,
    entityId: string,
    bytes: Uint8Array,
    mimeType: string,
    style?: DecorativeImageStyle
  ): Promise<DecorativeImage>;
  /** Restore the image that preceded the last regeneration or upload. */
  revertDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): Promise<DecorativeImage>;
  deleteDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): Promise<DecorativeImage>;
  /** Save the untouched source behind an internal image URL. Thumbnail routes are rejected. */
  downloadOriginalImage(
    source: string,
    label?: string | null
  ): Promise<{ canceled: boolean; path: string | null }>;
  onDecorativeImageChanged(cb: (image: DecorativeImage) => void): () => void;

  // audio / text-to-speech (synthesis runs in the renderer; main persists WAVs)
  getAudioSegments(entityKind: AudioEntityKind, entityId: string, request?: AudioSegmentRequest): Promise<AudioSegment[]>;
  listAudioClips(entityKind: AudioEntityKind, entityId: string): Promise<AudioClip[]>;
  clearAudioClips(entityKind: AudioEntityKind, entityId: string): Promise<void>;
  saveAudioClip(
    entityKind: AudioEntityKind,
    entityId: string,
    input: { segmentIndex: number; segmentLabel: string; provider: AudioProvider; voice: string; language: string; bytes: Uint8Array }
  ): Promise<AudioClip>;
  getAudioClipDataUrl(clipId: string): Promise<string | null>;
  deleteAudioClip(clipId: string): Promise<void>;
  deleteEntityAudioClips(entityKind: AudioEntityKind, entityId: string): Promise<void>;
  exportAudioClip(clipId: string): Promise<{ path: string } | null>;
  listStudyAudioBookmarks(entityKind: AudioEntityKind, entityId: string): Promise<StudyAudioBookmark[]>;
  createStudyAudioBookmark(entityKind: AudioEntityKind, entityId: string, segmentIndex: number, label: string): Promise<StudyAudioBookmark>;
  deleteStudyAudioBookmark(id: string): Promise<void>;
  getStudyPronunciations(subjectId: string): Promise<StudyPronunciationEntry[]>;
  setStudyPronunciations(subjectId: string, entries: StudyPronunciationEntry[]): Promise<StudyPronunciationEntry[]>;
  listStudyAudioPlaylist(subjectId: string): Promise<StudyAudioPlaylistItem[]>;
  // AI translations of a report/immersion (source Markdown supplied by the renderer).
  listContentTranslations(
    entityKind: TranslationEntityKind,
    entityId: string
  ): Promise<ContentTranslationSummary[]>;
  getContentTranslation(id: string): Promise<ContentTranslation | null>;
  generateContentTranslation(request: GenerateTranslationRequest): Promise<ContentTranslationSummary>;
  deleteContentTranslation(id: string): Promise<void>;
  /** Fires for local and server-received translation changes while a reader stays open. */
  onContentTranslationsChanged(cb: (entityKind: TranslationEntityKind | null, entityId: string | null) => void): () => void;
  // Hume cloud TTS (BYO-key). The key is stored in the main process; the renderer
  // only learns whether one exists, the voice list, and the audio bytes.
  humeStatus(): Promise<{ hasKey: boolean }>;
  humeSetKey(key: string): Promise<{ hasKey: boolean }>;
  humeClearKey(): Promise<{ hasKey: boolean }>;
  humeVoices(language?: string): Promise<HumeVoiceInfo[]>;
  humeSynthesize(voiceId: string, provider: 'HUME_AI' | 'CUSTOM_VOICE', text: string): Promise<Uint8Array>;

  // zotero
  zoteroPing(): Promise<ZoteroPingResult>;
  zoteroLibraries(): Promise<ZoteroLibrary[]>;
  zoteroCollections(library?: ZoteroLibrary): Promise<ZoteroCollection[]>;
  zoteroChildCollections(parentKey: string, library?: ZoteroLibrary): Promise<ZoteroCollection[]>;
  zoteroCollectionItems(
    collectionKey: string,
    opts?: { query?: string; recursive?: boolean; library?: ZoteroLibrary }
  ): Promise<ZoteroItem[]>;
  zoteroSearchItems(library: ZoteroLibrary, query: string): Promise<ZoteroItem[]>;
  zoteroItemAttachments(itemKey: string, library?: ZoteroLibrary): Promise<ZoteroAttachmentInfo[]>;

  // works / library
  getAcademicHomeSnapshot(): Promise<AcademicHomeSnapshot>;
  openExternal(url: string): Promise<void>;
  /** Open the packaged Nodus and third-party notices using the system viewer. */
  openThirdPartyNotices(): Promise<void>;
  openPrivacyPolicy(): Promise<void>;
}
