import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { LibraryCatalogItem, LibraryCollectionView, LibraryItemRecord } from '@shared/libraryTypes';
import type { WritingDraftAnnotation } from '@shared/types';
import type { ServerPersonalLibraryAnnotation } from '@shared/serverPublication';
import {
  getGlobalLibraryItem,
  listGlobalLibraryCollections,
  listGlobalLibraryItems,
} from '../library/libraryService';
import {
  getLibraryReaderRawContent,
  libraryReaderOriginalPath,
  listLibraryReaderAnnotations,
} from '../libraryReader/libraryReaderStore';

/**
 * The global library is independent from every vault database. Its catalogue therefore
 * cannot be added to CORE_TABLES: it is projected here and attached to each opted-in space.
 * Clean Markdown and figures travel as one content-addressed ZIP per document, while this
 * manifest remains small enough to search and paginate without downloading any document.
 */

export const SERVER_LIBRARY_FORMAT = 'nodus.server-library';
export const SERVER_LIBRARY_VERSION = 1;
const PAGE_SIZE = 500;
const MAX_FIGURE_BYTES = 8 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 96 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};
const ORIGINAL_EXTENSIONS = new Set([
  '.pdf', '.epub', '.md', '.markdown', '.txt', '.csv', '.tsv', '.xml', '.jats', '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.tif', '.tiff',
  '.docx', '.odt', '.rtf', '.pptx', '.odp', '.xlsx', '.ods',
]);

export interface PublishedLibraryCollection {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  parentId: string | null;
  position: number;
  directItemCount: number;
  updatedAt: string;
}

export interface PublishedLibraryDocument {
  id: string;
  title: string;
  itemType: string;
  creators: string[];
  abstract: string | null;
  date: string | null;
  year: number | null;
  language: string | null;
  publisher: string | null;
  publicationTitle: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  edition: string | null;
  place: string | null;
  rights: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxiv: string | null;
  isbn: string[];
  issn: string[];
  url: string | null;
  citationKey: string | null;
  reference: string;
  tags: string[];
  collectionIds: string[];
  updatedAt: string;
  cleanAvailable: boolean;
  wordCount: number;
  figureCount: number;
  packageHash: string | null;
  packageBytes: number | null;
  originalAvailable: boolean;
  originalFileName: string | null;
  originalMimeType: string | null;
  originalBytes: number | null;
  /** @deprecated Local compatibility accessor; deliberately non-enumerable. */
  annotations?: WritingDraftAnnotation[];
}

export interface PublishedLibraryManifest {
  format: typeof SERVER_LIBRARY_FORMAT;
  formatVersion: typeof SERVER_LIBRARY_VERSION;
  generatedAt: string;
  collections: PublishedLibraryCollection[];
  documents: PublishedLibraryDocument[];
}

export interface ServerLibraryPackage {
  hash: string;
  bytes: number;
  data: Buffer;
  documentId: string;
}

export interface BuiltServerLibraryPublication {
  manifest: PublishedLibraryManifest;
  packages: ServerLibraryPackage[];
  /** Personal reader state; never part of the canonical library manifest. */
  personalAnnotations: ServerPersonalLibraryAnnotation[];
}

function creatorName(value: LibraryCatalogItem['creators'][number]): string {
  return value.name?.trim() || [value.firstName, value.lastName].filter(Boolean).join(' ').trim();
}

function publicCollection(value: LibraryCollectionView): PublishedLibraryCollection {
  return {
    id: value.id,
    name: value.name,
    icon: value.icon,
    color: value.color,
    parentId: value.parentId,
    position: value.position,
    directItemCount: value.directItemCount,
    updatedAt: value.updatedAt,
  };
}

export function allServerLibraryItems(vaultId?: string): LibraryCatalogItem[] {
  const values: LibraryCatalogItem[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = listGlobalLibraryItems({ vaultId, limit: PAGE_SIZE, offset, includeFacets: false, sort: [{ field: 'title', direction: 'asc' }] });
    values.push(...page.items);
    if (values.length >= page.total || page.items.length === 0) break;
  }
  return values;
}

function staysInside(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return false;
  try {
    const realBase = fs.realpathSync.native(base);
    const realTarget = fs.realpathSync.native(target);
    return realTarget === realBase || realTarget.startsWith(`${realBase}${path.sep}`);
  } catch {
    return false;
  }
}

function markdownFigures(markdown: string): string[] {
  const found = new Set<string>();
  const expression = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of markdown.matchAll(expression)) {
    const raw = (match[1] || match[2] || '').trim();
    if (!raw || /^(?:data:|https?:|nodus:)/i.test(raw)) continue;
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* keep the literal path */ }
    const normalized = decoded.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized.startsWith('assets/') || normalized.includes('\0')) continue;
    found.add(normalized);
  }
  return [...found].sort();
}

