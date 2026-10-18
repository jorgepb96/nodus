import { isManualAcademic } from '../ai/academicMode';
import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryMigrationProgress,
  LibraryMigrationPreview,
  LibraryMigrationReport,
  LibraryMigrationSession,
  LibraryMigrationStartRequest,
  LibraryRebuildResult,
  LibraryStatus,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  ZoteroSyncSession,
  LibraryExtractionEnqueueResult,
  LibraryExtractionJob,
  LibraryExtractionOptions,
  LibraryExtractionProgress,
  LibraryCollectionView,
  LibraryCollectionPatch,
  LibraryItemCollectionPatch,
  LibraryItemRecord,
  LibraryLocalImportReport,
  LibraryVaultFileImportReport,
  LibraryBibliographyImportReport,
  LibraryDuplicateGroup,
  LibraryItemMetadata,
  LibraryMetadataLookupResult,
  LibraryReferenceKind,
  LibraryIdentifierImportResult,
  LibraryVaultLink,
  LibraryVaultLinkReport,
  LibraryAttachmentPatch,
  LibraryNoteRecord,
  LibraryItemRelationType,
  LibraryTagPatch,
  LibraryTagRecord,
  LibrarySavedSearchRecord,
  LibrarySmartSearchGroup,
  LibraryViewPreferences,
  LibraryBibliographyExportRequest,
  LibraryBibliographyExportReport,
  LibraryCitationResult,
  LibraryCitationStyle,
  LibraryCitationStyleRecord,
  LibraryCitationStyleImportReport,
  LibraryMetadataBatchEntry,
  LibraryMetadataBatchProgress,
  LibraryMetadataBatchResult,
  LibraryTrashImpact,
  LibraryPurgeReport,
  LibraryMergeImpact,
  LibraryRecoveryReport,
  LibraryReadingPreparationPlan,
  GlobalLibrarySettings,
  LibraryCompassCandidate,
  LibraryCompassImportItemResult,
  LibraryCompassImportProgress,
  LibraryCompassImportReport,
} from '@shared/libraryTypes';
import { DEFAULT_GLOBAL_LIBRARY_SETTINGS } from '@shared/libraryAttachmentNaming';
import type {
  OfficeCitationDocumentRequest,
  OfficeCitationDocumentResult,
  OfficeReferenceSummary,
} from '@shared/officeCitationTypes';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';
import {
  configuredLibraryRoot,
  libraryDeviceId,
  localLibraryDatabasePath,
} from './libraryPaths';
import { getVault, listVaults } from '../vaults/vaultRegistry';
import { withVaultDatabase, getDb } from '../db/database';
import { getWork, getWorkByZoteroKey, upsertWork } from '../db/worksRepo';
import { LibraryMigrationSessionManager } from './libraryMigrationSessions';
import { importZoteroLibraries, previewZoteroLibraries } from './zoteroLibraryImport';
import { ZoteroSyncSessionStore } from './libraryZoteroSyncSessions';
import { LibraryExtractionQueue } from './libraryExtractionQueue';
import { completeTextNeutral } from '../ai/aiClient';
import { getSettings } from '../db/settingsRepo';
import { localizeIpcPayload } from '@shared/uiLanguage';
import { buildLocalizedOcrTextPrompt, ocrUserPrompt } from '@shared/aiOcrPrompt';
import { DEFAULT_OCR_OPTIONS } from '@shared/aiOcrTypes';
import { withPipelineLogScope } from '../logging/pipelineLogCore';
import { LibraryOperations } from './libraryOperations';
import { normalizeLibraryCollectionRecord, normalizeLibraryItemRecord } from './libraryRecord';
import { resolveLibraryMetadata } from './libraryMetadataResolver';
import { downloadLibraryFullText } from './libraryFullText';
import { libraryItemIdentifier, runLibraryMetadataBatch } from './libraryMetadataBatch';
import { mergeLibraryMetadataCandidate } from '@shared/libraryMetadata';
import { propagateLibraryInvalidations, settleLibraryInvalidationsForItem } from './libraryInvalidation';
import { listLibraryAnalysisProvenance } from '../db/libraryAnalysisProvenance';
import type { LibraryAnalysisReuseComponent, LibraryAnalysisReuseStatus } from '@shared/libraryTypes';
import { reuseVaultAnalysisForWorks } from '../vaults/vaultAnalysisImport';
import { libraryRevisionFingerprint } from './libraryVaultProvenance';
import { notifyGlobalLibraryChanged, registerGlobalLibraryCloser } from './libraryRuntime';
import { documentIndexQueue } from '../pipeline/documentIndexQueue';
import {
  formatLibraryCitationCsl,
  formatLibraryOfficeDocumentCsl,
  importLibraryCitationStyleFiles,
  importZoteroCitationStyleDirectories,
  installRepositoryCitationStyle,
  searchRepositoryCitationStyles,
  listLibraryCitationStyles,
  removeLibraryCitationStyle,
} from './libraryCslStyles';
import { disposeLibraryOperationWorkers, runLibraryOperationInWorker } from './libraryOperationWorkerHost';
export { recordLinkedLibraryAnalysis } from './libraryVaultProvenance';

let live: {
  root: string;
  deviceId: string;
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  extraction: LibraryExtractionQueue;
  operations: LibraryOperations;
  migrations: LibraryMigrationSessionManager;
} | null = null;
const zoteroImports = new Map<string, { controller: AbortController; cancelable: boolean }>();
// Zotero is a single local API/database surface.  Serialize every global import
// (UI, plugin and account-sync) even when callers use different request IDs.
let zoteroImportTail: Promise<void> = Promise.resolve();
const compassImports = new Map<string, AbortController>();
const metadataBatches = new Map<string, { controller: AbortController; result: LibraryMetadataBatchResult | null }>();
const SHORT_READING_PAGE_LIMIT = 50;
const LONG_REFLOWABLE_BYTE_THRESHOLD = 8 * 1024 * 1024;

/** Validate the untrusted selection received from account-sync/plugin callers. */
export function normalizeZoteroImportSelection(input: unknown): ZoteroImportSelection {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('La selección de Zotero no es válida.');
  const value = input as Record<string, unknown>;
  const list = (name: string): string[] | undefined => {
    const raw = value[name];
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) throw new Error(`La selección de Zotero contiene ${name} no válido.`);
    if (raw.length > 10_000) throw new Error(`La selección de Zotero contiene demasiados valores en ${name}.`);
    const out = raw.map((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) throw new Error(`La selección de Zotero contiene ${name} no válido.`);
      return entry.trim();
    });
    return [...new Set(out)];
  };
  const boolean = (name: keyof ZoteroImportSelection): boolean | undefined => {
    const raw = value[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'boolean') throw new Error(`La selección de Zotero contiene ${String(name)} no válido.`);
    return raw;
  };
  const result: ZoteroImportSelection = {};
  const libraryIds = list('libraryIds'); if (libraryIds) result.libraryIds = libraryIds;
  const collectionIds = list('collectionIds'); if (collectionIds) result.collectionIds = collectionIds;
  const includeUnfiled = boolean('includeUnfiled'); if (includeUnfiled !== undefined) result.includeUnfiled = includeUnfiled;
  const copyAttachments = boolean('copyAttachments'); if (copyAttachments !== undefined) result.copyAttachments = copyAttachments;
  const includeStandaloneFiles = boolean('includeStandaloneFiles'); if (includeStandaloneFiles !== undefined) result.includeStandaloneFiles = includeStandaloneFiles;
  const fullRefresh = boolean('fullRefresh'); if (fullRefresh !== undefined) result.fullRefresh = fullRefresh;
  return result;
}

function bibliographicPageCount(pages?: string): number | null {
  if (!pages) return null;
  const values = pages.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (values.length >= 2) return Math.max(1, Math.abs(values.at(-1)! - values[0]) + 1);
  return values[0] && values[0] > 0 ? values[0] : null;
}

