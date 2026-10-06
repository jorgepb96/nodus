import { isManualAcademic } from './academicMode';
import { scheduleManualIndex } from './manualIdeaIndex';
import type { EmbeddingPipelineProgress, WorkEmbeddingStatus } from '@shared/types';
import { getDb } from '../db/database';
import { IDEA_EMBEDDING_THEME_LABELS_SQL } from '../db/ideaEmbeddingText';
import { getSettings } from '../db/settingsRepo';
import {
  clearAllEmbeddings,
  currentEmbeddingConfig,
  embeddingTextForIdea,
  embeddingTextHash,
  ideaNeedsEmbedding,
  updateIdeaEmbedding,
} from '../db/ideasRepo';
import { allWorkSummaryRows, clearAllWorkSummaryEmbeddings, summaryNeedsEmbedding, updateWorkSummaryEmbedding } from '../db/workSummariesRepo';
import { embedManyStrict } from './aiClient';
import { clearAllPassages } from '../db/passagesRepo';
import { addNotification } from '../notifications';
import { nodiText } from '@shared/nodiNotifications';
import { coalesce } from '../util/coalesce';
import { logPipelineFailure, logPipelineSuccess, logPipelineWarning } from '../logging/pipelineLogCore';

type ProgressListener = (p: EmbeddingPipelineProgress) => void;

const PAUSE_POLL_MS = 300;

interface WorkIdeas {
  nodusId: string;
  title: string;
  ideas: { globalId: string; type: string; label: string; statement: string; themes: string[] }[];
}

const state = {
  running: false,
  paused: false,
  stopRequested: false,
  startedAt: null as string | null,
  finishedAt: null as string | null,
  currentWorkStartedAt: null as string | null,
  currentWorkFinishedAt: null as string | null,
  works: [] as WorkIdeas[],
  currentWorkIndex: 0,
  ideasEmbedded: 0,
  totalIdeas: 0,
  currentIdeaIndex: 0,
  error: null as string | null,
  listeners: new Set<ProgressListener>(),
};

const emitter = coalesce(() => {
  const p = snapshot();
  for (const l of state.listeners) l(p);
}, 150);

function emit(): void {
  emitter.schedule();
}

function snapshot(): EmbeddingPipelineProgress {
  const currentWork = state.works[state.currentWorkIndex] ?? null;
  return {
    running: state.running,
    paused: state.paused,
    cancelled: state.stopRequested,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    currentWorkStartedAt: state.currentWorkStartedAt,
    currentWorkFinishedAt: state.currentWorkFinishedAt,
    currentWorkIndex: state.currentWorkIndex,
    totalWorks: state.works.length,
    currentWorkTitle: currentWork?.title ?? null,
    ideasEmbedded: state.ideasEmbedded,
    totalIdeas: state.totalIdeas,
    currentIdeaIndex: state.currentIdeaIndex,
    currentWorkIdeas: currentWork?.ideas.length ?? 0,
    error: state.error,
  };
}

export function onEmbeddingProgress(cb: ProgressListener): () => void {
  state.listeners.add(cb);
  return () => state.listeners.delete(cb);
}

export function getEmbeddingSnapshot(): EmbeddingPipelineProgress {
  return snapshot();
}

export function pauseEmbedding(): void {
  if (state.running) {
    state.paused = true;
    emit();
  }
}

export function resumeEmbedding(): void {
  state.paused = false;
  emit();
}

export function stopEmbedding(): void {
  state.stopRequested = true;
  state.paused = false;
}

/**
 * Dismiss the finished embedding queue without touching the embeddings already
 * written to the database. A live pipeline must be stopped first.
 */
export function clearEmbeddingProgress(): void {
  if (state.running) return;
  state.paused = false;
  state.stopRequested = false;
  state.startedAt = null;
  state.finishedAt = null;
  state.currentWorkStartedAt = null;
  state.currentWorkFinishedAt = null;
  state.works = [];
  state.currentWorkIndex = 0;
  state.ideasEmbedded = 0;
  state.totalIdeas = 0;
  state.currentIdeaIndex = 0;
  state.error = null;
  emit();
}

async function waitIfPaused(): Promise<boolean> {
  while (state.paused && !state.stopRequested) {
    await new Promise((r) => setTimeout(r, PAUSE_POLL_MS));
  }
  return state.stopRequested;
}

