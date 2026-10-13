import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, ModelRef, StudyStyle } from '@shared/types';
import type { EditorImageModel, EditorImageResult } from '@shared/editorAiReview';
import { Icon, Spinner } from '../ui';
import { ModelPicker } from '../ModelPicker';
import { useModelPickerPopover } from '../useModelPickerPopover';
import { getActiveLang, t } from '../../i18n';
import './scriptorAi.css';
import { studyStyleDisplay } from './studyStyleLocalization';

export interface AiChoice { id: string; label: string; description?: string; disabled?: boolean }
export function ScriptorSearchSelect({ label, testId, value, choices, onChange, disabled }: { label: string; testId: string; value: string; choices: AiChoice[]; onChange(id: string): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const language = getActiveLang();
  const ordered = useMemo(() => [...choices].sort((a, b) => a.label.localeCompare(b.label, language, { sensitivity: 'base' })), [choices, language]);
  const filtered = useMemo(() => ordered.filter(item => `${item.label} ${item.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [ordered, query]);
  useModelPickerPopover(open, popup, trigger);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const choose = (id: string) => { onChange(id); setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div ref={root} className="scriptor-ai-select">
    <button type="button" ref={trigger} data-testid={testId} disabled={disabled} aria-label={label} title={choices.find(item => item.id === value)?.label} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setQuery(''); setActive(Math.max(0, ordered.findIndex(item => item.id === value))); setOpen(!open); }}><span>{choices.find(item => item.id === value)?.label ?? label}</span><Icon name="chevronDown" size={13} /></button>
    {open && <div ref={popup} className="model-picker-options scriptor-ai-options" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => filtered.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0); }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const item = filtered[active]; if (item && !item.disabled) choose(item.id); }
    }}>
      <label className="scriptor-ai-option-search"><Icon name="search" size={14} /><input type="search" data-testid={`${testId}-search`} aria-label={label} placeholder={t('Buscar…')} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} role="combobox" aria-expanded="true" aria-controls={`${testId}-list`} aria-activedescendant={filtered[active] ? `${testId}-option-${active}` : undefined} /></label>
      <div role="listbox" id={`${testId}-list`} aria-label={label} className="scriptor-ai-option-list">{filtered.map((item, index) => <button type="button" id={`${testId}-option-${index}`} role="option" aria-selected={item.id === value} disabled={item.disabled} data-active={index === active} key={item.id} onClick={() => choose(item.id)}><span>{item.label}</span>{item.description && <small>{item.description}</small>}{item.id === value && <Icon name="check" size={13} />}</button>)}{!filtered.length && <p>{t('Sin resultados')}</p>}</div>
    </div>}
  </div>;
}

export function ScriptorAiPanel(props: {
  mode: 'polish' | 'image'; settings: AppSettings; model: ModelRef | null; onModelChange(model: ModelRef | null): void;
  styles: StudyStyle[]; quickStyles: StudyStyle[]; styleId: string; onStyleChange(id: string): void;
  instructions: string; onInstructionsChange(value: string): void; imagePrompt: string; onImagePromptChange(value: string): void;
  imageModel: EditorImageModel; imageChoices: AiChoice[]; onImageModelChange(model: EditorImageModel): void;
  status: 'compose' | 'streaming' | 'review' | 'generating' | 'image-ready'; error: string; warnings: string[]; image: EditorImageResult | null;
  onSubmit(): void; onCancel(): void; onAccept(): void; onReject(): void; onImage(): void; onPolish(): void; onInsert(): void; onClose(): void; onLayout(): void;
}) {
  const [tools, setTools] = useState(false); const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null), onLayout = useRef(props.onLayout); onLayout.current = props.onLayout;
  const busy = props.status === 'streaming' || props.status === 'generating', review = props.status === 'review';
  useLayoutEffect(() => {
    const element = panel.current, column = element?.parentElement; if (!element || !column) return;
    let frame = 0;
    const measure = () => {
      column.style.setProperty('--scriptor-ai-height', `${element.offsetHeight}px`);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => onLayout.current());
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure(); window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(frame); column.style.removeProperty('--scriptor-ai-height'); };
  }, []);
  useEffect(() => { if (!busy && !review) input.current?.focus({ preventScroll: true }); }, [props.mode, props.status]);
  useEffect(() => { const textarea = input.current; if (textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(72, textarea.scrollHeight)}px`; } }, [props.mode, props.instructions, props.imagePrompt]);
  return <section ref={panel} className="scriptor-ai-panel" role="dialog" aria-modal="false" aria-label={t(props.mode === 'image' ? 'Crear imagen con IA' : 'Pulir')} data-testid="scriptor-ai-panel" data-streaming={props.status === 'streaming'} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); if (tools) setTools(false); else props.onClose(); } }}>
    <header><Icon name={props.mode === 'image' ? 'image' : 'aiPolish'} size={17} /><strong>{t(props.mode === 'image' ? 'Crear imagen con IA' : 'Pulir')}</strong><span className="scriptor-ai-status" role="status">{t(props.status === 'streaming' ? 'Comparación provisional…' : review ? 'Revisa la propuesta' : props.status === 'generating' ? 'Generando imagen…' : props.mode === 'polish' ? 'Texto seleccionado' : 'Vista previa antes de insertar')}</span><button type="button" aria-label={t('Cerrar')} data-testid="scriptor-ai-close" onClick={props.onClose}><Icon name="x" size={15} /></button></header>
    {props.mode === 'polish' && <div className="scriptor-ai-controls">
      <ScriptorSearchSelect label={t('Estilo')} testId="scriptor-ai-style" choices={props.styles.map(style => { const display = studyStyleDisplay(style); return { id: style.id, label: display.name, description: display.description }; })} value={props.styleId} onChange={props.onStyleChange} disabled={busy} />
      <ModelPicker settings={props.settings} value={props.model} onChange={props.onModelChange} disabled={busy} compact menu allowEmpty={false} triggerModelOnly ariaLabel={t('Modelo de texto')} />
      {props.quickStyles.map(style => <button type="button" className="scriptor-ai-quick" key={style.id} aria-pressed={style.id === props.styleId} disabled={busy} onClick={() => props.onStyleChange(style.id)}>{studyStyleDisplay(style).name}</button>)}
    </div>}
    {props.mode === 'image' && <div className="scriptor-ai-controls"><ScriptorSearchSelect label={t('Modelo de imagen')} testId="scriptor-ai-image-model" choices={props.imageChoices} value={`${props.imageModel.provider}:${props.imageModel.model}`} onChange={id => { const at = id.indexOf(':'); props.onImageModelChange({ provider: id.slice(0, at) as EditorImageModel['provider'], model: id.slice(at + 1) }); }} disabled={busy} /></div>}
    {props.error && <p role="alert" className="scriptor-ai-error" data-testid="scriptor-ai-error">{t(props.error)}</p>}
    {!!props.warnings.length && <div className="scriptor-ai-warnings">{props.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    {props.image && <figure className="scriptor-ai-image-preview" data-testid="scriptor-ai-image-preview"><img src={props.image.dataUrl} alt={props.imagePrompt} /><figcaption>{props.image.provider} · {props.image.model}</figcaption></figure>}
    {(busy || review || props.status === 'image-ready') && <div className="scriptor-ai-decisions">
      {busy ? <><Spinner label={t(props.mode === 'image' ? 'Generando imagen…' : 'Mejorando texto…')} /><button type="button" data-testid="study-improve-cancel" onClick={props.onCancel}>{t('Cancelar')}</button></> : review ? <><button type="button" data-testid="scriptor-ai-regenerate" onClick={props.onSubmit}>{t('Volver a generar')}</button><button type="button" data-testid="scriptor-ai-reject" onClick={props.onReject}>{t('Rechazar')}</button><button type="button" className="scriptor-ai-primary" data-testid="scriptor-ai-accept" onClick={props.onAccept}><Icon name="check" size={14} />{t('Aceptar')}</button></> : <><button type="button" data-testid="scriptor-ai-regenerate-image" onClick={props.onSubmit}>{t('Regenerar')}</button><button type="button" onClick={props.onReject}>{t('Descartar')}</button><button type="button" className="scriptor-ai-primary" data-testid="scriptor-ai-insert" onClick={props.onInsert}>{t('Insertar')}</button></>}
    </div>}
    <form onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
      <div className="scriptor-ai-tools"><button type="button" aria-label={t('Herramientas')} aria-expanded={tools} disabled={busy || review} data-testid="scriptor-ai-tools" onClick={() => setTools(!tools)}><Icon name="sliders" size={17} /></button>{tools && <div className="scriptor-ai-tools-menu"><button type="button" onClick={() => { setTools(false); if (props.mode === 'image') props.onPolish(); else props.onImage(); }}><Icon name={props.mode === 'image' ? 'aiPolish' : 'image'} size={15} />{t(props.mode === 'image' ? 'Pulir' : 'Crear imagen con IA')}</button></div>}</div>
      <textarea ref={input} data-testid="scriptor-ai-input" rows={1} maxLength={props.mode === 'image' ? 8000 : 4000} disabled={busy} aria-label={t(props.mode === 'image' ? 'Describe la imagen…' : 'Instrucciones adicionales')} placeholder={t(props.mode === 'image' ? 'Describe la imagen…' : 'Haz que sea más claro…')} value={props.mode === 'image' ? props.imagePrompt : props.instructions} onChange={event => props.mode === 'image' ? props.onImagePromptChange(event.target.value) : props.onInstructionsChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && (props.mode === 'polish' || props.imageChoices.some(choice => choice.id === `${props.imageModel.provider}:${props.imageModel.model}` && !choice.disabled))) props.onSubmit(); } }} />
      <button type="submit" className="scriptor-ai-send" aria-label={t('Enviar')} data-testid="scriptor-ai-send" disabled={busy || (props.mode === 'image' && (!props.imagePrompt.trim() || !props.imageChoices.some(choice => choice.id === `${props.imageModel.provider}:${props.imageModel.model}` && !choice.disabled)))}><Icon name="arrowUp" size={17} /></button>
    </form>
  </section>;
}
