// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  BrowserConnectorAttachmentCandidate,
  BrowserConnectorCaptureRequest,
  BrowserConnectorPendingUpload,
  BrowserConnectorSaveResult,
} from '@shared/browserConnector';
import type { LibraryItemMetadata, LibraryMetadataIdentifierKind } from '@shared/libraryTypes';
import { detectLibraryMetadataIdentifier } from '@shared/libraryBibliography';
import { normalizeLibraryMetadata } from '../library/libraryRecord';
import {
  addGlobalLibraryAttachments,
  createGlobalLibraryItem,
  findGlobalLibraryItemByMetadata,
  getGlobalLibraryItem,
  listGlobalLibraryCollections,
  mergeGlobalLibraryItemMetadataIfMissing,
  patchGlobalLibraryItemCollections,
  resolveGlobalLibraryMetadata,
  updateGlobalLibraryAttachment,
} from '../library/libraryService';
import { downloadLibraryFullText } from '../library/libraryFullText';
import {
  MAX_PUBLIC_DOWNLOAD_BYTES,
  fetchPublicAttachment,
  responseToTemporaryFile,
  safeRemoteFileName,
} from '../network/publicDownload';

const MAX_REMOTE_BYTES = MAX_PUBLIC_DOWNLOAD_BYTES;
const MAX_SNAPSHOT_CHARS = 6 * 1024 * 1024;

// Keep the lookup/merge/create section atomic within the Electron process.
// Attachment downloads happen after this short critical section, so a slow
// publisher never blocks unrelated captures while still preventing two
// simultaneous captures from both creating the same record.
let captureMutationTail: Promise<void> = Promise.resolve();

async function serializeCaptureMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  const previous = captureMutationTail;
  let release!: () => void;
  captureMutationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); } finally { release(); }
}

