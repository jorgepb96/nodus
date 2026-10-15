import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { app } from 'electron';
import { z } from 'zod';
import { AI_PROVIDERS as SHARED_AI_PROVIDERS } from '@shared/providers';
import { PROMPT_LANGUAGES } from '@shared/types';
import { DEEP_RESEARCH_APPROACHES } from '@shared/deepResearchApproaches';
import { DEEP_RESEARCH_VERSIONS } from '@shared/deepResearchVersions';
import {
  DEEP_RESEARCH_SECTION_LENGTH_MAX,
  DEEP_RESEARCH_SECTION_LENGTH_MIN,
} from '@shared/deepResearchSectionLength';
import type {
  AiProvider,
  Debate,
  LightStatus,
  DeepStatus,
  ModelRef,
  NoteSource,
  ProjectChapter,
  ProjectKind,
  ProjectStatus,
  SummaryStatus,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopSelection,
  WorkFilter,
  AuthorSummary,
} from '@shared/types';
import path from 'node:path';
import { getDb, openDbPath } from '../db/database';
import { getActiveVault, listVaults } from '../vaults/vaultRegistry';
import * as ideas from '../db/ideasRepo';
import { getWork, getWorkByZoteroKey, getWorkByAliasKey, listWorks } from '../db/worksRepo';
import * as gaps from '../db/gapsRepo';
import * as notes from '../db/notesRepo';
import * as passages from '../db/passagesRepo';
import * as projects from '../db/projectsRepo';
import * as researchQuestions from '../db/researchMapRepo';
import * as themes from '../db/themesRepo';
import * as tutorRoutes from '../db/tutorRepo';
import * as workSummaries from '../db/workSummariesRepo';
import { getDocumentProfile } from '../db/documentProfilesRepo';
import { retrieveHierarchical } from '../ai/hierarchicalRetrieval';
import { listPersons, getPerson, listEvents, listEvidenceFor, recordCounts } from '../db/entitiesRepo';
import * as archive from '../db/archiveRepo';
import * as dbMode from '../db/databasesRepo';
import * as pages from '../db/pagesRepo';
import * as pageComments from '../db/pageCommentsRepo';
import * as pageAcl from '../db/aclRepo';
import * as databaseTasks from '../db/databaseTasksRepo';
import * as databaseAutomations from '../db/databaseAutomationsRepo';
import * as databaseResearch from '../db/databaseDeepResearchRepo';
import {
  DATABASE_DEEP_RESEARCH_REPORT_TYPES,
  DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES,
  DATABASE_RESEARCH_BUDGETS,
  estimateDatabaseDeepResearchCost,
  getDatabaseDeepResearchAnalysisRequirements,
  getDatabaseDeepResearchEligibility,
  normalizeDatabaseDeepResearchJobInput,
  normalizeDatabaseDeepResearchReportType,
  redactDatabaseResearchMarkdown,
  sanitizeDatabaseResearchExternal,
  type DatabaseDeepResearchJobInput,
  type DatabaseDeepResearchReportType,
  type DatabaseResearchRunStatus,
} from '@shared/databaseDeepResearch';
import { buildDatabaseDeepResearchPreviewSections } from '@shared/databaseDeepResearchPrompts';
import { enqueueDatabaseDeepResearch, ensureDatabaseDeepResearchLane } from '../ai/databaseDeepResearchLane';
import {
  decodeCheckbox,
  decodeMultiSelect,
  decodeNumber,
  encodeNumber,
  encodeMultiSelect,
  normalizeCellValue,
} from '@shared/databases';
import { comparableType, type FormulaSpec } from '@shared/databaseFormula';
import { describeFormula } from '@shared/databaseFormulaEval';
import {
  applyDatabaseFilter,
  sortDatabaseRows,
  operatorsForColumn,
  opNeedsValue,
  type FilterCondition,
  type FilterOp,
} from '@shared/databaseFilters';
import { STUDY_QUESTION_TYPES, type StudyQuestionType } from '@shared/studyQuestions';

import type { ArchiveItem, DatabaseColumn, DatabaseRow, HistoricalEventType } from '@shared/types';
import { kinOf } from '../db/relationshipsRepo';
import { listOpenSuggestions, listSuggestionsForPerson } from '../db/kinshipSuggestionsRepo';
import * as writingDrafts from '../db/writingDraftsRepo';
import * as studyOrg from '../db/studyOrgRepo';
import * as studyQuestions from '../db/studyQuestionsRepo';
import * as studyLearning from '../db/studyLearningRepo';
import * as studySchedule from '../db/studyScheduleRepo';
import * as teachingGroups from '../db/teachingGroupsRepo';
import * as teachingGrades from '../db/teachingGradesRepo';
import * as teachingExams from '../db/teachingExamsRepo';
import * as teachingRubrics from '../db/teachingRubricsRepo';
import { getProsopPopulationWorkspace } from '../db/prosopPopulationRepo';
import { getProsopIdentityWorkspace } from '../db/prosopIdentityRepo';
import { getProsopObservationsWorkspace } from '../db/prosopFactoidsRepo';
import { getProsopMembershipWorkspace } from '../db/prosopMembershipRepo';
import { runProsopAnalysis } from '../db/prosopAnalysisRepo';
import { createProsopProposal, searchProsopography } from '../db/prosopSearchRepo';
import {
  characterCounts,
  createCharacter,
  getCharacter,
  listCharacterAbilities,
  listCharacterEvents,
  listCharacters,
  listWorldEvents,
  updateCharacter,
} from '../db/charactersRepo';
import {
  createWorldPlace,
  getWorldPlace,
  inhabitantsOfPlace,
  listWorldPlaces,
  updateWorldPlace,
} from '../db/worldPlacesRepo';
import {
  createWorldGroup,
  getWorldGroup,
  listAffiliationsForCharacter,
  listAffiliationsForGroup,
  listWorldGroups,
  updateWorldGroup,
} from '../db/worldGroupsRepo';
import {
  appearancesOfCharacter,
  createScene,
  createSecret,
  listKnowers,
  listSceneCharacters,
  listScenes,
  listSecrets,
  secretsForCharacter,
  updateScene,
  updateSecret,
} from '../db/worldStoryRepo';
import {
  createWorldArticle,
  getWorldArticle,
  getWorldEntry,
  listWorldEntries,
  searchWorldBodies,
  updateWorldArticle,
  worldBacklinks,
  worldUnresolvedLinks,
} from '../db/worldEncyclopediaRepo';
import {
  createWorldThread,
  getWorldThread,
  listWorldBeats,
  listWorldThreads,
  threadBoardData,
  updateWorldThread,
} from '../db/worldThreadsRepo';
import { createWorldRule, getWorldRule, listWorldRules, updateWorldRule } from '../db/worldRulesRepo';
import {
  createWorldQuestion,
  getWorldQuestion,
  listWorldQuestions,
  questionFeed,
  updateWorldQuestion,
} from '../db/worldQuestionsRepo';
import { getWorldMap, listWorldMaps, mapAncestry, placeMapAppearances } from '../db/worldMapsRepo';
import {
  getSceneText,
  manuscriptProgress,
  manuscriptSpine,
  saveSceneText,
} from '../db/worldManuscriptRepo';
import { continuitySummary, listNoticeMutes, runContinuity } from '../db/worldContinuityRepo';
import { getWorldCalendar } from '../db/worldCalendarRepo';
import { gradebookToGrid, anonymousGrid, GRID_COL, type GridStudent } from '@shared/assessment';
import { isStudentFilled } from '@shared/teachingGroups';
import { normalizeVaultType, type VaultType } from '@shared/vaultTypes';
import { searchStudyCorpus } from '../ai/studySearch';
import { buildAuthorGraph, getDebate, getDebates } from '../graph/graphService';
import { embedQuery, AiError } from '../ai/aiClient';
import { decomposeQuestion, mapCoverage } from '../ai/researchMap';
import { buildWritingWorkshopSnapshot, generateWritingWorkshopDraft } from '../ai/writingWorkshop';
import { buildDeepResearchBrief, assembleClientDeepResearchReport } from '../ai/deepResearchClient';
import { ensureDeepResearchLane } from '../ai/deepResearchLane';
import {
  cancelDeepResearchJob,
  enqueueDeepResearchJob,
  getDeepResearchJob,
  listDeepResearchJobs,
  runDeepResearchJob,
  type DeepResearchJobRecord,
} from '../ai/deepResearchQueue';
import { analyzeText, composeCopilotIdeaInsertion, getCopilotIdeaDetail } from '../ai/liveRelations';
import {
  buildAuthorDossier,
  listAuthors as listAuthorSummaries,
  synthesizeAuthorDossier,
} from '../ai/authorDossier';

const IDEA_TYPES = ['claim', 'finding', 'construct', 'method', 'framework'] as const;
const EDGE_TYPES = [
  'extends',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'variant_of',
  'refines',
  'contains',
] as const;
const GAP_KINDS = ['future_work', 'limitation', 'open_question', 'unresolved_contradiction'] as const;
const LIGHT_STATUSES = ['all', 'none', 'pending', 'done', 'failed'] as const;
const DEEP_STATUSES = ['all', 'none', 'pending', 'done', 'failed', 'skipped_no_text'] as const;
const SUMMARY_STATUSES = ['all', 'none', 'pending', 'done', 'failed', 'skipped_no_text'] as const;
// The canonical provider list had drifted here (xiaomi and the local providers
// were missing), silently rejecting valid model overrides from MCP clients.
const AI_PROVIDERS = SHARED_AI_PROVIDERS as [AiProvider, ...AiProvider[]];
const NOTE_KINDS = ['markdown', 'assistant', 'writing', 'debate', 'idea'] as const;
const PROJECT_KINDS = ['thesis', 'article', 'chapter', 'literature_review', 'theoretical_framework', 'other'] as const;
const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
const TUTOR_MODES = ['overview', 'prompt'] as const;
const WRITING_KINDS = [
  'literature_review',
  'theoretical_framework',
  'debate',
  'gap_justification',
  'chapter_section',
  'research_question',
] as const;
const SAVED_WRITING_KINDS = [...WRITING_KINDS, 'deep_research'] as const;
const EVENT_TYPES = [
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'census',
  'residence',
  'migration',
  'occupation',
  'other',
] as const satisfies readonly HistoricalEventType[];
const ARCHIVE_KINDS = ['image', 'csv', 'xlsx', 'pdf', 'text', 'other'] as const;
const STUDY_QUESTION_TYPE_VALUES = STUDY_QUESTION_TYPES as unknown as [string, ...string[]];
// The question-bank filter matches stored per-question difficulty; 'mixed' only exists
// as a generation setting, so it is not offered here.
const STUDY_QUESTION_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const STUDY_QUESTION_STATUSES = ['pending', 'approved', 'problematic', 'discarded'] as const;
// The same operator vocabulary the in-app filter bar uses (shared/databaseFilters).
const DB_FILTER_OPS = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'isEmpty',
  'notEmpty',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'isAnyOf',
  'isNoneOf',
  'hasAllOf',
  'isChecked',
  'isUnchecked',
] as const satisfies readonly FilterOp[];

const WORLD_CHARACTER_ROLES = ['protagonist', 'antagonist', 'secondary', 'tertiary', 'cameo'] as const;
const WORLD_CHARACTER_STATUSES = ['unknown', 'alive', 'dead', 'missing', 'undead', 'immortal', 'unborn'] as const;
const WORLD_GROUP_KINDS = ['faction', 'culture', 'religion', 'house', 'order', 'species', 'language'] as const;
const WORLD_GROUP_STATUSES = ['active', 'extinct', 'dormant'] as const;
const WORLD_SCENE_STATUSES = ['outline', 'draft', 'written'] as const;
const WORLD_MAP_KINDS = [
  'world', 'continent', 'region', 'city', 'town', 'building', 'interior',
  'dungeon', 'battle', 'route', 'schematic', 'other',
] as const;
const WORLD_ENTRY_KINDS = ['article', 'character', 'place', 'group', 'scene', 'map', 'conflict', 'rule'] as const;
const WORLD_ARTICLE_CATEGORIES = [
  'magic', 'religion', 'language', 'creature', 'species', 'artifact', 'technology',
  'concept', 'event', 'organization', 'flora', 'fauna', 'custom', 'other',
] as const;
const WORLD_THREAD_KINDS = ['conflict', 'arc'] as const;
const WORLD_THREAD_STATUSES = ['open', 'resolved', 'archived'] as const;
const WORLD_THREAD_SCOPES = ['external', 'background'] as const;
const WORLD_RULE_HARDNESS = ['physical', 'costly', 'social'] as const;
const WORLD_RULE_STATUSES = ['canon', 'tentative', 'retired'] as const;
const WORLD_QUESTION_STATUSES = ['open', 'answered', 'parked'] as const;
const WORLD_QUESTION_ORIGINS = ['author', 'placeholder'] as const;

const nullableWorldText = (max = 200_000) => z.string().max(max).nullable().optional();
const nullableWorldId = z.string().trim().min(1).nullable().optional();
const nullableWorldInt = z.number().int().nullable().optional();
const worldCharacterPatchSchema = {
  displayName: z.string().trim().min(1).max(500).optional(),
  species: nullableWorldText(500),
  gender: nullableWorldText(500),
  pronouns: nullableWorldText(500),
  lifeStatus: z.enum(WORLD_CHARACTER_STATUSES).optional(),
  narrativeRole: z.enum(WORLD_CHARACTER_ROLES).nullable().optional(),
  accent: nullableWorldText(100),
  appearance: nullableWorldText(),
  personality: nullableWorldText(),
  backstory: nullableWorldText(),
  visualSeed: nullableWorldText(20_000),
  birthDate: nullableWorldText(200),
  deathDate: nullableWorldText(200),
  birthYearSort: nullableWorldInt,
  deathYearSort: nullableWorldInt,
  notes: nullableWorldText(),
  arc: z.object({
    want: nullableWorldText(),
    need: nullableWorldText(),
    flaw: nullableWorldText(),
    lie: nullableWorldText(),
    wound: nullableWorldText(),
  }).optional(),
  voice: z.object({
    register: nullableWorldText(),
    tics: nullableWorldText(),
    sample: nullableWorldText(),
  }).optional(),
};
const worldPlacePatchSchema = {
  name: z.string().trim().min(1).max(500).optional(),
  kind: nullableWorldText(200),
  parentId: nullableWorldId,
  notes: nullableWorldText(),
  appearance: nullableWorldText(),
  atmosphere: nullableWorldText(),
  history: nullableWorldText(),
  visualSeed: nullableWorldText(20_000),
  accent: nullableWorldText(100),
};
const worldGroupPatchSchema = {
  kind: z.enum(WORLD_GROUP_KINDS).optional(),
  name: z.string().trim().min(1).max(500).optional(),
  summary: nullableWorldText(),
  description: nullableWorldText(),
  visualSeed: nullableWorldText(20_000),
  accent: nullableWorldText(100),
  status: z.enum(WORLD_GROUP_STATUSES).nullable().optional(),
  parentId: nullableWorldId,
  seatPlaceId: nullableWorldId,
  foundedYear: nullableWorldInt,
  endedYear: nullableWorldInt,
  notes: nullableWorldText(),
};
const worldScenePatchSchema = {
  title: z.string().trim().min(1).max(1_000).optional(),
  summary: nullableWorldText(),
  placeId: nullableWorldId,
  worldYear: nullableWorldInt,
  worldDay: nullableWorldInt,
  status: z.enum(WORLD_SCENE_STATUSES).optional(),
  narrativeOrder: z.number().int().min(0).optional(),
  notes: nullableWorldText(),
};
const worldArticlePatchSchema = {
  title: z.string().trim().min(1).max(1_000).optional(),
  category: z.enum(WORLD_ARTICLE_CATEGORIES).optional(),
  summary: nullableWorldText(),
  body: nullableWorldText(500_000),
  aka: nullableWorldText(10_000),
  spoiler: z.boolean().optional(),
  sortTitle: nullableWorldText(1_000),
  notes: nullableWorldText(),
};
const worldThreadPatchSchema = {
  kind: z.enum(WORLD_THREAD_KINDS).optional(),
  title: z.string().trim().min(1).max(1_000).optional(),
  pitch: nullableWorldText(),
  stakes: nullableWorldText(),
  scope: z.enum(WORLD_THREAD_SCOPES).optional(),
  status: z.enum(WORLD_THREAD_STATUSES).optional(),
  outcome: nullableWorldText(),
};
const worldRulePatchSchema = {
  title: z.string().trim().min(1).max(1_000).optional(),
  statement: nullableWorldText(),
  cost: nullableWorldText(),
  limits: nullableWorldText(),
  hardness: z.enum(WORLD_RULE_HARDNESS).optional(),
  parentRuleId: nullableWorldId,
  articleId: nullableWorldId,
  scopeKind: z.enum(['world', 'group', 'place']).optional(),
  scopeId: nullableWorldId,
  fromWorldDay: nullableWorldInt,
  toWorldDay: nullableWorldInt,
  status: z.enum(WORLD_RULE_STATUSES).optional(),
  secretId: nullableWorldId,
};
const worldQuestionPatchSchema = {
  question: z.string().trim().min(1).max(8_000).optional(),
  anchorKind: nullableWorldText(100),
  anchorId: nullableWorldId,
  anchorField: nullableWorldText(100),
  status: z.enum(WORLD_QUESTION_STATUSES).optional(),
  origin: z.enum(WORLD_QUESTION_ORIGINS).optional(),
  originKey: nullableWorldText(1_000),
  blocking: z.boolean().optional(),
};

const modelSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1).max(300),
  })
  .describe('Nodus model override. If omitted, the model configured in Nodus Settings is used.');

/** Derived from the shared list so the MCP surface can never accept a narrower set of
 *  languages than the app itself offers. */
const promptLanguageSchema = z.enum(PROMPT_LANGUAGES);
const deepResearchApproachSchema = z.enum(DEEP_RESEARCH_APPROACHES).default('general');
const deepResearchVersionSchema = z
  .enum(DEEP_RESEARCH_VERSIONS)
  .default('v1')
  .describe('Deep Research engine. v1 is the lower-token default for simple retrieval. v2 uses more tokens and, in academic vaults, may create or refresh full-document profiles for up to 8 relevant works.');

const writingBriefSchema = z.object({
  kind: z.enum(WRITING_KINDS),
  objective: z.string().trim().min(1).max(8_000),
  audience: z.string().trim().max(1_000).optional(),
  tone: z.enum(['academic', 'synthetic', 'critical', 'exploratory']).optional(),
  language: promptLanguageSchema.optional(),
  deepResearchApproach: z.enum(DEEP_RESEARCH_APPROACHES).optional(),
  deepResearchVersion: z.enum(DEEP_RESEARCH_VERSIONS).optional(),
});

const writingSelectionSchema = z.object({
  ideaIds: z.array(z.string().min(1)).max(300),
  themeIds: z.array(z.string().min(1)).max(100),
  gapIds: z.array(z.string().min(1)).max(300),
  contradictionIds: z.array(z.string().min(1)).max(300),
  workIds: z.array(z.string().min(1)).max(300),
  passageIds: z.array(z.string().min(1)).max(300),
  tutorRouteIds: z.array(z.string().min(1)).max(100),
});

const deepResearchSectionLimitSchema = z
  .union([z.literal('auto'), z.literal('single'), z.number().int().min(1).max(20)])
  .default('auto')
  .describe('Report structure. "auto" lets Nodus choose headed sections; "single" publishes one continuous narrative without internal headings; a number is a hard MAXIMUM number of published sections — an over-sized plan is compacted into it and no evidence is dropped.');

const deepResearchSectionLengthSchema = z
  .union([
    z.literal('auto'),
    z.number().int().min(DEEP_RESEARCH_SECTION_LENGTH_MIN).max(DEEP_RESEARCH_SECTION_LENGTH_MAX),
  ])
  .default('auto')
  .describe(
    `Guideline length of EACH section, in WORDS (not tokens, and not words of the whole report). "auto" (the default) leaves it to Nodus, exactly as before this option existed. A number between ${DEEP_RESEARCH_SECTION_LENGTH_MIN} and ${DEEP_RESEARCH_SECTION_LENGTH_MAX} is editorial guidance, never a quota: long targets are produced by bounded continuation passes, and a section stops early rather than repeat, pad, invent or overstate when the corpus runs out.`,
  );

