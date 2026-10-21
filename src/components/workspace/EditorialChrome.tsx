import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../ui';
import { getActiveLang, t } from '../../i18n';
import { EDITORIAL_WORKSPACE_TRANSLATIONS } from '../../i18n.editorialWorkspace';
import './editorialWorkspace.css';
export interface EditorialItem { id: string; title: string; snippet: string; collection?: string }
export function EditorialCreateTrigger() {
  return <summary role="button" className="editorial-create-trigger" aria-label={t('Crear')} title={t('Crear')}><Icon name="plus" size={16} /></summary>;
}
export function EditorialCatalogRow({className = '',...props}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`editorial-catalog-row ${className}`} />;
}
export function EditorialInspector({activeTab,tabs,onTabChange,onClose,views,children}: {activeTab:string;tabs:Array<{id:string;label:string}>;onTabChange(id:string):void;onClose():void;views?:ReactNode;children:ReactNode}) {
  return <aside className="editorial-inspector" aria-label={t('Contexto del documento')}><div className="editorial-inspector-header"><b>{t('Contexto')}</b><button aria-label={t('Cerrar contexto')} onClick={onClose}><Icon name="x" size={14} /></button></div><div className="editorial-context-tabs" role="tablist">{tabs.map(tab=><button key={tab.id} role="tab" aria-selected={activeTab===tab.id} onClick={()=>onTabChange(tab.id)}>{tab.label}</button>)}</div>{views}{children}</aside>;
}
export function EditorialTitle({ value, onChange, readOnly, testId }: { value: string; onChange(value: string): void; readOnly?: boolean; testId?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const element = ref.current; if (!element) return; const resize = () => { element.style.height='auto'; element.style.height=`${element.scrollHeight}px`; }; resize(); const observer=new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect(); }, [value]);
  return <textarea ref={ref} rows={1} data-testid={testId} className="editorial-document-title" aria-label={t('Título del documento')} value={value} readOnly={readOnly} onChange={event => onChange(event.target.value.replace(/\n/g,' '))} />;
}
export function EditorialHeader({ title, location, status, contextOpen, focus, onContext, onFocus, leading, trailing, options, navigationOpen, onNavigation, onPreserveSelection }: { title: string; location?: string; status: string; contextOpen: boolean; focus: boolean; onContext(): void; onFocus(): void; leading?: ReactNode; trailing?: ReactNode; options?: ReactNode; navigationOpen?: boolean; onNavigation?(): void; onPreserveSelection?(): void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const contextLabel = t('Contexto');
  const focusLabel = t(focus ? 'Salir de foco' : 'Foco');
  useLayoutEffect(() => {
    const close = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector<HTMLElement>('summary')?.focus(); } };
    document.addEventListener('pointerdown',close); document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('pointerdown',close); document.removeEventListener('keydown',escape); };
  }, []);
  return <header className="editorial-editor-header" onPointerDownCapture={onPreserveSelection} onFocusCapture={onPreserveSelection}>{focus && onNavigation && <button data-testid="editorial-focus-navigation" className="editorial-header-action" aria-label={t(navigationOpen ? 'Ocultar el menú lateral' : 'Mostrar el menú lateral')} aria-pressed={navigationOpen} onClick={onNavigation}><Icon name="menu" size={14} /></button>}<div className="editorial-header-leading">{leading}</div><span className="editorial-location" title={`${location ?? t('Documento')} / ${title}`}>{location ?? t('Documento')}</span><span data-testid="study-editor-save-state" className="editorial-save-status" role="status" aria-live="polite">{status}</span>{trailing}<button className="editorial-header-action editorial-header-icon" aria-label={contextLabel} title={contextLabel} aria-pressed={contextOpen} onClick={onContext}><Icon name="columns" size={14} /></button><button className="editorial-header-action editorial-header-icon" aria-label={focusLabel} title={focusLabel} aria-pressed={focus} onClick={onFocus}><Icon name={focus ? 'minimize' : 'fit'} size={14} /></button><details ref={menu} className="editorial-options"><summary role="button" aria-label={t('Opciones del documento')}>···</summary><div className="editorial-options-panel" onClick={event=>{if((event.target as Element).closest('button:not(:disabled):not(.editorial-action-pin)')&&menu.current)menu.current.open=false;}}>{options}</div></details></header>;
}
export function EditorialNavigator({ items, activeId, search, onSearch, onOpen, onClose, collectionControl }: { items: EditorialItem[]; activeId: string; search: string; onSearch(value: string): void; onOpen(id: string): void; onClose(): void; collectionControl?: ReactNode }) {
  return <aside className="editorial-navigator"><div className="editorial-navigator-heading"><b>{t('Documentos')}</b><button aria-label={t('Cerrar navegador')} onClick={onClose}><Icon name="x" size={14} /></button></div><input className="input" value={search} onChange={event => onSearch(event.target.value)} placeholder={t('Buscar…')} />{collectionControl}{items.map(item => <button key={item.id} className="editorial-navigator-note" aria-current={item.id === activeId} onClick={() => onOpen(item.id)}><b>{item.title}</b><small>{item.snippet}</small></button>)}</aside>;
}
export function EditorialCards({ items, onOpen }: { items: EditorialItem[]; onOpen(id: string): void }) {
  return <div className="editorial-recent-cards">{items.map(item => <button className="editorial-recent-card" title={item.title} key={item.id} onClick={() => onOpen(item.id)}><small>{item.collection ?? t('Sin colección')}</small><h3>{item.title}</h3><p>{item.snippet || t('Sin contenido')}</p></button>)}</div>;
}
export function CatalogViewControl({ value, onChange }: { value: 'list' | 'cards'; onChange(value: 'list' | 'cards'): void }) {
  // This catalogue view uses document cards; the global study translation of
  // “Tarjetas” means flashcards and must retain its existing meaning.
  const language = getActiveLang();
  const cards = language === 'es' ? 'Tarjetas' : EDITORIAL_WORKSPACE_TRANSLATIONS[language]?.Tarjetas ?? t('Tarjetas');
  return <><button className="editorial-header-action" aria-pressed={value === 'list'} onClick={() => onChange('list')}>{t('Lista')}</button><button className="editorial-header-action" aria-pressed={value === 'cards'} onClick={() => onChange('cards')}>{cards}</button></>;
}
