import { useEffect, useRef, useState } from 'react';
import type { LocalRerankerStatus } from '@shared/embeddingComparison';
import { t, tx } from '../i18n';

export function LocalRerankerControl({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => Promise<unknown> }) {
  const [status, setStatus] = useState<LocalRerankerStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const cancelled = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; let active = true; void window.nodus.getLocalRerankerStatus().then(next => { if (active) setStatus(next); }).catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; mounted.current = false; }; }, []);
  useEffect(() => {
    if (!busy && !status?.downloading) return;
    let active = true;
    const timer = setInterval(() => { void window.nodus.getLocalRerankerStatus().then(next => { if (active) setStatus(next); }).catch(() => {}); }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [busy, status?.downloading]);
  const download = async () => {
    setBusy(true); setError(''); cancelled.current = false;
    try { const next = await window.nodus.prepareLocalReranker('download'); if (mounted.current) setStatus(next); }
    catch (cause) { if (mounted.current && !cancelled.current) setError(String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="space-y-2 rounded-lg border border-neutral-700 p-3 text-sm" data-testid="local-reranker-control">
    <label className="flex gap-2"><input type="checkbox" checked={enabled} disabled={!status?.available || busy} onChange={event => { void onChange(event.target.checked).catch(cause => setError(String(cause))); }} />{t('Reordenamiento local opcional')}</label>
    <p className="text-xs text-neutral-500">{t('Ordena los candidatos de la búsqueda documental con un modelo local. No modifica ni regenera embeddings. Si falla, se conserva el orden original.')}</p>
    {!status?.available && !busy && !status?.downloading && <button className="btn btn-ghost" disabled={!status} onClick={() => void download()}>{tx('Descargar modelo local ({size} MB)', { size: ((status?.bytes ?? 0) / 1024 ** 2).toFixed(0) })}</button>}
    {(busy || status?.downloading) && <div className="flex gap-3"><span>{Math.round((status?.progress ?? 0) * 100)}%</span><button className="btn btn-ghost" onClick={() => { cancelled.current = true; void window.nodus.prepareLocalReranker('cancel').then(setStatus).catch(cause => setError(String(cause))); }}>{t('Cancelar descarga')}</button></div>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
