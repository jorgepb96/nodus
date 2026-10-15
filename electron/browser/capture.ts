// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Turning what a browser tab is showing into something Nodus keeps.
 *
 * Almost nothing is implemented here, on purpose. Nodus already has the whole
 * "web page in, Library item out" pipeline, built for the Chrome extension:
 *
 *   previewBrowserCapture / saveBrowserCapture  (browser-connector/libraryCapture)
 *     → createGlobalLibraryItem, DOI enrichment through resolveGlobalLibraryMetadata,
 *       PDF resolution through downloadLibraryFullText, attachment storage,
 *       and addGlobalLibraryAttachments, which enqueues extraction, OCR,
 *       indexing and embeddings.
 *
 * The browser's job is only to ASK the page for a snapshot and hand the result
 * to that pipeline. Building a second metadata path would mean two Library
 * ingest routes that must agree — which is exactly the parallel system the plan
 * ruled out.
 */

import { randomUUID } from 'node:crypto';
import type { BrowserConnectorCapturePreview, BrowserConnectorCapturePreviewItem, BrowserConnectorCaptureRequest, BrowserConnectorSaveResult } from '@shared/browserConnector';
import { previewBrowserCapture, saveBrowserCapture, uploadBrowserAttachment } from '../browser-connector/libraryCapture';
import { fetchThroughBrowserSession } from './sessionDownload';
import { activeTabSummary, collectFromTab } from './tabs';
import { sanitizeBrowserCaptureRequest } from '../browser-connector/sanitize';

export type BrowserCapturePreview = BrowserConnectorCapturePreview;

function clean(value: unknown, limit: number): string {
  return typeof value === 'string'
    // eslint-disable-next-line no-control-regex -- page metadata is hostile input
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
}

function safeWebUrl(value: unknown): string | null {
  const raw = clean(value, 4_096);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Ask the active tab for everything the Library needs to describe it. */
export async function captureActivePage(): Promise<BrowserCapturePreview | null> {
  const detected = await collectFromTab('capture');
  const expectedUrl = activeTabSummary()?.url;
  const rawCandidates = Array.isArray(detected) ? detected.slice(0, 50) : [detected];
  const previews = (await Promise.all(rawCandidates.map(async (raw): Promise<BrowserConnectorCapturePreviewItem | null> => {
    const request = sanitizeBrowserCaptureRequest(raw, expectedUrl);
    if (!request) return null;
    // Enrichment (DOI → provider-quality metadata) happens before review.
    const preview = await previewBrowserCapture(request);
    return {
      request: { ...request, metadata: preview.metadata, snapshotAvailable: Boolean(request.snapshotHtml) },
      warnings: preview.warnings,
    };
  }))).filter((entry): entry is BrowserConnectorCapturePreviewItem => entry !== null);
  if (!previews.length) return null;
  const first = previews[0];
  return { ...first, ...(previews.length > 1 ? { candidates: previews } : {}) };
}

/** Store a reviewed capture, with everything the existing pipeline does to it. */
export async function saveCapture(
  request: BrowserConnectorCaptureRequest,
  options: { includeSnapshot: boolean },
): Promise<BrowserConnectorSaveResult> {
  const safe = sanitizeBrowserCaptureRequest(request);
  if (!safe) throw new Error('The page capture contained an invalid or unsupported URL.');
  return saveBrowserCapture({
    ...safe,
    snapshotHtml: options.includeSnapshot ? safe.snapshotHtml : '',
  });
}

/** Whether the active tab is currently showing a PDF. */
export async function activePageIsPdf(): Promise<{ isPdf: boolean; url: string }> {
  const result = await collectFromTab('pdf');
  const payload = (result ?? {}) as { isPdf?: unknown; url?: unknown };
  const url = safeWebUrl(payload.url) ?? '';
  return { isPdf: payload.isPdf === true && Boolean(url), url };
}

/**
 * Fetch a PDF the tab is already showing, and attach it to a Library item.
 *
 * The bytes are fetched through the BROWSER session rather than with a plain
 * request, because a paywalled PDF is only reachable with that session's
 * cookies. A second, session-less request would 403 — or, worse on a metered
 * institutional licence, spend another access against the user's quota.
 */
export async function importPdfIntoItem(itemId: string, url: string, title: string): Promise<BrowserConnectorSaveResult> {
  const safeUrl = safeWebUrl(url);
  if (!safeUrl) throw new Error('Only HTTP(S) documents can be imported from Browser.');
  const bytes = await fetchThroughBrowserSession(safeUrl);
  return uploadBrowserAttachment(itemId, bytes, {
    title: clean(title, 500) || 'PDF',
    mimeType: 'application/pdf',
    role: 'original',
    url: safeUrl,
  });
}

/** A request id for a page collection, so replies can be matched to askers. */
export function captureRequestId(): string {
  return `capture-${randomUUID()}`;
}