const writingDraftSchema = z.object({
  generatedAt: z.string().min(1),
  brief: writingBriefSchema,
  selection: writingSelectionSchema,
  title: z.string().min(1).max(2_000),
  abstract: z.string().max(20_000),
  outline: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      purpose: z.string(),
      keyClaims: z.array(z.string()),
      sources: z.array(z.string()),
    })
  ),
  draftMarkdown: z.string().max(200_000),
  matrix: z.array(
    z.object({
      claim: z.string(),
      role: z.enum(['support', 'contrast', 'gap', 'method', 'definition', 'context']),
      sourceLabel: z.string(),
      citation: z.string(),
      evidence: z.string(),
      notes: z.string(),
    })
  ),
  bibliography: z.array(z.string()),
  nextSteps: z.array(z.string()),
  limitations: z.array(z.string()),
  deepResearchApproach: z.enum(DEEP_RESEARCH_APPROACHES).optional(),
  deepResearchVersion: z.enum(DEEP_RESEARCH_VERSIONS).optional(),
  deepResearchStructure: z.enum(['sectioned', 'single']).optional(),
  generationModel: modelSchema.nullable().optional(),
  stats: z.object({
    selectedIdeas: z.number().int().nonnegative(),
    selectedThemes: z.number().int().nonnegative(),
    selectedGaps: z.number().int().nonnegative(),
    selectedContradictions: z.number().int().nonnegative(),
    selectedWorks: z.number().int().nonnegative(),
    selectedPassages: z.number().int().nonnegative(),
    selectedTutorRoutes: z.number().int().nonnegative(),
    contextChars: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

const paginationSchema = {
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
};
const compactLimitSchema = z.number().int().min(1).max(100).default(25);
const savedDraftSortSchema = z
  .enum(['newest', 'oldest', 'title'])
  .default('newest')
  .describe('Sort by most recently updated, oldest updated, or title.');
const querySchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .optional()
  .describe('Case-insensitive substring matched against the main text fields of each entity (title/label, statement/content…), never against ids or enum values.');

class McpToolError extends Error {
  constructor(
    readonly category: 'not_found' | 'invalid_input' | 'permission_denied' | 'ai_unconfigured' | 'ai_transient' | 'internal',
    message: string
  ) {
    super(message);
  }
}

function notFound(kind: string, id: string): McpToolError {
  return new McpToolError('not_found', `No ${kind} exists with id "${id}".`);
}

function assertMcpAcl(
  resourceType: 'vault' | 'page' | 'database' | 'view' | 'row',
  resourceId: string,
  capability: 'view' | 'comment' | 'edit_content' | 'edit',
): void {
  try {
    pageAcl.assertAcl(resourceType, resourceId, 'local', capability);
  } catch (error) {
    if (error instanceof Error && error.message.includes('permiso')) {
      throw new McpToolError(
        'permission_denied',
        `The local MCP principal does not have ${capability} permission for this ${resourceType}.`,
      );
    }
    throw error;
  }
}

function canMcpView(resourceType: 'page' | 'database' | 'view' | 'row', resourceId: string): boolean {
  try {
    return pageAcl.getEffectiveAcl(resourceType, resourceId, 'local').canView;
  } catch {
    return false;
  }
}

function databaseResearchRunDatabaseIds(run: ReturnType<typeof databaseResearch.getDatabaseResearchRun>): string[] {
  if (!run) return [];
  const requested = Array.isArray(run.options?.databaseIds)
    ? run.options.databaseIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return [...new Set([run.databaseId, ...requested])];
}

/** A multi-source research run is visible only when the MCP principal can
 * view every participating database. This prevents aggregate information from
 * a secondary database leaking through an otherwise-authorized anchor. */
function canMcpViewDatabaseResearchRun(run: ReturnType<typeof databaseResearch.getDatabaseResearchRun>): boolean {
  const databaseIds = databaseResearchRunDatabaseIds(run);
  return databaseIds.length > 0 && databaseIds.every((databaseId) => canMcpView('database', databaseId));
}

function safeMcpDatabaseResearchJob(run: NonNullable<ReturnType<typeof databaseResearch.getDatabaseResearchRun>>) {
  const job = databaseResearch.databaseResearchJob(run);
  return {
    ...job,
    title: redactDatabaseResearchMarkdown(job.title),
    error: job.error == null ? null : redactDatabaseResearchMarkdown(job.error),
  };
}

function visibleDatabaseResearchRuns(status: DatabaseResearchRunStatus | 'all', offset: number, limit: number) {
  const visible: ReturnType<typeof databaseResearch.listDatabaseResearchRuns> = []; let skipped = 0; let sourceOffset = 0;
  while (visible.length <= limit) {
    const batch = databaseResearch.listDatabaseResearchRuns({ status, limit: 200, offset: sourceOffset });
    sourceOffset += batch.length;
    for (const run of batch) {
      if (!canMcpViewDatabaseResearchRun(run)) continue;
      if (skipped++ < offset) continue;
      visible.push(run);
      if (visible.length > limit) break;
    }
    if (batch.length < 200) break;
  }
  return { items: visible.slice(0, limit), hasMore: visible.length > limit };
}

function visibleDatabaseResearchReports(query: string | undefined, offset: number, limit: number, reportType?: DatabaseDeepResearchReportType) {
  const visible: ReturnType<typeof databaseResearch.listDatabaseResearchReports> = []; let skipped = 0; let sourceOffset = 0;
  while (visible.length <= limit) {
    const batch = databaseResearch.listDatabaseResearchReports({ query, reportType, limit: 200, offset: sourceOffset });
    sourceOffset += batch.length;
    for (const report of batch) {
      const run = databaseResearch.getDatabaseResearchRun(report.runId);
      if (!canMcpViewDatabaseResearchRun(run)) continue;
      if (skipped++ < offset) continue;
      visible.push(report);
      if (visible.length > limit) break;
    }
    if (batch.length < 200) break;
  }
  return { items: visible.slice(0, limit).map((report) => safeMcpDatabaseResearchReport(report)), hasMore: visible.length > limit };
}

/** MCP is an external boundary: never return the persisted evidence graph or
 * model echoes verbatim. Keep report prose useful while recursively removing
 * cell-derived strings from structured payloads. */
function safeMcpDatabaseResearchReport(report: ReturnType<typeof databaseResearch.getDatabaseResearchReport>) {
  if (!report) return null;
  return {
    id: report.id,
    runId: report.runId,
    title: redactDatabaseResearchMarkdown(report.title),
    reportType: report.reportType ?? 'general',
    markdown: redactDatabaseResearchMarkdown(report.markdown),
    summary: report.summary == null ? null : redactDatabaseResearchMarkdown(report.summary),
    bibliography: sanitizeDatabaseResearchExternal(report.bibliography),
    metadata: sanitizeDatabaseResearchExternal(report.metadata),
    structured: sanitizeDatabaseResearchExternal(report.structured),
    quality: sanitizeDatabaseResearchExternal(report.quality),
    provenance: sanitizeDatabaseResearchExternal(report.provenance),
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function safeMcpDatabaseResearchJobDetail(detail: ReturnType<typeof databaseResearch.getDatabaseResearchRunDetail>) {
  if (!detail) return null;
  return {
    run: {
      ...safeMcpDatabaseResearchJob(detail.run),
      databaseId: detail.run.databaseId,
      reportType: detail.run.reportType ?? 'general',
      model: sanitizeDatabaseResearchExternal(detail.run.model),
      snapshotFingerprint: detail.run.snapshotFingerprint,
      snapshotManifest: sanitizeDatabaseResearchExternal(detail.run.snapshotManifest),
      updatedAt: detail.run.updatedAt,
    },
    steps: sanitizeDatabaseResearchExternal(detail.steps),
    claims: sanitizeDatabaseResearchExternal(detail.claims),
    report: safeMcpDatabaseResearchReport(detail.report),
  };
}

function json(value: unknown) {
  const content = [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
  // Modern MCP clients prefer structuredContent over re-parsing the text block. We
  // mirror object results there (the spec's structuredContent must be an object, not
  // an array or primitive) while still sending the text for older clients. No
  // outputSchema is declared, so the SDK forwards it without per-tool validation.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { content, structuredContent: value as Record<string, unknown> };
  }
  return { content };
}

function errorResult(error: unknown) {
  if (error instanceof McpToolError) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: { category: error.category, message: error.message } }) }],
      isError: true,
    };
  }
  if (error instanceof AiError) {
    const category = error.config ? 'ai_unconfigured' : error.retriable ? 'ai_transient' : 'internal';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: { category, message: error.message } }) }],
      isError: true,
    };
  }
  console.error('[mcp] tool failed', error);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: { category: 'internal', message: 'The operation could not be completed in Nodus.' } }),
      },
    ],
    isError: true,
  };
}

function tool<T>(fn: () => T | Promise<T>) {
  return async () => {
    try {
      return json(await fn());
    } catch (error) {
      return errorResult(error);
    }
  };
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Bridges a Nodus onProgress callback to MCP notifications/progress so clients can
 *  keep long tool calls alive. No-op when the client sent no progressToken. */
function progressNotifier(extra: ToolExtra | undefined): (message: string) => void {
  const progressToken = extra?._meta?.progressToken;
  if (extra === undefined || progressToken === undefined) return () => {};
  let step = 0;
  return (message) => {
    step += 1;
    void extra
      .sendNotification({ method: 'notifications/progress', params: { progressToken, progress: step, message } })
      .catch(() => {
        /* progress is best-effort; a dropped notification must never abort the tool */
      });
  };
}

function page<T, K extends string>(key: K, rows: T[], limit: number, offset: number): Record<K, T[]> & {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
} {
  const slice = rows.slice(offset, offset + limit);
  return {
    [key]: slice,
    total: rows.length,
    limit,
    offset,
    hasMore: offset + slice.length < rows.length,
  } as Record<K, T[]> & { total: number; limit: number; offset: number; hasMore: boolean };
}

/**
 * Semantic search can only find what has been embedded, and an unindexed corpus returns
 * exactly what an irrelevant query returns: nothing. A bare empty list therefore reads as
 * "the corpus does not discuss this" — a confident false negative — when the truth is
 * "this was never indexed" (never scanned, or the embedding model changed in Settings and
 * the stored vectors no longer match). Every semantic tool reports its index coverage, and
 * says so outright when there is none, so a client can tell the two apart.
 */
function searchCoverage(indexed: number, indexable: number, what: string) {
  return {
    indexed,
    indexable,
    ...(indexed === 0
      ? {
          warning:
            `No ${what} in this vault are indexed for semantic search with the embedding model currently configured in Nodus, so this search cannot match anything. ` +
            'An empty result here does NOT mean the corpus lacks the topic — do not tell the user it does. Ask them to index the vault in Nodus (or restore the embedding model it was indexed with).',
        }
      : {}),
  };
}

/** Case-insensitive substring match over an entity's human-readable text fields only,
 *  so a query never matches JSON keys, enum values or internal ids. */
function matchesText(query: string | undefined, fields: (string | null | undefined)[]): boolean {
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  return fields.some((field) => !!field && field.toLowerCase().includes(q));
}

function debateSearchFields(debate: Debate): string[] {
  return [
    debate.tension,
    ...debate.sharedThemes,
    ...[debate.sideA, debate.sideB].flatMap((side) => [
      side.label,
      side.statement,
      ...side.authors,
      ...side.works.map((work) => work.title),
    ]),
  ];
}

function snippet(text: string | null | undefined, max = 360): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function parseAuthorsJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function count(table: 'ideas' | 'works' | 'gaps' | 'authors' | 'notes' | 'themes' | 'passages'): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

/**
 * The vault these tools actually serve, resolved from the database file this process
 * has OPEN rather than the registry's activeVaultId: the connection is cached until an
 * explicit vault switch, while the registry is a file any second Nodus instance can
 * rewrite underneath us. Trusting the registry would label another vault's data with
 * this vault's name — a silent misattribution — so we serve (and report) the open one.
 */
function servingVault() {
  const vaults = listVaults();
  const registryActive = getActiveVault();
  const openPath = openDbPath();
  const serving =
    (openPath ? vaults.find((vault) => path.resolve(vault.path) === path.resolve(openPath)) : null) ?? registryActive;
  return { vaults, registryActive, serving };
}

/** The vault type the MCP surface is scoped to for the current session. */
export function resolveServingVaultType(): VaultType {
  return normalizeVaultType(servingVault().serving.type);
}

/**
 * Describes the vault these tools are actually serving, plus the vaults available to
 * switch to. When the open vault and the registry disagree we hand the client a
 * `warning` it can relay instead of guessing.
 */
function vaultContext() {
  const { vaults, registryActive, serving } = servingVault();
  const diverged = serving.id !== registryActive.id;
  return {
    active: { id: serving.id, name: serving.name, type: serving.type },
    available: vaults.map((vault) => ({ id: vault.id, name: vault.name, type: vault.type, active: vault.id === serving.id })),
    ...(diverged
      ? {
          warning:
            `Nodus has since made "${registryActive.name}" the active vault (another window or instance switched it), but this MCP server still serves "${serving.name}". ` +
            'Every tool here returns data from "' +
            serving.name +
            '". Ask the user to restart Nodus (or reconnect this MCP client) before trusting these results for the other vault.',
        }
      : {}),
  };
}

// ── Databases mode (read-only) decode helpers ────────────────────────────────

/** Decode a cell to a human-readable value for MCP (resolves option labels, counts). */
function dbCellValue(col: DatabaseColumn, row: DatabaseRow): unknown {
  const raw = row.cells[col.id] ?? null;
  // A rollup is derived and kept beside the cells, so it has to be read from there or it
  // reaches the client as null. A formula lives in cells but is typed by what it computes,
  // so a numeric one is handed over as a number rather than as a string.
  if (col.type === 'rollup') return row.rollups?.[col.id] ?? null;
  switch (comparableType(col)) {
    case 'select':
      return col.options.find((o) => o.id === raw)?.label ?? null;
    case 'multi_select':
      return decodeMultiSelect(raw).map((id) => col.options.find((o) => o.id === id)?.label ?? id);
    case 'checkbox':
      return decodeCheckbox(raw);
    case 'number':
      return decodeNumber(raw);
    case 'attachment':
      return (row.attachments?.[col.id] ?? []).map((a) => a.fileName);
    case 'relation':
      return { links: row.relationCounts?.[col.id] ?? 0 };
    default:
      return raw;
  }
}

function dbRowRecord(columns: DatabaseColumn[], row: DatabaseRow): { id: string; fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  for (const col of columns) fields[col.name] = dbCellValue(col, row);
  return { id: row.id, fields };
}

/** Resolve a column reference (id or case-insensitive name) with a helpful error. */
function dbResolveColumn(columns: DatabaseColumn[], ref: string): DatabaseColumn {
  const needle = ref.trim().toLowerCase();
  const found = columns.find((c) => c.id === ref) ?? columns.find((c) => c.name.toLowerCase() === needle);
  if (!found) {
    throw new McpToolError(
      'invalid_input',
      `No column named "${ref}" exists in this database. Available columns: ${columns.map((c) => c.name).join(', ')}.`
    );
  }
  return found;
}

/** Build a shared-engine FilterCondition from an MCP condition (labels → option ids). */
function dbBuildCondition(
  columns: DatabaseColumn[],
  input: { column: string; op: FilterOp; value?: string | string[] }
): FilterCondition {
  const column = dbResolveColumn(columns, input.column);
  const allowed = operatorsForColumn(column);
  if (!allowed.includes(input.op)) {
    throw new McpToolError(
      'invalid_input',
      `Operator "${input.op}" does not apply to column "${column.name}" (${comparableType(column)}). Valid operators: ${
        allowed.length ? allowed.join(', ') : 'none — this column is not filterable'
      }.`
    );
  }
  if (opNeedsValue(input.op) && (input.value === undefined || (Array.isArray(input.value) && input.value.length === 0))) {
    throw new McpToolError('invalid_input', `Operator "${input.op}" on column "${column.name}" requires a value.`);
  }
  let value: string | string[] | undefined = input.value;
  const type = comparableType(column);
  if ((type === 'select' || type === 'multi_select') && input.value !== undefined) {
    const labels = Array.isArray(input.value) ? input.value : [input.value];
    value = labels.map((label) => {
      const needle = label.trim().toLowerCase();
      const option = column.options.find((o) => o.id === label) ?? column.options.find((o) => o.label.toLowerCase() === needle);
      if (!option) {
        throw new McpToolError(
          'invalid_input',
          `Column "${column.name}" has no option "${label}". Available options: ${column.options.map((o) => o.label).join(', ')}.`
        );
      }
      return option.id;
    });
  }
  return { id: `mcp-${column.id}-${input.op}`, columnId: column.id, op: input.op, value };
}

// ── Genealogy / records decode helpers ────────────────────────────────────────

/** Compact archive item for list results: metadata plus text snippets, never the blob. */
function compactArchiveItem(item: ArchiveItem, folderNames: Map<string, string>) {
  return {
    itemId: item.itemId,
    title: item.title,
    kind: item.kind,
    docType: item.docType,
    year: item.year,
    fileName: item.fileName,
    mimeType: item.mimeType,
    hasFile: item.hasBlob,
    folders: item.folderIds.map((id) => folderNames.get(id) ?? id),
    tags: item.tags,
    linkedPersons: item.linkedPersons.map((p) => p.displayName),
    source: item.source,
    descriptionSnippet: snippet(item.description, 300) || null,
    extractedTextSnippet: snippet(item.extractedText, 300) || null,
    updatedAt: item.updatedAt,
  };
}

function archiveFolderNames(): Map<string, string> {
  return new Map(archive.listFolders().map((folder) => [folder.folderId, folder.name]));
}

function dbRowSearchText(columns: DatabaseColumn[], row: DatabaseRow): string {
  return columns
    .map((col) => {
      const v = dbCellValue(col, row);
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(' ');
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    })
    .join(' ')
    .toLowerCase();
}

function workCounts(nodusId: string) {
  const db = getDb();
  const scalar = (sql: string) => (db.prepare(sql).get(nodusId) as { n: number }).n;
  return {
    ideas: scalar('SELECT COUNT(DISTINCT global_id) AS n FROM idea_occurrences WHERE nodus_id = ?'),
    evidence: scalar('SELECT COUNT(*) AS n FROM evidence WHERE nodus_id = ?'),
    gaps: scalar('SELECT COUNT(*) AS n FROM gaps WHERE nodus_id = ?'),
    passages: scalar('SELECT COUNT(*) AS n FROM passages WHERE nodus_id = ?'),
  };
}

function compactProjectChapter(chapter: ProjectChapter, includeText = false) {
  if (includeText) return chapter;
  const { originalText: _originalText, currentMarkdown: _currentMarkdown, ...rest } = chapter;
  return {
    ...rest,
    currentMarkdownSnippet: snippet(chapter.currentMarkdown, 500),
  };
}

function compactTutorRoute(route: NonNullable<ReturnType<typeof tutorRoutes.getTutorRoute>>) {
  return {
    id: route.id,
    planId: route.planId,
    generatedAt: route.generatedAt,
    updatedAt: route.updatedAt,
    lastPlayedAt: route.lastPlayedAt,
    mode: route.mode,
    prompt: route.prompt,
    overview: route.overview,
    totalThemes: route.totalThemes,
    totalIdeas: route.totalIdeas,
    totalConnections: route.totalConnections,
    rating: route.rating,
    model: route.model,
    routeTitle: route.route.title,
    stopCount: route.route.stops.length,
  };
}

function resolveTheme(value: string) {
  const needle = value.trim().toLowerCase();
  return themes.listManagedThemes().find((theme) => theme.theme_id === value || theme.label.toLowerCase() === needle) ?? null;
}

function authorMatchesQuery(author: AuthorSummary, query?: string): boolean {
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  return [
    author.author_id,
    author.name,
    author.fullName,
    author.firstName,
    author.lastName,
    author.affiliation ?? '',
    ...author.topThemes,
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function resolveAuthor(value: string): AuthorSummary {
  const authors = listAuthorSummaries();
  const needle = value.trim().toLowerCase();
  const exact = authors.find(
    (author) =>
      author.author_id === value ||
      author.name.toLowerCase() === needle ||
      author.fullName.toLowerCase() === needle
  );
  if (exact) return exact;

  const matches = authors.filter((author) => authorMatchesQuery(author, value));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw notFound('author', value);
  throw new McpToolError(
    'invalid_input',
    `The search "${value}" matches several authors: ${matches
      .slice(0, 6)
      .map((author) => `${author.fullName || author.name} (${author.author_id})`)
      .join('; ')}. Use the author_id.`
  );
}

function asModel(model?: z.infer<typeof modelSchema>): ModelRef | undefined {
  return model as ModelRef | undefined;
}

/** Resolve a work reference that may be a nodus_id, a Zotero key, or a merged alias key. */
function resolveWorkNodusId(workId: string): string | null {
  const byNodusId = getWork(workId);
  if (byNodusId) return byNodusId.nodus_id;
  const byZoteroKey = getWorkByZoteroKey(workId) ?? getWorkByAliasKey(workId);
  return byZoteroKey?.nodus_id ?? null;
}

function asBrief(brief: z.infer<typeof writingBriefSchema>): WritingWorkshopBrief {
  return brief as WritingWorkshopBrief;
}

function asSelection(selection: z.infer<typeof writingSelectionSchema>): WritingWorkshopSelection {
  return selection as WritingWorkshopSelection;
}

function asDraft(draft: z.infer<typeof writingDraftSchema>): WritingWorkshopDraft {
  return draft as WritingWorkshopDraft;
}

// ── Tool surface scoped to the active vault type ─────────────────────────────
// A Nodus install holds vaults of different types, and each type only populates
// some of the data layers. Mutating/action tools are filtered to the active vault
// type, but every read-only tool is deliberately stable across vaults. MCP clients
// commonly cache tools/list across reconnects: when the old implementation built a
// session in Docencia and the user later switched to an academic vault, the client
// kept Docencia's 23-tool catalogue while nodus_get_capabilities and tool handlers
// correctly read the new vault. That advertised thousands of ideas without exposing
// any way to retrieve them. Stable reads make a cached catalogue safe; empty layers
// simply return an empty page or not-found, while writes remain fail-closed.

/** Vault types whose corpus is analysed works (the research/authoring graph). */
const RESEARCH_VAULTS: VaultType[] = ['academic', 'primary_sources', 'genealogy', 'testimonios'];
/** Vault types with a persons / timeline / evidence-archive records layer. */
const RECORDS_VAULTS: VaultType[] = ['primary_sources', 'genealogy'];
/** Vault types with the structured-tables (databases) layer. */
const DATABASE_VAULTS: VaultType[] = ['databases'];
/** Vault types with the study organisation layer (courses, materials, questions). */
const STUDY_VAULTS: VaultType[] = ['estudio', 'docencia'];
/** Vault types with the teaching layer (groups, gradebook, exams, rubrics). */
const TEACHING_VAULTS: VaultType[] = ['docencia'];
const PROSOPOGRAPHY_VAULTS: VaultType[] = ['prosopography'];
const WORLDBUILDING_VAULTS: VaultType[] = ['worldbuilding'];

/** Tool name → the vault types it is offered in. Absent = universal. */
const TOOL_VAULT_SCOPE: Record<string, VaultType[]> = {
  nodus_prosop_get_design: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_list_population: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_search: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_get_person: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_list_statements: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_get_coverage: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_run_analysis: PROSOPOGRAPHY_VAULTS,
  nodus_prosop_create_proposal: PROSOPOGRAPHY_VAULTS,
  // Research & authoring graph.
  nodus_list_ideas: RESEARCH_VAULTS,
  nodus_get_idea: RESEARCH_VAULTS,
  nodus_get_ideas_by_work: RESEARCH_VAULTS,
  nodus_search_ideas: RESEARCH_VAULTS,
  nodus_analyze_passage: RESEARCH_VAULTS,
  nodus_get_copilot_idea: RESEARCH_VAULTS,
  nodus_compose_insertion: RESEARCH_VAULTS,
  nodus_list_debates: RESEARCH_VAULTS,
  nodus_get_debate: RESEARCH_VAULTS,
  nodus_list_gaps: RESEARCH_VAULTS,
  nodus_get_gap: RESEARCH_VAULTS,
  nodus_search_authors: RESEARCH_VAULTS,
  nodus_get_author_relations: RESEARCH_VAULTS,
  nodus_get_author_synthesis: RESEARCH_VAULTS,
  nodus_list_works: RESEARCH_VAULTS,
  nodus_get_work: RESEARCH_VAULTS,
  nodus_get_document_profile: RESEARCH_VAULTS,
  nodus_search_documents: RESEARCH_VAULTS,
  nodus_search_hybrid: RESEARCH_VAULTS,
  nodus_list_work_passages: RESEARCH_VAULTS,
  nodus_get_passage: RESEARCH_VAULTS,
  nodus_search_passages: RESEARCH_VAULTS,
  nodus_list_themes: RESEARCH_VAULTS,
  nodus_get_theme: RESEARCH_VAULTS,
  nodus_list_tutor_routes: RESEARCH_VAULTS,
  nodus_get_tutor_route: RESEARCH_VAULTS,
  nodus_list_projects: RESEARCH_VAULTS,
  nodus_get_project: RESEARCH_VAULTS,
  nodus_list_coverage_questions: RESEARCH_VAULTS,
  nodus_get_coverage_question: RESEARCH_VAULTS,
  nodus_ask_coverage_question: RESEARCH_VAULTS,
  nodus_writing_snapshot: RESEARCH_VAULTS,
  nodus_generate_writing_draft: RESEARCH_VAULTS,
  nodus_save_writing_draft: RESEARCH_VAULTS,
  nodus_list_writing_drafts: RESEARCH_VAULTS,
  nodus_get_writing_draft: RESEARCH_VAULTS,
  nodus_list_deep_research_reports: RESEARCH_VAULTS,
  nodus_get_deep_research_report: RESEARCH_VAULTS,
  nodus_generate_deep_research: RESEARCH_VAULTS,
  nodus_finalize_deep_research: RESEARCH_VAULTS,
  nodus_enqueue_deep_research: RESEARCH_VAULTS,
  nodus_list_deep_research_jobs: RESEARCH_VAULTS,
  nodus_get_deep_research_job: RESEARCH_VAULTS,
  nodus_cancel_deep_research_job: RESEARCH_VAULTS,
  // Records layer.
  nodus_list_persons: RECORDS_VAULTS,
  nodus_get_person: RECORDS_VAULTS,
  nodus_list_kin_suggestions: RECORDS_VAULTS,
  nodus_list_events: RECORDS_VAULTS,
  nodus_list_archive_items: RECORDS_VAULTS,
  nodus_get_archive_item: RECORDS_VAULTS,
  nodus_search_archive: RECORDS_VAULTS,
  // Databases layer (read + the additive writes).
  nodus_list_databases: DATABASE_VAULTS,
  nodus_get_database_schema: DATABASE_VAULTS,
  nodus_query_database: DATABASE_VAULTS,
  nodus_get_database_row: DATABASE_VAULTS,
  nodus_list_database_views: DATABASE_VAULTS,
  nodus_list_database_templates: DATABASE_VAULTS,
  nodus_list_database_automations: DATABASE_VAULTS,
  nodus_list_database_forms: DATABASE_VAULTS,
  nodus_preview_database_deep_research: DATABASE_VAULTS,
  nodus_enqueue_database_deep_research: DATABASE_VAULTS,
  nodus_list_database_deep_research_jobs: DATABASE_VAULTS,
  nodus_get_database_deep_research_job: DATABASE_VAULTS,
  nodus_cancel_database_deep_research_job: DATABASE_VAULTS,
  nodus_list_database_deep_research_reports: DATABASE_VAULTS,
  nodus_get_database_deep_research_reports: DATABASE_VAULTS,
  nodus_create_database_row: DATABASE_VAULTS,
  nodus_set_database_cell: DATABASE_VAULTS,
  nodus_list_pages: DATABASE_VAULTS,
  nodus_search_pages: DATABASE_VAULTS,
  nodus_get_page: DATABASE_VAULTS,
  nodus_list_page_comments: DATABASE_VAULTS,
  nodus_create_page: DATABASE_VAULTS,
  nodus_update_page: DATABASE_VAULTS,
  nodus_replace_page_markdown: DATABASE_VAULTS,
  nodus_create_page_comment: DATABASE_VAULTS,
  // Study organisation layer (shared with teaching).
  nodus_study_get_workspace: STUDY_VAULTS,
  nodus_study_get_document: STUDY_VAULTS,
  nodus_study_search: STUDY_VAULTS,
  nodus_study_list_questions: STUDY_VAULTS,
  nodus_study_get_progress: STUDY_VAULTS,
  nodus_study_get_schedule: STUDY_VAULTS,
  // Teaching layer.
  nodus_teaching_list_groups: TEACHING_VAULTS,
  nodus_teaching_get_group: TEACHING_VAULTS,
  nodus_teaching_list_assessment_plans: TEACHING_VAULTS,
  nodus_teaching_get_assessment_plan: TEACHING_VAULTS,
  nodus_teaching_get_gradebook: TEACHING_VAULTS,
  nodus_teaching_list_exams: TEACHING_VAULTS,
  nodus_teaching_get_exam: TEACHING_VAULTS,
  nodus_teaching_list_rubrics: TEACHING_VAULTS,
  nodus_teaching_get_rubric: TEACHING_VAULTS,
};

/** Whether a vault-specific action is offered for a vault type. Universal tools
 *  (absent from the map) are always offered. Read tools bypass this gate below. */
export function isToolAllowedForVaultType(toolName: string, vaultType: VaultType): boolean {
  // Worldbuilding has a deliberately namespaced surface. Keeping the prefix as the
  // scope boundary makes adding a new world tool fail closed: it cannot accidentally
  // appear in academic, testimony or records vaults because somebody forgot a second
  // entry in this already-large table.
  if (toolName.startsWith('nodus_world_')) return WORLDBUILDING_VAULTS.includes(vaultType);
  const scope = TOOL_VAULT_SCOPE[toolName];
  return scope ? scope.includes(vaultType) : true;
}

function isReadOnlyToolMeta(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const annotations = (value as { annotations?: unknown }).annotations;
  return !!annotations
    && typeof annotations === 'object'
    && (annotations as { readOnlyHint?: unknown }).readOnlyHint === true;
}

/**
 * Registers the surface scoped to one vault type. Passing `null` registers every tool
 * (used by the test harness and any caller that wants the full surface). Wraps the
 * server so every read-only registration is stable and a disallowed action is skipped,
 * without weakening the strong typing of the individual registerTools call sites.
 */
export function registerToolsForVault(server: McpServer, vaultType: VaultType | null): void {
  if (!vaultType) {
    registerTools(server);
    return;
  }
  const gated = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
      const original = Reflect.get(target, prop, receiver) as (name: string, ...rest: unknown[]) => unknown;
      return (name: string, ...rest: unknown[]) => {
        return isReadOnlyToolMeta(rest[0]) || isToolAllowedForVaultType(name, vaultType)
          ? original.call(target, name, ...rest)
          : undefined;
      };
    },
  });
  registerTools(gated);
}

