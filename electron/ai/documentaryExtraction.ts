import { app } from 'electron';
import { isDocumentaryTextMime } from '@shared/documentaryFormats';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LibraryExtractionOptions, LibrarySourceMap } from '@shared/libraryTypes';
import { LibraryDiskStore } from '../library/libraryStorage';
import type { LibraryExtractionProgressHandler } from '../library/libraryExtractionEngine';
import { extractLibraryItemInWorker, libraryExtractionWorkerAvailable } from '../library/libraryExtractionWorkerHost';
import { itemChildren, attachmentFilePath, itemAsAttachment } from '../zotero/zoteroClient';
import { researchFingerprint } from './researchCorpusScope';
import { getGlobalLibraryItem, globalLibraryAttachmentPath } from '../library/libraryService';
export { readDocumentarySourceMap } from '../library/librarySourcePages';

/** Indexing reads text only. Figures and table crops would be rendered page by page and
 * then discarded with the staging folder, leaving dangling `![…](assets/…)` lines. */
export const DOCUMENTARY_EXTRACTION_OPTIONS: Partial<LibraryExtractionOptions> = { ocrMode: 'off', localOcrOnly: true, maxOcrPages: 0, extractImages: false };

export interface DocumentarySourcePart { text: string; sourceMap: Record<string, string>; attachmentId: string; attachmentRevision: string }

/** Preserve physical anchors only when the extraction map matches these bytes. */
export function documentarySourceText(markdown: string, map: LibrarySourceMap | null, marker: string): string {
  if (!map || map.reader.sha256 !== createHash('sha256').update(markdown).digest('hex')) return `[[src:${marker}]]\n${markdown}`;
  let position = 0;
  const parts: string[] = [];
  for (const block of [...map.blocks].sort((a, b) => a.markdown.start - b.markdown.start)) {
    const start = block.markdown.start;
    if (!Number.isInteger(start) || start < position || start > markdown.length) continue;
    const page = block.anchors[0]?.page;
    parts.push(markdown.slice(position, start), `\n[[src:${marker}${Number.isInteger(page) && page > 0 ? ` p. ${page}` : ''}]]\n`);
    position = start;
  }
  parts.push(markdown.slice(position));
  return parts.join('');
}

export function documentaryReaderComplete(folder: string, relativePath?: string): boolean {
  if (!relativePath) return false;
  try {
    const root = fs.realpathSync(folder);
    const target = fs.realpathSync(path.resolve(root, relativePath));
    if (!target.startsWith(`${root}${path.sep}`) || fs.statSync(target).size > 1024 * 1024) return false;
    const quality = JSON.parse(fs.readFileSync(target, 'utf8'));
    return quality.blankPages === 0 && ['passed', 'needs-review'].includes(quality.status);
  } catch { return false; }
}

async function fileHash(filename: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const data of fs.createReadStream(filename)) hash.update(data);
  return hash.digest('hex');
}

/** Use the existing clean-document worker in a disposable staging store. This
 * creates no Global Library item or vault migration and never discovers storage
 * directories: every input path comes from an authorized Zotero attachment. */