async function libraryRemoteOcr(input: { image: Buffer; mimeType: 'image/png' }): Promise<string> {
  const settings = getSettings();
  const model = settings.visionModel ?? settings.extractionModel ?? null;
  if (!model) throw new Error('No hay un modelo de visión configurado para el OCR remoto explícito.');
  const promptLanguage = settings.promptLanguage ?? 'es';
  // The vision call is the one AI step the extraction engine makes per page: without a scope
  // its failures would arrive in the log with no document behind them.
  return withPipelineLogScope({
    scope: 'ocr',
    provider: model.provider,
    model: model.model,
  }, () => completeTextNeutral({
    system: buildLocalizedOcrTextPrompt({ ...DEFAULT_OCR_OPTIONS, outputMode: 'text', promptLanguage }),
    user: ocrUserPrompt(promptLanguage),
    images: [{ base64: input.image.toString('base64'), mediaType: input.mimeType }],
    temperature: 0.1, maxTokens: 8000, plainContext: true,
  }, model));
}

function unavailableStatus(): LibraryStatus {
  return {
    configured: false,
    root: null,
    formatVersion: 2,
    deviceId: null,
    items: 0,
    collections: 0,
    attachments: 0,
    conflicts: 0,
    invalidRecords: 0,
    lastRebuiltAt: null,
  };
}

function service(): NonNullable<typeof live> | null {
  const root = configuredLibraryRoot();
  if (!root) {
    live?.extraction.dispose();
    live?.catalog.close();
    live = null;
    return null;
  }
  if (live?.root === root) return live;
  live?.extraction.dispose();
  live?.catalog.close();
  const deviceId = libraryDeviceId();
  const store = new LibraryDiskStore(root, deviceId);
  store.initialize();
  const catalog = new LibraryCatalog(localLibraryDatabasePath());
  const extraction = new LibraryExtractionQueue({ store, catalog, onProgress: broadcastExtraction, remoteOcr: libraryRemoteOcr });
  const migrations = new LibraryMigrationSessionManager(store, catalog, listVaults, broadcastMigration);
  const operations = new LibraryOperations(store, catalog);
  live = { root, deviceId, store, catalog, extraction, operations, migrations };
  setImmediate(() => {
    if (live?.root !== root) return;
    try {
      if (operations.repairCloudRenamedAttachmentPaths() > 0) broadcast(catalog.status(root, deviceId));
    } catch (error) {
      console.error('[library] encoded attachment path repair failed', error);
    }
  });
  if (catalog.status(root, deviceId).lastRebuiltAt) {
    setImmediate(() => {
      if (live?.root !== root) return;
      void runLibraryOperationInWorker(
        { root, deviceId, catalogFile: catalog.file }, 'ensure-citation-keys', [],
        () => operations.ensureCitationKeys(),
      ).catch(() => undefined);
    });
  }
  return live;
}

function workerContext(current: NonNullable<ReturnType<typeof service>>) {
  return { root: current.root, deviceId: current.deviceId, catalogFile: current.catalog.file };
}

async function ensureCatalogReady(current: NonNullable<ReturnType<typeof service>>): Promise<void> {
  if (current.catalog.status(current.root, current.deviceId).lastRebuiltAt) return;
  await runLibraryOperationInWorker(
    workerContext(current), 'rebuild', [], () => current.catalog.rebuild(current.store),
  );
}

function broadcast(status: LibraryStatus): void {
  notifyGlobalLibraryChanged();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('library:changed', status);
    }
  }
}

function broadcastMigration(progress: LibraryMigrationProgress): void {
  const localized = localizeIpcPayload(progress, getSettings().uiLanguage);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('library:migrationProgress', localized);
    }
  }
}

function broadcastExtraction(progress: LibraryExtractionProgress): void {
  if (progress.status === 'done' && live) settleLibraryInvalidationsForItem(progress.itemId, live.store, live.catalog);
  if (progress.status === 'done') notifyGlobalLibraryChanged();
  const localized = localizeIpcPayload(progress, getSettings().uiLanguage);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('library:extractionProgress', localized);
  }
}

export function getGlobalLibraryStatus(): LibraryStatus {
  const current = service();
  return current ? current.catalog.status(current.root, current.deviceId) : unavailableStatus();
}

export function rebuildGlobalLibrary(): LibraryRebuildResult {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.catalog.rebuild(current.store);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export async function rebuildGlobalLibraryInBackground(): Promise<LibraryRebuildResult> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'rebuild', [], () => current.catalog.rebuild(current.store),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function listGlobalLibraryItems(query?: LibraryCatalogQuery): LibraryCatalogPage {
  const current = service();
  if (!current) return {
    items: [], total: 0, limit: Math.max(1, Math.min(500, query?.limit ?? 100)), offset: Math.max(0, query?.offset ?? 0),
    facets: { sources: [], itemTypes: [], extraction: [], attachments: [], years: [], tags: [], vaults: [] },
  };
  const status = current.catalog.status(current.root, current.deviceId);
  if (!status.lastRebuiltAt) current.catalog.rebuild(current.store);
  let resolved = query;
  if (query?.savedSearchId) {
    const saved = current.operations.listSavedSearches().find((entry) => entry.id === query.savedSearchId);
    if (!saved) throw new Error('La búsqueda guardada ya no existe.');
    resolved = { ...query, smartSearch: saved.query };
  }
  return current.catalog.list(resolved);
}

export async function listGlobalLibraryItemsResponsive(query?: LibraryCatalogQuery): Promise<LibraryCatalogPage> {
  const current = service();
  if (current && !current.catalog.status(current.root, current.deviceId).lastRebuiltAt) {
    await runLibraryOperationInWorker(
      workerContext(current), 'rebuild', [], () => current.catalog.rebuild(current.store),
    );
  }
  return listGlobalLibraryItems(query);
}

export async function migrateExistingVaultLibraries(): Promise<LibraryMigrationReport> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  await ensureCatalogReady(current);
  const preview = current.migrations.preview();
  const selectedVaultIds = preview.vaults.filter((vault) => vault.available).map((vault) => vault.id);
  const session = await current.migrations.start({ preview, selectedVaultIds });
  if (!session.report || session.status !== 'completed') throw new Error(session.error ?? 'La migración no se completó.');
  const readyToExtract = current.catalog.pendingExtractionItemIds('zotero');
  if (readyToExtract.length) current.extraction.enqueue(readyToExtract);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return session.report;
}

export function previewLibraryMigration(): LibraryMigrationPreview {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return current.migrations.preview();
}

export async function startLibraryMigration(request: LibraryMigrationStartRequest): Promise<LibraryMigrationSession> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  await ensureCatalogReady(current);
  const session = await current.migrations.start(request);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return session;
}

export async function resumeLibraryMigration(sessionId: string): Promise<LibraryMigrationSession> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  await ensureCatalogReady(current);
  const session = await current.migrations.resume(sessionId);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return session;
}

export function cancelLibraryMigration(sessionId: string): boolean {
  return service()?.migrations.cancel(sessionId) ?? false;
}

export function rollbackLibraryMigration(sessionId: string): LibraryMigrationSession {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const session = current.migrations.rollback(sessionId);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return session;
}

export function listLibraryMigrationSessions(): LibraryMigrationSession[] {
  return service()?.migrations.list() ?? [];
}

export function listZoteroImportLibraries(): Promise<ZoteroLibraryPreview[]> {
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  return previewZoteroLibraries(current.catalog);
}

