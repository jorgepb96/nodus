import { exportAcademicDocument, inspectAcademicDocument } from '../export/academicExport';
import * as preparationExperience from '../ai/researchPreparationExperience';
import { onDocumentaryPreparationChanged } from '../ai/documentaryPreparationEvents';
import { manualIndexStatus, scheduleManualIndex } from '../ai/manualIdeaIndex';
import { embed as embedResearchQuery } from '../ai/aiClient';
import { assertAcademicAutomation } from '../ai/academicMode';
import { registerResearchAttachmentIpc } from './researchAttachments';
import { dialogTitle } from '../dialogTitles';
import { getResearchSystemPrompts, saveResearchSystemPrompt, selectResearchSystemPrompt, deleteResearchSystemPrompt } from '../db/researchSystemPromptsRepo';
import { mergeHybridResults, searchSnippet } from '@shared/hybridSearch';
import type { StudyQuestionBulkAction } from '@shared/studyQuestions';
import type { StudyFlashcardExport, StudyFlashcardBulkAction } from '@shared/studyFlashcards';
import type { StudyInterchangeExportOptions, StudyInterchangeFormat, StudyInterchangeImportOptions, StudyInterchangeKind } from '@shared/studyInterchange';
import { searchVaultContent } from '../ai/vaultContentSearch';
import { stellarPage, stellarThemes, getStellarSession, saveStellarSession } from '../graph/stellarService';
// The academic corpus and the study vault, moved verbatim out of the monolithic
// registerIpc. The channel names are unchanged; scripts/test-ipc-contract.mjs is
// what proves it.
//
// Two product surfaces share this module on purpose. Measured against the file
// they came from, the range spanned by `study:` contained every academic channel
// and the academic range contained every `study:` one — they enclose each other,
// so there was no cut that produced two pure blocks. What they genuinely share is
// the corpus: a study material and a work both end up as ideas in the same graph,
// and `queueImportedStudyKnowledge` below is where the two meet.
import { localizedForUi, type IpcContext } from './context';
import { BrowserWindow, shell } from 'electron';
import { seedTestimonyDemoData } from '../db/testimonyDemoData';
import type {
  AddProjectLinkInput,
  AnalyzeChapterRelationsRequest,
  ApplyManuscriptCitationRequest,
  ApplyProjectSuggestionsRequest,
  ArgumentMapRequest,
  AuthorSynthesisExportRequest,
  ChapterSuggestionStatus,
  ChatMessageRecord,
  CitationRef,
  CreateNoteFolderInput,
  CreateNoteInput,
  CreateProjectInput,
  CreateStudyAcademicYearInput,
  CreateStudyCourseInput,
  CreateStudyDocumentInput,
  CreateStudyFolderInput,
  CreateStudySubjectInput,
  CreateStudyTagInput,
  CreateStudyTemplateInput,
  CreateStudyTopicInput,
  DebateAnalysisRequest,
  DeepResearchArchiveRequest,
  DeepResearchRequest,
  ExportProjectChapterRequest,
  ExportProjectRequest,
  GenerateProjectSuggestionsRequest,
  HypothesisLabRequest,
  ImmersionAnswerRequest,
  ImmersionProgress,
  ImmersionRequest,
  ImmersionScopeRequest,
  ImportProjectChapterInput,
  LibraryReaderChatMessage,
  LibraryReaderChatRequest,
  LibraryReaderDocument,
  ManualIdeaPayload,
  ManuscriptVerificationRequest,
  NoteTagPatch,
  NotesExportOptions,
  OpenEvidenceAtPageResult,
  QueueKind,
  ReadingPathRequest,
  ReprocessConnectionsOptions,
  ReprocessConnectionsResult,
  ResearchChatRequest,
  ResearchContextSelection,
  RqDecomposeRequest,
  RqExportRequest,
  RqMapRequest,
  RqUpdateSubQuestionsRequest,
  SaveSearchInput,
  SearchResultKind,
  SemanticSearchOptions,
  StudyAnnotationInput,
  StudyAssessmentInput,
  StudyAssistantConversationInput,
  StudyAssistantConversationPatch,
  StudyAssistantRequest,
  StudyAttemptAnswerInput,
  StudyAttemptStartInput,
  StudyAudioMarkerInput,
  StudyDiarizationRequest,
  StudyDocUpdateInput,
  StudyEntityKind,
  StudyEntityMoveInput,
  StudyImproveRequest,
  StudyImprovementLog,
  StudyLifecycleAction,
  StudyMaterialAnnotationInput,
  StudyMaterialListOptions,
  StudyMaterialUpdateInput,
  StudyPlacementInput,
  StudyPlanRequest,
  StudyQuestionExport,
  StudyQuestionFilters,
  StudyQuestionGenerationRequest,
  StudyQuestionInput,
  StudyRecordingCreateInput,
  StudyRecordingListOptions,
  StudyRecordingUpdateInput,
  StudyRubricInput,
  StudySchedule,
  StudySearchOptions,
  StudySessionRequest,
  StudySttRequest,
  StudyStyleAssociationKind,
  StudyStyleExport,
  StudyStyleInput,
  StudySynonymRequest,
  StudyTestBuildRequest,
  StudyTranscriptInput,
  StudyTranscriptSegmentInput,
  StudyWorkspaceOptions,
  TutorPlan,
  TutorPlanRequest,
  TutorRoute,
  TutorStepRequest,
  UpdateNoteInput,
  UpdateProjectInput,
  UpdateProjectSectionInput,
  UpdateStudyAcademicYearInput,
  WorkFilter,
  WorkspaceLibraryLinkInput,
  WorkspaceLinkOwnerKind,
  WritingWorkshopBrief,
  WritingWorkshopDraftRequest,
  WritingWorkshopExportRequest,
  WritingWorkshopSaveDraftRequest,
  WritingDraftAnnotationInput,
  ZoteroItem,
  ZoteroStudyMaterialImportInput,
} from '@shared/types';
import type {
  DictionaryEntryInput,
  DictionaryEntryPatch,
  DictionaryEvidenceDecision,
  DictionaryEvidenceRef,
  DictionaryEvidenceRequest,
  DictionaryGenerationRequest,
  DictionaryProgress,
  DictionaryListRequest,
  DictionaryRelationType,
} from '@shared/dictionary';
import { immersionAnnotationDocumentId } from '@shared/readerAnnotations';
import { applyDecorativeImageOption, invalidateDecorativeImageGeneration } from '../ai/decorativeImages';
import { DictionaryGenerationQueue } from '../ai/dictionaryGenerationQueue';
import * as zotero from '../zotero/zoteroClient';
import * as dedupe from '../db/dedupeRepo';
import * as ideaDedupe from '../db/ideaDedupeRepo';
import { checkGraphIntegrity, dismissPendingThemeWorks, pendingThemeWorkIds, runGraphIntegrityRepair } from '../db/graphIntegrityRepair';
import { listCollectionFacets } from '../db/collectionsRepo';
import { setEdgeFeedback, listEdgeFeedback } from '../db/edgeFeedbackRepo';
import { aggregateGaps, aggregateGapsPage, contradictionCount, getGapDetail } from '../db/gapsRepo';
import { ingestZoteroItem } from '../sync/syncService';
import { buildIdeaGraph,   buildAuthorGraph, getContradictions, getDebates, buildReadingPath } from '../graph/graphService';
import { streamDebateAnalysis } from '../ai/debate';
import * as rqRepo from '../db/researchMapRepo';
import * as writingAnnotations from '../db/writingAnnotationsRepo';
import * as libraryReader from '../libraryReader/libraryReaderStore';
import {
  createLibraryReaderAnnotationInWorker,
  deleteLibraryReaderAnnotationInWorker,
  getLibraryReaderAttachmentContentInWorker,
  updateLibraryReaderCommentInWorker,
} from '../libraryReader/libraryReaderWorkerHost';
import { streamLibraryReaderChat } from '../ai/libraryReaderChat';
import { decomposeQuestion, mapCoverage } from '../ai/researchMap';
import { exportResearchCoverage } from '../export/researchMapExport';
import { exportData, importData } from '../export/exportImport';
import { buildSyncPackage, mergeSyncPackage } from '../export/syncPackage';
import { parsePageNumber, zoteroOpenPdfUrl, zoteroSelectUrl } from '@shared/pageLocation';
import { hasAnyData, seedDemoData, clearDemoData } from '../db/demoData';
import { seedGenealogyDemoData } from '../db/genealogyDemoData';
import { seedDatabasesDemoData } from '../db/databasesDemoData';
import { seedStudyDemoData } from '../db/studyDemoData';
import { seedTeachingDemoData } from '../db/teachingDemoData';
import { seedPrimarySourcesDemoData } from '../db/primarySourcesDemoData';
import { seedWorldbuildingDemoData } from '../db/worldbuildingDemoData';
import { generateDemoPortraits, hasDemoPortraitKey } from '../ai/genealogyDemoPortraits';
import { exportNotes } from '../export/notesExport';
import { reorderNotesByAI } from '../ai/notesOrder';
import { suggestFolderIdeas } from '../ai/folderIdeaSuggestions';
import { verifyCitations, previewCitation } from '../citations/verifyCitations';
import { getSearchResultDetail, globalSearch } from '../db/searchRepo';
import { listEditorReferences } from '../db/editorReferencesRepo';
import { semanticSearch, findSimilarToIdea } from '../ai/semanticSearch';
import { listSavedSearches, saveSearch, deleteSavedSearch } from '../db/savedSearchesRepo';
import { getCorpusHealth } from '../db/corpusHealthRepo';
import { analyzeChapterRelations, getChapterRelations, onChapterRelationsProgress } from '../ai/chapterIdeas';
import { applyManuscriptCitation, verifyManuscriptCitations } from '../ai/manuscriptVerifier';
import { suggestGapSearch } from '../ai/gapSearch';
import { extractFromPath } from '../extraction/textExtractor';
import { runDeepScan } from '../ai/deepScan';
import { summaryContentHash } from '../ai/summaryScan';
import { answerResearchChat, generateChatTitle, streamResearchChat } from '../ai/researchAssistant';
import * as researchNotebooks from '../ai/researchNotebookService';
import { researchCorpusInventory } from '../ai/researchCorpusInventory';
import { ResearchCorpusRun, resolveAcademicRunScope } from '../ai/researchCorpusRun';
import * as documentaryPreparation from '../ai/documentaryPreparation';
import { RETRIEVAL_PRESETS } from '@shared/researchCorpus';
import { listResearchContextSources } from '../ai/researchSourceScope';
import { answerTutorStep, buildTutorPlan, streamTutorStep } from '../ai/tutor';
import { buildArgumentMap, discoverArgumentRoutes } from '../ai/argumentMap';
import { listAuthors, listAuthorsPage, buildAuthorDossier, synthesizeAuthorDossier } from '../ai/authorDossier';
import { buildSynthesisMatrix, synthesizeMatrixCell } from '../ai/synthesisMatrix';
import { getCachedWorkIdeaSynthesis, synthesizeWorkIdeas } from '../ai/workIdeaSynthesis';
import { exportAuthorSyntheses } from '../export/authorSynthesisExport';
import { setAuthorSaved } from '../db/savedAuthorsRepo';
import { buildStudyPlan, generateStudySession } from '../ai/studyGuide';
import { buildImmersionScope, evaluateImmersionAnswer, generateImmersionSession } from '../ai/immersion';
import * as immersionRepo from '../db/immersionRepo';
import { generateHypothesisLab } from '../ai/hypothesisLab';
import * as studyProgress from '../db/studyProgressRepo';
import * as studyOrg from '../db/studyOrgRepo';
import * as studySchedule from '../db/studyScheduleRepo';
import * as studyEditor from '../db/studyEditorRepo';
import * as studyStyles from '../db/studyStylesRepo';
import * as studyRecordings from '../db/studyRecordingsRepo';
import { transcribeStudyAudio as transcribeOpenAiStudyAudio } from '../ai/studyTranscription';
import { diarizeStudyRecording } from '../ai/studyDiarization';
import { cancelWhisperCpp, deleteWhisperCppModel, downloadWhisperCppModel, getWhisperCppStatus, transcribeWhisperCpp, installWhisperCpp, uninstallWhisperCpp } from '../stt/whisperCpp';
import { improveStudyText } from '../ai/studyImprove';
import { suggestStudySynonyms } from '../ai/studySynonyms';
import * as studySearch from '../ai/studySearch';
import * as studyAssistant from '../ai/studyAssistant';
import * as studyQuestions from '../db/studyQuestionsRepo';
import * as studyLearning from '../db/studyLearningRepo';
import { detectStudyInterchangeFormat, exportStudyInterchange, interchangeExtension, parseStudyInterchange, writeStudyInterchange } from '../studyInterchange';
import * as studyAiUsage from '../db/studyAiUsageRepo';
import * as studyDataAdmin from '../db/studyDataAdmin';
import { exportStudyScope } from '../export/studyExport';
import { annotatedEpubBytes, annotatedPdfBytes } from '../export/studyMaterialAnnotations';
import { generateStudyQuestions } from '../ai/studyQuestions';
import { onStudyMaterialIndexChanged, queueStudyMaterialIndex, reindexStudyMaterial } from '../ai/studyMaterialIndex';
import { getStudyKnowledgeProgress, onStudyKnowledgeChanged, queueStudyKnowledgeSources, reanalyzeStudyKnowledgeSource } from '../ai/studyKnowledge';
import { decideStudyMaterialAiProcessing, resolveStudyMaterialAiProcessingRequest } from '../ai/studyKnowledgeConsent';
import * as studyKnowledgeRepo from '../db/studyKnowledgeRepo';
import * as studyAssessments from '../db/studyAssessmentsRepo';
import { buildStudyTest } from '../ai/studyTests';
import * as studyGrading from '../db/studyGradingRepo';
import { buildWritingWorkshopSnapshot, generateWritingWorkshopDraft } from '../ai/writingWorkshop';
import * as dictionaryRepo from '../db/dictionaryRepo';
import {
  detectDictionaryDuplicatesSemantic,
  generateDictionaryEntry,
  retrieveDictionaryResearchEvidence,
  scanChangedDictionaryEntries,
} from '../ai/dictionary';
import { ensureDeepResearchLane } from '../ai/deepResearchLane';
import {
  cancelDeepResearchJob,
  clearFinishedDeepResearchJobs,
  enqueueDeepResearchJob,
  listDeepResearchJobs,
  runDeepResearchJob,
} from '../ai/deepResearchQueue';
import { reprocessConnections } from '../ai/reprocessConnections';
import { startEmbedding, reindexAll, pauseEmbedding, resumeEmbedding, stopEmbedding, clearEmbeddingProgress, onEmbeddingProgress, getWorkEmbeddingStatuses, refreshRethemedIdeaEmbeddings } from '../ai/embeddingPipeline';
import { startPassageEmbedding, pausePassageEmbedding, resumePassageEmbedding, stopPassageEmbedding, clearPassageProgress, onPassageProgress, getWorkPassageStatuses } from '../ai/passageEmbeddingPipeline';
import { getScopedLegacyPassageDetail } from '../citations/scopedLegacyCitations';
import { getWebPassageDetail } from '../db/researchWebRepo';
import { getPassageDetail } from '../db/passagesRepo';
import * as researchZotero from '../mcp/researchZotero';
import { getDocumentaryPassageDetail } from '../citations/documentaryCitations';
import {
  deleteDocumentProfileOverride,
  documentProfileStatuses,
  getDocumentProfile,
  upsertDocumentProfileOverride,
} from '../db/documentProfilesRepo';
import { documentIndexQueue } from '../pipeline/documentIndexQueue';
import { discoverSemanticBridges, onSemanticBridgeProgress } from '../ai/semanticBridges';
import * as manualIdeas from '../db/manualIdeasRepo';
import * as tutorRoutes from '../db/tutorRepo';
import * as writingDrafts from '../db/writingDraftsRepo';
import * as translationsRepo from '../db/translationsRepo';
import * as workSummaries from '../db/workSummariesRepo';
import * as projects from '../db/projectsRepo';
import { exportDeepResearchArchive, exportWritingWorkshopDraft } from '../export/writingWorkshopExport';
import { exportImmersionSessionPdf } from '../export/immersionExport';
import { generateProjectSuggestions } from '../ai/projectInsertion';
import { exportProject, exportProjectChapter } from '../export/projectExport';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { dialog, app } from 'electron';
import { showImportOpenDialog } from '../privacy';
import type { AnalysisRunOptions, ModelRef, PromptLanguage, StudyMaterialImportInput, WorkDeletionOutcome } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { stopMcpServer, stopMcpTunnel } from '../mcp';
import * as works from '../db/worksRepo';
import * as ideas from '../db/ideasRepo';
import * as themes from '../db/themesRepo';
import { scanQueue } from '../pipeline/scanQueue';
import { isAiModelRequiredError } from '@shared/aiModelRequired';
import { getSyncPassphrase } from '../secrets/secretStore';
import * as studyMaterials from '../db/studyMaterialsRepo';
import { getEmbeddingSnapshot } from '../ai/embeddingPipeline';
import { getPassageSnapshot } from '../ai/passageEmbeddingPipeline';
import { isSemanticBridgeRunning } from '../ai/semanticBridges';
import * as chat from '../db/chatRepo';
import * as chatProjects from '../db/researchChatProjectsRepo';
import * as notes from '../db/notesRepo';
import * as workspace from '../db/workspaceRepo';
import * as studyNoteLinks from '../db/studyNoteLinksRepo';
import type { StudyNoteLinkFilter, StudyNoteLinkInput } from '@shared/studyNoteLinks';
import { getDb, withVaultDatabase } from '../db/database';
import { deleteWorks, worksRunningNow } from '../db/workDeletion';
import { removeGlobalLibraryLinksForWorks } from '../library/libraryService';
import { getActiveVault, withOwningVault } from '../vaults/vaultRegistry';
import { completeGuideOrganization, listCompleteGuideCatalog, previewCompleteGuide } from '../ai/completeGuide/sources';
import type { CompleteGuidePreviewRequest } from '@shared/completeGuide/preview';
import { getCompleteGuideEvidence } from '../ai/completeGuide/evidence';
import { configureAppleCalendarSync, getAppleCalendarSyncStatus, requestAppleCalendarSync } from '../calendar/appleCalendarSync';
import { listAppleCalendars } from '../calendar/appleCalendarBridge';

