import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  GlobalLibrarySettings,
  LibraryAttachmentRenameTemplate,
  LibraryAttachmentRenameType,
} from '@shared/libraryTypes';
import {
  buildAutomaticAttachmentFileName,
  DEFAULT_GLOBAL_LIBRARY_SETTINGS,
} from '@shared/libraryAttachmentNaming';
import { t } from '../../i18n';
import { Icon, Spinner } from '../ui';

const TEMPLATE_OPTIONS: Array<{ value: LibraryAttachmentRenameTemplate; label: string }> = [
  { value: 'creator-year-title', label: 'Autor - año - título' },
  { value: 'year-creator-title', label: 'Año - autor - título' },
  { value: 'title-creator-year', label: 'Título - autor - año' },
];

const TYPE_OPTIONS: Array<{ value: LibraryAttachmentRenameType; label: string; detail: string }> = [
  { value: 'pdf', label: 'PDF', detail: 'Artículos y documentos' },
  { value: 'epub', label: 'EPUB', detail: 'Libros electrónicos' },
  { value: 'other', label: 'Otros', detail: 'Imágenes, datos y documentos de oficina' },
];

function SwitchRow({ checked, disabled, title, description, testId, onChange }: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  testId?: string;
  onChange: (checked: boolean) => void;
}) {
  return <div className={`flex items-start gap-4 rounded-xl border border-neutral-800 p-4 ${disabled ? 'opacity-45' : ''}`}>
    <div className="min-w-0 flex-1"><b className="block text-sm">{title}</b><p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p></div>
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      disabled={disabled}
      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? 'border-indigo-400 bg-indigo-600' : 'border-neutral-700 bg-neutral-900'}`}
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute left-0 top-0.5 h-[1.125rem] w-[1.125rem] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      <span className="sr-only">{title}</span>
    </button>
  </div>;
}

function SettingsSection({ icon, title, description, children }: {
  icon: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return <section className="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-4">
    <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300"><Icon name={icon} size={17} /></span><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p></div></div>
    <div className="mt-4 space-y-3">{children}</div>
  </section>;
}

export function LibrarySettingsDialog({ settings, onClose, onSaved }: {
  settings: GlobalLibrarySettings;
  onClose: () => void;
  onSaved: (settings: GlobalLibrarySettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = useMemo(() => buildAutomaticAttachmentFileName({
    title: 'Prácticas de lectura y memoria digital', itemType: 'journal-article',
    creators: [
      { creatorType: 'author', firstName: 'Alicia', lastName: 'Ruiz' },
      { creatorType: 'author', firstName: 'Martín', lastName: 'Vega' },
    ],
    year: 2026, isbn: [], issn: [], tags: [],
  }, 'original.pdf', draft.attachmentRenameTemplate), [draft.attachmentRenameTemplate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const patch = <K extends keyof GlobalLibrarySettings>(key: K, value: GlobalLibrarySettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleType = (type: LibraryAttachmentRenameType) => patch('autoRenameAttachmentTypes', draft.autoRenameAttachmentTypes.includes(type)
    ? draft.autoRenameAttachmentTypes.filter((entry) => entry !== type)
    : [...draft.autoRenameAttachmentTypes, type]);
  const save = async () => {
    setBusy(true); setError('');
    try { onSaved(await window.nodus.setGlobalLibrarySettings(draft)); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[88] grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section data-testid="global-library-settings-dialog" className="card-modal flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-800 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="global-library-settings-title">
      <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="tools" size={19} /></span>
        <div className="min-w-0 flex-1"><h2 id="global-library-settings-title" className="font-semibold">{t('Opciones de la Biblioteca global')}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{t('Configura cómo Nodus nombra, protege y prepara los archivos de todos tus vaults.')}</p></div>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <SettingsSection icon="file" title={t('Nombres de archivo')} description={t('Nodus sigue la separación de Zotero entre el título visible del adjunto y su nombre real en disco.')}>
          <SwitchRow
            checked={draft.autoRenameAttachments}
            title={t('Renombrar adjuntos automáticamente')}
            description={t('Usa los metadatos de la referencia al añadir archivos. Está activado por defecto.')}
            testId="library-auto-rename-attachments"
            onChange={(checked) => patch('autoRenameAttachments', checked)}
          />
          <label className={`block rounded-xl border border-neutral-800 p-4 ${draft.autoRenameAttachments ? '' : 'opacity-45'}`}>
            <span className="text-xs font-medium">{t('Formato del nombre')}</span>
            <select data-testid="library-rename-template" className="input mt-2 w-full" disabled={!draft.autoRenameAttachments} value={draft.attachmentRenameTemplate} onChange={(event) => patch('attachmentRenameTemplate', event.target.value as LibraryAttachmentRenameTemplate)}>
              {TEMPLATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
            </select>
            <span className="mt-2 block break-all rounded-lg bg-neutral-900 px-3 py-2 font-mono text-[10px] text-neutral-400">{preview}</span>
          </label>
          <div className={`rounded-xl border border-neutral-800 p-4 ${draft.autoRenameAttachments ? '' : 'opacity-45'}`}><span className="text-xs font-medium">{t('Tipos de archivo')}</span><div className="mt-3 grid gap-2 sm:grid-cols-3">{TYPE_OPTIONS.map((option) => {
            const active = draft.autoRenameAttachmentTypes.includes(option.value);
            return <button key={option.value} type="button" data-testid={`library-rename-type-${option.value}`} disabled={!draft.autoRenameAttachments} aria-pressed={active} className={`rounded-xl border p-3 text-left ${active ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200' : 'border-neutral-800 text-neutral-500'}`} onClick={() => toggleType(option.value)}><b className="block text-xs">{t(option.label)}</b><span className="mt-1 block text-[10px] leading-4 opacity-70">{t(option.detail)}</span></button>;
          })}</div></div>
          <SwitchRow
            checked={draft.renameSupplementaryAttachments}
            disabled={!draft.autoRenameAttachments}
            title={t('Renombrar también los adjuntos adicionales')}
            description={t('Desactivado por defecto para conservar nombres informativos como tablas, anexos o conjuntos de datos.')}
            onChange={(checked) => patch('renameSupplementaryAttachments', checked)}
          />
          <SwitchRow
            checked={draft.keepAttachmentNamesInSync}
            disabled={!draft.autoRenameAttachments}
            title={t('Mantener los nombres sincronizados')}
            description={t('Actualiza los nombres gestionados por Nodus cuando cambias autor, año o título; los nombres editados manualmente no se tocan.')}
            onChange={(checked) => patch('keepAttachmentNamesInSync', checked)}
          />
          <button type="button" className="text-xs font-medium text-indigo-300 hover:text-indigo-200" onClick={() => setDraft((current) => ({
            ...current,
            autoRenameAttachments: DEFAULT_GLOBAL_LIBRARY_SETTINGS.autoRenameAttachments,
            attachmentRenameTemplate: DEFAULT_GLOBAL_LIBRARY_SETTINGS.attachmentRenameTemplate,
            autoRenameAttachmentTypes: DEFAULT_GLOBAL_LIBRARY_SETTINGS.autoRenameAttachmentTypes,
            renameSupplementaryAttachments: DEFAULT_GLOBAL_LIBRARY_SETTINGS.renameSupplementaryAttachments,
            keepAttachmentNamesInSync: DEFAULT_GLOBAL_LIBRARY_SETTINGS.keepAttachmentNamesInSync,
          }))}>{t('Restaurar valores de Zotero')}</button>
        </SettingsSection>
        <SettingsSection icon="bookOpen" title={t('Preparación de lectura')} description={t('Controla el trabajo que Nodus inicia después de incorporar un archivo.') }>
          <SwitchRow
            checked={draft.autoPrepareAttachments}
            title={t('Preparar automáticamente una copia legible')}
            description={t('Genera Markdown, estructura, tablas, imágenes y OCR en segundo plano. El original nunca se modifica.')}
            testId="library-auto-prepare-attachments"
            onChange={(checked) => patch('autoPrepareAttachments', checked)}
          />
        </SettingsSection>
        {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-neutral-800 px-5 py-4"><p className="text-[10px] leading-4 text-neutral-600">{t('Estas opciones se guardan con la Biblioteca global y se aplican a todos los vaults.')}</p><div className="flex shrink-0 gap-2"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button data-testid="save-global-library-settings" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : <Icon name="save" />} {t('Guardar')}</button></div></footer>
    </section>
  </div>;
}