export async function startZoteroLibraryImport(
  requestId: string,
  selection: ZoteroImportSelection | undefined,
  onProgress: (progress: ZoteroImportProgress) => void,
): Promise<ZoteroImportReport> {
  if (!requestId?.trim()) throw new Error('La importación necesita un identificador de solicitud.');
  if (zoteroImports.has(requestId)) throw new Error('Esa importación de Zotero ya está en curso.');
  const normalizedSelection = normalizeZoteroImportSelection(selection);
  const controller = new AbortController();
  const activeImport = { controller, cancelable: true };
  zoteroImports.set(requestId, activeImport);
  const previous = zoteroImportTail;
  let release!: () => void;
  zoteroImportTail = new Promise<void>((resolve) => { release = resolve; });
  try {
    await previous;
    const current = service();
    if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
    if (!current.catalog.status(current.root, current.deviceId).lastRebuiltAt) {
      await runLibraryOperationInWorker(
        workerContext(current), 'rebuild', [], () => current.catalog.rebuild(current.store),
      );
    }
    const sessions = new ZoteroSyncSessionStore(current.root);
    let latestProgress: ZoteroImportProgress | null = null;
    const importerProgress = (value: ZoteroImportProgress): void => {
      latestProgress = value;
      if (value.phase === 'failed' || value.phase === 'canceled') activeImport.cancelable = false;
      onProgress(value);
    };
    let report = await importZoteroLibraries({
      requestId, selection: normalizedSelection, store: current.store, catalog: current.catalog,
      signal: controller.signal, onProgress: importerProgress, deferSessionCompletion: true,
    });
    const finishCanceled = (): ZoteroImportReport => {
      const canceledReport: ZoteroImportReport = {
        ...report,
        canceled: true,
        partial: true,
        verification: report.verification ? { ...report.verification, status: 'blocked' } : report.verification,
      };
      const prior = latestProgress ?? {
        requestId, phase: 'rebuild' as const, libraryId: null, libraryName: null,
        processedItems: report.itemsDiscovered, totalItems: report.itemsDiscovered,
        processedAttachments: report.attachmentsCopied + report.attachmentsUnchanged,
        totalAttachments: report.attachmentsCopied + report.attachmentsUnchanged,
        percent: 99, message: 'Finalizando importación…',
      };
      const canceledProgress: ZoteroImportProgress = {
        ...prior, phase: 'canceled', percent: 100,
        finishedAt: new Date().toISOString(), currentItem: null, currentItemStartedAt: null,
        message: 'Importación cancelada; el catálogo ya importado se conserva.',
      };
      activeImport.cancelable = false;
      sessions.progress(requestId, canceledProgress);
      sessions.finish(requestId, 'canceled', canceledReport);
      latestProgress = canceledProgress;
      onProgress(canceledProgress);
      return canceledReport;
    };
    if (controller.signal.aborted && !report.canceled) report = finishCanceled();
    if (!report.partial && !report.canceled && report.verification?.status !== 'blocked') {
      try {
        await runLibraryOperationInWorker(
          workerContext(current), 'ensure-citation-keys', [], () => current.operations.ensureCitationKeys(),
        );
        if (controller.signal.aborted) {
          report = finishCanceled();
          broadcast(current.catalog.status(current.root, current.deviceId));
          return report;
        }
        const readyToExtract = current.catalog.pendingExtractionItemIds('zotero');
        if (readyToExtract.length) current.extraction.enqueue(readyToExtract);
        const prior = latestProgress!;
        const completeProgress: ZoteroImportProgress = {
          ...prior, phase: 'complete', percent: 100,
          finishedAt: new Date().toISOString(), currentItem: null, currentItemStartedAt: null,
          message: 'Importación de Zotero completada, verificada y preparada para extracción.',
        };
        activeImport.cancelable = false;
        sessions.progress(requestId, completeProgress);
        sessions.finish(requestId, 'completed', report);
        latestProgress = completeProgress;
        onProgress(completeProgress);
      } catch (error) {
        if (controller.signal.aborted) {
          report = finishCanceled();
          broadcast(current.catalog.status(current.root, current.deviceId));
          return report;
        }
        const message = error instanceof Error ? error.message : String(error);
        const verification = report.verification ?? {
          status: 'blocked' as const,
          expected: { libraries: report.libraries, items: report.itemsDiscovered, attachments: report.attachmentsCopied + report.attachmentsUnchanged },
          imported: { libraries: 0, items: report.itemsCreated + report.itemsUpdated + report.itemsUnchanged, attachments: report.attachmentsCopied + report.attachmentsUnchanged },
          mismatches: [],
        };
        const failedReport: ZoteroImportReport = {
          ...report,
          partial: true,
          warnings: [...report.warnings, `Falló el postproceso obligatorio de la importación: ${message}`],
          failures: [...report.failures, {
            libraryId: null, code: 'storage', retryable: true,
            message: `Falló el postproceso obligatorio de la importación: ${message}`,
          }],
          verification: {
            ...verification,
            status: 'blocked',
            mismatches: [...verification.mismatches, {
              kind: 'unknown', expected: 1, imported: 0,
              message: 'No se completaron la normalización de claves de cita y el encolado de extracción.',
            }],
          },
        };
        const session = sessions.get(requestId);
        if (session) {
          const failedProgress: ZoteroImportProgress = {
            ...session.progress,
            phase: 'failed',
            finishedAt: new Date().toISOString(), currentItem: null, currentItemStartedAt: null,
            message: `Falló el postproceso obligatorio de la importación: ${message}`,
          };
          sessions.progress(requestId, failedProgress);
          activeImport.cancelable = false;
          onProgress(failedProgress);
        }
        sessions.finish(requestId, 'failed', failedReport, message);
        throw error;
      }
    }
    broadcast(current.catalog.status(current.root, current.deviceId));
    return report;
  } finally {
    zoteroImports.delete(requestId);
    release();
  }
}

export function listZoteroSyncSessions(): ZoteroSyncSession[] {
  const current = service();
  if (!current) return [];
  return new ZoteroSyncSessionStore(current.root).list().map((session) => (
    session.status === 'running' && !zoteroImports.has(session.id)
      ? {
        ...session,
        status: 'failed' as const,
        error: session.error ?? 'La aplicación se cerró durante esta importación; puede reanudarse de forma segura.',
      }
      : session
  ));
}

export function resumeZoteroLibraryImport(
  requestId: string,
  onProgress: (progress: ZoteroImportProgress) => void,
): Promise<ZoteroImportReport> {
  const current = service();
  if (!current) return Promise.reject(new Error('Configura primero la carpeta de copias de seguridad de Nodus.'));
  const session = new ZoteroSyncSessionStore(current.root).get(requestId);
  if (!session) return Promise.reject(new Error('No se encontró esa sesión de sincronización.'));
  if (session.status === 'running' && zoteroImports.has(requestId)) {
    return Promise.reject(new Error('Esa sincronización todavía está en curso.'));
  }
  if (session.status === 'completed' && !session.report?.partial && session.report?.verification?.status !== 'blocked') {
    return Promise.reject(new Error('Esa sincronización ya se completó.'));
  }
  return startZoteroLibraryImport(requestId, session.selection, onProgress);
}

export function cancelZoteroLibraryImport(requestId: string): boolean {
  const active = zoteroImports.get(requestId);
  if (!active?.cancelable || active.controller.signal.aborted) return false;
  active.controller.abort();
  return true;
}

/** Import Compass results in bounded worker requests, retaining per-item state. */
export async function startGlobalLibraryCompassImport(
  requestId: string,
  candidates: LibraryCompassCandidate[],
  collectionIds: string[] = [],
  onProgress: (progress: LibraryCompassImportProgress) => void = () => undefined,
): Promise<LibraryCompassImportReport> {
  if (!requestId?.trim()) throw new Error('La importación de Compass necesita un identificador de solicitud.');
  if (compassImports.has(requestId)) throw new Error('Esa importación de Compass ya está en curso.');
  if (!Array.isArray(candidates) || candidates.length > 10_000) throw new Error('La importación de Compass supera el límite permitido.');
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  await ensureCatalogReady(current);
  const controller = new AbortController(); compassImports.set(requestId, controller);
  const unique = [...new Map(candidates.map((candidate) => [String(candidate?.canonicalKey ?? '').trim(), candidate])).values()]
    .filter((candidate) => !!candidate && String(candidate.canonicalKey ?? '').trim());
  const items: LibraryCompassImportItemResult[] = [];
  const emit = (currentKey: string | null): void => {
    onProgress({ requestId, completed: items.length, total: unique.length,
      created: items.filter((item) => item.state === 'created').length,
      linked: items.filter((item) => ['linked-existing', 'metadata-completed', 'skipped-duplicate'].includes(item.state)).length,
      failed: items.filter((item) => item.state === 'failed').length,
      canceled: controller.signal.aborted, currentKey });
  };
  emit(null);
  let status: LibraryCompassImportReport['status'] = 'completed';
  try {
    for (let offset = 0; offset < unique.length; offset += 25) {
      const chunk = unique.slice(offset, offset + 25);
      if (controller.signal.aborted) {
        items.push(...chunk.map((candidate) => ({ canonicalKey: candidate.canonicalKey, state: 'canceled' as const })));
        status = 'canceled'; emit(null); break;
      }
      try {
        const result = await runLibraryOperationInWorker<LibraryCompassImportReport>(
          workerContext(current), 'import-compass-candidates', [chunk, collectionIds, requestId],
          () => current.operations.importCompassCandidates(chunk, collectionIds, requestId),
          { signal: controller.signal },
        );
        for (const item of result.items) { items.push(item); emit(item.canonicalKey); }
      } catch (error) {
        if (controller.signal.aborted) {
          items.push(...chunk.map((candidate) => ({ canonicalKey: candidate.canonicalKey, state: 'canceled' as const })));
          status = 'canceled'; emit(null); break;
        }
        items.push(...chunk.map((candidate) => ({ canonicalKey: candidate.canonicalKey, state: 'failed' as const, error: error instanceof Error ? error.message : String(error) })));
        status = 'failed'; emit(chunk.at(-1)?.canonicalKey ?? null);
      }
    }
    if (controller.signal.aborted && items.length < unique.length) {
      items.push(...unique.slice(items.length).map((candidate) => ({ canonicalKey: candidate.canonicalKey, state: 'canceled' as const })));
      status = 'canceled';
    }
    if (items.some((item) => item.state === 'canceled')) status = 'canceled';
    broadcast(current.catalog.status(current.root, current.deviceId));
    return {
      requestId, status, items,
      created: items.filter((item) => item.state === 'created').length,
      linked: items.filter((item) => ['linked-existing', 'metadata-completed', 'skipped-duplicate'].includes(item.state)).length,
      failed: items.filter((item) => item.state === 'failed').length,
      canceled: status === 'canceled',
    };
  } finally { compassImports.delete(requestId); }
}

