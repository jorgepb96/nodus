import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { GlobalWorkerOptions, getDocument, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  LibraryReaderAttachment,
  LibraryReaderAttachmentContent,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { FindInPage, type FindTextSegment } from '../FindInPage';
import { ReaderSelectionActions } from '../ReaderSelectionActions';
import { Icon, Spinner } from '../ui';
import { confirm } from '../feedback';
import { sanitizePublicationHtml } from '../../lib/publicationHtml';
import { t, tx } from '../../i18n';

GlobalWorkerOptions.workerSrc = pdfWorker;

type AnnotationCreate = Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>;
interface ViewerProps {
  documentId: string;
  attachment: LibraryReaderAttachment;
  annotations: WritingDraftAnnotation[];
  highlighterColor: WritingDraftAnnotationColor | null;
  onCreate(scope: string, input: AnnotationCreate): Promise<void>;
  onUpdateComment(id: string, comment: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onError(message: string): void;
  onOpenExternal(): void;
}

function attachmentSessionNumber(documentId: string, attachmentId: string, field: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(`nodus.libraryReader.attachment.${documentId}.${attachmentId}.${field}`));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeAttachmentSessionNumber(documentId: string, attachmentId: string, field: string, value: number): void {
  try {
    localStorage.setItem(`nodus.libraryReader.attachment.${documentId}.${attachmentId}.${field}`, String(value));
  } catch {
    // Session restoration is optional and must never interrupt reading.
  }
}

function TextSurface({
  scope, contextId, annotations, highlighterColor, onCreate, onUpdateComment, onDelete, onError, children, testId,
  findSegments, activeFindSegmentId, onActivateFindSegment,
}: Pick<ViewerProps, 'annotations' | 'highlighterColor' | 'onCreate' | 'onUpdateComment' | 'onDelete' | 'onError'> & {
  scope: string; contextId: string; children: React.ReactNode; testId: string;
  findSegments: FindTextSegment[]; activeFindSegmentId: string; onActivateFindSegment?(id: string): void;
}) {
  const targetRef = useRef<HTMLDivElement | null>(null); const scrollRef = useRef<HTMLElement | null>(null);
  return <main ref={scrollRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-neutral-100 p-5 dark:bg-neutral-950" data-testid={testId}>
    <div ref={targetRef} className="library-attachment-text mx-auto max-w-4xl rounded-2xl bg-white px-8 py-10 text-neutral-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      {children}
    </div>
    <ReaderSelectionActions
      targetRef={targetRef} scrollRef={scrollRef} contextId={contextId}
      annotations={annotations.filter((entry) => entry.scope === scope)} highlighterColor={highlighterColor}
      onCreateAnnotation={(input) => onCreate(scope, input)} onUpdateComment={onUpdateComment}
      onDeleteAnnotation={onDelete} onAnnotationError={onError}
    />
    <FindInPage targetRef={targetRef} segments={findSegments} activeSegmentId={activeFindSegmentId} onActivateSegment={onActivateFindSegment} placement="surface" />
  </main>;
}

function PdfViewer(props: ViewerProps) {
  const { attachment } = props; const scrollRef = useRef<HTMLElement | null>(null); const activeTextRef = useRef<HTMLDivElement | null>(null); const currentPageRef = useRef(1);
  const textLayersRef = useRef(new Map<number, HTMLDivElement>()); const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const findSegmentsRef = useRef<{ pdf: PDFDocumentProxy; promise: Promise<FindTextSegment[]> } | null>(null);
  const [pageNumber, setPageNumber] = useState(() => attachmentSessionNumber(props.documentId, attachment.id, 'page', 1));
  const [scale, setScale] = useState(() => attachmentSessionNumber(props.documentId, attachment.id, 'scale', 1.25));
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>(() => localStorage.getItem('nodus.library.pdfViewMode') === 'continuous' ? 'continuous' : 'single');
  const [renderedScales, setRenderedScales] = useState<Record<number, number>>({}); const [renderRevision, setRenderRevision] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    if (!attachment.url) return;
    let live = true; let task: ReturnType<typeof getDocument> | null = null;
    setPdf(null); setLoading(true); setError(''); setRenderedScales({});
    // PDF.js URL loading uses XHR, which can turn a successful custom-protocol
    // response into status 0 in packaged Electron. Read validated local bytes
    // asynchronously in main and hand those bytes directly to PDF.js instead.
    void window.nodus.getLibraryReaderAttachmentBytes(props.documentId, attachment.id).then((buffer) => {
      if (!buffer?.byteLength) throw new Error('The PDF file is unavailable or empty.');
      if (!live) return null;
      const data = new Uint8Array(buffer);
      task = getDocument({ data });
      return task.promise;
    }).then((document) => {
      if (!document || !live) return;
      setPdf(document); setPageNumber((value) => Math.min(document.numPages, Math.max(1, value))); setLoading(false);
    }).catch((cause) => {
      if (!live) return;
      setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false);
    });
    return () => { live = false; void task?.destroy(); };
  }, [attachment.id, attachment.url, props.documentId]);
  useEffect(() => { writeAttachmentSessionNumber(props.documentId, attachment.id, 'page', pageNumber); }, [attachment.id, pageNumber, props.documentId]);
  useEffect(() => { writeAttachmentSessionNumber(props.documentId, attachment.id, 'scale', scale); }, [attachment.id, props.documentId, scale]);
  const selectTextLayer = useCallback((number: number, layer: HTMLDivElement | null) => {
    if (layer) textLayersRef.current.set(number, layer); else {
      textLayersRef.current.delete(number);
      setRenderedScales((current) => {
        if (!(number in current)) return current;
        const next = { ...current }; delete next[number]; return next;
      });
    }
    if (number === currentPageRef.current) activeTextRef.current = layer;
    setRenderRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    currentPageRef.current = pageNumber;
    activeTextRef.current = textLayersRef.current.get(pageNumber) ?? null;
    setRenderRevision((value) => value + 1);
  }, [pageNumber]);
  const markRendered = useCallback((renderedPage: number, rendered: number) => {
    setRenderedScales((current) => current[renderedPage] === rendered ? current : { ...current, [renderedPage]: rendered });
  }, []);
  const goToPage = useCallback((requested: number, smooth = true) => {
    const next = Math.min(pdf?.numPages ?? 1, Math.max(1, requested || 1)); setPageNumber(next);
    if (viewMode === 'continuous') window.requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-library-pdf-page="${next}"]`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
  }, [pdf?.numPages, viewMode]);
  useEffect(() => {
    localStorage.setItem('nodus.library.pdfViewMode', viewMode);
    if (viewMode !== 'continuous') return;
    const frame = window.requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-library-pdf-page="${currentPageRef.current}"]`)?.scrollIntoView({ behavior: 'auto', block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [viewMode]);
  useEffect(() => {
    const scroller = scrollRef.current; if (!scroller || viewMode !== 'continuous') return;
    let frame = 0;
    const updateCurrentPage = () => {
      window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 24;
        const closest = Array.from(scroller.querySelectorAll<HTMLElement>('[data-library-pdf-page]')).reduce<{ page: number; distance: number } | null>((best, element) => {
          const page = Number(element.dataset.libraryPdfPage || 0); const distance = Math.abs(element.getBoundingClientRect().top - top);
          return page && (!best || distance < best.distance) ? { page, distance } : best;
        }, null);
        if (closest) setPageNumber((current) => current === closest.page ? current : closest.page);
      });
    };
    updateCurrentPage(); scroller.addEventListener('scroll', updateCurrentPage, { passive: true });
    return () => { window.cancelAnimationFrame(frame); scroller.removeEventListener('scroll', updateCurrentPage); };
  }, [viewMode]);
  const loadFindSegments = useCallback(async (): Promise<FindTextSegment[]> => {
    if (!pdf) return [];
    if (findSegmentsRef.current?.pdf === pdf) return findSegmentsRef.current.promise;
    const promise = (async () => {
      const next: FindTextSegment[] = [];
      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex); const content = await page.getTextContent();
        next.push({ id: String(pageIndex), text: content.items.map((item) => 'str' in item && typeof item.str === 'string' ? item.str : '').join(' ') });
        if (pageIndex % 4 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      return next;
    })();
    findSegmentsRef.current = { pdf, promise }; return promise;
  }, [pdf]);
  const renderedScale = renderedScales[pageNumber] === scale ? scale : 0;
  const pageNumbers = pdf ? (viewMode === 'continuous' ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : [pageNumber]) : [];
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="library-reader-pdf-viewer" data-view-mode={viewMode} data-rendered-scale={renderedScale || undefined}>
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="flex items-center gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
        <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Anterior')} title={t('Anterior')} disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><Icon name="arrowLeft" size={13} /></button>
        <label><span className="sr-only">{t('Página')}</span><input aria-label={t('Página')} className="input h-8 w-14 text-center" type="number" min="1" max={pdf?.numPages ?? 1} value={pageNumber} onChange={(event) => goToPage(Number(event.target.value))} /></label>
        <span className="min-w-8 text-center text-xs tabular-nums text-neutral-500">/ {pdf?.numPages ?? '—'}</span>
        <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Siguiente')} title={t('Siguiente')} disabled={pageNumber >= (pdf?.numPages ?? 1)} onClick={() => goToPage(pageNumber + 1)}><Icon name="arrowRight" size={13} /></button>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
        <button data-testid="library-reader-pdf-zoom-out" className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Alejar')} title={t('Alejar')} onClick={() => setScale((value) => Math.max(.6, value - .15))}><Icon name="minus" size={13} /></button><button className="min-w-12 text-xs tabular-nums text-neutral-500" onClick={() => setScale(1.25)}>{Math.round(scale * 100)}%</button><button data-testid="library-reader-pdf-zoom-in" className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Acercar')} title={t('Acercar')} onClick={() => setScale((value) => Math.min(2.5, value + .15))}><Icon name="plus" size={13} /></button>
      </div>
      <div className="flex items-center rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800" role="group" aria-label={t('Modo de visualización')}>
        <button data-testid="library-reader-pdf-view-single" className={`btn h-8 w-8 p-0 ${viewMode === 'single' ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t('Vista individual')} title={t('Vista individual')} aria-pressed={viewMode === 'single'} onClick={() => setViewMode('single')}><Icon name="fileText" size={13} /></button>
        <button data-testid="library-reader-pdf-view-continuous" className={`btn h-8 w-8 p-0 ${viewMode === 'continuous' ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t('Vista continua')} title={t('Vista continua')} aria-pressed={viewMode === 'continuous'} onClick={() => setViewMode('continuous')}><Icon name="layers" size={13} /></button>
      </div>
      <button data-testid="library-reader-open-external" className="btn btn-ghost h-8" onClick={props.onOpenExternal} title={t('Abrir fuera de Nodus')}><Icon name="external" /><span className="max-md:hidden">{t('Abrir fuera de Nodus')}</span></button>
    </div>
    <main ref={scrollRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-neutral-200 p-6 dark:bg-black">
      {loading && <Spinner label={t('Cargando documento…')} />}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className={viewMode === 'continuous' ? 'space-y-6' : ''}>{pageNumbers.map((number) => <LibraryPdfPage key={`${number}:${scale}:${viewMode}`} pdf={pdf!} pageNumber={number} scale={scale} continuous={viewMode === 'continuous'} scrollRef={scrollRef} props={props} onTextLayer={selectTextLayer} onRendered={markRendered} onError={setError} />)}</div>
    </main>
    <FindInPage targetRef={activeTextRef} loadSegments={loadFindSegments} activeSegmentId={String(pageNumber)} onActivateSegment={(id) => goToPage(Number(id), false)} sourceRevision={`${pageNumber}:${renderedScale}:${renderRevision}`} ready={!loading && renderedScale > 0 && !!activeTextRef.current} emptyTextMessage={t('Este PDF no contiene texto buscable. Abre el Markdown limpio para consultar el OCR.')} placement="reader" />
  </section>;
}

function renderWasCancelled(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'RenderingCancelledException' || /rendering cancelled/i.test(cause.message));
}

