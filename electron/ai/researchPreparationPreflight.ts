import fs from 'node:fs';
import { isDocumentaryTextMime } from '@shared/documentaryFormats';
import type { ResearchPreparationInventory, ResearchPreparationPreview } from '@shared/researchCorpus';
import { getGlobalLibraryItem, globalLibraryAttachmentPath } from '../library/libraryService';
import { inspectResearchOriginalInWorker } from '../library/libraryExtractionWorkerHost';
import { attachmentFilePath, itemChildren } from '../zotero/zoteroClient';

/** Inventory inspection has no side effects on sources and no model calls. An
 * unavailable endpoint/worker stays unknown rather than promising full text. */
export async function preparationPreflight(documents: ResearchPreparationInventory['documents']): Promise<NonNullable<ResearchPreparationPreview['preflight']>> {
  const results: NonNullable<ResearchPreparationPreview['preflight']> = [];
  for (const document of documents) {
    const entry: typeof results[number] = { documentId: document.id, status: 'available', pages: null, reason: null };
    try {
      const files: Array<{ file: string | null; mime: string; sha256?: string }> = [];
      if (document.libraryItemId) {
        const item = getGlobalLibraryItem(document.libraryItemId);
        if (!item || item.deletedAt) throw new Error('research_source_not_authorized');
        for (const attachment of item.attachments) {
          if (!isDocumentaryTextMime(attachment.mimeType)) continue;
          let file: string | null = null;
          try { file = globalLibraryAttachmentPath(item.id, attachment.id); } catch { /* Report inaccessible. */ }
          files.push({ file, mime: attachment.mimeType!, sha256: attachment.sha256 });
        }
      } else if (document.origin.kind === 'zotero') {
        const origin = document.origin;
        const signal = AbortSignal.timeout(15000);
        const key = origin.libraryType === 'group' ? `groups:${origin.libraryId}:${origin.itemKey}` : origin.itemKey;
        for (const attachment of await itemChildren(origin.libraryId, key, signal)) {
          if (!isDocumentaryTextMime(attachment.contentType)) continue;
          files.push({ file: await attachmentFilePath(origin.libraryId, attachment.key, attachment.library, signal), mime: attachment.contentType! });
        }
      }
      if (!files.length) {
        entry.status = document.coverage === 'abstract' ? 'abstract' : 'unknown';
        entry.reason = 'no_attachment';
      }
      for (const file of files) {
        if (!file.file) { entry.status = 'inaccessible'; entry.reason = 'not_downloaded'; continue; }
        try { await fs.promises.access(file.file, fs.constants.R_OK); }
        catch { entry.status = 'inaccessible'; entry.reason = 'inaccessible'; continue; }
        if (file.mime !== 'application/pdf') continue;
        if (document.preparation.lexical === 'ready' && document.preparation.text === 'available') continue;
        const inspected = await inspectResearchOriginalInWorker({ file: file.file, sha256: file.sha256 });
        entry.pages = (entry.pages ?? 0) + inspected.pages;
        if (inspected.needsOcr && entry.status !== 'inaccessible') { entry.status = 'ocr_pending'; entry.reason = 'documentary_ocr_deferred'; }
      }
    } catch (error) {
      if (entry.status === 'available') entry.status = 'unknown';
      entry.reason = error instanceof Error && /^research_|^documentary_/.test(error.message) ? error.message : 'inspection_unavailable';
    }
    results.push(entry);
  }
  return results;
}
