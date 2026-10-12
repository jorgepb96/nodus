import { ChatSkillsControl } from '../components/ChatSkillsControl';
import { ChatAbortedNotice } from '../components/ChatAbortedNotice';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  AppSettings,
  LibraryReaderDocument,
  LibraryReaderChatMessage,
  LibraryReaderReference,
  ModelRef,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { ASSISTANT_CONTEXTS, type PendingAssistantNavigationTarget } from '../navigation';
import { FindInPage } from '../components/FindInPage';
import { Markdown, type MarkdownCitation, type MarkdownReaderCitation } from '../components/Markdown';
import { ModelPicker } from '../components/ModelPicker';
import { NodiViewContextSource } from '../components/NodiViewContextSource';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { LibraryAttachmentViewer } from '../components/library/LibraryAttachmentViewer';
import {
  READER_ANNOTATION_COLORS,
  ReaderHighlighterControl,
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from '../components/ReaderSelectionActions';
import { HoverLabelButton, Icon, ModalBackdrop, Spinner } from '../components/ui';
import { confirm } from '../components/feedback';
import { errorText, t, tx } from '../i18n';

GlobalWorkerOptions.workerSrc = pdfWorker;

function readingPositionKey(storageId: string): string {
  return `nodus.libraryReader.position.${storageId}`;
}

type ReaderOpeningFormat = 'clean' | 'original';

const READER_OPENING_FORMAT_KEY = 'nodus.libraryReader.openingFormat';

function readOpeningFormatPreference(): ReaderOpeningFormat | null {
  try {
    const value = localStorage.getItem(READER_OPENING_FORMAT_KEY);
    return value === 'clean' || value === 'original' ? value : null;
  } catch {
    return null;
  }
}

function writeOpeningFormatPreference(value: ReaderOpeningFormat | null): void {
  try {
    if (value) localStorage.setItem(READER_OPENING_FORMAT_KEY, value);
    else localStorage.removeItem(READER_OPENING_FORMAT_KEY);
  } catch {
    // A blocked localStorage must never prevent the document from opening.
  }
}

function primaryOriginalAttachment(reader: LibraryReaderDocument) {
  return reader.attachments.find((attachment) => attachment.available && attachment.role === 'original')
    ?? reader.attachments.find((attachment) => attachment.available && attachment.fileName === reader.originalFileName)
    ?? null;
}

function findTextRange(root: HTMLElement, annotation: WritingDraftAnnotation): Range | null {
  const content = root.textContent || '';
  const candidates: number[] = [];
  let from = 0;
  while (from <= content.length) {
    const index = content.indexOf(annotation.selectedText, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + Math.max(1, annotation.selectedText.length);
  }
  if (!candidates.length) return null;
  const index = candidates.sort((a, b) => {
    const score = (at: number) => {
      let value = -Math.abs(at - annotation.startOffset) / Math.max(1, content.length);
      if (annotation.prefix && content.slice(Math.max(0, at - annotation.prefix.length), at) === annotation.prefix) value += 2;
      if (annotation.suffix && content.slice(at + annotation.selectedText.length, at + annotation.selectedText.length + annotation.suffix.length) === annotation.suffix) value += 2;
      return value;
    };
    return score(b) - score(a);
  })[0];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const next = offset + text.data.length;
    if (!started && index >= offset && index <= next) {
      range.setStart(text, Math.min(text.data.length, index - offset));
      started = true;
    }
    const end = index + annotation.selectedText.length;
    if (started && end >= offset && end <= next) {
      range.setEnd(text, Math.min(text.data.length, end - offset));
      return range;
    }
    offset = next;
    node = walker.nextNode();
  }
  return null;
}

function anchorForElement(root: HTMLElement, element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const selectedText = range.toString();
  const startOffset = before.toString().length;
  const endOffset = startOffset + selectedText.length;
  const content = root.textContent || '';
  return {
    startOffset,
    endOffset,
    selectedText,
    prefix: content.slice(Math.max(0, startOffset - 64), startOffset),
    suffix: content.slice(endOffset, endOffset + 64),
  };
}

function sameAnnotationAnchor(left: WritingDraftAnnotation, right: WritingDraftAnnotation): boolean {
  return left.scope === right.scope
    && left.kind === right.kind
    && left.color === right.color
    && left.startOffset === right.startOffset
    && left.endOffset === right.endOffset
    && left.selectedText === right.selectedText;
}

const ReaderMarkdownDocument = memo(function ReaderMarkdownDocument({ content }: { content: string }) {
  return <Markdown content={content} verify={false} allowDataImages className="text-[16px] leading-[1.85] text-neutral-300" />;
});

function ReaderOpeningFormatDialog({
  reader,
  originalAttachment,
  remember,
  onRememberChange,
  onChoose,
  onCancel,
}: {
  reader: LibraryReaderDocument;
  originalAttachment: LibraryReaderDocument['attachments'][number] | null;
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  onChoose: (format: ReaderOpeningFormat) => void;
  onCancel: () => void;
}) {
  return (
    <ModalBackdrop onClose={onCancel} zIndex={150}>
      <section
        data-testid="library-reader-format-dialog"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-reader-format-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300"><Icon name="bookOpen" size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="library-reader-format-title" className="text-base font-semibold">{t('¿Cómo quieres leer este documento?')}</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t('Podrás cambiar de formato en cualquier momento desde Versiones y archivos.')}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0" aria-label={t('Cancelar')} title={t('Cancelar')} onClick={onCancel}><Icon name="x" size={13} /></button>
        </header>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <button
            data-testid="library-reader-format-clean"
            className="group min-h-36 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:bg-neutral-900/80"
            disabled={!reader.cleanAvailable}
            autoFocus={reader.cleanAvailable}
            onClick={() => onChoose('clean')}
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><Icon name="book" size={16} /></span>
            <strong className="mt-3 block text-sm">{t('Markdown limpio')}</strong>
            <span className="mt-1 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t('Lectura adaptable con texto, índice e imágenes extraídas.')}</span>
            {!reader.cleanAvailable && <span className="mt-2 block text-[10px] font-medium text-amber-600 dark:text-amber-300">{t('Todavía no está disponible')}</span>}
          </button>

          <button
            data-testid="library-reader-format-original"
            className="group min-h-36 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:bg-neutral-900/80"
            disabled={!originalAttachment}
            autoFocus={!reader.cleanAvailable && !!originalAttachment}
            onClick={() => onChoose('original')}
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"><Icon name="file" size={16} /></span>
            <strong className="mt-3 block text-sm">{t('Archivo original')}</strong>
            <span className="mt-1 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t('El archivo conservado, con su diseño y sus páginas originales.')}</span>
            {originalAttachment ? <span className="mt-2 block truncate text-[10px] text-neutral-400 dark:text-neutral-500" title={originalAttachment.fileName}>{originalAttachment.fileName}</span> : <span className="mt-2 block text-[10px] font-medium text-amber-600 dark:text-amber-300">{t('Todavía no está disponible')}</span>}
          </button>
        </div>

        <footer className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-neutral-700 dark:text-neutral-300">
            <input data-testid="library-reader-format-remember" className="mt-0.5" type="checkbox" checked={remember} onChange={(event) => onRememberChange(event.target.checked)} />
            <span><b className="font-medium">{t('No volver a preguntar')}</b><small className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{t('La próxima vez Nodus abrirá directamente el formato elegido.')}</small></span>
          </label>
        </footer>
      </section>
    </ModalBackdrop>
  );
}

const ReaderFilesMenu = memo(function ReaderFilesMenu({
  attachments,
  cleanAvailable,
  cleanLabel,
  filesLabel,
  selectedSource,
  selectedTitle,
  onSelect,
  hasOpeningPreference,
  onResetOpeningPreference,
}: {
  attachments: LibraryReaderDocument['attachments'];
  cleanAvailable: boolean;
  cleanLabel: string;
  filesLabel: string;
  selectedSource: string;
  selectedTitle: string;
  onSelect: (source: string) => void;
  hasOpeningPreference: boolean;
  onResetOpeningPreference: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (source: string) => {
    onSelect(source);
    setOpen(false);
  };
  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <button
        data-testid="library-reader-files-toggle"
        className="flex w-full items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/35 px-2.5 py-2 text-left hover:border-neutral-700 hover:bg-neutral-900/70"
        aria-expanded={open}
        aria-controls="library-reader-files"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-900 text-neutral-400"><Icon name="folder" size={13} /></span>
        <span className="min-w-0 flex-1"><b className="block truncate text-[11px] font-medium text-neutral-300">{filesLabel}</b><small className="block truncate text-[9px] text-neutral-600">{selectedTitle} · {attachments.length + 1}</small></span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} className="text-neutral-600" />
      </button>
      {open && <div id="library-reader-files" data-testid="library-reader-files" className="mt-2 max-h-56 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
        <button data-testid="library-reader-file-clean" className={`library-reader-file-option flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${selectedSource === 'clean' ? 'is-active' : ''}`} disabled={!cleanAvailable} onClick={() => choose('clean')}><Icon name="book" size={12} /><span className="truncate">{cleanLabel}</span></button>
        {attachments.map((attachment) => <button key={attachment.id} data-testid={`library-reader-file-${attachment.id}`} className={`library-reader-file-option flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${selectedSource === attachment.id ? 'is-active' : ''} disabled:opacity-40`} disabled={!attachment.available} onClick={() => choose(attachment.id)}><Icon name={attachment.viewer === 'image' ? 'image' : attachment.viewer === 'pdf' || attachment.viewer === 'epub' ? 'book' : 'archive'} size={12} /><span className="min-w-0 flex-1 truncate">{attachment.title}</span><span className="library-reader-file-kind text-[9px] uppercase">{attachment.viewer}</span></button>)}
        {hasOpeningPreference && <button data-testid="library-reader-reset-format-preference" className="mt-1 flex w-full items-center gap-2 border-t border-neutral-800 px-2 py-2.5 text-left text-[10px] text-neutral-500 hover:text-indigo-300" onClick={() => { onResetOpeningPreference(); setOpen(false); }}><Icon name="refresh" size={11} /><span>{t('Preguntar de nuevo al abrir')}</span></button>}
      </div>}
    </div>
  );
});

