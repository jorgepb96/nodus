import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, EmbeddingProvider } from '@shared/types';
import type { EmbeddingIndexPreview, EmbeddingIndexProgress, EmbeddingIndexSummary } from '@shared/embeddingIndexes';
import { PROVIDER_LABELS } from '@shared/providers';
import { getNodusLocalModel } from '@shared/localAiModels';
import { EmbeddingModelControl } from './EmbeddingModelControl';
import { ConfirmModal } from './ConfirmModal';
import { t, tx } from '../i18n';
import { defaultEmbeddingInputProfile, fixedEmbeddingInputPrefixes, type EmbeddingInputProfile } from '@shared/embeddingInputProfiles';
import { EmbeddingRunSummary, EmbeddingRunHistory } from './EmbeddingRunSummary';
import { EmbeddingComparison } from './EmbeddingComparison';
import { LocalRerankerControl } from './LocalRerankerControl';

type Selection = { provider: EmbeddingProvider; model: string; input?: EmbeddingInputProfile; indexId?: string; rebuild?: boolean; vaultId?: string };
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const familyLabels: Record<string, string> = {
  ideas: 'Ideas', work_summaries: 'Resúmenes', passages: 'Pasajes', document_vectors: 'Perfiles documentales',
  project_chapter_chunks: 'Capítulos', project_chapter_ideas: 'Ideas de capítulos', notes: 'Notas', archive_items: 'Fuentes primarias',
  study_docs: 'Documentos de estudio', study_materials: 'Materiales de estudio', study_ideas: 'Ideas de estudio',
  study_search: 'Búsquedas de estudio', testimony_segment_embeddings: 'Testimonios', documentary: 'Documentos del asistente',
};
const exclusionLabels: Record<string, string> = {
  source_policy: 'La política de la fuente impide indexarla.', no_text: 'Sin texto disponible',
  user_excluded: 'Excluido por el usuario', pseudonymization_required: 'Requiere seudonimización',
};

