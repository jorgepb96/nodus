import type { StudyFocusApi } from './studyFocus';
import type { SkillMarketplace } from './skillMarketplace';
import type { InboxPluginSummary, InstalledPluginSummary } from '../skill-capabilities/contracts';
import type { ChatSkill } from './chatSkills';
// Type-only, so the pair of modules stays free of a runtime cycle: the reasoning profile
// needs ModelRef/ModelInfo and the settings shape needs the effort union.
import type { ResearchEffort } from './researchReasoning';
// Shared domain types used by both the Electron main process and the React renderer.
// Keep this file free of any runtime imports from either side.
// Per-domain slices of the window.nodus contract. NodusApi extends them, so the
// renderer surface stays flat and unchanged; only the file each method is
// declared in moves. See shared/api/ for the slices extracted so far.
import type { ProsopographyApi } from './api/prosopography';
import type { AcademicApi } from './api/academic';
import type { RecordsApi } from './api/records';
import type { PlatformApi } from './api/platform';
import type { WorldbuildingApi } from './api/worldbuilding';
import type { ArchiveApi } from './api/archive';
import type { PrimarySourcesApi } from './api/primarySources';
import type { DatabasesApi } from './api/databases';
import type { PagesApi } from './api/pages';
import type { TeachingApi } from './api/teaching';
import type { ToolkitApi } from './api/toolkit';
import type { TestimoniesApi } from './api/testimonies';
import type { LibraryApi } from './api/library';
import type { RadarApi } from './api/radar';
import type { ReactionIndexApi } from './api/reactionIndex';
import type { CompassApi } from './api/compass';
import type { LogsApi } from './api/logs';
import type { DriftApi } from './api/drift';
import type { LibraryAttachmentRecord } from './libraryTypes';
import type { ToolkitToolPage } from './toolkitNavigation';

export type {
  LibraryAttachmentRecord,
  LibraryCatalogItem,
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryCollectionRecord,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryItemType,
  LibraryMigrationProgress,
  LibraryMigrationPreview,
  LibraryMigrationReport,
  LibraryMigrationSession,
  LibraryMigrationStartRequest,
  LibraryRebuildResult,
  LibraryRecordClock,
  LibraryStatus,
  LibraryVaultLink,
} from './libraryTypes';

// Testimonios (historia oral). Las REGLAS del dominio — transiciones, normalización de
// códigos, remapeo de citas, la puerta de acceso — viven en './testimonies' y
// './testimonyAccess', que son módulos puros y se prueban sin arrancar Electron. Aquí
// solo se reexportan sus tipos, para que NodusApi y el renderer los reciban desde
// '@shared/types' igual que el resto del sistema.
import type {
  AccessLevel,
  AgreementStatus,
  AnnotationKind,
  AttributionMode,
  CodeKind,
  DocumentedUse,
  IdentityMode,
  InterviewFilters,
  InterviewKind,
  InterviewMode,
  InterviewSort,
  InterviewWorkflowStatus,
  MediaKind,
  MediaRole,
  NarratorReviewStatus,
  ParticipantRole as OralHistoryParticipantRole,
  SavedInterviewView,
  SessionStatus,
  TranscriptKind,
  TranscriptStatus,
} from './testimonies';
import type { AccessChannel, AccessDecision, AccessDenialReason, VaultAccessPolicy } from './testimonyAccess';

export type {
  InterviewKind,
  InterviewMode,
  InterviewWorkflowStatus,
  SavedInterviewView,
  InterviewFilters as TestimonyInterviewFilters,
  InterviewSort as TestimonyInterviewSort,
  OralHistoryParticipantRole as TestimonyParticipantRole,
  IdentityMode as TestimonyIdentityMode,
  SessionStatus as TestimonySessionStatus,
  MediaKind as TestimonyMediaKind,
  MediaRole as TestimonyMediaRole,
  TranscriptKind as TestimonyTranscriptKind,
  TranscriptStatus as TestimonyTranscriptStatus,
  CodeKind as TestimonyCodeKind,
  AnnotationKind as TestimonyAnnotationKind,
  AgreementStatus as TestimonyAgreementStatus,
  AccessLevel as TestimonyAccessLevel,
  AttributionMode as TestimonyAttributionMode,
  NarratorReviewStatus as TestimonyNarratorReviewStatus,
  DocumentedUse as TestimonyDocumentedUse,
  AccessChannel as TestimonyAccessChannel,
  AccessDecision as TestimonyAccessDecision,
  AccessDenialReason as TestimonyAccessDenialReason,
  VaultAccessPolicy as TestimonyVaultAccessPolicy,
};

// Type-only re-export of the Nodus Toolkit type surface, so NodusApi (and callers
// that import from '@shared/types') get the toolkit types from one place. The
// runtime catalogue (TOOLKIT_OPS, toolkitOp, …) is imported directly from
// '@shared/toolkitTypes' to preserve this file's no-runtime-import rule.
export type {
  ToolkitCategory,
  ToolkitOpId,
  ToolkitOutput,
  ToolkitOptionType,
  ToolkitOptionField,
  ToolkitArity,
  ToolkitOp,
  ToolkitProduced,
  ToolkitFileStatus,
  ToolkitFileProgress,
  ToolkitJobRequest,
  ToolkitJobProgress,
  ToolkitJobResult,
} from './toolkitTypes';
// Type-only re-export of the AI OCR (OCR Workspace) surface, so NodusApi and renderer
// callers get these from '@shared/types' too. Runtime helpers live in '@shared/aiOcrTypes'.
export type {
  OcrBlockLabel,
  OcrBlock,
  OcrPageResult,
  OcrProcessingMode,
  OcrOutputMode,
  OcrOptions,
  OcrDocStatus,
  OcrPageStatus,
  OcrPageState,
  OcrSourceKind,
  OcrDoc,
  OcrDocSummary,
  OcrDocProgress,
  AiOcrCreateRequest,
  AiOcrExportFormat,
  AiOcrExportResult,
} from './aiOcrTypes';
export type {
  TranslateInputKind,
  TranslatePdfMode,
  TranslateOutputFormat,
  TranslateMarkupKind,
  TranslateZoteroSource,
  TranslateJobRequest,
  TranslateJobStage,
  TranslateJobProgress,
  TranslateOutputResult,
  TranslateJobResult,
  TranslateHistoryEntry,
  TranslateSegment,
  TranslateSegmentResult,
} from './toolkitTranslateTypes';
export type {
  ProtectInputExtension,
  ProtectSourceKind,
  ProtectSourceRef,
  ProtectSourceSummary,
  ProtectFilePayload,
  ProtectListSourcesRequest,
  ProtectArtifactFormat,
  ProtectArtifact,
  ProtectArtifactWriteResult,
  ProtectShareResult,
  ProtectVaultCopySummary,
  ProtectIssuedCopy,
  ProtectWatermarkPattern,
  ProtectManualWatermarkItem,
  ProtectWatermark,
  ProtectExportFooter,
  ProtectTraceOptions,
} from './protectTypes';
export type {
  ToolkitAppCategory,
  ToolkitAppAccent,
  ToolkitAppJsonValue,
  ToolkitAppManifest,
  StoredToolkitApp,
  ToolkitAppGenerationRequest,
  ToolkitAppGenerationProgress,
  ToolkitAppGenerationResult,
  ToolkitAppSessionInfo,
  ToolkitAppParticipant,
  ToolkitAppSessionMessage,
  ToolkitAppSessionSnapshot,
  ToolkitAppSessionEvent,
} from './toolkitApps';

// Type-only import (erased at compile time) — keeps the no-runtime-import rule intact.
import type { VaultType } from './vaultTypes';
import type { TutorialVideo } from './tutorialVideos';
import type { NodiNotificationText } from './nodiNotifications';
import type { AnnouncementEntry, AnnouncementRefreshResult } from './announcements';
import type {
} from './toolkitApps';
import type {
} from './protectTypes';
import type {
} from './studyEditor';
import type {
  StudySttProvider,
} from './sttModels';
import type { NodusImageQuality } from './localImageModels';
import type {
} from './studyImprove';
import type {
} from './studyMaterials';
import type {
} from './studyRecordings';
import type {
} from './studySearch';
import type {
} from './studyAssistant';
import type {
} from './studyQuestions';
import type {
} from './studyAssessments';
import type {
} from './studyGrading';
import type { StudyAiTask } from './studyAi';
export type { TeachingGroup, TeachingGroupInput, TeachingStudent } from './teachingGroups';
export type * from './assessmentImport';
export type * from './assessment/model';
import type {
} from './studyKnowledge';
export type { StudySchedule, StudyScheduleCell, StudyScheduleDay, StudySchedulePeriod, StudyScheduleSection } from './studySchedule';
export type {
  ExtractedStudyIdea,
  ExtractedStudyRelation,
  StudyMaterialAiProcessingDecision,
  StudyMaterialAiProcessingPrompt,
  StudyAssessmentKnowledgeContext,
  StudyIdeaConnection,
  StudyIdeaDetail,
  StudyIdeaEvidence,
  StudyIdeaRelationType,
  StudyIdeaSummary,
  StudyIdeaType,
  StudyKnowledgeExtraction,
  StudyKnowledgeGraph,
  StudyKnowledgeGraphEdge,
  StudyKnowledgeGraphNode,
  StudyKnowledgeJob,
  StudyKnowledgeJobStatus,
  StudyKnowledgeProgress,
  StudyKnowledgeSourceKind,
} from './studyKnowledge';
export type {
  StudyMaterialAnnotation,
  StudyMaterialAnnotationInput,
  StudyMaterialBibliography,
  StudyMaterialContent,
  StudyMaterialDetail,
  StudyMaterialFragmentLink,
  StudyMaterialImportInput,
  StudyMaterialImportResult,
  StudyMaterialIndexResult,
  StudyMaterialIndexStatus,
  StudyMaterialListOptions,
  StudyMaterialMetadata,
  StudyMaterialPlacement,
  StudyMaterialPreviewKind,
  StudyMaterialAnnotationKind,
  StudyMaterialPoint,
  StudyMaterialReadState,
  StudyMaterialRect,
  StudyMaterialSourceRef,
  StudyMaterialSummary,
  StudyMaterialVisualAnalysisStatus,
  StudyMaterialUpdateInput,
  StudyMaterialVersion,
  ZoteroStudyMaterialImportInput,
} from './studyMaterials';
export type {
  StudyAudioMarker,
  StudyAudioMarkerInput,
  StudyDiarizationRequest,
  StudyDiarizationResult,
  StudyRecordingContent,
  StudyRecordingCreateInput,
  StudyRecordingDetail,
  StudyRecordingImportResult,
  StudyRecordingListOptions,
  StudyRecordingScope,
  StudyRecordingStatus,
  StudyRecordingSummary,
  StudyRecordingUpdateInput,
  StudyTranscript,
  StudyTranscriptInput,
  StudyTranscriptKind,
  StudyTranscriptSegment,
  StudyTranscriptSegmentInput,
  StudyWhisperChunk,
} from './studyRecordings';
export type {
  StudySavedSearch,
  StudySearchHistoryEntry,
  StudySearchIndexEntry,
  StudySearchIndexStatus,
  StudySearchKind,
  StudySearchLocation,
  StudySearchOptions,
  StudySearchProgress,
  StudySearchResponse,
  StudySearchResult,
  StudySearchScore,
  StudySearchScope,
  StudySearchSort,
} from './studySearch';
export type {
  StudyAssistantCitation,
  StudyAssistantContextStats,
  StudyAssistantConversation,
  StudyAssistantConversationInput,
  StudyAssistantConversationPatch,
  StudyAssistantConversationSummary,
  StudyAssistantLanguage,
  StudyAssistantLevel,
  StudyAssistantMessage,
  StudyAssistantRequest,
  StudyAssistantResponse,
  StudyAssistantScopeKind,
  StudyAssistantSelection,
  StudyAssistantSourceOption,
  StudyAssistantStreamHandlers,
  StudyAssistantTask,
  StudyAssistantTone,
} from './studyAssistant';
export type {
  StudyCognitiveLevel,
  StudyQuestion,
  StudyQuestionAnswer,
  StudyQuestionBulkAction,
  StudyQuestionCollection,
  StudyQuestionDifficulty,
  StudyQuestionExport,
  StudyQuestionFilters,
  StudyQuestionGenerationRequest,
  StudyQuestionGenerationResult,
  StudyQuestionInput,
  StudyQuestionOption,
  StudyQuestionSort,
  StudyQuestionSource,
  StudyQuestionStatus,
  StudyQuestionType,
  StudyQuestionVersion,
  StudyQuestionAnalytics,
  StudyQuestionSimilar,
} from './studyQuestions';
export type {
  StudyAnswerEvaluation,
  StudyAssessment,
  StudyAssessmentConfig,
  StudyAssessmentInput,
  StudyAssessmentItem,
  StudyAssessmentKind,
  StudyAssessmentMode,
  StudyAssessmentSelection,
  StudyAttempt,
  StudyAttemptAnswer,
  StudyAttemptAnswerInput,
  StudyAttemptConfig,
  StudyAttemptStartInput,
  StudyAttemptStatus,
  StudyCorrectionMode,
  StudyQuestionResponse,
  StudyTestBuildRequest,
} from './studyAssessments';
export type {
  StudyCriterionGrade,
  StudyGradingAnnotation,
  StudyGradingAnnotationInput,
  StudyGradingAnnotationKind,
  StudyGradingAnnotationSeverity,
  StudyGradingRequest,
  StudyGradingResult,
  StudyGradingRun,
  StudyGradingSeverity,
  StudyGradingSource,
  StudyGradingStreamHandlers,
  StudyRubric,
  StudyRubricCriterion,
  StudyRubricInput,
} from './studyGrading';
export type { StudyFlashcard, StudyFlashcardBulkAction, StudyFlashcardExport, StudyFlashcardFilters, StudyFlashcardInput, StudyFlashcardSort, StudyFlashcardType, StudyReviewInput, StudyReviewRecord } from './studyFlashcards';
export type { StudyImportLocation, StudyInterchangeExportOptions, StudyInterchangeFormat, StudyInterchangeImportOptions, StudyInterchangeKind, StudyInterchangeParseResult, StudyInterchangeSummary } from './studyInterchange';
export type { StudySrsRating, StudySrsReviewResult, StudySrsState } from './studySrs';
export type { StudyPerformanceEvidence, StudyPerformanceSummary, StudyProgressDashboard, StudyProgressScope } from './studyStats';
export type { StudyCalendarEvent, StudyCalendarEventInput, StudyCalendarEventType, StudyGoal, StudyPlan, StudyPlanBlock, StudyPlannerSnapshot, StudyStudySession } from './studyPlanner';
export type { StudyAiTask, StudyAiUsage, StudyAiUsageSummary } from './studyAi';
export type { StudyLinkedNoteSummary, StudyNoteLink, StudyNoteLinkFilter, StudyNoteLinkInput, StudyNoteLinkTargetKind } from './studyNoteLinks';
export type {
  StudyImproveLength,
  StudyImproveLevel,
  StudyImproveMode,
  StudyImprovePresetId,
  StudyImproveRequest,
  StudyImproveResult,
  StudyImproveScope,
  StudyImproveStreamHandlers,
  StudyImprovementLog,
  StudyImproveVariables,
  StudyProtectedSpan,
  StudyProtectedSpanKind,
  StudyStyle,
  StudyStyleAssociation,
  StudyStyleAssociationKind,
  StudyStyleCategory,
  StudyStyleConfig,
  StudyStyleExport,
  StudyStyleInput,
  StudyStyleVersion,
} from './studyImprove';
export type {
  StudySentenceContext,
  StudySynonymAlternative,
  StudySynonymRequest,
  StudySynonymResult,
} from './studySynonyms';
export type {
  StudyDictationAction,
  StudyDictationTransform,
  StudyDictationTransformOptions,
  StudySttDeviceProfile,
  StudySttModel,
  StudySttProvider,
  StudySttRequest,
  StudySttResult,
  StudySttStreamHandlers,
  WhisperCppStatus,
} from './sttModels';
export type {
  ParsedStudyDocLink,
  StudyAnnotation,
  StudyAnnotationInput,
  StudyDocEditorData,
  StudyDocLink,
  StudyDocStyle,
  StudyDocUpdateInput,
  StudyDocVersion,
  StudyDocumentStats,
  StudyEditorAlignment,
  StudyEditorCommand,
  StudyEditorSaveReason,
  StudyEditorTheme,
  StudyOutlineItem,
} from './studyEditor';
import type {
} from './studyOrg';
export type {
  CreateStudyCourseInput,
  CreateStudyDocumentInput,
  CreateStudyFolderInput,
  CreateStudySubjectInput,
  CreateStudyTagInput,
  CreateStudyTemplateInput,
  CreateStudyTopicInput,
  StudyCourse,
  StudyDocument,
  StudyDocumentKind,
  StudyEntityMoveInput,
  StudyEntityKind,
  StudyFolder,
  StudyLifecycleAction,
  StudyPlacement,
  StudyPlacementInput,
  StudySubject,
  StudyTag,
  StudyTemplate,
  StudyTopic,
  StudyWorkspace,
  StudyWorkspaceOptions,
} from './studyOrg';
import type {
} from './studyAcademicYears';
export type {
  CreateStudyAcademicYearInput,
  StudyAcademicYear,
  UpdateStudyAcademicYearInput,
} from './studyAcademicYears';
import type { ArchiveMatchMode, ArchiveSortKey } from './archiveFilters';
export type { ArchiveMatchMode, ArchiveSortKey } from './archiveFilters';
export type { VaultType };
import type {
} from './databases';
export type {
  DatabaseAttachment,
  DatabaseColumn,
  DatabaseColumnConfig,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRelation,
  DatabaseRow,
  DatabaseRowHit,
  DatabaseRowSort,
  DatabaseSearchHit,
  DatabaseSelectOption,
  DatabaseSummary,
  RelationTarget,
  RelationTargetKind,
} from './databases';
export type {
  DatabaseFilterState,
  DatabaseSavedView,
  DatabaseViewRevision,
  FilterCondition,
  FilterGroup,
  SavedViewInput,
  SavedViewPatch,
  SortRule,
} from './databaseFilters';
export type {
  DatabaseViewConfig,
  DatabaseViewDensity,
  DatabaseViewEditPermission,
  DatabaseViewLayout,
  DatabaseViewOpenMode,
  DatabaseViewPropertyConfig,
  DatabaseViewScope,
} from './databaseViewConfig';
export type {
  DatabaseRowPage,
  DatabaseRowQuery,
  FilterConditionNode,
  FilterGroupNode,
  FilterNode,
  GroupRule,
} from './databaseQuery';
export type {
  AttachDatabaseViewSourceInput,
  DatabaseContainerDefinition,
  DatabaseContainerProperty,
  DatabaseContainerRow,
  DatabaseContainerRowPage,
  DatabaseContainerRowQuery,
  DatabaseDataSource,
  DatabaseViewDataSource,
} from './databaseSources';
export type {
  CreateDatabaseRowTemplateInput,
  DatabaseDuplicateRowInput,
  DatabaseRowDependency,
  DatabaseRowHierarchyItem,
  DatabaseRowTemplate,
  DatabaseSprint,
  DatabaseSprintState,
  DatabaseTaskConfig,
  DatabaseTaskDateChange,
  DatabaseTemplateInstantiation,
  DatabaseTemplateRecurrence,
  DatabaseTemplateRelationDefault,
  DatabaseSubitemView,
} from './databaseTasks';
export type {
  AutomationAction,
  AutomationEvent,
  AutomationRule,
  AutomationRuleMutationResult,
  AutomationRun,
  AutomationRunStatus,
  AutomationTrigger,
  AutomationTriggerType,
  AutomationValue,
  CreateAutomationRuleInput,
  CreateFormDefinitionInput,
  DatabaseFormAccess,
  DatabaseFormField,
  DatabaseFormServerStatus,
  DatabaseFormSubmission,
  FormDefinition,
  FormDefinitionMutationResult,
} from './databaseAutomations';
export type { ColumnProfile, DatabaseProfile, DistributionSlice, NumberStats } from './dataProfile';
import type { DbChatTurn } from './databaseChat';
export type { DbChatTurn } from './databaseChat';
export type { ChartSpec, ChatSegment } from './chartSpec';
export type {
  AnalysisKind,
  AnalysisOptions,
  AnalysisRequest,
  AnalysisResult,
  AnalysisSuggestion,
  ScatterPoint,
  DescriptiveColumn,
  DescriptiveResult,
  CorrelationResultOut,
  CorrelationMatrixResult,
  CovarianceMatrixResult,
  ChiSquareResultOut,
  CrosstabResult,
  GroupMetric,
  GroupCompareResult,
  TopValuesResult,
  SeriesLine,
  TimeSeriesResult,
  DataQualityColumn,
  DataQualityResult,
} from './analysisSpec';
export type { ColumnRole, ColumnRoles, KindMeta, RoleColumn } from './analysisCatalog';

export interface DatabaseChatRequest {
  attachmentIds?: string[];
  /** Optional vault-local preference; null/absence keeps the original application prompt. */
  systemPromptId?: string | null;
  model?: ModelRef | null;
  thinkingEffort?: import('./researchReasoning').ResearchEffort;
  conversationId?: string;
  question: string;
  databaseIds: string[];
  history?: DbChatTurn[];
}

export interface DatabaseChatConversationSummary extends ChatHistoryPlacementFields {
  id: string;
  title: string;
  databaseIds: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseChatConversation extends DatabaseChatConversationSummary {
  messages: DbChatTurn[];
}

export type IdeaType = 'claim' | 'finding' | 'construct' | 'method' | 'framework';
export type GraphNodeType = IdeaType | 'theme' | 'author';

export type EdgeType =
  | 'extends'
  | 'contradicts'
  | 'applies_to'
  | 'shares_method'
  | 'precondition_of'
  | 'measures_same'
  | 'supports'
  | 'refutes'
  | 'variant_of'
  | 'refines'
  | 'contains';

export type EdgeBasis = 'explicit' | 'inferred';
export type EvidenceKind = 'explicit' | 'paraphrased';

export type LightStatus = 'none' | 'pending' | 'done' | 'failed';
export type DeepStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
export type SummaryStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
export type DeepTrigger = 'tag' | 'manual' | 'both' | null;
export type SourceType = 'pdf' | 'epub' | 'markdown' | 'upload' | 'abstract_only' | 'none';
export type ResolvedSourceType = SourceType | 'mixed';
export type TextSourceOrigin =
  | 'local_attachment'
  | 'zotero_fulltext'
  | 'unpaywall_pdf'
  | 'uploaded_file'
  | 'library_clean'
  | 'abstract';
export type TextBlockReason =
  | 'abstract_only'
  | 'no_attachment'
  | 'file_missing'
  | 'scanned_no_ocr'
  | 'unreadable'
  | 'unsupported'
  // Zotero's local API could not be reached, so whether an attachment exists is
  // unknown. Never conflate this with `no_attachment`: the work may well have full
  // text and must be retried once Zotero is running.
  | 'zotero_unavailable';

export interface WorkTextSource {
  nodus_id: string;
  source_ref: string;
  origin: TextSourceOrigin;
  source_type: SourceType;
  zotero_library_id: string | null;
  attachment_key: string | null;
  display_name: string | null;
  content_hash: string;
  char_count: number;
  page_count: number | null;
  has_page_markers: number;
  ordinal: number;
  active: number;
  resolved_at: string;
}

export interface ResolvedTextState {
  sourceType: ResolvedSourceType;
  textHash: string | null;
  textChars: number;
  sourceCount: number;
  hasPageMarkers: boolean;
  blockReason: TextBlockReason | null;
  notes: string | null;
  resolvedAt: string;
  sources: WorkTextSource[];
}

export type GapKind =
  | 'future_work'
  | 'limitation'
  | 'open_question'
  | 'unresolved_contradiction';

export interface Work {
  nodus_id: string;
  zotero_key: string;
  zotero_version: number | null;
  /** Stable metadata revision used when Zotero's local API reports item version 0. */
  zotero_fingerprint: string | null;
  title: string;
  /** Original Zotero rich-text title when it differs from the plain display title. */
  zotero_title_markup: string | null;
  authors_json: string; // JSON-encoded string[]
  year: number | null;
  item_type: string;
  doi: string | null;
  read_tag: number; // 0|1
  manual_deep: number; // 0|1
  deep_trigger: DeepTrigger;
  source_type: SourceType | null;
  light_status: LightStatus;
  light_at: string | null;
  light_hash: string | null;
  deep_status: DeepStatus;
  deep_at: string | null;
  deep_hash: string | null;
  resolved_source_type: ResolvedSourceType | null;
  resolved_text_hash: string | null;
  resolved_text_chars: number;
  resolved_text_source_count: number;
  resolved_has_page_markers: number;
  text_block_reason: TextBlockReason | null;
  text_resolved_at: string | null;
  resolved_text_notes: string | null;
  deep_error: string | null;
  /** 1 while a deep job for this work is queued or running; survives a restart. */
  deep_queued: number;
  summary_status: SummaryStatus;
  summary_at: string | null;
  summary_hash: string | null;
  summary_error: string | null;
  archived: number; // 0|1
  notes: string | null;
}

/** Work with parsed authors + theme labels, as the renderer prefers it. */
export interface WorkView extends Omit<Work, 'authors_json'> {
  authors: string[];
  themes: string[];
  zoteroTags: string[];
  /** How many ideas have been extracted from this work (idea_occurrences count). */
  ideaCount: number;
}

/** One heading in the clean Markdown reader, linked back to its physical PDF page. */
export interface LibraryReaderSection {
  id: string;
  title: string;
  level: number;
  page: number | null;
}

/** Minimal stable identity accepted by the reader from either the global catalog
 * or a legacy vault work. It deliberately carries no vault-specific state. */
export interface LibraryReaderReference {
  id: string;
  zoteroKey: string | null;
  title: string;
  authors: string[];
  year: number | null;
  /** One-shot choice used by explicit “open original/clean” actions. */
  preferredSource?: 'clean' | 'original';
  /** Physical 1-based page to land on once open; absent means the reader's own last position. */
  page?: number | null;
  attachmentId?: string | null;
}

export type LibraryReaderAttachmentViewer = 'pdf' | 'epub' | 'image' | 'html' | 'text' | 'external';

/** One preserved attachment that can be selected independently from the clean copy. */
export interface LibraryReaderAttachment {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  role: LibraryAttachmentRecord['role'];
  viewer: LibraryReaderAttachmentViewer;
  available: boolean;
  url: string | null;
  annotationsSupported: boolean;
  annotationMode: 'text' | 'region' | 'none';
}

export interface LibraryReaderEpubChapter {
  id: string;
  title: string;
  html: string;
  text: string;
}

export interface LibraryReaderAttachmentContent {
  attachmentId: string;
  viewer: 'epub' | 'html' | 'text';
  text: string;
  html: string | null;
  chapters: LibraryReaderEpubChapter[];
}

/**
 * A durable, clean reading copy stored beside its immutable original.
 *
 * Zotero-backed documents keep the Zotero item key as `storageId`; local-only
 * documents use their Nodus id. The renderer never receives filesystem paths —
 * opening the original remains a narrowly-scoped main-process operation.
 */
export interface LibraryReaderDocument {
  workId: string;
  storageId: string;
  zoteroKey: string | null;
  citationKey: string | null;
  title: string;
  authors: string[];
  year: number | null;
  /** Canonical online record discovered from DOI, ISBN, PMID, PMCID, arXiv, or another provider. */
  sourceUrl: string | null;
  markdown: string;
  cleanAvailable: boolean;
  sections: LibraryReaderSection[];
  pageCount: number | null;
  wordCount: number;
  originalAvailable: boolean;
  originalFileName: string | null;
  /** Narrow internal URL served only for this preserved original. */
  originalUrl: string | null;
  originalMimeType: string | null;
  /** Every preserved file, in the same user-defined order shown by the item manager. */
  attachments: LibraryReaderAttachment[];
  sourceMapAvailable: boolean;
  /** Exact provenance of the clean copy currently shown. */
  contentFingerprint: string | null;
  extractionFingerprint: string | null;
  freshness: 'none' | 'queued' | 'running' | 'current' | 'stale' | 'failed' | 'unavailable';
  generatedAt: string | null;
  previousReadable: boolean;
}

/** A document-scoped conversation stored beside the clean Markdown copy. */
export interface LibraryReaderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  error?: boolean;
}

export interface LibraryReaderChatRequest {
  documentId: string;
  /** `clean` or the stable attachment id selected in the reader. */
  sourceId?: string;
  messages: LibraryReaderChatMessage[];
  model?: ModelRef | null;
}

export interface LibraryReaderChatResponse {
  answer: string;
  model: ModelRef;
  /** The user stopped the stream: `answer` is the partial text that had already arrived. */
  aborted?: boolean;
}

export interface LibraryReaderChatStreamHandlers {
  onDelta(delta: string): void;
  /** Provider reasoning is deliberately transient and is never written to chat.json. */
  onReasoning?(delta: string): void;
}

/** One work inside a duplicate group, with enough metadata to choose a canonical. */
export interface DuplicateWorkMember {
  nodus_id: string;
  zotero_key: string | null;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  light_status: LightStatus;
  deep_status: DeepStatus;
  /** How many ideas this work develops — a proxy for how much analysis it holds. */
  ideaCount: number;
  /** True for the richest member; pre-selected as the one to keep on merge. */
  suggestedCanonical: boolean;
}

/** A set of works that look like the same work, grouped for review-and-merge. */
export interface DuplicateWorkGroup {
  /** Why they were grouped: identical DOI, or identical title + year + authors. */
  reason: 'doi' | 'metadata';
  /** Stable group key, used as a React key in the review modal. */
  key: string;
  members: DuplicateWorkMember[];
}

/** One idea inside a duplicate group, with richness signals for review. */
export interface DuplicateIdeaMember {
  global_id: string;
  label: string;
  statement: string;
  type: string;
  /** How many works this idea occurs in. */
  workCount: number;
  /** How many evidence rows support it. */
  evidenceCount: number;
  /** How many graph edges touch it. */
  edgeCount: number;
  /** True for the richest member; pre-selected as the one to keep on merge. */
  suggestedCanonical: boolean;
}

/** A set of ideas that look like the same idea, grouped for review-and-merge. */
export interface DuplicateIdeaGroup {
  /** Why they were grouped. Phase 1 uses 'label' (identical normalized label + type). */
  reason: 'label';
  /** Stable group key, used as a React key in the review modal. */
  key: string;
  members: DuplicateIdeaMember[];
}

