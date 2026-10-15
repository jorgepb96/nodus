// The toolkit slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { Presentation, PresenterImportResult, PresenterImportSelection, PresenterLibrary, PresenterFolderDeleteMode, PptxNotes } from '../presenterTypes';
import type { PresenterAction, PresenterRuntimeState } from '../presenterState';
import type { ToolkitJobRequest, ToolkitJobProgress, ToolkitJobResult } from '../toolkitTypes';
import type { ToolkitAppGenerationRequest, ToolkitAppGenerationProgress, ToolkitAppGenerationResult, ToolkitAppManifest, ToolkitAppJsonValue, ToolkitAppSessionEvent, ToolkitAppSessionInfo, ToolkitAppSessionSnapshot } from '../toolkitApps';
import type { TranslateHistoryEntry, TranslateJobRequest, TranslateJobProgress, TranslateJobResult } from '../toolkitTranslateTypes';
import type { AiOcrCreateRequest, AiOcrExportFormat, AiOcrExportResult, OcrDoc, OcrDocSummary, OcrDocProgress, OcrOptions } from '../aiOcrTypes';
import type { ProtectArtifact, ProtectArtifactWriteResult, ProtectFilePayload, ProtectListSourcesRequest, ProtectShareResult, ProtectSourceRef, ProtectSourceSummary, ProtectVaultCopySummary } from '../protectTypes';
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  ModelRef,
} from '../types';

import type { BackupCatalog, BackupCatalogQuery, BackupCatalogPage, BackupPreset, OpenBackupOptions, OpenBackupPreview, OpenBackupProgress, OpenBackupResult } from '../backups';

export interface ToolkitApi {
  getBackupCatalog(vaultIds: string[]): Promise<BackupCatalog>;
  getBackupCatalogRecords(query: BackupCatalogQuery): Promise<BackupCatalogPage>;
  previewOpenBackup(options: OpenBackupOptions): Promise<OpenBackupPreview>;
  runOpenBackup(jobId: string, options: OpenBackupOptions, outputDir: string, onProgress: (p: OpenBackupProgress) => void): Promise<OpenBackupResult>;
  cancelOpenBackup(jobId: string): Promise<void>;
  saveBackupPreset(preset: BackupPreset): Promise<BackupPreset[]>;
  deleteBackupPreset(id: string): Promise<BackupPreset[]>;
  // Nodus Toolkit — local, deterministic file conversion. The job runs in main
  // and streams progress back; it survives navigation because the renderer's
  // background-jobs store re-subscribes. Cancellation is by jobId.
  runToolkitJob(
    request: ToolkitJobRequest,
    handlers: { onProgress: (progress: ToolkitJobProgress) => void },
  ): Promise<ToolkitJobResult>;
  cancelToolkitJob(jobId: string): Promise<void>;
  /** Open a file picker limited to the given extensions (empty = any file). */
  pickToolkitFiles(extensions: string[]): Promise<string[]>;
  /** Pick a destination folder; null when cancelled. */
  pickToolkitOutputDir(): Promise<string | null>;
  /** Reveal a produced file in the OS file manager. */
  revealToolkitOutput(filePath: string): Promise<void>;

  // Nodus Translate — AI translation of pasted text, local files and Zotero
  // attachments. Like Convert, the renderer re-attaches to progress after navigation.
  runTranslateJob(
    request: TranslateJobRequest,
    handlers: { onProgress: (progress: TranslateJobProgress) => void },
  ): Promise<TranslateJobResult>;
  cancelTranslateJob(jobId: string): Promise<void>;
  saveTranslatedText(text: string, targetLanguage: string, extension?: 'txt' | 'md' | 'html'): Promise<{ canceled: boolean; path?: string }>;
  listTranslateHistory(): Promise<TranslateHistoryEntry[]>;
  removeTranslateHistory(id: string, deleteOutput?: boolean): Promise<TranslateHistoryEntry[]>;

  // Nodus AI OCR (OCR Workspace) — a persistent, per-document OCR library backed by
  // vision models. Processing runs in main and survives navigation; progress is pushed
  // on 'aiOcr:event' (docId + snapshot), subscribed via onOcrEvent.
  createOcrDocs(input: AiOcrCreateRequest): Promise<OcrDoc[]>;
  listOcrDocs(): Promise<OcrDocSummary[]>;
  /** IDs of documents whose title or transcribed content matches the query (empty = all). */
  searchOcrDocs(query: string): Promise<string[]>;
  getOcrDoc(id: string): Promise<OcrDoc | null>;
  deleteOcrDoc(id: string): Promise<void>;
  cancelOcrDoc(id: string): Promise<void>;
  reprocessOcrPage(id: string, index: number, patch?: { model?: ModelRef | null }): Promise<void>;
  reprocessOcrDocument(id: string, patch?: { model?: ModelRef | null; options?: Partial<OcrOptions> }): Promise<void>;
  /** A rendered page image as a data URL, for page-by-page review. */
  getOcrPageImage(id: string, index: number): Promise<string | null>;
  /** The current Markdown of one page (manual edit if present, else the OCR text). */
  getOcrPageText(id: string, index: number): Promise<string>;
  /** Save a manual edit of one page; null reverts to the OCR reconstruction. */
  saveOcrPageEdit(id: string, index: number, text: string | null): Promise<void>;
  getOcrTranscript(id: string): Promise<string | null>;
  /** Export one document's transcript to disk (native save dialog). */
  exportOcrDoc(id: string, format: AiOcrExportFormat): Promise<AiOcrExportResult>;
  /** Export every completed document as one ZIP in the chosen format. */
  exportOcrDocsZip(ids: string[], format: AiOcrExportFormat): Promise<AiOcrExportResult>;
  /** Save a document's transcript into the active vault as a Markdown note. */
  saveOcrToVault(id: string): Promise<{ noteId: string; title: string }>;
  /** Native picker limited to PDF + image formats. */
  pickOcrFiles(): Promise<string[]>;
  /** Subscribe to per-document progress; returns an unsubscribe function. */
  onOcrEvent(cb: (docId: string, progress: OcrDocProgress) => void): () => void;

