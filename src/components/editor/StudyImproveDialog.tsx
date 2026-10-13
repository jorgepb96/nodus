import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudyStyle, StudyStyleInput } from '@shared/types';
import { studyStyleIcon, validateStudyStylePrompt } from '@shared/studyImprove';
import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
import { getActiveLang, t, tx } from '../../i18n';
import { Icon, ICON_NAMES, Spinner } from '../ui';
import { IconEmojiPicker } from '../IconEmojiPicker';
import { ConfirmModal } from '../ConfirmModal';
import './studyImproveDialog.css';
import { studyStyleDisplay } from './studyStyleLocalization';

const TOOLBAR_LIMIT = 4;

const newPrompt = (): StudyStyleInput => ({
  name: '', prompt: '', icon: 'sparkles', color: '#0f766e', description: 'Prompt personalizado creado por el usuario.',
  category: 'custom', language: 'auto', level: 'moderate', length: 'similar', systemPrompt: '', temperature: 0.2,
  maxOutputTokens: 2400, creativity: 0.1, locked: false, favorite: false, active: true,
});

/** El formulario sólo edita icono; un prompt importado con emoji vuelve al icono por defecto. */
const editableIcon = (style: StudyStyle) => {
  const icon = studyStyleIcon(style.icon);
  return (ICON_NAMES as readonly string[]).includes(icon) ? icon : 'sparkles';
};

function PromptMark({ style, size = 17 }: { style: Pick<StudyStyle, 'icon'>; size?: number }) {
  const icon = studyStyleIcon(style.icon);
  return <Icon name={(ICON_NAMES as readonly string[]).includes(icon) ? icon : 'sparkles'} size={size} />;
}