export function cancelGlobalLibraryCompassImport(requestId: string): boolean {
  const controller = compassImports.get(requestId); if (!controller) return false;
  controller.abort(); return true;
}

export function enqueueLibraryExtraction(
  itemIds: string[],
  options?: Partial<LibraryExtractionOptions>,
  priority?: number,
): LibraryExtractionEnqueueResult {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return current.extraction.enqueue(itemIds.map((id) => current.catalog.resolveItemId(id) ?? id), options, priority);
}

export function listLibraryExtractionJobs(): LibraryExtractionJob[] {
  return service()?.extraction.list() ?? [];
}

export function cancelLibraryExtraction(jobId: string): boolean {
  return service()?.extraction.cancel(jobId) ?? false;
}

export function retryLibraryExtraction(jobId: string): boolean {
  return service()?.extraction.retry(jobId) ?? false;
}

export async function prepareGlobalLibraryReading(itemId: string): Promise<LibraryReadingPreparationPlan> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const resolvedId = current.catalog.resolveItemId(itemId) ?? itemId;
  const item = getGlobalLibraryItem(resolvedId);
  if (!item) return { itemId: resolvedId, action: 'unavailable', attachmentId: null, pageCount: null, byteSize: 0, jobId: null, reason: 'no-file' };
  const original = item.attachments.find((entry) => entry.role === 'original' && !['source-missing', 'corrupt'].includes(entry.sourceState ?? 'available'))
    ?? item.attachments.find((entry) => !['source-missing', 'corrupt'].includes(entry.sourceState ?? 'available'))
    ?? null;
  if (item.files?.reader && item.extraction?.status !== 'failed') {
    return { itemId: item.id, action: 'open-clean', attachmentId: original?.id ?? null, pageCount: bibliographicPageCount(item.metadata.pages), byteSize: original?.byteSize ?? 0, jobId: null, reason: 'ready' };
  }
  if (!original) return { itemId: item.id, action: 'unavailable', attachmentId: null, pageCount: null, byteSize: 0, jobId: null, reason: 'no-file' };

  let pageCount = bibliographicPageCount(item.metadata.pages);
  if (pageCount == null && original.mimeType === 'application/pdf') {
    try {
      const file = current.operations.attachmentPath(item.id, original.id);
      const probed = await runLibraryOperationInWorker<{ pageCount: number | null }>(
        workerContext(current), 'probe-reading', [file, original.mimeType], () => ({ pageCount: null }),
      );
      pageCount = probed.pageCount;
    } catch { pageCount = null; }
  }
  const longDocument = pageCount != null
    ? pageCount >= SHORT_READING_PAGE_LIMIT
    : original.byteSize >= LONG_REFLOWABLE_BYTE_THRESHOLD;
  const enqueue = current.extraction.enqueue([item.id], {}, longDocument ? 0 : 100);
  return {
    itemId: item.id,
    action: longDocument ? 'queue-and-open-original' : 'prepare-before-open',
    attachmentId: original.id,
    pageCount,
    byteSize: original.byteSize,
    jobId: enqueue.jobIds[0] ?? null,
    reason: longDocument ? 'long-document' : 'short-document',
  };
}

export function listGlobalLibraryCollections(): LibraryCollectionView[] {
  return service()?.operations.listCollections() ?? [];
}

export function listGlobalLibrarySavedSearches(): LibrarySavedSearchRecord[] {
  return service()?.operations.listSavedSearches() ?? [];
}

export function saveGlobalLibrarySavedSearch(input: { id?: string; name: string; query: LibrarySmartSearchGroup }): LibrarySavedSearchRecord {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const record = current.operations.saveSavedSearch(input);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return record;
}

export function deleteGlobalLibrarySavedSearch(id: string): boolean {
  const current = service();
  if (!current) return false;
  const deleted = current.operations.deleteSavedSearch(id);
  if (deleted) broadcast(current.catalog.status(current.root, current.deviceId));
  return deleted;
}

export function getGlobalLibraryViewPreferences(): LibraryViewPreferences {
  return service()?.operations.getViewPreferences() ?? {
    visibleColumns: ['title', 'creator', 'year', 'source', 'status'],
    columnWidths: {},
    sort: [{ field: 'updatedAt', direction: 'desc' }, { field: 'title', direction: 'asc' }],
  };
}

export function setGlobalLibraryViewPreferences(preferences: LibraryViewPreferences): LibraryViewPreferences {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return current.operations.setViewPreferences(preferences);
}

export function getGlobalLibrarySettings(): GlobalLibrarySettings {
  return service()?.operations.getSettings() ?? { ...DEFAULT_GLOBAL_LIBRARY_SETTINGS };
}

export function setGlobalLibrarySettings(settings: GlobalLibrarySettings): GlobalLibrarySettings {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const saved = current.operations.setSettings(settings);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return saved;
}

export function getGlobalLibraryItem(itemId: string): LibraryItemRecord | null {
  const current = service();
  if (!current) return null;
  const storageId = current.catalog.itemStorageId(itemId);
  return storageId ? current.store.readMaterializedItem(storageId) : null;
}

/** Shared duplicate lookup for capture/import entry points. */
export function findGlobalLibraryItemByMetadata(metadata: LibraryItemMetadata, allowUrlMatch = true, captureRequestId?: string): {
  item: LibraryItemRecord;
  matchedBy: 'request' | 'identifier' | 'bibliography' | 'url';
} | null {
  const current = service();
  if (!current) return null;
  if (!current.catalog.status(current.root, current.deviceId).lastRebuiltAt) current.catalog.rebuild(current.store);
  const match = current.catalog.findItemIdByMetadata(metadata, allowUrlMatch, captureRequestId);
  if (!match) return null;
  const storageId = current.catalog.itemStorageId(match.itemId);
  const item = storageId ? current.store.readMaterializedItem(storageId) : null;
  return item ? { item, matchedBy: match.matchedBy } : null;
}

/** Full immutable records consumed by the account-global sync lane. This deliberately returns
 * no vault links, provider credentials or local paths: those never leave Desktop. */
export function getGlobalLibrarySyncSnapshot(): {
  root: string;
  deviceId: string;
  items: LibraryItemRecord[];
  collections: import('@shared/libraryTypes').LibraryCollectionRecord[];
  savedSearches: LibrarySavedSearchRecord[];
  preferences: LibraryViewPreferences & { format: 'nodus.library-view-preferences'; formatVersion: 1; id: string; updatedAt: string };
} | null {
  const current = service();
  if (!current) return null;
  const preferenceFile = `${current.root}/.nodus/view-preferences.json`;
  let preferenceUpdatedAt = '1970-01-01T00:00:00.000Z';
  try { preferenceUpdatedAt = fs.statSync(preferenceFile).mtime.toISOString(); } catch { /* defaults have no file yet */ }
  return {
    root: current.root,
    deviceId: current.deviceId,
    items: current.store.scanMaterializedItems().records,
    collections: current.store.scanMaterializedCollections().records,
    savedSearches: current.operations.listSavedSearches(),
    preferences: {
      format: 'nodus.library-view-preferences', formatVersion: 1,
      id: 'nodus:library-view-preferences:default',
      ...current.operations.getViewPreferences(), updatedAt: preferenceUpdatedAt,
    },
  };
}