/** A non-citable orientation summary derived from already extracted material. */
export interface WorkSummary {
  nodus_id: string;
  summary: string;
  source_level: 'deep' | 'light';
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical document understanding
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentUnderstandingState =
  | 'missing' | 'queued' | 'waiting_source' | 'structuring' | 'analyzing'
  | 'synthesizing' | 'auditing' | 'embedding' | 'aligning' | 'current'
  | 'stale' | 'failed' | 'paused' | 'unavailable';

export type DocumentProfileFieldKind =
  | 'object' | 'problem' | 'question' | 'hypothesis' | 'thesis' | 'argument' | 'method'
  | 'sources' | 'concept' | 'temporal_scope' | 'geographic_scope'
  | 'disciplinary_scope' | 'structure' | 'finding' | 'conclusion' | 'contribution'
  | 'limitation' | 'genre' | 'audience' | 'positioning' | 'original_abstract';

/**
 * Where a field's `confidence` came from. `floor` means the provider supplied no
 * usable measurement and the deterministic direct-support floor was substituted,
 * so the value is a minimum, not a reading. Absent on rows published before the
 * column existed, where it is read as `model`.
 */
export type DocumentProfileConfidenceSource = 'model' | 'floor';

export interface DocumentProfileField {
  fieldId: string;
  kind: DocumentProfileFieldKind;
  ordinal: number;
  text: string;
  generatedText?: string;
  confidence: number;
  centrality: number;
  confidenceSource?: DocumentProfileConfidenceSource;
  overridden?: boolean;
  overrideId?: string;
  verified?: boolean;
  conflict?: boolean;
}

export interface DocumentSection {
  sectionId: string;
  parentSectionId: string | null;
  level: number;
  ordinal: number;
  title: string;
  role: string | null;
  summary: string;
  concepts: string[];
  claims: string[];
  pageStart: string | null;
  pageEnd: string | null;
  sourceRef?: string | null;
  pageStartNumber?: number | null;
  pageEndNumber?: number | null;
  charStart: number | null;
  charEnd: number | null;
  contentHash: string;
}

export interface DocumentProfileSupport {
  supportId: string;
  targetKind: 'field' | 'section';
  targetId: string;
  sectionId: string | null;
  passageId: string | null;
  pageStart: string | null;
  pageEnd: string | null;
  sourceRef?: string | null;
  pageStartNumber?: number | null;
  pageEndNumber?: number | null;
  quote: string;
  supportKind: string;
  confidence: number;
  validationStatus: 'pending' | 'valid' | 'invalid';
}

export interface DocumentIdeaLink {
  globalId: string;
  targetKind: 'field' | 'section';
  targetId: string;
  role: 'principal' | 'supporting' | 'development' | 'contrast' | 'tangential';
  score: number;
}

/**
 * How a published profile relates to its audited synthesis.
 * - `null`: the auditor approved the synthesis, which is what most profiles are.
 * - `partial`: the audited prose was kept (every field carries a literal support) but
 *   the semantic verdict did not clear the acceptance bar, or was unusable. Nothing
 *   about the evidence is in doubt, so the profile is published with the caveat
 *   instead of being replaced by raw quotes.
 * - `extractive`: the synthesis itself was unusable, so the profile is assembled from
 *   literal source quotes. It is published on purpose (a rejected paraphrase must not
 *   leave a permanent hole in a campaign), but every field is source-language
 *   evidence, so consumers must treat it as an index of quotes, not as a synthesis.
 */
export type DocumentProfileFallbackMode = 'extractive' | 'partial';

export interface DocumentProfileAudit {
  /** The semantic verdict: whether the auditor approved the synthesis. A profile can
   *  be published with `passed: false` when it is marked `partial`. */
  passed: boolean;
  /** null when the provider reported no usable score: "no reading", not "zero". */
  score: number | null;
  supportCoverage: number;
  structureCoverage: number;
  issues: string[];
  repaired: boolean;
  fallback?: DocumentProfileFallbackMode | null;
  /** Sections published from literal extracts because no synthesis survived their own
   *  audit. A profile can be approved as a whole and still contain them. */
  sectionsDegraded?: number;
}

export interface DocumentProfile {
  nodusId: string;
  versionId: string;
  status: DocumentUnderstandingState;
  sourceFingerprint: string;
  pipelineVersion: string;
  sourceLanguage: string | null;
  presentationLanguage: string;
  overview: string;
  generatedOverview?: string;
  overviewOverridden?: boolean;
  overviewOverrideId?: string;
  overviewVerified?: boolean;
  overviewConflict?: boolean;
  fields: DocumentProfileField[];
  sections: DocumentSection[];
  supports: DocumentProfileSupport[];
  ideaLinks: DocumentIdeaLink[];
  audit: DocumentProfileAudit | null;
  qualityScore: number | null;
  generatorModel: ModelRef | null;
  auditorModel: ModelRef | null;
  createdAt: string;
  publishedAt: string | null;
  staleReason: string | null;
}

export interface DocumentProfileOverride {
  overrideId: string;
  nodusId: string;
  fieldPath: string;
  value: unknown;
  generatedValue: unknown;
  baseVersionId: string | null;
  verified: boolean;
  conflict: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DocumentIndexJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'unavailable';
export type DocumentIndexJobPhase =
  | 'queued' | 'paused' | 'waiting_source' | 'structuring' | 'analyzing_sections'
  | 'synthesizing' | 'auditing' | 'repairing' | 'embedding' | 'aligning' | 'publishing' | 'done';

export interface DocumentIndexJob {
  jobId: string;
  campaignId: string | null;
  vaultId: string;
  nodusId: string;
  title?: string;
  priority: number;
  reason: string;
  status: DocumentIndexJobStatus;
  phase: DocumentIndexJobPhase;
  progress: number;
  /** Stable, structured unit progress for phases that process sections/chunks. */
  progressMessage: string | null;
  currentUnit: number | null;
  totalUnits: number | null;
  sourceFingerprint: string | null;
  generatorModel: ModelRef | null;
  auditorModel: ModelRef | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentIndexCampaign {
  campaignId: string;
  vaultId: string;
  mode: 'continuous' | 'manual' | 'research';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  includeArchived: boolean;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  runningJobs: number;
  queuedJobs: number;
  pausedJobs: number;
  estimatedUnits: number;
  completedUnits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentIndexProgress {
  campaigns: DocumentIndexCampaign[];
  jobs: DocumentIndexJob[];
  active: number;
  queued: number;
  failed: number;
}

export interface DocumentSearchHit {
  kind: 'document' | 'section';
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  versionId: string;
  sourceId: string;
  fieldKind: string;
  text: string;
  similarity: number;
  lexicalScore?: number;
  centrality: number;
  explanation: string;
  stale: boolean;
}

/** A Zotero tag available in the local library, with its current work count. */
export interface ZoteroTag {
  label: string;
  workCount: number;
}

export interface Theme {
  theme_id: string;
  label: string;
  created_at: string;
  pinned?: number; // 0|1 — user-curated "main theme", protected from auto-pruning
}

/** A theme as shown in the "Temas principales" manager: label + usage counts + curated flag. */
export interface ManagedTheme {
  theme_id: string;
  label: string;
  created_at: string;
  pinned: boolean;
  work_count: number;
  idea_count: number;
}

/** Options for the graph-level reprocess of already-extracted ideas. */
export interface ReprocessConnectionsOptions {
  /** Also re-trace idea↔idea relations (stored as inferred edges) in addition to idea↔theme. */
  relations: boolean;
  /** Limit automatic maintenance to ideas occurring in these newly changed works. */
  nodusIds?: string[];
}

/** Progress event emitted during reprocessConnections. */
export interface ReprocessProgress {
  /** Current phase: 'themes' (idea→theme assignment) or 'relations' (idea↔idea). */
  phase: 'themes' | 'relations';
  /** Human-readable label for the current phase. */
  label: string;
  /** Batch index within the current phase (1-based). */
  current: number;
  /** Total batches in the current phase. */
  total: number;
}

export interface ReprocessConnectionsResult {
  /** Ideas considered (those occurring in at least one non-archived work). */
  ideas: number;
  /** How many of those ideas ended up assigned to at least one theme. */
  themedIdeas: number;
  /** New theme labels the model proposed (only possible when not locked). */
  newThemes: number;
  /** Inferred idea↔idea relations added (0 when the relations option is off). */
  relationsAdded: number;
  /** Ideas whose embedded theme labels this pass rewrote, so their vectors are stale.
   * Main process only: IPC handlers refresh those vectors and drop the list. */
  rethemedIdeaIds?: string[];
}

/**
 * How a graph-integrity finding is resolved: `repairable` by the SQL repair, `rescan` only
 * by analysing the listed works again, `info` needs nothing (expected or legacy state).
 */
export type GraphIntegrityCategory = 'repairable' | 'rescan' | 'info';

export type GraphIntegrityCheckId =
  | 'theme_links_missing_theme'
  | 'work_themes_missing_theme'
  | 'active_ideas_without_works'
  | 'dormant_ideas_with_works'
  | 'edges_missing_endpoint'
  | 'self_loop_edges'
  | 'orphan_edge_traces'
  | 'rows_of_missing_works'
  | 'unused_themes'
  | 'rows_missing_idea'
  | 'rows_missing_evidence'
  | 'edges_of_missing_works'
  | 'hidden_edges'
  | 'legacy_gap_evidence'
  | 'user_refs_missing_idea'
  | 'stuck_document_jobs';

export interface GraphIntegrityWork {
  nodus_id: string;
  title: string | null;
}

export interface GraphIntegrityCheck {
  id: GraphIntegrityCheckId;
  category: GraphIntegrityCategory;
  count: number;
  /** Works the finding belongs to, largest first (at most 50). */
  works: Array<GraphIntegrityWork & { count: number }>;
}

export interface GraphIntegrityReport {
  checks: GraphIntegrityCheck[];
  /** Sum of the counts per category. */
  totals: Record<GraphIntegrityCategory, number>;
  /** Works a `rescan` finding names, deduplicated. */
  rescanWorks: GraphIntegrityWork[];
  /** Works whose idea theme links a repair removed and that can have their themes reassigned. */
  pendingThemeWorks: GraphIntegrityWork[];
  checkedAt: string;
}

export interface GraphIntegrityRepairCounts {
  rowsOfMissingWorks: number;
  danglingThemeLinks: number;
  danglingWorkThemes: number;
  wokenIdeas: number;
  sleptIdeas: number;
  danglingEdges: number;
  selfLoopEdges: number;
  orphanTraces: number;
  prunedThemes: number;
}

export interface GraphIntegrityRepairResult {
  counts: GraphIntegrityRepairCounts;
  /** Works whose last deep analysis failed the integrity check. Listed, never requeued. */
  integrityFailedWorks: GraphIntegrityWork[];
  /** Consistent copy of the vault taken before a manual repair. */
  backupPath?: string;
  /** The audit right after the repair. */
  report?: GraphIntegrityReport;
}

export interface Idea {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  embedding?: number[] | null;
  created_at: string;
}

export interface IdeaOccurrence {
  global_id: string;
  nodus_id: string;
  role: 'principal' | 'secondary';
  development: string;
  confidence: number;
}

export interface Evidence {
  id: string;
  global_id: string;
  nodus_id: string;
  quote: string;
  location: string | null;
  source_ref?: string | null;
  page_number?: number | null;
  kind: EvidenceKind;
}

export interface EvidenceLocator {
  location: string | null;
  sourceRef: string | null;
  pageNumber: number | null;
}

/**
 * How an evidence locator was resolved. `pdf-page` and `select` are handled in
 * the main process (Zotero owns its reader); `local` means a copy in the Nodus
 * library can be shown at that page, so the renderer opens it in the in-app
 * reader; `none` means there is nothing to open.
 */
export type OpenEvidenceAtPageMode = 'pdf-page' | 'select' | 'local' | 'none';

export interface OpenEvidenceAtPageResult {
  ok: boolean;
  mode: OpenEvidenceAtPageMode;
  /** Physical 1-based page the locator resolved to, when it had one. */
  page: number | null;
  /** Document to open in the in-app reader when `mode` is `local`. */
  local: { itemId: string; scope: import('./libraryTypes').LibraryScope } | null;
}

export interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  source_work: string | null;
}

export interface Author {
  author_id: string;
  name: string;
  affiliation: string | null;
}

export interface AuthorRelation {
  from_author: string;
  to_author: string;
  type: string;
  weight: number;
}

export interface Gap {
  id: string;
  nodus_id: string;
  related_idea: string | null;
  kind: GapKind;
  statement: string;
  confidence: number;
  evidence_id: string | null;
}

export interface ExternalRef {
  id: string;
  nodus_id: string;
  from_idea: string;
  cited_work: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  evidence_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export type AiProvider =
  | 'anthropic'
  | 'openai'
  | 'codex'
  | 'github-copilot'
  | 'opencode-go'
  | 'openrouter'
  | 'groq'
  | 'cerebras'
  | 'deepseek'
  | 'gemini'
  | 'xiaomi'
  | 'ollama'
  | 'lmstudio'
  | 'custom'
  | 'nodus';
/** Providers that run on the user's machine (or LAN) via a configurable base URL.
 *  They need no API key (an optional token is supported for secured instances). */
export type LocalProvider = Extract<AiProvider, 'ollama' | 'lmstudio'>;
export type EmbeddingProvider = Extract<AiProvider, 'openai' | 'openrouter' | 'gemini' | 'ollama' | 'lmstudio' | 'nodus'>;
export type ImageProvider = 'google' | 'openai' | 'openrouter' | 'nodus' | 'codex';

/** User-editable connection settings for a local provider. The base URL includes
 *  scheme, host and port (e.g. "http://localhost:11434"); no trailing "/v1". */
export interface LocalProviderConfig {
  baseUrl: string;
  /** Auto chooses the smallest safe 4K/8K/16K bucket. Manual never changes a
   * task's output ceiling; it only controls the total prompt+completion window. */
  contextMode?: 'auto' | 'manual';
  manualContextTokens?: 4096 | 8192 | 16384 | 32768 | 65536 | 131072;
}

/**
 * The user's own OpenAI-compatible endpoint (LiteLLM, vLLM, llama.cpp server, a
 * proxy such as CLIProxyAPI or codex-lb). App-level, not per vault.
 *
 * Unlike LocalProviderConfig, `baseUrl` is used EXACTLY as typed apart from the
 * trailing slash: these gateways mount their API on wildly different paths
 * ("/v1", "/openai/v1", the root), so appending "/v1" would break as many setups
 * as it fixed. The user pastes the full base, e.g. "http://localhost:8317/v1".
 */
export interface CustomProviderConfig {
  baseUrl: string;
  /**
   * Model slugs typed by the user. Kept independently of anything GET /models
   * returns, because plenty of gateways serve inference without implementing
   * that endpoint at all — the manual list is what keeps those usable.
   */
  models: string[];
}

/** Result of pinging a local provider from Settings ("Test connection"). */
export interface LocalProviderTestResult {
  ok: boolean;
  /** Server version when the provider exposes it (Ollama). */
  version?: string;
  /** How many models the server currently reports. */
  modelCount?: number;
  /** Human-readable error when `ok` is false. */
  message?: string;
}

export interface LocalAiRequestDiagnostic {
  provider: LocalProvider;
  model: string;
  task: string;
  transport: 'native' | 'openai-compatible';
  contextMode: 'auto' | 'manual';
  requestedContextTokens?: number;
  effectiveContextTokens: number;
  estimatedInputTokens: number;
  actualInputTokens?: number;
  requestedOutputTokens: number;
  sentOutputTokens: number;
  actualOutputTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  batchSize?: number;
  splitDepth?: number;
  elapsedMs: number;
  timestamp: number;
}

/** A rolling usage window reported by the official Codex App Server. */
export interface ChatGptSubscriptionRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  /** Unix timestamp (seconds), as returned by Codex. */
  resetsAt: number | null;
}

/** ChatGPT-plan quota exposed by Codex. This is separate from OpenAI API billing. */
export interface ChatGptSubscriptionRateLimits {
  primary: ChatGptSubscriptionRateLimitWindow | null;
  secondary: ChatGptSubscriptionRateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
}

/** Renderer-safe view of the managed ChatGPT login. OAuth tokens never cross IPC. */
export interface ChatGptSubscriptionStatus {
  available: boolean;
  connected: boolean;
  loginPending: boolean;
  email: string | null;
  planType: string | null;
  rateLimits: ChatGptSubscriptionRateLimits | null;
  error: string | null;
}

export interface ChatGptSubscriptionLogin {
  loginId: string;
  authUrl: string;
}

/** One account-level quota bucket returned by the official GitHub Copilot runtime. */
export interface GitHubCopilotSubscriptionQuotaWindow {
  id: string;
  unlimited: boolean;
  entitlementRequests: number;
  usedRequests: number;
  remainingRequests: number | null;
  remainingPercentage: number;
  overage: number;
  overageAllowed: boolean;
  usageAllowedAfterExhaustion: boolean;
  resetDate: string | null;
  tokenBasedBilling: boolean;
  hasQuota: boolean;
}

export interface GitHubCopilotSessionUsage {
  model: string;
  premiumRequestCost: number;
  userRequests: number;
  inputTokens: number;
  outputTokens: number;
}

/** Renderer-safe status. GitHub tokens and keychain records never cross IPC. */
export interface GitHubCopilotSubscriptionStatus {
  available: boolean;
  connected: boolean;
  loginPending: boolean;
  login: string | null;
  authType: string | null;
  statusMessage: string | null;
  canLogout: boolean;
  quota: GitHubCopilotSubscriptionQuotaWindow[];
  lastSession: GitHubCopilotSessionUsage | null;
  error: string | null;
}

/** Usage Nodus can observe locally for OpenCode Go. The authoritative balance
 * remains in OpenCode Console because no supported user-key quota API exists. */
export interface OpenCodeGoUsagePeriod {
  requests: number;
  estimatedCostUsd: number;
  unpricedRequests: number;
}

export interface OpenCodeGoUsageStatus {
  officialUsageUrl: string;
  limitsUsd: { fiveHours: number; week: number; month: number };
  observed: {
    fiveHours: OpenCodeGoUsagePeriod;
    week: OpenCodeGoUsagePeriod;
    month: OpenCodeGoUsagePeriod;
  };
  lastUpdatedAt: string | null;
}
export type DecorativeImageEntityKind = 'immersion' | 'deep_research';
export type DecorativeImageStatus = 'not_requested' | 'pending' | 'ready' | 'failed';
export type DecorativeImageStyle =
  | 'antique_book'
  | 'colored_engraving'
  | 'classic_scientific'
  | 'watercolor'
  | 'historical_collage'
  | 'modernist_poster'
  | 'contemporary_editorial'
  | 'realistic_photo'
  | 'vintage_photograph'
  | 'black_and_white'
  | 'cinematic'
  | 'oil_painting';

/** The opt-in choice stored with one generation request. */
export interface DecorativeImageOption {
  enabled: boolean;
  style: DecorativeImageStyle;
}

/** How the current ready image was produced. */
export type DecorativeImageSource = 'ai' | 'custom';

/** Metadata only: image bytes stay in the main process and are loaded lazily. */
export interface DecorativeImage {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  requested: boolean;
  status: DecorativeImageStatus;
  provider: ImageProvider | null;
  model: string | null;
  style: DecorativeImageStyle;
  visualContext: string | null;
  prompt: string | null;
  assetRef: string | null;
  mimeType: string | null;
  error: string | null;
  /** Whether the current image was generated by AI or uploaded by the user. */
  source: DecorativeImageSource | null;
  /** A previous image is stored and can be restored (single-level undo). */
  hasPrevious: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImageModelInfo {
  provider: ImageProvider;
  id: string;
  name: string;
  /** Standard USD prices per one million tokens. Null means not published. */
  inputPriceUsdPerMillion: number | null;
  outputPriceUsdPerMillion: number | null;
  /** Direct per-generation price, only when published; compared within a provider. */
  imagePriceUsd: number | null;
  /** Provider-native pricing detail, e.g. resolution/quality or per-image variants. */
  imagePriceLabel: string | null;
  sourceUrl: string;
}

export interface DecorativeImageActionRequest {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  action: 'generate' | 'retry' | 'regenerate';
  style?: DecorativeImageStyle;
  /** Optional user-edited scene description. Rebuilds the prompt for this style. */
  visualContext?: string;
  /**
   * Engine for THIS image, chosen in the design modal. Omitted means "use the
   * default from Ajustes → Proveedores"; the pair is only honoured together, so a
   * half-specified request falls back to the setting rather than mixing engines.
   */
  provider?: ImageProvider;
  model?: string;
}
export type SyncMode = 'realtime' | 'manual';
/** 'system' follows the OS light/dark preference and reacts to changes at runtime. */
export type ThemeMode = 'dark' | 'light' | 'system';
/** Colour theme (palette family). Orthogonal to {@link ThemeMode}: every theme has a
 *  light and a dark mode. `default` is the built-in indigo/neutral palette; the rest are
 *  curated FreeColorPalettes palettes. Keep the built-in IDs in sync with `APP_THEME_IDS` in
 *  shared/appThemes.mjs. */
export type AppTheme =
  | 'default'
  | 'amethyst-iris'
  | 'deep-ocean'
  | 'plum-lilac'
  | 'sage-stone'
  | 'azure-night'
  | 'slate-gray'
  | 'mint-slate'
  | 'amber-ember'
  | 'berry-wine'
  | 'burnt-sun'
  | 'rose-quartz'
  | 'pine-grove'
  | 'golden-hour'
  | 'plum-noir'
  | 'sea-glass'
  | 'lagoon'
  | (string & {});
/** User-created palette definition. The runtime derives the full ramps from these anchors. */
export interface CustomAppTheme {
  id: string;
  label: string;
  accent: string;
  deep: string;
  pale: string;
  /** Persistent application chrome/background, with one value per colour mode. */
  appBackground: { light: string; dark: string };
  /** Foreground used when the UI is in light mode. */
  lightText: string;
  /** Foreground used when the UI is in dark mode. */
  darkText: string;
  tint: number;
}
export type DeepContextMode = 'standard' | 'long';
/** Languages Nodus can speak. `uiLanguage` localizes the interface; `promptLanguage`
 *  is injected into the AI prompts and so determines the language of generated content
 *  (ideas, themes, tutor narrative, drafts, assistant answers). */
export type AppLanguage = 'es' | 'en' | 'fr' | 'de' | 'pt' | 'pt-BR' | 'it' | 'tr' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko';
/** Single source of truth for the prompt languages: the union below is derived from
 *  it, and runtime validators (the MCP tool schemas) enumerate it instead of
 *  re-spelling the list — which is how `tr` once ended up accepted everywhere except
 *  over MCP. Adding a language here forces the exhaustive `Record`s to be filled in. */
export const PROMPT_LANGUAGES = [
  'es', 'en', 'fr', 'tr', 'de', 'pt', 'pt-BR', 'it',
  'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko',
] as const;
export type PromptLanguage = (typeof PROMPT_LANGUAGES)[number];

/** A concrete model selection: which provider + which model id. */
export interface ModelRef {
  provider: AiProvider;
  model: string;
  /** Set only at a portable-profile boundary when a local/downloadable model
   * cannot be executed by Server. It is an assignment marker, never a model
   * fallback; Desktop may resolve it locally. */
  pending?: boolean;
  /**
   * The reasoning level chosen for THIS assignment. It rides on the selection rather
   * than living in a map keyed by model id, which is what keeps two roles running the
   * same model independent: the Models tab stores one of these per role, so raising
   * Immersion to «Alto» cannot reach into Deep Research. Absent means «Predeterminado»
   * — fall back to the model's level in `codexReasoningEfforts` and then to the level
   * the provider recommends. Only Codex publishes levels today.
   */
  reasoningEffort?: CodexReasoningEffort;
}

/** One model as returned by a provider's model-list endpoint. */
export interface ModelInfo {
  id: string;
  /** Exact native reasoning choices advertised by the provider, in display order. */
  researchReasoningLevels?: import('./researchReasoning').NativeResearchEffort[];
  name?: string;
  /** For OpenRouter: the upstream provider segment of the id (e.g. "anthropic"). */
  group?: string;
  /** For OpenRouter: true when the model is a reasoning model (slower for scans). */
  reasoning?: boolean;
  /** The provider explicitly requires reasoning; opt-out values are invalid. */
  reasoningMandatory?: boolean;
  /** Codex App Server: exact effort choices advertised for this model. */
  supportedReasoningEfforts?: Array<{
    reasoningEffort: CodexReasoningEffort;
    description: string;
  }>;
  /** Codex App Server's recommended effort when the user leaves the model on default. */
  defaultReasoningEffort?: CodexReasoningEffort;
  // ── Local-provider metadata (Ollama / LM Studio). All optional; other
  //    providers omit them and the UI only renders what is present. ────────────
  /** On-disk size in bytes (Ollama). */
  sizeBytes?: number;
  /** Parameter count label, e.g. "8B" (Ollama). */
  paramSize?: string;
  /** Quantization label, e.g. "Q4_K_M" (Ollama / LM Studio). */
  quantization?: string;
  /** Max context length in tokens (LM Studio). */
  contextLength?: number;
  /** Architecture/training ceiling, distinct from the context currently loaded. */
  trainedContextLength?: number;
  /** Context currently allocated by the local runtime, when it reports it. */
  loadedContextLength?: number;
  /** Context Nodus will use after applying settings and provider/model ceilings. */
  effectiveContextLength?: number;
  /** Conservative value recommended by Nodus for background processing. */
  recommendedContextLength?: number;
  /** Whether the model is currently loaded into memory (LM Studio). */
  loaded?: boolean;
  /** Model kind reported by LM Studio: chat/vision vs embeddings. */
  kind?: 'llm' | 'vlm' | 'embeddings' | 'other';
  /** Whether the model accepts image input. true/false when known (OpenRouter
   *  modalities, LM Studio vlm), undefined when the provider doesn't expose it. */
  vision?: boolean;
}

/** A complete provider listing, distinct from the models shown by its picker. */
export interface ProviderModelCatalog {
  models: ModelInfo[];
  selectableModels: ModelInfo[];
}

/** A failed or unsupported catalogue query is inconclusive, never an empty catalogue. */
export type ModelCatalogResult = ({ status: 'read' } & ProviderModelCatalog) | { status: 'unreadable' };

/** How hard a model should "think" before answering. `off` skips the chain-of-thought
 *  on reasoning models where the provider supports it (much faster for scanning). */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

/** Codex deliberately types effort as an extensible string. The literals preserve
 * autocomplete for current catalogs; availability still comes from each ModelInfo. */
export type CodexReasoningEffort =
  | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  | (string & {});

// ── Audio / text-to-speech ───────────────────────────────────────────────────
/** Audio (text-to-speech) backends. Both current providers run fully local in the
 *  renderer via WebAssembly (cross-platform, offline). Piper has native-sounding
 *  per-language voices (incl. Spanish); Kokoro is a single English model with many
 *  high-quality voices. More providers (e.g. a cloud API) slot in behind the same
 *  settings + generation surface without changing callers. */
export type AudioProvider = 'piper' | 'kokoro' | 'hume';

/** Content kinds that can be narrated. Study kinds are stored in the vault's
 * regenerable local audio catalogue rather than in sync/backups. */
export type AudioEntityKind = 'deep_research' | 'immersion' | 'study_document' | 'study_transcript' | 'study_assistant' | 'study_subject' | 'study_question';

/** One Hume voice as returned by the voice-list endpoint. `humeProvider` says which
 *  Hume library it belongs to (needed to synthesize with it). */
export interface HumeVoiceInfo {
  id: string;
  name: string;
  humeProvider: 'HUME_AI' | 'CUSTOM_VOICE';
  /** Octave model versions the voice supports (e.g. ["octave-2"]). */
  models: string[];
}

/** One generated audio file for a segment (stage/section) of a report or immersion. */
export interface AudioClip {
  id: string;
  entityKind: AudioEntityKind;
  entityId: string;
  /** 0-based order within the entity (a report section or an immersion stage). */
  segmentIndex: number;
  /** Human label of the segment, e.g. "Resumen" or "Estación 2 · El viajero". */
  segmentLabel: string;
  provider: AudioProvider;
  voice: string;
  language: string;
  /** File name (relative to the vault audio dir). */
  fileName: string;
  bytes: number;
  durationSec: number;
  sampleRate: number;
  createdAt: string;
  /** True when the metadata row exists but the audio file is gone (e.g. after a
   *  restore from backup, which never carries the regenerable audio files). */
  missing: boolean;
}

/** A speakable segment extracted from an entity: the plain prose to narrate. */
export interface AudioSegment {
  index: number;
  label: string;
  text: string;
}

export interface AudioSegmentRequest {
  mode?: 'full' | 'selection' | 'cursor';
  markdown?: string;
  selection?: string;
  cursorOffset?: number;
  title?: string;
  pronunciations?: Array<{ written: string; spoken: string }>;
}

export interface StudyAudioBookmark {
  id: string;
  entityKind: AudioEntityKind;
  entityId: string;
  segmentIndex: number;
  label: string;
  createdAt: string;
}

export interface StudyPronunciationEntry { written: string; spoken: string }

export interface StudyAudioPlaylistItem {
  entityId: string;
  title: string;
  subjectId: string;
  clipCount: number;
  durationSec: number;
  updatedAt: string;
}

// ── AI translations ─────────────────────────────────────────────────────────
// A Deep Research report or an immersion can be translated to another language
// with AI. The source content is assembled to Markdown in the renderer and sent
// to the main process, which translates it (chunked, preserving structure and
// citations) and stores the result. Translations reuse the two content kinds and
// are keyed one-per-language, so regenerating replaces the stored copy.
export type TranslationEntityKind = AudioEntityKind;

/** One selectable target language for AI translation. `code` is a BCP-47-ish tag
 *  used as the stable key; `name` (English) guides the model; `nativeName` labels
 *  the picker. */
export interface TranslationLanguage {
  code: string;
  name: string;
  nativeName: string;
}

/** The curated languages offered for AI translation. English name drives the
 *  prompt; native name labels the dropdown. Kept in shared so main and renderer
 *  agree on the exact set and codes. */
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', nativeName: 'Português (Brasil)' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
];

/** A stored AI translation of a report/immersion, full Markdown body included. */
export interface ContentTranslation {
  id: string;
  entityKind: TranslationEntityKind;
  entityId: string;
  /** Target language code (matches a TRANSLATION_LANGUAGES entry). */
  language: string;
  /** Native-name label captured at generation time (for display). */
  languageLabel: string;
  /** Translated document title. */
  title: string;
  /** Full translated document as Markdown. */
  markdown: string;
  model: ModelRef | null;
  status: 'generating' | 'ready' | 'error';
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Translation metadata without the (potentially large) Markdown body. */
export type ContentTranslationSummary = Omit<ContentTranslation, 'markdown'>;

/** Request to (re)generate a translation. The renderer assembles and passes the
 *  source so the main process never has to re-derive an entity's Markdown. */
export interface GenerateTranslationRequest {
  entityKind: TranslationEntityKind;
  entityId: string;
  language: string;
  sourceTitle: string;
  sourceMarkdown: string;
  model?: ModelRef | null;
}

/** The two Nodi the user can choose between: the classic character, or the orb — a
 *  glass sphere holding a constellation, for users who want a soberer companion. */
export type NodiStyle = 'classic' | 'orb';

/** Whether the orb follows the active vault's accent colour or a colour the user picked. */
export type NodiOrbColorMode = 'auto' | 'manual';

export type BackupRetentionUnit = 'days' | 'weeks' | 'months' | 'years';

export interface AiConcurrencySnapshot {
  provider: string;
  model: string;
  active: number;
  queued: number;
  currentLimit: number;
  maximumLimit: number;
  cooldownUntil: number | null;
  lastChangeReason: string;
}

export type AcademicMode = 'auto' | 'manual';

export interface AppSettings {
  /** Vault-local, fixed after onboarding. Legacy vaults use Auto. */
  academicMode?: AcademicMode;
  /** Whether the user explicitly enabled the cross-vault catalogue. */
  libraryGlobalEnabled: boolean;
  /** Last scope selected after the compatibility-first Library introduction. */
  libraryScope: import('./libraryTypes').LibraryScope;
  /** Completed version of the optional global-Library activation contract. */
  libraryScopeOnboardingVersion: number;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  // Per-provider key presence (the keys themselves never cross IPC).
  providerKeys: Record<AiProvider, boolean>;
  /** Encrypted key files exist but the current OS secure-storage identity cannot
   * decrypt them yet. The renderer receives provider ids only, never key data. */
  lockedProviderKeys: AiProvider[];
  // Connection settings for local providers (Ollama, LM Studio). The base URL is
  // user-editable; an optional access token, when set, is stored like an API key.
  localProviders: Record<LocalProvider, LocalProviderConfig>;
  // The user's own OpenAI-compatible endpoint: base URL and manually typed model
  // slugs. An optional API key travels the ordinary secret path, never this blob.
  customProvider: CustomProviderConfig;
  // Favorite models the user pinned. This list is app-wide and shared across vaults.
  // Workload and feature selectors below remain deliberately independent: changing
  // one must never retarget another flow.
  favorites: ModelRef[];
  /** @deprecated Legacy global selector, retained only for one-time migration. */
  defaultModel: ModelRef | null;
  /** Simplified selectors or per-task overrides. Stored per vault. */
  modelSettingsMode: 'basic' | 'advanced';
  /** One-time migration marker for the simplified model settings. */
  modelSettingsVersion: number;
  extractionModel: ModelRef | null;
  // Vision model for analysing archive images (visual description + OCR). Falls back
  // to extractionModel when null. Should be an image-capable model.
  visionModel: ModelRef | null;
  // General long-form synthesis and initial fallback for feature-local pickers.
  synthesisModel: ModelRef | null;
  // Short orientation summaries of individual works. Falls back to synthesisModel.
  summaryModel: ModelRef | null;
  /** Model used for section-by-section document understanding. Falls back to summaryModel. */
  documentProfileModel: ModelRef | null;
  /** Independent semantic auditor for profiles. Falls back to documentProfileModel. */
  documentAuditModel: ModelRef | null;
  // Fusion: the many small dedup/relate calls during deep scan. Kept separate from
  // synthesisModel so a fast model can be used here without slowing long-form output.
  // Falls back to synthesisModel when unset.
  fusionModel: ModelRef | null;
  /** Model dedicated to semantic-pair validation and bridge discovery. Falls back
   * to fusionModel, then synthesisModel. */
  relationModel: ModelRef | null;
  // Per-feature choices. Null means "seed from synthesisModel until the user
  // chooses inside that feature"; once chosen, each value persists separately.
  chatModel: ModelRef | null;
  /** Model used only by the Nodi companion chat. */
  nodiModel: ModelRef | null;
  deepResearchModel: ModelRef | null;
  immersionModel: ModelRef | null;
  writingModel: ModelRef | null;
  argumentMapModel: ModelRef | null;
  authorModel: ModelRef | null;
  /** Model used only to generate and update persistent Dictionary entries. */
  dictionaryModel?: ModelRef | null;
  studyModel: ModelRef | null;
  tutorModel: ModelRef | null;
  hypothesisModel: ModelRef | null;
  // Study-vault task routing. Each workflow persists independently so choosing a
  // fast model for questions never retargets grading or text improvement.
  improveModel: ModelRef | null;
  /** Up to four study-writing prompts exposed as contextual editor shortcuts. */
  studyImproveToolbarStyleIds: string[];
  questionGenModel: ModelRef | null;
  gradingModel: ModelRef | null;
  flashcardModel: ModelRef | null;
  transcriptionModel: ModelRef | null;
  /** Optional second choice, used only when the primary task model fails before producing output. */
  studyAiFallbackModels: Partial<Record<StudyAiTask, ModelRef | null>>;
  /** Per-subject overrides; styles keep their own existing model override. */
  studyAiSubjectModels: Record<string, Partial<Record<StudyAiTask, ModelRef | null>>>;
  studyAiMonthlyBudgetUsd: number;
  studyAiBudgetWarningPercent: number;
  studyAiEnabled: boolean;
  studyAnalyticsEnabled: boolean;
  studySyncEnabled: boolean;
  studySharingEnabled: boolean;
  studyAiPrivacyMode: 'local' | 'hybrid' | 'external';
  studyAiExcludedSubjectIds: string[];
  /** Legacy mirror kept for older settings payloads; privacyMode is authoritative. */
  studyAiLocalOnly: boolean;
  studyAiConfirmExternal: boolean;
  /** What to do with newly imported study materials after storing them locally. */
  studyKnowledgeAutoProcess: 'ask' | 'always' | 'never';
  /**
   * Replace student names with opaque codes (`STU_7K3Q`) before any teaching text
   * reaches an AI provider, and map them back on the way in. On by default: rosters
   * hold the names of minors. Covers chat and structured (JSON) calls only —
   * embeddings, image analysis and audio transcription still see the raw text.
   */
  studentPseudonymsEnabled: boolean;
  studyAiMaxInputChars: number;
  studyAiMaxOutputTokens: number;
  studyAiTemperature: number;
  studyAiRetryCount: number;
  /** Speech-to-text backend. Transformers.js/ONNX is the local factory default. */
  sttProvider: StudySttProvider;
  /** Hugging Face model id used by the Transformers.js ONNX worker. */
  sttTransformersModel: string;
  /** GGML model id used by the optional whisper.cpp executable. */
  sttWhisperCppModel: string;
  /** User-selected whisper-cli executable; empty means auto-detect on PATH. */
  sttWhisperCppExecutable: string;
  /** Provider/model used only for optional decorative image generation. */
  imageProvider: ImageProvider;
  imageModel: string;
  /** Resolution preset for the native FLUX.2 pipeline; remote providers keep their own fixed settings. */
  imageQuality: NodusImageQuality;
  imageStyle: DecorativeImageStyle;
  /** Audio narration backend: 'piper' / 'kokoro' (local WASM) or 'hume' (cloud, BYO key). */
  audioProvider: AudioProvider;
  /** Selected Piper voice id (e.g. "es_ES-sharvard-medium"). Empty until chosen. */
  audioVoice: string;
  /** Playback/synthesis speed multiplier (1.0 = natural). Clamped 0.7–1.3. */
  audioSpeed: number;
  syncMode: SyncMode;
  readTag: string; // Zotero tag that can be used by the opt-in deep-scan automation.
  // All automatic analysis is opt-in. Manual sync can ingest Zotero metadata without spending tokens.
  autoLightScan: boolean;
  autoDeepScanOnReadTag: boolean;
  // After a deep scan completes, auto-generate the work's orientation summary.
  autoSummaryAfterDeep: boolean;
  /** Opt-in, per-vault continuous document indexing policy. */
  documentIndexingEnabled: boolean;
  /** Include archived works in the continuous campaign. */
  documentIndexIncludeArchived: boolean;
  /** 0 selects provider-aware automatic concurrency; otherwise 1..8. */
  documentIndexConcurrency: number;
  // When the queue drains after deep scans, auto-run semantic bridge discovery.
  autoBridgeAfterQueue: boolean;
  autoResumeQueue: boolean;
  zoteroUserId: string;
  zoteroStoragePath: string;
  monitoredCollections: string[]; // collection keys
  theme: ThemeMode;
  /** Colour palette. Light/dark is still governed by {@link AppSettings.theme}. */
  appTheme: AppTheme;
  /** User-created palettes, persisted with the profile and kept separate from built-ins. */
  customThemes: CustomAppTheme[];
  /**
   * Whether {@link AppSettings.appTheme} and {@link AppSettings.customThemes} are one
   * profile-wide choice or a per-vault one. Off by default: every vault keeps its own
   * palette, and a vault created later starts on the default one. Light/dark mode is
   * unaffected — it stays shared either way, because it tracks the display rather than
   * the corpus.
   */
  shareAppThemeAcrossVaults: boolean;
  // Interface language (localizes all UI text).
  uiLanguage: AppLanguage;
  // Language injected into AI prompts → language of generated ideas/themes/answers.
  promptLanguage: PromptLanguage;
  animationSpeed: number; // 0..1
  /** Global UI zoom. Kept independent from document/editor typography. */
  interfaceScale: number; // 0.85..1.3
  /** Uses a wider, highly legible system font stack without downloading fonts. */
  accessibleFont: boolean;
  /** Strengthens borders, focus rings and foreground/background separation. */
  highContrast: boolean;
  /** Disables non-essential motion, in addition to the OS preference. */
  reduceMotion: boolean;
  /** Reduces visual noise and gives study reading surfaces a calmer measure. */
  readingFocusMode: boolean;
  /**
   * Whether to fetch the published announcements (see shared/announcements.ts). On by
   * default; when off the app makes no request for them at all, which is the only
   * promise worth making about a network call.
   */
  announcementsEnabled: boolean;
  /**
   * Explicit, app-wide opt-in to prerelease application updates. Stable remains
   * the default and beta releases are never considered while this is false.
   */
  betaUpdates: boolean;
  /** Nodus Browser: per-origin permission decisions. Absence means «ask». */
  browserSitePermissions: BrowserSitePermissionMap;
  /** Where Nodus Browser saves downloads. Null asks each time. */
  browserDownloadFolder: string | null;
  /** What Home and a new tab open. */
  browserHomeMode: 'start' | 'bookmarks' | 'blank' | 'custom';
  browserHomeUrl: string;
  browserNewTabMode: 'home' | 'blank';
  browserSearchEngine: 'google' | 'scholar' | 'bing' | 'duckduckgo' | 'custom';
  /** Only used when the engine is 'custom'; must contain %s. */
  browserSearchTemplate: string;
  /** How long private Nodus Browser visit records remain on this device. */
  browserHistoryRetention: import('./browserHistory').BrowserHistoryRetention;
  /** Remove the private visit file whenever the Browser subsystem is destroyed. */
  browserClearHistoryOnClose: boolean;
  /**
   * Processing log: extraction, OCR, indexing, embeddings and the provider/JSON/connection
   * failures around them. App-wide because one corpus run crosses vaults and the Library,
   * and because the file is local diagnostics — it is neither backed up nor synced.
   */
  pipelineLogRetention: import('./pipelineLogs').PipelineLogRetention;
  pipelineLogMaxEntries: number;
  /** The language the log LINES are rendered in, chosen independently of the interface. */
  pipelineLogLanguage: AppLanguage;
  // Nodi mascot: show the floating companion (visual/animation only for now — no wired
  // behaviour yet). App-wide preference, on by default.
  mascotEnabled: boolean;
  // Discrete scale shared by the in-app and always-on-top companions. The default 1
  // preserves the size used before this setting was introduced.
  mascotScale: number;
  // Keep Nodi pinned on top of every application in a floating desktop window, on the
  // operating systems that allow it. When off, Nodi lives inside the app window only.
  mascotAlwaysOnTop: boolean;
  // Whether Nodi wears a per-vault accessory (cap / sprout / study glasses). When off,
  // the plain Nodi is shown in every vault. Only applies to the classic Nodi — the orb
  // wears its vault as a colour instead (see mascotOrbColorMode).
  mascotVaultCostumes: boolean;
  // Which Nodi is drawn everywhere: the classic character or the "orb", a sober glass
  // sphere holding a constellation. Existing installs keep the classic one.
  mascotStyle: NodiStyle;
  // True once the user has been offered the choice between the two Nodi — in the
  // cinematic tutorial, or in the one-time modal shown to users who already saw it.
  // Guards that modal so it can never be shown twice.
  mascotStyleChosen: boolean;
  // Orb only: 'auto' recolours the orb to the active vault's accent as you switch
  // vaults; 'manual' pins it to mascotOrbColor.
  mascotOrbColorMode: NodiOrbColorMode;
  // Orb only: the accent (hex) used when mascotOrbColorMode is 'manual'. Every other
  // colour in the orb is derived from this one's hue.
  mascotOrbColor: string;
  /** Provider-aware adaptive scheduling, or the explicitly selected fixed limit. */
  aiConcurrencyMode: 'automatic' | 'manual';
  /** Migration/rollout marker. Version 0 keeps existing installs in beta-safe manual mode. */
  aiConcurrencyVersion: number;
  /** Manual request limit (1..8); retained even while automatic mode is active. */
  concurrency: number;
  // Reasoning effort for interactive long-form calls (chat, tutor, debate, writing).
  // Scans always run with reasoning off for speed, regardless of this value.
  chatReasoning: ReasoningEffort;
  /** Per-model Codex reasoning overrides. Missing means use that model's advertised default. */
  codexReasoningEfforts: Record<string, CodexReasoningEffort>;
  /**
   * The thinking level the Research composer last used, keyed by `provider:model`, so
   * reopening a model starts where the user left it. Missing means the model opens on the
   * middle of its levels (`researchDefaultEffort`); Standard, once picked, is stored like any
   * other level. Shared by the Research chat, Deep Research and Immersion. App-wide like the
   * other model preferences: the level belongs to the model, not to the vault asking.
   */
  researchEffortByModel: Record<string, ResearchEffort>;
  /** Research Chat's web step: automatic (the agent decides) or off. App-wide. */
  researchWebSearch: ResearchWebSearchMode;
  // When using OpenRouter, bias routing toward the fastest upstream provider.
  openRouterThroughput: boolean;
  /**
   * Providers the user has flagged as running on a free tier. When set, requests to that provider
   * are shaped to fit its free limits: max_tokens is capped to the per-minute token budget (Groq)
   * and 429s are retried with backoff instead of failing the scan. Empty/unset = normal behaviour.
   */
  providerFreeTier: Partial<Record<AiProvider, boolean>>;
  unpaywallEmail: string;
  onboardingComplete: boolean;
  /** App-wide version of the introductory AI/vault tutorial already completed. */
  basicsTutorialVersion: number;
  /**
   * App-wide version of the first-vault chooser already completed — the cinematic
   * screen that follows the guide and asks the newcomer to name their first vault and
   * pick its mode. Zero means it has never been answered on this install.
   */
  firstVaultVersion: number;
  /**
   * Ids of the video tutorials already opened (`TutorialVideoId` values from
   * shared/tutorialVideos.ts, kept as plain strings so types.ts stays at the root of
   * the import graph). App-wide, like the tutorial version above: a video watched in
   * one vault stays watched in every other.
   */
  tutorialVideosWatched: string[];
  // First-run usage tour (distinct from the setup onboarding above).
  tourComplete: boolean;
  // Advanced research-workflow walkthrough. Opt-in (never auto-shown): defaults
  // to true so it only appears when the researcher launches it from Settings.
  advancedTourComplete: boolean;
  // True while the app is showing the seeded sample corpus. Only ever set on an
  // empty database; cleared (and the demo rows wiped) when the user leaves demo mode.
  demoMode: boolean;
  // The active vault's type before the genealogy demo flipped it, so leaving the demo
  // restores it. Null when no genealogy demo is active. (KV setting, no migration.)
  demoPriorVaultType: VaultType | null;
  /** Per-vault additions to the fact/event selectors. Built-in types are immutable. */
  customEventTypes: Record<EventTypeVocabularyScope, CustomHistoricalEventType[]>;
  // Completion flag for the genealogy-specific guided tour (shown in the genealogy demo).
  genealogyTourComplete: boolean;
  // Completion flag for the databases-mode guided tour (shown once per databases vault).
  databasesTourComplete: boolean;
  testimonyTourComplete: boolean;
  // Completion flag for the optional study-vault orientation tour.
  studyTourComplete: boolean;
  // Completion flag for the teaching-vault guided tour.
  docenciaTourComplete: boolean;
  // Completion flag for the six-step Primary Sources evidence workflow tour.
  primarySourcesTourComplete: boolean;
  /**
   * Explicit opt-in for coarse, on-device Primary Sources performance metrics.
   * These rows never leave the vault automatically and never contain content or ids.
   */
  primarySourcesLocalMetricsEnabled: boolean;
  // Large-PDF / extraction strategy
  preferZoteroFulltext: boolean;
  ocrEnabled: boolean;
  ocrLanguages: string;
  ocrMaxPages: number;
  /** PDFs of works whose text has never been used (no resolved text, no deep analysis) are
   *  extracted with reaction schemes, figure labels and tables as "[scheme]" and without running
   *  heads. The choice sticks per work and attachment in its vault, so later extractions
   *  of it give the same text without affecting other works that share the PDF. */
  declutterNewDocuments: boolean;
  /** Chemistry Studio uses the user's imported vendor stock lists (scripts/import-stock.mjs):
   *  route search stops at stocked precursors, disconnections and reports mark what can be
   *  bought, and the report says when the target itself is for sale. Off: stock is ignored. */
  chemistryUseStockLists: boolean;
  // Nodus Toolkit (Convert). No DB schema; plain JSON settings.
  /** Tesseract languages the Toolkit's OCR operations use, e.g. "spa+eng". */
  toolkitOcrLanguages: string;
  /** Destination folder for Toolkit outputs; null = write beside each original. */
  toolkitOutputDir: string | null;
  /** Open the destination folder when a Toolkit job finishes. */
  toolkitOpenFolderOnDone: boolean;
  // Deep scan chunking strategy. Standard preserves the legacy chunk size.
  deepContextMode: DeepContextMode;
  deepStandardChunkWords: number;
  deepLongChunkWords: number;
  // When true, light/deep scans only assign works to the existing curated themes and
  // never invent new ones. Toggled from the "Temas principales" manager.
  themesLocked: boolean;
  /** Opt-in local Model Context Protocol server for external AI clients. */
  mcpEnabled: boolean;
  /** Localhost TCP port used by the MCP Streamable HTTP endpoint. */
  mcpPort: number;
  /** Bearer token for the local MCP endpoint. This is intentionally visible in Settings. */
  mcpToken: string;
  /** Publish this vault to an independent Nodus Server. Never starts a local listener. */
  nodusServerEnabled: boolean;
  /** Transport selected for this vault. Classic preserves Docker/local compatibility. */
  nodusServerKind: 'classic' | 'cloudflare';
  /** Canonical HTTPS origin of the remote Nodus Server. */
  nodusServerUrl: string;
  /** Remote space selected during one-time pairing. */
  nodusServerSpaceId: string;
  nodusServerSpaceName: string;
  /** Language used by the paired Nodus Server web interface. English is the server default. */
  nodusServerLanguage: AppLanguage;
  /** Include user-authored notes, projects and study/teaching tables in the publication. */
  nodusServerIncludeUserContent: boolean;
  /** Include citable extracted passages. Off by default because full text may be licensed. */
  nodusServerIncludePassages: boolean;
  /** Publish the reviewed primary-source projection for a primary_sources vault. */
  nodusServerIncludePrimarySources: boolean;
  /** Publish textual testimony projection; participant/media/agreement rows remain private. */
  nodusServerIncludeTestimonies: boolean;
  /**
   * Publish the global library catalogue plus Clean Markdown/figure packages.
   * Independent from passages and authored vault content, and off by default because it may
   * publish an entire personal bibliography into every member's mobile library.
   */
  nodusServerIncludeLibraryDocuments: boolean;
  /**
   * Publish the idea embeddings so the space can answer a semantic query.
   *
   * The vectors are derived from ideas that already travel, and without them a phone or a
   * replica can only search literally — but they are still a computed projection of the
   * corpus, so it is a choice rather than an assumption. Passage vectors follow
   * `nodusServerIncludePassages`: a matrix built from full text is not something to publish
   * when the text itself was withheld.
   */
  nodusServerIncludeVectors: boolean;
  /** Low-cost periodic publication while the desktop app remains open. */
  nodusServerAutoSync: boolean;
  /**
   * Run Nodus Server on this computer instead of publishing to a Docker deployment.
   *
   * App-global rather than per-vault: it is one process per machine that every connected
   * vault publishes into, so storing it per vault would let two vaults disagree about
   * whether a single shared process should exist.
   */
  localServerEnabled: boolean;
  /** TCP port the local server listens on. */
  localServerPort: number;
  /** How other devices reach the local server. `loopback` shares with nothing. */
  localServerAccess: LocalServerAccess;
  /** Administrator account for the local server's own web administration. */
  localServerAdminEmail: string;
  /** Hold off idle sleep while the local server is running. */
  localServerKeepAwake: boolean;
  /** Disable system sleep entirely, so a closed lid keeps serving. Requires an administrator. */
  localServerKeepServingOnLidClose: boolean;
  /** Opt-in local HTTPS server that serves the Word writing-copilot add-in + its JSON API. */
  copilotEnabled: boolean;
  /** Localhost TCP port for the copilot HTTPS server (serves /addin and /api). */
  copilotPort: number;
  /** Bearer token for the copilot API. Intentionally visible in Settings. */
  copilotToken: string;
  /** Opt-in local HTTP server for the "Nodus for Zotero" plugin (chat about the open item). */
  zoteroPluginEnabled: boolean;
  /** Localhost TCP port for the Zotero-plugin JSON/NDJSON API. */
  zoteroPluginPort: number;
  /** Bearer token for the Zotero-plugin API. Intentionally visible in Settings. */
  zoteroPluginToken: string;
  /** Opt-in Chrome/Chromium connector that captures the active page into the global library. */
  browserConnectorEnabled: boolean;
  /** Separate bearer token issued only after the user approves the browser extension pairing. */
  browserConnectorToken: string;
  /** Canonical extension origin approved for the browser connector. Empty until pairing. */
  browserConnectorOrigin: string;
  /**
   * User-defined order of the sidebar sections, as stable view/action ids. Excludes
   * 'home' (always pinned first) and 'settings' (always pinned last). Empty means
   * the default order. Unknown/missing ids are reconciled against the active vault's
   * own navigation list at render time.
   */
  sidebarOrder: string[];
  /**
   * Stable view/action ids the user has hidden from the sidebar. 'home' and
   * 'settings' can never be hidden. Hidden sections are simply not rendered in
   * the sidebar nav; they can be shown again from Settings.
   */
  sidebarHidden: string[];
  /**
   * Whether the user has explicitly chosen sidebar visibility. While false, the
   * effective hidden set comes from the active vault type's preset (e.g. an
   * `estudio` vault hides research/authoring views by default). The first time
   * the user toggles a section, the effective set is materialised into
   * `sidebarHidden` and this flips true, so their choice is respected thereafter.
   */
  sidebarCustomized: boolean;
  /** Release migration that enables Nodus Scriptor once, before later manual choices. */
  scriptorSidebarVersion: number;
  /** Toolkit destinations explicitly pinned as independent sidebar shortcuts. */
  toolkitPinnedPages: ToolkitToolPage[];
  /** Default wooden frame design for the genealogy tree (per-person overrides win). */
  treeFrame: string;
  /** Person used as the relative centre for every displayed and AI-visible kinship tag. */
  treeFocusPersonId: string | null;
  /** Family-tree vertical direction. Legacy vaults default to ancestors on top. */
  treeOrientation: 'ancestors_top' | 'ancestors_bottom';
  /** User-selected colours for the two primary ancestor branches. */
  treePaternalColor: string;
  treeMaternalColor: string;
  /** Whether each focus-relative ancestor branch is visible in the genealogy tree. */
  treePaternalBranchVisible: boolean;
  treeMaternalBranchVisible: boolean;
  // ── Recovery and automatic encrypted backups ──────────────────────────────
  /** Version of the global recovery-folder onboarding contract completed here. */
  recoverySetupVersion: number;
  /** Empty means every registered vault. Otherwise only these vault ids are copied. */
  backupVaultIds: string[];
  /** Include app-wide preferences plus Nodi notifications/conversations. */
  backupIncludePreferences: boolean;
  /** Include per-vault assistant/search histories stored outside SQLite. */
  backupIncludeHistories: boolean;
  /** Include regenerable narration WAVs and their per-vault metadata. */
  backupIncludeGeneratedMedia: boolean;
  /** Legacy compatibility field. New backups always include API keys in their encrypted payload. */
  backupIncludeApiKeys: boolean;
  // Scheduled backups to a user-chosen folder (point it at iCloud Drive /
  // Google Drive to get off-machine copies for free). Encrypted with the
  // master backup password stored in the OS keychain; unlike the manual
  // export. MCP tokens are never included; API keys are protected inside backups.