  // Nodus Protect — all filesystem and vault references are registered and
  // validated in the main process before bytes are exposed to the renderer.
  pickProtectFiles(multiple: boolean): Promise<ProtectSourceSummary[]>;
  registerProtectDroppedFiles(files: unknown[]): Promise<ProtectSourceSummary[]>;
  listProtectVaultSources(request?: ProtectListSourcesRequest): Promise<ProtectSourceSummary[]>;
  readProtectSource(ref: ProtectSourceRef): Promise<ProtectFilePayload>;
  saveProtectArtifactToDisk(artifact: ProtectArtifact): Promise<ProtectArtifactWriteResult>;
  shareProtectArtifact(artifact: ProtectArtifact): Promise<ProtectShareResult>;
  listProtectCopies(query?: string): Promise<ProtectVaultCopySummary[]>;
  saveProtectArtifactToVault(artifact: ProtectArtifact): Promise<ProtectVaultCopySummary>;
  downloadProtectCopy(copyId: string): Promise<ProtectArtifactWriteResult>;
  deleteProtectCopy(copyId: string): Promise<void>;

  // Nodus Apps — generated sandboxed mini-apps and ephemeral LAN sessions.
  generateToolkitApp(request: ToolkitAppGenerationRequest, onProgress?: (progress: ToolkitAppGenerationProgress) => void): Promise<ToolkitAppGenerationResult>;
  downloadToolkitAppPackage(manifest: ToolkitAppManifest): Promise<string | null>;
  startToolkitAppSession(manifest: ToolkitAppManifest): Promise<ToolkitAppSessionInfo>;
  stopToolkitAppSession(): Promise<void>;
  getToolkitAppSessionInfo(): Promise<ToolkitAppSessionInfo | null>;
  getToolkitAppSessionSnapshot(): Promise<ToolkitAppSessionSnapshot>;
  sendToolkitAppSessionMessage(channel: string, payload: ToolkitAppJsonValue): Promise<void>;
  onToolkitAppSessionEvent(cb: (event: ToolkitAppSessionEvent) => void): () => void;

  // PDF Presenter — global Toolkit library of imported PDFs. The library JSON is
  // read/written whole; PDF bytes stream over IPC for pdfjs (offline).
  getPresenterLibrary(): Promise<PresenterLibrary>;
  savePresenterLibrary(lib: PresenterLibrary): Promise<void>;
  /** Pick a PDF or externally-authored presentation; null when cancelled. */
  pickPresenterImport(): Promise<PresenterImportSelection | null>;
  /** Import a selected PDF, or convert a selected presentation locally first. */
  importPresenterFile(token: string): Promise<PresenterImportResult>;
  /** Raw PDF bytes for a presentation, or null if its copy is missing. */
  getPresenterPdfData(id: string): Promise<Uint8Array | null>;
  deletePresenterPresentation(id: string): Promise<void>;
  deletePresenterFolder(id: string, mode: PresenterFolderDeleteMode): Promise<PresenterLibrary>;
  /** Open a .pptx picker and extract its speaker notes; null when cancelled. */
  importPresenterPptxNotes(): Promise<PptxNotes | null>;
  /** Save every slide's speaker notes in the versioned, re-importable TXT format. */
  exportPresenterNotesTxt(presentation: Presentation): Promise<boolean>;
  /** Open a TXT notes export and parse it; null when cancelled. */
  importPresenterNotesTxt(): Promise<PptxNotes | null>;
  /** Save the library's PDF copy of a deck wherever the user chooses. `cancelled`
   *  is the user backing out of the native dialog; `missing` means the internal
   *  copy is gone and there is nothing to write. */
  downloadPresenterPdf(id: string, name: string): Promise<'saved' | 'cancelled' | 'missing'>;
  /** Open the audience window (full-screen, external display when present). */
  startPresenter(pdfId: string, startSlide?: number): Promise<void>;
  /** Open the audience + presenter windows together. */
  startPresenterMode(pdfId: string, startSlide?: number): Promise<void>;
  /** Close every presentation window. */
  stopPresenter(): Promise<void>;
  getPresenterState(): Promise<PresenterRuntimeState>;
  /** Mobile-remote server info + a QR data URL, or null when not presenting. */
  getPresenterServerInfo(): Promise<{ ip: string; port: number; pin: string; url: string; qr: string; native?: { url: string; qr: string; name: string; transport?: 'lan' } } | null>;
  /** System output volume 0–100 (macOS; 50 elsewhere). */
  getPresenterVolume(): Promise<number>;
  setPresenterVolume(volume: number): Promise<void>;
  /** Open the macOS Screen Mirroring / AirPlay picker (no-op elsewhere). */
  openPresenterCast(): Promise<boolean>;
  /** Send a control action (navigate, black-screen, zoom, timer…) to the hub. */
  sendPresenterControl(action: PresenterAction): void;
  /** Subscribe to control actions relayed from the other window; returns an unsubscribe. */
  onPresenterControl(cb: (action: PresenterAction) => void): () => void;
  /** Fires when the presentation ends (all windows closed). */
  onPresenterEnded(cb: () => void): () => void;
}
