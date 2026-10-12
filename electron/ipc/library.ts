import { localizedForUi, type IpcContext } from './context';
import { BrowserWindow, clipboard, dialog, shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openDocumentPath } from '../util/openDocument';
import { promisify } from 'node:util';
import { uiText, type UiTranslations } from '@shared/uiLanguage';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';
import {
  getGlobalLibraryStatus,
  listGlobalLibraryItemsResponsive,
  migrateExistingVaultLibraries,
  previewLibraryMigration,
  startLibraryMigration,
  resumeLibraryMigration,
  cancelLibraryMigration,
  rollbackLibraryMigration,
  listLibraryMigrationSessions,
  rebuildGlobalLibraryInBackground,
  cancelZoteroLibraryImport,
  listZoteroImportLibraries,
  listZoteroSyncSessions,
  resumeZoteroLibraryImport,
  startZoteroLibraryImport,
  enqueueLibraryExtraction,
  listLibraryExtractionJobs,
  cancelLibraryExtraction,
  retryLibraryExtraction,
  prepareGlobalLibraryReading,
  listGlobalLibraryCollections,
  listGlobalLibrarySavedSearches,
  saveGlobalLibrarySavedSearch,
  deleteGlobalLibrarySavedSearch,
  getGlobalLibraryViewPreferences,
  setGlobalLibraryViewPreferences,
  getGlobalLibrarySettings,
  setGlobalLibrarySettings,
  getGlobalLibraryItem,
  createGlobalLibraryCollection,
  updateGlobalLibraryCollection,
  deleteGlobalLibraryCollection,
  patchGlobalLibraryItemCollections,
  setGlobalLibraryItemsDeleted,
  previewGlobalLibraryTrash,
  purgeGlobalLibraryTrash,
  auditGlobalLibraryRecovery,
  importGlobalLibraryFiles,
  importGlobalBibliographyFiles,
  updateGlobalLibraryItemMetadata,
  resolveGlobalLibraryMetadata,
  listGlobalLibraryDuplicates,
  previewGlobalLibraryMerge,
  mergeGlobalLibraryItems,
  createGlobalLibraryItem,
  importGlobalLibraryIdentifier,
  duplicateGlobalLibraryItem,
  convertGlobalLibraryItemToNodus,
  addGlobalLibraryAttachments,
  updateGlobalLibraryAttachment,
  replaceGlobalLibraryAttachment,
  removeGlobalLibraryAttachment,
  globalLibraryAttachmentPath,
  upsertGlobalLibraryNote,
  deleteGlobalLibraryNote,
  setGlobalLibraryItemRelation,
  patchGlobalLibraryItemTags,
  listGlobalLibraryTags,
  setGlobalLibraryTagColor,
  listGlobalLibraryVaults,
  listGlobalLibraryVaultLinks,
  linkGlobalLibraryItemsToVault,
  importGlobalLibraryFilesIntoVault,
  startGlobalLibraryMetadataBatch,
  applyGlobalLibraryMetadataBatch,
  cancelGlobalLibraryMetadataBatch,
  updateGlobalLibraryCitationKey,
  formatGlobalLibraryCitation,
  listGlobalLibraryCitationStyles,
  importGlobalLibraryCitationStyleFiles,
  importGlobalLibraryZoteroCitationStyles,
  installGlobalLibraryRepositoryCitationStyle,
  searchGlobalLibraryRepositoryCitationStyles,
  removeGlobalLibraryCitationStyle,
  exportGlobalLibraryBibliography,
} from '../library/libraryService';

const execFileAsync = promisify(execFile);

async function revealAttachmentInFolder(filePath: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    try {
      // Electron's showItemInFolder can fail silently on macOS. Finder's native
      // reveal command both opens the containing folder and selects the file.
      await execFileAsync('/usr/bin/open', ['-R', filePath], { timeout: 10_000 });
      return true;
    } catch {
      const error = await shell.openPath(path.dirname(filePath));
      if (error) throw new Error(`No se pudo abrir la carpeta del adjunto: ${error}`);
      return true;
    }
  }

  shell.showItemInFolder(filePath);
  return true;
}