export function OriginalPagePreview({
  documentId, attachmentId, initialPage, title, onClose, onOpenFull,
}: {
  documentId: string; attachmentId: string; initialPage: number; title: string; onClose: () => void; onOpenFull: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true; let task: ReturnType<typeof getDocument> | null = null;
    setLoading(true); setError('');
    void window.nodus.getLibraryReaderAttachmentBytes(documentId, attachmentId).then((buffer) => {
      if (!buffer?.byteLength) throw new Error('The PDF file is unavailable or empty.');
      if (!live) return null;
      task = getDocument({ data: new Uint8Array(buffer) });
      return task.promise;
    }).then((document) => {
      if (!document || !live) return;
      setPdf(document); setPageNumber((value) => Math.min(document.numPages, Math.max(1, value))); setLoading(false);
    }).catch((cause) => { if (live) { setError(errorText(cause)); setLoading(false); } });
    return () => { live = false; void task?.destroy(); };
  }, [attachmentId, documentId]);

  useEffect(() => { setPageNumber(Math.max(1, initialPage)); }, [initialPage]);
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let canceled = false;
    // pdf.js refuses a second render() on a canvas that is still drawing, so paging or
    // zooming quickly turned the preview into an error. The previous render is cancelled.
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;
    void pdf.getPage(pageNumber).then(async (page) => {
      if (canceled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${Math.ceil(viewport.width)}px`; canvas.style.height = `${Math.ceil(viewport.height)}px`;
      renderTask = page.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await renderTask.promise;
      page.cleanup();
    }).catch((cause) => { if (!canceled && (cause as { name?: string } | null)?.name !== 'RenderingCancelledException') setError(errorText(cause)); });
    return () => { canceled = true; renderTask?.cancel(); };
  }, [pdf, pageNumber, scale]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('Página del original')} data-testid="library-original-preview" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="card mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden shadow-2xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
          <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{title}</h2><p className="text-[10px] text-neutral-500">{t('Vista temporal del original; no se modifica el archivo.')}</p></div>
          <div className="flex items-center gap-1 rounded-lg border border-neutral-800 p-0.5">
            <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Anterior')} title={t('Anterior')} disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><Icon name="arrowLeft" size={13} /></button>
            <label><span className="sr-only">{t('Página')}</span><input aria-label={t('Página')} className="input h-8 w-14 text-center" type="number" min="1" max={pdf?.numPages ?? 1} value={pageNumber} onChange={(event) => setPageNumber(Math.min(pdf?.numPages ?? 1, Math.max(1, Number(event.target.value) || 1)))} /></label>
            <span className="min-w-8 text-center text-xs tabular-nums text-neutral-600">/ {pdf?.numPages ?? '—'}</span>
            <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Siguiente')} title={t('Siguiente')} disabled={pageNumber >= (pdf?.numPages ?? 1)} onClick={() => setPageNumber((value) => Math.min(pdf?.numPages ?? 1, value + 1))}><Icon name="arrowRight" size={13} /></button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-neutral-800 p-0.5">
            <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Alejar')} title={t('Alejar')} onClick={() => setScale((value) => Math.max(0.55, value - 0.15))}><Icon name="minus" size={13} /></button>
            <button className="min-w-12 text-[11px] tabular-nums text-neutral-500" onClick={() => setScale(1.2)}>{Math.round(scale * 100)}%</button>
            <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Acercar')} title={t('Acercar')} onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}><Icon name="plus" size={13} /></button>
          </div>
          <button className="btn btn-ghost h-8 border border-neutral-700" onClick={onOpenFull}><Icon name="external" size={13} /> {t('Abrir completo')}</button>
          <button className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-900/70 p-6 text-center">
          {loading && <div className="grid h-full place-items-center"><Spinner label={t('Cargando página original…')} /></div>}
          {error && <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
          {!loading && !error && <canvas ref={canvasRef} className="mx-auto bg-white shadow-2xl" data-page={pageNumber} />}
        </div>
      </section>
    </div>
  );
}

export function LibraryDocumentReader({
  reference,
  onBack,
  onOpenAssistant,
  initialSource,
  onSourceChange,
  showLibraryBackButton = true,
  initialPage,
  onInitialPageApplied,
}: {
  reference: LibraryReaderReference;
  onBack: () => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  initialSource?: string;
  onSourceChange?: (sourceId: string) => void;
  showLibraryBackButton?: boolean;
  /** Cited page to land on. Applied once, then reported through `onInitialPageApplied`. */
  initialPage?: number | null;
  onInitialPageApplied?: () => void;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const bookmarkMenuRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const pendingAnnotationsRef = useRef(new Map<string, WritingDraftAnnotation>());
  const onSourceChangeRef = useRef(onSourceChange);
  const [reader, setReader] = useState<LibraryReaderDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [orphanedAnnotations, setOrphanedAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [highlighterColor, setHighlighterColor] = useState<WritingDraftAnnotationColor | null>(null);
  const [hasReaderMark, setHasReaderMark] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [progress, setProgress] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'annotations' | 'metadata' | 'chat'>('annotations');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState('clean');
  const [openingFormatPrompt, setOpeningFormatPrompt] = useState(false);
  const [rememberOpeningFormat, setRememberOpeningFormat] = useState(false);
  const [openingFormatPreference, setOpeningFormatPreference] = useState<ReaderOpeningFormat | null>(() => readOpeningFormatPreference());
  const [chatMessages, setChatMessages] = useState<LibraryReaderChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatStreaming, setChatStreaming] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  // Id of the assistant message the user stopped. Its partial text stays and the red
  // notice renders under it instead of replacing the whole answer. The refs mirror the
  // streamed text and the stop request for the async callback and the catch.
  const [chatStoppedId, setChatStoppedId] = useState<string | null>(null);
  const chatStopRequestedRef = useRef(false);
  const chatStreamingRef = useRef('');
  const [chatSettings, setChatSettings] = useState<AppSettings | null>(null);
  const [chatModel, setChatModel] = useState<ModelRef | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);

  useEffect(() => { onSourceChangeRef.current = onSourceChange; }, [onSourceChange]);

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReader(await window.nodus.getLibraryReaderDocument(reference.id));
    } catch (nextError) {
      setError(errorText(nextError));
      setReader(null);
    } finally {
      setLoading(false);
    }
  }, [reference.id]);

  const refreshAnnotations = useCallback(async () => {
    try {
      const [current, orphaned] = await Promise.all([
        window.nodus.listLibraryReaderAnnotations(reference.id),
        window.nodus.listLibraryReaderOrphanedAnnotations(reference.id),
      ]);
      const pending = [...pendingAnnotationsRef.current.values()].filter((candidate) =>
        !current.some((persisted) => sameAnnotationAnchor(candidate, persisted))
      );
      setAnnotations([...current, ...pending]);
      setOrphanedAnnotations(orphaned);
      setAnnotationError(null);
    } catch (nextError) {
      setAnnotationError(errorText(nextError));
    }
  }, [reference.id]);

  useEffect(() => {
    pendingAnnotationsRef.current.clear();
    void loadReader();
  }, [loadReader]);
  useEffect(() => {
    if (!reader) return;
    const original = primaryOriginalAttachment(reader);
    const preferred = reference.preferredSource ?? readOpeningFormatPreference();
    setOpeningFormatPreference(preferred);
    setRememberOpeningFormat(false);
    const initialIsAvailable = initialSource === 'clean'
      ? reader.cleanAvailable
      : !!initialSource && !!reader.attachments.find((attachment) => attachment.id === initialSource && attachment.available);
    const citedAttachment = reference.attachmentId && reader.attachments.find(attachment => attachment.id === reference.attachmentId && attachment.available);
    if (citedAttachment) {
      setSelectedSource(citedAttachment.id);
      onSourceChangeRef.current?.(citedAttachment.id);
      setOpeningFormatPrompt(false);
    } else if (initialSource && initialIsAvailable) {
      setSelectedSource(initialSource);
      setOpeningFormatPrompt(false);
    } else if (preferred === 'clean' && reader.cleanAvailable) {
      setSelectedSource('clean');
      onSourceChangeRef.current?.('clean');
      setOpeningFormatPrompt(false);
    } else if (preferred === 'original' && original) {
      setSelectedSource(original.id);
      onSourceChangeRef.current?.(original.id);
      setOpeningFormatPrompt(false);
    } else if (reader.cleanAvailable && original) {
      setSelectedSource('clean');
      setOpeningFormatPrompt(true);
    } else {
      const fallback = reader.cleanAvailable ? 'clean' : original?.id ?? reader.attachments.find((entry) => entry.available)?.id ?? 'clean';
      setSelectedSource(fallback);
      onSourceChangeRef.current?.(fallback);
      setOpeningFormatPrompt(false);
    }
  }, [initialSource, reader, reference.preferredSource, reference.attachmentId]);
  useEffect(() => {
    if (!reader) return;
    let alive = true;
    void window.nodus.listLibraryReaderChatMessages(reference.id)
      .then((messages) => { if (alive) setChatMessages(messages); })
      .catch((nextError) => { if (alive) setChatError(errorText(nextError)); });
    return () => { alive = false; };
  }, [reader, reference.id]);
  useEffect(() => {
    const apply = (settings: AppSettings) => {
      setChatSettings(settings);
      setChatModel(settings.nodiModel ?? settings.chatModel ?? settings.synthesisModel ?? null);
    };
    void window.nodus.getSettings().then(apply).catch(() => undefined);
    return window.nodus.onSettingsChanged(apply);
  }, []);

  useEffect(() => {
    if (sidebarTab === 'chat') {
      const messages = chatMessagesRef.current;
      messages?.scrollTo({ top: messages.scrollHeight, behavior: chatStreaming ? 'auto' : 'smooth' });
    }
  }, [chatMessages, chatStreaming, sidebarTab]);
  useEffect(() => {
    const keepOneNarrowSidebar = () => {
      if (window.innerWidth < 1024 && outlineOpen && notesOpen) setOutlineOpen(false);
    };
    keepOneNarrowSidebar();
    window.addEventListener('resize', keepOneNarrowSidebar);
    return () => window.removeEventListener('resize', keepOneNarrowSidebar);
  }, [notesOpen, outlineOpen]);
  useEffect(() => {
    if (!bookmarkMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!bookmarkMenuRef.current?.contains(event.target as Node)) setBookmarkMenuOpen(false);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBookmarkMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissWithKeyboard);
    };
  }, [bookmarkMenuOpen]);
  useEffect(() => {
    if (!reader) return;
    void refreshAnnotations();
    return window.nodus.onLibraryReaderAnnotationsChanged((nodusId) => {
      if (nodusId === null || nodusId === reference.id) void refreshAnnotations();
    });
  }, [reader, refreshAnnotations, reference.id]);

  const createScopedAnnotation = useCallback(async (scope: string, input: Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>) => {
    const pendingId = `reader-pending:${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const optimistic: WritingDraftAnnotation = {
      id: pendingId,
      draftId: reference.id,
      scope,
      kind: input.kind,
      color: input.kind === 'highlight' ? input.color ?? null : null,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      selectedText: input.selectedText,
      prefix: input.prefix ?? '',
      suffix: input.suffix ?? '',
      comment: input.kind === 'comment' ? input.comment ?? null : null,
      createdAt: now,
      updatedAt: now,
      anchorStatus: 'current',
      ...(input.target ? { target: input.target } : {}),
    };
    pendingAnnotationsRef.current.set(pendingId, optimistic);
    setAnnotations((current) => [...current, optimistic]);
    setAnnotationError(null);
    try {
      const created = await window.nodus.createLibraryReaderAnnotation(reference.id, {
        ...input,
        draftId: reference.id,
        scope,
      });
      pendingAnnotationsRef.current.delete(pendingId);
      setAnnotations((current) => [...current.filter((item) => item.id !== pendingId && item.id !== created.id), created]);
    } catch (nextError) {
      pendingAnnotationsRef.current.delete(pendingId);
      setAnnotations((current) => current.filter((item) => item.id !== pendingId));
      throw nextError;
    }
  }, [reference.id]);
  const createAnnotation = useCallback((input: Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>) => createScopedAnnotation('source', input), [createScopedAnnotation]);

  const updateComment = useCallback(async (id: string, comment: string) => {
    let previous: WritingDraftAnnotation | null = null;
    setAnnotations((current) => current.map((item) => {
      if (item.id !== id) return item;
      previous = item;
      return { ...item, comment, updatedAt: new Date().toISOString() };
    }));
    setAnnotationError(null);
    try {
      const updated = await window.nodus.updateLibraryReaderComment(reference.id, id, comment);
      if (!updated) return void refreshAnnotations();
      setAnnotations((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (nextError) {
      if (previous) setAnnotations((current) => current.map((item) => item.id === id ? previous! : item));
      throw nextError;
    }
  }, [reference.id, refreshAnnotations]);

  const deleteAnnotation = useCallback(async (id: string) => {
    let previous: WritingDraftAnnotation | null = null;
    let previousOrphaned: WritingDraftAnnotation | null = null;
    setAnnotations((current) => current.filter((item) => {
      if (item.id === id) previous = item;
      return item.id !== id;
    }));
    setOrphanedAnnotations((current) => current.filter((item) => {
      if (item.id === id) previousOrphaned = item;
      return item.id !== id;
    }));
    setAnnotationError(null);
    try {
      await window.nodus.deleteLibraryReaderAnnotation(reference.id, id);
    } catch (nextError) {
      if (previous) setAnnotations((current) => [...current, previous!]);
      if (previousOrphaned) setOrphanedAnnotations((current) => [...current, previousOrphaned!]);
      throw nextError;
    }
  }, [reference.id]);

  useEffect(() => {
    const root = documentRef.current;
    if (!reader || !root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    headings.forEach((heading, index) => {
      const section = reader.sections[index];
      if (section) heading.id = section.id;
    });
    const scroller = scrollRef.current;
    if (!scroller) return;
    const saved = Number(localStorage.getItem(readingPositionKey(reader.storageId)) || 0);
    requestAnimationFrame(() => { scroller.scrollTop = Number.isFinite(saved) ? Math.max(0, saved) : 0; });
  }, [reader, selectedSource]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!reader || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      // Whole percent: the bar animates its width and the label shows an integer. An unrounded
      // value changed on every scroll frame and re-rendered the whole reader at 60 fps.
      setProgress(Math.round(Math.min(100, Math.max(0, (scroller.scrollTop / max) * 100))));
      localStorage.setItem(readingPositionKey(reader.storageId), String(Math.round(scroller.scrollTop)));
      const top = scroller.getBoundingClientRect().top + 120;
      const headings = Array.from(documentRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []);
      let next = 0;
      for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].getBoundingClientRect().top <= top) next = index;
        else break;
      }
      setActiveSection(next);
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [reader, selectedSource]);

  const selectReaderSource = useCallback((value: string) => {
    setSelectedSource(value);
    if (reader) localStorage.setItem(`nodus.libraryReader.source.${reader.storageId}`, value);
    onSourceChangeRef.current?.(value);
    setPreviewPage(null);
  }, [reader]);

  const chooseOpeningFormat = useCallback((format: ReaderOpeningFormat) => {
    if (!reader) return;
    const original = primaryOriginalAttachment(reader);
    let sourceId: string;
    if (format === 'clean' && reader.cleanAvailable) sourceId = 'clean';
    else if (format === 'original' && original) sourceId = original.id;
    else return;
    setSelectedSource(sourceId);
    localStorage.setItem(`nodus.libraryReader.source.${reader.storageId}`, sourceId);
    onSourceChangeRef.current?.(sourceId);
    if (rememberOpeningFormat) {
      writeOpeningFormatPreference(format);
      setOpeningFormatPreference(format);
    }
    setOpeningFormatPrompt(false);
  }, [reader, rememberOpeningFormat]);

  const resetOpeningFormatPreference = useCallback(() => {
    writeOpeningFormatPreference(null);
    setOpeningFormatPreference(null);
  }, []);

  const scrollToSection = (index: number) => {
    const id = reader?.sections[index]?.id;
    if (!id) return;
    if (selectedSource !== 'clean') selectReaderSource('clean');
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const goToAnnotation = (annotation: WritingDraftAnnotation) => {
    const root = documentRef.current;
    if (!root) return;
    const range = findTextRange(root, annotation);
    range?.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const markCurrentSection = async () => {
    const root = documentRef.current;
    const section = reader?.sections[activeSection];
    if (!root || !section) return;
    const heading = document.getElementById(section.id);
    if (!(heading instanceof HTMLElement)) return;
    const anchor = anchorForElement(root, heading);
    if (!anchor.selectedText.trim()) return;
    await createAnnotation({ ...anchor, kind: 'bookmark', color: null });
  };

  const openCurrentPage = (page: number | null) => {
    if (reader?.originalMimeType === 'application/pdf' && reader.originalUrl) setPreviewPage(page ?? 1);
    else void window.nodus.openLibraryReaderOriginal(reference.id);
  };

  // The exact point a citation named. The preserved PDF page is the literal
  // answer; without one, the clean text still knows which physical page each
  // section came from, so the reader scrolls there instead of showing the top of
  // the document. `openCurrentPage` is deliberately not the fallback: sending a
  // citation to the system viewer would land on page 1, which is the bug.
  const jumpToCitedPage = (page: number) => {
    if (!reader) return;
    if (reference.attachmentId) {
      const attachment = reader.attachments.find(attachment => attachment.id === reference.attachmentId && attachment.available);
      if (!attachment) return;
      setSelectedSource(attachment.id);
      if (attachment.viewer === 'pdf') { setPreviewAttachmentId(attachment.id); setPreviewPage(page); }
      return;
    }
    setPreviewAttachmentId(null);
    if (reader.originalMimeType === 'application/pdf' && reader.originalUrl) { setPreviewPage(page); return; }
    const index = reader.sections.findIndex((section) => typeof section.page === 'number' && section.page >= page);
    if (index >= 0) scrollToSection(index);
  };

  // Consumed once per mount: leaving the page on the reference would re-jump every
  // time the reader remounts (tab switch, restart) instead of restoring the
  // position the user had reached.
  const citedPageAppliedRef = useRef(false);
  useEffect(() => {
    if (!reader || !initialPage || citedPageAppliedRef.current) return;
    citedPageAppliedRef.current = true;
    jumpToCitedPage(initialPage);
    onInitialPageApplied?.();
  }, [reader, initialPage, onInitialPageApplied]);

  const openReaderCitation = (target: MarkdownReaderCitation) => {
    if (!reader || (target.documentId !== reader.workId && target.documentId !== reference.id)) return;
    if (target.page) {
      openCurrentPage(target.page);
      return;
    }
    selectReaderSource('clean');
    if (target.sectionId) {
      const index = reader.sections.findIndex((section) => section.id === target.sectionId);
      if (index >= 0) scrollToSection(index);
    } else {
      window.setTimeout(() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 0);
    }
  };

  // Stable callbacks for the saved chat answers: fresh closures here defeated ChatMarkdown's
  // memo, so every reader render (each scroll frame, each streamed delta) re-parsed them all.
  const openReaderCitationRef = useRef(openReaderCitation);
  openReaderCitationRef.current = openReaderCitation;
  const chatReaderCitation = useCallback((target: MarkdownReaderCitation) => openReaderCitationRef.current(target), []);
  const chatCitation = useCallback((next: MarkdownCitation) => setCitation(next), []);

  const openDocumentChat = () => {
    if (window.innerWidth < 1024) setOutlineOpen(false);
    setNotesOpen(true);
    setSidebarTab('chat');
  };

  const openFullAssistant = () => {
    onOpenAssistant({
      title: `${t('Lectura:')} ${reader?.title ?? reference.title}`,
      selection: ASSISTANT_CONTEXTS.reading,
      prompt:
        `${t('Quiero conversar sobre este documento. Prioriza su texto, sus anotaciones y su relación con el resto del corpus.')}`
        + `\n\n${reader?.title ?? reference.title}\n${(reader?.authors ?? reference.authors).join(', ')}`
        + `${reader?.zoteroKey ? `\nZotero: ${reader.zoteroKey}` : ''}`,
    });
  };

  const sendChat = async () => {
    const content = chatInput.trim();
    if (!content || chatSending || !reader) return;
    const user: LibraryReaderChatMessage = {
      id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString(),
    };
    const requestMessages = [...chatMessages.filter((message) => !message.error), user];
    setChatMessages(requestMessages);
    setChatInput('');
    setChatStreaming('');
    chatStreamingRef.current = '';
    chatStopRequestedRef.current = false;
    setChatStoppedId(null);
    setChatError(null);
    setChatSending(true);
    try {
      const response = await window.nodus.libraryReaderChatStream(
        { documentId: reference.id, sourceId: selectedSource, messages: requestMessages, model: chatModel },
        { onDelta: (delta) => { chatStreamingRef.current += delta; setChatStreaming((current) => current + delta); } },
      );
      const aborted = chatStopRequestedRef.current || Boolean(response.aborted);
      if (response.answer.trim()) {
        const answer: LibraryReaderChatMessage = {
          id: crypto.randomUUID(), role: 'assistant', content: response.answer, createdAt: new Date().toISOString(),
        };
        setChatMessages((current) => [...current, answer]);
        if (aborted) setChatStoppedId(answer.id);
      }
    } catch (nextError) {
      if (chatStopRequestedRef.current) {
        // The user stopped the stream: keep the text that already arrived instead
        // of replacing the whole answer with the cancellation error.
        const partial = chatStreamingRef.current.trim();
        if (partial) {
          const answer: LibraryReaderChatMessage = {
            id: crypto.randomUUID(), role: 'assistant', content: partial, createdAt: new Date().toISOString(),
          };
          setChatMessages((current) => [...current, answer]);
          setChatStoppedId(answer.id);
        }
      } else {
        const message = errorText(nextError);
        setChatError(message);
        setChatMessages((current) => [...current, {
          id: crypto.randomUUID(), role: 'assistant', content: message, createdAt: new Date().toISOString(), error: true,
        }]);
      }
    } finally {
      setChatSending(false);
      setChatStreaming('');
      chatStreamingRef.current = '';
      chatStopRequestedRef.current = false;
    }
  };

  const changeChatModel = (model: ModelRef | null) => {
    setChatModel(model);
    void window.nodus.updateSettings({
      ...(model ? { modelSettingsMode: 'advanced' as const } : {}),
      nodiModel: model,
    });
  };

  const clearChat = async () => {
    if (!chatMessages.length || !(await confirm({
      title: t('Vaciar conversación'),
      message: t('Se eliminará el chat guardado junto a este documento.'),
      confirmLabel: t('Vaciar'), danger: true,
    }))) return;
    if (chatSending) await window.nodus.cancelLibraryReaderChat();
    await window.nodus.clearLibraryReaderChat(reference.id);
    setChatMessages([]);
    setChatStreaming('');
    setChatError(null);
  };

  const selectedAttachment = useMemo(() => reader?.attachments.find((entry) => entry.id === selectedSource) ?? null, [reader, selectedSource]);
  const visibleAnnotations = useMemo(() => annotations.filter((annotation) => selectedSource === 'clean'
    ? annotation.scope === 'source'
    : annotation.scope === `attachment:${selectedSource}` || annotation.scope.startsWith(`attachment:${selectedSource}:`)), [annotations, selectedSource]);
  const sidebarAnnotations = useMemo(() => visibleAnnotations.filter((annotation) => annotation.kind !== 'bookmark'), [visibleAnnotations]);
  const contextMarkdown = useMemo(() => reader?.markdown.replace(/data:image\/[^;]+;base64,[^)\s]+/g, '[imagen extraída]') ?? '', [reader]);

  if (loading) {
    return <div className="grid h-full place-items-center"><Spinner label={t('Preparando lector…')} /></div>;
  }

  if (!reader) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-neutral-800 px-4 py-2.5">
          <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" /> {t('Volver a la biblioteca')}</button>
        </header>
        <div className="grid min-h-0 flex-1 place-items-center p-8">
          <div data-testid="library-reader-empty-card" className="library-reader-empty-card max-w-lg rounded-2xl border border-dashed border-neutral-700 bg-neutral-950/30 p-8 text-center">
            <span className="library-reader-empty-icon mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-950 text-indigo-300"><Icon name="book" size={21} /></span>
            <h2 className="mt-4 text-base font-semibold text-neutral-100">{t('Todavía no hay una versión limpia de esta obra')}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{error ?? tx('El lector buscará el documento en nodus-library/{id}, conservando su identificador estable.', { id: reference.zoteroKey || reference.id })}</p>
            <div className="mt-5 flex justify-center gap-2">
              {reference.zoteroKey && <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.openInZotero(reference.zoteroKey!)}><Icon name="external" /> {t('Abrir en Zotero')}</button>}
              <button className="btn btn-primary" onClick={() => void loadReader()}><Icon name="refresh" /> {t('Volver a comprobar')}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPage = reader.sections[activeSection]?.page ?? null;
  const sourceKind = selectedAttachment
    ? selectedAttachment.role === 'original' ? 'original' : 'attachment'
    : reader.freshness === 'current' ? 'current' : 'previous';
  const sourceLabel = selectedAttachment
    ? t(selectedAttachment.role === 'original' ? 'Archivo original' : 'Adjunto conservado')
    : t(reader.freshness === 'current' ? 'Markdown limpio' : 'Última copia legible');

  return (
    <div className="library-document-reader relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <NodiViewContextSource title={reader.title} text={contextMarkdown} />
      <header className="relative z-40 flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5 backdrop-blur">
        {showLibraryBackButton && <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" /> {t('Biblioteca')}</button>}
        <button
          className={`btn btn-ghost h-9 w-9 shrink-0 p-0 ${outlineOpen ? 'text-indigo-300' : ''}`}
          data-testid="library-reader-outline-toggle"
          onClick={() => setOutlineOpen((value) => {
            const next = !value;
            if (next && window.innerWidth < 1024) setNotesOpen(false);
            return next;
          })}
          aria-controls="library-reader-outline"
          aria-expanded={outlineOpen}
          aria-label={t('Índice')}
          title={t('Índice')}
        ><Icon name="list" /></button>
        <div className="min-w-[12rem] flex-1">
          <h1 className="truncate text-sm font-semibold text-neutral-100" title={reader.title}>{reader.title}</h1>
          <p className="truncate text-[11px] text-neutral-500">
            {reader.authors.join(', ')}{reader.year ? ` · ${reader.year}` : ''}{selectedAttachment ? ` · ${selectedAttachment.fileName}` : ` · ${reader.wordCount.toLocaleString()} ${t('palabras')}`}
          </p>
        </div>
        <label className="relative flex min-w-44 max-w-72 items-center" data-testid="library-reader-source-picker">
          <Icon name={selectedAttachment ? 'archive' : 'book'} size={13} className="pointer-events-none absolute left-2.5 z-10 text-neutral-500" />
          <select className="input input-with-leading-icon h-9 w-full truncate text-xs" value={selectedSource} onChange={(event) => selectReaderSource(event.target.value)} aria-label={t('Versión o archivo')}>
            <option value="clean" disabled={!reader.cleanAvailable}>{t('Markdown limpio')}</option>
            {reader.attachments.map((attachment) => <option key={attachment.id} value={attachment.id} disabled={!attachment.available}>{attachment.title} · {attachment.fileName}</option>)}
          </select>
        </label>
        <span
          data-testid="library-reader-freshness"
          data-source-kind={sourceKind}
          className={`library-reader-source-badge is-${sourceKind} hidden rounded-full border px-2 py-1 text-[10px] font-medium md:inline-flex`}
        >{sourceLabel}</span>
        <ReaderHighlighterControl value={highlighterColor} onChange={setHighlighterColor} />
        {selectedSource === 'clean' && <div ref={bookmarkMenuRef} className="relative">
          <button
            className={`btn btn-ghost h-9 w-10 gap-0.5 border p-0 ${hasReaderMark ? 'border-amber-700/60 text-amber-300' : 'border-neutral-700'}`}
            data-testid="library-reader-bookmark-menu"
            onClick={() => setBookmarkMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={bookmarkMenuOpen}
            aria-label={t('Marcar esta sección')}
            title={t('Marcar esta sección')}
          ><Icon name={hasReaderMark ? 'bookmarkFill' : 'bookmark'} size={14} /><Icon name="chevronDown" size={10} /></button>
          {bookmarkMenuOpen && <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-neutral-700 bg-neutral-950 p-1.5 shadow-2xl" role="menu">
            <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-900" role="menuitem" onClick={() => { setBookmarkMenuOpen(false); void markCurrentSection(); }}>
              <Icon name="bookmark" size={13} /><span>{t('Marcar esta sección')}</span>
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-700" role="menuitem" disabled={!hasReaderMark} onClick={() => { setBookmarkMenuOpen(false); markActionsRef.current?.goToMark(); }}>
              <Icon name="bookmarkFill" size={13} /><span>{t('Ir al marcador de lectura')}</span>
            </button>
          </div>}
        </div>}
        {selectedSource === 'clean' && <HoverLabelButton icon="file" label={currentPage ? tx('Ver página {n}', { n: currentPage }) : t('Ver página original')} onClick={() => openCurrentPage(currentPage)} disabled={!reader.originalAvailable} showLabel={!!currentPage} className="btn-ghost h-9 min-h-9 border border-neutral-700" />}
        <button className="btn btn-primary h-9 w-9 shrink-0 p-0" data-testid="library-reader-open-chat" onClick={openDocumentChat} aria-label={t('Preguntar al chat')} title={t('Preguntar al chat')}><Icon name="chat" size={14} /></button>
        <button
          className={`btn btn-ghost h-9 w-9 shrink-0 p-0 ${notesOpen ? 'text-indigo-300' : ''}`}
          data-testid="library-reader-sidebar-toggle"
          onClick={() => setNotesOpen((value) => {
            const next = !value;
            if (next && window.innerWidth < 1024) setOutlineOpen(false);
            return next;
          })}
          aria-controls="library-reader-sidebar"
          aria-expanded={notesOpen}
          aria-label={t('Anotaciones')}
          title={t('Anotaciones')}
        ><Icon name="columns" /></button>
        <div className="absolute inset-x-0 bottom-0 h-px bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress}%` }} /></div>
      </header>

      {(error || annotationError) && <div className="border-b border-red-900 bg-red-950/30 px-4 py-2 text-xs text-red-200">{error ?? annotationError}</div>}
      {reader.previousReadable && <div data-testid="library-reader-previous-copy" className="border-b border-amber-800/50 bg-amber-950/25 px-4 py-2 text-xs text-amber-200">
        {t('La sustitución todavía no está validada. Se muestra la última copia legible y sus resultados no se presentan como actuales.')}
      </div>}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="library-reader-layout">
        {outlineOpen && (
          <aside id="library-reader-outline" className="library-reader-outline w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-950/25 px-3 py-4 max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:w-[min(18rem,calc(100vw-1rem))] max-lg:shadow-2xl">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{t('En este documento')}</span>
              <span className="ml-auto text-[10px] tabular-nums text-neutral-600">{Math.round(progress)}%</span>
              <button className="library-reader-outline-close ml-1.5 rounded-lg p-1" onClick={() => setOutlineOpen(false)} aria-label={t('Cerrar')}><Icon name="chevronLeft" size={13} /></button>
            </div>
            <nav className="space-y-0.5">
              {reader.sections.length > 0 ? <>
                <p className="px-2 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-[.14em] text-neutral-600">{t('Índice del documento')}</p>
                {reader.sections.map((section, index) => (
                <div key={section.id} className={`library-reader-outline-section group flex items-center rounded-lg ${index === activeSection ? 'is-active' : ''}`}>
                  <button className="min-w-0 flex-1 px-2 py-2 text-left text-xs leading-4" style={{ paddingLeft: `${8 + Math.max(0, section.level - 1) * 10}px` }} onClick={() => scrollToSection(index)}>
                    <span className="line-clamp-2">{section.title}</span>
                  </button>
                  {section.page && <button className="library-reader-outline-page mr-1 shrink-0 rounded px-1.5 py-1 text-[9px] tabular-nums opacity-0" title={tx('Abrir página {n} del original', { n: section.page })} onClick={() => openCurrentPage(section.page)}>p. {section.page}</button>}
                </div>
                ))}
              </> : <p className="px-2 py-3 text-[10px] leading-4 text-neutral-600">{t('Añade títulos para crear un índice navegable.')}</p>}
              <ReaderFilesMenu
                attachments={reader.attachments}
                cleanAvailable={reader.cleanAvailable}
                cleanLabel={t('Markdown limpio')}
                filesLabel={t('Versiones y archivos')}
                selectedSource={selectedSource}
                selectedTitle={selectedAttachment?.title ?? t('Markdown limpio')}
                onSelect={selectReaderSource}
                hasOpeningPreference={!!openingFormatPreference}
                onResetOpeningPreference={resetOpeningFormatPreference}
              />
            </nav>
            <div className="mt-5 border-t border-neutral-800 px-2 pt-4 text-[10px] leading-5 text-neutral-600">
              <div>{t('Identificador')}: <span className="select-all font-mono text-neutral-500">{reader.storageId}</span></div>
              {reader.pageCount && <div>{reader.pageCount} {t('páginas en el original')}</div>}
            </div>
          </aside>
        )}

        {selectedSource === 'clean' ? <main ref={scrollRef} className="library-reader-clean-surface min-w-0 flex-1 overflow-y-auto px-5 py-8 max-md:px-3">
          <article className="library-reader-paper mx-auto max-w-[52rem] rounded-2xl border border-neutral-800/80 px-12 py-12 shadow-[0_24px_70px_-40px_rgba(0,0,0,.75)] max-md:rounded-none max-md:border-x-0 max-md:px-5">
            <div ref={documentRef} className="library-reader-document relative" data-testid="library-reader-document">
              <ReaderMarkdownDocument content={reader.markdown} />
            </div>
          </article>
          <div className="mx-auto mt-6 flex max-w-[52rem] items-center justify-between px-2 pb-10 text-[11px] text-neutral-600">
            <span>{reader.citationKey ? `[${reader.citationKey}]` : reader.storageId}</span>
            <span>{t('El original permanece separado y sin modificaciones.')}</span>
          </div>
        </main> : selectedAttachment && <LibraryAttachmentViewer
          documentId={reference.id} attachment={selectedAttachment} annotations={annotations} highlighterColor={highlighterColor}
          onCreate={createScopedAnnotation} onUpdateComment={updateComment} onDelete={deleteAnnotation} onError={setAnnotationError}
          onOpenExternal={() => { void window.nodus.openGlobalLibraryAttachment(reference.id, selectedAttachment.id).catch(() => window.nodus.openLibraryReaderOriginal(reference.id)); }}
        />}

        {selectedSource === 'clean' && <ReaderSelectionActions
          ref={markActionsRef}
          targetRef={documentRef}
          scrollRef={scrollRef}
          contextId={`library-reader:${reader.storageId}`}
          annotations={visibleAnnotations}
          highlighterColor={highlighterColor}
          onCreateAnnotation={createAnnotation}
          onUpdateComment={updateComment}
          onDeleteAnnotation={deleteAnnotation}
          onAnnotationError={setAnnotationError}
          onMarkChange={setHasReaderMark}
        />}

        {notesOpen && (
          <aside id="library-reader-sidebar" className="library-reader-notes flex min-h-0 w-[21rem] shrink-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950/25 max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:w-[min(21rem,calc(100vw-1rem))] max-xl:shadow-2xl max-sm:w-full" data-testid="library-reader-sidebar">
            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
              <h2 className="text-xs font-semibold text-neutral-200">{t('Documento')}</h2>
              <button className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-900 hover:text-neutral-300" onClick={() => setNotesOpen(false)} aria-label={t('Cerrar')}><Icon name="chevronRight" size={14} /></button>
            </div>
            <div className="flex items-center gap-1 border-b border-neutral-800 p-1.5" role="tablist">
              {([
                ['annotations', 'notebook', t('Notas')], ['metadata', 'info', t('Info')], ['chat', 'chat', t('Chat')],
              ] as const).map(([id, icon, label]) => {
                const selected = sidebarTab === id;
                return <button
                  key={id}
                  role="tab"
                  aria-selected={selected}
                  aria-label={label}
                  title={label}
                  data-testid={`library-reader-sidebar-tab-${id}`}
                  className={`btn h-8 min-w-0 text-[10px] transition-[width,padding] ${selected ? 'btn-secondary flex-1 px-3' : 'btn-ghost w-8 shrink-0 p-0'}`}
                  onClick={() => setSidebarTab(id)}
                ><Icon name={icon} size={12} />{selected && <span className="truncate">{label}</span>}</button>;
              })}
            </div>
            <div className="min-h-0 flex-1">
              {sidebarTab === 'annotations' && <div className="h-full space-y-2 overflow-y-auto p-4">
                <p className="mb-3 text-[10px] text-neutral-600">{tx('{n} fragmentos guardados', { n: sidebarAnnotations.length })}</p>
                {sidebarAnnotations.map((annotation) => {
                  const color = READER_ANNOTATION_COLORS.find((item) => item.id === annotation.color)?.hex;
                  return <article key={annotation.id} className="group rounded-xl border border-neutral-800 bg-neutral-950/35 p-3 hover:border-neutral-700">
                    <button className="block w-full text-left" onClick={() => goToAnnotation(annotation)}>
                      <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-neutral-600">{color ? <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : <Icon name="chat" size={11} />}{annotation.kind === 'comment' ? t('Anotación') : t('Subrayado')}</span>
                      <span className="mt-2 line-clamp-3 block border-l-2 border-neutral-700 pl-2 text-[11px] italic leading-5 text-neutral-400">“{annotation.selectedText.replace(/\s+/g, ' ').trim()}”</span>
                      {annotation.comment && <span className="mt-2 line-clamp-4 block text-xs leading-5 text-neutral-300">{annotation.comment}</span>}
                    </button>
                    <div className="mt-2 flex justify-end opacity-0 group-hover:opacity-100"><button className="rounded p-1 text-neutral-600 hover:bg-red-950 hover:text-red-400" aria-label={t('Eliminar')} onClick={async () => {
                      const accepted = await confirm({ title: t('Eliminar'), message: t('¿Eliminar esta anotación? No se puede deshacer.'), confirmLabel: t('Eliminar'), danger: true });
                      if (accepted) await deleteAnnotation(annotation.id);
                    }}><Icon name="trash" size={12} /></button></div>
                  </article>;
                })}
                {!sidebarAnnotations.length && <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center text-xs leading-5 text-neutral-600">{t('Selecciona texto para subrayarlo, anotarlo o preguntarle a Nodi.')}</div>}
                {orphanedAnnotations.length > 0 && <section data-testid="library-reader-orphaned-annotations" className="mt-5 border-t border-amber-800/40 pt-4">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400">{t('Anotaciones sin ancla')}</h3>
                  <p className="mt-1 text-[10px] leading-4 text-neutral-600">{t('Se conserva la cita original para que puedas revisarla o eliminarla.')}</p>
                  <div className="mt-3 space-y-2">{orphanedAnnotations.map((annotation) => <article key={annotation.id} className="rounded-xl border border-amber-800/35 bg-amber-950/10 p-3">
                    <span className="line-clamp-4 block border-l-2 border-amber-700/50 pl-2 text-[11px] italic leading-5 text-neutral-400">“{annotation.selectedText.replace(/\s+/g, ' ').trim()}”</span>
                    {annotation.comment && <p className="mt-2 text-xs leading-5 text-neutral-300">{annotation.comment}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[9px] leading-4 text-amber-500/80">{annotation.orphanReason ?? t('No se encontró el texto en la revisión actual.')}</span><button className="shrink-0 rounded p-1 text-neutral-600 hover:bg-red-950 hover:text-red-400" aria-label={t('Eliminar')} onClick={() => void deleteAnnotation(annotation.id)}><Icon name="trash" size={12} /></button></div>
                  </article>)}</div>
                </section>}
              </div>}
              {sidebarTab === 'metadata' && <div data-testid="library-reader-metadata" className="h-full space-y-5 overflow-y-auto p-4">
                <div><span className={`rounded-full px-2 py-1 text-[10px] ${reader.freshness === 'current' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{reader.freshness === 'current' ? t('Markdown limpio') : t('Última copia legible')}</span><h3 className="mt-3 text-sm font-semibold leading-5">{reader.title}</h3><p className="mt-2 text-xs leading-5 text-neutral-500">{reader.authors.join('; ') || t('Sin autoría')}</p></div>
                {reader.sourceUrl && <button data-testid="library-reader-online-source" className="flex w-full items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2.5 text-left text-xs text-neutral-400 hover:border-indigo-500/40 hover:text-indigo-300" onClick={() => void window.nodus.openExternal(reader.sourceUrl!)}><Icon name="external" size={13} /><span className="min-w-0 flex-1 truncate">{reader.sourceUrl}</span></button>}
                <dl className="space-y-3 text-xs">{[
                  [t('Año'), reader.year], [t('Identificador'), reader.storageId], [t('Clave Zotero'), reader.zoteroKey],
                  [t('Clave de cita'), reader.citationKey], [t('Original'), reader.originalFileName], [t('Palabras'), reader.wordCount], [t('Páginas'), reader.pageCount],
                ].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={String(label)}><dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt><dd className="mt-1 break-words text-neutral-300">{String(value)}</dd></div>)}</dl>
                <section data-testid="library-reader-provenance" className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{t('Procedencia de esta revisión')}</h3>
                  <dl className="mt-3 space-y-3 text-[10px]">
                    <div><dt className="text-neutral-600">{t('Estado')}</dt><dd className="mt-1 text-neutral-300">{reader.freshness}</dd></div>
                    {reader.generatedAt && <div><dt className="text-neutral-600">{t('Generada')}</dt><dd className="mt-1 text-neutral-300">{new Date(reader.generatedAt).toLocaleString()}</dd></div>}
                    {reader.contentFingerprint && <div><dt className="text-neutral-600">{t('Huella del contenido')}</dt><dd className="mt-1 break-all font-mono text-neutral-400">sha256:{reader.contentFingerprint}</dd></div>}
                    {reader.extractionFingerprint && <div><dt className="text-neutral-600">{t('Huella de extracción')}</dt><dd className="mt-1 break-all font-mono text-neutral-400">sha256:{reader.extractionFingerprint}</dd></div>}
                  </dl>
                </section>
                <p className="rounded-xl border border-neutral-800 p-3 text-[10px] leading-5 text-neutral-600">{t('El Markdown, los recursos y las anotaciones se guardan junto al original dentro de nodus-library.')}</p>
              </div>}
              {sidebarTab === 'chat' && <div data-testid="library-reader-chat" className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-neutral-800/80 px-3 py-2.5">
                  <div className="flex min-h-5 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <p className="min-w-0 flex-1 truncate text-[9px] text-neutral-600">{t(selectedSource === 'clean' ? 'Documento, anotaciones y vault incluidos' : 'Archivo, anotaciones y vault incluidos')}</p>
                  {chatMessages.length > 0 && <button className="rounded p-1.5 text-neutral-600 hover:bg-red-950 hover:text-red-400" aria-label={t('Vaciar conversación')} onClick={() => void clearChat()}><Icon name="trash" size={12} /></button>}
                  </div>
                  <div className="mt-2 flex items-center gap-2"><div className="min-w-0 flex-1">{chatSettings && <div data-testid="library-reader-chat-model">
                    <ModelPicker settings={chatSettings} value={chatModel} onChange={changeChatModel} compact menu allowEmpty={false} emptyLabel="Usar modelo de síntesis" />
                  </div>}</div><ChatSkillsControl surface="assistant" disabled={chatSending} />
                  </div>
                </div>
                <div ref={chatMessagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
                  {!chatMessages.length && !chatSending && <div className="rounded-xl border border-dashed border-indigo-500/20 bg-indigo-500/5 px-4 py-6 text-center"><p className="text-xs leading-5 text-neutral-500">{t('Pregunta por la tesis, un concepto o la relación entre tus subrayados.')}</p></div>}
                  {chatMessages.map((message) => <article key={message.id} className={message.role === 'user' ? 'ml-5 rounded-xl bg-indigo-600/20 px-3 py-2.5 text-xs leading-5 text-indigo-100' : `mr-1 rounded-xl border px-3 py-2.5 text-xs leading-5 ${message.error ? 'border-red-500/25 bg-red-500/5 text-red-300' : 'border-neutral-800 bg-neutral-950/45 text-neutral-300'}`}>
                    {message.role === 'assistant' && !message.error ? <ChatMarkdown content={message.content} onCitation={chatCitation} onReaderCitation={chatReaderCitation} className="text-xs leading-5" /> : <p className="whitespace-pre-wrap">{message.content}</p>}
                    {message.role === 'assistant' && message.id === chatStoppedId ? <ChatAbortedNotice /> : null}
                  </article>)}
                  {chatSending && <article data-testid="library-reader-chat-stream" className="mr-1 rounded-xl border border-neutral-800 bg-neutral-950/45 px-3 py-2.5 text-xs leading-5 text-neutral-300">{chatStreaming ? <ChatMarkdown streaming content={chatStreaming} verify={false} className="text-xs leading-5" /> : <span className="flex items-center gap-2 text-neutral-500"><Spinner /> {t('Leyendo el documento…')}</span>}</article>}
                </div>
                {chatError && <p role="alert" className="shrink-0 px-4 pt-2 text-[10px] leading-4 text-red-400">{chatError}</p>}
                <div className="m-3 mt-2 shrink-0 rounded-xl border border-neutral-800 bg-neutral-950/55 p-2 focus-within:border-indigo-500/50">
                  <textarea data-testid="library-reader-chat-input" rows={2} className="block w-full resize-none bg-transparent px-1 text-xs leading-5 text-neutral-200 outline-none placeholder:text-neutral-700" value={chatInput} disabled={chatSending} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} placeholder={t('Pregunta sobre este documento…')} />
                  <div className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2">
                    <button className="text-[9px] text-neutral-600 hover:text-indigo-300" onClick={openFullAssistant}>{t('Abrir en Asistente')}</button>
                    {chatSending ? <button data-testid="library-reader-chat-stop" className="btn btn-secondary h-7 px-2 text-[10px]" onClick={() => { chatStopRequestedRef.current = true; void window.nodus.cancelLibraryReaderChat(); }}><Icon name="stop" size={11} /> {t('Detener')}</button> : <button data-testid="library-reader-chat-send" className="btn btn-primary h-7 px-2 text-[10px]" disabled={!chatInput.trim()} onClick={() => void sendChat()}><Icon name="arrowUp" size={11} /> {t('Enviar')}</button>}
                  </div>
                </div>
              </div>}
            </div>
          </aside>
        )}
      </div>
      {selectedSource === 'clean' && <FindInPage targetRef={documentRef} sourceRevision={reader.contentFingerprint ?? reader.generatedAt ?? reader.storageId} placement="reader" />}
      {openingFormatPrompt && <ReaderOpeningFormatDialog
        reader={reader}
        originalAttachment={primaryOriginalAttachment(reader)}
        remember={rememberOpeningFormat}
        onRememberChange={setRememberOpeningFormat}
        onChoose={chooseOpeningFormat}
        onCancel={onBack}
      />}
      {previewPage && (previewAttachmentId || primaryOriginalAttachment(reader)) && <OriginalPagePreview documentId={reference.id} attachmentId={previewAttachmentId ?? primaryOriginalAttachment(reader)!.id} initialPage={previewPage} title={reader.title} onClose={() => { setPreviewPage(null); setPreviewAttachmentId(null); }} onOpenFull={() => previewAttachmentId ? void window.nodus.openGlobalLibraryAttachment(reference.id, previewAttachmentId) : void window.nodus.openLibraryReaderOriginal(reference.id)} />}
      {citation && <SourceCitationModal target={citation} onClose={() => setCitation(null)} />}
    </div>
  );
}
