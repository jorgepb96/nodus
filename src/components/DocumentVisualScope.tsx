import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DocumentVisualDiscard, DocumentVisualManifest, DocumentVisualTarget } from '@shared/documentSkills';
import { documentVisualDiscardTally, documentVisualDiscardText } from '@shared/documentSkills';
import type { AppSettings, ModelRef } from '@shared/types';
import { documentVisualModelFromSettings } from '@shared/documentVisualEnrich';
import { DocumentSkillsControl, useDocumentSkills } from './DocumentSkillsControl';
import { ModelPicker, SubscriptionQuotaNotice } from './ModelPicker';
import { t, tx } from '../i18n';
import './documentFigures.css';
import { Icon } from './ui';
import { DocumentFigureContext as Context } from './DocumentFigures';
export { DocumentFigure, DocumentVisualFigures, useDocumentFigures } from './DocumentFigures';

export function DocumentVisualScope({ target, children, enabled = true, initialManifest }: { target: DocumentVisualTarget; children: ReactNode; enabled?: boolean; initialManifest?: DocumentVisualManifest }) {
  const [manifest, setManifest] = useState<DocumentVisualManifest | null>(initialManifest ?? null);
  const serial = useRef(0);
  const refresh = () => { const request = ++serial.current; if (enabled && !initialManifest) void window.nodus.getDocumentVisuals(target).then(value => { if (request === serial.current) setManifest(value); }).catch(() => { if (request === serial.current) setManifest(null); }); };
  useEffect(() => {
    if (initialManifest) { setManifest(initialManifest); return; }
    setManifest(null); refresh();
    if (!enabled) return;
    const off = window.nodus.onDocumentVisualsChanged(changed => { if (changed.kind === target.kind && changed.id === target.id) refresh(); });
    return () => { serial.current++; off(); };
  }, [target.id, target.kind, enabled, initialManifest]);
  return <Context.Provider value={enabled ? { manifest, target, refresh, removeFigure: id => void window.nodus.removeDocumentFigure(target, id).then(refresh) } : null}>{children}</Context.Provider>;
}

/** Why the planner's proposals did not become figures, counted by motive. The wording
 *  is the processing log's own catalogue, so the panel and the log never disagree. */
function DiscardReasons({ discarded }: { discarded: readonly DocumentVisualDiscard[] }) {
  if (!discarded.length) return null;
  return <ul className="document-visual-discards" data-testid="document-visual-discards">
    {documentVisualDiscardTally(discarded).map(({ reason, count }) => <li key={reason}>{count} · {t(documentVisualDiscardText(reason))}</li>)}
  </ul>;
}

