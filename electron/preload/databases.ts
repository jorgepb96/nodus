// databases half of the renderer bridge, paired with electron/ipc/databases.ts.
// Typed as DatabasesApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { DatabasesApi } from '@shared/api/databases';
import { chatStreamRegistry } from './chatStreams';

// Tracks the data-chat streams in flight so cancelDbChat can abort the one of the chat it
// was pressed in. It lived in preload.ts next to the research-chat one; it belongs with
// the bindings that are its only users.
const dbChatStreams = chatStreamRegistry();

// A deterministic latency hook for the isolated notion-parity runner. It is
// deliberately unavailable unless the process also carries the QA-root guard,
// so normal profiles can never enable it through application data or settings.
const qaDatabaseQueryDelayMs = process.env.NODUS_QA_ROOT
  ? Math.min(2_000, Math.max(0, Number.parseInt(process.env.NODUS_QA_DATABASE_QUERY_DELAY_MS ?? '0', 10) || 0))
  : 0;
const qaDatabaseTaskDelayMs = process.env.NODUS_QA_ROOT
  ? Math.min(2_000, Math.max(0, Number.parseInt(process.env.NODUS_QA_DATABASE_TASK_DELAY_MS ?? '0', 10) || 0))
  : 0;
const qaDatabaseAutomationDelayMs = process.env.NODUS_QA_ROOT
  ? Math.min(2_000, Math.max(0, Number.parseInt(process.env.NODUS_QA_DATABASE_AUTOMATION_DELAY_MS ?? '0', 10) || 0))
  : 0;

