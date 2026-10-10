import { useEffect, useState } from 'react';
import type { EdgeDetail, IdeaDetail, IdeaType, WorkMeta, WorkSummary, WorkView } from '@shared/types';
import { EDGE_LABELS, NODE_LABELS, Badge, Icon } from './ui';
import { SaveToNotesModal } from './SaveToNotesModal';
import { buildEdgeNote, buildIdeaNote } from '../notes';
import { parsePageNumber } from '@shared/pageLocation';
import { openEvidenceAtPage } from '../evidenceJump';
import { t } from '../i18n';
import { isPhoneSurface } from '../mobileWeb/phoneLayout';
import { MobileSheet } from './MobileSheet';

// Persisted detail-panel sizing, shared by the graph view and the argument map.
export const DETAIL_WIDTH_KEY = 'nodus.graph.detailWidth';
export const DETAIL_FONT_KEY = 'nodus.graph.detailFontSize';

export const DETAIL_MIN_WIDTH = 320;
export const DETAIL_MAX_WIDTH = 720;
export const DETAIL_DEFAULT_WIDTH = 384;
export const DETAIL_MIN_FONT = 12;
export const DETAIL_MAX_FONT = 20;
export const DETAIL_DEFAULT_FONT = 14;

export function loadNumber(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export interface DetailLoading {
  kind: 'idea' | 'edge';
  id: string;
  label: string;
  type?: string;
}

/**
 * Right-hand detail panel. Opens instantly with a loading skeleton when
 * `loading` is set (so taps/selections never feel frozen), then fills with the
 * idea or edge detail. Reused by the graph view and the argument map.
 */
/** One typed relation of the open idea, ready to render + navigate. */
export interface RelationRow {
  id: string;
  edgeId?: string;
  direction?: 'incoming' | 'outgoing';
  label: string;
  relLabel: string;
  relColor: string;
  themeLabel?: string;
  /** True when the neighbour lives in a different theme (a cross-theme bridge). */
  isBridge: boolean;
}

export function NodeDetailPanel({
  ideaDetail,
  edgeDetail,
  loading,
  width,
  fontSize,
  onWidthChange,
  onFontChange,
  onClose,
  relations,
  onOpenIdea,
  onEditIdea,
  onEdgeFeedback,
  onOpenEvidence,
  showEdgeAudit = true,
  onSaveIdea,
  onSaveEdge,
  readOnly = false,
  edgeLabel,
  edgeContext,
}: {
  readOnly?: boolean;
  edgeLabel?: string;
  edgeContext?: string;
  ideaDetail: IdeaDetail | null;
  edgeDetail: EdgeDetail | null;
  loading: DetailLoading | null;
  width: number;
  fontSize: number;
  onWidthChange: (width: number) => void;
  onFontChange: (delta: number) => void;
  onClose: () => void;
  /** Typed relations of the open idea (cross-theme included); enables the
   *  navigable "Conectada con" list. */
  relations?: RelationRow[];
  onOpenIdea?: (ideaId: string) => void;
  onEditIdea?: (ideaId: string) => void;
  /** Called after the user sets/clears an audit verdict, so the host view can refresh its graph. */
  onEdgeFeedback?: (verdict: 'rejected' | 'confirmed' | null) => void;
  onOpenEvidence?: (sourceRef: string, location: string | null, quote?: string) => void;
  showEdgeAudit?: boolean;
  onSaveIdea?: (detail: IdeaDetail) => Promise<void>;
  onSaveEdge?: (detail: EdgeDetail) => Promise<void>;
}) {
  // A note pending capture: built lazily from whichever detail is open.
  const [saving, setSaving] = useState<{ content: string; title: string; ref: string } | null>(null);
  const [savingExternal, setSavingExternal] = useState(false);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (evt: PointerEvent) => {
      onWidthChange(Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, startWidth + startX - evt.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const panel = (
    <div className="relative flex min-h-0 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900 graph-detail-panel" style={{ width, '--detail-font-size': `${fontSize}px` } as React.CSSProperties}>
      <div
        className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize hover:bg-indigo-500/25"
        role="separator"
        aria-orientation="vertical"
        title={t('Ajustar ancho')}
        onPointerDown={startResize}
      />
      <div className="graph-detail-header relative z-10 flex shrink-0 items-center justify-end gap-1 border-b border-neutral-800 px-4 py-2">
        {ideaDetail && onEditIdea && <button className="btn btn-primary mr-auto text-xs" data-testid="graph-edit-manual-idea" onClick={() => onEditIdea(ideaDetail.idea.global_id)}><Icon name="edit" size={13} /> {t('Editar')}</button>}
        {!onEditIdea && !readOnly && (ideaDetail || edgeDetail) && (
          <button
            className="card mr-auto inline-flex items-center gap-1.5 bg-neutral-900 px-2 py-1 text-xs hover:bg-neutral-800"
            title={t('Guardar en notas')}
            disabled={savingExternal}
            onClick={() => {
              if (ideaDetail) {
                if (onSaveIdea) {
                  setSavingExternal(true);
                  void onSaveIdea(ideaDetail).finally(() => setSavingExternal(false));
                  return;
                }
                setSaving({
                  content: buildIdeaNote(ideaDetail),
                  title: ideaDetail.idea.label,
                  ref: ideaDetail.idea.global_id,
                });
              } else if (edgeDetail) {
                if (onSaveEdge) {
                  setSavingExternal(true);
                  void onSaveEdge(edgeDetail).finally(() => setSavingExternal(false));
                  return;
                }
                setSaving({
                  content: buildEdgeNote(edgeDetail),
                  title: `${edgeDetail.fromLabel} → ${edgeDetail.toLabel}`,
                  ref: edgeDetail.edge.id,
                });
              }
            }}
          >
            <Icon name="notebook" size={13} /> {t(savingExternal ? 'Guardando…' : 'Guardar en notas')}
          </button>
        )}
        <button className="card bg-neutral-900 px-2 py-1 hover:bg-neutral-800 text-xs" aria-label={t('Disminuir texto')} title={t('Disminuir texto')} onClick={() => onFontChange(-1)}>
          a
        </button>
        <button className="card bg-neutral-900 px-2 py-1 hover:bg-neutral-800 text-sm font-semibold" aria-label={t('Aumentar texto')} title={t('Aumentar texto')} onClick={() => onFontChange(1)}>
          A
        </button>
        <button className="ml-2 inline-flex items-center justify-center text-neutral-500 hover:text-white" data-testid="graph-close-detail" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={onClose}>
          <Icon name="x" size={18}/>
        </button>
      </div>
      <div className="graph-detail-scroll mt-6 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {loading && !ideaDetail && !edgeDetail && (
        <div className="space-y-3 animate-pulse">
          {loading.kind === 'idea' ? (
            <>
              <div>
                <Badge color="indigo">{t(NODE_LABELS[loading.type as IdeaType]) ?? loading.type ?? ''}</Badge>
                <h3 className="font-semibold mt-2">{loading.label}</h3>
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-3 bg-neutral-800 rounded mt-1.5 w-full" />
                <div className="h-3 bg-neutral-800 rounded mt-1.5 w-5/6" />
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-500 mb-1">{t('Obras que la desarrollan')}</div>
                <div className="card p-3 mb-2">
                  <div className="h-3 bg-neutral-800 rounded w-2/3" />
                  <div className="h-2.5 bg-neutral-800 rounded mt-2 w-1/2" />
                </div>
                <div className="card p-3 mb-2">
                  <div className="h-3 bg-neutral-800 rounded w-3/4" />
                  <div className="h-2.5 bg-neutral-800 rounded mt-2 w-2/5" />
                </div>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-semibold">{t(EDGE_LABELS[loading.label as keyof typeof EDGE_LABELS]) ?? loading.label}</h3>
              <div className="h-3 bg-neutral-800 rounded w-1/2" />
              <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
            </>
          )}
        </div>
      )}
      {ideaDetail && (
        <div className="space-y-3">
          <div>
            <Badge color="indigo">{t(NODE_LABELS[ideaDetail.idea.type as IdeaType]) ?? ideaDetail.idea.type}</Badge>
            <h3 className="font-semibold mt-2">{ideaDetail.idea.label}</h3>
            <p className="text-neutral-400 mt-1">{ideaDetail.idea.statement}</p>
          </div>
          {relations && relations.length > 0 && (
            <div>
              <div className="text-xs uppercase text-neutral-500 mb-1">{t('Conectada con')}</div>
              <div className="-mx-1">
                {relations.map((r) => (
                  <button
                    key={r.edgeId || r.id}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-800"
                    onClick={() => onOpenIdea?.(r.id)}
                    title={t('Abrir esta idea')}
                  >
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.relColor }} />
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug text-neutral-200">{r.label}</span>
                      <span className="text-[11px] text-neutral-500">
                        {r.direction && (r.direction === 'incoming' ? `${t('Entrante')} ← · ` : `${t('Saliente')} → · `)}{r.relLabel}
                        {r.themeLabel && (
                          <>
                            {' · '}
                            <span className={r.isBridge ? 'font-medium text-amber-400' : 'text-neutral-500'}>
                              {r.isBridge ? '→ ' : ''}
                              {r.themeLabel}
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs uppercase text-neutral-500 mb-1">{t('Obras que la desarrollan')}</div>
            {ideaDetail.occurrences.map((o) => (
              <OccurrenceCard key={o.nodus_id} occurrence={o} readOnly={readOnly} />
            ))}
          </div>
          {ideaDetail.evidence.length > 0 && (
            <div>
              <div className="text-xs uppercase text-neutral-500 mb-1">{t('Evidencia anclada')}</div>
              {ideaDetail.evidence.map((ev) => (
                <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
                  “{ev.quote}” <EvidenceLocationLink nodusId={ev.nodus_id} location={ev.location} quote={ev.quote} sourceRef={ev.source_ref} pageNumber={ev.page_number} suffix={` · ${ev.kind}`} onOpen={onOpenEvidence} />
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
      {edgeDetail && (
        <div className="space-y-3">
          <h3 className="font-semibold">
            {t(edgeLabel || EDGE_LABELS[edgeDetail.edge.type as keyof typeof EDGE_LABELS] || edgeDetail.edge.type)}
          </h3>
          {edgeDetail.explanation && <p className="text-neutral-300">{edgeDetail.explanation}</p>}
          <div className="text-neutral-400">
            <span className="text-neutral-200">{edgeDetail.fromLabel}</span> → <span className="text-neutral-200">{edgeDetail.toLabel}</span>
          </div>
          <div className="flex gap-2">
            <Badge color={edgeDetail.edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeDetail.edge.basis}</Badge>
            <Badge>conf {edgeDetail.edge.confidence.toFixed(2)}</Badge>
            {edgeDetail.trace?.method && <Badge>{edgeDetail.trace.method}</Badge>}
            {edgeDetail.trace?.similarity != null && <Badge>sim {edgeDetail.trace.similarity.toFixed(2)}</Badge>}
          </div>
          {edgeContext && <p className="text-xs text-neutral-400">{edgeContext}</p>}
          {edgeDetail.trace && (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/35 p-3 text-xs text-neutral-300 space-y-1">
              {edgeDetail.trace.rationale && <p>{edgeDetail.trace.rationale}</p>}
              {(edgeDetail.trace.model || edgeDetail.trace.embeddingModel) && (
                <p className="text-neutral-500">
                  {edgeDetail.trace.model ? `${edgeDetail.trace.model.provider}/${edgeDetail.trace.model.model}` : t('modelo IA no registrado')}
                  {edgeDetail.trace.embeddingModel ? ` · ${t('embeddings')} ${edgeDetail.trace.embeddingProvider}/${edgeDetail.trace.embeddingModel}` : ''}
                </p>
              )}
            </div>
          )}
          {edgeDetail.evidence.map((ev) => (
            <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
              “{ev.quote}” <EvidenceLocationLink nodusId={ev.nodus_id} location={ev.location} quote={ev.quote} sourceRef={ev.source_ref} pageNumber={ev.page_number} onOpen={onOpenEvidence} />
            </blockquote>
          ))}
          {showEdgeAudit && <EdgeAuditControls edgeDetail={edgeDetail} onEdgeFeedback={onEdgeFeedback} />}
        </div>
      )}
      </div>
      {saving && (
        <SaveToNotesModal
          content={saving.content}
          defaultTitle={saving.title}
          kind="idea"
          source={{ origin: 'idea', ref: saving.ref }}
          onClose={() => setSaving(null)}
        />
      )}
    </div>
  );
  return isPhoneSurface() ? <MobileSheet title={ideaDetail?.idea.label ?? loading?.label ?? edgeDetail?.fromLabel ?? t('Idea seleccionada')} onClose={onClose}>{panel}</MobileSheet> : panel;
}

/**
 * The location tail of an evidence quote. A page opens that exact position;
 * a source reference without a page still opens the exact attachment. It stays
 * plain text only when neither locator nor a custom opener is available.
 */
export function EvidenceLocationLink({
  nodusId,
  location,
  sourceRef = null,
  pageNumber = null,
  suffix = '',
  quote,
  onOpen,
}: {
  nodusId: string;
  location: string | null;
  sourceRef?: string | null;
  pageNumber?: number | null;
  suffix?: string;
  quote?: string;
  onOpen?: (sourceRef: string, location: string | null, quote?: string) => void;
}) {
  const page = pageNumber ?? parsePageNumber(location);
  if ((!window.nodus && !onOpen) || (page === null && !sourceRef && !onOpen)) {
    return <span className="text-neutral-500 not-italic">{(location ?? '') + suffix}</span>;
  }
  return (
    <span className="text-neutral-500 not-italic">
      <button
        className="inline-flex items-center gap-0.5 text-indigo-400 hover:text-indigo-300"
        title={t('Abrir fuente')}
        onClick={() => onOpen
          ? onOpen(sourceRef ?? nodusId, location, quote)
          : void openEvidenceAtPage(nodusId, { location, sourceRef, pageNumber: page })}
      >
        <Icon name="external" size={11} /> {location || t('Abrir fuente')}
      </button>
      {suffix}
    </span>
  );
}

/**
 * Audit controls for one relation. The verdict is keyed by the idea pair +
 * type in the DB, so it survives rescans: a rejected relation stays hidden
 * even if a pipeline pass recreates the edge row.
 */
function EdgeAuditControls({
  edgeDetail,
  onEdgeFeedback,
}: {
  edgeDetail: EdgeDetail;
  onEdgeFeedback?: (verdict: 'rejected' | 'confirmed' | null) => void;
}) {
  const [verdict, setVerdict] = useState<'rejected' | 'confirmed' | null>(edgeDetail.feedback?.verdict ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setVerdict(edgeDetail.feedback?.verdict ?? null);
  }, [edgeDetail.edge.id, edgeDetail.feedback?.verdict]);

  const apply = async (next: 'rejected' | 'confirmed' | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await window.nodus.setEdgeFeedback(edgeDetail.edge.from_id, edgeDetail.edge.to_id, edgeDetail.edge.type, next);
      setVerdict(next);
      onEdgeFeedback?.(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/35 p-3 space-y-2">
      <div className="text-xs uppercase text-neutral-500">{t('Auditoría de la relación')}</div>
      {verdict === 'confirmed' && <p className="text-xs text-emerald-400">{t('Has confirmado esta relación.')}</p>}
      {verdict === 'rejected' && (
        <p className="text-xs text-red-400">{t('Has marcado esta relación como incorrecta: desaparecerá del grafo y de los análisis.')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {verdict !== 'confirmed' && (
          <button
            className="card px-2 py-1 text-xs text-emerald-300 hover:bg-neutral-800 disabled:opacity-50"
            disabled={busy}
            title={t('Marcar esta relación como verificada por ti')}
            onClick={() => void apply('confirmed')}
          >
            ✓ {t('Confirmar')}
          </button>
        )}
        {verdict !== 'rejected' && (
          <button
            className="card px-2 py-1 text-xs text-red-300 hover:bg-neutral-800 disabled:opacity-50"
            disabled={busy}
            title={t('Ocultar esta relación del grafo y de los análisis (persiste tras re-análisis)')}
            onClick={() => void apply('rejected')}
          >
            ✕ {t('Marcar como incorrecta')}
          </button>
        )}
        {verdict !== null && (
          <button
            className="card px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            disabled={busy}
            title={t('Quitar el veredicto y volver al estado derivado')}
            onClick={() => void apply(null)}
          >
            {t('Deshacer')}
          </button>
        )}
      </div>
    </div>
  );
}

const ITEM_TYPE_ES: Record<string, string> = {
  journalArticle: 'artículo de revista',
  magazineArticle: 'artículo de revista',
  newspaperArticle: 'artículo de periódico',
  bookSection: 'capítulo de libro',
  book: 'libro',
  conferencePaper: 'ponencia',
  thesis: 'tesis',
  report: 'informe',
  preprint: 'preprint',
  manuscript: 'manuscrito',
  webpage: 'página web',
  document: 'documento',
  encyclopediaArticle: 'entrada de enciclopedia',
};

function itemTypeLabel(type?: string | null): string | null {
  return type ? t(ITEM_TYPE_ES[type] ?? type) : null;
}

export function OccurrenceCard({ occurrence, readOnly=false }: { occurrence: IdeaDetail['occurrences'][number]; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<WorkSummary | null>(null);
  const work = occurrence.work;
  const author = work.authors[0] ?? t('Autor desconocido');
  const year = work.year ?? t('s.f.');

  useEffect(() => {
    let active = true;
    if (readOnly || work.summary_status !== 'done') return;
    void window.nodus.getWorkSummary(work.nodus_id).then((value) => {
      if (active) setSummary(value);
    });
    return () => {
      active = false;
    };
  }, [work.nodus_id, work.summary_status, readOnly]);

  return (
    <div className="card p-3 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-xs truncate">{work.title}</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">
            {author}
            {work.authors.length > 1 ? ' et al.' : ''} ({year})
          </div>
        </div>
        {!readOnly && <div className="flex items-center gap-1 shrink-0">
          <button
            className="inline-flex items-center justify-center text-neutral-500 hover:text-neutral-200 p-1"
            title={open ? t('Ocultar metadatos') : t('Mostrar metadatos')}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="info" size={14} />
          </button>
          <button
            className="inline-flex items-center gap-1 text-indigo-400 text-xs p-1 hover:text-indigo-300"
            title={t('Abrir en Zotero')}
            onClick={() => window.nodus.openInZotero(work.zotero_key)}
          >
            <Icon name="external" size={13} /> Zotero
          </button>
        </div>}
      </div>
      {open && <OccurrenceMeta work={work} />}
      <div className="text-[11px] text-neutral-500 mt-2">
        {occurrence.role} · conf {occurrence.confidence.toFixed(2)}
      </div>
      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{occurrence.development}</p>
      {summary && (
        <div className="mt-2 border-l-2 border-violet-700 pl-2 text-xs leading-relaxed text-neutral-300">
          <div className="mb-0.5 text-[10px] font-medium uppercase text-violet-300">{t('Resumen (orientación)')}</div>
          {summary.summary}
          <div className="mt-1 text-[10px] text-neutral-500">{t('No es evidencia citable.')}</div>
        </div>
      )}
    </div>
  );
}

/** Bibliographic detail for one occurrence — authors, venue, pages — read live from Zotero. */
function OccurrenceMeta({ work }: { work: WorkView }) {
  const [meta, setMeta] = useState<WorkMeta | null>(null);
  useEffect(() => {
    let on = true;
    void window.nodus.getWorkMeta(work.nodus_id).then((m) => {
      if (on) setMeta(m);
    });
    return () => {
      on = false;
    };
  }, [work.nodus_id]);

  const authors = meta?.authors?.length ? meta.authors : work.authors;
  const type = itemTypeLabel(meta?.itemType ?? work.item_type);
  const year = work.year ?? meta?.year ?? null;
  const venue: string[] = [];
  if (meta?.container) venue.push(meta.container);
  if (meta?.publisher) venue.push(meta.publisher);
  if (meta?.volume) venue.push(`${t('vol.')} ${meta.volume}${meta.issue ? `(${meta.issue})` : ''}`);
  else if (meta?.issue) venue.push(`${t('n.º')} ${meta.issue}`);
  if (meta?.pages) venue.push(`pp. ${meta.pages}`);
  else if (meta?.numPages) venue.push(`${meta.numPages} pp.`);
  if (meta?.place) venue.push(meta.place);

  return (
    <div className="text-[11px] text-neutral-500 mt-1 space-y-0.5">
      {authors.length > 0 && (
        <div className="text-neutral-400">
          {authors.slice(0, 4).join('; ')}
          {authors.length > 4 ? ' et al.' : ''}
        </div>
      )}
      {(type || year) && <div>{[type, year].filter(Boolean).join(' · ')}</div>}
      {venue.length > 0 && <div className="text-neutral-400">{venue.join(' · ')}</div>}
      {meta?.doi && <div className="font-mono truncate">doi:{meta.doi}</div>}
    </div>
  );
}