function bibliographicReference(item: LibraryCatalogItem): string {
  const creators = item.creators.map(creatorName).filter(Boolean);
  const author = creators.length > 2
    ? `${creators[0]} et al.`
    : creators.length === 2 ? `${creators[0]} & ${creators[1]}` : creators[0] ?? '';
  const year = item.year ?? item.date?.trim() ?? 's. f.';
  const container = item.metadata.publicationTitle?.trim() || item.metadata.publisher?.trim() || '';
  const volumeIssue = [item.metadata.volume?.trim(), item.metadata.issue?.trim() ? `(${item.metadata.issue.trim()})` : ''].join('');
  const location = [container, volumeIssue, item.metadata.pages?.trim()].filter(Boolean).join(', ');
  const identifier = item.doi ? `https://doi.org/${item.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}` : item.metadata.url?.trim() || '';
  return [author ? `${author} (${year}).` : `(${year}).`, `${item.title}.`, location ? `${location}.` : '', identifier]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function originalMetadata(record: LibraryItemRecord): {
  available: boolean;
  fileName: string | null;
  mimeType: string | null;
  bytes: number | null;
  path: string | null;
} {
  const original = record.attachments.find((attachment) => attachment.role === 'original');
  const originalPath = libraryReaderOriginalPath(record.id);
  let stat: fs.Stats | null = null;
  try { stat = originalPath ? fs.statSync(originalPath) : null; } catch { stat = null; }
  const extension = originalPath ? path.extname(originalPath).toLowerCase() : '';
  const available = Boolean(
    original && originalPath && stat?.isFile() && stat.size > 0 && stat.size <= MAX_ORIGINAL_BYTES
    && ORIGINAL_EXTENSIONS.has(extension)
    && original.sourceState !== 'not-downloaded' && original.sourceState !== 'source-missing'
  );
  return {
    available,
    fileName: available ? original?.fileName ?? path.basename(originalPath!) : null,
    mimeType: available ? original?.mimeType ?? null : null,
    bytes: available ? stat!.size : null,
    path: available ? originalPath : null,
  };
}

function packageFor(item: LibraryCatalogItem, record: LibraryItemRecord): {
  value: ServerLibraryPackage | null;
  wordCount: number;
  figureCount: number;
  cleanAvailable: boolean;
  originalIncluded: boolean;
} {
  const raw = getLibraryReaderRawContent(item.id);
  const original = originalMetadata(record);
  const markdown = raw?.markdown.trim() ? raw.markdown.replace(/\r\n/g, '\n') : null;
  if (!markdown && !original.available) {
    return { value: null, wordCount: 0, figureCount: 0, cleanAvailable: false, originalIncluded: false };
  }

  const zip = new AdmZip();
  if (markdown) zip.addFile('document.md', Buffer.from(markdown, 'utf8'));
  let packageBytes = markdown ? Buffer.byteLength(markdown) : 0;
  let figureCount = 0;
  if (markdown && raw) {
    const readerPath = record.files?.reader || 'reader.md';
    const readerDirectory = path.dirname(path.join(raw.folder, readerPath));
    for (const relative of markdownFigures(markdown)) {
      const source = path.resolve(readerDirectory, relative);
      const extension = path.extname(source).toLowerCase();
      if (!IMAGE_MIME[extension] || !staysInside(raw.folder, source)) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(source); } catch { continue; }
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FIGURE_BYTES) continue;
      if (packageBytes + stat.size > MAX_PACKAGE_BYTES) break;
      const bytes = fs.readFileSync(source);
      zip.addFile(relative, bytes);
      packageBytes += bytes.length;
      figureCount += 1;
    }
  }
  let packagedOriginal: { path: string; fileName: string; mimeType: string | null; bytes: number } | null = null;
  if (original.available && original.path && original.bytes && packageBytes + original.bytes <= MAX_PACKAGE_BYTES) {
    const extension = path.extname(original.path).toLowerCase();
    const packagePath = `original/document${extension}`;
    const bytes = fs.readFileSync(original.path);
    zip.addFile(packagePath, bytes);
    packageBytes += bytes.length;
    packagedOriginal = {
      path: packagePath,
      fileName: original.fileName ?? path.basename(original.path),
      mimeType: original.mimeType,
      bytes: bytes.length,
    };
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'nodus.library-document-package',
    formatVersion: 2,
    documentId: item.id,
    title: item.title,
    contentFingerprint: record.contentRevision?.contentFingerprint ?? null,
    figures: figureCount,
    cleanMarkdown: Boolean(markdown),
    original: packagedOriginal,
  }, null, 2), 'utf8'));
  // adm-zip stamps new entries with the current time. Normalise those timestamps so the
  // same Clean Markdown produces the same package hash on every publication.
  const deterministicTime = new Date('1980-01-01T00:00:00.000Z');
  for (const entry of zip.getEntries()) entry.header.time = deterministicTime;
  const data = zip.toBuffer();
  if (data.length > MAX_PACKAGE_BYTES) {
    return { value: null, wordCount: 0, figureCount: 0, cleanAvailable: false, originalIncluded: false };
  }
  const hash = createHash('sha256').update(data).digest('hex');
  return {
    value: { hash, bytes: data.length, data, documentId: item.id },
    wordCount: markdown?.split(/\s+/u).filter(Boolean).length ?? 0,
    figureCount,
    cleanAvailable: Boolean(markdown),
    originalIncluded: Boolean(packagedOriginal),
  };
}

