// databases channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import { dialogTitle } from '../dialogTitles';
import type { IpcContext } from './context';
import crypto from 'node:crypto';
import { withVaultDatabase } from '../db/database';
import { mobileDatabaseResearchCatalogue } from '../desktopBridge/databaseResearchCatalogue';
import {mobileDatabaseResearchReader} from '../desktopBridge/databaseResearchReading';
import * as dbMode from '../db/databasesRepo';
import * as taskMode from '../db/databaseTasksRepo';
import * as automationMode from '../db/databaseAutomationsRepo';
import * as databaseChatHistory from '../db/databaseChatRepo';
import { runAiCell, runAiColumn } from '../ai/databaseAiColumn';
import { runAiImageCell, runAiImageColumn } from '../ai/databaseAiImageColumn';
import { getDatabaseProfile, generateAnalysisReport, suggestDatabaseAnalyses, runDatabaseAnalysis, narrateAnalysisResult } from '../ai/databaseAnalysis';
import type { AnalysisRequest, AnalysisResult } from '@shared/analysisSpec';
import { streamDatabaseChat, DatabaseChatRequest } from '../ai/databaseChat';
import { databaseExportDescriptor, exportDatabaseToFile } from '../export/databaseExport';
import type { ExportFormat } from '@shared/databaseExport';
import { parseCsv, detectDelimiter } from '../extraction/tabular';
import { buildCsvImportPlan } from '@shared/databaseCsv';
import { matchFilesToRows, codeTemplateToRegex, BulkAttachOptions } from '@shared/databaseBulk';
import { makeThumbnail } from '../db/attachmentThumb';
import { yieldToEventLoop, YIELD_EVERY } from '../util/async';
import type { DatabaseColumnConfig, DatabaseColumnType, DatabaseSelectOption, RelationTargetKind } from '@shared/databases';
import type { SavedViewInput, SavedViewPatch } from '@shared/databaseFilters';
import type { DatabaseRowQuery, DatabaseRowSearchQuery } from '@shared/databaseQuery';
import type { DatabaseAggregateQuery, DatabaseBulkEditInput } from '@shared/databaseTableOps';
import type { DatabaseTemporalQuery, DatabaseTemporalRangeUpdate } from '@shared/databaseTemporal';
import type { DatabaseChartExportInput, DatabaseChartQuery, DatabaseFeedQuery, DatabaseMapQuery } from '@shared/databaseVisualization';
import type { AttachDatabaseViewSourceInput, DatabaseContainerRowQuery } from '@shared/databaseSources';
import type { CreateDatabaseRowTemplateInput, DatabaseDuplicateRowInput, DatabaseSprintState, DatabaseTaskConfig } from '@shared/databaseTasks';
import type { CreateAutomationRuleInput, CreateFormDefinitionInput } from '@shared/databaseAutomations';
import { databaseFormPublicUrl, databaseFormServerStatus } from '../automation/formServer';
import path from 'node:path';
import fs from 'node:fs';
import { BrowserWindow, dialog } from 'electron';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';
import { cancelDatabaseCalculation, getDatabaseCalculationStatus, startDatabaseCalculation } from '../db/databaseComputeHost';
import { aggregateDatabaseRowsInWorker } from '../db/databaseAggregateHost';
import { extractFromPath } from '../extraction/textExtractor';
import { getActiveVault } from '../vaults/vaultRegistry';
import { analyzeImageBytes } from '../ai/imageAnalysis';
import { isVisionMime } from '@shared/imageAnalysis';
import { importNotionZip } from '../import/notionZipImport';
import { getQaDatabaseScaleFixtureStatus, startQaDatabaseScaleFixture } from '../qa/databaseScaleFixtureHost';
import type { QaDatabaseScaleFixtureInput } from '@shared/databaseScaleQa';
import * as databaseResearch from '../db/databaseDeepResearchRepo';
import {
  estimateDatabaseDeepResearchCost,
  DATABASE_DEEP_RESEARCH_REPORT_TYPES,
  getDatabaseDeepResearchAnalysisRequirements,
  getDatabaseDeepResearchEligibility,
  normalizeDatabaseDeepResearchJobInput,
  normalizeDatabaseDeepResearchReportType,
  autoConfigureDatabaseDeepResearch,
  type DatabaseDeepResearchExportOptions,
  type DatabaseDeepResearchJobInput,
  type DatabaseDeepResearchReportType,
} from '@shared/databaseDeepResearch';
import { enqueueDatabaseDeepResearch, ensureDatabaseDeepResearchLane } from '../ai/databaseDeepResearchLane';
import { buildDatabaseDeepResearchExport } from '../export/databaseDeepResearchExport';
import { buildDatabaseDeepResearchPreviewSections } from '@shared/databaseDeepResearchPrompts';

/**
 * Rows of the CSV the import modal is currently showing, kept out of the renderer: a real
 * sheet is tens of MB, and round-tripping it through the modal froze the UI. One entry at a
 * time — the modal can only show one import.
 */
const pendingCsvImports = new Map<string, { headers: string[]; rows: string[][] }>();
/** How many rows the import modal previews. */
const CSV_PREVIEW_ROWS = 50;
/** Guards against a mis-picked folder (a home directory) walking the whole disk. */
const BULK_WALK_MAX_DEPTH = 8;
const BULK_WALK_MAX_FILES = 50_000;

/** Best-effort MIME type from a file extension, for database attachments. */
function dbGuessMime(ext: string): string | null {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.json': 'application/json',
  };
  return map[ext.toLowerCase()] ?? null;
}

