import { useLearningArtifact } from '../learning/useLearningArtifact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ResearchQuestion,
  ResearchQuestionDetail,
  RqCoverageLink,
  RqCoverageStatus,
  RqMapProgress,
  RqSubQuestion,
} from '@shared/types';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { Badge, Icon, Spinner } from '../components/ui';
import { confirm } from '../components/feedback';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import {
  coverageQuestionQueue,
  type CoverageQuestionJob,
} from '../coverageQuestionQueue';
import { useDataRefresh } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { getActiveLang, t, tx } from '../i18n';

type BadgeColor = 'green' | 'amber' | 'red' | 'indigo' | 'neutral' | 'cyan';
const STATUS: Record<RqCoverageStatus, { label: string; color: BadgeColor; icon: string }> = {
  covered: { label: 'Bien cubierta', color: 'green', icon: 'check' },
  partial: { label: 'Parcial', color: 'amber', icon: 'minus' },
  uncovered: { label: 'Sin cubrir', color: 'red', icon: 'alert' },
  disputed: { label: 'En disputa', color: 'indigo', icon: 'scale' },
};

interface SubDraft {
  id?: string;
  text: string;
  rationale: string | null;
}

type Busy = 'decompose' | 'map' | 'save' | null;

export function ResearchMapView({
  vaultId,
  onOpenGraph,
  onOpenAssistant,
  onOpenDebates,
}: {
  vaultId: string | null;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenDebates: () => void;
}) {
  const [questions, setQuestions] = useState<ResearchQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [queuedQuestions, setQueuedQuestions] = useState<readonly CoverageQuestionJob[]>(() =>
    coverageQuestionQueue.snapshot()
  );
  const [detail, setDetail] = useState<ResearchQuestionDetail | null>(null);
  useLearningArtifact('overview',detail?.rq.status==='mapped'?detail.rq.id:null,detail?.subQuestions.flatMap(q=>q.links.filter(l=>l.kind==='idea'||l.kind==='work').map(l=>({kind:l.kind as 'idea'|'work',id:l.refId})))??[]);
  const [newQuestion, setNewQuestion] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [subDraft, setSubDraft] = useState<SubDraft[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<RqMapProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const listRequest = useRef(0);

  const reloadList = useCallback(async () => {
    const request = ++listRequest.current;
    if (!vaultId) {
      setQuestions([]);
      setQuestionsLoading(false);
      return;
    }
    setQuestionsLoading(true);
    try {
      const next = await window.nodus.listResearchQuestions();
      if (request === listRequest.current) setQuestions(next);
    } catch (err) {
      if (request === listRequest.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === listRequest.current) setQuestionsLoading(false);
    }
  }, [vaultId]);

  useEffect(() => {
    reloadList();
  }, [reloadList]);
  useDataRefresh(reloadList);

  useEffect(
    () =>
      coverageQuestionQueue.subscribe((jobs, event) => {
        setQueuedQuestions(jobs);
        if (event.type === 'ready' && event.vaultId === vaultId) void reloadList();
      }),
    [reloadList, vaultId]
  );

  const syncDetail = useCallback((d: ResearchQuestionDetail | null) => {
    setDetail(d);
    setSubDraft(d ? d.subQuestions.map((s) => ({ id: s.id, text: s.text, rationale: s.rationale })) : []);
  }, []);

  useEffect(() => {
    syncDetail(null);
    setError(null);
    setNewQuestion('');
    setNewNotes('');
  }, [syncDetail, vaultId]);

  const openQuestion = useCallback(
    (id: string) => {
      setError(null);
      void window.nodus.getResearchQuestion(id).then(syncDetail);
    },
    [syncDetail]
  );

  const run = useCallback(async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);

  const enqueueQuestion = () => {
    const question = newQuestion.trim();
    if (!vaultId || !question) return;
    coverageQuestionQueue.enqueue({ vaultId, question, notes: newNotes.trim() || undefined });
    setNewQuestion('');
    setNewNotes('');
  };

  const redecompose = () =>
    detail &&
    run('decompose', async () => {
      const d = await window.nodus.decomposeResearchQuestion({ rqId: detail.rq.id, model: null });
      syncDetail(d);
    });

  const dirty = useMemo(() => {
    if (!detail) return false;
    const orig = detail.subQuestions;
    if (orig.length !== subDraft.length) return true;
    return subDraft.some((s, i) => s.id !== orig[i].id || s.text.trim() !== orig[i].text);
  }, [detail, subDraft]);

  const saveSubs = () =>
    detail &&
    run('save', async () => {
      const d = await window.nodus.updateResearchSubQuestions({
        rqId: detail.rq.id,
        subQuestions: subDraft.filter((s) => s.text.trim()).map((s) => ({ id: s.id, text: s.text.trim(), rationale: s.rationale })),
      });
      syncDetail(d);
    });

  const runMap = () =>
    detail &&
    run('map', async () => {
      if (dirty) {
        await window.nodus.updateResearchSubQuestions({
          rqId: detail.rq.id,
          subQuestions: subDraft.filter((s) => s.text.trim()).map((s) => ({ id: s.id, text: s.text.trim(), rationale: s.rationale })),
        });
      }
      const d = await window.nodus.mapResearchCoverage({ rqId: detail.rq.id, model: null }, { onProgress: setProgress });
      syncDetail(d);
      reloadList();
    });

  const removeQuestion = async (id: string, question: string) => {
    const approved = await confirm({
      title: t('Eliminar'),
      message: tx('Se eliminará «{title}». Esta acción no se puede deshacer.', { title: question }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!approved) return;
    void run(null, async () => {
      await window.nodus.deleteResearchQuestion(id);
      if (detail?.rq.id === id) syncDetail(null);
      await reloadList();
    });
  };

  const exportMap = () =>
    detail &&
    run(null, async () => {
      await window.nodus.exportResearchCoverage({ rqId: detail.rq.id });
    });

  // Sub-question draft editing
  const editSub = (i: number, text: string) => setSubDraft((prev) => prev.map((s, j) => (j === i ? { ...s, text } : s)));
  const addSub = () => setSubDraft((prev) => [...prev, { text: '', rationale: null }]);
  const removeSub = (i: number) => setSubDraft((prev) => prev.filter((_, j) => j !== i));
  const moveSub = (i: number, dir: -1 | 1) =>
    setSubDraft((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const queueForVault = queuedQuestions.filter((job) => job.vaultId === vaultId);
  const inFlightIds = new Set(queueForVault.map((job) => job.rqId).filter((id): id is string => Boolean(id)));
  const visibleQuestions = questions.filter((question) => !inFlightIds.has(question.id));

  return (
    <div data-testid="coverage-catalog" className="flex h-full min-h-0 bg-white dark:bg-neutral-950">
      <aside className="flex w-64 min-h-0 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
          <button className="btn btn-primary w-full text-sm gap-1.5" onClick={() => syncDetail(null)}>
            <Icon name="plus" size={14} /> {t('Nueva pregunta')}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
          {questionsLoading && <div className="p-2"><Spinner label={t('Cargando…')} /></div>}
          {!questionsLoading && visibleQuestions.length === 0 && <p className="text-xs text-neutral-500 p-2">{t('Aún no hay preguntas.')}</p>}
          {visibleQuestions.map((q) => (
            <button
              key={q.id}
              className={`w-full rounded-md p-2 text-left text-sm ${detail?.rq.id === q.id ? 'bg-indigo-50 text-indigo-700 dark:bg-neutral-800 dark:text-neutral-100' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
              onClick={() => openQuestion(q.id)}
            >
              <span className="line-clamp-2">{q.question}</span>
              <span className="text-[11px] text-neutral-500">{t(statusWord(q.status))}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 min-h-0 overflow-auto p-5">
        {error && <div className="mb-4 text-sm text-red-400 border border-red-900/60 bg-red-950/40 rounded-md p-3">{error}</div>}

        {!detail && (
          <div className="max-w-2xl">
            <p className="text-sm text-neutral-400 mb-4">
              {t(
                'Escribe tu pregunta de tesis. Nodus la descompone en sub-preguntas y mapea cuáles responde, responde a medias, deja sin cubrir o solo cubre con un debate sin resolver tu biblioteca.'
              )}
            </p>
            <label className="block text-xs text-neutral-400 mb-1">{t('Pregunta de investigación')}</label>
            <textarea
              className="input w-full mb-3"
              rows={3}
              placeholder={t('¿Cómo afectan las recompensas externas a la motivación intrínseca en contextos educativos?')}
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
            />
            <label className="block text-xs text-neutral-400 mb-1">{t('Notas (opcional)')}</label>
            <textarea
              className="input w-full mb-3"
              rows={2}
              placeholder={t('Matices, enfoque o límites que deba tener en cuenta…')}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
            <button className="btn btn-primary text-sm gap-1.5" onClick={enqueueQuestion} disabled={!vaultId || !newQuestion.trim()}>
              <Icon name="layers" size={14} /> {t('Añadir a la cola')}
            </button>

            {queueForVault.length > 0 && (
              <div className="mt-4 space-y-2" data-testid="coverage-question-queue">
                {queueForVault.map((job) => (
                  <div key={job.id} className={`rounded-md border px-3 py-2 text-xs ${job.status === 'failed' ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30' : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60'}`}>
                    <div className="flex items-center gap-2">
                      <Icon
                        name={job.status === 'running' ? 'sync' : job.status === 'failed' ? 'alert' : 'clock'}
                        size={12}
                        className={job.status === 'running' ? 'animate-spin text-indigo-300' : job.status === 'failed' ? 'text-red-400' : 'text-neutral-500'}
                      />
                      <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300" title={job.question}>{job.question}</span>
                      <span className={job.status === 'failed' ? 'text-red-400' : 'text-neutral-500'}>
                        {job.status === 'running' ? t('Descomponiendo…') : job.status === 'failed' ? t('Falló') : t('En cola')}
                      </span>
                      {job.status === 'failed' && (
                        <button className="text-neutral-500 hover:text-neutral-300" onClick={() => coverageQuestionQueue.dismiss(job.id)} title={t('Quitar')}>
                          <Icon name="x" size={12} />
                        </button>
                      )}
                    </div>
                    {job.error && <p className="mt-1 text-red-500/90 dark:text-red-400/80">{localizeRuntimeError(job.error, getActiveLang())}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {detail && (
          <div className="max-w-3xl">
            <div className="card p-4 mb-4">
              <div className="flex items-start gap-3">
                <p className="text-base font-medium flex-1">{detail.rq.question}</p>
                <button className="btn btn-ghost text-xs" onClick={() => void removeQuestion(detail.rq.id, detail.rq.question)} title={t('Borrar')}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {detail.rq.notes && <p className="text-sm text-neutral-400 mt-1">{detail.rq.notes}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Badge color="neutral">{t(statusWord(detail.rq.status))}</Badge>
                {detail.stale && (
                  <Badge color="amber" title={t('El corpus creció desde el último mapeo')}>
                    <Icon name="alert" size={11} /> {t('desactualizado')}
                  </Badge>
                )}
                <div className="flex-1" />
                <button className="btn btn-ghost border border-neutral-700 text-xs gap-1.5" onClick={redecompose} disabled={busy === 'decompose'}>
                  <Icon name="refresh" size={13} /> {t('Re-descomponer')}
                </button>
                <button data-testid="coverage-map-action" className="btn btn-primary text-xs gap-1.5" onClick={runMap} disabled={busy === 'map' || subDraft.length === 0}>
                  <Icon name="strata" size={13} /> {t('Mapear cobertura')}
                </button>
                {detail.rq.status === 'mapped' && (
                  <button className="btn btn-ghost border border-neutral-700 text-xs gap-1.5" onClick={exportMap}>
                    <Icon name="download" size={13} /> {t('Exportar')}
                  </button>
                )}
              </div>
            </div>

            {detail.rq.status === 'mapped' && <CoverageGauge summary={detail.summary} />}

            {busy === 'map' && progress && (
              <div className="mb-4">
                <div className="text-xs text-neutral-400 mb-1">
                  {tx('Mapeando {i}/{n}: {phase}', {
                    i: progress.index + 1,
                    n: progress.total,
                    phase: t(progress.phase === 'retrieving' ? 'recuperando' : progress.phase === 'classifying' ? 'clasificando' : 'hecho'),
                  })}
                </div>
                <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 transition-all" style={{ width: `${((progress.index + 1) / progress.total) * 100}%` }} />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium text-neutral-300">{t('Sub-preguntas')}</h2>
              <button className="btn btn-ghost text-xs gap-1.5" onClick={addSub}>
                <Icon name="plus" size={13} /> {t('Añadir')}
              </button>
            </div>

            <div className="space-y-2">
              {subDraft.map((sub, i) => {
                const mapped = detail.subQuestions.find((s) => s.id === sub.id);
                return (
                  <SubQuestionCard
                    key={sub.id ?? `new-${i}`}
                    index={i}
                    sub={sub}
                    mapped={mapped}
                    canMoveUp={i > 0}
                    canMoveDown={i < subDraft.length - 1}
                    onEdit={(text) => editSub(i, text)}
                    onRemove={() => removeSub(i)}
                    onMove={(dir) => moveSub(i, dir)}
                    onCite={setCitation}
                    onOpenGraph={onOpenGraph}
                    onOpenDebates={onOpenDebates}
                    onOpenAssistant={onOpenAssistant}
                  />
                );
              })}
            </div>

            {dirty && (
              <div className="sticky bottom-0 mt-3 py-2 bg-neutral-950/95 backdrop-blur flex gap-2">
                <button className="btn btn-primary text-sm gap-1.5" onClick={saveSubs} disabled={busy === 'save'}>
                  <Icon name="check" size={14} /> {t('Guardar sub-preguntas')}
                </button>
                <span className="text-xs text-neutral-500 self-center">{t('Editar una sub-pregunta reinicia su cobertura.')}</span>
              </div>
            )}
          </div>
        )}
      </main>

      {citation && <SourceCitationModal target={citation} onClose={() => setCitation(null)} />}
    </div>
  );
}

function CoverageGauge({ summary }: { summary: ResearchQuestionDetail['summary'] }) {
  const cells: { label: string; value: number; color: string }[] = [
    { label: t('Bien cubierta'), value: summary.covered, color: 'text-emerald-300' },
    { label: t('Parcial'), value: summary.partial, color: 'text-amber-300' },
    { label: t('Sin cubrir'), value: summary.uncovered, color: 'text-red-300' },
    { label: t('En disputa'), value: summary.disputed, color: 'text-indigo-300' },
    { label: t('Sin mapear'), value: summary.unmapped, color: 'text-neutral-400' },
  ];
  return (
    <div className="grid grid-cols-5 gap-2 mb-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-neutral-900 rounded-md p-2 text-center">
          <div className={`text-2xl font-semibold ${c.color}`}>{c.value}</div>
          <div className="text-[11px] text-neutral-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function SubQuestionCard({
  index,
  sub,
  mapped,
  canMoveUp,
  canMoveDown,
  onEdit,
  onRemove,
  onMove,
  onCite,
  onOpenGraph,
  onOpenDebates,
  onOpenAssistant,
}: {
  index: number;
  sub: SubDraft;
  mapped?: RqSubQuestion;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: (text: string) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onCite: (c: CitationTarget) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenDebates: () => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const status = mapped?.coverageStatus ? STATUS[mapped.coverageStatus] : null;
  const ideas = mapped?.links.filter((l) => l.kind === 'idea') ?? [];
  const works = mapped?.links.filter((l) => l.kind === 'work') ?? [];
  const debates = mapped?.links.filter((l) => l.kind === 'debate') ?? [];

  return (
    <div className="card p-3">
      <div className="flex items-start gap-2">
        <span className="text-xs text-neutral-500 mt-2 w-5 text-right shrink-0">{index + 1}.</span>
        <textarea
          className="input flex-1 resize-none"
          rows={2}
          value={sub.text}
          placeholder={t('Escribe una sub-pregunta…')}
          onChange={(e) => onEdit(e.target.value)}
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button className="btn btn-ghost px-1.5 py-0.5" onClick={() => onMove(-1)} disabled={!canMoveUp} title={t('Subir')}>
            <Icon name="arrowUp" size={12} />
          </button>
          <button className="btn btn-ghost px-1.5 py-0.5" onClick={() => onMove(1)} disabled={!canMoveDown} title={t('Bajar')}>
            <Icon name="arrowDown" size={12} />
          </button>
          <button className="btn btn-ghost px-1.5 py-0.5" onClick={onRemove} title={t('Quitar')}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>

      {status && (
        <div className="mt-2 pl-7">
          <div className="flex items-center gap-2 mb-1">
            <Badge color={status.color}>
              <Icon name={status.icon} size={11} /> {t(status.label)}
            </Badge>
          </div>
          {mapped?.justification && <p className="text-sm text-neutral-400 mb-2">{mapped.justification}</p>}

          <div className="flex flex-wrap gap-1.5">
            {ideas.map((l) => (
              <LinkChip key={l.id} link={l} onClick={() => onCite({ kind: 'idea', id: l.refId })} icon="bulb" />
            ))}
            {works.map((l) => (
              <LinkChip key={l.id} link={l} onClick={() => onCite({ kind: 'work', id: l.refId })} icon="book" />
            ))}
            {debates.map((l) => (
              <LinkChip key={l.id} link={l} onClick={() => onCite({ kind: 'contradiction', id: l.refId })} icon="scale" />
            ))}
          </div>

          {mapped?.coverageStatus === 'disputed' && (
            <button className="btn btn-ghost border border-neutral-700 text-xs gap-1.5 mt-2" onClick={onOpenDebates}>
              <Icon name="scale" size={13} /> {t('Ver en Debates')}
            </button>
          )}
          {mapped?.coverageStatus === 'uncovered' && (
            <button
              className="btn btn-ghost border border-neutral-700 text-xs gap-1.5 mt-2"
              onClick={() =>
                onOpenAssistant({
                  title: t('Sub-pregunta sin cubrir'),
                  selection: ASSISTANT_CONTEXTS.gap,
                  prompt: `${t('Esta sub-pregunta no está cubierta por mi biblioteca. Sugiere cómo abordarla y qué tipo de fuentes buscar.')}\n\n${sub.text}`,
                })
              }
            >
              <Icon name="chat" size={13} /> {t('Asistente')}
            </button>
          )}
          {mapped?.coverageStatus && mapped.coverageStatus !== 'uncovered' && (
            <button
              className="btn btn-ghost border border-neutral-700 text-xs gap-1.5 mt-2"
              onClick={() => onOpenGraph({ preset: 'overview', label: sub.text })}
            >
              <Icon name="layers" size={13} /> {t('Grafo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LinkChip({ link, onClick, icon }: { link: RqCoverageLink; onClick: () => void; icon: string }) {
  return (
    <button
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
      onClick={onClick}
      title={link.label}
    >
      <Icon name={icon} size={11} />
      <span className="max-w-[180px] truncate">{link.label}</span>
      {link.readState === 'unread' && <span className="text-amber-400" title={t('No leída')}>•</span>}
    </button>
  );
}

function statusWord(status: ResearchQuestion['status']): string {
  if (status === 'draft') return 'borrador';
  if (status === 'decomposed') return 'descompuesta';
  return 'mapeada';
}