// Mirrors MANUAL_IDEA_MARKER in shared/types.ts. Defined locally because the
// electron sub-build erases type-only @shared imports but cannot resolve the
// alias for a runtime value import.
const MANUAL_IDEA_MARKER = 'manual-idea';

/**
 * Queue the full analysis chain for one work: themes (if missing) → ideas, marked
 * with `chain: true` so the scan queue continues into summary, indexing (ideas +
 * passages) and semantic bridge discovery even when the auto-* settings are off.
 */
function processFullChain(nodusId: string, model?: ModelRef | null, options: AnalysisRunOptions = { mode: 'if-stale' }): void {
  const w = works.getWork(nodusId);
  if (!w) return;
  const refresh = options.mode === 'refresh';
  if (refresh || w.light_status !== 'done') {
    // Keep a committed light result readable while its forced replacement is in
    // flight. Queue state already communicates progress; the new result publishes
    // atomically, and a failed refresh must leave the previous status current.
    if (!(refresh && w.light_status === 'done')) works.setLightPending(nodusId);
    scanQueue.enqueue(nodusId, w.title, 'light', model, { refresh });
  }
  works.setManualDeep(nodusId, true);
  works.setDeepPending(nodusId);
  scanQueue.enqueue(nodusId, w.title, 'deep', model, { chain: true, refresh });
}
async function importStudyMaterialPaths(paths: string[], input: StudyMaterialImportInput = {}) {
  const results: Awaited<ReturnType<typeof studyMaterials.importStudyMaterialFile>>[] = [];
  const visit = async (filePath: string): Promise<void> => {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        await visit(path.join(filePath, entry.name));
      }
      return;
    }
    if (path.extname(filePath).toLowerCase() === '.zip') {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-study-import-'));
      try {
        const entries = new AdmZip(filePath).getEntries().filter((entry) => !entry.isDirectory);
        let index = 0;
        for (const entry of entries) {
          const name = path.basename(entry.entryName);
          if (!name || !studyMaterials.supportsStudyMaterial(name)) continue;
          const extracted = path.join(temp, `${String(index++).padStart(4, '0')}-${name}`);
          fs.writeFileSync(extracted, entry.getData());
          results.push(await studyMaterials.importStudyMaterialFile(extracted, input));
        }
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      return;
    }
    if (studyMaterials.supportsStudyMaterial(filePath)) results.push(await studyMaterials.importStudyMaterialFile(filePath, input));
  };
  for (const selected of paths) await visit(selected);
  return results;
}

/**
 * Tell every window the saved-drafts table changed.
 *
 * The other emitter is the inbox poller, which is how a report sent from the phone reaches
 * an open Deep Research gallery. Emitting here too means the channel means what its name
 * says rather than "something arrived from the server", so a second window sees this one's
 * saves and deletes as well.
 */
function announceWritingDrafts(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('writing:saved:changed', null);
  }
}

function announceDictionary(entryId: string | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('dictionary:changed', entryId);
  }
}

function announceDictionaryProgress(progress: DictionaryProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('dictionary:progress', localizedForUi(progress));
      if (progress.phase === 'failed' && isAiModelRequiredError(progress.error)) {
        win.webContents.send('ai:modelRequired');
      }
    }
  }
}

const dictionaryGenerationJobs = new DictionaryGenerationQueue(
  async (request, report) => {
    const version = await generateDictionaryEntry(request, report);
    announceDictionary(request.entryId);
    return version;
  },
  announceDictionaryProgress,
);

function announceWritingDraftAnnotations(draftId: string | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('writing:annotations:changed', draftId);
    }
  }
}

function announceLibraryReaderAnnotations(nodusId: string | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('libraryReader:annotations:changed', nodusId);
    }
  }
}

/**
 * The library copy of a work that can actually be shown at a page: either a
 * preserved PDF original, or clean text whose source map kept the physical page
 * of each section. A document with neither cannot honour a locator, so it is not
 * offered as a jump target.
 */
function pageCapableLibraryCopy(nodusId: string): OpenEvidenceAtPageResult['local'] {
  let reader: LibraryReaderDocument | null = null;
  try {
    reader = libraryReader.getLibraryReaderDocument(nodusId);
  } catch {
    // A missing or unreadable reader document is the same as no local copy.
  }
  if (!reader) return null;
  const pdfOriginal = reader.originalAvailable && reader.originalMimeType === 'application/pdf';
  if (!pdfOriginal && !reader.sections.some((section) => typeof section.page === 'number')) return null;
  // The reader resolves its document by id from either library, so the scope only
  // decides which Library the user lands in: the vault the citation came from when
  // the work is in it, the transverse catalog otherwise.
  let inVault = false;
  try {
    inVault = Boolean(works.getWork(nodusId));
  } catch {
    inVault = false;
  }
  return { itemId: nodusId, scope: inVault ? 'vault' : 'global' };
}