/** Merge one cloud winner using the Library's own vector-clock comparison and rebuild only its
 * catalogue row. Opaque or future record formats are refused instead of guessed. */
export function mergeGlobalLibrarySyncRecord(payload: unknown): 'item' | 'collection' | 'saved-search' | 'preferences' | null {
  const current = service();
  if (!current) return null;
  const item = normalizeLibraryItemRecord(payload);
  if (item) {
    const winner = current.store.mergeItem(item);
    current.catalog.indexItem(winner, current.store);
    broadcast(current.catalog.status(current.root, current.deviceId));
    return 'item';
  }
  const collection = normalizeLibraryCollectionRecord(payload);
  if (collection) {
    const winner = current.store.mergeCollection(collection);
    current.catalog.indexCollection(winner);
    broadcast(current.catalog.status(current.root, current.deviceId));
    return 'collection';
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (record.format === 'nodus.library-saved-search' && record.formatVersion === 1 && typeof record.id === 'string'
      && typeof record.name === 'string' && typeof record.createdAt === 'string' && typeof record.updatedAt === 'string' && record.query) {
      current.operations.mergeSavedSearch(record as unknown as LibrarySavedSearchRecord);
      broadcast(current.catalog.status(current.root, current.deviceId));
      return 'saved-search';
    }
    if (record.format === 'nodus.library-view-preferences' && Array.isArray(record.visibleColumns) && Array.isArray(record.sort)) {
      current.operations.setViewPreferences(record as unknown as LibraryViewPreferences);
      broadcast(current.catalog.status(current.root, current.deviceId));
      return 'preferences';
    }
  }
  return null;
}

export function globalLibrarySyncAttachmentPath(itemId: string, attachmentId: string): string | null {
  const current = service();
  if (!current) return null;
  try { return current.operations.attachmentPath(itemId, attachmentId); } catch { return null; }
}

export function mergeGlobalLibrarySyncTombstone(recordId: string): boolean {
  const current = service();
  if (!current) return false;
  const storageId = current.catalog.itemStorageId(recordId);
  if (storageId) {
    const item = current.store.readMaterializedItem(storageId);
    if (!item) return false;
    const next = current.store.upsertItem({ ...item, deletedAt: new Date().toISOString() }, item.clock.revision);
    current.catalog.indexItem(next, current.store);
    broadcast(current.catalog.status(current.root, current.deviceId));
    return true;
  }
  const collection = current.store.readMaterializedCollection(recordId);
  if (!collection) {
    if (recordId.startsWith('saved-search:') || recordId.startsWith('nodus:saved-search:')) return current.operations.deleteSavedSearch(recordId);
    return false;
  }
  const next = current.store.upsertCollection({ ...collection, deletedAt: new Date().toISOString() }, collection.clock.revision);
  current.catalog.indexCollection(next);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return true;
}

export function createGlobalLibraryCollection(name: string, parentId: string | null): LibraryCollectionView {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.createCollection(name, parentId);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export async function updateGlobalLibraryCollection(
  id: string,
  patch: LibraryCollectionPatch,
): Promise<LibraryCollectionView> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'update-collection', [id, patch], () => current.operations.updateCollection(id, patch),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export async function deleteGlobalLibraryCollection(id: string, deleteItems?: boolean): Promise<number> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'delete-collection', [id, deleteItems], () => current.operations.deleteCollection(id, deleteItems),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export async function patchGlobalLibraryItemCollections(itemIds: string[], patch: LibraryItemCollectionPatch): Promise<number> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'patch-item-collections', [itemIds, patch], () => current.operations.patchItemCollections(itemIds, patch),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export async function setGlobalLibraryItemsDeleted(itemIds: string[], deleted: boolean): Promise<number> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'set-items-deleted', [itemIds, deleted], () => current.operations.setItemsDeleted(itemIds, deleted),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export async function previewGlobalLibraryTrash(itemIds: string[]): Promise<LibraryTrashImpact> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return runLibraryOperationInWorker(workerContext(current), 'trash-impact', [itemIds], () => current.operations.trashImpact(itemIds));
}

export async function purgeGlobalLibraryTrash(itemIds: string[]): Promise<LibraryPurgeReport> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(workerContext(current), 'purge-trash', [itemIds], () => current.operations.purgeTrash(itemIds));
  broadcast(current.catalog.status(current.root, current.deviceId)); return result;
}

export async function auditGlobalLibraryRecovery(): Promise<LibraryRecoveryReport> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return runLibraryOperationInWorker(workerContext(current), 'audit-recovery', [], () => current.operations.auditRecovery());
}

export async function importGlobalLibraryFiles(files: string[], collectionId?: string | null): Promise<LibraryLocalImportReport> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const report = await runLibraryOperationInWorker(
    workerContext(current), 'import-files', [files, collectionId], () => current.operations.importLocalFiles(files, collectionId),
  );
  if (report.itemIds.length && current.operations.getSettings().autoPrepareAttachments) current.extraction.enqueue(report.itemIds);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return report;
}

/** Files dropped on a vault's Library land in the Global Library and are used in that
 * vault in one step. A file whose exact bytes are already in the Global Library is not
 * copied again; its existing item is used in the vault instead. Linking creates the
 * vault work, so the vault's automatic preparation picks it up like any other addition. */
export async function importGlobalLibraryFilesIntoVault(files: string[], vaultId: string): Promise<LibraryVaultFileImportReport> {
  if (!getVault(vaultId)) throw new Error('El vault seleccionado ya no existe.');
  const report = await importGlobalLibraryFiles(files, null);
  const itemIds = [...new Set([...report.itemIds, ...(report.existingItemIds ?? [])])];
  if (!itemIds.length) return { ...report, vaultId, linked: 0, alreadyInVault: 0 };
  const link = await linkGlobalLibraryItemsToVault(itemIds, vaultId);
  return { ...report, vaultId, linked: link.linked, alreadyInVault: link.existing };
}

export async function importGlobalBibliographyFiles(files: string[], collectionId?: string | null): Promise<LibraryBibliographyImportReport> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const report = await runLibraryOperationInWorker(
    workerContext(current), 'import-bibliography', [files, collectionId], () => current.operations.importBibliographyFiles(files, collectionId),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return report;
}

function finishItemMutation(current: NonNullable<ReturnType<typeof service>>, result: LibraryItemRecord): LibraryItemRecord {
  const final = propagateLibraryInvalidations(result, current.store, current.catalog);
  if (final.clock.revision !== result.clock.revision) current.catalog.indexItem(final, current.store);
  if (final.contentRevision?.components.extraction.freshness === 'queued' && final.attachments.length
    && current.operations.getSettings().autoPrepareAttachments) current.extraction.enqueue([final.id]);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return final;
}

export function createGlobalLibraryItem(metadata: LibraryItemMetadata, collectionIds?: string[]): LibraryItemRecord {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return finishItemMutation(current, current.operations.createItem(metadata, collectionIds));
}

/** Fill absent fields without replacing better values or user overrides. */
export function mergeGlobalLibraryItemMetadataIfMissing(itemId: string, metadata: LibraryItemMetadata): LibraryItemRecord {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const before = getGlobalLibraryItem(itemId);
  const result = current.operations.mergeItemMetadataIfMissing(itemId, metadata);
  return before?.clock.revision === result.clock.revision ? result : finishItemMutation(current, result);
}

export async function duplicateGlobalLibraryItem(itemId: string): Promise<LibraryItemRecord> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'duplicate-item', [itemId], () => current.operations.duplicateItem(itemId),
  );
  return finishItemMutation(current, result);
}

export async function convertGlobalLibraryItemToNodus(itemId: string): Promise<LibraryItemRecord> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const existing = getGlobalLibraryItem(itemId);
  if (!existing) throw new Error('El documento ya no existe.');
  if (existing.source === 'nodus') return existing;
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'duplicate-item', [itemId], () => current.operations.duplicateItem(itemId),
  );
  return finishItemMutation(current, result);
}

export async function addGlobalLibraryAttachments(itemId: string, files: string[]): Promise<LibraryItemRecord> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'add-attachments', [itemId, files], () => current.operations.addAttachments(itemId, files),
  );
  return finishItemMutation(current, result);
}