/** Register the complete external MCP surface. Derived graph entities are intentionally read-only. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'nodus_get_capabilities',
    {
      title: 'Nodus corpus capabilities',
      description:
        'Returns the running Nodus version, the current size and vocabulary of this local corpus, and which vault it belongs to. Ideas, themes, edges, debates, gaps and authors are generated by analysing works and are read-only through MCP. All tools read the vault reported as `vault.active`; if the user seems to mean a different one from `vault.available`, tell them to switch it in the Nodus app — MCP cannot change the active vault. If `vault.warning` is present, the app has since switched vaults and this server is still serving the one named in `vault.active`: relay that warning instead of presenting the results as the other vault\'s.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => {
      const records = recordCounts();
      const studyWorkspace = studyOrg.getStudyWorkspace();
      const teachingGroupList = teachingGroups.listTeachingGroups();
      const worldCharacters = characterCounts();
      return {
        version: app.getVersion(),
        vault: vaultContext(),
        access: {
          read:
            'All read-only MCP tools stay available across vault switches and read the active vault. Layers without data return an empty page or not-found.',
          write:
            'Write and action tools remain limited to the active vault type and to the narrow operations explicitly exposed by Nodus.',
        },
        counts: {
          ideas: count('ideas'),
          works: count('works'),
          themes: count('themes'),
          debates: getDebates().length,
          gaps: count('gaps'),
          authors: count('authors'),
          passages: count('passages'),
          notes: count('notes'),
          writingDrafts: writingDrafts.countWritingWorkshopDrafts(),
          deepResearchReports: writingDrafts.countWritingWorkshopDrafts('deep_research'),
          persons: records.persons,
          events: records.events,
          archiveItems: archive.archiveCounts().items,
          databases: dbMode.listDatabases().length,
          studyCourses: studyWorkspace.courses.length,
          studyDocuments: studyWorkspace.documents.length,
          studyQuestions: studyQuestions.listStudyQuestions().length,
          teachingGroups: teachingGroupList.length,
          teachingStudents: teachingGroupList.reduce((sum, group) => sum + (group.studentCount ?? 0), 0),
          teachingAssessmentPlans: teachingGrades.listAssessmentPlans().length,
          teachingExams: teachingExams.listTeachingExams().length,
          teachingRubrics: teachingRubrics.listTeachingRubrics().length,
          worldCharacters: worldCharacters.total,
          worldPlaces: listWorldPlaces().length,
          worldGroups: listWorldGroups().length,
          worldScenes: listScenes().length,
          worldEntries: listWorldEntries().length,
          worldThreads: listWorldThreads().length,
          worldRules: listWorldRules().length,
          worldQuestions: listWorldQuestions().length,
          worldMaps: listWorldMaps().length,
        },
        enums: {
          ideaTypes: IDEA_TYPES,
          edgeTypes: EDGE_TYPES,
          gapKinds: GAP_KINDS,
          eventTypes: EVENT_TYPES,
          worldCharacterRoles: WORLD_CHARACTER_ROLES,
          worldCharacterStatuses: WORLD_CHARACTER_STATUSES,
          worldGroupKinds: WORLD_GROUP_KINDS,
          worldSceneStatuses: WORLD_SCENE_STATUSES,
          worldEntryKinds: WORLD_ENTRY_KINDS,
          worldMapKinds: WORLD_MAP_KINDS,
        },
      };
    })
  );

  server.registerTool(
    'nodus_list_ideas',
    {
      title: 'List ideas',
      description:
        'Lists derived ideas in the local corpus. Returns compact rows (label plus a statement snippet) by default to keep responses cheap; pass full=true for complete statements, or use nodus_get_idea for one idea with relations. Read-only; ideas are created only by Nodus deep scans of works.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
        type: z.enum(IDEA_TYPES).optional(),
        query: querySchema,
        full: z
          .boolean()
          .default(false)
          .describe('true returns each idea\'s full statement; by default only a snippet (statementSnippet) is returned.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, type, query, full }) =>
      tool(() => {
        const all = ideas
          .allIdeaCandidates()
          .filter((idea) => !type || idea.type === type)
          .filter((idea) => matchesText(query, [idea.label, idea.statement]))
          .sort((a, b) => a.global_id.localeCompare(b.global_id));
        const result = page('ideas', all, limit, offset);
        if (full) return result;
        return {
          ...result,
          ideas: result.ideas.map(({ statement, ...idea }) => ({ ...idea, statementSnippet: snippet(statement, 220) })),
        };
      })()
  );

  server.registerTool(
    'nodus_get_idea',
    {
      title: 'Get idea with relations',
      description: 'Gets one derived idea, its occurrences, evidence, and every direct relation to other ideas. Read-only.',
      inputSchema: { ideaId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ideaId }) =>
      tool(() => {
        const detail = ideas.getIdeaDetail(ideaId);
        if (!detail) throw notFound('idea', ideaId);
        return { ...detail, relations: ideas.getIdeaEdges(ideaId) };
      })()
  );

  server.registerTool(
    'nodus_get_ideas_by_work',
    {
      title: 'Get ideas by work',
      description:
        'Lists every derived idea (claim, finding, construct, method, framework) with an occurrence anchored to a given work. The inverse of nodus_get_idea: instead of the works of an idea, it returns the ideas of a work. Deterministic and exhaustive over the existing idea↔work relation; use it instead of nodus_search_ideas when you need the complete set for one work. workId accepts a nodus_id or a Zotero key. Each idea also carries the fields specific to its occurrence in this work: role, confidence and development. An unknown workId yields an empty list, not an error. Read-only.',
      inputSchema: {
        workId: z.string().trim().min(1),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workId, limit, offset }) =>
      tool(() => {
        const nodusId = resolveWorkNodusId(workId);
        if (!nodusId) return { ideas: [], total: 0 };
        return ideas.getIdeasByWork(nodusId, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_search_ideas',
    {
      title: 'Search ideas semantically',
      description:
        'Finds ideas ranked by semantic similarity. Requires embeddings and an embedding provider already configured in Nodus. Reports index coverage (`indexed` of `indexable` ideas); when `indexed` is 0 the vault has no vectors for the configured embedding model, so an empty result means "not indexed", NOT "not in the corpus" — a `warning` says so.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) =>
      tool(async () => {
        const vector = await embedQuery(query);
        if (!vector) {
          throw new McpToolError(
            'ai_unconfigured',
            'No embeddings available. Configure the embedding provider and key in Nodus Settings.'
          );
        }
        return {
          ideas: await ideas.findSimilarIdeasPaged(vector, -1, limit),
          ...searchCoverage(ideas.embeddedIdeaCount(), count('ideas'), 'ideas'),
        };
      })()
  );

  server.registerTool(
    'nodus_analyze_passage',
    {
      title: 'Analyze a passage against the library',
      description:
        'Writing-copilot engine: takes an arbitrary passage (e.g. a paragraph being drafted) and returns how it relates to the whole corpus. For each candidate idea, work or passage it gives a typed relation (supports, contradicts, refines, extends, applies_to, …), a similarity and confidence, a short rationale, and — when the target resolves to a work — the Zotero item to cite (zoteroKey, an author-year label and a Zotero quick-search string). This is the symmetric, ad-hoc counterpart of the per-chapter analysis used by the Nodus writing copilot. Read-only over the derived graph: it does not create ideas or edges. Requires an embedding provider configured in Nodus and uses one AI pass to type the relations, so it may consume provider tokens. Returns { available: false } when no embedding provider is configured.',
      inputSchema: {
        text: z.string().trim().min(1).max(8_000),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ text, model }) => tool(() => analyzeText(text, asModel(model)))()
  );

  server.registerTool(
    'nodus_get_copilot_idea',
    {
      title: 'Get idea with citation and connections',
      description:
        'Returns one derived idea shaped for writing: its statement, every occurrence, its evidence and its graph connections, plus the citation metadata needed to cite it — the Zotero item key, an author-year label and a Zotero quick-search string, both for the idea and for each occurrence. Complements nodus_get_idea (raw relations) with the ready-to-cite Zotero bridge used by the writing copilot. Pair it with nodus_analyze_passage, which returns the candidate ideas. Read-only.',
      inputSchema: { ideaId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ideaId }) =>
      tool(() => {
        const detail = getCopilotIdeaDetail(ideaId);
        if (!detail) throw notFound('idea', ideaId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_compose_insertion',
    {
      title: 'Compose a cited insertion for a paragraph',
      description:
        'Uses Nodus AI to write one short, academic sentence that integrates a chosen library idea into the user’s paragraph, with the parenthetical (Author, Year) citation already in place and grounded only in that idea’s statement, evidence and connections. Returns the insertable plain text plus its nodus:// citation and the author-year label. Use the ideaId of a relation returned by nodus_analyze_passage. The model is taken from Nodus Settings; this consumes provider tokens.',
      inputSchema: {
        ideaId: z.string().trim().min(1),
        paragraphText: z.string().trim().min(1).max(8_000),
        selectionText: z.string().trim().max(4_000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ideaId, paragraphText, selectionText }) =>
      tool(() => {
        if (!getCopilotIdeaDetail(ideaId)) throw notFound('idea', ideaId);
        return composeCopilotIdeaInsertion({ ideaId, paragraphText, selectionText });
      })()
  );

  server.registerTool(
    'nodus_list_debates',
    {
      title: 'List debates',
      description: 'Lists contradiction/refutation debates, including their opposing ideas, works, evidence, timeline and relation. Read-only.',
      inputSchema: { ...paginationSchema, query: querySchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query }) =>
      tool(() => {
        const all = getDebates().filter((debate) => matchesText(query, debateSearchFields(debate)));
        return page('debates', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_debate',
    {
      title: 'Get debate',
      description: 'Gets the complete debate for a contradiction or refutation edge id. Read-only.',
      inputSchema: { edgeId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ edgeId }) =>
      tool(() => {
        const debate = getDebate(edgeId);
        if (!debate) throw notFound('debate', edgeId);
        return debate;
      })()
  );

  server.registerTool(
    'nodus_list_gaps',
    {
      title: 'List research gaps',
      description: 'Lists normalized research-gap aggregates. Use one returned gapIds value with nodus_get_gap for a full record. Read-only.',
      inputSchema: { ...paginationSchema, query: querySchema, kind: z.enum(GAP_KINDS).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind }) =>
      tool(() => {
        const all = gaps
          .aggregateGaps()
          .filter((gap) => (!kind || gap.kind === kind) && matchesText(query, [gap.statement, ...gap.works.map((work) => work.title)]));
        return page('gaps', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_gap',
    {
      title: 'Get research gap',
      description: 'Gets an individual research-gap record with the originating work, related idea, and evidence. Read-only.',
      inputSchema: { gapId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ gapId }) =>
      tool(() => {
        const detail = gaps.getGapDetail(gapId);
        if (!detail) throw notFound('research gap', gapId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_get_author_relations',
    {
      title: 'Get author relations',
      description: 'Returns the weighted author graph. With author, returns that author and their immediate neighbours; author can be an id or exact displayed name. Read-only.',
      inputSchema: { author: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ author }) =>
      tool(() => {
        const graph = buildAuthorGraph();
        if (!author) return graph;
        const root = graph.nodes.find((node) => node.id === author || node.label === author);
        if (!root) throw notFound('author', author);
        const edges = graph.edges.filter((edge) => edge.source === root.id || edge.target === root.id);
        const nodeIds = new Set([root.id, ...edges.flatMap((edge) => [edge.source, edge.target])]);
        return { nodes: graph.nodes.filter((node) => nodeIds.has(node.id)), edges };
      })()
  );

  server.registerTool(
    'nodus_search_authors',
    {
      title: 'Search authors',
      description:
        'Searches authors in the local corpus by id, name, affiliation or top themes. Returns each author footprint and whether a dossier synthesis has already been generated. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        synthesis: z.enum(['all', 'with', 'without']).default('all'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, synthesis = 'all' }) =>
      tool(() => {
        const all = listAuthorSummaries()
          .filter((author) => authorMatchesQuery(author, query))
          .filter((author) => synthesis === 'all' || (synthesis === 'with' ? author.hasSynthesis : !author.hasSynthesis));
        return page('authors', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_read_author_synthesis',
    {
      title: 'Read stored author synthesis',
      description:
        'Resolves an author by author_id or name and returns the dossier synthesis already stored in Nodus, or source="missing" when none exists. This never generates, refreshes or saves anything; use nodus_get_author_synthesis only when the user explicitly wants generation that may consume provider tokens.',
      inputSchema: { author: z.string().trim().min(1).max(500) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ author }) =>
      tool(() => {
        const resolved = resolveAuthor(author);
        const dossier = buildAuthorDossier(resolved.author_id);
        if (!dossier) throw notFound('author', author);
        return {
          source: dossier.synthesis ? 'cached' : 'missing',
          author: resolved,
          synthesis: dossier.synthesis ?? null,
          counts: {
            works: dossier.works.length,
            ideas: dossier.ideas.length,
            relations: dossier.relations.length,
            themes: dossier.themes.length,
          },
        };
      })()
  );

  server.registerTool(
    'nodus_get_author_synthesis',
    {
      title: 'Get or generate author synthesis',
      description:
        'Resolves an author by author_id or name. If a dossier synthesis already exists it is returned; if it does not and generateIfMissing=true, it is generated and saved using the configured synthesis model or the given model. Pass refresh=true to regenerate even when one exists. May consume provider tokens when it generates.',
      inputSchema: {
        author: z.string().trim().min(1).max(500),
        generateIfMissing: z.boolean().default(true),
        refresh: z.boolean().default(false),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ author, generateIfMissing = true, refresh = false, model }) =>
      tool(async () => {
        const resolved = resolveAuthor(author);
        const dossier = buildAuthorDossier(resolved.author_id);
        if (!dossier) throw notFound('author', author);

        if (!refresh && dossier.synthesis) {
          return {
            source: 'cached',
            author: resolved,
            synthesis: dossier.synthesis,
            counts: {
              works: dossier.works.length,
              ideas: dossier.ideas.length,
              relations: dossier.relations.length,
              themes: dossier.themes.length,
            },
          };
        }

        if (!generateIfMissing && !refresh) {
          return {
            source: 'missing',
            author: resolved,
            synthesis: null,
            counts: {
              works: dossier.works.length,
              ideas: dossier.ideas.length,
              relations: dossier.relations.length,
              themes: dossier.themes.length,
            },
          };
        }

        const synthesis = await synthesizeAuthorDossier(resolved.author_id, asModel(model));
        return {
          source: refresh ? 'refreshed' : 'generated',
          author: { ...resolved, hasSynthesis: true },
          synthesis,
          counts: {
            works: dossier.works.length,
            ideas: dossier.ideas.length,
            relations: dossier.relations.length,
            themes: dossier.themes.length,
          },
        };
      })()
  );

  server.registerTool(
    'nodus_list_works',
    {
      title: 'List works',
      description:
        'Lists Zotero/library works with pagination and operational filters. Use nodus_get_work for per-work counts, summary and passage status. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        includeArchived: z.boolean().default(false),
        lightStatus: z.enum(LIGHT_STATUSES).default('all'),
        deepStatus: z.enum(DEEP_STATUSES).default('all'),
        summaryStatus: z.enum(SUMMARY_STATUSES).default('all'),
        statusFlags: z
          .array(z.enum(['deep', 'summary', 'ideas', 'passages', '!deep', '!summary', '!ideas', '!passages']))
          .max(8)
          .optional(),
        theme: z.string().trim().min(1).max(500).optional(),
        zoteroTags: z.array(z.string().trim().min(1).max(500)).max(25).optional(),
        zoteroTagMode: z.enum(['any', 'all']).default('any'),
        collections: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
        collectionMode: z.enum(['any', 'all']).default('any'),
        yearMin: z.number().int().min(0).max(3000).optional(),
        yearMax: z.number().int().min(0).max(3000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({
      limit,
      offset,
      query,
      includeArchived,
      lightStatus,
      deepStatus,
      summaryStatus,
      statusFlags,
      theme,
      zoteroTags,
      zoteroTagMode,
      collections,
      collectionMode,
      yearMin,
      yearMax,
    }) =>
      tool(() => {
        const filter: WorkFilter = {
          search: query,
          includeArchived,
          lightStatus: lightStatus as LightStatus | 'all',
          deepStatus: deepStatus as DeepStatus | 'all',
          summaryStatus: summaryStatus as SummaryStatus | 'all',
          statusFlags,
          theme,
          zoteroTags,
          zoteroTagMode,
          collections,
          collectionMode,
          yearMin,
          yearMax,
        };
        return page('works', listWorks(filter), limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_work',
    {
      title: 'Get work',
      description:
        'Gets one work by nodus_id, Zotero key or merged alias key, including themes/tags, orientation summary, passage status and derived entity counts. Read-only.',
      inputSchema: { workId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workId }) =>
      tool(() => {
        const nodusId = resolveWorkNodusId(workId);
        if (!nodusId) throw notFound('work', workId);
        const work = getWork(nodusId);
        if (!work) throw notFound('work', workId);
        return {
          work,
          summary: workSummaries.getWorkSummary(nodusId),
          counts: workCounts(nodusId),
          passageStatus: passages.workPassageStatuses([nodusId])[0] ?? null,
        };
      })()
  );

  server.registerTool(
    'nodus_get_document_profile',
    {
      title: 'Get document profile',
      description:
        'Gets the current audited whole-document profile for one work: overview, central question, explicit hypotheses, thesis, method, findings, contribution, scope, section architecture and links to extracted ideas. The profile is generated orientation metadata, never a citable source; verify claims through its support passages or the original work. workId accepts a nodus_id or Zotero key. Read-only.',
      inputSchema: { workId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workId }) =>
      tool(() => {
        const nodusId = resolveWorkNodusId(workId);
        if (!nodusId) throw notFound('work', workId);
        const profile = getDocumentProfile(nodusId);
        if (!profile) throw notFound('document profile', workId);
        return {
          profile,
          citationPolicy: 'orientation_only',
          citationGuidance: 'Cite supporting passages or the original work, never this generated profile.',
        };
      })()
  );

  server.registerTool(
    'nodus_search_documents',
    {
      title: 'Search whole documents',
      description:
        'Finds globally relevant works using audited document profiles and section representations. It distinguishes central treatment from incidental mentions and falls back to lexical profile search when embeddings are unavailable. Results orient retrieval and are not citable evidence. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(50).default(15),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) =>
      tool(async () => {
        const result = await retrieveHierarchical(query, {
          documentLimit: limit,
          ideaLimit: 0,
          passageLimit: 0,
          routedPassageLimit: 0,
        });
        return {
          embeddingAvailable: result.embeddingAvailable,
          documents: result.documents,
          citationPolicy: 'orientation_only',
          citationGuidance: 'Use nodus_search_hybrid or passage tools to obtain citable evidence.',
        };
      })()
  );

  server.registerTool(
    'nodus_search_hybrid',
    {
      title: 'Search documents, ideas and evidence',
      description:
        'Runs hierarchical retrieval across three independent lanes: whole-document profiles, extracted ideas and full-text passages. Document routing can add passages but never removes globally relevant ideas or evidence. Cite passages/original works; profiles only orient and contextualize. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        documentLimit: z.number().int().min(1).max(50).default(12),
        ideaLimit: z.number().int().min(1).max(100).default(30),
        passageLimit: z.number().int().min(1).max(50).default(16),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, documentLimit, ideaLimit, passageLimit }) =>
      tool(async () => {
        const result = await retrieveHierarchical(query, { documentLimit, ideaLimit, passageLimit });
        return {
          ...result,
          documents: result.documents.map((hit) => ({ ...hit, citationPolicy: 'orientation_only' })),
          passages: result.passages.map((hit) => ({
            ...hit,
            text: undefined,
            textSnippet: snippet(hit.text, 700),
            citationPolicy: 'citable_source_evidence',
          })),
          ideas: result.ideas.map((hit) => ({ ...hit, citationPolicy: 'derived_claim_verify_in_source' })),
          citationGuidance: 'Cite passage pages or original works. Do not cite generated document profiles.',
        };
      })()
  );

  server.registerTool(
    'nodus_list_work_passages',
    {
      title: 'List full-text passages',
      description:
        'Lists full-text passage chunks, optionally scoped to one work. Returns snippets only; use nodus_get_passage for full text. Read-only.',
      inputSchema: {
        ...paginationSchema,
        workId: z.string().trim().min(1).optional(),
        query: querySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, workId, query }) =>
      tool(() => {
        const nodusId = workId ? resolveWorkNodusId(workId) : null;
        if (workId && !nodusId) throw notFound('work', workId);
        const params: unknown[] = [];
        const clauses: string[] = [
          'w.archived = 0',
          `((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
            OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))`,
        ];
        if (nodusId) {
          clauses.push('p.nodus_id = ?');
          params.push(nodusId);
        }
        if (query?.trim()) {
          clauses.push('(LOWER(p.text) LIKE ? OR LOWER(w.title) LIKE ?)');
          const q = `%${query.trim().toLowerCase()}%`;
          params.push(q, q);
        }
        const rows = getDb()
          .prepare(
            `SELECT p.passage_id, p.nodus_id, p.chunk_index, p.page_label, p.char_len, p.text,
                    w.title, w.authors_json, w.year, w.zotero_key
               FROM passages p
               JOIN works w ON w.nodus_id = p.nodus_id
              WHERE ${clauses.join(' AND ')}
              ORDER BY w.year DESC, w.title COLLATE NOCASE ASC, p.chunk_index ASC`
          )
          .all(...params) as {
          passage_id: string;
          nodus_id: string;
          chunk_index: number;
          page_label: string | null;
          char_len: number;
          text: string;
          title: string;
          authors_json: string;
          year: number | null;
          zotero_key: string;
        }[];
        const out = rows.map((row) => ({
          passage_id: row.passage_id,
          nodus_id: row.nodus_id,
          chunk_index: row.chunk_index,
          page_label: row.page_label,
          char_len: row.char_len,
          textSnippet: snippet(row.text),
          work: {
            title: row.title,
            authors: parseAuthorsJson(row.authors_json),
            year: row.year,
            zotero_key: row.zotero_key,
          },
        }));
        return page('passages', out, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_passage',
    {
      title: 'Get full-text passage',
      description: 'Gets one full-text passage chunk by passage_id, including source-work citation metadata. Read-only.',
      inputSchema: { passageId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ passageId }) =>
      tool(() => {
        const detail = passages.getPassageDetail(passageId);
        if (!detail) throw notFound('passage', passageId);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_search_passages',
    {
      title: 'Search full-text passages semantically',
      description:
        'Finds full-text passage chunks ranked by semantic similarity to the query — the direct way to locate where the corpus discusses a topic, with citable work metadata attached to every hit. Optionally scoped to one work (workId accepts a nodus_id or a Zotero key). Returns snippets; use nodus_get_passage for the full text. Complements nodus_search_ideas (derived claims) with retrieval over the underlying source text, and unlike nodus_analyze_passage it performs no AI relation typing. Requires an embedding provider already configured in Nodus. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(50).default(10),
        minSimilarity: z
          .number()
          .min(0)
          .max(1)
          .default(0.18)
          .describe(
            'Cosine similarity floor; 0.18 is the value the Nodus writing copilot uses. Scores are RELATIVE and their scale depends on the configured embedding model — with some models unrelated text still scores well above this floor, so clearing it is not evidence of relevance on its own. Rank by the returned order and judge each hit by its text.'
          ),
        workId: z.string().trim().min(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, minSimilarity, workId }) =>
      tool(async () => {
        const nodusId = workId ? resolveWorkNodusId(workId) : null;
        if (workId && !nodusId) throw notFound('work', workId);
        const vector = await embedQuery(query);
        if (!vector) {
          throw new McpToolError(
            'ai_unconfigured',
            'No embeddings available. Configure the embedding provider and key in Nodus Settings.'
          );
        }
        const hits = await passages.findSimilarPassagesPaged(
          vector,
          minSimilarity,
          limit,
          nodusId ? { nodusIds: [nodusId] } : {}
        );
        return {
          ...searchCoverage(passages.embeddedPassageCount(), count('passages'), 'full-text passages'),
          passages: hits.map((hit) => ({
            passage_id: hit.passage_id,
            nodus_id: hit.nodus_id,
            similarity: hit.similarity,
            page_label: hit.page_label,
            textSnippet: snippet(hit.text, 600),
            work: {
              title: hit.title,
              authors: parseAuthorsJson(hit.authors_json),
              year: hit.year,
              zotero_key: hit.zotero_key,
            },
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_list_themes',
    {
      title: 'List themes',
      description: 'Lists graph/library themes with work and idea counts, pagination and filters. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        pinned: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, pinned }) =>
      tool(() => {
        const all = themes
          .listManagedThemes()
          .filter((theme) => pinned === undefined || theme.pinned === pinned)
          .filter((theme) => matchesText(query, [theme.label]));
        return page('themes', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_theme',
    {
      title: 'Get theme',
      description:
        'Gets a theme by theme_id or exact label, with paged works and ideas connected to that theme. Read-only.',
      inputSchema: {
        theme: z.string().trim().min(1),
        worksLimit: compactLimitSchema,
        worksOffset: z.number().int().min(0).default(0),
        ideasLimit: compactLimitSchema,
        ideasOffset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ theme, worksLimit, worksOffset, ideasLimit, ideasOffset }) =>
      tool(() => {
        const resolved = resolveTheme(theme);
        if (!resolved) throw notFound('theme', theme);
        const linkedWorks = listWorks({ theme: resolved.label });
        const ideaRows = getDb()
          .prepare(
            `SELECT DISTINCT i.global_id, i.type, i.label, i.statement
               FROM idea_theme_links itl
               JOIN ideas i ON i.global_id = itl.global_id
              WHERE itl.theme_id = ?
              ORDER BY i.label COLLATE NOCASE ASC`
          )
          .all(resolved.theme_id);
        return {
          theme: resolved,
          works: page('items', linkedWorks, worksLimit, worksOffset),
          ideas: page('items', ideaRows, ideasLimit, ideasOffset),
        };
      })()
  );

  server.registerTool(
    'nodus_list_tutor_routes',
    {
      title: 'List saved tutor routes',
      description: 'Lists saved Tutor routes with pagination. The full route is omitted; use nodus_get_tutor_route for stops. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        mode: z.enum(TUTOR_MODES).optional(),
        minRating: z.number().int().min(1).max(5).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, mode, minRating }) =>
      tool(() => {
        const all = tutorRoutes
          .listTutorRoutes()
          .filter((route) => !mode || route.mode === mode)
          .filter((route) => minRating === undefined || (route.rating ?? 0) >= minRating)
          .filter((route) =>
            matchesText(query, [
              route.prompt,
              route.overview,
              route.route.title,
              route.route.description,
              ...route.route.stops.flatMap((stop) => [stop.title, stop.focus]),
            ])
          )
          .map(compactTutorRoute);
        return page('routes', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_tutor_route',
    {
      title: 'Get saved tutor route',
      description: 'Gets a complete saved Tutor route, including route stops and graph context. Read-only.',
      inputSchema: { routeId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ routeId }) =>
      tool(() => {
        const route = tutorRoutes.getTutorRoute(routeId);
        if (!route) throw notFound('tutor route', routeId);
        return route;
      })()
  );

  server.registerTool(
    'nodus_list_projects',
    {
      title: 'List projects',
      description: 'Lists research-writing projects/manuscripts with pagination and filters. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        kind: z.enum(PROJECT_KINDS).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, status }) =>
      tool(() => {
        const all = projects
          .listProjects()
          .filter((project) => !kind || project.kind === (kind as ProjectKind))
          .filter((project) => !status || project.status === (status as ProjectStatus))
          .filter((project) => matchesText(query, [project.title, project.brief]));
        return page('projects', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_project',
    {
      title: 'Get project',
      description:
        'Gets one research-writing project with sections, links, chapter metadata and stats. Chapter bodies are summarized unless includeChapterText=true. Read-only.',
      inputSchema: { projectId: z.string().trim().min(1), includeChapterText: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ projectId, includeChapterText }) =>
      tool(() => {
        const detail = projects.getProjectDetail(projectId);
        if (!detail) throw notFound('project', projectId);
        return {
          ...detail,
          chapters: detail.chapters.map((chapter) => compactProjectChapter(chapter, includeChapterText)),
        };
      })()
  );

  server.registerTool(
    'nodus_search_notes',
    {
      title: 'Search notes',
      description:
        'Searches user-created notes with pagination and snippets. Use nodus_get_note for full Markdown content. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        kind: z.enum(NOTE_KINDS).optional(),
        folderId: z.string().trim().min(1).nullable().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, folderId }) =>
      tool(() => {
        const tree = notes.getNotesTree();
        const folderById = new Map(tree.folders.map((folder) => [folder.id, folder]));
        const all = tree.notes
          .filter((note) => !kind || note.kind === kind)
          .filter((note) => folderId === undefined || note.folderId === folderId)
          .filter((note) => matchesText(query, [note.title, note.content]))
          .map((note) => ({
            id: note.id,
            folderId: note.folderId,
            folderName: note.folderId ? folderById.get(note.folderId)?.name ?? null : null,
            title: note.title,
            kind: note.kind,
            source: note.source,
            orderIdx: note.orderIdx,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            contentSnippet: snippet(note.content, 400),
          }));
        return page('notes', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_list_notes_tree',
    {
      title: 'List notes tree',
      description: 'Returns the user-created notes and folders. Each folder carries its summary brief (the ideas it is meant to hold). This list omits note content; use nodus_get_note for a full note.',
      inputSchema: { ...paginationSchema, query: querySchema, kind: z.enum(NOTE_KINDS).optional(), folderId: z.string().trim().min(1).nullable().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, folderId }) =>
      tool(() => {
        const tree = notes.getNotesTree();
        const filteredNotes = tree.notes
          .filter((note) => !kind || note.kind === kind)
          .filter((note) => folderId === undefined || note.folderId === folderId)
          .filter((note) => matchesText(query, [note.title, note.content]))
          .map(({ content: _content, ...note }) => ({ ...note, contentSnippet: snippet(_content, 220) }));
        return { folders: tree.folders, ...page('notes', filteredNotes, limit, offset) };
      })()
  );

  server.registerTool(
    'nodus_get_note',
    {
      title: 'Get note',
      description: 'Gets a user-created note including Markdown content. Read-only.',
      inputSchema: { noteId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ noteId }) =>
      tool(() => {
        const note = notes.getNote(noteId);
        if (!note) throw notFound('note', noteId);
        return note;
      })()
  );

  server.registerTool(
    'nodus_list_coverage_questions',
    {
      title: 'List coverage questions',
      description: 'Lists saved research coverage questions. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ questions: researchQuestions.listResearchQuestions() }))
  );

  server.registerTool(
    'nodus_get_coverage_question',
    {
      title: 'Get coverage question',
      description: 'Gets a saved research question, its sub-questions, coverage status, and linked ideas/works. Read-only.',
      inputSchema: { id: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      tool(() => {
        const detail = researchQuestions.getResearchQuestionDetail(id);
        if (!detail) throw notFound('coverage question', id);
        return detail;
      })()
  );

  server.registerTool(
    'nodus_ask_coverage_question',
    {
      title: 'Ask and map a coverage question',
      description:
        'Creates a research question, uses Nodus AI to decompose it, maps coverage against the local corpus, and saves the result. This modifies Nodus data and may consume provider tokens. Sends MCP progress notifications while mapping when the request carries a progressToken. All-or-nothing: if decomposition or mapping fails, the question is not left behind in Nodus.',
      inputSchema: {
        question: z.string().trim().min(1).max(8_000),
        notes: z.string().trim().max(8_000).optional(),
        model: modelSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ question, notes: questionNotes, model }, extra) =>
      tool(async () => {
        const notify = progressNotifier(extra);
        const created = researchQuestions.createResearchQuestion(question, questionNotes);
        const request = { rqId: created.rq.id, model: asModel(model) };
        try {
          notify('Decomposing the question into sub-questions…');
          await decomposeQuestion(request);
          return await mapCoverage(request, (p) => notify(`Mapping coverage ${p.index}/${p.total}: ${p.subQuestion}`));
        } catch (error) {
          // The row is written before the AI runs, so a failure here (no provider, a
          // transient error) would report an error to the client and still leave an
          // empty, unmapped question in the user's vault. Undo it: the client was told
          // the call failed, so nothing may survive it.
          researchQuestions.deleteResearchQuestion(created.rq.id);
          throw error;
        }
      })()
  );

  server.registerTool(
    'nodus_writing_snapshot',
    {
      title: 'Build writing workshop snapshot',
      description: 'Ranks Nodus ideas, themes, gaps, works and evidence for a writing objective. It may use configured embeddings but does not write data.',
      inputSchema: { brief: writingBriefSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ brief }) => tool(() => buildWritingWorkshopSnapshot(asBrief(brief)))()
  );

  server.registerTool(
    'nodus_generate_writing_draft',
    {
      title: 'Generate writing workshop draft',
      description: 'Generates a grounded Markdown draft from an explicit Nodus writing selection. With save=true, it also saves the draft. This can consume provider tokens and may modify data.',
      inputSchema: {
        brief: writingBriefSchema,
        selection: writingSelectionSchema,
        model: modelSchema.optional(),
        save: z.boolean().default(false),
        title: z.string().trim().min(1).max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ brief, selection, model, save, title }) =>
      tool(async () => {
        const draft = await generateWritingWorkshopDraft({ brief: asBrief(brief), selection: asSelection(selection), model: asModel(model) });
        const saved = save ? writingDrafts.saveWritingWorkshopDraft({ draft, model: asModel(model), title }) : null;
        return { draft, savedDraftId: saved?.id ?? null, savedDraft: saved };
      })()
  );

  server.registerTool(
    'nodus_save_writing_draft',
    {
      title: 'Save writing workshop draft',
      description: 'Saves a draft previously generated by the Nodus writing workshop. This modifies Nodus data.',
      inputSchema: { draft: writingDraftSchema, model: modelSchema.optional(), title: z.string().trim().min(1).max(2_000).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ draft, model, title }) => tool(() => writingDrafts.saveWritingWorkshopDraft({ draft: asDraft(draft), model: asModel(model), title }))()
  );

  server.registerTool(
    'nodus_list_writing_drafts',
    {
      title: 'List saved writing drafts',
      description:
        'Lists a compact, paginated catalogue of drafts saved by the Nodus writing workshop. It never returns full report bodies, so large libraries remain below MCP response limits; use nodus_get_writing_draft for one complete draft. Filter by kind or title/objective. For completed Deep Research reports prefer nodus_list_deep_research_reports. Read-only.',
      inputSchema: {
        query: querySchema,
        kind: z.enum(SAVED_WRITING_KINDS).optional(),
        sort: savedDraftSortSchema,
        limit: compactLimitSchema,
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, kind, sort, limit, offset }) =>
      tool(() => {
        const result = writingDrafts.listWritingWorkshopDraftSummaries({ query, kind, sort, limit, offset });
        return {
          drafts: result.drafts,
          total: result.total,
          limit,
          offset,
          hasMore: offset + limit < result.total,
        };
      })()
  );

  server.registerTool(
    'nodus_get_writing_draft',
    {
      title: 'Get a saved writing draft',
      description:
        'Returns one complete saved writing draft, including its Markdown, evidence selection, traceability matrix and bibliography. Obtain the id from nodus_list_writing_drafts. Read-only.',
      inputSchema: { draftId: z.string().trim().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ draftId }) =>
      tool(() => {
        const draft = writingDrafts.getWritingWorkshopDraft(draftId);
        if (!draft) throw notFound('writing draft', draftId);
        return { draft };
      })()
  );

  server.registerTool(
    'nodus_list_deep_research_reports',
    {
      title: 'List saved Deep Research reports',
      description:
        'Lists completed Deep Research reports persisted in the active vault gallery. This is the durable report catalogue, independent of the temporary generation lane returned by nodus_list_deep_research_jobs. Results are compact, searchable and paginated so every report remains discoverable without crossing MCP response limits; use nodus_get_deep_research_report for the full text. Read-only.',
      inputSchema: {
        query: querySchema,
        sort: savedDraftSortSchema,
        limit: compactLimitSchema,
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, sort, limit, offset }) =>
      tool(() => {
        const result = writingDrafts.listWritingWorkshopDraftSummaries({
          query,
          kind: 'deep_research',
          sort,
          limit,
          offset,
        });
        return {
          reports: result.drafts,
          total: result.total,
          limit,
          offset,
          hasMore: offset + limit < result.total,
        };
      })()
  );

  server.registerTool(
    'nodus_get_deep_research_report',
    {
      title: 'Get a saved Deep Research report',
      description:
        'Returns one complete persisted Deep Research report from the active vault, including its Markdown, source selection, traceability matrix and bibliography. Obtain the reportId from nodus_list_deep_research_reports or use a completed queue job\'s savedDraftId. Read-only.',
      inputSchema: { reportId: z.string().trim().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reportId }) =>
      tool(() => {
        const report = writingDrafts.getWritingWorkshopDraft(reportId);
        if (!report || report.brief.kind !== 'deep_research') throw notFound('Deep Research report', reportId);
        return { report };
      })()
  );

  server.registerTool(
    'nodus_generate_deep_research',
    {
      title: 'Generate a Deep Research report',
      description:
        'Runs the orchestrated, coverage-guided, fully-cited Deep Research pipeline over the whole corpus. The report grows only as long as the retrieved evidence and distinct analytical value require; no editorial word/page target is applied. Two writers via `writer`: ' +
        '"nodus" (default) — Nodus\'s own configured model plans and writes the whole report and returns it (save=true also stores it as a draft). ' +
        '"client" — returns a self-contained writing kit (corpus materials with verbatim citation tokens, evidence-derived section plan, method and citation policy) so the MODEL CALLING THIS MCP articulates and drafts the report itself; when done, that draft is passed to nodus_finalize_deep_research to validate citations and assemble references. Both keep Nodus as the grounding authority. writer="nodus" can consume provider tokens and may take several minutes; it sends MCP progress notifications (planning, per-section, assembly) when the request carries a progressToken. It also holds this call open for the whole generation and waits behind anything already in the shared lane — prefer nodus_enqueue_deep_research unless the report is needed in this very turn.',
      inputSchema: {
        objective: z.string().trim().min(1).max(8_000),
        approach: deepResearchApproachSchema,
        deepResearchVersion: deepResearchVersionSchema,
        language: promptLanguageSchema.optional(),
        audience: z.string().trim().max(1_000).optional(),
        sectionLimit: deepResearchSectionLimitSchema,
        sectionLength: deepResearchSectionLengthSchema,
        writer: z
          .enum(['nodus', 'client'])
          .default('nodus')
          .describe('"nodus": the model configured in Nodus writes the report. "client": the model calling this MCP writes it from the returned kit.'),
        model: modelSchema.optional(),
        save: z.boolean().default(false),
        title: z.string().trim().min(1).max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ objective, approach, deepResearchVersion, language, audience, sectionLimit, sectionLength, writer, model, save, title }, extra) =>
      tool(async () => {
        if (writer === 'client') {
          return buildDeepResearchBrief({ objective, approach, deepResearchVersion, language, audience, sectionLimit, sectionLength });
        }
        const notify = progressNotifier(extra);
        ensureDeepResearchLane();
        // Through the lane like everything else, so this blocking call cannot run
        // beside a queued report. The draft is saved below, keeping this tool's
        // response shape (the full saved draft, not just its id).
        const report = await runDeepResearchJob(
          {
            request: { objective, approach, deepResearchVersion, language, audience, sectionLimit, sectionLength, model: asModel(model) ?? null },
            origin: 'mcp',
            save: false,
          },
          (p) =>
            notify(
              p.phase === 'section' && p.sectionIndex
                ? `[section ${p.sectionIndex}${p.sectionTotal ? `/${p.sectionTotal}` : ''}] ${p.message}`
                : p.message
            )
        );
        const saved = save ? writingDrafts.saveWritingWorkshopDraft({ draft: report.draft, model: report.draft.generationModel ?? asModel(model), title }) : null;
        return { report, savedDraftId: saved?.id ?? null, savedDraft: saved };
      })()
  );

  server.registerTool(
    'nodus_finalize_deep_research',
    {
      title: 'Finalize a client-written Deep Research report',
      description:
        'Second step of nodus_generate_deep_research(writer="client"). Takes the Markdown the calling model wrote (headed body sections normally, or plain continuous prose when sectionLimit="single") and enforces Nodus\'s citation contract: hallucinated citations are stripped, labels canonicalised, and the References/bibliography are built from the works actually cited. Returns the assembled report in the standard draft shape; with save=true it also stores it as a Nodus writing draft. Pass the SAME objective/language/sectionLimit used for the brief so the same corpus and visible structure are preserved.',
      inputSchema: {
        objective: z.string().trim().min(1).max(8_000),
        approach: deepResearchApproachSchema,
        deepResearchVersion: deepResearchVersionSchema,
        language: promptLanguageSchema.optional(),
        audience: z.string().trim().max(1_000).optional(),
        sectionLimit: deepResearchSectionLimitSchema,
        sectionLength: deepResearchSectionLengthSchema,
        sectionsMarkdown: z.string().trim().min(1).max(200_000),
        title: z.string().trim().min(1).max(2_000).optional(),
        abstract: z.string().trim().max(20_000).optional(),
        limitations: z.array(z.string().trim().min(1).max(2_000)).max(30).optional(),
        nextSteps: z.array(z.string().trim().min(1).max(2_000)).max(30).optional(),
        generationModel: modelSchema.optional().describe('Model that wrote sectionsMarkdown. Persisted as provenance; omit rather than guessing.'),
        save: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ objective, approach, deepResearchVersion, language, audience, sectionLimit, sectionLength, sectionsMarkdown, title, abstract, limitations, nextSteps, generationModel, save }) =>
      tool(async () => {
        const report = await assembleClientDeepResearchReport({
          objective,
          approach,
          deepResearchVersion,
          language,
          audience,
          sectionLimit,
          sectionLength,
          sectionsMarkdown,
          title,
          abstract,
          limitations,
          nextSteps,
          generationModel: asModel(generationModel),
        });
        const saved = save ? writingDrafts.saveWritingWorkshopDraft({ draft: report.draft, model: report.draft.generationModel, title }) : null;
        return { report, savedDraftId: saved?.id ?? null, savedDraft: saved };
      })()
  );

  server.registerTool(
    'nodus_enqueue_deep_research',
    {
      title: 'Queue a Deep Research report',
      description:
        'Queues the same report as nodus_generate_deep_research(writer="nodus") but returns a job id immediately instead of holding the call open for the minutes it takes. Use this instead of the blocking tool whenever you do not need the text in this turn: the report survives this MCP session ending, and Nodus notifies the user when it lands. ' +
        'Reports run ONE AT A TIME in a single lane shared with the Nodus window, so a queued report waits for anything already generating. ' +
        'The job is bound to the vault active right now: if the user switches vault before it starts, it is cancelled rather than researched against a different corpus. ' +
        'Poll nodus_get_deep_research_job for status; with save=true (the default) the finished report is stored as a Nodus writing draft and appears in the user\'s Deep Research gallery.',
      inputSchema: {
        objective: z.string().trim().min(1).max(8_000),
        approach: deepResearchApproachSchema,
        deepResearchVersion: deepResearchVersionSchema,
        language: promptLanguageSchema.optional(),
        audience: z.string().trim().max(1_000).optional(),
        sectionLimit: deepResearchSectionLimitSchema,
        sectionLength: deepResearchSectionLengthSchema,
        model: modelSchema.optional(),
        save: z.boolean().default(true).describe('Store the finished report as a Nodus writing draft. Leave true unless the user only wants to read it here.'),
        title: z.string().trim().min(1).max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ objective, approach, deepResearchVersion, language, audience, sectionLimit, sectionLength, model, save, title }) =>
      tool(() => {
        ensureDeepResearchLane();
        const job = enqueueDeepResearchJob({
          request: { objective, approach, deepResearchVersion, language, audience, sectionLimit, sectionLength, model: asModel(model) ?? null },
          origin: 'mcp',
          save,
          title,
        });
        return { job, hint: 'Call nodus_get_deep_research_job with this id to follow it. Do not claim the report exists until its status is "completed".' };
      })()
  );

  server.registerTool(
    'nodus_list_deep_research_jobs',
    {
      title: 'List queued Deep Research reports',
      description:
        'Lists only the temporary Deep Research generation lane — queued, running and recently finished — including jobs started from the Nodus window rather than over MCP (`origin`). An empty lane does NOT mean the vault has no completed reports. Use nodus_list_deep_research_reports for the persistent gallery. Read-only.',
      inputSchema: {
        status: z
          .enum(['all', 'active', 'finished'])
          .default('all')
          .describe('"active": queued or running. "finished": completed, failed or cancelled.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ status }) =>
      tool(() => {
        ensureDeepResearchLane();
        const all = listDeepResearchJobs();
        const active = (job: DeepResearchJobRecord) => job.status === 'queued' || job.status === 'running';
        const jobs = status === 'all' ? all : all.filter((job) => (status === 'active' ? active(job) : !active(job)));
        return { jobs, running: all.some((job) => job.status === 'running'), queued: all.filter((job) => job.status === 'queued').length };
      })()
  );

  server.registerTool(
    'nodus_get_deep_research_job',
    {
      title: 'Get a queued Deep Research report',
      description:
        'Returns one job from the Deep Research lane: its status, live progress, and the error or saved draft id it ended with. Read-only. ' +
        'With includeReport=true a completed job also returns the full report (kept in memory for the last few finished jobs only — after that call nodus_get_deep_research_report with `savedDraftId`). ' +
        'A `queued` job has not started; `ahead` says how many reports are in front of it.',
      inputSchema: {
        jobId: z.string().trim().min(1).max(200),
        includeReport: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ jobId, includeReport }) =>
      tool(() => {
        ensureDeepResearchLane();
        const found = getDeepResearchJob(jobId);
        if (!found) {
          return {
            job: null,
            error: 'No job with that id is in the Deep Research lane. Finished jobs are eventually dropped; list persistent reports with nodus_list_deep_research_reports.',
          };
        }
        return {
          job: found.job,
          ...(includeReport
            ? { report: found.report, reportAvailable: found.report !== null }
            : {}),
        };
      })()
  );

  server.registerTool(
    'nodus_cancel_deep_research_job',
    {
      title: 'Cancel a queued Deep Research report',
      description:
        'Drops a report that has not started yet. A report already being generated is never abandoned mid-flight — the call returns cancelled=false and the job runs to the end. This modifies Nodus data.',
      inputSchema: { jobId: z.string().trim().min(1).max(200) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    ({ jobId }) =>
      tool(() => {
        ensureDeepResearchLane();
        const cancelled = cancelDeepResearchJob(jobId);
        return { cancelled, job: getDeepResearchJob(jobId)?.job ?? null };
      })()
  );

  server.registerTool(
    'nodus_create_folder',
    {
      title: 'Create notes folder',
      description: 'Creates a user-owned folder in the Nodus notes workspace. An optional summary describes the ideas the folder is meant to hold. This modifies Nodus data.',
      inputSchema: {
        name: z.string().trim().min(1).max(500),
        parentId: z.string().trim().min(1).nullable().optional(),
        summary: z.string().trim().max(8_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, parentId, summary }) =>
      tool(() => {
        if (parentId && !notes.getNoteFolder(parentId)) throw notFound('folder', parentId);
        const folder = notes.createNoteFolder({ name, parentId });
        if (summary && summary.trim()) return notes.updateNoteFolderSummary(folder.id, summary) ?? folder;
        return folder;
      })()
  );

  server.registerTool(
    'nodus_update_folder_summary',
    {
      title: 'Update folder summary',
      description:
        "Sets a notes folder's summary brief (the ideas the folder is meant to hold). Nodus reads this brief to suggest ideas to integrate into the folder. This modifies Nodus data.",
      inputSchema: { id: z.string().trim().min(1), summary: z.string().max(8_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id, summary }) =>
      tool(() => {
        const folder = notes.updateNoteFolderSummary(id, summary);
        if (!folder) throw notFound('folder', id);
        return folder;
      })()
  );

  server.registerTool(
    'nodus_create_note',
    {
      title: 'Create note',
      description: 'Creates a user-owned note in the Nodus notes workspace. This modifies Nodus data.',
      inputSchema: {
        title: z.string().trim().min(1).max(2_000),
        content: z.string().max(500_000),
        kind: z.enum(NOTE_KINDS).default('markdown'),
        folderId: z.string().trim().min(1).nullable().optional(),
        source: z
          .object({ origin: z.enum(NOTE_KINDS), model: modelSchema.nullable().optional(), ref: z.string().nullable().optional(), note: z.string().nullable().optional() })
          .nullable()
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ title, content, kind, folderId, source }) =>
      tool(() => {
        if (folderId && !notes.getNoteFolder(folderId)) throw notFound('folder', folderId);
        return notes.createNote({ title, content, kind, folderId, source: source as NoteSource | null | undefined });
      })()
  );

  server.registerTool(
    'nodus_update_note',
    {
      title: 'Update note',
      description: 'Updates title, Markdown content, or folder for an existing user-owned Nodus note. This modifies Nodus data.',
      inputSchema: {
        id: z.string().trim().min(1),
        title: z.string().trim().min(1).max(2_000).optional(),
        content: z.string().max(500_000).optional(),
        folderId: z.string().trim().min(1).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id, title, content, folderId }) =>
      tool(() => {
        if (folderId && !notes.getNoteFolder(folderId)) throw notFound('folder', folderId);
        const note = notes.updateNote({ id, title, content, folderId });
        if (!note) throw notFound('note', id);
        return note;
      })()
  );

  // ── Genealogy / primary-source records (read-only) ─────────────────────────
  // These read the entity ontology (persons, events, kinship). In a genealogy or
  // primary-sources vault they let an AI client reason over the family/record layer;
  // in an academic vault they simply return empty. They are strictly read-only: an
  // AI client can never write a relationship or confirm a suggestion through MCP —
  // that stays in the user's hands inside the Nodus app.

  server.registerTool(
    'nodus_list_persons',
    {
      title: 'List persons',
      description:
        'Lists persons in the records ontology (genealogy / primary-source vaults): the people extracted from records or entered by hand. Optional name query matches the display name or a name variant. Read-only; returns an empty list in vaults without a records layer.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
        query: querySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query }) =>
      tool(() => {
        const all = listPersons({ search: query || undefined }).map((p) => ({
          personId: p.personId,
          displayName: p.displayName,
          sex: p.sex,
          birthDate: p.birthDate,
          deathDate: p.deathDate,
        }));
        return page('persons', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_person',
    {
      title: 'Get a person with kin, events and evidence',
      description:
        'Gets one person with their immediate kinship (parents, spouses, children, siblings), life events, the cited evidence backing them, and any OPEN kinship suggestions that concern them. Kinship suggestions are evidence-backed proposals awaiting the user\'s confirmation in the Nodus app — they are NOT asserted relationships, and this tool cannot confirm or write them. Read-only. Do not present a suggestion as an established fact.',
      inputSchema: { personId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ personId }) =>
      tool(() => {
        const person = getPerson(personId);
        if (!person) throw notFound('person', personId);
        const kin = kinOf(personId);
        const names = (people: { displayName: string }[]) => people.map((p) => p.displayName);
        return {
          personId: person.personId,
          displayName: person.displayName,
          sex: person.sex,
          birthDate: person.birthDate,
          deathDate: person.deathDate,
          nameVariants: person.names.map((n) => n.name),
          biography: person.biography,
          kin: {
            parents: names(kin.parents),
            spouses: names(kin.spouses),
            children: names(kin.children),
            siblings: names(kin.siblings),
          },
          events: listEvents({ personId }).map((e) => ({ type: e.type, date: e.date, place: e.placeName, label: e.label })),
          evidence: listEvidenceFor('person', personId).map((ev) => ({ quote: ev.quote, location: ev.location, source: ev.sourceKind })),
          kinshipSuggestions: listSuggestionsForPerson(personId).map((s) => ({
            type: s.type,
            fromName: s.fromName,
            toName: s.toName,
            strength: s.strength,
            status: 'proposed (awaiting user confirmation in Nodus)',
            evidence: s.evidence.filter((ev) => ev.quote).map((ev) => ({ quote: ev.quote, location: ev.location, signal: ev.signal })),
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_list_kin_suggestions',
    {
      title: 'List open kinship suggestions',
      description:
        'Lists the vault\'s OPEN kinship suggestions: evidence-backed parent/spouse proposals derived from records and explicit textual claims, each carrying its verbatim quotes and a strength (alta/media/baja). These are hypotheses awaiting the user\'s confirmation in the Nodus app — never present them as established relationships, and note that only the user can confirm them. Read-only.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset }) =>
      tool(() => {
        const all = listOpenSuggestions().map((s) => ({
          suggestionId: s.suggestionId,
          type: s.type,
          fromName: s.fromName,
          toName: s.toName,
          strength: s.strength,
          evidence: s.evidence.filter((ev) => ev.quote).map((ev) => ({ quote: ev.quote, location: ev.location, signal: ev.signal })),
        }));
        return page('suggestions', all, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_list_events',
    {
      title: 'List timeline events',
      description:
        'Lists the historical events of the records ontology (genealogy / primary-source vaults) in chronological order — the same data behind the Nodus timeline. Optional filters: personId (events the person participates in), type (birth|baptism|marriage|death|burial|census|residence|migration|occupation|other), and a from/to window over the sortable date (ISO prefix, e.g. "1890" or "1890-05"). Each event carries its participants with their roles. Read-only; returns an empty list in vaults without a records layer.',
      inputSchema: {
        ...paginationSchema,
        personId: z.string().trim().min(1).optional(),
        type: z.enum(EVENT_TYPES).optional(),
        from: z.string().trim().min(1).max(30).optional().describe('Earliest sortable date, ISO prefix (e.g. "1890" or "1890-05-01").'),
        to: z.string().trim().min(1).max(30).optional().describe('Latest sortable date, ISO prefix.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, personId, type, from, to }) =>
      tool(() => {
        if (personId && !getPerson(personId)) throw notFound('person', personId);
        const events = listEvents({ personId, type, from, to });
        const paged = page('events', events, limit, offset);
        return {
          ...paged,
          events: paged.events.map((e) => ({
            eventId: e.eventId,
            type: e.type,
            label: e.label,
            date: e.date,
            place: e.placeName,
            notes: e.notes,
            participants: e.participants.map((p) => ({ personId: p.personId, name: p.displayName ?? null, role: p.role })),
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_list_archive_items',
    {
      title: 'List archive documents',
      description:
        'Lists the evidence-archive documents of a genealogy / primary-source vault (record photos, scans, transcribed certificates, exports) with their document type, year, folders, tags and linked persons. Optional filters: query (title/description/text), docTypes, kinds, tags, personId (documents linked to that person) and a year window. Returns compact rows with text snippets; use nodus_get_archive_item for the full extracted text and metadata. File binaries are never returned. Read-only; empty in vaults without an archive.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        docTypes: z.array(z.string().trim().min(1).max(200)).max(25).optional().describe('Document-type ids (see each item\'s docType).'),
        kinds: z.array(z.enum(ARCHIVE_KINDS)).max(6).optional(),
        tags: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
        personId: z.string().trim().min(1).optional(),
        yearFrom: z.number().int().min(0).max(3000).optional(),
        yearTo: z.number().int().min(0).max(3000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, docTypes, kinds, tags, personId, yearFrom, yearTo }) =>
      tool(() => {
        if (personId && !getPerson(personId)) throw notFound('person', personId);
        const items = archive.listItems({
          search: query,
          docTypes,
          kinds,
          tags,
          personIds: personId ? [personId] : undefined,
          yearFrom,
          yearTo,
        });
        const folderNames = archiveFolderNames();
        const compact = items.map((item) => compactArchiveItem(item, folderNames));
        return page('items', compact, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_archive_item',
    {
      title: 'Get archive document',
      description:
        'Gets one evidence-archive document by itemId: full extracted text, description, provenance (source), document type with its metadata form values, folders, tags and linked persons. The file binary itself is not returned. Read-only.',
      inputSchema: { itemId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ itemId }) =>
      tool(() => {
        const item = archive.getItem(itemId);
        if (!item) throw notFound('archive item', itemId);
        const folderNames = archiveFolderNames();
        return {
          itemId: item.itemId,
          title: item.title,
          kind: item.kind,
          docType: item.docType,
          metadata: item.metadata,
          year: item.year,
          fileName: item.fileName,
          mimeType: item.mimeType,
          bytes: item.bytes,
          hasFile: item.hasBlob,
          folders: item.folderIds.map((id) => folderNames.get(id) ?? id),
          tags: item.tags,
          linkedPersons: item.linkedPersons.map((p) => ({ personId: p.personId, displayName: p.displayName })),
          source: item.source,
          description: item.description,
          extractedText: item.extractedText,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      })()
  );

  server.registerTool(
    'nodus_search_archive',
    {
      title: 'Search archive documents semantically',
      description:
        'Finds evidence-archive documents ranked by semantic similarity to the query — the direct way to locate which records discuss a person, place or fact when exact words differ (period spellings, synonyms). Searches the embedded extracted text/description of archive items. Reports index coverage (`indexed` of `indexable`); when `indexed` is 0 nothing can match and a `warning` says so, so an empty result means "not indexed", NOT "not in the archive". Returns compact items with a similarity score; use nodus_get_archive_item for full text. Requires an embedding provider already configured in Nodus. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(50).default(10),
        minSimilarity: z
          .number()
          .min(0)
          .max(1)
          .default(0.35)
          .describe(
            'Cosine similarity floor; 0.35 is the value the Nodus archive discovery uses. Scores are RELATIVE and their scale depends on the configured embedding model — with some models unrelated text still scores ~0.5, so a hit clearing this floor is not evidence of relevance on its own. Rank by the returned order and judge each hit by its text.'
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, minSimilarity }) =>
      tool(async () => {
        const vector = await embedQuery(query);
        if (!vector) {
          throw new McpToolError(
            'ai_unconfigured',
            'No embeddings available. Configure the embedding provider and key in Nodus Settings.'
          );
        }
        const hits = await archive.findArchiveItemsSimilar(vector, { limit, minSimilarity });
        const folderNames = archiveFolderNames();
        const embedding = archive.archiveEmbeddingCount();
        return {
          items: hits.map((hit) => ({ ...compactArchiveItem(hit, folderNames), similarity: hit.similarity })),
          ...searchCoverage(embedding.indexed, embedding.total, 'archive documents'),
        };
      })()
  );

  // ── Databases mode (read-only) ──────────────────────────────────────────────
  server.registerTool(
    'nodus_list_databases',
    {
      title: 'List databases',
      description:
        'Lists the structured databases in a "databases"-mode vault (Notion-like tables the user built). Returns each database\'s id, short id, name and row count. Read-only; use nodus_get_database_schema for columns and nodus_query_database for rows.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
      databases: dbMode.listDatabases()
        .filter((database) => canMcpView('database', database.id))
        .map((d) => ({ id: d.id, shortId: d.shortId, name: d.name, rows: d.rowCount })),
    }))
  );

  server.registerTool(
    'nodus_enqueue_database_deep_research',
    {
      title: 'Queue database Deep Research',
      description:
        'Queues a durable Deep Research run for one structured database and returns immediately. The run is persisted in the active databases vault and remains discoverable after restart. This endpoint only schedules orchestration; it never changes database rows.',
      inputSchema: {
        databaseIds: z.array(z.string().trim().min(1)).min(1).max(100),
        objective: z.string().trim().min(1).max(20_000),
        reportType: z.enum(DATABASE_DEEP_RESEARCH_REPORT_TYPES).default('general'),
        language: z.enum(DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES).optional(),
        audience: z.string().trim().max(200).optional(),
        viewIds: z.array(z.string().trim().min(1)).max(100).default([]),
        filters: z.object({ query: z.string().max(2_000).default(''), columnIds: z.array(z.string()).max(500).default([]) }).default({ query: '', columnIds: [] }),
        roles: z.record(z.union([z.string(), z.array(z.string())])).default({}),
        model: modelSchema.nullable().optional(),
        depth: z.enum(['focused', 'deep', 'exhaustive']).default('deep'),
        maxRows: z.number().int().min(1).max(500_000).default(500_000),
        maxCostUsd: z.number().min(0).max(100_000).optional(),
        seed: z.union([z.number().int(), z.string().max(200)]).optional(),
        includedCellTypes: z.array(z.string()).max(100).default([]),
        includeAttachmentContent: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ databaseIds, objective, reportType, language, audience, viewIds, filters, roles, model, depth, maxRows, maxCostUsd, seed, includedCellTypes, includeAttachmentContent }) =>
      tool(async () => {
        for (const databaseId of databaseIds) if (!canMcpView('database', databaseId)) throw notFound('database', databaseId);
        const preset = DATABASE_RESEARCH_BUDGETS[depth];
        const input: DatabaseDeepResearchJobInput & { reportType: string } = {
          databaseIds, objective, reportType, language, audience, viewIds, filters,
          roles, model: asModel(model ?? undefined) ?? null, depth,
          budget: { ...preset, depth, maxRows, seed, ...(maxCostUsd == null ? {} : { maxCostUsd }) },
          includedCellTypes, includeAttachmentContent,
        };
        return { job: await enqueueDatabaseDeepResearch(getActiveVault().id, input), queued: true };
      })()
  );

  server.registerTool(
    'nodus_preview_database_deep_research',
    {
      title: 'Preview database Deep Research',
      description: 'Previews bounded row evidence and an estimated cost before queueing a database Deep Research run.',
      inputSchema: {
        databaseIds: z.array(z.string().trim().min(1)).min(1).max(100),
        objective: z.string().trim().min(1).max(20_000),
        reportType: z.enum(DATABASE_DEEP_RESEARCH_REPORT_TYPES).default('general'),
        language: z.enum(DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES).optional(),
        viewIds: z.array(z.string().trim().min(1)).max(100).default([]),
        filters: z.object({ query: z.string().max(2_000).default(''), columnIds: z.array(z.string()).default([]) }).default({ query: '', columnIds: [] }),
        roles: z.record(z.union([z.string(), z.array(z.string())])).default({}),
        model: modelSchema.nullable().optional(),
        depth: z.enum(['focused', 'deep', 'exhaustive']).default('deep'),
        maxRows: z.number().int().min(1).max(500_000).default(500_000),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseIds, objective, reportType, language, viewIds, filters, roles, model, depth, maxRows }) =>
      tool(() => {
        for (const databaseId of databaseIds) if (!canMcpView('database', databaseId)) throw notFound('database', databaseId);
        const normalized = normalizeDatabaseDeepResearchJobInput({ databaseIds, objective, reportType, language, viewIds, filters, roles, model: asModel(model ?? undefined) ?? null, depth, budget: { maxRows } } as DatabaseDeepResearchJobInput);
        const rows = databaseIds.reduce((n, databaseId) => n + (dbMode.getDatabase(databaseId)?.rowCount ?? 0), 0);
        const estimate = estimateDatabaseDeepResearchCost(rows, databaseIds.length, depth);
        const columns = databaseIds.flatMap((databaseId) => dbMode.getColumns(databaseId).map((column) => ({ id: column.id, type: column.type })));
        const availableReportTypes = DATABASE_DEEP_RESEARCH_REPORT_TYPES.map((type) => getDatabaseDeepResearchEligibility(type, { columns, roles: normalized.roles, databaseCount: databaseIds.length }));
        const effectiveReportType = normalizeDatabaseDeepResearchReportType(normalized.reportType);
        const analyses = getDatabaseDeepResearchAnalysisRequirements(effectiveReportType);
        return {
          rowCount: rows,
          sourceCount: databaseIds.length,
          reportType: effectiveReportType,
          eligibility: availableReportTypes.find((item) => item.reportType === effectiveReportType),
          availableReportTypes,
          ...estimate,
          requiredAnalyses: analyses.required,
          optionalAnalyses: analyses.optional,
          sections: buildDatabaseDeepResearchPreviewSections(
            normalized.language ?? 'en',
            effectiveReportType,
            normalized.objective,
            0,
          ),
          evidence: [],
          request: normalized,
        };
      })()
  );

  server.registerTool(
    'nodus_list_database_deep_research_jobs',
    { title: 'List database Deep Research jobs', description: 'Lists the durable asynchronous database Deep Research queue with pagination.', inputSchema: { limit: compactLimitSchema, offset: z.number().int().min(0).default(0), status: z.enum(['all', 'queued', 'running', 'completed', 'partial', 'failed', 'stale', 'cancelling', 'cancelled']).default('all') }, annotations: { readOnlyHint: true, openWorldHint: false } },
    ({ limit, offset, status }) => tool(() => {
      ensureDatabaseDeepResearchLane(getActiveVault().id);
      const visible = visibleDatabaseResearchRuns(status, offset, limit);
      return { jobs: visible.items.map(safeMcpDatabaseResearchJob), limit, offset, hasMore: visible.hasMore };
    })()
  );

  server.registerTool(
    'nodus_get_database_deep_research_job',
    { title: 'Get database Deep Research job', description: 'Returns one database Deep Research queue job and its durable detail.', inputSchema: { jobId: z.string().trim().min(1) }, annotations: { readOnlyHint: true, openWorldHint: false } },
    ({ jobId }) => tool(() => {
      const detail = databaseResearch.getDatabaseResearchRunDetail(jobId);
      if (!detail || !canMcpViewDatabaseResearchRun(detail.run)) throw notFound('database research job', jobId);
      return { job: safeMcpDatabaseResearchJob(detail.run), detail: safeMcpDatabaseResearchJobDetail(detail) };
    })()
  );

  server.registerTool(
    'nodus_cancel_database_deep_research_job',
    { title: 'Cancel database Deep Research job', description: 'Cancels a queued or running database Deep Research job.', inputSchema: { jobId: z.string().trim().min(1) }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
    ({ jobId }) => tool(() => {
      const detail = databaseResearch.getDatabaseResearchRunDetail(jobId);
      if (!detail || !canMcpViewDatabaseResearchRun(detail.run)) throw notFound('database research job', jobId);
      const cancelled = databaseResearch.cancelDatabaseResearchRun(jobId);
      const updated = databaseResearch.getDatabaseResearchRun(jobId);
      return { cancelled, job: updated ? safeMcpDatabaseResearchJob(updated) : null };
    })()
  );

  server.registerTool(
    'nodus_list_database_deep_research_reports',
    { title: 'List database Deep Research reports', description: 'Lists saved database Deep Research reports with pagination, optional title search, and report type.', inputSchema: { query: querySchema, reportType: z.enum(DATABASE_DEEP_RESEARCH_REPORT_TYPES).optional(), limit: compactLimitSchema, offset: z.number().int().min(0).default(0) }, annotations: { readOnlyHint: true, openWorldHint: false } },
    ({ query, reportType, limit, offset }) => tool(() => {
      const visible = visibleDatabaseResearchReports(query, offset, limit, reportType);
      return { reports: visible.items, limit, offset, hasMore: visible.hasMore };
    })()
  );

  server.registerTool(
    'nodus_get_database_deep_research_reports',
    { title: 'Get database Deep Research report', description: 'Returns one saved database Deep Research report.', inputSchema: { reportId: z.string().trim().min(1) }, annotations: { readOnlyHint: true, openWorldHint: false } },
    ({ reportId }) => tool(() => {
      const report = databaseResearch.getDatabaseResearchReport(reportId);
      const run = report ? databaseResearch.getDatabaseResearchRun(report.runId) : null;
      if (!report || !canMcpViewDatabaseResearchRun(run)) throw notFound('database research report', reportId);
      return { report: safeMcpDatabaseResearchReport(report) };
    })()
  );

  server.registerTool(
    'nodus_get_database_schema',
    {
      title: 'Get database schema',
      description:
        'Gets a database\'s columns: each column\'s id, name and type (title|text|number|date|time|select|multi_select|checkbox|attachment|ai|ai_image|relation|rollup|formula|comparison) plus the option labels for select/multi-select columns. A formula column also reports `computes` (number|text — what its values behave as, since "formula" says nothing on its own) and `formula`, a plain-language description of the recipe. Read-only.',
      inputSchema: { databaseId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId }) =>
      tool(() => {
        const detail = dbMode.getDatabaseDetail(databaseId);
        if (!detail || !canMcpView('database', databaseId)) throw notFound('database', databaseId);
        return {
          database: { id: detail.database.id, shortId: detail.database.shortId, name: detail.database.name, rows: detail.database.rowCount },
          columns: detail.columns.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            // "formula" tells a client nothing it can query on, so say what it yields and how.
            ...(c.type === 'formula'
              ? {
                  computes: comparableType(c),
                  formula: describeFormula(c.config.formula as FormulaSpec | undefined, detail.columns) || undefined,
                }
              : {}),
            options: c.options.length ? c.options.map((o) => o.label) : undefined,
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_query_database',
    {
      title: 'Query database rows',
      description:
        'Lists a database\'s rows with human-readable field values (select/multi-select resolved to labels, checkboxes to booleans, attachments to file names, relations to a link count). Three composable narrowing mechanisms: `query` (substring over all of a row\'s text), `filter` (typed conditions — the same engine as the in-app filter bar; reference columns by name or id, select/multi-select values by option label) and `sorts` (multi-column, applied in order; empty values always sort last). Get the columns, their types and option labels from nodus_get_database_schema first. Read-only; paginated.',
      inputSchema: {
        databaseId: z.string().trim().min(1),
        query: querySchema,
        filter: z
          .object({
            conjunction: z.enum(['and', 'or']).default('and'),
            conditions: z
              .array(
                z.object({
                  column: z.string().trim().min(1).describe('Column name (case-insensitive) or column id.'),
                  op: z.enum(DB_FILTER_OPS),
                  value: z
                    .union([z.string(), z.array(z.string()).max(50)])
                    .optional()
                    .describe('Text/number/date as string; option labels (or ids) for select/multi-select. Omit for isEmpty/notEmpty/isChecked/isUnchecked.'),
                })
              )
              .min(1)
              .max(20),
          })
          .optional()
          .describe('Typed row filter. Number columns compare numerically (gt/gte/lt/lte), date columns support before/after, select columns isAnyOf/isNoneOf/hasAllOf.'),
        sorts: z
          .array(z.object({ column: z.string().trim().min(1), dir: z.enum(['asc', 'desc']).default('asc') }))
          .max(5)
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId, query, filter, sorts, limit, offset }) =>
      tool(() => {
        const detail = dbMode.getDatabaseDetail(databaseId);
        if (!detail || !canMcpView('database', databaseId)) throw notFound('database', databaseId);
        let rows = dbMode.listRows(databaseId, { sort: 'position' });
        if (filter) {
          const conditions = filter.conditions.map((cond) => dbBuildCondition(detail.columns, cond));
          rows = applyDatabaseFilter(rows, detail.columns, { conjunction: filter.conjunction, conditions });
        }
        if (sorts?.length) {
          const rules = sorts.map((s) => ({ columnId: dbResolveColumn(detail.columns, s.column).id, dir: s.dir }));
          rows = sortDatabaseRows(rows, detail.columns, rules);
        }
        const q = query?.trim().toLowerCase();
        if (q) rows = rows.filter((r) => dbRowSearchText(detail.columns, r).includes(q));
        const paged = page('rows', rows, limit, offset);
        return { ...paged, rows: paged.rows.map((r) => dbRowRecord(detail.columns, r)) };
      })()
  );

  server.registerTool(
    'nodus_get_database_row',
    {
      title: 'Get a database row',
      description:
        'Gets one database row by id, with its field values decoded to human-readable form. Unlike nodus_query_database (which reports relation columns as link counts), here each relation column resolves to the labels of its linked targets. Read-only.',
      inputSchema: { rowId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ rowId }) =>
      tool(() => {
        const row = dbMode.getRow(rowId);
        if (!row || !canMcpView('row', rowId)) throw notFound('row', rowId);
        const detail = dbMode.getDatabaseDetail(row.databaseId);
        if (!detail) throw notFound('database', row.databaseId);
        const record = dbRowRecord(detail.columns, row);
        for (const col of detail.columns) {
          if (col.type !== 'relation') continue;
          record.fields[col.name] = dbMode.listRelations(row.id, col.id).map((rel) => ({
            label: rel.label,
            kind: rel.targetKind,
            ...(rel.vaultName ? { vault: rel.vaultName } : {}),
          }));
        }
        return {
          database: { id: detail.database.id, name: detail.database.name },
          page: (() => {
            const linked = pages.getPageForRow(row.id);
            return linked && pageAcl.getEffectiveAcl('page', linked.id, 'local').canView
              ? { id: linked.id, title: linked.title, revision: linked.revision }
              : null;
          })(),
          ...record,
        };
      })()
  );

  server.registerTool(
    'nodus_list_database_views',
    {
      title: 'List database views',
      description: 'Lists every versioned view configuration of one database, including layout, recursive filters, sorts, grouping, card/calendar/timeline options, scope and revision. Hidden databases return not-found. Read-only.',
      inputSchema: { databaseId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId }) => tool(() => {
      if (!dbMode.getDatabase(databaseId) || !canMcpView('database', databaseId)) throw notFound('database', databaseId);
      return { views: dbMode.listViews(databaseId) };
    })()
  );

  server.registerTool(
    'nodus_list_database_templates',
    {
      title: 'List database templates',
      description: 'Lists row/page templates with default properties, blocks, relations, recurrence, timezone and revision. Read-only.',
      inputSchema: { databaseId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId }) => tool(() => {
      if (!dbMode.getDatabase(databaseId) || !canMcpView('database', databaseId)) throw notFound('database', databaseId);
      return { templates: databaseTasks.listDatabaseRowTemplates(databaseId) };
    })()
  );

  server.registerTool(
    'nodus_list_database_automations',
    {
      title: 'List database automations',
      description: 'Lists versioned automation rules and a bounded page of recent execution records for one visible database. Read-only.',
      inputSchema: {
        databaseId: z.string().trim().min(1),
        runLimit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId, runLimit }) => tool(() => {
      if (!dbMode.getDatabase(databaseId) || !canMcpView('database', databaseId)) throw notFound('database', databaseId);
      return {
        rules: databaseAutomations.listAutomationRules(databaseId),
        runs: databaseAutomations.listAutomationRuns(databaseId, runLimit),
      };
    })()
  );

  server.registerTool(
    'nodus_list_database_forms',
    {
      title: 'List database forms',
      description: 'Lists public or authenticated form definitions, fields, validation/rate-limit configuration, enabled state, submission count and revision for one visible database. Authentication secrets are never returned. Read-only.',
      inputSchema: { databaseId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ databaseId }) => tool(() => {
      if (!dbMode.getDatabase(databaseId) || !canMcpView('database', databaseId)) throw notFound('database', databaseId);
      return { forms: databaseAutomations.listDatabaseForms(databaseId) };
    })()
  );

  // ── Universal pages, blocks and comments ─────────────────────────────────
  // The local MCP token represents the local workspace actor. Every operation still
  // crosses the same ACL boundary as Electron IPC, and every mutation requires the
  // revision the client actually read so a stale model call can never overwrite a
  // newer edit silently.
  server.registerTool(
    'nodus_list_pages',
    {
      title: 'List workspace pages',
      description:
        'Lists standalone workspace pages as a compact, paginated tree. Database-row pages are discoverable through nodus_search_pages and their page id is returned by nodus_get_database_row. Pages the local MCP principal cannot view are omitted. Read-only.',
      inputSchema: {
        state: z.enum(['active', 'trashed', 'all']).default('active'),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ state, limit, offset }) =>
      tool(() => {
        const visible = pages.listPages(state).filter((item) => pageAcl.getEffectiveAcl('page', item.id, 'local').canView);
        return page('pages', visible, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_search_pages',
    {
      title: 'Search workspace pages and blocks',
      description:
        'Full-text search over page titles and block text, including database-row pages. Results include ranked snippets but never pages hidden by ACL. Read-only and paginated.',
      inputSchema: {
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit, offset }) =>
      tool(() => {
        const requested = Math.min(200, limit + offset);
        const visible = pages.searchPages(query, 'lexical', requested)
          .filter((item) => item.pageId != null && pageAcl.getEffectiveAcl('page', item.pageId, 'local').canView);
        return page('results', visible, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_get_page',
    {
      title: 'Get a workspace page',
      description:
        'Returns one universal page with Markdown and revision tokens. Set includeBlocks to receive the structured block projection as well; Yjs binary state is never returned. Pages hidden by ACL return not-found. Read-only.',
      inputSchema: {
        pageId: z.string().trim().min(1),
        includeBlocks: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ pageId, includeBlocks }) =>
      tool(() => {
        const access = pageAcl.getEffectiveAcl('page', pageId, 'local');
        if (!access.canView) throw notFound('page', pageId);
        const document = pages.getPageDocument(pageId);
        if (!document) throw notFound('page', pageId);
        return {
          page: document.page,
          documentRevision: document.revision,
          updateSequence: document.updateSequence,
          markdown: document.markdown,
          markdownHash: document.markdownHash,
          blocks: includeBlocks ? document.blocks : undefined,
          access,
        };
      })()
  );

  server.registerTool(
    'nodus_list_page_comments',
    {
      title: 'List page comments',
      description: 'Lists page and block comment threads visible to the local MCP principal. Resolved threads are omitted unless requested. Read-only.',
      inputSchema: {
        pageId: z.string().trim().min(1),
        includeResolved: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ pageId, includeResolved }) =>
      tool(() => {
        assertMcpAcl('page', pageId, 'view');
        return { comments: pageComments.listPageComments(pageId, includeResolved) };
      })()
  );

  server.registerTool(
    'nodus_create_page',
    {
      title: 'Create a workspace page',
      description:
        'Creates a standalone page, optionally below another page, and atomically initializes its Markdown blocks. The parent ACL must allow structural editing. Returns both page and document revisions. Not read-only.',
      inputSchema: {
        title: z.string().trim().min(1).max(500),
        parentPageId: z.string().trim().min(1).nullable().default(null),
        icon: z.string().trim().max(32).nullable().default(null),
        markdown: z.string().max(2_000_000).default(''),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ title, parentPageId, icon, markdown }) =>
      tool(() => {
        assertMcpAcl(parentPageId ? 'page' : 'vault', parentPageId ?? 'vault', 'edit');
        return getDb().transaction(() => {
          let document = pages.createPage({ title, parentPageId, icon, actorId: 'local' });
          if (markdown) {
            const result = pages.replacePageFromMarkdown(document.page.id, markdown, document.revision, 'local');
            if (!result.ok) throw new Error('La página cambió durante su creación.');
            document = result.document;
          }
          return { page: document.page, documentRevision: document.revision, markdownHash: document.markdownHash };
        })();
      })()
  );

  server.registerTool(
    'nodus_update_page',
    {
      title: 'Update page properties',
      description:
        'Updates user-authored page properties with optimistic concurrency. expectedPageRevision must equal the revision returned by nodus_get_page; stale writes fail explicitly. Not read-only.',
      inputSchema: {
        pageId: z.string().trim().min(1),
        expectedPageRevision: z.number().int().min(1),
        title: z.string().trim().min(1).max(500).optional(),
        icon: z.string().trim().max(32).nullable().optional(),
        fullWidth: z.boolean().optional(),
        locked: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ pageId, expectedPageRevision, title, icon, fullWidth, locked }) =>
      tool(() => {
        assertMcpAcl('page', pageId, 'edit');
        const updated = pages.updatePage(pageId, { title, icon, fullWidth, locked }, expectedPageRevision, 'local');
        if (!updated) throw notFound('page', pageId);
        return { page: updated };
      })()
  );

  server.registerTool(
    'nodus_replace_page_markdown',
    {
      title: 'Replace page Markdown',
      description:
        'Replaces a page document through the universal block engine. expectedDocumentRevision must come from nodus_get_page. A concurrent edit returns an explicit conflict with the current revision instead of overwriting it. Not read-only.',
      inputSchema: {
        pageId: z.string().trim().min(1),
        expectedDocumentRevision: z.number().int().min(1),
        markdown: z.string().max(2_000_000),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ pageId, expectedDocumentRevision, markdown }) =>
      tool(() => {
        assertMcpAcl('page', pageId, 'edit_content');
        const result = pages.replacePageFromMarkdown(pageId, markdown, expectedDocumentRevision, 'local');
        return result.ok
          ? { ok: true, page: result.document.page, documentRevision: result.document.revision, markdownHash: result.document.markdownHash }
          : { ok: false, conflict: { kind: result.conflict.kind, expectedRevision: result.conflict.expectedRevision, actualRevision: result.conflict.actualRevision } };
      })()
  );

  server.registerTool(
    'nodus_create_page_comment',
    {
      title: 'Create a page comment',
      description: 'Creates a page, block or threaded reply comment when the local MCP principal has comment access. Not read-only.',
      inputSchema: {
        pageId: z.string().trim().min(1),
        blockId: z.string().trim().min(1).nullable().default(null),
        parentCommentId: z.string().trim().min(1).nullable().default(null),
        body: z.string().trim().min(1).max(20_000),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ pageId, blockId, parentCommentId, body }) =>
      tool(() => {
        assertMcpAcl('page', pageId, 'comment');
        return { comment: pageComments.createPageComment({ pageId, blockId, parentCommentId, body, actorId: 'local' }) };
      })()
  );

  // ── Study vault (read-only) ────────────────────────────────────────────────
  // Learning data can be inspected and searched by an explicitly enabled local
  // MCP client, but creation, grading and review decisions remain in the app.
  server.registerTool(
    'nodus_study_get_workspace',
    {
      title: 'Get study workspace',
      description:
        'Returns the active vault\'s study organisation: academic years, courses, subjects, topics and compact document metadata. Read-only. Empty arrays mean that the active vault has no study layer. '
        + 'Courses and subjects carry an academicYearId into academicYears (label "2024/2025"); a subject whose academicYearId is null belongs to its course\'s year, and null on both means no academic year is set.',
      inputSchema: { includeArchived: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ includeArchived }) =>
      tool(() => {
        const workspace = studyOrg.getStudyWorkspace({ includeArchived });
        return {
          // Without the year rows an academicYearId is an opaque uuid the client
          // cannot turn back into "2024/2025".
          academicYears: workspace.academicYears,
          courses: workspace.courses,
          subjects: workspace.subjects,
          topics: workspace.topics,
          documents: workspace.documents.map(({ contentMarkdown: _content, ...document }) => document),
          placements: workspace.placements,
          tags: workspace.tags,
        };
      })()
  );

  server.registerTool(
    'nodus_study_get_document',
    {
      title: 'Get study document',
      description:
        'Gets one study document and its placements. Content is omitted by default; pass includeContent=true when the complete Markdown is needed. Read-only.',
      inputSchema: {
        documentId: z.string().trim().min(1),
        includeContent: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ documentId, includeContent }) =>
      tool(() => {
        const workspace = studyOrg.getStudyWorkspace({ includeArchived: true, includeDeleted: false });
        const document = workspace.documents.find((item) => item.id === documentId || item.shortId === documentId);
        if (!document) throw notFound('study document', documentId);
        const { contentMarkdown: _contentMarkdown, ...metadata } = document;
        return {
          document: includeContent ? document : metadata,
          placements: workspace.placements.filter((placement) => placement.documentId === document.id),
          tags: workspace.documentTags
            .filter((link) => link.documentId === document.id)
            .map((link) => workspace.tags.find((tag) => tag.id === link.tagId))
            .filter(Boolean),
          contentOmitted: !includeContent,
        };
      })()
  );

  server.registerTool(
    'nodus_study_search',
    {
      title: 'Search the study corpus',
      description:
        'Searches study documents, imported materials, transcripts, questions and exams in the active vault. Returns grounded snippets and precise locations where available. Read-only.',
      inputSchema: {
        query: z.string().trim().min(2).max(2_000),
        kinds: z.array(z.enum(['document', 'material', 'transcript', 'question', 'exam'])).max(5).optional(),
        courseId: z.string().trim().min(1).optional(),
        subjectId: z.string().trim().min(1).optional(),
        topicId: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, kinds, courseId, subjectId, topicId, limit }) =>
      tool(async () => searchStudyCorpus(query, { kinds, courseId, subjectId, topicId, limit }))()
  );

  server.registerTool(
    'nodus_study_list_questions',
    {
      title: 'List study questions',
      description:
        'Lists compact, source-grounded questions from the active study vault, filterable by course/subject/topic, question type, difficulty and review status. Read-only; lifecycle and grading actions remain inside Nodus.',
      inputSchema: {
        query: querySchema,
        courseId: z.string().trim().min(1).optional(),
        subjectId: z.string().trim().min(1).optional(),
        topicId: z.string().trim().min(1).optional(),
        type: z.enum(STUDY_QUESTION_TYPE_VALUES).optional(),
        difficulty: z.enum(STUDY_QUESTION_DIFFICULTIES).optional(),
        status: z.enum(STUDY_QUESTION_STATUSES).optional(),
        favorite: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, courseId, subjectId, topicId, type, difficulty, status, favorite, limit, offset }) =>
      tool(() => {
        const questions = studyQuestions.listStudyQuestions({
          search: query,
          courseId,
          subjectId,
          topicId,
          type: type as StudyQuestionType | undefined,
          difficulty,
          status,
          favorite,
        });
        const compact = questions.map((question) => ({
          id: question.id,
          shortId: question.shortId,
          prompt: question.prompt,
          type: question.type,
          difficulty: question.difficulty,
          cognitiveLevel: question.cognitiveLevel,
          status: question.status,
          explanation: question.explanation,
          tags: question.tags,
          courseId: question.courseId,
          subjectId: question.subjectId,
          topicId: question.topicId,
          source: question.source,
          favorite: question.favorite,
        }));
        return page('questions', compact, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_study_get_progress',
    {
      title: 'Get study progress',
      description:
        'Returns the local evidence-based study progress dashboard and planner snapshot. Read-only; no review, session or goal is changed.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
      progress: studyLearning.getStudyProgressDashboard(),
      planner: studyLearning.getStudyPlanner(),
    }))
  );

  server.registerTool(
    'nodus_study_get_schedule',
    {
      title: 'Get weekly schedule',
      description:
        'Returns the weekly timetable grid (periods and day/period cells) of a study or teaching vault. Pass academicYearId to read a specific course year; omit it for the unscoped timetable. Cells reference subjectId (resolve names via nodus_study_get_workspace). Read-only; empty in vaults without a study layer.',
      inputSchema: {
        academicYearId: z.string().trim().min(1).nullable().default(null),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ academicYearId }) => tool(() => studySchedule.getStudySchedule(academicYearId))()
  );

  // ── Teaching vault (read-only) ─────────────────────────────────────────────
  // The teacher's own workspace: class groups, assessment schemes, the computed
  // gradebook, exams and rubrics. Two invariants make this surface safe to hand to
  // an external model: STUDENTS ARE ONLY EVER IDENTIFIED BY THEIR OPAQUE PSEUDONYM
  // CODE (never given names, surnames or comments), and grades are a read-only
  // PROJECTION computed by the shared assessment engine — the MCP never records one.
  server.registerTool(
    'nodus_teaching_list_groups',
    {
      title: 'List class groups',
      description:
        'Lists the teaching groups (class cohorts) of a docencia vault with their student counts. Optional filters: subjectId, and academicYearId (pass null to scope to groups with no year). No student names are returned. Read-only; empty in vaults without a teaching layer.',
      inputSchema: {
        subjectId: z.string().trim().min(1).optional(),
        academicYearId: z.string().trim().min(1).nullable().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ subjectId, academicYearId }) =>
      tool(() =>
        teachingGroups
          .listTeachingGroups({ subjectId, academicYearId })
          .map((group) => ({
            id: group.id,
            shortId: group.shortId,
            name: group.name,
            subjectId: group.subjectId,
            academicYearId: group.academicYearId,
            expectedSize: group.expectedSize,
            studentCount: group.studentCount ?? 0,
          }))
      )()
  );

  server.registerTool(
    'nodus_teaching_get_group',
    {
      title: 'Get class group roster',
      description:
        'Gets one teaching group and its roster BY PSEUDONYM CODE ONLY — each student is returned as an opaque code (e.g. "STU_7K3Q") plus its position and whether the teacher has filled in a real identity, never the name itself. Use the code to line up with nodus_teaching_get_gradebook. Read-only.',
      inputSchema: { groupId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ groupId }) =>
      tool(() => {
        let group;
        try {
          group = teachingGroups.getTeachingGroup(groupId);
        } catch {
          throw notFound('teaching group', groupId);
        }
        return {
          id: group.id,
          shortId: group.shortId,
          name: group.name,
          subjectId: group.subjectId,
          academicYearId: group.academicYearId,
          expectedSize: group.expectedSize,
          students: (group.students ?? []).map((student) => ({
            code: student.pseudonymCode,
            position: student.position,
            filled: isStudentFilled(student),
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_teaching_list_assessment_plans',
    {
      title: 'List assessment plans',
      description:
        'Lists the assessment plans (grading schemes) of a docencia vault: the weighting profile and the version/publication state. Optional filters: subjectId, academicYearId (null = plans with no year). Use nodus_teaching_get_assessment_plan for the item tree and rules. Read-only.',
      inputSchema: {
        subjectId: z.string().trim().min(1).optional(),
        academicYearId: z.string().trim().min(1).nullable().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ subjectId, academicYearId }) =>
      tool(() =>
        teachingGrades.listAssessmentPlans({ subjectId, academicYearId }).map((plan) => ({
          id: plan.id,
          name: plan.name,
          subjectId: plan.subjectId,
          academicYearId: plan.academicYearId,
          profile: plan.profile,
          version: plan.version,
          published: plan.publishedAt != null,
        }))
      )()
  );

  server.registerTool(
    'nodus_teaching_get_assessment_plan',
    {
      title: 'Get assessment plan',
      description:
        'Gets one assessment plan with its full item tree (blocks, activities and criteria with their weights, aggregation, entry mode and thresholds) and its computation rules (rounding, pass mark, qualitative bands, not-presented policy). This is the scheme; nodus_teaching_get_gradebook applies it to a group. Read-only.',
      inputSchema: { planId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ planId }) =>
      tool(() => {
        try {
          return teachingGrades.getAssessmentPlan(planId);
        } catch {
          throw notFound('assessment plan', planId);
        }
      })()
  );

  server.registerTool(
    'nodus_teaching_get_gradebook',
    {
      title: 'Get computed gradebook',
      description:
        'Applies an assessment plan to a group and returns the COMPUTED gradebook, fully anonymised: one row per student pseudonym code with the per-item marks, the final grade (the numeric/qualitative projection the engine derives — never stored), and whether the student passed or is not-presented; plus a cohort distribution (evaluated count, pass rate, mean/median/min/max, counts per qualitative band). Grades are read-only. Optional convocatoria ("ordinaria" by default) and track ("continua"/"no_continua"). Read-only.',
      inputSchema: {
        planId: z.string().trim().min(1),
        groupId: z.string().trim().min(1),
        convocatoria: z.string().trim().min(1).default('ordinaria'),
        track: z.enum(['continua', 'no_continua']).default('continua'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ planId, groupId, convocatoria, track }) =>
      tool(() => {
        let plan, items, group;
        try {
          ({ plan, items } = teachingGrades.getAssessmentPlan(planId));
        } catch {
          throw notFound('assessment plan', planId);
        }
        try {
          group = teachingGroups.getTeachingGroup(groupId);
        } catch {
          throw notFound('teaching group', groupId);
        }
        const students: GridStudent[] = (group.students ?? []).map((student) => ({
          id: student.id,
          givenNames: student.givenNames,
          surnames: student.surnames,
          pseudonymCode: student.pseudonymCode,
          position: student.position,
        }));
        const filledById = new Map((group.students ?? []).map((student) => [student.id, isStudentFilled(student)]));
        const grid = gradebookToGrid({
          plan,
          items,
          entries: teachingGrades.listGradeEntries(planId, convocatoria),
          students,
          cohort: teachingGrades.cohortStats(planId, groupId, convocatoria),
          track,
          previous: teachingGrades.ratchetBaseline(planId, groupId, convocatoria),
          convocatoria,
          // MCP always anonymises regardless of the app's pseudonym setting: the code
          // column is the identifier a model is allowed to see.
          showCodes: true,
        });
        // Drop the identifying columns by construction, then relabel each row by its code.
        const anon = anonymousGrid(grid);
        const markColumns = anon.columns
          .filter((column) => column.id !== GRID_COL.code)
          .map((column) => ({ id: column.id, name: column.name }));
        const rows = anon.rows.map((row) => {
          const result = grid.results[row.id];
          const cells: Record<string, string | null> = {};
          for (const column of markColumns) cells[column.id] = row.cells[column.id] ?? null;
          return {
            code: row.cells[GRID_COL.code] ?? null,
            filled: filledById.get(row.id) ?? false,
            cells,
            final: {
              raw: result?.raw ?? null,
              numeric: result?.record.numeric ?? null,
              qualitative: result?.record.qualitative ?? null,
              passed: result?.passed ?? false,
              notPresented: result?.record.notPresented ?? false,
            },
          };
        });
        const numeric = rows
          .filter((row) => row.filled && !row.final.notPresented && row.final.numeric != null)
          .map((row) => row.final.numeric as number);
        const sorted = [...numeric].sort((a, b) => a - b);
        const sum = sorted.reduce((total, value) => total + value, 0);
        const byQualitative: Record<string, number> = {};
        for (const row of rows) {
          if (!row.filled) continue;
          const band = row.final.qualitative;
          if (band) byQualitative[band] = (byQualitative[band] ?? 0) + 1;
        }
        const distribution = {
          enrolled: rows.filter((row) => row.filled).length,
          evaluated: sorted.length,
          passed: rows.filter((row) => row.filled && row.final.passed).length,
          notPresented: rows.filter((row) => row.filled && row.final.notPresented).length,
          passRate: sorted.length ? rows.filter((row) => row.filled && row.final.passed).length / rows.filter((row) => row.filled).length : null,
          mean: sorted.length ? sum / sorted.length : null,
          median: sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null,
          min: sorted.length ? sorted[0] : null,
          max: sorted.length ? sorted[sorted.length - 1] : null,
          byQualitative,
        };
        return {
          plan: { id: plan.id, name: plan.name, profile: plan.profile },
          convocatoria,
          track,
          markColumns,
          students: rows,
          distribution,
        };
      })()
  );

  server.registerTool(
    'nodus_teaching_list_exams',
    {
      title: 'List exams',
      description:
        'Lists the exam papers of a docencia vault (title, language, subject/course and question count). Optional subjectId filter and includeArchived. Image data is never returned. Use nodus_teaching_get_exam for the questions. Read-only.',
      inputSchema: {
        subjectId: z.string().trim().min(1).optional(),
        includeArchived: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ subjectId, includeArchived }) =>
      tool(() =>
        teachingExams.listTeachingExams({ subjectId, includeArchived }).map((exam) => ({
          id: exam.id,
          shortId: exam.shortId,
          title: exam.title,
          subjectId: exam.subjectId,
          courseId: exam.courseId,
          language: exam.language,
          targetQuestionCount: exam.targetQuestionCount,
        }))
      )()
  );

  server.registerTool(
    'nodus_teaching_get_exam',
    {
      title: 'Get exam',
      description:
        'Gets one exam with its header configuration and questions (prompt, type, points, options/pairs/items and the model solution when set). Inline image data is replaced by a hasImage flag and its caption; logos are reported as a count. Read-only.',
      inputSchema: { examId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ examId }) =>
      tool(() => {
        let detail;
        try {
          detail = teachingExams.getTeachingExam(examId);
        } catch {
          throw notFound('exam', examId);
        }
        const { logos, questions, ...exam } = detail;
        return {
          ...exam,
          logoCount: logos.length,
          questions: questions.map(({ imageDataUrl, ...question }) => ({
            ...question,
            hasImage: imageDataUrl != null,
          })),
        };
      })()
  );

  server.registerTool(
    'nodus_teaching_list_rubrics',
    {
      title: 'List rubrics',
      description:
        'Lists the analytic rubrics of a docencia vault. Optional subjectId and search (matches title). Use nodus_teaching_get_rubric for the criteria, levels and cell descriptors. Read-only.',
      inputSchema: {
        subjectId: z.string().trim().min(1).optional(),
        query: querySchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ subjectId, query }) =>
      tool(() =>
        teachingRubrics.listTeachingRubrics({ subjectId, search: query }).map((rubric) => ({
          id: rubric.id,
          shortId: rubric.shortId,
          title: rubric.title,
          subjectId: rubric.subjectId,
          criteria: rubric.criteria.length,
          levels: rubric.levels.length,
        }))
      )()
  );

  server.registerTool(
    'nodus_teaching_get_rubric',
    {
      title: 'Get rubric',
      description:
        'Gets one analytic rubric: its performance levels, its criteria (with weights) and the descriptor text in every criterion×level cell. Read-only.',
      inputSchema: { rubricId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ rubricId }) =>
      tool(() => {
        try {
          return teachingRubrics.getTeachingRubric(rubricId);
        } catch {
          throw notFound('rubric', rubricId);
        }
      })()
  );

  // ── Databases mode (additive writes) ───────────────────────────────────────
  // The write policy is deliberate and transversal: the derived graph and personal
  // data (grades, confirmed kinship) stay read-only through MCP; only user-authored
  // structured data can be written. For databases that means adding a row and editing
  // its cells — additive/edit only. Deletes and schema changes (dropping rows,
  // columns or whole tables) are intentionally not exposed here.
  server.registerTool(
    'nodus_create_database_row',
    {
      title: 'Create a database row',
      description:
        'Appends a new, empty row to a database and returns its id and position. Fill it with nodus_set_database_cell. User-authored data only; available in databases vaults. Not read-only.',
      inputSchema: { databaseId: z.string().trim().min(1) },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ databaseId }) =>
      tool(() => {
        if (!dbMode.getDatabase(databaseId)) throw notFound('database', databaseId);
        assertMcpAcl('database', databaseId, 'edit_content');
        const row = dbMode.createRow(databaseId);
        return { databaseId, row: { id: row.id, position: row.position } };
      })()
  );

  server.registerTool(
    'nodus_set_database_cell',
    {
      title: 'Set a database cell',
      description:
        'Sets one cell of a database row and returns the updated row. Accepts a typed value: a string for text/title/date/time/url, a number for number, a boolean for checkbox, an option LABEL (or id) for select, and an array of labels/ids for multi_select. Pass null to clear. Computed and binary columns (formula, rollup, relation, attachment, ai, ai_image) cannot be set here. User-authored data only; available in databases vaults. Not read-only.',
      inputSchema: {
        rowId: z.string().trim().min(1),
        columnId: z.string().trim().min(1),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ rowId, columnId, value }) =>
      tool(() => {
        const row = dbMode.getRow(rowId);
        if (!row) throw notFound('database row', rowId);
        assertMcpAcl('row', rowId, 'edit_content');
        const column = dbMode.getColumn(columnId);
        if (!column || column.databaseId !== row.databaseId) throw notFound('database column', columnId);
        const raw = encodeCellForWrite(column, value);
        const updated = dbMode.setCell(rowId, columnId, raw);
        if (!updated) throw notFound('database row', rowId);
        return { row: dbRowRecord(dbMode.getColumns(row.databaseId), updated) };
      })()
  );

  // ── Worldbuilding ──────────────────────────────────────────────────────────
  // Worldbuilding is canonical author-owned data rather than a derived research graph.
  // MCP may therefore create and edit it, just as it can edit notes/database rows, but
  // it intentionally cannot delete anything. Destructive editing remains in the app,
  // where the user can see the affected cast, links, manuscript and continuity checks.

  server.registerTool(
    'nodus_world_get_overview',
    {
      title: 'Get worldbuilding overview',
      description:
        'Returns the size, calendar, manuscript progress and continuity coverage of the active Worldbuilding vault. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({
      counts: {
        ...characterCounts(),
        places: listWorldPlaces().length,
        groups: listWorldGroups().length,
        scenes: listScenes().length,
        secrets: listSecrets().length,
        entries: listWorldEntries().length,
        threads: listWorldThreads().length,
        rules: listWorldRules().length,
        questions: listWorldQuestions().length,
        maps: listWorldMaps().length,
        events: listWorldEvents().length,
      },
      calendar: getWorldCalendar(),
      manuscript: manuscriptProgress(),
      continuity: continuitySummary(),
    }))
  );

  server.registerTool(
    'nodus_world_search',
    {
      title: 'Search the fictional world',
      description:
        'Searches encyclopedia entries and their prose, character sheets, secrets, open questions and manuscript scenes in the active Worldbuilding vault. Results identify the owning entity and field. Read-only.',
      inputSchema: {
        query: z.string().trim().min(1).max(8_000),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) =>
      tool(() => {
        const q = query.trim();
        const results: { kind: string; id: string; title: string; field: string; excerpt: string }[] = [];
        const add = (kind: string, id: string, title: string, field: string, text: string | null | undefined) => {
          if (results.length >= limit || !matchesText(q, [text])) return;
          results.push({ kind, id, title, field, excerpt: snippet(text, 600) });
        };
        for (const hit of searchWorldBodies(q, limit)) {
          results.push({ kind: hit.kind, id: hit.id, title: hit.title, field: hit.field, excerpt: hit.snippet });
          if (results.length >= limit) break;
        }
        for (const character of listCharacters()) {
          add('character', character.personId, character.displayName, 'sheet', [
            character.displayName,
            character.profile.appearance, character.profile.personality, character.profile.backstory,
            character.notes, character.biography,
          ].filter(Boolean).join('\n'));
        }
        for (const secret of listSecrets()) add('secret', secret.secretId, secret.title, 'content', `${secret.content ?? ''}\n${secret.notes ?? ''}`);
        for (const question of listWorldQuestions()) add('question', question.questionId, question.question, 'question', question.question);
        for (const scene of listScenes()) {
          add('scene', scene.sceneId, scene.title, 'manuscript', getSceneText(scene.sceneId).text);
        }
        return { query: q, results: results.slice(0, limit), truncated: results.length >= limit };
      })()
  );

  server.registerTool(
    'nodus_world_list_characters',
    {
      title: 'List worldbuilding characters',
      description: 'Lists characters with their narrative role, life status, species, factions and cultures. Read-only and paginated.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        role: z.enum(WORLD_CHARACTER_ROLES).optional(),
        status: z.enum(WORLD_CHARACTER_STATUSES).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, role, status }) =>
      tool(() => {
        const characters = listCharacters({ search: query || undefined, role, status }).map((character) => ({
          personId: character.personId,
          displayName: character.displayName,
          species: character.profile.species,
          gender: character.profile.gender,
          pronouns: character.profile.pronouns,
          lifeStatus: character.profile.lifeStatus,
          narrativeRole: character.profile.narrativeRole,
          factions: character.factions ?? [],
          cultures: character.cultures ?? [],
          updatedAt: character.updatedAt,
        }));
        return page('characters', characters, limit, offset);
      })()
  );

  server.registerTool(
    'nodus_world_get_character',
    {
      title: 'Get worldbuilding character',
      description:
        'Returns the complete character sheet plus abilities, affiliations, appearances, life events and secrets. Read-only.',
      inputSchema: { personId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ personId }) =>
      tool(() => {
        const character = getCharacter(personId);
        if (!character) throw notFound('world character', personId);
        return {
          character,
          abilities: listCharacterAbilities(personId),
          affiliations: listAffiliationsForCharacter(personId),
          appearances: appearancesOfCharacter(personId),
          events: listCharacterEvents(personId),
          secrets: secretsForCharacter(personId),
        };
      })()
  );

  server.registerTool(
    'nodus_world_create_character',
    {
      title: 'Create worldbuilding character',
      description: 'Creates an author-owned character sheet. This modifies the active Worldbuilding vault; it never generates or accepts AI biography text.',
      inputSchema: {
        ...worldCharacterPatchSchema,
        displayName: z.string().trim().min(1).max(500),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ character: createCharacter(input) }))()
  );

  server.registerTool(
    'nodus_world_update_character',
    {
      title: 'Update worldbuilding character',
      description: 'Edits fields on an existing author-owned character sheet. Omitted fields are preserved. This modifies the vault and never deletes a character.',
      inputSchema: { personId: z.string().trim().min(1), ...worldCharacterPatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ personId, ...patch }) =>
      tool(() => {
        const character = updateCharacter(personId, patch);
        if (!character) throw notFound('world character', personId);
        return { character };
      })()
  );

  server.registerTool(
    'nodus_world_list_places',
    {
      title: 'List worldbuilding places',
      description: 'Lists places with hierarchy and fiction-specific profile fields. Read-only and paginated.',
      inputSchema: { ...paginationSchema, query: querySchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query }) =>
      tool(() => page(
        'places',
        listWorldPlaces().filter((place) => matchesText(query, [
          place.name, place.kind, place.notes, place.profile.appearance, place.profile.atmosphere, place.profile.history,
        ])),
        limit,
        offset,
      ))()
  );

  server.registerTool(
    'nodus_world_get_place',
    {
      title: 'Get worldbuilding place',
      description: 'Returns a place sheet with inhabitants and every map where it appears. Read-only.',
      inputSchema: { placeId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ placeId }) =>
      tool(() => {
        const place = getWorldPlace(placeId);
        if (!place) throw notFound('world place', placeId);
        return { place, inhabitants: inhabitantsOfPlace(placeId), maps: placeMapAppearances(placeId) };
      })()
  );

  server.registerTool(
    'nodus_world_create_place',
    {
      title: 'Create worldbuilding place',
      description: 'Creates an author-owned place. This modifies the active Worldbuilding vault.',
      inputSchema: { ...worldPlacePatchSchema, name: z.string().trim().min(1).max(500) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ place: createWorldPlace(input) }))()
  );

  server.registerTool(
    'nodus_world_update_place',
    {
      title: 'Update worldbuilding place',
      description: 'Edits an existing place. Parent cycles are refused by the same repository rules as the app. This never deletes a place.',
      inputSchema: { placeId: z.string().trim().min(1), ...worldPlacePatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ placeId, ...patch }) =>
      tool(() => {
        const place = updateWorldPlace(placeId, patch);
        if (!place) throw notFound('world place', placeId);
        return { place };
      })()
  );

  server.registerTool(
    'nodus_world_list_groups',
    {
      title: 'List worldbuilding groups',
      description: 'Lists factions, cultures, religions, houses, orders, species and languages. Read-only and paginated.',
      inputSchema: { ...paginationSchema, kind: z.enum(WORLD_GROUP_KINDS).optional(), query: querySchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, kind, query }) =>
      tool(() => page(
        'groups',
        listWorldGroups(kind).filter((group) => matchesText(query, [group.name, group.summary, group.description, group.notes])),
        limit,
        offset,
      ))()
  );

  server.registerTool(
    'nodus_world_get_group',
    {
      title: 'Get worldbuilding group',
      description: 'Returns a group sheet and its character memberships. Read-only.',
      inputSchema: { groupId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ groupId }) =>
      tool(() => {
        const group = getWorldGroup(groupId);
        if (!group) throw notFound('world group', groupId);
        return { group, affiliations: listAffiliationsForGroup(groupId) };
      })()
  );

  server.registerTool(
    'nodus_world_create_group',
    {
      title: 'Create worldbuilding group',
      description: 'Creates an author-owned faction, culture, religion, house, order, species or language.',
      inputSchema: { ...worldGroupPatchSchema, name: z.string().trim().min(1).max(500) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ group: createWorldGroup(input) }))()
  );

  server.registerTool(
    'nodus_world_update_group',
    {
      title: 'Update worldbuilding group',
      description: 'Edits an existing group without deleting memberships or related entities.',
      inputSchema: { groupId: z.string().trim().min(1), ...worldGroupPatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ groupId, ...patch }) =>
      tool(() => {
        const group = updateWorldGroup(groupId, patch);
        if (!group) throw notFound('world group', groupId);
        return { group };
      })()
  );

  server.registerTool(
    'nodus_world_list_scenes',
    {
      title: 'List worldbuilding scenes',
      description: 'Lists scenes in narrative or chronological order, optionally narrowed by title, summary, place or notes. Read-only.',
      inputSchema: {
        ...paginationSchema,
        order: z.enum(['narrative', 'chronological']).default('narrative'),
        query: querySchema,
        status: z.enum(WORLD_SCENE_STATUSES).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, order, query, status }) =>
      tool(() => page(
        'scenes',
        listScenes(order)
          .filter((scene) => !status || scene.status === status)
          .filter((scene) => matchesText(query, [scene.title, scene.summary, scene.placeName, scene.notes])),
        limit,
        offset,
      ))()
  );

  server.registerTool(
    'nodus_world_get_scene',
    {
      title: 'Get worldbuilding scene',
      description: 'Returns a scene with cast, manuscript text, story beats and questions anchored to it. Read-only.',
      inputSchema: { sceneId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ sceneId }) =>
      tool(() => {
        const scene = listScenes().find((item) => item.sceneId === sceneId);
        if (!scene) throw notFound('world scene', sceneId);
        return {
          scene,
          cast: listSceneCharacters(sceneId),
          manuscript: getSceneText(sceneId),
          beats: listWorldBeats().filter((beat) => beat.sceneId === sceneId),
          questions: listWorldQuestions().filter((question) => question.anchorKind === 'scene' && question.anchorId === sceneId),
        };
      })()
  );

  server.registerTool(
    'nodus_world_create_scene',
    {
      title: 'Create worldbuilding scene',
      description: 'Creates an author-owned story scene at the end of the narrative unless narrativeOrder is supplied.',
      inputSchema: { ...worldScenePatchSchema, title: z.string().trim().min(1).max(1_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ scene: createScene(input) }))()
  );

  server.registerTool(
    'nodus_world_update_scene',
    {
      title: 'Update worldbuilding scene',
      description: 'Edits scene metadata without deleting cast, beats or manuscript prose.',
      inputSchema: { sceneId: z.string().trim().min(1), ...worldScenePatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ sceneId, ...patch }) =>
      tool(() => {
        const scene = updateScene(sceneId, patch);
        if (!scene) throw notFound('world scene', sceneId);
        return { scene };
      })()
  );

  server.registerTool(
    'nodus_world_list_secrets',
    {
      title: 'List worldbuilding secrets',
      description: 'Lists secrets and their status. Optional ownerPersonId narrows to secrets owned or known by that character. Read-only.',
      inputSchema: { ownerPersonId: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ownerPersonId }) =>
      tool(() => ({ secrets: ownerPersonId ? secretsForCharacter(ownerPersonId) : listSecrets() }))()
  );

  server.registerTool(
    'nodus_world_get_secret',
    {
      title: 'Get worldbuilding secret',
      description: 'Returns a secret and the characters who know it, with acquisition timing. Read-only.',
      inputSchema: { secretId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ secretId }) =>
      tool(() => {
        const secret = listSecrets().find((item) => item.secretId === secretId);
        if (!secret) throw notFound('world secret', secretId);
        return { secret, knowers: listKnowers(secretId) };
      })()
  );

  server.registerTool(
    'nodus_world_create_secret',
    {
      title: 'Create worldbuilding secret',
      description: 'Creates a secret in the active Worldbuilding vault.',
      inputSchema: {
        title: z.string().trim().min(1).max(1_000),
        content: nullableWorldText(),
        ownerPersonId: nullableWorldId,
        status: z.enum(['kept', 'revealed']).optional(),
        revealedWorldDay: nullableWorldInt,
        notes: nullableWorldText(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ secret: createSecret(input) }))()
  );

  server.registerTool(
    'nodus_world_update_secret',
    {
      title: 'Update worldbuilding secret',
      description: 'Edits a secret without deleting it or its knower history.',
      inputSchema: {
        secretId: z.string().trim().min(1),
        title: z.string().trim().min(1).max(1_000).optional(),
        content: nullableWorldText(),
        ownerPersonId: nullableWorldId,
        status: z.enum(['kept', 'revealed']).optional(),
        revealedWorldDay: nullableWorldInt,
        notes: nullableWorldText(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ secretId, ...patch }) =>
      tool(() => {
        const secret = updateSecret(secretId, patch);
        if (!secret) throw notFound('world secret', secretId);
        return { secret };
      })()
  );

  server.registerTool(
    'nodus_world_list_entries',
    {
      title: 'List world encyclopedia entries',
      description: 'Lists the unified encyclopedia index across articles, characters, places, groups, scenes, maps, conflicts and rules. Read-only.',
      inputSchema: {
        ...paginationSchema,
        query: querySchema,
        kind: z.enum(WORLD_ENTRY_KINDS).optional(),
        includeSpoilers: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, offset, query, kind, includeSpoilers }) =>
      tool(() => page(
        'entries',
        listWorldEntries()
          .filter((entry) => !kind || entry.kind === kind)
          .filter((entry) => includeSpoilers || !entry.spoiler)
          .filter((entry) => matchesText(query, [entry.title, entry.summary, ...entry.aliases])),
        limit,
        offset,
      ))()
  );

  server.registerTool(
    'nodus_world_get_entry',
    {
      title: 'Get world encyclopedia entry',
      description: 'Returns an encyclopedia entry with composed body, facts, outgoing links, backlinks and ontology relations. Read-only.',
      inputSchema: { kind: z.enum(WORLD_ENTRY_KINDS), id: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ kind, id }) =>
      tool(() => {
        const entry = getWorldEntry({ kind, id });
        if (!entry) throw notFound('world entry', `${kind}:${id}`);
        return { ...entry, backlinks: worldBacklinks({ kind, id }) };
      })()
  );

  server.registerTool(
    'nodus_world_list_unresolved_links',
    {
      title: 'List unresolved world links',
      description: 'Lists [[wiki links]] in world prose that do not yet resolve to an encyclopedia entry. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ links: worldUnresolvedLinks() }))
  );

  server.registerTool(
    'nodus_world_create_article',
    {
      title: 'Create world encyclopedia article',
      description: 'Creates a canonical author-owned encyclopedia article. AI proposals are not auto-accepted by this tool.',
      inputSchema: { ...worldArticlePatchSchema, title: z.string().trim().min(1).max(1_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ article: createWorldArticle(input) }))()
  );

  server.registerTool(
    'nodus_world_update_article',
    {
      title: 'Update world encyclopedia article',
      description: 'Edits a canonical encyclopedia article and reindexes its links. This never deletes an article.',
      inputSchema: { articleId: z.string().trim().min(1), ...worldArticlePatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ articleId, ...patch }) =>
      tool(() => {
        if (!getWorldArticle(articleId)) throw notFound('world article', articleId);
        return { article: updateWorldArticle(articleId, patch) };
      })()
  );

  server.registerTool(
    'nodus_world_list_threads',
    {
      title: 'List world conflicts and arcs',
      description: 'Lists conflicts and character arcs with parties and status. Read-only.',
      inputSchema: { kind: z.enum(WORLD_THREAD_KINDS).optional(), status: z.enum(WORLD_THREAD_STATUSES).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ kind, status }) =>
      tool(() => ({ threads: listWorldThreads(kind).filter((thread) => !status || thread.status === status) }))()
  );

  server.registerTool(
    'nodus_world_get_thread',
    {
      title: 'Get world conflict or arc',
      description: 'Returns a conflict/arc and its scene beats. Read-only.',
      inputSchema: { threadId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ threadId }) =>
      tool(() => {
        const thread = getWorldThread(threadId);
        if (!thread) throw notFound('world thread', threadId);
        return { thread, beats: listWorldBeats().filter((beat) => beat.threadId === threadId) };
      })()
  );

  server.registerTool(
    'nodus_world_get_story_board',
    {
      title: 'Get world story board',
      description: 'Returns the cross-scene conflict/arc board used by the Worldbuilding analysis workspace. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => threadBoardData())
  );

  server.registerTool(
    'nodus_world_create_thread',
    {
      title: 'Create world conflict or arc',
      description: 'Creates an author-owned conflict or arc. Parties and beats remain reviewable in Nodus.',
      inputSchema: {
        ...worldThreadPatchSchema,
        kind: z.enum(WORLD_THREAD_KINDS),
        title: z.string().trim().min(1).max(1_000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ thread: createWorldThread(input) }))()
  );

  server.registerTool(
    'nodus_world_update_thread',
    {
      title: 'Update world conflict or arc',
      description: 'Edits a conflict or arc without deleting its parties or beats.',
      inputSchema: { threadId: z.string().trim().min(1), ...worldThreadPatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ threadId, ...patch }) =>
      tool(() => {
        const thread = updateWorldThread(threadId, patch);
        if (!thread) throw notFound('world thread', threadId);
        return { thread };
      })()
  );

  server.registerTool(
    'nodus_world_list_rules',
    {
      title: 'List world rules',
      description: 'Lists canon, tentative or retired physical, costly and social rules. Read-only.',
      inputSchema: { status: z.enum(WORLD_RULE_STATUSES).optional(), hardness: z.enum(WORLD_RULE_HARDNESS).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ status, hardness }) =>
      tool(() => ({ rules: listWorldRules().filter((rule) => (!status || rule.status === status) && (!hardness || rule.hardness === hardness)) }))()
  );

  server.registerTool(
    'nodus_world_get_rule',
    {
      title: 'Get world rule',
      description: 'Returns a world rule and every scene beat that tests it. Read-only.',
      inputSchema: { ruleId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ ruleId }) =>
      tool(() => {
        const rule = getWorldRule(ruleId);
        if (!rule) throw notFound('world rule', ruleId);
        return { rule, beats: listWorldBeats().filter((beat) => beat.threadKind === 'rule' && beat.threadId === ruleId) };
      })()
  );

  server.registerTool(
    'nodus_world_create_rule',
    {
      title: 'Create world rule',
      description: 'Creates a canonical author-owned world rule. It does not accept quarantined AI proposal text.',
      inputSchema: { ...worldRulePatchSchema, title: z.string().trim().min(1).max(1_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ rule: createWorldRule(input) }))()
  );

  server.registerTool(
    'nodus_world_update_rule',
    {
      title: 'Update world rule',
      description: 'Edits a canonical rule without deleting its scene tests.',
      inputSchema: { ruleId: z.string().trim().min(1), ...worldRulePatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ ruleId, ...patch }) =>
      tool(() => {
        const rule = updateWorldRule(ruleId, patch);
        if (!rule) throw notFound('world rule', ruleId);
        return { rule };
      })()
  );

  server.registerTool(
    'nodus_world_list_questions',
    {
      title: 'List worldbuilding open questions',
      description: 'Lists stored world questions, or the ranked feed that also includes derived holes and blockers. Read-only.',
      inputSchema: {
        feed: z.boolean().default(true),
        includeSettled: z.boolean().default(false),
        status: z.enum(WORLD_QUESTION_STATUSES).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ feed, includeSettled, status }) =>
      tool(() => {
        const questions = feed ? questionFeed(includeSettled) : listWorldQuestions();
        return { questions: status ? questions.filter((question) => question.status === status) : questions };
      })()
  );

  server.registerTool(
    'nodus_world_get_question',
    {
      title: 'Get worldbuilding question',
      description: 'Returns one stored question with its competing options and chosen state. Read-only.',
      inputSchema: { questionId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ questionId }) =>
      tool(() => {
        const question = getWorldQuestion(questionId);
        if (!question) throw notFound('world question', questionId);
        return { question };
      })()
  );

  server.registerTool(
    'nodus_world_create_question',
    {
      title: 'Create worldbuilding question',
      description: 'Creates an explicit author question. It does not choose or apply an answer.',
      inputSchema: { ...worldQuestionPatchSchema, question: z.string().trim().min(1).max(8_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => tool(() => ({ question: createWorldQuestion(input) }))()
  );

  server.registerTool(
    'nodus_world_update_question',
    {
      title: 'Update worldbuilding question',
      description: 'Edits or parks a question without applying an answer to canonical prose.',
      inputSchema: { questionId: z.string().trim().min(1), ...worldQuestionPatchSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ questionId, ...patch }) =>
      tool(() => {
        const question = updateWorldQuestion(questionId, patch);
        if (!question) throw notFound('world question', questionId);
        return { question };
      })()
  );

  server.registerTool(
    'nodus_world_list_maps',
    {
      title: 'List world maps',
      description: 'Lists map canvases, hierarchy, calibration and temporal coverage; binary map images are never returned through MCP. Read-only.',
      inputSchema: { kind: z.enum(WORLD_MAP_KINDS).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ kind }) => tool(() => ({ maps: listWorldMaps().filter((map) => !kind || map.kind === kind) }))()
  );

  server.registerTool(
    'nodus_world_get_map',
    {
      title: 'Get world map',
      description: 'Returns a map and its ancestry. Image binaries and local paths are not exposed. Read-only.',
      inputSchema: { mapId: z.string().trim().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ mapId }) =>
      tool(() => {
        const map = getWorldMap(mapId);
        if (!map) throw notFound('world map', mapId);
        return { map, ancestry: mapAncestry(mapId) };
      })()
  );

  server.registerTool(
    'nodus_world_get_manuscript',
    {
      title: 'Get world manuscript',
      description:
        'Returns the manuscript spine, chapter/book structure and progress. Pass includeText=true for full scene prose; otherwise each scene only carries a snippet. Read-only.',
      inputSchema: { includeText: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ includeText }) =>
      tool(() => {
        const spine = manuscriptSpine();
        const scenes = spine.chapters.flatMap((chapter) => chapter.scenes).map((scene) => {
          const manuscript = getSceneText(scene.sceneId);
          return includeText
            ? { ...scene, text: manuscript.text, updatedAt: manuscript.updatedAt }
            : { ...scene, textSnippet: snippet(manuscript.text, 600), updatedAt: manuscript.updatedAt };
        });
        return {
          ...spine,
          scenes,
          progress: manuscriptProgress(),
        };
      })()
  );

  server.registerTool(
    'nodus_world_update_scene_text',
    {
      title: 'Update world manuscript scene',
      description:
        'Replaces the manuscript prose of one existing scene and updates its word count. This is a canonical authoring write; pass null to clear the prose. It does not delete the scene.',
      inputSchema: { sceneId: z.string().trim().min(1), text: z.string().max(2_000_000).nullable() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ sceneId, text }) =>
      tool(() => {
        if (!listScenes().some((scene) => scene.sceneId === sceneId)) throw notFound('world scene', sceneId);
        return { manuscript: saveSceneText(sceneId, text) };
      })()
  );

  server.registerTool(
    'nodus_world_get_continuity',
    {
      title: 'Run world continuity checks',
      description:
        'Runs the same deterministic continuity checks as the app (time, travel, affiliations, secrets, containment and character coherence), respecting the user’s muted notices. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ findings: runContinuity(), muted: listNoticeMutes(), summary: continuitySummary() }))
  );

  server.registerTool(
    'nodus_world_get_calendar',
    {
      title: 'Get world calendar and events',
      description: 'Returns the invented calendar plus all dated events in world order. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(() => ({ calendar: getWorldCalendar(), events: listWorldEvents() }))
  );

  server.registerTool('nodus_prosop_get_design',{title:'Get prosopography study design',description:'Returns the versioned population, criteria, questionnaire and vocabularies. Read-only.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},tool(()=>getProsopPopulationWorkspace()));
  server.registerTool('nodus_prosop_list_population',{title:'List prosopography population',description:'Lists non-restricted people and auditable membership decisions. Read-only.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},tool(()=>{const identity=getProsopIdentityWorkspace();const persons=identity.persons.filter((item)=>item.privacyStatus!=='restricted');const ids=new Set(persons.map((item)=>item.personId));const membership=getProsopMembershipWorkspace();return{persons,memberships:membership.memberships.filter((item)=>ids.has(item.personId))};}));
  server.registerTool('nodus_prosop_search',{title:'Search prosopography evidence',description:'Searches names, people, statements and sources while preserving deep links.',inputSchema:{query:z.string().trim().min(1)},annotations:{readOnlyHint:true,openWorldHint:false}},({query})=>tool(()=>({hits:searchProsopography(query)}))());
  server.registerTool('nodus_prosop_get_person',{title:'Get documented person dossier',description:'Returns a non-restricted person with attestations and evidence counts; it never generates a biography.',inputSchema:{personId:z.string().trim().min(1)},annotations:{readOnlyHint:true,openWorldHint:false}},({personId})=>tool(()=>{const person=getProsopIdentityWorkspace().persons.find((item)=>item.personId===personId&&item.privacyStatus!=='restricted');if(!person)throw notFound('prosopography person',personId);return{person};})());
  server.registerTool('nodus_prosop_list_statements',{title:'List documented statements',description:'Lists non-restricted factoids and atomic statements with source and locator.',inputSchema:{personId:z.string().trim().optional()},annotations:{readOnlyHint:true,openWorldHint:false}},({personId})=>tool(()=>{const restrictedPeople=new Set(getProsopIdentityWorkspace().persons.filter((item)=>item.privacyStatus==='restricted').map((item)=>item.personId));const factoids=getProsopObservationsWorkspace().factoids.map((factoid)=>({...factoid,statements:factoid.statements.filter((statement)=>!statement.entities.some((entity)=>entity.entityKind==='person'&&restrictedPeople.has(entity.entityId)))})).filter((factoid)=>factoid.statements.length>0);return{factoids:personId?factoids.filter((factoid)=>factoid.statements.some((statement)=>statement.entities.some((entity)=>entity.entityKind==='person'&&entity.entityId===personId))):factoids};})());
  server.registerTool('nodus_prosop_get_coverage',{title:'Describe prosopography coverage',description:'Returns denominators, membership states, reviewed statements and explicit missing values.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},tool(()=>getProsopMembershipWorkspace().coverage));
  server.registerTool('nodus_prosop_run_analysis',{title:'Run a validated prosopography analysis',description:'Runs and stores a reproducible projection. It does not alter canonical statements.',inputSchema:{title:z.string().trim().min(1),kind:z.enum(['frequency','timeline','trajectory','map']),variableIds:z.array(z.string().trim().min(1)).min(1)},annotations:{readOnlyHint:false,openWorldHint:false}},({title,kind,variableIds})=>tool(()=>runProsopAnalysis({title,analysisKind:kind,variableIds,createdBy:'mcp'}))());
  server.registerTool('nodus_prosop_create_proposal',{title:'Create a reviewable prosopography proposal',description:'Creates a proposal only. It cannot merge identities, decide membership or write reviewed facts.',inputSchema:{proposalKind:z.string().trim().min(1),targetKind:z.string().trim().min(1),targetId:z.string().trim().optional(),payload:z.record(z.string(),z.unknown()),rationale:z.string().trim().min(1)},annotations:{readOnlyHint:false,openWorldHint:false}},({proposalKind,targetKind,targetId,payload,rationale})=>tool(()=>createProsopProposal({proposalKind,targetKind,targetId,payload:payload as never,rationale,producerKind:'ai',producerId:'mcp'}))());
}

/** Encodes an MCP-supplied typed value into the text cell a column stores, resolving
 *  select/multi_select labels to option ids and rejecting computed/binary columns. */
