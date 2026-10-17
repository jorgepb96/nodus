// The databases slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { CsvImportPlanData } from '../databaseCsv';
import type { BulkAttachOptions } from '../databaseBulk';
import type { DatabaseAttachment, DatabaseCalculationProgress, DatabaseColumn, DatabaseColumnConfig, DatabaseColumnType, DatabaseDetail, DatabaseRelation, DatabaseRow, DatabaseRowHit, DatabaseRowSort, DatabaseSearchHit, DatabaseSelectOption, DatabaseSummary, RelationTarget, RelationTargetKind } from '../databases';
import type { DatabaseSavedView, DatabaseViewRevision, SavedViewInput, SavedViewPatch } from '../databaseFilters';
import type { DatabaseRowPage, DatabaseRowQuery, DatabaseRowSearchPage, DatabaseRowSearchQuery } from '../databaseQuery';
import type { DatabaseAggregateQuery, DatabaseAggregateResult, DatabaseBulkEditInput, DatabaseBulkEditResult } from '../databaseTableOps';
import type { DatabaseTemporalEventPage, DatabaseTemporalQuery, DatabaseTemporalRangeUpdate, DatabaseTemporalRangeUpdateResult } from '../databaseTemporal';
import type { DatabaseChartExportInput, DatabaseChartQuery, DatabaseChartResult, DatabaseFeedQuery, DatabaseFeedResult, DatabaseMapQuery, DatabaseMapResult } from '../databaseVisualization';
import type { AttachDatabaseViewSourceInput, DatabaseContainerDefinition, DatabaseContainerRowPage, DatabaseContainerRowQuery, DatabaseDataSource, DatabaseViewDataSource } from '../databaseSources';
import type { CreateDatabaseRowTemplateInput, DatabaseDuplicateRowInput, DatabaseRowDependency, DatabaseRowHierarchyItem, DatabaseRowTemplate, DatabaseSprint, DatabaseSprintState, DatabaseTaskConfig, DatabaseTaskDateChange, DatabaseTemplateInstantiation } from '../databaseTasks';
import type { AutomationRule, AutomationRuleMutationResult, AutomationRun, CreateAutomationRuleInput, CreateFormDefinitionInput, DatabaseFormServerStatus, DatabaseFormSubmission, FormDefinition, FormDefinitionMutationResult } from '../databaseAutomations';
import type { DatabaseProfile } from '../dataProfile';
import type { NotionImportReport } from '../notionImport';
import type { DbChatTurn } from '../databaseChat';
import type { AnalysisRequest, AnalysisResult, AnalysisSuggestion } from '../analysisSpec';
import type { QaDatabaseScaleFixtureInput, QaDatabaseScaleFixtureStatus } from '../databaseScaleQa';
import type {
  DatabaseResearchProgress,
  DatabaseResearchReport,
  DatabaseDeepResearchJob,
  DatabaseDeepResearchJobInput,
  DatabaseDeepResearchPreview,
  DatabaseDeepResearchReportType,
  DatabaseDeepResearchReportAnnotation,
  DatabaseDeepResearchReportAnnotationInput,
  DatabaseResearchReportQuery,
} from '../databaseDeepResearch';
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  DatabaseChatConversation,
  DatabaseChatConversationSummary,
  DatabaseChatRequest,
} from '../types';