function LibraryPdfPage({ pdf, pageNumber, scale, continuous, scrollRef, props, onTextLayer, onRendered, onError }: {
  pdf: PDFDocumentProxy; pageNumber: number; scale: number; continuous: boolean; scrollRef: RefObject<HTMLElement | null>; props: ViewerProps;
  onTextLayer(pageNumber: number, layer: HTMLDivElement | null): void; onRendered(pageNumber: number, scale: number): void; onError(message: string): void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null); const canvasRef = useRef<HTMLCanvasElement | null>(null); const textRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(!continuous); const [size, setSize] = useState({ width: 612 * scale, height: 792 * scale }); const [textReady, setTextReady] = useState(false);
  const scope = `attachment:${props.attachment.id}:page:${pageNumber}`;
  useEffect(() => {
    if (!continuous) { setNearViewport(true); return; }
    const shell = shellRef.current; if (!shell) return;
    const observer = new IntersectionObserver((entries) => setNearViewport(entries.some((entry) => entry.isIntersecting)), { root: scrollRef.current, rootMargin: '1000px 0px' });
    observer.observe(shell); return () => observer.disconnect();
  }, [continuous, scrollRef]);
  useEffect(() => {
    let cancelled = false; let renderTask: RenderTask | null = null; let textLayer: TextLayer | null = null;
    setTextReady(false); onTextLayer(pageNumber, null);
    void pdf.getPage(pageNumber).then(async (page) => {
      const viewport = page.getViewport({ scale }); if (cancelled) return;
      setSize({ width: viewport.width, height: viewport.height });
      if (!nearViewport || !canvasRef.current || !textRef.current) return;
      const canvas = canvasRef.current; const layer = textRef.current; const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      layer.replaceChildren(); layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D is not available.');
      renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); await renderTask.promise;
      if (cancelled) return;
      textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport }); await textLayer.render();
      if (cancelled) return;
      setTextReady(true); onTextLayer(pageNumber, layer); onRendered(pageNumber, scale);
    }).catch((cause) => { if (!cancelled && !renderWasCancelled(cause)) onError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; textLayer?.cancel(); renderTask?.cancel(); onTextLayer(pageNumber, null); };
  }, [nearViewport, onError, onRendered, onTextLayer, pageNumber, pdf, scale]);
  return <section className={continuous ? 'scroll-mt-6' : ''}>
    <div ref={shellRef} data-library-pdf-page={pageNumber} className="pdf-annotation-page relative mx-auto bg-white shadow-2xl" style={size}><canvas ref={canvasRef} className="block" /><div ref={textRef} className="textLayer" />{nearViewport && !textReady && <div className="absolute inset-0 grid place-items-center bg-white/80"><Spinner label={t('Renderizando PDF…')} /></div>}</div>
    {continuous && <p className="mt-2 text-center text-[10px] tabular-nums text-neutral-500">{t('Página')} {pageNumber}</p>}
    {textReady && <ReaderSelectionActions targetRef={textRef} scrollRef={scrollRef} contextId={`${props.documentId}:${scope}`} annotations={props.annotations.filter((entry) => entry.scope === scope)} highlighterColor={props.highlighterColor} onCreateAnnotation={(input) => props.onCreate(scope, { ...input, target: { type: 'text', attachmentId: props.attachment.id, page: pageNumber } })} onUpdateComment={props.onUpdateComment} onDeleteAnnotation={props.onDelete} onAnnotationError={props.onError} />}
  </section>;
}

