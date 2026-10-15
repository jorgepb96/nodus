// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type { BrowserConnectorCaptureRequest } from '@shared/browserConnector';
import { normalizeLibraryMetadata } from '../library/libraryRecord';

const CAPTURE_SOURCES = new Set<BrowserConnectorCaptureRequest['metadataSource']>([
  'highwire', 'json-ld', 'coins', 'dublin-core', 'open-graph', 'direct-file', 'generic',
]);
const ATTACHMENT_ROLES = new Set<NonNullable<BrowserConnectorCaptureRequest['attachments']>[number]['role']>([
  'original', 'supplement', 'snapshot', 'image', 'dataset', 'other',
]);
const MAX_SNAPSHOT_CHARS = 6 * 1024 * 1024;

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

function sanitizedMetadata(value: unknown, pageUrl: string) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const scalarKeys = [
    'title', 'itemType', 'abstract', 'date', 'year', 'language', 'publisher', 'publicationTitle',
    'volume', 'issue', 'pages', 'edition', 'place', 'rights', 'doi', 'pmid', 'pmcid', 'arxiv',
  ] as const;
  const bounded: Record<string, unknown> = { url: safeWebUrl(source.url) ?? pageUrl };
  for (const key of scalarKeys) bounded[key] = source[key];
  bounded.creators = Array.isArray(source.creators) ? source.creators.slice(0, 128) : [];
  bounded.isbn = Array.isArray(source.isbn) ? source.isbn.slice(0, 32) : [];
  bounded.issn = Array.isArray(source.issn) ? source.issn.slice(0, 32) : [];
  bounded.tags = Array.isArray(source.tags) ? source.tags.slice(0, 256) : [];
  if (source.extra && typeof source.extra === 'object' && !Array.isArray(source.extra)) {
    bounded.extra = Object.fromEntries(Object.entries(source.extra as Record<string, unknown>).slice(0, 64));
  }
  return normalizeLibraryMetadata(bounded, pageUrl);
}

function decodeHtmlNumericEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);?/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function snapshotLooksPassive(html: string): boolean {
  const unsafeHref = /(?:^|[\s/])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const hasUnsafeHref = [...html.matchAll(unsafeHref)].some((match) => {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    const normalized = [...decodeHtmlNumericEntities(value)]
      .filter((character) => character.codePointAt(0)! > 0x20)
      .join('')
      .toLowerCase();
    return /^(?:javascript|file|data|vbscript|nodus):/.test(normalized);
  });
  return !/<\s*(?:script|iframe|object|embed|form|base|style)\b/i.test(html)
    && !/(?:^|[\s/])(?:on[a-z]+|srcdoc|style)\s*=/i.test(html)
    // Snapshots are stored and later rendered by the trusted Library reader. Do not
    // preserve remote media or resource-loading attributes from hostile page HTML.
    && !/(?:^|[\s/])(?:src|srcset|poster|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i.test(html)
    && !hasUnsafeHref;
}

/** Re-validate page-derived data before it reaches the Library or disk. */
export function sanitizeBrowserCaptureRequest(
  raw: unknown,
  expectedPageUrl?: string | null,
): BrowserConnectorCaptureRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const pageUrl = safeWebUrl(input.pageUrl);
  if (!pageUrl) return null;
  if (expectedPageUrl && safeWebUrl(expectedPageUrl) !== pageUrl) return null;
  const metadataSource = CAPTURE_SOURCES.has(input.metadataSource as never)
    ? input.metadataSource as BrowserConnectorCaptureRequest['metadataSource']
    : 'generic';
  const attachments = (Array.isArray(input.attachments) ? input.attachments : [])
    .slice(0, 8)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      const url = safeWebUrl(candidate.url);
      if (!url) return [];
      const role = ATTACHMENT_ROLES.has(candidate.role as never) ? candidate.role as never : undefined;
      const mimeType = clean(candidate.mimeType, 120).toLowerCase();
      return [{
        url,
        title: clean(candidate.title, 500) || 'Attachment',
        ...(clean(candidate.fileName, 240) ? { fileName: clean(candidate.fileName, 240) } : {}),
        ...(mimeType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType.split(';')[0]) ? { mimeType } : {}),
        ...(role ? { role } : {}),
        resolveFullText: candidate.resolveFullText === true,
      }];
    });
  const snapshotHtml = typeof input.snapshotHtml === 'string'
    && input.snapshotHtml.length <= MAX_SNAPSHOT_CHARS
    && snapshotLooksPassive(input.snapshotHtml)
    ? input.snapshotHtml
    : '';
  return {
    pageUrl,
    metadataSource,
    metadataReviewed: input.metadataReviewed === true,
    ...(/^[a-f0-9-]{36}:\d{1,2}$/.test(String(input.captureRequestId || '')) ? { captureRequestId: String(input.captureRequestId) } : {}),
    sourceIsResultPage: input.sourceIsResultPage === true,
    metadata: sanitizedMetadata(input.metadata, pageUrl),
    ...(clean(input.collectionId, 200) ? { collectionId: clean(input.collectionId, 200) } : {}),
    tags: (Array.isArray(input.tags) ? input.tags : []).slice(0, 256).map((entry) => clean(entry, 200)).filter(Boolean),
    attachments,
    snapshotHtml,
  };
}
