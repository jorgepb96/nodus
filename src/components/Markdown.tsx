import { DocumentFigure, useDocumentFigures } from './DocumentFigures';
import { documentBlocks } from '@shared/documentSkills';
import { ChatVisual } from './ChatVisual';
import { Children, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';
import { remarkGuideCallouts } from './markdownCallouts';
import type { CitationPreview } from '@shared/types';
import { parseTestimonyLink, type TestimonyDeepLink } from '@shared/testimonyDeepLinks';
import { t } from '../i18n';
import { VERIFY_DEBOUNCE_MS, decodeCitationId, planCitationVerification } from '../citationVerification';
import { parsePrimarySourceExcerptDeepLink } from '@shared/primarySourceDeepLink';
import { rehypeGroupParenthesizedCitations } from '../markdownCitationGroups';

function citationChildren(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  return parts.every(part => typeof part === 'string') && /^fuente$/i.test(parts.join('').trim()) ? t('Fuente') : children;
}

const nodusUrlTransform = (value: string) => {
  if (value.startsWith('nodus://')) return value;
  return defaultUrlTransform(value);
};

// The reader updates its current section while smooth-scrolling. That can remount
// the Markdown subtree, so keep the last in-text origin outside the component as
// well as in its local ref. Stale entries are harmless: a missing source element
// falls back to the saved scroll offset, and the next citation replaces it.
interface InternalBackTarget {
  sourceId: string;
  scrollTop: number | null;
}

const INTERNAL_BACK_TARGETS = new Map<string, InternalBackTarget>();

/**
 * Renders AI-authored Markdown (tutor narration, chat answers). Links never navigate
 * the renderer: external links open in the user's browser via the safe `openExternal`
 * bridge, and `nodus://...` citations fire `onCitation` so the caller can open
 * source details or route to the graph (NotebookLM-style).
 * react-markdown does not render raw HTML by default, so this is XSS-safe.
 */
export interface MarkdownCitation {
  kind: 'idea' | 'work' | 'gap' | 'contradiction' | 'passage';
  id: string;
}

export interface MarkdownReaderCitation {
  documentId: string;
  sectionId?: string;
  page?: number;
}

function MarkdownComponent({
  content,
  className = '',
  onCitation,
  onReaderCitation,
  onStudyDocument,
  onStudyMaterial,
  onStudyRecording,
  onStudyEvidence,
  onGuideEvidence,
  onWorldEntry,
  onTestimonyLink,
  verify = true,
  allowDataImages = false,
  chatVisuals = false,
}: {
  content: string;
  chatVisuals?: boolean;
  className?: string;
  onCitation?: (citation: MarkdownCitation) => void;
  /** `nodus://reader/<document>[/section/<id>|/page/<n>]` returns to traced
   * evidence inside the currently open Library document. */
  onReaderCitation?: (citation: MarkdownReaderCitation) => void;
  /** `nodus://world/<kind>/<id>`. `kind` is `new` when the entry does not exist yet. */
  onWorldEntry?: (kind: string, id: string) => void;
  /** `nodus://testimonios/...`: abre la entrevista, el participante o el contraste, y
   *  salta al minuto exacto cuando el enlace lo lleva. */
  onTestimonyLink?: (link: TestimonyDeepLink) => void;
  onStudyDocument?: (documentId: string, location?: { from?: number | null }) => void;
  onStudyMaterial?: (materialId: string, location?: { pageNumber?: number | null; slideNumber?: number | null }) => void;
  onStudyRecording?: (recordingId: string, timestamp?: number | null) => void;
  onStudyEvidence?: (citationId: string) => void;
  /** Complete study guides: a citation carrying `e=<item>` can show its exact quote
   *  before opening the source; `open` performs the ordinary jump. */
  onGuideEvidence?: (itemId: string, open: () => void) => void;
  /** Resolve each `nodus://` citation against the corpus and flag unresolved ones. */
  verify?: boolean;
  /** Only for trusted local reader assets already confined by the main process. */
  allowDataImages?: boolean;
}) {
  const documentFigures = useDocumentFigures(content);
  const insertDocumentFigures = () => (tree: any) => {
    if (!documentFigures.length) return;
    const ranges = documentBlocks({ text: content });
    const inserted = new Set<string>();
    tree.children = tree.children.flatMap((node: any) => {
      const additions = documentFigures.filter(({ figure, block }) => !inserted.has(figure.id) && node.type === 'element' && node.position?.end?.line >= ranges[block.index]?.endLine);
      return [node, ...additions.map(({ figure }) => { inserted.add(figure.id); return { type: 'element', tagName: 'figure', properties: { 'dataDocumentFigure': figure.id }, children: [] }; })];
    });
  };
  // Validity of each citation, keyed by `${kind}:${id}`. A key absent from the map
  // is still being checked (treated as neutral); `false` means it did not resolve.
  const [validity, setValidity] = useState<Record<string, boolean>>({});
  const internalBackTargets = useRef<Record<string, InternalBackTarget>>({});
  const internalAnchorSequence = useRef(0);

  const navigateInternalAnchor = (origin: HTMLAnchorElement): void => {
    const href = origin.getAttribute('href');
    if (!href) return;
    const targetId = decodeURIComponent(href.slice(1));
    const target = document.getElementById(targetId);
    const storedReturn = internalBackTargets.current[targetId] ?? INTERNAL_BACK_TARGETS.get(targetId);
    const returnTarget = storedReturn ?? (target?.dataset.nodusReturnId
      ? { sourceId: target.dataset.nodusReturnId, scrollTop: null }
      : undefined);
    if (target?.contains(origin) && returnTarget) {
      const source = document.getElementById(returnTarget.sourceId);
      if (source) {
        source.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (returnTarget.scrollTop !== null) {
        const scrollSurface = origin.closest('.library-reader-clean-surface') as HTMLElement | null;
        scrollSurface?.scrollTo({ top: returnTarget.scrollTop, behavior: 'smooth' });
      }
      return;
    }
    if (!origin.id) origin.id = `nodus-internal-source-${++internalAnchorSequence.current}`;
    const scrollSurface = origin.closest('.library-reader-clean-surface') as HTMLElement | null;
    const backTarget = { sourceId: origin.id, scrollTop: scrollSurface?.scrollTop ?? null };
    internalBackTargets.current[targetId] = backTarget;
    INTERNAL_BACK_TARGETS.set(targetId, backTarget);
    if (target) target.dataset.nodusReturnId = origin.id;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Verification is deliberately deferred rather than run per render.
  //
  // While an answer streams, `content` grows by one delta at a time — dozens of
  // changes a second. Verifying on each of them fired an IPC round-trip whose
  // main-process handler runs a synchronous SQLite lookup *per citation*, and
  // since the citation list grows as the answer does, the total cost was
  // quadratic in the length of the answer. That starved the main process for
  // the whole duration of every cited response.
  //
  // Waiting for the content to settle collapses a whole stream into one call,
  // and skipping unchanged reference lists means edits that do not touch
  // citations cost nothing at all.
  const lastVerifiedRef = useRef<string>('');
  useEffect(() => {
    if (!verify) return;
    const plan = planCitationVerification(content, lastVerifiedRef.current);
    if (plan.action === 'skip') return;
    if (plan.action === 'clear') {
      lastVerifiedRef.current = '';
      setValidity((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    let on = true;
    const timer = setTimeout(() => {
      lastVerifiedRef.current = plan.key;
      void window.nodus.verifyCitations(plan.refs).then((map) => {
        if (on) setValidity(map);
      });
    }, VERIFY_DEBOUNCE_MS);
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [content, verify]);

  const components=useMemo<Components>(()=>({
          figure: ({ node }) => {
            const id = (node as any)?.properties?.dataDocumentFigure;
            const index = documentFigures.findIndex(item => item.figure.id === id);
            return index >= 0 ? <DocumentFigure figure={documentFigures[index].figure} number={documentFigures[index].number} onSource={source => {
              const parsed = parseCitation(source);
              if (parsed) { onCitation?.(parsed); return; }
              // Figures taken from a study material point back to its page or slide.
              const material = source.match(/^nodus:\/\/study\/material\/([^?]+)(?:\?(.*))?$/);
              if (material && onStudyMaterial) {
                const params = new URLSearchParams(material[2] ?? '');
                const number = (key: string) => { const value = Number(params.get(key)); return Number.isFinite(value) && value > 0 ? value : null; };
                onStudyMaterial(decodeURIComponent(material[1]), { pageNumber: number('page'), slideNumber: number('slide') });
                return;
              }
              // Attributed web images point to the file's page, where its licence is stated.
              if (/^https:\/\//i.test(source)) void window.nodus.openExternal(source);
            }} /> : null;
          },
          img: ({ src, alt }) => chatVisuals && src?.startsWith('nodus-image://chat/') ? <ChatVisual source={src} alt={alt} /> : <img src={src} alt={alt} />,
          p: ({ node, children, ...props }) => {
            const first = (node as any)?.children?.[0];
            const href = first?.tagName === 'a' ? String(first.properties?.href ?? '') : '';
            const id = href.startsWith('#nodus-reference-') ? decodeCitationId(href.slice(1)) ?? undefined : undefined;
            if (chatVisuals && (node as any)?.children?.some((child: any) => child.tagName === 'img')) return <div {...props} id={id}>{children}</div>;
            return <p {...props} id={id}>{children}</p>;
          },
          a: ({ node: _node, href, children, ...anchorProps }) => {
            if (href && href.startsWith('#')) {
              return <a {...anchorProps} href={href} data-nodus-internal-anchor="true" onClick={(event) => {
                event.preventDefault();
                navigateInternalAnchor(event.currentTarget);
              }}>{children}</a>;
            }
            const readerCitation = href?.match(/^nodus:\/\/reader\/([^/?]+)(?:\/(section|page)\/([^?]+))?$/);
            if (readerCitation && onReaderCitation) {
              const documentId = decodeCitationId(readerCitation[1]);
              const target = readerCitation[2];
              const value = readerCitation[3] ? decodeCitationId(readerCitation[3]) : undefined;
              // Still streaming inside a percent escape: plain text until the link is whole.
              if (documentId === null || value === null) return <span>{children}</span>;
              return <button
                className="citation-link"
                data-citation-kind="reader"
                title={t('Abrir cita en el lector')}
                onClick={() => onReaderCitation({
                  documentId,
                  ...(target === 'section' && value ? { sectionId: value } : {}),
                  ...(target === 'page' && value && Number.isFinite(Number(value)) ? { page: Number(value) } : {}),
                })}
                >{citationChildren(children)}</button>;
            }
            const studyMaterial = href?.match(/^nodus:\/\/study\/material\/([^?]+)(?:\?(.*))?$/);
            if (studyMaterial && onStudyMaterial) {
              const params = new URLSearchParams(studyMaterial[2] ?? '');
              const number = (key: string) => { const value = Number(params.get(key)); return Number.isFinite(value) && value > 0 ? value : null; };
              const open = () => onStudyMaterial(decodeURIComponent(studyMaterial[1]), { pageNumber: number('page'), slideNumber: number('slide') });
              const evidence = params.get('e');
              return <button className="text-teal-400 underline decoration-teal-700 underline-offset-2 hover:text-teal-300" onClick={() => (evidence && onGuideEvidence ? onGuideEvidence(evidence, open) : open())}>{children}</button>;
            }
            const studyEvidence = href?.match(/^nodus:\/\/study\/evidence\/(.+)$/);
            if (studyEvidence && onStudyEvidence) {
              return <button className="study-evidence-citation mx-0.5 inline-flex rounded-full border border-teal-800 bg-teal-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300 hover:border-teal-500" onClick={() => onStudyEvidence(decodeURIComponent(studyEvidence[1]))}>{children}</button>;
            }
            const studyDocument = href?.match(/^nodus:\/\/(?:study\/doc|note)\/([^?]+)(?:\?(.*))?$/);
            if (studyDocument && onStudyDocument) {
              const params = new URLSearchParams(studyDocument[2] ?? '');
              const from = Number(params.get('from'));
              const open = () => onStudyDocument(decodeURIComponent(studyDocument[1]), Number.isFinite(from) && params.has('from') ? { from } : undefined);
              const evidence = params.get('e');
              return <button className="text-indigo-400 underline decoration-indigo-700 underline-offset-2 hover:text-indigo-300" onClick={() => (evidence && onGuideEvidence ? onGuideEvidence(evidence, open) : open())}>{children}</button>;
            }
            const studyRecording = href?.match(/^nodus:\/\/study\/recording\/([^?]+)(?:\?(.*))?$/);
            if (studyRecording && onStudyRecording) {
              const params = new URLSearchParams(studyRecording[2] ?? '');
              const timestamp = params.get('t');
              const open = () => onStudyRecording(decodeURIComponent(studyRecording[1]), timestamp == null ? null : Number(timestamp));
              const evidence = params.get('e');
              return <button className="text-teal-400 underline decoration-teal-700 underline-offset-2 hover:text-teal-300" onClick={() => (evidence && onGuideEvidence ? onGuideEvidence(evidence, open) : open())}>{children}</button>;
            }
            // Encyclopedia links. Deliberately NOT routed through `parseCitation`: a
            // citation pill fetches a preview of an ACADEMIC source over IPC, which a
            // world entry has no answer for. The reserved kind `new` is a link the author
            // wrote as [[…]] and nobody has defined — rendered dashed so it reads as an
            // invitation rather than as a broken link.
            const worldEntry = href?.match(/^nodus:\/\/world\/([a-z]+)\/(.+)$/);
            if (worldEntry && onWorldEntry) {
              const kind = worldEntry[1];
              const id = decodeCitationId(worldEntry[2]);
              if (id === null) return <span>{children}</span>;
              return kind === 'new' ? (
                <button
                  className="border-b border-dashed border-amber-700/80 text-amber-400 hover:text-amber-300"
                  title={t('Esta entrada todavía no existe')}
                  onClick={() => onWorldEntry(kind, id)}
                >
                  {children}
                </button>
              ) : (
                <button
                  className="text-indigo-400 underline decoration-indigo-700 underline-offset-2 hover:text-indigo-300"
                  onClick={() => onWorldEntry(kind, id)}
                >
                  {children}
                </button>
              );
            }
            const primarySource = href ? parsePrimarySourceExcerptDeepLink(href) : null;
            if (primarySource) {
              return (
                <button
                  className="text-indigo-400 underline decoration-indigo-700 underline-offset-2 hover:text-indigo-300"
                  onClick={() => window.dispatchEvent(new CustomEvent(
                    'nodus:navigate-primary-source',
                    { detail: primarySource }
                  ))}
                >
                  {children}
                </button>
              );
            }
            // Enlaces de Testimonios. Van ANTES de `parseCitation` por lo mismo que los
            // del mundo: una píldora de cita pide por IPC la vista previa de una fuente
            // ACADÉMICA, y un fragmento de entrevista no tiene esa respuesta. Además, el
            // enlace lleva el minuto: pulsarlo tiene que devolver al audio, no abrir una
            // ficha bibliográfica.
            const testimonyLink = href?.startsWith('nodus://testimonios/') ? parseTestimonyLink(href) : null;
            if (testimonyLink && onTestimonyLink) {
              return (
                <button
                  className="text-indigo-400 underline decoration-indigo-700 underline-offset-2 hover:text-indigo-300"
                  onClick={() => onTestimonyLink(testimonyLink)}
                >
                  {children}
                </button>
              );
            }
            const citation = parseCitation(href);
            if (citation && onCitation) {
              const key = `${citation.kind}:${citation.id}`;
              const unverified = verify && validity[key] === false;
              return (
                <CitationLink citation={citation} unverified={unverified} onCitation={onCitation}>
                  {children}
                </CitationLink>
              );
            }
            return (
              <a
                {...anchorProps}
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) void window.nodus.openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
  }),[documentFigures,onCitation,onReaderCitation,onStudyDocument,onStudyMaterial,onStudyRecording,onStudyEvidence,onGuideEvidence,onWorldEntry,onTestimonyLink,verify,validity,chatVisuals]);

  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkGuideCallouts]}
        rehypePlugins={[rehypeKatex, rehypeGroupParenthesizedCitations, insertDocumentFigures]}
        urlTransform={(value, key) => {
          if (chatVisuals && key === 'src' && /^nodus-image:\/\/chat\/[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(value)) return value;
          if (allowDataImages && key === 'src' && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(value)) return value;
          return nodusUrlTransform(value);
        }}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Preserve live DOM selections and CSS Highlight ranges across parent renders. */
export const Markdown = memo(MarkdownComponent);

/**
 * Inline citation pill with a hover-card. Hovering (after a short delay, so a
 * cursor merely passing over the text does not flash cards) lazily fetches a
 * lightweight preview — title, source and a snippet — positioned above or below
 * the pill. The card is `position: fixed` so it escapes the chat's scroll
 * clipping, and `pointer-events: none` so it never steals the hover. Clicking
 * still opens the full source modal via `onCitation`.
 */
function CitationLink({
  citation,
  unverified,
  onCitation,
  children,
}: {
  citation: MarkdownCitation;
  unverified: boolean;
  onCitation: (citation: MarkdownCitation) => void;
  children: ReactNode;
}) {
  const [preview, setPreview] = useState<CitationPreview | 'loading' | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const fetchedRef = useRef(false);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  const reveal = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const placement: 'top' | 'bottom' = rect.top > 240 ? 'top' : 'bottom';
    setPos({
      top: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - 340)),
      placement,
    });
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      setPreview('loading');
      // Secondary windows intentionally expose a narrowed bridge. If that contract
      // ever drifts again, invoking a missing method throws synchronously — before a
      // Promise exists for `.catch()` — and would otherwise strand the card on
      // "Loading…" forever.
      try {
        void window.nodus
          .getCitationPreview({ kind: citation.kind, id: citation.id })
          .then((value) => setPreview(value))
          .catch(() => {
            fetchedRef.current = false;
            setPreview(null);
          });
      } catch {
        fetchedRef.current = false;
        setPreview(null);
      }
    }
  };

  const onEnter = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(reveal, 320);
  };
  const onLeave = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPos(null);
  };

  return (
    <span className="citation-wrap" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        ref={btnRef}
        type="button"
        className="citation-link"
        data-citation-kind={citation.kind}
        data-citation-id={citation.id}
        data-web-source={citation.kind === 'passage' && citation.id.startsWith('web:') ? 'true' : undefined}
        data-verified={unverified ? 'false' : undefined}
        title={
          unverified
            ? t('Fuente no encontrada: esta cita no se pudo verificar en el corpus.')
            : citation.kind === 'passage' && citation.id.startsWith('web:') ? t('Abrir la fuente web en una pestaña nueva del navegador de Nodus')
            : `${t('Abrir fuente:')} ${citationLabel(citation.kind)}`
        }
        onClick={(e) => {
          e.preventDefault();
          onCitation(citation);
        }}
      >
        {citationChildren(children)}
        {unverified && (
          <span aria-hidden className="citation-warn">
            ⚠
          </span>
        )}
      </button>
      {pos && preview !== null && (
        <span
          className="citation-card"
          data-placement={pos.placement}
          style={{ top: pos.top, left: pos.left }}
        >
          {preview === 'loading' ? (
            <span className="citation-card-loading">{t('Cargando…')}</span>
          ) : (
            <>
              <span className="citation-card-kind">{preview.url ? t('Fuente web') : citationLabel(preview.kind)}</span>
              <span className="citation-card-title">{preview.title}</span>
              {preview.subtitle && <span className="citation-card-sub">{preview.subtitle}</span>}
              {preview.url && <span className="citation-card-url" data-testid="citation-card-url">{preview.url}</span>}
              {preview.snippet && <span className="citation-card-snippet">{preview.snippet}</span>}
            </>
          )}
        </span>
      )}
    </span>
  );
}

function parseCitation(href: string | undefined): MarkdownCitation | null {
  if (!href) return null;
  // Mid-stream a link can end inside a percent escape; it becomes a citation once complete.
  const citation = (kind: MarkdownCitation['kind'], encoded: string): MarkdownCitation | null => {
    const id = decodeCitationId(encoded);
    return id === null ? null : { kind, id };
  };
  const idea = href.match(/^nodus:\/\/idea\/(.+)$/);
  if (idea) return citation('idea', idea[1]);
  const work = href.match(/^nodus:\/\/work\/(.+)$/);
  if (work) return citation('work', work[1]);
  const gap = href.match(/^nodus:\/\/gap\/(.+)$/);
  if (gap) return citation('gap', gap[1]);
  const contradiction = href.match(/^nodus:\/\/contradiction\/(.+)$/);
  if (contradiction) return citation('contradiction', contradiction[1]);
  const passage = href.match(/^nodus:\/\/passage\/(.+)$/);
  if (passage) return citation('passage', passage[1]);
  return null;
}

function citationLabel(kind: MarkdownCitation['kind']): string {
  switch (kind) {
    case 'idea':
      return t('idea');
    case 'work':
      return t('documento');
    case 'gap':
      return t('hueco de investigación');
    case 'contradiction':
      return t('contradicción');
    case 'passage':
      return t('pasaje');
  }
}
