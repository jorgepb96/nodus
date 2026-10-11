import type {
  ArgumentMapRequest,
  DeepResearchRequest,
  ModelRef,
  ProjectKind,
  ProjectSectionStatus,
  ProjectStatus,
  WritingWorkshopBrief,
  WritingWorkshopKind,
  WritingWorkshopSelection,
} from '@shared/types';
import {PROMPT_LANGUAGES} from '@shared/types';
import { buildArgumentMap } from '../ai/argumentMap';
import { synthesizeAuthorDossier } from '../ai/authorDossier';
import { enqueueDeepResearchJob } from '../ai/deepResearchQueue';
import { ensureDeepResearchLane } from '../ai/deepResearchLane';
import { synthesizeMatrixCell } from '../ai/synthesisMatrix';
import { deleteIdea, getIdeaSummary } from '../db/ideasRepo';
import { createNote } from '../db/notesRepo';
import { runContinuity } from '../db/worldContinuityRepo';
import { reviewWorldProse } from '../ai/worldProseReview';
import { deleteWorldArticle } from '../db/worldEncyclopediaRepo';
import { deleteCharacter } from '../db/charactersRepo';
import { deleteWorldPlace } from '../db/worldPlacesRepo';
import { deleteWorldGroup } from '../db/worldGroupsRepo';
import { deleteScene } from '../db/worldStoryRepo';
import { deleteWorldThread } from '../db/worldThreadsRepo';
import { deleteWorldRule } from '../db/worldRulesRepo';
import { deleteWorldQuestion } from '../db/worldQuestionsRepo';
import { getPageDocument, restorePageRevision } from '../db/pagesRepo';
import { createDatabaseFromCsv } from '../db/databasesRepo';
import * as projects from '../db/projectsRepo';
import { generateWritingWorkshopDraft } from '../ai/writingWorkshop';
import { saveWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { getNodusServerTokenFor } from '../secrets/secretStore';
import { currentPublishedRevision, markVaultDirty } from './serverSyncService';
import { fetchWithTimeout, normalizeUrl, type VaultServerConfig } from './serverSyncShared';
import { executeRemoteToolkitAction } from './toolkitAction';

type ActionStatus = 'queued' | 'claimed' | 'running' | 'applied' | 'refused' | 'failed' | 'cancelled';

interface ClaimedAction {
  id: string;
  kind: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  inputRevision: string | null;
  inputFingerprint: string | null;
  status: ActionStatus;
}

interface ActionResult {
  result: unknown;
  changedVault: boolean;
}

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing_${key}`);
  return value.trim();
}

function optionalModel(payload: Record<string, unknown>): ModelRef | null {
  const value = payload.model;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.provider === 'string' && typeof candidate.model === 'string'
    ? { provider: candidate.provider as ModelRef['provider'], model: candidate.model }
    : null;
}

function optionalText(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

function stringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`bad_${key}`);
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))].slice(0, 500);
}

async function execute(action: ClaimedAction, runtime: { base: string; token: string }): Promise<ActionResult> {
  const payload = action.payload;
  switch (action.kind) {
    case 'idea.delete': {
      const id = text(payload, 'ideaId');
      return { result: { deleted: deleteIdea(id), ideaId: id }, changedVault: true };
    }
    case 'idea.saveToNotes': {
      const id = text(payload, 'ideaId');
      const idea = getIdeaSummary(id);
      if (!idea) throw new Error('idea_not_found');
      const note = createNote({
        title: idea.label,
        content: `# ${idea.label}\n\n${idea.statement}`,
        kind: 'idea',
        source: { origin: 'idea', ref: idea.global_id },
      });
      return { result: { noteId: note.id, ideaId: id }, changedVault: true };
    }
    case 'author.synthesis.generate': {
      const synthesis = await synthesizeAuthorDossier(text(payload, 'authorId'), optionalModel(payload));
      return { result: synthesis, changedVault: true };
    }
    case 'authors.matrix.generate': {
      const cell = await synthesizeMatrixCell(text(payload, 'authorId'), text(payload, 'themeId'), optionalModel(payload));
      return { result: cell, changedVault: true };
    }
    case 'argumentMap.generate': {
      const request = payload.request as ArgumentMapRequest | undefined;
      if (!request || typeof request !== 'object' || typeof request.seedIdeaId !== 'string') throw new Error('bad_argument_map_request');
      return { result: await buildArgumentMap(request, request.model), changedVault: false };
    }
    case 'deepResearch.generate': {
      const request = payload.request as DeepResearchRequest | undefined;
      if (!request || typeof request !== 'object' || typeof request.objective !== 'string' || !request.objective.trim()) {
        throw new Error('bad_deep_research_request');
      }
      ensureDeepResearchLane();
      const job = enqueueDeepResearchJob({ request, origin: 'mcp', save: true, title: typeof payload.title === 'string' ? payload.title : null });
      return { result: { job }, changedVault: false };
    }
    case 'deepResearch.saveToNotes': {
      const reportId = text(payload, 'reportId');
      const title = text(payload, 'title');
      const markdown = text(payload, 'markdown');
      const note = createNote({
        title,
        content: markdown,
        kind: 'writing',
        source: { origin: 'writing', ref: reportId, note: 'deep_research' },
      });
      return { result: { noteId: note.id, reportId }, changedVault: true };
    }
    case 'hypothesis.saveToNotes': {
      const hypothesisId = text(payload, 'hypothesisId');
      const title = text(payload, 'title');
      const markdown = text(payload, 'markdown');
      const note = createNote({
        title,
        content: markdown,
        kind: 'writing',
        source: { origin: 'writing', ref: hypothesisId, note: 'hypothesis' },
      });
      return { result: { noteId: note.id, hypothesisId }, changedVault: true };
    }
    case 'writing.generate': {
      const allowedKinds = new Set<WritingWorkshopKind>([
        'literature_review', 'theoretical_framework', 'debate', 'gap_justification', 'chapter_section', 'research_question',
      ]);
      const kind = text(payload, 'kind') as WritingWorkshopKind;
      if (!allowedKinds.has(kind)) throw new Error('bad_writing_kind');
      const toneValue = optionalText(payload, 'tone') ?? 'academic';
      if (!['academic', 'synthetic', 'critical', 'exploratory'].includes(toneValue)) throw new Error('bad_writing_tone');
      const language = optionalText(payload, 'language') ?? 'es';
      if (!(PROMPT_LANGUAGES as readonly string[]).includes(language)) throw new Error('bad_writing_language');
      const brief: WritingWorkshopBrief = {
        kind,
        objective: text(payload, 'objective'),
        tone: toneValue as WritingWorkshopBrief['tone'],
        language: language as WritingWorkshopBrief['language'],
      };
      const selection: WritingWorkshopSelection = {
        ideaIds: stringArray(payload, 'ideaIds'),
        themeIds: stringArray(payload, 'themeIds'),
        gapIds: stringArray(payload, 'gapIds'),
        contradictionIds: stringArray(payload, 'contradictionIds'),
        workIds: stringArray(payload, 'workIds'),
        passageIds: stringArray(payload, 'passageIds'),
        tutorRouteIds: stringArray(payload, 'tutorRouteIds'),
      };
      const draft = await generateWritingWorkshopDraft({ brief, selection, model: optionalModel(payload) });
      const saved = saveWritingWorkshopDraft({ draft, model: optionalModel(payload), title: optionalText(payload, 'title') });
      return { result: { draftId: saved.id, title: saved.title }, changedVault: true };
    }
    case 'projects.create': {
      const allowedKinds = new Set<ProjectKind>(['thesis', 'article', 'chapter', 'literature_review', 'theoretical_framework', 'other']);
      const kind = (optionalText(payload, 'kind') ?? 'other') as ProjectKind;
      if (!allowedKinds.has(kind)) throw new Error('bad_project_kind');
      const rawTarget = payload.targetWords;
      const targetWords = typeof rawTarget === 'number' && Number.isSafeInteger(rawTarget) && rawTarget > 0 && rawTarget <= 2_000_000
        ? rawTarget : undefined;
      const project = projects.createProject({
        title: text(payload, 'title'), kind, brief: optionalText(payload, 'brief'), targetWords,
      });
      return { result: { projectId: project.project.id, title: project.project.title }, changedVault: true };
    }
    case 'projects.update': {
      const allowedStatuses = new Set<ProjectStatus>(['active', 'paused', 'done']);
      const status = optionalText(payload, 'status') as ProjectStatus | undefined;
      if (status && !allowedStatuses.has(status)) throw new Error('bad_project_status');
      const updated = projects.updateProject({
        id: text(payload, 'id'),
        title: optionalText(payload, 'title'),
        brief: optionalText(payload, 'brief'),
        status,
        targetWords: typeof payload.targetWords === 'number' && Number.isSafeInteger(payload.targetWords) ? payload.targetWords : undefined,
      });
      if (!updated) throw new Error('project_not_found');
      return { result: { projectId: updated.id }, changedVault: true };
    }
    case 'projects.section.update': {
      const allowedStatuses = new Set<ProjectSectionStatus>(['empty', 'in_progress', 'review', 'ready', 'discarded']);
      const status = text(payload, 'status') as ProjectSectionStatus;
      if (!allowedStatuses.has(status)) throw new Error('bad_section_status');
      const section = projects.updateSection({ id: text(payload, 'id'), status });
      if (!section) throw new Error('project_section_not_found');
      return { result: { sectionId: section.id, status: section.status }, changedVault: true };
    }
    case 'projects.chapter.import': {
      const sourceFormat = optionalText(payload, 'sourceFormat') === 'markdown' ? 'markdown' : 'txt';
      const chapterText = text(payload, 'text');
      if (chapterText.length > 500_000) throw new Error('chapter_too_large');
      const chapter = projects.createChapter({
        projectId: text(payload, 'projectId'), title: text(payload, 'title'), sourceFormat, text: chapterText,
      });
      return { result: { chapterId: chapter.id, projectId: chapter.projectId }, changedVault: true };
    }
    case 'worldbuilding.continuity':
      return { result: { findings: runContinuity() }, changedVault: false };
    case 'worldbuilding.proseReview':
      return { result: await reviewWorldProse(text(payload, 'sceneId')), changedVault: false };
    case 'worldbuilding.entityDelete': {
      const id = text(payload, 'id');
      const entity = text(payload, 'entity');
      switch (entity) {
        case 'article': deleteWorldArticle(id); break;
        case 'character': deleteCharacter(id); break;
        case 'place': deleteWorldPlace(id); break;
        case 'group': deleteWorldGroup(id); break;
        case 'scene': deleteScene(id); break;
        case 'thread': deleteWorldThread(id); break;
        case 'rule': deleteWorldRule(id); break;
        case 'question': deleteWorldQuestion(id); break;
        default: throw new Error('bad_worldbuilding_entity');
      }
      return { result: { entity, id, deleted: true }, changedVault: true };
    }
    case 'pages.restoreRevision': {
      const pageId = text(payload, 'pageId');
      const revision = payload.revision;
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('bad_page_revision');
      const current = getPageDocument(pageId);
      if (!current) throw new Error('page_not_found');
      const restored = restorePageRevision(pageId, revision, current.revision, 'mobile');
      if (!restored.ok) throw new Error('page_revision_conflict');
      return { result: { pageId, revision, documentRevision: restored.document.revision }, changedVault: true };
    }
    case 'databases.importCSV': {
      const name = text(payload, 'name');
      const headers = payload.headers;
      const rows = payload.rows;
      const types = payload.types;
      const allowed = new Set([
        'title', 'rich_text', 'text', 'number', 'date', 'time', 'select', 'status', 'multi_select',
        'checkbox', 'person', 'url', 'email', 'phone', 'location',
      ]);
      if (!Array.isArray(headers) || headers.length < 1 || headers.length > 200 || headers.some((value) => typeof value !== 'string')) throw new Error('bad_csv_headers');
      if (!Array.isArray(rows) || rows.length > 10_000 || rows.some((row) => !Array.isArray(row) || row.length !== headers.length || row.some((value) => typeof value !== 'string'))) throw new Error('bad_csv_rows');
      if (!Array.isArray(types) || types.length !== headers.length || types.some((value) => value !== null && (typeof value !== 'string' || !allowed.has(value)))) throw new Error('bad_csv_types');
      const database = createDatabaseFromCsv(name, headers as string[], rows as string[][], types as Parameters<typeof createDatabaseFromCsv>[3]);
      return { result: { databaseId: database.id, name: database.name, rows: rows.length }, changedVault: true };
    }
    case 'toolkit.desktopRun':
      return { result: await executeRemoteToolkitAction(payload, runtime.base, runtime.token), changedVault: false };
    // These are named in the protocol now so older clients can negotiate them, but their
    // feature phases own their validation and processor. Refusal is terminal and explicit;
    // no arbitrary fallback invocation is ever attempted.
    case 'library.importToSpace':
    case 'academic.recompute':
    case 'pages.automationRun':
      throw new TypedRefusal('handler_not_enabled');
    default:
      throw new TypedRefusal('unknown_action_kind');
  }
}