/**
 * Start the embedding pipeline for the given works.
 * If nodusIds is empty, processes all deep-scanned works. `ideaIds` narrows the pass to
 * those ideas, wherever they occur: re-embedding a few rewritten ideas must not also
 * re-embed every other idea of their works that an old embedding model left behind.
 */
export async function startEmbedding(nodusIds?: string[], options: { ideaIds?: readonly string[] } = {}): Promise<void> {
  if (isManualAcademic()) { scheduleManualIndex(true); return; }
  if (state.running) {
    // A caller awaiting required post-processing must not receive a false success.
    // Let the active batch finish, then run its requested scope explicitly.
    while (state.running) await new Promise((resolve) => setTimeout(resolve, 100));
    return startEmbedding(nodusIds, options);
  }
  const ideaFilter = options.ideaIds ? new Set(options.ideaIds) : null;
  if (ideaFilter && ideaFilter.size === 0) return;

  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.currentWorkStartedAt = null;
  state.currentWorkFinishedAt = null;
  state.error = null;
  state.works = [];
  state.currentWorkIndex = 0;
  state.ideasEmbedded = 0;
  state.totalIdeas = 0;
  state.currentIdeaIndex = 0;
  emit();

  let terminalError: Error | null = null;
  try {
    const db = getDb();

    let workRows: { nodus_id: string; title: string }[];
    if (ideaFilter) {
      workRows = db
        .prepare(`SELECT DISTINCT w.nodus_id, w.title FROM works w JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
          WHERE io.global_id IN (SELECT value FROM json_each(?)) AND w.archived = 0 ORDER BY w.nodus_id`)
        .all(JSON.stringify([...ideaFilter])) as { nodus_id: string; title: string }[];
    } else if (nodusIds && nodusIds.length > 0) {
      const placeholders = nodusIds.map(() => '?').join(',');
      workRows = db
        .prepare(`SELECT nodus_id, title FROM works WHERE nodus_id IN (${placeholders}) AND archived = 0`)
        .all(...nodusIds) as { nodus_id: string; title: string }[];
    } else {
      workRows = db
        .prepare("SELECT nodus_id, title FROM works WHERE deep_status = 'done' AND archived = 0")
        .all() as { nodus_id: string; title: string }[];
    }

    if (workRows.length === 0) {
      // A refresh of ideas no active work holds any more has nothing to do; it is not an error.
      state.error = ideaFilter ? null : 'No hay obras con análisis profundo para indexar.';
      emit();
      return;
    }

    const claimedIdeas = new Set<string>();
    state.works = workRows.map((w) => ({
      nodusId: w.nodus_id,
      title: w.title,
      ideas: [],
    }));

    for (const wi of state.works) {
      const rows = db
        .prepare(
          `SELECT DISTINCT
             i.global_id,
             i.type,
             i.label,
             i.statement,
             i.embedding,
             i.embedding_provider,
             i.embedding_model,
             i.embedding_dim,
             i.embedding_text_hash,
             ${IDEA_EMBEDDING_THEME_LABELS_SQL} AS theme_labels
           FROM ideas i
           JOIN idea_occurrences io ON io.global_id = i.global_id
           WHERE io.nodus_id = ?`
        )
        .all(wi.nodusId) as {
        global_id: string;
        type: string;
        label: string;
        statement: string;
        embedding: Buffer | null;
        embedding_provider: string | null;
        embedding_model: string | null;
        embedding_dim: number | null;
        embedding_text_hash: string | null;
        theme_labels: string;
      }[];

      wi.ideas = rows
        .map((r) => ({
          globalId: r.global_id,
          type: r.type,
          label: r.label,
          statement: r.statement,
          themes: r.theme_labels ? r.theme_labels.split(',').filter(Boolean) : [],
          embedding: r.embedding,
          embedding_provider: r.embedding_provider,
          embedding_model: r.embedding_model,
          embedding_dim: r.embedding_dim,
          embedding_text_hash: r.embedding_text_hash,
        }))
        .filter((idea) => {
          // An idea shared by several works is embedded once, under the first of them.
          if (ideaFilter && !ideaFilter.has(idea.globalId)) return false;
          if (claimedIdeas.has(idea.globalId)) return false;
          const text = embeddingTextForIdea(idea);
          const needed = ideaNeedsEmbedding(idea, text);
          if (needed) claimedIdeas.add(idea.globalId);
          return needed;
        })
        .map(({
          embedding: _embedding,
          embedding_provider: _embeddingProvider,
          embedding_model: _embeddingModel,
          embedding_dim: _embeddingDim,
          embedding_text_hash: _embeddingTextHash,
          ...idea
        }) => idea);

      state.totalIdeas += wi.ideas.length;
    }

    state.works = state.works.filter((w) => w.ideas.length > 0);
    state.totalIdeas = state.works.reduce((sum, w) => sum + w.ideas.length, 0);

    if (state.totalIdeas === 0) {
      state.error = null;
      emit();
      return;
    }

    emit();

    for (let wi = 0; wi < state.works.length; wi++) {
      if (state.stopRequested) break;

      state.currentWorkIndex = wi;
      const work = state.works[wi];
      state.currentWorkStartedAt = new Date().toISOString();
      state.currentWorkFinishedAt = null;
      emit();

      if (await waitIfPaused()) break;
      const texts = work.ideas.map((idea) => embeddingTextForIdea(idea));
      const embeddings = await embedManyStrict(texts, undefined, {
        role: 'document',
        perf: { nodusId: work.nodusId, title: work.title },
        jobId: `${work.nodusId}:idea-embeddings`,
      });
      if (state.stopRequested || await waitIfPaused()) break;
      getDb().transaction(() => {
        for (let ii = 0; ii < work.ideas.length; ii++) {
          state.currentIdeaIndex = ii;
          updateIdeaEmbedding(work.ideas[ii].globalId, texts[ii], embeddings[ii]);
          state.ideasEmbedded += 1;
        }
      })();
      state.currentWorkFinishedAt = new Date().toISOString();
      emit();
    }
  } catch (e) {
    terminalError = e instanceof Error ? e : new Error(String(e));
    state.error = terminalError.message;
    console.error('[embeddingPipeline] fatal error:', state.error);
  } finally {
    const finishedAt = new Date().toISOString();
    if (state.currentWorkStartedAt && !state.currentWorkFinishedAt) state.currentWorkFinishedAt = finishedAt;
    state.finishedAt = finishedAt;
    state.running = false;
    emit();
    if (!state.stopRequested && state.totalIdeas > 0) {
      addNotification({
        title: nodiText(state.error ? 'ideaEmbeddingsFailedTitle' : 'ideaEmbeddingsDoneTitle'),
        // The failure body is the provider's own message: runtime prose with no key,
        // translated as best the renderer can at render time.
        body: state.error
          ? state.error
          : nodiText('ideaEmbeddingsDoneBody', { ideas: state.ideasEmbedded, works: state.works.length }),
        kind: state.error ? 'warning' : 'success',
        dedupeKey: `idea-embeddings:${state.error ? 'error' : 'complete'}`,
      });
    }
    // The run's outcome belongs in the processing log whether it finished, failed or was
    // stopped: an interrupted index is exactly what someone opens the log to explain.
    if (state.stopRequested) {
      logPipelineWarning({ subject: 'subjectEmbeddings', code: 'cancelled', reason: 'reasonCancelled', context: { scope: 'embeddings' } });
    } else if (state.error) {
      logPipelineFailure({
        error: state.error,
        code: 'embedding_failed',
        subject: 'subjectEmbeddings',
        context: { scope: 'embeddings' },
        detail: state.error,
      });
    } else if (state.totalIdeas > 0) {
      logPipelineSuccess({
        subject: 'subjectEmbeddings',
        context: { scope: 'embeddings' },
        message: { id: 'ideasEmbedded', params: { done: state.ideasEmbedded, total: state.totalIdeas } },
      });
    }
  }
  if (terminalError && !state.stopRequested) throw terminalError;
}

