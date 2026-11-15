import type { DocumentPreparationState, ResearchCorpusDocument } from './researchCorpus';

/**
 * The decisions behind the first run's "bring your sources" step, kept free of React so
 * they can be tested without a window.
 *
 * The step exists to get a newcomer from an empty app to a cited answer in minutes. That
 * rules out preparing a whole Zotero library up front — a thousand works is an hour of
 * reading and, with a paid embedding service, a bill nobody agreed to. So it prepares a
 * small starter set, moves on as soon as ONE document can be searched, and leaves the
 * rest in the Library for the user to prepare when they choose.
 */

export type PreparedDocument = ResearchCorpusDocument & { preparation: DocumentPreparationState };

/** How many documents the first run prepares before handing over to the chat. */
export const STARTER_DOCUMENT_LIMIT = 5;
/** How many Zotero works are inspected to find that many with readable full text. */
export const STARTER_INSPECTION_LIMIT = 15;

export type StarterPreflight = { documentId: string; status: 'available' | 'abstract' | 'inaccessible' | 'ocr_pending' | 'unknown' };

/**
 * Choose which documents to prepare first. Works whose file was seen to hold text go
 * first (a reference with no PDF can never answer a question), then anything not yet
 * ruled out; a work known to be unreadable is only used when there is nothing better.
 */
export function pickStarterDocuments<T extends { id: string }>(
  documents: readonly T[],
  preflight: readonly StarterPreflight[] = [],
  limit = STARTER_DOCUMENT_LIMIT,
): T[] {
  const status = new Map(preflight.map((entry) => [entry.documentId, entry.status]));
  const rank = (document: T): number => {
    const value = status.get(document.id);
    if (value === 'available') return 0;
    if (value === undefined || value === 'unknown' || value === 'ocr_pending') return 1;
    return 2;
  };
  return documents
    .map((document, index) => ({ document, index, rank: rank(document) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.document);
}

/**
 * Text extracted, indexed for exact search and (unless working manually) embedded.
 *
 * Judged from the preparation state alone. `coverage` looks like the natural test and
 * is not one: it describes the Library's own copy, so a work read straight from Zotero
 * stays at `metadata` after its whole text has been prepared — requiring `fulltext`
 * left every Zotero collection waiting forever on a document that was ready.
 */
export function isDocumentSearchable(document: PreparedDocument, manual = false): boolean {
  const state = document.preparation;
  return state.text === 'available'
    && state.lexical === 'ready'
    && !state.unpreparedAttachmentIds?.length
    && (manual || (state.embeddings === 'ready' && state.status === 'ready'));
}

/** Preparation ended without a searchable document, and waiting longer will not change it. */
export function hasPreparationGivenUp(document: PreparedDocument): boolean {
  const state = document.preparation;
  return state.status === 'failed'
    || state.status === 'blocked'
    || state.status === 'cancelled'
    || state.text === 'abstract'
    || state.embeddings === 'failed';
}

export type StarterFailure = 'no-file' | 'unreadable' | 'no-model' | 'provider' | 'other';

/** Why a document could not be prepared, reduced to what the user can act on. */
export function starterFailure(document: PreparedDocument): StarterFailure {
  const { reason, text } = document.preparation;
  if (reason === 'no_model') return 'no-model';
  if (reason === 'provider_failed') return 'provider';
  if (reason === 'no_attachment' || reason === 'not_downloaded' || text === 'abstract') return 'no-file';
  if (reason === 'inaccessible' || reason === 'extraction_failed' || reason === 'ocr_required') return 'unreadable';
  return 'other';
}

export interface StarterProgress {
  /** The first searchable document, in the order they were asked for. */
  ready: PreparedDocument | null;
  readyCount: number;
  failedCount: number;
  pendingCount: number;
  total: number;
  /** Set once every document has given up, with the reason most of them share. */
  failure: StarterFailure | null;
  /** The document currently being read, for the progress line. */
  active: PreparedDocument | null;
}

/** Where the starter set stands, from one inventory reading. */
export function starterProgress(
  inventory: readonly PreparedDocument[],
  starterIds: readonly string[],
  manual = false,
): StarterProgress {
  const byId = new Map(inventory.map((document) => [document.id, document]));
  const documents = starterIds.map((id) => byId.get(id)).filter((document): document is PreparedDocument => !!document);
  const ready = documents.filter((document) => isDocumentSearchable(document, manual));
  const failed = documents.filter((document) => !isDocumentSearchable(document, manual) && hasPreparationGivenUp(document));
  const pending = documents.filter((document) => !ready.includes(document) && !failed.includes(document));
  let failure: StarterFailure | null = null;
  if (documents.length > 0 && ready.length === 0 && pending.length === 0) {
    const counts = new Map<StarterFailure, number>();
    for (const document of failed) counts.set(starterFailure(document), (counts.get(starterFailure(document)) ?? 0) + 1);
    failure = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
  }
  return {
    ready: ready[0] ?? null,
    readyCount: ready.length,
    failedCount: failed.length,
    pendingCount: pending.length,
    total: documents.length,
    failure,
    active: pending.find((document) => document.preparation.status === 'running') ?? pending[0] ?? null,
  };
}