  // ── Testimonios (historia oral). Preferencias POR BÓVEDA ────────────────────
  // Son valores predeterminados que cada entrevista puede sobrescribir, no decisiones
  // irrevocables: un proyecto de historia oral suele tener una política («todo se
  // deposita en el archivo municipal, el narrador siempre revisa»), pero una entrevista
  // concreta puede acordarse de otra manera y el programa no puede impedirlo.
  /** Idioma habitual de las entrevistas de este proyecto (BCP-47 cuando sea posible). */
  testimonyDefaultLanguage: string;
  /** Nivel de acceso con el que nace un acuerdo si nadie dice otra cosa. */
  testimonyDefaultAccess: AccessLevel;
  /** Modo de atribución predeterminado. */
  testimonyDefaultAttribution: AttributionMode;
  /** Si en este proyecto el narrador revisa la transcripción por norma. */
  testimonyNarratorReviewDefault: boolean;
  /** Institución o repositorio de destino previsto. */
  testimonyRepositoryName: string;
  /** Política de conservación, en texto libre: es una decisión del proyecto, no un enum. */
  testimonyRetentionPolicy: string;
  /** Plantilla o referencia del acuerdo utilizado (un nombre o una URL). */
  testimonyAgreementTemplate: string;
  /**
   * Si esta bóveda permite mandar material a proveedores externos. DESACTIVADO por
   * omisión y a propósito: el ajuste puede CERRAR lo que un acuerdo abre, pero nunca al
   * revés. El acuerdo de cada entrevista sigue mandando por encima de esta casilla.
   */
  testimonyAllowExternalProviders: boolean;
  /** Propósito general del proyecto, mostrado en Inicio. */
  testimonyProjectPurpose: string;

