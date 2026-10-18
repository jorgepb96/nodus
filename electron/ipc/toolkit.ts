import { registerSignIpc } from './sign';
import { getBackupCatalog, getBackupCatalogRecords, previewOpenBackup, runOpenBackup, cancelOpenBackup, saveBackupPreset, deleteBackupPreset } from '../export/openBackupService';
import type { BackupCatalogQuery, BackupPreset, OpenBackupOptions } from '@shared/backups';
// toolkit channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import type { IpcContext } from './context';
import { assertNotBrowserIpcSender } from './trust';
import { runToolkitJob, ToolkitSignal } from '../toolkit/toolkitJobs';
import { TOOLKIT_REGISTRY } from '../toolkit/convert';
import { initAiOcr, resumeAiOcr, createOcrDocs, listOcrDocs, searchOcrDocs, getOcrDoc, deleteOcrDoc, cancelOcrDoc, reprocessOcrPage, reprocessOcrDocument, ocrPageImageDataUrl, ocrPageText, updateOcrPage, ocrTranscript, buildOcrExport, buildOcrExportZip, saveOcrToVault, AiOcrCreateInput } from '../toolkit/aiOcr';
import type { AiOcrExportFormat, OcrOptions } from '@shared/aiOcrTypes';
import type { ToolkitJobRequest } from '@shared/toolkitTypes';
import type { TranslateJobRequest } from '@shared/toolkitTranslateTypes';
import { runTranslateJob, suggestedTextFilename, TranslateSignal } from '../toolkit/translate';
import { listTranslateHistory, removeTranslateHistory } from '../toolkit/translate/history';
import * as presenterLibrary from '../toolkit/presenter/library';
import { extractPptxNotes } from '../toolkit/presenter/pptxNotes';
import { canExtractOpenXmlNotes, convertPresentationToPdf, PRESENTER_IMPORT_EXTENSIONS, PresentationConversionError, presenterImportFormat } from '../toolkit/presenter/conversion';
import * as presenterWindows from '../toolkit/presenter/windows';
import { generateToolkitApp } from '../ai/toolkitApps';
import * as toolkitAppSession from '../toolkit/apps/server';
import { buildToolkitAppPackage, toolkitAppPackageFileName } from '../toolkit/apps/export';
import { isToolkitAppManifest } from '@shared/toolkitApps';
import type { ToolkitAppGenerationProgress, ToolkitAppGenerationRequest, ToolkitAppJsonValue, ToolkitAppManifest } from '@shared/toolkitApps';
import { getSystemVolume, setSystemVolume, openCastPicker } from '../toolkit/presenter/systemAudio';
import { normalizeLibrary, PresenterLibrary, type PresenterFolderDeleteMode } from '@shared/presenterTypes';
import { parsePresenterNotesTxt, serializePresenterNotesTxt } from '@shared/presenterNotesTxt';
import type { PresenterAction } from '@shared/presenterState';
import type { ProtectArtifact, ProtectListSourcesRequest, ProtectSourceRef } from '@shared/protectTypes';
import { PROTECT_INPUT_EXTENSIONS } from '@shared/protectTypes';
import { toolkitDialogText, ToolkitDialogKey } from '../toolkit/dialogI18n';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ipcMain, shell, BrowserWindow, dialog, app } from 'electron';
import { showImportOpenDialog } from '../privacy';
import type { ModelRef } from '@shared/types';
import { getSettings } from '../db/settingsRepo';
import * as protect from '../protect/protectService';

/**
 * A file-name stem the native save dialog will accept on every platform: the
 * characters Windows forbids and every control character become "_", and an empty
 * result falls back to "presentation" rather than offering a nameless file.
 */