export interface DatabasesApi {
  // databases mode (Notion-like structured data)
  listDatabases(): Promise<DatabaseSummary[]>;
  searchDatabases(query: string, includeContent: boolean): Promise<DatabaseSearchHit[]>;
  searchDatabaseRows(query: string, limit?: number): Promise<DatabaseRowHit[]>;
  searchDatabaseRowsPage(input: DatabaseRowSearchQuery): Promise<DatabaseRowSearchPage>;
  getDatabase(id: string): Promise<DatabaseSummary | null>;
  getDatabaseDetail(id: string): Promise<DatabaseDetail | null>;
  databaseStats(id: string): Promise<{ rowCount: number; vaultTotal: number; percent: number }>;
  createDatabase(name: string, icon?: string | null): Promise<DatabaseSummary>;
  renameDatabase(id: string, name: string): Promise<DatabaseSummary | null>;
  setDatabaseIcon(id: string, icon: string | null): Promise<DatabaseSummary | null>;
  deleteDatabase(id: string): Promise<void>;
  reorderDatabases(ids: string[]): Promise<void>;
  createDatabaseColumn(
    databaseId: string,
    name: string,
    type: DatabaseColumnType,
    config?: DatabaseColumnConfig
  ): Promise<DatabaseColumn>;
  updateDatabaseColumn(
    id: string,
    patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }
  ): Promise<DatabaseColumn | null>;
  deleteDatabaseColumn(id: string): Promise<void>;
  reorderDatabaseColumns(databaseId: string, ids: string[]): Promise<void>;
  addDatabaseOption(
    columnId: string,
    label: string,
    color?: string | null,
    group?: DatabaseSelectOption['group'],
  ): Promise<DatabaseSelectOption>;
  updateDatabaseOption(
    id: string,
    patch: { label?: string; color?: string | null; group?: DatabaseSelectOption['group'] },
  ): Promise<void>;
  deleteDatabaseOption(id: string): Promise<void>;
  reorderDatabaseOptions(columnId: string, ids: string[]): Promise<void>;
  listDatabaseRows(
    databaseId: string,
    opts?: { sort?: DatabaseRowSort; limit?: number; offset?: number }
  ): Promise<DatabaseRow[]>;
  queryDatabaseRows(input: DatabaseRowQuery): Promise<DatabaseRowPage>;
  /** QA-only: hard-disabled unless the active vault and userData are below NODUS_QA_ROOT. */
  startQaDatabaseScaleFixture(input: QaDatabaseScaleFixtureInput): Promise<{ jobId: string; databaseId: string }>;
  getQaDatabaseScaleFixtureStatus(jobId: string): Promise<QaDatabaseScaleFixtureStatus | null>;
  listDatabaseDataSources(): Promise<DatabaseDataSource[]>;
  getDatabaseContainer(viewId: string): Promise<DatabaseContainerDefinition | null>;
  listDatabaseViewSources(viewId: string): Promise<DatabaseViewDataSource[]>;
  attachDatabaseViewSource(viewId: string, databaseId: string, input?: AttachDatabaseViewSourceInput): Promise<DatabaseViewDataSource>;
  detachDatabaseViewSource(viewId: string, sourceId: string): Promise<void>;
  queryDatabaseContainerRows(input: DatabaseContainerRowQuery): Promise<DatabaseContainerRowPage>;
  recalculateDatabase(databaseId: string): Promise<{ jobId: string }>;
  getDatabaseCalculationStatus(databaseId: string): Promise<DatabaseCalculationProgress | null>;
  cancelDatabaseCalculation(jobId: string): Promise<boolean>;
  onDatabaseCalculationProgress(cb: (progress: DatabaseCalculationProgress) => void): () => void;
  getDatabaseRow(id: string): Promise<DatabaseRow | null>;
  createDatabaseRow(databaseId: string): Promise<DatabaseRow>;
  deleteDatabaseRow(id: string): Promise<void>;
  listDatabaseRowTemplates(databaseId: string): Promise<DatabaseRowTemplate[]>;
  createDatabaseRowTemplate(databaseId: string, input: CreateDatabaseRowTemplateInput): Promise<DatabaseRowTemplate>;
  deleteDatabaseRowTemplate(templateId: string): Promise<void>;
  instantiateDatabaseRowTemplate(templateId: string, occurrenceKey?: string | null): Promise<DatabaseTemplateInstantiation>;
  runDueDatabaseRowTemplates(at?: string, limit?: number): Promise<DatabaseTemplateInstantiation[]>;
  duplicateDatabaseRow(input: DatabaseDuplicateRowInput): Promise<DatabaseTemplateInstantiation>;
  listDatabaseRowHierarchy(databaseId: string, limit?: number): Promise<DatabaseRowHierarchyItem[]>;
  setDatabaseSubitemParent(rowId: string, parentRowId: string | null): Promise<void>;
  setDatabaseSubitemCollapsed(rowId: string, collapsed: boolean): Promise<void>;
  listDatabaseRowDependencies(databaseId: string): Promise<DatabaseRowDependency[]>;
  addDatabaseRowDependency(predecessorRowId: string, successorRowId: string, lagDays?: number): Promise<DatabaseRowDependency>;
  removeDatabaseRowDependency(id: string): Promise<void>;
  getDatabaseTaskConfig(databaseId: string): Promise<DatabaseTaskConfig>;
  updateDatabaseTaskConfig(databaseId: string, patch: Partial<Omit<DatabaseTaskConfig, 'databaseId' | 'revision' | 'updatedAt'>>): Promise<DatabaseTaskConfig>;
  shiftDatabaseTaskDates(rowId: string, deltaDays: number): Promise<DatabaseTaskDateChange[]>;
  listDatabaseSprints(databaseId: string): Promise<DatabaseSprint[]>;
  createDatabaseSprint(databaseId: string, input: { name: string; startAt: string; endAt: string }): Promise<DatabaseSprint>;
  updateDatabaseSprintState(sprintId: string, state: DatabaseSprintState): Promise<DatabaseSprint>;
  assignDatabaseRowToSprint(sprintId: string, rowId: string): Promise<void>;
  listDatabaseAutomationRules(databaseId: string): Promise<AutomationRule[]>;
  createDatabaseAutomationRule(databaseId: string, input: CreateAutomationRuleInput): Promise<AutomationRule>;
  updateDatabaseAutomationRule(ruleId: string, patch: Partial<CreateAutomationRuleInput>, expectedRevision: number): Promise<AutomationRuleMutationResult>;
  deleteDatabaseAutomationRule(ruleId: string, expectedRevision: number): Promise<boolean>;
  runDatabaseAutomationRule(ruleId: string, rowId?: string | null, eventKey?: string): Promise<AutomationRun>;
  runDatabaseButtonAutomation(columnId: string, rowId: string): Promise<AutomationRun[]>;
  runDueDatabaseAutomations(at?: string, limit?: number): Promise<AutomationRun[]>;
  listDatabaseAutomationRuns(databaseId: string, limit?: number): Promise<AutomationRun[]>;
  listDatabaseAutomationNotifications(databaseId: string, limit?: number): Promise<Array<{ id: string; ruleId: string | null; runId: string | null; rowId: string | null; title: string; body: string; isRead: boolean; createdAt: string }>>;
  listDatabaseForms(databaseId: string): Promise<FormDefinition[]>;
  createDatabaseForm(databaseId: string, input: CreateFormDefinitionInput): Promise<FormDefinition>;
  updateDatabaseForm(formId: string, input: CreateFormDefinitionInput, expectedRevision: number): Promise<FormDefinitionMutationResult>;
  deleteDatabaseForm(formId: string, expectedRevision: number): Promise<boolean>;
  listDatabaseFormSubmissions(formId: string, limit?: number): Promise<DatabaseFormSubmission[]>;
  getDatabaseFormServerStatus(): Promise<DatabaseFormServerStatus>;
  getDatabaseFormPublicUrl(slug: string): Promise<string | null>;
  setDatabaseCell(rowId: string, columnId: string, raw: string | null): Promise<DatabaseRow | null>;
  setDatabaseCellsBulk(input: DatabaseBulkEditInput): Promise<DatabaseBulkEditResult>;
  aggregateDatabaseRows(input: DatabaseAggregateQuery): Promise<DatabaseAggregateResult>;
  queryDatabaseTemporalEvents(input: DatabaseTemporalQuery): Promise<DatabaseTemporalEventPage>;
  updateDatabaseTemporalRange(input: DatabaseTemporalRangeUpdate): Promise<DatabaseTemporalRangeUpdateResult>;
  queryDatabaseChart(input: DatabaseChartQuery): Promise<DatabaseChartResult>;
  queryDatabaseMap(input: DatabaseMapQuery): Promise<DatabaseMapResult>;
  queryDatabaseFeed(input: DatabaseFeedQuery): Promise<DatabaseFeedResult>;
  exportDatabaseChart(input: DatabaseChartExportInput): Promise<{ canceled: boolean; path: string | null }>;
  runDatabaseComparisonCell(rowId: string, columnId: string): Promise<DatabaseRow | null>;
  runDatabaseComparisonColumn(databaseId: string, columnId: string): Promise<{ done: number }>;
  onDatabaseComparisonProgress(
    cb: (payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }) => void
  ): () => void;
  listDatabaseAttachments(rowId: string, columnId: string): Promise<DatabaseAttachment[]>;
  getDatabaseAttachmentBlob(id: string): Promise<Uint8Array | null>;
  /**
   * The attachment's downscaled preview, falling back to the original when there is none.
   * `mimeType` describes the returned bytes, which is not the attachment's own type when a
   * thumb was generated.
   */
  getDatabaseAttachmentThumb(id: string): Promise<{ bytes: Uint8Array; mimeType: string | null } | null>;
  deleteDatabaseAttachment(id: string): Promise<void>;
  downloadDatabaseAttachment(id: string): Promise<{ canceled: boolean; path: string | null }>;
  pickAndAttachDatabaseFiles(
    rowId: string,
    columnId: string
  ): Promise<{ added: number; attachments: DatabaseAttachment[] }>;
  runDatabaseAiCell(rowId: string, columnId: string): Promise<string>;
  runDatabaseAiColumn(databaseId: string, columnId: string): Promise<{ done: number; failed: number }>;
  generateDatabaseAiImage(rowId: string, columnId: string): Promise<DatabaseAttachment>;
  generateDatabaseAiImageColumn(databaseId: string, columnId: string): Promise<{ done: number; failed: number }>;
  onDatabaseAiProgress(
    cb: (payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }) => void
  ): () => void;
  listDatabaseRelations(rowId: string, columnId: string): Promise<DatabaseRelation[]>;
  addDatabaseRelation(
    rowId: string,
    columnId: string,
    targetKind: RelationTargetKind,
    targetId: string,
    targetVaultId?: string | null
  ): Promise<DatabaseRelation>;
  removeDatabaseRelation(id: string): Promise<void>;
  repairDatabaseRelation(id: string, targetId: string, targetVaultId?: string | null): Promise<DatabaseRelation>;
  cleanupBrokenDatabaseRelations(databaseId: string): Promise<{ removed: number }>;
  searchDatabaseRelationTargets(
    kind: RelationTargetKind,
    query: string,
    databaseId?: string
  ): Promise<RelationTarget[]>;
  parseCsvForImport(): Promise<CsvImportPlanData | null>;
  createDatabaseFromCsv(
    name: string,
    headers: string[],
    rows: string[][],
    types: (DatabaseColumnType | null)[]
  ): Promise<DatabaseSummary>;
  /** Import the CSV held in the main process behind `token`. A null type discards the column. */
  createDatabaseFromCsvToken(
    token: string,
    name: string,
    types: (DatabaseColumnType | null)[]
  ): Promise<DatabaseSummary>;
  /** Drop a parsed CSV the user decided not to import, so its rows stop occupying memory. */
  releaseCsvImport(token: string): Promise<void>;
  onCsvImportProgress(cb: (p: { done: number; total: number; finished: boolean }) => void): () => void;
  importNotionZip(): Promise<NotionImportReport | null>;
  exportDatabase(databaseId: string, format: 'csv' | 'json' | 'xlsx'): Promise<{
    canceled: boolean;
    path?: string;
    metrics?: { rows: number; maxPageRows: number; bytes: number } | null;
  }>;
  getDatabaseProfile(databaseId: string): Promise<{ databaseName: string; profile: DatabaseProfile } | null>;
  analyzeDatabaseReport(databaseId: string): Promise<{ databaseName: string; profileText: string; report: string }>;
  suggestDatabaseAnalyses(databaseId: string): Promise<{ databaseName: string; suggestions: AnalysisSuggestion[] }>;
  runDatabaseAnalysis(databaseId: string, request: AnalysisRequest): Promise<{ databaseName: string; request: AnalysisRequest; result: AnalysisResult }>;
  narrateDatabaseAnalysis(result: AnalysisResult): Promise<string>;
  previewDatabaseDeepResearch(input: DatabaseDeepResearchJobInput): Promise<DatabaseDeepResearchPreview>;
  enqueueDatabaseDeepResearch(input: DatabaseDeepResearchJobInput): Promise<DatabaseDeepResearchJob>;
  listDatabaseDeepResearchJobs(): Promise<DatabaseDeepResearchJob[]>;
  getDatabaseDeepResearchJob(id: string): Promise<DatabaseDeepResearchJob | null>;
  cancelDatabaseDeepResearchJob(id: string): Promise<boolean>;
  clearFinishedDatabaseDeepResearchJobs(): Promise<number>;
  listDatabaseDeepResearchReports(query?: DatabaseResearchReportQuery & { reportType?: DatabaseDeepResearchReportType }): Promise<DatabaseResearchReport[]>;
  getDatabaseDeepResearchReport(id: string): Promise<DatabaseResearchReport | null>;
  setDatabaseDeepResearchReportRead(id: string, read: boolean): Promise<DatabaseResearchReport | null>;
  listDatabaseDeepResearchReportAnnotations(reportId: string): Promise<DatabaseDeepResearchReportAnnotation[]>;
  createDatabaseDeepResearchReportAnnotation(input: DatabaseDeepResearchReportAnnotationInput): Promise<DatabaseDeepResearchReportAnnotation>;
  updateDatabaseDeepResearchReportComment(id: string, comment: string): Promise<DatabaseDeepResearchReportAnnotation | null>;
  deleteDatabaseDeepResearchReportAnnotation(id: string): Promise<void>;
  onDatabaseDeepResearchReportAnnotationsChanged(cb: (reportId: string | null) => void): () => void;
  deleteDatabaseDeepResearchReport(id: string): Promise<boolean>;
  exportDatabaseDeepResearchReport(
    id: string,
    options: import('../databaseDeepResearch').DatabaseDeepResearchExportOptions,
  ): Promise<{ canceled: boolean; path: string | null }>;
  onDatabaseDeepResearchProgress(cb: (progress: DatabaseResearchProgress) => void): () => void;
  dbChatStream(request: DatabaseChatRequest, handlers: { onDelta: (delta: string) => void }): Promise<{ text: string; aborted?: boolean }>;
  /** Without a conversation, aborts the stream started last. */
  cancelDbChat(conversationId?: string): Promise<void>;
  /** Archived chats only when asked for. */
  listDatabaseChatConversations(includeArchived?: boolean): Promise<DatabaseChatConversationSummary[]>;
  getDatabaseChatConversation(id: string): Promise<DatabaseChatConversation | null>;
  /** A chat may start in a project (and a folder of it) or in a notebook. */
  createDatabaseChatConversation(input: { title: string; databaseIds: string[]; projectId?: string | null; folderId?: string | null; notebookId?: string | null }): Promise<DatabaseChatConversation>;
  saveDatabaseChatConversation(id: string, messages: DbChatTurn[], databaseIds: string[]): Promise<DatabaseChatConversation | null>;
  deleteDatabaseChatConversation(id: string): Promise<void>;
  listDatabaseViews(databaseId: string): Promise<DatabaseSavedView[]>;
  createDatabaseView(databaseId: string, input: SavedViewInput): Promise<DatabaseSavedView>;
  updateDatabaseView(id: string, patch: SavedViewPatch): Promise<DatabaseSavedView | null>;
  duplicateDatabaseView(id: string, name?: string): Promise<DatabaseSavedView | null>;
  linkDatabaseView(id: string, name?: string, scope?: 'personal' | 'shared'): Promise<DatabaseSavedView | null>;
  reorderDatabaseViews(databaseId: string, ids: string[]): Promise<DatabaseSavedView[]>;
  listDatabaseViewRevisions(id: string): Promise<DatabaseViewRevision[]>;
  restoreDatabaseViewRevision(id: string, revision: number, expectedRevision?: number): Promise<DatabaseSavedView | null>;
  deleteDatabaseView(id: string): Promise<void>;
  pickBulkDatabaseFiles(mode?: 'files' | 'folder'): Promise<{ name: string; path: string }[]>;
  bulkAttachDatabaseFiles(
    databaseId: string,
    refColumnId: string,
    attachmentColumnId: string,
    files: { name: string; path: string }[],
    options?: BulkAttachOptions
  ): Promise<{ attached: number; matched: number; unmatched: number }>;
  onDatabaseBulkProgress(
    cb: (payload: { databaseId: string; done: number; total: number; attached: number; matched: number; finished: boolean }) => void
  ): () => void;
}