  autoBackupEnabled: boolean;
  autoBackupFolder: string;
  autoBackupIntervalHours: number;
  /** Days of week the backup runs (0=Sun..6=Sat). Empty = every day. */
  autoBackupDays: number[];
  /** Local time of day for the scheduled backup. */
  autoBackupHour: number;
  autoBackupMinute: number;
  lastAutoBackupAt: string | null;
  lastAutoBackupStatus: string | null;
  /** Explicit opt-in to age-based cleanup of this computer's scheduled backups. */
  backupCleanupEnabled: boolean;
  backupRetentionValue: number;
  backupRetentionUnit: BackupRetentionUnit;
  lastBackupCleanupAt: string | null;
  lastBackupCleanupStatus: string | null;
}

/** Outcome of a manual or scheduled automatic backup run. */
export interface AutoBackupResult {
  ok: boolean;
  message: string;
  path?: string;
  prunedCount?: number;
}

export interface BackupCleanupPreview {
  ok: boolean;
  message: string;
  /** Opaque fingerprint of the exact files shown to the user; null on preview failure. */
  scopeToken: string | null;
  cutoff: string | null;
  candidateCount: number;
  candidateBytes: number;
  protectedCount: number;
  trashCount: number;
  purgeReadyCount: number;
  purgeReadyBytes: number;
}

export interface BackupCleanupResult extends BackupCleanupPreview {
  quarantinedCount: number;
  quarantinedBytes: number;
  purgedCount: number;
  purgedBytes: number;
  trashPath?: string;
}

/** User-facing scope for a complete encrypted backup. Database-backed content is
 * always copied as a whole per selected vault so foreign-key relationships cannot
 * be broken by a partial restore. */
export interface BackupSelection {
  vaultIds: string[];
  includePreferences: boolean;
  includeHistories: boolean;
  includeGeneratedMedia: boolean;
  includeApiKeys: boolean;
}

export interface RecoverySnapshotSummary {
  fileName: string;
  path: string;
  date: string;
  appVersion: string;
  schemaVersion: number;
  vaultCount: number;
  bytes: number;
  includesSecrets: boolean;
}

export interface RecoveryFolderInspection {
  path: string;
  kind: 'empty' | 'recovery' | 'invalid' | 'missing';
  message: string;
  snapshots: RecoverySnapshotSummary[];
}

/**
 * Why protection is (or is not) working right now. A backup system that fails quietly
 * is worse than none, so this is computed on every status read and surfaced in the UI
 * rather than left buried in a status string nobody opens.
 */
export type RecoveryHealthLevel = 'ok' | 'warning' | 'critical';
export type RecoveryHealthCode =
  | 'ok'
  /** Enabled and configured, but no snapshot has ever completed. */
  | 'never-run'
  /** The destination folder is gone, offline or no longer a recovery root. */
  | 'folder-unreachable'
  /** The last attempt failed (unreadable master password, disk error…). */
  | 'last-run-failed'
  /** Backups are enabled but the newest snapshot is far older than the schedule. */
  | 'stale'
  /** The user has not enabled automatic backups at all. */
  | 'disabled';

export interface RecoveryHealth {
  level: RecoveryHealthLevel;
  code: RecoveryHealthCode;
  /** Whole days since the last successful snapshot; null when there has never been one. */
  daysSinceLastBackup: number | null;
  /** The raw `lastAutoBackupStatus`, for the detailed view. */
  detail: string;
}

export interface RecoveryStatus {
  setupVersion: number;
  needsSetup: boolean;
  previousInstallation: boolean;
  configuredRoot: string;
  folder: RecoveryFolderInspection | null;
  hasPassword: boolean;
  hasRecoveryKey: boolean;
  health: RecoveryHealth;
}

export interface RecoverySetupResult {
  ok: boolean;
  message: string;
  snapshot?: RecoverySnapshotSummary;
  /** Shown once after setup so the user can store an independent credential. */
  recoveryKey?: string;
}

export type RecoveryRestoreProgressPhase =
  | 'preparing'
  | 'decrypting'
  | 'verifying'
  | 'restoring'
  | 'finalizing'
  | 'complete';

/** Live, monotonic restore progress. `progress` is the overall 0..1 value shown
 * by the UI; byte counters describe the real work completed in the current
 * streaming phase. Milestone-only phases intentionally report zero bytes. */
export interface RecoveryRestoreProgress {
  phase: RecoveryRestoreProgressPhase;
  progress: number;
  completedBytes: number;
  totalBytes: number;
}

/**
 * Where a vault's canonical data lives.
 *
 * 'local' is every vault that has ever existed: the SQLite on this machine IS the vault.
 * 'connected' is a replica of a Nodus Server space — still a real, fully migrated database
 * that every repository reads normally, but one a remote publication can overwrite, and
 * whose authored content may travel back depending on the account's role.
 */
export type VaultOrigin = 'local' | 'connected';

export type VaultRemoteRole = 'reader' | 'writer' | 'owner';

export interface VaultRemote {
  /** Absent in older registries and therefore treated as classic. */
  serverKind?: 'classic' | 'cloudflare';
  url: string;
  spaceId: string;
  spaceName: string;
  serverName: string;
  userEmail: string;
  /**
   * Last role the server reported. Advisory only, for offline UI: every request re-reads
   * the real role server-side, so a stale copy here can never grant anything.
   */
  role: VaultRemoteRole;
  /**
   * 'revoked' stops syncing and keeps every local byte readable. A server withdrawing
   * access is not a reason to destroy the notes its user wrote on their own machine.
   */
  state: 'active' | 'revoked' | 'paused';
  lastPulledRevision: string | null;
  lastPulledAt: string | null;
}

/** One space the signed-in account can reach, as offered by the picker. */
export interface RemoteSpaceChoice {
  id: string;
  name: string;
  description: string;
  role: VaultRemoteRole;
  vault: { id: string; name: string; type: string } | null;
  updatedAt: string | null;
  hasSnapshot: boolean;
}

export interface RemoteSignIn {
  /** Single use, five minutes: the password is never sent a second time. */
  ticket: string;
  url: string;
  serverName: string;
  userEmail: string;
  /** Absent on older servers, which are treated as classic. */
  serverKind?: 'classic' | 'cloudflare';
  spaces: RemoteSpaceChoice[];
}

export type ReplicaPhaseView = 'idle' | 'syncing' | 'ok' | 'error' | 'revoked' | 'paused';

export interface ReplicaConnectionView {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  isActiveVault: boolean;
  url: string;
  spaceName: string;
  serverName: string;
  userEmail: string;
  role: VaultRemoteRole;
  state: VaultRemote['state'];
  phase: ReplicaPhaseView;
  lastPulledAt: string | null;
  lastError: string | null;
  /** Changes written here that have not reached the main vault yet. */
  pendingMutations: number;
  /** Changes the server refused, kept locally so the work is never lost in silence. */
  rejectedMutations: number;
  /** Illustrations fetched on the last pull; zero once the replica holds them all. */
  lastImages: { downloaded: number; bytes: number; skipped: number } | null;
}

export interface ReplicaPresenceParticipant {
  id: string;
  userId: string;
  name: string;
  pageId: string | null;
  blockId: string | null;
  cursor: { anchor: number; head: number } | null;
  color: string | null;
  updatedAt: string;
}

export interface ReplicaPresenceInput {
  pageId?: string | null;
  blockId?: string | null;
  cursor?: { anchor: number; head: number } | null;
  color?: string | null;
}

export interface VaultSummary {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  active: boolean;
  legacy: boolean;
  /** The vault's mode. Pre-existing vaults default to 'academic'. */
  type: VaultType;
  /** Pre-existing vaults default to 'local'. */
  origin: VaultOrigin;
  remote: VaultRemote | null;
  apiKeyProviders: AiProvider[];
}

export interface CreateVaultInput {
  name: string;
  /** Optional vault type; defaults to 'academic' when omitted. */
  type?: VaultType;
  /** Initial general text model chosen in the creation wizard. Optional only for
   * backwards compatibility with older renderer builds and automation clients. */
  aiModel?: ModelRef;
  /** Initial semantic-index provider/model chosen independently from the text model. */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
}

export interface VaultSwitchOptions {
  copyApiKeysFromVaultId?: string | null;
}

export type VaultAnalysisReuseKind =
  | 'themes'
  | 'ideas'
  | 'ideaEmbeddings'
  | 'summary'
  | 'passages'
  | 'documentProfile'
  | 'relations'
  | 'authors'
  | 'synthesis';

export interface VaultAnalysisReuseWorkResult {
  nodusId: string;
  matchedVaultId: string | null;
  matchedVaultName: string | null;
  matchedSourceNodusId: string | null;
  imported: VaultAnalysisReuseKind[];
  importedRows: number;
  tableRows: Record<string, number>;
  compatibility: Partial<Record<VaultAnalysisReuseKind, {
    state: 'reused' | 'pending' | 'incompatible' | 'unavailable' | 'canceled';
    reason: string;
  }>>;
}

export interface VaultAnalysisReuseResult {
  requested: number;
  matched: number;
  imported: number;
  canceled: boolean;
  works: VaultAnalysisReuseWorkResult[];
}

export interface VaultSwitchResult {
  ok: boolean;
  message: string;
  activeVault?: VaultSummary;
  copiedProviders: AiProvider[];
}

export interface VaultCreateResult {
  vault: VaultSummary;
}

export interface VaultDuplicateResult {
  vault: VaultSummary;
  copiedProviders: AiProvider[];
}

/** Immutable, verified copy made immediately before a schema migration. */
export interface MigrationRecoverySnapshot {
  id: string;
  databasePath: string;
  manifestPath: string;
  sourceDatabasePath: string;
  fromVersion: number;
  targetVersion: number;
  createdAt: string;
  bytes: number;
  sha256: string;
  quickCheck: string;
  immutable: boolean;
  major: boolean;
}

// ── Primary-source / genealogy records ontology (phase B) ────────────────────

export type PersonSex = 'male' | 'female' | 'unknown';

/**
 * Event kinds stored in `events.type`. The first block is the records/genealogy
 * vocabulary; the second is the worldbuilding one. They share the column and this
 * union but never the same picker — each surface enumerates its own subset
 * (EVENT_TYPE_OPTIONS in the person dossier, CHARACTER_EVENT_TYPES in the character
 * one), and every consumer of this union is an explicit allow-list rather than an
 * exhaustive switch, so neither vocabulary ever leaks into the other's UI.
 */
export type HistoricalEventType =
  | 'birth'
  | 'baptism'
  | 'marriage'
  | 'death'
  | 'burial'
  | 'census'
  | 'residence'
  | 'migration'
  | 'occupation'
  | 'other'
  // Worldbuilding
  | 'first_appearance'
  | 'oath'
  | 'betrayal'
  | 'battle'
  | 'journey'
  | 'ascension'
  | 'exile'
  | 'transformation'
  | 'bond'
  | 'loss'
  | 'revelation';

/** User-defined event kinds carry their encoded label so facts stay readable after
 * the vocabulary entry itself is removed. */
export type CustomHistoricalEventType = `custom:${string}`;
export type EventTypeValue = HistoricalEventType | CustomHistoricalEventType;
export type EventTypeVocabularyScope = 'records' | 'worldbuilding';

export type ParticipantRole =
  | 'principal'
  | 'spouse'
  | 'father'
  | 'mother'
  | 'child'
  | 'witness'
  | 'officiant'
  | 'other';

export type RecordEvidenceTargetKind =
  | 'person'
  | 'place'
  | 'event'
  | 'event_participant'
  | 'social_relation'
  | 'identity_resolution'
  | 'archive_item'
  /** Legacy names remain readable while callers migrate to the explicit names above. */
  | 'participant'
  | 'relationship';
export type RecordSourceKind = 'work' | 'archive';
export type RecordEvidenceRole = 'supports' | 'contradicts' | 'contextualizes' | 'mentions';
export type RecordEvidenceReviewStatus = 'unreviewed' | 'in_review' | 'reviewed';

// Kinship (genealogy layer, phase C)
export type RelationshipType = 'parent' | 'spouse' | 'sibling';
export type RelationshipProvenance = 'user_asserted' | 'ai_confirmed';
/** Nuance on a parent edge: null = biological/default, 'adoptive' for adoptions. */
export type RelationshipSubtype = 'adoptive' | null;

export interface Relationship {
  relId: string;
  fromPerson: string;
  toPerson: string;
  type: RelationshipType;
  provenance: RelationshipProvenance;
  subtype: RelationshipSubtype;
  notes: string | null;
}

/** A person's immediate kin, resolved for the ficha and the tree. */
export interface Kin {
  parents: Person[];
  children: Person[];
  spouses: Person[];
  siblings: Person[];
}

// Social-relations network (genealogy layer) — a SECOND, independent graph from the
// kinship tree: the connections a person had beyond family (patrons, friends,
// employers, rivals, correspondents...), the material a social/prosopographical
// historian works with. Always recorded from a tree person's ficha ("who they
// knew"); the target is either another tree person or a lightweight contact who
// isn't themselves a tree member.

/** A person known only through a social relation, not themselves a tree member. */
export interface SocialContact {
  contactId: string;
  displayName: string;
  /** Free text (markdown) about who they were — occupation, dates, place... */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialContactInput {
  displayName: string;
  notes?: string | null;
}

export type SocialRelationTargetKind = 'contact' | 'person';

/** A directed, typed connection recorded from `personId`'s ficha. */
export interface SocialRelation {
  relationId: string;
  personId: string;
  /** personId's display name, resolved for convenience (always a tree person). */
  personName: string;
  targetKind: SocialRelationTargetKind;
  targetId: string;
  /** The target's display name, resolved for convenience (contact or person). */
  targetName: string;
  /** Free text from personId's perspective (amigo, patrón, socio...). */
  role: string;
  /** Markdown, about the connection itself (distinct from the contact's own notes). */
  notes: string | null;
  /**
   * Worldbuilding only: the colour of the bond. The relation is already DIRECTIONAL, so
   * A can be 'lover' towards B while B is 'nemesis' towards A — the asymmetry that
   * fiction needs and a genealogy role never expresses.
   */
  valence?: SocialRelationValence | null;
  /** The event from which the bond took this shape; null when it always has. */
  sinceEventId?: string | null;
  /** Evidence-first enrichment. Legacy rows use the schema defaults. */
  status: 'proposal' | 'confirmed' | 'rejected';
  certainty: number | null;
  dateDisplay: string | null;
  dateStartSort: string | null;
  dateEndSort: string | null;
  direction: 'directed' | 'undirected' | 'mutual';
  createdAt: string;
  updatedAt: string;
}

/** How a directed social bond feels from the source's side. */
export type SocialRelationValence =
  | 'ally'
  | 'rival'
  | 'lover'
  | 'mentor'
  | 'student'
  | 'nemesis'
  | 'kin'
  | 'neutral';

export interface SocialRelationInput {
  personId: string;
  targetKind: SocialRelationTargetKind;
  targetId: string;
  role: string;
  notes?: string | null;
  valence?: SocialRelationValence | null;
  sinceEventId?: string | null;
  status?: 'proposal' | 'confirmed' | 'rejected';
  certainty?: number | null;
  dateDisplay?: string | null;
  dateStartSort?: string | null;
  dateEndSort?: string | null;
  direction?: 'directed' | 'undirected' | 'mutual';
}

/** One node in the social-relations graph: a tree person or a standalone contact. */
export interface SocialGraphNode {
  id: string;
  kind: SocialRelationTargetKind;
  displayName: string;
}

export interface SocialGraphEdge {
  relationId: string;
  fromId: string;
  toId: string;
  role: string;
}

export interface SocialGraphData {
  nodes: SocialGraphNode[];
  edges: SocialGraphEdge[];
}

export interface GedcomImportResult {
  persons: number;
  relationships: number;
  events: number;
}

// ── Evidence-driven kinship suggestions (genealogy) ──────────────────────────
// The AI proposes kinship; it never asserts it. A suggestion accumulates evidence
// and is confirmed (→ a real ai_confirmed relationship) or dismissed by the user.

/** How a piece of evidence came to back a kinship suggestion. */
export type KinSignal = 'record_role' | 'explicit_claim';

export type KinSuggestionStatus = 'open' | 'confirmed' | 'dismissed';

/** Qualitative strength of a suggestion, derived from its accumulated score. */
export type KinStrength = 'alta' | 'media' | 'baja';

/** One evidence item behind a kinship suggestion, with its verbatim quote. */
export interface KinSuggestionEvidence {
  id: string;
  suggestionId: string;
  signal: KinSignal;
  sourceKind: RecordSourceKind;
  nodusId: string | null;
  quote: string | null;
  location: string | null;
  weight: number;
}

/** A proposed parent/spouse relationship with the evidence and people it concerns. */
export interface KinSuggestion {
  suggestionId: string;
  fromPerson: string;
  toPerson: string;
  type: RelationshipType;
  subtype: RelationshipSubtype;
  status: KinSuggestionStatus;
  score: number;
  strength: KinStrength;
  fromName: string;
  toName: string;
  evidence: KinSuggestionEvidence[];
  createdAt: string;
  updatedAt: string;
}

/** A proposed identity match between two person records, with why. */
export interface MatchCandidatePair {
  aId: string;
  bId: string;
  score: number;
  reasons: string[];
  a: Person;
  b: Person;
}

export interface PersonName {
  name: string;
  kind: string | null;
  /**
   * Worldbuilding only: this name is a secret. Genealogy never sets it — a historical
   * record either says a name or it does not.
   */
  secret?: boolean;
  /** Who inside the story knows this name. Free text; only meaningful when `secret`. */
  knownBy?: string | null;
}

/** Non-destructive framing of a person's portrait; the original bytes are untouched. */
export interface PortraitFocus {
  focusX: number;
  focusY: number;
  scale: number;
  /** True when the portrait is an AI-generated reference likeness, not a real photo. */
  generated?: boolean;
  /** Revision of the stored bytes/framing, used to invalidate the native image cache. */
  updatedAt?: string;
}

export interface Person {
  personId: string;
  displayName: string;
  /** Country-issued identifier, e.g. a national identity or tax number. */
  nationalId: string | null;
  sex: PersonSex;
  /** Human display form of the date, e.g. "c. 1850". */
  birthDate: string | null;
  deathDate: string | null;
  notes: string | null;
  /** Name variants / spellings across records. */
  names: PersonName[];
  /** Portrait framing when a photo is attached; null when there is none. */
  portrait: PortraitFocus | null;
  /** Per-person wooden tree-frame design override; null = use the vault default. */
  frameStyle: string | null;
  /** AI-generated biography from the evidence; null until generated. */
  biography: string | null;
  biographyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonInput {
  displayName: string;
  nationalId?: string | null;
  sex?: PersonSex;
  birthDate?: string | null;
  deathDate?: string | null;
  notes?: string | null;
  names?: PersonName[];
}

// ── Worldbuilding characters ─────────────────────────────────────────────────
// A character is a `Person` row plus the `character_profiles` overlay (schema v91).
// Reusing the person row is what gives characters life events, kinship, social
// relations, places and the portrait for free; the overlay carries everything that
// only means something inside an invented world.

export type CharacterLifeStatus =
  | 'unknown'
  | 'alive'
  | 'dead'
  | 'missing'
  | 'undead'
  | 'immortal'
  | 'unborn';

export type CharacterNarrativeRole = 'protagonist' | 'antagonist' | 'secondary' | 'tertiary' | 'cameo';

/** The classic story-structure arc. Every field optional: it is a prompt, not a form. */
export interface CharacterArc {
  want: string | null;
  need: string | null;
  flaw: string | null;
  /** The lie they believe about themselves or the world. */
  lie: string | null;
  /** The wound the lie came from. */
  wound: string | null;
}

/** How a character sounds — reused when the AI writes their dialogue or speaks them. */
export interface CharacterVoice {
  register: string | null;
  /** Verbal tics, catchphrases, things they never say. */
  tics: string | null;
  /** A two- or three-line sample of them talking. */
  sample: string | null;
}

export type CharacterImageKind = 'portrait' | 'full_body' | 'expression' | 'age' | 'outfit' | 'emblem' | 'other';

/** What a `world_images` row hangs off. Polymorphic, so nothing cascades from it.
 *  The column carries no CHECK constraint, so a value outside this union writes happily
 *  and the gallery then returns nothing without erroring: this type is the only guard. */
export type WorldImageEntityKind = 'character' | 'place' | 'group' | 'scene' | 'article';

/**
 * How a character's biography is written. `faithful` retells only what the sheet says;
 * `propose` may fill gaps but must mark what it invented, and its output is quarantined
 * in CharacterProfile.biographyProposed until the author accepts it.
 */
export type CharacterBiographyMode = 'faithful' | 'propose';

export interface CharacterImage {
  imageId: string;
  personId: string;
  kind: CharacterImageKind;
  label: string | null;
  mimeType: string;
  bytes: number;
  /** The prompt that produced it, so a generation can be iterated, not re-guessed. */
  prompt: string | null;
  provider: string | null;
  model: string | null;
  style: string | null;
  generated: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterChatImage {
  imageId: string;
  mimeType: string;
  bytes: number;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface CharacterChatMessage {
  id: string;
  role: 'author' | 'character';
  content: string;
  image: CharacterChatImage | null;
  createdAt: string;
}

export interface CharacterChatConversationSummary {
  id: string;
  personId: string;
  title: string;
  imageEnabled: boolean;
  messageCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterChatConversation extends CharacterChatConversationSummary {
  messages: CharacterChatMessage[];
}

export interface CharacterChatSendResult {
  conversation: CharacterChatConversation;
  /** Text still succeeds when the optional image provider fails. */
  imageError: string | null;
}

export interface CharacterAbility {
  abilityId: string;
  personId: string;
  name: string;
  description: string | null;
  /** What using it costs. */
  cost: string | null;
  /** What it cannot do. Without this a power is a plot solvent. */
  limits: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** The fiction half of a place: an overlay on `places`, like CharacterProfile on persons. */
export interface PlaceProfile {
  placeId: string;
  appearance: string | null;
  atmosphere: string | null;
  history: string | null;
  visualSeed: string | null;
  accent: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A place seen from a worldbuilding vault: the shared row plus its overlay. */
export interface WorldPlace extends Place {
  profile: PlaceProfile;
}

export interface WorldPlaceInput {
  name: string;
  kind?: string | null;
  parentId?: string | null;
  notes?: string | null;
  appearance?: string | null;
  atmosphere?: string | null;
  history?: string | null;
  visualSeed?: string | null;
  accent?: string | null;
}

// ── Secrets and scenes (schema v96) ──────────────────────────────────────────

export type WorldSecretStatus = 'kept' | 'revealed';

export interface WorldSecret {
  secretId: string;
  title: string;
  content: string | null;
  ownerPersonId: string | null;
  ownerName: string | null;
  status: WorldSecretStatus;
  /** When it got out, on the world scale. */
  revealedWorldDay: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldSecretInput {
  title: string;
  content?: string | null;
  ownerPersonId?: string | null;
  status?: WorldSecretStatus;
  revealedWorldDay?: number | null;
  notes?: string | null;
}

export interface SecretKnower {
  id: string;
  secretId: string;
  personId: string;
  personName: string;
  /** When they learned it; null means they always knew. */
  sinceWorldDay: number | null;
  how: string | null;
}

export type WorldSceneStatus = 'outline' | 'draft' | 'written';

export interface WorldScene {
  sceneId: string;
  title: string;
  summary: string | null;
  placeId: string | null;
  placeName: string | null;
  /** WHEN it happens in the world. */
  worldYear: number | null;
  worldDay: number | null;
  status: WorldSceneStatus;
  /** WHERE it sits in the telling. Not the same as when it happens — see a prologue. */
  narrativeOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldSceneInput {
  title: string;
  summary?: string | null;
  placeId?: string | null;
  worldYear?: number | null;
  worldDay?: number | null;
  status?: WorldSceneStatus;
  narrativeOrder?: number;
  notes?: string | null;
}

export interface SceneAppearance {
  id: string;
  sceneId: string;
  sceneTitle: string;
  personId: string;
  personName: string;
  role: string | null;
}

// ── Maps of an invented world (schema v97) ───────────────────────────────────
//
// A MAP IS A CANVAS, NOT A PLACE: the relation to `Place` is many-to-many. Every
// coordinate below is normalized 0..1 against the base image, never a pixel; the
// arithmetic lives in shared/worldMapGeometry.ts and is the only correct way to
// transform any of it.

export type WorldMapKind =
  | 'world' | 'continent' | 'region' | 'city' | 'town' | 'building'
  | 'interior' | 'dungeon' | 'battle' | 'route' | 'schematic' | 'other';

export type MapGeometryKind = 'point' | 'circle' | 'polygon' | 'path';
export type MapLayerKind = 'political' | 'physical' | 'routes' | 'climate' | 'culture' | 'battle' | 'labels' | 'custom';
export type MapImageRole = 'base' | 'previous' | 'reference';

export interface WorldMap {
  mapId: string;
  name: string;
  kind: WorldMapKind;
  /** The place this map IS of, when it is of one. */
  placeId: string | null;
  placeName: string | null;
  parentMapId: string | null;
  /** Where this map falls inside its parent, in the PARENT's normalized coordinates. */
  parentX0: number | null;
  parentY0: number | null;
  parentX1: number | null;
  parentY1: number | null;
  imageId: string | null;
  widthPx: number;
  heightPx: number;
  /** The calibration segment: two points, never a length. See worldMapGeometry.ts. */
  scaleX0: number | null;
  scaleY0: number | null;
  scaleX1: number | null;
  scaleY1: number | null;
  scaleDistance: number | null;
  scaleUnit: MapDistanceUnitName | null;
  projection: 'flat' | 'globe';
  planetRadius: number | null;
  planetRadiusUnit: MapDistanceUnitName | null;
  fromWorldDay: number | null;
  toWorldDay: number | null;
  visualSeed: string | null;
  style: string | null;
  /** True when the image model was asked to write the place names itself. */
  modelLabels: boolean;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Kept as a plain string union rather than importing `MapDistanceUnit` from
 * worldMapGeometry: types.ts sits at the root of the import graph and nothing here may
 * depend on a module that depends on it. The two are pinned together by a test.
 */
export type MapDistanceUnitName = 'km' | 'mi' | 'm' | 'ft' | 'league' | 'custom';

export interface WorldMapInput {
  name: string;
  kind?: WorldMapKind;
  placeId?: string | null;
  parentMapId?: string | null;
  parentX0?: number | null;
  parentY0?: number | null;
  parentX1?: number | null;
  parentY1?: number | null;
  projection?: 'flat' | 'globe';
  planetRadius?: number | null;
  planetRadiusUnit?: MapDistanceUnitName | null;
  scaleX0?: number | null;
  scaleY0?: number | null;
  scaleX1?: number | null;
  scaleY1?: number | null;
  scaleDistance?: number | null;
  scaleUnit?: MapDistanceUnitName | null;
  fromWorldDay?: number | null;
  toWorldDay?: number | null;
  visualSeed?: string | null;
  style?: string | null;
  modelLabels?: boolean;
  notes?: string | null;
  sortOrder?: number;
}

export interface MapImageMeta {
  imageId: string;
  mapId: string;
  role: MapImageRole;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  style: string | null;
  generated: boolean;
  createdAt: string;
}

export interface MapLayer {
  layerId: string;
  mapId: string;
  name: string;
  kind: MapLayerKind;
  color: string | null;
  opacity: number;
  visible: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MapLayerInput {
  name: string;
  kind?: MapLayerKind;
  color?: string | null;
  opacity?: number;
  visible?: boolean;
  sortOrder?: number;
}

export interface MapMarker {
  markerId: string;
  mapId: string;
  layerId: string | null;
  placeId: string | null;
  /** Resolved from the place, so a card can be drawn without a second query. */
  placeName: string | null;
  placeKind: string | null;
  childMapId: string | null;
  /** Override; null means "use the place name". */
  label: string | null;
  geometryKind: MapGeometryKind;
  x: number;
  y: number;
  /** Circles only, normalized against the X axis. */
  radius: number | null;
  /** polygon/path vertices, already parsed. */
  points: { x: number; y: number }[] | null;
  icon: string | null;
  color: string | null;
  fromWorldDay: number | null;
  toWorldDay: number | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MapMarkerInput {
  mapId: string;
  layerId?: string | null;
  placeId?: string | null;
  childMapId?: string | null;
  label?: string | null;
  geometryKind?: MapGeometryKind;
  x: number;
  y: number;
  radius?: number | null;
  points?: { x: number; y: number }[] | null;
  icon?: string | null;
  color?: string | null;
  fromWorldDay?: number | null;
  toWorldDay?: number | null;
  notes?: string | null;
  sortOrder?: number;
}

export interface MapTravelMode {
  modeId: string;
  name: string;
  distancePerDay: number;
  unit: MapDistanceUnitName;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MapTravelModeInput {
  name: string;
  distancePerDay: number;
  unit?: MapDistanceUnitName;
  icon?: string | null;
  sortOrder?: number;
}

export type MapGenerationMode = 'create' | 'zoom' | 'expand' | 'restyle' | 'variant';

export interface MapGenerationRequestPayload {
  mapId: string;
  mode: MapGenerationMode;
  style?: string;
  extra?: string | null;
  region?: { x0: number; y0: number; x1: number; y1: number };
  childName?: string;
  edge?: 'north' | 'south' | 'east' | 'west';
  fraction?: number;
  /** `zoom` only: crop with no model at all — exact, instant and offline. */
  cropOnly?: boolean;
}

export interface MapGenerationResultPayload {
  map: WorldMap;
  degraded: boolean;
  notice: string | null;
}

export interface SuggestedMapMarker {
  name: string;
  kind: string | null;
  x: number;
  y: number;
}

/** Where a place is shown, for the "En los mapas" section of a place sheet. */
export interface PlaceMapAppearance {
  mapId: string;
  mapName: string;
  mapKind: WorldMapKind;
  markerId: string;
  x: number;
  y: number;
}

// ── "Analizar": rules, conflicts, arcs, continuity and open questions (v99) ──
//
// Five sections over one skeleton, because all five are readings of a single statement
// the vault could not hold before: "in this scene, this moves like so". A rule put to the
// test, a conflict that advances and an arc that turns are the same row with different
// vocabulary — which is why they are filled in from one place, the sheet of the scene the
// author already has open, and not from five screens nobody visits.

/** How a scene's day is declared: relative to the previous one, or pinned. */
export type SceneDayMode = 'anchor' | 'same' | 'offset';

export interface SceneDayLink {
  sceneId: string;
  mode: SceneDayMode;
  offsetDays: number;
  anchorWorldDay: number | null;
}

/** A conflict is a thread whose parties oppose; an arc is a thread with one subject. */
export type WorldThreadKind = 'conflict' | 'arc';
export type WorldThreadStatus = 'open' | 'resolved' | 'archived';
/** `background` is pressure that is nobody's plan — the winter, the plague, the debt. */
export type WorldThreadScope = 'external' | 'background';
/** `caught` is the one nobody asks for and every story needs: the child, the hostage. */
export type ThreadPartySide = 'subject' | 'wants' | 'opposes' | 'caught';

export interface ThreadParty {
  threadId: string;
  partyKind: 'character' | 'group';
  partyId: string;
  partyName: string;
  side: ThreadPartySide;
}

export interface WorldThread {
  threadId: string;
  kind: WorldThreadKind;
  title: string;
  titleKey: string;
  /** One box of prose, not two: whoever types "The war for the ford" has said the object. */
  pitch: string | null;
  /** What is lost if this is lost. Conflicts only. */
  stakes: string | null;
  scope: WorldThreadScope;
  status: WorldThreadStatus;
  outcome: string | null;
  origin: 'author' | 'ai';
  parties: ThreadParty[];
  createdAt: string;
  updatedAt: string;
}

export interface WorldThreadInput {
  kind?: WorldThreadKind;
  title?: string;
  pitch?: string | null;
  stakes?: string | null;
  scope?: WorldThreadScope;
  status?: WorldThreadStatus;
  outcome?: string | null;
}

/** What a beat hangs off. `rule` points at `world_rules`, the rest at `world_threads`. */
export type BeatThreadKind = 'rule' | 'conflict' | 'arc';

/**
 * The four-word vocabularies. Four words an author picks without thinking, never a 0–10
 * number: a figure re-invented on each scene measures nothing across a manuscript.
 */
export type RuleMark = 'obeys' | 'bends' | 'breaks' | 'establishes';
export type ConflictMark = 'raise' | 'turn' | 'ease' | 'resolve';
export type ArcMark = 'step' | 'turn';
export type BeatMark = RuleMark | ConflictMark | ArcMark;

export interface WorldBeat {
  threadKind: BeatThreadKind;
  threadId: string;
  threadTitle: string;
  sceneId: string;
  sceneTitle: string;
  narrativeOrder: number;
  mark: BeatMark;
  /** What changes, in one sentence. Only asked for when the mark is a turn. */
  text: string | null;
  /** In whose favour. For a rule, who broke it; for an arc, null. */
  subjectKind: 'character' | 'group' | null;
  subjectId: string | null;
  subjectName: string | null;
  /** Rules only. 1 = the price is on the page, 0 = it is not, null = not looked at yet. */
  paid: boolean | null;
}

export interface WorldBeatInput {
  threadKind: BeatThreadKind;
  threadId: string;
  sceneId: string;
  mark: BeatMark;
  text?: string | null;
  subjectKind?: 'character' | 'group' | null;
  subjectId?: string | null;
  paid?: boolean | null;
}

/** The contract with the reader, and the only field that changes what a breach means. */
export type RuleHardness = 'physical' | 'costly' | 'social';
export type RuleStatus = 'canon' | 'tentative' | 'retired';

export interface WorldRule {
  ruleId: string;
  title: string;
  titleKey: string;
  statement: string | null;
  /** What breaking it costs. Apart from the statement because the whole diagnostic layer
   *  asks it one question: is this price ever on the page. */
  cost: string | null;
  /** How far it does NOT reach. Without this a magic system dissolves every plot. */
  limits: string | null;
  hardness: RuleHardness;
  /** An exception is a NARROWER RULE hanging off its mother, inheriting scope and price. */
  parentRuleId: string | null;
  /** The encyclopedia article this rule was made from. */
  articleId: string | null;
  scopeKind: 'world' | 'group' | 'place';
  scopeId: string | null;
  fromWorldDay: number | null;
  toWorldDay: number | null;
  status: RuleStatus;
  secretId: string | null;
  proposedText: string | null;
  proposedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldRuleInput {
  title?: string;
  statement?: string | null;
  cost?: string | null;
  limits?: string | null;
  hardness?: RuleHardness;
  parentRuleId?: string | null;
  articleId?: string | null;
  scopeKind?: 'world' | 'group' | 'place';
  scopeId?: string | null;
  fromWorldDay?: number | null;
  toWorldDay?: number | null;
  status?: RuleStatus;
  secretId?: string | null;
}

/** `parked` means "stop showing me this until something changes" and absorbs what the
 *  design called `dismissed`: two negative states nobody could tell apart in practice. */
export type WorldQuestionStatus = 'open' | 'answered' | 'parked';

/** Two derivations and no more. The other five belong to the sections that own those facts
 *  and arrive here through a button on each of them, never through a second scan. */
export type WorldQuestionOrigin = 'author' | 'placeholder';

/** What answering WRITES. Inferred from where the question was captured, never chosen in a
 *  form. `none` is a first-class answer: decisions get taken and simply remembered. */
export type WorldApplyMode = 'none' | 'fill_field' | 'create_article';

export type WorldQuestionUrgency = 'blocking' | 'soon' | 'later';

/**
 * One competing answer. A row rather than a bullet in a JSON column because each one is
 * chosen, applied and undone separately — and above all because an option is A PENDING
 * WRITE, and a write needs a destination.
 */
export interface WorldQuestionOption {
  optionId: string;
  questionId: string;
  text: string;
  /** What it drags along with it. Written by the model beside the option; as an empty box
   *  it gets filled in on the first two questions and never again. */
  implications: string | null;
  /** An option is not canon until it is chosen AND applied, so the quarantine here is
   *  structural rather than a second column. */
  origin: 'author' | 'ai';
  applyMode: WorldApplyMode;
  appliedAt: string | null;
  /** What the field said BEFORE. This is the undo, and without it nobody presses a button
   *  that overwrites a paragraph of their own prose. */
  replacedText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldQuestion {
  questionId: string;
  question: string;
  /** Polymorphic over six tables and therefore without a foreign key. NULL is legitimate
   *  and common: "magic leaves a visible mark" belongs to the world, not to a sheet. */
  anchorKind: string | null;
  anchorId: string | null;
  /** Joined for display and for the facet; not a column. */
  anchorTitle: string | null;
  anchorField: string | null;
  status: WorldQuestionStatus;
  origin: WorldQuestionOrigin;
  originKey: string | null;
  /** A switch, not a priority scale: a scale is a field edited once and never again. */
  blocking: boolean;
  chosenOptionId: string | null;
  answeredAt: string | null;
  options: WorldQuestionOption[];
  createdAt: string;
  updatedAt: string;
}

export interface WorldQuestionInput {
  question?: string;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorField?: string | null;
  status?: WorldQuestionStatus;
  origin?: WorldQuestionOrigin;
  originKey?: string | null;
  blocking?: boolean;
}

export interface WorldQuestionOptionInput {
  optionId?: string;
  questionId: string;
  text?: string;
  implications?: string | null;
  origin?: 'author' | 'ai';
  applyMode?: WorldApplyMode;
}

/** A question as the screen reads it: the stored row (or a hole that has no row yet), plus
 *  the two things only the whole vault can answer — what leans on it and what it blocks. */
export interface WorldQuestionFeedItem {
  /** null while it is only derived: nothing has been stored for this hole yet. */
  questionId: string | null;
  originKey: string | null;
  question: string;
  origin: WorldQuestionOrigin;
  status: WorldQuestionStatus;
  anchor: { kind: string; id: string; title: string } | null;
  anchorField: string | null;
  blocking: boolean;
  /** The line the hole sits in, verbatim. */
  evidence: string | null;
  options: WorldQuestionOption[];
  chosenOptionId: string | null;
  /** How many bodies mention the anchor. */
  leverage: number;
  blockedScene: { sceneId: string; title: string; narrativeOrder: number } | null;
  urgency: WorldQuestionUrgency;
  updatedAt: string | null;
}

// ── The manuscript (v100) ────────────────────────────────────────────────────
//
// Not a new document: the column the scene was missing. The prose of a scene, the chapter
// it opens, and the word diary — everything else the section needs (the order, the dates,
// what a scene must do) already exists elsewhere in the vault.

export interface SceneText {
  sceneId: string;
  text: string | null;
  wordCount: number;
  updatedAt: string | null;
}

/**
 * Which of a scene's declared beats are actually on the page.
 *
 * `present: null` means the model did not answer for that one — never a guess. Telling an
 * author something is written when nobody checked is the failure this exists to avoid.
 */
export interface ProseReviewResult {
  beats: {
    threadKind: BeatThreadKind;
    threadId: string;
    threadTitle: string;
    mark: string;
    present: boolean | null;
    note: string | null;
  }[];
  /** True when there are no declared beats, or nothing written yet — not an error. */
  noMaterial: boolean;
}

/** What a scene said before a rewrite. The list never carries the text. */
export interface SceneSnapshot {
  snapshotId: string;
  sceneId: string;
  wordCount: number;
  /** `shrink` was taken by the save itself, when the text suddenly halved. */
  reason: 'manual' | 'shrink';
  createdAt: string;
}

export interface ManuscriptSpine {
  /** The shelf. One book is the normal case and comes back as a single untitled one. */
  books: import('./worldManuscript').SpineBook[];
  chapters: import('./worldManuscript').SpineChapter[];
  totals: import('./worldManuscript').ManuscriptTotals;
}

export interface ManuscriptProgress {
  words: number;
  /** Written today, against the last day recorded. Negative on a day of cutting. */
  today: number;
  history: { day: string; totalWords: number }[];
}

/** A question for the world chat. `focusKeys` is the author's explicit choice; with none,
 *  the repo resolves the focus from the names the question itself uses. */
export interface WorldChatRequest {
  attachmentIds?: string[];
  /** Optional vault-local preference; null/absence keeps the original application prompt. */
  systemPromptId?: string | null;
  thinkingEffort?: import('./researchReasoning').ResearchEffort;
  conversationId?: string;
  question: string;
  focusKeys?: string[];
  history?: DbChatTurn[];
  model?: ModelRef | null;
}

export interface WorldChatResult {
  text: string;
  /** What it actually answered about, so the screen can show (and correct) the focus. */
  focus: { kind: string; id: string; title: string }[];
  /** True when the question named nothing this world contains — not an error. */
  noMaterial: boolean;
  /** The user stopped the stream: `text` is the partial answer that had already arrived. */
  aborted?: boolean;
}

export interface WorldChatSelection {
  /** Automatic resolves names in each question; manual always sends the chosen entries. */
  scope: 'auto' | 'manual';
  entryKeys: string[];
  /** In automatic mode, keep using the last resolved focus for follow-up questions. */
  keepFocus: boolean;
}

export interface WorldChatConversationSummary extends ChatHistoryPlacementFields {
  id: string;
  title: string;
  selection: WorldChatSelection;
  focus: WorldChatResult['focus'];
  model: ModelRef | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorldChatConversation extends WorldChatConversationSummary {
  messages: DbChatTurn[];
}

/** The drafted statement of a law, quarantined in `world_rules.proposed_text`. */
export interface WorldRuleDraftResult {
  text: string | null;
  /** True when the law is too bare to draft from — not an error. */
  noMaterial: boolean;
}

/** Answers a model proposed. They are stored as options and are NOT canon: an option
 *  becomes part of the world only when the author chooses it and applies it. */
export interface WorldQuestionOptionsResult {
  options: WorldQuestionOption[];
  noMaterial: boolean;
}

/** What a scene is waiting on, for the band on its sheet. */
export interface SceneQuestionLoad {
  count: number;
  blocking: number;
  items: WorldQuestionFeedItem[];
}

export interface WorldFindingText {
  key: string;
  vars?: Record<string, string>;
}

/** A contradiction, recomputed whole on every open. There is NO findings table: a stored
 *  finding is a second truth that outlives its own correction. */
export interface WorldFinding {
  /** Stable across runs and machines — it is half the mute fingerprint. */
  checkId: string;
  /** Which check produced it, for the filter and the label. */
  family: string;
  severity: 'contradiction' | 'warning' | 'gap';
  /** An i18n KEY plus its variables, never a finished sentence: a headline built by
   *  interpolation is invisible to the i18n collector and would stay in Spanish in the
   *  other six languages. The renderer calls tx(key, vars). */
  headline: WorldFindingText;
  detail: WorldFindingText | null;
  subjects: { kind: string; id: string; title: string; field?: string }[];
  fingerprint: string;
}

export type MuteReasonCode = 'double' | 'told' | 'deliberate' | 'unknown';

export interface WorldNoticeMute {
  fingerprint: string;
  checkId: string;
  scope: 'finding' | 'check';
  subjects: { kind: string; id: string; title: string; field?: string }[];
  headline: string | null;
  reasonCode: MuteReasonCode;
  reason: string | null;
  createdAt: string;
}

export type QuestionStatus = 'open' | 'answered' | 'parked';

export interface WorldQuestionOption {
  optionId: string;
  questionId: string;
  text: string;
  /** What it drags along with it. */
  implications: string | null;
  origin: 'author' | 'ai';
  applyMode: 'none' | 'fill_field' | 'create_article';
  appliedAt: string | null;
  /** What the field said BEFORE. This is the undo. */
  replacedText: string | null;
}

export interface WorldQuestion {
  questionId: string;
  question: string;
  anchorKind: string | null;
  anchorId: string | null;
  anchorTitle: string | null;
  /** Which field of the sheet the answer goes in. Derived from where it was captured. */
  anchorField: string | null;
  status: QuestionStatus;
  origin: 'author' | 'placeholder';
  originKey: string | null;
  /** "I cannot go on without this". A switch, not a priority scale. */
  blocking: boolean;
  chosenOptionId: string | null;
  options: WorldQuestionOption[];
  answeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldQuestionInput {
  question?: string;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorField?: string | null;
  status?: QuestionStatus;
  blocking?: boolean;
}

// ── The encyclopedia (schema v98) ────────────────────────────────────────────
//
// One index over the whole world. `article` is native and editable; every other kind is
// a READ-TIME PROJECTION of a row that lives in its own section, which is why there is no
// index table: a second copy of a character's name would disagree with the first the day
// somebody renamed them. See shared/worldEncyclopedia.ts for the keys and the link syntax.

export type WorldEntryKind = 'article' | 'character' | 'place' | 'group' | 'scene' | 'map' | 'conflict' | 'rule';

/** A kind-qualified address. Ids are unique per table, never across the world, so nothing
 *  anywhere may key an entry by its id alone. */
export interface WorldEntryRef {
  kind: WorldEntryKind;
  id: string;
}

/** `${kind}:${id}`. The React key, the link target, the export anchor and
 *  `world_links.target_key` are all this same string — see `entryKey()`. */
export type WorldEntryKey = string;

/** What lore that hangs off no entity is filed under. */
export type WorldArticleCategory =
  | 'magic' | 'religion' | 'language' | 'creature' | 'species' | 'artifact'
  | 'technology' | 'concept' | 'event' | 'organization' | 'flora' | 'fauna'
  | 'custom' | 'other';

/** One row of the A–Z index. Deliberately without a body: the index loads whole. */
export interface WorldEntry {
  kind: WorldEntryKind;
  id: string;
  key: WorldEntryKey;
  title: string;
  /** Accent-folded, lowercased title — the link resolver's and the A–Z rail's key. */
  titleKey: string;
  /** Other names it answers to: `person_names` for a character, `aka` for an article. */
  aliases: string[];
  summary: string | null;
  /** The taxonomy chip, from the underlying row's own kind column. */
  category: string | null;
  /** Only an article. A projection is browsed here and edited in its own section. */
  editable: boolean;
  /** True when there is nothing written yet — the writer's real question. */
  stub: boolean;
  spoiler: boolean;
  updatedAt: string;
}

/** One edge of the link graph, in either direction. */
export interface WorldEntryLink {
  source: WorldEntryRef;
  sourceTitle: string;
  /** Which text it was written in: body, notes, backstory, history… */
  sourceField: string;
  /** null when the author wrote a `[[…]]` nobody has defined yet. */
  target: WorldEntryRef | null;
  targetTitle: string | null;
  /** The normalised text of an unresolved link; null once it resolves. */
  pendingText: string | null;
  /** The words the author actually wrote. Rendered verbatim — never rewritten by a
   *  rename, because the link belongs to the prose. */
  label: string | null;
  occurrences: number;
}

export interface WorldEntryDetail {
  entry: WorldEntry;
  /** Markdown. For a projection this is COMPOSED from the sheet at read time and never
   *  stored: there is no second copy of a character's backstory. */
  body: string;
  /** The infobox. */
  facts: { label: string; value: string }[];
  links: WorldEntryLink[];
  /** "Mentioned in" — prose references, as opposed to `related`. */
  backlinks: WorldEntryLink[];
  /** What the ontology already knows: affiliations, appearances, kin, containment. */
  related: { ref: WorldEntryRef; title: string; relation: string }[];
  /** Articles only: the quarantined AI draft, if there is one. */
  proposedBody: string | null;
  proposedAt: string | null;
}

/** The native row. */
export interface WorldArticle {
  articleId: string;
  title: string;
  titleKey: string;
  category: WorldArticleCategory;
  summary: string | null;
  body: string | null;
  proposedBody: string | null;
  proposedAt: string | null;
  aka: string | null;
  origin: 'author' | 'ai_proposal';
  spoiler: boolean;
  sortTitle: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldArticleInput {
  title?: string;
  category?: WorldArticleCategory;
  summary?: string | null;
  body?: string | null;
  aka?: string | null;
  spoiler?: boolean;
  sortTitle?: string | null;
  notes?: string | null;
}

/** A full-text hit from the on-demand search (the index search is client-side). */
export interface WorldBodyHit {
  key: WorldEntryKey;
  kind: WorldEntryKind;
  id: string;
  title: string;
  /** Which text matched, already localised for display. */
  field: string;
  snippet: string;
}

/** Something the world talks about but has never defined. */
export interface WorldEntryProposal {
  proposalId: string;
  term: string;
  termKey: string;
  category: WorldArticleCategory | null;
  rationale: string | null;
  suggestedSummary: string | null;
  evidence: { key: WorldEntryKey; title: string; snippet: string }[];
  /** An unresolved `[[…]]` is a fact the author already stated; an n-gram is a guess. */
  source: 'unresolved_link' | 'frequency';
  confidence: number | null;
  status: 'pending' | 'accepted' | 'dismissed';
  articleId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** How an article draft is written — the same two modes, and the same quarantine, as a
 *  character biography, except that BOTH modes are quarantined here: a biography is one
 *  field of a sheet the author is looking at, an article body is the whole entry. */
export type WorldArticleDraftMode = 'draft' | 'expand';

export interface WorldArticleDraftResult {
  body: string | null;
  /** True when the article is too empty to write from — not an error. */
  noMaterial: boolean;
}

export interface WorldBibleOptions {
  format: 'md' | 'pdf';
  kinds?: WorldEntryKind[];
  categories?: string[];
  entryKeys?: WorldEntryKey[];
  order: 'alpha' | 'category';
  includeSpoilers: boolean;
  includeNotes: boolean;
  /** A draft nobody accepted is not canon. */
  includeProposals: boolean;
  title: string;
}

/** Factions, cultures, religions, houses and orders: one entity, several kinds. */
export type WorldGroupKind = 'faction' | 'culture' | 'religion' | 'house' | 'order' | 'species' | 'language';
export type WorldGroupStatus = 'active' | 'extinct' | 'dormant';

export interface WorldGroup {
  groupId: string;
  kind: WorldGroupKind;
  name: string;
  summary: string | null;
  description: string | null;
  /** Same role as a character's: keeps generated images of one group looking alike. */
  visualSeed: string | null;
  accent: string | null;
  status: WorldGroupStatus | null;
  parentId: string | null;
  /** Where it is seated, if anywhere — a `places` row. */
  seatPlaceId: string | null;
  foundedYear: number | null;
  endedYear: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldGroupInput {
  kind?: WorldGroupKind;
  name: string;
  summary?: string | null;
  description?: string | null;
  visualSeed?: string | null;
  accent?: string | null;
  status?: WorldGroupStatus | null;
  parentId?: string | null;
  seatPlaceId?: string | null;
  foundedYear?: number | null;
  endedYear?: number | null;
  notes?: string | null;
}

/** A character's membership of a group, with a rank and a period in world days. */
export interface CharacterAffiliation {
  affiliationId: string;
  personId: string;
  groupId: string;
  groupName: string;
  groupKind: WorldGroupKind;
  /** Resolved for the group sheet's member list, which has no other way to name them. */
  personName: string;
  rank: string | null;
  fromWorldDay: number | null;
  toWorldDay: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterAffiliationInput {
  personId: string;
  groupId: string;
  rank?: string | null;
  fromWorldDay?: number | null;
  toWorldDay?: number | null;
  notes?: string | null;
}

export interface CharacterAbilityInput {
  name: string;
  description?: string | null;
  cost?: string | null;
  limits?: string | null;
  sortOrder?: number;
}

export interface CharacterProfile {
  personId: string;
  species: string | null;
  gender: string | null;
  /** Written verbatim by the author and passed verbatim to the AI. */
  pronouns: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  /** A palette token from CHARACTER_ACCENTS, never a raw hex. */
  accent: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  /** Canonical appearance prompt re-injected into every image generation. */
  visualSeed: string | null;
  /** In-world year; the readable date lives in Person.birthDate / deathDate. */
  birthYearSort: number | null;
  deathYearSort: number | null;
  arc: CharacterArc;
  voice: CharacterVoice;
  /**
   * A biography the AI was allowed to PROPOSE beyond the sheet. Held apart from
   * Person.biography so a proposal is never mistaken for accepted canon: accepting it
   * is what moves it across.
   */
  biographyProposed: string | null;
  biographyProposedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A character: the shared person row joined to its worldbuilding overlay. */
export interface Character extends Person {
  profile: CharacterProfile;
  /** Names of the factions/houses/orders they belong to — what the grid facets by. */
  factions?: string[];
  /** Names of the cultures/species/languages they belong to. */
  cultures?: string[];
}

export interface CharacterInput {
  displayName: string;
  species?: string | null;
  gender?: string | null;
  pronouns?: string | null;
  lifeStatus?: CharacterLifeStatus;
  narrativeRole?: CharacterNarrativeRole | null;
  accent?: string | null;
  appearance?: string | null;
  personality?: string | null;
  backstory?: string | null;
  visualSeed?: string | null;
  /** Free text, exactly as the author writes it in their own calendar. */
  birthDate?: string | null;
  deathDate?: string | null;
  birthYearSort?: number | null;
  deathYearSort?: number | null;
  arc?: Partial<CharacterArc>;
  voice?: Partial<CharacterVoice>;
  notes?: string | null;
  names?: PersonName[];
}

export interface CharacterFilter {
  search?: string;
  role?: CharacterNarrativeRole;
  status?: CharacterLifeStatus;
}

export interface CharacterCounts {
  total: number;
  byRole: Record<string, number>;
  byStatus: Record<string, number>;
}

/**
 * A life event seen from a character sheet: the shared historical event plus its
 * position in the world's own calendar. A wrapper rather than two more fields on
 * HistoricalEvent, so the genealogy timeline never grows a column it cannot use.
 */
export interface CharacterEvent extends HistoricalEvent {
  /** In-world year (may be negative); null when the author has not placed it yet. */
  worldYear: number | null;
  /** Tie-break within the same year. */
  worldOrder: number;
  /** Structured date against the world's calendar (v93); all null without one. */
  eraId: string | null;
  /** 0-based index into the calendar's months. */
  monthIndex: number | null;
  day: number | null;
  /** Derived absolute day; orders events WITHIN a year. */
  worldDay: number | null;
}

export interface Place {
  placeId: string;
  name: string;
  parentId: string | null;
  kind: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  gazetteerId: string | null;
  admin1: string | null;
  country: string | null;
  countryCode: string | null;
}

export interface PlaceInput {
  name: string;
  parentId?: string | null;
  kind?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  /** Stable gazetteer identity (e.g. 'geonames:2520118') when resolved from the picker. */
  gazetteerId?: string | null;
  admin1?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

/** A candidate place returned by the offline gazetteer search (GeoNames-derived). */
export interface GazetteerPlace {
  /** Stable unique id, e.g. 'geonames:2520118'. */
  gazetteerId: string;
  name: string;
  /** State / province / region (admin1). */
  admin1: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population: number;
}

/** A place associated with a person (their per-person place record → their map). */
export interface PersonPlace {
  id: string;
  personId: string;
  placeId: string;
  /** Kind of association: birth | residence | death | other (free text ok). */
  label: string | null;
  date: string | null;
  sortKey: string | null;
  notes: string | null;
  /** Resolved place fields for display/mapping (joined). */
  placeName: string;
  admin1: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PersonPlaceInput {
  personId: string;
  placeId: string;
  label?: string | null;
  date?: string | null;
  notes?: string | null;
}

/**
 * One located point on the map: a person associated with a place that has
 * coordinates. Carries the person's identity/dates for the thumbnail and the place's
 * geography for plotting. The renderer groups points by person (migration routes) and
 * by place (thumbnails), and filters by the chronological slider using `sortKey`.
 */
export interface MapPlacePoint {
  personPlaceId: string;
  personId: string;
  personName: string;
  birthDate: string | null;
  deathDate: string | null;
  hasPortrait: boolean;
  placeId: string;
  placeName: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  label: string | null;
  date: string | null;
  sortKey: string | null;
}

export interface EventParticipant {
  personId: string;
  role: ParticipantRole;
  /** Convenience for display; filled by read queries. */
  displayName?: string;
}

export interface HistoricalEvent {
  eventId: string;
  type: EventTypeValue;
  label: string | null;
  /** Human display form of the date. */
  date: string | null;
  /** Sortable lower-bound key 'YYYY-MM-DD' for the timeline; null if unknown. */
  sortKey: string | null;
  placeId: string | null;
  placeName: string | null;
  notes: string | null;
  participants: EventParticipant[];
}

export interface EventInput {
  type: EventTypeValue;
  label?: string | null;
  date?: string | null;
  placeId?: string | null;
  notes?: string | null;
  participants?: EventParticipant[];
}

export interface RecordEvidence {
  id: string;
  targetKind: RecordEvidenceTargetKind;
  targetId: string;
  nodusId: string | null;
  sourceKind: RecordSourceKind;
  quote: string | null;
  location: string | null;
  confidence: number | null;
  excerptId: string | null;
  evidenceRole: RecordEvidenceRole;
  certainty: number | null;
  reviewStatus: RecordEvidenceReviewStatus;
  sourceVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordEvidenceInput {
  targetKind: RecordEvidenceTargetKind;
  targetId: string;
  nodusId?: string | null;
  sourceKind?: RecordSourceKind;
  quote?: string | null;
  location?: string | null;
  confidence?: number | null;
  excerptId?: string | null;
  evidenceRole?: RecordEvidenceRole;
  certainty?: number | null;
  reviewStatus?: RecordEvidenceReviewStatus;
  sourceVersionId?: string | null;
  createdBy?: string | null;
}

// ── Evidence archive (phase B) ───────────────────────────────────────────────

export type ArchiveItemKind = 'image' | 'csv' | 'xlsx' | 'pdf' | 'text' | 'other';

/** A tree member a document is linked to. */
export interface ArchiveLinkedPerson {
  personId: string;
  displayName: string;
}

export interface ArchiveFolder {
  folderId: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

/** Archive item metadata for lists — never carries the file blob. */
export interface ArchiveItem {
  itemId: string;
  folderId: string | null;
  title: string;
  kind: ArchiveItemKind;
  fileName: string | null;
  mimeType: string | null;
  bytes: number;
  /** Whether a file blob is stored (blobs are fetched separately). */
  hasBlob: boolean;
  extractedText: string | null;
  description: string | null;
  /** Provenance of the document: where it came from — the archive/repository,
   *  a citation, a URL, or how it was obtained. Free text; null when unrecorded. */
  source: string | null;
  contentHash: string | null;
  /** Primary-source document type (from shared/archiveDocTypes), or null. */
  docType: string | null;
  /** Optional type-specific metadata form values. */
  metadata: Record<string, string> | null;
  /** Best-effort year the document concerns, derived from its metadata date field(s). */
  year: number | null;
  /** Tree members this document is linked to. */
  linkedPersons: ArchiveLinkedPerson[];
  tags: string[];
  /** Folder memberships (archive_item_folders). A "Carpeta" multi-select in the UI —
   *  an item may belong to several folders; the option list is the archive_folders. */
  folderIds: string[];
  /** Whether the item's text has been embedded for semantic discovery. */
  hasEmbedding?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** How a document↔person link came to be proposed. */
export type LinkSuggestionReason = 'name' | 'semantic';

/** A proposed link between an archive document and a person (never auto-applied). */
export interface DocumentLinkSuggestion {
  itemId: string;
  title: string;
  docType: string | null;
  reason: LinkSuggestionReason;
  /** 0..1 semantic similarity when reason === 'semantic'. */
  score: number;
  /** The person's name as it appears in the document, when reason === 'name'. */
  snippet: string | null;
}

/** A proposed link between a person and an archive document (person side of the pair). */
export interface PersonLinkSuggestion {
  personId: string;
  displayName: string;
  reason: LinkSuggestionReason;
  score: number;
  snippet: string | null;
}

export interface ArchiveItemInput {
  folderId?: string | null;
  title: string;
  kind?: ArchiveItemKind;
  fileName?: string | null;
  mimeType?: string | null;
  bytes?: number;
  blob?: Uint8Array | null;
  extractedText?: string | null;
  description?: string | null;
  /** Provenance of the document (archive/repository, citation, URL…). */
  source?: string | null;
  contentHash?: string | null;
  docType?: string | null;
  metadata?: Record<string, string> | null;
  tags?: string[];
}

/** Filter + sort options for listArchiveItems ("upload sources" window). Every
 *  category combines with AND; tags/persons support a Notion-style any/all toggle. */
export interface ArchiveListOptions {
  folderId?: string | null;
  /** Filter to items belonging to ANY of these folders (Carpeta multi-select facet). */
  folderIds?: string[];
  search?: string;
  docTypes?: string[];
  kinds?: ArchiveItemKind[];
  tags?: string[];
  tagsMode?: ArchiveMatchMode;
  personIds?: string[];
  personsMode?: ArchiveMatchMode;
  /** Heritage-dimension facets (OR within a dimension, AND across). Keyed by dimension id. */
  facets?: Record<string, string[]>;
  yearFrom?: number | null;
  yearTo?: number | null;
  sort?: ArchiveSortKey;
}

export interface RecordCounts {
  persons: number;
  places: number;
  events: number;
}

export interface ArchiveCounts {
  items: number;
  folders: number;
}

export interface ArchiveTagCount {
  tag: string;
  count: number;
}

export interface ArchiveIngestSummary {
  added: number;
  duplicates: number;
  items: ArchiveItem[];
}

/** Complete draft used by the genealogy Archive's single creation flow. */
export interface ArchiveEntryCreateInput {
  paths?: string[];
  title: string;
  description?: string | null;
  source?: string | null;
  docType?: string | null;
  metadata?: Record<string, string> | null;
  tags?: string[];
  folderIds?: string[];
  personIds?: string[];
  extractedText?: string | null;
}

export interface ZoteroArchiveEntryImportInput extends Omit<ArchiveEntryCreateInput, 'paths'> {
  library: ZoteroLibrary;
  itemKey: string;
  attachmentKey: string;
}

export interface RecordsScanSummary {
  persons: number;
  places: number;
  events: number;
  evidence: number;
  /** Extracted persons linked to an existing record instead of duplicated. */
  linked?: number;
  /** Open kinship suggestions across the vault after the scan. */
  suggestions?: number;
  /** True when the item had no extracted text to scan. */
  noText: boolean;
}

/** Runtime state of the opt-in localhost MCP server. Never includes the bearer token. */
export interface McpServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  error: string | null;
}

// ── Nodus Server, basic mode ───────────────────────────────────────────────
// The advanced mode publishes to somebody else's Docker deployment. Basic mode runs that
// same server on this computer, so the state below describes a process Nodus itself owns:
// whether it is up, how people reach it, and what is keeping the machine awake for it.

export type LocalServerPhase = 'stopped' | 'starting' | 'running' | 'error';

/**
 * How devices reach the local server.
 *
 * There is deliberately no cleartext option. `tailscale` is what Nodus recommends: the
 * traffic is WireGuard-encrypted, the certificate is a real one, and no port is opened on
 * the router. `lan` serves HTTPS with a Nodus-generated certificate to the local network,
 * for people who do not want a second product involved.
 */
export type LocalServerAccess = 'loopback' | 'tailscale' | 'lan';

export interface LocalServerTailscale {
  /** The CLI was found on this machine. Without it nothing else here is meaningful. */
  installed: boolean;
  /** The daemon reports this machine as logged in to a tailnet. */
  connected: boolean;
  /** MagicDNS name of this machine, e.g. `laptop.tail1234.ts.net`. */
  dnsName: string | null;
  /** HTTPS certificates are enabled for the tailnet, so `tailscale serve` can be used. */
  httpsAvailable: boolean;
  /** `tailscale serve` is already forwarding the tailnet HTTPS port to our local port. */
  servingOurPort: boolean;
  /** The public URL devices should open, when serving is configured. */
  url: string | null;
}

export interface LocalServerLan {
  /** Addresses this machine holds on the local network, in the certificate's SAN. */
  addresses: string[];
  /** SHA-256 of the certificate authority, for the user to compare on the other device. */
  caFingerprint: string | null;
  /** Where the exportable CA certificate lives, so a phone can trust it once. */
  caCertPath: string | null;
}

/** Runtime state of the Nodus Server process running on this computer. */
export interface LocalServerStatus {
  phase: LocalServerPhase;
  /** Persisted preference: start the local server when Nodus opens. */
  enabled: boolean;
  port: number;
  access: LocalServerAccess;
  /** Loopback origin the desktop publishes to. Null until the process is up. */
  localUrl: string | null;
  /** What people type on their phone or tablet. Null when only loopback is reachable. */
  shareUrl: string | null;
  /** Web administration sign-in, so the user is never locked out of their own server. */
  adminEmail: string | null;
  tailscale: LocalServerTailscale;
  lan: LocalServerLan;
  /** Last failure, already stripped of anything secret. */
  error: string | null;
}

export type DesktopBridgeDomain =
  | 'corpus'
  | 'writing'
  | 'research-generation'
  | 'testimonies'
  | 'teaching-roster'
  | 'teaching-grades'
  | 'study-recordings'
  | 'primary-source-files'
  | 'prosopography-private';

export interface DesktopBridgePairingSummary {
  id: string;
  deviceId: string;
  deviceName: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  renewedAt?: string;
}

export interface DesktopBridgeStatus {
  running: boolean;
  port: number | null;
  origins: string[];
  certificateFingerprint: string | null;
  pairings: DesktopBridgePairingSummary[];
  relay?: { state: string; origin?: string };
  error: string | null;
}

export interface DesktopBridgeOffer {
  renewalPairingId?: string;
  id: string;
  code: string;
  origins: string[];
  certificateFingerprint: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  expiresAt: string;
  pairingURL: string;
  qrURL?: string;
}

/** Which sleep defences are currently held, and whether the platform can hold them. */
export interface LocalServerPowerStatus {
  /** Idle sleep is blocked. Costs nothing and needs no password. */
  awake: boolean;
  /** System sleep is disabled outright, so a closed lid keeps serving. Needs an administrator. */
  lidOpenServing: boolean;
  /** This platform can disable lid sleep at all. Linux cannot, from inside the app. */
  lidSupported: boolean;
  /** Running on battery. The lid switch refuses to engage here. */
  onBattery: boolean;
  /**
   * The system says sleep is disabled but Nodus did not do it in this run — an earlier
   * session was killed before it could revert. Surfaced so the user can put it back.
   */
  orphaned: boolean;
  error: string | null;
}

export type NodusServerSyncPhase = 'disconnected' | 'idle' | 'checking' | 'syncing' | 'ok' | 'error';

/** Runtime state of the outbound Nodus Server publisher. It never includes its device token. */
export interface NodusServerSyncStatus {
  configured: boolean;
  enabled: boolean;
  autoSync: boolean;
  phase: NodusServerSyncPhase;
  url: string | null;
  spaceId: string | null;
  spaceName: string | null;
  language: AppLanguage;
  lastSyncAt: string | null;
  lastError: string | null;
  lastBytes: number | null;
  /** Human-readable proof that the remote publisher and localhost MCP do not share a listener. */
  transport: 'outbound-https';
}

export interface NodusServerPairResult {
  ok: boolean;
  serverName: string;
  spaceId: string;
  spaceName: string;
  language: AppLanguage;
}

/**
 * One vault's live connection to Nodus Server. A pairing belongs to the vault that
 * created it and keeps publishing in the background regardless of which vault is
 * currently open, so the desktop tracks and surfaces every connection at once — never
 * only the active vault's. Never includes the device token.
 */
export interface NodusServerConnection {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  /** True when this connection's vault is the one currently open in the app. */
  isActiveVault: boolean;
  url: string;
  spaceId: string;
  spaceName: string;
  language: AppLanguage;
  /** The "Publish this vault" switch: paused connections keep their config but stop uploading. */
  enabled: boolean;
  autoSync: boolean;
  includeUserContent: boolean;
  includePassages: boolean;
  includeLibraryDocuments: boolean;
  includeVectors: boolean;
  includePrimarySources: boolean;
  includeTestimonies: boolean;
  phase: NodusServerSyncPhase;
  lastSyncAt: string | null;
  lastError: string | null;
  lastBytes: number | null;
  /** What the last collection from the mutation ledger did; null until one has run. */
  lastInbox: { applied: number; deleted: number; keptLocal: number; refused: number } | null;
}

/**
 * One thing that arrived from another device, and what this desktop did with it.
 *
 * PER VAULT, unlike the phone's outbox, which is deliberately global: an entry belongs to
 * the vault it landed in, and lives in that vault's own database. Switching vaults
 * therefore shows a different Inbox, which is the truth — the mutation was applied to one
 * corpus and to no other.
 */
export interface ServerInboxEntry {
  /** The mutation's id. A retry carries the same one, which is what makes recording idempotent. */
  id: string;
  seq: number;
  spaceId: string | null;
  /** Which DEVICE sent it. The server never attributes a mutation to a person. */
  clientId: string | null;
  table: string;
  /** The row's identity, decoded from the stored JSON. */
  key: unknown[];
  op: 'upsert' | 'delete';
  outcome: 'applied' | 'deleted' | 'kept_local' | 'refused';
  reason: string | null;
  /** The row's own name when it has one, so the panel need not show a raw key. */
  title: string | null;
  entityKind: string | null;
  /** Root item that owns this change. Child annotations from one report/document share it. */
  parentEntityKind: 'deep_research' | 'immersion' | 'library_document' | null;
  parentEntityId: string | null;
  /** Human title captured on arrival, so grouping never has to show an opaque id. */
  parentTitle: string | null;
  schemaVersion: number | null;
  /** When the sending device wrote it. */
  createdAt: string | null;
  /** When this desktop applied it. */
  arrivedAt: string;
  read: boolean;
}

/** Every Nodus Server connection across all vaults, plus what the active vault can pair. */
export interface NodusServerOverview {
  connections: NodusServerConnection[];
  activeVault: { id: string; name: string; type: VaultType; connected: boolean };
  transport: 'outbound-https';
}

export type McpTunnelPhase =
  | 'not_configured'
  | 'stopped'
  | 'installing'
  | 'checking'
  | 'connecting'
  | 'connected'
  | 'error';

export type McpTunnelErrorCode =
  | 'invalid_tunnel_id'
  | 'missing_api_key'
  | 'unsupported_platform'
  | 'download_failed'
  | 'integrity_failed'
  | 'api_key_rejected'
  | 'permission_denied'
  | 'tunnel_not_found'
  | 'network'
  | 'local_server'
  | 'client_stopped'
  | 'unknown';

/** Runtime state of OpenAI's outbound-only Secure MCP Tunnel client. Secrets never cross this boundary. */
export interface McpTunnelStatus {
  configured: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  phase: McpTunnelPhase;
  tunnelId: string | null;
  clientVersion: string | null;
  installProgress: number | null;
  uiUrl: string | null;
  errorCode: McpTunnelErrorCode | null;
  /** Redacted diagnostic detail for support; never contains either API key or bearer token. */
  errorDetail: string | null;
}

export interface McpTunnelConnectInput {
  tunnelId: string;
  /** Optional when replacing/restarting a connection that already has a stored runtime key. */
  apiKey?: string;
}

/** Runtime state of the opt-in localhost copilot HTTPS server (for the Word add-in). */
export interface CopilotServerStatus {
  running: boolean;
  port: number | null;
  /** URL of the add-in task pane (what the Word manifest points at). */
  addinUrl: string | null;
  /** Whether a trusted localhost TLS certificate was found/loaded. */
  certReady: boolean;
  error: string | null;
}

/** Runtime state of the opt-in localhost HTTP server for the "Nodus for Zotero" plugin. */
export interface ZoteroPluginServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  error: string | null;
  protocolVersion?: number;
  clientProtocolVersion?: number | null;
  compatibilityWarning?: string | null;
}

/** Whether Zotero + its profile are detected, and whether Zotero is running now. */
export interface ZoteroInstallInfo {
  profileFound: boolean;
  running: boolean;
  profilePath: string | null;
}

/** Result of installing/updating the Nodus-for-Zotero plugin into the Zotero profile. */
export interface ZoteroInstallResult {
  ok: boolean;
  message: string;
  running: boolean;
  reopened: boolean;
}

/** Result of saving the packaged .xpi to disk for manual installation. */
export interface ZoteroExportResult {
  ok: boolean;
  path: string | null;
  canceled: boolean;
  message?: string;
}

/** Result of saving the packaged Chrome connector for manual installation. */
export interface BrowserConnectorExportResult {
  ok: boolean;
  path: string | null;
  canceled: boolean;
  message?: string;
}

/** Result of installing/updating the local Word add-in manifest from Settings. */
export interface CopilotInstallResult {
  ok: boolean;
  message: string;
  manifestPath: string | null;
}

/** Navigation request emitted by the local Word add-in server into the renderer. */
export interface CopilotOpenIdeaTarget {
  ideaId: string;
  label: string | null;
  /** Word opens ideas, graph nodes, or the Library's installed CSL manager. */
  destination?: 'ideas' | 'graph' | 'library-citation-styles';
}

/** Navigation request emitted by the local Zotero sidebar server. */
export interface ZoteroPluginOpenTarget {
  kind: 'library-reader' | 'work' | 'idea' | 'gap' | string;
  id: string;
}

/** One typed relation between the edited paragraph and a library entity (Word copilot). */
export interface LiveRelation {
  relation: ChapterRelationType;
  targetKind: ChapterRelationTargetKind;
  targetId: string;
  targetLabel: string;
  targetSubtitle: string | null;
  similarity: number;
  confidence: number;
  /** Final affinity score used for ordering and display in the Word copilot. */
  rankScore: number;
  /** Statement/text of the target, so idea cards never render empty. */
  targetStatement: string | null;
  /** Retrieval route that surfaced the target. */
  source: 'semantic' | 'lexical' | 'graph' | 'support';
  rationale: string;
  /** Zotero item key of the underlying work, when resolvable. */
  zoteroKey: string | null;
  /** "Surname, Year" style label for inline insertion. */
  authorYear: string | null;
  /** A precise search string (author + year + title) for Zotero's quick search. */
  searchString: string | null;
  /** Verifiable nodus:// citation for the target. */
  citation: string;
  /** Optional one-line paraphrase to insert. */
  proposedText: string | null;
}

export interface LiveRelationsResult {
  /** False when no embedding provider/key is configured. */
  available: boolean;
  relations: LiveRelation[];
}

export type ExtractStrategy = 'zotero_fulltext' | 'digital' | 'hybrid' | 'scanned' | 'empty';

export interface PdfAnalysis {
  pageCount: number;
  sampledPages: number;
  textPages: number;
  textCoverage: number; // 0..1 ratio of sampled pages with a usable text layer
  avgCharsPerTextPage: number;
  strategy: ExtractStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zotero
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoteroCollection {
  key: string;
  /** Raw Zotero key inside its library. `key` stays globally unique in Nodus. */
  itemKey: string;
  library: ZoteroLibrary;
  name: string;
  parentCollection: string | false;
  itemCount: number; // direct items only (Zotero meta.numItems)
  subCount: number; // number of subcollections (Zotero meta.numCollections)
}

export interface ZoteroLibrary {
  type: 'user' | 'group';
  id: string;
  name: string;
}

/**
 * Outcome of checking Zotero's local API. On failure `message` carries the technical
 * detail (a transport error such as "The operation could not be completed.", or the
 * HTTP status) and `reason` says what the user has to do about it, which the renderer
 * turns into a localized hint. 'forbidden' and 'unreachable' come down to the same
 * fix: Zotero open, and its local API allowed in Advanced settings.
 */
export interface ZoteroPingResult {
  ok: boolean;
  userId?: string;
  version?: number;
  message?: string;
  reason?: 'forbidden' | 'unreachable' | 'http';
}

export interface ZoteroAttachmentInfo {
  key: string;
  itemKey: string;
  library: ZoteroLibrary;
  title: string;
  contentType: string | null;
  linkMode: string | null;
  filename: string | null;
  available: boolean;
  version?: number;
  parentItem?: string | null;
  dateModified?: string | null;
}

/** Rich bibliographic metadata for one work, read live from Zotero for the detail panel. */
export interface WorkMeta {
  itemType: string;
  authors: string[];
  year: number | null;
  container: string | null; // journal / book / proceedings the item appears in
  publisher: string | null;
  pages: string | null; // page range, e.g. "12-34"
  numPages: number | null;
  volume: string | null;
  issue: string | null;
  edition: string | null;
  place: string | null;
  doi: string | null;
  url: string | null;
  language: string | null;
}

export interface ZoteroItem {
  key: string;
  /** Raw Zotero item key inside `library`; `key` is the Nodus-safe identity. */
  itemKey: string;
  library: ZoteroLibrary;
  version: number;
  title: string;
  /** Original Zotero rich-text title; `title` is always safe plain text. */
  titleMarkup?: string | null;
  creators: ZoteroCreator[];
  year: number | null;
  itemType: string;
  doi: string | null;
  abstract: string | null;
  tags: string[];
  collections: string[];
  publisher: string | null;
  publicationTitle: string | null;
  isbn: string | null;
  issn: string | null;
  url: string | null;
  date: string | null;
  language: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  edition: string | null;
  place: string | null;
  rights: string | null;
  extra: string | null;
  /** Primitive Zotero fields not represented by the common Nodus schema. */
  fields: Record<string, string>;
  dateAdded: string | null;
  dateModified: string | null;
}

/** A raw Zotero creator. `creatorType` distinguishes author/editor/translator/… */
export interface ZoteroCreator {
  lastName: string;
  firstName?: string;
  name?: string;
  creatorType?: string;
}

/** Persisted per work (works.creators_json): structured creators kept for building
 *  canonical author identity. `role` is the collapsed Zotero creatorType we care
 *  about for the author layer. */
export interface WorkCreator {
  lastName: string;
  firstName: string;
  name: string | null;
  role: 'author' | 'editor';
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue / pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type QueueKind = 'light' | 'deep' | 'summary' | 'bridge';
export type QueueState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'paused';

export interface QueueItem {
  id: string;
  nodus_id: string;
  title: string;
  kind: QueueKind;
  state: QueueState;
  error: string | null;
  enqueued_at: string;
  /** First dispatch time. Retries keep the original timestamp so this is total wall time. */
  started_at: string | null;
  /** Terminal time; null while queued/running or while a retry is pending. */
  finished_at: string | null;
  /** Sub-step detail for the running item, e.g. "OCR p. 12/340" or "Extrayendo p. 8/22". */
  detail?: string | null;
  /**
   * 0..1 progress through the item's own plan, when the phase in hand can measure it:
   * extraction owns the first half and the analysis the second, so the number only ever
   * advances. Steps with no fraction of their own (the required summary, indexing, the
   * OCR pass over problem pages) leave it null instead of parking the previous value.
   */
  subPct?: number | null;
  /** Optional explicit override; null lets the job resolve its workload setting. */
  model?: ModelRef | null;
  /**
   * When set on a deep job, forces the full chain (summary + index + bridge discovery)
   * to run on completion regardless of the auto-* settings. Used by "Procesar todo".
   */
  chain?: boolean;
  /** Explicit user-confirmed renewal: bypasses currentness/no-op gates while keeping
   * the previous committed analysis visible until replacement succeeds. */
  refresh?: boolean;
  /** Changed works that bound an automatic semantic-maintenance job. Omitted for a manual full pass. */
  scopeNodusIds?: string[];
}

export interface AnalysisRunOptions {
  mode: 'if-stale' | 'refresh';
}

export interface QueueProgress {
  paused: boolean;
  /** When the queue auto-paused on a misconfiguration (no model / invalid key), why. */
  pausedReason: string | null;
  /** Reanudable global graph post-processing failure; never hidden as a completed queue. */
  maintenanceError?: string | null;
  /** Global relation maintenance remains visible until it has really settled. */
  maintenanceRunning: boolean;
  maintenanceDetail: string | null;
  /**
   * When the maintenance pass now in flight started, so the bar can tick a clock while
   * a single model call (which reports no progress of its own) is running. Null when no
   * pass is in flight.
   */
  maintenanceStartedAt?: string | null;
  /**
   * Attempts made for the current maintenance step: 1 the first time, 2 after the user
   * asked for a retry or a new drain resumed a failed one. Reset once it settles.
   */
  maintenanceAttempt?: number;
  /** Wall time for the whole queue task, including required post-processing. */
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  failed: number;
  current: { title: string; kind: QueueKind } | null;
  items: QueueItem[];
}

export interface SyncLogEntry {
  id: number;
  at: string;
  mode: string;
  summary: string;
}

export interface ZoteroSyncOptions {
  /** Update monitored catalog metadata and membership without starting analysis. */
  catalogOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph payloads (renderer consumes these directly)
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string; // global_id (idea) or author_id (author lens)
  label: string;
  type: GraphNodeType;
  /** When the underlying research object entered Nodus; drives graph history playback. */
  createdAt?: string | null;
  statement?: string;
  workCount: number;
  workIds?: string[];
  read: boolean; // true when every linked work has the user's read tag
  themes: string[];
  years: number[];
  authors: string[];
  maxConfidence: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType | string;
  basis: EdgeBasis;
  confidence: number;
  /** User audit verdict. Rejected edges never reach the graph, so only 'confirmed' appears here. */
  verdict?: EdgeFeedbackVerdict;
}

// ── Edge audit feedback ──────────────────────────────────────────────────────
// A user verdict over a derived relation. Keyed by idea pair + relation type
// (not by edges.id) so it survives rescans that recreate edge rows.

export type EdgeFeedbackVerdict = 'rejected' | 'confirmed';

export interface EdgeFeedback {
  from_id: string;
  to_id: string;
  type: string;
  verdict: EdgeFeedbackVerdict;
  note: string;
  created_at: string;
}

/** Feedback row enriched with idea labels for listing in the UI. */
export interface EdgeFeedbackView extends EdgeFeedback {
  from_label: string;
  to_label: string;
}

// ── User-layer sync package (multi-machine) ─────────────────────────────────

export interface SyncTableCounts {
  inserted: number;
  updated: number;
  skipped: number;
}

/** Per-table outcome of merging a sync package. Merges are additive: nothing local is deleted. */
/** Modules a sync package carries. Counts are aggregated per group so the UI can show
 *  that, say, the gradebook travelled — previously whole modules were absent with no
 *  zero anywhere to reveal it. */
export type SyncGroupKey =
  | 'tombstones'
  | 'notes'
  | 'writing'
  | 'searches'
  | 'edgeFeedback'
  | 'curation'
  | 'databases'
  | 'protect'
  | 'study'
  | 'teaching'
  | 'genealogy'
  | 'prosopography'
  | 'worldbuilding'
  | 'research'
  | 'chats'
  | 'content';

export interface SyncConflict {
  table: string;
  /** Why the row could not be applied. Reported rather than aborting the merge. */
  reason: 'constraint' | 'missing-parent' | 'missing-primary-key' | 'no-primary-key';
  rows: number;
  detail: string;
}

/**
 * Why a version was kept instead of being discarded.
 * - `incoming-lost`: the arriving version lost the timestamp comparison.
 * - `local-overwritten`: the arriving version won and replaced local work.
 * - `restored`: a superseded version was promoted back, displacing this one.
 * - `deleted-remotely`: the other machine deleted it, and the deletion was applied here.
 */
export type SupersededOrigin = 'incoming-lost' | 'local-overwritten' | 'restored' | 'deleted-remotely';

export interface SupersededField {
  name: string;
  value: string;
  /** BLOBs are not duplicated; the field records only what was there. */
  omittedBlob: boolean;
}

export interface SupersededEntry {
  id: string;
  tableName: string;
  rowKey: string[];
  origin: SupersededOrigin;
  fields: SupersededField[];
  rowStamp: string | null;
  winnerStamp: string | null;
  packageDate: string | null;
  createdAt: string;
  hasOmittedBlobs: boolean;
}

export interface SupersededRestoreResult {
  ok: boolean;
  message: string;
}

export interface SyncMergeSummary {
  groups: Record<SyncGroupKey, SyncTableCounts>;
  /** Convenience alias for the Nodus Protect group, retained for sync callers. */
  protectCopies: SyncTableCounts;
  /** Rows that could not be applied. Empty when everything merged cleanly. */
  conflicts: SyncConflict[];
  /** Tables in the package this build does not recognise (named, not silently dropped). */
  unknownTables: string[];
  packageSchemaVersion: number;
  localSchemaVersion: number;
  /** Versions this merge discarded and kept, recoverable from Settings → Sync. A merge
   *  that reports 0 here overwrote nothing the user might want back. */
  supersededKept: number;
  /** Rows removed because the other machine deleted them. Each one is recoverable. */
  deletionsApplied: number;
  /** The package predates the tombstone horizon, so deletions it never heard about may
   *  reappear. Worth telling the user rather than letting rows quietly return. */
  predatesTombstoneHorizon: boolean;
  /** How far the sending machine's clock appears to run AHEAD of this one. Non-zero means
   *  that computer wins timestamp comparisons it should not; the losing versions are kept
   *  either way, so this is a prompt to fix the clock, not a data-loss report. */
  clockSkewAheadMs: number;
}

export interface StudyDataOverview {
  schemaVersion: number;
  expectedSchemaVersion: number;
  databaseBytes: number;
  materialBytes: number;
  recordingBytes: number;
  embeddingBytes: number;
  studyRows: number;
  trashRows: number;
  integrityOk: boolean;
  integrityMessages: string[];
  foreignKeyErrors: string[];
  journalMode: string;
  lastCheckedAt: string;
}

export interface StudyDataMaintenanceResult {
  ok: boolean;
  changedRows: number;
  message: string;
}

export type StudyExportFormat = 'markdown' | 'txt' | 'html' | 'docx' | 'pdf' | 'bundle';
export interface StudyExportScope {
  kind: 'workspace' | 'course' | 'subject' | 'topic' | 'folder' | 'document';
  id?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface IdeaDetail {
  themes?: string[];
  idea: Idea;
  occurrences: (IdeaOccurrence & { work: WorkView })[];
  evidence: Evidence[];
}

/** Compact row used by the paginated Ideas list; it deliberately omits graph-wide payloads. */
export interface IdeaListItem {
  id: string;
  label: string;
  type: IdeaType;
  statement: string;
  workCount: number;
  themes: string[];
  maxConfidence: number;
  connectionCount: number;
}

/**
 * The least an idea picker needs: enough to show it and to search it, nothing else.
 * Views that only let the user *choose* an idea used to load the whole ideas graph
 * for this, edges included.
 */
export interface IdeaPickerItem {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
}

export interface IdeaPageRequest {
  offset: number;
  limit: number;
  search?: string;
  type?: IdeaType | '';
  sort: 'label' | 'type' | 'works' | 'connections' | 'confidence';
}

export interface IdeaPage {
  items: IdeaListItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface IdeaConnection {
  edge: GraphEdge;
  node: IdeaListItem;
}

/** One idea anchored to a work, with that idea↔work occurrence's fields. */
export interface IdeaByWork {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  role: 'principal' | 'secondary';
  confidence: number;
  development: string;
}

/** A page of a work's ideas plus the total count, for paginated listing. */
export interface IdeaByWorkPage {
  ideas: IdeaByWork[];
  total: number;
}

export interface EdgeDetail {
  edge: Edge;
  fromLabel: string;
  toLabel: string;
  explanation?: string | null;
  evidence: Evidence[];
  trace?: EdgeTrace | null;
  /** Current audit verdict for this relation, if the user has set one. */
  feedback?: EdgeFeedback | null;
}

export interface EdgeTrace {
  edgeId: string;
  method: 'deep' | 'fusion' | 'bridge' | 'reprocess' | string;
  model: ModelRef | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  similarity: number | null;
  rationale: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debate (contradiction face-off) — a contradicts/refutes edge rendered as two
// opposing positions, each with the works/authors/evidence that back it, plus a
// chronology of the dispute. All derived from existing edges/ideas/works — no
// new persistence is required.
// ─────────────────────────────────────────────────────────────────────────────

export type DebateRelation = 'contradicts' | 'refutes';
/** `leaning` when later `supports` edges favour one side; otherwise `open`. */
export type DebateStatus = 'open' | 'leaning';
export type DebateSideKey = 'A' | 'B';

/** One work that develops a side of a debate, with its anchored evidence. */
export interface DebateWork {
  nodus_id: string;
  title: string;
  zotero_key: string;
  authors: string[];
  year: number | null;
  role: 'principal' | 'secondary';
  /**
   * Empty in list responses. `getDebates()` returns every contradiction in the
   * corpus at once and nothing renders this prose, so shipping it meant tens of
   * megabytes structured-cloned across IPC per call. `getDebate()` fills it.
   */
  development: string;
  evidence: Evidence[];
}

/** One position in a debate: an idea plus the works/authors/evidence backing it. */
export interface DebateSide {
  ideaId: string; // global_id
  type: IdeaType;
  label: string;
  statement: string;
  authors: string[]; // union of authors across backing works (the "bando")
  works: DebateWork[];
  earliestYear: number | null;
  latestYear: number | null;
}

/** One marker on the dispute timeline: a work taking a side in a given year. */
export interface DebateTimelineEntry {
  year: number | null;
  side: DebateSideKey;
  nodus_id: string;
  title: string;
  authors: string[];
}

/** A contradicts/refutes relation rendered as a face-off with chronology. */
export interface Debate {
  id: string; // edge id
  relation: DebateRelation;
  basis: EdgeBasis;
  confidence: number;
  /** Connected-component id grouping debates that share ideas (multi-sided debates). */
  clusterId: string;
  clusterSize: number;
  status: DebateStatus;
  leaningSide: DebateSideKey | null;
  sharedThemes: string[];
  /** True when the same single work develops both sides (internal tension, not a cross-author debate). */
  internal: boolean;
  sideA: DebateSide;
  sideB: DebateSide;
  timeline: DebateTimelineEntry[];
  /** Rule-based, no-AI summary of the tension (always present). */
  tension: string;
  /** Stable localization key and user-content parameters for the rule-based summary. */
  tensionKey?: 'debate.refutes' | 'debate.contradicts';
  tensionParams?: { left: string; right: string };
  trace?: EdgeTrace | null;
}

/** Optional, user-triggered AI synthesis of a single debate. */
export interface DebateAnalysisRequest {
  debateId: string;
  model?: ModelRef | null;
}
export interface DebateAnalysisStreamHandlers {
  onDelta(delta: string): void;
  /** Reasoning/thinking trace, streamed for live display only. */
  onReasoning?(delta: string): void;
}
export interface DebateAnalysisResponse {
  analysis: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Research coverage map (question-driven research) — decompose a thesis question
// into sub-questions and map which the local corpus answers, partially answers,
// leaves uncovered, or only covers with internal disputes. Persisted artifact.
// ─────────────────────────────────────────────────────────────────────────────

export type RqStatus = 'draft' | 'decomposed' | 'mapped';
export type RqCoverageStatus = 'covered' | 'partial' | 'uncovered' | 'disputed';
export type RqLinkKind = 'idea' | 'work' | 'gap' | 'debate';

export interface ResearchQuestion {
  id: string;
  question: string;
  notes: string | null;
  model: ModelRef | null;
  status: RqStatus;
  /** Corpus size snapshot at the last mapping — used to flag stale coverage. */
  corpusIdeas: number;
  corpusWorks: number;
  createdAt: string;
  updatedAt: string;
  mappedAt: string | null;
}

export interface RqCoverageLink {
  id: string;
  kind: RqLinkKind;
  refId: string;
  label: string;
  score: number | null;
  /** For idea/work links: whether the backing work(s) have been deep-read (priority #2). */
  readState: 'read' | 'unread' | null;
}

export interface RqSubQuestion {
  id: string;
  text: string;
  rationale: string | null;
  orderIdx: number;
  coverageStatus: RqCoverageStatus | null;
  justification: string | null;
  links: RqCoverageLink[];
}

export interface ResearchCoverageSummary {
  covered: number;
  partial: number;
  uncovered: number;
  disputed: number;
  unmapped: number;
}

export interface ResearchQuestionDetail {
  rq: ResearchQuestion;
  subQuestions: RqSubQuestion[];
  /** True when the corpus grew since the last mapping (freshness hint). */
  stale: boolean;
  summary: ResearchCoverageSummary;
}

export interface RqDecomposeRequest {
  rqId: string;
  model?: ModelRef | null;
}
export interface RqMapRequest {
  rqId: string;
  model?: ModelRef | null;
}
export interface RqSubQuestionInput {
  id?: string;
  text: string;
  rationale?: string | null;
}
export interface RqUpdateSubQuestionsRequest {
  rqId: string;
  subQuestions: RqSubQuestionInput[];
}
export interface RqExportRequest {
  rqId: string;
}
export interface RqMapProgress {
  index: number;
  total: number;
  phase: 'retrieving' | 'classifying' | 'done';
  subQuestion: string;
}
export interface RqMapHandlers {
  onProgress?(progress: RqMapProgress): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hypothesis lab — turns gaps, debates and supporting ideas into testable,
// evidence-backed research hypotheses. Not persisted as its own table: users can
// save a generated dossier into Notes, where nodus:// citations remain clickable.
// ─────────────────────────────────────────────────────────────────────────────

export type HypothesisLabMode = 'exploratory' | 'causal' | 'comparative' | 'methodological' | 'intervention';
export type HypothesisMaturity = 'seed' | 'promising' | 'testable' | 'ready';
export type HypothesisEvidenceKind = 'gap' | 'idea' | 'debate' | 'work' | 'passage' | 'project';
export type HypothesisEvidenceRole = 'gap' | 'support' | 'contrast' | 'method' | 'scope' | 'source';

export interface HypothesisLabRequest {
  objective: string;
  mode: HypothesisLabMode;
  projectId?: string | null;
  language?: PromptLanguage;
  maxCandidates?: number;
  model?: ModelRef | null;
}

export interface HypothesisEvidenceLink {
  kind: HypothesisEvidenceKind;
  role: HypothesisEvidenceRole;
  refId: string;
  label: string;
  citation: string;
  quote?: string | null;
  score?: number | null;
}

export interface HypothesisVariable {
  name: string;
  role: 'phenomenon' | 'context' | 'condition' | 'mechanism' | 'outcome' | 'case' | 'method';
  description: string;
}

export interface HypothesisCandidate {
  id: string;
  title: string;
  hypothesis: string;
  rationale: string;
  maturity: HypothesisMaturity;
  score: number;
  novelty: number;
  support: number;
  testability: number;
  risk: number;
  variables: HypothesisVariable[];
  evidence: HypothesisEvidenceLink[];
  methods: string[];
  predictions: string[];
  counterArguments: string[];
  nextSteps: string[];
  searchQueries: string[];
  draftAbstract: string;
}

export interface HypothesisLabStats {
  works: number;
  ideas: number;
  gaps: number;
  debates: number;
  passages: number;
  projectLinked: boolean;
  aiRefined: boolean;
  contextChars: number;
}

export interface HypothesisLabResult {
  generatedAt: string;
  request: HypothesisLabRequest;
  stats: HypothesisLabStats;
  candidates: HypothesisCandidate[];
  warnings: string[];
}

export interface GapAggregate {
  kind: GapKind;
  statement: string;
  count: number;
  works: { nodus_id: string; title: string; zotero_key: string }[];
  /** Individual records behind this normalized aggregate; use one with `nodus_get_gap`. */
  gapIds: string[];
}

export interface GapPage {
  items: GapAggregate[];
  total: number;
  offset: number;
  limit: number;
}

export interface GapDetail {
  gap: Gap;
  work: {
    nodus_id: string;
    title: string;
    zotero_key: string;
    authors: string[];
    year: number | null;
    item_type: string;
  };
  relatedIdea: Pick<Idea, 'global_id' | 'type' | 'label' | 'statement'> | null;
  evidence: Evidence | null;
}

export type ReadingPathStrategy =
  | 'research_relevance'
  | 'gaps'
  | 'foundational'
  | 'recent'
  | 'connected_authors'
  | 'bridges';

export interface ReadingPathRequest {
  strategy?: ReadingPathStrategy;
  researchBrief?: string;
  limit?: number;
  includeRead?: boolean;
}

export interface ReadingAnalysisStatus {
  lightStatus: LightStatus;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  hasThemes: boolean;
  hasIdeas: boolean;
  hasContradictions: boolean;
  hasGaps: boolean;
  hasExternalRefs: boolean;
  themeCount: number;
  ideaCount: number;
  relationCount: number;
  contradictionCount: number;
  gapCount: number;
  externalRefCount: number;
}

export interface ReadingPathEntry {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  themes: string[];
  /** Orientation only; it must not be treated as evidence or a citation. */
  orientationSummary: string | null;
  readTag: boolean;
  read: boolean;
  analysis: ReadingAnalysisStatus;
  score: number;
  priority: number;
  phase: string;
  strategyScore: number;
  gapScore: number;
  foundationalScore: number;
  recencyScore: number;
  authorConnectivityScore: number;
  bridgeScore: number;
  interestScore: number;
  diversityKey: string | null;
  relatedGaps: string[];
  relatedIdeas: string[];
  connectedAuthors: string[];
  citedBy: number;
  reason: string;
  /** Stable server projection key; `reason` remains for older clients. */
  reasonKey?: string;
  reasonParams?: Record<string, string | number | string[]>;
}

export interface ReadingPathPhase {
  id: string;
  title: string;
  objective: string;
  /** Stable server projection keys; legacy prose fields remain for old clients. */
  titleKey?: string;
  objectiveKey?: string;
  entries: ReadingPathEntry[];
  totalCandidates: number;
  omitted: number;
}

export interface ReadingPathPlan {
  strategy: ReadingPathStrategy;
  researchBrief: string;
  generatedAt: string;
  totalWorks: number;
  shownWorks: number;
  readCount: number;
  unreadCount: number;
  analyzedCount: number;
  pendingAnalysisCount: number;
  summary: string;
  summaryKey?: string;
  summaryParams?: Record<string, string | number | string[]>;
  phases: ReadingPathPhase[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Research assistant
// ─────────────────────────────────────────────────────────────────────────────

export interface ResearchGraphPartsSelection {
  ideaNodes: boolean;
  themeNodes: boolean;
  ideaEdges: boolean;
  authorGraph: boolean;
}

/**
 * What a Research Chat turn may consult, as the context balloon offers it: the ideas
 * layer (ideas, themes, contradictions, gaps, reading paths, authors and the graph) and
 * the documents layer (the works' text, read from the Nodus library or Zotero, and their
 * profiles). The web step has its own setting. All off: the answer comes from general
 * knowledge and says so.
 */
export interface ResearchContextLayers {
  ideas: boolean;
  documents: boolean;
}

export interface ResearchContextSelection {
  notebookId?: string | null;
  /** The layers chosen in the context balloon. Absent in selections saved before it
   * existed, which keep reading the sections below as they always did. */
  layers?: ResearchContextLayers;
  retrieval?: import('./researchCorpus').RetrievalSettings;
  sourceFilter?: import('./researchContextFilters').ResearchSourceFilter;
  ideas: boolean;
  themes: boolean;
  contradictions: boolean;
  gaps: boolean;
  readingPath: boolean;
  authors: boolean;
  documents: boolean;
  /** Fine-grained full-text evidence retrieved from the local passage index. */
  passages: boolean;
  graph: boolean;
  graphParts: ResearchGraphPartsSelection;
}

export interface ResearchChatMessage {
  attachments?: import('./researchAttachments').ResearchAttachment[];
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchChatRequest {
  concilium?: import('./researchConcilium').ConciliumConfig;
  attachmentIds?: string[];
  /** Optional vault-local preference; null/absence keeps the original application prompt. */
  systemPromptId?: string | null;
  conversationId?: string;
  /** Isolated from Nodi and global chat defaults. Absence means standard. */
  thinkingEffort?: import('./researchReasoning').ResearchEffort;
  messages: ResearchChatMessage[];
  selection: ResearchContextSelection;
  model?: ModelRef | null;
  /** Skills invoked with @ for this turn only; applied even when switched off for the chat. */
  skillIds?: string[];
  /** Research Chat's web step. Absent means automatic; 'off' never leaves the machine. */
  webSearch?: ResearchWebSearchMode;
}

export type ResearchWebSearchMode = 'auto' | 'off';
/** What the web step did in one turn, persisted with the answer. */
export interface ResearchWebSearchStats {
  mode: ResearchWebSearchMode;
  searched: boolean;
  trigger?: 'supervisor' | 'explicit' | 'fallback';
  queries: Array<{ query: string; category: 'general' | 'science'; round: number; results: number; failed?: boolean }>;
  rounds: number;
  found: number;
  consulted: Array<{ url: string; title: string; domain: string; outcome: import('./researchActivity').ResearchWebPageOutcome; passages: number }>;
  limitations: string[];
  durationMs: number;
}
/** A web page whose passages reached the model, with the citations that point at it. */
export interface ResearchWebSource {
  url: string;
  title: string;
  siteName: string | null;
  domain: string;
  retrievedAt: string;
  publishedAt: string | null;
  passageIds: string[];
}

export interface ResearchContextStats {
  researchTraversal?: import('./researchCorpus').ResearchTraversal;
  webSearch?: ResearchWebSearchStats;
  webSources?: ResearchWebSource[];
  sections: string[];
  works: number;
  documents: number;
  summaries: number;
  passages: number;
  contextChars: number;
  truncated: boolean;
}

export interface ResearchChatResponse {
  concilium?: import('./researchConcilium').ConciliumResult;
  answer: string;
  stats: ResearchContextStats;
  /** The user stopped the stream: `answer` is the partial text that had already arrived. */
  aborted?: boolean;
}

export interface ResearchChatStreamHandlers {
  onActivity?(activity: import('./researchActivity').ResearchActivity): void;
  onConcilium?(result: import('./researchConcilium').ConciliumResult): void;
  onDelta(delta: string): void;
  /** The whole answer so far, replacing what has streamed: the application's interim repaints
   *  (the target drawing, then the route report) while slower checks still run. */
  onReplace?(text: string): void;
  /** Reasoning/thinking trace, streamed for live display only. */
  onReasoning?(delta: string): void;
  onStats?(stats: ResearchContextStats): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutor mode — AI-guided, step-by-step walkthrough of the idea graph
// ─────────────────────────────────────────────────────────────────────────────

export type TutorMode = 'overview' | 'prompt';

/** What a tour stop is anchored to in the graph. */
export type TutorStopKind = 'theme' | 'idea' | 'connection';

export interface TutorStop {
  id: string;
  kind: TutorStopKind;
  title: string;
  /** One line: why we pause here / what to notice. */
  focus: string;
  /** Graph node ids to spotlight: an idea `global_id` or `theme:<id>`. A connection lists both endpoints. */
  nodeIds: string[];
  /** Edge id when the stop is a connection between two ideas. */
  edgeId: string | null;
}

export interface TutorRoute {
  id: string;
  title: string;
  description: string;
  /** 1..5 — relative weight/centrality of this route in the corpus. */
  weight: number;
  /** Short human label for the weight, e.g. "línea principal". */
  weightLabel: string;
  themes: string[];
  stops: TutorStop[];
}

export interface TutorPlan {
  generatedAt: string;
  mode: TutorMode;
  prompt: string;
  /** Map-level welcome that mentions everything important before the routes. */
  overview: string;
  totalThemes: number;
  totalIdeas: number;
  totalConnections: number;
  /** Distinct idea nodes referenced by at least one route stop. */
  coveredIdeas: number;
  routes: TutorRoute[];
  /** True when the graph was too large to send whole (some nodes/edges omitted). */
  truncated: boolean;
}

export interface TutorSavedRoute {
  id: string;
  planId: string;
  generatedAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  mode: TutorMode;
  prompt: string;
  model: ModelRef | null;
  overview: string;
  totalThemes: number;
  totalIdeas: number;
  totalConnections: number;
  route: TutorRoute;
  rating: number | null;
}

export interface TutorPlanRequest {
  mode: TutorMode;
  prompt?: string;
  model?: ModelRef | null;
  language?: PromptLanguage;
}

export interface TutorStepRequest {
  /** The route being toured (sent on each call so the backend stays stateless). */
  route: TutorRoute;
  stopIndex: number;
  overview: string;
  /** Titles of stops already visited, for narrative continuity. */
  history: string[];
  /** Tail of the immediately previous stop's narration, so the discourse continues without repeating. */
  previousText?: string;
  model?: ModelRef | null;
  language?: PromptLanguage;
}

export interface TutorStepResponse {
  explanation: string;
}

export interface TutorStepStreamHandlers {
  onDelta(delta: string): void;
  /** Reasoning/thinking trace, streamed for live display only. */
  onReasoning?(delta: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument map (AI-traced hierarchical block outline around a seed idea)
// ─────────────────────────────────────────────────────────────────────────────

/** One block in the argument map tree. Synthetic ids are assigned by the backend. */
export interface ArgumentBlock {
  id: string;
  /** global_id of the underlying idea, or null for a synthetic framing block. */
  ideaId: string | null;
  label: string;
  statement: string;
  type: IdeaType | 'framing';
  /** One-line gloss from the model explaining this block's role. */
  summary: string;
  /** How this block relates to its parent (a real edge type, or 'root'/'framing'). */
  relation: EdgeType | 'root' | 'framing' | 'related';
  children: ArgumentBlock[];
  /** Connections this idea has in the graph that the map did not draw as branches,
   *  so a trimmed hub says so instead of passing for a fully explored one. */
  hiddenChildren?: number;
}

export interface ArgumentMap {
  seedIdeaId: string;
  seedLabel: string;
  overview: string;
  root: ArgumentBlock;
  generatedAt: string;
  /** True when the local subgraph sent to the model was capped. */
  truncated: boolean;
  ideaCount: number;
}

export interface ArgumentMapRequest {
  seedIdeaId: string;
  model?: ModelRef | null;
  language?: PromptLanguage;
  /** 'ai' traces the tree with the model; 'auto' builds it structurally from the
   *  real graph edges (no model needed). Defaults to 'ai'. */
  mode?: 'ai' | 'auto';
}

/** A ranked seed candidate for the automatic argument-map mode. */
export interface ArgumentRouteSuggestion {
  ideaId: string;
  label: string;
  statement: string;
  type: IdeaType;
  /** Number of idea↔idea connections. */
  degree: number;
  /** Connections that are contradictions or refutations (debate hubs surface higher). */
  debateCount: number;
  /** Average confidence across the idea's connections. */
  avgConfidence: number;
  /** Relation-type breakdown, most frequent first. */
  topRelations: { type: EdgeType; count: number }[];
  /** Up to a few neighbour labels, for a quick preview of the route. */
  neighborLabels: string[];
}


// ─────────────────────────────────────────────────────────────────────────────
// Research chat history (persisted conversations)
// ─────────────────────────────────────────────────────────────────────────────

/** One persisted chat message. `stats`/`selectionKey`/`error` mirror the in-memory UI message. */
export interface ChatMessageRecord {
  concilium?: import('./researchConcilium').ConciliumResult;
  attachments?: import('./researchAttachments').ResearchAttachment[];
  id: string;
  role: 'user' | 'assistant';
  content: string;
  selectionKey?: string | null;
  stats?: ResearchContextStats | null;
  error?: boolean;
  /** Skills the user invoked with @ for this message (name kept for display). */
  skills?: { id: string; name: string }[];
}

/** Conversation list entry (no messages) for the history sidebar. */
export interface ChatConversationSummary {
  notebookId?: string | null;
  /** Research chat project holding this conversation, if any. */
  projectId?: string | null;
  /** Folder inside that project; always one of the project's own folders, or null. */
  folderId?: string | null;
  /** Set while the conversation is one of the (at most five) pinned chats. */
  pinnedAt?: string | null;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  model: ModelRef | null;
  messageCount: number;
}

/** A research chat project: a named, iconed group of conversations. */
export interface ResearchChatProject {
  /** Shared preferences inherited by every conversation currently in this project. */
  instructions?: string;
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A folder inside a research chat project. Folders nest; projects do not. */
export interface ResearchChatProjectFolder {
  id: string;
  projectId: string;
  /** Null at the project's root. */
  parentId: string | null;
  name: string;
  /** Order among its siblings. */
  position: number;
  createdAt: string;
}

/** How many conversations may be pinned at once. */
export const RESEARCH_CHAT_PIN_LIMIT = 5;

/**
 * A notebook a chat history keeps of its own (Databases, Worldbuilding): a named, iconed
 * set of sources its chats read. `selection` is what the surface's context picker stores —
 * database ids, or a Worldbuilding selection. Research Chat's notebooks live in the
 * research corpus instead, and Study reuses its courses.
 */
export interface ChatHistoryNotebook {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  selection: unknown;
  createdAt: string;
  updatedAt: string;
}

/** The chat histories organized through the shared chat-history channels (Research Chat
 * keeps its own). Study also serves the Teaching vault: same store, that vault's file. */
export type ChatHistorySurface = 'database' | 'world' | 'study';
/** The surfaces whose history keeps notebooks of its own. */
export type ChatHistoryNotebookSurface = 'database' | 'world';

/** Where a conversation of a chat history sits, beside its own fields. */
export interface ChatHistoryPlacementFields {
  archived?: boolean;
  projectId?: string | null;
  /** Always a folder of `projectId`, or null. */
  folderId?: string | null;
  pinnedAt?: string | null;
  notebookId?: string | null;
}

/** A full conversation with its messages and the context selection it was using. */
export interface ChatConversation extends ChatConversationSummary {
  selection: ResearchContextSelection | null;
  messages: ChatMessageRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes (user-structured workspace: folders/subfolders + markdown/AI notes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a note's content came from. `markdown` is a hand-written note; the others
 * carry content captured from another surface (assistant answer, writing workshop
 * draft, debate synthesis, or a single idea) whose Markdown keeps `nodus://`
 * citations so they stay clickable inside the notes editor.
 */
export type NoteKind = 'markdown' | 'assistant' | 'writing' | 'debate' | 'idea' | 'hypothesis';

/** Optional provenance metadata kept alongside a captured note (model, source ids…). */
export interface NoteResearchReference {
  /** Citation token used inside the saved Markdown (for example `S1`). */
  citationId?: string | null;
  label: string;
  subtitle?: string | null;
  quote?: string | null;
  /** A safe external URL or a durable `nodus://` deep link. */
  href?: string | null;
}

export interface NoteResearchChatSource {
  surface: import('./researchAttachments').ResearchAttachmentSurface;
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  /** Stable fallback for transports that reconstruct message ids when loading. */
  messageIndex?: number | null;
  references: NoteResearchReference[];
}

export interface NoteSource {
  origin: NoteKind;
  model?: ModelRef | null;
  /** Free-form references back to the originating object (idea id, draft title…). */
  ref?: string | null;
  note?: string | null;
  /** Structured origin for answers captured from any Research chat surface. */
  researchChat?: NoteResearchChatSource | null;
}

export interface NoteFolder {
  id: string;
  parentId: string | null;
  name: string;
  /** Free-text brief: the ideas this folder is meant to hold. Drives AI idea suggestions. */
  summary: string;
  orderIdx: number;
  /**
   * Where a migrated collection came from (`project:<id>`, or `writing` for the saved
   * Escritura documents). Null for anything the user made. It is what keeps the
   * Workspace migration idempotent, and it is shown as provenance in the UI.
   */
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  editorRevision?: number;
  id: string;
  folderId: string | null;
  title: string;
  kind: NoteKind;
  content: string;
  /** User-managed labels shared by notes and ideas in the Workspace catalogue. */
  tags: string[];
  /** Soft-deletion marker. Null means the item belongs to the live Workspace. */
  trashedAt: string | null;
  source: NoteSource | null;
  orderIdx: number;
  createdAt: string;
  updatedAt: string;
}

/** Whole notes workspace in one payload so the view can build the tree client-side. */
export interface NotesTree {
  folders: NoteFolder[];
  notes: Note[];
}

export interface CreateNoteFolderInput {
  name: string;
  parentId?: string | null;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  kind?: NoteKind;
  folderId?: string | null;
  tags?: string[];
  source?: NoteSource | null;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  folderId?: string | null;
  tags?: string[];
}

export interface NoteTagPatch {
  add?: string[];
  remove?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace ↔ biblioteca. Una nota, una idea o una colección puede apuntar a
// varios elementos de la biblioteca del usuario, y un elemento puede estar citado
// desde muchas. El enlace guarda también el ámbito porque el mismo identificador
// puede existir en la biblioteca global y en la de la bóveda.
// ─────────────────────────────────────────────────────────────────────────────

export type WorkspaceLinkOwnerKind = 'note' | 'collection';

export interface WorkspaceLibraryLink {
  ownerKind: WorkspaceLinkOwnerKind;
  ownerId: string;
  libraryItemId: string;
  scope: 'global' | 'vault';
  /** Título con el que se guardó, para poder mostrar un enlace roto con su nombre. */
  label: string | null;
  createdAt: string;
}

export interface WorkspaceLibraryLinkInput {
  ownerKind: WorkspaceLinkOwnerKind;
  ownerId: string;
  libraryItemId: string;
  scope?: 'global' | 'vault';
  label?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual ideas — user-authored ideas that live in the graph, owned by a note.
// The note's `source.note` carries MANUAL_IDEA_MARKER and `source.ref` the idea
// id, so deleting the note also purges the idea and its indexing.
// ─────────────────────────────────────────────────────────────────────────────

export const MANUAL_IDEA_MARKER = 'manual-idea';

/** A work the manual idea is developed in, plus the user's note on how. */
export interface ManualIdeaWorkLink {
  nodusId: string;
  development: string;
}

/** An anchored quote, optionally tied to one of the linked works. */
export interface ManualIdeaEvidence {
  nodusId: string | null;
  quote: string;
  location: string | null;
}

/** A connection from this idea to another idea (manual or accepted suggestion). */
export interface ManualIdeaConnection {
  /** Incoming connections are displayed but owned by their source idea. */
  incoming?: boolean;
  toId: string;
  toLabel: string;
  type: EdgeType;
  confidence: number;
  /** 'inferred' when accepted from the auto-index search, 'explicit' when hand-added. */
  basis: EdgeBasis;
}

export interface ManualIdeaPayload {
  themes?: string[];
  /** Edit links without overwriting a concurrently autosaved document. */
  linksOnly?: boolean;
  globalId: string;
  noteId: string;
  title: string;
  summary: string;
  works: ManualIdeaWorkLink[];
  evidence: ManualIdeaEvidence[];
  connections: ManualIdeaConnection[];
}

/** A candidate idea returned by the connection search or the auto-index suggestions. */
export interface IdeaCandidate {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  similarity?: number;
}

export interface AutoIndexResult {
  indexed: boolean;
  /** Null when no embedding provider is configured / embedding failed. */
  message: string | null;
  suggestions: IdeaCandidate[];
}

/** How a work's bibliography is rendered in a notes export. */
export type NotesExportBibliography = 'full' | 'zotero' | 'none';

/** Granular options for the structured notes export. */
export interface NotesExportOptions {
  format: 'markdown' | 'json';
  /** Root of the export: a folder id (its whole subtree) or null for every note. */
  folderId: string | null;
  /** Include each note's raw Markdown body. */
  includeContent: boolean;
  /** Include anchored evidence for idea notes. */
  includeEvidence: boolean;
  /** Include the connections of idea notes. */
  includeRelations: boolean;
  /** Per-work bibliography detail: full citation, Zotero item key only, or nothing. */
  bibliography: NotesExportBibliography;
}

/** Result of an AI logical reorder of the notes in one scope. */
export interface NotesReorderResult {
  orderedIds: string[];
}

/**
 * One idea Nodus proposes integrating into a folder, with the AI's justification.
 * Produced by matching the folder's summary against the whole idea base.
 */
export interface FolderIdeaSuggestion {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  /** Semantic cosine similarity to the folder summary (null when surfaced only via a graph edge). */
  similarity: number | null;
  /** True when the idea was reached by expanding a conceptual connection rather than direct similarity. */
  viaConnection: boolean;
  /** The AI's short reason for why this idea belongs in the folder. */
  reason: string;
  /** The AI's 0..1 fit score, used to order the list. */
  score: number;
}

/** Result of analysing every available idea against a folder's summary. */
export interface FolderIdeaSuggestionsResult {
  ok: boolean;
  /** Null on success; a human-readable explanation when no suggestions could be produced. */
  message: string | null;
  suggestions: FolderIdeaSuggestion[];
  /** Ideas already present in the folder subtree, excluded from the analysis. */
  excludedCount: number;
  /** Candidate ideas considered before the AI curation step. */
  consideredCount: number;
}

/** The kinds of sources an inline `nodus://` citation can point to. */
export type CitationKind = 'idea' | 'work' | 'gap' | 'contradiction' | 'passage';

/** A single inline citation to verify against the local graph/corpus. */
export interface CitationRef {
  kind: CitationKind;
  id: string;
}

/**
 * Lightweight preview of a cited source, shown in the hover-card that appears
 * over an inline citation before the user commits to opening the full source
 * modal. All strings come straight from the corpus (already Spanish); the
 * caller adds the localized kind label.
 */
export interface CitationPreview {
  kind: CitationKind;
  title: string;
  subtitle?: string;
  snippet?: string;
  /** Set for web evidence: the page the passage was read from. */
  url?: string;
  /** Link that lands on the quoted passage (text fragment or PDF page). */
  openUrl?: string;
}

export interface WebPassageSource {
  url: string;
  finalUrl: string;
  siteName: string | null;
  domain: string;
  retrievedAt: string;
  publishedAt: string | null;
  doi: string | null;
  kind: 'html' | 'pdf';
}

// ─────────────────────────────────────────────────────────────────────────────
// Global search
// ─────────────────────────────────────────────────────────────────────────────

/** The entity types the global search spans, each of which links elsewhere. */
export type SearchResultKind =
  | 'note'
  | 'idea'
  | 'work'
  | 'gap'
  | 'theme'
  | 'author'
  | 'passage'
  // Records/genealogy kinds — only ever populated in primary-source & genealogy vaults.
  | 'person'
  | 'event'
  | 'archive';

/** A single match. `id` and the optional fields carry what the UI needs to route
 * to the right destination (graph node, work, note, gaps view, …). */
export interface GlobalSearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle?: string | null;
  snippet?: string | null;
  /** Works/passages: to open in Zotero / focus the reading graph. */
  zoteroKey?: string | null;
  /** Passages: the work this passage belongs to, to route into its reading graph. */
  nodusId?: string | null;
  /** Passages: page label for the citation chip. */
  pageLabel?: string | null;
  /** Ideas only: node type, for the badge. */
  ideaType?: string | null;
  /** Gaps only: gap kind, for the badge. */
  gapKind?: GapKind | null;
  /** Themes only: the theme label used as a graph filter. */
  themeLabel?: string | null;
  /** Unified relevance used to order literal and semantic matches together. */
  relevance?: number;
  /** Semantic results only: cosine similarity in [0,1]. */
  similarity?: number | null;
}

/** Common, type-adaptive detail payload used by the global-search modal. */
export interface SearchResultDetail {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  metadata: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; content: string }>;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
}

/** Which retrieval strategy the search box uses. */
export type SearchMode = 'text' | 'semantic' | 'hybrid';

export interface SemanticSearchOptions {
  /** Which result kinds to include. Empty/undefined ⇒ ideas, passages and works. */
  kinds?: SearchResultKind[];
  /** Max results per kind. */
  limit?: number;
  /** Minimum cosine similarity to keep a match. */
  minSimilarity?: number;
}

export interface SemanticSearchResponse {
  /** False when no embedding provider/key is configured, so nothing could be embedded. */
  available: boolean;
  results: GlobalSearchResult[];
}

/** A reusable search the user pinned: query + mode + kind filters. */
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  mode: SearchMode;
  kinds: SearchResultKind[];
  created_at: string;
}

export interface SaveSearchInput {
  name: string;
  query: string;
  mode: SearchMode;
  kinds: SearchResultKind[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus health (Home dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export interface CorpusHealthWork {
  nodus_id: string;
  title: string;
  year: number | null;
  zotero_key: string | null;
}

/** One health dimension: how many works fall in it plus a small clickable sample. */
export interface CorpusHealthBucket {
  count: number;
  sample: CorpusHealthWork[];
}

/** The work-level corpus-health buckets that can be replayed as a Library filter. */
export type CorpusHealthBucketId = 'withoutText' | 'lightOnly' | 'deepPriority' | 'pdfsToRecover';

/**
 * How far along a work is, as one readable value. Derived in the renderer by
 * `deriveWorkStatus` and, for filtering, reproduced in SQL by
 * `electron/db/readinessFilters.ts` — the two must stay in step.
 */
export type WorkReadiness =
  | 'unstarted'
  /** Accepted by the queue but not executing yet. Filterable from persisted markers. */
  | 'pending'
  /** Being processed right now. Live-queue only: never a SQL filter. */
  | 'running'
  | 'failed'
  /** Text extraction was attempted and there was nothing usable to read. */
  | 'noText'
  /**
   * Analysed, but only the abstract was available. Its ideas are real and
   * usable; only its citable passages can never exist. Kept apart from `noText`
   * because calling a work with extracted ideas "no text" understates it, and
   * calling it "ready" overstates it.
   */
  | 'abstractOnly'
  | 'incomplete'
  | 'ready';

export interface CorpusHealth {
  totalWorks: number;
  /** Works with no usable full text (abstract-only, no source, or extraction skipped). */
  withoutText: CorpusHealthBucket;
  /** Works analysed only lightly (themes done) but never deep-analysed, although text exists. */
  lightOnly: CorpusHealthBucket;
  /** Works flagged as important (read tag or manual) still missing deep analysis. */
  deepPriority: CorpusHealthBucket;
  /** Works whose text could not be extracted but a recovery path (OCR / DOI) exists. */
  pdfsToRecover: CorpusHealthBucket;
  embeddings: {
    totalIdeas: number;
    embeddedIdeas: number;
    pendingIdeas: number;
    /** Non-archived works with at least one idea still lacking a current embedding. */
    incompleteWorks: number;
    /** Works with text whose full-text passage index is missing or outdated. */
    passagesPendingWorks: number;
  };
}

/** Compact, aggregate-only payload for the academic Home dashboard. */
export interface AcademicHomeStats {
  totalWorks: number;
  readTaggedWorks: number;
  manualDeepWorks: number;
  unreadWorks: number;
  deepTarget: number;
  lightDone: number;
  lightPending: number;
  lightMissing: number;
  deepDone: number;
  deepPending: number;
  deepMissing: number;
  skippedNoText: number;
  failedWorks: number;
  ideaNodes: number;
  themeNodes: number;
  semanticEdges: number;
  totalEmbeddableIdeas: number;
  embeddedIdeas: number;
  embeddingIncompleteWorks: number;
  gaps: number;
  contradictions: number;
}

/** Home uses one small IPC response instead of cloning the complete corpus. */
export interface AcademicHomeSnapshot {
  stats: AcademicHomeStats;
  health: CorpusHealth;
  queue: QueueProgress;
  latestSync: SyncLogEntry | null;
}

/** AI-suggested ways to find literature that would fill a research gap. */
export interface GapSearchSuggestions {
  keywords: string[];
  queries: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects / manuscripts — a project is a research-writing container layered on
// top of Notes, coverage maps, writing drafts and verifiable graph material.
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectKind = 'thesis' | 'article' | 'chapter' | 'literature_review' | 'theoretical_framework' | 'other';
export type ProjectStatus = 'active' | 'paused' | 'done';
export type ProjectSectionRole =
  | 'brief'
  | 'coverage'
  | 'literature'
  | 'debates'
  | 'gaps'
  | 'drafts'
  | 'manuscript'
  | 'custom';
export type ProjectSectionStatus = 'empty' | 'in_progress' | 'review' | 'ready' | 'discarded';
export type ProjectLinkKind =
  | 'note'
  | 'folder'
  | 'idea'
  | 'work'
  | 'gap'
  | 'debate'
  | 'tutor_route'
  | 'writing_draft'
  | 'research_question'
  | 'chapter';
export type ProjectLinkRole =
  | 'evidence'
  | 'argument'
  | 'counterargument'
  | 'pending'
  | 'discarded'
  | 'key_citation'
  | 'source'
  | 'draft'
  | 'context';
export type ChapterSourceFormat = 'docx' | 'pdf' | 'epub' | 'markdown' | 'txt' | 'unknown';
export type ChapterSuggestionKind = 'idea' | 'gap' | 'debate' | 'work' | 'note';
export type ChapterSuggestionOperation = 'insert_after' | 'insert_before' | 'replace' | 'comment';
export type ChapterSuggestionStatus = 'suggested' | 'accepted' | 'rejected' | 'applied' | 'blocked';
export type ChapterSuggestionMode = 'suggest' | 'insert';
export type ProjectExportFormat = 'markdown' | 'json';
export type ChapterExportFormat = 'markdown' | 'txt' | 'docx' | 'pdf';

export interface Project {
  id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  brief: string;
  researchQuestionId: string | null;
  rootFolderId: string | null;
  model: ModelRef | null;
  targetWords: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSection {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  role: ProjectSectionRole;
  status: ProjectSectionStatus;
  targetWords: number | null;
  orderIdx: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLink {
  id: string;
  projectId: string;
  sectionId: string | null;
  kind: ProjectLinkKind;
  refId: string;
  label: string;
  role: ProjectLinkRole;
  createdAt: string;
}

export interface ProjectChapter {
  id: string;
  projectId: string;
  sectionId: string | null;
  noteId: string | null;
  title: string;
  sourceFormat: ChapterSourceFormat;
  originalFileName: string | null;
  originalTextHash: string;
  originalText: string;
  currentMarkdown: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChapterChunk {
  id: string;
  chapterId: string;
  orderIdx: number;
  headingPath: string;
  text: string;
  startOffset: number;
  endOffset: number;
  wordCount: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  embeddingTextHash: string | null;
}

export interface ProjectInsertionSuggestion {
  id: string;
  projectId: string;
  chapterId: string;
  targetChunkId: string | null;
  kind: ChapterSuggestionKind;
  refId: string;
  refLabel: string;
  operation: ChapterSuggestionOperation;
  proposedText: string;
  citationRefs: CitationRef[];
  rationale: string;
  confidence: number;
  status: ChapterSuggestionStatus;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChapterVersion {
  id: string;
  chapterId: string;
  label: string;
  markdown: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter ideas: ideas distilled from the uploaded chapter text, kept separate
// from the curated graph, and their typed relations with the library.
// ─────────────────────────────────────────────────────────────────────────────

export type ChapterIdeaType = 'claim' | 'finding' | 'construct' | 'method' | 'framework';
/** How a chapter idea relates to a library entity. */
export type ChapterRelationType = 'supports' | 'contradicts' | 'refines' | 'extends' | 'related';
/** Which library entity a chapter idea relates to. */
export type ChapterRelationTargetKind = 'idea' | 'note' | 'passage' | 'work';

export interface ProjectChapterIdea {
  id: string;
  chapterId: string;
  projectId: string;
  type: ChapterIdeaType;
  label: string;
  statement: string;
  orderIdx: number;
  createdAt: string;
}

/** A typed relation from a chapter idea to a library entity, with display metadata. */
export interface ChapterIdeaRelation {
  id: string;
  chapterIdeaId: string;
  targetKind: ChapterRelationTargetKind;
  targetId: string;
  relation: ChapterRelationType;
  similarity: number;
  confidence: number;
  rationale: string;
  /** Human-readable title of the target (idea label, note title, work title…). */
  targetLabel: string;
  /** Short context for the target (author·year, snippet…). */
  targetSubtitle: string | null;
}

/** A chapter idea bundled with its discovered relations, for the relations view. */
export interface ChapterIdeaWithRelations {
  idea: ProjectChapterIdea;
  relations: ChapterIdeaRelation[];
}

export interface ChapterRelationsResult {
  chapterId: string;
  /** True once ideas have been extracted at least once for the current text. */
  analyzed: boolean;
  /** False when no embedding provider/key is configured. */
  available: boolean;
  ideas: ChapterIdeaWithRelations[];
}

/** Progress event while analysing a chapter's ideas and relations. */
export interface ChapterRelationsProgress {
  chapterId: string;
  phase: 'extracting' | 'embedding' | 'relating' | 'done' | 'error';
  current: number;
  total: number;
  message: string | null;
}

export interface AnalyzeChapterRelationsRequest {
  chapterId: string;
  model?: ModelRef | null;
  language?: PromptLanguage;
  /** Re-extract and recompute even if cached for the current text hash. */
  force?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manuscript verifier: sentence-level claim checks against indexed/listed corpus
// ideas and full-text passages. It is deliberately not a "send whole manuscript
// to the model" feature: the main process extracts candidate claims first and
// only sends compact claim+evidence batches for optional classification.
// ─────────────────────────────────────────────────────────────────────────────

export type ManuscriptClaimStatus = 'missing_citation' | 'covered' | 'own_argument' | 'weak_match';
export type ManuscriptClaimSeverity = 'high' | 'medium' | 'low' | 'info';
export type ManuscriptEvidenceKind = 'idea' | 'passage';

export interface ManuscriptEvidenceCandidate {
  kind: ManuscriptEvidenceKind;
  refId: string;
  label: string;
  citation: string;
  snippet: string;
  score: number;
  workTitle?: string | null;
  pageLabel?: string | null;
  /** True when the AI review confirmed this candidate as direct support for the claim. */
  aiEndorsed?: boolean;
}

export interface ManuscriptClaimCheck {
  id: string;
  excerpt: string;
  paragraphIndex: number;
  sentenceIndex: number;
  hasCitation: boolean;
  existingCitations: string[];
  status: ManuscriptClaimStatus;
  severity: ManuscriptClaimSeverity;
  rationale: string;
  suggestedCitations: ManuscriptEvidenceCandidate[];
  replacementHint?: string | null;
}

export interface ManuscriptVerificationSummary {
  totalClaims: number;
  checkedClaims: number;
  missingCitations: number;
  covered: number;
  ownArguments: number;
  weakMatches: number;
  citedClaims: number;
}

export interface ManuscriptVerificationResult {
  chapterId: string;
  generatedAt: string;
  /** False only when there is no chapter text or no corpus signal to compare against. */
  available: boolean;
  /** True when an AI pass refined the deterministic retrieval result. */
  aiReviewed: boolean;
  summary: ManuscriptVerificationSummary;
  claims: ManuscriptClaimCheck[];
  warnings: string[];
}

export interface ManuscriptVerificationRequest {
  chapterId: string;
  model?: ModelRef | null;
  language?: AppLanguage;
  maxClaims?: number;
}

export interface ApplyManuscriptCitationRequest {
  chapterId: string;
  /** Claim sentence as returned by the verifier; located in the draft with whitespace tolerance. */
  excerpt: string;
  /** Citation markdown to append to the sentence, e.g. `[label](nodus://idea/...)`. */
  citationMarkdown: string;
}

export interface ApplyManuscriptCitationResult {
  /** False when the sentence could not be located in the current draft. */
  applied: boolean;
  chapter: ProjectChapter | null;
}

export interface ProjectDetail {
  project: Project;
  sections: ProjectSection[];
  links: ProjectLink[];
  chapters: ProjectChapter[];
  stats: {
    sections: number;
    links: number;
    chapters: number;
    suggestions: number;
    appliedSuggestions: number;
  };
}

export interface CreateProjectInput {
  title: string;
  kind?: ProjectKind;
  brief?: string;
  researchQuestionId?: string | null;
  model?: ModelRef | null;
  targetWords?: number | null;
}

export interface UpdateProjectInput {
  id: string;
  title?: string;
  kind?: ProjectKind;
  status?: ProjectStatus;
  brief?: string;
  researchQuestionId?: string | null;
  model?: ModelRef | null;
  targetWords?: number | null;
}

export interface UpdateProjectSectionInput {
  id: string;
  title?: string;
  role?: ProjectSectionRole;
  status?: ProjectSectionStatus;
  targetWords?: number | null;
}

export interface AddProjectLinkInput {
  projectId: string;
  sectionId?: string | null;
  kind: ProjectLinkKind;
  refId: string;
  label?: string;
  role?: ProjectLinkRole;
}

export interface ImportProjectChapterInput {
  projectId: string;
  sectionId?: string | null;
  /** Optional explicit file path; when omitted the main process opens a file picker. */
  filePath?: string | null;
  title?: string;
}

export interface GenerateProjectSuggestionsRequest {
  projectId: string;
  chapterId: string;
  sectionId?: string | null;
  mode: ChapterSuggestionMode;
  model?: ModelRef | null;
  limit?: number;
}

export interface ApplyProjectSuggestionsRequest {
  chapterId: string;
  suggestionIds: string[];
}

export interface ExportProjectRequest {
  projectId: string;
  format: ProjectExportFormat;
}

export interface ExportProjectChapterRequest {
  chapterId: string;
  format: ChapterExportFormat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing workshop
// ─────────────────────────────────────────────────────────────────────────────

export type WritingWorkshopKind =
  | 'literature_review'
  | 'theoretical_framework'
  | 'debate'
  | 'gap_justification'
  | 'chapter_section'
  | 'research_question'
  | 'deep_research';

export interface WritingWorkshopBrief {
  kind: WritingWorkshopKind;
  objective: string;
  audience?: string;
  tone?: 'academic' | 'synthetic' | 'critical' | 'exploratory';
  language?: PromptLanguage;
  /** Deep Research only. Missing means the historical General approach. */
  deepResearchApproach?: import('./deepResearchApproaches').DeepResearchApproach;
  /** Deep Research engine used for this request. Missing on historical drafts. */
  deepResearchVersion?: import('./deepResearchVersions').DeepResearchVersion;
  /** Study vaults: which kind of report this is. Missing means the retrieval-based report. */
  studyReportMode?: 'research' | 'complete_guide';
}

export interface WritingWorkshopSelection {
  ideaIds: string[];
  themeIds: string[];
  gapIds: string[];
  contradictionIds: string[];
  workIds: string[];
  /** Full-text evidence deliberately selected from semantic retrieval. */
  passageIds: string[];
  tutorRouteIds: string[];
}

export interface WritingWorkshopCandidateBase {
  id: string;
  label: string;
  summary: string;
  score: number;
  reason: string;
}

export interface WritingWorkshopIdeaCandidate extends WritingWorkshopCandidateBase {
  type: IdeaType;
  statement: string;
  themes: string[];
  workCount: number;
  evidenceCount: number;
  works: { nodus_id: string; title: string; authors: string[]; year: number | null; zotero_key: string; doi?: string | null }[];
}

export interface WritingWorkshopThemeCandidate extends WritingWorkshopCandidateBase {
  workCount: number;
  ideaCount: number;
  pinned: boolean;
}

export interface WritingWorkshopGapCandidate extends WritingWorkshopCandidateBase {
  kind: GapKind;
  work: { nodus_id: string; title: string; authors: string[]; year: number | null; zotero_key: string };
  relatedIdea: string | null;
  confidence: number;
}

export interface WritingWorkshopContradictionCandidate extends WritingWorkshopCandidateBase {
  fromLabel: string;
  toLabel: string;
  type: EdgeType | string;
  basis: EdgeBasis;
  confidence: number;
  /** Author-year labels of the works behind the dispute, so a writer can attribute
   * the debate to whoever actually holds each position instead of describing a
   * nameless tension. */
  sources?: string[];
}

export interface WritingWorkshopWorkCandidate extends WritingWorkshopCandidateBase {
  title: string;
  authors: string[];
  year: number | null;
  zotero_key: string;
  /** Present when the source carries one; the only locator the local schema stores. */
  doi?: string | null;
  themes: string[];
  deepStatus: DeepStatus;
  /** Orientation only; never evidence or a citation target. */
  orientationSummary?: string | null;
  /** Audited whole-document orientation. It routes retrieval but is never cited. */
  documentOverview?: string | null;
  documentStatus?: DocumentUnderstandingState;
  documentVersionId?: string | null;
  ideaCount: number;
  gapCount: number;
}

export interface WritingWorkshopPassageCandidate extends WritingWorkshopCandidateBase {
  nodus_id: string;
  pageLabel: string | null;
  authors: string[];
  year: number | null;
  zotero_key: string;
  citation: string;
}

export interface WritingWorkshopRouteCandidate extends WritingWorkshopCandidateBase {
  routeTitle: string;
  mode: TutorMode;
  prompt: string;
  themes: string[];
  stops: number;
  rating: number | null;
}

export interface WritingWorkshopSnapshot {
  generatedAt: string;
  brief: WritingWorkshopBrief;
  stats: {
    ideas: number;
    themes: number;
    gaps: number;
    contradictions: number;
    works: number;
    passages: number;
    tutorRoutes: number;
  };
  recommendedSelection: WritingWorkshopSelection;
  ideas: WritingWorkshopIdeaCandidate[];
  themes: WritingWorkshopThemeCandidate[];
  gaps: WritingWorkshopGapCandidate[];
  contradictions: WritingWorkshopContradictionCandidate[];
  works: WritingWorkshopWorkCandidate[];
  passages: WritingWorkshopPassageCandidate[];
  tutorRoutes: WritingWorkshopRouteCandidate[];
}

export interface WritingWorkshopSection {
  id: string;
  title: string;
  purpose: string;
  keyClaims: string[];
  sources: string[];
}

export interface WritingWorkshopMatrixRow {
  claim: string;
  role: 'support' | 'contrast' | 'gap' | 'method' | 'definition' | 'context';
  sourceLabel: string;
  citation: string;
  evidence: string;
  notes: string;
}

/** One claim the verification pass flagged, with the source text to check it against. */
export interface SupportAuditEntry {
  verdict: 'partial' | 'removed';
  kind: 'idea' | 'passage' | 'gap' | 'contradiction';
  /** The section the claim sits in. */
  section: string;
  /** The sentence as it appears in the report. */
  sentence: string;
  /** What the cited source actually says. */
  source: string;
  /** Author-year of the work behind it, when there is one. */
  sourceLabel: string;
}

export interface WritingWorkshopDraft {
  claimLedger?: import('./researchClaimAudit').ResearchClaimRecord[];
  researchTraversal?: import('./researchCorpus').ResearchTraversal;
  documentSkills?: import('./documentSkills').DocumentSkillPolicy;
  documentVisualHints?: string[];
  generatedAt: string;
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  title: string;
  abstract: string;
  outline: WritingWorkshopSection[];
  draftMarkdown: string;
  matrix: WritingWorkshopMatrixRow[];
  bibliography: string[];
  nextSteps: string[];
  limitations: string[];
  /** Persisted generation-time approach. Missing on reports created before approaches existed. */
  deepResearchApproach?: import('./deepResearchApproaches').DeepResearchApproach;
  /** Persisted engine generation. Missing means the historical v1 architecture. */
  deepResearchVersion?: import('./deepResearchVersions').DeepResearchVersion;
  /** Persisted presentation structure. Missing reports use ordinary headed sections. */
  deepResearchStructure?: 'sectioned' | 'single';
  /**
   * Persisted guideline words per section, so reusing a prompt restores the length
   * the report was written to. Missing reports were written before the control and
   * are read back as `'auto'`.
   */
  deepResearchSectionLength?: import('./deepResearchSectionLength').DeepResearchSectionLength;
  /** Exact generation-time model. Null means no Nodus writing model was used or recorded. */
  generationModel?: ModelRef | null;
  /**
   * What the entailment pass concluded about individual claims, so a researcher can
   * spot-check the weakest ones instead of re-reading every source. Only claims that
   * are worth a second look are listed: those whose source supports a weaker version
   * of the sentence, and those whose citation was removed for not supporting it.
   */
  supportAudit?: SupportAuditEntry[];
  /** Reproducible quality signals shared by every Deep Research variant. */
  qualityAssessment?: import('./deepResearchQuality').DeepResearchQualityAssessment;
  /** Complete study guides only: configuration, coverage and the review sheet. */
  completeGuide?: import('./completeGuide/types').CompleteGuideDraftMeta;
  stats: {
    selectedIdeas: number;
    selectedThemes: number;
    selectedGaps: number;
    selectedContradictions: number;
    selectedWorks: number;
    selectedPassages: number;
    selectedTutorRoutes: number;
    contextChars: number;
    truncated: boolean;
  };
}

export interface WritingWorkshopDraftRequest {
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  model?: ModelRef | null;
}

export type WritingWorkshopExportFormat = 'markdown' | 'pdf' | 'docx';

export interface WritingWorkshopExportRequest {
  draft: WritingWorkshopDraft;
  /** Output format. Defaults to `'markdown'` when omitted. */
  format?: WritingWorkshopExportFormat;
  /** Saved Deep Research id, used only to include its ready decorative image in PDF exports. */
  entityId?: string;
  /** Complete study guides: export only the review sheet. */
  part?: 'full' | 'cheatsheet';
}

/**
 * `'both'` writes one `.md` AND one `.pdf` per report into the same archive.
 * `'docx'` is a Word document with the report's figures embedded, so it carries no
 * loose asset files the way the Markdown entry does.
 */
export type DeepResearchArchiveFormat = 'markdown' | 'pdf' | 'docx' | 'both';

/** Bulk download: several saved reports zipped into a single archive the user places. */
export interface DeepResearchArchiveRequest {
  ids: string[];
  /** Defaults to `'markdown'` when omitted — the only format that costs nothing to render. */
  format?: DeepResearchArchiveFormat;
  /** Complete study guides: also write each guide's review sheet as its own file. */
  includeCheatSheets?: boolean;
}

export interface DeepResearchArchiveResult {
  path: string;
  /** Reports actually written into the archive. */
  count: number;
  /**
   * Reports left out because they could not be rendered. Reported rather than
   * swallowed: a zip that silently holds 9 of 10 selected reports is worse than
   * one that says which one is missing and why.
   */
  failed: { title: string; reason: string }[];
}

/** A locally saved workshop draft, including the exact prompt and selected evidence. */
export interface WritingWorkshopSavedDraft {
  id: string;
  title: string;
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  model: ModelRef | null;
  draft: WritingWorkshopDraft;
  image: DecorativeImage | null;
  /**
   * When the reader marked this report read, or null while they have not.
   *
   * Separate from `updatedAt`: reading a report does not change it, and the two would
   * otherwise fight over the same field — sorting by "most recent" would put whatever
   * you last opened at the top of the gallery.
   */
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The six quiet colours offered by the document-reader highlighter. */
export type WritingDraftAnnotationColor = 'yellow' | 'rose' | 'blue' | 'mint' | 'lavender' | 'peach';

/**
 * A text annotation belongs to one immutable reader rendering: a saved report,
 * an Immersion step, or a supported library document.
 *
 * `scope` is `source` for the original report and `translation:<id>` for a saved
 * translation. Offsets make the common path exact and cheap; the selected text plus
 * its two short contexts let the reader recover the range if Markdown changes how it
 * splits text nodes between releases.
 */
export interface WritingDraftAnnotation {
  id: string;
  draftId: string;
  scope: string;
  kind: 'highlight' | 'comment' | 'bookmark';
  color: WritingDraftAnnotationColor | null;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  /** Library-reader annotations are reanchored whenever clean Markdown changes. */
  anchorStatus?: 'current' | 'orphaned';
  contentFingerprint?: string | null;
  orphanReason?: string | null;
  /** Text selections can identify a PDF page or EPUB chapter; images use a normalized rectangle. */
  target?: WritingDraftAnnotationTarget;
}

export type WritingDraftAnnotationTarget =
  | { type: 'text'; attachmentId: string; page?: number; chapterId?: string }
  | { type: 'region'; attachmentId: string; x: number; y: number; width: number; height: number };

export interface WritingDraftAnnotationInput {
  draftId: string;
  scope: string;
  kind: WritingDraftAnnotation['kind'];
  color?: WritingDraftAnnotationColor | null;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix?: string;
  suffix?: string;
  comment?: string | null;
  target?: WritingDraftAnnotationTarget;
}

export interface WritingWorkshopSaveDraftRequest {
  draft: WritingWorkshopDraft;
  model?: ModelRef | null;
  /** Defaults to the generated draft title when omitted. */
  title?: string;
  /** Only Deep Research uses this. Undefined keeps ordinary workshop saves unchanged. */
  decorativeImage?: DecorativeImageOption;
}

export interface WritingWorkshopStreamHandlers {
  onDelta(delta: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep Research — orchestrated, coverage-guided multi-page report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the report is organised. `'auto'` lets the model/heuristic pick from the
 * corpus size; `'single'` preserves the same evidence-led internal planning but
 * publishes one continuous narrative without section headings; a positive number
 * is a soft ceiling. The bibliography, abstract and limitations never count.
 */
export type DeepResearchSectionLimit = 'auto' | 'single' | number;

/**
 * Re-exported so every Deep Research surface can reach the structure control and the
 * length control from the same place. The implementation (normalization, validation,
 * the option list, the continuation arithmetic) lives in ./deepResearchSectionLength.
 */
export type { DeepResearchSectionLength } from './deepResearchSectionLength';

/**
 * One section of a teacher-authored outline (teaching vaults, Unit design).
 *
 * A blank `title` still reserves the slot: the teacher fixes HOW MANY parts the unit
 * has and may name only the ones they care about, leaving the rest to the model. That
 * is why the outline is a list of slots rather than a list of titles — dropping the
 * untitled ones would silently change the length the teacher asked for.
 */
export interface DeepResearchOutlineSection {
  title: string;
  /** Optional steer: what this section must concentrate on. */
  focus?: string;
}

export interface DeepResearchRequest {
  notebookId?: string | null;
  retrieval?: import('./researchCorpus').RetrievalSettings;
  documentSkills?: import('./documentSkills').DocumentSkillPolicy;
  /** The research idea/question the whole report must develop. */
  objective: string;
  /**
   * Internal coverage contract derived from the objective before planning. Each
   * question must be assigned to a section. Callers normally omit this field.
   */
  coverageQuestions?: string[];
  /** Missing is General, preserving every pre-approach request and queued job. */
  approach?: import('./deepResearchApproaches').DeepResearchApproach;
  /** Missing requests are normalized by their entry point; the new UI always sends v2. */
  deepResearchVersion?: import('./deepResearchVersions').DeepResearchVersion;
  language?: PromptLanguage;
  audience?: string;
  /**
   * Visible report structure. `'auto'` (default) sizes headed sections from the
   * corpus; `'single'` publishes the same evidence-led research as one continuous
   * narrative; a number is a hard MAXIMUM number of published sections — an
   * over-sized plan is compacted into it without discarding any evidence.
   */
  sectionLimit?: DeepResearchSectionLimit;
  /**
   * "Extensión orientativa de cada sección": how many WORDS each section should aim
   * for. `'auto'` (the default, and what every request without the field means)
   * leaves it to the model exactly as before. It is editorial guidance, never a
   * quota — no writer may pad, repeat, invent or drop evidence to reach it.
   */
  sectionLength?: import('./deepResearchSectionLength').DeepResearchSectionLength;
  model?: ModelRef | null;
  /** The thinking level chosen in the form for `model`. Absent (older builds, MCP, the
   *  Server) runs every call with the model's usual reasoning, as before. */
  thinkingEffort?: import('./researchReasoning').ResearchEffort;
  decorativeImage?: DecorativeImageOption;
  /** Study vaults: use the indexed learning corpus and the pedagogical report prompts. */
  studyMode?: boolean;
  /**
   * Teaching vaults (Unit design): same local corpus as `studyMode`, but written as a
   * teaching unit for a class and enriched with the extracted idea network.
   */
  unitMode?: boolean;
  /**
   * Teacher-authored structure. When present the generated unit has EXACTLY these
   * sections, in this order — the model may name the untitled ones but can neither add
   * nor drop a part. Absent/empty means the model designs the structure itself, and
   * `sectionLimit` applies as usual.
   */
  outline?: DeepResearchOutlineSection[];
  /**
   * Genealogy vaults only: centre the family-history report on this person — their
   * documents are guaranteed into the source pool and every section is written to
   * keep them as the throughline. Ignored outside the genealogy pipeline.
   */
  focusPersonId?: string | null;
  /**
   * Study vaults only: write a "Guía de estudio completa" from exactly these sources,
   * read in full, instead of a retrieval-based study report. Present with an empty
   * selection is an error, never a fallback to the whole vault.
   */
  completeGuide?: import('./completeGuide/types').CompleteGuideConfig;
}

/** One live progress event emitted while a report is being orchestrated. */
export interface DeepResearchProgress {
  /** `queued` is emitted while the report waits its turn in the single generation lane. */
  phase: 'queued' | 'discovery' | 'document_preparation' | 'snapshot' | 'planning' | 'section' | 'coverage' | 'assembling' | 'done';
  message: string;
  /** 1-based index of the section being written (phase === 'section'). */
  sectionIndex?: number;
  sectionTotal?: number;
  sectionTitle?: string;
  wordsSoFar?: number;
  pagesSoFar?: number;
  /** Complete study guides: the pass in progress and its own counter. */
  stage?: 'recon' | 'extract' | 'plan' | 'write' | 'verify' | 'finalize';
  done?: number;
  total?: number;
}

export type DeepResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Who asked for a queued report: the Nodus window, or an MCP client. */
export type DeepResearchJobOrigin = 'app' | 'mcp' | 'mobile';

/**
 * One report in the single generation lane (electron/ai/deepResearchQueue.ts), as seen
 * by the app window and by MCP clients. Bound to the vault it was enqueued against, so
 * a deferred report can never be researched — or saved — against a different corpus.
 */
export interface DeepResearchJobRecord {
  id: string;
  origin: DeepResearchJobOrigin;
  /** Trusted private Bridge job identity; links its durable request to this lane. */
  bridgeJobId?: string;
  vaultId: string;
  vaultName: string;
  objective: string;
  /** Short single-line preview of the objective, for list UIs. */
  title: string;
  /** Serialized with the job so queue observers never infer it from current UI state. */
  deepResearchApproach?: import('./deepResearchApproaches').DeepResearchApproach;
  /** Serialized independently from approach so old and new engines remain reproducible. */
  deepResearchVersion?: import('./deepResearchVersions').DeepResearchVersion;
  /** Requested visible structure, available while the report is still queued. */
  structure?: 'sectioned' | 'single';
  /** Study vaults: a complete study guide rather than a retrieval-based report. */
  studyReportMode?: 'research' | 'complete_guide';
  /** Requested guideline words per section. Missing on jobs queued before the control existed. */
  sectionLength?: import('./deepResearchSectionLength').DeepResearchSectionLength;
  /** Exact model selection captured when the job was enqueued, when one was explicit. */
  model?: ModelRef | null;
  status: DeepResearchJobStatus;
  progress: DeepResearchProgress | null;
  error: string | null;
  savedDraftId: string | null;
  /** The report finished but could not be stored as a draft. The work is not lost — it is readable through the job. */
  saveError: string | null;
  /** How many reports are ahead of this one; `null` unless it is still queued. */
  ahead: number | null;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Coverage + evidence accounting attached to a finished report. */
export interface DeepResearchMeta {
  factualAudit?: { checked: number; supported: number; removed: number; unverified: number;
    /** Whole-report reconciliation; pairs are kept so removals can be reviewed. */
    consistency?: { checked: boolean; conflicts: number; removed: number; pruned: number; pairs: Array<{ a: string; b: string; reason: string }> } };
  researchTraversal?: import('./researchCorpus').ResearchTraversal;
  /** Engine generation that produced the report. */
  deepResearchVersion: import('./deepResearchVersions').DeepResearchVersion;
  /** Visible report structure; internal evidence planning may still use movements. */
  structure?: 'sectioned' | 'single';
  /**
   * The guideline words-per-section the report was written to, so a finished report
   * can be inspected and the setting reused. Missing means `'auto'`.
   */
  sectionLength?: import('./deepResearchSectionLength').DeepResearchSectionLength;
  /**
   * How the guideline length actually landed. `short` counts sections that ended
   * below the target because the supported evidence ran out — the expected, correct
   * outcome of a target the corpus cannot honestly fill, and the number that keeps
   * a "why is my 20.000-word section 4.000 words?" question answerable.
   */
  sectionLengthOutcome?: { targetWords: number; sections: number; reached: number; short: number } | null;
  sections: number;
  words: number;
  pages: number;
  ideasCovered: number;
  ideasConsidered: number;
  worksCited: number;
  /** Non-null when the loop stopped before covering everything (section safety cap, provider failure, etc.). */
  stoppedReason: string | null;
  /**
   * Result of checking that each citation's source really supports the sentence it
   * was attached to. Null when no verification pass ran. `unsupported` citations were
   * removed from the prose, so this is a record of what the report stopped claiming.
   */
  verification?: { checked: number; partial: number; unsupported: number; unverified?: number } | null;
  /** Professional-editing rewrites accepted because they improved the quality gates. */
  qualityRevisions?: number;
  /** Per-section blind A/B barrier between the established writer and the
   * evidence-planned writer. A tie or order-sensitive judgement keeps baseline. */
  generationSelection?: { compared: number; planned: number; baseline: number } | null;
  /** Passages of the report that contradict each other, reported rather than repaired. */
  coherenceIssues?: number;
  /** Atomic brief questions used by planning and their deterministic report coverage. */
  coverage?: { questions: string[]; ratio: number } | null;
  /** Retrieval order used for this report. New academic reports lock the idea-graph
   * argument before whole-document evidence can enter. */
  retrievalStrategy?: 'idea_first_document_enrichment' | 'scoped_documentary' | 'legacy' | null;
  /** Outcome of the bounded, post-plan document-profile preparation pass. */
  documentPreparation?: {
    considered: number;
    requested: number;
    prepared: number;
    unavailable: number;
    failed: number;
  } | null;
  /** Planned propositions checked against section-specific evidence before prose. */
  claimAudit?: {
    checked: number;
    supported: number;
    partial: number;
    unsupported: number;
    /** Atomic support rate by evidentiary function. This exposes whether a report
     * is strong on facts but weak on causality, reception or bilateral debate. */
    roles?: Partial<Record<'fact' | 'actor_time' | 'mechanism' | 'causality' | 'comparison_side' | 'agreement' | 'contradiction' | 'effect' | 'reception' | 'limit' | 'method', {
      checked: number;
      supported: number;
    }>>;
  } | null;
}

/**
 * A finished report. `draft` reuses the Writing Workshop draft shape so the whole
 * downstream stack (renderer, citation modal, export, local save) works unchanged;
 * `meta` carries the deep-research-specific accounting.
 */
export interface DeepResearchReport {
  draft: WritingWorkshopDraft;
  meta: DeepResearchMeta;
  /** Complete study guides: the evidence sidecar, stored locally once the draft is saved. */
  completeGuideArtifacts?: unknown;
  /** Complete study guides: figures from the materials, seeded into the saved guide. */
  completeGuideFigures?: { figures: import('./completeGuide/figures').CompleteGuideFigure[]; siblings: Record<string, string[]> };
}

export interface DeepResearchStreamHandlers {
  onProgress?(progress: DeepResearchProgress): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Updates
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateCheckStatus =
  | 'disabled'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'backing-up'
  | 'installing'
  | 'error';

export type UpdateErrorCode =
  | 'pre-update-backup-required'
  | 'pre-update-backup-failed'
  | 'update-check-failed'
  | 'update-download-failed'
  | 'update-install-failed'
  | 'update-install-incomplete';

export interface UpdateCheckResponse {
  /** Verified download still available for an explicit install, including after an error. */
  downloadedVersion?: string | null;
  status: UpdateCheckStatus;
  message: string;
  errorCode?: UpdateErrorCode;
  version?: string;
  progress?: number | null;
  bytesPerSecond?: number | null;
  transferred?: number | null;
  total?: number | null;
}

export interface UpdateProgressEvent extends UpdateCheckResponse {
  at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Author Dossier ("Ficha de autor") — a per-author study surface that assembles
// what one author claims across the corpus plus how they relate to the others.
// Assembly is pure DB; the `synthesis` block is an on-demand, cached AI pass.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthorSummary {
  author_id: string;
  /** Sort form as stored ("Surname, Given"). */
  name: string;
  /** Given name(s), for name-order sorting. */
  firstName: string;
  /** Surname(s), for surname sorting. */
  lastName: string;
  /** Natural reading order ("Given Surname") for display. */
  fullName: string;
  affiliation: string | null;
  /** Works this person actually wrote. Volumes they only edited are counted apart. */
  workCount: number;
  /** Volumes this person edited without authoring — never part of their footprint. */
  editedCount: number;
  ideaCount: number;
  relationCount: number;
  /** Most frequent Zotero tags across this author's live works. */
  topTags: string[];
  topThemes: string[];
  read: boolean;
  hasSynthesis: boolean;
  /** Reader-curated bookmark stored in this vault. */
  saved: boolean;
}

export interface AuthorPageRequest {
  offset: number;
  limit: number;
  query?: string;
  sort: 'name' | 'surname' | 'works' | 'ideas' | 'connections';
  synthesis: 'all' | 'with' | 'without';
  savedOnly?: boolean;
}

export interface AuthorPage {
  items: AuthorSummary[];
  total: number;
  offset: number;
  limit: number;
}

export interface AuthorDossierWork {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  itemType: string | null;
  doi: string | null;
  zoteroKey: string | null;
  sourceType: SourceType | null;
  lightStatus: LightStatus;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  notes: string | null;
  read: boolean;
  /** How this person is credited on the work (from Zotero). */
  role: 'author' | 'editor';
  /**
   * Whether this work's ideas count towards this person. True for everything they
   * wrote, and — as the one deliberate exception — for a volume they edited that
   * Zotero credits to no author at all, whose ideas would otherwise belong to
   * nobody. The interface marks that second case as provisional.
   */
  attributed: boolean;
}

export interface AuthorDossierIdea {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  development: string;
  role: 'principal' | 'secondary';
  confidence: number;
  workId: string;
  workTitle: string;
  year: number | null;
  /** Attributed here only because the volume records no author. Shown as provisional. */
  provisional: boolean;
  themes: string[];
  evidence: Evidence[];
}

export interface AuthorDossierRelation {
  author_id: string;
  name: string;
  /** contradicts | extends | supports | refutes (from the derived author_relations layer). */
  type: string;
  weight: number;
  sharedThemes: string[];
}

export interface AuthorDossierSynthesis {
  /** 1–2 sentence central thesis of the author across their works. */
  thesis: string;
  /** Short "what to remember" bullets for fast retention under time pressure. */
  remember: string[];
  /** One paragraph narrating how this author relates to the connected authors. */
  positioning: string;
  model: ModelRef | null;
  generatedAt: string;
  /** True when the underlying ideas/relations changed since this was generated. */
  stale: boolean;
}

export interface WorkIdeaSynthesis {
  /** 1–2 sentence central thesis of one work across its extracted ideas. */
  thesis: string;
  /** Short "what to remember" bullets for fast retention under time pressure. */
  remember: string[];
  /** One paragraph placing the work within its internal themes and tensions. */
  positioning: string;
  model: ModelRef | null;
  generatedAt: string;
  stale: boolean;
}

export interface AuthorDossier {
  author: Author;
  /** Natural reading order ("Given Surname") for the card heading. */
  fullName: string;
  firstName: string;
  lastName: string;
  /** Works this person wrote — the only ones their ideas are drawn from. */
  works: AuthorDossierWork[];
  /** Volumes they edited: listed as a bibliographic fact, never as authorship. */
  editedWorks: AuthorDossierWork[];
  ideas: AuthorDossierIdea[];
  relations: AuthorDossierRelation[];
  themes: string[];
  synthesis: AuthorDossierSynthesis | null;
}

export interface AuthorSynthesisExportRequest {
  /** Authors to export. Empty = all syntheses, optionally restricted by savedOnly. */
  authorIds: string[];
  format: 'markdown' | 'pdf';
  /** When authorIds is empty, restrict the export to reader-saved authors. */
  savedOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis Matrix ("Matriz de síntesis") — the classic literature matrix:
// rows = authors, columns = themes, cells = that author's ideas on that theme.
// Counts/labels are pure DB; the per-cell `stance` is an on-demand, cached AI pass.
// ─────────────────────────────────────────────────────────────────────────────

export interface SynthesisMatrixAuthor {
  author_id: string;
  name: string;
  workCount: number;
}

export interface SynthesisMatrixTheme {
  theme_id: string;
  label: string;
}

export interface SynthesisMatrixCellIdea {
  global_id: string;
  label: string;
  type: IdeaType;
}

export interface SynthesisMatrixCell {
  authorId: string;
  themeId: string;
  ideaCount: number;
  ideas: SynthesisMatrixCellIdea[];
  /** One-sentence synthesized stance; null until generated. */
  stance: string | null;
}

export interface SynthesisMatrix {
  authors: SynthesisMatrixAuthor[];
  themes: SynthesisMatrixTheme[];
  /** Sparse — only cells where the author develops at least one idea in the theme. */
  cells: SynthesisMatrixCell[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Study Guide ("Modo Estudio") — a guided layer for mastering a whole corpus:
// author-by-author learning goals, ranked Zotero works, progress tracking and
// optional AI tutor sessions grounded in the existing graph + indexed passages.
// ─────────────────────────────────────────────────────────────────────────────

export type StudyProgressKind = 'author' | 'work' | 'idea' | 'theme';
export type StudyProgressStatus = 'pending' | 'in_progress' | 'understood' | 'needs_full_read' | 'review';

export interface StudyProgressRecord {
  targetKind: StudyProgressKind;
  targetId: string;
  status: StudyProgressStatus;
  note: string | null;
  updatedAt: string;
}

export interface StudyPlanRequest {
  objective?: string;
  sessionMinutes?: number;
  authorLimit?: number;
  worksPerAuthor?: number;
  includeCompleted?: boolean;
  /** User-triggered semantic focus. Uses embeddings when configured; never required. */
  semanticFocus?: boolean;
}

export interface StudyGuideStats {
  totalAuthors: number;
  shownAuthors: number;
  totalWorks: number;
  totalIdeas: number;
  completedAuthors: number;
  reviewAuthors: number;
  fullReadWorks: number;
  zoteroLinkedWorks: number;
}

export interface StudyKeyIdea {
  globalId: string;
  type: IdeaType;
  label: string;
  statement: string;
  workId: string;
  workTitle: string;
}

export interface StudyRecommendedWork {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  read: boolean;
  sourceType: SourceType | null;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  ideaCount: number;
  principalIdeaCount: number;
  passageCount: number;
  score: number;
  reasons: string[];
  progressStatus: StudyProgressStatus | null;
  summary: string | null;
}

export interface StudyAuthorPlan {
  authorId: string;
  name: string;
  fullName: string;
  rank: number;
  score: number;
  progressStatus: StudyProgressStatus | null;
  progressNote: string | null;
  workCount: number;
  ideaCount: number;
  relationCount: number;
  topThemes: string[];
  coverage: {
    analyzedWorks: number;
    totalWorks: number;
    fullTextWorks: number;
    zoteroLinkedWorks: number;
    readWorks: number;
  };
  recommendedWorks: StudyRecommendedWork[];
  keyIdeas: StudyKeyIdea[];
  learningGoals: string[];
  reviewQuestions: string[];
  reasons: string[];
  nextAction: string;
}

export interface StudyGuidePhase {
  id: 'orientacion' | 'autores' | 'contrastes' | 'lectura_profunda' | 'repaso';
  title: string;
  objective: string;
  authorIds: string[];
}

export interface StudyGuidePlan {
  generatedAt: string;
  objective: string;
  sessionMinutes: number;
  stats: StudyGuideStats;
  summary: string;
  nextAuthorId: string | null;
  authors: StudyAuthorPlan[];
  phases: StudyGuidePhase[];
  coverageWarnings: string[];
  semanticFocusAvailable: boolean;
  semanticFocusUsed: boolean;
  semanticFocusSummary: string | null;
}

export interface StudySessionRequest {
  authorId: string;
  objective?: string;
  sessionMinutes?: number;
  useFullText?: boolean;
  model?: ModelRef | null;
}

export interface StudySessionPassage {
  passageId: string;
  workId: string;
  workTitle: string;
  zoteroKey: string | null;
  pageLabel: string | null;
  snippet: string;
  similarity: number | null;
}

export interface StudySessionStep {
  title: string;
  body: string;
  workIds: string[];
  ideaIds: string[];
  minutes: number;
}

export interface StudyQuizQuestion {
  id: string;
  question: string;
  expected: string;
  ideaIds: string[];
  workIds: string[];
}

export interface StudySession {
  authorId: string;
  authorName: string;
  generatedAt: string;
  model: ModelRef | null;
  usedFullText: boolean;
  guide: string;
  sequence: StudySessionStep[];
  recommendedWorks: StudyRecommendedWork[];
  keyIdeas: StudyKeyIdea[];
  passages: StudySessionPassage[];
  quiz: StudyQuizQuestion[];
  fullReadCandidates: StudyRecommendedWork[];
  nextActions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Inmersión — a fully guided topic-mastery session. Phase 0 (the scope) is pure
// embeddings + graph, no AI; the generated plan stores every AI answer verbatim
// so a session can be resumed and replayed forever without new AI calls.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImmersionScopeRequest {
  topic: string;
  /** Chosen time budget, so the station estimate matches the depth tier. */
  minutes?: number;
}

/** One idea inside the topic territory, ranked by relevance (no AI involved). */
export interface ImmersionScopeIdea {
  id: string;
  type: IdeaType;
  label: string;
  statement: string;
  score: number;
  themes: string[];
  authors: string[];
  workIds: string[];
}

export interface ImmersionScopeWork {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  score: number;
  ideaCount: number;
}

export interface ImmersionScopeAuthor {
  authorId: string | null;
  name: string;
  ideaCount: number;
  workCount: number;
}

/** Phase 0 — the map of what the corpus knows about a topic (embeddings + graph only). */
export interface ImmersionScope {
  topic: string;
  generatedAt: string;
  embeddingAvailable: boolean;
  /** Whether the configured immersion/synthesis model has a usable API key; without it generation would degrade to structural content. */
  aiKeyAvailable: boolean;
  ideas: ImmersionScopeIdea[];
  works: ImmersionScopeWork[];
  authors: ImmersionScopeAuthor[];
  themes: string[];
  debateCount: number;
  gapCount: number;
  passageCount: number;
  /** The topic subgraph (idea nodes + edges among them), ready for the renderer. */
  graph: GraphData;
  estimatedStations: number;
  warnings: string[];
}

export interface ImmersionRequest {
  documentSkills?: import('./documentSkills').DocumentSkillPolicy;
  topic: string;
  language?: PromptLanguage;
  /** Total time budget for the whole immersion, in minutes. */
  minutes: number;
  /** Whether stations and the final exam carry retrieval questions (always skippable). */
  includeQuiz: boolean;
  model?: ModelRef | null;
  /** The thinking level chosen in the form for `model`. Absent (older builds, MCP, the
   *  Server) runs every call with the model's usual reasoning, as before. */
  thinkingEffort?: import('./researchReasoning').ResearchEffort;
  decorativeImage?: DecorativeImageOption;
}

/**
 * A literal quote re-read from the stored full text. `text` always comes from the
 * database, never from the model — the model only picks the passage and explains
 * why it matters.
 */
export interface ImmersionCitation {
  passageId: string;
  workId: string;
  workTitle: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  pageLabel: string | null;
  text: string;
  whyItMatters: string;
  /** Guided close reading: what to notice in this quote and how it bears on the sub-question. */
  commentary: string;
}

export interface ImmersionAuthorPosition {
  authorId: string | null;
  name: string;
  position: string;
  ideaIds: string[];
}

export interface ImmersionQuizQuestion {
  id: string;
  kind: 'choice' | 'open';
  question: string;
  /** Choice questions: the options shown; empty for open questions. */
  options: string[];
  /** Choice questions: index into `options`; null for open questions. */
  correctIndex: number | null;
  /** Choice questions: shown after answering. */
  explanation: string;
  /** Open questions: what a solid answer must recover. */
  expected: string;
  ideaIds: string[];
}

/**
 * One guided stop of the immersion — a complete mini-lesson: framing context,
 * a long threaded lesson, guided close reading of literal quotes, author
 * positions, takeaways to retain and optional retrieval questions.
 */
export interface ImmersionStation {
  id: string;
  title: string;
  question: string;
  minutes: number;
  /** Why this sub-question matters inside the topic (framing before the lesson). */
  context: string;
  /** The main lesson: markdown with nodus:// citations, validated against the corpus. */
  synthesis: string;
  citations: ImmersionCitation[];
  positions: ImmersionAuthorPosition[];
  /** The sentences the reader must retain from this station. */
  takeaways: string[];
  /** The ideas this station covers; drives the embedded graph excerpt. */
  ideaIds: string[];
  quiz: ImmersionQuizQuestion[];
}

export interface ImmersionKeyTerm {
  term: string;
  definition: string;
}

export interface ImmersionContrastCell {
  author: string;
  authorId: string | null;
  /** One-sentence stance; empty when this author has no known position. */
  stance: string;
  ideaIds: string[];
}

export interface ImmersionContrastRow {
  stationId: string;
  question: string;
  cells: ImmersionContrastCell[];
}

export interface ImmersionContrasts {
  authors: string[];
  rows: ImmersionContrastRow[];
}

export interface ImmersionFrontier {
  kind: 'gap' | 'thin_coverage';
  statement: string;
  detail: string;
  workTitle: string | null;
}

export interface ImmersionExam {
  questions: ImmersionQuizQuestion[];
  /** The "explain it in your own words" closing prompt. */
  feynman: string;
}

/** Compact idea reference stored in the plan so answers can be assessed later without the live graph. */
export interface ImmersionIdeaRef {
  id: string;
  label: string;
  statement: string;
  authors: string[];
  workTitles: string[];
}

export interface ImmersionPlanStats {
  stations: number;
  ideas: number;
  works: number;
  authors: number;
  citations: number;
  quizQuestions: number;
}

export interface ImmersionPlan {
  documentSkills?: import('./documentSkills').DocumentSkillPolicy;
  documentVisualHints?: string[];
  topic: string;
  title: string;
  language: PromptLanguage;
  minutes: number;
  generatedAt: string;
  model: ModelRef | null;
  /** Phase 1 panorama: markdown with nodus:// citations. */
  overview: string;
  keyTerms: ImmersionKeyTerm[];
  stations: ImmersionStation[];
  contrasts: ImmersionContrasts;
  frontiers: ImmersionFrontier[];
  exam: ImmersionExam;
  /** The topic subgraph; stations select node subsets from it via ideaIds. */
  graph: GraphData;
  ideaIndex: ImmersionIdeaRef[];
  stats: ImmersionPlanStats;
  /** Non-null when generation degraded somewhere (a model failure fell back to structural content). */
  stoppedReason: string | null;
}

export interface ImmersionAssessment {
  verdict: 'solid' | 'partial' | 'weak';
  score: number;
  feedback: string;
  missing: string[];
}

export interface ImmersionAnswerRecord {
  questionId: string;
  kind: 'choice' | 'open';
  answer: string;
  /** Choice questions: whether the chosen option was right. */
  correct: boolean | null;
  /** Legacy field for old sessions; new open answers are stored with `null`. */
  assessment: ImmersionAssessment | null;
  answeredAt: string;
}

export interface ImmersionProgress {
  currentStep: number;
  furthestStep: number;
  completedSteps: number[];
  answers: ImmersionAnswerRecord[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImmersionSession {
  id: string;
  topic: string;
  language: PromptLanguage;
  minutes: number;
  model: ModelRef | null;
  plan: ImmersionPlan;
  progress: ImmersionProgress;
  image: DecorativeImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImmersionSessionSummary {
  id: string;
  topic: string;
  title: string;
  language: PromptLanguage;
  minutes: number;
  stats: ImmersionPlanStats;
  progressPct: number;
  finished: boolean;
  image: DecorativeImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImmersionBuildProgress {
  phase: 'discovery' | 'document_preparation' | 'material' | 'curriculum' | 'panorama' | 'station' | 'contrasts' | 'frontiers' | 'exam' | 'assembling' | 'done';
  message: string;
  stationIndex?: number;
  stationTotal?: number;
  stationTitle?: string;
}

export interface ImmersionStreamHandlers {
  onProgress?(progress: ImmersionBuildProgress): void;
}

export interface ImmersionAnswerRequest {
  sessionId: string;
  questionId: string;
  answer: string;
  model?: ModelRef | null;
}

/** The recorded answer (with assessment when open) plus the persisted progress. */
export interface ImmersionAnswerResult {
  record: ImmersionAnswerRecord;
  progress: ImmersionProgress;
}

/** Runtime environment info, surfaced in the feedback/PR form so every report
 *  carries the exact Nodus build and platform it came from. */
export interface AppInfo {
  /** Nodus version (package.json / app.getVersion()), e.g. "2.0.3". */
  version: string;
  /** Raw Node platform: 'darwin' | 'win32' | 'linux' | … */
  platform: string;
  /** Friendly OS label, e.g. "macOS", "Windows", "Linux". */
  osName: string;
  /** os.release() string. */
  osVersion: string;
  /** CPU architecture, e.g. "arm64" | "x64". */
  arch: string;
  /** Bundled Electron version. */
  electron: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nodi companion (mascot): notifications + chat.
// ─────────────────────────────────────────────────────────────────────────────

export interface NodiNotification {
  id: string;
  /**
   * The notification as a translation key plus its values, translated by the panel on
   * every paint. Everything the app raises comes this way; see shared/nodiNotifications.
   */
  titleText?: NodiNotificationText;
  bodyText?: NodiNotificationText;
  /**
   * Prose with no key, translated as best it can be at render time. Two producers:
   * notifications stored by builds that predate the catalogue, and provider errors,
   * which are runtime text nobody can key in advance.
   */
  title?: string;
  body?: string;
  kind: 'info' | 'success' | 'warning';
  createdAt: number;
  read: boolean;
  /** Optional destination. Older builds can still render the notification as prose. */
  action?: { type: 'radar'; updateId?: string };
}

export interface NodiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type NodiContextKind = 'documentation' | 'current_view' | 'vault' | 'all_vaults';

/**
 * Contexts a Nodi chat starts with. A question asked from inside a vault is
 * almost always a question about that vault, so its retrieval is on next to the
 * product documentation and the visible view. `all_vaults` stays opt-in: it
 * reaches into every other vault, which is a decision per question.
 */
export const NODI_DEFAULT_CONTEXTS: NodiContextKind[] = ['documentation', 'current_view', 'vault'];

export interface NodiViewContext {
  viewId: string;
  title: string;
  text: string;
  capturedAt: number;
  /** Full reader documents (Deep Research and Immersion) use the larger document
   * budget instead of the small, generic visible-DOM snapshot. */
  complete?: boolean;
}

export interface NodiQuoteSelection {
  id: string;
  text: string;
  createdAt: number;
}

export interface TestimonyIndexReport {
  indexedInterviews: number;
  indexedSegments: number;
  withheld: { reason: string; interviews: number }[];
  purged: number;
  model: string;
  failed: number;
}

export interface TestimonyIndexStatus {
  indexable: number;
  indexed: number;
  segments: number;
  /** Tramos indexados que el acuerdo ya no autoriza: hay que reconstruir. */
  stale: number;
  model: string | null;
}

export interface TestimonySemanticHit {
  segmentId: string;
  interviewId: string;
  transcriptId: string;
  similarity: number;
  text: string;
  tStart: number;
  interviewTitle: string;
  shortId: string;
  speakerLabel: string | null;
  speakerPersonId: string | null;
}

/** Lo que la IA propone para una entrevista. Nada de esto está guardado todavía. */
export interface TestimonyInterviewAnalysis {
  interviewId: string;
  transcriptId: string;
  codes: { label: string; note: string }[];
  passages: { quote: string; code: string; why: string; segmentId: string; at: string; tStart: number }[];
  /** Las citas que el modelo dio y no aparecen en la transcripción, con cuánto se acercaban. */
  discarded: { quote: string; coverage: number }[];
  model: string;
}

export interface TestimonyTranscriptImprovement {
  transcriptId: string;
  segments: { segmentId: string; before: string; after: string; accepted: boolean; removed: string[]; added: string[] }[];
  accepted: number;
  rejected: number;
  model: string;
}

export interface NodiChatRequest {
  conversationId?: string;
  messages: NodiChatMessage[];
  contexts: NodiContextKind[];
  model?: ModelRef | null;
  /** The in-window companion can attach the latest visible view directly. The
   * overlay falls back to the bounded snapshot published by the main renderer. */
  currentView?: NodiViewContext | null;
  /** Extra grounding contract used by the Library reader. The document itself is
   * carried in `currentView`; this metadata makes its traced sections citable and
   * keeps those citations navigable without weakening Nodi's vault citations. */
  readerGrounding?: {
    documentId: string;
    title: string;
    citationUri: string;
    sections: Array<{ id: string; title: string; page: number | null }>;
  };
}

export interface NodiConversation {
  id: string;
  title: string;
  messages: NodiChatMessage[];
  contexts: NodiContextKind[];
  model: ModelRef | null;
  vaultId: string | null;
  vaultName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NodiConversationInput {
  id?: string | null;
  title?: string;
  messages: NodiChatMessage[];
  contexts: NodiContextKind[];
  model?: ModelRef | null;
}

/** A quick Markdown note kept by the Nodi companion (local, per install). */
export interface NodiNote {
  id: string;
  title: string;
  /** Distinguishes a user-assigned title from the three-word fallback. */
  titleExplicit: boolean;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodiNoteInput {
  id?: string | null;
  /** Optional explicit title; the first three content words are used when empty. */
  title?: string;
  content: string;
}

export interface NodiOverlayPlacement {
  x: number;
  y: number;
  horizontal: 'left' | 'right';
  vertical: 'up' | 'down';
}

export type NodiNavigationTarget =
  | 'settings'
  | { view: 'radar'; updateId?: string }
  | {
      view: 'characters' | 'places' | 'factions' | 'scenes' | 'encyclopedia' | 'map' | 'rules' | 'conflicts';
      kind: string;
      id: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Testimonios — historia oral. El dominio puro (estados, transiciones, reglas de
// acceso, citas) vive en shared/testimonies.ts y shared/testimonyAccess.ts; aquí solo
// están las FORMAS que viajan por IPC. Los dos ficheros se separan a propósito: las
// reglas se prueban sin arrancar Electron.
// ─────────────────────────────────────────────────────────────────────────────

export interface TestimonyInterview {
  id: string;
  shortId: string;
  title: string;
  interviewKind: InterviewKind;
  workflowStatus: InterviewWorkflowStatus;
  collectionLabel: string | null;
  scheduledAt: string | null;
  conductedAt: string | null;
  locationText: string | null;
  interviewMode: InterviewMode | null;
  language: string | null;
  objective: string | null;
  contextMarkdown: string | null;
  guideMarkdown: string | null;
  abstract: string | null;
  repositoryName: string | null;
  accessionId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

/** Una entrevista con lo que la tabla necesita mostrar sin abrir su dossier. */
export interface TestimonyInterviewRow extends TestimonyInterview {
  participants: TestimonyInterviewParticipant[];
  /** Nombres YA resueltos contra el modo de atribución del acuerdo vigente. */
  narratorNames: string[];
  interviewerNames: string[];
  sessionCount: number;
  mediaCount: number;
  durationSeconds: number;
  transcriptionState: TestimonyTranscriptionState;
  agreement: TestimonyAgreement | null;
  annotationCount: number;
  needsReviewCount: number;
}

/** El estado agregado de transcripción de una entrevista, para la tabla y los filtros. */
export type TestimonyTranscriptionState = 'none' | 'pending' | 'processing' | 'ready' | 'reviewed' | 'error';

export interface TestimonyInterviewInput {
  title: string;
  interviewKind?: InterviewKind;
  workflowStatus?: InterviewWorkflowStatus;
  collectionLabel?: string | null;
  scheduledAt?: string | null;
  conductedAt?: string | null;
  locationText?: string | null;
  interviewMode?: InterviewMode | null;
  language?: string | null;
  objective?: string | null;
  contextMarkdown?: string | null;
  guideMarkdown?: string | null;
  abstract?: string | null;
  repositoryName?: string | null;
  accessionId?: string | null;
  narratorIds?: string[];
  interviewerIds?: string[];
}

export interface TestimonyInterviewParticipant {
  interviewId: string;
  personId: string;
  role: OralHistoryParticipantRole;
  speakerLabel: string | null;
  isPrimary: boolean;
  position: number;
  /** Nombre de trabajo, tal como consta en `persons`. Nunca sale a un derivado. */
  workingName: string;
  /** Nombre mostrable, ya resuelto contra el acuerdo vigente. */
  displayName: string;
  identityMode: IdentityMode;
}

export interface TestimonyParticipantProfile {
  personId: string;
  workingName: string;
  publicName: string | null;
  identityMode: IdentityMode;
  pronunciation: string | null;
  biographicalNote: string | null;
  attributionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestimonyParticipantInput {
  workingName: string;
  publicName?: string | null;
  identityMode?: IdentityMode;
  pronunciation?: string | null;
  biographicalNote?: string | null;
  attributionNote?: string | null;
  nameVariants?: string[];
}

/** Una persona en la tabla de Participantes. */
export interface TestimonyParticipantRow extends TestimonyParticipantProfile {
  roles: OralHistoryParticipantRole[];
  interviewCount: number;
  lastInterviewAt: string | null;
  pendingAgreements: number;
  noteCount: number;
}

export interface TestimonySession {
  id: string;
  shortId: string;
  interviewId: string;
  sequenceNo: number;
  title: string | null;
  status: SessionStatus;
  scheduledAt: string | null;
  recordedAt: string | null;
  locationText: string | null;
  mode: InterviewMode | null;
  language: string | null;
  fieldNotes: string | null;
  createdAt: string;
  updatedAt: string;
  media: TestimonyMedia[];
}

export interface TestimonySessionInput {
  interviewId: string;
  title?: string | null;
  status?: SessionStatus;
  scheduledAt?: string | null;
  recordedAt?: string | null;
  locationText?: string | null;
  mode?: InterviewMode | null;
  language?: string | null;
  fieldNotes?: string | null;
}

/** Un archivo. NUNCA lleva el blob: se pide aparte, por id. */
export interface TestimonyMedia {
  id: string;
  shortId: string;
  sessionId: string;
  mediaKind: MediaKind;
  role: MediaRole;
  fileName: string | null;
  mimeType: string | null;
  contentHash: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  technical: Record<string, string | number | null> | null;
  sourceMediaId: string | null;
  immutable: boolean;
  createdAt: string;
  deletedAt: string | null;
  transcripts: TestimonyTranscript[];
}

export interface TestimonyMediaImportInput {
  sessionId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer | Uint8Array;
  durationSeconds?: number | null;
  role?: MediaRole;
  mediaKind?: MediaKind;
  sourceMediaId?: string | null;
  technical?: Record<string, string | number | null> | null;
}

/** Qué pasó al importar: un duplicado exacto no se guarda dos veces. */
export interface TestimonyMediaImportResult {
  media: TestimonyMedia;
  duplicateOf: string | null;
  proposedStatus: InterviewWorkflowStatus | null;
}

export interface TestimonyTranscript {
  id: string;
  shortId: string;
  mediaId: string;
  kind: TranscriptKind;
  language: string | null;
  contentMarkdown: string | null;
  status: TranscriptStatus;
  versionNo: number;
  sourceTranscriptId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  segmentCount: number;
}

export interface TestimonyTranscriptSegment {
  id: string;
  shortId: string;
  transcriptId: string;
  sourceSegmentId: string | null;
  tStart: number;
  tEnd: number;
  text: string;
  speakerPersonId: string | null;
  speakerLabel: string | null;
  confidence: number | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestimonyCode {
  id: string;
  label: string;
  normalizedLabel: string;
  kind: CodeKind;
  parentId: string | null;
  description: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  /** Cuántas anotaciones lo usan y en cuántas entrevistas aparece. */
  usageCount: number;
  interviewCount: number;
}

export interface TestimonyCodeInput {
  label: string;
  kind?: CodeKind;
  parentId?: string | null;
  description?: string | null;
  color?: string | null;
}

export interface TestimonyAnnotation {
  id: string;
  shortId: string;
  interviewId: string;
  transcriptId: string;
  segmentId: string | null;
  kind: AnnotationKind;
  tStart: number;
  tEnd: number;
  startOffset: number | null;
  endOffset: number | null;
  quoteSnapshot: string;
  memo: string | null;
  linkStatus: 'valid' | 'needs_review';
  createdAt: string;
  updatedAt: string;
  codes: TestimonyCode[];
}

export interface TestimonyAnnotationInput {
  interviewId: string;
  transcriptId: string;
  segmentId?: string | null;
  kind?: AnnotationKind;
  tStart: number;
  tEnd: number;
  startOffset?: number | null;
  endOffset?: number | null;
  quoteSnapshot: string;
  memo?: string | null;
  codeIds?: string[];
}

export interface TestimonyAgreement {
  id: string;
  interviewId: string;
  versionNo: number;
  isCurrent: boolean;
  status: AgreementStatus;
  documentedAt: string | null;
  accessLevel: AccessLevel;
  embargoUntil: string | null;
  attributionMode: AttributionMode;
  allowedUses: DocumentedUse[];
  narratorReviewRequired: boolean;
  narratorReviewStatus: NarratorReviewStatus;
  narratorReviewSentAt: string | null;
  narratorReviewNotes: string | null;
  restrictionsMarkdown: string | null;
  documentMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestimonyAgreementInput {
  interviewId: string;
  status?: AgreementStatus;
  documentedAt?: string | null;
  accessLevel?: AccessLevel;
  embargoUntil?: string | null;
  attributionMode?: AttributionMode;
  allowedUses?: DocumentedUse[];
  narratorReviewRequired?: boolean;
  narratorReviewStatus?: NarratorReviewStatus;
  narratorReviewSentAt?: string | null;
  narratorReviewNotes?: string | null;
  restrictionsMarkdown?: string | null;
  documentMediaId?: string | null;
}

/** Un fragmento tal y como lo pintan Contrastes, Buscar y una nota. */
export interface TestimonyFragment {
  annotationId: string;
  shortId: string;
  interviewId: string;
  interviewTitle: string;
  interviewShortId: string;
  transcriptId: string;
  transcriptKind: TranscriptKind;
  sessionId: string | null;
  mediaId: string | null;
  /** Ya resuelto contra el acuerdo: nunca el nombre real bajo seudónimo. */
  speakerName: string;
  speakerPersonId: string | null;
  tStart: number;
  tEnd: number;
  text: string;
  memo: string | null;
  codes: TestimonyCode[];
  accessLevel: AccessLevel;
  agreementStatus: AgreementStatus;
  linkStatus: 'valid' | 'needs_review';
  conductedAt: string | null;
}

export interface TestimonyContrast {
  id: string;
  shortId: string;
  title: string;
  filters: TestimonyContrastFilters;
  memoMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
  pinned: TestimonyContrastItem[];
}

export interface TestimonyContrastItem {
  contrastId: string;
  annotationId: string;
  position: number;
  note: string | null;
}

export interface TestimonyContrastFilters {
  interviewIds?: string[];
  codeIds?: string[];
  personIds?: string[];
  search?: string;
  languages?: string[];
  collections?: string[];
  from?: string;
  to?: string;
  /** Solo versiones revisadas o aprobadas, si el investigador lo pide. */
  reviewedOnly?: boolean;
  mode?: 'parallel' | 'byTheme' | 'matrix';
}

export interface TestimonyContrastInput {
  title: string;
  filters?: TestimonyContrastFilters;
  memoMarkdown?: string | null;
}

/** El resultado de un contraste. Nodus muestra; interpretar es del investigador. */
export interface TestimonyContrastResult {
  fragments: TestimonyFragment[];
  /** Códigos presentes en TODAS las entrevistas seleccionadas. */
  sharedCodeIds: string[];
  /** Entrevistas seleccionadas que no aportan ningún fragmento: ausencia, no conclusión. */
  silentInterviewIds: string[];
  matrix: { codeId: string; interviewId: string; count: number }[];
}

/** El tablero de Inicio. */
export interface TestimonyDashboard {
  metrics: {
    interviews: number;
    scheduled: number;
    pendingTranscription: number;
    reviewing: number;
    completed: number;
    recordedSeconds: number;
    storageBytes: number;
    participants: number;
    codes: number;
    annotations: number;
  };
  alerts: TestimonyAlert[];
  recent: {
    interviews: { id: string; title: string; updatedAt: string }[];
    transcripts: { id: string; interviewId: string; interviewTitle: string; kind: TranscriptKind; createdAt: string }[];
    notes: { id: string; title: string; updatedAt: string }[];
    contrasts: { id: string; title: string; updatedAt: string }[];
  };
  preservation: {
    lastBackupAt: string | null;
    interviewsWithoutMaster: number;
    mediaWithoutHash: number;
    storageBytes: number;
  };
}

export interface TestimonyAlert {
  kind: TestimonyAlertKind;
  count: number;
  /** Las primeras entrevistas afectadas, para poder saltar sin abrir la lista. */
  interviewIds: string[];
}

export type TestimonyAlertKind =
  | 'upcoming'
  | 'agreement_missing'
  | 'backup_stale'
  | 'transcription_error'
  | 'transcription_pending_review'
  | 'narrator_review_pending'
  | 'embargo_expiring'
  | 'annotation_needs_review'
  | 'master_missing';

/** Qué desaparece al borrar una entrevista. Se enseña ANTES de preguntar. */
export interface TestimonyDeletionImpact {
  interviewId: string;
  title: string;
  sessions: number;
  media: number;
  masterMedia: number;
  transcripts: number;
  segments: number;
  annotations: number;
  agreements: number;
  contrastItems: number;
  noteLinks: number;
  bytes: number;
}

export type TestimonySearchKind =
  | 'interview'
  | 'participant'
  | 'segment'
  | 'code'
  | 'note'
  | 'contrast';

export interface TestimonySearchHit {
  kind: TestimonySearchKind;
  id: string;
  title: string;
  snippet: string | null;
  /** Presente solo en los pasajes. */
  interviewId?: string;
  transcriptId?: string;
  segmentId?: string;
  speakerName?: string;
  tStart?: number;
  accessLevel?: AccessLevel;
  agreementStatus?: AgreementStatus;
}

/** Un enlace de una nota con cualquier entidad. Tabla genérica `note_links`. */
export interface NoteLink {
  noteId: string;
  targetKind: string;
  targetId: string;
  label: string | null;
  createdAt: string;
}

/** El paquete archivístico que se puede exportar. */
export type TestimonyExportKind = 'preservation' | 'access' | 'review';

export interface TestimonyExportRequest {
  kind: TestimonyExportKind;
  interviewIds: string[];
  /** El documento del acuerdo solo viaja tras una casilla explícita. */
  includeAgreementDocuments?: boolean;
  includeNotes?: boolean;
}

export interface TestimonyExportResult {
  path: string;
  interviews: number;
  files: number;
  bytes: number;
  /** Entrevistas que la puerta de acceso dejó fuera, con su motivo. */
  excluded: { interviewId: string; title: string; reason: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC API surface exposed on window.nodus via the preload bridge.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nodus Browser. The renderer draws the chrome and issues commands; it never
 * holds a WebContents. State arrives whole through `onBrowserStateChanged`.
 */
/**
 * Per-origin permission decisions the user chose ("Always allow for this site").
 * Absence means "ask"; only explicit allow/deny are stored.
 */
export type BrowserSitePermissionMap = Record<string, Record<string, 'allow' | 'deny'>>;

export interface BrowserApi {
  getBrowserState(): Promise<import('./browser').BrowserState>;
  openBrowserTab(url: string): Promise<string | null>;
  /** Navigate the current tab to a trusted local start page; remote pages never receive this API. */
  navigateBrowserStartPage(page: 'atlas' | 'bookmarks'): Promise<boolean>;
  activateBrowserTab(id: string): Promise<void>;
  closeBrowserTab(id: string): Promise<void>;
  /** Clear a tab's error pane and reveal the page that is still loaded behind it. */
  browserDismissError(): Promise<void>;
  browserGoBack(): Promise<void>;
  browserGoForward(): Promise<void>;
  /** Open where Back/Forward would go in a NEW tab, leaving this one put. */
  openBrowserHistoryNeighbourTab(direction: 'back' | 'forward'): Promise<string | null>;
  browserReload(): Promise<void>;
  browserStop(): Promise<void>;
  browserGoHome(): Promise<{ url: string }>;
  /** Destroy and recreate only the Browser subsystem; websites cannot call it. */
  restartNodusBrowser(confirmed?: boolean): Promise<import('./browser').BrowserRestartResult>;
  revealBrowserDownload(id: string): Promise<void>;
  clearBrowserDownloads(): Promise<import('./browser').BrowserDownloadView[]>;
  /** The native context menu asking the renderer to open one of its dialogs. */
  onBrowserActionRequested(cb: (action: string) => void): () => void;
  submitBrowserOmnibox(input: string): Promise<import('./browserOmnibox').OmniboxResolution & { ok?: boolean }>;
  setBrowserViewport(viewport: import('./browser').BrowserViewport): Promise<void>;
  /** Hide the native page view while a React overlay is open. */
  setBrowserOverlayVisible(open: boolean): Promise<void>;
  /** A transient image of the page, used beneath HTML overlays. */
  captureBrowserOverlaySnapshot(): Promise<string | null>;
  /** Whether the browser section is the one currently on screen. */
  setBrowserSectionVisible(visible: boolean): Promise<void>;
  onBrowserStateChanged(cb: (state: import('./browser').BrowserState) => void): () => void;
  getPendingBrowserPermission(): Promise<import('./browser').PendingBrowserPermission | null>;
  resolveBrowserPermission(id: string, granted: boolean, remember: boolean): Promise<void>;
  cancelBrowserPermissions(): Promise<void>;
  onBrowserPermissionRequest(
    cb: (request: import('./browser').PendingBrowserPermission | null) => void,
  ): () => void;
  /** An HTTP authentication challenge waiting on credentials. */
  getPendingBrowserAuth(): Promise<import('./browser').PendingBrowserAuth | null>;
  /** Answer the challenge; credentials are never stored by Nodus. */
  resolveBrowserAuth(id: string, username: string, password: string): Promise<void>;
  /** Dismiss one request by id, or every pending request when no id is given. */
  cancelBrowserAuth(id?: string): Promise<void>;
  onBrowserAuthRequest(
    cb: (request: import('./browser').PendingBrowserAuth | null) => void,
  ): () => void;
  getBrowserMedia(): Promise<import('./browser').BrowserMediaState[]>;
  browserMediaCommand(tabId: string, command: import('./browser').BrowserMediaCommand): Promise<void>;
  setBrowserTabMuted(tabId: string, muted: boolean): Promise<void>;
  /** Read and set the device's general output volume (0–100). */
  getBrowserDeviceVolume(): Promise<number>;
  setBrowserDeviceVolume(volume: number): Promise<void>;
  onBrowserMediaChanged(cb: (states: import('./browser').BrowserMediaState[]) => void): () => void;
  captureBrowserPage(): Promise<import('./browserConnector').BrowserConnectorCapturePreview | null>;
  saveBrowserCapture(
    request: import('./browserConnector').BrowserConnectorCaptureRequest,
    includeSnapshot: boolean,
  ): Promise<import('./browserConnector').BrowserConnectorSaveResult>;
  browserPageIsPdf(): Promise<{ isPdf: boolean; url: string }>;
  importBrowserPdf(itemId: string, url: string, title: string):
    Promise<import('./browserConnector').BrowserConnectorSaveResult>;
  /** Refresh Nodi's Current view context from the active native browser page. */
  syncBrowserNodiContext(): Promise<boolean>;
  askNodiAboutBrowserPage(): Promise<boolean>;
  askNodiAboutBrowserSelection(): Promise<boolean>;
  getBrowserDownloads(): Promise<import('./browser').BrowserDownloadView[]>;
  cancelBrowserDownload(id: string): Promise<void>;
  dismissBrowserDownload(id: string): Promise<void>;
  importBrowserDownload(id: string, title: string): Promise<{ itemId: string; title: string }>;
  onBrowserDownloadsChanged(cb: (downloads: import('./browser').BrowserDownloadView[]) => void): () => void;
  getBrowserStorage(force?: boolean): Promise<import('./browser').BrowserStorageReport>;
  clearBrowserData(
    categories: import('./browser').BrowserDataCategory[],
    origins?: string[],
  ): Promise<import('./browser').BrowserStorageReport>;
  clearAllBrowserData(): Promise<import('./browser').BrowserStorageReport>;
  /** Global Nodus data. Never exposed to the untrusted Browser-page preload. */
  getBrowserBookmarks(): Promise<import('./browserBookmarks').BrowserBookmarkStore>;
  resolveBrowserBookmarkFavicons(ids: string[]): Promise<void>;
  getCurrentBrowserBookmarkCandidate(): Promise<import('./browserBookmarks').BrowserBookmarkCandidate | null>;
  createBrowserBookmark(draft: import('./browserBookmarks').BrowserBookmarkDraft): Promise<{
    store: import('./browserBookmarks').BrowserBookmarkStore;
    bookmark: import('./browserBookmarks').BrowserBookmark;
    duplicate: boolean;
  }>;
  updateBrowserBookmark(id: string, patch: Partial<import('./browserBookmarks').BrowserBookmarkDraft>): Promise<import('./browserBookmarks').BrowserBookmarkStore>;
  createBrowserBookmarkFolder(draft: import('./browserBookmarks').BrowserBookmarkFolderDraft): Promise<{
    store: import('./browserBookmarks').BrowserBookmarkStore;
    folder: import('./browserBookmarks').BrowserBookmarkFolder;
  }>;
  updateBrowserBookmarkFolder(id: string, patch: Partial<import('./browserBookmarks').BrowserBookmarkFolderDraft>): Promise<import('./browserBookmarks').BrowserBookmarkStore>;
  deleteBrowserBookmarkNode(ref: import('./browserBookmarks').BrowserBookmarkNodeRef): Promise<import('./browserBookmarks').BrowserBookmarkStore>;
  moveBrowserBookmarkNode(ref: import('./browserBookmarks').BrowserBookmarkNodeRef, parentId: string | null, index: number): Promise<import('./browserBookmarks').BrowserBookmarkStore>;
  previewBrowserBookmarksImport(): Promise<import('./browserBookmarks').BrowserBookmarksImportPreview | null>;
  commitBrowserBookmarksImport(token: string): Promise<{
    store: import('./browserBookmarks').BrowserBookmarkStore;
    summary: import('./browserBookmarks').BrowserBookmarksImportSummary;
  }>;
  exportBrowserBookmarks(format: 'json' | 'html'): Promise<import('./browserBookmarks').BrowserBookmarksExportResult>;
  onBrowserBookmarksChanged(cb: (store: import('./browserBookmarks').BrowserBookmarkStore) => void): () => void;
  /** Local visit data. Never exposed to Browser page renderers or included in backups. */
  getBrowserHistory(): Promise<import('./browserHistory').BrowserHistoryStore>;
  deleteBrowserHistoryEntry(id: string): Promise<import('./browserHistory').BrowserHistoryStore>;
  clearBrowserHistory(): Promise<import('./browserHistory').BrowserHistoryStore>;
  onBrowserHistoryChanged(cb: (store: import('./browserHistory').BrowserHistoryStore) => void): () => void;
  browserFindInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<void>;
  browserStopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): Promise<void>;
  onBrowserFoundInPage(cb: (result: { requestId: number; activeMatchOrdinal: number; matches: number; selectionArea: unknown; finalUpdate: boolean }) => void): () => void;
}

export interface NodusApi extends StudyFocusApi, ProsopographyApi, TestimoniesApi, ToolkitApi, TeachingApi, DatabasesApi, PagesApi, PrimarySourcesApi, ArchiveApi, WorldbuildingApi, PlatformApi, RecordsApi, AcademicApi, LibraryApi, RadarApi, ReactionIndexApi, CompassApi, BrowserApi, LogsApi, DriftApi {
  // settings + secrets
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getAiConcurrencySnapshot(): Promise<AiConcurrencySnapshot[]>;
  onAiConcurrencySnapshot(cb: (snapshot: AiConcurrencySnapshot[]) => void): () => void;
  listVaults(): Promise<VaultSummary[]>;
  // Nodi companion
  listNotifications(): Promise<NodiNotification[]>;
  /** Manually refresh published announcements and reconcile the local activity list. */
  refreshNotifications(): Promise<{
    notifications: NodiNotification[];
    announcements: AnnouncementEntry[];
    refresh: AnnouncementRefreshResult;
  }>;
  markNotificationsRead(): Promise<NodiNotification[]>;
  clearNotifications(): Promise<NodiNotification[]>;
  openNotification(id: string): Promise<void>;
  onNotificationsChanged(cb: (list: NodiNotification[]) => void): () => void;
  /** Published announcements. Read state is per notice, unlike the activity feed. */
  listAnnouncements(): Promise<AnnouncementEntry[]>;
  markAnnouncementRead(id: string): Promise<AnnouncementEntry[]>;
  onAnnouncementsChanged(cb: (list: AnnouncementEntry[]) => void): () => void;
  getSkillMarketplace(): Promise<SkillMarketplace>;
  addSkillSource(url: string): Promise<SkillMarketplace>;
  removeSkillSource(id: string): Promise<SkillMarketplace>;
  updateSkillSource(id: string): Promise<SkillMarketplace>;
  installMarketplaceSkill(sourceId: string, packagePath: string, commit: string): Promise<ChatSkill[]>;
  importSkillPackage(): Promise<ChatSkill[]>;
  exportSkillPackage(id: string): Promise<string | null>;
  listChatSkills(): Promise<ChatSkill[]>;
  listDocumentSkills(): Promise<import('./documentSkills').DocumentSkillOption[]>;
  getDocumentVisuals(target: import('./documentSkills').DocumentVisualTarget): Promise<import('./documentSkills').DocumentVisualManifest | null>;
  enrichDocumentVisuals(target: import('./documentSkills').DocumentVisualTarget, policy: import('./documentSkills').DocumentSkillPolicy, options?: import('./documentVisualEnrich').DocumentVisualEnrichOptions): Promise<import('./documentSkills').DocumentVisualManifest>;
  cancelDocumentVisuals(target: import('./documentSkills').DocumentVisualTarget): Promise<void>;
  undoDocumentVisuals(target: import('./documentSkills').DocumentVisualTarget): Promise<import('./documentSkills').DocumentVisualManifest | null>;
  removeDocumentFigure(target: import('./documentSkills').DocumentVisualTarget, figureId: string): Promise<import('./documentSkills').DocumentVisualManifest | null>;
  onDocumentVisualsChanged(listener: (target: import('./documentSkills').DocumentVisualTarget) => void): () => void;
  saveChatSkill(skill: ChatSkill): Promise<ChatSkill[]>;
  deleteChatSkill(id: string): Promise<ChatSkill[]>;
  restoreChatSkills(): Promise<ChatSkill[]>;
  onChatSkillsChanged(cb: () => void): () => void;
  getChatImageMetadata(source: string): Promise<Record<string, string> | null>;
  copyChatImage(source: string): Promise<void>;
  downloadCapabilityFile(source: string): Promise<void>;
  readCapabilityModel(source: string): Promise<{ bytes: Uint8Array; mimeType: string; name: string; info: import('../packages/capability-api/src/models').ModelAssetInfo }>;
  readCapabilityMedia(source: string): Promise<{ bytes: Uint8Array; mimeType: string; name: string; info: import('../packages/capability-api/src/media').MediaAssetInfo }>;
  fetchCapabilityTile(capabilityId: string, service: string, tilePath: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  listCapabilities(): Promise<import('./capabilities').CapabilityListPayload>;
  onCapabilityRegistryChanged(cb: (payload: import('./capabilities').CapabilityRegistryPayload) => void): () => void;
  capabilityHealth(capabilityId: string): Promise<import('./capabilities').CapabilityHealthPayload>;
  getCapabilitySettings(capabilityId: string): Promise<import('./capabilities').CapabilitySettingsPayload>;
  applyCapabilitySettings(capabilityId: string, submission: import('./capabilities').SettingsSubmissionV1): Promise<import('./capabilities').SettingsStateV1>;
  runCapabilityAction(capabilityId: string, actionId: string): Promise<import('./capabilities').SettingsStateV1>;
  renderCapabilityArtifact(source: string, locale?: string): Promise<import('./capabilities').ArtifactRenderResult>;
  renderLegacyCapabilityResult(fence: string, payload: string, locale?: string): Promise<import('./capabilities').LegacyResultRenderResult>;
  onCapabilityMigrationChanged(cb: () => void): () => void;
  checkCapabilityUpdates(pluginId?: string): Promise<Array<{ pluginId: string; state: 'updated' | 'awaiting-approval' | 'incompatible' | 'current' | 'skipped' | 'failed'; from?: string; to?: string; detail?: string }>>;
  setCapabilityAutoUpdate(pluginId: string, autoUpdate: boolean): Promise<import('./capabilities').InstalledCapabilityPlugin>;
  capabilityMigrationStatus(): Promise<import('./capabilities').CapabilityMigrationStatus>;
  retryCapabilityMigration(): Promise<{ installed: string[]; adopted: string[]; preserved: string[]; failed: Array<{ pluginId: string; phase: string; detail: string }> }>;
  refreshCapabilityCatalog(sourceUrl: string): Promise<import('./capabilities').CapabilityListPayload['catalog']>;
  installCapabilityPlugin(pluginId: string, approvePermissions?: boolean): Promise<{ state: import('./capabilities').InstalledCapabilityPlugin; activated: boolean; pendingPermissions: import('./capabilities').TrustedPermissionSetV2 | null }>;
  approveCapabilityPlugin(pluginId: string): Promise<import('./capabilities').InstalledCapabilityPlugin>;
  discardPendingCapabilityPlugin(pluginId: string): Promise<import('./capabilities').InstalledCapabilityPlugin[]>;
  rollbackCapabilityPlugin(pluginId: string): Promise<import('./capabilities').InstalledCapabilityPlugin>;
  removeCapabilityPlugin(pluginId: string, purgeData?: boolean): Promise<import('./capabilities').InstalledCapabilityPlugin[]>;
  listInstalledPlugins(): Promise<InstalledPluginSummary[]>;
  listInboxPlugins(): Promise<InboxPluginSummary[]>;
  approveInboxPlugin(directory: string): Promise<ChatSkill[]>;
  discardInboxPlugin(directory: string): Promise<InboxPluginSummary[]>;
  installMarketplacePlugin(sourceId: string, packagePath: string, commit: string, approvePermissions: boolean): Promise<ChatSkill[]>;
  approvePlugin(id: string): Promise<ChatSkill[]>;
  setPluginAutoUpdate(id: string, enabled: boolean): Promise<InstalledPluginSummary[]>;
  rollbackPlugin(id: string): Promise<ChatSkill[]>;
  removePlugin(id: string): Promise<ChatSkill[]>;
  configurePluginSecret(pluginId: string, capabilityId: string, secretId: string, value: string): Promise<InstalledPluginSummary[]>;
  restorePluginSkillAuthorVersion(id: string): Promise<ChatSkill[]>;
  listNodiConversations(): Promise<NodiConversation[]>;
  getNodiConversation(id: string): Promise<NodiConversation | null>;
  saveNodiConversation(input: NodiConversationInput): Promise<NodiConversation>;
  deleteNodiConversation(id: string): Promise<void>;
  clearNodiConversations(): Promise<void>;
  listNodiNotes(): Promise<NodiNote[]>;
  saveNodiNote(input: NodiNoteInput): Promise<NodiNote>;
  deleteNodiNote(id: string): Promise<void>;
  nodiChatStream(request: NodiChatRequest, handlers: { onDelta: (delta: string) => void }): Promise<string>;
  cancelNodiChat(): Promise<void>;
  setNodiViewContext(context: NodiViewContext): Promise<void>;
  getNodiViewContext(): Promise<NodiViewContext | null>;
  quoteNodiSelection(text: string): Promise<NodiQuoteSelection | null>;
  consumeNodiQuoteSelection(): Promise<NodiQuoteSelection | null>;
  onNodiQuoteSelection(cb: (selection: NodiQuoteSelection) => void): () => void;
  setNodiTutorialVisible(visible: boolean): Promise<void>;
  nodiOpenSettings(): Promise<void>;
  nodiOpenWorldEntry(kind: string, id: string): Promise<void>;
  onNodiNavigate(cb: (target: NodiNavigationTarget) => void): () => void;
  nodiSetMouseIgnore(ignore: boolean): Promise<void>;
  /** Synchronous, but IPC-free: read from the URL the mascot window was loaded with. */
  nodiGetOverlayPlacement(): NodiOverlayPlacement;
  /** Authoritative placement from the main process, for after a reload. */
  nodiRefreshOverlayPlacement(): Promise<NodiOverlayPlacement>;
  nodiSetExpanded(expanded: boolean): Promise<NodiOverlayPlacement>;
  onNodiDismiss(cb: () => void): () => void;
  nodiOpenMainWindow(): Promise<void>;
  nodiBeginWindowDrag(screenX: number, screenY: number): Promise<NodiOverlayPlacement>;
  nodiDragWindow(screenX: number, screenY: number): Promise<NodiOverlayPlacement>;
  nodiEndWindowDrag(): Promise<void>;
  onVaultChanged(cb: (vault: VaultSummary | null) => void): () => void;
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void;
  /** Fired when a user-started AI task cannot resolve any configured model. */
  onAiModelRequired(cb: () => void): () => void;
  /** Deeplink received via OS (nodus://...), e.g. OAuth callback from system browser. */
  onDeepLink(cb: (url: string) => void): () => void;
  getActiveVault(): Promise<VaultSummary>;
  createVault(input: CreateVaultInput): Promise<VaultCreateResult>;
  /** Step one of connecting to a Nodus Server space: verify credentials, list the spaces. */
  remoteSignIn(url: string, email: string, password: string): Promise<RemoteSignIn>;
  /** Step two: take a device token for one space and hydrate a local replica of it. */
  createConnectedVault(input: {
    url: string;
    ticket: string;
    space: RemoteSpaceChoice;
    userEmail: string;
    serverName: string;
    serverKind?: 'classic' | 'cloudflare';
  }): Promise<VaultCreateResult>;
  replicaOverview(): Promise<ReplicaConnectionView[]>;
  replicaSyncNow(vaultId: string): Promise<ReplicaConnectionView[]>;
  replicaPresence(vaultId: string): Promise<ReplicaPresenceParticipant[]>;
  replicaUpdatePresence(vaultId: string, input: ReplicaPresenceInput | null): Promise<ReplicaPresenceParticipant[]>;
  /** Keep the data, stop syncing: what a revoked or unwanted replica becomes. */
  replicaDetach(vaultId: string): Promise<ReplicaConnectionView[]>;
  renameVault(id: string, name: string): Promise<VaultSummary>;
  setVaultType(id: string, type: VaultType): Promise<VaultSummary>;
  switchVault(id: string, options?: VaultSwitchOptions): Promise<VaultSwitchResult>;
  onBeforeEditorLeave(callback: () => Promise<boolean>): () => void;
  duplicateVault(id: string, name: string, options?: VaultSwitchOptions): Promise<VaultDuplicateResult>;
  deleteVault(id: string, deleteFiles?: boolean): Promise<void>;
  resetVault(id: string): Promise<VaultSummary>;
  reuseVaultAnalysis(nodusIds: string[], operationId?: string): Promise<VaultAnalysisReuseResult>;
  cancelVaultAnalysisReuse(operationId: string): Promise<boolean>;
  copyVaultApiKeys(sourceVaultId: string, targetVaultId: string): Promise<{ copiedProviders: AiProvider[] }>;
  listMigrationRecoverySnapshots(): Promise<MigrationRecoverySnapshot[]>;
  openMigrationRecoverySnapshot(id: string): Promise<VaultCreateResult>;


  // core: sync, backups, recovery. Regrouped here so the academic and study
  // declarations above form one range — they used to sit inside it.
  syncNow(options?: ZoteroSyncOptions): Promise<SyncLogEntry>;
  getSyncLog(): Promise<SyncLogEntry[]>;
  /** Sync packages are encrypted with a passphrase the user sets on both machines. */
  hasSyncPassphrase(): Promise<boolean>;
  setSyncPassphrase(passphrase: string): Promise<void>;
  clearSyncPassphrase(): Promise<void>;
  /** Versions a sync merge discarded, kept so a wrong resolution stays recoverable. */
  countSupersededVersions(): Promise<number>;
  listSupersededVersions(limit?: number, offset?: number): Promise<SupersededEntry[]>;
  restoreSupersededVersion(id: string): Promise<SupersededRestoreResult>;
  clearSupersededVersions(ids?: string[]): Promise<number>;
  /** Set (≥8 chars) the master password that encrypts every automatic backup. Stored in the OS keychain. */
  setBackupPassword(password: string): Promise<void>;
  clearBackupPassword(): Promise<void>;
  hasBackupPassword(): Promise<boolean>;
  /** Folder picker for the automatic-backup destination. Returns the chosen path or null. */
  chooseBackupFolder(): Promise<string | null>;
  /** Run one complete encrypted automatic-style backup immediately. */
  runBackupNow(): Promise<AutoBackupResult>;
  /** Read-only cleanup preview; never moves or deletes files. */
  previewBackupCleanup(): Promise<BackupCleanupPreview>;
  /** Run the guarded cleanup immediately after explicit user confirmation. */
  runBackupCleanupNow(scopeToken: string): Promise<BackupCleanupResult>;
  /** Write a plaintext recovery kit (master password + independent recovery key) to a user-chosen file. */
  saveBackupRecoveryKit(): Promise<{ ok: boolean; message: string }>;
  /**
   * The video tutorials to show: this build's list plus any published since, fetched
   * and validated in the main process. Falls back to the built-in list, so it is safe
   * to render whatever comes back.
   */
  getTutorialCatalogue(): Promise<TutorialVideo[]>;
  /** Inspect whether recovery onboarding is required for this installation. */
  getRecoveryStatus(): Promise<RecoveryStatus>;
  /** Pick and inspect an empty folder or an existing Nodus recovery root. */
  chooseRecoveryFolder(mode: 'create' | 'restore', language?: AppLanguage): Promise<RecoveryFolderInspection | null>;
  /** Create a recovery root and commit its first verified full-state snapshot. */
  initializeRecoveryFolder(path: string, password: string, language?: AppLanguage): Promise<RecoverySetupResult>;
  /** Restore a selected snapshot from an existing recovery root. */
  restoreRecoverySnapshot(
    root: string,
    fileName: string,
    password: string,
    language?: AppLanguage,
    onProgress?: (progress: RecoveryRestoreProgress) => void,
  ): Promise<RecoverySetupResult>;
  /** The absolute path of a file dropped on the window. webUtils, not a channel. */
  getPathForDroppedFile(file: unknown): string;

  // app updates
  checkForUpdates(): Promise<UpdateCheckResponse>;
  installUpdate(): Promise<UpdateCheckResponse>;
  getUpdateStatus(): Promise<UpdateProgressEvent | null>;
  onUpdateProgress(cb: (event: UpdateProgressEvent) => void): () => void;

  // macOS dock icon (dynamic: follows theme + active vault). No-op elsewhere.
  setDockIcon(pngDataUrl: string): Promise<void>;

}

export interface WorkFilter {
  search?: string;
  lightStatus?: LightStatus | 'all';
  deepStatus?: DeepStatus | 'all';
  summaryStatus?: SummaryStatus | 'all';
  /** Presence conditions that must all be satisfied (AND). `!` prefix = NOT. */
  statusFlags?: Array<'deep' | 'summary' | 'ideas' | 'passages' | '!deep' | '!summary' | '!ideas' | '!passages'>;
  /** Restrict to a corpus-health bucket (works without text, light-only, etc.). */
  healthBucket?: CorpusHealthBucketId;
  /**
   * Restrict to one readiness value — what the library's status presets use.
   * `running` is renderer-only (live queue); persisted `pending` is filterable.
   */
  readiness?: Exclude<WorkReadiness, 'running'>;
  theme?: string;
  /** Zotero tags to match. Multiple tags can use any-match (default) or all-match. */
  zoteroTags?: string[];
  zoteroTagMode?: 'any' | 'all';
  /** Zotero collection keys to match (selecting a parent includes its subcollections). */
  collections?: string[];
  collectionMode?: 'any' | 'all';
  yearMin?: number;
  yearMax?: number;
  includeArchived?: boolean;
}

export type WorkSortKey =
  | 'title'
  | 'authors'
  | 'year'
  | 'themes'
  | 'ideas'
  | 'light'
  | 'deep'
  | 'summary'
  | 'embeddings'
  | 'passages';

export interface WorkPageRequest {
  offset: number;
  limit: number;
  sort?: { key: WorkSortKey; dir: 'asc' | 'desc' } | null;
}

export interface WorkPage {
  items: WorkView[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Result of deleting selected works from the current vault.
 *
 * `ok: false` is the one expected refusal, not a failure: the scan queue is analysing
 * some of those works right now and their analysis would be republished after the
 * delete. It is returned rather than thrown so the renderer can word it in the
 * reader's language.
 */
export interface WorkDeletionOutcome {
  ok: boolean;
  /** Works the queue is analysing right now; only set when `ok` is false. */
  running: string[];
  deleted: string[];
  /** Global ideas left without any occurrence: kept and marked dormant, never deleted. */
  dormantIdeas: number;
  /** Index entries removed from the Global Library for the deleted works. */
  globalLinks: number;
}

/** A Zotero collection available as a Library filter, flattened with its depth. */
export interface CollectionFacet {
  key: string;
  name: string;
  parentKey: string | null;
  /** Indentation level in the flattened tree (0 = top-level). */
  depth: number;
  /** Works in this collection and its subcollections. */
  workCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingPipelineProgress {
  running: boolean;
  paused: boolean;
  cancelled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  currentWorkStartedAt: string | null;
  currentWorkFinishedAt: string | null;
  /** Index of the work currently being processed (0-based). */
  currentWorkIndex: number;
  /** Total works queued for embedding. */
  totalWorks: number;
  /** Title of the work currently being processed. */
  currentWorkTitle: string | null;
  /** Number of ideas embedded so far across all works. */
  ideasEmbedded: number;
  /** Total ideas to embed across all works. */
  totalIdeas: number;
  /** Index of the idea being processed within the current work (0-based). */
  currentIdeaIndex: number;
  /** Total ideas in the current work. */
  currentWorkIdeas: number;
  /** Error message if the pipeline stopped on error. */
  error: string | null;
}

/** Per-work embedding status for display in the library table. */
export interface WorkEmbeddingStatus {
  nodus_id: string;
  totalIdeas: number;
  embeddedIdeas: number;
  /** true if all ideas have embeddings. */
  complete: boolean;
}

/** Progress state for the manual full-text passage indexing pipeline. */
export interface PassageEmbeddingProgress {
  running: boolean;
  paused: boolean;
  cancelled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  currentWorkStartedAt: string | null;
  currentWorkFinishedAt: string | null;
  currentWorkIndex: number;
  totalWorks: number;
  currentWorkTitle: string | null;
  passagesEmbedded: number;
  totalPassages: number;
  currentPassageIndex: number;
  currentWorkPassages: number;
  error: string | null;
}

export interface WorkPassageStatus {
  nodus_id: string;
  totalPassages: number;
  status: 'complete' | 'outdated' | 'missing';
  /** Why an existing passage index is not current. Null for complete/missing indexes. */
  outdatedReason: 'text_changed' | 'model_changed' | 'text_and_model_changed' | 'missing_embeddings' | null;
}

export interface PassageDetail {
  attachmentRevision?: string;
  conversationAttachment?: { conversationId: string; attachmentId: string };
  noteId?: string;
  revision?: string;
  historical?: boolean;
  libraryItemId?: string | null;
  attachmentId?: string | null;
  provenance?: 'source' | 'abstract' | 'user-note' | 'generated-report' | 'web';
  /** Research Chat web evidence: where and when Nodus read this passage. */
  web?: WebPassageSource;
  passage_id: string;
  nodus_id: string;
  text: string;
  page_label: string | null;
  source_ref: string | null;
  page_number: number | null;
  chunk_index: number;
  work: {
    title: string;
    authors: string[];
    year: number | null;
    zotero_key: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic bridge discovery
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticBridgeProgress {
  phase: 'scan' | 'validation' | 'done';
  label: string;
  current: number;
  total: number;
  candidatesFound: number;
  bridgesAdded: number;
}

export interface SemanticBridgeResult {
  candidatesScanned: number;
  crossThemeCandidates: number;
  validated: number;
  added: number;
}
