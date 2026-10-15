// toolkit half of the renderer bridge, paired with electron/ipc/toolkit.ts.
// Typed as ToolkitApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';
import type { PresenterAction as PresenterControlAction } from '@shared/presenterState';
import { webUtils } from 'electron';
import type { ToolkitApi } from '@shared/api/toolkit';

export const toolkitApi: ToolkitApi = {
  getBackupCatalog: ids => ipcRenderer.invoke('backups:catalog', ids),
  getBackupCatalogRecords: query => ipcRenderer.invoke('backups:records', query),
  previewOpenBackup: options => ipcRenderer.invoke('backups:preview', options),
  runOpenBackup: async (jobId, options, outputDir, onProgress) => {
    const listener = (_e: unknown, id: string, progress: Parameters<typeof onProgress>[0]) => { if (id === jobId) onProgress(progress); };
    ipcRenderer.on('backups:progress', listener);
    try { return await ipcRenderer.invoke('backups:run', jobId, options, outputDir); }
    finally { ipcRenderer.removeListener('backups:progress', listener); }
  },
  cancelOpenBackup: id => ipcRenderer.invoke('backups:cancel', id),
  saveBackupPreset: preset => ipcRenderer.invoke('backups:presets:save', preset),
  deleteBackupPreset: id => ipcRenderer.invoke('backups:presets:delete', id),
  // Nodus Toolkit (Convert). Progress is pushed on 'toolkit:job:event' filtered
  // by a per-run jobId, mirroring the Nodi chat-stream pattern.
  runToolkitJob: async (request, handlers) => {
    const jobId = `toolkit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onEvent = (_e: unknown, id: string, progress: Parameters<typeof handlers.onProgress>[0]) => {
      if (id === jobId) handlers.onProgress(progress);
    };
    ipcRenderer.on('toolkit:job:event', onEvent);
    try {
      return await ipcRenderer.invoke('toolkit:job:run', jobId, request);
    } finally {
      ipcRenderer.removeListener('toolkit:job:event', onEvent);
    }
  },
  cancelToolkitJob: (jobId) => ipcRenderer.invoke('toolkit:job:cancel', jobId).then(() => undefined),
  pickToolkitFiles: (extensions) => ipcRenderer.invoke('toolkit:pickFiles', extensions),
  pickToolkitOutputDir: () => ipcRenderer.invoke('toolkit:pickOutputDir'),
  revealToolkitOutput: (filePath) => ipcRenderer.invoke('toolkit:showInFolder', filePath).then(() => undefined),

  // Nodus Translate. A per-run id keeps simultaneous/late events isolated in the
  // renderer and gives cancellation an unambiguous main-process target.
  runTranslateJob: async (request, handlers) => {
    const jobId = `translate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onEvent = (_e: unknown, id: string, progress: Parameters<typeof handlers.onProgress>[0]) => {
      if (id === jobId) handlers.onProgress(progress);
    };
    ipcRenderer.on('translate:job:event', onEvent);
    try {
      return await ipcRenderer.invoke('translate:job:run', jobId, request);
    } finally {
      ipcRenderer.removeListener('translate:job:event', onEvent);
    }
  },
  cancelTranslateJob: (jobId) => ipcRenderer.invoke('translate:job:cancel', jobId).then(() => undefined),
  saveTranslatedText: (text, targetLanguage, extension) => ipcRenderer.invoke('translate:text:save', text, targetLanguage, extension),
  listTranslateHistory: () => ipcRenderer.invoke('translate:history:list'),
  removeTranslateHistory: (id, deleteOutput) => ipcRenderer.invoke('translate:history:remove', id, deleteOutput),

  // Nodus AI OCR (OCR Workspace). Progress is pushed on 'aiOcr:event' (docId + snapshot).
  createOcrDocs: (input) => ipcRenderer.invoke('aiOcr:create', input),
  listOcrDocs: () => ipcRenderer.invoke('aiOcr:list'),
  searchOcrDocs: (query) => ipcRenderer.invoke('aiOcr:search', query),
  getOcrDoc: (id) => ipcRenderer.invoke('aiOcr:get', id),
  deleteOcrDoc: (id) => ipcRenderer.invoke('aiOcr:delete', id).then(() => undefined),
  cancelOcrDoc: (id) => ipcRenderer.invoke('aiOcr:cancel', id).then(() => undefined),
  reprocessOcrPage: (id, index, patch) => ipcRenderer.invoke('aiOcr:reprocessPage', id, index, patch).then(() => undefined),
  reprocessOcrDocument: (id, patch) => ipcRenderer.invoke('aiOcr:reprocessDocument', id, patch).then(() => undefined),
  getOcrPageImage: (id, index) => ipcRenderer.invoke('aiOcr:pageImage', id, index),
  getOcrPageText: (id, index) => ipcRenderer.invoke('aiOcr:pageText', id, index),
  saveOcrPageEdit: (id, index, text) => ipcRenderer.invoke('aiOcr:updatePage', id, index, text).then(() => undefined),
  getOcrTranscript: (id) => ipcRenderer.invoke('aiOcr:transcript', id),
  exportOcrDoc: (id, format) => ipcRenderer.invoke('aiOcr:export', id, format),
  exportOcrDocsZip: (ids, format) => ipcRenderer.invoke('aiOcr:exportZip', ids, format),
  saveOcrToVault: (id) => ipcRenderer.invoke('aiOcr:saveToVault', id),
  pickOcrFiles: () => ipcRenderer.invoke('aiOcr:pickFiles'),
  onOcrEvent: (cb) => {
    const listener = (_e: unknown, docId: string, progress: Parameters<typeof cb>[1]) => cb(docId, progress);
    ipcRenderer.on('aiOcr:event', listener);
    return () => ipcRenderer.removeListener('aiOcr:event', listener);
  },
  pickProtectFiles: (multiple) => ipcRenderer.invoke('protect:pickFiles', multiple),
  registerProtectDroppedFiles: (files) => ipcRenderer.invoke(
    'protect:registerDroppedFiles',
    files.map((file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])),
  ),
  listProtectVaultSources: (request) => ipcRenderer.invoke('protect:listVaultSources', request),
  readProtectSource: (ref) => ipcRenderer.invoke('protect:readSource', ref),
  saveProtectArtifactToDisk: (artifact) => ipcRenderer.invoke('protect:saveDisk', artifact),
  shareProtectArtifact: (artifact) => ipcRenderer.invoke('protect:share', artifact),
  listProtectCopies: (query) => ipcRenderer.invoke('protect:copies:list', query),
  saveProtectArtifactToVault: (artifact) => ipcRenderer.invoke('protect:copies:save', artifact),
  downloadProtectCopy: (copyId) => ipcRenderer.invoke('protect:copies:download', copyId),
  deleteProtectCopy: (copyId) => ipcRenderer.invoke('protect:copies:delete', copyId).then(() => undefined),

  // Nodus Apps — sandboxed mini-app generation + temporary LAN sessions.
  generateToolkitApp: async (request, onProgress) => {
    const requestId = `toolkit-app-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_e: unknown, id: string, progress: Parameters<NonNullable<typeof onProgress>>[0]) => {
      if (id === requestId) onProgress?.(progress);
    };
    ipcRenderer.on('toolkitApps:generate:progress', listener);
    try {
      return await ipcRenderer.invoke('toolkitApps:generate', requestId, request);
    } finally {
      ipcRenderer.removeListener('toolkitApps:generate:progress', listener);
    }
  },
  downloadToolkitAppPackage: (manifest) => ipcRenderer.invoke('toolkitApps:package:download', manifest),
  startToolkitAppSession: (manifest) => ipcRenderer.invoke('toolkitApps:session:start', manifest),
  stopToolkitAppSession: () => ipcRenderer.invoke('toolkitApps:session:stop').then(() => undefined),
  getToolkitAppSessionInfo: () => ipcRenderer.invoke('toolkitApps:session:info'),
  getToolkitAppSessionSnapshot: () => ipcRenderer.invoke('toolkitApps:session:snapshot'),
  sendToolkitAppSessionMessage: (channel, payload) => ipcRenderer.invoke('toolkitApps:session:send', channel, payload).then(() => undefined),
  onToolkitAppSessionEvent: (cb) => {
    const listener = (_e: unknown, event: Parameters<typeof cb>[0]) => cb(event);
    ipcRenderer.on('toolkitApps:session:event', listener);
    return () => ipcRenderer.removeListener('toolkitApps:session:event', listener);
  },

  // PDF Presenter — global library of imported PDFs (Toolkit). The PDF bytes are
  // fetched over IPC (offline; no file:// or CDN) for pdfjs to render.
  getPresenterLibrary: () => ipcRenderer.invoke('presenter:library:get'),
  savePresenterLibrary: (lib) => ipcRenderer.invoke('presenter:library:save', lib).then(() => undefined),
  pickPresenterImport: () => ipcRenderer.invoke('presenter:import:pick'),
  importPresenterFile: (token) => ipcRenderer.invoke('presenter:import:file', token),
  getPresenterPdfData: (id) => ipcRenderer.invoke('presenter:pdf:getData', id),
  deletePresenterPresentation: (id) => ipcRenderer.invoke('presenter:delete', id).then(() => undefined),
  deletePresenterFolder: (id, mode) => ipcRenderer.invoke('presenter:folder:delete', id, mode),
  importPresenterPptxNotes: () => ipcRenderer.invoke('presenter:import:pptxNotes'),
  exportPresenterNotesTxt: (presentation) => ipcRenderer.invoke('presenter:export:txtNotes', presentation),
  importPresenterNotesTxt: () => ipcRenderer.invoke('presenter:import:txtNotes'),
  downloadPresenterPdf: (id, name) => ipcRenderer.invoke('presenter:export:pdf', id, name),
  startPresenter: (pdfId, startSlide) => ipcRenderer.invoke('presenter:start', pdfId, startSlide).then(() => undefined),
  startPresenterMode: (pdfId, startSlide) => ipcRenderer.invoke('presenter:startPresenterMode', pdfId, startSlide).then(() => undefined),
  stopPresenter: () => ipcRenderer.invoke('presenter:stop').then(() => undefined),
  getPresenterState: () => ipcRenderer.invoke('presenter:state:get'),
  getPresenterServerInfo: () => ipcRenderer.invoke('presenter:server:info'),
  getPresenterVolume: () => ipcRenderer.invoke('presenter:volume:get'),
  setPresenterVolume: (volume) => ipcRenderer.invoke('presenter:volume:set', volume).then(() => undefined),
  openPresenterCast: () => ipcRenderer.invoke('presenter:cast'),
  sendPresenterControl: (action) => ipcRenderer.send('presenter:control', action),
  onPresenterControl: (cb) => {
    const listener = (_e: unknown, action: PresenterControlAction) => cb(action);
    ipcRenderer.on('presenter:control:event', listener);
    return () => ipcRenderer.removeListener('presenter:control:event', listener);
  },
  onPresenterEnded: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('presenter:ended', listener);
    return () => ipcRenderer.removeListener('presenter:ended', listener);
  },
};