let releasePreparationProgress: (() => void) | null = null;
export function registerAcademicIpc(context: IpcContext): void {
  releasePreparationProgress?.();
  releasePreparationProgress = onDocumentaryPreparationChanged(() => {
    const progress = preparationExperience.getResearchPreparationProgress();
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('research:preparation:progress', progress);
  });
  const { getWindow, chatAborters } = context;
  const h: IpcContext['h'] = (channel, listener) => context.h(channel, (event, ...args) => {
    if (/^(scan:|works:(setManualDeep|analyzeBoth|process|retry|rescan|reassignThemes|summarize|synthesizeIdeas)|study:improve$|themes:reprocess|bridges:discover|queue:enqueue|notes:reorderByAI|notes:folders:suggestIdeas|ideas:(merge|dedup|audit)|dictionary:(scan|retrieve))/.test(channel)) assertAcademicAutomation();
    return listener(event, ...args);
  });
  h('manualIdeas:indexStatus', async () => manualIndexStatus());
  h('manualIdeas:retryIndex', async () => { scheduleManualIndex(true); });
  registerResearchAttachmentIpc(context);
  const studyImproveAborters = new Map<string, AbortController>();
  const studyAssistantAborters = new Map<string, AbortController>();
  const libraryReaderChatAborters = new Map<string, AbortController>();

  h('dictionary:list', async (_e, request: DictionaryListRequest) => dictionaryRepo.listDictionaryEntries(request));
  h('dictionary:facets', async () => dictionaryRepo.listDictionaryFacets());
  h('dictionary:get', async (_e, id: string) => dictionaryRepo.getDictionaryEntryDetail(id));
  h('dictionary:create', async (_e, input: DictionaryEntryInput) => {
    const entry = dictionaryRepo.createDictionaryEntry(input);
    announceDictionary(entry.id);
    return entry;
  });
  h('dictionary:update', async (_e, id: string, patch: DictionaryEntryPatch, expectedUpdatedAt: string) => {
    const entry = dictionaryRepo.updateDictionaryEntry(id, patch, expectedUpdatedAt);
    announceDictionary(id);
    return entry;
  });
  h('dictionary:delete', async (_e, ids: string[]) => {
    const changed = dictionaryRepo.deleteDictionaryEntries(ids);
    dictionaryGenerationJobs.delete(ids);
    if (changed) announceDictionary(null);
    return changed;
  });
  h('dictionary:duplicates', async (_e, name: string, aliases: string[]) => detectDictionaryDuplicatesSemantic(name, aliases));
  h('dictionary:retrieve', async (_e, entryId: string, options?: import('@shared/dictionary').DictionaryResearchOptions) => {
    const detail = await retrieveDictionaryResearchEvidence(entryId, 'initial', options);
    announceDictionary(entryId);
    return detail;
  });
  h('dictionary:scan', async (_e, entryId: string, options?: import('@shared/dictionary').DictionaryResearchOptions) => {
    const detail = await retrieveDictionaryResearchEvidence(entryId, 'scan', options);
    announceDictionary(entryId);
    return detail;
  });
  h('dictionary:scanChanged', async (_e, limit?: number) => {
    const ids = await scanChangedDictionaryEntries(limit);
    if (ids.length) announceDictionary(null);
    return ids;
  });
  h('dictionary:evidence:list', async (_e, request: DictionaryEvidenceRequest) => dictionaryRepo.listDictionaryEvidence(request));
  h('dictionary:evidence:decision', async (_e, entryId: string, refs: DictionaryEvidenceRef[], decision: DictionaryEvidenceDecision) => {
    dictionaryRepo.setDictionaryEvidenceDecision(entryId, refs, decision);
    announceDictionary(entryId);
  });
  h('dictionary:generate', async (_e, request: DictionaryGenerationRequest) => {
    try {
      const version = await generateDictionaryEntry(request);
      announceDictionary(request.entryId);
      return { ok: true as const, version };
    } catch (error) {
      const failureDetail = error instanceof Error ? error.message : String(error);
      if (isAiModelRequiredError(error)) getWindow()?.webContents.send('ai:modelRequired');
      console.error(`[dictionary] generation failed for ${request.entryId}`, error);
      return { ok: false as const, failureDetail };
    }
  });
  h('dictionary:generate:start', async (_e, request: DictionaryGenerationRequest) => {
    return dictionaryGenerationJobs.start(request);
  });
  h('dictionary:generate:jobs', async () => dictionaryGenerationJobs.list());
  h('dictionary:versions:list', async (_e, entryId: string) => dictionaryRepo.listDictionaryVersions(entryId));
  h('dictionary:versions:accept', async (_e, entryId: string, versionId: string, expectedCurrentVersionId: string | null) => {
    const detail = dictionaryRepo.acceptDictionaryVersion(entryId, versionId, expectedCurrentVersionId);
    announceDictionary(entryId);
    return detail;
  });
  h('dictionary:versions:restore', async (_e, entryId: string, versionId: string, expectedCurrentVersionId: string | null) => {
    const detail = dictionaryRepo.restoreDictionaryVersion(entryId, versionId, expectedCurrentVersionId);
    announceDictionary(entryId);
    return detail;
  });
  h('dictionary:relations:add', async (_e, fromEntryId: string, toEntryId: string, type?: DictionaryRelationType) => {
    const relation = dictionaryRepo.addDictionaryRelation(fromEntryId, toEntryId, type);
    announceDictionary(fromEntryId);
    return relation;
  });

  const queueImportedStudyKnowledge = async (
    results: Awaited<ReturnType<typeof importStudyMaterialPaths>>,
    subjectId?: string | null,
  ): Promise<void> => {
    const decision = await decideStudyMaterialAiProcessing(results, subjectId, getWindow());
    if (!decision.process) return;
    queueStudyKnowledgeSources('material', results.map((result) => result.material.id), false, {
      approved: true,
      externalConsentModelKey: decision.externalConsentModelKey,
    });
  };

  // ── Corpus: works and ideas ─────────────────────────────────────────────────
  h('works:list', async (_e, filter?: WorkFilter) => works.listWorks(filter));
  h('works:listPage', async (_e, filter, request) => works.listWorksPage(filter, request));
  h('works:listZoteroTags', async () => works.listZoteroTags());
  h('works:get', async (_e, nodusId: string) => works.getWork(nodusId));
  h('works:ingestZoteroItems', async (_e, items: ZoteroItem[]) => {
    const { readTag } = getSettings();
    const out = [];
    for (const item of items) {
      const { nodusId } = ingestZoteroItem(item, readTag);
      const w = works.getWork(nodusId);
      if (w) out.push(w);
    }
    return out;
  });
  h('works:setManualDeep', async (_e, nodusId: string, value: boolean, model?: ModelRef | null) => {
    works.setManualDeep(nodusId, value);
    const w = works.getWork(nodusId);
    if (value && w) {
      works.setDeepPending(nodusId);
      // A light scan first captures the broad "research line" parent themes that group
      // sibling ideas in the graph; the deep scan then preserves them.
      if (w.light_status !== 'done') {
        works.setLightPending(nodusId);
        scanQueue.enqueue(nodusId, w.title, 'light', model);
      }
      scanQueue.enqueue(nodusId, w.title, 'deep', model);
    }
  });
  h('works:setManualDeepBulk', async (_e, nodusIds: string[], value: boolean, model?: ModelRef | null) => {
    for (const id of nodusIds) {
      works.setManualDeep(id, value);
      if (value) {
        const w = works.getWork(id);
        if (w) {
          works.setDeepPending(id);
          if (w.light_status !== 'done') {
            works.setLightPending(id);
            scanQueue.enqueue(id, w.title, 'light', model);
          }
          scanQueue.enqueue(id, w.title, 'deep', model);
        }
      }
    }
  });
  h('works:analyzeBoth', async (_e, nodusId: string, model?: ModelRef | null) => {
    const w = works.getWork(nodusId);
    if (!w) return;
    // Themes first, then ideas — each as its own queue job so progress is visible.
    works.setLightPending(nodusId);
    scanQueue.enqueue(nodusId, w.title, 'light', model);
    works.setManualDeep(nodusId, true);
    works.setDeepPending(nodusId);
    scanQueue.enqueue(nodusId, w.title, 'deep', model);
  });
  h('works:analyzeBothBulk', async (_e, nodusIds: string[], model?: ModelRef | null) => {
    for (const id of nodusIds) {
      const w = works.getWork(id);
      if (!w) continue;
      works.setLightPending(id);
      scanQueue.enqueue(id, w.title, 'light', model);
      works.setManualDeep(id, true);
      works.setDeepPending(id);
      scanQueue.enqueue(id, w.title, 'deep', model);
    }
  });
  /**
   * Remove works from the current vault together with their derived data.
   *
   * Returns a result object instead of throwing on the one expected refusal, so the
   * renderer can word it in the reader's language. The refusal is the point: a running
   * analysis publishes its idea occurrences after the provider call returns, and those
   * rows have no foreign key to `works`, so deleting underneath it would resurrect
   * rows for a work that no longer exists.
   */
  h('works:delete', async (_e, nodusIds: string[]): Promise<WorkDeletionOutcome> => {
    const ids = [...new Set((nodusIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) return { ok: true, running: [], deleted: [], dormantIdeas: 0, globalLinks: 0 };

    const queueItems = scanQueue.snapshot().items;
    const running = worksRunningNow(ids, queueItems);
    if (running.length > 0) return { ok: false, running, deleted: [], dormantIdeas: 0, globalLinks: 0 };

    // Pending jobs go first: the queue must never pick up a work that is about to
    // disappear, and `removeItem` also asks a job that started meanwhile to settle.
    for (const item of queueItems) {
      if (ids.includes(item.nodus_id)) scanQueue.removeItem(item.id);
    }

    const vaultId = getActiveVault().id;
    return withOwningVault(vaultId, () => withVaultDatabase(vaultId, async () => {
    await documentaryPreparation.reconcileResearchDocumentOwnership();
    const result = deleteWorks(ids, { vaultId });
    // The Global Library index lives in its own database and only needs cleanup when it
    // is configured; a failure there must not undo a delete that already happened.
    let globalLinks = 0;
    try {
      globalLinks = removeGlobalLibraryLinksForWorks(vaultId, result.deleted);
    } catch (error) {
      console.error('[works:delete] no se pudieron limpiar los enlaces de la Biblioteca global', error);
    }
    // The document index keeps campaigns per vault; its jobs cascade away with the
    // works, so let it reconcile instead of discovering the gap on its next poll.
    if (vaultId) {
      void documentIndexQueue.refreshVault(vaultId).catch((error) => {
        console.error('[works:delete] no se pudo reconciliar la ficha documental', error);
      });
    }
    await documentaryPreparation.reconcileResearchDocumentOwnership();
    return { ok: true, running: [], deleted: result.deleted, dormantIdeas: result.dormantIdeas, globalLinks };
    }));
  });
  h('works:processFull', async (_e, nodusId: string, model?: ModelRef | null, options?: AnalysisRunOptions) => {
    processFullChain(nodusId, model, options);
  });
  h('works:processFullBulk', async (_e, nodusIds: string[], model?: ModelRef | null, options?: AnalysisRunOptions) => {
    for (const id of nodusIds) processFullChain(id, model, options);
  });
  h('works:reassignThemes', async (_e, model?: ModelRef | null) => {
    // Re-run the cheap (title+abstract) theme scan for every work so older works pick
    // up the broad parent themes that group their ideas in the graph. Each light scan
    // replaces that work's broad themes so stale one-off labels disappear over time.
    const all = getDb().prepare('SELECT nodus_id, title FROM works WHERE archived = 0').all() as {
      nodus_id: string;
      title: string;
    }[];
    for (const w of all) {
      works.setLightPending(w.nodus_id);
      scanQueue.enqueue(w.nodus_id, w.title, 'light', model);
    }
    return all.length;
  });
  h('works:meta', async (_e, nodusId: string) => {
    const w = works.getWork(nodusId);
    if (!w) return null;
    const { zoteroUserId } = getSettings();
    const meta = await zotero.getItemMeta(zoteroUserId, w.zotero_key).catch(() => null);
    if (!meta) return null;
    return meta;
  });
  h('works:rescan', async (_e, nodusId: string, kind: QueueKind, model?: ModelRef | null) => {
    const w = works.getWork(nodusId);
    if (!w) return;
    if (kind === 'deep') {
      works.setDeepPending(nodusId);
    } else if (kind === 'summary') {
      works.setSummaryPending(nodusId);
    } else {
      works.setLightPending(nodusId);
    }
    scanQueue.enqueue(nodusId, w.title, kind, model);
  });
  h('works:rescanDegraded', async (_e, model?: ModelRef | null) => {
    // Re-scan works that only ever saw the abstract (e.g. the PDF wasn't attached/
    // indexed when they were first analysed). A bare enqueue is idempotent: if the
    // resolved text is unchanged, runDeepScan re-commits the same result and returns
    // without calling the model, so no tokens are spent.
    const rows = getDb()
      .prepare(
        `SELECT nodus_id, title FROM works
          WHERE archived = 0
            AND deep_status IN ('done','failed','skipped_no_text')
            AND (
              COALESCE(resolved_source_type, source_type) IN ('abstract_only','none')
              OR text_block_reason IS NOT NULL
            )`
      )
      .all() as { nodus_id: string; title: string }[];
    for (const w of rows) scanQueue.enqueue(w.nodus_id, w.title, 'deep', model);
    return rows.length;
  });
  h('works:summarize', async (_e, nodusId: string, model?: ModelRef | null) => {
    const work = works.getWork(nodusId);
    if (!work) return;
    works.setSummaryPending(nodusId);
    scanQueue.enqueue(nodusId, work.title, 'summary', model);
  });
  h('works:summarizeBulk', async (_e, nodusIds: string[], model?: ModelRef | null) => {
    for (const nodusId of nodusIds) {
      const work = works.getWork(nodusId);
      if (!work) continue;
      works.setSummaryPending(nodusId);
      scanQueue.enqueue(nodusId, work.title, 'summary', model);
    }
  });
  h('works:summarizeAll', async (_e, model?: ModelRef | null) => {
    const all = works.listWorks();
    let enqueued = 0;
    for (const work of all) {
      if (
        work.summary_status === 'done' &&
        work.summary_hash === summaryContentHash(work, model) &&
        workSummaries.getWorkSummary(work.nodus_id)
      ) continue;
      works.setSummaryPending(work.nodus_id);
      scanQueue.enqueue(work.nodus_id, work.title, 'summary', model);
      enqueued++;
    }
    return enqueued;
  });
  h('works:getSummary', async (_e, nodusId: string) => workSummaries.getWorkSummary(nodusId));
  h('works:collectionFacets', async () => listCollectionFacets());
  h('works:listDuplicates', async () => dedupe.listDuplicateWorks());
  h('works:merge', async (_e, canonicalId: string, duplicateIds: string[]) =>
    dedupe.mergeWorks(canonicalId, duplicateIds)
  );
  h('ideas:listDuplicates', async () => ideaDedupe.listDuplicateIdeas());
  h('ideas:merge', async (_e, canonicalId: string, duplicateIds: string[]) =>
    ideaDedupe.mergeIdeas(canonicalId, duplicateIds)
  );
  h('ideas:backup', async () => ideaDedupe.backupDatabase());
  h('works:openInZotero', async (_e, zoteroKey: string) => {
    const { zoteroUserId } = getSettings();
    await shell.openExternal(zoteroSelectUrl(zoteroKey));
    return zoteroUserId;
  });
  // Evidence → the exact PDF page. The [[p. N]] markers the extractor writes are
  // physical 1-based page indices, which is exactly what zotero://open-pdf
  // expects, so Zotero's reader is tried first whenever the work has a PDF
  // attachment there. Zotero is not the only possible destination though: a work
  // can have no item in Zotero at all, or Zotero can be closed (resolving the
  // attachment then fails), and the corpus copy in the Nodus library can still
  // show that page. In that case the renderer is told which document to open
  // instead of silently degrading to "select the item", which is what left every
  // citation on page 1.
  h('works:openAtPage', async (_e, nodusId: string, locator: string | null | { location?: string | null; sourceRef?: string | null; pageNumber?: number | null }): Promise<OpenEvidenceAtPageResult> => {
    const work = works.getWork(nodusId);
    const structured = locator && typeof locator === 'object' ? locator : null;
    const location = typeof locator === 'string' || locator === null ? locator : structured?.location ?? null;
    const page = structured?.pageNumber ?? parsePageNumber(location);
    const source = structured?.sourceRef
      ? getDb().prepare('SELECT attachment_key FROM work_text_sources WHERE nodus_id=? AND source_ref=?')
        .get(nodusId, structured.sourceRef) as { attachment_key: string | null } | undefined
      : undefined;
    if (page !== null && work?.zotero_key) {
      const attachmentKey = source?.attachment_key
        ?? await zotero.resolvePdfAttachmentKey(getSettings().zoteroUserId, work.zotero_key);
      if (attachmentKey) {
        await shell.openExternal(zoteroOpenPdfUrl(attachmentKey, page));
        return { ok: true, mode: 'pdf-page', page, local: null };
      }
    }
    const local = page !== null ? pageCapableLibraryCopy(nodusId) : null;
    if (local) return { ok: false, mode: 'local', page, local };
    if (work?.zotero_key) {
      await shell.openExternal(zoteroSelectUrl(source?.attachment_key ?? work.zotero_key));
      return { ok: true, mode: 'select', page, local: null };
    }
    return { ok: false, mode: 'none', page, local: null };
  });
  h('libraryReader:get', async (_e, nodusId: string) => libraryReader.getLibraryReaderDocument(nodusId));
  h('libraryReader:attachmentContent', async (_e, nodusId: string, attachmentId: string) =>
    getLibraryReaderAttachmentContentInWorker(nodusId, attachmentId));
  h('libraryReader:attachmentBytes', async (_e, nodusId: string, attachmentId: string) =>
    libraryReader.getLibraryReaderAttachmentBytes(nodusId, attachmentId));
  h('libraryReader:openOriginal', async (_e, nodusId: string) => {
    const originalPath = libraryReader.libraryReaderOriginalPath(nodusId);
    if (!originalPath) return false;
    return (await shell.openPath(originalPath)) === '';
  });
  h('libraryReader:annotations:list', async (_e, nodusId: string) =>
    libraryReader.listLibraryReaderAnnotations(nodusId)
  );
  h('libraryReader:annotations:listOrphaned', async (_e, nodusId: string) =>
    libraryReader.listLibraryReaderOrphanedAnnotations(nodusId)
  );
  h('libraryReader:annotations:create', async (_e, nodusId: string, input: WritingDraftAnnotationInput) => {
    const annotation = await createLibraryReaderAnnotationInWorker(nodusId, { ...input, draftId: nodusId });
    announceLibraryReaderAnnotations(nodusId);
    return annotation;
  });
  h('libraryReader:annotations:updateComment', async (_e, nodusId: string, id: string, comment: string) => {
    const annotation = await updateLibraryReaderCommentInWorker(nodusId, id, comment);
    if (annotation) announceLibraryReaderAnnotations(nodusId);
    return annotation;
  });
  h('libraryReader:annotations:delete', async (_e, nodusId: string, id: string) => {
    const deleted = await deleteLibraryReaderAnnotationInWorker(nodusId, id);
    if (deleted) announceLibraryReaderAnnotations(nodusId);
    return deleted;
  });
  h('libraryReader:chat:list', async (_e, nodusId: string) =>
    libraryReader.listLibraryReaderChatMessages(nodusId)
  );
  h('libraryReader:chat:clear', async (_e, nodusId: string) => {
    libraryReader.clearLibraryReaderChat(nodusId);
  });
  h('libraryReader:chat:stream', async (event, requestId: string, request: LibraryReaderChatRequest) => {
    const controller = new AbortController();
    libraryReaderChatAborters.set(requestId, controller);
    try {
      const response = await streamLibraryReaderChat(
        request,
        (delta, kind) => event.sender.send(
          kind === 'reasoning' ? 'libraryReader:chat:reasoning' : 'libraryReader:chat:delta',
          requestId,
          delta,
        ),
        controller.signal,
      );
      const persisted: LibraryReaderChatMessage[] = [
        ...request.messages,
        ...(response.answer ? [{
          id: `assistant:${requestId}`,
          role: 'assistant' as const,
          content: response.answer,
          createdAt: new Date().toISOString(),
        }] : []),
      ];
      libraryReader.saveLibraryReaderChatMessages(request.documentId, persisted);
      return response;
    } finally {
      libraryReaderChatAborters.delete(requestId);
    }
  });
  h('libraryReader:chat:cancel', async (_e, requestId: string) => {
    libraryReaderChatAborters.get(requestId)?.abort();
  });
  h('study:knowledge:processing:resolve', async (event, requestId: string, decision) => {
    resolveStudyMaterialAiProcessingRequest(event.sender.id, requestId, decision);
  });
  h('works:uploadText', async (_e, nodusId: string, filePath: string) => {
    const w = getDb().prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as any;
    if (!w) return;
    const s = getSettings();
    const doc = await extractFromPath(filePath, {
      ocr: { enabled: s.ocrEnabled, languages: s.ocrLanguages, maxPages: s.ocrMaxPages },
      perf: { nodusId, title: w.title },
    });
    // This path scans OUTSIDE the queue, so nothing else will ever clear the queued
    // marker setDeepPending leaves behind. Without the finally, a failed upload scan
    // would have resumePending() start a queued scan of this work on the next launch —
    // one that resolves text from Zotero and overwrites the uploaded-text analysis.
    works.setDeepPending(nodusId);
    try {
      await runDeepScan(w, doc);
    } finally {
      // Ask the queue rather than clearing outright: this work may also have a deep job
      // waiting, and zeroing the marker under it would lose that job on the next launch.
      scanQueue.syncDeepQueued(nodusId);
    }
  });

  // queue
  h('queue:get', async () => scanQueue.snapshot());
  h('queue:pause', async () => scanQueue.pause());
  h('queue:resume', async () => scanQueue.resume());
  h('queue:cancelItem', async (_e, id: string) => scanQueue.cancelItem(id));
  h('queue:removeItem', async (_e, id: string) => scanQueue.removeItem(id));
  h('queue:moveToTop', async (_e, id: string) => scanQueue.moveToTop(id));
  h('queue:clear', async () => scanQueue.clear());
  h('queue:stopAll', async () => scanQueue.stopAll());
  h('queue:retryFailed', async () => scanQueue.retryFailed());
  h('queue:enqueueBridge', async (_e, model?: ModelRef | null) => scanQueue.enqueueBridge(model));
  h('documents:profile:get', async (_e, nodusId: string) => getDocumentProfile(nodusId));
  h('documents:profile:override:save', async (_e, input: {
    nodusId: string; fieldPath: string; value: string; generatedValue: string;
    baseVersionId: string; verified?: boolean;
  }) => upsertDocumentProfileOverride(input));
  h('documents:profile:override:delete', async (_e, overrideId: string) => deleteDocumentProfileOverride(overrideId));
  h('documents:profile:statuses', async (_e, nodusIds?: string[]) => documentProfileStatuses(nodusIds));
  h('documents:index:progress', async () => documentIndexQueue.snapshot());
  h('documents:index:startCampaign', async (_e, options?: { includeArchived?: boolean; nodusIds?: string[] }) => {
    const vault = getActiveVault();
    return documentIndexQueue.startVaultCampaign(vault.id, { ...options, mode: 'manual' });
  });
  h('documents:index:enqueue', async (_e, nodusId: string, vaultId?: string) => {
    await documentIndexQueue.enqueueWork(vaultId ?? getActiveVault().id, nodusId, 750, 'manual');
  });
  h('documents:index:campaignStatus', async (_e, vaultId: string, campaignId: string, status: 'running' | 'paused' | 'cancelled') => {
    await documentIndexQueue.setCampaignStatus(vaultId, campaignId, status);
  });
  h('documents:index:cancelJob', async (_e, jobId: string, vaultId?: string) => {
    await documentIndexQueue.cancelJob(vaultId ?? getActiveVault().id, jobId);
  });

  // Stellar canvas
  h('stellar:page', async (_e, request) => stellarPage(request));
  h('stellar:themes', async () => stellarThemes());
  h('stellar:session', async (_e, key) => getStellarSession(key));
  h('stellar:save', async (_e, vaultId, key, state) => saveStellarSession(vaultId, key, state));
  // graph
  h('graph:get', async (_e, lens: 'ideas' | 'authors') =>
    lens === 'authors' ? buildAuthorGraph() : buildIdeaGraph()
  );
  h('ideas:listPage', async (_e, request) => ideas.listIdeasPage(request));
  h('ideas:picker', async () => ideas.listPickerIdeas());
  h('ideas:connections', async (_e, globalId: string) => ideas.listIdeaConnections(globalId));
  h('graph:ideaDetail', async (_e, globalId: string) => ideas.getIdeaDetail(globalId));
  h('ideas:delete', async (_e, globalId: string) => ideas.deleteIdea(globalId));
  h('graph:edgeDetail', async (_e, edgeId: string) => ideas.getEdgeDetail(edgeId));
  h('graph:ideaEdges', async (_e, globalId: string) => ideas.getIdeaEdges(globalId));
  h('graph:edgeFeedback:set', async (_e, fromId: string, toId: string, type: string, verdict: 'rejected' | 'confirmed' | null, note?: string) =>
    setEdgeFeedback(fromId, toId, type, verdict, note ?? '')
  );
  h('graph:edgeFeedback:list', async () => listEdgeFeedback());
  h('works:ideasByWork', async (_e, nodusId: string, limit: number, offset: number) =>
    ideas.getIdeasByWork(nodusId, limit, offset)
  );
  h('works:getIdeaSynthesis', async (_e, nodusId: string) => getCachedWorkIdeaSynthesis(nodusId));
  h('works:synthesizeIdeas', async (_e, nodusId: string, model?: ModelRef | null) =>
    synthesizeWorkIdeas(nodusId, model)
  );
  h('graph:themes', async () => themes.listGraphThemes());

  // authors (dossier + synthesis matrix)
  h('authors:list', async () => listAuthors());
  h('authors:listPage', async (_e, request) => listAuthorsPage(request));
  h('authors:setSaved', async (_e, authorId: string, saved: boolean) => setAuthorSaved(authorId, saved));
  h('authors:dossier', async (_e, authorId: string) => buildAuthorDossier(authorId));
  h('authors:synthesize', async (_e, authorId: string, model?: ModelRef | null) =>
    synthesizeAuthorDossier(authorId, model)
  );
  h('authors:matrix', async () => buildSynthesisMatrix());
  h('authors:matrixCell', async (_e, authorId: string, themeId: string, model?: ModelRef | null) =>
    synthesizeMatrixCell(authorId, themeId, model)
  );
  h('authors:exportSyntheses', async (_e, request: AuthorSynthesisExportRequest) => exportAuthorSyntheses(request));

  // study guide
  h('study:workspace', async (_e, options?: StudyWorkspaceOptions) => studyOrg.getStudyWorkspace(options));
  h('study:schedule:get', async (_e, academicYearId?: string | null) => studySchedule.getStudySchedule(academicYearId ?? null));
  h('study:schedule:save', async (_e, schedule: StudySchedule) => studySchedule.saveStudySchedule(schedule));
  h('study:schedule:copy', async (_e, fromAcademicYearId: string | null, toAcademicYearId: string | null) =>
    studySchedule.copyStudySchedule(fromAcademicYearId, toAcademicYearId));
  h('study:academicYear:create', async (_e, input: CreateStudyAcademicYearInput) => studyOrg.createStudyAcademicYear(input));
  h('study:academicYear:update', async (_e, id: string, patch: UpdateStudyAcademicYearInput) => studyOrg.updateStudyAcademicYear(id, patch));
  h('study:academicYear:delete', async (_e, id: string) => { studyOrg.deleteStudyAcademicYear(id); });
  h('study:course:create', async (_e, input: CreateStudyCourseInput) => studyOrg.createStudyCourse(input));
  h('study:subject:create', async (_e, input: CreateStudySubjectInput) => studyOrg.createStudySubject(input));
  h('study:topic:create', async (_e, input: CreateStudyTopicInput) => studyOrg.createStudyTopic(input));
  h('study:folder:create', async (_e, input: CreateStudyFolderInput) => studyOrg.createStudyFolder(input));
  h('study:document:create', async (_e, input: CreateStudyDocumentInput) => {
    const result = studyOrg.createStudyDocument(input); queueStudyKnowledgeSources('document', [result.id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:entity:update', async (_e, kind: StudyEntityKind, id: string, patch: Record<string, unknown>) =>
    studyOrg.updateStudyEntity(kind, id, patch));
  h('study:entity:move', async (_e, kind: 'subject' | 'folder' | 'topic', id: string, input: StudyEntityMoveInput) => {
    const result = studyOrg.moveStudyEntity(kind, id, input);
    const materialIds = (getDb().prepare('SELECT id FROM study_materials WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
    const documentIds = (getDb().prepare('SELECT id FROM study_docs WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
    for (const sourceId of materialIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', sourceId);
    for (const sourceId of documentIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', sourceId);
    queueStudyKnowledgeSources('material', materialIds); queueStudyKnowledgeSources('document', documentIds); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:add', async (_e, documentId: string, input: StudyPlacementInput) => {
    const result = studyOrg.addStudyPlacement(documentId, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', documentId);
    queueStudyKnowledgeSources('document', [documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:setPrimary', async (_e, documentId: string, input: StudyPlacementInput) => {
    const result = studyOrg.setPrimaryStudyPlacement(documentId, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', documentId);
    queueStudyKnowledgeSources('document', [documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:move', async (_e, documentId: string, placementId: string | null, destination: StudyPlacementInput) => {
    const result = studyOrg.moveStudyPlacement(documentId, placementId, destination);
    studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', documentId);
    // Relocation preserves generated knowledge and never starts a new AI analysis.
    studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:remove', async (_e, id: string) => {
    const row = getDb().prepare('SELECT document_id FROM study_placements WHERE id=?').get(id) as { document_id: string } | undefined;
    const result = studyOrg.removeStudyPlacement(id); if (row) { studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', row.document_id); queueStudyKnowledgeSources('document', [row.document_id]); studySearch.queueStudySearchIndexRefresh(); }
    return result;
  });
  h('study:lifecycle:set', async (_e, kind: StudyEntityKind, id: string, action: StudyLifecycleAction, options?: { purgeLinkedKnowledge?: boolean }) => {
    const destructive = action === 'trash';
    const purgeLinkedKnowledge = destructive && options?.purgeLinkedKnowledge !== false;
    if (kind === 'document' && purgeLinkedKnowledge) studyKnowledgeRepo.purgeStudyKnowledgeSource('document', id);
    const result = studyOrg.setStudyLifecycle(kind, id, action);
    if (kind === 'document') {
      if (!destructive || purgeLinkedKnowledge) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', id);
      if (action === 'restore' || action === 'recover') queueStudyKnowledgeSources('document', [id]);
      studySearch.queueStudySearchIndexRefresh();
    }
    else {
      const materialIds = (getDb().prepare('SELECT id FROM study_materials WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
      const documentIds = (getDb().prepare('SELECT id FROM study_docs WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
      for (const sourceId of materialIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', sourceId);
      for (const sourceId of documentIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', sourceId);
      if (action === 'restore' || action === 'recover') { queueStudyKnowledgeSources('material', materialIds); queueStudyKnowledgeSources('document', documentIds); }
      studySearch.queueStudySearchIndexRefresh();
    }
    return result;
  });
  h('study:tree:duplicate', async (_e, kind: StudyEntityKind, id: string) => studyOrg.duplicateStudyTree(kind, id));
  h('study:tag:create', async (_e, input: CreateStudyTagInput) => studyOrg.createStudyTag(input));
  h('study:tag:update', async (_e, id: string, patch: Partial<CreateStudyTagInput> & { favorite?: boolean; position?: number }) =>
    studyOrg.updateStudyTag(id, patch));
  h('study:tag:delete', async (_e, id: string) => studyOrg.deleteStudyTag(id));
  h('study:document:setTags', async (_e, documentId: string, tagIds: string[]) =>
    studyOrg.setStudyDocumentTags(documentId, tagIds));
  h('study:template:create', async (_e, input: CreateStudyTemplateInput) => studyOrg.createStudyTemplate(input));
  h('study:template:update', async (_e, id: string, patch: Partial<CreateStudyTemplateInput> & { favorite?: boolean; position?: number }) =>
    studyOrg.updateStudyTemplate(id, patch));
  h('study:template:delete', async (_e, id: string) => studyOrg.deleteStudyTemplate(id));
  h('study:template:apply', async (_e, id: string, name?: string) => studyOrg.applyStudyTemplate(id, name));
  h('study:editor:data', async (_e, documentId: string) => studyEditor.getStudyDocEditorData(documentId));
  h('study:editor:update', async (_e, documentId: string, input: StudyDocUpdateInput) => {
    const result = studyEditor.updateStudyDoc(documentId, input);
    if (process.env.NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI !== '1') {
      queueStudyKnowledgeSources('document', [documentId]);
      studySearch.queueStudySearchIndexRefresh();
    }
    return result;
  });
  h('study:editor:restore', async (_e, documentId: string, versionId: string) => {
    const result = studyEditor.restoreStudyDocVersion(documentId, versionId);
    if (process.env.NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI !== '1') {
      queueStudyKnowledgeSources('document', [documentId]);
      studySearch.queueStudySearchIndexRefresh();
    }
    return result;
  });
  h('study:annotation:create', async (_e, documentId: string, input: StudyAnnotationInput) => studyEditor.createStudyAnnotation(documentId, input));
  h('study:annotation:update', async (_e, id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }) =>
    studyEditor.updateStudyAnnotation(id, patch));
  h('study:annotation:delete', async (_e, id: string) => studyEditor.deleteStudyAnnotation(id));
  h('study:stt:transcribe', async (event, request: StudySttRequest) => {
    const provider = request.provider ?? getSettings().sttProvider;
    let result;
    if (provider === 'whisper_cpp') {
      result = await transcribeWhisperCpp(request, {
        onProgress: (fraction) => event.sender.send('study:stt:progress', request.requestId, fraction),
        onPartial: (text) => event.sender.send('study:stt:partial', request.requestId, text),
      });
    } else if (provider === 'openai') {
      result = await transcribeOpenAiStudyAudio(request);
    } else {
      throw new Error('Transformers.js se ejecuta en el worker local del renderer.');
    }
    event.sender.send('study:stt:complete', request.requestId);
    return result;
  });
  h('study:stt:cancel', async (_event, requestId: string) => cancelWhisperCpp(requestId));
  h('study:stt:whisperCpp:status', async () => getWhisperCppStatus());
  h('study:stt:whisperCpp:install', async () => installWhisperCpp());
  h('study:stt:whisperCpp:uninstall', async () => uninstallWhisperCpp());
  h('study:stt:whisperCpp:chooseExecutable', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('selectWhisperCli', getSettings().uiLanguage),
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    updateSettings({ sttWhisperCppExecutable: picked.filePaths[0] });
    return picked.filePaths[0];
  });
  h('study:stt:whisperCpp:download', async (event, requestId: string, model: string) =>
    downloadWhisperCppModel(model, (fraction) => event.sender.send('study:stt:modelProgress', requestId, fraction)));
  h('study:stt:whisperCpp:delete', async (_event, model: string) => deleteWhisperCppModel(model));
  h('study:styles:list', async (_e, options?: { includeArchived?: boolean; search?: string }) => studyStyles.listStudyStyles(options));
  h('study:styles:create', async (_e, input: StudyStyleInput) => studyStyles.createStudyStyle(input));
  h('study:styles:update', async (_e, id: string, patch: Partial<StudyStyleInput>) => studyStyles.updateStudyStyle(id, patch));
  h('study:styles:duplicate', async (_e, id: string) => studyStyles.duplicateStudyStyle(id));
  h('study:styles:archive', async (_e, id: string, archived: boolean) => studyStyles.archiveStudyStyle(id, archived));
  h('study:styles:delete', async (_e, id: string) => studyStyles.deleteStudyStyle(id));
  h('study:styles:versions', async (_e, styleId: string) => studyStyles.listStudyStyleVersions(styleId));
  h('study:styles:restore', async (_e, styleId: string, versionId: string) => studyStyles.restoreStudyStyleVersion(styleId, versionId));
  h('study:styles:associations', async () => studyStyles.listStudyStyleAssociations());
  h('study:styles:associate', async (_e, styleId: string, kind: StudyStyleAssociationKind, targetId?: string, isDefault?: boolean) =>
    studyStyles.setStudyStyleAssociation(styleId, kind, targetId, isDefault));
  h('study:styles:default', async (_e, subjectId?: string | null, documentKind?: string | null) =>
    studyStyles.resolveStudyStyleDefault(subjectId, documentKind));
  h('study:styles:export', async (_e, styleIds?: string[]) => {
    const payload = studyStyles.exportStudyStyles(styleIds);
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('exportStudyStyles', getSettings().uiLanguage), defaultPath: 'nodus-study-styles.json', filters: [{ name: 'Nodus Study Styles', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { path: picked.filePath };
  });
  h('study:styles:import', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('importStudyStyles', getSettings().uiLanguage), properties: ['openFile'], filters: [{ name: 'Nodus Study Styles', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return [];
    const payload = JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8')) as StudyStyleExport;
    return studyStyles.importStudyStyles(payload);
  });
  h('study:improve', async (e, requestId: string, request: StudyImproveRequest) => {
    const controller = new AbortController();
    studyImproveAborters.set(requestId, controller);
    try {
      return await improveStudyText(request, (delta) => {
        if (!e.sender.isDestroyed()) e.sender.send('study:improve:delta', requestId, delta);
      }, controller.signal);
    } finally {
      studyImproveAborters.delete(requestId);
    }
  });
  h('study:synonyms', async (_e, request: StudySynonymRequest) => suggestStudySynonyms(request));
  h('study:improve:cancel', async (_e, requestId: string) => studyImproveAborters.get(requestId)?.abort());
  h('study:improve:log', async (_e, documentId: string) => studyStyles.listStudyImprovementLog(documentId));
  h('study:improve:action', async (_e, id: string, action: StudyImprovementLog['action']) => studyStyles.updateStudyImprovementAction(id, action));
  h('study:materials:list', async (_e, options?: StudyMaterialListOptions) => studyMaterials.listStudyMaterials(options));
  h('study:materials:get', async (_e, id: string) => studyMaterials.getStudyMaterial(id));
  h('study:materials:content', async (_e, id: string) => studyMaterials.getStudyMaterialContent(id));
  h('study:materials:download', async (_e, id: string) => {
    const material = studyMaterials.getStudyMaterial(id);
    if (material.origin === 'zotero_link') throw new Error('Este material es un enlace de Zotero y no contiene un fichero local que descargar.');
    const content = studyMaterials.getStudyMaterialContent(id);
    const safeName = path.basename(material.fileName).replace(/[\\/:*?"<>|]+/g, '-') || `material.${material.extension || 'bin'}`;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('downloadMaterial', getSettings().uiLanguage),
      defaultPath: safeName,
      filters: material.extension ? [{ name: material.extension.toUpperCase(), extensions: [material.extension] }] : undefined,
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, Buffer.from(content.bytes));
    return { path: picked.filePath };
  });
  h('study:materials:import', async (_e, input?: StudyMaterialImportInput) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('addStudyMaterials', getSettings().uiLanguage), properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Materiales de estudio', extensions: ['pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg', 'zip'] }],
    });
    if (picked.canceled) return [];
    const results = await importStudyMaterialPaths(picked.filePaths, input);
    queueStudyMaterialIndex(results.map((result) => result.material.id));
    await queueImportedStudyKnowledge(results, input?.subjectId);
    return results;
  });
  h('study:materials:importFolder', async (_e, input?: StudyMaterialImportInput) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, { title: dialogTitle('addMaterialsFolder', getSettings().uiLanguage), properties: ['openDirectory'] });
    if (picked.canceled) return [];
    const results = await importStudyMaterialPaths(picked.filePaths, input);
    queueStudyMaterialIndex(results.map((result) => result.material.id));
    await queueImportedStudyKnowledge(results, input?.subjectId);
    return results;
  });
  h('study:materials:choosePaths', async (_e, folder?: boolean) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, folder ? {
      title: dialogTitle('selectMaterialsFolder', getSettings().uiLanguage), properties: ['openDirectory'],
    } : {
      title: dialogTitle('selectStudyMaterials', getSettings().uiLanguage), properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Materiales de estudio', extensions: ['pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg', 'zip'] }],
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  h('study:materials:importPaths', async (_e, paths: string[], input?: StudyMaterialImportInput) => {
    const safePaths = [...new Set(paths.filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0))];
    const results = await importStudyMaterialPaths(safePaths, input);
    queueStudyMaterialIndex(results.map((result) => result.material.id));
    await queueImportedStudyKnowledge(results, input?.subjectId);
    return results;
  });
  h('study:materials:importZotero', async (_e, input: ZoteroStudyMaterialImportInput) => {
    const { zoteroUserId } = getSettings();
    const canonicalItemKey = input.library.type === 'group' ? `groups:${input.library.id}:${input.itemKey}` : input.itemKey;
    const item = await zotero.getItem(zoteroUserId, canonicalItemKey, input.library);
    if (!item) throw new Error('El elemento ya no está disponible en Zotero.');
    const attachments = await zotero.itemAttachments(zoteroUserId, canonicalItemKey, input.library);
    const attachment = input.attachmentKey
      ? attachments.find((candidate) => candidate.itemKey === input.attachmentKey || candidate.key === input.attachmentKey) ?? null
      : attachments[0] ?? null;
    const placement: StudyMaterialImportInput = {
      courseId: input.courseId, subjectId: input.subjectId, topicId: input.topicId,
      folderId: input.folderId, documentId: input.documentId, readState: input.readState,
      tags: input.tags, ocr: input.ocr,
    };
    if (input.mode === 'link') {
      return studyMaterials.linkStudyMaterialFromZotero(input.library, item, attachment, placement);
    }
    if (!attachment) throw new Error('Elige un adjunto para importarlo a Nodus.');
    const filePath = await zotero.attachmentFilePath(zoteroUserId, attachment.key);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('El adjunto no está descargado en este equipo. Ábrelo o descárgalo primero desde Zotero.');
    if (!studyMaterials.supportsStudyMaterial(filePath)) throw new Error(`Formato no compatible: .${path.extname(filePath).replace(/^\./, '') || '?'}`);
    const result = await studyMaterials.importStudyMaterialFromZotero(filePath, input.library, item, attachment, placement);
    queueStudyMaterialIndex([result.material.id]);
    await queueImportedStudyKnowledge([result], input.subjectId);
    return result;
  });
  h('study:materials:openZotero', async (_e, id: string) => {
    const material = studyMaterials.getStudyMaterial(id);
    if (!material.zoteroItemKey || !material.zoteroLibraryType || !material.zoteroLibraryId) throw new Error('Este material no conserva un enlace con Zotero.');
    const key = material.zoteroLibraryType === 'group'
      ? `groups:${material.zoteroLibraryId}:${material.zoteroAttachmentKey || material.zoteroItemKey}`
      : material.zoteroAttachmentKey || material.zoteroItemKey;
    await shell.openExternal(zoteroSelectUrl(key));
  });
  h('study:materials:replace', async (_e, id: string, ocr?: boolean) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('replaceMaterialFile', getSettings().uiLanguage), properties: ['openFile'],
      filters: [{ name: 'Materiales de estudio', extensions: ['pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const updated = await studyMaterials.replaceStudyMaterialFile(id, picked.filePaths[0], Boolean(ocr));
    queueStudyMaterialIndex([id]);
    queueStudyKnowledgeSources('material', [id], true);
    return updated;
  });
  h('study:materials:update', async (_e, id: string, patch: StudyMaterialUpdateInput) => {
    const updated = studyMaterials.updateStudyMaterial(id, patch);
    if (patch.title !== undefined || patch.description !== undefined || patch.metadata !== undefined || patch.bibliography !== undefined) { queueStudyMaterialIndex([id]); queueStudyKnowledgeSources('material', [id]); }
    return updated;
  });
  h('study:materials:reindex', async (_e, id: string) => reindexStudyMaterial(id));
  h('study:materials:version:restore', async (_e, id: string, versionId: string) => {
    const restored = studyMaterials.restoreStudyMaterialVersion(id, versionId);
    queueStudyMaterialIndex([id]);
    queueStudyKnowledgeSources('material', [id], true);
    return restored;
  });
  h('study:materials:placement:add', async (_e, id: string, input: StudyMaterialImportInput) => {
    const result = studyMaterials.addStudyMaterialPlacement(id, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    queueStudyKnowledgeSources('material', [id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:placement:move', async (_e, id: string, placementId: string | null, destination: StudyPlacementInput) => {
    // Relocation needs no extraction or AI generation. The lexical catalogue reads
    // placements directly and reuses existing vectors by content hash.
    return studyMaterials.moveStudyMaterialPlacement(id, placementId, destination);
  });
  h('study:materials:placement:setPrimary', async (_e, id: string, input: StudyMaterialImportInput) => {
    const result = studyMaterials.setPrimaryStudyMaterialPlacement(id, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    queueStudyKnowledgeSources('material', [id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:placement:remove', async (_e, id: string, placementId: string) => {
    const result = studyMaterials.removeStudyMaterialPlacement(id, placementId); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    queueStudyKnowledgeSources('material', [id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:annotation:create', async (_e, materialId: string, input: StudyMaterialAnnotationInput) => studyMaterials.createStudyMaterialAnnotation(materialId, input));
  h('study:materials:annotation:update', async (_e, id: string, patch: Partial<StudyMaterialAnnotationInput>) => studyMaterials.updateStudyMaterialAnnotation(id, patch));
  h('study:materials:annotation:delete', async (_e, id: string) => studyMaterials.deleteStudyMaterialAnnotation(id));
  h('study:materials:annotation:export', async (_e, id: string) => {
    const material = studyMaterials.getStudyMaterial(id);
    const content = studyMaterials.getStudyMaterialContent(id);
    const isPdf = material.extension === 'pdf';
    const isEpub = material.extension === 'epub';
    if (!isPdf && !isEpub) throw new Error('La exportación anotada solo está disponible para PDF y EPUB.');
    const extension = isPdf ? 'pdf' : 'epub';
    const baseName = path.basename(material.fileName, path.extname(material.fileName)).replace(/[\\/:*?"<>|]+/g, '-') || 'material';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('downloadAnnotatedMaterial', getSettings().uiLanguage), defaultPath: `${baseName}-anotado.${extension}`,
      filters: [{ name: isPdf ? 'PDF anotado' : 'EPUB anotado', extensions: [extension] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const bytes = isPdf ? await annotatedPdfBytes(content, material) : annotatedEpubBytes(content, material);
    fs.writeFileSync(picked.filePath, Buffer.from(bytes));
    return { path: picked.filePath };
  });
  h('study:materials:note:create', async (_e, materialId: string, annotationId?: string | null, title?: string) => {
    const result = studyMaterials.createStudyNoteFromMaterial(materialId, annotationId, title); queueStudyKnowledgeSources('document', [result.documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:lifecycle', async (_e, id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete', options?: { purgeLinkedKnowledge?: boolean }) => {
    const destructive = action === 'trash' || action === 'delete';
    const purgeLinkedKnowledge = destructive && options?.purgeLinkedKnowledge !== false;
    if (purgeLinkedKnowledge) studyKnowledgeRepo.purgeStudyKnowledgeSource('material', id);
    const result = studyMaterials.setStudyMaterialLifecycle(id, action);
    if (action !== 'delete' && (!destructive || purgeLinkedKnowledge)) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    if (action === 'restore' || action === 'recover') queueStudyKnowledgeSources('material', [id]);
    studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:recordings:list', async (_e, options?: StudyRecordingListOptions) => studyRecordings.listStudyRecordings(options));
  h('study:recordings:get', async (_e, id: string) => studyRecordings.getStudyRecording(id));
  h('study:recordings:content', async (_e, id: string) => studyRecordings.getStudyRecordingContent(id));

  h('study:recordings:create', async (_e, input: StudyRecordingCreateInput) => studyRecordings.createStudyRecording(input));
  h('study:recordings:import', async (_e, scope?: Omit<StudyRecordingCreateInput, 'bytes' | 'fileName' | 'mimeType'>) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('addClassRecordings', getSettings().uiLanguage), properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Grabaciones de audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm'] }],
    });
    if (picked.canceled) return [];
    return picked.filePaths.map((filePath) => studyRecordings.importStudyRecordingFile(filePath, scope));
  });
  h('study:recordings:update', async (_e, id: string, patch: StudyRecordingUpdateInput) => studyRecordings.updateStudyRecording(id, patch));
  h('study:recordings:marker:create', async (_e, recordingId: string, input: StudyAudioMarkerInput) => studyRecordings.createStudyAudioMarker(recordingId, input));
  h('study:recordings:marker:update', async (_e, id: string, patch: Partial<StudyAudioMarkerInput>) => studyRecordings.updateStudyAudioMarker(id, patch));
  h('study:recordings:marker:delete', async (_e, id: string) => studyRecordings.deleteStudyAudioMarker(id));
  h('study:recordings:transcript:save', async (_e, recordingId: string, input: StudyTranscriptInput) => studyRecordings.saveStudyTranscript(recordingId, input));
  h('study:recordings:transcript:update', async (_e, id: string, contentMarkdown: string, segments?: StudyTranscriptSegmentInput[]) => studyRecordings.updateStudyTranscript(id, contentMarkdown, segments));
  h('study:recordings:diarize', async (_e, request: StudyDiarizationRequest) => diarizeStudyRecording(request));
  h('study:recordings:segment:update', async (_e, id: string, patch: Partial<StudyTranscriptSegmentInput>) => studyRecordings.updateStudyTranscriptSegment(id, patch));
  h('study:recordings:transcript:delete', async (_e, id: string) => studyRecordings.deleteStudyTranscript(id));
  h('study:recordings:note:create', async (_e, recordingId: string, transcriptId: string, placements?: StudyPlacementInput[]) => {
    const result = studyRecordings.createStudyNoteFromTranscript(recordingId, transcriptId, placements); queueStudyKnowledgeSources('document', [result.documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:recordings:audio:delete', async (_e, id: string) => studyRecordings.deleteStudyRecordingAudio(id));
  h('study:recordings:lifecycle', async (_e, id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete') => studyRecordings.setStudyRecordingLifecycle(id, action));
  h('study:search:query', async (_e, query: string, options?: StudySearchOptions) => studySearch.searchStudyCorpus(query, options));
  h('study:search:status', async () => studySearch.getStudySearchIndexStatus());
  h('study:search:rebuild', async (e) => {
    const off = studySearch.onStudySearchProgress((next) => { if (!e.sender.isDestroyed()) e.sender.send('study:search:progress', localizedForUi(next)); });
    try { return await studySearch.rebuildStudySearchIndex(); } finally { off(); }
  });
  h('study:search:pause', async () => studySearch.pauseStudySearchIndex());
  h('study:search:resume', async () => studySearch.resumeStudySearchIndex());
  h('study:search:stop', async () => studySearch.stopStudySearchIndex());
  h('study:search:deleteIndex', async () => studySearch.deleteStudySearchIndex());
  h('study:search:exclude', async (_e, sourceId: string, excluded: boolean) => studySearch.setStudySearchSourceExcluded(sourceId, excluded));
  h('study:search:saved:list', async () => studySearch.listStudySavedSearches());
  h('study:search:saved:create', async (_e, name: string, query: string, options: StudySearchOptions) => studySearch.saveStudySearch(name, query, options));
  h('study:search:saved:delete', async (_e, id: string) => studySearch.deleteStudySavedSearch(id));
  h('study:search:history:list', async () => studySearch.listStudySearchHistory());
  h('study:search:history:clear', async () => studySearch.clearStudySearchHistory());
  h('study:knowledge:ideas', async (_e, subjectId: string, query?: string) => studyKnowledgeRepo.listStudyIdeas(subjectId, query));
  h('study:knowledge:idea', async (_e, id: string) => studyKnowledgeRepo.getStudyIdeaDetail(id));
  h('study:knowledge:idea:delete', async (_e, id: string) => studyKnowledgeRepo.deleteStudyIdea(id));
  h('study:knowledge:graph', async (_e, subjectId: string) => studyKnowledgeRepo.getStudyKnowledgeGraph(subjectId));
  h('study:knowledge:jobs', async (_e, subjectId?: string) => studyKnowledgeRepo.listStudyKnowledgeJobs(subjectId));
  h('study:knowledge:progress', async () => getStudyKnowledgeProgress());
  h('study:knowledge:reanalyze', async (_e, sourceKind: 'material' | 'document', sourceId: string) => reanalyzeStudyKnowledgeSource(sourceKind, sourceId));
  h('study:assistant:sources', async () => studyAssistant.getStudyAssistantSources());
  h('study:assistant:list', async (_e, includeArchived?: boolean) => studyAssistant.listStudyAssistantConversations(Boolean(includeArchived)));
  h('study:assistant:get', async (_e, id: string) => studyAssistant.getStudyAssistantConversation(id));
  h('study:assistant:create', async (_e, input?: StudyAssistantConversationInput) => studyAssistant.createStudyAssistantConversation(input));
  h('study:assistant:update', async (_e, id: string, patch: StudyAssistantConversationPatch) => studyAssistant.updateStudyAssistantConversation(id, patch));
  h('study:assistant:delete', async (_e, id: string) => studyAssistant.deleteStudyAssistantConversation(id));
  h('study:assistant:stream', async (e, requestId: string, request: StudyAssistantRequest) => {
    const controller = new AbortController(); studyAssistantAborters.set(requestId, controller);
    try {
      return await studyAssistant.streamStudyAssistant(request, (delta, kind) => {
        if (!e.sender.isDestroyed()) e.sender.send(kind === 'reasoning' ? 'study:assistant:reasoning' : 'study:assistant:delta', requestId, delta);
      }, controller.signal);
    } finally { studyAssistantAborters.delete(requestId); }
  });
  h('study:assistant:cancel', async (_e, requestId: string) => studyAssistantAborters.get(requestId)?.abort());
  h('study:assistant:export', async (_e, id: string) => {
    const conversation = studyAssistant.getStudyAssistantConversation(id); if (!conversation) return null;
    const safeTitle = conversation.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'chat-estudio';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('exportStudyConversation', getSettings().uiLanguage), defaultPath: `${safeTitle}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, studyAssistant.renderStudyAssistantConversation(conversation), 'utf8');
    return { path: picked.filePath };
  });
  h('study:questions:list', async (_e, filters?: StudyQuestionFilters) => studyQuestions.listStudyQuestions(filters));
  h('study:questions:get', async (_e, id: string) => studyQuestions.getStudyQuestion(id));
  h('study:questions:create', async (_e, input: StudyQuestionInput) => studyQuestions.createStudyQuestion(input));
  h('study:questions:update', async (_e, id: string, patch: Partial<StudyQuestionInput>) => studyQuestions.updateStudyQuestion(id, patch));
  h('study:questions:duplicate', async (_e, id: string) => studyQuestions.duplicateStudyQuestion(id));
  h('study:questions:versions', async (_e, id: string) => studyQuestions.listStudyQuestionVersions(id));
  h('study:questions:restore', async (_e, id: string, versionId: string) => studyQuestions.restoreStudyQuestionVersion(id, versionId));
  h('study:questions:lifecycle', async (_e, id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete') => studyQuestions.setStudyQuestionLifecycle(id, action));
  h('study:questions:generate', async (_e, request: StudyQuestionGenerationRequest) => generateStudyQuestions(request));
  h('study:questions:export', async (_e, ids?: string[]) => {
    const payload = studyQuestions.exportStudyQuestions(ids);
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('exportQuestionBank', getSettings().uiLanguage), defaultPath: 'nodus-preguntas.json', filters: [{ name: 'Nodus Study Questions', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { path: picked.filePath };
  });
  h('study:questions:import', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: dialogTitle('importQuestionBank', getSettings().uiLanguage), properties: ['openFile'], filters: [{ name: 'Nodus Study Questions', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return [];
    return studyQuestions.importStudyQuestions(JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8')) as StudyQuestionExport);
  });
  h('study:questions:collections:list', async () => studyQuestions.listStudyQuestionCollections());
  h('study:questions:collections:create', async (_e, name: string, description?: string) => studyQuestions.createStudyQuestionCollection(name, description));
  h('study:questions:collections:setItems', async (_e, collectionId: string, questionIds: string[]) => studyQuestions.setStudyQuestionCollectionItems(collectionId, questionIds));
  h('study:questions:collections:delete', async (_e, id: string) => studyQuestions.deleteStudyQuestionCollection(id));
  h('study:questions:analytics', async (_e, id: string) => studyQuestions.getStudyQuestionAnalytics(id));
  h('study:questions:similar', async (_e, id: string, threshold?: number) => studyQuestions.findSimilarStudyQuestions(id, threshold));
  h('study:questions:tags', async () => studyQuestions.listStudyQuestionTags());
  h('study:questions:bulk', async (_e, ids: string[], action: StudyQuestionBulkAction) => studyQuestions.bulkStudyQuestions(ids, action));
  h('study:interchange:export', async (_e, kind: StudyInterchangeKind, format: StudyInterchangeFormat, options?: StudyInterchangeExportOptions) => {
    const bytes = exportStudyInterchange(kind, format, options ?? {});
    const extension = interchangeExtension(kind, format);
    const defaultName = kind === 'questions' ? `nodus-preguntas.${extension}` : `nodus-flashcards.${extension}`;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: kind === 'questions' ? dialogTitle('exportQuestionBank', getSettings().uiLanguage) : dialogTitle('exportFlashcards', getSettings().uiLanguage),
      defaultPath: defaultName,
      filters: [{ name: format === 'nodus' ? 'Nodus' : format.toUpperCase(), extensions: [extension] }, { name: 'Todos', extensions: ['*'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, bytes);
    return { path: picked.filePath };
  });
  h('study:interchange:import', async (_e, kind: StudyInterchangeKind, options?: StudyInterchangeImportOptions) => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: kind === 'questions' ? dialogTitle('importQuestions', getSettings().uiLanguage) : dialogTitle('importFlashcards', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: kind === 'questions'
        ? [{ name: 'Preguntas compatibles', extensions: ['json', 'csv', 'xml', 'gift', 'txt', 'tsv', 'apkg'] }, { name: 'Todos', extensions: ['*'] }]
        : [{ name: 'Flashcards compatibles', extensions: ['json', 'csv', 'txt', 'tsv', 'apkg', 'xml', 'gift'] }, { name: 'Todos', extensions: ['*'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    const bytes = fs.readFileSync(filePath);
    const format = options?.format ?? detectStudyInterchangeFormat(path.basename(filePath), bytes);
    const parsed = parseStudyInterchange(kind, format, bytes, path.basename(filePath));
    const written = writeStudyInterchange(kind, parsed, options?.location);
    return { kind, format, imported: written.imported, skipped: written.skipped, warnings: written.warnings, file: path.basename(filePath), path: filePath };
  });
  h('study:assessments:list', async (_e, kind?: 'test' | 'exam', includeArchived?: boolean) => studyAssessments.listStudyAssessments(kind, includeArchived));
  h('study:assessments:get', async (_e, id: string) => studyAssessments.getStudyAssessment(id));
  h('study:assessments:create', async (_e, input: StudyAssessmentInput) => studyAssessments.createStudyAssessment(input));
  h('study:assessments:buildTest', async (_e, input: StudyTestBuildRequest) => buildStudyTest(input));
  h('study:assessments:update', async (_e, id: string, patch: Partial<Omit<StudyAssessmentInput, 'questionIds'>> & { archived?: boolean }) => studyAssessments.updateStudyAssessment(id, patch));
  h('study:assessments:delete', async (_e, id: string) => studyAssessments.deleteStudyAssessment(id));
  h('study:attempts:list', async (_e, assessmentId?: string) => studyAssessments.listStudyAttempts(assessmentId));
  h('study:attempts:get', async (_e, id: string) => studyAssessments.getStudyAttempt(id));
  h('study:attempts:start', async (_e, input: StudyAttemptStartInput) => studyAssessments.startStudyAttempt(input));
  h('study:attempts:answer', async (_e, id: string, input: StudyAttemptAnswerInput) => studyAssessments.saveStudyAttemptAnswer(id, input));
  h('study:attempts:submit', async (_e, id: string, expired?: boolean) => studyAssessments.submitStudyAttempt(id, expired));
  h('study:attempts:abandon', async (_e, id: string) => studyAssessments.abandonStudyAttempt(id));
  h('study:assessments:export', async (_e, id: string, includeAnswers?: boolean) => {
    const assessment = studyAssessments.getStudyAssessment(id); if (!assessment) return null;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('exportStudyTest', getSettings().uiLanguage), defaultPath: `${assessment.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'test'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, studyAssessments.renderStudyAssessmentMarkdown(assessment, Boolean(includeAnswers)), 'utf8');
    return { path: picked.filePath };
  });
  h('study:grading:rubrics:list', async (_e, includeArchived?: boolean) => studyGrading.listStudyRubrics(includeArchived));
  h('study:grading:rubrics:create', async (_e, input: StudyRubricInput) => studyGrading.createStudyRubric(input));
  h('study:grading:rubrics:update', async (_e, id: string, patch: Partial<StudyRubricInput> & { archived?: boolean }) => studyGrading.updateStudyRubric(id, patch));
  h('study:grading:rubrics:duplicate', async (_e, id: string) => studyGrading.duplicateStudyRubric(id));
  h('study:grading:rubrics:delete', async (_e, id: string) => studyGrading.deleteStudyRubric(id));
  h('study:grading:runs:list', async (_e, attemptAnswerId?: string) => studyGrading.listStudyGradingRuns(attemptAnswerId));
  h('study:grading:manual', async (_e, id: string, score: number, comment?: string) => studyGrading.setStudyGradingManualScore(id, score, comment));
  h('study:flashcards:list', async (_e, options) => studyLearning.listStudyFlashcards(options));
  h('study:flashcards:create', async (_e, input) => studyLearning.createStudyFlashcard(input));
  h('study:flashcards:update', async (_e, id: string, patch) => studyLearning.updateStudyFlashcard(id, patch));
  h('study:flashcards:fromQuestions', async (_e, ids: string[]) => studyLearning.createStudyFlashcardsFromQuestions(ids));
  h('study:flashcards:review', async (_e, input) => studyLearning.reviewStudyFlashcard(input));
  h('study:flashcards:state', async (_e, id: string, action) => studyLearning.setStudyFlashcardState(id, action));
  h('study:flashcards:tags', async () => studyLearning.listStudyFlashcardTags());
  h('study:flashcards:bulk', async (_e, ids: string[], action: StudyFlashcardBulkAction) => studyLearning.bulkStudyFlashcards(ids, action));
  h('study:flashcards:export', async (_e, ids?: string[]) => studyLearning.exportStudyFlashcards(ids));
  h('study:flashcards:import', async (_e, payload: StudyFlashcardExport) => studyLearning.importStudyFlashcards(payload));
  h('study:learning:progress', async () => studyLearning.getStudyProgressDashboard());
  h('study:planner:get', async () => studyLearning.getStudyPlanner());
  h('study:planner:create', async (_e, input) => studyLearning.createStudyPlan(input));
  h('study:planner:block:create', async (_e, input) => studyLearning.createStudyPlanBlock(input));
  h('study:planner:event:create', async (_e, input) => { const event = studyLearning.createStudyCalendarEvent(input); requestAppleCalendarSync(); return event; });
  h('study:planner:event:update', async (_e, id: string, input) => { const event = studyLearning.updateStudyCalendarEvent(id, input); requestAppleCalendarSync(); return event; });
  h('study:planner:event:delete', async (_e, id: string) => { studyLearning.deleteStudyCalendarEvent(id); requestAppleCalendarSync(); });
  h('study:calendar:apple:status', async () => getAppleCalendarSyncStatus(getActiveVault().id));
  h('study:calendar:apple:destinations', async () => listAppleCalendars(true));
  h('study:calendar:apple:configure', async (_e, input) => configureAppleCalendarSync(getActiveVault().id, input));
  h('study:planner:event:external', async (_e, id: string, target: 'google' | 'icloud' | 'outlook') => {
    if (!['google', 'icloud', 'outlook'].includes(target)) throw new Error('Destino de calendario no válido.');
    const event = studyLearning.getStudyPlanner().events.find((item) => item.id === id);
    if (!event) throw new Error('Evento no encontrado.');
    if (target === 'google') {
      const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const dates = `${stamp(event.startsAt)}/${stamp(event.endsAt ?? event.startsAt)}`;
      const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates, details: event.description || event.notes });
      params.append('sprop', 'name:Nodus');
      if (event.url) params.set('location', event.url);
      await shell.openExternal(`https://calendar.google.com/calendar/render?${params.toString()}`);
      return null;
    }
    const ics = studyLearning.renderStudyCalendarEventIcs(id);
    if (target === 'outlook') {
      const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
        title: `${dialogTitle('exportStudyCalendar', getSettings().uiLanguage)} · Outlook`,
        defaultPath: `nodus-evento-${event.shortId.replace(/[^a-zA-Z0-9_-]/g, '')}.ics`,
        filters: [{ name: 'iCalendar · Outlook', extensions: ['ics'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      fs.writeFileSync(picked.filePath, ics, 'utf8');
      return { path: picked.filePath };
    }
    const filePath = path.join(os.tmpdir(), `nodus-${event.id}.ics`);
    fs.writeFileSync(filePath, ics, 'utf8');
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return null;
  });
  h('study:planner:goal:create', async (_e, input) => studyLearning.createStudyGoal(input));
  h('study:planner:item:update', async (_e, kind, id: string, patch) => { studyLearning.updateStudyPlannerItem(kind, id, patch); if (kind === 'event') requestAppleCalendarSync(); });
  h('study:planner:session:start', async (_e, input) => studyLearning.startStudySession(input));
  h('study:planner:session:finish', async (_e, id: string, input) => studyLearning.finishStudySession(id, input));
  h('study:planner:exportIcs', async (_e, target?: 'outlook') => {
    // Capture the originating vault before the user can switch vaults in the save dialog.
    const ics = studyLearning.renderStudyPlannerIcs();
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, { title: dialogTitle('exportStudyCalendar', getSettings().uiLanguage) + (target === 'outlook' ? ' · Outlook' : ''), defaultPath: 'nodus-calendario.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, ics, 'utf8'); return { path: picked.filePath };
  });
  h('study:ai:usage:list', async (_e, limit?: number) => studyAiUsage.listStudyAiUsage(limit));
  h('study:ai:usage:summary', async () => studyAiUsage.getStudyAiUsageSummary());
  h('study:ai:usage:clear', async () => studyAiUsage.clearStudyAiUsage());

  h('study:plan', async (_e, request?: StudyPlanRequest) => buildStudyPlan(request ?? {}));
  h('study:progress:set', async (_e, record: {
    targetKind: 'author' | 'work' | 'idea' | 'theme';
    targetId: string;
    status: 'pending' | 'in_progress' | 'understood' | 'needs_full_read' | 'review';
    note?: string | null;
  }) => studyProgress.setStudyProgress(record));
  h('study:session', async (_e, request: StudySessionRequest) => generateStudySession(request));
  // inmersión (guided topic mastery: scope → generate → resume/replay forever)
  h('immersion:scope', async (_e, request: ImmersionScopeRequest) => buildImmersionScope(request));
  h('immersion:generate', async (e, requestId: string, request: ImmersionRequest) => {
    const session = await generateImmersionSession(request, (p) =>
      e.sender.send('immersion:generate:progress', requestId, p)
    );
    // Content has already been committed. This only persists/queues the optional
    // decoration and therefore cannot roll back or delay the immersion.
    const image = applyDecorativeImageOption('immersion', session.id, request.decorativeImage, (next) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:changed', localizedForUi(next));
    });
    return { ...session, image };
  });
  h('immersion:list', async () => immersionRepo.listImmersionSessions());
  h('immersion:get', async (_e, id: string) => immersionRepo.getImmersionSession(id));
  h('immersion:restart', async (_e, id: string) => immersionRepo.restartImmersionSession(id));
  h('immersion:progress:set', async (_e, id: string, progress: ImmersionProgress) =>
    immersionRepo.setImmersionProgress(id, progress)
  );
  h('immersion:answer', async (_e, request: ImmersionAnswerRequest) => evaluateImmersionAnswer(request));
  h('immersion:exportPdf', async (_e, id: string) => {
    const session = immersionRepo.getImmersionSession(id);
    if (!session) throw new Error('La inmersión ya no existe.');
    return exportImmersionSessionPdf(session);
  });
  h('immersion:delete', async (_e, id: string) => {
    invalidateDecorativeImageGeneration('immersion', id);
    translationsRepo.deleteEntityTranslations('immersion', id);
    immersionRepo.deleteImmersionSession(id);
    announceWritingDraftAnnotations(immersionAnnotationDocumentId(id));
  });

  // main-theme management ("temas principales")
  h('themes:listManaged', async () => themes.listManagedThemes());
  h('themes:add', async (_e, label: string) => {
    themes.addManualTheme(label);
    return themes.listManagedThemes();
  });
  h('themes:rename', async (_e, themeId: string, label: string) => {
    themes.renameTheme(themeId, label);
    return themes.listManagedThemes();
  });
  h('themes:setPinned', async (_e, themeId: string, pinned: boolean) => {
    themes.setThemePinned(themeId, pinned);
    return themes.listManagedThemes();
  });
  h('themes:delete', async (_e, themeId: string) => {
    themes.deleteTheme(themeId);
    return themes.listManagedThemes();
  });
  // A re-themed idea's vector is stale (it embeds its theme labels): refresh just those
  // in the background and keep the id list out of the IPC answer.
  const refreshRethemed = ({ rethemedIdeaIds = [], ...result }: ReprocessConnectionsResult) => {
    void refreshRethemedIdeaEmbeddings(rethemedIdeaIds).catch(() => undefined);
    return result;
  };
  h('themes:reprocess', async (e, options: ReprocessConnectionsOptions, model?: ModelRef | null) =>
    // Re-group the already-extracted ideas under the curated/existing themes (and
    // optionally re-trace idea↔idea relations) with the model. No document re-reading.
    refreshRethemed(await reprocessConnections(options ?? { relations: false }, model, (p) => {
      e.sender.send('themes:reprocess:progress', p);
    }))
  );
  // Reassign idea themes only in the works whose links a graph repair removed. The
  // channel name keeps the `themes:reprocess` prefix so Manual mode blocks it like the
  // full reprocess; the list is cleared only once the reprocess has committed.
  h('themes:reprocessRepairedWorks', async (e, model?: ModelRef | null) => {
    const nodusIds = pendingThemeWorkIds();
    if (nodusIds.length === 0) return { ideas: 0, themedIdeas: 0, newThemes: 0, relationsAdded: 0 };
    const result = await reprocessConnections({ relations: false, nodusIds }, model, (p) => {
      e.sender.send('themes:reprocess:progress', p);
    });
    dismissPendingThemeWorks();
    return refreshRethemed(result);
  });

  // Graph health (Settings › Data): read-only audit, on-demand repair, pending themes.
  h('graph:integrity:check', async () => checkGraphIntegrity());
  h('graph:integrity:repair', async () => {
    if (scanQueue.isBusy()) throw new Error('Espera a que termine la cola de análisis antes de reparar el grafo.');
    const backupPath = await ideaDedupe.backupDatabase('pre-graph-repair');
    return { ...runGraphIntegrityRepair(), backupPath };
  });
  h('graph:integrity:dismissThemeWorks', async () => {
    dismissPendingThemeWorks();
    return checkGraphIntegrity();
  });

  // gaps + reading path
  h('gaps:aggregate', async () => aggregateGaps());
  h('gaps:listPage', async (_e, offset: number, limit: number) => aggregateGapsPage(offset, limit));
  h('gaps:contradictionCount', async () => contradictionCount());
  h('gaps:detail', async (_e, gapId: string) => getGapDetail(gapId));
  h('gaps:contradictions', async () => getContradictions());
  h('reading:path', async (_e, request?: ReadingPathRequest) => buildReadingPath(request));

  // debates (contradiction face-offs)
  h('debates:list', async () => getDebates());
  h('debates:analyzeStream', async (e, requestId: string, request: DebateAnalysisRequest) =>
    streamDebateAnalysis(request, (delta, kind) => {
      const channel = kind === 'reasoning' ? 'debates:analyzeStream:reasoning' : 'debates:analyzeStream:delta';
      e.sender.send(channel, requestId, delta);
    })
  );

  // research coverage map (question-driven research)
  h('research:rq:list', async () => rqRepo.listResearchQuestions());
  h('research:rq:get', async (_e, id: string) => rqRepo.getResearchQuestionDetail(id));
  h('research:rq:create', async (_e, input: { question: string; notes?: string }) =>
    rqRepo.createResearchQuestion(input.question, input.notes)
  );
  h('research:rq:decompose', async (_e, request: RqDecomposeRequest) => decomposeQuestion(request));
  h('research:rq:updateSubs', async (_e, request: RqUpdateSubQuestionsRequest) => {
    rqRepo.replaceSubQuestions(request.rqId, request.subQuestions);
    return rqRepo.getResearchQuestionDetail(request.rqId);
  });
  h('research:rq:map', async (e, requestId: string, request: RqMapRequest) =>
    mapCoverage(request, (p) => e.sender.send('research:rq:map:progress', requestId, p))
  );
  h('research:rq:delete', async (_e, id: string) => {
    rqRepo.deleteResearchQuestion(id);
  });
  h('research:rq:export', async (_e, request: RqExportRequest) => exportResearchCoverage(request));

  // hypothesis lab
  h('hypothesis:generate', async (_e, request: HypothesisLabRequest) => generateHypothesisLab(request));

  // research assistant
  h('research:corpus:sources', async () => researchCorpusInventory());
  h('research:zotero:automatic', async (_e, enabled: boolean) => researchZotero.setResearchZoteroAutomatic(enabled));
  h('research:zotero:status', async (_e, notebookId) => researchZotero.getResearchZoteroStatus(notebookId));
  h('research:zotero:connect', async (_e, input: Parameters<typeof researchZotero.connectResearchZotero>[0]) => researchZotero.connectResearchZotero(input));
  h('research:zotero:disconnect', async (_e, notebookId) => researchZotero.disconnectResearchZotero(notebookId));
  h('research:zotero:read', async (_e, input: Parameters<typeof researchZotero.readResearchZotero>[0]) => researchZotero.readResearchZotero(input));
  h('research:notebooks:list', async () => researchNotebooks.listResearchNotebooks());
  h('research:notebooks:save', async (_e, input) => researchNotebooks.saveResearchNotebook(input));
  h('research:notebooks:delete', async (_e, id: string) => researchNotebooks.deleteResearchNotebook(id));
  h('research:notebooks:resolve', async (_e, id: string) => researchNotebooks.resolveResearchNotebook(id));
  h('research:notebooks:appearance', async (_e, id: string, patch: { name?: string; icon?: string | null; color?: string | null }) => researchNotebooks.updateResearchNotebookAppearance(id, patch));
  h('research:notebooks:preparation', async (_e, id: string) => researchNotebooks.ensureNotebookPrepared(id));
  h('research:notebooks:search', async (_e, id: string, query: string) => {
    if (typeof query !== 'string' || query.length > 10000) throw new Error('Invalid research query');
    const scope = researchNotebooks.resolveResearchNotebook(id);
    const notebook = researchNotebooks.listResearchNotebooks().find(item => item.id === id)!;
    const controller = new AbortController();
    const release = researchNotebooks.registerNotebookRun(id, controller);
    try {
      const vector = scope.documents.length ? await embedResearchQuery(query, controller.signal).catch(() => null) : null;
      controller.signal.throwIfAborted();
      const result = await documentaryPreparation.retrieveSharedDocumentaryEvidence(scope, query, notebook.settings ?? RETRIEVAL_PRESETS.balanced, vector, controller.signal);
      if (researchNotebooks.resolveResearchNotebook(id).id !== scope.id) throw new Error('research_scope_changed');
      return { evidence: result.evidence, scopeId: scope.id, partial: result.traversal.partial };
    } finally { release(); }
  });
  h('research:corpus:read', async (_e, input: Parameters<import('@shared/researchCorpus').ResearchCorpusApi['readResearchDocument']>[0]) => {
    if (!input || typeof input.documentId !== 'string' || input.documentId.length > 500) throw new Error('Invalid document identifier');
    const scope = resolveAcademicRunScope(input.notebookId);
    const notebook = input.notebookId ? researchNotebooks.listResearchNotebooks().find(item => item.id === input.notebookId) : null;
    const controller = new AbortController();
    const release = input.notebookId ? researchNotebooks.registerNotebookRun(input.notebookId, controller) : () => {};
    try { return await new ResearchCorpusRun(scope, notebook?.settings ?? RETRIEVAL_PRESETS.balanced, controller.signal).readDocument(input.documentId, input.operation); }
    finally { release(); }
  });
  // A one-time store compaction holds the write lock for tens of seconds; preparation
  // actions wait for it instead of failing on a locked database.
  const afterDocumentaryMaintenance = <T>(work: () => T | Promise<T>) => documentaryPreparation.documentaryMaintenanceSettled().then(work);
  h('research:preparation:policy', async () => preparationExperience.getResearchPreparationPolicy());
  h('research:preparation:policy:set', async (_e, input) => afterDocumentaryMaintenance(() => preparationExperience.setResearchPreparationPolicy(input)));
  h('research:preparation:preview', async (_e, input) => afterDocumentaryMaintenance(() => preparationExperience.previewResearchPreparation(input)));
  h('research:preparation:campaign:start', async (_e, input) => afterDocumentaryMaintenance(() => preparationExperience.startResearchPreparationCampaign(input)));
  h('research:preparation:progress', async () => preparationExperience.getResearchPreparationProgress());
  h('research:preparation:campaign:control', async (_e, input) => afterDocumentaryMaintenance(() => preparationExperience.controlResearchPreparationCampaign(input)));
  h('research:preparation:control', async (_e, action) => afterDocumentaryMaintenance(() => preparationExperience.controlAllResearchPreparation(action)));
  h('research:preparation:inventory', async () => documentaryPreparation.getResearchPreparationInventory());
  h('research:preparation:start', async (_e, ids: string[]) => afterDocumentaryMaintenance(() => documentaryPreparation.prepareResearchDocuments(ids)));
  h('research:preparation:index', async (_e, input) => afterDocumentaryMaintenance(() => preparationExperience.indexResearchWorks(input)));
  h('research:preparation:cancel', async (_e, ids: string[]) => afterDocumentaryMaintenance(() => documentaryPreparation.cancelResearchDocuments(ids)));
  h('research:preparation:enabled', async (_e, enabled: boolean) => afterDocumentaryMaintenance(() => documentaryPreparation.setResearchPreparationEnabled(enabled)));
  h('research:preparation:paused', async (_e, paused: boolean) => afterDocumentaryMaintenance(() => documentaryPreparation.setResearchPreparationPaused(paused)));
  h('research:chat', async (_e, request: ResearchChatRequest) => answerResearchChat(request));
  h('research:chatStream', async (e, requestId: string, request: ResearchChatRequest) => {
    // Track the in-flight stream so `research:chatStream:cancel` can abort it. On
    // abort the provider stops mid-answer and streamResearchChat returns whatever
    // partial text had streamed, which the renderer keeps.
    const controller = new AbortController();
    chatAborters.set(requestId, controller);
    const unregisterNotebook = request.selection.notebookId ? researchNotebooks.registerNotebookRun(request.selection.notebookId, controller) : () => {};
    // Timeline of one answer (request, first and last streamed text, done), for perf diagnosis.
    const t0 = Date.now();
    let firstDelta = 0, lastDelta = 0, chars = 0;
    try {
      return await streamResearchChat(
        request,
        (delta, kind) => {
          const now = Date.now();
          if (kind !== 'replace') { if (!firstDelta) firstDelta = now; lastDelta = now; chars += delta.length; }
          const channel = kind === 'reasoning' ? 'research:chatStream:reasoning' : kind === 'replace' ? 'research:chatStream:replace' : 'research:chatStream:delta';
          e.sender.send(channel, requestId, delta);
        },
        controller.signal,
        result => { if (!e.sender.isDestroyed()) e.sender.send('research:chatStream:concilium', requestId, result); },
        activity => { if (!e.sender.isDestroyed()) e.sender.send('research:chatStream:activity', requestId, activity); }
      );
    } finally {
      const s = (t: number) => (t ? ((t - t0) / 1000).toFixed(1) : '-');
      console.info(`${new Date().toISOString()} [chatTimeline] first text ${s(firstDelta)}s · last text ${s(lastDelta)}s · done ${s(Date.now())}s · streamed ${chars} chars`);
      chatAborters.delete(requestId);
      unregisterNotebook();
    }
  });
  h('research:chatStream:cancel', async (_e, requestId: string) => {
    chatAborters.get(requestId)?.abort();
  });

  // writing workshop
  h('writing:snapshot', async (_e, brief: WritingWorkshopBrief) => buildWritingWorkshopSnapshot(brief));
  h('writing:draft', async (_e, request: WritingWorkshopDraftRequest) => generateWritingWorkshopDraft(request));
  h('writing:export', async (_e, request: WritingWorkshopExportRequest) => exportWritingWorkshopDraft(request));
  h('writing:exportZip', async (e, requestId: string, request: DeepResearchArchiveRequest) =>
    exportDeepResearchArchive(request, (done, total, title) => {
      if (!e.sender.isDestroyed()) e.sender.send('writing:exportZip:progress', requestId, done, total, title);
    })
  );
  h('writing:saved:list', async () => writingDrafts.listWritingWorkshopDrafts());
  h('writing:saved:save', async (e, request: WritingWorkshopSaveDraftRequest) => {
    const saved = writingDrafts.saveWritingWorkshopDraft(request);
    announceWritingDrafts();
    if (saved.brief.kind !== 'deep_research') return saved;
    // Like Inmersión, the complete report is durable before image work begins.
    const image = applyDecorativeImageOption('deep_research', saved.id, request.decorativeImage, (next) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:changed', localizedForUi(next));
    });
    return { ...saved, image };
  });
  h('writing:saved:read', async (_e, id: string, read: boolean) => {
    const saved = writingDrafts.setWritingWorkshopDraftRead(id, read);
    // The same announcement a save makes, so a report marked read while reading it is
    // already wearing its badge when the gallery comes back.
    if (saved) announceWritingDrafts();
    return saved;
  });
  h('writing:annotations:list', async (_e, draftId: string) => writingAnnotations.listWritingDraftAnnotations(draftId));
  h('writing:annotations:create', async (_e, input: WritingDraftAnnotationInput) => {
    const annotation = writingAnnotations.createWritingDraftAnnotation(input);
    announceWritingDraftAnnotations(annotation.draftId);
    return annotation;
  });
  h('writing:annotations:updateComment', async (_e, id: string, comment: string) => {
    const annotation = writingAnnotations.updateWritingDraftComment(id, comment);
    if (annotation) announceWritingDraftAnnotations(annotation.draftId);
    return annotation;
  });
  h('writing:annotations:delete', async (_e, id: string) => {
    const draftId = writingAnnotations.deleteWritingDraftAnnotation(id);
    if (draftId) announceWritingDraftAnnotations(draftId);
    return !!draftId;
  });
  h('writing:saved:delete', async (_e, id: string) => {
    invalidateDecorativeImageGeneration('deep_research', id);
    translationsRepo.deleteEntityTranslations('deep_research', id);
    const removed = writingDrafts.deleteWritingWorkshopDraft(id);
    announceWritingDrafts();
    announceWritingDraftAnnotations(id);
    return removed;
  });

  // deep research (orchestrated, coverage-guided multi-page report)
  //
  // Routed through the shared queue rather than called directly: MCP clients can queue
  // reports too, and two pipelines running at once would put two multi-minute
  // generations on the single event loop of this process. The window still streams
  // progress — it just also sees `queued` while another report is ahead of it. The
  // draft is saved by the renderer (which owns the decorative image), so `save` is
  // false here.
  h('research:deep', async (e, requestId: string, request: DeepResearchRequest) => {
    ensureDeepResearchLane();
    return runDeepResearchJob({ request, origin: 'app', save: false }, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('research:deep:progress', requestId, p);
    });
  });
  h('research:deep:queue:list', async () => {
    ensureDeepResearchLane();
    return listDeepResearchJobs();
  });
  h('research:deep:queue:enqueue', async (_e, request: DeepResearchRequest) => {
    ensureDeepResearchLane();
    return enqueueDeepResearchJob({ request, origin: 'app', save: true });
  });
  h('research:deep:queue:cancel', async (_e, id: string) => {
    ensureDeepResearchLane();
    return cancelDeepResearchJob(id);
  });
  h('research:deep:queue:clear', async () => {
    ensureDeepResearchLane();
    return clearFinishedDeepResearchJobs();
  });
  // Complete study guide: the composer's source tree and its pre-flight estimate.
  h('research:completeGuide:catalog', async () => ({ sources: listCompleteGuideCatalog(), organization: completeGuideOrganization() }));
  h('research:completeGuide:preview', async (_e, request: CompleteGuidePreviewRequest) => previewCompleteGuide(request));
  h('research:completeGuide:evidence', async (_e, draftId: string, itemId: string, language?: PromptLanguage) => getCompleteGuideEvidence(draftId, itemId, language));

  // tutor mode (AI-guided graph walkthrough)
  h('tutor:plan', async (_e, request: TutorPlanRequest) => buildTutorPlan(request));
  h('tutor:routes:list', async () => tutorRoutes.listTutorRoutes());
  h('tutor:routes:save', async (_e, plan: TutorPlan, route: TutorRoute, model: ModelRef | null, rating: number) =>
    tutorRoutes.saveTutorRoute(plan, route, model, rating)
  );
  h('tutor:routes:rate', async (_e, routeId: string, rating: number | null) => tutorRoutes.rateTutorRoute(routeId, rating));
  h('tutor:routes:played', async (_e, routeId: string) => tutorRoutes.markTutorRoutePlayed(routeId));
  h('tutor:routes:delete', async (_e, routeId: string) => tutorRoutes.deleteTutorRoute(routeId));
  h('tutor:step', async (_e, request: TutorStepRequest) => answerTutorStep(request));
  h('tutor:stepStream', async (e, requestId: string, request: TutorStepRequest) =>
    streamTutorStep(request, (delta, kind) => {
      const channel = kind === 'reasoning' ? 'tutor:stepStream:reasoning' : 'tutor:stepStream:delta';
      e.sender.send(channel, requestId, delta);
    })
  );

  // argument map (AI-traced hierarchical outline around a seed idea)
  h('argumentMap:build', async (_e, request: ArgumentMapRequest) =>
    buildArgumentMap(request, request.model)
  );
  h('argumentMap:discover', async () => discoverArgumentRoutes());

  // research chat history
  h('research:prompts:list', (_e, key?: string | null) => getResearchSystemPrompts(key));
  h('research:prompts:save', (_e, input: import('@shared/researchSystemPrompts').ResearchSystemPromptInput) => saveResearchSystemPrompt(input));
  h('research:prompts:select', (_e, key: string, id: string | null) => selectResearchSystemPrompt(key, id));
  h('research:prompts:delete', (_e, id: string) => deleteResearchSystemPrompt(id));
  h('research:contextSources', async () => listResearchContextSources());
  h('chat:list', async (_e, includeArchived?: boolean) => chat.listConversations(includeArchived ?? false));
  h('chat:get', async (_e, id: string) => chat.getConversation(id));
  h('chat:create', async (_e, input: { model?: ModelRef | null; selection?: ResearchContextSelection | null; title?: string; projectId?: string | null; folderId?: string | null }) =>
    chat.createConversation(input ?? {})
  );
  h(
    'chat:saveMessages',
    async (
      _e,
      id: string,
      messages: ChatMessageRecord[],
      meta?: { model?: ModelRef | null; selection?: ResearchContextSelection | null }
    ) => chat.saveMessages(id, messages, meta)
  );
  h('chat:generateTitle', async (_e, id: string, model?: ModelRef | null) => {
    const conversation = chat.getConversation(id);
    if (!conversation) return '';
    const title = await generateChatTitle(conversation.messages, model ?? conversation.model);
    chat.renameConversation(id, title);
    return title;
  });
  h('chat:rename', async (_e, id: string, title: string) => chat.renameConversation(id, title));
  h('chat:archive', async (_e, id: string, archived: boolean) => chat.setArchived(id, archived));
  h('chat:delete', async (_e, id: string) => chat.deleteConversation(id));
  h('chat:projects:list', async () => chatProjects.listChatProjects());
  h('chat:projects:create', async (_e, input: { name: string; icon?: string | null; color?: string | null; instructions?: string }) => chatProjects.createChatProject(input));
  h('chat:projects:update', async (_e, id: string, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }) => chatProjects.updateChatProject(id, patch));
  h('chat:projects:delete', async (_e, id: string) => chatProjects.deleteChatProject(id));
  h('chat:folders:list', async () => chatProjects.listChatProjectFolders());
  h('chat:folders:create', async (_e, input: { projectId: string; parentId?: string | null; name: string }) => chatProjects.createChatProjectFolder(input));
  h('chat:folders:rename', async (_e, id: string, name: string) => chatProjects.renameChatProjectFolder(id, name));
  h('chat:folders:move', async (_e, id: string, parentId: string | null, index?: number) => chatProjects.moveChatProjectFolder(id, parentId, index));
  h('chat:folders:delete', async (_e, id: string) => chatProjects.deleteChatProjectFolder(id));
  h('chat:setProject', async (_e, id: string, projectId: string | null) => chatProjects.setConversationProject(id, projectId));
  h('chat:setFolder', async (_e, id: string, folderId: string | null) => chatProjects.setConversationFolder(id, folderId));
  h('chat:setPinned', async (_e, id: string, pinned: boolean) => chatProjects.setConversationPinned(id, pinned));

  // notes (user-structured folders/subfolders with markdown + captured AI content)
  h('notes:tree', async (_e, includeTrashed?: boolean) => notes.getNotesTree(includeTrashed ?? false));
  h('notes:folders:create', async (_e, input: CreateNoteFolderInput) => notes.createNoteFolder(input));
  h('notes:folders:rename', async (_e, id: string, name: string) => notes.renameNoteFolder(id, name));
  h('notes:folders:move', async (_e, id: string, parentId: string | null) => notes.moveNoteFolder(id, parentId ?? null));
  h('notes:folders:delete', async (_e, id: string) => {
    notes.deleteNoteFolder(id);
  });
  h('notes:folders:trash', async (_e, id: string) => notes.trashNoteFolder(id));
  h('notes:create', async (_e, input: CreateNoteInput) => notes.createNote(input));
  h('notes:get', async (_e, id: string) => notes.getNote(id));
  h('notes:update', async (_e, input: UpdateNoteInput) => notes.updateNote(input));
  h('notes:move', async (_e, id: string, folderId: string | null) => notes.moveNote(id, folderId ?? null));
  h('notes:tags:patch', async (_e, noteIds: string[], patch: NoteTagPatch) => notes.patchNoteTags(noteIds, patch));
  h('notes:trash', async (_e, noteIds: string[]) => { notes.trashNotes(noteIds); });
  h('notes:restore', async (_e, noteIds: string[]) => { notes.restoreNotes(noteIds); scheduleManualIndex(); });
  h('notes:deletePermanently', async (_e, noteIds: string[]) => {
    for (const id of [...new Set(noteIds)]) {
      const note = notes.getNote(id);
      if (note?.source?.note === MANUAL_IDEA_MARKER && note.source.ref) manualIdeas.deleteManualIdea(note.source.ref);
      notes.deleteNote(id);
    }
  });
  h('notes:delete', async (_e, id: string) => {
    // A manual idea is owned by its note: deleting the note purges the idea and
    // everything indexed for it (occurrences, evidence, edges, embedding).
    const note = notes.getNote(id);
    if (note?.source?.note === MANUAL_IDEA_MARKER && note.source.ref) {
      manualIdeas.deleteManualIdea(note.source.ref);
    }
    notes.deleteNote(id);
  });

  // manual ideas (user-authored, note-owned graph ideas)
  h('manualIdeas:create', async (_e, input: { folderId: string | null; title?: string }) =>
    manualIdeas.createManualIdea(input)
  );
  h('manualIdeas:save', async (_e, payload: ManualIdeaPayload) => {
    manualIdeas.saveManualIdea(payload);
  });
  h('manualIdeas:autoIndex', async (_e, input: { globalId: string; title: string; summary: string; excludeIds?: string[] }) =>
    manualIdeas.autoIndexManualIdea(input)
  );
  h('manualIdeas:searchCandidates', async (_e, query: string, excludeIds?: string[], limit?: number) =>
    manualIdeas.searchIdeaCandidates(query, excludeIds ?? [], limit ?? 20)
  );

  // notes export + reordering
  h('notes:export', async (_e, options: NotesExportOptions) => exportNotes(options));
  h('notes:reorder', async (_e, noteIds: string[]) => {
    notes.reorderNotes(noteIds);
  });
  h('notes:reorderByAI', async (_e, noteIds: string[]) => reorderNotesByAI(noteIds));
  h('notes:folders:updateSummary', async (_e, id: string, summary: string) =>
    notes.updateNoteFolderSummary(id, summary ?? '')
  );
  h('notes:folders:suggestIdeas', async (_e, folderId: string) => suggestFolderIdeas(folderId));

  // workspace — el editor completo sobre una nota, y sus enlaces con la biblioteca
  h('workspace:academic:export', async (_e, input) => exportAcademicDocument(input));
  h('workspace:editor:data', async (_e, noteId: string) => workspace.getWorkspaceNoteEditorData(noteId));
  h('workspace:editor:update', async (_e, noteId: string, input: StudyDocUpdateInput) =>
    workspace.updateWorkspaceNote(noteId, input));
  h('workspace:editor:restore', async (_e, noteId: string, versionId: string) =>
    workspace.restoreWorkspaceNoteVersion(noteId, versionId));
  h('workspace:annotation:create', async (_e, noteId: string, input: StudyAnnotationInput) =>
    workspace.createWorkspaceAnnotation(noteId, input));
  h('workspace:annotation:update', async (_e, id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }) =>
    workspace.updateWorkspaceAnnotation(id, patch));
  h('workspace:annotation:delete', async (_e, id: string) => {
    workspace.deleteWorkspaceAnnotation(id);
  });
  h('workspace:library:list', async (_e, ownerKind: WorkspaceLinkOwnerKind, ownerId: string) =>
    workspace.listWorkspaceLibraryLinks(ownerKind, ownerId));
  // Los enlaces de toda la bóveda de una vez: la lista pinta un contador por fila y
  // pedirlos uno a uno convertiría una lista de doscientas notas en doscientas llamadas.
  h('workspace:library:all', async () => {
    workspace.pruneWorkspaceLibraryLinks();
    return workspace.listAllWorkspaceLibraryLinks();
  });
  h('workspace:library:add', async (_e, input: WorkspaceLibraryLinkInput) => workspace.addWorkspaceLibraryLink(input));
  h('workspace:library:remove', async (_e, ownerKind: WorkspaceLinkOwnerKind, ownerId: string, libraryItemId: string, scope?: 'global' | 'vault') => {
    workspace.removeWorkspaceLibraryLink(ownerKind, ownerId, libraryItemId, scope ?? 'global');
  });
  // Estudio y Docencia: una nota del Workspace vinculada a cursos, asignaturas, carpetas,
  // temas y materiales, donde aparece sin copiarse.
  h('study:noteLinks:list', async (_e, filter?: StudyNoteLinkFilter) => studyNoteLinks.listStudyNoteLinks(filter ?? {}));
  h('study:noteLinks:add', async (_e, input: StudyNoteLinkInput) => studyNoteLinks.addStudyNoteLink(input));
  h('study:noteLinks:remove', async (_e, ids: string[]) => { studyNoteLinks.removeStudyNoteLinks(Array.isArray(ids) ? ids : []); });
  h('citations:verify', async (_e, refs: CitationRef[]) => verifyCitations(refs ?? []));
  h('citations:preview', async (_e, ref: CitationRef) => (ref ? previewCitation(ref) : null));
  h('search:vaultContent', async (_e, query: string, kinds?: string[], semantic?: boolean, limit?: number) => searchVaultContent(query, kinds, semantic, limit));
  h('search:global', async (_e, query: string, limitPerKind?: number, kinds?: SearchResultKind[]) =>
    (query ?? '').trim().length < 2 ? [] : mergeHybridResults(query ?? '', globalSearch(query ?? '', -1, true, kinds ? new Set(kinds) : undefined), [], kinds ? new Set(kinds) : undefined, Math.max(1, Math.min(250, limitPerKind ?? 8)) * (kinds?.length ?? 11))
      .map((hit) => ({ ...hit, snippet: searchSnippet(hit.snippet, query ?? '') }))
  );
  h('search:detail', async (_e, kind: SearchResultKind, id: string) => getSearchResultDetail(kind, id));
  h('workspace:academic:inspect',async (_event,input)=>inspectAcademicDocument(input));
  h('editor:references', async (_event,options) => listEditorReferences(options));
  h('search:semantic', async (_e, query: string, options?: SemanticSearchOptions) =>
    semanticSearch(query ?? '', options ?? {})
  );
  h('search:similarIdea', async (_e, globalId: string, limit?: number) =>
    findSimilarToIdea(globalId, limit ?? 12)
  );
  h('search:saved:list', async () => listSavedSearches());
  h('search:saved:create', async (_e, input: SaveSearchInput) => saveSearch(input));
  h('search:saved:delete', async (_e, id: string) => {
    deleteSavedSearch(id);
  });
  h('corpus:health', async () => getCorpusHealth());
  h('gaps:suggestSearch', async (_e, statement: string, workTitles?: string[]) =>
    suggestGapSearch(statement ?? '', workTitles ?? [])
  );

  // projects / manuscripts
  h('projects:list', async () => projects.listProjects());
  h('projects:get', async (_e, id: string) => projects.getProjectDetail(id));
  h('projects:create', async (_e, input: CreateProjectInput) => projects.createProject(input));
  h('projects:update', async (_e, input: UpdateProjectInput) => projects.updateProject(input));
  h('projects:delete', async (_e, id: string) => {
    projects.deleteProject(id);
  });
  h('projects:sections:update', async (_e, input: UpdateProjectSectionInput) => projects.updateSection(input));
  h('projects:links:add', async (_e, input: AddProjectLinkInput) => projects.addLink(input));
  h('projects:links:delete', async (_e, id: string) => {
    projects.deleteLink(id);
  });
  h('projects:chapters:import', async (_e, input: ImportProjectChapterInput) => {
    let filePath = input.filePath?.trim() || null;
    if (!filePath) {
      const result = await showImportOpenDialog({
        title: dialogTitle('importChapter', getSettings().uiLanguage),
        properties: ['openFile'],
        filters: [
          { name: 'Documentos de texto', extensions: ['docx', 'pdf', 'epub', 'md', 'markdown', 'txt'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      filePath = result.filePaths[0];
    }
    const settings = getSettings();
    const doc = await extractFromPath(filePath, {
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      perf: { title: path.basename(filePath), nodusId: input.projectId },
    });
    if (!doc.text.trim()) throw new Error('No se pudo extraer texto útil del capítulo.');
    return projects.createChapter({
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      title: input.title?.trim() || path.basename(filePath, path.extname(filePath)),
      sourceFormat: projects.sourceFormatFromPath(filePath),
      originalFileName: path.basename(filePath),
      text: doc.text,
    });
  });
  h('projects:chapters:update', async (_e, chapterId: string, markdown: string) =>
    projects.updateChapterMarkdown(chapterId, markdown, { versionLabel: 'Antes de guardar edicion manual' })
  );
  h('projects:suggestions:list', async (_e, chapterId: string) => projects.listSuggestions(chapterId));
  h('projects:suggestions:generate', async (_e, request: GenerateProjectSuggestionsRequest) =>
    generateProjectSuggestions(request)
  );
  h('projects:suggestions:updateStatus', async (_e, id: string, status: ChapterSuggestionStatus) =>
    projects.updateSuggestionStatus(id, status)
  );
  h('projects:suggestions:apply', async (_e, request: ApplyProjectSuggestionsRequest) =>
    projects.applySuggestions(request.chapterId, request.suggestionIds)
  );
  h('projects:versions:list', async (_e, chapterId: string) => projects.listChapterVersions(chapterId));
  h('projects:versions:restore', async (_e, versionId: string) => projects.restoreChapterVersion(versionId));
  h('projects:chapterRelations:get', async (_e, chapterId: string) => getChapterRelations(chapterId));
  h('projects:chapterRelations:analyze', async (_e, request: AnalyzeChapterRelationsRequest) =>
    analyzeChapterRelations(request)
  );
  h('projects:manuscript:verify', async (_e, request: ManuscriptVerificationRequest) =>
    verifyManuscriptCitations(request)
  );
  h('projects:manuscript:applyCitation', async (_e, request: ApplyManuscriptCitationRequest) =>
    applyManuscriptCitation(request)
  );
  h('projects:export', async (_e, request: ExportProjectRequest) => exportProject(request));
  h('projects:chapters:export', async (_e, request: ExportProjectChapterRequest) =>
    exportProjectChapter(request)
  );

  // embedding pipeline
  h('embeddings:start', async (_e, nodusIds?: string[]) => startEmbedding(nodusIds));
  h('embeddings:reindexAll', async () => reindexAll());
  h('embeddings:pause', async () => pauseEmbedding());
  h('embeddings:resume', async () => resumeEmbedding());
  h('embeddings:stop', async () => stopEmbedding());
  h('embeddings:clearProgress', async () => clearEmbeddingProgress());
  h('embeddings:status', async () => getEmbeddingSnapshot());
  h('embeddings:workStatuses', async (_e, nodusIds?: string[]) => getWorkEmbeddingStatuses(nodusIds));

  // Full-text passage index
  h('passages:start', async (_e, nodusIds?: string[]) => startPassageEmbedding(nodusIds));
  h('passages:pause', async () => pausePassageEmbedding());
  h('passages:resume', async () => resumePassageEmbedding());
  h('passages:stop', async () => stopPassageEmbedding());
  h('passages:clearProgress', async () => clearPassageProgress());
  h('passages:status', async () => getPassageSnapshot());
  h('passages:workStatuses', async (_e, nodusIds?: string[]) => getWorkPassageStatuses(nodusIds));
  h('passages:get', async (_e, passageId: string) => passageId.startsWith('documentary:') ? getDocumentaryPassageDetail(passageId) : passageId.startsWith('scoped:') ? getScopedLegacyPassageDetail(passageId) : passageId.startsWith('web:') ? getWebPassageDetail(passageId) : getPassageDetail(passageId));

  // semantic bridge discovery
  h('bridges:discover', async (_e, model?: ModelRef | null) => discoverSemanticBridges(model));
  h('bridges:isRunning', async () => isSemanticBridgeRunning());

  // export / import
  h('data:export', async () => exportData());
  h('data:exportSync', async () => {
    if (getActiveVault().type === 'estudio' && !getSettings().studySyncEnabled) throw new Error('La sincronización del vault de estudio está desactivada en Ajustes.');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogTitle('exportSyncPackage', getSettings().uiLanguage),
      defaultPath: path.join(app.getPath('documents'), `nodus-sync-${new Date().toISOString().slice(0, 10)}.nodussync`),
      filters: [{ name: 'Nodus Sync', extensions: ['nodussync'] }],
    });
    if (canceled || !filePath) return null;
    const passphrase = getSyncPassphrase();
    if (!passphrase) {
      throw new Error('Configura una frase de sincronización en Ajustes: los paquetes van cifrados y la necesitarás en el otro equipo.');
    }
    const { buffer, counts } = buildSyncPackage(app.getVersion(), passphrase);
    fs.writeFileSync(filePath, buffer);
    return { path: filePath, counts };
  });

  h('data:importSync', async (_e, passphrase?: string) => {
    if (getActiveVault().type === 'estudio' && !getSettings().studySyncEnabled) throw new Error('La sincronización del vault de estudio está desactivada en Ajustes.');
    const { canceled, filePaths } = await showImportOpenDialog({
      title: dialogTitle('importSyncPackage', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: [{ name: 'Nodus Sync', extensions: ['nodussync'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    // The local passphrase is tried first; the renderer prompts only if it does not fit,
    // which is the case where the package came from a machine set up separately.
    return mergeSyncPackage(fs.readFileSync(filePaths[0]), passphrase?.trim() || getSyncPassphrase() || undefined);
  });
  h('study:data:overview', async () => studyDataAdmin.getStudyDataOverview());
  h('study:data:exportScope', async (_e, scope, format) => {
    if (!getSettings().studySharingEnabled) throw new Error('La exportación para compartir está desactivada en Ajustes.');
    return exportStudyScope(scope, format);
  });
  h('study:data:maintain', async (_e, action: 'rebuild-indexes' | 'clear-embeddings' | 'empty-trash' | 'repair') => {
    if (action === 'rebuild-indexes') return studyDataAdmin.rebuildStudyIndexes();
    if (action === 'clear-embeddings') { studySearch.deleteStudySearchIndex(); return studyDataAdmin.clearStudyEmbeddingCache(); }
    if (action === 'empty-trash') return studyDataAdmin.emptyStudyTrash();
    if (action === 'repair') return studyDataAdmin.repairStudyData();
    throw new Error('Acción de mantenimiento no válida.');
  });
  h('study:data:diagnostic', async () => {
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('exportStudyDiagnostic', getSettings().uiLanguage), defaultPath: 'nodus-estudio-diagnostico.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(studyDataAdmin.buildStudyDiagnostic(), null, 2), 'utf8');
    return { path: picked.filePath };
  });
  h('data:import', async (_e, password: string) => {
    const result = await importData(password);
    // Imports intentionally restore MCP as disabled and tokenless. Stop any
    // listener from the previous local profile once the swap succeeds.
    if (result.ok) {
      await stopMcpTunnel();
      await stopMcpServer();
    }
    return result;
  });
  h('data:resetGraph', async () => {
    // Stop any pending scans first so a finishing job can't repopulate after the wipe.
    scanQueue.clear();
    ideas.resetGraphData();
  });

  // demo mode: a curated sample corpus, only offered on an empty database.
  h('data:hasData', async () => hasAnyData());
  h('data:seedDemo', async () => seedDemoData());
  h('data:seedPrimarySourcesDemo', async () => seedPrimarySourcesDemoData());
  h('data:clearDemo', async () => {
    scanQueue.clear();
    clearDemoData();
  });
  // Genealogy demo: seeds the Serrano–Vidal family (tree, archive, evidence, open
  // kinship suggestions) and flips the vault to the genealogy type. Portraits are
  // generated in the background with the cheap Gemini model when a key is present.
  h('data:seedGenealogyDemo', async () => {
    const seeded = seedGenealogyDemoData();
    const willGeneratePortraits = seeded && hasDemoPortraitKey();
    if (willGeneratePortraits) {
      void generateDemoPortraits({
        onProgress: (done, total) => getWindow()?.webContents.send('demo:portraits', { done, total }),
      }).catch(() => undefined);
    }
    return { seeded, willGeneratePortraits };
  });
  h('data:generateDemoPortraits', async () =>
    generateDemoPortraits({
      onProgress: (done, total) => getWindow()?.webContents.send('demo:portraits', { done, total }),
    })
  );
  // Databases demo: seeds three sample databases covering every column type and flips
  // the vault to the databases type.
  h('data:seedDatabasesDemo', async () => seedDatabasesDemoData());
  // Study demo stays entirely local and is only accepted by an empty study vault.
  h('data:seedStudyDemo', async () => seedStudyDemoData());
  // Teaching demo, likewise local-only. Unlike genealogy and databases it never
  // converts the active vault: it is refused outside a `docencia` vault instead.
  h('data:seedTeachingDemo', async () => seedTeachingDemoData());
  // Worldbuilding demo is a complete, local-only fictional world. It is refused
  // outside an empty worldbuilding vault and never invokes an AI provider.
  h('data:seedWorldbuildingDemo', async () => seedWorldbuildingDemoData());
  // Demo de Testimonios: proyecto de historia oral completo y local. Sin ninguna voz real
  // — los maestros son un tono sintético marcado como tal — y sin una sola llamada a IA.
  h('data:seedTestimonyDemo', async () => seedTestimonyDemoData());




  // Stream queue progress to the renderer. A configuration pause happens after
  // the enqueue call has already returned, so it cannot pass through the common
  // IPC error wrapper. Emit the same one-shot notice from the progress edge.
  let scanModelRequiredNotified = false;
  scanQueue.onProgress((p) => {
    const win = getWindow();
    win?.webContents.send('queue:progress', localizedForUi(p));
    const modelRequired = isAiModelRequiredError(p.pausedReason);
    if (modelRequired && !scanModelRequiredNotified) win?.webContents.send('ai:modelRequired');
    scanModelRequiredNotified = modelRequired;
  });

  void documentIndexQueue.initialize();
  let documentModelRequiredNotified = false;
  documentIndexQueue.onProgress((p) => {
    const win = getWindow();
    win?.webContents.send('documents:index:progress', localizedForUi(p));
    const modelRequired = p.jobs.some((job) => job.status === 'paused' && isAiModelRequiredError(job.error));
    if (modelRequired && !documentModelRequiredNotified) win?.webContents.send('ai:modelRequired');
    documentModelRequiredNotified = modelRequired;
  });

  // Stream embedding pipeline progress to the renderer.
  onEmbeddingProgress((p) => {
    getWindow()?.webContents.send('embeddings:progress', localizedForUi(p));
  });

  onPassageProgress((p) => {
    getWindow()?.webContents.send('passages:progress', localizedForUi(p));
  });

  onStudyMaterialIndexChanged((materialId) => {
    getWindow()?.webContents.send('study:materials:indexChanged', materialId);
  });

  onStudyKnowledgeChanged((next) => {
    getWindow()?.webContents.send('study:knowledge:changed', next);
  });

  onChapterRelationsProgress((p) => {
    getWindow()?.webContents.send('projects:chapterRelations:progress', localizedForUi(p));
  });

  // Stream semantic bridge progress to the renderer.
  onSemanticBridgeProgress((p) => {
    getWindow()?.webContents.send('bridges:progress', localizedForUi(p));
  });
}