/** The direct companion only enters the content/research subset; remote toolkit,
 * extraction, recomputation and automation cases cannot cross this boundary. */
export async function executeCompanionSpaceAction(action:ClaimedAction):Promise<ActionResult>{
  const allowed=new Set(['idea.delete','idea.saveToNotes','deepResearch.saveToNotes','hypothesis.saveToNotes','projects.create','projects.update','projects.section.update','projects.chapter.import','worldbuilding.entityDelete','pages.restoreRevision','databases.importCSV','author.synthesis.generate','authors.matrix.generate','argumentMap.generate','writing.generate','worldbuilding.continuity','worldbuilding.proseReview']);
  if(!allowed.has(action.kind))throw new Error('desktop_only_action');
  return execute(action,{base:'',token:''});
}

class TypedRefusal extends Error {}

async function report(base: string, spaceId: string, token: string, id: string, status: Exclude<ActionStatus, 'queued' | 'claimed' | 'cancelled'>, extra: Record<string, unknown> = {}): Promise<void> {
  await fetchWithTimeout(`${base}/api/v1/spaces/${encodeURIComponent(spaceId)}/actions/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ status, ...extra }),
  });
}

/** Claim and execute at most one job. The thirty-second inbox timer supplies backpressure and
 * keeps AI work sequential with the existing Deep Research lane. */
export async function drainOneSpaceAction(config: VaultServerConfig): Promise<void> {
  if (!config.configured || !config.enabled) return;
  const token = getNodusServerTokenFor(config.vaultId);
  if (!token) return;
  const base = normalizeUrl(config.url);
  const endpoint = `${base}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/actions`;
  const response = await fetchWithTimeout(`${endpoint}/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status === 404 || response.status === 403) return;
  if (!response.ok) throw new Error(`space_action_claim_http_${response.status}`);
  const value = await response.json() as { action?: ClaimedAction | null };
  const action = value.action;
  if (!action) return;

  const published = currentPublishedRevision(config.vaultId);
  if (action.inputRevision && published && action.inputRevision !== published) {
    await report(base, config.spaceId, token, action.id, 'refused', { errorCode: 'stale_input_revision' });
    return;
  }

  await report(base, config.spaceId, token, action.id, 'running');
  try {
    const outcome = await execute(action, { base, token });
    // JSON serialization is also the boundary check: a handler cannot return a process,
    // function or other ambient capability through the typed result channel.
    const result = JSON.parse(JSON.stringify(outcome.result)) as unknown;
    await report(base, config.spaceId, token, action.id, 'applied', { result });
    if (outcome.changedVault) markVaultDirty(config.vaultId);
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 128) : 'action_failed';
    await report(base, config.spaceId, token, action.id, error instanceof TypedRefusal ? 'refused' : 'failed', { errorCode: code });
  }
}

/** Purely for contract tests: there is no dynamic dispatcher to escape into. */
export const SPACE_ACTION_HANDLER_KINDS = Object.freeze([
  'idea.delete', 'idea.saveToNotes', 'author.synthesis.generate', 'authors.matrix.generate',
  'argumentMap.generate', 'deepResearch.generate', 'deepResearch.saveToNotes', 'worldbuilding.continuity',
  'worldbuilding.entityDelete', 'worldbuilding.proseReview',
  'pages.restoreRevision', 'databases.importCSV',
  'hypothesis.saveToNotes', 'writing.generate', 'projects.create', 'projects.update',
  'projects.section.update', 'projects.chapter.import',
  'library.importToSpace', 'academic.recompute', 'pages.automationRun', 'toolkit.desktopRun',
]);
