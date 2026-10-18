import { createHash } from 'node:crypto';
import type {
  LibraryAnalysisComponent,
  LibraryComponentRevision,
  LibraryContentRevision,
  LibraryExtractionOptions,
  LibraryItemRecord,
  LibraryPendingInvalidation,
} from '@shared/libraryTypes';
import { canonicalJson } from './libraryRecord';

export const LIBRARY_EXTRACTION_PIPELINE = 'nodus-clean-markdown/12';

const COMPONENTS: LibraryAnalysisComponent[] = ['extraction', 'light', 'deep', 'passages', 'ideas', 'embeddings', 'summary'];
const CONTENT_DERIVATIVES: LibraryAnalysisComponent[] = ['deep', 'passages', 'ideas', 'embeddings', 'summary'];

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function emptyComponent(freshness: LibraryComponentRevision['freshness'] = 'none'): LibraryComponentRevision {
  return { freshness, fingerprint: null, reason: null, generatedAt: null };
}

function components(): LibraryContentRevision['components'] {
  return Object.fromEntries(COMPONENTS.map((component) => [component, emptyComponent()])) as LibraryContentRevision['components'];
}

export function bibliographicFingerprint(item: Pick<LibraryItemRecord, 'metadata'>): string {
  return hash({
    title: item.metadata.title,
    abstract: item.metadata.abstract ?? null,
    creators: item.metadata.creators.map((creator) => ({
      creatorType: creator.creatorType,
      firstName: creator.firstName ?? null,
      lastName: creator.lastName ?? null,
      name: creator.name ?? null,
    })),
  });
}

export function primaryAttachmentFingerprint(item: Pick<LibraryItemRecord, 'attachments' | 'files'>): string | null {
  const attachment = item.attachments.find((entry) => entry.role === 'original') ?? item.attachments[0];
  if (attachment?.sha256) return hash({ sha256: attachment.sha256, mimeType: attachment.mimeType, role: attachment.role });
  return item.files?.original ? hash({ relativePath: item.files.original }) : null;
}

export function extractionFingerprint(input: {
  sourceSha256: string;
  options: LibraryExtractionOptions;
  pipeline?: string;
}): string {
  return hash({
    sourceSha256: input.sourceSha256,
    ocrMode: input.options.ocrMode,
    ocrLanguages: input.options.ocrLanguages,
    maxOcrPages: input.options.maxOcrPages,
    extractImages: input.options.extractImages,
    detectTables: input.options.detectTables,
    pipeline: input.pipeline ?? LIBRARY_EXTRACTION_PIPELINE,
  });
}

export function embeddingFingerprint(input: {
  textFingerprint: string;
  provider: string;
  model: string;
  dimension: number;
  pipeline: string;
}): string {
  return hash(input);
}

export function summaryFingerprint(input: {
  lightHash: string | null;
  deepHash: string | null;
  model: string;
  prompt: string;
}): string {
  return hash({ ...input, prompt: hash(input.prompt) });
}

export function initialLibraryContentRevision(item: Pick<LibraryItemRecord, 'metadata' | 'attachments' | 'files' | 'extraction'>, now: string): LibraryContentRevision {
  const next = components();
  if (item.extraction?.status === 'processing') next.extraction = { ...emptyComponent('running'), reason: 'Legacy extraction has no verifiable fingerprint.' };
  else if (item.extraction?.status === 'failed') next.extraction = { ...emptyComponent('failed'), reason: item.extraction.error ?? 'Extraction failed.' };
  else if (item.files?.reader) next.extraction = { ...emptyComponent('unavailable'), reason: 'Readable legacy output has no recorded pipeline fingerprint.' };
  return {
    format: 'nodus.library-content-revision', formatVersion: 1, revision: 1,
    extractionFingerprint: null,
    bibliographicFingerprint: bibliographicFingerprint(item),
    contentFingerprint: null,
    embeddingFingerprint: null,
    summaryFingerprint: null,
    components: next,
    previousReadable: null,
    pendingInvalidations: [],
    updatedAt: now,
  };
}

function stale(component: LibraryComponentRevision, reason: string): LibraryComponentRevision {
  if (component.freshness === 'none' || component.freshness === 'unavailable') return component;
  return { ...component, freshness: 'stale', reason };
}

function pending(
  current: LibraryPendingInvalidation[],
  componentsToInvalidate: LibraryAnalysisComponent[],
  reason: LibraryPendingInvalidation['reason'],
  now: string,
): LibraryPendingInvalidation[] {
  const withoutSame = current.filter((entry) => !(entry.vaultId === '*' && entry.reason === reason));
  return [...withoutSame, { vaultId: '*', components: componentsToInvalidate, reason, requestedAt: now }];
}