export async function updateGlobalLibraryAttachment(itemId: string, attachmentId: string, patch: LibraryAttachmentPatch): Promise<LibraryItemRecord> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'update-attachment', [itemId, attachmentId, patch], () => current.operations.updateAttachment(itemId, attachmentId, patch),
  );
  return finishItemMutation(current, result);
}

export async function replaceGlobalLibraryAttachment(itemId: string, attachmentId: string, file: string): Promise<LibraryItemRecord> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'replace-attachment', [itemId, attachmentId, file], () => current.operations.replaceAttachment(itemId, attachmentId, file),
  );
  return finishItemMutation(current, result);
}

export async function removeGlobalLibraryAttachment(itemId: string, attachmentId: string): Promise<LibraryItemRecord> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'remove-attachment', [itemId, attachmentId], () => current.operations.removeAttachment(itemId, attachmentId),
  );
  return finishItemMutation(current, result);
}

export function globalLibraryAttachmentPath(itemId: string, attachmentId: string): string {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return current.operations.attachmentPath(itemId, attachmentId);
}

export function upsertGlobalLibraryNote(itemId: string, note: Partial<LibraryNoteRecord> & Pick<LibraryNoteRecord, 'title' | 'markdown'>): LibraryItemRecord {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return finishItemMutation(current, current.operations.upsertNote(itemId, note));
}

export function deleteGlobalLibraryNote(itemId: string, noteId: string): LibraryItemRecord {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return finishItemMutation(current, current.operations.deleteNote(itemId, noteId));
}

export function setGlobalLibraryItemRelation(itemId: string, targetItemId: string, relationType: LibraryItemRelationType, enabled: boolean): LibraryItemRecord {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return finishItemMutation(current, current.operations.setRelation(itemId, targetItemId, relationType, enabled));
}

export async function patchGlobalLibraryItemTags(itemIds: string[], patch: LibraryTagPatch): Promise<number> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const count = await runLibraryOperationInWorker(
    workerContext(current), 'patch-tags', [itemIds, patch], () => current.operations.patchItemTags(itemIds, patch),
  );
  broadcast(current.catalog.status(current.root, current.deviceId)); return count;
}

export function listGlobalLibraryTags(): LibraryTagRecord[] { return service()?.operations.listTagRecords() ?? []; }

export function setGlobalLibraryTagColor(tag: string, color: string | null): LibraryTagRecord[] {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.setTagColor(tag, color); broadcast(current.catalog.status(current.root, current.deviceId)); return result;
}

