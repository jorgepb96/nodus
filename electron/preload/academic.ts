// The academic and study half of the renderer bridge, paired with
// electron/ipc/academic.ts. Typed as AcademicApi so the compiler, not a test,
// guarantees the slice is complete.
import { ipcRenderer } from 'electron';
import type { QueueProgress, ReprocessProgress, EmbeddingPipelineProgress, PassageEmbeddingProgress, SemanticBridgeProgress, ChapterRelationsProgress, DocumentIndexProgress } from '@shared/types';
import type { AcademicApi } from '@shared/api/academic';

// The stream currently in flight for each cancellable channel, so the Stop
// button can abort it without the renderer having to juggle request ids. One
// stream at a time per surface (the composer is disabled while sending).
let activeChatRequestId: string | null = null;
/** How long a finished research turn still accepts its late activity events. */
const ACTIVITY_GRACE_MS = 2000;
let activeLibraryReaderChatRequestId: string | null = null;
let activeStudyImproveRequestId: string | null = null;
let activeStudyAssistantRequestId: string | null = null;
let activeStudySttRequestId: string | null = null;

export const academicApi: AcademicApi = {
  exportAcademicDocument: input => ipcRenderer.invoke('workspace:academic:export',input),
  getResearchCorpusSources: () => ipcRenderer.invoke('research:corpus:sources'),
  setResearchZoteroAutomatic: enabled => ipcRenderer.invoke('research:zotero:automatic', enabled),
  getZoteroMcpStatus: notebookId => ipcRenderer.invoke('research:zotero:status', notebookId),
  connectResearchZotero: input => ipcRenderer.invoke('research:zotero:connect', input),
  disconnectResearchZotero: notebookId => ipcRenderer.invoke('research:zotero:disconnect', notebookId),
  readResearchZotero: input => ipcRenderer.invoke('research:zotero:read', input),
  listResearchNotebooks: () => ipcRenderer.invoke('research:notebooks:list'),
  saveResearchNotebook: input => ipcRenderer.invoke('research:notebooks:save', input),
  deleteResearchNotebook: id => ipcRenderer.invoke('research:notebooks:delete', id),
  resolveResearchNotebook: id => ipcRenderer.invoke('research:notebooks:resolve', id),
  updateResearchNotebookAppearance: (id, patch) => ipcRenderer.invoke('research:notebooks:appearance', id, patch),
  getResearchNotebookPreparation: id => ipcRenderer.invoke('research:notebooks:preparation', id),
  readResearchDocument: input => ipcRenderer.invoke('research:corpus:read', input),
  searchResearchNotebook: (id, query) => ipcRenderer.invoke('research:notebooks:search', id, query),
  getResearchPreparationPolicy: () => ipcRenderer.invoke('research:preparation:policy'),
  setResearchPreparationPolicy: input => ipcRenderer.invoke('research:preparation:policy:set', input),
  previewResearchPreparation: input => ipcRenderer.invoke('research:preparation:preview', input),
  startResearchPreparationCampaign: input => ipcRenderer.invoke('research:preparation:campaign:start', input),
  getResearchPreparationProgress: () => ipcRenderer.invoke('research:preparation:progress'),
  controlResearchPreparationCampaign: input => ipcRenderer.invoke('research:preparation:campaign:control', input),
  controlAllResearchPreparation: action => ipcRenderer.invoke('research:preparation:control', action),
  onResearchPreparationProgress: callback => {
    const listener = (_event: unknown, value: import('@shared/researchCorpus').ResearchPreparationProgress) => callback(value);
    ipcRenderer.on('research:preparation:progress', listener);
    return () => ipcRenderer.removeListener('research:preparation:progress', listener);
  },
  getResearchPreparationInventory: () => ipcRenderer.invoke('research:preparation:inventory'),
  prepareResearchDocuments: ids => ipcRenderer.invoke('research:preparation:start', ids),
  indexResearchWorks: input => ipcRenderer.invoke('research:preparation:index', input),
  cancelResearchDocuments: ids => ipcRenderer.invoke('research:preparation:cancel', ids),
  setResearchPreparationEnabled: enabled => ipcRenderer.invoke('research:preparation:enabled', enabled),
  setResearchPreparationPaused: paused => ipcRenderer.invoke('research:preparation:paused', paused),
  listDictionaryEntries: (request) => ipcRenderer.invoke('dictionary:list', request),
  listDictionaryFacets: () => ipcRenderer.invoke('dictionary:facets'),
  getDictionaryEntry: (id) => ipcRenderer.invoke('dictionary:get', id),
  createDictionaryEntry: (input) => ipcRenderer.invoke('dictionary:create', input),
  updateDictionaryEntry: (id, patch, expectedUpdatedAt) =>
    ipcRenderer.invoke('dictionary:update', id, patch, expectedUpdatedAt),
  deleteDictionaryEntries: (ids) => ipcRenderer.invoke('dictionary:delete', ids),
  detectDictionaryDuplicates: (name, aliases) => ipcRenderer.invoke('dictionary:duplicates', name, aliases),
  retrieveDictionaryEvidence: (entryId, options) => ipcRenderer.invoke('dictionary:retrieve', entryId, options),
  scanDictionaryNewEvidence: (entryId, options) => ipcRenderer.invoke('dictionary:scan', entryId, options),
  scanChangedDictionaryEntries: (limit) => ipcRenderer.invoke('dictionary:scanChanged', limit),
  listDictionaryEvidence: (request) => ipcRenderer.invoke('dictionary:evidence:list', request),
  setDictionaryEvidenceDecision: (entryId, refs, decision) =>
    ipcRenderer.invoke('dictionary:evidence:decision', entryId, refs, decision).then(() => undefined),
  generateDictionaryEntry: async (request) => {
    const result = await ipcRenderer.invoke('dictionary:generate', request) as
      | { ok: true; version: Awaited<ReturnType<AcademicApi['generateDictionaryEntry']>> }
      | { ok: false; failureDetail: string };
    if (!result.ok) throw new Error(result.failureDetail);
    return result.version;
  },
  startDictionaryGeneration: (request) => ipcRenderer.invoke('dictionary:generate:start', request),
  listDictionaryGenerationJobs: () => ipcRenderer.invoke('dictionary:generate:jobs'),
  onDictionaryProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress);
    ipcRenderer.on('dictionary:progress', listener);
    return () => ipcRenderer.removeListener('dictionary:progress', listener);
  },
  listDictionaryVersions: (entryId) => ipcRenderer.invoke('dictionary:versions:list', entryId),
  acceptDictionaryVersion: (entryId, versionId, expectedCurrentVersionId) =>
    ipcRenderer.invoke('dictionary:versions:accept', entryId, versionId, expectedCurrentVersionId),
  restoreDictionaryVersion: (entryId, versionId, expectedCurrentVersionId) =>
    ipcRenderer.invoke('dictionary:versions:restore', entryId, versionId, expectedCurrentVersionId),
  addDictionaryRelation: (fromEntryId, toEntryId, type) =>
    ipcRenderer.invoke('dictionary:relations:add', fromEntryId, toEntryId, type),
  onDictionaryChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entryId: string | null) => callback(entryId);
    ipcRenderer.on('dictionary:changed', listener);
    return () => ipcRenderer.removeListener('dictionary:changed', listener);
  },
  // Corpus: works and ideas
  listWorks: (filter) => ipcRenderer.invoke('works:list', filter),
  listWorksPage: (filter, request) => ipcRenderer.invoke('works:listPage', filter, request),
  listZoteroTags: () => ipcRenderer.invoke('works:listZoteroTags'),
  getWork: (nodusId) => ipcRenderer.invoke('works:get', nodusId),
  ingestZoteroItems: (items) => ipcRenderer.invoke('works:ingestZoteroItems', items),
  setManualDeep: (nodusId, value, model) => ipcRenderer.invoke('works:setManualDeep', nodusId, value, model),
  setManualDeepBulk: (nodusIds, value, model) => ipcRenderer.invoke('works:setManualDeepBulk', nodusIds, value, model),
  analyzeBoth: (nodusId, model) => ipcRenderer.invoke('works:analyzeBoth', nodusId, model).then(() => undefined),
  analyzeBothBulk: (nodusIds, model) => ipcRenderer.invoke('works:analyzeBothBulk', nodusIds, model).then(() => undefined),
  processFull: (nodusId, model, options) => ipcRenderer.invoke('works:processFull', nodusId, model, options).then(() => undefined),
  processFullBulk: (nodusIds, model, options) => ipcRenderer.invoke('works:processFullBulk', nodusIds, model, options).then(() => undefined),
  deleteWorks: (nodusIds) => ipcRenderer.invoke('works:delete', nodusIds),
  reassignThemes: (model) => ipcRenderer.invoke('works:reassignThemes', model),
  rescan: (nodusId, kind, model) => ipcRenderer.invoke('works:rescan', nodusId, kind, model),
  rescanDegraded: (model) => ipcRenderer.invoke('works:rescanDegraded', model),
  summarizeWork: (nodusId, model) => ipcRenderer.invoke('works:summarize', nodusId, model).then(() => undefined),
  summarizeBulk: (nodusIds, model) => ipcRenderer.invoke('works:summarizeBulk', nodusIds, model).then(() => undefined),
  summarizeAll: (model) => ipcRenderer.invoke('works:summarizeAll', model).then(() => undefined),
  getWorkSummary: (nodusId) => ipcRenderer.invoke('works:getSummary', nodusId),
  listCollectionFacets: () => ipcRenderer.invoke('works:collectionFacets'),
  listDuplicateWorks: () => ipcRenderer.invoke('works:listDuplicates'),
  mergeWorks: (canonicalId, duplicateIds) => ipcRenderer.invoke('works:merge', canonicalId, duplicateIds),
  listDuplicateIdeas: () => ipcRenderer.invoke('ideas:listDuplicates'),
  mergeIdeas: (canonicalId, duplicateIds) => ipcRenderer.invoke('ideas:merge', canonicalId, duplicateIds),
  backupDatabase: () => ipcRenderer.invoke('ideas:backup'),
  getWorkMeta: (nodusId) => ipcRenderer.invoke('works:meta', nodusId),
  openInZotero: (zoteroKey) => ipcRenderer.invoke('works:openInZotero', zoteroKey).then(() => undefined),
  openEvidenceAtPage: (nodusId, location) => ipcRenderer.invoke('works:openAtPage', nodusId, location),
  getLibraryReaderDocument: (nodusId) => ipcRenderer.invoke('libraryReader:get', nodusId),
  getLibraryReaderAttachmentContent: (nodusId, attachmentId) => ipcRenderer.invoke('libraryReader:attachmentContent', nodusId, attachmentId),
  getLibraryReaderAttachmentBytes: (nodusId, attachmentId) => ipcRenderer.invoke('libraryReader:attachmentBytes', nodusId, attachmentId),
  openLibraryReaderOriginal: (nodusId) => ipcRenderer.invoke('libraryReader:openOriginal', nodusId),
  listLibraryReaderAnnotations: (nodusId) => ipcRenderer.invoke('libraryReader:annotations:list', nodusId),
  listLibraryReaderOrphanedAnnotations: (nodusId) => ipcRenderer.invoke('libraryReader:annotations:listOrphaned', nodusId),
  createLibraryReaderAnnotation: (nodusId, input) => ipcRenderer.invoke('libraryReader:annotations:create', nodusId, input),
  updateLibraryReaderComment: (nodusId, id, comment) => ipcRenderer.invoke('libraryReader:annotations:updateComment', nodusId, id, comment),
  deleteLibraryReaderAnnotation: (nodusId, id) => ipcRenderer.invoke('libraryReader:annotations:delete', nodusId, id).then(() => undefined),
  onLibraryReaderAnnotationsChanged: (cb) => {
    const listener = (_e: unknown, nodusId: string | null) => cb(nodusId);
    ipcRenderer.on('libraryReader:annotations:changed', listener);
    return () => ipcRenderer.removeListener('libraryReader:annotations:changed', listener);
  },
  listLibraryReaderChatMessages: (nodusId) => ipcRenderer.invoke('libraryReader:chat:list', nodusId),
  libraryReaderChatStream: async (request, handlers) => {
    const requestId = `library-reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_event: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_event: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    ipcRenderer.on('libraryReader:chat:delta', onDelta);
    ipcRenderer.on('libraryReader:chat:reasoning', onReasoning);
    activeLibraryReaderChatRequestId = requestId;
    try {
      return await ipcRenderer.invoke('libraryReader:chat:stream', requestId, request);
    } finally {
      if (activeLibraryReaderChatRequestId === requestId) activeLibraryReaderChatRequestId = null;
      ipcRenderer.removeListener('libraryReader:chat:delta', onDelta);
      ipcRenderer.removeListener('libraryReader:chat:reasoning', onReasoning);
    }
  },
  cancelLibraryReaderChat: async () => {
    if (activeLibraryReaderChatRequestId) await ipcRenderer.invoke('libraryReader:chat:cancel', activeLibraryReaderChatRequestId);
  },
  clearLibraryReaderChat: (nodusId) => ipcRenderer.invoke('libraryReader:chat:clear', nodusId).then(() => undefined),
  onStudyMaterialAiProcessingRequest: (cb) => {
    const listener = (_e: unknown, request: Parameters<typeof cb>[0]) => cb(request);
    ipcRenderer.on('study:knowledge:processing:request', listener);
    return () => ipcRenderer.removeListener('study:knowledge:processing:request', listener);
  },
  resolveStudyMaterialAiProcessingRequest: (requestId, decision) =>
    ipcRenderer.invoke('study:knowledge:processing:resolve', requestId, decision).then(() => undefined),
  uploadText: (nodusId, filePath) => ipcRenderer.invoke('works:uploadText', nodusId, filePath),

  getQueue: () => ipcRenderer.invoke('queue:get'),
  pauseQueue: () => ipcRenderer.invoke('queue:pause'),
  resumeQueue: () => ipcRenderer.invoke('queue:resume'),
  cancelQueueItem: (id) => ipcRenderer.invoke('queue:cancelItem', id),
  removeQueueItem: (id) => ipcRenderer.invoke('queue:removeItem', id),
  moveQueueItemToTop: (id) => ipcRenderer.invoke('queue:moveToTop', id),
  clearQueue: () => ipcRenderer.invoke('queue:clear'),
  stopQueue: () => ipcRenderer.invoke('queue:stopAll'),
  retryFailed: () => ipcRenderer.invoke('queue:retryFailed'),
  enqueueBridgeDiscovery: (model) => ipcRenderer.invoke('queue:enqueueBridge', model).then(() => undefined),
  onQueueProgress: (cb) => {
    const listener = (_e: unknown, p: QueueProgress) => cb(p);
    ipcRenderer.on('queue:progress', listener);
    return () => ipcRenderer.removeListener('queue:progress', listener);
  },
  getDocumentProfile: (nodusId) => ipcRenderer.invoke('documents:profile:get', nodusId),
  saveDocumentProfileOverride: (input) => ipcRenderer.invoke('documents:profile:override:save', input),
  deleteDocumentProfileOverride: (overrideId) => ipcRenderer.invoke('documents:profile:override:delete', overrideId).then(() => undefined),
  getDocumentProfileStatuses: (nodusIds) => ipcRenderer.invoke('documents:profile:statuses', nodusIds),
  getDocumentIndexProgress: () => ipcRenderer.invoke('documents:index:progress'),
  startDocumentIndexCampaign: (options) => ipcRenderer.invoke('documents:index:startCampaign', options),
  enqueueDocumentProfile: (nodusId, vaultId?) => ipcRenderer.invoke('documents:index:enqueue', nodusId, vaultId).then(() => undefined),
  setDocumentIndexCampaignStatus: (vaultId, campaignId, status) => ipcRenderer.invoke('documents:index:campaignStatus', vaultId, campaignId, status).then(() => undefined),
  cancelDocumentIndexJob: (jobId, vaultId?) => ipcRenderer.invoke('documents:index:cancelJob', jobId, vaultId).then(() => undefined),
  onDocumentIndexProgress: (cb) => {
    const listener = (_e: unknown, progress: DocumentIndexProgress) => cb(progress);
    ipcRenderer.on('documents:index:progress', listener);
    return () => ipcRenderer.removeListener('documents:index:progress', listener);
  },

  stellarPage: (request) => ipcRenderer.invoke('stellar:page', request),
  stellarThemes: () => ipcRenderer.invoke('stellar:themes'),
  getStellarSession: (key) => ipcRenderer.invoke('stellar:session', key),
  saveStellarSession: (vaultId, key, state) => ipcRenderer.invoke('stellar:save', vaultId, key, state),
  getGraph: (lens) => ipcRenderer.invoke('graph:get', lens),
  listIdeasPage: (request) => ipcRenderer.invoke('ideas:listPage', request),
  listPickerIdeas: () => ipcRenderer.invoke('ideas:picker'),
  listIdeaConnections: (globalId) => ipcRenderer.invoke('ideas:connections', globalId),
  getIdeaDetail: (globalId) => ipcRenderer.invoke('graph:ideaDetail', globalId),
  deleteIdea: (globalId) => ipcRenderer.invoke('ideas:delete', globalId).then(() => undefined),
  getEdgeDetail: (edgeId) => ipcRenderer.invoke('graph:edgeDetail', edgeId),
  getIdeaEdges: (globalId) => ipcRenderer.invoke('graph:ideaEdges', globalId),
  setEdgeFeedback: (fromId, toId, type, verdict, note) => ipcRenderer.invoke('graph:edgeFeedback:set', fromId, toId, type, verdict, note),
  listEdgeFeedback: () => ipcRenderer.invoke('graph:edgeFeedback:list'),
  getIdeasByWork: (nodusId, limit, offset) => ipcRenderer.invoke('works:ideasByWork', nodusId, limit, offset),
  getWorkIdeaSynthesis: (nodusId) => ipcRenderer.invoke('works:getIdeaSynthesis', nodusId),
  synthesizeWorkIdeas: (nodusId, model) => ipcRenderer.invoke('works:synthesizeIdeas', nodusId, model),
  getThemes: () => ipcRenderer.invoke('graph:themes'),

  listAuthors: () => ipcRenderer.invoke('authors:list'),
  listAuthorsPage: (request) => ipcRenderer.invoke('authors:listPage', request),
  setAuthorSaved: (authorId, saved) => ipcRenderer.invoke('authors:setSaved', authorId, saved).then(() => undefined),
  getAuthorDossier: (authorId) => ipcRenderer.invoke('authors:dossier', authorId),
  synthesizeAuthor: (authorId, model) => ipcRenderer.invoke('authors:synthesize', authorId, model),
  getSynthesisMatrix: () => ipcRenderer.invoke('authors:matrix'),
  synthesizeMatrixCell: (authorId, themeId, model) =>
    ipcRenderer.invoke('authors:matrixCell', authorId, themeId, model),
  exportAuthorSyntheses: (request) => ipcRenderer.invoke('authors:exportSyntheses', request),

  getStudyWorkspace: (options) => ipcRenderer.invoke('study:workspace', options),
  getStudySchedule: (academicYearId) => ipcRenderer.invoke('study:schedule:get', academicYearId ?? null),
  saveStudySchedule: (schedule) => ipcRenderer.invoke('study:schedule:save', schedule),
  copyStudySchedule: (fromAcademicYearId, toAcademicYearId) => ipcRenderer.invoke('study:schedule:copy', fromAcademicYearId, toAcademicYearId),
  createStudyAcademicYear: (input) => ipcRenderer.invoke('study:academicYear:create', input),
  updateStudyAcademicYear: (id, patch) => ipcRenderer.invoke('study:academicYear:update', id, patch),
  deleteStudyAcademicYear: (id) => ipcRenderer.invoke('study:academicYear:delete', id).then(() => undefined),
  createStudyCourse: (input) => ipcRenderer.invoke('study:course:create', input),
  createStudySubject: (input) => ipcRenderer.invoke('study:subject:create', input),
  createStudyTopic: (input) => ipcRenderer.invoke('study:topic:create', input),
  createStudyFolder: (input) => ipcRenderer.invoke('study:folder:create', input),
  createStudyDocument: (input) => ipcRenderer.invoke('study:document:create', input),
  updateStudyEntity: (kind, id, patch) => ipcRenderer.invoke('study:entity:update', kind, id, patch),
  moveStudyEntity: (kind, id, input) => ipcRenderer.invoke('study:entity:move', kind, id, input),
  addStudyPlacement: (documentId, input) => ipcRenderer.invoke('study:placement:add', documentId, input),
  setPrimaryStudyPlacement: (documentId, input) => ipcRenderer.invoke('study:placement:setPrimary', documentId, input),
  moveStudyPlacement: (documentId, placementId, destination) => ipcRenderer.invoke('study:placement:move', documentId, placementId, destination),
  removeStudyPlacement: (id) => ipcRenderer.invoke('study:placement:remove', id).then(() => undefined),
  setStudyLifecycle: (kind, id, action, options) => ipcRenderer.invoke('study:lifecycle:set', kind, id, action, options).then(() => undefined),
  duplicateStudyTree: (kind, id) => ipcRenderer.invoke('study:tree:duplicate', kind, id),
  createStudyTag: (input) => ipcRenderer.invoke('study:tag:create', input),
  updateStudyTag: (id, patch) => ipcRenderer.invoke('study:tag:update', id, patch),
  deleteStudyTag: (id) => ipcRenderer.invoke('study:tag:delete', id).then(() => undefined),
  setStudyDocumentTags: (documentId, tagIds) => ipcRenderer.invoke('study:document:setTags', documentId, tagIds).then(() => undefined),
  createStudyTemplate: (input) => ipcRenderer.invoke('study:template:create', input),
  updateStudyTemplate: (id, patch) => ipcRenderer.invoke('study:template:update', id, patch),
  deleteStudyTemplate: (id) => ipcRenderer.invoke('study:template:delete', id).then(() => undefined),
  applyStudyTemplate: (id, name) => ipcRenderer.invoke('study:template:apply', id, name),
  getStudyDocEditorData: (documentId) => ipcRenderer.invoke('study:editor:data', documentId),
  updateStudyDoc: (documentId, input) => ipcRenderer.invoke('study:editor:update', documentId, input),
  restoreStudyDocVersion: (documentId, versionId) => ipcRenderer.invoke('study:editor:restore', documentId, versionId),
  createStudyAnnotation: (documentId, input) => ipcRenderer.invoke('study:annotation:create', documentId, input),
  updateStudyAnnotation: (id, patch) => ipcRenderer.invoke('study:annotation:update', id, patch),
  deleteStudyAnnotation: (id) => ipcRenderer.invoke('study:annotation:delete', id).then(() => undefined),
  transcribeStudyAudio: async (request, handlers = {}) => {
    const requestId = `study-stt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_event: unknown, id: string, fraction: number) => { if (id === requestId) handlers.onProgress?.(fraction); };
    const onPartial = (_event: unknown, id: string, text: string) => { if (id === requestId) handlers.onPartial?.(text); };
    let markStreamComplete: () => void = () => {};
    const streamComplete = new Promise<void>((resolve) => { markStreamComplete = resolve; });
    const onComplete = (_event: unknown, id: string) => { if (id === requestId) markStreamComplete(); };
    ipcRenderer.on('study:stt:progress', onProgress);
    ipcRenderer.on('study:stt:partial', onPartial);
    ipcRenderer.on('study:stt:complete', onComplete);
    activeStudySttRequestId = requestId;
    try {
      const result = await ipcRenderer.invoke('study:stt:transcribe', { ...request, requestId });
      // The invoke reply and webContents.send events travel through separate IPC
      // queues. On a busy runner the reply can win, so keep the listeners alive
      // until main confirms every partial/progress event has been enqueued.
      await Promise.race([streamComplete, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
      return result;
    } finally {
      if (activeStudySttRequestId === requestId) activeStudySttRequestId = null;
      ipcRenderer.removeListener('study:stt:progress', onProgress);
      ipcRenderer.removeListener('study:stt:partial', onPartial);
      ipcRenderer.removeListener('study:stt:complete', onComplete);
    }
  },
  cancelStudyTranscription: async () => {
    if (activeStudySttRequestId) await ipcRenderer.invoke('study:stt:cancel', activeStudySttRequestId);
  },
  getWhisperCppStatus: () => ipcRenderer.invoke('study:stt:whisperCpp:status'),
  installWhisperCpp: () => ipcRenderer.invoke('study:stt:whisperCpp:install'),
  uninstallWhisperCpp: () => ipcRenderer.invoke('study:stt:whisperCpp:uninstall'),
  chooseWhisperCppExecutable: () => ipcRenderer.invoke('study:stt:whisperCpp:chooseExecutable'),
  downloadWhisperCppModel: async (model, onProgress) => {
    const requestId = `whisper-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('study:stt:modelProgress', listener);
    try { return await ipcRenderer.invoke('study:stt:whisperCpp:download', requestId, model); }
    finally { ipcRenderer.removeListener('study:stt:modelProgress', listener); }
  },
  deleteWhisperCppModel: (model) => ipcRenderer.invoke('study:stt:whisperCpp:delete', model),
  listStudyStyles: (options) => ipcRenderer.invoke('study:styles:list', options),
  createStudyStyle: (input) => ipcRenderer.invoke('study:styles:create', input),
  updateStudyStyle: (id, patch) => ipcRenderer.invoke('study:styles:update', id, patch),
  duplicateStudyStyle: (id) => ipcRenderer.invoke('study:styles:duplicate', id),
  archiveStudyStyle: (id, archived) => ipcRenderer.invoke('study:styles:archive', id, archived),
  deleteStudyStyle: (id) => ipcRenderer.invoke('study:styles:delete', id).then(() => undefined),
  listStudyStyleVersions: (styleId) => ipcRenderer.invoke('study:styles:versions', styleId),
  restoreStudyStyleVersion: (styleId, versionId) => ipcRenderer.invoke('study:styles:restore', styleId, versionId),
  listStudyStyleAssociations: () => ipcRenderer.invoke('study:styles:associations'),
  setStudyStyleAssociation: (styleId, kind, targetId, isDefault) => ipcRenderer.invoke('study:styles:associate', styleId, kind, targetId, isDefault),
  resolveStudyStyleDefault: (subjectId, documentKind) => ipcRenderer.invoke('study:styles:default', subjectId, documentKind),
  exportStudyStyles: (styleIds) => ipcRenderer.invoke('study:styles:export', styleIds),
  importStudyStyles: () => ipcRenderer.invoke('study:styles:import'),
  improveStudyText: async (request, handlers) => {
    const requestId = `study-improve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('study:improve:delta', onDelta);
    activeStudyImproveRequestId = requestId;
    try {
      return await ipcRenderer.invoke('study:improve', requestId, request);
    } finally {
      if (activeStudyImproveRequestId === requestId) activeStudyImproveRequestId = null;
      ipcRenderer.removeListener('study:improve:delta', onDelta);
    }
  },
  suggestStudySynonyms: (request) => ipcRenderer.invoke('study:synonyms', request),
  cancelStudyImprove: async () => {
    if (activeStudyImproveRequestId) await ipcRenderer.invoke('study:improve:cancel', activeStudyImproveRequestId);
  },
  listStudyImprovementLog: (documentId) => ipcRenderer.invoke('study:improve:log', documentId),
  updateStudyImprovementAction: (id, action) => ipcRenderer.invoke('study:improve:action', id, action).then(() => undefined),
  listStudyMaterials: (options) => ipcRenderer.invoke('study:materials:list', options),
  getStudyMaterial: (id) => ipcRenderer.invoke('study:materials:get', id),
  getStudyMaterialContent: (id) => ipcRenderer.invoke('study:materials:content', id),
  downloadStudyMaterial: (id) => ipcRenderer.invoke('study:materials:download', id),
  importStudyMaterials: (input) => ipcRenderer.invoke('study:materials:import', input),
  importStudyMaterialFolder: (input) => ipcRenderer.invoke('study:materials:importFolder', input),
  chooseStudyMaterialPaths: (folder) => ipcRenderer.invoke('study:materials:choosePaths', folder),
  importStudyMaterialPaths: (paths, input) => ipcRenderer.invoke('study:materials:importPaths', paths, input),
  importZoteroStudyMaterial: (input) => ipcRenderer.invoke('study:materials:importZotero', input),
  openStudyMaterialInZotero: (id) => ipcRenderer.invoke('study:materials:openZotero', id).then(() => undefined),
  reindexStudyMaterial: (id) => ipcRenderer.invoke('study:materials:reindex', id),
  onStudyMaterialIndexChanged: (cb) => {
    const listener = (_event: unknown, id: string) => cb(id);
    ipcRenderer.on('study:materials:indexChanged', listener);
    return () => ipcRenderer.removeListener('study:materials:indexChanged', listener);
  },
  replaceStudyMaterialFile: (id, ocr) => ipcRenderer.invoke('study:materials:replace', id, ocr),
  updateStudyMaterial: (id, patch) => ipcRenderer.invoke('study:materials:update', id, patch),
  restoreStudyMaterialVersion: (id, versionId) => ipcRenderer.invoke('study:materials:version:restore', id, versionId),
  addStudyMaterialPlacement: (id, input) => ipcRenderer.invoke('study:materials:placement:add', id, input),
  setPrimaryStudyMaterialPlacement: (id, input) => ipcRenderer.invoke('study:materials:placement:setPrimary', id, input),
  moveStudyMaterialPlacement: (id, placementId, destination) => ipcRenderer.invoke('study:materials:placement:move', id, placementId, destination),
  removeStudyMaterialPlacement: (id, placementId) => ipcRenderer.invoke('study:materials:placement:remove', id, placementId).then(() => undefined),
  createStudyMaterialAnnotation: (materialId, input) => ipcRenderer.invoke('study:materials:annotation:create', materialId, input),
  updateStudyMaterialAnnotation: (id, patch) => ipcRenderer.invoke('study:materials:annotation:update', id, patch),
  deleteStudyMaterialAnnotation: (id) => ipcRenderer.invoke('study:materials:annotation:delete', id).then(() => undefined),
  exportAnnotatedStudyMaterial: (id) => ipcRenderer.invoke('study:materials:annotation:export', id),
  createStudyNoteFromMaterial: (materialId, annotationId, title) => ipcRenderer.invoke('study:materials:note:create', materialId, annotationId, title),
  setStudyMaterialLifecycle: (id, action, options) => ipcRenderer.invoke('study:materials:lifecycle', id, action, options).then(() => undefined),
  listStudyRecordings: (options) => ipcRenderer.invoke('study:recordings:list', options),
  getStudyRecording: (id) => ipcRenderer.invoke('study:recordings:get', id),
  getStudyRecordingContent: (id) => ipcRenderer.invoke('study:recordings:content', id),
  createStudyRecording: (input) => ipcRenderer.invoke('study:recordings:create', input),
  importStudyRecordings: (scope) => ipcRenderer.invoke('study:recordings:import', scope),
  updateStudyRecording: (id, patch) => ipcRenderer.invoke('study:recordings:update', id, patch),
  createStudyAudioMarker: (recordingId, input) => ipcRenderer.invoke('study:recordings:marker:create', recordingId, input),
  updateStudyAudioMarker: (id, patch) => ipcRenderer.invoke('study:recordings:marker:update', id, patch),
  deleteStudyAudioMarker: (id) => ipcRenderer.invoke('study:recordings:marker:delete', id).then(() => undefined),
  saveStudyTranscript: (recordingId, input) => ipcRenderer.invoke('study:recordings:transcript:save', recordingId, input),
  updateStudyTranscript: (id, contentMarkdown, segments) => ipcRenderer.invoke('study:recordings:transcript:update', id, contentMarkdown, segments),
  diarizeStudyRecording: (request) => ipcRenderer.invoke('study:recordings:diarize', request),
  updateStudyTranscriptSegment: (id, patch) => ipcRenderer.invoke('study:recordings:segment:update', id, patch),
  deleteStudyTranscript: (id) => ipcRenderer.invoke('study:recordings:transcript:delete', id).then(() => undefined),
  createStudyNoteFromTranscript: (recordingId, transcriptId, placements) => ipcRenderer.invoke('study:recordings:note:create', recordingId, transcriptId, placements),
  deleteStudyRecordingAudio: (id) => ipcRenderer.invoke('study:recordings:audio:delete', id),
  setStudyRecordingLifecycle: (id, action) => ipcRenderer.invoke('study:recordings:lifecycle', id, action).then(() => undefined),
  searchStudyCorpus: (query, options) => ipcRenderer.invoke('study:search:query', query, options),
  getStudySearchIndexStatus: () => ipcRenderer.invoke('study:search:status'),
  rebuildStudySearchIndex: () => ipcRenderer.invoke('study:search:rebuild'),
  pauseStudySearchIndex: () => ipcRenderer.invoke('study:search:pause').then(() => undefined),
  resumeStudySearchIndex: () => ipcRenderer.invoke('study:search:resume').then(() => undefined),
  stopStudySearchIndex: () => ipcRenderer.invoke('study:search:stop').then(() => undefined),
  deleteStudySearchIndex: () => ipcRenderer.invoke('study:search:deleteIndex').then(() => undefined),
  setStudySearchSourceExcluded: (sourceId, excluded) => ipcRenderer.invoke('study:search:exclude', sourceId, excluded),
  listStudySavedSearches: () => ipcRenderer.invoke('study:search:saved:list'),
  saveStudySearch: (name, query, options) => ipcRenderer.invoke('study:search:saved:create', name, query, options),
  deleteStudySavedSearch: (id) => ipcRenderer.invoke('study:search:saved:delete', id).then(() => undefined),
  listStudySearchHistory: () => ipcRenderer.invoke('study:search:history:list'),
  clearStudySearchHistory: () => ipcRenderer.invoke('study:search:history:clear').then(() => undefined),
  onStudySearchProgress: (cb) => {
    const listener = (_e: unknown, next: Parameters<typeof cb>[0]) => cb(next);
    ipcRenderer.on('study:search:progress', listener);
    return () => ipcRenderer.removeListener('study:search:progress', listener);
  },
  listStudyIdeas: (subjectId, query) => ipcRenderer.invoke('study:knowledge:ideas', subjectId, query),
  getStudyIdeaDetail: (id) => ipcRenderer.invoke('study:knowledge:idea', id),
  deleteStudyIdea: (id) => ipcRenderer.invoke('study:knowledge:idea:delete', id).then(() => undefined),
  getStudyKnowledgeGraph: (subjectId) => ipcRenderer.invoke('study:knowledge:graph', subjectId),
  listStudyKnowledgeJobs: (subjectId) => ipcRenderer.invoke('study:knowledge:jobs', subjectId),
  getStudyKnowledgeProgress: () => ipcRenderer.invoke('study:knowledge:progress'),
  reanalyzeStudyKnowledgeSource: (sourceKind, sourceId) => ipcRenderer.invoke('study:knowledge:reanalyze', sourceKind, sourceId).then(() => undefined),
  onStudyKnowledgeChanged: (cb) => {
    const listener = (_event: unknown, next: Parameters<typeof cb>[0]) => cb(next);
    ipcRenderer.on('study:knowledge:changed', listener);
    return () => ipcRenderer.removeListener('study:knowledge:changed', listener);
  },
  listStudyAssistantSources: () => ipcRenderer.invoke('study:assistant:sources'),
  listStudyAssistantConversations: (includeArchived) => ipcRenderer.invoke('study:assistant:list', includeArchived),
  getStudyAssistantConversation: (id) => ipcRenderer.invoke('study:assistant:get', id),
  createStudyAssistantConversation: (input) => ipcRenderer.invoke('study:assistant:create', input),
  updateStudyAssistantConversation: (id, patch) => ipcRenderer.invoke('study:assistant:update', id, patch),
  deleteStudyAssistantConversation: (id) => ipcRenderer.invoke('study:assistant:delete', id).then(() => undefined),
  streamStudyAssistant: async (request, handlers) => {
    const requestId = `study-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => { if (id === requestId) handlers.onDelta(delta); };
    const onReasoning = (_e: unknown, id: string, delta: string) => { if (id === requestId) handlers.onReasoning?.(delta); };
    ipcRenderer.on('study:assistant:delta', onDelta); ipcRenderer.on('study:assistant:reasoning', onReasoning);
    activeStudyAssistantRequestId = requestId;
    try { return await ipcRenderer.invoke('study:assistant:stream', requestId, request); }
    finally {
      if (activeStudyAssistantRequestId === requestId) activeStudyAssistantRequestId = null;
      ipcRenderer.removeListener('study:assistant:delta', onDelta); ipcRenderer.removeListener('study:assistant:reasoning', onReasoning);
    }
  },
  cancelStudyAssistant: async () => {
    if (activeStudyAssistantRequestId) await ipcRenderer.invoke('study:assistant:cancel', activeStudyAssistantRequestId);
  },
  exportStudyAssistantConversation: (id) => ipcRenderer.invoke('study:assistant:export', id),
  listStudyQuestions: (filters) => ipcRenderer.invoke('study:questions:list', filters),
  getStudyQuestion: (id) => ipcRenderer.invoke('study:questions:get', id),
  createStudyQuestion: (input) => ipcRenderer.invoke('study:questions:create', input),
  updateStudyQuestion: (id, patch) => ipcRenderer.invoke('study:questions:update', id, patch),
  duplicateStudyQuestion: (id) => ipcRenderer.invoke('study:questions:duplicate', id),
  listStudyQuestionVersions: (id) => ipcRenderer.invoke('study:questions:versions', id),
  restoreStudyQuestionVersion: (id, versionId) => ipcRenderer.invoke('study:questions:restore', id, versionId),
  setStudyQuestionLifecycle: (id, action) => ipcRenderer.invoke('study:questions:lifecycle', id, action).then(() => undefined),
  generateStudyQuestions: (request) => ipcRenderer.invoke('study:questions:generate', request),
  exportStudyQuestions: (ids) => ipcRenderer.invoke('study:questions:export', ids),
  importStudyQuestions: () => ipcRenderer.invoke('study:questions:import'),
  listStudyQuestionCollections: () => ipcRenderer.invoke('study:questions:collections:list'),
  createStudyQuestionCollection: (name, description) => ipcRenderer.invoke('study:questions:collections:create', name, description),
  setStudyQuestionCollectionItems: (collectionId, questionIds) => ipcRenderer.invoke('study:questions:collections:setItems', collectionId, questionIds).then(() => undefined),
  deleteStudyQuestionCollection: (id) => ipcRenderer.invoke('study:questions:collections:delete', id).then(() => undefined),
  getStudyQuestionAnalytics: (id) => ipcRenderer.invoke('study:questions:analytics', id),
  findSimilarStudyQuestions: (id, threshold) => ipcRenderer.invoke('study:questions:similar', id, threshold),
  listStudyQuestionTags: () => ipcRenderer.invoke('study:questions:tags'),
  bulkStudyQuestions: (ids, action) => ipcRenderer.invoke('study:questions:bulk', ids, action),
  exportStudyInterchange: (kind, format, options) => ipcRenderer.invoke('study:interchange:export', kind, format, options),
  importStudyInterchange: (kind, options) => ipcRenderer.invoke('study:interchange:import', kind, options),
  listStudyAssessments: (kind, includeArchived) => ipcRenderer.invoke('study:assessments:list', kind, includeArchived),
  getStudyAssessment: (id) => ipcRenderer.invoke('study:assessments:get', id),
  createStudyAssessment: (input) => ipcRenderer.invoke('study:assessments:create', input),
  buildStudyTest: (input) => ipcRenderer.invoke('study:assessments:buildTest', input),
  updateStudyAssessment: (id, patch) => ipcRenderer.invoke('study:assessments:update', id, patch),
  deleteStudyAssessment: (id) => ipcRenderer.invoke('study:assessments:delete', id).then(() => undefined),
  listStudyAttempts: (assessmentId) => ipcRenderer.invoke('study:attempts:list', assessmentId),
  getStudyAttempt: (id) => ipcRenderer.invoke('study:attempts:get', id),
  startStudyAttempt: (input) => ipcRenderer.invoke('study:attempts:start', input),
  saveStudyAttemptAnswer: (id, input) => ipcRenderer.invoke('study:attempts:answer', id, input),
  submitStudyAttempt: (id, expired) => ipcRenderer.invoke('study:attempts:submit', id, expired),
  abandonStudyAttempt: (id) => ipcRenderer.invoke('study:attempts:abandon', id),
  exportStudyAssessment: (id, includeAnswers) => ipcRenderer.invoke('study:assessments:export', id, includeAnswers),
  listStudyRubrics: (includeArchived) => ipcRenderer.invoke('study:grading:rubrics:list', includeArchived),
  createStudyRubric: (input) => ipcRenderer.invoke('study:grading:rubrics:create', input),
  updateStudyRubric: (id, patch) => ipcRenderer.invoke('study:grading:rubrics:update', id, patch),
  duplicateStudyRubric: (id) => ipcRenderer.invoke('study:grading:rubrics:duplicate', id),
  deleteStudyRubric: (id) => ipcRenderer.invoke('study:grading:rubrics:delete', id).then(() => undefined),
  listStudyGradingRuns: (attemptAnswerId) => ipcRenderer.invoke('study:grading:runs:list', attemptAnswerId),
  setStudyGradingManualScore: (id, score, comment) => ipcRenderer.invoke('study:grading:manual', id, score, comment),
  listStudyFlashcards: (options) => ipcRenderer.invoke('study:flashcards:list', options),
  createStudyFlashcard: (input) => ipcRenderer.invoke('study:flashcards:create', input),
  updateStudyFlashcard: (id, patch) => ipcRenderer.invoke('study:flashcards:update', id, patch),
  createStudyFlashcardsFromQuestions: (ids) => ipcRenderer.invoke('study:flashcards:fromQuestions', ids),
  reviewStudyFlashcard: (input) => ipcRenderer.invoke('study:flashcards:review', input),
  setStudyFlashcardState: (id, action) => ipcRenderer.invoke('study:flashcards:state', id, action).then(() => undefined),
  listStudyFlashcardTags: () => ipcRenderer.invoke('study:flashcards:tags'),
  bulkStudyFlashcards: (ids, action) => ipcRenderer.invoke('study:flashcards:bulk', ids, action),
  exportStudyFlashcards: (ids) => ipcRenderer.invoke('study:flashcards:export', ids),
  importStudyFlashcards: (payload) => ipcRenderer.invoke('study:flashcards:import', payload),
  getStudyProgressDashboard: () => ipcRenderer.invoke('study:learning:progress'),
  getStudyPlanner: () => ipcRenderer.invoke('study:planner:get'),
  createStudyPlan: (input) => ipcRenderer.invoke('study:planner:create', input),
  createStudyPlanBlock: (input) => ipcRenderer.invoke('study:planner:block:create', input),
  createStudyCalendarEvent: (input) => ipcRenderer.invoke('study:planner:event:create', input),
  updateStudyCalendarEvent: (id, input) => ipcRenderer.invoke('study:planner:event:update', id, input),
  deleteStudyCalendarEvent: (id) => ipcRenderer.invoke('study:planner:event:delete', id).then(() => undefined),
  addStudyCalendarEventToExternal: (id, target) => ipcRenderer.invoke('study:planner:event:external', id, target),
  getAppleCalendarSyncStatus: () => ipcRenderer.invoke('study:calendar:apple:status'),
  listAppleCalendarDestinations: () => ipcRenderer.invoke('study:calendar:apple:destinations'),
  configureAppleCalendarSync: (input) => ipcRenderer.invoke('study:calendar:apple:configure', input),
  createStudyGoal: (input) => ipcRenderer.invoke('study:planner:goal:create', input),
  updateStudyPlannerItem: (kind, id, patch) => ipcRenderer.invoke('study:planner:item:update', kind, id, patch).then(() => undefined),
  startStudySession: (input) => ipcRenderer.invoke('study:planner:session:start', input),
  finishStudySession: (id, input) => ipcRenderer.invoke('study:planner:session:finish', id, input),
  exportStudyPlannerIcs: (target) => ipcRenderer.invoke('study:planner:exportIcs', target),
  listStudyAiUsage: (limit) => ipcRenderer.invoke('study:ai:usage:list', limit),
  getStudyAiUsageSummary: () => ipcRenderer.invoke('study:ai:usage:summary'),
  clearStudyAiUsage: () => ipcRenderer.invoke('study:ai:usage:clear').then(() => undefined),

  getStudyPlan: (request) => ipcRenderer.invoke('study:plan', request),
  setStudyProgress: (record) => ipcRenderer.invoke('study:progress:set', record),
  generateStudySession: (request) => ipcRenderer.invoke('study:session', request),
  buildImmersionScope: (request) => ipcRenderer.invoke('immersion:scope', request),
  generateImmersionSession: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_e: unknown, id: string, progress: import('@shared/types').ImmersionBuildProgress) => {
      if (id === requestId) handlers?.onProgress?.(progress);
    };
    ipcRenderer.on('immersion:generate:progress', onProgress);
    try {
      return await ipcRenderer.invoke('immersion:generate', requestId, request);
    } finally {
      ipcRenderer.removeListener('immersion:generate:progress', onProgress);
    }
  },
  listImmersionSessions: () => ipcRenderer.invoke('immersion:list'),
  getImmersionSession: (id) => ipcRenderer.invoke('immersion:get', id),
  restartImmersionSession: (id) => ipcRenderer.invoke('immersion:restart', id),
  setImmersionProgress: (id, progress) => ipcRenderer.invoke('immersion:progress:set', id, progress).then(() => undefined),
  answerImmersionQuestion: (request) => ipcRenderer.invoke('immersion:answer', request),
  exportImmersionSessionPdf: (id) => ipcRenderer.invoke('immersion:exportPdf', id),
  deleteImmersionSession: (id) => ipcRenderer.invoke('immersion:delete', id).then(() => undefined),

  listManagedThemes: () => ipcRenderer.invoke('themes:listManaged'),
  addManualTheme: (label) => ipcRenderer.invoke('themes:add', label),
  renameTheme: (themeId, label) => ipcRenderer.invoke('themes:rename', themeId, label),
  setThemePinned: (themeId, pinned) => ipcRenderer.invoke('themes:setPinned', themeId, pinned),
  deleteTheme: (themeId) => ipcRenderer.invoke('themes:delete', themeId),
  reprocessThemeConnections: async (options, model, onProgress) => {
    const listener = (_e: unknown, p: ReprocessProgress) => onProgress?.(p);
    ipcRenderer.on('themes:reprocess:progress', listener);
    try {
      return await ipcRenderer.invoke('themes:reprocess', options, model);
    } finally {
      ipcRenderer.removeListener('themes:reprocess:progress', listener);
    }
  },
  reprocessRepairedThemeWorks: async (model, onProgress) => {
    const listener = (_e: unknown, p: ReprocessProgress) => onProgress?.(p);
    ipcRenderer.on('themes:reprocess:progress', listener);
    try {
      return await ipcRenderer.invoke('themes:reprocessRepairedWorks', model);
    } finally {
      ipcRenderer.removeListener('themes:reprocess:progress', listener);
    }
  },
  checkGraphIntegrity: () => ipcRenderer.invoke('graph:integrity:check'),
  repairGraphIntegrity: () => ipcRenderer.invoke('graph:integrity:repair'),
  dismissRepairedThemeWorks: () => ipcRenderer.invoke('graph:integrity:dismissThemeWorks'),

  getGaps: () => ipcRenderer.invoke('gaps:aggregate'),
  getGapsPage: (offset, limit) => ipcRenderer.invoke('gaps:listPage', offset, limit),
  getContradictionCount: () => ipcRenderer.invoke('gaps:contradictionCount'),
  getGapDetail: (gapId) => ipcRenderer.invoke('gaps:detail', gapId),
  getContradictions: () => ipcRenderer.invoke('gaps:contradictions'),
  getReadingPath: (request) => ipcRenderer.invoke('reading:path', request),

  getDebates: () => ipcRenderer.invoke('debates:list'),
  analyzeDebate: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    ipcRenderer.on('debates:analyzeStream:delta', onDelta);
    ipcRenderer.on('debates:analyzeStream:reasoning', onReasoning);
    try {
      return await ipcRenderer.invoke('debates:analyzeStream', requestId, request);
    } finally {
      ipcRenderer.removeListener('debates:analyzeStream:delta', onDelta);
      ipcRenderer.removeListener('debates:analyzeStream:reasoning', onReasoning);
    }
  },

  listResearchQuestions: () => ipcRenderer.invoke('research:rq:list'),
  getResearchQuestion: (id) => ipcRenderer.invoke('research:rq:get', id),
  createResearchQuestion: (input) => ipcRenderer.invoke('research:rq:create', input),
  decomposeResearchQuestion: (request) => ipcRenderer.invoke('research:rq:decompose', request),
  updateResearchSubQuestions: (request) => ipcRenderer.invoke('research:rq:updateSubs', request),
  mapResearchCoverage: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_e: unknown, id: string, p: import('@shared/types').RqMapProgress) => {
      if (id === requestId) handlers?.onProgress?.(p);
    };
    ipcRenderer.on('research:rq:map:progress', onProgress);
    try {
      return await ipcRenderer.invoke('research:rq:map', requestId, request);
    } finally {
      ipcRenderer.removeListener('research:rq:map:progress', onProgress);
    }
  },
  deleteResearchQuestion: (id) => ipcRenderer.invoke('research:rq:delete', id).then(() => undefined),
  exportResearchCoverage: (request) => ipcRenderer.invoke('research:rq:export', request),
  generateHypothesisLab: (request) => ipcRenderer.invoke('hypothesis:generate', request),
  getResearchSystemPrompts: (key) => ipcRenderer.invoke('research:prompts:list', key),
  saveResearchSystemPrompt: (input) => ipcRenderer.invoke('research:prompts:save', input),
  selectResearchSystemPrompt: (key, id) => ipcRenderer.invoke('research:prompts:select', key, id),
  deleteResearchSystemPrompt: (id) => ipcRenderer.invoke('research:prompts:delete', id),
  listResearchContextSources: () => ipcRenderer.invoke('research:contextSources'),
  importResearchAttachments: (owner, filePaths) => ipcRenderer.invoke('research:attachments:import', owner, filePaths),
  pickResearchAttachments: (owner) => ipcRenderer.invoke('research:attachments:pick', owner),
  listResearchAttachments: (owner) => ipcRenderer.invoke('research:attachments:list', owner),
  removeResearchAttachment: (owner, id) => ipcRenderer.invoke('research:attachments:remove', owner, id),
  saveResearchAttachment: (owner, id) => ipcRenderer.invoke('research:attachments:save', owner, id),
  researchChat: (request) => ipcRenderer.invoke('research:chat', request),
  researchChatStream: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onActivity = (_e: unknown, id: string, activity: import('@shared/researchActivity').ResearchActivity) => {
      if (id === requestId) handlers.onActivity?.(activity);
    };
    ipcRenderer.on('research:chatStream:activity', onActivity);
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    // A handler without onReplace (an older view) keeps the provisional stream as it was.
    const onReplace = (_e: unknown, id: string, text: string) => {
      if (id === requestId) handlers.onReplace?.(text);
    };
    const onConcilium = (_e: unknown, id: string, result: import('@shared/researchConcilium').ConciliumResult) => {
      if (id === requestId) handlers.onConcilium?.(result);
    };
    ipcRenderer.on('research:chatStream:concilium', onConcilium);
    ipcRenderer.on('research:chatStream:delta', onDelta);
    ipcRenderer.on('research:chatStream:reasoning', onReasoning);
    ipcRenderer.on('research:chatStream:replace', onReplace);
    activeChatRequestId = requestId;
    try {
      const response = await ipcRenderer.invoke('research:chatStream', requestId, request);
      handlers.onStats?.(response.stats);
      return response;
    } finally {
      if (activeChatRequestId === requestId) activeChatRequestId = null;
      // Activity events and the invoke reply travel on different IPC pipes, so the reply can
      // overtake the last events of the turn. Keep listening briefly for those stragglers.
      setTimeout(() => ipcRenderer.removeListener('research:chatStream:activity', onActivity), ACTIVITY_GRACE_MS);
      ipcRenderer.removeListener('research:chatStream:concilium', onConcilium);
      ipcRenderer.removeListener('research:chatStream:delta', onDelta);
      ipcRenderer.removeListener('research:chatStream:reasoning', onReasoning);
      ipcRenderer.removeListener('research:chatStream:replace', onReplace);
    }
  },
  cancelResearchChat: async () => {
    if (activeChatRequestId) await ipcRenderer.invoke('research:chatStream:cancel', activeChatRequestId);
  },

  getWritingWorkshopSnapshot: (brief) => ipcRenderer.invoke('writing:snapshot', brief),
  generateWritingWorkshopDraft: (request) => ipcRenderer.invoke('writing:draft', request),
  exportWritingWorkshopDraft: (request) => ipcRenderer.invoke('writing:export', request),
  exportDeepResearchArchive: async (request, onProgress) => {
    const requestId = `dr-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_e: unknown, id: string, done: number, total: number, title: string) => {
      if (id === requestId) onProgress?.(done, total, title);
    };
    ipcRenderer.on('writing:exportZip:progress', listener);
    try {
      return await ipcRenderer.invoke('writing:exportZip', requestId, request);
    } finally {
      ipcRenderer.removeListener('writing:exportZip:progress', listener);
    }
  },
  listWritingWorkshopDrafts: () => ipcRenderer.invoke('writing:saved:list'),
  listWritingWorkshopDownloadCatalogue: (request) => ipcRenderer.invoke('writing:saved:downloadCatalogue', request),
  getWritingWorkshopDraft: (id) => ipcRenderer.invoke('writing:saved:get', id),
  saveWritingWorkshopDraft: (request) => ipcRenderer.invoke('writing:saved:save', request),
  setWritingWorkshopDraftRead: (id, read) => ipcRenderer.invoke('writing:saved:read', id, read),
  deleteWritingWorkshopDraft: (id) => ipcRenderer.invoke('writing:saved:delete', id).then(() => undefined),
  onWritingDraftsChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('writing:saved:changed', listener);
    return () => ipcRenderer.removeListener('writing:saved:changed', listener);
  },
  listWritingDraftAnnotations: (draftId) => ipcRenderer.invoke('writing:annotations:list', draftId),
  createWritingDraftAnnotation: (input) => ipcRenderer.invoke('writing:annotations:create', input),
  updateWritingDraftComment: (id, comment) => ipcRenderer.invoke('writing:annotations:updateComment', id, comment),
  deleteWritingDraftAnnotation: (id) => ipcRenderer.invoke('writing:annotations:delete', id).then(() => undefined),
  onWritingDraftAnnotationsChanged: (cb) => {
    const listener = (_event: unknown, draftId: string | null) => cb(draftId);
    ipcRenderer.on('writing:annotations:changed', listener);
    return () => ipcRenderer.removeListener('writing:annotations:changed', listener);
  },

  generateDeepResearchReport: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_e: unknown, id: string, progress: import('@shared/types').DeepResearchProgress) => {
      if (id === requestId) handlers?.onProgress?.(progress);
    };
    ipcRenderer.on('research:deep:progress', onProgress);
    try {
      return await ipcRenderer.invoke('research:deep', requestId, request);
    } finally {
      ipcRenderer.removeListener('research:deep:progress', onProgress);
    }
  },
  listDeepResearchJobs: () => ipcRenderer.invoke('research:deep:queue:list'),
  enqueueDeepResearchJob: (request) => ipcRenderer.invoke('research:deep:queue:enqueue', request),
  cancelDeepResearchJob: (id) => ipcRenderer.invoke('research:deep:queue:cancel', id),
  clearFinishedDeepResearchJobs: () => ipcRenderer.invoke('research:deep:queue:clear'),
  listCompleteGuideCatalog: () => ipcRenderer.invoke('research:completeGuide:catalog'),
  previewCompleteGuide: (request) => ipcRenderer.invoke('research:completeGuide:preview', request),
  getCompleteGuideEvidence: (draftId, itemId, language) => ipcRenderer.invoke('research:completeGuide:evidence', draftId, itemId, language),
  onDeepResearchQueue: (cb) => {
    const listener = (_e: unknown, jobs: import('@shared/types').DeepResearchJobRecord[]) => cb(jobs);
    ipcRenderer.on('research:deep:queue', listener);
    return () => ipcRenderer.removeListener('research:deep:queue', listener);
  },

  tutorPlan: (request) => ipcRenderer.invoke('tutor:plan', request),
  listTutorRoutes: () => ipcRenderer.invoke('tutor:routes:list'),
  saveTutorRoute: (plan, route, model, rating) => ipcRenderer.invoke('tutor:routes:save', plan, route, model, rating),
  rateTutorRoute: (routeId, rating) => ipcRenderer.invoke('tutor:routes:rate', routeId, rating),
  markTutorRoutePlayed: (routeId) => ipcRenderer.invoke('tutor:routes:played', routeId),
  deleteTutorRoute: (routeId) => ipcRenderer.invoke('tutor:routes:delete', routeId).then(() => undefined),
  tutorStep: (request) => ipcRenderer.invoke('tutor:step', request),
  tutorStepStream: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    ipcRenderer.on('tutor:stepStream:delta', onDelta);
    ipcRenderer.on('tutor:stepStream:reasoning', onReasoning);
    try {
      return await ipcRenderer.invoke('tutor:stepStream', requestId, request);
    } finally {
      ipcRenderer.removeListener('tutor:stepStream:delta', onDelta);
      ipcRenderer.removeListener('tutor:stepStream:reasoning', onReasoning);
    }
  },

  buildArgumentMap: (request) => ipcRenderer.invoke('argumentMap:build', request),
  discoverArgumentRoutes: () => ipcRenderer.invoke('argumentMap:discover'),

  listConversations: (includeArchived) => ipcRenderer.invoke('chat:list', includeArchived),
  getConversation: (id) => ipcRenderer.invoke('chat:get', id),
  createConversation: (input) => ipcRenderer.invoke('chat:create', input),
  saveConversationMessages: (id, messages, meta) =>
    ipcRenderer.invoke('chat:saveMessages', id, messages, meta).then(() => undefined),
  generateConversationTitle: (id, model) => ipcRenderer.invoke('chat:generateTitle', id, model),
  renameConversation: (id, title) => ipcRenderer.invoke('chat:rename', id, title).then(() => undefined),
  archiveConversation: (id, archived) => ipcRenderer.invoke('chat:archive', id, archived).then(() => undefined),
  deleteConversation: (id) => ipcRenderer.invoke('chat:delete', id).then(() => undefined),
  listChatProjects: () => ipcRenderer.invoke('chat:projects:list'),
  createChatProject: (input) => ipcRenderer.invoke('chat:projects:create', input),
  updateChatProject: (id, patch) => ipcRenderer.invoke('chat:projects:update', id, patch),
  deleteChatProject: (id) => ipcRenderer.invoke('chat:projects:delete', id).then(() => undefined),
  listChatProjectFolders: () => ipcRenderer.invoke('chat:folders:list'),
  createChatProjectFolder: (input) => ipcRenderer.invoke('chat:folders:create', input),
  renameChatProjectFolder: (id, name) => ipcRenderer.invoke('chat:folders:rename', id, name),
  moveChatProjectFolder: (id, parentId, index) => ipcRenderer.invoke('chat:folders:move', id, parentId, index),
  deleteChatProjectFolder: (id) => ipcRenderer.invoke('chat:folders:delete', id).then(() => undefined),
  setConversationProject: (id, projectId) => ipcRenderer.invoke('chat:setProject', id, projectId).then(() => undefined),
  setConversationFolder: (id, folderId) => ipcRenderer.invoke('chat:setFolder', id, folderId).then(() => undefined),
  listChatHistoryProjects: (surface) => ipcRenderer.invoke('chatHistory:projects:list', surface),
  createChatHistoryProject: (surface, input) => ipcRenderer.invoke('chatHistory:projects:create', surface, input),
  updateChatHistoryProject: (surface, id, patch) => ipcRenderer.invoke('chatHistory:projects:update', surface, id, patch),
  deleteChatHistoryProject: (surface, id) => ipcRenderer.invoke('chatHistory:projects:delete', surface, id).then(() => undefined),
  listChatHistoryFolders: (surface) => ipcRenderer.invoke('chatHistory:folders:list', surface),
  createChatHistoryFolder: (surface, input) => ipcRenderer.invoke('chatHistory:folders:create', surface, input),
  renameChatHistoryFolder: (surface, id, name) => ipcRenderer.invoke('chatHistory:folders:rename', surface, id, name),
  moveChatHistoryFolder: (surface, id, parentId, index) => ipcRenderer.invoke('chatHistory:folders:move', surface, id, parentId, index),
  deleteChatHistoryFolder: (surface, id) => ipcRenderer.invoke('chatHistory:folders:delete', surface, id).then(() => undefined),
  setChatHistoryProject: (surface, id, projectId) => ipcRenderer.invoke('chatHistory:setProject', surface, id, projectId).then(() => undefined),
  setChatHistoryFolder: (surface, id, folderId) => ipcRenderer.invoke('chatHistory:setFolder', surface, id, folderId).then(() => undefined),
  setChatHistoryPinned: (surface, id, pinned) => ipcRenderer.invoke('chatHistory:setPinned', surface, id, pinned).then(() => undefined),
  renameChatHistoryConversation: (surface, id, title) => ipcRenderer.invoke('chatHistory:rename', surface, id, title).then(() => undefined),
  archiveChatHistoryConversation: (surface, id, archived) => ipcRenderer.invoke('chatHistory:archive', surface, id, archived).then(() => undefined),
  listChatHistoryNotebooks: (surface) => ipcRenderer.invoke('chatHistory:notebooks:list', surface),
  createChatHistoryNotebook: (surface, input) => ipcRenderer.invoke('chatHistory:notebooks:create', surface, input),
  updateChatHistoryNotebook: (surface, id, patch) => ipcRenderer.invoke('chatHistory:notebooks:update', surface, id, patch),
  deleteChatHistoryNotebook: (surface, id) => ipcRenderer.invoke('chatHistory:notebooks:delete', surface, id).then(() => undefined),
  setConversationPinned: (id, pinned) => ipcRenderer.invoke('chat:setPinned', id, pinned).then(() => undefined),

  getNotesTree: (includeTrashed) => ipcRenderer.invoke('notes:tree', includeTrashed),
  createNoteFolder: (input) => ipcRenderer.invoke('notes:folders:create', input),
  renameNoteFolder: (id, name) => ipcRenderer.invoke('notes:folders:rename', id, name),
  moveNoteFolder: (id, parentId) => ipcRenderer.invoke('notes:folders:move', id, parentId),
  deleteNoteFolder: (id) => ipcRenderer.invoke('notes:folders:delete', id).then(() => undefined),
  trashNoteFolder: (id) => ipcRenderer.invoke('notes:folders:trash', id),
  createNote: (input) => ipcRenderer.invoke('notes:create', input),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  updateNote: (input) => ipcRenderer.invoke('notes:update', input),
  moveNote: (id, folderId) => ipcRenderer.invoke('notes:move', id, folderId),
  patchNoteTags: (noteIds, patch) => ipcRenderer.invoke('notes:tags:patch', noteIds, patch),
  trashNotes: (noteIds) => ipcRenderer.invoke('notes:trash', noteIds).then(() => undefined),
  restoreNotes: (noteIds) => ipcRenderer.invoke('notes:restore', noteIds).then(() => undefined),
  deleteNotesPermanently: (noteIds) => ipcRenderer.invoke('notes:deletePermanently', noteIds).then(() => undefined),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id).then(() => undefined),

  getManualIndexStatus: () => ipcRenderer.invoke('manualIdeas:indexStatus'),
  retryManualIndex: () => ipcRenderer.invoke('manualIdeas:retryIndex'),
  createManualIdea: (input) => ipcRenderer.invoke('manualIdeas:create', input),
  saveManualIdea: (payload) => ipcRenderer.invoke('manualIdeas:save', payload).then(() => undefined),
  autoIndexManualIdea: (input) => ipcRenderer.invoke('manualIdeas:autoIndex', input),
  searchIdeaCandidates: (query, excludeIds, limit) =>
    ipcRenderer.invoke('manualIdeas:searchCandidates', query, excludeIds, limit),

  exportNotes: (options) => ipcRenderer.invoke('notes:export', options),
  reorderNotes: (noteIds) => ipcRenderer.invoke('notes:reorder', noteIds).then(() => undefined),
  reorderNotesByAI: (noteIds) => ipcRenderer.invoke('notes:reorderByAI', noteIds),
  updateNoteFolderSummary: (id, summary) => ipcRenderer.invoke('notes:folders:updateSummary', id, summary),
  suggestFolderIdeas: (folderId) => ipcRenderer.invoke('notes:folders:suggestIdeas', folderId),
  getWorkspaceNoteEditorData: (noteId) => ipcRenderer.invoke('workspace:editor:data', noteId),
  updateWorkspaceNote: (noteId, input) => ipcRenderer.invoke('workspace:editor:update', noteId, input),
  restoreWorkspaceNoteVersion: (noteId, versionId) => ipcRenderer.invoke('workspace:editor:restore', noteId, versionId),
  createWorkspaceAnnotation: (noteId, input) => ipcRenderer.invoke('workspace:annotation:create', noteId, input),
  updateWorkspaceAnnotation: (id, patch) => ipcRenderer.invoke('workspace:annotation:update', id, patch),
  deleteWorkspaceAnnotation: (id) => ipcRenderer.invoke('workspace:annotation:delete', id).then(() => undefined),
  listStudyNoteLinks: (filter) => ipcRenderer.invoke('study:noteLinks:list', filter),
  addStudyNoteLink: (input) => ipcRenderer.invoke('study:noteLinks:add', input),
  removeStudyNoteLinks: (ids) => ipcRenderer.invoke('study:noteLinks:remove', ids).then(() => undefined),
  listWorkspaceLibraryLinks: (ownerKind, ownerId) => ipcRenderer.invoke('workspace:library:list', ownerKind, ownerId),
  listAllWorkspaceLibraryLinks: () => ipcRenderer.invoke('workspace:library:all'),
  addWorkspaceLibraryLink: (input) => ipcRenderer.invoke('workspace:library:add', input),
  removeWorkspaceLibraryLink: (ownerKind, ownerId, libraryItemId, scope) =>
    ipcRenderer.invoke('workspace:library:remove', ownerKind, ownerId, libraryItemId, scope).then(() => undefined),
  verifyCitations: (refs) => ipcRenderer.invoke('citations:verify', refs),
  getCitationPreview: (ref) => ipcRenderer.invoke('citations:preview', ref),
  searchVaultContent: (query, kinds, semantic, limit) => ipcRenderer.invoke('search:vaultContent', query, kinds, semantic, limit),
  globalSearch: (query, limitPerKind, kinds) => ipcRenderer.invoke('search:global', query, limitPerKind, kinds),
  inspectAcademicDocument: input => ipcRenderer.invoke('workspace:academic:inspect',input),
  listEditorReferences: options => ipcRenderer.invoke('editor:references',options),
  getSearchResultDetail: (kind, id) => ipcRenderer.invoke('search:detail', kind, id),
  semanticSearch: (query, options) => ipcRenderer.invoke('search:semantic', query, options),
  findSimilarToIdea: (globalId, limit) => ipcRenderer.invoke('search:similarIdea', globalId, limit),
  listSavedSearches: () => ipcRenderer.invoke('search:saved:list'),
  saveSearch: (input) => ipcRenderer.invoke('search:saved:create', input),
  deleteSavedSearch: (id) => ipcRenderer.invoke('search:saved:delete', id).then(() => undefined),
  getCorpusHealth: () => ipcRenderer.invoke('corpus:health'),
  suggestGapSearch: (statement, workTitles) =>
    ipcRenderer.invoke('gaps:suggestSearch', statement, workTitles),

  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (id) => ipcRenderer.invoke('projects:get', id),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  updateProject: (input) => ipcRenderer.invoke('projects:update', input),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id).then(() => undefined),
  updateProjectSection: (input) => ipcRenderer.invoke('projects:sections:update', input),
  addProjectLink: (input) => ipcRenderer.invoke('projects:links:add', input),
  deleteProjectLink: (id) => ipcRenderer.invoke('projects:links:delete', id).then(() => undefined),
  importProjectChapter: (input) => ipcRenderer.invoke('projects:chapters:import', input),
  updateProjectChapter: (chapterId, markdown) => ipcRenderer.invoke('projects:chapters:update', chapterId, markdown),
  listProjectChapterSuggestions: (chapterId) => ipcRenderer.invoke('projects:suggestions:list', chapterId),
  generateProjectSuggestions: (request) => ipcRenderer.invoke('projects:suggestions:generate', request),
  updateProjectSuggestionStatus: (id, status) =>
    ipcRenderer.invoke('projects:suggestions:updateStatus', id, status),
  applyProjectSuggestions: (request) => ipcRenderer.invoke('projects:suggestions:apply', request),
  listProjectChapterVersions: (chapterId) => ipcRenderer.invoke('projects:versions:list', chapterId),
  restoreProjectChapterVersion: (versionId) => ipcRenderer.invoke('projects:versions:restore', versionId),
  getChapterRelations: (chapterId) => ipcRenderer.invoke('projects:chapterRelations:get', chapterId),
  analyzeChapterRelations: (request) => ipcRenderer.invoke('projects:chapterRelations:analyze', request),
  onChapterRelationsProgress: (cb) => {
    const listener = (_e: unknown, p: ChapterRelationsProgress) => cb(p);
    ipcRenderer.on('projects:chapterRelations:progress', listener);
    return () => ipcRenderer.removeListener('projects:chapterRelations:progress', listener);
  },
  verifyManuscriptCitations: (request) => ipcRenderer.invoke('projects:manuscript:verify', request),
  applyManuscriptCitation: (request) => ipcRenderer.invoke('projects:manuscript:applyCitation', request),
  exportProject: (request) => ipcRenderer.invoke('projects:export', request),
  exportProjectChapter: (request) => ipcRenderer.invoke('projects:chapters:export', request),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (password) => ipcRenderer.invoke('data:import', password),
  exportSyncPackage: () => ipcRenderer.invoke('data:exportSync'),
  importSyncPackage: (passphrase?: string) => ipcRenderer.invoke('data:importSync', passphrase),
  getStudyDataOverview: () => ipcRenderer.invoke('study:data:overview'),
  maintainStudyData: (action) => ipcRenderer.invoke('study:data:maintain', action),
  exportStudyDiagnostic: () => ipcRenderer.invoke('study:data:diagnostic'),
  exportStudyScope: (scope, format) => ipcRenderer.invoke('study:data:exportScope', scope, format),
  resetGraph: () => ipcRenderer.invoke('data:resetGraph').then(() => undefined),

  hasAnyData: () => ipcRenderer.invoke('data:hasData'),
  seedDemoData: () => ipcRenderer.invoke('data:seedDemo'),
  seedPrimarySourcesDemoData: () => ipcRenderer.invoke('data:seedPrimarySourcesDemo'),
  clearDemoData: () => ipcRenderer.invoke('data:clearDemo').then(() => undefined),
  seedGenealogyDemoData: () => ipcRenderer.invoke('data:seedGenealogyDemo'),
  seedDatabasesDemoData: () => ipcRenderer.invoke('data:seedDatabasesDemo'),
  seedStudyDemoData: () => ipcRenderer.invoke('data:seedStudyDemo'),
  seedTeachingDemoData: () => ipcRenderer.invoke('data:seedTeachingDemo'),
  seedWorldbuildingDemoData: () => ipcRenderer.invoke('data:seedWorldbuildingDemo'),

  seedTestimonyDemoData: () => ipcRenderer.invoke('data:seedTestimonyDemo'),
  generateDemoPortraits: () => ipcRenderer.invoke('data:generateDemoPortraits'),
  onDemoPortraitsProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number }) => cb(p);
    ipcRenderer.on('demo:portraits', listener);
    return () => ipcRenderer.removeListener('demo:portraits', listener);
  },

  startEmbedding: (nodusIds) => ipcRenderer.invoke('embeddings:start', nodusIds).then(() => undefined),
  reindexAll: () => ipcRenderer.invoke('embeddings:reindexAll').then(() => undefined),
  pauseEmbedding: () => ipcRenderer.invoke('embeddings:pause').then(() => undefined),
  resumeEmbedding: () => ipcRenderer.invoke('embeddings:resume').then(() => undefined),
  stopEmbedding: () => ipcRenderer.invoke('embeddings:stop').then(() => undefined),
  clearEmbeddingProgress: () => ipcRenderer.invoke('embeddings:clearProgress').then(() => undefined),
  getEmbeddingStatus: () => ipcRenderer.invoke('embeddings:status'),
  getWorkEmbeddingStatuses: (nodusIds) => ipcRenderer.invoke('embeddings:workStatuses', nodusIds),
  onEmbeddingProgress: (cb) => {
    const listener = (_e: unknown, p: EmbeddingPipelineProgress) => cb(p);
    ipcRenderer.on('embeddings:progress', listener);
    return () => ipcRenderer.removeListener('embeddings:progress', listener);
  },

  startPassageEmbedding: (nodusIds) => ipcRenderer.invoke('passages:start', nodusIds).then(() => undefined),
  pausePassageEmbedding: () => ipcRenderer.invoke('passages:pause').then(() => undefined),
  resumePassageEmbedding: () => ipcRenderer.invoke('passages:resume').then(() => undefined),
  stopPassageEmbedding: () => ipcRenderer.invoke('passages:stop').then(() => undefined),
  clearPassageProgress: () => ipcRenderer.invoke('passages:clearProgress').then(() => undefined),
  getPassageStatus: () => ipcRenderer.invoke('passages:status'),
  getWorkPassageStatuses: (nodusIds) => ipcRenderer.invoke('passages:workStatuses', nodusIds),
  getPassage: (passageId) => ipcRenderer.invoke('passages:get', passageId),
  onPassageProgress: (cb) => {
    const listener = (_e: unknown, p: PassageEmbeddingProgress) => cb(p);
    ipcRenderer.on('passages:progress', listener);
    return () => ipcRenderer.removeListener('passages:progress', listener);
  },

  discoverSemanticBridges: (model) => ipcRenderer.invoke('bridges:discover', model),
  isSemanticBridgeRunning: () => ipcRenderer.invoke('bridges:isRunning'),
  onSemanticBridgeProgress: (cb) => {
    const listener = (_e: unknown, p: SemanticBridgeProgress) => cb(p);
    ipcRenderer.on('bridges:progress', listener);
    return () => ipcRenderer.removeListener('bridges:progress', listener);
  },
};