/** Reconcile ordinary item writes. Organizational fields deliberately do not participate. */
export function reconcileLibraryContentRevision(
  previous: LibraryItemRecord | null,
  next: Pick<LibraryItemRecord, 'metadata' | 'attachments' | 'files' | 'extraction'> & Partial<Pick<LibraryItemRecord, 'contentRevision'>>,
  now: string,
): LibraryContentRevision {
  if (!previous) return next.contentRevision ?? initialLibraryContentRevision(next, now);
  const prior = previous.contentRevision ?? initialLibraryContentRevision(previous, previous.clock.updatedAt || now);
  // Extraction/model publishers supply a complete, explicitly incremented revision.
  // Ordinary callers frequently spread a record loaded from disk, so object identity
  // cannot distinguish an explicit publication from an unchanged revision.
  if (next.contentRevision && next.contentRevision.revision > prior.revision) return next.contentRevision;
  const nextBibliographic = bibliographicFingerprint(next);
  const bibliographicChanged = nextBibliographic !== prior.bibliographicFingerprint;
  const attachmentChanged = primaryAttachmentFingerprint(previous) !== primaryAttachmentFingerprint(next);
  if (!bibliographicChanged && !attachmentChanged) return prior;
  const updated: LibraryContentRevision = {
    ...prior,
    revision: prior.revision + 1,
    bibliographicFingerprint: nextBibliographic,
    components: { ...prior.components },
    pendingInvalidations: [...prior.pendingInvalidations],
    updatedAt: now,
  };
  if (bibliographicChanged) {
    for (const component of ['light', 'summary'] as const) updated.components[component] = stale(prior.components[component], 'Bibliographic fields changed.');
    updated.pendingInvalidations = pending(updated.pendingInvalidations, ['light', 'summary'], 'bibliographic-change', now);
  }
  if (attachmentChanged) {
    updated.components.extraction = { ...prior.components.extraction, freshness: 'queued', reason: 'The primary attachment changed.' };
    for (const component of CONTENT_DERIVATIVES) updated.components[component] = stale(prior.components[component], 'The primary attachment changed.');
    updated.pendingInvalidations = pending(updated.pendingInvalidations, ['extraction', ...CONTENT_DERIVATIVES], 'primary-attachment-change', now);
  }
  return updated;
}

export function publishLibraryContentRevision(input: {
  item: LibraryItemRecord;
  extractionFingerprint: string;
  contentFingerprint: string;
  files: NonNullable<LibraryItemRecord['files']>;
  now: string;
}): LibraryContentRevision {
  const prior = input.item.contentRevision ?? initialLibraryContentRevision(input.item, input.item.clock.updatedAt || input.now);
  const contentChanged = prior.contentFingerprint !== null && prior.contentFingerprint !== input.contentFingerprint;
  const next: LibraryContentRevision = {
    ...prior,
    revision: prior.revision + 1,
    extractionFingerprint: input.extractionFingerprint,
    contentFingerprint: input.contentFingerprint,
    components: {
      ...prior.components,
      extraction: {
        freshness: 'current', fingerprint: input.extractionFingerprint, reason: null, generatedAt: input.now,
        pipeline: LIBRARY_EXTRACTION_PIPELINE,
      },
    },
    previousReadable: contentChanged && prior.contentFingerprint && input.item.files
      ? { contentFingerprint: prior.contentFingerprint, files: input.item.files, supersededAt: input.now }
      : prior.previousReadable,
    pendingInvalidations: contentChanged
      ? pending(prior.pendingInvalidations, CONTENT_DERIVATIVES, 'content-change', input.now)
      : prior.pendingInvalidations,
    updatedAt: input.now,
  };
  if (contentChanged) for (const component of CONTENT_DERIVATIVES) {
    next.components[component] = stale(prior.components[component], 'Clean Markdown changed.');
  }
  return next;
}

export function failLibraryExtractionRevision(item: LibraryItemRecord, message: string, now: string): LibraryContentRevision {
  const prior = item.contentRevision ?? initialLibraryContentRevision(item, item.clock.updatedAt || now);
  return {
    ...prior, revision: prior.revision + 1,
    components: { ...prior.components, extraction: { ...prior.components.extraction, freshness: 'failed', reason: message } },
    updatedAt: now,
  };
}

export function markLibraryExtractionRevision(
  item: LibraryItemRecord,
  freshness: 'queued' | 'running',
  reason: string,
  now: string,
): LibraryContentRevision {
  const prior = item.contentRevision ?? initialLibraryContentRevision(item, item.clock.updatedAt || now);
  return {
    ...prior,
    revision: prior.revision + 1,
    components: {
      ...prior.components,
      extraction: { ...prior.components.extraction, freshness, reason },
    },
    updatedAt: now,
  };
}

export function setLibraryEmbeddingRevision(item: LibraryItemRecord, input: {
  provider: string; model: string; dimension: number; pipeline: string; textFingerprint?: string;
}, now: string): LibraryContentRevision {
  const prior = item.contentRevision ?? initialLibraryContentRevision(item, item.clock.updatedAt || now);
  const fingerprint = embeddingFingerprint({
    textFingerprint: input.textFingerprint ?? prior.contentFingerprint ?? '',
    provider: input.provider, model: input.model, dimension: input.dimension, pipeline: input.pipeline,
  });
  if (prior.embeddingFingerprint === fingerprint) return prior;
  return {
    ...prior, revision: prior.revision + 1, embeddingFingerprint: fingerprint,
    components: { ...prior.components, embeddings: { freshness: 'stale', fingerprint, reason: 'Embedding configuration changed.', generatedAt: null, ...input } },
    pendingInvalidations: pending(prior.pendingInvalidations, ['embeddings'], 'embedding-config-change', now), updatedAt: now,
  };
}

export function setLibrarySummaryRevision(item: LibraryItemRecord, input: {
  lightHash: string | null; deepHash: string | null; model: string; prompt: string;
}, now: string): LibraryContentRevision {
  const prior = item.contentRevision ?? initialLibraryContentRevision(item, item.clock.updatedAt || now);
  const fingerprint = summaryFingerprint(input);
  if (prior.summaryFingerprint === fingerprint) return prior;
  return {
    ...prior, revision: prior.revision + 1, summaryFingerprint: fingerprint,
    components: { ...prior.components, summary: { freshness: 'stale', fingerprint, reason: 'Summary model or prompt changed.', generatedAt: null, model: input.model, promptHash: hash(input.prompt) } },
    pendingInvalidations: pending(prior.pendingInvalidations, ['summary'], 'summary-config-change', now), updatedAt: now,
  };
}
