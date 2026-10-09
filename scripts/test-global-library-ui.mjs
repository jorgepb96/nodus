import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, assertApiMethods, assertChannelsWired } from './ipc-channel-census.mjs';

test('the unified Library keeps the global catalogue independent and the vault corpus available', async () => {
  const [registry, app, vaultTypes] = await Promise.all([
    readSource('src/app/views/corpus.tsx'), readSource('@shell'), readSource('shared/vaultTypes.ts'),
  ]);
  assert.match(registry, /GlobalLibraryView[\s\S]*onOpenSettings/);
  assert.match(registry, /vaultId=\{activeVault\?\.id \?\? null\}/, 'the same screen receives the active vault for its compatibility scope');
  assert.match(app, /const libraryItem = NAV_ITEMS\.find/);
  assert.ok((app.match(/navButton\(libraryItem\)/g) ?? []).length >= 8, 'every dedicated and standard sidebar pins the Library');
  assert.match(vaultTypes, /'prosopSources', 'prosopAnalysis', 'prosopNetworks', 'researchChat', 'library'/, 'prosopography allows the global Library route');
});

test('the Global Library selection bar is one row of icon actions; copy, move and tag open small dialogs', async () => {
  const view = await readSource('src/views/GlobalLibraryView.tsx');
  const start = view.indexOf('data-testid="global-library-bulk-actions"');
  const bar = view.slice(start, view.indexOf('</div>}', start));
  assert.match(bar, /flex-nowrap/, 'the actions share one row');
  assert.doesNotMatch(bar, /<select|<input|<details/, 'no inline selects, tag field or overflow menu');
  for (const action of ['bulk-copy-library-collection', 'bulk-move-library-collection', 'bulk-remove-library-collection', 'bulk-tag-library-items',
    'bulk-resolve-library-metadata', 'bulk-library-citations', 'bulk-add-library-to-vault', 'bulk-rebuild-library-clean', 'bulk-trash-library-items',
    'bulk-restore-library-trash', 'bulk-purge-library-trash', 'bulk-clear-library-selection']) assert.match(bar, new RegExp(`<BulkIconButton testId="${action}"`), action);
  assert.match(view, /function BulkIconButton[\s\S]*?aria-label=\{label\} title=/, 'every icon names itself in its tooltip and accessible name');
  for (const marker of ['library-bulk-collection-dialog', 'library-bulk-collection-target-', 'confirm-library-bulk-collection', 'library-bulk-tag-dialog', 'library-bulk-tag-input', 'confirm-library-bulk-tag'])
    assert.match(view, new RegExp(`data-testid=(?:"|{\`)${marker}`), marker);
});