function RichTextViewer(props: ViewerProps) {
  const [content, setContent] = useState<LibraryReaderAttachmentContent | null>(null);
  const [chapterIndex, setChapterIndex] = useState(() => attachmentSessionNumber(props.documentId, props.attachment.id, 'chapter', 0));
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setError(''); setContent(null); void window.nodus.getLibraryReaderAttachmentContent(props.documentId, props.attachment.id)
    .then((value) => { if (live) { setContent(value); if (value?.viewer === 'epub') setChapterIndex((index) => Math.min(Math.max(0, value.chapters.length - 1), index)); } }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); }); return () => { live = false; }; }, [props.attachment.id, props.documentId]);
  useEffect(() => { writeAttachmentSessionNumber(props.documentId, props.attachment.id, 'chapter', chapterIndex); }, [chapterIndex, props.attachment.id, props.documentId]);
  const findSegments = useMemo<FindTextSegment[]>(() => {
    if (!content) return [];
    return content.viewer === 'epub'
      ? content.chapters.map((chapter) => ({ id: chapter.id, text: chapter.text, label: chapter.title }))
      : [{ id: 'document', text: content.text }];
  }, [content]);
  const activateFindSegment = useCallback((id: string) => {
    if (!content || content.viewer !== 'epub') return;
    const next = content.chapters.findIndex((chapter) => chapter.id === id);
    if (next >= 0) setChapterIndex(next);
  }, [content]);
  // Sanitised once per chapter, not on every render (find, selection and annotations re-render it).
  const safeHtml = useMemo(() => content ? sanitizePublicationHtml(content.chapters[chapterIndex]?.html || content.html || '') : '', [content, chapterIndex]);
  if (error) return <UnavailableTextViewer message={error} />;
  if (!content) return <div className="grid flex-1 place-items-center"><Spinner label={t('Preparando el adjunto…')} /></div>;
  const chapter = content.chapters[chapterIndex]; const isEpub = content.viewer === 'epub'; const scope = isEpub ? `attachment:${props.attachment.id}:chapter:${chapter?.id}` : `attachment:${props.attachment.id}`;
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid={isEpub ? 'library-reader-epub-viewer' : 'library-reader-text-viewer'}>
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
      {isEpub && <><button className="btn btn-ghost h-8 w-8 shrink-0 p-0" aria-label={t('Anterior')} title={t('Anterior')} disabled={!chapterIndex} onClick={() => setChapterIndex((value) => Math.max(0, value - 1))}><Icon name="arrowLeft" size={13} /></button><select className="input h-8 min-w-40 flex-1" value={chapterIndex} onChange={(event) => setChapterIndex(Number(event.target.value))}>{content.chapters.map((entry, index) => <option key={entry.id} value={index}>{entry.title}</option>)}</select><button className="btn btn-ghost h-8 w-8 shrink-0 p-0" aria-label={t('Siguiente')} title={t('Siguiente')} disabled={chapterIndex >= content.chapters.length - 1} onClick={() => setChapterIndex((value) => Math.min(content.chapters.length - 1, value + 1))}><Icon name="arrowRight" size={13} /></button></>}
      <button data-testid="library-reader-open-external" className="btn btn-ghost ml-auto h-8" onClick={props.onOpenExternal} title={t('Abrir fuera de Nodus')}><Icon name="external" /><span className="max-md:hidden">{t('Abrir fuera de Nodus')}</span></button>
    </div>
    <TextSurface scope={scope} contextId={`${props.documentId}:${scope}`} annotations={props.annotations} highlighterColor={props.highlighterColor} onCreate={(nextScope, input) => props.onCreate(nextScope, { ...input, target: { type: 'text', attachmentId: props.attachment.id, ...(chapter ? { chapterId: chapter.id } : {}) } })} onUpdateComment={props.onUpdateComment} onDelete={props.onDelete} onError={props.onError} testId={content.viewer === 'html' ? 'library-reader-html-viewer' : isEpub ? 'library-reader-epub-content' : 'library-reader-text-content'} findSegments={findSegments} activeFindSegmentId={isEpub ? chapter?.id ?? '' : 'document'} onActivateFindSegment={activateFindSegment}>
      {(chapter?.html || content.html) ? <article className="prose prose-neutral max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: safeHtml }} /> : <pre className="whitespace-pre-wrap font-serif text-base leading-8">{chapter?.text || content.text}</pre>}
    </TextSurface>
  </section>;
}

