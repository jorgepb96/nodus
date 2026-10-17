// PDF Presenter — pdfjs setup for the renderer, shared by every presenter surface
// (library thumbnails now; audience/presenter windows later). Uses the bundled
// pdfjs-dist + local worker (never a CDN) so the tool stays fully offline, and
// loads the PDF bytes over IPC (contextIsolation blocks file:// from the renderer).
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

/**
 * Load a presentation's PDF into a pdfjs document. The caller owns the returned
 * doc and MUST `destroy()` it when done (one live doc per surface — keeping many
 * open is the fast path to exhausting memory on a several-hundred-page deck).
 */
export async function loadPresenterPdf(id: string): Promise<PDFDocumentProxy | null> {
  const bytes = await window.nodus.getPresenterPdfData(id);
  if (!bytes) return null;
  // pdfjs takes ownership of the buffer; hand it a fresh Uint8Array.
  return loadPdfBytes(bytes);
}

/** Shared offline byte loader for local PDF tools; callers own and destroy the proxy. */
export function loadPdfBytes(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(bytes) }).promise;
}
