import { searchPrimarySourceHybrid } from '../ai/primarySourceSearch';
// primarySources channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import { dialogTitle } from '../dialogTitles';
import type { IpcContext } from './context';
import type { PrimarySourceBulkPatch, PrimarySourceFileImportInput, PrimarySourceFileMetadataPatch, PrimarySourceExcerptCreateInput, PrimarySourceIngestInput, PrimarySourceAnalysis, PrimarySourceProposalAcceptanceInput, PrimarySourceProposalDecisionInput, PrimarySourceProposalExtractionInput, PrimarySourceNoteLinkInput, PrimarySourceNoteProfilePatch, PrimarySourcePersonFilter, PrimarySourceSearchRequest, PrimarySourceSearchTargetKind, PrimarySourceCitationBuildRequest, PrimarySourceCitationSettings, PrimarySourceExportRequest, PrimarySourcePolicySettingsPatch, PrimarySourceToolkitRequest, PrimarySourceToponymResolutionInput, PrimarySourceTextVersionCreateInput, PrimarySourceUnitCreateInput } from '@shared/primarySourcesTypes';
import type { ArchiveReviewStatus, ArchiveTextStatus } from '@shared/archiveTypes';
import { applyPrimarySourceBulkEdit, createDescriptionOnlyUnit, createDescriptionTemplate, ensurePrimarySourceProjection, getPrimarySourceDossier, getPrimarySourceArchiveWorkspace, previewPrimarySourceBulkEdit, updatePrimarySourceArchiveRecord } from '../db/primarySourcesArchiveRepo';
import { createArchiveFilesFromPaths, getArchiveFile, getArchiveFileBlob, regenerateArchiveThumbnail, reorderArchiveFileGroups, updateArchiveFileMetadata, verifyArchiveItemFiles } from '../db/archiveFilesRepo';
import { recordArchiveAudit } from '../db/archiveAuditRepo';
import { createPrimarySourceTextVersion, setArchiveTextReviewStatus } from '../db/archiveTextsRepo';
import { createStableArchiveExcerpt, savePrimarySourceAnalysis, setArchiveExcerptReviewStatus } from '../db/archiveEvidenceRepo';
import { acceptEntityProposal, decideEntityProposal, revertEntityResolution } from '../db/archiveProposalsRepo';
import { addPrimarySourcePersonVariant, getPrimarySourcePersonDossier, listPrimarySourcePersons, mergePrimarySourcePersons, revertPrimarySourcePersonMerge } from '../db/primarySourcePersonsRepo';
import { getPrimarySourceMapWorkspace, getPrimarySourceRelationsWorkspace, getPrimarySourceTimelineWorkspace, resolvePrimarySourceToponym, revertPrimarySourceToponymResolution } from '../db/primarySourceDerivedViewsRepo';
import { addPrimarySourceNoteLink, createPrimarySourceNote, getPrimarySourceBacklinks, getPrimarySourceNoteWorkspace, getPrimarySourceOperationalDashboard, insertPrimarySourceExcerptCitation, removePrimarySourceNoteLink, updatePrimarySourceNoteProfile } from '../db/primarySourceResearchRepo';
import { getPrimarySourceGovernanceWorkspace, updatePrimarySourceCitationSettings, updatePrimarySourcePolicySettings } from '../db/primarySourceGovernanceRepo';
import { buildPrimarySourceCitation, previewPrimarySourceToolkitOperation, runPrimarySourceToolkitOperation } from '../primarySources/primarySourceGovernance';
import { createPrimarySourceResearchPackage, previewPrimarySourceExport, restorePrimarySourceResearchPackage, validatePrimarySourceResearchPackage } from '../primarySources/primarySourceExport';
import { clearPrimarySourceLocalMetrics, getPrimarySourceLocalMetricSummary, recordPrimarySourceLocalMetric } from '../db/primarySourceMetricsRepo';
import { extractPrimarySourceProposals } from '../ai/primarySourceProposals';
import { createArchiveRepository, createCaptureSession } from '../db/archiveHierarchyRepo';
import path from 'node:path';
import { openDocumentPath } from '../util/openDocument';
import fs from 'node:fs';
import { BrowserWindow, dialog, app } from 'electron';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { createFolder, updateItem } from '../db/archiveRepo';
import { ingestArchiveFile } from '../archive/archiveIngest';
import { embedArchiveBacklog } from '../archive/archiveDiscovery';