/** True when an embedding provider and its credential are configured for indexing. */
export function embeddingIndexConfigured(): boolean {
  const settings = getSettings();
  return settings.embeddingProvider === 'nodus'
    || settings.embeddingProvider === 'ollama'
    || settings.embeddingProvider === 'lmstudio'
    || settings.providerKeys[settings.embeddingProvider] === true;
}

/**
 * Re-embed the ideas a reprocess pass re-themed. An idea is embedded with its theme
 * labels, so rewriting them leaves its vector stale. Only those ideas are refreshed:
 * a library-wide pass would also re-embed every idea that an earlier embedding model
 * produced, which is a paid rebuild of the whole library nobody asked for.
 */
export async function refreshRethemedIdeaEmbeddings(ideaIds: readonly string[]): Promise<void> {
  if (!ideaIds.length || !embeddingIndexConfigured()) return;
  await startEmbedding(undefined, { ideaIds });
}

/**
 * Clear all existing embeddings and re-embed every idea from scratch.
 * Useful after changing the embedding model.
 */
export async function reindexAll(): Promise<void> {
  clearAllEmbeddings();
  clearAllWorkSummaryEmbeddings();
  clearAllPassages();
  await startEmbedding();
  await reembedAllSummaries();
}

/** Rebuild orientation-summary vectors without coupling them to the idea-progress UI. */
async function reembedAllSummaries(): Promise<void> {
  const rows = allWorkSummaryRows().filter((row) => summaryNeedsEmbedding(row, row.summary));
  if (!rows.length) return;
  const titles = rows.map(row => (getDb().prepare('SELECT title FROM works WHERE nodus_id=?').get(row.nodus_id) as { title: string } | undefined)?.title);
  const embeddings = await embedManyStrict(rows.map((row) => row.summary), undefined, { role: 'document', titles });
  getDb().transaction(() => {
    rows.forEach((row, index) => updateWorkSummaryEmbedding(row.nodus_id, row.summary, embeddings[index], titles[index]));
  })();
}