export function registerDatabasesIpc({ h, getWindow, chatAborters }: IpcContext): void {
  // ── Databases mode (Notion-like structured data) ───────────────────────────
  h('db:list', async () => dbMode.listDatabases());
  h('db:search', async (_e, query: string, includeContent: boolean) => dbMode.searchDatabases(query, includeContent));
  h('db:searchRows', async (_e, query: string, limit?: number) => dbMode.searchDatabaseRows(query, limit));
  h('db:searchRowsPage', async (_e, input: DatabaseRowSearchQuery) => dbMode.searchDatabaseRowsPage(input));
  h('db:get', async (_e, id: string) => dbMode.getDatabase(id));
  h('db:detail', async (_e, id: string) => dbMode.getDatabaseDetail(id));
  h('db:stats', async (_e, id: string) => dbMode.databaseStats(id));
  h('db:create', async (_e, name: string, icon?: string | null) => dbMode.createDatabase(name, icon ?? null));
  h('db:rename', async (_e, id: string, name: string) => dbMode.renameDatabase(id, name));
  h('db:setIcon', async (_e, id: string, icon: string | null) => dbMode.setDatabaseIcon(id, icon));
  h('db:delete', async (_e, id: string) => {
    dbMode.deleteDatabase(id);
  });
  h('db:reorder', async (_e, ids: string[]) => {
    dbMode.reorderDatabases(ids);
  });
  h('db:createColumn', async (_e, databaseId: string, name: string, type: DatabaseColumnType, config?: DatabaseColumnConfig) =>
    dbMode.createColumn(databaseId, name, type, config ?? {})
  );
  h('db:updateColumn', async (_e, id: string, patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }) =>
    dbMode.updateColumn(id, patch)
  );
  h('db:deleteColumn', async (_e, id: string) => {
    dbMode.deleteColumn(id);
  });
  h('db:reorderColumns', async (_e, databaseId: string, ids: string[]) => {
    dbMode.reorderColumns(databaseId, ids);
  });
  h('db:addOption', async (
    _e, columnId: string, label: string, color?: string | null,
    group?: DatabaseSelectOption['group'],
  ) => dbMode.addOption(columnId, label, color ?? null, group ?? null)
  );
  h('db:updateOption', async (
    _e, id: string,
    patch: { label?: string; color?: string | null; group?: DatabaseSelectOption['group'] },
  ) => {
    dbMode.updateOption(id, patch);
  });
  h('db:deleteOption', async (_e, id: string) => {
    dbMode.deleteOption(id);
  });
  h('db:reorderOptions', async (_e, columnId: string, ids: string[]) => {
    dbMode.reorderOptions(columnId, ids);
  });
  h('db:listRows', async (_e, databaseId: string, opts?: { sort?: dbMode.DatabaseRowSort; limit?: number; offset?: number }) =>
    dbMode.listRows(databaseId, opts ?? {})
  );
  h('db:queryRows', async (_e, input: DatabaseRowQuery) => dbMode.queryDatabaseRows(input));
  h('qa:db:startScaleFixture', async (_e, input: QaDatabaseScaleFixtureInput) =>
    startQaDatabaseScaleFixture(input, (progress) => getWindow()?.webContents.send('qa:db:scaleFixtureProgress', progress)));
  h('qa:db:scaleFixtureStatus', async (_e, jobId: string) => getQaDatabaseScaleFixtureStatus(jobId));
  h('db:listDataSources', async () => dbMode.listDatabaseDataSources());
  h('db:getContainer', async (_e, viewId: string) => dbMode.getDatabaseContainer(viewId));
  h('db:listViewSources', async (_e, viewId: string) => dbMode.listDatabaseViewSources(viewId));
  h('db:attachViewSource', async (_e, viewId: string, databaseId: string, input?: AttachDatabaseViewSourceInput) =>
    dbMode.attachDatabaseViewSource(viewId, databaseId, input ?? {}));
  h('db:detachViewSource', async (_e, viewId: string, sourceId: string) => dbMode.detachDatabaseViewSource(viewId, sourceId));
  h('db:queryContainerRows', async (_e, input: DatabaseContainerRowQuery) => dbMode.queryDatabaseContainerRows(input));
  h('db:recalculate', async (_e, databaseId: string) => {
    const vault = getActiveVault();
    if (!dbMode.getDatabase(databaseId)) throw new Error('Base de datos no encontrada.');
    return startDatabaseCalculation(vault.path, databaseId, (progress) => {
      getWindow()?.webContents.send('db:calculationProgress', progress);
    });
  });
  h('db:calculationStatus', async (_e, databaseId: string) => getDatabaseCalculationStatus(databaseId));
  h('db:cancelCalculation', async (_e, jobId: string) => cancelDatabaseCalculation(jobId));
  h('db:getRow', async (_e, id: string) => dbMode.getRow(id));
  h('db:createRow', async (_e, databaseId: string) => {
    const row = dbMode.createRow(databaseId);
    await automationMode.dispatchAutomationEvent({
      type: 'row_created', databaseId, rowId: row.id, eventKey: `row-created:${row.id}`,
    });
    return dbMode.getRow(row.id) ?? row;
  });
  h('db:deleteRow', async (_e, id: string) => {
    dbMode.deleteRow(id);
  });
  h('db:listRowTemplates', async (_e, databaseId: string) => taskMode.listDatabaseRowTemplates(databaseId));
  h('db:createRowTemplate', async (_e, databaseId: string, input: CreateDatabaseRowTemplateInput) => taskMode.createDatabaseRowTemplate(databaseId, input));
  h('db:deleteRowTemplate', async (_e, templateId: string) => taskMode.deleteDatabaseRowTemplate(templateId));
  h('db:instantiateRowTemplate', async (_e, templateId: string, occurrenceKey?: string | null) => taskMode.instantiateDatabaseRowTemplate(templateId, occurrenceKey ?? null));
  h('db:runDueRowTemplates', async (_e, at?: string, limit?: number) => taskMode.runDueDatabaseRowTemplates(at, limit));
  h('db:duplicateRow', async (_e, input: DatabaseDuplicateRowInput) => taskMode.duplicateDatabaseRow(input));
  h('db:listRowHierarchy', async (_e, databaseId: string, limit?: number) => taskMode.listDatabaseRowHierarchy(databaseId, limit));
  h('db:setSubitemParent', async (_e, rowId: string, parentRowId: string | null) => taskMode.setDatabaseSubitemParent(rowId, parentRowId));
  h('db:setSubitemCollapsed', async (_e, rowId: string, collapsed: boolean) => taskMode.setDatabaseSubitemCollapsed(rowId, collapsed));
  h('db:listRowDependencies', async (_e, databaseId: string) => taskMode.listDatabaseRowDependencies(databaseId));
  h('db:addRowDependency', async (_e, predecessorRowId: string, successorRowId: string, lagDays?: number) => taskMode.addDatabaseRowDependency(predecessorRowId, successorRowId, lagDays));
  h('db:removeRowDependency', async (_e, id: string) => taskMode.removeDatabaseRowDependency(id));
  h('db:getTaskConfig', async (_e, databaseId: string) => taskMode.getDatabaseTaskConfig(databaseId));
  h('db:updateTaskConfig', async (_e, databaseId: string, patch: Partial<Omit<DatabaseTaskConfig, 'databaseId' | 'revision' | 'updatedAt'>>) => taskMode.updateDatabaseTaskConfig(databaseId, patch));
  h('db:shiftTaskDates', async (_e, rowId: string, deltaDays: number) => taskMode.shiftDatabaseTaskDates(rowId, deltaDays));
  h('db:listSprints', async (_e, databaseId: string) => taskMode.listDatabaseSprints(databaseId));
  h('db:createSprint', async (_e, databaseId: string, input: { name: string; startAt: string; endAt: string }) => taskMode.createDatabaseSprint(databaseId, input));
  h('db:updateSprintState', async (_e, sprintId: string, state: DatabaseSprintState) => taskMode.updateDatabaseSprintState(sprintId, state));
  h('db:assignRowToSprint', async (_e, sprintId: string, rowId: string) => taskMode.assignDatabaseRowToSprint(sprintId, rowId));
  h('db:listAutomationRules', async (_e, databaseId: string) => automationMode.listAutomationRules(databaseId));
  h('db:createAutomationRule', async (_e, databaseId: string, input: CreateAutomationRuleInput) => automationMode.createAutomationRule(databaseId, input));
  h('db:updateAutomationRule', async (_e, ruleId: string, patch: Partial<CreateAutomationRuleInput>, expectedRevision: number) => automationMode.updateAutomationRule(ruleId, patch, expectedRevision));
  h('db:deleteAutomationRule', async (_e, ruleId: string, expectedRevision: number) => automationMode.deleteAutomationRule(ruleId, expectedRevision));
  h('db:runAutomationRule', async (_e, ruleId: string, rowId?: string | null, eventKey?: string) => automationMode.runAutomationRule(ruleId, rowId ?? null, eventKey));
  h('db:runButtonAutomation', async (_e, columnId: string, rowId: string) => automationMode.runDatabaseButtonAutomation(columnId, rowId));
  h('db:runDueAutomations', async (_e, at?: string, limit?: number) => automationMode.runDueAutomationRules(at, limit));
  h('db:listAutomationRuns', async (_e, databaseId: string, limit?: number) => automationMode.listAutomationRuns(databaseId, limit));
  h('db:listAutomationNotifications', async (_e, databaseId: string, limit?: number) => automationMode.listAutomationNotifications(databaseId, limit));
  h('db:listForms', async (_e, databaseId: string) => automationMode.listDatabaseForms(databaseId));
  h('db:createForm', async (_e, databaseId: string, input: CreateFormDefinitionInput) => automationMode.createDatabaseForm(databaseId, input));
  h('db:updateForm', async (_e, formId: string, input: CreateFormDefinitionInput, expectedRevision: number) => automationMode.updateDatabaseForm(formId, input, expectedRevision));
  h('db:deleteForm', async (_e, formId: string, expectedRevision: number) => automationMode.deleteDatabaseForm(formId, expectedRevision));
  h('db:listFormSubmissions', async (_e, formId: string, limit?: number) => automationMode.listDatabaseFormSubmissions(formId, limit));
  h('db:formServerStatus', async () => databaseFormServerStatus());
  h('db:formPublicUrl', async (_e, slug: string) => databaseFormPublicUrl(slug));
  h('db:setCell', async (_e, rowId: string, columnId: string, raw: string | null) => {
    const row = dbMode.setCell(rowId, columnId, raw);
    if (row) await automationMode.dispatchAutomationEvent({
      type: 'property_changed', databaseId: row.databaseId, rowId, columnId,
      eventKey: `property-changed:${rowId}:${columnId}:${crypto.randomUUID()}`,
    });
    return dbMode.getRow(rowId) ?? row;
  });
  h('db:setCellsBulk', async (_e, input: DatabaseBulkEditInput) => {
    const result = dbMode.setCellsBulk(input);
    for (const change of input.changes) {
      await automationMode.dispatchAutomationEvent({
        type: 'property_changed', databaseId: input.databaseId, rowId: change.rowId, columnId: change.columnId,
        eventKey: `bulk-property-changed:${change.rowId}:${change.columnId}:${crypto.randomUUID()}`,
      });
    }
    return { ...result, rows: result.rows.map((row) => dbMode.getRow(row.id) ?? row) };
  });
  h('db:aggregateRows', async (_e, input: DatabaseAggregateQuery) => {
    const vault = getActiveVault();
    if (!dbMode.getDatabase(input.databaseId)) throw new Error('Base de datos no encontrada.');
    return aggregateDatabaseRowsInWorker(vault.path, input);
  });
  h('db:queryTemporalEvents', async (_e, input: DatabaseTemporalQuery) => dbMode.queryDatabaseTemporalEvents(input));
  h('db:updateTemporalRange', async (_e, input: DatabaseTemporalRangeUpdate) => dbMode.updateDatabaseTemporalRange(input));
  h('db:queryChart', async (_e, input: DatabaseChartQuery) => dbMode.queryDatabaseChart(input));
  h('db:queryMap', async (_e, input: DatabaseMapQuery) => dbMode.queryDatabaseMap(input));
  h('db:queryFeed', async (_e, input: DatabaseFeedQuery) => dbMode.queryDatabaseFeed(input));
  h('db:exportChart', async (_e, input: DatabaseChartExportInput) => {
    if (!input || typeof input.svg !== 'string' || input.svg.length > 5_000_000 || !/^<svg[\s>]/i.test(input.svg.trim())
      || /<script\b|\son\w+\s*=|(?:href|src)\s*=\s*["']https?:/i.test(input.svg)) throw new Error('SVG de gráfico no válido.');
    if (input.format !== 'svg' && input.format !== 'png') throw new Error('Formato de gráfico no válido.');
    if (!dbMode.getDatabase(input.databaseId)) throw new Error('Base de datos no encontrada.');
    const baseName = (input.title || 'grafico').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'grafico';
    const fileName = `${baseName}.${input.format}`;
    const qaExportDir = process.env.NODUS_QA_EXPORT_DIR;
    let filePath: string | null = null;
    if (qaExportDir) {
      const qaRoot = process.env.NODUS_QA_ROOT; const relative = qaRoot ? path.relative(path.resolve(qaRoot), path.resolve(qaExportDir)) : '..';
      if (!qaRoot || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('QA abortado: la exportación está fuera del directorio autorizado.');
      fs.mkdirSync(qaExportDir, { recursive: true }); filePath = path.join(qaExportDir, fileName);
    } else {
      const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, { title: dialogTitle('exportChart', getSettings().uiLanguage), defaultPath: fileName,
        filters: [{ name: input.format.toUpperCase(), extensions: [input.format] }] });
      if (picked.canceled || !picked.filePath) return { canceled: true, path: null }; filePath = picked.filePath;
    }
    if (input.format === 'svg') fs.writeFileSync(filePath, input.svg, 'utf8');
    else { const sharp = (await import('sharp')).default; await sharp(Buffer.from(input.svg)).png().toFile(filePath); }
    return { canceled: false, path: filePath };
  });
  h('db:runComparisonCell', async (_e, rowId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => dbMode.runComparisonCell(rowId, columnId));
  });
  h('db:runComparisonColumn', async (_e, databaseId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () =>
      dbMode.runComparisonColumn(databaseId, columnId, (done, total) =>
        getWindow()?.webContents.send('db:comparisonProgress', { vaultId, databaseId, columnId, done, total })
      )
    );
  });
  h('db:listAttachments', async (_e, rowId: string, columnId: string) => dbMode.listAttachments(rowId, columnId));
  h('db:getAttachmentBlob', async (_e, id: string) => dbMode.getAttachmentBlob(id));
  h('db:getAttachmentThumb', async (_e, id: string) => dbMode.getAttachmentThumb(id));
  h('db:deleteAttachment', async (_e, id: string) => {
    dbMode.deleteAttachment(id);
  });
  h('db:downloadAttachment', async (_e, id: string) => {
    const att = dbMode.getAttachment(id);
    const blob = dbMode.getAttachmentBlob(id);
    if (!att || !blob) return { canceled: true, path: null };
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: dialogTitle('downloadAttachment', getSettings().uiLanguage),
      defaultPath: att.fileName ?? 'adjunto',
    });
    if (picked.canceled || !picked.filePath) return { canceled: true, path: null };
    fs.writeFileSync(picked.filePath, blob);
    return { canceled: false, path: picked.filePath };
  });
  h('db:runAiCell', async (_e, rowId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => runAiCell(rowId, columnId));
  });
  h('db:runAiColumn', async (_e, databaseId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () =>
      runAiColumn(databaseId, columnId, (done, total) =>
        getWindow()?.webContents.send('db:aiProgress', { vaultId, databaseId, columnId, done, total })
      )
    );
  });
  h('db:generateAiImage', async (_e, rowId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => runAiImageCell(rowId, columnId));
  });
  h('db:generateAiImageColumn', async (_e, databaseId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () =>
      runAiImageColumn(databaseId, columnId, (done, total) =>
        getWindow()?.webContents.send('db:aiProgress', { vaultId, databaseId, columnId, done, total })
      )
    );
  });
  h('db:pickBulkFiles', async (_e, mode: 'files' | 'folder' = 'files') => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: mode === 'folder' ? dialogTitle('chooseBulkUploadFolder', getSettings().uiLanguage) : dialogTitle('chooseBulkUploadFiles', getSettings().uiLanguage),
      properties: mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      ...(mode === 'folder' ? {} : { filters: [{ name: 'Todos los archivos', extensions: ['*'] }] }),
    });
    if (picked.canceled) return [];
    if (mode === 'files') return picked.filePaths.map((p) => ({ name: path.basename(p), path: p }));
    // A real catalogue is a tree of folders, not a flat selection the user can shift-click:
    // walk it so "pick the folder" is the whole interaction.
    const out: { name: string; path: string }[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > BULK_WALK_MAX_DEPTH || out.length >= BULK_WALK_MAX_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= BULK_WALK_MAX_FILES) return;
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile()) out.push({ name: e.name, path: full });
      }
    };
    for (const root of picked.filePaths) walk(root, 0);
    return out;
  });
  h('db:bulkAttach', async (
    _e,
    databaseId: string,
    refColumnId: string,
    attachmentColumnId: string,
    files: { name: string; path: string }[],
    options: BulkAttachOptions = {}
  ) => {
    const rows = dbMode.listRows(databaseId).map((r) => ({ rowId: r.id, refValue: r.cells[refColumnId] ?? null }));
    const matches = matchFilesToRows(files.map((f) => f.name), rows, {
      fuzzy: options.fuzzy ?? false,
      codePattern: options.codeTemplate ? codeTemplateToRegex(options.codeTemplate) : null,
    });
    // Pair by index, not by name: walking a folder tree turns up files that share a name
    // across folders, and keying a map on the name would file them all under one row.
    const rowByIndex = matches.map((m) => m.rowId);
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = options.describe
      ? settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null
      : null;
    const total = files.length;
    let attached = 0;
    let matched = 0;
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rowId = rowByIndex[i];
      if (rowId) {
        matched++;
        try {
          const buf = fs.readFileSync(f.path);
          const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
          if (!dbMode.attachmentExists(rowId, attachmentColumnId, contentHash)) {
            const mimeType = dbGuessMime(path.extname(f.path));
            let extractedText: string | null = null;
            let description: string | null = null;
            // Both passes are opt-in: a photo catalogue is thousands of files, and OCRing or
            // describing every one of them is hours of work the user rarely wants.
            if (options.ocr) {
              try {
                const doc = await extractFromPath(f.path, { ocr });
                extractedText = doc.text && doc.text.trim() ? doc.text : null;
              } catch {
                /* keep the blob even if extraction fails */
              }
            }
            if (visionModel && isVisionMime(mimeType)) {
              const analysis = await analyzeImageBytes(buf, mimeType!, visionModel).catch(() => null);
              if (analysis) {
                description = analysis.description || null;
                if (!extractedText && analysis.text.trim()) extractedText = analysis.text;
              }
            }
            dbMode.addAttachment({
              rowId,
              columnId: attachmentColumnId,
              fileName: f.name,
              mimeType,
              bytes: buf.length,
              blob: buf,
              contentHash,
              extractedText,
              description,
              thumb: makeThumbnail(buf, mimeType),
            });
            attached++;
          }
        } catch {
          /* unreadable file — skip */
        }
      }
      done++;
      getWindow()?.webContents.send('db:bulkProgress', { databaseId, done, total, attached, matched, finished: false });
      // Reading, hashing and downscaling a file is all synchronous, and with OCR and the
      // vision pass both off (the common case) nothing else in this loop awaits — so a
      // 7k-image catalogue would hold the main process for ~100s and the progress emits
      // above would only reach the renderer once it finished.
      if (done % YIELD_EVERY === 0) await yieldToEventLoop();
    }
    getWindow()?.webContents.send('db:bulkProgress', { databaseId, done: total, total, attached, matched, finished: true });
    return { attached, matched, unmatched: total - matched };
  });
  h('db:parseCsvForImport', async () => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: dialogTitle('importCsv', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const filePath = picked.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = parseCsv(text, detectDelimiter(text));
    const plan = buildCsvImportPlan(parsed);
    // The rows stay here: a real sheet is tens of MB, and shipping it to the renderer only
    // to have it shipped straight back to db:createFromCsv cost two structured clones of
    // ~180k strings and froze the UI. The modal only ever renders headers + a preview.
    const token = crypto.randomUUID();
    pendingCsvImports.clear();
    pendingCsvImports.set(token, { headers: plan.headers, rows: plan.rows });
    return {
      token,
      fileName: path.basename(filePath),
      headers: plan.headers,
      suggestedTypes: plan.suggestedTypes,
      suggestions: plan.suggestions,
      rowCount: plan.rows.length,
      sampleRows: plan.rows.slice(0, CSV_PREVIEW_ROWS),
    };
  });
  h('db:releaseCsvImport', async (_e, token: string) => {
    pendingCsvImports.delete(token);
  });
  h('db:importNotionZip', async () => {
    const qaPath = process.env.NODUS_QA_NOTION_ZIP;
    let filePath: string | null = null;
    if (qaPath) {
      const qaRoot = process.env.NODUS_QA_ROOT;
      const relative = qaRoot ? path.relative(path.resolve(qaRoot), path.resolve(qaPath)) : '..';
      if (!qaRoot || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('QA abortado: el ZIP de Notion está fuera del directorio autorizado.');
      }
      filePath = path.resolve(qaPath);
    } else {
      const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
        title: dialogTitle('importNotionExport', getSettings().uiLanguage), properties: ['openFile'],
        filters: [{ name: 'Notion ZIP', extensions: ['zip'] }],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      filePath = picked.filePaths[0];
    }
    return importNotionZip(filePath);
  });
  h('db:createFromCsvToken', async (_e, token: string, name: string, types: (DatabaseColumnType | null)[]) => {
    const pending = pendingCsvImports.get(token);
    if (!pending) throw new Error('El CSV importado ya no está disponible. Vuelve a elegir el archivo.');
    const send = (done: number, total: number) =>
      getWindow()?.webContents.send('db:csvImportProgress', { done, total, finished: done >= total });
    const created = dbMode.createDatabaseFromCsv(name, pending.headers, pending.rows, types, send);
    // Only drop the rows once they are safely in the database: if the import throws, the
    // modal reports the error and the user can hit Import again without re-picking the file.
    pendingCsvImports.delete(token);
    return created;
  });
  h('db:createFromCsv', async (_e, name: string, headers: string[], rows: string[][], types: (DatabaseColumnType | null)[]) =>
    dbMode.createDatabaseFromCsv(name, headers, rows, types)
  );
  h('db:export', async (_e, databaseId: string, format: ExportFormat) => {
    const descriptor = databaseExportDescriptor(databaseId, format);
    if (!descriptor) return { canceled: true };
    // Real E2E runs cannot operate a native save sheet reliably. The QA-only path is
    // still the production serializer and IPC handler; it merely replaces the picker
    // with a fail-closed destination under the isolated profile.
    const qaExportDir = process.env.NODUS_QA_EXPORT_DIR;
    if (qaExportDir) {
      const qaRoot = process.env.NODUS_QA_ROOT;
      const relative = qaRoot ? path.relative(path.resolve(qaRoot), path.resolve(qaExportDir)) : '..';
      if (!qaRoot || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('QA abortado: la exportación está fuera del directorio autorizado.');
      }
      fs.mkdirSync(qaExportDir, { recursive: true });
      const filePath = path.join(qaExportDir, descriptor.fileName);
      const metrics = await exportDatabaseToFile(databaseId, format, filePath);
      return { canceled: false, path: filePath, metrics };
    }
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, { title: dialogTitle('exportDatabase', getSettings().uiLanguage), defaultPath: descriptor.fileName });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    const metrics = await exportDatabaseToFile(databaseId, format, picked.filePath);
    return { canceled: false, path: picked.filePath, metrics };
  });
  h('db:profile', async (_e, databaseId: string) => getDatabaseProfile(databaseId));
  h('db:analyzeReport', async (_e, databaseId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => generateAnalysisReport(databaseId));
  });
  h('db:suggestAnalyses', async (_e, databaseId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => suggestDatabaseAnalyses(databaseId));
  });
  h('db:runAnalysis', async (_e, databaseId: string, request: AnalysisRequest) => runDatabaseAnalysis(databaseId, request));
  h('db:narrateAnalysis', async (_e, result: AnalysisResult) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => narrateAnalysisResult(result));
  });
  // Database Deep Research is a durable, asynchronous orchestration lane. The
  // statistical/AI worker consumes these records separately; IPC only validates,
  // persists and reports lifecycle changes.
  const databaseResearchVault = () => {
    const vault = getActiveVault();
    if (vault.type !== 'databases') throw new Error('La investigación de bases sólo está disponible en un vault de bases de datos.');
    return vault;
  };
  h('db:deepResearch:preview', async (_e, input: DatabaseDeepResearchJobInput) => {
    const vault = databaseResearchVault();
    return withVaultDatabase(vault.id, () => {
      const normalized = normalizeDatabaseDeepResearchJobInput(input);
      const evidence: Array<{ id: string; label: string; excerpt: string; databaseName?: string; rowId?: string }> = [];
      let rowCount = 0;
      const availableViews = new Set<string>();
      const availableColumns = new Set<string>();
      const schemaColumns: Array<{ databaseId: string; id: string; type: string; name: string; config: Record<string, unknown>; profile?: { filled?: number; fillRate?: number; distinct?: number; valueType?: string } }> = [];
      for (const databaseId of normalized.databaseIds) {
        const database = dbMode.getDatabase(databaseId);
        if (!database) throw new Error('Base de datos no encontrada.');
        for (const view of dbMode.listViews(databaseId)) availableViews.add(view.id);
        for (const column of dbMode.getColumns(databaseId)) {
          availableColumns.add(column.id);
          const profile = getDatabaseProfile(databaseId)?.profile.columns.find((item) => item.columnId === column.id);
          schemaColumns.push({ databaseId, id: column.id, type: column.type, name: column.name, config: column.config as Record<string, unknown>, profile });
        }
        const rows = dbMode.listRows(databaseId, { limit: 200 });
        rowCount += database.rowCount;
        for (const [index] of rows.slice(0, 8).entries()) {
          // Preview is metadata-only. Never echo cell values, row IDs, free text,
          // PII or prompt-injection payloads across the IPC boundary.
          const excerpt = 'Valores de celdas omitidos por privacidad; solo se muestra evidencia agregada tras ejecutar la investigación.';
          evidence.push({ id: `${databaseId}:sample:${index}`, label: 'Muestra redactada', excerpt, databaseName: database.name });
        }
      }
      for (const viewId of normalized.viewIds) if (!availableViews.has(viewId)) throw new Error(`Vista no válida: ${viewId}`);
      for (const columnId of normalized.filters.columnIds) if (!availableColumns.has(columnId)) throw new Error(`Columna de filtro no válida: ${columnId}`);
      const { estimatedTokens, estimatedCostUsd } = estimateDatabaseDeepResearchCost(rowCount, normalized.databaseIds.length, normalized.depth);
      const requestedReportType = normalized.requestedReportType ?? normalized.reportType ?? 'general';
      const autoConfiguration = normalized.autoConfigure
        ? autoConfigureDatabaseDeepResearch(requestedReportType, { columns: schemaColumns, roles: normalized.roles, databaseCount: normalized.databaseIds.length, objective: normalized.objective }, normalized.roles)
        : { requestedReportType, reportType: normalizeDatabaseDeepResearchReportType(normalized.reportType), roles: normalized.roles, confidence: 1, warnings: [], limitations: [], partial: false };
      const effectiveRoles = autoConfiguration.roles;
      const effectiveReportType = autoConfiguration.reportType;
      const availableReportTypes = DATABASE_DEEP_RESEARCH_REPORT_TYPES.map((type) =>
        getDatabaseDeepResearchEligibility(type, {
          columns: schemaColumns,
          roles: effectiveRoles,
          databaseCount: normalized.databaseIds.length,
        }),
      );
      const eligibility = availableReportTypes.find((item) => item.reportType === effectiveReportType);
      const analyses = getDatabaseDeepResearchAnalysisRequirements(effectiveReportType);
      return {
        requestedReportType,
        reportType: effectiveReportType,
        resolvedReportType: effectiveReportType,
        suggestedRoles: effectiveRoles,
        confidence: autoConfiguration.confidence,
        warnings: autoConfiguration.warnings,
        limitations: autoConfiguration.limitations,
        preflight: { ok: Boolean(eligibility?.applicable), partial: autoConfiguration.partial, warnings: autoConfiguration.warnings },
        eligibility,
        availableReportTypes,
        rowCount, sourceCount: normalized.databaseIds.length, estimatedTokens, estimatedCostUsd,
        requiredAnalyses: analyses.required,
        optionalAnalyses: analyses.optional,
        sections: buildDatabaseDeepResearchPreviewSections(
          normalized.language ?? 'en',
          effectiveReportType,
          normalized.objective,
          evidence.length,
        ),
        evidence,
      };
    });
  });
  h('db:deepResearch:enqueue', async (e, input: DatabaseDeepResearchJobInput) => {
    const vault = databaseResearchVault();
    const host=e as typeof e & {mobileBridgeJobId?:string;mobileBridgeRecovery?:boolean};
    const job = await enqueueDatabaseDeepResearch(vault.id, input,{bridgeJobId:host.mobileBridgeJobId,requireExisting:host.mobileBridgeRecovery});
    if (!e.sender.isDestroyed()) e.sender.send('db:deepResearch:progress', {
      runId: job.id, status: job.status, progress: job.progress, step: null, phase: job.phase, message: 'Añadida a la cola.',
    });
    return job;
  });
  h('db:deepResearch:job:get', async (_e, id: string) => {
    const vault = databaseResearchVault(); ensureDatabaseDeepResearchLane(vault.id); return withVaultDatabase(vault.id, () => databaseResearch.getDatabaseResearchJob(id));
  });
  h('db:deepResearch:jobs:list', async () => {
    const vault = databaseResearchVault(); ensureDatabaseDeepResearchLane(vault.id); return withVaultDatabase(vault.id, () => databaseResearch.listDatabaseResearchJobs());
  });
  h('db:deepResearch:job:cancel', async (_e, id: string) => {
    const vault = databaseResearchVault(); return withVaultDatabase(vault.id, () => databaseResearch.cancelDatabaseResearchRun(id));
  });
  h('db:deepResearch:jobs:clear', async () => {
    const vault = databaseResearchVault(); return withVaultDatabase(vault.id, () => databaseResearch.clearFinishedDatabaseResearchJobs());
  });
  h('db:deepResearch:reports:list', async (_e, query?: { limit?: number; offset?: number; query?: string; reportType?: DatabaseDeepResearchReportType }) => {
    const vault = databaseResearchVault(); return withVaultDatabase(vault.id, () => databaseResearch.listDatabaseResearchReports(query));
  });
  h('db:deepResearch:mobileCatalogue', async (_e,input?: {limit?:number;offset?:number}) => {
    const vault = databaseResearchVault(); return withVaultDatabase(vault.id,()=>mobileDatabaseResearchCatalogue(input));
  });
  h('db:deepResearch:report:get', async (_e, id: string) => {
    const vault = databaseResearchVault(); return withVaultDatabase(vault.id, () => databaseResearch.getDatabaseResearchReport(id));
  });
  h('db:deepResearch:mobileReader',async(_e,id:string)=>{
    const vault=databaseResearchVault(); return withVaultDatabase(vault.id,()=>mobileDatabaseResearchReader(id));
  });
  h('db:deepResearch:report:read', async (_e, id: string, read: boolean) => {
    const vault = databaseResearchVault();
    return withVaultDatabase(vault.id, () => databaseResearch.setDatabaseDeepResearchReportRead(id, read === true));
  });
  const announceDatabaseResearchAnnotations = (reportId: string | null): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('db:deepResearch:report:annotations:changed', reportId);
    }
  };
  h('db:deepResearch:report:annotations:list', async (_e, reportId: string) => {
    const vault = databaseResearchVault();
    return withVaultDatabase(vault.id, () => databaseResearch.listDatabaseDeepResearchReportAnnotations(reportId));
  });
  h('db:deepResearch:report:annotations:create', async (_e, input) => {
    const vault = databaseResearchVault();
    const annotation = await withVaultDatabase(vault.id, () => databaseResearch.createDatabaseDeepResearchReportAnnotation(input));
    announceDatabaseResearchAnnotations(annotation.reportId);
    return annotation;
  });
  h('db:deepResearch:report:annotations:updateComment', async (_e, id: string, comment: string) => {
    const vault = databaseResearchVault();
    const annotation = await withVaultDatabase(vault.id, () => databaseResearch.updateDatabaseDeepResearchReportComment(id, comment));
    if (annotation) announceDatabaseResearchAnnotations(annotation.reportId);
    return annotation;
  });
  h('db:deepResearch:report:annotations:delete', async (_e, id: string) => {
    const vault = databaseResearchVault();
    const reportId = await withVaultDatabase(vault.id, () => databaseResearch.deleteDatabaseDeepResearchReportAnnotation(id));
    if (reportId) announceDatabaseResearchAnnotations(reportId);
    return !!reportId;
  });
  h('db:deepResearch:report:delete', async (_e, id: string) => {
    const vault = databaseResearchVault(); return withVaultDatabase(vault.id, () => databaseResearch.deleteDatabaseResearchReport(id));
  });
  h('db:deepResearch:report:export', async (_e, id: string, options: DatabaseDeepResearchExportOptions) => {
    const vault = databaseResearchVault();
    if (!options || !['markdown', 'pdf', 'docx', 'zip'].includes(options.format)) throw new Error('Formato de exportación no válido.');
    if (options.includeSnapshot && options.format !== 'zip') throw new Error('El snapshot bruto sólo puede incluirse en el ZIP reproducible.');
    const report = await withVaultDatabase(vault.id, () => databaseResearch.getDatabaseResearchReport(id));
    if (!report) return { canceled: true, path: null };
    const extension = options.format === 'markdown' ? 'md' : options.format;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, { title: dialogTitle('exportDeepResearchReport', getSettings().uiLanguage), defaultPath: `${report.title.replace(/[^\w\-. ]+/g, '').trim() || 'database-research'}.${extension}` });
    if (picked.canceled || !picked.filePath) return { canceled: true, path: null };
    const exported = await withVaultDatabase(vault.id, () => buildDatabaseDeepResearchExport(id, options));
    fs.writeFileSync(picked.filePath, exported.bytes);
    return { canceled: false, path: picked.filePath };
  });
  h('db:chatStream', async (e, requestId: string, request: DatabaseChatRequest) => {
    const controller = new AbortController();
    chatAborters.set(requestId, controller);
    try {
      return await streamDatabaseChat(request, (delta) => e.sender.send('db:chatStream:delta', requestId, delta), controller.signal);
    } finally {
      chatAborters.delete(requestId);
    }
  });
  h('db:chatStream:cancel', async (_e, requestId: string) => {
    chatAborters.get(requestId)?.abort();
  });
  h('db:chatHistory:list', async (_e, includeArchived?: boolean) => databaseChatHistory.listDatabaseChatConversations(Boolean(includeArchived)));
  h('db:chatHistory:get', async (_e, id: string) => databaseChatHistory.getDatabaseChatConversation(id));
  h('db:chatHistory:create', async (_e, input: Parameters<typeof databaseChatHistory.createDatabaseChatConversation>[0]) => databaseChatHistory.createDatabaseChatConversation(input));
  h('db:chatHistory:save', async (_e, id: string, messages: import('@shared/types').DbChatTurn[], databaseIds: string[]) => databaseChatHistory.saveDatabaseChatConversation(id, messages, databaseIds));
  h('db:chatHistory:delete', async (_e, id: string) => databaseChatHistory.deleteDatabaseChatConversation(id));
  h('db:listViews', async (_e, databaseId: string) => dbMode.listViews(databaseId));
  h('db:createView', async (_e, databaseId: string, input: SavedViewInput) => dbMode.createView(databaseId, input));
  h('db:updateView', async (_e, id: string, patch: SavedViewPatch) => dbMode.updateView(id, patch));
  h('db:duplicateView', async (_e, id: string, name?: string) => dbMode.duplicateView(id, name));
  h('db:linkView', async (_e, id: string, name?: string, scope?: 'personal' | 'shared') => dbMode.linkView(id, name, scope));
  h('db:reorderViews', async (_e, databaseId: string, ids: string[]) => dbMode.reorderViews(databaseId, ids));
  h('db:listViewRevisions', async (_e, id: string) => dbMode.listViewRevisions(id));
  h('db:restoreViewRevision', async (_e, id: string, revision: number, expectedRevision?: number) =>
    dbMode.restoreViewRevision(id, revision, expectedRevision));
  h('db:deleteView', async (_e, id: string) => {
    dbMode.deleteView(id);
  });
  h('db:listRelations', async (_e, rowId: string, columnId: string) => dbMode.listRelations(rowId, columnId));
  h('db:addRelation', async (_e, rowId: string, columnId: string, targetKind: RelationTargetKind, targetId: string, targetVaultId?: string | null) =>
    dbMode.addRelation(rowId, columnId, targetKind, targetId, targetVaultId ?? null)
  );
  h('db:removeRelation', async (_e, id: string) => {
    dbMode.removeRelation(id);
  });
  h('db:repairRelation', async (_e, id: string, targetId: string, targetVaultId?: string | null) =>
    dbMode.repairRelation(id, targetId, targetVaultId ?? null)
  );
  h('db:cleanupBrokenRelations', async (_e, databaseId: string) => dbMode.cleanupBrokenRelations(databaseId));
  h('db:searchRelationTargets', async (_e, kind: RelationTargetKind, query: string, databaseId?: string) =>
    dbMode.searchRelationTargets(kind, query, { databaseId })
  );
  h('db:pickAndAttach', async (_e, rowId: string, columnId: string) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: dialogTitle('attachFiles', getSettings().uiLanguage),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Todos los archivos', extensions: ['*'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx', 'docx'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { added: 0, attachments: dbMode.listAttachments(rowId, columnId) };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    let added = 0;
    for (const filePath of picked.filePaths) {
      const buf = fs.readFileSync(filePath);
      const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (dbMode.attachmentExists(rowId, columnId, contentHash)) continue;
      let extractedText: string | null = null;
      try {
        const doc = await extractFromPath(filePath, { ocr });
        extractedText = doc.text && doc.text.trim() ? doc.text : null;
      } catch {
        /* non-extractable file (e.g. an image with OCR off) — keep the blob anyway */
      }
      dbMode.addAttachment({
        rowId,
        columnId,
        fileName: path.basename(filePath),
        mimeType: dbGuessMime(path.extname(filePath)),
        bytes: buf.length,
        blob: buf,
        contentHash,
        extractedText,
      });
      added++;
    }
    return { added, attachments: dbMode.listAttachments(rowId, columnId) };
  });
}
