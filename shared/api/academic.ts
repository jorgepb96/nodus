import type { StellarPageRequest, StellarPage, StellarSession, StellarTheme } from '../stellarGraph';
// The academic and study slice of the window.nodus contract. NodusApi extends it,
// so the renderer surface stays flat and every call site is unchanged.
import type { StudyAnnotation, StudyAnnotationInput, StudyDocEditorData, StudyDocUpdateInput } from '../studyEditor';
import type { StudySttRequest, StudySttResult, StudySttStreamHandlers, WhisperCppStatus } from '../sttModels';
import type { StudyImproveRequest, StudyImproveResult, StudyImproveStreamHandlers, StudyImprovementLog, StudyStyle, StudyStyleAssociation, StudyStyleAssociationKind, StudyStyleInput, StudyStyleVersion } from '../studyImprove';
import type { StudySynonymRequest, StudySynonymResult } from '../studySynonyms';
import type { StudyMaterialAnnotation, StudyMaterialAnnotationInput, StudyMaterialContent, StudyMaterialDetail, StudyMaterialImportInput, StudyMaterialImportResult, StudyMaterialIndexResult, StudyMaterialListOptions, StudyMaterialPlacement, StudyMaterialSummary, StudyMaterialUpdateInput, ZoteroStudyMaterialImportInput } from '../studyMaterials';
import type { StudyAudioMarker, StudyAudioMarkerInput, StudyDiarizationRequest, StudyDiarizationResult, StudyRecordingContent, StudyRecordingCreateInput, StudyRecordingDetail, StudyRecordingImportResult, StudyRecordingListOptions, StudyRecordingSummary, StudyRecordingUpdateInput, StudyTranscript, StudyTranscriptInput, StudyTranscriptSegment, StudyTranscriptSegmentInput } from '../studyRecordings';
import type { StudySavedSearch, StudySearchHistoryEntry, StudySearchIndexStatus, StudySearchOptions, StudySearchProgress, StudySearchResponse } from '../studySearch';
import type { StudyAssistantConversation, StudyAssistantConversationInput, StudyAssistantConversationPatch, StudyAssistantConversationSummary, StudyAssistantRequest, StudyAssistantResponse, StudyAssistantSourceOption, StudyAssistantStreamHandlers } from '../studyAssistant';
import type { StudyQuestion, StudyQuestionBulkAction, StudyQuestionCollection, StudyQuestionFilters, StudyQuestionGenerationRequest, StudyQuestionGenerationResult, StudyQuestionInput, StudyQuestionVersion, StudyQuestionAnalytics, StudyQuestionSimilar } from '../studyQuestions';
import type { StudyAssessment, StudyAssessmentInput, StudyAttempt, StudyAttemptAnswer, StudyAttemptAnswerInput, StudyAttemptStartInput, StudyTestBuildRequest } from '../studyAssessments';
import type { StudyGradingRun, StudyRubric, StudyRubricInput } from '../studyGrading';
import type { StudyFlashcard, StudyFlashcardBulkAction, StudyFlashcardExport, StudyFlashcardFilters, StudyFlashcardInput, StudyReviewInput, StudyReviewRecord } from '../studyFlashcards';
import type { StudyInterchangeExportOptions, StudyInterchangeFormat, StudyInterchangeImportOptions, StudyInterchangeKind, StudyInterchangeSummary } from '../studyInterchange';
import type { StudyProgressDashboard } from '../studyStats';
import type { StudyCalendarEvent, StudyCalendarEventInput, StudyGoal, StudyPlan, StudyPlanBlock, StudyPlannerSnapshot, StudyStudySession } from '../studyPlanner';
import type { AppleCalendarDestination, AppleCalendarSyncStatus } from '../appleCalendar';
import type { StudyAiUsage, StudyAiUsageSummary } from '../studyAi';
import type { StudySchedule } from '../studySchedule';
import type {
  DictionaryDuplicateMatch,
  DictionaryEntry,
  DictionaryEntryDetail,
  DictionaryEntryInput,
  DictionaryEntryPage,
  DictionaryEntryPatch,
  DictionaryEvidenceDecision,
  DictionaryEvidencePage,
  DictionaryEvidenceRef,
  DictionaryEvidenceRequest,
  DictionaryFacets,
  DictionaryGenerationRequest,
  DictionaryProgress,
  DictionaryListRequest,
  DictionaryRelation,
  DictionaryRelationType,
  DictionaryVersion,
} from '../dictionary';
import type { StudyMaterialAiProcessingDecision, StudyMaterialAiProcessingPrompt, StudyIdeaDetail, StudyIdeaSummary, StudyKnowledgeGraph, StudyKnowledgeJob, StudyKnowledgeProgress } from '../studyKnowledge';
import type { CreateStudyCourseInput, CreateStudyDocumentInput, CreateStudyFolderInput, CreateStudySubjectInput, CreateStudyTagInput, CreateStudyTemplateInput, CreateStudyTopicInput, StudyCourse, StudyDocument, StudyEntityMoveInput, StudyEntityKind, StudyFolder, StudyLifecycleAction, StudyPlacement, StudyPlacementInput, StudySubject, StudyTag, StudyTemplate, StudyTopic, StudyWorkspace, StudyWorkspaceOptions } from '../studyOrg';
import type { CreateStudyAcademicYearInput, StudyAcademicYear, UpdateStudyAcademicYearInput } from '../studyAcademicYears';// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  AddProjectLinkInput,
  AnalyzeChapterRelationsRequest,
  ApplyManuscriptCitationRequest,
  ApplyManuscriptCitationResult,
  ApplyProjectSuggestionsRequest,
  ArgumentMap,
  ArgumentMapRequest,
  ArgumentRouteSuggestion,
  AuthorDossier,
  AuthorDossierSynthesis,
  AuthorPage,
  AuthorPageRequest,
  AuthorSummary,
  AuthorSynthesisExportRequest,
  AutoIndexResult,
  ChapterRelationsProgress,
  ChapterRelationsResult,
  ChapterSuggestionStatus,
  ChatConversation,
  ChatConversationSummary,
  ResearchChatProject,
  ResearchChatProjectFolder,
  ChatHistoryNotebook,
  ChatHistoryNotebookSurface,
  ChatHistorySurface,
  ChatMessageRecord,
  CitationPreview,
  CitationRef,
  CollectionFacet,
  CorpusHealth,
  CreateNoteFolderInput,
  CreateNoteInput,
  CreateProjectInput,
  Debate,
  DebateAnalysisRequest,
  DebateAnalysisResponse,
  DebateAnalysisStreamHandlers,
  DeepResearchArchiveRequest,
  DeepResearchArchiveResult,
  DeepResearchJobRecord,
  DeepResearchReport,
  DeepResearchRequest,
  DeepResearchStreamHandlers,
  DuplicateIdeaGroup,
  DuplicateWorkGroup,
  DocumentIndexCampaign,
  DocumentIndexProgress,
  DocumentProfile,
  DocumentProfileOverride,
  DocumentUnderstandingState,
  EdgeDetail,
  EdgeFeedbackVerdict,
  EdgeFeedbackView,
  EmbeddingPipelineProgress,
  ExportProjectChapterRequest,
  ExportProjectRequest,
  FolderIdeaSuggestionsResult,
  GapAggregate,
  GapDetail,
  GapPage,
  GapSearchSuggestions,
  GenerateProjectSuggestionsRequest,
  GlobalSearchResult,
  GraphData,
  HypothesisLabRequest,
  HypothesisLabResult,
  IdeaByWorkPage,
  IdeaCandidate,
  IdeaConnection,
  IdeaDetail,
  IdeaPage,
  IdeaPageRequest,
  IdeaPickerItem,
  ImmersionAnswerRequest,
  ImmersionAnswerResult,
  ImmersionProgress,
  ImmersionRequest,
  ImmersionScope,
  ImmersionScopeRequest,
  ImmersionSession,
  ImmersionSessionSummary,
  ImmersionStreamHandlers,
  ImportProjectChapterInput,
  LibraryReaderDocument,
  LibraryReaderAttachmentContent,
  LibraryReaderChatMessage,
  LibraryReaderChatRequest,
  LibraryReaderChatResponse,
  LibraryReaderChatStreamHandlers,
  ManagedTheme,
  ManualIdeaPayload,
  ManuscriptVerificationRequest,
  ManuscriptVerificationResult,
  ModelRef,
  AnalysisRunOptions,
  Note,
  NoteFolder,
  NoteTagPatch,
  NotesExportOptions,
  NotesReorderResult,
  NotesTree,
  PassageDetail,
  PassageEmbeddingProgress,
  Project,
  ProjectChapter,
  ProjectChapterVersion,
  ProjectDetail,
  ProjectInsertionSuggestion,
  ProjectLink,
  ProjectSection,
  QueueKind,
  QueueProgress,
  ReadingPathPlan,
  ReadingPathRequest,
  ReprocessConnectionsOptions,
  ReprocessConnectionsResult,
  GraphIntegrityReport,
  GraphIntegrityRepairResult,
  ReprocessProgress,
  ResearchChatRequest,
  ResearchChatResponse,
  ResearchChatStreamHandlers,
  ResearchContextSelection,
  ResearchQuestion,
  ResearchQuestionDetail,
  RqDecomposeRequest,
  RqExportRequest,
  RqMapHandlers,
  RqMapRequest,
  RqUpdateSubQuestionsRequest,
  SaveSearchInput,
  SavedSearch,
  SearchResultDetail,
  SearchResultKind,
  SemanticBridgeProgress,
  SemanticBridgeResult,
  SemanticSearchOptions,
  SemanticSearchResponse,
  StudyDataMaintenanceResult,
  StudyDataOverview,
  StudyExportFormat,
  StudyExportScope,
  StudyGuidePlan,
  StudyPlanRequest,
  StudyProgressKind,
  StudyProgressRecord,
  StudyProgressStatus,
  StudySession,
  StudySessionRequest,
  SyncMergeSummary,
  SynthesisMatrix,
  SynthesisMatrixCell,
  Theme,
  TutorPlan,
  TutorPlanRequest,
  TutorRoute,
  TutorSavedRoute,
  TutorStepRequest,
  TutorStepResponse,
  TutorStepStreamHandlers,
  UpdateNoteInput,
  UpdateProjectInput,
  UpdateProjectSectionInput,
  WorkEmbeddingStatus,
  WorkFilter,
  WorkIdeaSynthesis,
  WorkDeletionOutcome,
  WorkMeta,
  WorkPage,
  WorkPageRequest,
  WorkPassageStatus,
  WorkSummary,
  WorkView,
  WorkspaceLibraryLink,
  WorkspaceLibraryLinkInput,
  StudyNoteLink,
  StudyNoteLinkFilter,
  StudyNoteLinkInput,
  WorkspaceLinkOwnerKind,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopDraftRequest,
  WritingWorkshopExportRequest,
  WritingWorkshopSaveDraftRequest,
  WritingWorkshopSavedDraft,
  WritingDraftAnnotation,
  WritingDraftAnnotationInput,
  WritingWorkshopSnapshot,
  ZoteroItem,
  ZoteroTag,
} from '../types';