/** Get per-work embedding status for the library table. */
export function getWorkEmbeddingStatuses(
  nodusIds?: string[]
): WorkEmbeddingStatus[] {
  const db = getDb();
  const config = currentEmbeddingConfig();

  let rows: {
    nodus_id: string;
    global_id: string;
    type: string;
    label: string;
    statement: string;
    embedding_bytes: number | null;
    embedding_provider: string | null;
    embedding_model: string | null;
    embedding_dim: number | null;
    embedding_text_hash: string | null;
    theme_labels: string;
  }[];
  if (nodusIds && nodusIds.length > 0) {
    const placeholders = nodusIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT DISTINCT
                io.nodus_id,
                i.global_id,
                i.type,
                i.label,
                i.statement,
                length(i.embedding) AS embedding_bytes,
                i.embedding_provider,
                i.embedding_model,
                i.embedding_dim,
                i.embedding_text_hash,
                ${IDEA_EMBEDDING_THEME_LABELS_SQL} AS theme_labels
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
         WHERE io.nodus_id IN (${placeholders})`
      )
      .all(...nodusIds) as typeof rows;
  } else {
    rows = db
      .prepare(
        `SELECT DISTINCT
                io.nodus_id,
                i.global_id,
                i.type,
                i.label,
                i.statement,
                length(i.embedding) AS embedding_bytes,
                i.embedding_provider,
                i.embedding_model,
                i.embedding_dim,
                i.embedding_text_hash,
                ${IDEA_EMBEDDING_THEME_LABELS_SQL} AS theme_labels
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id`
      )
      .all() as typeof rows;
  }

  const byWork = new Map<string, { total: Set<string>; embedded: Set<string> }>();
  for (const row of rows) {
    const entry = byWork.get(row.nodus_id) ?? { total: new Set<string>(), embedded: new Set<string>() };
    byWork.set(row.nodus_id, entry);
    entry.total.add(row.global_id);
    const themes = row.theme_labels ? row.theme_labels.split(',').filter(Boolean) : [];
    const text = embeddingTextForIdea({ type: row.type, label: row.label, statement: row.statement, themes });
    const hasCurrentEmbedding =
      Number(row.embedding_bytes ?? 0) > 0 &&
      row.embedding_provider === config.provider &&
      row.embedding_model === config.model &&
      row.embedding_dim === Number(row.embedding_bytes) / 4 &&
      row.embedding_text_hash === embeddingTextHash(text);
    if (hasCurrentEmbedding) entry.embedded.add(row.global_id);
  }

  return [...byWork.entries()].map(([nodus_id, value]) => ({
    nodus_id,
    totalIdeas: value.total.size,
    embeddedIdeas: value.embedded.size,
    complete: value.total.size > 0 && value.embedded.size === value.total.size,
  }));
}