function presenterFileStem(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  return (
    Array.from(raw.replace(/[<>:"/\\|?*]/g, '_'))
      .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .trim() || 'presentation'
  );
}

export function registerToolkitIpc({ h, getWindow }: IpcContext): void {
  registerSignIpc({ h, getWindow });
  h('backups:catalog', async (e, ids: string[]) => { assertNotBrowserIpcSender(e); return getBackupCatalog(ids); });
  h('backups:records', async (e, query: BackupCatalogQuery) => { assertNotBrowserIpcSender(e); return getBackupCatalogRecords(query); });
  h('backups:preview', async (e, options: OpenBackupOptions) => { assertNotBrowserIpcSender(e); return previewOpenBackup(options); });
  h('backups:run', async (e, id: string, options: OpenBackupOptions, output: string) => {
    assertNotBrowserIpcSender(e); return runOpenBackup(id, options, output, p => { if (!e.sender.isDestroyed()) e.sender.send('backups:progress', id, p); });
  });
  h('backups:cancel', async (e, id: string) => { assertNotBrowserIpcSender(e); cancelOpenBackup(id); });
  h('backups:presets:save', async (e, preset: BackupPreset) => { assertNotBrowserIpcSender(e); return saveBackupPreset(preset); });
  h('backups:presets:delete', async (e, id: string) => { assertNotBrowserIpcSender(e); return deleteBackupPreset(id); });

  // ── Nodus Toolkit (Convert) ─────────────────────────────────────────────────
  // Native-dialog copy for every toolkit tool, in the current UI language.
  const toolkitCopy = (key: ToolkitDialogKey): string => toolkitDialogText(key, getSettings().uiLanguage);
  // The job runs in main and streams a progress snapshot back per state change;
  // the renderer's background-jobs store keeps it alive across navigation. Each
  // in-flight job holds a cancellation flag keyed by its jobId.
  const toolkitSignals = new Map<string, ToolkitSignal>();
  h('toolkit:job:run', async (e, jobId: string, request: ToolkitJobRequest) => {
    const signal: ToolkitSignal = { cancelled: false };
    toolkitSignals.set(jobId, signal);
    try {
      const result = await runToolkitJob(jobId, request, TOOLKIT_REGISTRY, {
        signal,
        onProgress: (progress) => e.sender.send('toolkit:job:event', jobId, progress),
      });
      if (request.openFolderOnDone && !result.cancelled) {
        const firstOutput = result.zipPath ?? result.files.flatMap((f) => f.outputPaths)[0];
        if (firstOutput) shell.showItemInFolder(firstOutput);
      }
      return result;
    } finally {
      toolkitSignals.delete(jobId);
    }
  });
  h('toolkit:job:cancel', async (_e, jobId: string) => {
    const signal = toolkitSignals.get(jobId);
    if (signal) signal.cancelled = true;
  });
  h('toolkit:pickFiles', async (e, extensions: string[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    // "Todos los archivos" stays reachable even when a compatible-extension list is
    // given: the checksum operation accepts any file at all, so a hard filter would
    // make it unusable from the picker (drag-and-drop would be the only way in).
    const allFiles = { name: toolkitCopy('allFiles'), extensions: ['*'] };
    const filters = extensions.length
      ? [{ name: toolkitCopy('compatibleFiles'), extensions }, allFiles]
      : [allFiles];
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('addFiles'),
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  h('toolkit:pickOutputDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('outputFolder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0];
  });
  h('toolkit:showInFolder', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // ── Nodus Translate ─────────────────────────────────────────────────────────
  const translateSignals = new Map<string, TranslateSignal>();
  h('translate:job:run', async (e, jobId: string, request: TranslateJobRequest) => {
    const signal: TranslateSignal = { cancelled: false };
    translateSignals.set(jobId, signal);
    try {
      const result = await runTranslateJob(jobId, request, {
        signal,
        onProgress: (progress) => e.sender.send('translate:job:event', jobId, progress),
      });
      if (request.openFolderOnDone && !result.cancelled && result.outputs[0]?.outputPath) {
        shell.showItemInFolder(result.outputs[0].outputPath);
      }
      return result;
    } finally {
      translateSignals.delete(jobId);
    }
  });
  h('translate:job:cancel', async (_e, jobId: string) => {
    const signal = translateSignals.get(jobId);
    if (signal) signal.cancelled = true;
  });
  h('translate:text:save', async (e, text: string, targetLanguage: string, extension: 'txt' | 'md' | 'html' = 'txt') => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('saveTranslation'),
      defaultPath: suggestedTextFilename(targetLanguage, extension),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    fs.writeFileSync(picked.filePath, text, 'utf8');
    return { canceled: false, path: picked.filePath };
  });
  h('translate:history:list', async () => listTranslateHistory());
  h('translate:history:remove', async (_e, id: string, deleteOutput = false) => {
    const entry = listTranslateHistory().find((candidate) => candidate.id === id);
    if (deleteOutput && entry?.outputPath && fs.existsSync(entry.outputPath)) {
      await shell.trashItem(entry.outputPath);
    }
    return removeTranslateHistory(id);
  });

  // ── Nodus AI OCR (OCR Workspace) ────────────────────────────────────────────
  // A persistent, per-document OCR library under userData. Processing runs in main and
  // survives navigation; progress is pushed on 'aiOcr:event' (docId + snapshot). The
  // store and manager are Electron-free; this layer binds them to the window + settings
  // via initAiOcr, then resumes anything left unfinished by a previous session.
  initAiOcr(getWindow);
  void resumeAiOcr().catch((error) => console.error('[aiOcr] resume failed safely:', error));
  h('aiOcr:create', async (_e, input: AiOcrCreateInput) => createOcrDocs(input));
  h('aiOcr:list', async () => listOcrDocs());
  h('aiOcr:search', async (_e, query: string) => searchOcrDocs(query));
  h('aiOcr:get', async (_e, id: string) => getOcrDoc(id));
  h('aiOcr:delete', async (_e, id: string) => deleteOcrDoc(id));
  h('aiOcr:cancel', async (_e, id: string) => cancelOcrDoc(id));
  h('aiOcr:reprocessPage', async (_e, id: string, index: number, patch?: { model?: ModelRef | null }) => reprocessOcrPage(id, index, patch));
  h('aiOcr:reprocessDocument', async (_e, id: string, patch?: { model?: ModelRef | null; options?: Partial<OcrOptions> }) => reprocessOcrDocument(id, patch));
  h('aiOcr:pageImage', async (_e, id: string, index: number) => ocrPageImageDataUrl(id, index));
  h('aiOcr:saveToVault', async (_e, id: string) => saveOcrToVault(id));
  h('aiOcr:pageText', async (_e, id: string, index: number) => ocrPageText(id, index));
  h('aiOcr:updatePage', async (_e, id: string, index: number, text: string | null) => updateOcrPage(id, index, text));
  h('aiOcr:transcript', async (_e, id: string) => ocrTranscript(id));
  h('aiOcr:export', async (e, id: string, format: AiOcrExportFormat) => {
    const { filename, data } = await buildOcrExport(id, format, getSettings().uiLanguage);
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, { title: toolkitCopy('exportTranscript'), defaultPath: filename });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    fs.writeFileSync(picked.filePath, data);
    return { canceled: false, path: picked.filePath };
  });
  h('aiOcr:exportZip', async (e, ids: string[], format: AiOcrExportFormat) => {
    const { filename, data } = await buildOcrExportZip(ids, format, getSettings().uiLanguage);
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, { title: toolkitCopy('exportTranscripts'), defaultPath: filename });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    fs.writeFileSync(picked.filePath, data);
    return { canceled: false, path: picked.filePath };
  });
  h('aiOcr:pickFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('addOcrFiles'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: toolkitCopy('pdfAndImages'), extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] },
        { name: toolkitCopy('allFiles'), extensions: ['*'] },
      ],
    });
    return picked.canceled ? [] : picked.filePaths;
  });

  // ── PDF Presenter (Toolkit) ─────────────────────────────────────────────────
  // A global library of imported PDFs (copies) + folders, independent of the
  // active vault, under userData/toolkit/presenter. The pure model + reducers
  // live in @shared/presenterTypes; the filesystem side in toolkit/presenter.
  const presenterDir = () => path.join(app.getPath('userData'), 'toolkit', 'presenter');
  const pendingPresenterImports = new Map<string, { path: string; pickedAt: number }>();
  h('presenter:library:get', async () => presenterLibrary.readLibrary(presenterDir()));
  h('presenter:library:save', async (_e, lib: PresenterLibrary) => {
    presenterLibrary.writeLibrary(presenterDir(), normalizeLibrary(lib));
  });
  h('presenter:import:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('importPresentation'),
      properties: ['openFile'],
      filters: [
        { name: toolkitCopy('pdfAndPresentations'), extensions: [...PRESENTER_IMPORT_EXTENSIONS] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: toolkitCopy('presentations'), extensions: PRESENTER_IMPORT_EXTENSIONS.filter((ext) => ext !== 'pdf') },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const selectedPath = picked.filePaths[0];
    const format = presenterImportFormat(selectedPath);
    if (!format) return null;
    const now = Date.now();
    for (const [token, pending] of pendingPresenterImports) {
      if (now - pending.pickedAt > 10 * 60_000) pendingPresenterImports.delete(token);
    }
    const token = crypto.randomUUID();
    pendingPresenterImports.set(token, { path: selectedPath, pickedAt: now });
    return {
      token,
      fileName: path.basename(selectedPath),
      format,
      needsConversion: format !== 'pdf',
    };
  });
  h('presenter:import:file', async (_e, token: string) => {
    const pending = typeof token === 'string' ? pendingPresenterImports.get(token) : undefined;
    if (pending) pendingPresenterImports.delete(token); // one use, success or failure
    const selectedPath = pending?.path;
    if (!selectedPath || Date.now() - pending.pickedAt > 10 * 60_000 || !fs.existsSync(selectedPath)) {
      return { ok: false, code: 'invalid-file' } as const;
    }
    const format = presenterImportFormat(selectedPath);
    if (!format) return { ok: false, code: 'unsupported-format' } as const;
    if (format === 'pdf') {
      try {
        const presentation = presenterLibrary.importPdf(presenterDir(), selectedPath);
        return { ok: true, presentation, converted: false, importedNotes: 0 } as const;
      } catch (error) {
        console.error('[presenter] PDF import failed:', error);
        return { ok: false, code: 'invalid-file' } as const;
      }
    }

    try {
      const converted = await convertPresentationToPdf(selectedPath);
      try {
        let notes: Record<string, string> = {};
        if (canExtractOpenXmlNotes(format)) {
          try {
            notes = extractPptxNotes(fs.readFileSync(selectedPath)).notes;
          } catch (error) {
            // Notes are an enhancement; a valid visual conversion must still import.
            console.warn('[presenter] Could not extract PowerPoint notes:', error);
          }
        }
        const presentation = presenterLibrary.importPdf(presenterDir(), converted.pdfPath, new Date(), {
          originalFileName: path.basename(selectedPath),
          notes,
        });
        return {
          ok: true,
          presentation,
          converted: true,
          converter: converted.converter,
          importedNotes: Object.keys(notes).length,
        } as const;
      } finally {
        converted.cleanup();
      }
    } catch (error) {
      console.error('[presenter] Presentation conversion failed:', error);
      const code = error instanceof PresentationConversionError ? error.code : 'conversion-failed';
      return { ok: false, code } as const;
    }
  });
  h('presenter:pdf:getData', async (_e, id: string) => {
    const bytes = presenterLibrary.readPdfBytes(presenterDir(), id);
    return bytes ? new Uint8Array(bytes) : null;
  });
  h('presenter:delete', async (_e, id: string) => {
    presenterLibrary.deletePresentation(presenterDir(), id);
  });
  h('presenter:folder:delete', async (_e, id: string, mode: PresenterFolderDeleteMode) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid folder id');
    return presenterLibrary.deleteFolder(presenterDir(), id, mode);
  });
  h('presenter:import:pptxNotes', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('importPowerPointNotes'),
      properties: ['openFile'],
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return extractPptxNotes(fs.readFileSync(picked.filePaths[0]));
  });
  h('presenter:export:txtNotes', async (e, rawPresentation: unknown) => {
    const presentation = normalizeLibrary({ presentations: [rawPresentation], tags: [] }).presentations[0];
    if (!presentation?.totalPages) throw new Error('Presentation has no slides');
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('exportPresenterNotes'),
      defaultPath: `${presenterFileStem(presentation.name)} - notas.txt`,
      filters: [{ name: toolkitCopy('text'), extensions: ['txt'] }],
    });
    if (picked.canceled || !picked.filePath) return false;
    fs.writeFileSync(
      picked.filePath,
      serializePresenterNotesTxt(presentation.notes, presentation.totalPages),
      'utf-8',
    );
    return true;
  });
  h('presenter:export:pdf', async (e, id: string, name: string) => {
    // Hand the user their own copy of the deck: the library keeps the PDF it
    // imported (or converted), and this writes it out wherever they choose. The
    // library copy is read, never moved, so the shelf is unaffected.
    const bytes = presenterLibrary.readPdfBytes(presenterDir(), String(id ?? ''));
    // The three outcomes are distinguished so the renderer can stay silent on a
    // cancel and still report a deck whose copy has gone missing.
    if (!bytes) return 'missing' as const;
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('downloadPresentation'),
      defaultPath: `${presenterFileStem(name)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (picked.canceled || !picked.filePath) return 'cancelled' as const;
    fs.writeFileSync(picked.filePath, bytes);
    return 'saved' as const;
  });
  h('presenter:import:txtNotes', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('importTxtNotes'),
      properties: ['openFile'],
      filters: [{ name: toolkitCopy('text'), extensions: ['txt'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return parsePresenterNotesTxt(fs.readFileSync(picked.filePaths[0], 'utf-8'));
  });
  // Nodus Apps — sandboxed bundle generation and ephemeral LAN runtime.
  h('toolkitApps:generate', async (e, requestId: string, request: ToolkitAppGenerationRequest) => generateToolkitApp(request, (progress: ToolkitAppGenerationProgress) => {
    if (!e.sender.isDestroyed()) e.sender.send('toolkitApps:generate:progress', requestId, progress);
  }));
  h('toolkitApps:package:download', async (e, manifest: ToolkitAppManifest) => {
    if (!isToolkitAppManifest(manifest)) throw new Error('La app no es válida y no se puede descargar.');
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('downloadAppPackage'),
      defaultPath: toolkitAppPackageFileName(manifest, getSettings().uiLanguage),
      filters: [{ name: toolkitCopy('zipPackage'), extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, buildToolkitAppPackage(manifest, getSettings().uiLanguage));
    return picked.filePath;
  });
  h('toolkitApps:session:start', async (e, manifest: ToolkitAppManifest) => {
    const sender = e.sender;
    return toolkitAppSession.startToolkitAppSession(manifest, (next) => {
      if (!sender.isDestroyed()) sender.send('toolkitApps:session:event', { type: 'snapshot', snapshot: next });
    });
  });
  h('toolkitApps:session:stop', async (e) => {
    toolkitAppSession.stopToolkitAppSession();
    if (!e.sender.isDestroyed()) e.sender.send('toolkitApps:session:event', { type: 'stopped' });
  });
  h('toolkitApps:session:info', async () => toolkitAppSession.getToolkitAppSessionInfo());
  h('toolkitApps:session:snapshot', async () => toolkitAppSession.getToolkitAppSessionSnapshot());
  h('toolkitApps:session:send', async (_e, channel: string, payload: ToolkitAppJsonValue) => {
    toolkitAppSession.sendToolkitAppSessionMessage(channel, payload);
  });

  // Presentation windows (audience + presenter). The control channel is fire-and-
  // forget (ipcMain.on) because navigation/zoom fire rapidly and don't need a reply.
  h('presenter:start', async (_e, pdfId: string, startSlide?: number) => {
    presenterWindows.startPresentation(pdfId, startSlide ?? 1, false);
  });
  h('presenter:startPresenterMode', async (_e, pdfId: string, startSlide?: number) => {
    presenterWindows.startPresentation(pdfId, startSlide ?? 1, true);
  });
  h('presenter:stop', async () => {
    presenterWindows.stopPresentation();
  });
  h('presenter:state:get', async () => presenterWindows.getPresenterRuntimeState());
  h('presenter:server:info', async () => presenterWindows.getServerInfoWithQr());
  h('presenter:volume:get', async () => getSystemVolume());
  h('presenter:volume:set', async (_e, volume: number) => {
    await setSystemVolume(volume);
  });
  h('presenter:cast', async () => openCastPicker());
  ipcMain.on('presenter:control', (e, action: PresenterAction) => {
    assertNotBrowserIpcSender(e);
    presenterWindows.handlePresenterControl(e.sender, action);
  });

  // ── Nodus Protect ──────────────────────────────────────────────────────────
  h('protect:pickFiles', async (e, multiple = true) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: toolkitCopy('selectProtectDocuments'),
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: toolkitCopy('compatiblePdfAndImages'), extensions: [...PROTECT_INPUT_EXTENSIONS] }],
    });
    return picked.canceled ? [] : protect.registerProtectDiskSources(picked.filePaths);
  });
  h('protect:registerDroppedFiles', async (_e, filePaths: string[]) => {
    if (!Array.isArray(filePaths) || filePaths.length > 500) throw new Error('Selección de archivos no válida.');
    return protect.registerProtectDiskSources(filePaths);
  });
  h('protect:listVaultSources', async (_e, request?: ProtectListSourcesRequest) =>
    protect.listProtectVaultSources(request));
  h('protect:readSource', async (_e, ref: ProtectSourceRef) => protect.readProtectSource(ref));
  h('protect:saveDisk', async (e, artifact: ProtectArtifact) => {
    artifact = protect.validateProtectArtifact(artifact);
    const win = BrowserWindow.fromWebContents(e.sender);
    const ext = artifact.format;
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('saveProtectedCopy'),
      defaultPath: path.basename(artifact.fileName),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (picked.canceled || !picked.filePath) return { saved: false, canceled: true, path: null };
    protect.writeArtifactAtomically(picked.filePath, artifact.bytes);
    return { saved: true, canceled: false, path: picked.filePath };
  });
  h('protect:share', async (e, artifact: ProtectArtifact) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await protect.shareProtectArtifact(artifact, win);
    if (!result.fallbackRequired) return result;
    const ext = artifact.format;
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('saveForSharing'), defaultPath: path.basename(artifact.fileName),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (picked.canceled || !picked.filePath) return { shared: false, canceled: true, fallbackRequired: true, message: result.message };
    protect.writeArtifactAtomically(picked.filePath, artifact.bytes);
    return { shared: true, canceled: false, fallbackRequired: true, message: result.message };
  });
  h('protect:copies:list', async (_e, query?: string) => {
    if (query != null && (typeof query !== 'string' || query.length > 300)) throw new Error('Consulta no válida.');
    return protect.listProtectCopies(query);
  });
  h('protect:copies:save', async (_e, artifact: ProtectArtifact) => protect.saveProtectCopy(artifact));
  h('protect:copies:download', async (e, copyId: string) => {
    const artifact = protect.getProtectCopyArtifact(copyId);
    const win = BrowserWindow.fromWebContents(e.sender);
    const ext = artifact.format;
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: toolkitCopy('downloadProtectedCopy'), defaultPath: artifact.fileName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (picked.canceled || !picked.filePath) return { canceled: true, path: null };
    protect.writeArtifactAtomically(picked.filePath, artifact.bytes);
    return { canceled: false, path: picked.filePath };
  });
  h('protect:copies:delete', async (_e, copyId: string) => protect.deleteProtectCopy(copyId));
}