export function EmbeddingIndexesManager({ settings, onChange, vaultId }: { settings: AppSettings; vaultId?: string; onChange: () => unknown | Promise<unknown> }) {
  const [indexes, setIndexes] = useState<EmbeddingIndexSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<{ input: Selection; value: EmbeddingIndexPreview } | null>(null);
  const [deleting, setDeleting] = useState<EmbeddingIndexSummary | null>(null);
  const [deleteStep, setDeleteStep] = useState<'intro' | 'code' | 'final'>('intro');
  const [code, setCode] = useState('');
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<EmbeddingIndexProgress | null>(null);
  const [inputKind, setInputKind] = useState<'auto' | 'plain' | 'e5' | 'nomic' | 'harrier' | 'custom'>('auto');
  const [queryPrefix, setQueryPrefix] = useState(''), [documentPrefix, setDocumentPrefix] = useState('');
  const profileFor = (provider: EmbeddingProvider, model: string): EmbeddingInputProfile => {
    const automatic = defaultEmbeddingInputProfile(provider, model);
    if (inputKind === 'auto' || automatic.kind === 'gemma2') return automatic;
    return { version: 1, kind: inputKind, ...(inputKind === 'custom' ? { queryPrefix, documentPrefix } : fixedEmbeddingInputPrefixes(inputKind)) };
  };
  const request = useRef(0);
  const mounted = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const next = await window.nodus.listEmbeddingIndexes(vaultId);
    if (mounted.current && version === loadVersion.current) { setIndexes(next); setLoaded(true); }
  }, [vaultId]);
  useEffect(() => {
    mounted.current = true; setLoaded(false); setIndexes([]); setPreview(null); setDeleting(null); setProgress(null);
    void load().catch(cause => setError(String(cause)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = window.nodus.onEmbeddingIndexesChanged(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void load().then(() => onChangeRef.current()).catch(cause => setError(String(cause))); }, 350);
    });
    const releaseProgress = window.nodus.onEmbeddingIndexProgress(value => { if (!value.vaultId || !vaultId || value.vaultId === vaultId) setProgress(value); });
    return () => { mounted.current = false; request.current++; loadVersion.current++; if (timer) clearTimeout(timer); release(); releaseProgress(); };
  }, [load, vaultId]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await load(); await onChange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const showPreview = async (input: Selection) => {
    const id = ++request.current;
    setError(null); setBusy(true);
    try {
      const value = await window.nodus.previewEmbeddingIndex({ ...input, vaultId });
      if (id === request.current && mounted.current) setPreview({ input, value });
    } catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === request.current && mounted.current) setBusy(false); }
  };
  const beginDelete = (index: EmbeddingIndexSummary) => {
    setDeleting(index); setDeleteStep('intro'); setEntry(''); setError(null);
    setCode(Array.from(crypto.getRandomValues(new Uint8Array(6)), value => String(value % 10)).join(''));
  };
  const active = indexes.find(index => index.active);
  return <div className="w-full max-w-3xl space-y-4" data-testid="embedding-index-manager" aria-busy={busy}>
    <EmbeddingModelControl settings={settings} onEmbeddingChange={(provider, model) => { void showPreview({ provider, model, input: profileFor(provider, model) }); }} />
    <details className="rounded-lg border border-neutral-700 p-3 text-sm" data-testid="embedding-input-profile"><summary>{t('Perfil de entrada del modelo')}</summary>
      <p className="my-2 text-xs text-neutral-500">{t('Los prefijos se guardan con el índice. Los índices existentes conservan su receta hasta que prepares otro perfil.')}</p>
      <select className="input" aria-label={t('Perfil de entrada del modelo')} value={inputKind} onChange={event => setInputKind(event.target.value as typeof inputKind)}>
        <option value="auto">{t('Automático')}</option><option value="plain">{t('Sin prefijos')}</option><option value="e5">E5</option><option value="nomic">Nomic</option><option value="harrier">Harrier</option><option value="custom">{t('Personalizado')}</option>
      </select>
      {inputKind === 'custom' && <div className="mt-2 grid gap-2 sm:grid-cols-2"><label>{t('Prefijo de consulta')}<input className="input w-full font-mono" maxLength={512} value={queryPrefix} onChange={event => setQueryPrefix(event.target.value)} /></label>
        <label>{t('Prefijo de documento')}<input className="input w-full font-mono" maxLength={512} value={documentPrefix} onChange={event => setDocumentPrefix(event.target.value)} /></label></div>}
      <button className="btn btn-ghost mt-2" disabled={busy} onClick={() => void showPreview({ provider: settings.embeddingProvider, model: settings.embeddingModel, input: profileFor(settings.embeddingProvider, settings.embeddingModel) })}>{t('Preparar con este perfil')}</button>
    </details>
    <div className="space-y-3">
      <h3 className="font-medium">{t('Índices de embeddings de esta bóveda')}</h3>
      {!loaded && <p className="text-sm text-neutral-400">{t('Cargando…')}</p>}
      {loaded && !active && <div className="space-y-2"><p className="text-sm text-amber-200">{t('Sin índice semántico activo. La búsqueda textual sigue disponible.')}</p>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void showPreview({ provider: settings.embeddingProvider ?? 'openai', model: settings.embeddingModel })}>{t('Preparar índice de embeddings')}</button></div>}
      {indexes.map(index => <div key={index.id} className="rounded-lg border border-neutral-700 p-3 text-sm" data-testid={`embedding-index-${index.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{PROVIDER_LABELS[index.profile.provider] ?? index.profile.provider} · {index.profile.model}</strong>
          <span className={index.active ? 'text-cyan-300' : 'text-neutral-400'}>{t(index.active ? 'Activo' : 'Guardado')}</span>
        </div>
        <p className="mt-1 text-xs text-neutral-400">{index.dimensions ? `${index.dimensions} · ` : ''}{size(index.bytes)} · {new Date(index.updatedAt).toLocaleString()}</p>
        <p className="mt-1 text-xs text-neutral-400">{t('Perfil de entrada del modelo')}: {index.profile.input?.kind === 'custom' ? t('Personalizado')
          : index.profile.input?.kind === 'plain' || (!index.profile.input && defaultEmbeddingInputProfile(index.profile.provider, index.profile.model).kind !== 'gemma2') ? t('Sin prefijos')
            : index.profile.input?.kind === 'e5' ? 'E5' : index.profile.input?.kind === 'nomic' ? 'Nomic' : index.profile.input?.kind === 'harrier' ? 'Harrier' : index.profile.input?.kind === 'gemini' ? 'Gemini' : 'EmbeddingGemma 2'} · {index.id.slice(0, 8)}</p>
        <p className="mt-1 text-xs">{index.legacy ? t('Heredado: reconstruye el índice antes de activarlo.') : index.pending ? tx('{n} pendientes', { n: index.pending }) : t('Actualizado')}</p>
        {!index.legacy && (() => {
          const current = index.profile.provider === 'nodus' ? getNodusLocalModel(index.profile.model) : undefined;
          const replacement = current?.supersededBy ? getNodusLocalModel(current.supersededBy) : undefined;
          // Only the pooling changes, so the new index keeps this index's input recipe.
          return current && replacement && <div className="mt-2 rounded-md border border-amber-700/50 p-2 text-xs text-amber-200" data-testid="embedding-index-superseded">
            <p>{tx('{model} usa mean pooling, una receta anterior que recupera peor. Este índice sigue funcionando; prepara uno con {replacement} cuando quieras.', { model: current.label, replacement: replacement.label })}</p>
            <button className="btn btn-ghost mt-1" disabled={busy} onClick={() => void showPreview({ provider: 'nodus', model: replacement.id, input: index.profile.input ?? defaultEmbeddingInputProfile('nodus', replacement.id) })}>{t('Preparar índice de embeddings')}</button>
          </div>;
        })()}
        <details className="mt-2 text-xs text-neutral-400"><summary>{t('Cobertura y almacenamiento')}</summary>
          <ul className="mt-2 space-y-1">{index.coverage.map(family => <li key={family.family}>{t(familyLabels[family.family] ?? family.family)}: {family.indexed}/{family.total - family.excluded}{family.excluded ? ` · ${family.excluded} ${t('excluidos')}` : ''}</li>)}</ul>
          <p className="mt-2">{t('Espacio compartido')}: {size(index.sharedBytes)} · {t('Espacio liberable')}: {size(index.reclaimableBytes)}</p>
          {index.profile.input && (index.profile.input.queryPrefix || index.profile.input.documentPrefix) && <div className="mt-2 break-words">
            <p>{t('Prefijo de consulta')}: <code>{JSON.stringify(index.profile.input.queryPrefix)}</code></p>
            <p>{t('Prefijo de documento')}: <code>{JSON.stringify(index.profile.input.documentPrefix)}</code></p>
          </div>}
        </details>
        {index.preparation !== 'idle' && <p className="mt-2 text-xs text-cyan-200">{t(index.preparation === 'running' ? 'Preparando índice' : index.preparation === 'paused' ? 'Preparación pausada' : index.preparation === 'cancelled' ? 'Preparación cancelada' : 'Error de preparación')}
          {` · ${progress?.indexId === index.id ? progress.completed : index.completed}/${progress?.indexId === index.id ? progress.total : index.total}`}</p>}
        {index.error && <p role="alert" className="mt-2 text-xs text-red-300">{index.error}</p>}
        {(progress?.indexId === index.id ? progress.run ?? index.run : index.run) && <EmbeddingRunSummary run={(progress?.indexId === index.id ? progress.run ?? index.run : index.run)!} />}
        <EmbeddingRunHistory indexId={index.id} vaultId={vaultId} updatedAt={index.run?.updatedAt} />
        <div className="mt-3 flex flex-wrap gap-2">
          {index.preparation === 'running' ? <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => window.nodus.controlEmbeddingIndex(index.id, 'pause', vaultId))}>{t('Pausar')}</button>
            : (index.preparation === 'paused' || index.preparation === 'error' || index.preparation === 'cancelled') && <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => window.nodus.controlEmbeddingIndex(index.id, 'resume', vaultId))}>{t('Reanudar')}</button>}
          {!index.legacy && index.preparation !== 'running' && (!index.active || index.pending > 0) && <button className="btn btn-ghost" disabled={busy} onClick={() => void showPreview({ ...index.profile, indexId: index.id })}>{t(index.pending ? 'Actualizar y activar' : 'Activar')}</button>}
          {index.preparation !== 'running' && <button className="btn btn-ghost" disabled={busy} onClick={() => void showPreview({ ...index.profile, indexId: index.id, rebuild: true })}>{t('Reconstruir')}</button>}
          {index.preparation === 'running' && <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => window.nodus.controlEmbeddingIndex(index.id, 'cancel', vaultId))}>{t('Cancelar preparación')}</button>}
          <button className="btn btn-ghost text-red-300" disabled={busy} onClick={() => beginDelete(index)}>{t('Eliminar')}</button>
        </div>
      </div>)}
      {indexes.some(index => index.preparation === 'running') && <p className="text-xs text-neutral-400">{t('El índice actual sigue activo mientras se prepara el siguiente. Los avances se conservan si pausas o cierras Nodus.')}</p>}
    </div>
    <LocalRerankerControl enabled={settings.researchReranking === 'local'} selected={settings.researchRerankerModel}
      onChange={async enabled => { await window.nodus.updateSettings({ researchReranking: enabled ? 'local' : 'off' }); await onChange(); }}
      onSelect={async modelId => { await window.nodus.updateSettings({ researchRerankerModel: modelId }); await onChange(); }} />
    <EmbeddingComparison indexes={indexes} vaultId={vaultId} />
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {preview && <ConfirmModal title={t(preview.input.rebuild ? 'Reconstruir índice de embeddings' : 'Preparar índice de embeddings')}
      confirmLabel={t(preview.value.pending || preview.input.rebuild ? 'Preparar y activar' : 'Activar índice')}
      message={<div className="space-y-2"><p>{preview.value.profile.model}</p><p>{tx('{n} reutilizables', { n: preview.value.reusable })} · {tx('{n} pendientes', { n: preview.value.pending })} · {tx('{n} excluidos', { n: preview.value.excluded })}</p>
        <p>{t('Perfil de entrada del modelo')}: {preview.value.profile.input?.kind ?? t('Sin prefijos')}</p>
        {preview.value.profile.input?.queryPrefix && <p>{t('Prefijo de consulta')}: <code>{JSON.stringify(preview.value.profile.input.queryPrefix)}</code></p>}
        {preview.value.profile.input?.documentPrefix && <p>{t('Prefijo de documento')}: <code>{JSON.stringify(preview.value.profile.input.documentPrefix)}</code></p>}
        <p>{t(preview.value.external ? 'El texto pendiente se enviará al proveedor seleccionado y puede generar costes.' : 'Los embeddings pendientes se generarán en este equipo.')}</p>
        <p>{t('Se conservarán los índices anteriores. El nuevo se activará cuando termine de actualizarse.')}</p>
        {preview.value.estimatedBytes !== null && <p>{t('Espacio estimado')}: {size(preview.value.estimatedBytes)}</p>}
        {preview.value.exclusions.map(exclusion => <p key={exclusion.reason}>{exclusion.count} · {t(exclusionLabels[exclusion.reason] ?? 'No autorizado por la política de acceso.')}</p>)}</div>}
      onCancel={() => setPreview(null)} onConfirm={() => { const input = preview.input; setPreview(null); void run(() => window.nodus.prepareEmbeddingIndex({ ...input, vaultId })); }} />}
    {deleting && deleteStep === 'intro' && <ConfirmModal title={t('Eliminar índice de embeddings')} danger autoFocusConfirm={false}
      message={<div className="space-y-2"><p>{deleting.profile.model}</p><p>{t('Se eliminarán los vectores de este índice. Reconstruirlos puede consumir tiempo o dinero.')}</p>{deleting.active && <p>{t('La bóveda quedará sin índice semántico activo. Los documentos y la búsqueda textual se conservarán.')}</p>}</div>}
      confirmLabel={t('Continuar')} onCancel={() => setDeleting(null)} onConfirm={() => setDeleteStep('code')} />}
    {deleting && deleteStep === 'code' && <ConfirmModal title={t('Código de seguridad')} danger autoFocusConfirm={false}
      message={<div className="space-y-3"><p>{t('Introduce este código manualmente para eliminar el índice.')}</p><p className="select-none text-center text-2xl tracking-widest" onCopy={event => event.preventDefault()}>{code}</p>
        <input className="input w-full" aria-label={t('Código de seguridad')} inputMode="numeric" autoComplete="off" value={entry} onChange={event => setEntry(event.target.value)} onPaste={event => event.preventDefault()} />{error && <p role="alert" className="text-red-300">{error}</p>}</div>}
      confirmLabel={t('Continuar')} onCancel={() => setDeleting(null)} onConfirm={() => { if (entry === code) { setError(null); setDeleteStep('final'); } else setError(t('El código no coincide.')); }} />}
    {deleting && deleteStep === 'final' && <ConfirmModal title={t('Confirmación final')} danger autoFocusConfirm={false}
      message={tx('Confirma la eliminación definitiva del índice «{name}».', { name: deleting.profile.model })} confirmLabel={t('Eliminar definitivamente')}
      onCancel={() => setDeleting(null)} onConfirm={() => { const id = deleting.id; setDeleting(null); void run(() => window.nodus.deleteEmbeddingIndex(id, vaultId)); }} />}
  </div>;
}