export function registerPrimarySourcesIpc({ h, getWindow }: IpcContext): void {
  // ── Primary Sources archival workspace ────────────────────────────────────
  h('primarySources:workspace', async (
    _e,
    search?: string,
    offset?: number,
    limit?: number
  ) => {
    const started = performance.now();
    let success = false;
    try {
      const workspace = getPrimarySourceArchiveWorkspace(search ?? '', offset, limit);
      success = true;
      return workspace;
    } finally {
      recordPrimarySourceLocalMetric(
        search?.trim() ? 'archive_filter' : 'archive_list',
        performance.now() - started,
        limit ?? 200,
        success
      );
    }
  });
  h('primarySources:dossier', async (_e, itemId: string) => {
    const started = performance.now();
    let success = false;
    try {
      const dossier = getPrimarySourceDossier(itemId);
      success = true;
      return dossier;
    } finally {
      recordPrimarySourceLocalMetric('dossier_open', performance.now() - started, 1, success);
    }
  });
  h('primarySources:chooseFiles', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('addPrimarySources', getSettings().uiLanguage),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documentos, imágenes, audio y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'bmp', 'wav', 'mp3', 'm4a', 'mp4', 'mov'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  h('primarySources:ingest', async (_e, input: PrimarySourceIngestInput) => {
    const paths = [...new Set((input.paths ?? []).filter((candidate) => typeof candidate === 'string' && candidate.trim()))];
    if (paths.length === 0) throw new Error('Selecciona al menos un archivo.');
    const settings = getSettings();
    const ocr = {
      enabled: settings.ocrEnabled,
      languages: settings.ocrLanguages,
      maxPages: settings.ocrMaxPages,
    };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    let added = 0;
    let duplicates = 0;
    const rows = [];
    for (const filePath of paths) {
      const result = await ingestArchiveFile(filePath, {
        title: paths.length === 1 ? input.title?.trim() || undefined : undefined,
        tags: input.tags,
        ocr,
        visionModel,
        docType: input.documentType ?? null,
      });
      if (result.duplicate) {
        duplicates += 1;
      } else {
        added += 1;
        updateItem(result.item.itemId, {
          description: input.description?.trim() || result.item.description,
          docType: input.documentType ?? result.item.docType,
          metadata: input.documentMetadata ?? result.item.metadata,
        });
      }
      rows.push(ensurePrimarySourceProjection(result.item.itemId, {
        ...input,
        paths: undefined,
        title: paths.length === 1 && !result.duplicate
          ? input.title
          : result.item.title,
      } as Omit<PrimarySourceIngestInput, 'paths'>));
    }
    void embedArchiveBacklog().catch(() => undefined);
    return { added, duplicates, rows };
  });
  h('primarySources:createUnit', async (_e, input: PrimarySourceUnitCreateInput) =>
    createDescriptionOnlyUnit(input)
  );
  h('primarySources:createRepository', async (
    _e,
    input: Parameters<typeof createArchiveRepository>[0]
  ) => createArchiveRepository(input));
  h('primarySources:createSession', async (
    _e,
    input: Parameters<typeof createCaptureSession>[0]
  ) => createCaptureSession(input));
  h('primarySources:createCollection', async (_e, name: string, parentId?: string | null) =>
    createFolder(name, parentId ?? null)
  );
  h('primarySources:createTemplate', async (
    _e,
    input: Parameters<typeof createDescriptionTemplate>[0]
  ) => createDescriptionTemplate(input));
  h('primarySources:updateRecord', async (
    _e,
    itemId: string,
    input: import('@shared/primarySourcesTypes').PrimarySourceArchiveEditInput
  ) => updatePrimarySourceArchiveRecord(itemId, input));
  h('primarySources:bulkPreview', async (_e, itemIds: string[]) =>
    previewPrimarySourceBulkEdit(itemIds)
  );
  h('primarySources:bulkApply', async (
    _e,
    input: {
      itemIds: string[];
      patch: PrimarySourceBulkPatch;
      expectedRevisions: Record<string, string>;
    }
  ) => applyPrimarySourceBulkEdit(input));
  h('primarySources:files:add', async (_e, input: PrimarySourceFileImportInput) => {
    const added = createArchiveFilesFromPaths(input);
    const dossier = getPrimarySourceDossier(input.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return { added, dossier };
  });
  h('primarySources:files:updateMetadata', async (
    _e,
    fileId: string,
    patch: PrimarySourceFileMetadataPatch
  ) => {
    const file = updateArchiveFileMetadata(fileId, patch);
    const dossier = getPrimarySourceDossier(file.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:files:reorder', async (_e, itemId: string, rootFileIds: string[]) => {
    reorderArchiveFileGroups(itemId, rootFileIds);
    const dossier = getPrimarySourceDossier(itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:files:verifyAll', async (_e, itemId: string) => {
    verifyArchiveItemFiles(itemId);
    const dossier = getPrimarySourceDossier(itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:files:thumbnail', async (_e, parentFileId: string) => {
    const thumbnail = await regenerateArchiveThumbnail(parentFileId);
    const dossier = getPrimarySourceDossier(thumbnail.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:files:save', async (event, fileId: string) => {
    const file = getArchiveFile(fileId);
    const blob = getArchiveFileBlob(fileId);
    if (!file || !blob) throw new Error('El archivo preservado no está disponible.');
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: dialogTitle('savePreservedFileCopy', getSettings().uiLanguage),
      defaultPath: file.originalFileName || `fuente-${file.fileId}`,
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, blob);
    recordArchiveAudit({
      itemId: file.itemId,
      fileId,
      action: 'file_exported',
      createdBy: 'primary_sources_user',
      details: { destinationKind: 'user_selected', byteSize: blob.byteLength },
    });
    return picked.filePath;
  });
  h('primarySources:files:openExternal', async (_e, fileId: string) => {
    const file = getArchiveFile(fileId);
    const blob = getArchiveFileBlob(fileId);
    if (!file || !blob) throw new Error('El archivo preservado no está disponible.');
    const safeName = [...path.basename(file.originalFileName || `fuente-${file.fileId}`)]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? '_' : character;
      })
      .join('');
    const folder = path.join(app.getPath('temp'), 'nodus-primary-sources');
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `${file.contentHash?.slice(0, 12) || file.fileId}-${safeName}`);
    if (!fs.existsSync(target)) fs.writeFileSync(target, blob, { flag: 'wx' });
    const error = await openDocumentPath(target);
    if (error) throw new Error(error);
    recordArchiveAudit({
      itemId: file.itemId,
      fileId,
      action: 'file_opened_external',
      createdBy: 'primary_sources_user',
      details: { temporaryManagedCopy: true },
    });
    return true;
  });
  h('primarySources:text:create', async (
    _e,
    input: PrimarySourceTextVersionCreateInput
  ) => {
    createPrimarySourceTextVersion(input);
    const dossier = getPrimarySourceDossier(input.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:text:review', async (
    _e,
    textVersionId: string,
    status: ArchiveTextStatus
  ) => {
    const version = setArchiveTextReviewStatus(textVersionId, status);
    if (!version) throw new Error('La versión de texto ya no existe.');
    const dossier = getPrimarySourceDossier(version.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:excerpt:create', async (
    _e,
    input: PrimarySourceExcerptCreateInput
  ) => {
    createStableArchiveExcerpt(input);
    const dossier = getPrimarySourceDossier(input.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:excerpt:review', async (
    _e,
    excerptId: string,
    status: ArchiveReviewStatus
  ) => {
    const excerpt = setArchiveExcerptReviewStatus(excerptId, status);
    if (!excerpt) throw new Error('El fragmento ya no existe.');
    const dossier = getPrimarySourceDossier(excerpt.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:analysis:save', async (
    _e,
    itemId: string,
    patch: Partial<Omit<
      PrimarySourceAnalysis,
      'analysisId' | 'itemId' | 'createdAt' | 'updatedAt'
    >>
  ) => {
    savePrimarySourceAnalysis(itemId, patch);
    const dossier = getPrimarySourceDossier(itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:proposals:extract', async (
    _e,
    input: PrimarySourceProposalExtractionInput
  ) => {
    const result = await extractPrimarySourceProposals(input);
    const dossier = getPrimarySourceDossier(input.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return { result, dossier };
  });
  h('primarySources:proposals:accept', async (
    _e,
    proposalId: string,
    input: PrimarySourceProposalAcceptanceInput
  ) => {
    const result = acceptEntityProposal(proposalId, input);
    const dossier = getPrimarySourceDossier(result.proposal.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return { result, dossier };
  });
  h('primarySources:proposals:decide', async (
    _e,
    proposalId: string,
    status: 'rejected' | 'deferred',
    input: PrimarySourceProposalDecisionInput
  ) => {
    const proposal = decideEntityProposal(proposalId, status, input);
    if (!proposal) throw new Error('La propuesta ya no existe.');
    const dossier = getPrimarySourceDossier(proposal.itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:resolutions:revert', async (
    _e,
    itemId: string,
    resolutionId: string
  ) => {
    const resolution = revertEntityResolution(resolutionId, itemId);
    if (!resolution) throw new Error('La resolución ya no existe.');
    const dossier = getPrimarySourceDossier(itemId);
    if (!dossier) throw new Error('La fuente ya no existe.');
    return dossier;
  });
  h('primarySources:persons:list', async (
    _e,
    search?: string,
    filter?: PrimarySourcePersonFilter
  ) => listPrimarySourcePersons({ search, filter }));
  h('primarySources:persons:dossier', async (_e, personId: string) =>
    getPrimarySourcePersonDossier(personId)
  );
  h('primarySources:persons:addVariant', async (
    _e,
    personId: string,
    name: string
  ) => addPrimarySourcePersonVariant(personId, name));
  h('primarySources:persons:merge', async (
    _e,
    input: {
      sourcePersonId: string;
      targetPersonId: string;
      rationale?: string | null;
    }
  ) => mergePrimarySourcePersons(input));
  h('primarySources:persons:revertMerge', async (_e, resolutionId: string) =>
    revertPrimarySourcePersonMerge(resolutionId)
  );
  h('primarySources:timeline:workspace', async () =>
    getPrimarySourceTimelineWorkspace()
  );
  h('primarySources:map:workspace', async () =>
    getPrimarySourceMapWorkspace()
  );
  h('primarySources:map:resolveToponym', async (
    _e,
    input: PrimarySourceToponymResolutionInput
  ) => {
    resolvePrimarySourceToponym(input);
    return getPrimarySourceMapWorkspace();
  });
  h('primarySources:map:revertToponym', async (_e, resolutionId: string) => {
    const resolution = revertPrimarySourceToponymResolution(resolutionId);
    if (!resolution) throw new Error('La resolución geográfica ya no existe.');
    return getPrimarySourceMapWorkspace();
  });
  h('primarySources:relations:workspace', async () =>
    getPrimarySourceRelationsWorkspace()
  );
  h('primarySources:search', async (_e, request: PrimarySourceSearchRequest) => {
    const started = performance.now();
    let success = false;
    try {
      const response = await searchPrimarySourceHybrid(request);
      success = true;
      return response;
    } finally {
      recordPrimarySourceLocalMetric(
        'research_search',
        performance.now() - started,
        request.limit ?? 250,
        success
      );
    }
  });
  h('primarySources:notes:workspace', async () =>
    getPrimarySourceNoteWorkspace()
  );
  h('primarySources:notes:create', async (_e, input: Parameters<typeof createPrimarySourceNote>[0]) =>
    createPrimarySourceNote(input)
  );
  h('primarySources:notes:updateProfile', async (
    _e,
    noteId: string,
    patch: PrimarySourceNoteProfilePatch
  ) => updatePrimarySourceNoteProfile(noteId, patch));
  h('primarySources:notes:addLink', async (_e, input: PrimarySourceNoteLinkInput) =>
    addPrimarySourceNoteLink(input)
  );
  h('primarySources:notes:removeLink', async (_e, linkId: string) =>
    removePrimarySourceNoteLink(linkId)
  );
  h('primarySources:notes:backlinks', async (
    _e,
    targetKind: PrimarySourceSearchTargetKind,
    targetId: string
  ) => getPrimarySourceBacklinks(targetKind, targetId));
  h('primarySources:notes:insertCitation', async (_e, input: PrimarySourceNoteLinkInput) =>
    insertPrimarySourceExcerptCitation(input)
  );
  h('primarySources:dashboard', async () =>
    getPrimarySourceOperationalDashboard()
  );
  h('primarySources:governance:workspace', async () =>
    getPrimarySourceGovernanceWorkspace()
  );
  h('primarySources:governance:updatePolicy', async (
    _e,
    patch: PrimarySourcePolicySettingsPatch
  ) => updatePrimarySourcePolicySettings(patch));
  h('primarySources:governance:updateCitations', async (
    _e,
    patch: Partial<Omit<PrimarySourceCitationSettings, 'updatedAt'>>
  ) => updatePrimarySourceCitationSettings(patch));
  h('primarySources:metrics:summary', async () =>
    getPrimarySourceLocalMetricSummary()
  );
  h('primarySources:metrics:clear', async () => {
    clearPrimarySourceLocalMetrics();
  });
  h('primarySources:toolkit:preview', async (
    _e,
    request: PrimarySourceToolkitRequest
  ) => previewPrimarySourceToolkitOperation(request));
  h('primarySources:toolkit:run', async (
    _e,
    request: PrimarySourceToolkitRequest
  ) => runPrimarySourceToolkitOperation(request));
  h('primarySources:citations:build', async (
    _e,
    request: PrimarySourceCitationBuildRequest
  ) => buildPrimarySourceCitation(request));
  h('primarySources:export:preview', async (
    _e,
    request: PrimarySourceExportRequest
  ) => previewPrimarySourceExport(request));
  h('primarySources:export:package', async (
    event,
    request: PrimarySourceExportRequest
  ) => {
    const started = performance.now();
    let success = false;
    const built = await createPrimarySourceResearchPackage({
      request,
      tempDir: app.getPath('temp'),
      appVersion: app.getVersion(),
    });
    const extension = request.profile === 'inventory'
      ? 'nodus-inventory.zip'
      : 'nodus-research.zip';
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined!, {
      title: dialogTitle('saveResearchPackage', getSettings().uiLanguage),
      defaultPath: `${getActiveVault().name.replace(/[\\/:*?"<>|]/g, '_')}.${extension}`,
      filters: [{ name: 'Paquete de investigación Nodus', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) {
      success = true;
      recordPrimarySourceLocalMetric(
        'package_export',
        performance.now() - started,
        built.manifest.selection.included,
        success
      );
      return {
        canceled: true,
        path: null,
        exportId: built.exportId,
        packageHash: built.packageHash,
        manifest: built.manifest,
      };
    }
    const temporary = `${picked.filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(temporary, built.buffer);
    fs.renameSync(temporary, picked.filePath);
    success = true;
    recordPrimarySourceLocalMetric(
      'package_export',
      performance.now() - started,
      built.manifest.selection.included,
      success
    );
    return {
      canceled: false,
      path: picked.filePath,
      exportId: built.exportId,
      packageHash: built.packageHash,
      manifest: built.manifest,
    };
  });
  h('primarySources:export:validate', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('validateResearchPackage', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: [{ name: 'Paquete de investigación Nodus', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return validatePrimarySourceResearchPackage(fs.readFileSync(picked.filePaths[0]));
  });
  h('primarySources:export:restore', async (_e, name?: string | null) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('restorePackageAsNewVault', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: [{ name: 'Paquete de investigación Nodus', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const started = performance.now();
    let success = false;
    try {
      const restored = await restorePrimarySourceResearchPackage({
        buffer: fs.readFileSync(picked.filePaths[0]),
        tempDir: app.getPath('temp'),
        name,
      });
      success = true;
      return restored;
    } finally {
      recordPrimarySourceLocalMetric('package_restore', performance.now() - started, 1, success);
    }
  });
}