export function updateGlobalLibraryItemMetadata(itemId: string, patch: Partial<LibraryItemMetadata>): LibraryItemRecord {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  let result = current.operations.updateItemMetadata(itemId, patch);
  const propagated = propagateLibraryInvalidations(result, current.store, current.catalog);
  if (propagated.clock.revision !== result.clock.revision) {
    result = propagated;
    current.catalog.indexItem(result, current.store);
  }
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function resolveGlobalLibraryMetadata(kind: LibraryReferenceKind, value: string): Promise<LibraryMetadataLookupResult> {
  return resolveLibraryMetadata(kind, value);
}

export async function importGlobalLibraryIdentifier(
  kind: LibraryReferenceKind,
  value: string,
  collectionIds: string[] = [],
): Promise<LibraryIdentifierImportResult> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  await ensureCatalogReady(current);
  const lookup = await resolveLibraryMetadata(kind, value);
  const candidate = lookup.candidates[0];
  if (!candidate) throw new Error('No se encontró ninguna ficha bibliográfica.');
  const sourceUrl = candidate.metadata.url ?? candidate.sourceUrl ?? undefined;
  const existingId = current.catalog.findItemIdByMetadataIdentifiers(candidate.metadata);
  let item = existingId
    ? current.operations.bibliographyRecords({ itemIds: [existingId] })[0]
    : null;
  if (item && collectionIds.length) {
    const editableCollections = new Set(current.catalog.listCollections().filter((entry) => entry.source === 'nodus').map((entry) => entry.id));
    const add = collectionIds.filter((collectionId) => editableCollections.has(current.catalog.resolveCollectionId(collectionId) ?? collectionId));
    if (add.length) {
      current.operations.patchItemCollections([item.id], { add });
      item = current.operations.bibliographyRecords({ itemIds: [item.id] })[0] ?? item;
      broadcast(current.catalog.status(current.root, current.deviceId));
    }
  }
  if (item?.attachments.some((attachment) => {
    if (attachment.mimeType !== 'application/pdf' || ['source-missing', 'corrupt'].includes(attachment.sourceState ?? 'available')) return false;
    try { return fs.existsSync(current.operations.attachmentPath(item!.id, attachment.id)); } catch { return false; }
  })) {
    return { item, created: false, fullText: { status: 'already-present', sourceUrl: null, message: null } };
  }
  const downloaded = await downloadLibraryFullText(candidate);
  const created = !item;
  item ??= createGlobalLibraryItem({ ...candidate.metadata, ...(sourceUrl ? { url: sourceUrl } : {}) }, collectionIds);
  try {
    if (downloaded.status === 'downloaded' && downloaded.filePath) {
      try {
        const knownAttachmentIds = new Set(item.attachments.map((attachment) => attachment.id));
        item = await addGlobalLibraryAttachments(item.id, [downloaded.filePath]);
        const addedPdf = item.attachments.find((attachment) => !knownAttachmentIds.has(attachment.id) && attachment.mimeType === 'application/pdf');
        if (addedPdf && addedPdf.role !== 'original') item = await updateGlobalLibraryAttachment(item.id, addedPdf.id, { makePrimary: true });
      } catch (error) {
        return {
          item, created,
          fullText: {
            status: 'failed', sourceUrl: downloaded.sourceUrl,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    return {
      item, created,
      fullText: {
        status: downloaded.status,
        sourceUrl: downloaded.sourceUrl,
        message: downloaded.message,
      },
    };
  } finally {
    if (downloaded.temporaryDirectory) fs.rmSync(downloaded.temporaryDirectory, { recursive: true, force: true });
  }
}

export async function startGlobalLibraryMetadataBatch(
  requestId: string,
  itemIds: string[],
  onProgress: (progress: LibraryMetadataBatchProgress) => void,
  rateLimitMs = 350,
): Promise<LibraryMetadataBatchResult> {
  if (metadataBatches.has(requestId)) throw new Error('Ya existe una resolución masiva con ese identificador.');
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const controller = new AbortController(); const startedAt = new Date().toISOString();
  metadataBatches.set(requestId, { controller, result: null });
  const uniqueIds = [...new Set(itemIds)]; const entries: LibraryMetadataBatchEntry[] = [];
  const emit = (phase: LibraryMetadataBatchProgress['phase'], currentItemId: string | null, message: string) => onProgress({
    requestId, phase, completed: entries.length, total: uniqueIds.length, currentItemId,
    succeeded: entries.filter((entry) => !!entry.candidate).length, failed: entries.filter((entry) => !!entry.error).length, message,
  });
  emit('queued', null, 'Preparando la resolución de metadatos.');
  let status: LibraryMetadataBatchResult['status'] = 'ready';
  try {
    const batch = await runLibraryMetadataBatch(uniqueIds.map((itemId) => ({ itemId, item: current.operations.bibliographyRecords({ itemIds: [itemId] })[0] ?? null })), {
      signal: controller.signal, rateLimitMs,
      resolve: (kind, value, signal) => resolveLibraryMetadata(kind, value, { signal }),
      onStep: (entry, itemId) => {
        if (entry) { entries.push(entry); emit('resolving', itemId, 'Resultado parcial guardado.'); }
        else {
          const item = current.operations.bibliographyRecords({ itemIds: [itemId] })[0]; const detected = item ? libraryItemIdentifier(item) : null;
          emit('resolving', itemId, detected ? `Resolviendo ${detected.kind.toUpperCase()}…` : 'Sin identificador compatible.');
        }
      },
    });
    status = batch.status; emit(status === 'ready' ? 'ready' : 'canceled', null, status === 'ready' ? 'La vista previa está lista para confirmar.' : 'Resolución cancelada; se conservan los resultados parciales.');
  } catch (error) {
    status = controller.signal.aborted ? 'canceled' : 'failed';
    emit(status === 'canceled' ? 'canceled' : 'failed', null, status === 'canceled' ? 'Resolución cancelada; se conservan los resultados parciales.' : error instanceof Error ? error.message : String(error));
  }
  const result: LibraryMetadataBatchResult = { requestId, status, entries, startedAt, completedAt: new Date().toISOString() };
  metadataBatches.set(requestId, { controller, result }); return result;
}

export function applyGlobalLibraryMetadataBatch(requestId: string, itemIds: string[]): LibraryMetadataBatchResult {
  const session = metadataBatches.get(requestId); const current = service();
  if (!session?.result || !current) throw new Error('La vista previa ya no está disponible.');
  const selected = new Set(itemIds); const entries = session.result.entries.map((entry) => {
    if (!selected.has(entry.itemId) || !entry.candidate) return entry;
    const existing = current.operations.bibliographyRecords({ itemIds: [entry.itemId] })[0]; if (!existing) return { ...entry, error: 'El documento ya no existe.' };
    const patch = mergeLibraryMetadataCandidate(existing.metadata, entry.candidate.metadata);
    patch.extra = { ...(patch.extra ?? {}), [`resolved:${entry.kind}`]: entry.value ?? '' };
    finishItemMutation(current, current.operations.updateItemMetadata(entry.itemId, patch));
    return { ...entry, applied: true };
  });
  const result: LibraryMetadataBatchResult = { ...session.result, status: 'complete', entries, completedAt: new Date().toISOString() };
  metadataBatches.set(requestId, { ...session, result }); return result;
}

export function cancelGlobalLibraryMetadataBatch(requestId: string): boolean {
  const session = metadataBatches.get(requestId); if (!session || session.result?.status === 'complete') return false;
  session.controller.abort(); return true;
}

export function updateGlobalLibraryCitationKey(itemId: string, citationKey: string): LibraryItemRecord {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = current.operations.updateCitationKey(itemId, citationKey); broadcast(current.catalog.status(current.root, current.deviceId)); return result;
}

export function listGlobalLibraryCitationStyles(): LibraryCitationStyleRecord[] {
  return listLibraryCitationStyles();
}

export function importGlobalLibraryCitationStyleFiles(files: string[]): LibraryCitationStyleImportReport {
  return importLibraryCitationStyleFiles(files, 'file');
}

export function importGlobalLibraryZoteroCitationStyles(directories?: string[]): LibraryCitationStyleImportReport {
  return importZoteroCitationStyleDirectories(directories);
}

export async function installGlobalLibraryRepositoryCitationStyle(styleId: string): Promise<LibraryCitationStyleRecord> {
  return installRepositoryCitationStyle(styleId);
}

export async function searchGlobalLibraryRepositoryCitationStyles(query: string, limit?: number) {
  return searchRepositoryCitationStyles(query, limit);
}

export function removeGlobalLibraryCitationStyle(styleId: string): boolean {
  return removeLibraryCitationStyle(styleId);
}

export async function formatGlobalLibraryCitation(itemIds: string[], style: LibraryCitationStyle, kind: 'citation' | 'bibliography', locale = 'es-ES'): Promise<LibraryCitationResult> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const records = await runLibraryOperationInWorker<LibraryItemRecord[]>(
    workerContext(current), 'bibliography-records', [{ itemIds }], () => {
      current.operations.ensureCitationKeys();
      return current.operations.bibliographyRecords({ itemIds });
    },
  );
  return formatLibraryCitationCsl(records, style, kind, locale);
}

function officeReferenceAuthor(item: LibraryCatalogPage['items'][number]): string {
  const creators = item.creators.filter((entry) => entry.creatorType === 'author' || entry.creatorType === 'bookAuthor');
  const values = creators.map((entry) => entry.name || [entry.lastName, entry.firstName].filter(Boolean).join(', ')).filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} & ${values[1]}`;
  return `${values[0]} et al.`;
}

export async function searchGlobalLibraryOfficeReferences(query: string, limit = 40): Promise<OfficeReferenceSummary[]> {
  const page = await listGlobalLibraryItemsResponsive({
    search: query.trim() || undefined,
    limit: Math.max(1, Math.min(100, Math.trunc(limit || 40))),
    includeFacets: false,
    sort: [{ field: query.trim() ? 'title' : 'updatedAt', direction: query.trim() ? 'asc' : 'desc' }],
  });
  return page.items.map((item) => ({
    id: item.id,
    citationKey: item.citationKey,
    title: item.title,
    itemType: item.itemType,
    author: officeReferenceAuthor(item),
    year: item.year,
    publicationTitle: item.metadata.publicationTitle ?? null,
    identifiers: [...new Set([
      item.doi ? `DOI ${item.doi}` : '',
      ...item.isbn.map((value) => `ISBN ${value}`),
      ...item.issn.map((value) => `ISSN ${value}`),
      item.metadata.pmid ? `PMID ${item.metadata.pmid}` : '',
      item.metadata.arxiv ? `arXiv ${item.metadata.arxiv}` : '',
    ].filter(Boolean))],
    tags: item.tags,
    source: item.source,
    snapshot: { citationKey: item.citationKey, metadata: item.metadata },
  }));
}

function officeSnapshotRecord(itemId: string, request: OfficeCitationDocumentRequest): LibraryItemRecord | null {
  const snapshot = [...request.citations.flatMap((citation) => citation.citationItems), ...(request.uncitedItems ?? [])]
    .find((item) => item.id === itemId)?.snapshot;
  if (!snapshot) return null;
  const now = new Date().toISOString();
  return {
    format: 'nodus.library-item', formatVersion: 2, id: itemId, storageId: itemId,
    aliases: [], sourceIdentities: [], source: 'legacy', citationKey: snapshot.citationKey ?? undefined,
    metadata: snapshot.metadata, collectionIds: [], attachments: [], createdAt: now, deletedAt: null,
    clock: { deviceId: 'office-document', revision: 1, baseRevision: 0, updatedAt: now, contentHash: '' },
  };
}

export async function formatGlobalLibraryOfficeDocument(request: OfficeCitationDocumentRequest): Promise<OfficeCitationDocumentResult> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const itemIds = [...new Set([
    ...request.citations.flatMap((citation) => citation.citationItems.map((item) => item.id)),
    ...(request.uncitedItemIds ?? []),
    ...(request.uncitedItems ?? []).map((item) => item.id),
  ])];
  const records = await runLibraryOperationInWorker<LibraryItemRecord[]>(
    workerContext(current), 'bibliography-records', [{ itemIds }], () => {
      current.operations.ensureCitationKeys();
      return current.operations.bibliographyRecords({ itemIds });
    },
  );
  const existing = new Set(records.map((record) => record.id));
  for (const itemId of itemIds) {
    if (existing.has(itemId)) continue;
    const fallback = officeSnapshotRecord(itemId, request);
    if (fallback) records.push(fallback);
  }
  const unresolved = itemIds.filter((itemId) => !records.some((record) => record.id === itemId));
  if (unresolved.length) throw new Error(`No se pudieron resolver ${unresolved.length} referencia(s) del documento.`);
  return formatLibraryOfficeDocumentCsl(records, request);
}

export async function exportGlobalLibraryBibliography(request: LibraryBibliographyExportRequest, filePath: string): Promise<LibraryBibliographyExportReport> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const exported = await runLibraryOperationInWorker<{ content: string; exported: number }>(
    workerContext(current), 'export-bibliography', [request], () => {
      current.operations.ensureCitationKeys();
      return current.operations.exportBibliography(request);
    },
  );
  await fs.promises.writeFile(filePath, exported.content, 'utf8');
  return { format: request.format, exported: exported.exported, filePath, canceled: false, warnings: [] };
}

export async function listGlobalLibraryDuplicates(): Promise<LibraryDuplicateGroup[]> {
  const current = service(); if (!current) return [];
  return runLibraryOperationInWorker(workerContext(current), 'list-duplicates', [], () => current.operations.listDuplicateGroups());
}

export async function previewGlobalLibraryMerge(canonicalId: string, duplicateIds: string[]): Promise<LibraryMergeImpact> {
  const current = service(); if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return runLibraryOperationInWorker(
    workerContext(current), 'merge-impact', [canonicalId, duplicateIds], () => current.operations.mergeImpact(canonicalId, duplicateIds),
  );
}

export async function mergeGlobalLibraryItems(canonicalId: string, duplicateIds: string[]): Promise<LibraryItemRecord> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const result = await runLibraryOperationInWorker(
    workerContext(current), 'merge-items', [canonicalId, duplicateIds], () => current.operations.mergeItems(canonicalId, duplicateIds),
  );
  broadcast(current.catalog.status(current.root, current.deviceId));
  return result;
}

export function listGlobalLibraryVaults() {
  return listVaults();
}

export function listGlobalLibraryVaultLinks(itemId?: string): LibraryVaultLink[] {
  return service()?.catalog.listVaultLinks(itemId) ?? [];
}

/**
 * Forget the Global Library index entries that point at works deleted from a vault.
 * Best effort by design: a user without the Global Library configured has no catalog to
 * clean, and that must never make deleting a work fail.
 */
export function removeGlobalLibraryLinksForWorks(vaultId: string | null, workIds: readonly string[]): number {
  const current = service();
  if (!current || !vaultId || workIds.length === 0) return 0;
  return current.catalog.deleteVaultLinksForWorks(vaultId, workIds);
}

function creatorDisplayName(creator: LibraryItemRecord['metadata']['creators'][number]): string {
  return creator.name?.trim() || [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim();
}

function vaultAnalysis(itemId: string, vaultId: string, vaultName: string, vaultType: string, workId: string): LibraryVaultLink {
  const db = getDb();
  const work = getWork(workId);
  if (!work) throw new Error('No se pudo crear la referencia dentro del vault.');
  const count = (table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE nodus_id=?`).get(workId) as { n: number }).n);
  const provenance = new Map(listLibraryAnalysisProvenance(workId).map((entry) => [entry.component, entry]));
  const reuse = Object.fromEntries((['light', 'deep', 'summary', 'ideas', 'passages', 'embeddings'] as const).map((component) => {
    const entry = provenance.get(component);
    const status: LibraryAnalysisReuseStatus = entry
      ? {
        state: entry.sourceVaultId && entry.sourceVaultId !== vaultId ? 'reused' : 'current',
        reason: entry.sourceVaultId && entry.sourceVaultId !== vaultId
          ? `Exact ${component} provenance reused from ${entry.sourceVaultId}.`
          : `Current ${component} output has complete provenance.`,
        sourceVaultId: entry.sourceVaultId,
        sourceWorkId: entry.sourceWorkId,
        reusedAt: entry.sourceVaultId && entry.sourceVaultId !== vaultId ? entry.updatedAt : null,
      }
      : { state: 'pending', reason: `No reusable ${component} output with complete provenance.`, sourceVaultId: null, sourceWorkId: null, reusedAt: null };
    return [component, status];
  })) as Record<LibraryAnalysisReuseComponent, LibraryAnalysisReuseStatus>;
  return {
    itemId, vaultId, vaultName, vaultType, workId,
    analysis: {
      lightStatus: work.light_status,
      deepStatus: work.deep_status,
      summaryStatus: work.summary_status,
      ideaCount: count('idea_occurrences'),
      passageCount: count('passages'),
      evidenceCount: count('evidence'),
      gapCount: count('gaps'),
      hasSummary: count('work_summaries') > 0,
      hasNotes: Boolean(work.notes?.trim()),
      archived: work.archived === 1,
      reuse,
    },
  };
}