/** Build the complete global-library projection for one opted-in space. */
export function buildServerLibraryPublication(now = new Date().toISOString(), options: { items?: LibraryCatalogItem[]; includePackages?: boolean } = {}): BuiltServerLibraryPublication {
  const packages: ServerLibraryPackage[] = [];
  const documents: PublishedLibraryDocument[] = [];
  const personalAnnotations: ServerPersonalLibraryAnnotation[] = [];
  for (const item of options.items ?? allServerLibraryItems()) {
    const record = getGlobalLibraryItem(item.id);
    if (!record || record.deletedAt) continue;
    const original = originalMetadata(record);
    const raw = options.includePackages === false ? getLibraryReaderRawContent(item.id) : null;
    const built = options.includePackages === false ? {
      value: null, wordCount: raw?.markdown.split(/\s+/u).filter(Boolean).length ?? 0,
      figureCount: raw ? markdownFigures(raw.markdown).length : 0,
      cleanAvailable: Boolean(raw?.markdown.trim()), originalIncluded: original.available,
    } : packageFor(item, record);
    if (built.value) packages.push(built.value);
    const annotations = listLibraryReaderAnnotations(item.id);
    for (const annotation of annotations) {
      personalAnnotations.push({ documentId: item.id, annotation: annotation as unknown as Record<string, unknown> });
    }
    const document: PublishedLibraryDocument = {
      id: item.id,
      title: item.title,
      itemType: item.itemType,
      creators: item.creators.map(creatorName).filter(Boolean),
      abstract: item.metadata.abstract?.trim() || null,
      date: item.date,
      year: item.year,
      language: item.metadata.language?.trim() || null,
      publisher: item.metadata.publisher?.trim() || null,
      publicationTitle: item.metadata.publicationTitle?.trim() || null,
      volume: item.metadata.volume?.trim() || null,
      issue: item.metadata.issue?.trim() || null,
      pages: item.metadata.pages?.trim() || null,
      edition: item.metadata.edition?.trim() || null,
      place: item.metadata.place?.trim() || null,
      rights: item.metadata.rights?.trim() || null,
      doi: item.doi,
      pmid: item.metadata.pmid?.trim() || null,
      pmcid: item.metadata.pmcid?.trim() || null,
      arxiv: item.metadata.arxiv?.trim() || null,
      isbn: item.isbn,
      issn: item.issn,
      url: item.metadata.url?.trim() || null,
      citationKey: item.citationKey,
      reference: bibliographicReference(item),
      tags: item.tags,
      collectionIds: item.collectionIds,
      updatedAt: item.updatedAt,
      cleanAvailable: built.cleanAvailable,
      wordCount: built.wordCount,
      figureCount: built.figureCount,
      packageHash: built.value?.hash ?? null,
      packageBytes: built.value?.bytes ?? null,
      originalAvailable: built.originalIncluded,
      originalFileName: built.originalIncluded ? original.fileName : null,
      originalMimeType: built.originalIncluded ? original.mimeType : null,
      originalBytes: built.originalIncluded ? original.bytes : null,
    };
    // Existing local callers still read this field, but it must not enter the
    // canonical manifest, revision hash or wire payload.
    Object.defineProperty(document, 'annotations', { value: annotations, enumerable: false, writable: false });
    documents.push(document);
  }
  return {
    manifest: {
      format: SERVER_LIBRARY_FORMAT,
      formatVersion: SERVER_LIBRARY_VERSION,
      generatedAt: now,
      collections: listGlobalLibraryCollections().map(publicCollection),
      documents,
    },
    packages,
    personalAnnotations,
  };
}
