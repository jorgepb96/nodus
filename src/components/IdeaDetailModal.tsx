import {useLearningEvidenceVisibility} from '../learning/useLearningEvidenceVisibility';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EdgeDetail, IdeaDetail, IdeaType } from '@shared/types';
import { Badge, EDGE_LABELS, Icon, NODE_LABELS } from './ui';
import { EvidenceLocationLink, OccurrenceCard } from './NodeDetailPanel';
import { SaveToNotesModal } from './SaveToNotesModal';
import { buildIdeaNote } from '../notes';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

function ideaTypeLabel(type: IdeaType): string {
  return t(NODE_LABELS[type]) ?? type;
}

function edgeTypeLabel(type: EdgeDetail['edge']['type']): string {
  return t(EDGE_LABELS[type]) ?? type;
}

export function IdeaDetailModal({
  initialIdeaId,
  onClose,
  onOpenGraph,
}: {
  initialIdeaId: string;
  onClose: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState([initialIdeaId]);
  const [pos, setPos] = useState(0);
  const selectedId = history[pos] ?? initialIdeaId;
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [edges, setEdges] = useState<EdgeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingNote, setSavingNote] = useState<IdeaDetail | null>(null);

  useEffect(() => {
    setHistory([initialIdeaId]);
    setPos(0);
  }, [initialIdeaId]);

  useEffect(() => {
    let on = true;
    setLoading(true);
    setDetail(null);
    setEdges([]);
    void Promise.all([window.nodus.getIdeaDetail(selectedId), window.nodus.getIdeaEdges(selectedId)]).then(([idea, nextEdges]) => {
      if (!on) return;
      setDetail(idea);
      setEdges(nextEdges);
      setLoading(false);
    });
    return () => {
      on = false;
    };
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const navigateTo = useCallback(
    (id: string) => {
      setHistory((current) => [...current.slice(0, pos + 1), id]);
      setPos((current) => current + 1);
    },
    [pos]
  );

  useLearningEvidenceVisibility(detail,modalRef);

  const connections = useMemo(
    () =>
      edges.map((edge) => {
        const outgoing = edge.edge.from_id === selectedId;
        return {
          edgeId: edge.edge.id,
          otherId: outgoing ? edge.edge.to_id : edge.edge.from_id,
          otherLabel: outgoing ? edge.toLabel : edge.fromLabel,
          type: edge.edge.type,
          confidence: edge.edge.confidence,
          outgoing,
        };
      }),
    [edges, selectedId]
  );

  const canGoBack = pos > 0;
  const canGoForward = pos < history.length - 1;

  // Into <body>, so a `space-y-*` stack in the caller (the author dossier) can
  // never hand the overlay a top margin that uncovers the title bar.
  return createPortal(
    <div ref={modalRef} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-8" data-testid="idea-detail-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="card flex h-full w-full max-w-4xl flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <Icon name="bulb" size={17} className="text-amber-300" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{detail?.idea.label ?? t('Detalle de idea')}</h2>
            <p className="text-xs text-neutral-500">{t('Descripción, obras, evidencias y conexiones')}</p>
          </div>
          <div className="flex-1" />
          <button className="btn btn-ghost px-2 py-1" title={t('Cerrar')} onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <button
              className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
              title={t('Idea anterior')}
              disabled={!canGoBack}
              onClick={() => setPos((current) => Math.max(0, current - 1))}
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <button
              className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
              title={t('Idea siguiente')}
              disabled={!canGoForward}
              onClick={() => setPos((current) => Math.min(history.length - 1, current + 1))}
            >
              <Icon name="chevronRight" size={14} />
            </button>
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5 px-2 py-1 text-xs disabled:opacity-40"
              title={t('Volver a la idea de origen')}
              disabled={!canGoBack}
              onClick={() => setPos(0)}
            >
              <Icon name="home" size={13} /> {t('Origen')}
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-neutral-600">{tx('{i} de {n}', { i: pos + 1, n: history.length })}</span>
          </div>

          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-1/3 rounded bg-neutral-800" />
              <div className="h-3 w-3/4 rounded bg-neutral-800" />
              <div className="h-3 w-full rounded bg-neutral-800" />
              <div className="h-24 rounded bg-neutral-800" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div>
                <Badge color="indigo">{ideaTypeLabel(detail.idea.type as IdeaType)}</Badge>
                <h3 className="mt-2 text-base font-semibold leading-snug">{detail.idea.label}</h3>
                <p className="mt-1 text-sm text-neutral-400">{detail.idea.statement}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary gap-1.5 text-xs"
                  title={t('Ver este nodo y sus conexiones en el grafo')}
                  onClick={() => {
                    onClose();
                    onOpenGraph({ preset: 'overview', nodeId: detail.idea.global_id, label: detail.idea.label });
                  }}
                >
                  <Icon name="compass" size={13} /> {t('Ver en el grafo')}
                </button>
                <button
                  className="btn btn-ghost gap-1.5 border border-neutral-700 text-xs"
                  title={t('Guardar esta idea en notas')}
                  onClick={() => setSavingNote(detail)}
                >
                  <Icon name="notebook" size={13} /> {t('Guardar en notas')}
                </button>
              </div>

              <section>
                <div className="mb-1 text-xs uppercase text-neutral-500">{tx('Conexiones ({n})', { n: connections.length })}</div>
                {connections.length === 0 ? (
                  <p className="text-xs text-neutral-500">{t('Esta idea aún no tiene conexiones con otras ideas.')}</p>
                ) : (
                  <ul className="space-y-1">
                    {connections.map((connection) => (
                      <li key={connection.edgeId}>
                        <button
                          className="flex w-full items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-left hover:border-neutral-700 hover:bg-neutral-900/60"
                          title={t('Ver esta idea conectada')}
                          onClick={() => navigateTo(connection.otherId)}
                        >
                          <Badge color="cyan">{edgeTypeLabel(connection.type)}</Badge>
                          <Icon
                            name={connection.outgoing ? 'arrowDown' : 'arrowUp'}
                            size={12}
                            className={connection.outgoing ? 'text-neutral-500 rotate-90' : 'text-neutral-500 -rotate-90'}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{connection.otherLabel}</span>
                          <span className="shrink-0 text-[10px] text-neutral-500">
                            {t('conf')} {connection.confidence.toFixed(2)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="mb-1 text-xs uppercase text-neutral-500">{t('Obras que la desarrollan')}</div>
                {detail.occurrences.length === 0 && <p className="text-xs text-neutral-500">{t('Sin obras vinculadas.')}</p>}
                {detail.occurrences.map((occurrence) => (
                  <OccurrenceCard key={occurrence.nodus_id} occurrence={occurrence} />
                ))}
              </section>

              {detail.evidence.length > 0 && (
                <section>
                  <div className="mb-1 text-xs uppercase text-neutral-500">{t('Evidencia anclada')}</div>
                  {detail.evidence.map((evidence) => (
                    <blockquote
                      key={evidence.id}
                      data-evidence-id={evidence.id}
                      className="my-2 rounded-r-md border-l-2 border-indigo-700 bg-neutral-950/35 py-2 pl-3 text-xs italic text-neutral-300"
                    >
                      “{evidence.quote}”{' '}
                      <EvidenceLocationLink nodusId={evidence.nodus_id} location={evidence.location} sourceRef={evidence.source_ref} pageNumber={evidence.page_number} suffix={` · ${evidence.kind}`} />
                    </blockquote>
                  ))}
                </section>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
              {t('No se pudo cargar el detalle de la idea.')}
            </div>
          )}
        </div>
      </div>

      {savingNote && (
        <SaveToNotesModal
          content={buildIdeaNote(savingNote)}
          defaultTitle={savingNote.idea.label}
          kind="idea"
          source={{ origin: 'idea', ref: savingNote.idea.global_id }}
          onClose={() => setSavingNote(null)}
        />
      )}
    </div>,
    document.body
  );
}