/** Materialize references in a vault without duplicating the immutable global
 * files. Analysis resolves the clean Markdown through the stable zotero_key. */
export async function linkGlobalLibraryItemsToVault(itemIds: string[], vaultId: string): Promise<LibraryVaultLinkReport> {
  const current = service();
  if (!current) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  const vault = getVault(vaultId);
  if (!vault) throw new Error('El vault seleccionado ya no existe.');
  if (vault.origin === 'connected' && (vault.remote?.role === 'reader' || vault.remote?.state !== 'active')) {
    throw new Error('Este vault conectado es de solo lectura o no está activo.');
  }
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  const canonicalIds = [...new Set(uniqueIds.map((id) => current.catalog.resolveItemId(id) ?? id))];
  const records = canonicalIds.flatMap((itemId) => {
    const storageId = current.catalog.itemStorageId(itemId);
    const item = storageId ? current.store.readMaterializedItem(storageId) : null;
    return item && !item.deletedAt ? [item] : [];
  });
  if (records.length !== canonicalIds.length) throw new Error('Alguno de los documentos seleccionados ya no existe.');
  const prior = new Set(current.catalog.listVaultLinks().filter((link) => link.vaultId === vaultId).map((link) => link.itemId));
  const links = await withVaultDatabase(vaultId, async () => {
    const nextLinks: LibraryVaultLink[] = [];
    for (const record of records) {
    const zoteroIdentity = record.sourceIdentities.find((identity) => identity.source === 'zotero');
    const zoteroKey = zoteroIdentity
      ? zoteroIdentity.libraryType === 'group'
        ? `groups:${zoteroIdentity.libraryId}:${zoteroIdentity.itemKey}`
        : zoteroIdentity.itemKey
      : `nodus-library:${encodeURIComponent(record.id)}`;
    const existing = getWorkByZoteroKey(zoteroKey);
    const authors = record.metadata.creators.map(creatorDisplayName).filter(Boolean);
    const creators = record.metadata.creators.flatMap((creator) => {
      const role = creator.creatorType === 'editor' ? 'editor' as const : creator.creatorType === 'author' ? 'author' as const : null;
      if (!role) return [];
      return [{
        lastName: creator.lastName?.trim() || '',
        firstName: creator.firstName?.trim() || '',
        name: creator.name?.trim() || null,
        role,
      }];
    });
    upsertWork({
      nodus_id: existing?.nodus_id ?? record.vaultWorkIds?.[vaultId] ?? record.id,
      zotero_key: zoteroKey,
      zotero_version: null,
      title: record.metadata.title,
      authors,
      creators,
      year: record.metadata.year ?? null,
      item_type: record.metadata.itemType,
      doi: record.metadata.doi?.trim() || null,
      read_tag: false,
      zoteroTags: record.metadata.tags ?? [],
    });
    const linked = getWorkByZoteroKey(zoteroKey);
    if (!linked) throw new Error('No se pudo vincular el documento al vault.');
    getDb().prepare("UPDATE works SET source_type='markdown' WHERE nodus_id=?").run(linked.nodus_id);
    const revisionFingerprints = Object.fromEntries((['light', 'deep', 'summary', 'ideas', 'passages', 'embeddings'] as const)
      .map((component) => [component, libraryRevisionFingerprint(record, component)])) as Record<LibraryAnalysisReuseComponent, string | null>;
    if (!isManualAcademic()) await reuseVaultAnalysisForWorks([linked.nodus_id], {
      targetVaultId: vault.id,
      context: { libraryItemId: record.id, revisionFingerprints },
    });
      nextLinks.push(vaultAnalysis(record.id, vault.id, vault.name, String(vault.type), linked.nodus_id));
    }
    return nextLinks;
  });
  // Linking materializes works in a vault; an enabled continuous campaign should
  // see those works immediately, while disabled vaults remain completely inert.
  await documentIndexQueue.refreshVault(vault.id).catch((error) => {
    console.error('[document-index] post-library-link refresh failed', error);
  });
  current.catalog.upsertVaultLinks(links);
  broadcast(current.catalog.status(current.root, current.deviceId));
  return {
    requested: canonicalIds.length,
    linked: links.filter((link) => !prior.has(link.itemId)).length,
    existing: links.filter((link) => prior.has(link.itemId)).length,
    vaultId,
    links,
    reusedComponents: links.reduce((sum, link) => sum + Object.values(link.analysis.reuse ?? {}).filter((entry) => entry.state === 'reused').length, 0),
    pendingComponents: links.reduce((sum, link) => sum + Object.values(link.analysis.reuse ?? {}).filter((entry) => ['pending', 'incompatible', 'unavailable'].includes(entry.state)).length, 0),
    canceled: false,
  };
}

export function closeGlobalLibrary(): void {
  for (const active of zoteroImports.values()) active.controller.abort();
  zoteroImports.clear();
  live?.extraction.dispose();
  disposeLibraryOperationWorkers();
  live?.catalog.close();
  live = null;
}

registerGlobalLibraryCloser(closeGlobalLibrary);