export async function extractTraditionalResearchWork(userId: string, key: string, itemType: string, signal?: AbortSignal, extractionOptions: Partial<LibraryExtractionOptions> = DOCUMENTARY_EXTRACTION_OPTIONS, onProgress?: LibraryExtractionProgressHandler): Promise<{ text: string; sourceMap: Record<string, string>; parts: DocumentarySourcePart[] }> {
  if (!libraryExtractionWorkerAvailable()) throw new Error('documentary_extraction_worker_unavailable');
  signal?.throwIfAborted();
  const attachments = itemType === 'attachment' ? [await itemAsAttachment(userId, key)].filter(item => item != null) : await itemChildren(userId, key, signal);
  const stagingParent = path.join(app.getPath('userData'), 'documentary', 'staging');
  await fs.promises.mkdir(stagingParent, { recursive: true });
  const root = await fs.promises.mkdtemp(path.join(stagingParent, 'extract-'));
  const store = new LibraryDiskStore(root, 'documentary-extraction');
  const texts: string[] = [];
  const parts: DocumentarySourcePart[] = [];
  const sourceMap: Record<string, string> = {};
  try {
    for (const attachment of attachments) {
      signal?.throwIfAborted();
      if (!attachment || !attachment.contentType || !isDocumentaryTextMime(attachment.contentType)) continue;
      const source = await attachmentFilePath(userId, attachment.key, attachment.library, signal);
      if (!source) continue;
      const stat = await fs.promises.stat(source);
      if (stat.size > 256 * 1024 * 1024) throw new Error('documentary_attachment_too_large');
      const id = randomUUID();
      const folder = store.itemFolder(id);
      await fs.promises.mkdir(folder, { recursive: true });
      const relativePath = `source${path.extname(source)}`;
      const staged = path.join(folder, relativePath);
      const before = await fileHash(source);
      await fs.promises.copyFile(source, staged, fs.constants.COPYFILE_EXCL);
      if (before !== await fileHash(staged)) throw new Error('research_source_revision_changed');
      const item = store.upsertItem({ id, storageId: id, source: 'nodus', metadata: { title: attachment.title, itemType: 'document', creators: [] }, collectionIds: [],
        attachments: [{ id: attachment.key, title: attachment.title, fileName: relativePath, relativePath, mimeType: attachment.contentType,
          byteSize: stat.size, sha256: before, role: 'original', sourceKey: attachment.key, sourceVersion: attachment.version }] });
      const result = await extractLibraryItemInWorker({ item, store, signal, extractionOptions, onProgress });
      if (before !== await fileHash(source)) throw new Error('research_source_revision_changed');
      const markdown = await fs.promises.readFile(path.join(folder, result.item.files?.reader ?? 'reader.md'), 'utf8');
      const marker = `attachment-${texts.length}`;
      sourceMap[marker] = `zotero:${attachment.library.type}:${attachment.library.id}:${attachment.key}`;
      const text = documentarySourceText(markdown, result.sourceMap, marker);
      texts.push(text);
      parts.push({ text, sourceMap: { [marker]: sourceMap[marker] }, attachmentId: attachment.key,
        attachmentRevision: researchFingerprint([before, attachment.version]) });
    }
    return { text: texts.join('\n\n'), sourceMap, parts };
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}

/** Extract each authorized Global attachment independently. The clean-document
 * worker normally chooses a primary attachment; a research corpus needs every
 * eligible attachment, with its own fingerprint and original source locator. */
export async function extractGlobalResearchAttachments(itemId: string, signal?: AbortSignal, extractionOptions: Partial<LibraryExtractionOptions> = DOCUMENTARY_EXTRACTION_OPTIONS, onProgress?: LibraryExtractionProgressHandler): Promise<DocumentarySourcePart[]> {
  const item = getGlobalLibraryItem(itemId);
  if (!item || item.deletedAt) throw new Error('research_source_not_authorized');
  const parts: DocumentarySourcePart[] = [];
  const parent = path.join(app.getPath('userData'), 'documentary', 'staging');
  await fs.promises.mkdir(parent, { recursive: true });
  const root = await fs.promises.mkdtemp(path.join(parent, 'attachments-'));
  const store = new LibraryDiskStore(root, 'documentary-extraction');
  try {
    for (const attachment of item.attachments) {
      signal?.throwIfAborted();
      if (!isDocumentaryTextMime(attachment.mimeType)) continue;
      const source = globalLibraryAttachmentPath(itemId, attachment.id);
      const stat = await fs.promises.stat(source);
      if (stat.size > 256 * 1024 * 1024) throw new Error('documentary_attachment_too_large');
      const hash = await fileHash(source);
      if (hash !== attachment.sha256) throw new Error('research_source_revision_changed');
      const id = randomUUID();
      const folder = store.itemFolder(id);
      await fs.promises.mkdir(folder, { recursive: true });
      const relativePath = `source${path.extname(source)}`;
      await fs.promises.copyFile(source, path.join(folder, relativePath), fs.constants.COPYFILE_EXCL);
      if (hash !== await fileHash(path.join(folder, relativePath))) throw new Error('research_source_revision_changed');
      const staged = store.upsertItem({ id, storageId: id, source: 'nodus', metadata: item.metadata, collectionIds: [],
        attachments: [{ ...attachment, relativePath, role: 'original' }] });
      const extracted = await extractLibraryItemInWorker({ item: staged, store, signal, extractionOptions, onProgress });
      if (hash !== await fileHash(source)) throw new Error('research_source_revision_changed');
      const markdown = await fs.promises.readFile(path.join(folder, extracted.item.files?.reader ?? 'reader.md'), 'utf8');
      const marker = `attachment-${parts.length}`;
      parts.push({ text: documentarySourceText(markdown, extracted.sourceMap, marker),
        sourceMap: { [marker]: `library:${itemId}:${attachment.id}` }, attachmentId: attachment.id,
        attachmentRevision: researchFingerprint([attachment.sha256, attachment.sourceVersion]) });
    }
    return parts;
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}