function encodeCellForWrite(column: DatabaseColumn, value: string | number | boolean | string[] | null): string | null {
  const writable = new Set(['title', 'text', 'number', 'date', 'time', 'select', 'multi_select', 'checkbox']);
  if (!writable.has(column.type)) {
    throw new McpToolError(
      'invalid_input',
      `Column "${column.name}" is of type ${column.type}, which is computed or binary and cannot be set through MCP.`,
    );
  }
  if (value === null) return null;
  switch (column.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new McpToolError('invalid_input', `Column "${column.name}" needs a number.`);
      return encodeNumber(n);
    }
    case 'checkbox':
      return (typeof value === 'boolean' ? value : String(value) === 'true') ? '1' : '0';
    case 'select': {
      const id = resolveOptionId(column, String(value));
      return id;
    }
    case 'multi_select': {
      const list = Array.isArray(value) ? value : [String(value)];
      return encodeMultiSelect(list.map((entry) => resolveOptionId(column, entry)));
    }
    default:
      return normalizeCellValue(column.type, String(value));
  }
}

/** Maps an option label (case-insensitively) or a raw option id to the stored id. */
function resolveOptionId(column: DatabaseColumn, labelOrId: string): string {
  const options = dbMode.getOptions(column.id);
  const term = labelOrId.trim();
  const match = options.find((option) => option.id === term)
    ?? options.find((option) => option.label.toLowerCase() === term.toLowerCase());
  if (!match) {
    const available = options.map((option) => option.label).join(', ') || '(none defined)';
    throw new McpToolError('invalid_input', `"${term}" is not an option of "${column.name}". Options: ${available}.`);
  }
  return match.id;
}
