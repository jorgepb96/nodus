import { useCallback, useEffect, useState } from 'react';
import {
  TRANSLATION_LANGUAGES,
  type ContentTranslation,
  type ContentTranslationSummary,
  type ModelRef,
  type TranslationEntityKind,
} from '@shared/types';
import { Icon, ModalBackdrop } from './ui';
import { confirm } from './feedback';
import { t, tx } from '../i18n';

/**
 * Translation manager presented next to the action that opens it instead of at
 * the end of a potentially very long document. Jobs are persisted by the main
 * process before the first AI call, so closing the dialog never interrupts them.
 */
export function TranslationModal({
  onClose,
  ...panelProps
}: {
  entityKind: TranslationEntityKind;
  entityId: string;
  sourceTitle: string;
  sourceMarkdown: string;
  model: ModelRef | null;
  activeTranslationId: string | null;
  onApply: (translation: ContentTranslation | null) => void;
  onClose: () => void;
}) {
  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="card-modal flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="translation-modal-title"
        data-testid="translation-modal"
      >
        <header className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <Icon name="languages" className="text-indigo-500 dark:text-indigo-300" />
          <h2 id="translation-modal-title" className="text-sm font-semibold">{t('Traducciones')}</h2>
          <div className="flex-1" />
          <button className="btn btn-ghost !p-2" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          <TranslationPanel
            {...panelProps}
            onApply={(translation) => {
              panelProps.onApply(translation);
              onClose();
            }}
          />
        </div>
      </section>
    </ModalBackdrop>
  );
}

function TranslationPanel({
  entityKind,
  entityId,
  sourceTitle,
  sourceMarkdown,
  model,
  activeTranslationId,
  onApply,
}: {
  entityKind: TranslationEntityKind;
  entityId: string;
  sourceTitle: string;
  sourceMarkdown: string;
  model: ModelRef | null;
  activeTranslationId: string | null;
  onApply: (translation: ContentTranslation | null) => void;
}) {
  const [list, setList] = useState<ContentTranslationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState('en');
  const [starting, setStarting] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setList(await window.nodus.listContentTranslations(entityKind, entityId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [entityKind, entityId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => window.nodus.onContentTranslationsChanged((kind, id) => {
    if ((kind === null || kind === entityKind) && (id === null || id === entityId)) void refresh();
  }), [entityId, entityKind, refresh]);
  useEffect(() => {
    if (!list.some((item) => item.status === 'generating')) return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [list, refresh]);
  useEffect(() => {
    const taken = new Set(list.map((item) => item.language));
    const firstFree = TRANSLATION_LANGUAGES.find((item) => !taken.has(item.code));
    if (firstFree) setLanguage((current) => taken.has(current) ? firstFree.code : current);
  }, [list]);

  const generate = (code: string) => {
    if (starting.includes(code) || list.some((item) => item.language === code && item.status === 'generating')) return;
    setError(null);
    setStarting((current) => [...current, code]);
    void window.nodus.generateContentTranslation({ entityKind, entityId, language: code, sourceTitle, sourceMarkdown, model })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { setStarting((current) => current.filter((item) => item !== code)); void refresh(); });
    window.setTimeout(() => void refresh(), 80);
  };

  const apply = async (summary: ContentTranslationSummary) => {
    if (summary.status !== 'ready') return;
    setError(null);
    try {
      const full = await window.nodus.getContentTranslation(summary.id);
      if (!full) throw new Error(t('La traducción ya no está disponible.'));
      onApply(full);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const remove = async (summary: ContentTranslationSummary) => {
    const ok = await confirm({ title: t('Eliminar traducción'), message: tx('¿Eliminar la traducción a {lang}? Esta acción no se puede deshacer.', { lang: summary.languageLabel }), confirmLabel: t('Eliminar'), danger: true, zIndex: 140 });
    if (!ok) return;
    await window.nodus.deleteContentTranslation(summary.id);
    if (activeTranslationId === summary.id) onApply(null);
    await refresh();
  };

  return <section className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/30" data-testid="translation-panel">
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1"><label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t('Idioma')}</label><select className="input w-full text-sm" value={language} onChange={(event) => setLanguage(event.target.value)}>{TRANSLATION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.nativeName} — {item.name}</option>)}</select></div>
      <button className="btn btn-primary gap-1.5" disabled={starting.includes(language) || list.some((item) => item.language === language && item.status === 'generating')} onClick={() => generate(language)}><Icon name={starting.includes(language) ? 'sync' : 'languages'} className={starting.includes(language) ? 'animate-spin' : ''} size={15} />{starting.includes(language) ? t('Traduciendo…') : t('Generar traducción')}</button>
    </div>
    <p className="mt-2 text-xs text-neutral-500">{t('Puedes salir de esta vista. La traducción seguirá trabajando y conservará aquí su estado.')}</p>
    {error && <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-400">{error}</p>}
    <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Traducciones')}</h3>
      <ul className="space-y-1.5">
        <li className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${activeTranslationId == null ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}><button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onApply(null)}><Icon name="book" size={14} /><span className="text-sm font-medium">{t('Contenido original')}</span></button>{activeTranslationId == null && <span className="text-[10px] font-semibold uppercase text-indigo-500">{t('Aplicado')}</span>}</li>
        {loading && !list.length ? <li className="py-5 text-center text-xs text-neutral-500">{t('Cargando traducciones…')}</li> : list.map((item) => {
          const working = item.status === 'generating'; const failed = item.status === 'error'; const active = activeTranslationId === item.id;
          return <li key={item.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${active ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : failed ? 'border-red-300 dark:border-red-900/60' : 'border-neutral-200 dark:border-neutral-800'}`}>
            <button aria-label={tx('Leer traducción a {lang}', {lang:item.languageLabel})} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default" disabled={working || failed} onClick={() => void apply(item)}>
              <Icon name={working ? 'sync' : failed ? 'alert' : 'book'} size={14} className={working ? 'animate-spin text-indigo-400' : failed ? 'text-red-400' : 'text-neutral-400'} />
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.languageLabel}</span><span className={`block truncate text-[11px] ${failed ? 'text-red-400' : 'text-neutral-500'}`}>{working ? t('Traduciendo…') : failed ? item.error || t('No se pudo completar') : item.title}</span></span>
            </button>
            {active && <span className="text-[10px] font-semibold uppercase text-indigo-500">{t('Aplicado')}</span>}
            <button className="btn btn-ghost !py-1" aria-label={tx('Regenerar traducción a {lang}', {lang:item.languageLabel})} title={t('Regenerar esta traducción')} disabled={working} onClick={() => generate(item.language)}><Icon name={working ? 'sync' : 'refresh'} size={12} className={working ? 'animate-spin' : ''} /></button>
            <button className="btn btn-ghost !py-1 text-neutral-500 hover:text-red-400" title={t('Eliminar traducción')} disabled={working} onClick={() => void remove(item)}><Icon name="trash" size={12} /></button>
          </li>;
        })}
      </ul>
    </div>
  </section>;
}