export function StudyImproveDialog({ onToolbarChanged, onClose, onApply }: {
  onToolbarChanged: (styles: StudyStyle[]) => void;
  onClose: () => void;
  onApply?: (style: StudyStyle) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const confirmationOpenRef = useRef(false);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (!confirmationOpenRef.current) { event.preventDefault(); closeRef.current(); }
        return;
      }
      if (event.key !== 'Tab') return;
      const activeDialog = confirmationOpenRef.current
        ? [...document.querySelectorAll<HTMLElement>('[role=dialog]')].find(element => element.getAttribute('aria-label') === t('Eliminar prompt'))
        : dialogRef.current;
      const elements = [...activeDialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []].filter(element => element.getClientRects().length);
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const [styles, setStyles] = useState<StudyStyle[]>([]);
  const [toolbarIds, setToolbarIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('builtin:academic');
  const [query, setQuery] = useState('');
  /** `null` muestra la ficha; `create` y `edit` abren el mismo formulario. */
  const [editing, setEditing] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [draft, setDraft] = useState<StudyStyleInput>(newPrompt);
  const [visual, setVisual] = useState({ icon: 'sparkles', emoji: '' });
  const [pendingDeletion, setPendingDeletion] = useState<StudyStyle | null>(null);
  confirmationOpenRef.current = Boolean(pendingDeletion);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async (preferredId?: string) => {
    const [nextStyles, settings] = await Promise.all([window.nodus.listStudyStyles(), window.nodus.getSettings()]);
    const available = nextStyles.filter((style) => style.active && !style.archivedAt);
    const nextIds = settings.studyImproveToolbarStyleIds.filter((id) => available.some((style) => style.id === id)).slice(0, TOOLBAR_LIMIT);
    setStyles(available);
    setToolbarIds(nextIds);
    const targetId = preferredId ?? selectedId;
    setSelectedId(available.some((style) => style.id === targetId) ? targetId : available[0]?.id ?? '');
    onToolbarChanged(available.filter((style) => nextIds.includes(style.id)).sort((a, b) => nextIds.indexOf(a.id) - nextIds.indexOf(b.id)));
  };

  useEffect(() => { void load(); }, []);

  const selected = styles.find((style) => style.id === selectedId) ?? null;
  const selectedDisplay = selected ? studyStyleDisplay(selected) : null;
  const language = getActiveLang();
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return styles.filter((style) => {
      const display = studyStyleDisplay(style);
      return !needle || `${display.name} ${display.description} ${display.prompt}`.toLocaleLowerCase().includes(needle);
    });
  }, [styles, query, language]);

  const toggleToolbar = async (style: StudyStyle) => {
    const active = toolbarIds.includes(style.id);
    if (!active && toolbarIds.length >= TOOLBAR_LIMIT) {
      setMessage(t('Puedes mostrar un máximo de cuatro prompts en la barra.'));
      return;
    }
    const next = active ? toolbarIds.filter((id) => id !== style.id) : [...toolbarIds, style.id];
    setToolbarIds(next); setMessage('');
    await window.nodus.updateSettings({ studyImproveToolbarStyleIds: next });
    onToolbarChanged(styles.filter((item) => next.includes(item.id)).sort((a, b) => next.indexOf(a.id) - next.indexOf(b.id)));
  };

  const startCreate = () => {
    setDraft(newPrompt()); setVisual({ icon: 'sparkles', emoji: '' }); setEditing({ mode: 'create' }); setMessage('');
  };

  const startEdit = (style: StudyStyle) => {
    setDraft({ name: style.name, prompt: style.prompt, icon: style.icon, description: style.description });
    setVisual({ icon: editableIcon(style), emoji: '' }); setEditing({ mode: 'edit', id: style.id }); setMessage('');
  };

  const savePrompt = async () => {
    if (!draft.name.trim() || !draft.prompt.trim()) { setMessage(t('Indica un título y un prompt.')); return; }
    setBusy(true); setMessage('');
    try {
      const icon = visual.emoji || visual.icon;
      if (editing?.mode === 'edit') {
        // El formulario sólo toca estos tres campos; el resto de la configuración se conserva.
        const saved = await window.nodus.updateStudyStyle(editing.id, { name: draft.name, prompt: draft.prompt, icon });
        setEditing(null);
        await load(saved.id);
        setMessage(t('Prompt actualizado.'));
        return;
      }
      const saved = await window.nodus.createStudyStyle({ ...draft, icon });
      setSelectedId(saved.id); setEditing(null);
      const nextIds = toolbarIds.length < TOOLBAR_LIMIT ? [...toolbarIds, saved.id] : toolbarIds;
      if (nextIds.length !== toolbarIds.length) await window.nodus.updateSettings({ studyImproveToolbarStyleIds: nextIds });
      await load(saved.id);
      setMessage(t('Prompt guardado.'));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  /** Al borrar hay que sacarlo también de la barra: los ajustes guardan ids, no estilos. */
  const deletePrompt = async (style: StudyStyle) => {
    setPendingDeletion(null); setBusy(true); setMessage('');
    try {
      await window.nodus.deleteStudyStyle(style.id);
      const nextIds = toolbarIds.filter((id) => id !== style.id);
      if (nextIds.length !== toolbarIds.length) await window.nodus.updateSettings({ studyImproveToolbarStyleIds: nextIds });
      if (editing?.mode === 'edit' && editing.id === style.id) setEditing(null);
      await load();
      setMessage(t('Prompt eliminado.'));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const warnings = validateStudyStylePrompt(draft.prompt, normalizePromptLanguage(getActiveLang()));
  const builtInNotice = t('Los prompts incluidos no se pueden editar ni eliminar.');
  const cancelDeletion = () => {
    setPendingDeletion(null);
    requestAnimationFrame(() => deleteButtonRef.current?.focus());
  };

  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('Prompts de mejora')} className="study-prompts-backdrop" data-testid="study-improve-dialog" onMouseDown={(event) => { if (event.target === event.currentTarget && !pendingDeletion) onClose(); }}>
    <section className="study-prompts-dialog">
      <header className="study-prompts-header">
        <Icon name="sparkles" size={18} className="study-prompts-heading-mark" />
        <h2>{t('Prompts de mejora')}</h2>
        <button type="button" className="study-prompts-close" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={16} /></button>
      </header>
      <div className="study-prompts-toolbar">
        <label className="study-prompts-search"><Icon name="search" size={15} /><input data-testid="study-prompt-search" type="search" className="input" aria-label={t('Buscar prompts…')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar prompts…')} /></label>
        <button type="button" data-testid="study-style-new" className="btn study-prompts-new" onClick={startCreate}><Icon name="plus" size={14} />{t('Nuevo prompt')}</button>
      </div>
      <div className="study-prompts-layout">
        <aside className="study-prompts-sidebar">
          <div className="study-prompts-list" data-testid="study-style-list" role="list" aria-label={t('Prompts de mejora')}>
            {filtered.map((style) => {
              const inToolbar = toolbarIds.includes(style.id);
              const display = studyStyleDisplay(style);
              return <div key={style.id} className={`study-prompts-row${selectedId === style.id ? ' is-selected' : ''}`} role="listitem">
                <button type="button" className="study-prompts-choice" data-testid={`study-style-${style.id.replace(':', '-')}`} aria-pressed={selectedId === style.id} title={display.name} onClick={() => { setSelectedId(style.id); setEditing(null); setMessage(''); }}><PromptMark style={style} size={16} /><span>{display.name}</span></button>
                <button type="button" data-testid={`study-style-toolbar-${style.id.replace(':', '-')}`} className={`study-prompts-pin${inToolbar ? ' is-pinned' : ''}`} aria-pressed={inToolbar} title={inToolbar ? t('Quitar de la barra') : t('Mostrar en la barra')} aria-label={inToolbar ? t('Quitar de la barra') : t('Mostrar en la barra')} onClick={() => void toggleToolbar(style)}><Icon name="star" size={13} /></button>
              </div>;
            })}
            {!filtered.length && <p className="study-prompts-empty" role="status">{t(query.trim() ? 'Sin resultados' : 'No hay prompts guardados.')}</p>}
          </div>
          <div className="study-prompts-shortcuts"><Icon name="star" size={13} /><span>{toolbarIds.length}/{TOOLBAR_LIMIT}</span><p>{t('Elige hasta cuatro accesos rápidos para la barra de escritura.')}</p></div>
        </aside>
        <main className="study-prompts-main" data-testid={!editing && selected ? 'study-prompt-detail' : undefined}>
          {editing ? <>
            <div className="study-prompts-detail-header"><h3>{t(editing.mode === 'edit' ? 'Editar prompt' : 'Añadir prompt')}</h3></div>
            <div className="study-prompts-content" data-testid="study-style-editor">
              <label className="study-prompts-field">{t('Título')}<input data-testid="study-prompt-title" autoFocus className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label className="study-prompts-field">{t('Icono')}<IconEmojiPicker icon={visual.icon} emoji="" allowEmoji={false} onChange={(value) => setVisual({ icon: value.icon, emoji: '' })} /></label>
              <label className="study-prompts-field study-prompts-text-field">{t('Prompt')}<textarea data-testid="study-prompt-text" className="input" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder={t('Indica exactamente cómo debe transformar el texto seleccionado…')} /></label>
              {draft.prompt.trim() && warnings.length > 0 && <div className="study-prompts-warning">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
            </div>
          </> : selected ? <>
            <div className="study-prompts-detail-header">
              <div className="study-prompts-identity"><PromptMark style={selected} size={18} /><div><h3>{selectedDisplay?.name}</h3><p>{t(selected.builtIn ? 'Prompt incluido' : 'Prompt personalizado')}</p></div></div>
              <div className="study-prompts-detail-actions">
                <button type="button" data-testid="study-prompt-edit" className="btn" disabled={busy || selected.builtIn} title={selected.builtIn ? builtInNotice : t('Editar prompt')} onClick={() => startEdit(selected)}><Icon name="edit" size={13} />{t('Editar')}</button>
                <button type="button" ref={deleteButtonRef} data-testid="study-prompt-delete" className="btn study-prompts-delete" disabled={busy || selected.builtIn} title={selected.builtIn ? builtInNotice : t('Eliminar prompt')} onClick={() => { setMessage(''); setPendingDeletion(selected); }}><Icon name="trash" size={13} />{t('Eliminar')}</button>
              </div>
            </div>
            <article className="study-prompts-content" data-testid="study-prompt-content" key={selected.id}>
              <p className="study-prompts-description">{selectedDisplay?.description || t('Sin descripción.')}</p>
              {selected.builtIn && <p className="study-prompts-builtin-notice">{builtInNotice}</p>}
              <h4>{t('Prompt guardado')}</h4>
              <pre className="study-prompts-text">{selectedDisplay?.prompt}</pre>
            </article>
          </> : <div className="study-prompts-content study-prompts-empty">{t('No hay prompts guardados.')}</div>}
          {message && <p className="study-prompts-message" role="status">{message}</p>}
          <footer className="study-prompts-footer">
            {editing ? <div className="study-prompts-save-actions"><button type="button" className="btn" onClick={() => setEditing(null)}>{t('Cancelar')}</button><button type="button" data-testid="study-prompt-save" className="btn study-prompts-primary" disabled={busy} onClick={() => void savePrompt()}>{busy ? <Spinner label={t('Guardando…')} /> : t(editing.mode === 'edit' ? 'Guardar cambios' : 'Guardar prompt')}</button></div>
              : selected && <><button type="button" className="btn study-prompts-shortcut-toggle" aria-pressed={toolbarIds.includes(selected.id)} onClick={() => void toggleToolbar(selected)}><Icon name="star" size={13} />{t(toolbarIds.includes(selected.id) ? 'Visible en la barra' : 'Mostrar en la barra')}</button>{onApply && <button type="button" data-testid="study-prompt-apply" className="btn study-prompts-primary" onClick={() => onApply(selected)}><Icon name="sparkles" size={14} />{t('Mejorar con IA')}</button>}</>}
          </footer>
        </main>
      </div>
    </section>
    {pendingDeletion && <ConfirmModal
      zIndex={150}
      danger
      title={t('Eliminar prompt')}
      message={tx('Se eliminará «{name}» de tus prompts de mejora. Esta acción no se puede deshacer.', { name: pendingDeletion.name })}
      confirmLabel={t('Eliminar')}
      autoFocusConfirm={false}
      onCancel={cancelDeletion}
      onConfirm={() => void deletePrompt(pendingDeletion)}
    />}
  </div>;
}
