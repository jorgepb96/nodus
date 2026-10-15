import { ipcRenderer } from 'electron';
import type { LibraryApi } from '@shared/api/library';

export const libraryApi: LibraryApi = {
  getGlobalLibraryStatus: () => ipcRenderer.invoke('library:status'),
  rebuildGlobalLibrary: () => ipcRenderer.invoke('library:rebuild'),
  listGlobalLibraryItems: (query) => ipcRenderer.invoke('library:list', query),
  migrateExistingVaultLibraries: () => ipcRenderer.invoke('library:migrateVaults'),
  previewLibraryMigration: () => ipcRenderer.invoke('library:migrationPreview'),
  startLibraryMigration: (request) => ipcRenderer.invoke('library:startMigration', request),
  resumeLibraryMigration: (sessionId) => ipcRenderer.invoke('library:resumeMigration', sessionId),
  cancelLibraryMigration: (sessionId) => ipcRenderer.invoke('library:cancelMigration', sessionId),
  rollbackLibraryMigration: (sessionId) => ipcRenderer.invoke('library:rollbackMigration', sessionId),
  listLibraryMigrationSessions: () => ipcRenderer.invoke('library:migrationSessions'),
  listZoteroImportLibraries: () => ipcRenderer.invoke('library:zoteroLibraries'),
  importZoteroLibrary: (requestId, selection) => ipcRenderer.invoke('library:importZotero', requestId, selection),
  listZoteroSyncSessions: () => ipcRenderer.invoke('library:zoteroSyncSessions'),
  resumeZoteroLibraryImport: (requestId) => ipcRenderer.invoke('library:resumeZoteroImport', requestId),
  cancelZoteroLibraryImport: (requestId) => ipcRenderer.invoke('library:cancelZoteroImport', requestId),
  onZoteroImportProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:zoteroImportProgress', listener);
    return () => ipcRenderer.removeListener('library:zoteroImportProgress', listener);
  },
  enqueueLibraryExtraction: (itemIds, options, priority) => ipcRenderer.invoke('library:enqueueExtraction', itemIds, options, priority),
  listLibraryExtractionJobs: () => ipcRenderer.invoke('library:extractionJobs'),
  cancelLibraryExtraction: (jobId) => ipcRenderer.invoke('library:cancelExtraction', jobId),
  retryLibraryExtraction: (jobId) => ipcRenderer.invoke('library:retryExtraction', jobId),
  prepareGlobalLibraryReading: (itemId) => ipcRenderer.invoke('library:prepareReading', itemId),
  onLibraryExtractionProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:extractionProgress', listener);
    return () => ipcRenderer.removeListener('library:extractionProgress', listener);
  },
  listGlobalLibraryCollections: () => ipcRenderer.invoke('library:collections'),
  listGlobalLibrarySavedSearches: () => ipcRenderer.invoke('library:savedSearches'),
  saveGlobalLibrarySavedSearch: (input) => ipcRenderer.invoke('library:saveSavedSearch', input),
  deleteGlobalLibrarySavedSearch: (id) => ipcRenderer.invoke('library:deleteSavedSearch', id),
  getGlobalLibraryViewPreferences: () => ipcRenderer.invoke('library:viewPreferences'),
  setGlobalLibraryViewPreferences: (preferences) => ipcRenderer.invoke('library:setViewPreferences', preferences),
  getGlobalLibrarySettings: () => ipcRenderer.invoke('library:settings'),
  setGlobalLibrarySettings: (settings) => ipcRenderer.invoke('library:setSettings', settings),
  getGlobalLibraryItem: (itemId) => ipcRenderer.invoke('library:item', itemId),
  createGlobalLibraryCollection: (name, parentId) => ipcRenderer.invoke('library:createCollection', name, parentId),
  updateGlobalLibraryCollection: (id, patch) => ipcRenderer.invoke('library:updateCollection', id, patch),
  deleteGlobalLibraryCollection: (id, deleteItems) => ipcRenderer.invoke('library:deleteCollection', id, deleteItems),
  patchGlobalLibraryItemCollections: (itemIds, patch) => ipcRenderer.invoke('library:patchItemCollections', itemIds, patch),
  setGlobalLibraryItemsDeleted: (itemIds, deleted) => ipcRenderer.invoke('library:setItemsDeleted', itemIds, deleted),
  previewGlobalLibraryTrash: (itemIds) => ipcRenderer.invoke('library:trashImpact', itemIds),
  purgeGlobalLibraryTrash: (itemIds) => ipcRenderer.invoke('library:purgeTrash', itemIds),
  auditGlobalLibraryRecovery: () => ipcRenderer.invoke('library:auditRecovery'),
  importGlobalLibraryFiles: (collectionId) => ipcRenderer.invoke('library:importFiles', collectionId),
  importDroppedGlobalLibraryFiles: (filePaths, collectionId) => ipcRenderer.invoke('library:importDroppedFiles', filePaths, collectionId),
  importDroppedFilesIntoVault: (filePaths, vaultId) => ipcRenderer.invoke('library:importDroppedFilesToVault', filePaths, vaultId),
  importAcademicLearningSample: (vaultId) => ipcRenderer.invoke('library:importAcademicLearningSample', vaultId),
  importGlobalBibliographyFiles: (collectionId) => ipcRenderer.invoke('library:importBibliography', collectionId),
  createGlobalLibraryItem: (metadata, collectionIds) => ipcRenderer.invoke('library:createItem', metadata, collectionIds),
  importGlobalLibraryIdentifier: (kind, value, collectionIds) => ipcRenderer.invoke('library:importIdentifier', kind, value, collectionIds),
  duplicateGlobalLibraryItem: (itemId) => ipcRenderer.invoke('library:duplicateItem', itemId),
  convertGlobalLibraryItemToNodus: (itemId) => ipcRenderer.invoke('library:convertItemToNodus', itemId),
  updateGlobalLibraryItemMetadata: (itemId, patch) => ipcRenderer.invoke('library:updateMetadata', itemId, patch),
  addGlobalLibraryAttachments: (itemId) => ipcRenderer.invoke('library:addAttachments', itemId),
  updateGlobalLibraryAttachment: (itemId, attachmentId, patch) => ipcRenderer.invoke('library:updateAttachment', itemId, attachmentId, patch),
  replaceGlobalLibraryAttachment: (itemId, attachmentId) => ipcRenderer.invoke('library:replaceAttachment', itemId, attachmentId),
  removeGlobalLibraryAttachment: (itemId, attachmentId) => ipcRenderer.invoke('library:removeAttachment', itemId, attachmentId),
  openGlobalLibraryAttachment: (itemId, attachmentId) => ipcRenderer.invoke('library:openAttachment', itemId, attachmentId),
  revealGlobalLibraryAttachment: (itemId, attachmentId) => ipcRenderer.invoke('library:revealAttachment', itemId, attachmentId),
  upsertGlobalLibraryNote: (itemId, note) => ipcRenderer.invoke('library:upsertNote', itemId, note),
  deleteGlobalLibraryNote: (itemId, noteId) => ipcRenderer.invoke('library:deleteNote', itemId, noteId),
  setGlobalLibraryItemRelation: (itemId, targetItemId, relationType, enabled) => ipcRenderer.invoke('library:setRelation', itemId, targetItemId, relationType, enabled),
  patchGlobalLibraryItemTags: (itemIds, patch) => ipcRenderer.invoke('library:patchTags', itemIds, patch),
  listGlobalLibraryTags: () => ipcRenderer.invoke('library:tags'),
  setGlobalLibraryTagColor: (tag, color) => ipcRenderer.invoke('library:setTagColor', tag, color),
  resolveGlobalLibraryMetadata: (kind, value) => ipcRenderer.invoke('library:resolveMetadata', kind, value),
  startGlobalLibraryMetadataBatch: (requestId, itemIds) => ipcRenderer.invoke('library:startMetadataBatch', requestId, itemIds),
  applyGlobalLibraryMetadataBatch: (requestId, itemIds) => ipcRenderer.invoke('library:applyMetadataBatch', requestId, itemIds),
  cancelGlobalLibraryMetadataBatch: (requestId) => ipcRenderer.invoke('library:cancelMetadataBatch', requestId),
  onGlobalLibraryMetadataBatchProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:metadataBatchProgress', listener);
    return () => ipcRenderer.removeListener('library:metadataBatchProgress', listener);
  },
  updateGlobalLibraryCitationKey: (itemId, citationKey) => ipcRenderer.invoke('library:updateCitationKey', itemId, citationKey),
  listGlobalLibraryCitationStyles: () => ipcRenderer.invoke('library:citationStyles'),
  importGlobalLibraryCitationStyles: () => ipcRenderer.invoke('library:importCitationStyles'),
  importZoteroCitationStyles: () => ipcRenderer.invoke('library:importZoteroCitationStyles'),
  installGlobalLibraryRepositoryCitationStyle: (styleId) => ipcRenderer.invoke('library:installRepositoryCitationStyle', styleId),
  searchGlobalLibraryRepositoryCitationStyles: (query, limit) => ipcRenderer.invoke('library:searchRepositoryCitationStyles', query, limit),
  removeGlobalLibraryCitationStyle: (styleId) => ipcRenderer.invoke('library:removeCitationStyle', styleId),
  formatGlobalLibraryCitation: (itemIds, style, kind, locale) => ipcRenderer.invoke('library:formatCitation', itemIds, style, kind, locale),
  exportGlobalLibraryBibliography: (request) => ipcRenderer.invoke('library:exportBibliography', request),
  listGlobalLibraryDuplicates: () => ipcRenderer.invoke('library:duplicates'),
  previewGlobalLibraryMerge: (canonicalId, duplicateIds) => ipcRenderer.invoke('library:mergeImpact', canonicalId, duplicateIds),
  mergeGlobalLibraryItems: (canonicalId, duplicateIds) => ipcRenderer.invoke('library:mergeItems', canonicalId, duplicateIds),
  listGlobalLibraryVaults: () => ipcRenderer.invoke('library:vaults'),
  listGlobalLibraryVaultLinks: (itemId) => ipcRenderer.invoke('library:vaultLinks', itemId),
  linkGlobalLibraryItemsToVault: (itemIds, vaultId) => ipcRenderer.invoke('library:linkToVault', itemIds, vaultId),
  onLibraryMigrationProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:migrationProgress', listener);
    return () => ipcRenderer.removeListener('library:migrationProgress', listener);
  },
  onGlobalLibraryChanged: (cb) => {
    const listener = (_event: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('library:changed', listener);
    return () => ipcRenderer.removeListener('library:changed', listener);
  },
};