export const databasesApi: DatabasesApi = {
  // databases mode
  listDatabases: () => ipcRenderer.invoke('db:list'),
  searchDatabases: (query, includeContent) => ipcRenderer.invoke('db:search', query, includeContent),
  searchDatabaseRows: (query, limit) => ipcRenderer.invoke('db:searchRows', query, limit),
  searchDatabaseRowsPage: (input) => ipcRenderer.invoke('db:searchRowsPage', input),
  getDatabase: (id) => ipcRenderer.invoke('db:get', id),
  getDatabaseDetail: (id) => ipcRenderer.invoke('db:detail', id),
  databaseStats: (id) => ipcRenderer.invoke('db:stats', id),
  createDatabase: (name, icon) => ipcRenderer.invoke('db:create', name, icon),
  renameDatabase: (id, name) => ipcRenderer.invoke('db:rename', id, name),
  setDatabaseIcon: (id, icon) => ipcRenderer.invoke('db:setIcon', id, icon),
  deleteDatabase: (id) => ipcRenderer.invoke('db:delete', id).then(() => undefined),
  reorderDatabases: (ids) => ipcRenderer.invoke('db:reorder', ids).then(() => undefined),
  createDatabaseColumn: (databaseId, name, type, config) =>
    ipcRenderer.invoke('db:createColumn', databaseId, name, type, config),
  updateDatabaseColumn: (id, patch) => ipcRenderer.invoke('db:updateColumn', id, patch),
  deleteDatabaseColumn: (id) => ipcRenderer.invoke('db:deleteColumn', id).then(() => undefined),
  reorderDatabaseColumns: (databaseId, ids) => ipcRenderer.invoke('db:reorderColumns', databaseId, ids).then(() => undefined),
  addDatabaseOption: (columnId, label, color, group) => ipcRenderer.invoke('db:addOption', columnId, label, color, group),
  updateDatabaseOption: (id, patch) => ipcRenderer.invoke('db:updateOption', id, patch).then(() => undefined),
  deleteDatabaseOption: (id) => ipcRenderer.invoke('db:deleteOption', id).then(() => undefined),
  reorderDatabaseOptions: (columnId, ids) => ipcRenderer.invoke('db:reorderOptions', columnId, ids).then(() => undefined),
  listDatabaseRows: (databaseId, opts) => ipcRenderer.invoke('db:listRows', databaseId, opts),
  queryDatabaseRows: async (input) => {
    if (qaDatabaseQueryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseQueryDelayMs));
    return ipcRenderer.invoke('db:queryRows', input);
  },
  startQaDatabaseScaleFixture: (input) => ipcRenderer.invoke('qa:db:startScaleFixture', input),
  getQaDatabaseScaleFixtureStatus: (jobId) => ipcRenderer.invoke('qa:db:scaleFixtureStatus', jobId),
  listDatabaseDataSources: () => ipcRenderer.invoke('db:listDataSources'),
  getDatabaseContainer: (viewId) => ipcRenderer.invoke('db:getContainer', viewId),
  listDatabaseViewSources: (viewId) => ipcRenderer.invoke('db:listViewSources', viewId),
  attachDatabaseViewSource: (viewId, databaseId, input) => ipcRenderer.invoke('db:attachViewSource', viewId, databaseId, input ?? {}),
  detachDatabaseViewSource: (viewId, sourceId) => ipcRenderer.invoke('db:detachViewSource', viewId, sourceId).then(() => undefined),
  queryDatabaseContainerRows: async (input) => {
    if (qaDatabaseQueryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseQueryDelayMs));
    return ipcRenderer.invoke('db:queryContainerRows', input);
  },
  recalculateDatabase: (databaseId) => ipcRenderer.invoke('db:recalculate', databaseId),
  getDatabaseCalculationStatus: (databaseId) => ipcRenderer.invoke('db:calculationStatus', databaseId),
  cancelDatabaseCalculation: (jobId) => ipcRenderer.invoke('db:cancelCalculation', jobId),
  onDatabaseCalculationProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('db:calculationProgress', listener);
    return () => ipcRenderer.removeListener('db:calculationProgress', listener);
  },
  getDatabaseRow: (id) => ipcRenderer.invoke('db:getRow', id),
  createDatabaseRow: (databaseId) => ipcRenderer.invoke('db:createRow', databaseId),
  deleteDatabaseRow: (id) => ipcRenderer.invoke('db:deleteRow', id).then(() => undefined),
  listDatabaseRowTemplates: async (databaseId) => {
    if (qaDatabaseTaskDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseTaskDelayMs));
    return ipcRenderer.invoke('db:listRowTemplates', databaseId);
  },
  createDatabaseRowTemplate: (databaseId, input) => ipcRenderer.invoke('db:createRowTemplate', databaseId, input),
  deleteDatabaseRowTemplate: (templateId) => ipcRenderer.invoke('db:deleteRowTemplate', templateId).then(() => undefined),
  instantiateDatabaseRowTemplate: (templateId, occurrenceKey) => ipcRenderer.invoke('db:instantiateRowTemplate', templateId, occurrenceKey ?? null),
  runDueDatabaseRowTemplates: (at, limit) => ipcRenderer.invoke('db:runDueRowTemplates', at, limit),
  duplicateDatabaseRow: (input) => ipcRenderer.invoke('db:duplicateRow', input),
  listDatabaseRowHierarchy: (databaseId, limit) => ipcRenderer.invoke('db:listRowHierarchy', databaseId, limit),
  setDatabaseSubitemParent: (rowId, parentRowId) => ipcRenderer.invoke('db:setSubitemParent', rowId, parentRowId).then(() => undefined),
  setDatabaseSubitemCollapsed: (rowId, collapsed) => ipcRenderer.invoke('db:setSubitemCollapsed', rowId, collapsed).then(() => undefined),
  listDatabaseRowDependencies: (databaseId) => ipcRenderer.invoke('db:listRowDependencies', databaseId),
  addDatabaseRowDependency: (predecessorRowId, successorRowId, lagDays) => ipcRenderer.invoke('db:addRowDependency', predecessorRowId, successorRowId, lagDays),
  removeDatabaseRowDependency: (id) => ipcRenderer.invoke('db:removeRowDependency', id).then(() => undefined),
  getDatabaseTaskConfig: (databaseId) => ipcRenderer.invoke('db:getTaskConfig', databaseId),
  updateDatabaseTaskConfig: (databaseId, patch) => ipcRenderer.invoke('db:updateTaskConfig', databaseId, patch),
  shiftDatabaseTaskDates: (rowId, deltaDays) => ipcRenderer.invoke('db:shiftTaskDates', rowId, deltaDays),
  listDatabaseSprints: (databaseId) => ipcRenderer.invoke('db:listSprints', databaseId),
  createDatabaseSprint: (databaseId, input) => ipcRenderer.invoke('db:createSprint', databaseId, input),
  updateDatabaseSprintState: (sprintId, state) => ipcRenderer.invoke('db:updateSprintState', sprintId, state),
  assignDatabaseRowToSprint: (sprintId, rowId) => ipcRenderer.invoke('db:assignRowToSprint', sprintId, rowId).then(() => undefined),
  listDatabaseAutomationRules: async (databaseId) => {
    if (qaDatabaseAutomationDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseAutomationDelayMs));
    return ipcRenderer.invoke('db:listAutomationRules', databaseId);
  },
  createDatabaseAutomationRule: (databaseId, input) => ipcRenderer.invoke('db:createAutomationRule', databaseId, input),
  updateDatabaseAutomationRule: (ruleId, patch, expectedRevision) => ipcRenderer.invoke('db:updateAutomationRule', ruleId, patch, expectedRevision),
  deleteDatabaseAutomationRule: (ruleId, expectedRevision) => ipcRenderer.invoke('db:deleteAutomationRule', ruleId, expectedRevision),
  runDatabaseAutomationRule: (ruleId, rowId, eventKey) => ipcRenderer.invoke('db:runAutomationRule', ruleId, rowId ?? null, eventKey),
  runDatabaseButtonAutomation: (columnId, rowId) => ipcRenderer.invoke('db:runButtonAutomation', columnId, rowId),
  runDueDatabaseAutomations: (at, limit) => ipcRenderer.invoke('db:runDueAutomations', at, limit),
  listDatabaseAutomationRuns: (databaseId, limit) => ipcRenderer.invoke('db:listAutomationRuns', databaseId, limit),
  listDatabaseAutomationNotifications: (databaseId, limit) => ipcRenderer.invoke('db:listAutomationNotifications', databaseId, limit),
  listDatabaseForms: (databaseId) => ipcRenderer.invoke('db:listForms', databaseId),
  createDatabaseForm: (databaseId, input) => ipcRenderer.invoke('db:createForm', databaseId, input),
  updateDatabaseForm: (formId, input, expectedRevision) => ipcRenderer.invoke('db:updateForm', formId, input, expectedRevision),
  deleteDatabaseForm: (formId, expectedRevision) => ipcRenderer.invoke('db:deleteForm', formId, expectedRevision),
  listDatabaseFormSubmissions: (formId, limit) => ipcRenderer.invoke('db:listFormSubmissions', formId, limit),
  getDatabaseFormServerStatus: () => ipcRenderer.invoke('db:formServerStatus'),
  getDatabaseFormPublicUrl: (slug) => ipcRenderer.invoke('db:formPublicUrl', slug),
  setDatabaseCell: (rowId, columnId, raw) => ipcRenderer.invoke('db:setCell', rowId, columnId, raw),
  setDatabaseCellsBulk: (input) => ipcRenderer.invoke('db:setCellsBulk', input),
  aggregateDatabaseRows: (input) => ipcRenderer.invoke('db:aggregateRows', input),
  queryDatabaseTemporalEvents: async (input) => {
    if (qaDatabaseQueryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseQueryDelayMs));
    return ipcRenderer.invoke('db:queryTemporalEvents', input);
  },
  updateDatabaseTemporalRange: (input) => ipcRenderer.invoke('db:updateTemporalRange', input),
  queryDatabaseChart: async (input) => {
    if (qaDatabaseQueryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseQueryDelayMs));
    return ipcRenderer.invoke('db:queryChart', input);
  },
  queryDatabaseMap: async (input) => {
    if (qaDatabaseQueryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseQueryDelayMs));
    return ipcRenderer.invoke('db:queryMap', input);
  },
  queryDatabaseFeed: async (input) => {
    if (qaDatabaseQueryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaDatabaseQueryDelayMs));
    return ipcRenderer.invoke('db:queryFeed', input);
  },
  exportDatabaseChart: (input) => ipcRenderer.invoke('db:exportChart', input),
  runDatabaseComparisonCell: (rowId, columnId) => ipcRenderer.invoke('db:runComparisonCell', rowId, columnId),
  runDatabaseComparisonColumn: (databaseId, columnId) => ipcRenderer.invoke('db:runComparisonColumn', databaseId, columnId),
  onDatabaseComparisonProgress: (cb) => {
    const listener = (
      _e: unknown,
      payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }
    ) => cb(payload);
    ipcRenderer.on('db:comparisonProgress', listener);
    return () => ipcRenderer.removeListener('db:comparisonProgress', listener);
  },
  listDatabaseAttachments: (rowId, columnId) => ipcRenderer.invoke('db:listAttachments', rowId, columnId),
  getDatabaseAttachmentBlob: (id) => ipcRenderer.invoke('db:getAttachmentBlob', id),
  getDatabaseAttachmentThumb: (id) => ipcRenderer.invoke('db:getAttachmentThumb', id),
  deleteDatabaseAttachment: (id) => ipcRenderer.invoke('db:deleteAttachment', id).then(() => undefined),
  downloadDatabaseAttachment: (id) => ipcRenderer.invoke('db:downloadAttachment', id),
  pickAndAttachDatabaseFiles: (rowId, columnId) => ipcRenderer.invoke('db:pickAndAttach', rowId, columnId),
  runDatabaseAiCell: (rowId, columnId) => ipcRenderer.invoke('db:runAiCell', rowId, columnId),
  runDatabaseAiColumn: (databaseId, columnId) => ipcRenderer.invoke('db:runAiColumn', databaseId, columnId),
  generateDatabaseAiImage: (rowId, columnId) => ipcRenderer.invoke('db:generateAiImage', rowId, columnId),
  generateDatabaseAiImageColumn: (databaseId, columnId) => ipcRenderer.invoke('db:generateAiImageColumn', databaseId, columnId),
  onDatabaseAiProgress: (cb) => {
    const listener = (
      _e: unknown,
      payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }
    ) => cb(payload);
    ipcRenderer.on('db:aiProgress', listener);
    return () => ipcRenderer.removeListener('db:aiProgress', listener);
  },
  listDatabaseRelations: (rowId, columnId) => ipcRenderer.invoke('db:listRelations', rowId, columnId),
  addDatabaseRelation: (rowId, columnId, targetKind, targetId, targetVaultId) =>
    ipcRenderer.invoke('db:addRelation', rowId, columnId, targetKind, targetId, targetVaultId),
  removeDatabaseRelation: (id) => ipcRenderer.invoke('db:removeRelation', id).then(() => undefined),
  repairDatabaseRelation: (id, targetId, targetVaultId) => ipcRenderer.invoke('db:repairRelation', id, targetId, targetVaultId),
  cleanupBrokenDatabaseRelations: (databaseId) => ipcRenderer.invoke('db:cleanupBrokenRelations', databaseId),
  searchDatabaseRelationTargets: (kind, query, databaseId) => ipcRenderer.invoke('db:searchRelationTargets', kind, query, databaseId),
  parseCsvForImport: () => ipcRenderer.invoke('db:parseCsvForImport'),
  createDatabaseFromCsv: (name, headers, rows, types) => ipcRenderer.invoke('db:createFromCsv', name, headers, rows, types),
  createDatabaseFromCsvToken: (token, name, types) => ipcRenderer.invoke('db:createFromCsvToken', token, name, types),
  releaseCsvImport: (token) => ipcRenderer.invoke('db:releaseCsvImport', token).then(() => undefined),
  importNotionZip: () => ipcRenderer.invoke('db:importNotionZip'),
  onCsvImportProgress: (cb) => {
    const listener = (_e: unknown, payload: { done: number; total: number; finished: boolean }) => cb(payload);
    ipcRenderer.on('db:csvImportProgress', listener);
    return () => ipcRenderer.removeListener('db:csvImportProgress', listener);
  },
  exportDatabase: (databaseId, format) => ipcRenderer.invoke('db:export', databaseId, format),
  getDatabaseProfile: (databaseId) => ipcRenderer.invoke('db:profile', databaseId),
  analyzeDatabaseReport: (databaseId) => ipcRenderer.invoke('db:analyzeReport', databaseId),
  suggestDatabaseAnalyses: (databaseId) => ipcRenderer.invoke('db:suggestAnalyses', databaseId),
  runDatabaseAnalysis: (databaseId, request) => ipcRenderer.invoke('db:runAnalysis', databaseId, request),
  narrateDatabaseAnalysis: (result) => ipcRenderer.invoke('db:narrateAnalysis', result),
  previewDatabaseDeepResearch: (input) => ipcRenderer.invoke('db:deepResearch:preview', input),
  enqueueDatabaseDeepResearch: (input) => ipcRenderer.invoke('db:deepResearch:enqueue', input),
  getDatabaseDeepResearchJob: (id) => ipcRenderer.invoke('db:deepResearch:job:get', id),
  clearFinishedDatabaseDeepResearchJobs: () => ipcRenderer.invoke('db:deepResearch:jobs:clear'),
  deleteDatabaseDeepResearchReport: (id) => ipcRenderer.invoke('db:deepResearch:report:delete', id),
  exportDatabaseDeepResearchReport: (id, options) => ipcRenderer.invoke('db:deepResearch:report:export', id, options),
  onDatabaseDeepResearchProgress: (cb) => {
    const listener = (_e: unknown, progress: import('@shared/databaseDeepResearch').DatabaseResearchProgress) => cb(progress);
    ipcRenderer.on('db:deepResearch:progress', listener);
    return () => ipcRenderer.removeListener('db:deepResearch:progress', listener);
  },
  listDatabaseDeepResearchJobs: () => ipcRenderer.invoke('db:deepResearch:jobs:list'),
  listDatabaseDeepResearchReports: (query) => ipcRenderer.invoke('db:deepResearch:reports:list', query),
  getDatabaseDeepResearchReport: (id) => ipcRenderer.invoke('db:deepResearch:report:get', id),
  setDatabaseDeepResearchReportRead: (id, read) => ipcRenderer.invoke('db:deepResearch:report:read', id, read),
  listDatabaseDeepResearchReportAnnotations: (reportId) => ipcRenderer.invoke('db:deepResearch:report:annotations:list', reportId),
  createDatabaseDeepResearchReportAnnotation: (input) => ipcRenderer.invoke('db:deepResearch:report:annotations:create', input),
  updateDatabaseDeepResearchReportComment: (id, comment) => ipcRenderer.invoke('db:deepResearch:report:annotations:updateComment', id, comment),
  deleteDatabaseDeepResearchReportAnnotation: (id) => ipcRenderer.invoke('db:deepResearch:report:annotations:delete', id).then(() => undefined),
  onDatabaseDeepResearchReportAnnotationsChanged: (cb) => {
    const listener = (_e: unknown, reportId: string | null) => cb(reportId);
    ipcRenderer.on('db:deepResearch:report:annotations:changed', listener);
    return () => ipcRenderer.removeListener('db:deepResearch:report:annotations:changed', listener);
  },
  cancelDatabaseDeepResearchJob: (id) => ipcRenderer.invoke('db:deepResearch:job:cancel', id),
  dbChatStream: async (request, handlers) => {
    const requestId = `db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('db:chatStream:delta', onDelta);
    const untrack = dbChatStreams.track(requestId, request.conversationId);
    try {
      return await ipcRenderer.invoke('db:chatStream', requestId, request);
    } finally {
      untrack();
      ipcRenderer.removeListener('db:chatStream:delta', onDelta);
    }
  },
  cancelDbChat: async (conversationId) => {
    const requestId = dbChatStreams.find(conversationId);
    if (requestId) await ipcRenderer.invoke('db:chatStream:cancel', requestId);
  },
  listDatabaseChatConversations: (includeArchived) => ipcRenderer.invoke('db:chatHistory:list', includeArchived),
  getDatabaseChatConversation: (id) => ipcRenderer.invoke('db:chatHistory:get', id),
  createDatabaseChatConversation: (input) => ipcRenderer.invoke('db:chatHistory:create', input),
  saveDatabaseChatConversation: (id, messages, databaseIds) => ipcRenderer.invoke('db:chatHistory:save', id, messages, databaseIds),
  deleteDatabaseChatConversation: (id) => ipcRenderer.invoke('db:chatHistory:delete', id).then(() => undefined),
  listDatabaseViews: (databaseId) => ipcRenderer.invoke('db:listViews', databaseId),
  createDatabaseView: (databaseId, input) => ipcRenderer.invoke('db:createView', databaseId, input),
  updateDatabaseView: (id, patch) => ipcRenderer.invoke('db:updateView', id, patch),
  duplicateDatabaseView: (id, name) => ipcRenderer.invoke('db:duplicateView', id, name),
  linkDatabaseView: (id, name, scope) => ipcRenderer.invoke('db:linkView', id, name, scope),
  reorderDatabaseViews: (databaseId, ids) => ipcRenderer.invoke('db:reorderViews', databaseId, ids),
  listDatabaseViewRevisions: (id) => ipcRenderer.invoke('db:listViewRevisions', id),
  restoreDatabaseViewRevision: (id, revision, expectedRevision) =>
    ipcRenderer.invoke('db:restoreViewRevision', id, revision, expectedRevision),
  deleteDatabaseView: (id) => ipcRenderer.invoke('db:deleteView', id).then(() => undefined),
  pickBulkDatabaseFiles: (mode) => ipcRenderer.invoke('db:pickBulkFiles', mode ?? 'files'),
  bulkAttachDatabaseFiles: (databaseId, refColumnId, attachmentColumnId, files, options) =>
    ipcRenderer.invoke('db:bulkAttach', databaseId, refColumnId, attachmentColumnId, files, options ?? {}),
  onDatabaseBulkProgress: (cb) => {
    const listener = (
      _e: unknown,
      payload: { databaseId: string; done: number; total: number; attached: number; matched: number; finished: boolean }
    ) => cb(payload);
    ipcRenderer.on('db:bulkProgress', listener);
    return () => ipcRenderer.removeListener('db:bulkProgress', listener);
  },
};
