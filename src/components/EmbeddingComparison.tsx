import { useEffect, useRef, useState } from 'react';
import type { EmbeddingIndexSummary } from '@shared/embeddingIndexes';
import type { EmbeddingComparisonFamily, EmbeddingComparisonReport } from '@shared/embeddingComparison';
import { t, tx } from '../i18n';

export function EmbeddingComparison({ indexes, vaultId }: { indexes: EmbeddingIndexSummary[]; vaultId?: string }) {
  const available = indexes.filter(index => !index.legacy && index.dimensions);
  const [left, setLeft] = useState(''), [right, setRight] = useState('');
  const [family, setFamily] = useState<EmbeddingComparisonFamily>('passages');
  const [questions, setQuestions] = useState(''), [gold, setGold] = useState(''), [complete, setComplete] = useState(false);
  const [reranking, setReranking] = useState(false), [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EmbeddingComparisonReport | null>(null), [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const version = useRef(0);
  const identity = available.map(index => index.id).sort().join('|');
  useEffect(() => {
    setLeft(previous => available.some(index => index.id === previous) ? previous : available[0]?.id ?? '');
    setRight(previous => available.some(index => index.id === previous) ? previous : available[1]?.id ?? '');
  }, [identity]);
  useEffect(() => {
    setReport(null); setError(''); setBusy(false);
    return () => { version.current++; if (request.current) void window.nodus.cancelEmbeddingComparison(request.current).catch(() => {}); request.current = null; };
  }, [vaultId]);
  const compare = async () => {
    const current = ++version.current, id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
    request.current = id; setBusy(true); setError(''); setReport(null);
    try {
      const items = questions.split('\n').map(question => question.trim()).filter(Boolean);
      const next = await window.nodus.compareEmbeddingIndexes({ requestId: id, vaultId, indexIds: [left, right], family, reranking: reranking ? 'local' : 'off',
        questions: items.map((question, index) => ({ question, ...(index === 0 && gold.trim() ? { expected: { ids: gold.split('\n').map(value => value.trim()).filter(Boolean), complete } } : {}) })) });
      if (version.current === current) setReport(next);
    } catch (cause) { if (version.current === current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (version.current === current) { setBusy(false); request.current = null; } }
  };
  const cancel = () => {
    version.current++; const id = request.current; request.current = null; setBusy(false);
    if (id) void window.nodus.cancelEmbeddingComparison(id).catch(cause => setError(String(cause)));
  };
  const exportReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `nodus-embedding-comparison-${report.createdAt.replace(/[:.]/g, '-')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const label = (index: EmbeddingIndexSummary) => `${index.profile.provider} · ${index.profile.model} · ${index.id.slice(0, 8)}`;
  return <details className="rounded-lg border border-neutral-700 p-3 text-sm" data-testid="embedding-comparison">
    <summary className="cursor-pointer font-medium">{t('Comparar recuperación A/B')}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-neutral-500">{t('La comparación consulta índices guardados sin activarlos ni recalcular documentos. Las preguntas pueden generar costes en sus proveedores.')}</p>
      {available.length < 2 && <p>{t('Prepara dos índices verificados para compararlos.')}</p>}
      <div className="grid gap-2 sm:grid-cols-2">{([['A', left, setLeft], ['B', right, setRight]] as const).map(([name, value, change]) => <label key={name}>{name}
        <select className="input w-full" aria-label={`Índice ${name}`} value={value} disabled={busy} onChange={event => change(event.target.value)}>
          <option value="">{t('Seleccionar índice')}</option>{available.map(index => <option key={index.id} value={index.id}>{label(index)}</option>)}
        </select></label>)}</div>
      {available.some(index => [left, right].includes(index.id) && index.pending > 0) && <p className="text-xs text-amber-300">{t('Hay contenido pendiente en alguno de los índices. La comparación usa su cobertura actual.')}</p>}
      <label className="block">{t('Contenido')}<select className="input ml-2" value={family} disabled={busy} onChange={event => setFamily(event.target.value as EmbeddingComparisonFamily)}>
        <option value="ideas">{t('Ideas')}</option><option value="passages">{t('Pasajes')}</option><option value="documents">{t('Perfiles documentales')}</option><option value="documentary">{t('Documentos del asistente')}</option></select></label>
      <label className="block">{t('Preguntas de prueba (una por línea, máximo 20)')}<textarea className="input mt-1 min-h-24 w-full" aria-label={t('Preguntas de prueba')} value={questions} disabled={busy} onChange={event => setQuestions(event.target.value)} /></label>
      {family === 'documentary' && <label className="flex gap-2"><input type="checkbox" checked={reranking} disabled={busy} onChange={event => setReranking(event.target.checked)} />{t('Reordenamiento local opcional')}</label>}
      <details className="text-xs"><summary>{t('Evaluar con anotaciones de relevancia')}</summary>
        <p className="my-2">{t('Introduce los IDs pertinentes de la primera pregunta, uno por línea. Sin anotaciones completas no se calcula calidad.')}</p>
        <textarea className="input w-full" aria-label={t('IDs pertinentes')} value={gold} onChange={event => setGold(event.target.value)} disabled={busy} />
        <label className="mt-2 flex gap-2"><input type="checkbox" checked={complete} disabled={busy} onChange={event => setComplete(event.target.checked)} />{t('La lista de resultados pertinentes está completa')}</label>
      </details>
      <div className="flex gap-2"><button className="btn" disabled={busy || !questions.trim() || !left || !right || left === right} onClick={() => void compare()}>{t('Comparar')}</button>
        {busy && <button className="btn btn-ghost" onClick={cancel}>{t('Cancelar')}</button>}{report && <button className="btn btn-ghost" onClick={exportReport}>{t('Exportar comparación')}</button>}</div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {report && <><p className="text-xs text-neutral-500">{new Date(report.createdAt).toLocaleString()} · {t('La memoria corresponde al proceso compartido de búsqueda.')}</p>
        <div className="grid min-w-0 gap-3 md:grid-cols-2">{report.arms.map((arm, armIndex) => <section key={`${armIndex}:${arm.indexId}`} className="min-w-0 rounded-lg border border-neutral-700 p-2" data-testid={`comparison-arm-${armIndex}`}>
          <strong>{armIndex ? 'B' : 'A'} · {arm.profile.model}</strong>
          {arm.questions.map((result, index) => <div key={index} className="mt-3 space-y-2"><p className="font-medium">{result.question}</p>
            <p className="text-xs">{t('Embedding')}: {result.embeddingMs.toFixed(0)} ms · {t('Búsqueda')}: {result.retrievalMs.toFixed(0)} ms · {result.workerRssBytes > 0 ? `${(result.workerRssBytes / 1024 ** 2).toFixed(1)} MB` : t('No disponible')}</p>
            <p className="text-xs">{t('Reordenamiento')}: {t(({ applied: 'Aplicado', unavailable: 'No disponible', timeout: 'Tiempo agotado', failed: 'Fallido', off: 'Desactivado', stale: 'Contenido modificado' } as Record<string, string>)[result.reranking] ?? result.reranking)}</p>
            {!result.semanticAvailable && <p className="text-xs text-amber-300">{t('Solo búsqueda textual: el embedding de consulta no está disponible.')}</p>}
            {result.quality ? <p className="text-xs">Hit@{report.limit}: {result.quality.hit} · Recall@{report.limit}: {(100 * result.quality.recall).toFixed(0)}% · MRR: {result.quality.mrr.toFixed(3)} · nDCG: {result.quality.ndcg.toFixed(3)}</p>
              : <p className="text-xs text-neutral-500">{t('Sin anotaciones completas: calidad no evaluada.')}</p>}
            <ol className="list-inside list-decimal space-y-2">{result.hits.map(hit => <li key={hit.id} className="break-words text-xs"><strong>{hit.title}</strong>{hit.location && ` · ${hit.location}`}<p>{hit.text}</p>
              <details><summary>{t('Identificador y canales')}</summary><code className="break-all">{hit.id}</code><p>{hit.channels.join(', ')}</p></details></li>)}</ol>
            {!result.hits.length && <p className="text-xs">{tx('{n} resultados', { n: 0 })}</p>}
          </div>)}
        </section>)}</div></>}
    </div>
  </details>;
}