export interface AcademicApi extends Pick<import('../researchCorpus').ResearchCorpusApi,
  'getResearchCorpusSources' | 'listResearchNotebooks' | 'saveResearchNotebook' | 'deleteResearchNotebook' | 'resolveResearchNotebook' | 'updateResearchNotebookAppearance' | 'getResearchNotebookPreparation' | 'searchResearchNotebook' | 'readResearchDocument'
  | 'getResearchPreparationPolicy' | 'setResearchPreparationPolicy' | 'previewResearchPreparation' | 'startResearchPreparationCampaign' | 'getResearchPreparationProgress' | 'onResearchPreparationProgress' | 'controlResearchPreparationCampaign' | 'controlAllResearchPreparation'
  | 'getResearchPreparationInventory' | 'prepareResearchDocuments' | 'indexResearchWorks' | 'cancelResearchDocuments' | 'setResearchPreparationEnabled' | 'setResearchPreparationPaused'
  | 'setResearchZoteroAutomatic' | 'getZoteroMcpStatus' | 'connectResearchZotero' | 'disconnectResearchZotero' | 'readResearchZotero'> {
  exportAcademicDocument(input: {documentId:string;kind:'note'|'study';expectedRevision?:number;format:import('../academicDocument').AcademicExportFormat;acceptWarnings?:boolean}): Promise<{base64:string;mime:string;fileName:string;html:string}>;
  // Dictionary: persistent evidence-backed concept syntheses
  listDictionaryEntries(request: DictionaryListRequest): Promise<DictionaryEntryPage>;
  listDictionaryFacets(): Promise<DictionaryFacets>;
  getDictionaryEntry(id: string): Promise<DictionaryEntryDetail | null>;
  createDictionaryEntry(input: DictionaryEntryInput): Promise<DictionaryEntry>;
  updateDictionaryEntry(id: string, patch: DictionaryEntryPatch, expectedUpdatedAt: string): Promise<DictionaryEntry>;
  deleteDictionaryEntries(ids: string[]): Promise<number>;
  detectDictionaryDuplicates(name: string, aliases: string[]): Promise<DictionaryDuplicateMatch[]>;
  retrieveDictionaryEvidence(entryId: string, options?: import('../dictionary').DictionaryResearchOptions): Promise<DictionaryEntryDetail>;
  scanDictionaryNewEvidence(entryId: string, options?: import('../dictionary').DictionaryResearchOptions): Promise<DictionaryEntryDetail>;
  scanChangedDictionaryEntries(limit?: number): Promise<string[]>;
  listDictionaryEvidence(request: DictionaryEvidenceRequest): Promise<DictionaryEvidencePage>;
  setDictionaryEvidenceDecision(entryId: string, refs: DictionaryEvidenceRef[], decision: DictionaryEvidenceDecision): Promise<void>;
  generateDictionaryEntry(request: DictionaryGenerationRequest): Promise<DictionaryVersion>;
  startDictionaryGeneration(request: DictionaryGenerationRequest): Promise<DictionaryProgress>;
  listDictionaryGenerationJobs(): Promise<DictionaryProgress[]>;
  onDictionaryProgress(callback: (progress: DictionaryProgress) => void): () => void;
  listDictionaryVersions(entryId: string): Promise<DictionaryVersion[]>;
  acceptDictionaryVersion(entryId: string, versionId: string, expectedCurrentVersionId: string | null): Promise<DictionaryEntryDetail>;
  restoreDictionaryVersion(entryId: string, versionId: string, expectedCurrentVersionId: string | null): Promise<DictionaryEntryDetail>;
  addDictionaryRelation(fromEntryId: string, toEntryId: string, type?: DictionaryRelationType): Promise<DictionaryRelation>;
  onDictionaryChanged(callback: (entryId: string | null) => void): () => void;

  // corpus: works and ideas
  listWorks(filter?: WorkFilter): Promise<WorkView[]>;
  listWorksPage(filter: WorkFilter | undefined, request: WorkPageRequest): Promise<WorkPage>;
  listZoteroTags(): Promise<ZoteroTag[]>;
  getWork(nodusId: string): Promise<WorkView | null>;
  ingestZoteroItems(items: ZoteroItem[]): Promise<WorkView[]>;
  setManualDeep(nodusId: string, value: boolean, model?: ModelRef | null): Promise<void>;
  setManualDeepBulk(nodusIds: string[], value: boolean, model?: ModelRef | null): Promise<void>;
  /** Analyse themes (light) and then ideas (deep) for one work, as two queue jobs. */
  analyzeBoth(nodusId: string, model?: ModelRef | null): Promise<void>;
  analyzeBothBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  /** Run the full chain (themes + ideas + summary + index + relationship discovery) for one work. */
  processFull(nodusId: string, model?: ModelRef | null, options?: AnalysisRunOptions): Promise<void>;
  processFullBulk(nodusIds: string[], model?: ModelRef | null, options?: AnalysisRunOptions): Promise<void>;
  /**
   * Remove works from the current vault together with their derived data (ideas, passages,
   * embeddings, document profiles…). Data belonging to other works is never touched: shared
   * ideas are kept and merely go dormant. Refuses while any of the works is being analysed
   * right now, reported through `ok: false` rather than an exception.
   */
  deleteWorks(nodusIds: string[]): Promise<WorkDeletionOutcome>;
  /** Re-run the cheap theme scan over the whole library to backfill broad parent themes. */
  reassignThemes(model?: ModelRef | null): Promise<number>;
  rescan(nodusId: string, kind: QueueKind, model?: ModelRef | null): Promise<void>;
  /** Re-scan every work that degraded to abstract-only, to pick up full text that
   *  became available since. Idempotent: works whose text is unchanged are no-ops.
   *  Returns the number of works re-enqueued. */
  rescanDegraded(model?: ModelRef | null): Promise<number>;
  summarizeWork(nodusId: string, model?: ModelRef | null): Promise<void>;
  summarizeBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  summarizeAll(model?: ModelRef | null): Promise<void>;
  getWorkSummary(nodusId: string): Promise<WorkSummary | null>;
  /** Zotero collections (with work counts) available as Library filters. */
  listCollectionFacets(): Promise<CollectionFacet[]>;
  /** Groups of works that look like the same work (same DOI, or same title+year+authors). */
  listDuplicateWorks(): Promise<DuplicateWorkGroup[]>;
  /** Merge duplicate works into the chosen canonical, re-pointing all derived data. */
  mergeWorks(canonicalId: string, duplicateIds: string[]): Promise<{ merged: number }>;
  /** Groups of ideas that look like the same idea (identical normalized label + type). */
  listDuplicateIdeas(): Promise<DuplicateIdeaGroup[]>;
  /** Merge duplicate ideas into the chosen canonical, re-pointing all derived data and the graph. */
  mergeIdeas(canonicalId: string, duplicateIds: string[]): Promise<{ merged: number }>;
  /** Snapshot the DB into userData/backups before a destructive maintenance action; returns the path. */
  backupDatabase(): Promise<string>;
  /** Live bibliographic metadata for a work (journal/book, pages, publisher, …). */
  getWorkMeta(nodusId: string): Promise<WorkMeta | null>;
  openInZotero(zoteroKey: string): Promise<void>;
  /**
   * Open an evidence locator at its exact page. Zotero's own reader is preferred
   * when the work has a PDF attachment there; otherwise the result names the
   * library copy the renderer should open at that page. Callers must go through
   * `openEvidenceAtPage` in `src/evidenceJump.ts`, which also handles the `local`
   * case — a non-`ok` result is not "nothing happened".
   */
  openEvidenceAtPage(nodusId: string, locator: string | null | import('../types').EvidenceLocator): Promise<import('../types').OpenEvidenceAtPageResult>;
  /** Clean Markdown reader stored under the configured backup root. */
  getLibraryReaderDocument(nodusId: string): Promise<LibraryReaderDocument | null>;
  getLibraryReaderAttachmentContent(nodusId: string, attachmentId: string): Promise<LibraryReaderAttachmentContent | null>;
  getLibraryReaderAttachmentBytes(nodusId: string, attachmentId: string): Promise<ArrayBuffer | null>;
  openLibraryReaderOriginal(nodusId: string): Promise<boolean>;
  listLibraryReaderAnnotations(nodusId: string): Promise<WritingDraftAnnotation[]>;
  listLibraryReaderOrphanedAnnotations(nodusId: string): Promise<WritingDraftAnnotation[]>;
  createLibraryReaderAnnotation(nodusId: string, input: WritingDraftAnnotationInput): Promise<WritingDraftAnnotation>;
  updateLibraryReaderComment(nodusId: string, id: string, comment: string): Promise<WritingDraftAnnotation | null>;
  deleteLibraryReaderAnnotation(nodusId: string, id: string): Promise<void>;
  onLibraryReaderAnnotationsChanged(cb: (nodusId: string | null) => void): () => void;
  listLibraryReaderChatMessages(nodusId: string): Promise<LibraryReaderChatMessage[]>;
  libraryReaderChatStream(request: LibraryReaderChatRequest, handlers: LibraryReaderChatStreamHandlers): Promise<LibraryReaderChatResponse>;
  cancelLibraryReaderChat(): Promise<void>;
  clearLibraryReaderChat(nodusId: string): Promise<void>;
  /** Open an http(s)/mailto link in the user's default browser (used by rendered Markdown). */
  onStudyMaterialAiProcessingRequest(cb: (request: StudyMaterialAiProcessingPrompt) => void): () => void;
  resolveStudyMaterialAiProcessingRequest(requestId: string, decision: StudyMaterialAiProcessingDecision): Promise<void>;
  uploadText(nodusId: string, filePath: string): Promise<void>;

  // queue
  getQueue(): Promise<QueueProgress>;
  pauseQueue(): Promise<void>;
  resumeQueue(): Promise<void>;
  cancelQueueItem(id: string): Promise<void>;
  removeQueueItem(id: string): Promise<void>;
  moveQueueItemToTop(id: string): Promise<void>;
  clearQueue(): Promise<void>;
  stopQueue(): Promise<void>;
  retryFailed(): Promise<void>;
  /** Enqueue a semantic bridge discovery job into the scan queue. */
  enqueueBridgeDiscovery(model?: ModelRef | null): Promise<void>;
  onQueueProgress(cb: (p: QueueProgress) => void): () => void;

  // audited whole-document understanding
  getDocumentProfile(nodusId: string): Promise<DocumentProfile | null>;
  saveDocumentProfileOverride(input: {
    nodusId: string;
    fieldPath: string;
    value: string;
    generatedValue: string;
    baseVersionId: string;
    verified?: boolean;
  }): Promise<DocumentProfileOverride>;
  deleteDocumentProfileOverride(overrideId: string): Promise<void>;
  getDocumentProfileStatuses(nodusIds?: string[]): Promise<Array<{
    nodusId: string;
    status: DocumentUnderstandingState;
    currentVersionId: string | null;
    sourceFingerprint: string | null;
    staleReason: string | null;
    error: string | null;
  }>>;
  getDocumentIndexProgress(): Promise<DocumentIndexProgress>;
  startDocumentIndexCampaign(options?: { includeArchived?: boolean; nodusIds?: string[] }): Promise<DocumentIndexCampaign>;
  enqueueDocumentProfile(nodusId: string, vaultId?: string): Promise<void>;
  setDocumentIndexCampaignStatus(vaultId: string, campaignId: string, status: 'running' | 'paused' | 'cancelled'): Promise<void>;
  cancelDocumentIndexJob(jobId: string, vaultId?: string): Promise<void>;
  onDocumentIndexProgress(cb: (p: DocumentIndexProgress) => void): () => void;

  // graph
  stellarPage(request: StellarPageRequest): Promise<StellarPage>;
  /** Theme hubs for the first graph tab, each with the ideas it nests. */
  stellarThemes(): Promise<StellarTheme[]>;
  getStellarSession(key: string): Promise<{vaultId: string; session: StellarSession | null}>;
  saveStellarSession(vaultId: string, key: string, session: StellarSession): Promise<void>;
  getGraph(lens: 'ideas' | 'authors'): Promise<GraphData>;
  listIdeasPage(request: IdeaPageRequest): Promise<IdeaPage>;
  /** Every graph idea, with only the fields a picker shows and searches. */
  listPickerIdeas(): Promise<IdeaPickerItem[]>;
  listIdeaConnections(globalId: string): Promise<IdeaConnection[]>;
  getIdeaDetail(globalId: string): Promise<IdeaDetail | null>;
  deleteIdea(globalId: string): Promise<void>;
  getEdgeDetail(edgeId: string): Promise<EdgeDetail | null>;
  /** Every direct idea↔idea edge touching an idea (its connections). */
  getIdeaEdges(globalId: string): Promise<EdgeDetail[]>;
  /** Set (or clear with null) the audit verdict for a relation. */
  setEdgeFeedback(fromId: string, toId: string, type: string, verdict: EdgeFeedbackVerdict | null, note?: string): Promise<void>;
  /** Every audit verdict, newest first, with idea labels. */
  listEdgeFeedback(): Promise<EdgeFeedbackView[]>;
  /** Paginated list of the ideas a work develops. */
  getIdeasByWork(nodusId: string, limit: number, offset: number): Promise<IdeaByWorkPage>;
  /** Cached narrated synthesis for the ideas extracted from one work, if present. */
  getWorkIdeaSynthesis(nodusId: string): Promise<WorkIdeaSynthesis | null>;
  /** Generate a narrated synthesis for the ideas extracted from one work. */
  synthesizeWorkIdeas(nodusId: string, model?: ModelRef | null): Promise<WorkIdeaSynthesis>;
  getThemes(): Promise<Theme[]>;

  // authors (dossier + synthesis matrix)
  /** Lightweight list of every author with their corpus footprint. */
  listAuthors(): Promise<AuthorSummary[]>;
  listAuthorsPage(request: AuthorPageRequest): Promise<AuthorPage>;
  setAuthorSaved(authorId: string, saved: boolean): Promise<void>;
  /** Full study card for one author (ideas, relations, themes, cached synthesis). */
  getAuthorDossier(authorId: string): Promise<AuthorDossier | null>;
  /** Generate (and cache) the AI thesis/remember/positioning for one author. */
  synthesizeAuthor(authorId: string, model?: ModelRef | null): Promise<AuthorDossierSynthesis>;
  /** Authors × themes matrix with idea counts/labels and any cached stances. */
  getSynthesisMatrix(): Promise<SynthesisMatrix>;
  /** Generate (and cache) the one-sentence stance for one author×theme cell. */
  synthesizeMatrixCell(authorId: string, themeId: string, model?: ModelRef | null): Promise<SynthesisMatrixCell>;
  /** Export cached author syntheses (selected or all) to Markdown or PDF. */
  exportAuthorSyntheses(request: AuthorSynthesisExportRequest): Promise<{ path: string } | null>;

  // study guide
  /** Complete local organization snapshot for the active study vault. */
  getStudyWorkspace(options?: StudyWorkspaceOptions): Promise<StudyWorkspace>;
  /** The weekly grid for one academic year; `null` is the unscoped timetable. */
  getStudySchedule(academicYearId?: string | null): Promise<StudySchedule>;
  /** Replaces the grid of `schedule.academicYearId` only; other years are untouched. */
  saveStudySchedule(schedule: StudySchedule): Promise<StudySchedule>;
  /** Overwrites the destination year's grid with a copy of the source year's. */
  copyStudySchedule(fromAcademicYearId: string | null, toAcademicYearId: string | null): Promise<StudySchedule>;
  /** Creates the year, or returns the existing one with the same canonical label. */
  createStudyAcademicYear(input: CreateStudyAcademicYearInput): Promise<StudyAcademicYear>;
  updateStudyAcademicYear(id: string, patch: UpdateStudyAcademicYearInput): Promise<StudyAcademicYear | null>;
  /** Unlinks the year from its courses and subjects; their content is kept. */
  deleteStudyAcademicYear(id: string): Promise<void>;
  createStudyCourse(input: CreateStudyCourseInput): Promise<StudyCourse>;
  createStudySubject(input: CreateStudySubjectInput): Promise<StudySubject>;
  createStudyTopic(input: CreateStudyTopicInput): Promise<StudyTopic>;
  createStudyFolder(input: CreateStudyFolderInput): Promise<StudyFolder>;
  createStudyDocument(input: CreateStudyDocumentInput): Promise<StudyDocument>;
  updateStudyEntity(kind: StudyEntityKind, id: string, patch: Record<string, unknown>): Promise<StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument | null>;
  moveStudyEntity(kind: Exclude<StudyEntityKind, 'course' | 'document'>, id: string, input: StudyEntityMoveInput): Promise<StudySubject | StudyTopic | StudyFolder>;
  addStudyPlacement(documentId: string, input: StudyPlacementInput): Promise<StudyPlacement>;
  setPrimaryStudyPlacement(documentId: string, input: StudyPlacementInput): Promise<StudyPlacement>;
  /** Move a single location; null destination fields leave it unfiled. Other locations are retained. */
  moveStudyPlacement(documentId: string, placementId: string | null, destination: StudyPlacementInput): Promise<StudyPlacement | null>;
  removeStudyPlacement(id: string): Promise<void>;
  setStudyLifecycle(kind: StudyEntityKind, id: string, action: StudyLifecycleAction, options?: { purgeLinkedKnowledge?: boolean }): Promise<void>;
  /** The copy keeps the original's academic year; re-file it by editing the copy. */
  duplicateStudyTree(kind: StudyEntityKind, id: string): Promise<StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument>;
  createStudyTag(input: CreateStudyTagInput): Promise<StudyTag>;
  updateStudyTag(id: string, patch: Partial<CreateStudyTagInput> & { favorite?: boolean; position?: number }): Promise<StudyTag | null>;
  deleteStudyTag(id: string): Promise<void>;
  setStudyDocumentTags(documentId: string, tagIds: string[]): Promise<void>;
  createStudyTemplate(input: CreateStudyTemplateInput): Promise<StudyTemplate>;
  updateStudyTemplate(id: string, patch: Partial<CreateStudyTemplateInput> & { favorite?: boolean; position?: number }): Promise<StudyTemplate | null>;
  deleteStudyTemplate(id: string): Promise<void>;
  applyStudyTemplate(id: string, name?: string): Promise<StudyCourse | StudySubject | StudyDocument>;
  getStudyDocEditorData(documentId: string): Promise<StudyDocEditorData>;
  updateStudyDoc(documentId: string, input: StudyDocUpdateInput): Promise<StudyDocument>;
  restoreStudyDocVersion(documentId: string, versionId: string): Promise<StudyDocument>;
  createStudyAnnotation(documentId: string, input: StudyAnnotationInput): Promise<StudyAnnotation>;
  updateStudyAnnotation(id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }): Promise<StudyAnnotation | null>;
  deleteStudyAnnotation(id: string): Promise<void>;
  transcribeStudyAudio(request: StudySttRequest, handlers?: StudySttStreamHandlers): Promise<StudySttResult>;
  cancelStudyTranscription(): Promise<void>;
  getWhisperCppStatus(): Promise<WhisperCppStatus>;
  installWhisperCpp(): Promise<WhisperCppStatus>;
  uninstallWhisperCpp(): Promise<WhisperCppStatus>;
  chooseWhisperCppExecutable(): Promise<string | null>;
  downloadWhisperCppModel(model: string, onProgress?: (fraction: number) => void): Promise<WhisperCppStatus>;
  deleteWhisperCppModel(model: string): Promise<WhisperCppStatus>;
  listStudyStyles(options?: { includeArchived?: boolean; search?: string }): Promise<StudyStyle[]>;
  createStudyStyle(input: StudyStyleInput): Promise<StudyStyle>;
  updateStudyStyle(id: string, patch: Partial<StudyStyleInput>): Promise<StudyStyle>;
  duplicateStudyStyle(id: string): Promise<StudyStyle>;
  archiveStudyStyle(id: string, archived: boolean): Promise<StudyStyle>;
  deleteStudyStyle(id: string): Promise<void>;
  listStudyStyleVersions(styleId: string): Promise<StudyStyleVersion[]>;
  restoreStudyStyleVersion(styleId: string, versionId: string): Promise<StudyStyle>;
  listStudyStyleAssociations(): Promise<StudyStyleAssociation[]>;
  setStudyStyleAssociation(styleId: string, kind: StudyStyleAssociationKind, targetId?: string, isDefault?: boolean): Promise<StudyStyleAssociation>;
  resolveStudyStyleDefault(subjectId?: string | null, documentKind?: string | null): Promise<string>;
  exportStudyStyles(styleIds?: string[]): Promise<{ path: string } | null>;
  importStudyStyles(): Promise<StudyStyle[]>;
  improveStudyText(request: StudyImproveRequest, handlers: StudyImproveStreamHandlers): Promise<StudyImproveResult>;
  suggestStudySynonyms(request: StudySynonymRequest): Promise<StudySynonymResult>;
  cancelStudyImprove(): Promise<void>;
  listStudyImprovementLog(documentId: string): Promise<StudyImprovementLog[]>;
  updateStudyImprovementAction(id: string, action: StudyImprovementLog['action']): Promise<void>;
  listStudyMaterials(options?: StudyMaterialListOptions): Promise<StudyMaterialSummary[]>;
  getStudyMaterial(id: string): Promise<StudyMaterialDetail>;
  getStudyMaterialContent(id: string): Promise<StudyMaterialContent>;
  downloadStudyMaterial(id: string): Promise<{ path: string } | null>;
  importStudyMaterials(input?: StudyMaterialImportInput): Promise<StudyMaterialImportResult[]>;
  importStudyMaterialFolder(input?: StudyMaterialImportInput): Promise<StudyMaterialImportResult[]>;
  chooseStudyMaterialPaths(folder?: boolean): Promise<string[]>;
  importStudyMaterialPaths(paths: string[], input?: StudyMaterialImportInput): Promise<StudyMaterialImportResult[]>;
  importZoteroStudyMaterial(input: ZoteroStudyMaterialImportInput): Promise<StudyMaterialImportResult>;
  openStudyMaterialInZotero(id: string): Promise<void>;
  reindexStudyMaterial(id: string): Promise<StudyMaterialIndexResult>;
  onStudyMaterialIndexChanged(cb: (id: string) => void): () => void;
  replaceStudyMaterialFile(id: string, ocr?: boolean): Promise<StudyMaterialSummary | null>;
  updateStudyMaterial(id: string, patch: StudyMaterialUpdateInput): Promise<StudyMaterialSummary>;
  restoreStudyMaterialVersion(id: string, versionId: string): Promise<StudyMaterialSummary>;
  addStudyMaterialPlacement(id: string, input: StudyMaterialImportInput): Promise<StudyMaterialPlacement | null>;
  setPrimaryStudyMaterialPlacement(id: string, input: StudyMaterialImportInput): Promise<StudyMaterialPlacement | null>;
  moveStudyMaterialPlacement(id: string, placementId: string | null, destination: StudyPlacementInput): Promise<StudyMaterialPlacement | null>;
  removeStudyMaterialPlacement(id: string, placementId: string): Promise<void>;
  createStudyMaterialAnnotation(materialId: string, input: StudyMaterialAnnotationInput): Promise<StudyMaterialAnnotation>;
  updateStudyMaterialAnnotation(id: string, patch: Partial<StudyMaterialAnnotationInput>): Promise<StudyMaterialAnnotation>;
  deleteStudyMaterialAnnotation(id: string): Promise<void>;
  exportAnnotatedStudyMaterial(id: string): Promise<{ path: string } | null>;
  createStudyNoteFromMaterial(materialId: string, annotationId?: string | null, title?: string): Promise<{ documentId: string }>;
  setStudyMaterialLifecycle(id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete', options?: { purgeLinkedKnowledge?: boolean }): Promise<void>;
  listStudyRecordings(options?: StudyRecordingListOptions): Promise<StudyRecordingSummary[]>;
  getStudyRecording(id: string): Promise<StudyRecordingDetail>;
  getStudyRecordingContent(id: string): Promise<StudyRecordingContent>;
  createStudyRecording(input: StudyRecordingCreateInput): Promise<StudyRecordingImportResult>;
  importStudyRecordings(scope?: Omit<StudyRecordingCreateInput, 'bytes' | 'fileName' | 'mimeType'>): Promise<StudyRecordingImportResult[]>;
  updateStudyRecording(id: string, patch: StudyRecordingUpdateInput): Promise<StudyRecordingSummary>;
  createStudyAudioMarker(recordingId: string, input: StudyAudioMarkerInput): Promise<StudyAudioMarker>;
  updateStudyAudioMarker(id: string, patch: Partial<StudyAudioMarkerInput>): Promise<StudyAudioMarker>;
  deleteStudyAudioMarker(id: string): Promise<void>;
  saveStudyTranscript(recordingId: string, input: StudyTranscriptInput): Promise<StudyTranscript>;
  updateStudyTranscript(id: string, contentMarkdown: string, segments?: StudyTranscriptSegmentInput[]): Promise<StudyTranscript>;
  diarizeStudyRecording(request: StudyDiarizationRequest): Promise<StudyDiarizationResult>;
  updateStudyTranscriptSegment(id: string, patch: Partial<StudyTranscriptSegmentInput>): Promise<StudyTranscriptSegment>;
  deleteStudyTranscript(id: string): Promise<void>;
  createStudyNoteFromTranscript(recordingId: string, transcriptId: string, placements?: StudyPlacementInput[]): Promise<{ documentId: string }>;
  deleteStudyRecordingAudio(id: string): Promise<StudyRecordingSummary>;
  setStudyRecordingLifecycle(id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete'): Promise<void>;
  searchStudyCorpus(query: string, options?: StudySearchOptions): Promise<StudySearchResponse>;
  getStudySearchIndexStatus(): Promise<StudySearchProgress>;
  rebuildStudySearchIndex(): Promise<StudySearchProgress>;
  pauseStudySearchIndex(): Promise<void>;
  resumeStudySearchIndex(): Promise<void>;
  stopStudySearchIndex(): Promise<void>;
  deleteStudySearchIndex(): Promise<void>;
  setStudySearchSourceExcluded(sourceId: string, excluded: boolean): Promise<StudySearchIndexStatus>;
  listStudySavedSearches(): Promise<StudySavedSearch[]>;
  saveStudySearch(name: string, query: string, options: StudySearchOptions): Promise<StudySavedSearch>;
  deleteStudySavedSearch(id: string): Promise<void>;
  listStudySearchHistory(): Promise<StudySearchHistoryEntry[]>;
  clearStudySearchHistory(): Promise<void>;
  onStudySearchProgress(cb: (progress: StudySearchProgress) => void): () => void;
  listStudyIdeas(subjectId: string, query?: string): Promise<StudyIdeaSummary[]>;
  getStudyIdeaDetail(id: string): Promise<StudyIdeaDetail | null>;
  deleteStudyIdea(id: string): Promise<void>;
  getStudyKnowledgeGraph(subjectId: string): Promise<StudyKnowledgeGraph>;
  listStudyKnowledgeJobs(subjectId?: string): Promise<StudyKnowledgeJob[]>;
  getStudyKnowledgeProgress(): Promise<StudyKnowledgeProgress>;
  reanalyzeStudyKnowledgeSource(sourceKind: 'material' | 'document', sourceId: string): Promise<void>;
  onStudyKnowledgeChanged(cb: (progress: StudyKnowledgeProgress) => void): () => void;
  listStudyAssistantSources(): Promise<StudyAssistantSourceOption[]>;
  listStudyAssistantConversations(includeArchived?: boolean): Promise<StudyAssistantConversationSummary[]>;
  getStudyAssistantConversation(id: string): Promise<StudyAssistantConversation | null>;
  createStudyAssistantConversation(input?: StudyAssistantConversationInput): Promise<StudyAssistantConversation>;
  updateStudyAssistantConversation(id: string, patch: StudyAssistantConversationPatch): Promise<StudyAssistantConversation | null>;
  deleteStudyAssistantConversation(id: string): Promise<void>;
  streamStudyAssistant(request: StudyAssistantRequest, handlers: StudyAssistantStreamHandlers): Promise<StudyAssistantResponse>;
  cancelStudyAssistant(): Promise<void>;
  exportStudyAssistantConversation(id: string): Promise<{ path: string } | null>;
  listStudyQuestions(filters?: StudyQuestionFilters): Promise<StudyQuestion[]>;
  getStudyQuestion(id: string): Promise<StudyQuestion | null>;
  createStudyQuestion(input: StudyQuestionInput): Promise<StudyQuestion>;
  updateStudyQuestion(id: string, patch: Partial<StudyQuestionInput>): Promise<StudyQuestion>;
  duplicateStudyQuestion(id: string): Promise<StudyQuestion>;
  listStudyQuestionVersions(id: string): Promise<StudyQuestionVersion[]>;
  restoreStudyQuestionVersion(id: string, versionId: string): Promise<StudyQuestion>;
  setStudyQuestionLifecycle(id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete'): Promise<void>;
  generateStudyQuestions(request: StudyQuestionGenerationRequest): Promise<StudyQuestionGenerationResult>;
  exportStudyQuestions(ids?: string[]): Promise<{ path: string } | null>;
  importStudyQuestions(): Promise<StudyQuestion[]>;
  listStudyQuestionCollections(): Promise<StudyQuestionCollection[]>;
  createStudyQuestionCollection(name: string, description?: string): Promise<StudyQuestionCollection>;
  setStudyQuestionCollectionItems(collectionId: string, questionIds: string[]): Promise<void>;
  deleteStudyQuestionCollection(id: string): Promise<void>;
  getStudyQuestionAnalytics(id: string): Promise<StudyQuestionAnalytics>;
  findSimilarStudyQuestions(id: string, threshold?: number): Promise<StudyQuestionSimilar[]>;
  listStudyQuestionTags(): Promise<Array<{ tag: string; count: number }>>;
  bulkStudyQuestions(ids: string[], action: StudyQuestionBulkAction): Promise<number>;
  exportStudyInterchange(kind: StudyInterchangeKind, format: StudyInterchangeFormat, options?: StudyInterchangeExportOptions): Promise<{ path: string } | null>;
  importStudyInterchange(kind: StudyInterchangeKind, options?: StudyInterchangeImportOptions): Promise<StudyInterchangeSummary | null>;
  listStudyAssessments(kind?: StudyAssessment['kind'], includeArchived?: boolean): Promise<StudyAssessment[]>;
  getStudyAssessment(id: string): Promise<StudyAssessment | null>;
  createStudyAssessment(input: StudyAssessmentInput): Promise<StudyAssessment>;
  buildStudyTest(request: StudyTestBuildRequest): Promise<StudyAssessment>;
  updateStudyAssessment(id: string, patch: Partial<Omit<StudyAssessmentInput, 'questionIds'>> & { archived?: boolean }): Promise<StudyAssessment>;
  deleteStudyAssessment(id: string): Promise<void>;
  listStudyAttempts(assessmentId?: string): Promise<StudyAttempt[]>;
  getStudyAttempt(id: string): Promise<StudyAttempt | null>;
  startStudyAttempt(input: StudyAttemptStartInput): Promise<StudyAttempt>;
  saveStudyAttemptAnswer(attemptId: string, input: StudyAttemptAnswerInput): Promise<StudyAttemptAnswer>;
  submitStudyAttempt(id: string, expired?: boolean): Promise<StudyAttempt>;
  abandonStudyAttempt(id: string): Promise<StudyAttempt>;
  exportStudyAssessment(id: string, includeAnswers?: boolean): Promise<{ path: string } | null>;
  listStudyRubrics(includeArchived?: boolean): Promise<StudyRubric[]>;
  createStudyRubric(input: StudyRubricInput): Promise<StudyRubric>;
  updateStudyRubric(id: string, patch: Partial<StudyRubricInput> & { archived?: boolean }): Promise<StudyRubric>;
  duplicateStudyRubric(id: string): Promise<StudyRubric>;
  deleteStudyRubric(id: string): Promise<void>;
  listStudyGradingRuns(attemptAnswerId?: string): Promise<StudyGradingRun[]>;
  setStudyGradingManualScore(id: string, score: number, comment?: string): Promise<StudyGradingRun>;
  listStudyFlashcards(options?: StudyFlashcardFilters): Promise<StudyFlashcard[]>;
  createStudyFlashcard(input: StudyFlashcardInput): Promise<StudyFlashcard>;
  updateStudyFlashcard(id: string, patch: Partial<StudyFlashcardInput>): Promise<StudyFlashcard>;
  createStudyFlashcardsFromQuestions(questionIds: string[]): Promise<StudyFlashcard[]>;
  reviewStudyFlashcard(input: StudyReviewInput): Promise<{ card: StudyFlashcard; review: StudyReviewRecord }>;
  setStudyFlashcardState(id: string, action: 'master' | 'reset' | 'exclude' | 'include' | 'archive' | 'delete'): Promise<void>;
  listStudyFlashcardTags(): Promise<Array<{ tag: string; count: number }>>;
  bulkStudyFlashcards(ids: string[], action: StudyFlashcardBulkAction): Promise<number>;
  exportStudyFlashcards(ids?: string[]): Promise<StudyFlashcardExport>;
  importStudyFlashcards(payload: StudyFlashcardExport): Promise<StudyFlashcard[]>;
  getStudyProgressDashboard(): Promise<StudyProgressDashboard>;
  getStudyPlanner(): Promise<StudyPlannerSnapshot>;
  createStudyPlan(input: { title: string; description?: string; courseId?: string | null; subjectId?: string | null; examAt?: string | null; availableMinutes?: number; config?: Record<string, unknown> }): Promise<StudyPlan>;
  createStudyPlanBlock(input: { planId?: string | null; title: string; type?: string; courseId?: string | null; subjectId?: string | null; topicId?: string | null; startsAt: string; durationMinutes?: number; priority?: number; notes?: string }): Promise<StudyPlanBlock>;
  createStudyCalendarEvent(input: StudyCalendarEventInput): Promise<StudyCalendarEvent>;
  updateStudyCalendarEvent(id: string, input: StudyCalendarEventInput): Promise<StudyCalendarEvent>;
  deleteStudyCalendarEvent(id: string): Promise<void>;
  addStudyCalendarEventToExternal(id: string, target: 'google' | 'icloud' | 'outlook'): Promise<{ path: string } | null>;
  getAppleCalendarSyncStatus(): Promise<AppleCalendarSyncStatus>;
  listAppleCalendarDestinations(): Promise<AppleCalendarDestination[]>;
  configureAppleCalendarSync(input: { enabled: boolean; calendarId?: string }): Promise<AppleCalendarSyncStatus>;
  createStudyGoal(input: { title: string; period?: StudyGoal['period']; targetValue?: number; unit?: string; startsAt?: string; endsAt?: string | null; subjectId?: string | null }): Promise<StudyGoal>;
  updateStudyPlannerItem(kind: 'block' | 'event' | 'goal', id: string, patch: Record<string, unknown>): Promise<void>;
  startStudySession(input: { planBlockId?: string | null; subjectId?: string | null; topicId?: string | null; mode?: string; plannedMinutes?: number }): Promise<StudyStudySession>;
  finishStudySession(id: string, input: { actualSeconds: number; interruptions?: number; notes?: string }): Promise<StudyStudySession>;
  exportStudyPlannerIcs(target?: 'outlook'): Promise<{ path: string } | null>;
  listStudyAiUsage(limit?: number): Promise<StudyAiUsage[]>;
  getStudyAiUsageSummary(): Promise<StudyAiUsageSummary>;
  clearStudyAiUsage(): Promise<void>;

  /** Guided corpus mastery plan over authors, ideas and Zotero-linked works. */
  getStudyPlan(request?: StudyPlanRequest): Promise<StudyGuidePlan>;
  /** Persist study progress for an author/work/idea/theme. */
  setStudyProgress(record: {
    targetKind: StudyProgressKind;
    targetId: string;
    status: StudyProgressStatus;
    note?: string | null;
  }): Promise<StudyProgressRecord>;
  /** Optional AI tutor session for one author, grounded in graph data and indexed passages. */
  generateStudySession(request: StudySessionRequest): Promise<StudySession>;

  // inmersión (guided topic mastery)
  buildImmersionScope(request: ImmersionScopeRequest): Promise<ImmersionScope>;
  generateImmersionSession(request: ImmersionRequest, handlers?: ImmersionStreamHandlers): Promise<ImmersionSession>;
  listImmersionSessions(): Promise<ImmersionSessionSummary[]>;
  getImmersionSession(id: string): Promise<ImmersionSession | null>;
  restartImmersionSession(id: string): Promise<ImmersionSession | null>;
  setImmersionProgress(id: string, progress: ImmersionProgress): Promise<void>;
  answerImmersionQuestion(request: ImmersionAnswerRequest): Promise<ImmersionAnswerResult>;
  exportImmersionSessionPdf(id: string): Promise<{ path: string } | null>;
  deleteImmersionSession(id: string): Promise<void>;
  // main-theme management ("temas principales")
  listManagedThemes(): Promise<ManagedTheme[]>;
  addManualTheme(label: string): Promise<ManagedTheme[]>;
  renameTheme(themeId: string, label: string): Promise<ManagedTheme[]>;
  setThemePinned(themeId: string, pinned: boolean): Promise<ManagedTheme[]>;
  deleteTheme(themeId: string): Promise<ManagedTheme[]>;
  /**
   * Re-group the already-extracted ideas under the curated/existing themes using the
   * model (no document re-reading). Optionally also re-traces idea↔idea relations.
   */
  reprocessThemeConnections(
    options: ReprocessConnectionsOptions,
    model?: ModelRef | null,
    onProgress?: (p: ReprocessProgress) => void
  ): Promise<ReprocessConnectionsResult>;
  /** Reassign idea themes only in the works whose links a graph repair removed (uses the model). */
  reprocessRepairedThemeWorks(
    model?: ModelRef | null,
    onProgress?: (p: ReprocessProgress) => void
  ): Promise<ReprocessConnectionsResult>;

  // graph health
  /** Read-only audit of the whole idea graph, with the works each finding belongs to. */
  checkGraphIntegrity(): Promise<GraphIntegrityReport>;
  /** Back up the vault, then repair every `repairable` finding. Refused while the analysis queue runs. */
  repairGraphIntegrity(): Promise<GraphIntegrityRepairResult>;
  /** Forget the works waiting for their idea themes to be reassigned. */
  dismissRepairedThemeWorks(): Promise<GraphIntegrityReport>;

  // gaps + reading path
  getGaps(): Promise<GapAggregate[]>;
  getGapsPage(offset: number, limit: number): Promise<GapPage>;
  getContradictionCount(): Promise<number>;
  getGapDetail(gapId: string): Promise<GapDetail | null>;
  getContradictions(): Promise<EdgeDetail[]>;
  getReadingPath(request?: ReadingPathRequest): Promise<ReadingPathPlan>;

  // debates (contradiction face-offs)
  /** Contradicts/refutes edges as two-sided debates with authors, evidence and chronology. */
  getDebates(): Promise<Debate[]>;
  /** Optional, user-triggered streamed AI synthesis of one debate (grounded in its evidence). */
  analyzeDebate(request: DebateAnalysisRequest, handlers: DebateAnalysisStreamHandlers): Promise<DebateAnalysisResponse>;

  // research coverage map (question-driven research)
  listResearchQuestions(): Promise<ResearchQuestion[]>;
  getResearchQuestion(id: string): Promise<ResearchQuestionDetail | null>;
  createResearchQuestion(input: { question: string; notes?: string }): Promise<ResearchQuestionDetail>;
  /** Break the question into sub-questions with the model (replaces existing ones). */
  decomposeResearchQuestion(request: RqDecomposeRequest): Promise<ResearchQuestionDetail>;
  /** Manually edit the sub-questions; coverage is preserved where the text is unchanged. */
  updateResearchSubQuestions(request: RqUpdateSubQuestionsRequest): Promise<ResearchQuestionDetail>;
  /** Map each sub-question against the local corpus (semantic + lexical retrieval + classification). */
  mapResearchCoverage(request: RqMapRequest, handlers?: RqMapHandlers): Promise<ResearchQuestionDetail>;
  deleteResearchQuestion(id: string): Promise<void>;
  exportResearchCoverage(request: RqExportRequest): Promise<{ path: string } | null>;

  // hypothesis lab
  /** Generate evidence-backed, testable hypotheses from gaps, ideas, debates, works and an optional project. */
  generateHypothesisLab(request: HypothesisLabRequest): Promise<HypothesisLabResult>;

  // research assistant
  getResearchSystemPrompts(conversationKey?: string | null): Promise<import('../researchSystemPrompts').ResearchSystemPromptState>;
  saveResearchSystemPrompt(input: import('../researchSystemPrompts').ResearchSystemPromptInput): Promise<import('../researchSystemPrompts').ResearchSystemPrompt>;
  selectResearchSystemPrompt(conversationKey: string, id: string | null): Promise<void>;
  deleteResearchSystemPrompt(id: string): Promise<void>;
  listResearchContextSources(): Promise<import('../researchContextFilters').ResearchContextSources>;
  importResearchAttachments(owner: import('../researchAttachments').ResearchAttachmentOwner, filePaths: string[]): Promise<import('../researchAttachments').ResearchAttachmentImportResult>;
  pickResearchAttachments(owner: import('../researchAttachments').ResearchAttachmentOwner): Promise<import('../researchAttachments').ResearchAttachmentImportResult>;
  listResearchAttachments(owner: import('../researchAttachments').ResearchAttachmentOwner): Promise<import('../researchAttachments').ResearchAttachment[]>;
  removeResearchAttachment(owner: import('../researchAttachments').ResearchAttachmentOwner, id: string): Promise<void>;
  saveResearchAttachment(owner: import('../researchAttachments').ResearchAttachmentOwner, id: string): Promise<void>;
  researchChat(request: ResearchChatRequest): Promise<ResearchChatResponse>;
  researchChatStream(request: ResearchChatRequest, handlers: ResearchChatStreamHandlers): Promise<ResearchChatResponse>;
  /**
   * Abort the research-chat stream currently in flight. The pending
   * {@link researchChatStream} promise then resolves with whatever partial
   * answer had streamed so far (never rejects), so the UI can keep the text.
   */
  cancelResearchChat(): Promise<void>;

  // writing workshop
  getWritingWorkshopSnapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot>;
  generateWritingWorkshopDraft(request: WritingWorkshopDraftRequest): Promise<WritingWorkshopDraft>;
  exportWritingWorkshopDraft(request: WritingWorkshopExportRequest): Promise<{ path: string } | null>;
  /**
   * Zip several saved Deep Research reports into one archive the user places.
   * Resolves to `null` when the save dialog is dismissed. `onProgress` fires before
   * and after each report, because rendering PDFs runs serially and can take a while.
   */
  exportDeepResearchArchive(
    request: DeepResearchArchiveRequest,
    onProgress?: (done: number, total: number, title: string) => void
  ): Promise<DeepResearchArchiveResult | null>;
  listWritingWorkshopDrafts(): Promise<WritingWorkshopSavedDraft[]>;
  /** Bounded discovery for selected companion downloads; no report bodies. */
  listWritingWorkshopDownloadCatalogue(request: {offset: number; limit: number}): Promise<{
    items: Array<Pick<WritingWorkshopSavedDraft, 'id' | 'title' | 'createdAt' | 'updatedAt'>>;
    total: number; offset: number; limit: number;
  }>;
  getWritingWorkshopDraft(id: string): Promise<WritingWorkshopSavedDraft | null>;
  saveWritingWorkshopDraft(request: WritingWorkshopSaveDraftRequest): Promise<WritingWorkshopSavedDraft>;
  /**
   * Mark a saved report read, or take the mark back. Resolves to the report as it now
   * stands, or `null` when it no longer exists — which is the honest answer for a
   * gallery holding an id another machine has since deleted.
   */
  setWritingWorkshopDraftRead(id: string, read: boolean): Promise<WritingWorkshopSavedDraft | null>;
  deleteWritingWorkshopDraft(id: string): Promise<void>;
  /**
   * Push: the saved-drafts table changed under this window's feet.
   *
   * Emitted when the inbox poller applies a mutation to writing_saved_drafts — which is how
   * a Deep Research report sent from the phone appears without remounting the gallery — and
   * on this window's own saves and deletes, so the channel means what its name says.
   * Returns its own unsubscribe.
   */
  onWritingDraftsChanged(cb: () => void): () => void;
  /** Persistent highlights and margin comments attached to one saved report. */
  listWritingDraftAnnotations(draftId: string): Promise<WritingDraftAnnotation[]>;
  createWritingDraftAnnotation(input: WritingDraftAnnotationInput): Promise<WritingDraftAnnotation>;
  updateWritingDraftComment(id: string, comment: string): Promise<WritingDraftAnnotation | null>;
  deleteWritingDraftAnnotation(id: string): Promise<void>;
  /** Push notification for local edits and annotations received through server sync. */
  onWritingDraftAnnotationsChanged(cb: (draftId: string | null) => void): () => void;

  // deep research (orchestrated, coverage-guided report over the whole corpus)
  /** Plan → write evidence-bearing sections → stop when the corpus adds no relevant contribution. */
  generateDeepResearchReport(request: DeepResearchRequest, handlers?: DeepResearchStreamHandlers): Promise<DeepResearchReport>;
  /** Every report in the shared generation lane, including those queued by MCP clients. */
  listDeepResearchJobs(): Promise<DeepResearchJobRecord[]>;
  /** Add a report from the app to the durable shared lane and return immediately. */
  enqueueDeepResearchJob(request: DeepResearchRequest): Promise<DeepResearchJobRecord>;
  /** Remove a queued report or cancel the one currently running. */
  cancelDeepResearchJob(id: string): Promise<boolean>;
  /** Forget the finished tail of the lane; returns how many jobs were dropped. */
  clearFinishedDeepResearchJobs(): Promise<number>;
  /** Subscribe to the lane; fires on every state change. Returns an unsubscribe function. */
  onDeepResearchQueue(cb: (jobs: DeepResearchJobRecord[]) => void): () => void;
  /** Study vaults: readable sources and organization for the complete-guide source tree. */
  listCompleteGuideCatalog(): Promise<import('../completeGuide/preview').CompleteGuideCatalog>;
  /** Study vaults: resolve a complete-guide selection and estimate what reading it in full costs. */
  previewCompleteGuide(request: import('../completeGuide/preview').CompleteGuidePreviewRequest): Promise<import('../completeGuide/preview').CompleteGuidePreview>;
  /** Exact quotes behind one citation of a saved complete guide (local evidence sidecar). */
  getCompleteGuideEvidence(draftId: string, itemId: string, language?: import('../types').PromptLanguage): Promise<import('../completeGuide/types').CompleteGuideEvidenceView | null>;

  // tutor mode (AI-guided graph walkthrough)
  /** Analyse the whole idea graph and propose weighted guided routes (overview or prompt-driven). */
  tutorPlan(request: TutorPlanRequest): Promise<TutorPlan>;
  listTutorRoutes(): Promise<TutorSavedRoute[]>;
  /** Save a completed route with the user's required 1–5 rating. */
  saveTutorRoute(plan: TutorPlan, route: TutorRoute, model: ModelRef | null, rating: number): Promise<TutorSavedRoute | null>;
  rateTutorRoute(routeId: string, rating: number | null): Promise<TutorSavedRoute | null>;
  markTutorRoutePlayed(routeId: string): Promise<TutorSavedRoute | null>;
  deleteTutorRoute(routeId: string): Promise<void>;
  /** Narrate one stop of a route, grounded in that node's ideas/evidence. */
  tutorStep(request: TutorStepRequest): Promise<TutorStepResponse>;
  tutorStepStream(request: TutorStepRequest, handlers: TutorStepStreamHandlers): Promise<TutorStepResponse>;

  // argument map (AI-traced hierarchical outline around a seed idea)
  /** Trace a hierarchical block outline of the ideas connected to a seed idea. */
  buildArgumentMap(request: ArgumentMapRequest): Promise<ArgumentMap>;
  /** Rank idea hubs by connectivity for the automatic mode (no AI, no model). */
  discoverArgumentRoutes(): Promise<ArgumentRouteSuggestion[]>;

  // research chat history
  listConversations(includeArchived?: boolean): Promise<ChatConversationSummary[]>;
  getConversation(id: string): Promise<ChatConversation | null>;
  createConversation(input: {
    model?: ModelRef | null;
    selection?: ResearchContextSelection | null;
    title?: string;
    /** Research chat project the new conversation starts in. */
    projectId?: string | null;
    /** A folder of that project it starts in. */
    folderId?: string | null;
  }): Promise<ChatConversation>;
  saveConversationMessages(
    id: string,
    messages: ChatMessageRecord[],
    meta?: { model?: ModelRef | null; selection?: ResearchContextSelection | null }
  ): Promise<void>;
  /** Ask the model for a short title from the conversation so far; persists + returns it. */
  generateConversationTitle(id: string, model?: ModelRef | null): Promise<string>;
  renameConversation(id: string, title: string): Promise<void>;
  archiveConversation(id: string, archived: boolean): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  /** Research chat projects, alphabetical. Optional: surfaces without projects omit them. */
  listChatProjects?(): Promise<ResearchChatProject[]>;
  createChatProject?(input: { name: string; icon?: string | null; color?: string | null; instructions?: string }): Promise<ResearchChatProject>;
  updateChatProject?(id: string, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }): Promise<ResearchChatProject>;
  /** The project's chats return to the general history; none is deleted. */
  deleteChatProject?(id: string): Promise<void>;
  /** Every project's folders; a project's tree is built from parentId and position. */
  listChatProjectFolders?(): Promise<ResearchChatProjectFolder[]>;
  createChatProjectFolder?(input: { projectId: string; parentId?: string | null; name: string }): Promise<ResearchChatProjectFolder>;
  renameChatProjectFolder?(id: string, name: string): Promise<ResearchChatProjectFolder>;
  /** Nest under `parentId` (null: the project's root) at `index`; refused with research_chat_folder_cycle into its own subtree. */
  moveChatProjectFolder?(id: string, parentId: string | null, index?: number): Promise<ResearchChatProjectFolder>;
  /** Subfolders go too; the chats of all of them stay in the project, unfiled. */
  deleteChatProjectFolder?(id: string): Promise<void>;
  /** Changing project clears the chat's folder. */
  setConversationProject?(id: string, projectId: string | null): Promise<void>;
  /** A folder also places the chat in its project; null leaves it in the project, unfiled. */
  setConversationFolder?(id: string, folderId: string | null): Promise<void>;
  /** Refused with research_chat_pin_limit beyond RESEARCH_CHAT_PIN_LIMIT pinned chats. */
  setConversationPinned?(id: string, pinned: boolean): Promise<void>;

  // The other chat histories (Databases, Worldbuilding, Study and Teaching): the same
  // projects, folders, pins, archive and rename, and notebooks where the surface keeps
  // its own, each call reaching only that surface's store in the active vault. Same rules
  // and the same refusals as the research chat calls above.
  listChatHistoryProjects?(surface: ChatHistorySurface): Promise<ResearchChatProject[]>;
  createChatHistoryProject?(surface: ChatHistorySurface, input: { name: string; icon?: string | null; color?: string | null; instructions?: string }): Promise<ResearchChatProject>;
  updateChatHistoryProject?(surface: ChatHistorySurface, id: string, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }): Promise<ResearchChatProject>;
  deleteChatHistoryProject?(surface: ChatHistorySurface, id: string): Promise<void>;
  listChatHistoryFolders?(surface: ChatHistorySurface): Promise<ResearchChatProjectFolder[]>;
  createChatHistoryFolder?(surface: ChatHistorySurface, input: { projectId: string; parentId?: string | null; name: string }): Promise<ResearchChatProjectFolder>;
  renameChatHistoryFolder?(surface: ChatHistorySurface, id: string, name: string): Promise<ResearchChatProjectFolder>;
  moveChatHistoryFolder?(surface: ChatHistorySurface, id: string, parentId: string | null, index?: number): Promise<ResearchChatProjectFolder>;
  deleteChatHistoryFolder?(surface: ChatHistorySurface, id: string): Promise<void>;
  setChatHistoryProject?(surface: ChatHistorySurface, conversationId: string, projectId: string | null): Promise<void>;
  setChatHistoryFolder?(surface: ChatHistorySurface, conversationId: string, folderId: string | null): Promise<void>;
  setChatHistoryPinned?(surface: ChatHistorySurface, conversationId: string, pinned: boolean): Promise<void>;
  renameChatHistoryConversation?(surface: ChatHistorySurface, conversationId: string, title: string): Promise<void>;
  archiveChatHistoryConversation?(surface: ChatHistorySurface, conversationId: string, archived: boolean): Promise<void>;
  listChatHistoryNotebooks?(surface: ChatHistoryNotebookSurface): Promise<ChatHistoryNotebook[]>;
  createChatHistoryNotebook?(surface: ChatHistoryNotebookSurface, input: { name: string; icon?: string | null; color?: string | null; selection: unknown }): Promise<ChatHistoryNotebook>;
  updateChatHistoryNotebook?(surface: ChatHistoryNotebookSurface, id: string, patch: { name?: string; icon?: string | null; color?: string | null; selection?: unknown }): Promise<ChatHistoryNotebook>;
  /** The notebook's chats return to the general history; none is deleted. */
  deleteChatHistoryNotebook?(surface: ChatHistoryNotebookSurface, id: string): Promise<void>;

  // notes (user-structured folders/subfolders with markdown + captured AI content)
  /** Load every folder and note in one payload; the renderer builds the tree. */
  getNotesTree(includeTrashed?: boolean): Promise<NotesTree>;
  createNoteFolder(input: CreateNoteFolderInput): Promise<NoteFolder>;
  renameNoteFolder(id: string, name: string): Promise<NoteFolder | null>;
  /** Re-parent a folder (null = root). Cycles are rejected and return the folder unchanged. */
  moveNoteFolder(id: string, parentId: string | null): Promise<NoteFolder | null>;
  /** Delete a folder and, recursively, its subfolders and all their notes. */
  deleteNoteFolder(id: string): Promise<void>;
  /** Delete a folder hierarchy but preserve its notes and ideas in the Workspace trash. */
  trashNoteFolder(id: string): Promise<string[]>;
  createNote(input: CreateNoteInput): Promise<Note>;
  getNote(id: string): Promise<Note | null>;
  updateNote(input: UpdateNoteInput): Promise<Note | null>;
  /** Move a note to another folder (null = unfiled / root). */
  moveNote(id: string, folderId: string | null): Promise<Note | null>;
  /** Add or remove user labels from several Workspace items atomically. */
  patchNoteTags(noteIds: string[], patch: NoteTagPatch): Promise<Note[]>;
  /** Move Workspace items to the recoverable trash without deleting graph ideas. */
  trashNotes(noteIds: string[]): Promise<void>;
  restoreNotes(noteIds: string[]): Promise<void>;
  /** Permanently delete trashed items and their owned manual graph ideas. */
  deleteNotesPermanently(noteIds: string[]): Promise<void>;
  deleteNote(id: string): Promise<void>;

  getManualIndexStatus(): Promise<{ state: 'idle' | 'queued' | 'preparing' | 'indexing' | 'ready' | 'error'; error: string | null }>;
  retryManualIndex(): Promise<void>;

  // manual ideas (user-authored, note-owned graph ideas)
  /** Create an empty manual idea plus the note that owns it. */
  createManualIdea(input: { folderId: string | null; title?: string }): Promise<{ note: Note; globalId: string }>;
  /** Replace the structured data (title, summary, works, evidence, connections) of a manual idea. */
  saveManualIdea(payload: ManualIdeaPayload): Promise<void>;
  /** Embed the idea and return semantically related ideas to connect to. */
  autoIndexManualIdea(input: { globalId: string; title: string; summary: string; excludeIds?: string[] }): Promise<AutoIndexResult>;
  /** Keyword search over existing ideas to add a manual connection. */
  searchIdeaCandidates(query: string, excludeIds?: string[], limit?: number): Promise<IdeaCandidate[]>;

  /** Export notes (and their ideas/relations/bibliography) to a structured file. */
  exportNotes(options: NotesExportOptions): Promise<{ path: string } | null>;
  /** Persist an explicit note order (order_idx = position). Used for AI reorder + undo. */
  reorderNotes(noteIds: string[]): Promise<void>;
  /** Ask the AI to order the given notes into a logical sequence; persists and returns it. */
  reorderNotesByAI(noteIds: string[]): Promise<NotesReorderResult>;
  /** Update a folder's summary brief (the ideas it is meant to hold). */
  updateNoteFolderSummary(id: string, summary: string): Promise<NoteFolder | null>;
  /** Match the folder summary against every idea (semantic + connections + AI) and suggest ideas to integrate. */
  suggestFolderIdeas(folderId: string): Promise<FolderIdeaSuggestionsResult>;

  // Workspace: el mismo editor de Estudio y Docencia, escribiendo sobre una nota, y los
  // enlaces persistentes entre lo que se escribe y la biblioteca del usuario.
  getWorkspaceNoteEditorData(noteId: string): Promise<StudyDocEditorData>;
  updateWorkspaceNote(noteId: string, input: StudyDocUpdateInput): Promise<Note>;
  restoreWorkspaceNoteVersion(noteId: string, versionId: string): Promise<Note>;
  createWorkspaceAnnotation(noteId: string, input: StudyAnnotationInput): Promise<StudyAnnotation>;
  updateWorkspaceAnnotation(id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }): Promise<StudyAnnotation | null>;
  deleteWorkspaceAnnotation(id: string): Promise<void>;
  /** Live links of Workspace notes to study places; a note or place in the trash hides its links. */
  listStudyNoteLinks(filter?: StudyNoteLinkFilter): Promise<StudyNoteLink[]>;
  /** Links a note to a course, subject, folder, topic or material; linking twice returns the same link. */
  addStudyNoteLink(input: StudyNoteLinkInput): Promise<StudyNoteLink>;
  /** Unlinks only: the note stays in the Workspace. */
  removeStudyNoteLinks(ids: string[]): Promise<void>;
  listWorkspaceLibraryLinks(ownerKind: WorkspaceLinkOwnerKind, ownerId: string): Promise<WorkspaceLibraryLink[]>;
  listAllWorkspaceLibraryLinks(): Promise<WorkspaceLibraryLink[]>;
  addWorkspaceLibraryLink(input: WorkspaceLibraryLinkInput): Promise<WorkspaceLibraryLink>;
  removeWorkspaceLibraryLink(
    ownerKind: WorkspaceLinkOwnerKind,
    ownerId: string,
    libraryItemId: string,
    scope?: 'global' | 'vault'
  ): Promise<void>;
  /** Check which inline citations resolve to a real source. Key is `${kind}:${id}`. */
  verifyCitations(refs: CitationRef[]): Promise<Record<string, boolean>>;
  /** Lightweight preview (title + snippet) of a cited source for its hover-card. Null if it no longer resolves. */
  getCitationPreview(ref: CitationRef): Promise<CitationPreview | null>;
  /** Search across ideas, works, gaps, themes, authors and notes. */
  searchVaultContent(query: string, kinds?: string[], semantic?: boolean, limit?: number): Promise<import('../hybridSearch').VaultContentSearchResponse>;
  globalSearch(query: string, limitPerKind?: number, kinds?: SearchResultKind[]): Promise<GlobalSearchResult[]>;
  /** Metadata-only link catalogue, scoped to the active vault and visible ideas. */
  inspectAcademicDocument(input:{documentId:string;kind:'note'|'study';expectedRevision?:number}):Promise<import('../academicDocument').AcademicIssue[]>;
  listEditorReferences(options?:{includePassages?:boolean;search?:string}): Promise<import('../editorReferences').EditorReference[]>;
  getSearchResultDetail(kind: SearchResultKind, id: string): Promise<SearchResultDetail | null>;
  /** Search by meaning over embedded ideas, passages and works. */
  semanticSearch(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResponse>;
  /** Find ideas whose meaning is closest to the given idea ("ideas parecidas a esta"). */
  findSimilarToIdea(globalId: string, limit?: number): Promise<SemanticSearchResponse>;
  /** Saved searches (query + mode + kind filters), newest first. */
  listSavedSearches(): Promise<SavedSearch[]>;
  saveSearch(input: SaveSearchInput): Promise<SavedSearch>;
  deleteSavedSearch(id: string): Promise<void>;
  /** Operational health of the corpus for the Home dashboard. */
  getCorpusHealth(): Promise<CorpusHealth>;
  /** Ask the AI for keywords/queries to find literature filling a research gap. */
  suggestGapSearch(statement: string, workTitles: string[]): Promise<GapSearchSuggestions>;

  // projects / manuscripts
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<ProjectDetail | null>;
  createProject(input: CreateProjectInput): Promise<ProjectDetail>;
  updateProject(input: UpdateProjectInput): Promise<Project | null>;
  deleteProject(id: string): Promise<void>;
  updateProjectSection(input: UpdateProjectSectionInput): Promise<ProjectSection | null>;
  addProjectLink(input: AddProjectLinkInput): Promise<ProjectLink>;
  deleteProjectLink(id: string): Promise<void>;
  importProjectChapter(input: ImportProjectChapterInput): Promise<ProjectChapter | null>;
  updateProjectChapter(chapterId: string, markdown: string): Promise<ProjectChapter | null>;
  listProjectChapterSuggestions(chapterId: string): Promise<ProjectInsertionSuggestion[]>;
  generateProjectSuggestions(request: GenerateProjectSuggestionsRequest): Promise<ProjectInsertionSuggestion[]>;
  updateProjectSuggestionStatus(id: string, status: ChapterSuggestionStatus): Promise<ProjectInsertionSuggestion | null>;
  applyProjectSuggestions(request: ApplyProjectSuggestionsRequest): Promise<ProjectChapter | null>;
  listProjectChapterVersions(chapterId: string): Promise<ProjectChapterVersion[]>;
  restoreProjectChapterVersion(versionId: string): Promise<ProjectChapter | null>;
  /** Cached chapter ideas + their typed relations with the library (no AI call). */
  getChapterRelations(chapterId: string): Promise<ChapterRelationsResult>;
  /** Extract chapter ideas, embed them and discover typed relations with the library. */
  analyzeChapterRelations(request: AnalyzeChapterRelationsRequest): Promise<ChapterRelationsResult>;
  onChapterRelationsProgress(cb: (p: ChapterRelationsProgress) => void): () => void;
  /** Check uncited manuscript claims against indexed/listed corpus ideas and passages. */
  verifyManuscriptCitations(request: ManuscriptVerificationRequest): Promise<ManuscriptVerificationResult>;
  /** Insert a chosen citation into the draft at the claim sentence, saving a recoverable version. */
  applyManuscriptCitation(request: ApplyManuscriptCitationRequest): Promise<ApplyManuscriptCitationResult>;
  exportProject(request: ExportProjectRequest): Promise<{ path: string } | null>;
  exportProjectChapter(request: ExportProjectChapterRequest): Promise<{ path: string } | null>;

  // export / import
  exportData(): Promise<{ path: string; password: string; recoveryKey: string } | null>;
  importData(password: string): Promise<{ ok: boolean; message: string }>;
  /** Export the user layer (notes, drafts, saved searches, edge verdicts) as a portable sync package. */
  exportSyncPackage(): Promise<{ path: string; counts: Record<string, number> } | null>;
  /** Merge a sync package from another machine. Additive; newest row wins; never deletes local data. */
  importSyncPackage(passphrase?: string): Promise<SyncMergeSummary | null>;
  getStudyDataOverview(): Promise<StudyDataOverview>;
  maintainStudyData(action: 'rebuild-indexes' | 'clear-embeddings' | 'empty-trash' | 'repair'): Promise<StudyDataMaintenanceResult>;
  exportStudyDiagnostic(): Promise<{ path: string } | null>;
  exportStudyScope(scope: StudyExportScope, format: StudyExportFormat): Promise<{ path: string } | null>;
  /** Wipe all derived graph data (ideas, themes, edges, authors, gaps) and reset scan
   *  status on every work. The library and settings are kept. */
  resetGraph(): Promise<void>;

  // demo mode
  /** Whether the database holds any user content (works, notes or ideas). */
  hasAnyData(): Promise<boolean>;
  /** Seed the curated demo corpus. Returns false (no-op) if data already exists. */
  seedDemoData(): Promise<boolean>;
  /** Seed the wholly fictional Primary Sources training corpus in an empty vault. */
  seedPrimarySourcesDemoData(): Promise<boolean>;
  /** Remove every demo row and leave demo mode. */
  clearDemoData(): Promise<void>;
  /** Seed the genealogy demo (Serrano–Vidal family) and flip the vault to genealogy;
   *  kicks off background portrait generation when a Gemini key is present. */
  seedGenealogyDemoData(): Promise<{ seeded: boolean; willGeneratePortraits: boolean }>;
  seedDatabasesDemoData(): Promise<boolean>;
  /** Seed an empty study vault with a small, fully local learning workspace. */
  seedStudyDemoData(): Promise<boolean>;
  /** Seed a teaching vault with a class, a rubric, an exam and a published gradebook.
   *  Returns false outside a `docencia` vault, or when the demo is already loaded. */
  seedTeachingDemoData(): Promise<boolean>;
  /** Seed an empty worldbuilding vault with the complete local-only Ashen Tides world. */


  seedWorldbuildingDemoData(): Promise<boolean>;
  /** Sembrar un vault de testimonios con el proyecto ficticio «Memoria del valle». */
  seedTestimonyDemoData(): Promise<boolean>;
  /** Generate daguerreotype portraits for the demo people (cheap Gemini model). */
  generateDemoPortraits(): Promise<{ generated: number; skipped: number }>;
  /** Progress of demo portrait generation. Returns an unsubscribe function. */
  onDemoPortraitsProgress(cb: (p: { done: number; total: number }) => void): () => void;

  // embedding pipeline
  /** Start embedding generation for the given works (or all non-archived works if empty). */
  startEmbedding(nodusIds?: string[]): Promise<void>;
  /** Clear all existing embeddings and regenerate from scratch. */
  reindexAll(): Promise<void>;
  pauseEmbedding(): Promise<void>;
  resumeEmbedding(): Promise<void>;
  stopEmbedding(): Promise<void>;
  /** Hide a completed/stopped embedding queue without deleting generated embeddings. */
  clearEmbeddingProgress(): Promise<void>;
  getEmbeddingStatus(): Promise<EmbeddingPipelineProgress>;
  /** Per-work embedding counts for the library table. */
  getWorkEmbeddingStatuses(nodusIds?: string[]): Promise<WorkEmbeddingStatus[]>;
  onEmbeddingProgress(cb: (p: EmbeddingPipelineProgress) => void): () => void;

  // full-text passage index
  /** Index full-text passages for the chosen works; analysis in the idea graph is not required. */
  startPassageEmbedding(nodusIds?: string[]): Promise<void>;
  pausePassageEmbedding(): Promise<void>;
  resumePassageEmbedding(): Promise<void>;
  stopPassageEmbedding(): Promise<void>;
  clearPassageProgress(): Promise<void>;
  getPassageStatus(): Promise<PassageEmbeddingProgress>;
  getWorkPassageStatuses(nodusIds?: string[]): Promise<WorkPassageStatus[]>;
  onPassageProgress(cb: (p: PassageEmbeddingProgress) => void): () => void;
  getPassage(passageId: string): Promise<PassageDetail | null>;

  // semantic bridge discovery
  discoverSemanticBridges(model?: ModelRef | null): Promise<SemanticBridgeResult>;
  isSemanticBridgeRunning(): Promise<boolean>;
  onSemanticBridgeProgress(cb: (p: SemanticBridgeProgress) => void): () => void;
}