export function DocumentVisualActions() {
  const context = useContext(Context), config = useDocumentSkills();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [settings, setSettings] = useState<AppSettings | null>(null), [model, setModel] = useState<ModelRef | null>(null);
  const statusDialog = useRef<HTMLDialogElement>(null);
  const statusId = useId();
  const chosen = useRef(false);
  const kind = context?.target.kind;
  useEffect(() => {
    if (!kind) return;
    let active = true;
    // The resources follow the task's model, not the one the report was written with: a
    // report remembers who wrote its prose, and that engine may be one the reader has
    // since left behind — or, as with a subscription that ran out of quota, one that
    // refuses to work at all.
    void window.nodus.getSettings().then(fresh => {
      if (!active) return;
      setSettings(fresh);
      if (!chosen.current) setModel(documentVisualModelFromSettings(fresh, kind));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [kind]);
  if (!context) return null;
  const { target, manifest, refresh } = context;
  const discards = manifest?.discarded ?? [];
  const running = busy || manifest?.state === 'planning' || manifest?.state === 'generating';
  const incomplete = manifest && ['partial', 'failed', 'cancelled'].includes(manifest.state);
  const emptyMessage = manifest?.state === 'ready' && !manifest.figures.length
    ? (discards.length
      ? tx('No se añadió ninguna figura: se descartaron {n} propuestas.', { n: discards.length })
      : t('No se añadieron figuras: no eran necesarias.'))
    : '';
  const statusMessage = !running ? (error || (incomplete ? t('Algunos recursos no se pudieron generar.') : emptyMessage)) : '';
  const actionClass = 'btn btn-ghost document-visual-action border border-neutral-300 dark:border-neutral-700';
  const run = async (retry = false) => {
    if (!config.valid && !retry) return;
    setBusy(true); setOpen(false); setError('');
    try { await window.nodus.enrichDocumentVisuals(target, retry && manifest ? manifest.policy : config.policy, { retry, model }); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="document-visual-actions" data-reader-ignore="true">
    <button type="button" className={actionClass} aria-label={t(running ? 'Preparando recursos visuales…' : 'Añadir recursos visuales')} title={t(running ? 'Preparando recursos visuales…' : 'Añadir recursos visuales')} disabled={running} onClick={() => { if (manifest) config.setPolicy(manifest.policy); setOpen(true); }}><Icon name={running ? 'sync' : 'sparkles'} size={16} className={running ? 'animate-spin' : ''} /></button>
    {running && <button type="button" className={actionClass} aria-label={t('Cancelar')} title={t('Cancelar')} onClick={() => void window.nodus.cancelDocumentVisuals(target)}><Icon name="stop" size={16} /></button>}
    {manifest && !running && <button type="button" className={actionClass} aria-label={t('Deshacer enriquecimiento')} title={t('Deshacer enriquecimiento')} onClick={() => void window.nodus.undoDocumentVisuals(target).then(refresh)}><Icon name="undo" size={16} /></button>}
    {incomplete && !running && <button type="button" className={actionClass} aria-label={t('Reintentar')} title={t('Reintentar')} onClick={() => void run(true)}><Icon name="sync" size={16} /></button>}
    {statusMessage && <>
      <button type="button" className={`${actionClass}${error || incomplete ? ' text-amber-600 dark:text-amber-400' : ''}`} aria-label={statusMessage} title={statusMessage} aria-haspopup="dialog" aria-controls={statusId} onClick={() => statusDialog.current?.showModal()}><Icon name={error || incomplete ? 'alert' : 'info'} size={16} /></button>
      <dialog ref={statusDialog} id={statusId} className="document-visual-status-dialog" aria-labelledby={`${statusId}-title`}>
        <header>
          <h2 id={`${statusId}-title`}>{statusMessage}</h2>
          <button type="button" className={actionClass} aria-label={t('Cerrar')} title={t('Cerrar')} onClick={() => statusDialog.current?.close()}><Icon name="x" size={16} /></button>
        </header>
        {incomplete && manifest?.error && <p>{manifest.error}</p>}
        {incomplete && manifest?.figures.filter(figure => figure.error).map(figure => <p key={figure.id}>{figure.caption}: {figure.error}</p>)}
        <DiscardReasons discarded={discards} />
      </dialog>
    </>}
    <span className="sr-only" role={error ? 'alert' : 'status'}>{running ? t('Preparando recursos visuales…') : statusMessage}</span>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setOpen(false)}><section className="w-full max-w-xl rounded-xl bg-white dark:bg-neutral-950 p-5 max-h-[90vh] overflow-auto" role="dialog" aria-modal="true" aria-label={t('Añadir recursos visuales')} onMouseDown={event => event.stopPropagation()}>
      <h2 className="font-semibold mb-3">{t('Añadir recursos visuales')}</h2>
      <DocumentSkillsControl value={config.policy} onChange={config.setPolicy} onValidityChange={config.setValid} />
      {settings && <div className="mt-4" data-testid="document-visual-model">
        <span className="text-xs text-neutral-500">{t('Modelo')}</span>
        <ModelPicker settings={settings} value={model} onChange={next => { chosen.current = true; setModel(next); }} ariaLabel={t('Modelo')} className="w-full text-sm" menu />
        <p className="mt-1 text-xs text-neutral-500">{t('Los recursos se generan con el modelo elegido aquí, no con el del informe.')}</p>
        <SubscriptionQuotaNotice model={model} />
      </div>}
      <p className="text-xs text-neutral-500 mt-3">{t('El texto está guardado. Los recursos visuales son opcionales.')}</p>
      <footer className="flex justify-end gap-2 mt-4"><button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!config.valid} onClick={() => void run()}>{t('Añadir recursos visuales')}</button></footer>
    </section></div>}
  </div>;
}