export function registerLibraryIpc({ h }: IpcContext): void {
  const dialogText = (copy: UiTranslations): string => uiText(getSettings().uiLanguage, copy);
  const existingItem = async (itemId: string) => {
    const item = await getGlobalLibraryItem(itemId);
    if (!item) throw new Error('El documento ya no existe.');
    return item;
  };
  h('library:status', async () => getGlobalLibraryStatus());
  h('library:rebuild', async () => rebuildGlobalLibraryInBackground());
  h('library:list', async (_event, query) => listGlobalLibraryItemsResponsive(query));
  h('library:migrateVaults', async () => migrateExistingVaultLibraries());
  h('library:migrationPreview', async () => previewLibraryMigration());
  h('library:startMigration', async (_event, request) => startLibraryMigration(request));
  h('library:resumeMigration', async (_event, sessionId) => resumeLibraryMigration(sessionId));
  h('library:cancelMigration', async (_event, sessionId) => cancelLibraryMigration(sessionId));
  h('library:rollbackMigration', async (_event, sessionId) => rollbackLibraryMigration(sessionId));
  h('library:migrationSessions', async () => listLibraryMigrationSessions());
  h('library:zoteroLibraries', async () => listZoteroImportLibraries());
  h('library:importZotero', async (event, requestId, selection) => startZoteroLibraryImport(
    requestId, selection, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('library:zoteroImportProgress', localizedForUi(progress));
    },
  ));
  h('library:zoteroSyncSessions', async () => listZoteroSyncSessions());
  h('library:resumeZoteroImport', async (event, requestId) => resumeZoteroLibraryImport(requestId, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('library:zoteroImportProgress', localizedForUi(progress));
  }));
  h('library:cancelZoteroImport', async (_event, requestId) => cancelZoteroLibraryImport(requestId));
  h('library:enqueueExtraction', async (_event, itemIds, options, priority) => enqueueLibraryExtraction(itemIds, options, priority));
  h('library:extractionJobs', async () => listLibraryExtractionJobs());
  h('library:cancelExtraction', async (_event, jobId) => cancelLibraryExtraction(jobId));
  h('library:retryExtraction', async (_event, jobId) => retryLibraryExtraction(jobId));
  h('library:prepareReading', async (_event, itemId) => prepareGlobalLibraryReading(itemId));
  h('library:collections', async () => listGlobalLibraryCollections());
  h('library:savedSearches', async () => listGlobalLibrarySavedSearches());
  h('library:saveSavedSearch', async (_event, input) => saveGlobalLibrarySavedSearch(input));
  h('library:deleteSavedSearch', async (_event, id) => deleteGlobalLibrarySavedSearch(id));
  h('library:viewPreferences', async () => getGlobalLibraryViewPreferences());
  h('library:setViewPreferences', async (_event, preferences) => setGlobalLibraryViewPreferences(preferences));
  h('library:settings', async () => getGlobalLibrarySettings());
  h('library:setSettings', async (_event, settings) => setGlobalLibrarySettings(settings));
  h('library:item', async (_event, itemId) => getGlobalLibraryItem(itemId));
  h('library:createCollection', async (_event, name, parentId) => createGlobalLibraryCollection(name, parentId));
  h('library:updateCollection', async (_event, id, patch) => updateGlobalLibraryCollection(id, patch));
  h('library:deleteCollection', async (_event, id, deleteItems) => deleteGlobalLibraryCollection(id, deleteItems));
  h('library:patchItemCollections', async (_event, itemIds, patch) => patchGlobalLibraryItemCollections(itemIds, patch));
  h('library:setItemsDeleted', async (_event, itemIds, deleted) => setGlobalLibraryItemsDeleted(itemIds, deleted));
  h('library:trashImpact', async (_event, itemIds) => previewGlobalLibraryTrash(itemIds));
  h('library:purgeTrash', async (_event, itemIds) => purgeGlobalLibraryTrash(itemIds));
  h('library:auditRecovery', async () => auditGlobalLibraryRecovery());
  h('library:importFiles', async (event, collectionId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: dialogText({ es: 'Importar documentos en la Biblioteca', en: 'Import documents into the Library', fr: 'Importer des documents dans la Bibliothèque', de: 'Dokumente in die Bibliothek importieren', pt: 'Importar documentos para a Biblioteca', 'pt-BR': 'Importar documentos para a Biblioteca', it: 'Importa documenti nella Biblioteca', tr: 'Belgeleri Kütüphaneye aktar', 'zh-CN': '将文档导入文献库' ,
  'zh-TW': '將文件匯入文獻庫',
  ko: "문서를 라이브러리로 가져오기",
  ja: "ドキュメントをライブラリにインポートする", }),
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{
        name: dialogText({ es: 'Documentos compatibles', en: 'Supported documents', fr: 'Documents compatibles', de: 'Unterstützte Dokumente', pt: 'Documentos compatíveis', 'pt-BR': 'Documentos compatíveis', it: 'Documenti compatibili', tr: 'Desteklenen belgeler', 'zh-CN': '支持的文档' ,
  'zh-TW': '支援的文件',
  ko: "지원되는 문서",
  ja: "サポートされているドキュメント", }),
        extensions: ['pdf', 'epub', 'md', 'markdown', 'txt', 'html', 'htm', 'xml', 'jats', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp', 'csv', 'tsv', 'xlsx', 'xls', 'ods', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff'],
      }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? { created: 0, skipped: 0, itemIds: [], warnings: [] } : importGlobalLibraryFiles(selected.filePaths, collectionId);
  });
  h('library:importDroppedFiles', async (_event, filePaths, collectionId) => {
    if (!Array.isArray(filePaths) || filePaths.length > 500 || filePaths.some((entry) => typeof entry !== 'string')) {
      throw new Error('La lista de archivos arrastrados no es válida.');
    }
    return importGlobalLibraryFiles(filePaths, collectionId);
  });
  h('library:importDroppedFilesToVault', async (_event, filePaths, vaultId) => {
    if (!Array.isArray(filePaths) || filePaths.length > 500 || filePaths.some((entry) => typeof entry !== 'string') || typeof vaultId !== 'string') {
      throw new Error('La lista de archivos arrastrados no es válida.');
    }
    return importGlobalLibraryFilesIntoVault(filePaths, vaultId);
  });
  h('library:importBibliography', async (event, collectionId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: dialogText({ es: 'Importar referencias bibliográficas', en: 'Import bibliographic references', fr: 'Importer des références bibliographiques', de: 'Literaturangaben importieren', pt: 'Importar referências bibliográficas', 'pt-BR': 'Importar referências bibliográficas', it: 'Importa riferimenti bibliografici', tr: 'Kaynakça kayıtlarını içe aktar', 'zh-CN': '导入参考文献' ,
  'zh-TW': '匯入參考文獻',
  ko: "참고문헌 가져오기",
  ja: "参考文献のインポート", }),
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'RIS, BibTeX, BibLaTeX, CSL JSON, EndNote, Zotero RDF, CSV o Markdown', extensions: ['ris', 'bib', 'bibtex', 'biblatex', 'json', 'xml', 'rdf', 'csv', 'md', 'markdown'] }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled
      ? { created: 0, updated: 0, duplicates: 0, skipped: 0, itemIds: [], warnings: [] }
      : importGlobalBibliographyFiles(selected.filePaths, collectionId);
  });
  h('library:createItem', async (_event, metadata, collectionIds) => createGlobalLibraryItem(metadata, collectionIds));
  h('library:importIdentifier', async (_event, kind, value, collectionIds) => importGlobalLibraryIdentifier(kind, value, collectionIds));
  h('library:duplicateItem', async (_event, itemId) => duplicateGlobalLibraryItem(itemId));
  h('library:convertItemToNodus', async (_event, itemId) => convertGlobalLibraryItemToNodus(itemId));
  h('library:addAttachments', async (event, itemId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: dialogText({ es: 'Añadir adjuntos a la referencia', en: 'Add attachments to the reference', fr: 'Ajouter des pièces jointes à la référence', de: 'Anhänge zur Literaturangabe hinzufügen', pt: 'Adicionar anexos à referência', 'pt-BR': 'Adicionar anexos à referência', it: 'Aggiungi allegati al riferimento', tr: 'Kaynak kaydına ek dosyalar ekle', 'zh-CN': '为参考文献添加附件' ,
  'zh-TW': '為參考文獻新增附件',
  ko: "참고자료에 첨부파일 추가",
  ja: "参照に添付ファイルを追加する", }), properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: dialogText({ es: 'Documentos, datos e imágenes', en: 'Documents, data and images', fr: 'Documents, données et images', de: 'Dokumente, Daten und Bilder', pt: 'Documentos, dados e imagens', 'pt-BR': 'Documentos, dados e imagens', it: 'Documenti, dati e immagini', tr: 'Belgeler, veriler ve görseller', 'zh-CN': '文档、数据和图片' ,
  'zh-TW': '文件、資料和圖片',
  ko: "문서, 데이터 및 이미지",
  ja: "文書、データ、画像", }), extensions: ['pdf', 'epub', 'md', 'markdown', 'txt', 'html', 'htm', 'xml', 'jats', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp', 'csv', 'tsv', 'xlsx', 'xls', 'ods', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff'] }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? existingItem(itemId) : addGlobalLibraryAttachments(itemId, selected.filePaths);
  });
  h('library:updateAttachment', async (_event, itemId, attachmentId, patch) => updateGlobalLibraryAttachment(itemId, attachmentId, patch));
  h('library:replaceAttachment', async (event, itemId, attachmentId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: dialogText({ es: 'Sustituir adjunto', en: 'Replace attachment', fr: 'Remplacer la pièce jointe', de: 'Anhang ersetzen', pt: 'Substituir anexo', 'pt-BR': 'Substituir anexo', it: 'Sostituisci allegato', tr: 'Ek dosyayı değiştir', 'zh-CN': '替换附件' ,
  'zh-TW': '替換附件',
  ko: "첨부파일 교체",
  ja: "アタッチメントを交換する", }), properties: ['openFile'] as Array<'openFile'> };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? existingItem(itemId) : replaceGlobalLibraryAttachment(itemId, attachmentId, selected.filePaths[0]);
  });
  h('library:removeAttachment', async (_event, itemId, attachmentId) => removeGlobalLibraryAttachment(itemId, attachmentId));
  h('library:openAttachment', async (_event, itemId, attachmentId) => (await openDocumentPath(globalLibraryAttachmentPath(itemId, attachmentId))) === '');
  h('library:revealAttachment', async (_event, itemId, attachmentId) => revealAttachmentInFolder(globalLibraryAttachmentPath(itemId, attachmentId)));
  h('library:upsertNote', async (_event, itemId, note) => upsertGlobalLibraryNote(itemId, note));
  h('library:deleteNote', async (_event, itemId, noteId) => deleteGlobalLibraryNote(itemId, noteId));
  h('library:setRelation', async (_event, itemId, targetItemId, relationType, enabled) => setGlobalLibraryItemRelation(itemId, targetItemId, relationType, enabled));
  h('library:patchTags', async (_event, itemIds, patch) => patchGlobalLibraryItemTags(itemIds, patch));
  h('library:tags', async () => listGlobalLibraryTags());
  h('library:setTagColor', async (_event, tag, color) => setGlobalLibraryTagColor(tag, color));
  h('library:updateMetadata', async (_event, itemId, patch) => updateGlobalLibraryItemMetadata(itemId, patch));
  h('library:resolveMetadata', async (_event, kind, value) => resolveGlobalLibraryMetadata(kind, value));
  h('library:startMetadataBatch', async (event, requestId, itemIds) => startGlobalLibraryMetadataBatch(requestId, itemIds, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('library:metadataBatchProgress', localizedForUi(progress));
  }));
  h('library:applyMetadataBatch', async (_event, requestId, itemIds) => applyGlobalLibraryMetadataBatch(requestId, itemIds));
  h('library:cancelMetadataBatch', async (_event, requestId) => cancelGlobalLibraryMetadataBatch(requestId));
  h('library:updateCitationKey', async (_event, itemId, citationKey) => updateGlobalLibraryCitationKey(itemId, citationKey));
  h('library:citationStyles', async () => listGlobalLibraryCitationStyles());
  h('library:importCitationStyles', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: dialogText({ es: 'Importar estilos CSL', en: 'Import CSL styles', fr: 'Importer des styles CSL', de: 'CSL-Stile importieren', pt: 'Importar estilos CSL', 'pt-BR': 'Importar estilos CSL', it: 'Importa stili CSL', tr: 'CSL stillerini içe aktar', 'zh-CN': '导入CSL样式' ,
  'zh-TW': '匯入CSL樣式',
  ko: "CSL 스타일 가져오기",
  ja: "CSL スタイルをインポートする", }), properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>, filters: [{ name: 'Citation Style Language', extensions: ['csl'] }] };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? { imported: 0, updated: 0, skipped: 0, styles: listGlobalLibraryCitationStyles(), warnings: [] } : importGlobalLibraryCitationStyleFiles(selected.filePaths);
  });
  h('library:importZoteroCitationStyles', async (event) => {
    const automatic = importGlobalLibraryZoteroCitationStyles();
    if (automatic.imported || automatic.updated || !automatic.warnings.length) return automatic;
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: dialogText({ es: 'Seleccionar la carpeta styles de Zotero', en: 'Select the Zotero styles folder', fr: 'Sélectionner le dossier styles de Zotero', de: 'Zotero-Ordner „styles“ auswählen', pt: 'Selecionar a pasta styles do Zotero', 'pt-BR': 'Selecionar a pasta styles do Zotero', it: 'Seleziona la cartella styles di Zotero', tr: 'Zotero styles klasörünü seç', 'zh-CN': '选择Zotero的styles文件夹' ,
  'zh-TW': '選擇Zotero的styles資料夾',
  ko: "Zotero 스타일 폴더를 선택하세요.",
  ja: "Zotero スタイルフォルダーを選択します", }), properties: ['openDirectory'] as Array<'openDirectory'> };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? automatic : importGlobalLibraryZoteroCitationStyles(selected.filePaths);
  });
  h('library:installRepositoryCitationStyle', async (_event, styleId) => installGlobalLibraryRepositoryCitationStyle(styleId));
  h('library:searchRepositoryCitationStyles', async (_event, query, limit) => searchGlobalLibraryRepositoryCitationStyles(String(query ?? ''), Number(limit ?? 80)));
  h('library:removeCitationStyle', async (_event, styleId) => removeGlobalLibraryCitationStyle(styleId));
  h('library:formatCitation', async (_event, itemIds, style, kind, locale) => {
    const result = await formatGlobalLibraryCitation(itemIds, style, kind, locale); clipboard.writeText(result.text); return result;
  });
  h('library:exportBibliography', async (event, request) => {
    const extensions = { ris: 'ris', bibtex: 'bib', biblatex: 'biblatex', 'csl-json': 'json', 'endnote-xml': 'xml', 'zotero-rdf': 'rdf', csv: 'csv', markdown: 'md' } as const;
    const extension = extensions[request.format as keyof typeof extensions]; if (!extension) throw new Error('Formato de exportación no compatible.');
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: dialogText({ es: 'Exportar referencias bibliográficas', en: 'Export bibliographic references', fr: 'Exporter les références bibliographiques', de: 'Literaturangaben exportieren', pt: 'Exportar referências bibliográficas', 'pt-BR': 'Exportar referências bibliográficas', it: 'Esporta riferimenti bibliografici', tr: 'Kaynakça kayıtlarını dışa aktar', 'zh-CN': '导出参考文献' ,
  'zh-TW': '匯出參考文獻',
  ko: "참고문헌 내보내기",
  ja: "参考文献のエクスポート", }), defaultPath: `nodus-library.${extension}`, filters: [{ name: request.format, extensions: [extension] }] };
    const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return { format: request.format, exported: 0, filePath: null, canceled: true, warnings: [] };
    const report = await exportGlobalLibraryBibliography(request, selected.filePath);
    if (!fs.existsSync(selected.filePath)) throw new Error('No se pudo verificar el archivo exportado.');
    return report;
  });
  h('library:duplicates', async () => listGlobalLibraryDuplicates());
  h('library:mergeImpact', async (_event, canonicalId, duplicateIds) => previewGlobalLibraryMerge(canonicalId, duplicateIds));
  h('library:mergeItems', async (_event, canonicalId, duplicateIds) => mergeGlobalLibraryItems(canonicalId, duplicateIds));
  h('library:vaults', async () => listGlobalLibraryVaults());
  h('library:vaultLinks', async (_event, itemId) => listGlobalLibraryVaultLinks(itemId));
  h('library:linkToVault', async (_event, itemIds, vaultId) => linkGlobalLibraryItemsToVault(itemIds, vaultId));
}