function cleanText(value: unknown, limit = 10_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function expectsPdf(candidate: BrowserConnectorAttachmentCandidate): boolean {
  return candidate.resolveFullText === true
    || candidate.mimeType?.split(';')[0].toLowerCase() === 'application/pdf'
    || /\.pdf(?:$|[?#])/i.test(candidate.url)
    || /\.pdf$/i.test(candidate.fileName ?? '');
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'));
}


async function attachFile(itemId: string, file: string, candidate: BrowserConnectorAttachmentCandidate, makePrimary = false) {
  const before = getGlobalLibraryItem(itemId);
  const known = new Set(before?.attachments.map((entry) => entry.id) ?? []);
  let result = await addGlobalLibraryAttachments(itemId, [file]);
  const added = result.attachments.find((entry) => !known.has(entry.id));
  if (added && (candidate.title || candidate.role || makePrimary)) {
    result = await updateGlobalLibraryAttachment(itemId, added.id, {
      ...(candidate.title ? { title: cleanText(candidate.title, 500) } : {}),
      ...(candidate.role ? { role: candidate.role } : {}),
      ...(makePrimary ? { makePrimary: true } : {}),
    });
  }
  return result;
}

function preferredIdentifier(metadata: LibraryItemMetadata): { kind: LibraryMetadataIdentifierKind; value: string } | null {
  const candidates = [metadata.doi, metadata.pmid && `pmid:${metadata.pmid}`, metadata.pmcid, metadata.arxiv && `arxiv:${metadata.arxiv}`, metadata.isbn?.[0] && `isbn:${metadata.isbn[0]}`];
  for (const candidate of candidates) {
    const detected = candidate ? detectLibraryMetadataIdentifier(candidate) : null;
    if (detected) return detected;
  }
  return null;
}

function mergeMetadata(detected: LibraryItemMetadata, resolved: LibraryItemMetadata | null, source: BrowserConnectorCaptureRequest['metadataSource']): LibraryItemMetadata {
  if (!resolved) return normalizeLibraryMetadata(detected);
  const trustedPage = !['direct-file', 'generic', 'open-graph'].includes(source);
  const overlay = trustedPage ? detected : {
    ...detected,
    title: resolved.title || detected.title,
    itemType: resolved.itemType !== 'document' ? resolved.itemType : detected.itemType,
    creators: resolved.creators.length ? resolved.creators : detected.creators,
  };
  return normalizeLibraryMetadata({
    ...resolved,
    ...overlay,
    creators: overlay.creators.length ? overlay.creators : resolved.creators,
    abstract: overlay.abstract || resolved.abstract,
    publicationTitle: overlay.publicationTitle || resolved.publicationTitle,
    publisher: overlay.publisher || resolved.publisher,
    date: overlay.date || resolved.date,
    year: overlay.year ?? resolved.year,
    doi: overlay.doi || resolved.doi,
    pmid: overlay.pmid || resolved.pmid,
    pmcid: overlay.pmcid || resolved.pmcid,
    arxiv: overlay.arxiv || resolved.arxiv,
    isbn: [...new Set([...(overlay.isbn ?? []), ...(resolved.isbn ?? [])])],
    issn: [...new Set([...(overlay.issn ?? []), ...(resolved.issn ?? [])])],
    tags: [...new Set([...(overlay.tags ?? []), ...(resolved.tags ?? [])])],
    extra: { ...(resolved.extra ?? {}), ...(overlay.extra ?? {}) },
  });
}

export async function previewBrowserCapture(request: BrowserConnectorCaptureRequest): Promise<{ metadata: LibraryItemMetadata; warnings: string[] }> {
  const detected = normalizeLibraryMetadata({ ...request.metadata, url: request.metadata.url || request.pageUrl }, request.pageUrl);
  const warnings: string[] = [];
  let resolved: LibraryItemMetadata | null = null;
  const identifier = preferredIdentifier(detected);
  if (identifier) {
    try {
      resolved = (await resolveGlobalLibraryMetadata(identifier.kind, identifier.value)).candidates[0]?.metadata ?? null;
    } catch (error) {
      warnings.push(`Identifier enrichment unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { metadata: mergeMetadata(detected, resolved, request.metadataSource), warnings };
}

function editableCollectionId(requested: string | null | undefined): string | null {
  if (!requested) return null;
  const collection = listGlobalLibraryCollections().find((entry) => entry.id === requested);
  if (!collection) throw new Error('The selected collection no longer exists.');
  if (collection.source !== 'nodus') throw new Error('Imported collections are read-only; choose a Nodus collection.');
  return collection.id;
}

export async function saveBrowserCapture(request: BrowserConnectorCaptureRequest): Promise<BrowserConnectorSaveResult> {
  const preview = request.metadataReviewed
    ? { metadata: normalizeLibraryMetadata(request.metadata, request.pageUrl), warnings: [] as string[] }
    : await previewBrowserCapture(request);
  const tags = [...new Set([...(preview.metadata.tags ?? []), ...(request.tags ?? [])].map((entry) => cleanText(entry, 200)).filter(Boolean))].slice(0, 256);
  const collectionId = editableCollectionId(request.collectionId);
  const incomingMetadata = { ...preview.metadata, tags, ...(request.captureRequestId ? { extra: { ...preview.metadata.extra, 'Browser capture request': request.captureRequestId } } : {}) };
  const resolution = await serializeCaptureMutation(async () => {
    const match = findGlobalLibraryItemByMetadata(incomingMetadata, !request.sourceIsResultPage, request.captureRequestId);
    const initialRevision = match?.item.clock.revision ?? null;
    let record = match
      ? mergeGlobalLibraryItemMetadataIfMissing(match.item.id, incomingMetadata)
      : createGlobalLibraryItem(incomingMetadata, collectionId ? [collectionId] : []);
    let changed = !match;
    if (match && collectionId && !record.collectionIds.includes(collectionId)) {
      await patchGlobalLibraryItemCollections([record.id], { add: [collectionId] });
      record = getGlobalLibraryItem(record.id) ?? record;
      changed = true;
    }
    changed ||= initialRevision !== record.clock.revision;
    return { match, record, changed };
  });
  const { match } = resolution;
  let record = resolution.record;
  let changed = resolution.changed;
  const warnings = [...preview.warnings];
  const pendingUploads: BrowserConnectorPendingUpload[] = [];
  const attachments = [...new Map((request.attachments ?? []).slice(0, 8).flatMap((entry) => {
    try { return [[new URL(entry.url).toString(), entry] as const]; } catch { return []; }
  })).values()];

  for (const [index, candidate] of attachments.entries()) {
    let temporary: { dir: string; file: string } | null = null;
    try {
      if (expectsPdf(candidate)) {
        const downloaded = await downloadLibraryFullText({
          metadata: preview.metadata,
          sourceUrl: request.pageUrl,
          fullTextLinks: [{ url: candidate.url, mimeType: candidate.mimeType ?? null, source: 'landing-page' }],
        });
        if (downloaded.status !== 'downloaded' || !downloaded.temporaryDirectory || !downloaded.filePath) {
          throw new Error(downloaded.message || 'The scholarly full-text link did not resolve to a PDF.');
        }
        temporary = { dir: downloaded.temporaryDirectory, file: downloaded.filePath };
      } else {
        const response = await fetchPublicAttachment(candidate.url);
        temporary = await responseToTemporaryFile(response, candidate);
      }
      const beforeAttachmentRevision = record.clock.revision;
      record = await attachFile(record.id, temporary.file, candidate, index === 0 && candidate.role === 'original');
      changed ||= record.clock.revision !== beforeAttachmentRevision;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`${candidate.title || candidate.url}: ${reason}`);
      pendingUploads.push({ ...candidate, reason });
    } finally {
      if (temporary) await fs.promises.rm(temporary.dir, { recursive: true, force: true });
    }
  }

  if (request.snapshotHtml && request.snapshotHtml.length <= MAX_SNAPSHOT_CHARS) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodus-browser-snapshot-'));
    const file = path.join(dir, 'webpage.html');
    try {
      await fs.promises.writeFile(file, request.snapshotHtml, { encoding: 'utf8', mode: 0o600 });
      const beforeSnapshotRevision = record.clock.revision;
      record = await attachFile(record.id, file, { url: request.pageUrl, title: 'Web page snapshot', mimeType: 'text/html', role: 'snapshot' });
      changed ||= record.clock.revision !== beforeSnapshotRevision;
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  } else if (request.snapshotHtml && request.snapshotHtml.length > MAX_SNAPSHOT_CHARS) {
    warnings.push('The web page snapshot exceeded 6 MB and was not stored.');
  }

  return {
    ok: true,
    itemId: record.id,
    disposition: !match ? 'created' : changed ? 'updated' : 'existing',
    deduplicated: !!match,
    ...(match ? { matchedBy: match.matchedBy } : {}),
    title: record.metadata.title,
    attachmentCount: record.attachments.length,
    extractionStatus: record.extraction?.status ?? null,
    warnings,
    pendingUploads,
  };
}

export async function uploadBrowserAttachment(itemId: string, bytes: Uint8Array, input: Omit<BrowserConnectorAttachmentCandidate, 'url'> & { url?: string }): Promise<BrowserConnectorSaveResult> {
  if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_BYTES) throw new Error('The uploaded attachment must be between 1 byte and 64 MB.');
  if (input.mimeType?.split(';')[0].toLowerCase() === 'application/pdf' && !hasPdfSignature(bytes)) {
    throw new Error('The uploaded file was labelled as a PDF but did not contain a PDF document.');
  }
  const current = getGlobalLibraryItem(itemId);
  if (!current || current.deletedAt) throw new Error('The captured library item no longer exists.');
  const fileName = safeRemoteFileName(input.fileName || input.title, input.mimeType, input.url);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodus-browser-upload-'));
  const file = path.join(dir, fileName);
  try {
    await fs.promises.writeFile(file, bytes, { mode: 0o600 });
    const saved = await attachFile(itemId, file, input as BrowserConnectorAttachmentCandidate, input.role === 'original');
    return {
      ok: true,
      itemId: saved.id,
      disposition: saved.clock.revision === current.clock.revision ? 'existing' : 'updated',
      deduplicated: false,
      title: saved.metadata.title,
      attachmentCount: saved.attachments.length,
      extractionStatus: saved.extraction?.status ?? null,
      warnings: [],
      pendingUploads: [],
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