test('the Library UI exposes hierarchy, search, bulk operations, imports and background state', async () => {
  const workspaceTabs = await readSource('src/components/library/LibraryWorkspaceTabs.tsx');
  const zoteroProgress = await readSource('src/components/ZoteroImportProgressBar.tsx');
  const itemManager = await readSource('src/components/library/LibraryItemManager.tsx');
  const librarySettings = await readSource('src/components/library/LibrarySettingsDialog.tsx');
  const libraryTypes = await readSource('shared/libraryTypes.ts');
  const view = `${await readSource('src/views/GlobalLibraryView.tsx')}\n${zoteroProgress}\n${workspaceTabs}\n${itemManager}\n${librarySettings}\n${await readSource('src/components/library/LibrarySmartSearchDialog.tsx')}\n${await readSource('src/components/library/LibraryMetadataDialogs.tsx')}\n${await readSource('src/components/library/LibraryRecoveryDialogs.tsx')}`;
  const vaultLibrary = await readSource('src/views/Library.tsx');
  const libraryService = await readSource('electron/library/libraryService.ts');
  const appCss = await readSource('src/index.css');
  for (const marker of [
    'global-library-view', 'global-library-search', 'global-library-bulk-actions',
    'global-library-detail', 'zotero-global-import-dialog', 'open-zotero-global-import',
    'library-online-source',
    'import-library-bibliography', 'open-library-duplicates', 'edit-library-metadata',
    'add-library-item-to-vault', 'global-library-vault-dialog',
    'global-library-integrity-warning',
    'create-library-reference', 'library-item-manager', 'library-attachments', 'reveal-library-attachment-',
    'library-notes', 'library-relations', 'library-tag-manager',
    'open-library-migration', 'library-migration-dialog', 'start-library-migration',
    'library-smart-search-dialog', 'smart-search-preview', 'library-table-settings', 'library-table-preferences',
    'zotero-sync-resume', 'resume-zotero-sync',
    'library-source-missing',
    'library-metadata-batch-dialog', 'start-library-metadata-batch', 'apply-library-metadata-batch',
    'library-citation-export-dialog', 'copy-library-citation', 'export-library-bibliography',
    'open-library-trash', 'empty-library-trash', 'library-trash-impact-dialog', 'restore-library-trash', 'purge-library-trash',
    'open-library-recovery', 'library-recovery-dialog', 'rebuild-library-recovery', 'library-merge-impact',
    'library-collection-edit-', 'library-collection-move-', 'library-collection-delete-',
    'library-collection-move-dialog', 'library-collection-move-search', 'library-collection-move-root', 'confirm-library-collection-move',
    'library-collection-style-', 'library-collection-style-dialog', 'library-collection-custom-color', 'save-library-collection-style',
    'library-sidebar-navigation', 'library-collections-pane', 'library-sidebar-section-resizer', 'library-saved-searches-pane',
    'library-add-menu-toggle', 'library-add-menu', 'library-more-menu-toggle', 'library-more-menu',
    'library-detail-primary-action', 'library-detail-actions-toggle', 'library-detail-actions-menu',
    'library-reading-status', 'library-extraction-advanced', 'cancel-library-preparation',
    'library-catalog-scroll',
    'open-global-library-settings', 'global-library-settings-dialog',
    'save-global-library-settings',
  ]) assert.match(view, new RegExp(`data-testid=(?:"|{\`)[^\n]*${marker}`));
  for (const method of [
    'getGlobalLibraryStatus', 'listGlobalLibraryItems', 'listGlobalLibraryCollections',
    'importGlobalLibraryFiles', 'listZoteroImportLibraries', 'importZoteroLibrary',
    'listZoteroSyncSessions', 'resumeZoteroLibraryImport',
    'enqueueLibraryExtraction', 'patchGlobalLibraryItemCollections', 'setGlobalLibraryItemsDeleted',
    'importGlobalBibliographyFiles',
    'createGlobalLibraryItem', 'importGlobalLibraryIdentifier', 'duplicateGlobalLibraryItem', 'convertGlobalLibraryItemToNodus',
    'addGlobalLibraryAttachments', 'updateGlobalLibraryAttachment', 'replaceGlobalLibraryAttachment',
    'removeGlobalLibraryAttachment', 'openGlobalLibraryAttachment', 'revealGlobalLibraryAttachment',
    'upsertGlobalLibraryNote', 'deleteGlobalLibraryNote', 'setGlobalLibraryItemRelation',
    'patchGlobalLibraryItemTags', 'listGlobalLibraryTags', 'setGlobalLibraryTagColor',
    'listGlobalLibraryVaultLinks', 'linkGlobalLibraryItemsToVault',
    'previewLibraryMigration', 'startLibraryMigration', 'resumeLibraryMigration',
    'cancelLibraryMigration', 'rollbackLibraryMigration', 'listLibraryMigrationSessions',
    'listGlobalLibrarySavedSearches', 'saveGlobalLibrarySavedSearch', 'deleteGlobalLibrarySavedSearch',
    'getGlobalLibraryViewPreferences', 'setGlobalLibraryViewPreferences',
    'getGlobalLibrarySettings', 'setGlobalLibrarySettings',
    'startGlobalLibraryMetadataBatch', 'applyGlobalLibraryMetadataBatch', 'cancelGlobalLibraryMetadataBatch',
    'updateGlobalLibraryCitationKey', 'formatGlobalLibraryCitation', 'exportGlobalLibraryBibliography',
    'listGlobalLibraryCitationStyles', 'importGlobalLibraryCitationStyles', 'importZoteroCitationStyles',
    'installGlobalLibraryRepositoryCitationStyle', 'removeGlobalLibraryCitationStyle',
    'previewGlobalLibraryTrash', 'purgeGlobalLibraryTrash', 'auditGlobalLibraryRecovery', 'rebuildGlobalLibrary',
    'previewGlobalLibraryMerge',
  ]) assert.match(view, new RegExp(String.raw`window\.nodus\.${method}\b`));
  assert.match(view, /CollectionBranch[\s\S]*<CollectionBranch/, 'collection rendering is recursively unbounded');
  assert.match(view, /const nextParentId = targetCollection\.id/, 'dropping a collection on another collection nests it directly');
  assert.doesNotMatch(view, /event\.shiftKey \? targetCollection\.id/, 'nesting does not depend on a hidden keyboard modifier');
  assert.match(view, /deleteGlobalLibraryCollection\(current\.id, false\)/, 'deleting a grouping explicitly preserves its items');
  assert.match(view, /collectionSubtreeIds/, 'move and delete actions account for every nested collection');
  assert.match(view, /collectionSearchIds/, 'move search preserves matching collections and their hierarchical ancestors');
  assert.match(view, /COLLECTION_COLOR_PRESETS\.map/, 'collection styling exposes the six predefined colors');
  assert.match(view, /type="color"/, 'collection styling includes a custom native color palette');
  assert.match(view, /role="separator"[\s\S]*aria-orientation="horizontal"/, 'collections and smart searches use an accessible horizontal splitter');
  assert.match(view, /setPointerCapture/, 'the Library navigation splitter supports pointer dragging');
  assert.match(view, /ArrowUp[\s\S]*ArrowDown/, 'the Library navigation splitter supports keyboard resizing');
  assert.match(view, /localStorage\.setItem\(LIBRARY_COLLECTION_PANE_RATIO_KEY/, 'the chosen pane ratio persists locally');
  assert.match(libraryService, /candidate\.metadata\.url \?\? candidate\.sourceUrl/, 'identifier creation retains the canonical source even when the provider metadata omits its URL');
  assert.match(view, /data-testid="open-library-trash"[\s\S]*?<Icon name="folder"/, 'trash is rendered as the final collection-tree folder');
  assert.match(view, /library-trash-folder[\s\S]*aria-current=\{trashMode \? 'page'/, 'the trash folder exposes its selected state');
  assert.match(view, /library-trash-section[\s\S]*h-10 shrink-0[\s\S]*library-trash-folder[\s\S]*h-8/, 'trash uses the same fixed height as the table footer');
  assert.match(view, /library-table-footer[\s\S]*h-10/, 'the table footer exposes its shared height to visual tests');
  assert.match(view, /t\('Añadir'\)[\s\S]*t\('Sincronizar Zotero'\)[\s\S]*open-global-library-settings[\s\S]*library-more-menu-toggle/, 'the main toolbar keeps Add, Zotero sync, Library settings, and the overflow menu together');
  assert.match(itemManager, /h-\[min\(44rem,90vh\)\]/, 'every item-manager tab uses one stable modal height');
  assert.match(itemManager, /const deleteNote = async[\s\S]*await confirm\([\s\S]*danger: true[\s\S]*deleteGlobalLibraryNote/, 'note deletion requires a destructive confirmation before the write');
  assert.match(librarySettings, /DEFAULT_GLOBAL_LIBRARY_SETTINGS[\s\S]*autoRenameAttachments[\s\S]*attachmentRenameTemplate/, 'the settings dialog exposes Zotero-compatible attachment naming defaults');
  assert.match(librarySettings, /testId="library-auto-rename-attachments"/, 'automatic attachment renaming has a stable interactive test hook');
  assert.match(view, /t\('Reconstruir versión limpia'\)/, 'clean Markdown rebuilding is named explicitly');
  assert.match(view, /window\.nodus\.cancelLibraryExtraction/, 'visible background preparation can be canceled');
  assert.match(view, /refreshSelectedLibraryDetail/, 'terminal extraction progress refreshes the selected detail in place');
  assert.match(view, /progress\.status === 'done' \|\| progress\.status === 'failed' \|\| progress\.status === 'canceled'/, 'every terminal extraction state reconciles stale detail state');
  assert.match(view, /detail\.attachments\.length === 0[\s\S]*addGlobalLibraryAttachments/, 'a record without a file exposes Add file as its primary action');
  assert.match(view, /detail\.extraction\?\.status === 'failed'[\s\S]*Intentar de nuevo/, 'a failed preparation exposes a plain-language retry action');
  assert.match(view, /detail\.extraction\?\.status === 'needs-review'[\s\S]*Leer y revisar/, 'reviewable Markdown remains directly readable');
  assert.match(view, /data-testid="library-reading-status"[\s\S]*data-testid="edit-library-metadata"[\s\S]*data-testid="add-library-item-to-vault"[\s\S]*data-testid="library-extraction-advanced"[\s\S]*data-testid="library-online-source"/,
    'the detail header keeps reading state, metadata, vault, technical details, and external source together');
  assert.match(view, /<span\s+data-testid="library-reading-status"[\s\S]*?<span className="sr-only">\{detailReadingLabel\}<\/span>/,
    'the compact reading state remains accessible without becoming a button');
  assert.doesNotMatch(view, /data-testid="edit-library-metadata"[^>]*role="menuitem"/,
    'metadata editing no longer requires the detail overflow menu');
  assert.doesNotMatch(view, />\s*\{t\('Procesar'\)\}\s*</, 'the ambiguous Process action is no longer rendered');
  assert.doesNotMatch(view, /\{!trashMode && <aside/, 'the collection tree remains visible while trash is open');
  assert.match(appCss, /\.library-trash-folder\.is-active[\s\S]*background: rgb\(127 29 29 \/ 0\.32\)/);
  assert.match(appCss, /\.light \.library-trash-folder\.is-active[\s\S]*background: #fee2e2/);
  assert.match(vaultLibrary, /library-active-chip tone-amber/, 'the corpus-health selection uses the semantic amber chip');
  assert.match(appCss, /\.light \.library-active-chip\.tone-amber \{[\s\S]*background-color: #fffbeb;[\s\S]*border-color: #fcd34d;[\s\S]*color: #b45309;/,
    'active corpus-health filters have an explicit light palette');
  assert.match(appCss, /\.library-catalog-scroll::-webkit-scrollbar \{ height: 4px; \}/, 'the catalogue horizontal scrollbar stays visually minimal');
  assert.match(appCss, /\.library-catalog-scroll::-webkit-scrollbar-track \{ background: transparent; \}/, 'the scrollbar does not render a second opaque rail');
  assert.match(view, /className="library-catalog-list[^"]*overflow-x-hidden"/, 'the virtualized rows cannot render a second horizontal scrollbar');
  assert.match(view, /La importación se canceló; el catálogo ya recuperado se conserva/);
  assert.match(view, /Copia de solo lectura: Nodus nunca modifica Zotero/);
  assert.match(view, /includeStandaloneFiles, setIncludeStandaloneFiles\] = useState\(true\)/, 'standalone Zotero files are enabled by default for new imports');
  assert.match(view, /allAvailableSelected[\s\S]*allAvailableSelected \? \{\} : \{ libraryIds:/, 'the default all-libraries UI leaves discovery open so disappeared groups are detected');
  assert.match(view, /inventory:\s*'Inventariando Zotero/, 'Zotero progress exposes the inventory phase');
  assert.match(view, /verification:\s*'Comprobando integridad/, 'Zotero progress exposes the verification phase');
  assert.match(view, /verification\?\.status === 'blocked'/, 'a blocked verification is visible and prevents a success close');
  assert.match(view, /report\?\.partial[\s\S]*report\?\.verification\?\.status === 'blocked'/, 'partial and blocked sessions remain retryable');
  assert.match(view, /zotero-import-verification-blocked/, 'verification mismatches have a strict visible blocking panel');
  assert.match(libraryTypes, /interface ZoteroImportVerification[\s\S]*status: 'passed' \| 'blocked'[\s\S]*expected: ZoteroImportVerificationCounts[\s\S]*imported: ZoteroImportVerificationCounts[\s\S]*mismatches: ZoteroImportVerificationMismatch\[\]/, 'Zotero reports expose a serializable verification contract');
  assert.match(libraryTypes, /verification\?: ZoteroImportVerification/, 'verification remains optional for pre-verification BETA sessions');
  assert.match(libraryTypes, /sourceVersion\?: number[\s\S]*sourceModifiedAt\?: string/, 'attachment provenance retains source version and modification time');
  assert.match(libraryTypes, /accessDate\?: string[\s\S]*zoteroDateAdded\?: string[\s\S]*zoteroDateModified\?: string/, 'Zotero access/add/modified dates are first-class sortable metadata');
  assert.match(view, /column === 'accessDate'[\s\S]*column === 'zoteroDateAdded'[\s\S]*column === 'zoteroDateModified'/, 'source dates are rendered as date columns instead of opaque metadata');
  assert.match(libraryTypes, /interface LibraryNoteRecord[\s\S]*sourceVersion\?: number/, 'mirrored Zotero notes retain source version');
  assert.match(libraryTypes, /attachment-unavailable.*attachment-corrupt.*verification-mismatch.*concurrent-source-change.*storage/, 'Zotero reports support typed integrity and coordination failures');
  assert.match(view, /status\.conflicts > 0 \|\| status\.invalidRecords > 0/);
  assert.match(view, /LibraryDocumentReader/);
  assert.match(view, /onDoubleClick=\{\(event\) => \{ if \(\(event\.target as HTMLElement\)\.closest\('button, input, select, a'\)\) return; if \(item\.readerAvailable \|\| item\.attachmentCount\) void openReader/, 'global rows open the reader on a non-interactive double-click');
  assert.match(view, /column === 'title'[\s\S]*onDoubleClick=\{\(event\)[\s\S]*void openReader\(item\.id\)/, 'double-clicking the global title follows the same reader path');
  assert.match(vaultLibrary, /const openVaultWorkAnalysis = \(work: WorkView\) => setIdeasWork/, 'the vault scope keeps its historical work-analysis entry point');
  assert.match(vaultLibrary, /data-testid=\{`vault-library-item-[\s\S]*onClick=\{\(event\)[\s\S]*openVaultWorkAnalysis\(w\)/, 'clicking a non-interactive part of a vault row opens its analysis modal');
  assert.match(vaultLibrary, /data-testid=\{`vault-library-title-[\s\S]*onClick=\{\(\) => openVaultWorkAnalysis\(w\)\}/, 'clicking a vault work title opens its analysis modal');
  assert.doesNotMatch(vaultLibrary, /data-testid=\{`vault-library-item-[\s\S]*onDoubleClick=\{\(event\)[\s\S]*openReader\(w\)/, 'vault rows never reuse the Global reader gesture');
  assert.match(vaultLibrary, /<RowIconButton[\s\S]{0,240}title=\{t\('Abrir lector limpio'\)\}[\s\S]{0,240}onClick=\{\(\) => openReader\(w\)\}/, 'the clean reader remains available from the vault action column');
  assert.match(view, /data-testid="library-workspace-tabs"/, 'open documents share one compact workspace tab strip');
  assert.match(view, /homeTestId="library-workspace-tab-library"/, 'the Library remains a fixed, non-closable workspace tab');
  assert.match(workspaceTabs, /data-testid=\{homeTestId\}/, 'the shared strip renders that fixed tab, and the Workspace passes its own');
  assert.match(workspaceTabs, /overflow-x: auto|library-workspace-tabs-scroll/, 'document tabs use one horizontally scrollable row');
  assert.match(workspaceTabs, /onAuxClick[\s\S]*event\.button === 1/, 'a document tab supports conventional middle-click closing');
  assert.match(view, /workspaceTabs\.find\(\(tab\) => tab\.key === activeReaderKey\)/, 'only the active document is selected for rendering');
  assert.match(view, /activeReader \? 'hidden' : ''/, 'the catalogue stays mounted behind the active reader');
  assert.match(view, /initialSource=\{activeReader\.sourceId\}/, 'each open tab retains its selected file or clean version');
  assert.match(view, /showLibraryBackButton=\{false\}/, 'the fixed Library tab replaces the duplicated reader back label');
  assert.match(appCss, /\.library-workspace-tabs \{[\s\S]*height: 2\.25rem/, 'the workspace consumes a single low-height row');
  assert.match(appCss, /\.light \.library-workspace-tab\.is-active[\s\S]*background: #ffffff/, 'workspace tabs have an explicit light appearance');
  assert.match(view, /className="library-theme flex/);
  assert.match(view, /className="library-theme-canvas flex/);
  assert.match(view, /className="library-theme-panel/);
});

test('Library file mutations automatically prepare the clean reading version', async () => {
  const [service, operations, extraction] = await Promise.all([
    readSource('electron/library/libraryService.ts'),
    readSource('electron/library/libraryOperations.ts'),
    readSource('electron/library/libraryExtractionEngine.ts'),
  ]);
  assert.match(service, /importGlobalLibraryFiles[\s\S]*current\.extraction\.enqueue\(report\.itemIds\)/,
    'newly imported files enter the extraction queue automatically');
  assert.match(service, /finishItemMutation[\s\S]*freshness === 'queued'[\s\S]*current\.extraction\.enqueue/,
    'added, replaced, or reprioritized primary attachments enter the queue automatically');
  assert.match(operations, /extraction:\s*\{ status: 'pending' \}/,
    'new file-backed records start in a user-visible preparation state');
  assert.match(extraction, /function sourceExtension[\s\S]*decodeURIComponent/,
    'legacy filenames with encoded extensions are recognized without renaming stored files');
});

test('the Library accepts external files at the root or inside an editable collection', async () => {
  const [view, api, preload, ipc, operations] = await Promise.all([
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('shared/api/library.ts'),
    readSource('electron/preload/library.ts'),
    readSource('electron/ipc/library.ts'),
    readSource('electron/library/libraryOperations.ts'),
  ]);
  assert.match(view, /getPathForDroppedFile/,
    'the renderer resolves Electron File handles without exposing raw browser paths');
  assert.match(view, /importDroppedGlobalLibraryFiles/,
    'dropped documents use a dedicated typed import bridge');
  assert.match(view, /dropOnCollection[\s\S]*dataTransfer\.files[\s\S]*targetCollection\.id/,
    'dropping files on an editable collection imports them directly into that collection');
  assert.match(view, /data-testid="library-file-drop-surface"/,
    'the full catalogue is a visible root/selected-collection drop target');
  assert.match(view, /data-testid="library-file-drop-overlay"/,
    'dragging files provides immediate destination feedback');
  assert.match(api, /importDroppedGlobalLibraryFiles\(filePaths: string\[\], collectionId\?: string \| null\)/);
  assert.match(preload, /library:importDroppedFiles/);
  assert.match(ipc, /library:importDroppedFiles/);
  const vaultLibrary = await readSource('src/views/Library.tsx');
  assert.match(vaultLibrary, /data-testid="library-vault-file-drop-surface"/, 'a vault Library also accepts dropped files');
  assert.match(vaultLibrary, /data-testid="library-vault-file-drop-overlay"/);
  assert.match(vaultLibrary, /getPathForDroppedFile[\s\S]*importDroppedFilesIntoVault/,
    'files dropped on a vault go to the Global Library and are used in that vault in one step');
  assert.match(api, /importDroppedFilesIntoVault\(filePaths: string\[\], vaultId: string\)/);
  assert.match(preload, /library:importDroppedFilesToVault/);
  assert.match(ipc, /library:importDroppedFilesToVault/);
  assert.match(operations, /inferredLocalFileMetadata[\s\S]*yearMatch[\s\S]*isbnMatch[\s\S]*doiMatch/,
    'filename inference supplies editable title, date, ISBN, and DOI candidates without network blocking');
});

test('global Library rows expose a compact Nodus context menu', async () => {
  const view = await readSource('src/views/GlobalLibraryView.tsx');
  assert.match(view, /onContextMenu=/);
  for (const marker of [
    'library-item-context-menu', 'context-read-library-item', 'context-open-original', 'context-reveal-library-attachment',
    'context-edit-library-metadata', 'context-manage-library-attachments',
    'context-manage-library-notes', 'context-cite-library-item',
    'context-duplicate-library-item', 'context-trash-library-item',
  ]) assert.match(view, new RegExp(marker));
});

test('both Library reveal actions use Finder native reveal on macOS', async () => {
  const [view, itemManager, ipc] = await Promise.all([
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/components/library/LibraryItemManager.tsx'),
    readSource('electron/ipc/library.ts'),
  ]);
  assert.match(view, /context-reveal-library-attachment[\s\S]*revealContextOriginal/,
    'the row context menu keeps its reveal action wired');
  assert.match(view, /revealContextOriginal[\s\S]*revealGlobalLibraryAttachment/,
    'the context action resolves the original attachment through the shared bridge');
  assert.match(itemManager, /reveal-library-attachment-[\s\S]*revealGlobalLibraryAttachment/,
    'the attachment manager uses the same shared bridge');
  assert.match(ipc, /process\.platform === 'darwin'[\s\S]*\/usr\/bin\/open[\s\S]*\['-R', filePath\]/,
    'macOS delegates selection to Finder instead of relying on Electron\'s silent API');
  assert.match(ipc, /shell\.openPath\(path\.dirname\(filePath\)\)/,
    'a failed native selection still opens the containing folder');
});

test('opening an unprepared document routes short and long reading jobs without blocking the renderer', async () => {
  const [view, service, worker, queue, api] = await Promise.all([
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('electron/library/libraryService.ts'),
    readSource('electron/workers/libraryOperationWorker.ts'),
    readSource('electron/library/libraryExtractionQueue.ts'),
    readSource('shared/api/library.ts'),
  ]);
  assert.match(api, /prepareGlobalLibraryReading/);
  assert.match(service, /SHORT_READING_PAGE_LIMIT\s*=\s*50/);
  assert.match(service, /runLibraryOperationInWorker[\s\S]*probe-reading/,
    'page probing runs away from the Electron main thread');
  assert.match(worker, /PDFDocument[\s\S]*getPageCount/,
    'PDF length uses the actual page tree rather than file-size guessing');
  assert.match(queue, /priority > active\.priority[\s\S]*putExtractionJob/,
    'opening a queued short document promotes it ahead of passive background work');
  assert.match(view, /data-testid="library-foreground-preparation"/,
    'short-document preparation has one compact progress strip');
  assert.match(view, /plan\.action === 'queue-and-open-original'[\s\S]*openReaderReference\(item, 'original'\)/,
    'long documents immediately open their preserved original while extraction continues');
  assert.match(view, /progress\.status === 'done'[\s\S]*preferredSource: 'clean'/,
    'a short document opens its clean version when foreground preparation finishes');
});

test('vault Library does not duplicate status operations in its header', async () => {
  const view = await readSource('src/views/Library.tsx');
  assert.doesNotMatch(view, /advancedOpen/);
  assert.doesNotMatch(view, /<OperationCard/);
  assert.match(view, /<WorkStatusModal/,
    'per-work processing remains available from the Status column');
});

test('the global reader exposes annotations, metadata, chat and native attachment viewers', async () => {
  const [readerSource, attachmentViewer, findSource, selectionSource, markdownSource, selectionCss, appCss, store, protocol, main, html] = await Promise.all([
    readSource('src/views/LibraryDocumentReader.tsx'), readSource('src/components/library/LibraryAttachmentViewer.tsx'),
    readSource('src/components/FindInPage.tsx'),
    readSource('src/components/ReaderSelectionActions.tsx'),
    readSource('src/components/Markdown.tsx'),
    readSource('src/components/readerSelectionActions.css'), readSource('src/index.css'),
    readSource('electron/libraryReader/libraryReaderStore.ts'), readSource('electron/libraryProtocol.ts'), readSource('electron/main.ts'), readSource('index.html'),
  ]);
  const reader = `${readerSource}\n${attachmentViewer}\n${findSource}`;
  for (const marker of [
    'library-reader-document', 'library-reader-outline-toggle', 'library-reader-sidebar-toggle',
    'library-reader-sidebar', 'library-reader-metadata', 'library-reader-chat', 'library-original-preview',
    'library-reader-source-picker', 'library-reader-pdf-viewer', 'library-reader-epub-viewer',
    'library-reader-pdf-view-single', 'library-reader-pdf-view-continuous',
    'library-reader-image-viewer', 'library-reader-text-viewer', 'library-reader-open-external',
    'library-reader-files-toggle', 'library-reader-chat-model',
    'library-reader-format-dialog', 'library-reader-format-clean', 'library-reader-format-original',
    'library-reader-format-remember', 'library-reader-reset-format-preference',
    'library-reader-online-source', 'find-in-page', 'find-in-page-input',
    'find-option-mark-all', 'find-option-case', 'find-option-whole',
  ]) assert.match(reader, new RegExp(marker));
  assert.match(reader, /aria-expanded=\{outlineOpen\}/);
  assert.match(reader, /aria-expanded=\{notesOpen\}/);
  assert.match(reader, /data-testid="library-reader-bookmark-menu"/);
  assert.match(reader, /data-testid="library-reader-open-chat"/);
  assert.match(reader, /aria-haspopup="menu"/);
  assert.match(reader, /role="menuitem"/);
  assert.match(reader, /library-reader-sidebar-tab-/);
  assert.match(attachmentViewer, /key=\{`\$\{number\}:\$\{scale\}:\$\{viewMode\}`\}/,
    'every PDF page and scale owns a fresh canvas lifecycle');
  assert.match(attachmentViewer, /renderTask\?\.cancel\(\)/,
    'in-flight PDF renders are cancelled when their canvas unmounts');
  assert.match(attachmentViewer, /attachmentSessionNumber[\s\S]*writeAttachmentSessionNumber/, 'PDF and EPUB positions survive switching document tabs');
  assert.match(attachmentViewer, /'page', pageNumber[\s\S]*'scale', scale/, 'PDF page and zoom are restored per document attachment');
  assert.match(attachmentViewer, /'chapter', chapterIndex/, 'EPUB chapter position is restored per document attachment');
  assert.match(attachmentViewer, /data-library-pdf-page=\{pageNumber\}/,
    'continuous mode exposes stable page targets');
  assert.match(selectionSource, /READER_HIGHLIGHTS_BY_CONTEXT/,
    'annotations from multiple visible PDF pages share the CSS Highlight registry');
  assert.match(reader, /selected && <span/);
  assert.match(reader, /t\('Info'\)/);
  assert.match(reader, /OriginalPagePreview/);
  assert.match(reader, /TextLayer/);
  assert.match(reader, /attachment:/);
  assert.match(reader, /target:\s*\{\s*type:\s*'region'/);
  assert.match(reader, /ReaderSelectionActions/);
  assert.match(readerSource, /selectedSource === 'clean' && <FindInPage targetRef=\{documentRef\}/, 'clean Markdown owns the document-wide find panel');
  assert.match(attachmentViewer, /loadFindSegments[\s\S]*pdf\.numPages[\s\S]*getTextContent/, 'PDF search lazily indexes every page');
  assert.match(attachmentViewer, /pageIndex % 4 === 0[\s\S]*setTimeout/, 'long PDF indexing yields to the renderer');
  assert.match(attachmentViewer, /content\.chapters\.map\(\(chapter\) => \(\{ id: chapter\.id, text: chapter\.text/ , 'EPUB search indexes every chapter');
  assert.match(attachmentViewer, /FindInPage targetRef=\{targetRef\} segments=\{findSegments\}/, 'reflowable readers use the segmented document index');
  assert.match(attachmentViewer, /library-reader-image-viewer[\s\S]*FindInPage[\s\S]*Markdown limpio para buscar el OCR/, 'image files still open the find panel and explain their missing text layer');
  assert.match(findSource, /event\.metaKey \|\| event\.ctrlKey[\s\S]*key\.toLowerCase\(\) === 'f'/, 'Cmd/Ctrl+F always opens the Nodus document search');
  assert.match(findSource, /caseSensitive[\s\S]*wholeWord[\s\S]*markAll/, 'document search exposes case, whole-term, and visible-match controls');
  assert.match(findSource, /activeSegmentId[\s\S]*onActivateSegment/, 'segmented results navigate to their PDF page or EPUB chapter');
  assert.match(appCss, /\.library-document-reader:has\(\.library-reader-notes\) \.find-in-page-panel\[data-find-placement="reader"\][\s\S]*right: 21\.75rem/, 'wide root-level reader search stays clear of the notes and chat rail');
  assert.match(attachmentViewer, /placement="surface"/, 'reflowable attachment search is anchored inside its own reading surface');
  assert.match(readerSource, /className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="library-reader-layout"/, 'the reader owns a width-constrained viewport instead of growing with a zoomed attachment');
  assert.match(attachmentViewer, /className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="library-reader-pdf-viewer"/, 'PDF pages scroll inside their viewer and cannot push the right rail away');
  assert.match(attachmentViewer, /className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid=\{isEpub \? 'library-reader-epub-viewer' : 'library-reader-text-viewer'\}/, 'reflowable and office viewers share the constrained attachment shell');
  assert.match(selectionSource, /MutationObserver[\s\S]*setContentRevision[\s\S]*contentRevision/, 'annotations rebuild their live ranges when a viewer replaces its text nodes');
  assert.match(attachmentViewer, /renderTask\?\.cancel\(\)/, 'superseded PDF zoom renders are cancelled before they can overwrite the current page');
  assert.match(reader, /libraryReaderChatStream/);
  assert.match(reader, /sourceId: selectedSource/);
  assert.match(reader, /model: chatModel/);
  assert.match(reader, /ModelPicker/);
  // The chat answers route reader links through a stable callback that calls openReaderCitation.
  assert.match(reader, /onReaderCitation={chatReaderCitation}/);
  assert.match(reader, /chatReaderCitation = useCallback\(\(target: MarkdownReaderCitation\) => openReaderCitationRef\.current\(target\), \[\]\)/);
  assert.match(reader, /openReaderCitationRef\.current = openReaderCitation;/);
  assert.match(reader, /library-reader-chat-input/);
  assert.match(reader, /data-testid="library-reader-empty-card"/);
  assert.match(reader, /library-reader-empty-icon/);
  assert.match(reader, /input input-with-leading-icon/);
  assert.match(reader, /data-source-kind=\{sourceKind\}/);
  assert.match(reader, /library-reader-source-badge is-/);
  assert.match(reader, /library-reader-file-option/);
  assert.match(readerSource, /READER_OPENING_FORMAT_KEY = 'nodus\.libraryReader\.openingFormat'/, 'the remembered opening format has one explicit cross-library preference');
  assert.match(readerSource, /preferred === 'clean'[\s\S]*preferred === 'original'[\s\S]*setOpeningFormatPrompt\(true\)/, 'the reader applies a saved preference or asks when both formats are available');
  assert.match(readerSource, /primaryOriginalAttachment\(reader\)/, 'the original choice resolves the preserved primary file rather than an arbitrary supplement');
  assert.match(readerSource, /writeOpeningFormatPreference\(null\)/, 'users can restore the opening question');
  assert.match(selectionCss, /\.light \.reader-highlighter-palette button:hover,[\s\S]*background: #eef2ff; color: #4338ca;/);
  assert.match(appCss, /\.light \.library-reader-source-badge\.is-original[\s\S]*background: #ffffff;[\s\S]*color: #52525b;/);
  assert.match(appCss, /\.light \.library-reader-file-option\.is-active \{ background: #eef2ff; color: #4338ca; \}/);
  assert.match(readerSource, /library-reader-outline-section[\s\S]*index === activeSection \? 'is-active' : ''/, 'outline rows use semantic interaction states instead of dark-only hover utilities');
  assert.match(appCss, /\.light \.library-theme \.library-reader-outline-section:hover,[\s\S]*background: #f4f4f5; color: #27272a;/, 'light outline hover text has strong contrast against its surface');
  assert.match(appCss, /\.light \.library-theme \.library-reader-outline-section\.is-active \{ background: #e0e7ff; color: #4338ca; \}/, 'the current outline section remains distinguishable in light mode');
  assert.match(appCss, /@media \(max-width: 1279px\)[\s\S]*?\.library-reader-notes \{ background-color: #09090b; \}[\s\S]*?\.light \.library-theme \.library-reader-notes \{ background-color: #ffffff; \}/, 'overlay reader rails are opaque in dark and light themes');
  assert.match(appCss, /\.library-reader-document \.md p \{[\s\S]*text-align: justify;[\s\S]*text-indent: 1\.5em;/, 'clean prose is justified with a first-line indent');
  assert.match(appCss, /\.library-reader-document \.md blockquote \{[\s\S]*margin: 1\.4em 2em;/, 'standalone quotations are visibly inset');
  assert.match(markdownSource, /href\.startsWith\('#'\)/, 'local note and bibliography anchors never leave the reader');
  assert.match(markdownSource, /internalBackTargets/, 'end references can return to the last in-text citation');
  assert.match(markdownSource, /nodus-reference-/, 'numbered bibliography entries receive stable document anchors');
  assert.match(store, /function globalDocument/);
  assert.match(store, /nodus-library:\/\/original/);
  assert.match(store, /nodus-library:\/\/attachment/);
  assert.match(store, /application\/epub\+zip/);
  assert.match(store, /getLibraryReaderAttachmentContent/);
  assert.match(attachmentViewer, /getLibraryReaderAttachmentBytes\(props\.documentId, attachment\.id\)/, 'PDF bytes cross the validated reader bridge instead of a custom-scheme network request');
  assert.match(attachmentViewer, /getDocument\(\{ data \}\)/, 'PDF.js receives local bytes so custom-scheme status 0 cannot abort the reader');
  assert.doesNotMatch(attachmentViewer, /getDocument\(\{ url: attachment\.url \}\)/, 'the attachment viewer never gives the custom URL to PDF.js XHR');
  assert.match(store, /fs\.promises\.readFile\(task\.file\)/, 'the PDF is read asynchronously so disk I/O does not block Electron main');
  const chat = await readSource('electron/ai/libraryReaderChat.ts');
  assert.match(chat, /getLibraryReaderAttachmentContent/);
  assert.match(chat, /extractFromPath/);
  assert.match(chat, /contextSourceId/);
  assert.match(chat, /streamNodiChat/);
  assert.match(chat, /contexts: \['current_view', 'vault'\]/);
  assert.match(chat, /readerGrounding/);
  assert.match(protocol, /Accept-Ranges/);
  assert.match(main, /registerLibrarySchemePrivileges/);
  assert.match(main, /registerLibraryProtocol/);
  assert.match(html, /connect-src[^"]*nodus-library:/);
});

test('citation UI searches installed and official CSL styles without punctuation-sensitive matching', async () => {
  const [dialogs, picker, manager, api, addinHtml, addinReferences] = await Promise.all([
    readSource('src/components/library/LibraryMetadataDialogs.tsx'),
    readSource('src/components/library/CitationStylePicker.tsx'),
    readSource('electron/library/libraryCslStyles.ts'),
    readSource('shared/api/library.ts'),
    readSource('word-addin/taskpane.html'),
    readSource('word-addin/references.js'),
  ]);
  for (const marker of [
    'library-citation-style-manager', 'library-installed-style-search',
    'library-citation-style-list', 'import-library-csl', 'import-zotero-csl',
    'browse-csl-repository', 'library-csl-repository-search',
  ]) assert.match(dialogs, new RegExp(marker));
  assert.match(dialogs, /max-h-72 overflow-y-auto/, 'installed styles have an independent scrollable list');
  assert.match(dialogs, /input input-with-leading-icon w-full/, 'the manager search reserves space for its icon');
  assert.match(picker, /normalize\('NFKD'\)/);
  assert.match(picker, /replace\(\/\[\^a-z0-9\]\+\/g, ' '\)/, 'hyphens and punctuation normalize to spaces');
  assert.match(picker, /tokens\.every/, 'multi-token searches can match non-contiguous words');
  assert.match(dialogs, /listGlobalLibraryCitationStyles/);
  assert.match(manager, /citation-style-language\/styles/);
  assert.match(manager, /raw\.githubusercontent\.com/);
  assert.match(manager, /searchRepositoryCitationStyles/);
  assert.match(manager, /CC BY-SA 3\.0/);
  assert.match(manager, /@citation-js\/plugin-csl/);
  assert.match(api, /importGlobalLibraryCitationStyles/);
  assert.match(api, /importZoteroCitationStyles/);
  assert.match(api, /searchGlobalLibraryRepositoryCitationStyles/);
  assert.match(addinHtml, /id="referenceStyleSearch"/);
  assert.match(addinReferences, /normalizeStyleSearch/);
  assert.match(addinReferences, /renderStyleOptions/);
});

test('the typed bridge covers every global management operation', async () => {
  const methods = [
    'listGlobalLibraryCollections', 'getGlobalLibraryItem', 'createGlobalLibraryCollection',
    'updateGlobalLibraryCollection', 'deleteGlobalLibraryCollection', 'patchGlobalLibraryItemCollections',
    'setGlobalLibraryItemsDeleted', 'importGlobalLibraryFiles', 'importDroppedGlobalLibraryFiles', 'importDroppedFilesIntoVault',
    'prepareGlobalLibraryReading',
    'importGlobalBibliographyFiles', 'updateGlobalLibraryItemMetadata', 'resolveGlobalLibraryMetadata',
    'createGlobalLibraryItem', 'importGlobalLibraryIdentifier', 'duplicateGlobalLibraryItem', 'convertGlobalLibraryItemToNodus',
    'addGlobalLibraryAttachments', 'updateGlobalLibraryAttachment', 'replaceGlobalLibraryAttachment',
    'removeGlobalLibraryAttachment', 'openGlobalLibraryAttachment', 'revealGlobalLibraryAttachment',
    'upsertGlobalLibraryNote', 'deleteGlobalLibraryNote', 'setGlobalLibraryItemRelation',
    'patchGlobalLibraryItemTags', 'listGlobalLibraryTags', 'setGlobalLibraryTagColor',
    'listGlobalLibraryDuplicates', 'mergeGlobalLibraryItems',
    'listGlobalLibraryVaults', 'listGlobalLibraryVaultLinks', 'linkGlobalLibraryItemsToVault',
    'previewLibraryMigration', 'startLibraryMigration', 'resumeLibraryMigration',
    'cancelLibraryMigration', 'rollbackLibraryMigration', 'listLibraryMigrationSessions',
    'listGlobalLibrarySavedSearches', 'saveGlobalLibrarySavedSearch', 'deleteGlobalLibrarySavedSearch',
    'getGlobalLibraryViewPreferences', 'setGlobalLibraryViewPreferences',
    'getGlobalLibrarySettings', 'setGlobalLibrarySettings',
    'listZoteroSyncSessions', 'resumeZoteroLibraryImport',
    'startGlobalLibraryMetadataBatch', 'applyGlobalLibraryMetadataBatch', 'cancelGlobalLibraryMetadataBatch',
    'updateGlobalLibraryCitationKey', 'formatGlobalLibraryCitation', 'exportGlobalLibraryBibliography',
    'searchGlobalLibraryRepositoryCitationStyles',
    'previewGlobalLibraryTrash', 'purgeGlobalLibraryTrash', 'auditGlobalLibraryRecovery',
    'previewGlobalLibraryMerge',
  ];
  assertApiMethods(assert, methods);
  assertChannelsWired(assert, [
    'library:collections', 'library:item', 'library:createCollection', 'library:updateCollection',
    'library:deleteCollection', 'library:patchItemCollections', 'library:setItemsDeleted', 'library:importFiles', 'library:importDroppedFiles', 'library:importDroppedFilesToVault',
    'library:prepareReading',
    'library:createItem', 'library:duplicateItem', 'library:convertItemToNodus',
    'library:addAttachments', 'library:updateAttachment', 'library:replaceAttachment', 'library:removeAttachment',
    'library:openAttachment', 'library:revealAttachment', 'library:upsertNote', 'library:deleteNote',
    'library:setRelation', 'library:patchTags', 'library:tags', 'library:setTagColor',
    'library:importBibliography', 'library:updateMetadata', 'library:resolveMetadata', 'library:duplicates', 'library:mergeItems',
    'library:vaults', 'library:vaultLinks', 'library:linkToVault',
    'library:migrationPreview', 'library:startMigration', 'library:resumeMigration',
    'library:cancelMigration', 'library:rollbackMigration', 'library:migrationSessions',
    'library:savedSearches', 'library:saveSavedSearch', 'library:deleteSavedSearch',
    'library:viewPreferences', 'library:setViewPreferences',
    'library:settings', 'library:setSettings',
    'library:zoteroSyncSessions', 'library:resumeZoteroImport',
    'library:startMetadataBatch', 'library:applyMetadataBatch', 'library:cancelMetadataBatch',
    'library:updateCitationKey', 'library:formatCitation', 'library:exportBibliography',
    'library:citationStyles', 'library:importCitationStyles', 'library:importZoteroCitationStyles',
    'library:installRepositoryCitationStyle', 'library:removeCitationStyle',
    'library:searchRepositoryCitationStyles',
    'library:trashImpact', 'library:purgeTrash', 'library:auditRecovery', 'library:mergeImpact',
  ]);
});

test('reader chat uses the shared AI engine and persists beside the document', async () => {
  const [ai, ipc, preload, types, store] = await Promise.all([
    readSource('electron/ai/libraryReaderChat.ts'), readSource('electron/ipc/academic.ts'),
    readSource('electron/preload/academic.ts'), readSource('shared/api/academic.ts'),
    readSource('electron/libraryReader/libraryReaderStore.ts'),
  ]);
  assert.match(ai, /streamNodiChat/);
  assert.match(ai, /settings\.nodiModel \?\? settings\.chatModel/);
  assert.match(ai, /listLibraryReaderAnnotations/);
  assert.match(ai, /contexts: \['current_view', 'vault'\]/);
  assert.match(ai, /nodus:\/\/reader/);
  assert.match(ipc, /libraryReader:chat:stream/);
  assert.match(preload, /libraryReaderChatStream/);
  assert.match(types, /libraryReaderChatStream/);
  assert.match(store, /chat\.json/);
});

test('Zotero bridge exposes import, status and clean-reader navigation', async () => {
  const [server, sidebar] = await Promise.all([
    readSource('electron/zotero-plugin/server.ts'), readSource('zotero-plugin/content/sidebar.js'),
  ]);
  for (const route of ['/api/z/library/status', '/api/z/library/import', '/api/z/library/open']) assert.match(server, new RegExp(route));
  assert.match(server, /startZoteroLibraryImport/);
  assert.match(sidebar, /renderLibraryActions/);
  assert.match(sidebar, /library\.open/);
  assert.match(server, /ZOTERO_PLUGIN_PROTOCOL_VERSION = 4/);
  assert.match(server, /minimumPluginProtocol/);
  assert.match(server, /librarySyncV2: true/);
  assert.match(server, /lastClientProtocol < ZOTERO_PLUGIN_PROTOCOL_VERSION/);
  assert.match(sidebar, /X-Nodus-Zotero-Protocol": "4"/);
  assert.match(sidebar, /serverInfo\.capabilities\.globalLibrary/,
    'plugin v4 hides global-Library actions when a v3 desktop does not advertise them');
});

test('metadata management keeps editing focused, supports bulk confirmation and requires an explicit duplicate merge', async () => {
  const dialogs = await readSource('src/components/library/LibraryMetadataDialogs.tsx');
  const picker = await readSource('src/components/library/CitationStylePicker.tsx');
  for (const marker of ['library-metadata-editor', 'library-metadata-batch-dialog', 'library-citation-export-dialog', 'library-duplicates-dialog']) assert.match(dialogs, new RegExp(marker));
  assert.match(dialogs, /updateGlobalLibraryItemMetadata/);
  assert.doesNotMatch(dialogs, /Buscar por identificador/, 'the metadata editor no longer wastes space on an identifier lookup sidebar');
  assert.match(dialogs, /md:grid-cols-\[7rem_7rem_minmax\(0,1fr\)_minmax\(0,1fr\)_5\.5rem\]/,
    'creator rows use compact fluid name columns without forcing horizontal overflow');
  assert.match(dialogs, /overflow-x-hidden overflow-y-auto/, 'the editor constrains horizontal overflow while keeping the form scrollable');
  assert.match(dialogs, /importGlobalLibraryIdentifier/);
  assert.match(dialogs, /Buscando metadatos y texto completo/);
  assert.match(dialogs, /onGlobalLibraryMetadataBatchProgress/);
  assert.match(dialogs, /formatGlobalLibraryCitation/);
  assert.match(dialogs, /<CitationStylePicker styles=\{styles\}/, 'the citation chooser receives the installed CSL catalogue');
  assert.match(picker, /filtered\.map\(\(entry\)/, 'the searchable citation chooser renders its filtered catalogue');
  assert.match(dialogs, /'endnote-xml'[^\n]*'zotero-rdf'[^\n]*'csv'[^\n]*'markdown'/);
  assert.match(dialogs, /mergeGlobalLibraryItems/);
  assert.match(dialogs, /Las obras de vault permanecen separadas/);
  assert.match(dialogs, /previewGlobalLibraryMerge/);
});

test('the add-to-vault dialog stays a bounded panel with a searchable, badged vault list', async () => {
  const view = await readSource('src/views/GlobalLibraryView.tsx');
  const dialog = view.slice(view.indexOf('function VaultLinkDialog'), view.indexOf('/** A connected vault only for reading'));
  assert.ok(dialog.length > 0, 'the add-to-vault dialog is still defined in the global Library view');
  // Unbounded, the list stretched the panel to the window height on accounts with
  // many vaults; the panel is capped and its body owns the scroll instead.
  assert.match(dialog, /max-h-\[min\(86vh,620px\)\][^"]*flex-col/, 'the panel keeps a rectangular, height-capped shape');
  assert.match(dialog, /min-h-0 flex-1 overflow-y-auto/, 'the vault list scrolls inside the panel');
  assert.match(dialog, /data-testid="global-library-vault-search"/, 'the vault list is searchable');
  assert.match(dialog, /shownVaults\.map/, 'the rendered list is the filtered one');
  assert.match(dialog, /t\('Sin coincidencias\.'\)/, 'an empty search result is stated instead of showing a blank list');
  // Each vault carries its own mode identity: glyph, accent colour, phase tag and origin.
  assert.match(dialog, /backgroundColor: accent/, 'every vault is drawn with its type colour');
  assert.match(dialog, /<Icon name=\{vaultTypeIcon\(vault\.type\)\}/, 'every vault is drawn with its type glyph');
  assert.match(dialog, /vaultTypeLabel\(vault\.type\)/, 'every vault is labelled by its type');
  assert.match(dialog, /VaultPhaseBadge phase=\{phase\} compact/, 'beta/alpha vaults keep their phase tag');
  assert.match(dialog, /isPreviewVaultType\(vault\.type\)/, 'preview vaults keep their tag');
  assert.match(dialog, /isReadOnlyVault\(vault\)/, 'read-only connected vaults remain listed but unselectable');
  assert.match(dialog, /data-testid="confirm-global-library-vault-link"/, 'the confirm action stays addressable by the e2e flow');
});
