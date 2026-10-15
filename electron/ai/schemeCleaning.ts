import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { cleanChunkText, type PageLayoutLines } from '@shared/schemeText';
import type { RetrievalChunk } from '@shared/retrievalChunks';
import { pageTextHash } from '../extraction/schemeSidecar';

/**
 * Scheme decluttering of passages (see electron/extraction/schemeLayout.ts). Layout files
 * made by scripts/build-scheme-layout.mjs sit in <userData>/scheme-layout, each mapping the
 * hash of a page's extracted text to that page's scheme and margin lines. A document's pages
 * are looked up by their own text, so a layout applies only where the text is exactly what it
 * was made from: an OCR'd page, another edition or another file never matches. A document with
 * no matching page is prepared exactly as before.
 */

export const SCHEME_LAYOUT_DIR = 'scheme-layout';

interface LayoutFile { version: number; pages: Record<string, PageLayoutLines> }

let cache: { stamp: string; pages: Map<string, PageLayoutLines> } | null = null;

function layoutDir(): string {
  return path.join(app.getPath('userData'), SCHEME_LAYOUT_DIR);
}

function layoutPages(): Map<string, PageLayoutLines> {
  const dir = layoutDir();
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort(); } catch { return new Map(); }
  const stamp = files.map((name) => `${name}:${fs.statSync(path.join(dir, name)).mtimeMs}`).join('|');
  if (cache?.stamp === stamp) return cache.pages;
  const pages = new Map<string, PageLayoutLines>();
  for (const name of files) {
    try {
      const file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as LayoutFile;
      for (const [hash, lines] of Object.entries(file.pages ?? {})) pages.set(hash, lines);
    } catch (error) {
      console.warn(`[scheme-layout] unreadable ${name}:`, error instanceof Error ? error.message : String(error));
    }
  }
  cache = { stamp, pages };
  return pages;
}

const MARKER = /\[\[src:([^\]\s]+)(?:\s+p\.\s*(\d+))?\]\]|\[\[p\.\s*(\d+)\]\]/gi;

/** Each page of a document text: its source (as the chunker names it), page and text. */
export function documentPages(text: string, sourceMap: Record<string, string> = {}): Array<{ sourceRef: string | null; page: number | null; text: string }> {
  const out: Array<{ sourceRef: string | null; page: number | null; text: string }> = [];
  let sourceRef: string | null = null;
  let page: number | null = null;
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    if (match.index! > last) out.push({ sourceRef, page, text: text.slice(last, match.index) });
    if (match[1]) { sourceRef = sourceMap[match[1]] ?? match[1]; page = match[2] ? Number(match[2]) : null; }
    else page = Number(match[3]);
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ sourceRef, page, text: text.slice(last) });
  return out.filter((entry) => entry.text.trim());
}

export interface SchemeCleaning {
  /** Identifies the layouts applied; part of the index identity so a cleaned index never
   *  reuses an uncleaned one's chunks or vectors. */
  signature: string;
  pages: number;
  clean<T extends Pick<RetrievalChunk, 'text' | 'sourceRef' | 'pageNumber' | 'pageStarts'>>(chunk: T): T;
}

export function schemeCleaningFor(text: string, sourceMap: Record<string, string> = {}): SchemeCleaning | null {
  const known = layoutPages();
  if (!known.size) return null;
  const byPage = new Map<string, PageLayoutLines>();
  const matched: string[] = [];
  for (const entry of documentPages(text, sourceMap)) {
    if (entry.page == null) continue;
    const hash = pageTextHash(entry.text);
    const lines = known.get(hash);
    if (!lines) continue;
    byPage.set(`${entry.sourceRef ?? ''}\u0000${entry.page}`, lines);
    matched.push(hash);
  }
  if (!matched.length) return null;
  const signature = `scheme-layout/1:${createHash('sha256').update(matched.join('\n')).digest('hex').slice(0, 32)}`;
  return {
    signature,
    pages: matched.length,
    clean: (chunk) => {
      const text = cleanChunkText(chunk.text, chunk.pageNumber, chunk.pageStarts, (page) => byPage.get(`${chunk.sourceRef ?? ''}\u0000${page}`) ?? null);
      return text === chunk.text ? chunk : { ...chunk, text };
    },
  };
}
