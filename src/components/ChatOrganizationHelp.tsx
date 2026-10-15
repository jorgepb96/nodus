import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Icon } from './ui';

/** Read-only help: opening it never creates a chat or prepares any sources. */
export function ChatOrganizationHelp({ collections, locksMoves, onClose }: {
  collections: boolean;
  locksMoves: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const notebookId = useId();
  const projectId = useId();
  const [accent, setAccent] = useState('var(--a-500)');
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    const surface = document.querySelector('.research-chat-surface');
    if (surface) setAccent(getComputedStyle(surface).getPropertyValue('--vault-accent').trim() || 'var(--a-500)');
    element?.showModal();
    return () => { element?.close(); trigger?.focus({ preventScroll: true }); };
  }, []);

  return createPortal(<dialog ref={dialog} data-testid="chat-organization-help-dialog" data-browser-native-overlay="true"
    className="research-system-prompt-dialog research-prompt-edit-modal research-history-help" role="dialog" aria-modal="true" aria-labelledby={titleId}
    style={{ '--vault-accent': accent } as CSSProperties}
    onKeyDown={event => {
      if (event.key === 'Escape') event.stopPropagation();
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== dialog.current) return;
      const bounds = dialog.current.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="research-prompt-edit-head">
      <Icon name="help" size={18} /><h2 id={titleId}>{t('Cuadernos y proyectos')}</h2>
      <button type="button" className="btn btn-ghost ml-auto" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={16} /></button>
    </header>
    <div className="research-prompt-edit-body">
      <div className="research-history-help-grid">
        <section className="research-history-help-card" aria-labelledby={notebookId}>
          <h3 id={notebookId}><Icon name="notebook" size={17} />{t('Cuaderno (notebook)')}</h3>
          <p>{t('Un cuaderno reúne un conjunto de fuentes para consultarlas en varias conversaciones.')}</p>
          <p>{t(collections
            ? 'Selecciona colecciones de Nodus o Zotero. Los chats del cuaderno consultan las obras incluidas en ellas.'
            : 'Selecciona las fuentes del cuaderno. Sus chats conservan ese ámbito de consulta.')}</p>
          {collections && <p>{t('Al guardar un cuaderno académico se preparan sus colecciones. Podrás consultarlo cuando termine la indexación.')}</p>}
          <p className="research-history-help-use">{t('Úsalo para comparar artículos de un tema, estudiar una bibliografía o reunir evidencia para una pregunta.')}</p>
        </section>
        <section className="research-history-help-card" aria-labelledby={projectId}>
          <h3 id={projectId}><Icon name="folder" size={17} />{t('Proyecto')}</h3>
          <p>{t('Un proyecto organiza conversaciones sobre un trabajo y comparte instrucciones entre ellas.')}</p>
          <p>{t('Agrupa chats en carpetas, mueve conversaciones y define instrucciones comunes de tono, enfoque o formato.')}</p>
          <p>{t('Cada chat del proyecto conserva su propio contexto; el proyecto no fija las fuentes.')}</p>
          <p className="research-history-help-use">{t('Úsalo para una tesis, un artículo o un trabajo con varias líneas de investigación.')}</p>
        </section>
      </div>
      <p className="research-history-help-choice">{t('Elige un cuaderno para compartir fuentes y un proyecto para organizar chats y compartir instrucciones.')}</p>
      <div className="research-history-help-notes">
        {locksMoves && <p>{t('Los chats de un cuaderno permanecen en él y no se pueden mover a un proyecto.')}</p>}
        <p>{t('Eliminar un cuaderno o un proyecto conserva sus chats en el historial general.')}</p>
      </div>
    </div>
    <footer className="research-prompt-footer research-prompt-edit-foot"><span /><span /><button type="button" className="btn btn-primary" onClick={onClose}>{t('Entendido')}</button></footer>
  </dialog>, document.body);
}