const REGION_COLORS: Record<WritingDraftAnnotationColor, string> = { yellow: '#facc15', rose: '#fb7185', blue: '#60a5fa', mint: '#4ade80', lavender: '#a78bfa', peach: '#fb923c' };
function ImageViewer(props: ViewerProps) {
  const imageRef = useRef<HTMLImageElement | null>(null); const findTargetRef = useRef<HTMLElement | null>(null); const [drawing, setDrawing] = useState(false); const [start, setStart] = useState<{ x: number; y: number } | null>(null); const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const scope = `attachment:${props.attachment.id}`; const point = (event: ReactPointerEvent) => { const rect = imageRef.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const move = (event: ReactPointerEvent) => { if (!start) return; const end = point(event); setDraft({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }); };
  const finish = async () => { if (!draft || draft.width < .005 || draft.height < .005) { setStart(null); setDraft(null); return; } await props.onCreate(scope, { kind: 'highlight', color: props.highlighterColor || 'yellow', startOffset: 0, endOffset: 1, selectedText: '◼', prefix: '', suffix: '', target: { type: 'region', attachmentId: props.attachment.id, ...draft } }); setStart(null); setDraft(null); };
  const regions = props.annotations.filter((entry) => entry.scope === scope && entry.target?.type === 'region');
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="library-reader-image-viewer"><div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2"><button className={`btn h-8 ${drawing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDrawing((value) => !value)}><Icon name="highlighter" />{t('Marcar región')}</button><span className="text-[10px] text-neutral-500">{t('Arrastra sobre la imagen para subrayar una zona.')}</span><button data-testid="library-reader-open-external" className="btn btn-ghost ml-auto h-8" onClick={props.onOpenExternal}><Icon name="external" />{t('Abrir fuera de Nodus')}</button></div>
    <main ref={findTargetRef} className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-6 dark:bg-black"><div className="relative mx-auto w-fit max-w-full select-none"><img ref={imageRef} src={props.attachment.url || ''} alt={props.attachment.title} draggable={false} className={`max-h-[calc(100vh-15rem)] max-w-full object-contain shadow-2xl ${drawing ? 'cursor-crosshair' : ''}`} onPointerDown={(event) => { if (!drawing) return; event.currentTarget.setPointerCapture(event.pointerId); const value = point(event); setStart(value); setDraft({ ...value, width: 0, height: 0 }); }} onPointerMove={move} onPointerUp={() => void finish()} />
      {regions.map((annotation) => { const target = annotation.target!; if (target.type !== 'region') return null; return <button key={annotation.id} aria-label={t('Eliminar subrayado')} className="absolute border-2 bg-yellow-300/20 hover:bg-red-400/30" style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%`, width: `${target.width * 100}%`, height: `${target.height * 100}%`, borderColor: REGION_COLORS[annotation.color || 'yellow'] }} onClick={() => void confirm({ title: t('Eliminar subrayado'), message: t('¿Eliminar este subrayado?'), confirmLabel: t('Eliminar'), danger: true }).then(async (ok) => { if (ok) await props.onDelete(annotation.id); })} />; })}
      {draft && <span className="pointer-events-none absolute border-2 border-indigo-400 bg-indigo-300/20" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}</div></main>
    <FindInPage targetRef={findTargetRef} unavailableMessage={t('Las imágenes no contienen una capa textual. Usa el Markdown limpio para buscar el OCR.')} placement="reader" />
  </section>;
}

function UnavailableTextViewer({ message }: { message: string }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  return <div ref={targetRef} className="grid flex-1 place-items-center p-8 text-center"><p className="text-sm text-red-400">{message}</p><FindInPage targetRef={targetRef} unavailableMessage={t('Este archivo no contiene una capa de texto que Nodus pueda buscar.')} placement="reader" /></div>;
}

function ExternalViewer({ props }: { props: ViewerProps }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  return <div ref={targetRef} className="grid flex-1 place-items-center p-8 text-center"><div><Icon name="archive" size={40} className="mx-auto text-neutral-500" /><h2 className="mt-3 font-semibold">{props.attachment.title}</h2><p className="mt-1 max-w-md text-xs text-neutral-500">{tx('Nodus conserva este archivo. Usa la versión limpia para subrayar el texto o ábrelo con su aplicación compatible.', {})}</p><button data-testid="library-reader-open-external" className="btn btn-primary mt-5" onClick={props.onOpenExternal}><Icon name="external" />{t('Abrir fuera de Nodus')}</button></div><FindInPage targetRef={targetRef} unavailableMessage={t('Este archivo no contiene una capa de texto que Nodus pueda buscar.')} placement="reader" /></div>;
}

export function LibraryAttachmentViewer(props: ViewerProps) {
  if (!props.attachment.available) return <UnavailableTextViewer message={t('El archivo no está disponible en este dispositivo.')} />;
  if (props.attachment.viewer === 'pdf') return <PdfViewer key={`${props.documentId}:${props.attachment.id}`} {...props} />;
  if (props.attachment.viewer === 'epub' || props.attachment.viewer === 'html' || props.attachment.viewer === 'text') return <RichTextViewer key={`${props.documentId}:${props.attachment.id}`} {...props} />;
  if (props.attachment.viewer === 'image') return <ImageViewer {...props} />;
  return <ExternalViewer props={props} />;
}
