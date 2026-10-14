import { academicPreparationSummary } from '../academicInterfaceGuideState';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { selectorPanelMotion } from './selectorMotion';
import type { AcademicInterfaceProfile, AppSettings } from '@shared/types';
import type { ResearchPreparationInventory, ResearchPreparationPolicy, ResearchPreparationProgress } from '@shared/researchCorpus';
import { ACADEMIC_GUIDE_VERSION, ACADEMIC_INTERFACE_PROFILES, academicProfileLabel } from '../academicInterfaceProfiles';
import { useDataRefresh } from '../hooks';
import { t, tx } from '../i18n';
import type { View } from '../navigation';
import { Icon } from './ui';
import { ThemePalettePicker } from './ThemePalettePicker';
import { PROMPT_LANGUAGE_OPTIONS } from '@shared/promptLanguageOptions';
import { openResearchPreparationQueue } from './ResearchPreparationWelcome';
import './academicInterface.css';
import simpleIllustration from '../assets/academic-interface/simple.webp';
import intermediateIllustration from '../assets/academic-interface/intermediate.webp';
import advancedIllustration from '../assets/academic-interface/advanced.webp';
import customIllustration from '../assets/academic-interface/custom.webp';

const PROFILE_ILLUSTRATIONS: Record<AcademicInterfaceProfile, string> = {
  simple: simpleIllustration, intermediate: intermediateIllustration,
  advanced: advancedIllustration, custom: customIllustration,
};

const INTERFACE_TABS = [
  { id: 'profiles', label: 'Perfiles', icon: 'monitor' },
  { id: 'theme', label: 'Tema', icon: 'palette' },
  { id: 'languages', label: 'Idiomas', icon: 'globe' },
  { id: 'nodi', label: 'Nodi', icon: 'sparkles' },
] as const;
type InterfaceTab = typeof INTERFACE_TABS[number]['id'];
const UI_LANGUAGES = [
  ['es', 'Español'], ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'],
  ['pt', 'Português (Portugal)'], ['pt-BR', 'Português (Brasil)'], ['it', 'Italiano'],
  ['tr', 'Türkçe'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'],
] as const;

export function AcademicInterfacePicker({ open, anchorEl, settings, profile, onSelect, onClose, onGuide, onUpdate, onSettings }: {
  open: boolean;
  anchorEl: HTMLElement | null;
  settings: AppSettings;
  profile?: AcademicInterfaceProfile;
  onSelect: (profile: AcademicInterfaceProfile) => Promise<void>;
  onClose: () => void;
  onGuide: () => void;
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
  onSettings: (target: 'appearance' | 'nodi') => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [present, setPresent] = useState(false);
  const [tab, setTab] = useState<InterfaceTab>('profiles');
  const guidedTab = useRef<InterfaceTab|null>(null);
  useEffect(() => {
    const openTab = (event: Event) => {
      const tab = (event as CustomEvent<{tab:InterfaceTab}>).detail?.tab;
      if (INTERFACE_TABS.some(item => item.id === tab)) { guidedTab.current=open?null:tab; setTab(tab); }
    };
    window.addEventListener('nodus:interface-tab', openTab);
    return () => window.removeEventListener('nodus:interface-tab', openTab);
  }, [open]);
  const [position, setPosition] = useState({ left: 16, top: 52, width: 520, originX: 260 });
  const systemReducedMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    if (!open) {
      // Saving temporarily disables the focused control, which can leave focus on body.
      if (dialog.current?.contains(document.activeElement) || document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
      return;
    }
    setPresent(true); setBusy(false); setError(''); setTab(guidedTab.current ?? 'profiles'); guidedTab.current=null;
    trigger.current = anchorEl ?? document.activeElement as HTMLElement | null;
    const place = () => {
      const bounds = anchorEl?.getBoundingClientRect();
      const width = Math.min(520, window.innerWidth - 32);
      const center = bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2;
      const left = Math.max(16, Math.min(center - width / 2, window.innerWidth - width - 16));
      setPosition({ left, top: (bounds?.bottom ?? 44) + 8, width, originX: center - left });
    };
    place();
    // A popover must leave the header interactive: showModal makes its triggers inert.
    if (!dialog.current?.open) dialog.current?.show();
    const observer = new ResizeObserver(place);
    if (anchorEl) observer.observe(anchorEl);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchorEl]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || dialog.current?.contains(target) || anchorEl?.contains(target)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [open, anchorEl, onClose]);
  useEffect(() => () => { dialog.current?.close(); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const patch = (value: Partial<AppSettings>) => void run(() => onUpdate(value));
  const changeTab = (next: InterfaceTab) => {
    setTab(next); setError('');
    dialog.current?.querySelector('.academic-interface-content')?.scrollTo(0, 0);
  };
  if (!open && !present) return null;
  return createPortal(<dialog ref={dialog} data-testid="academic-interface-picker" data-browser-native-overlay="true" className="academic-interface-dialog" style={{ left: position.left, top: position.top, width: position.width }} role="dialog" aria-modal="false" aria-hidden={!open} aria-busy={busy} aria-labelledby="academic-interface-title" onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <AnimatePresence onExitComplete={() => { dialog.current?.close(); setPresent(false); }}>
    {open && <motion.div className="academic-interface-panel" {...selectorPanelMotion(settings.reduceMotion || Boolean(systemReducedMotion))} style={{ transformOrigin: `${position.originX}px top`, maxHeight: `calc(100vh - ${position.top + 16}px)` }}>
    <div className="academic-interface-heading flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
      <div className="min-w-0"><h2 id="academic-interface-title" className="text-sm font-semibold">{t('Interfaz')}</h2><p className="mt-0.5 text-[11px] leading-4 text-neutral-500">{t('Personaliza tu espacio de trabajo.')}</p></div>
      <button type="button" className="btn btn-ghost shrink-0 px-2 py-1" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={16} /></button>
    </div>
    <div className="academic-interface-tabs" role="tablist" aria-label={t('Interfaz')}>
      {INTERFACE_TABS.map((item, index) => <button key={item.id} id={`interface-tab-${item.id}`} data-testid={`interface-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="academic-interface-tabpanel" tabIndex={tab === item.id ? 0 : -1} disabled={busy} onClick={() => changeTab(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % INTERFACE_TABS.length : event.key === 'ArrowLeft' ? (index + INTERFACE_TABS.length - 1) % INTERFACE_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? INTERFACE_TABS.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); changeTab(INTERFACE_TABS[next].id);
        dialog.current?.querySelector<HTMLElement>(`#interface-tab-${INTERFACE_TABS[next].id}`)?.focus();
      }}><Icon name={item.icon} size={14} /><span>{item.id === 'nodi' ? 'Nodi' : t(item.label)}</span></button>)}
    </div>
    <div className="academic-interface-content" id="academic-interface-tabpanel" role="tabpanel" aria-labelledby={`interface-tab-${tab}`}>
    {tab === 'profiles' && <div className="academic-profile-list">
      <p className="academic-interface-hint">{t('Elige qué herramientas quieres tener a mano.')}</p>
      {ACADEMIC_INTERFACE_PROFILES.map(item => <button type="button" key={item.id} data-testid={`academic-profile-${item.id}`} className="academic-profile-option" aria-pressed={item.id === (profile ?? 'custom')} disabled={busy} onClick={() => void run(() => onSelect(item.id))}>
        <span className="academic-profile-icon"><Icon name={item.icon} size={15} /></span>
        <span className="academic-profile-copy"><strong>{t(item.label)}</strong><span className="academic-profile-description">{t(item.description)}</span><small>{item.tools.split(' · ').map(part => t(part)).join(' · ')}</small></span>
        <span className={`academic-profile-art academic-profile-art-${item.id}`} aria-hidden="true">
          <img className="academic-profile-illustration" src={PROFILE_ILLUSTRATIONS[item.id]} alt="" width="140" height="72" />
        </span>
        {item.id === (profile ?? 'custom') ? <Icon name="check" size={15} className="academic-profile-check" /> : <span aria-hidden="true" />}
      </button>)}
    </div>}
    {tab === 'theme' && <div className="academic-interface-controls">
      <section className="academic-interface-control-group"><h3>{t('Modo de color')}</h3><p className="academic-interface-hint">{t('Elige entre modo claro, oscuro o seguir el sistema operativo.')}</p>
        <div className="academic-color-modes">{([{ id: 'light', label: 'Claro', icon: 'sun' }, { id: 'dark', label: 'Oscuro', icon: 'moon' }, { id: 'system', label: 'Sistema', icon: 'monitor' }] as const).map(mode => <button type="button" key={mode.id} data-testid={`interface-theme-${mode.id}`} aria-pressed={settings.theme === mode.id} disabled={busy} onClick={() => patch({theme: mode.id})}><Icon name={mode.icon} size={16} />{t(mode.label)}</button>)}</div>
      </section>
      <section className="academic-interface-control-group"><h3>{t('Paleta de colores')}</h3><ThemePalettePicker value={settings.appTheme} customThemes={settings.customThemes ?? []} disabled={busy} onSelect={appTheme => patch({appTheme, customThemes: settings.customThemes ?? []})} testId="interface-theme-picker" />
        <button type="button" className="academic-guide-link mt-2" disabled={busy} onClick={() => onSettings('appearance')}><Icon name="settings" size={13} />{t('Crear o editar temas')}</button>
      </section>
      <section className="academic-interface-control-group academic-interface-options">
        <label><span>{t('Usar la misma paleta en todas las bóvedas')}</span><input data-testid="interface-share-theme" type="checkbox" checked={settings.shareAppThemeAcrossVaults} disabled={busy} onChange={event => patch({shareAppThemeAcrossVaults: event.target.checked})} /></label>
        <label><span>{t('Reducir animaciones')}</span><input data-testid="interface-reduce-motion" type="checkbox" checked={settings.reduceMotion} disabled={busy} onChange={event => patch({reduceMotion: event.target.checked})} /></label>
      </section>
    </div>}
    {tab === 'languages' && <div className="academic-interface-controls">
      <section className="academic-interface-control-group"><label htmlFor="interface-ui-language">{t('Idioma de la interfaz')}</label><select id="interface-ui-language" className="input w-full" disabled={busy} value={settings.uiLanguage} onChange={event => patch({uiLanguage: event.target.value as AppSettings['uiLanguage']})}>{UI_LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></section>
      <section className="academic-interface-control-group"><label htmlFor="interface-prompt-language">{t('Idioma de los prompts (idioma de las ideas generadas)')}</label><select id="interface-prompt-language" className="input w-full" disabled={busy} value={settings.promptLanguage} onChange={event => patch({promptLanguage: event.target.value as AppSettings['promptLanguage']})}>{PROMPT_LANGUAGE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><p className="academic-interface-hint">{t('El idioma de los prompts determina en qué idioma la IA genera ideas, temas, narrativa del tutor y borradores. Las citas textuales siempre conservan el idioma original de la fuente.')}</p></section>
    </div>}
    {tab === 'nodi' && <div className="academic-interface-controls">
      <section className="academic-interface-control-group"><h3 className="flex items-center gap-2"><Icon name="sparkles" size={18} />Nodi</h3><p className="academic-interface-hint">{t('Nodi es el nodo que acompaña la app, flotando abajo a la derecha. Haz clic en Nodi para abrir el chat, tus notificaciones y la ayuda.')}</p><label className="academic-nodi-toggle"><span>{t('Mostrar a Nodi')}</span><input data-testid="interface-nodi-enabled" type="checkbox" checked={settings.mascotEnabled} disabled={busy} onChange={event => patch({mascotEnabled: event.target.checked})} /></label>
      </section>
      <button type="button" className="academic-guide-link" disabled={busy} onClick={() => onSettings('nodi')}><Icon name="settings" size={13} />{t('Más ajustes de Nodi')}</button>
    </div>}
    </div>
    {error && <p role="alert" className="px-3 pb-2 text-xs text-red-500">{error}</p>}
    {tab === 'profiles' && <div className="academic-interface-footer border-t border-neutral-800 p-2"><button type="button" className="btn btn-ghost w-full text-xs" disabled={busy} onClick={onGuide}><Icon name="info" size={14} />{t('Cómo empezar con este perfil')}</button></div>}
    </motion.div>}
    </AnimatePresence>
  </dialog>, document.querySelector('[data-testid="app-shell"]') ?? document.body);
}

type GuideStep = { title: string; body: string; view?: View; action?: string };
export function AcademicInterfaceGuide({ settings, vaultId, progress, onNavigate, onLibrary, onCustomize, onModels, onClose }: {
  settings: AppSettings; vaultId: string; progress: ResearchPreparationProgress; onNavigate: (view: View) => void;
  onLibrary: (scope: 'vault' | 'global') => void; onCustomize: () => void; onModels: () => void; onClose: () => void;
}) {
  const profile = settings.academicInterfaceProfile ?? 'custom';
  const manual = settings.academicMode === 'manual';
  const [inventory, setInventory] = useState<ResearchPreparationInventory | null>(null);
  const [policy, setPolicy] = useState<ResearchPreparationPolicy | null>(null);
  const generation = useRef(0);
  const refresh = async () => {
    const request = ++generation.current;
    try {
      const [nextInventory, nextPolicy] = await Promise.all([window.nodus.getResearchPreparationInventory(), window.nodus.getResearchPreparationPolicy()]);
      if (request === generation.current && nextPolicy.vaultId === vaultId) { setInventory(nextInventory); setPolicy(nextPolicy); }
    } catch { /* Keep the guide usable while preparation reconnects. */ }
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    void refresh();
    let signature = '';
    const off = window.nodus.onResearchPreparationProgress(next => {
      const nextSignature = JSON.stringify([next.paused, next.campaigns.filter(campaign => campaign.vaultId === vaultId).map(campaign => campaign.jobs.map(job => [job.documentId, job.state, job.error]))]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refresh(); }, 150);
    });
    return () => { generation.current++; if (timer) clearTimeout(timer); off(); };
  }, [vaultId, settings.embeddingProvider, settings.embeddingModel]);
  useDataRefresh(refresh);
  const { total, ready, failed, pending, paused, noModel } = academicPreparationSummary(inventory, progress, vaultId);
  const preparation = !inventory ? t('Comprobando fuentes…') : !total ? t('Añade obras a este vault para empezar.')
    : noModel ? t('Configura un modelo de embeddings para preparar tus fuentes.')
    : tx('{ready} de {total} fuentes listas para consultar.', { ready, total });
  const stateAction = !total ? () => onLibrary('vault') : noModel ? onModels : ready === total ? () => onNavigate('researchChat') : pending || failed ? openResearchPreparationQueue : () => onLibrary('vault');
  const stateLabel = !total ? 'Añade obras' : noModel ? 'Configurar modelo' : ready === total ? 'Abrir Research chat' : pending || failed ? 'Ver progreso' : 'Preparar fuentes';
  let steps: GuideStep[];
  if (profile === 'simple') steps = [
    { title: 'Añade obras', body: 'Añádelas a Este vault, o guárdalas en Global y elige cuáles incorporar aquí.', view: 'library', action: 'Abrir Biblioteca' },
    { title: 'Prepara tus fuentes', body: 'La indexación prepara el texto de tus obras para consultarlo en el chat.' },
    { title: 'Pregunta y comprueba', body: 'Haz preguntas en Research chat y abre las citas para revisar la fuente.', view: 'researchChat', action: 'Abrir Research chat' },
  ];
  else if (profile === 'intermediate') steps = [
    { title: 'Reúne y prepara fuentes', body: 'Elige las obras de este vault y sigue su preparación en Cola y tareas.', view: 'library', action: 'Abrir Biblioteca' },
    { title: manual ? 'Crea tus ideas' : 'Extrae ideas', body: manual ? 'Crea ideas, vincula obras y añade citas y relaciones a tu ritmo.' : 'En Este vault, selecciona obras y pulsa Extraer ideas. Revisa después su evidencia.', view: manual ? 'ideas' : 'library', action: manual ? 'Abrir Ideas' : 'Abrir Biblioteca' },
    { title: 'Explora y profundiza', body: 'Explora Ideas, Autores, Grafo y Mapa de argumentos. Profundiza con Deep Research.', view: 'ideas', action: 'Abrir Ideas' },
  ];
  else if (profile === 'advanced') steps = [
    { title: 'Define tu pregunta', body: 'Reúne un corpus relevante y prepara las fuentes que necesitas.', view: 'library', action: 'Abrir Biblioteca' },
    { title: 'Contrasta la evidencia', body: manual ? 'Crea ideas, vincula obras y añade citas y relaciones a tu ritmo.' : 'Contrasta argumentos y explora Estado de la cuestión, Hipótesis y Ruta de lectura.', view: manual ? 'ideas' : 'research', action: manual ? 'Abrir Ideas' : 'Estado de la cuestión' },
    { title: 'Desarrolla tu trabajo', body: 'Profundiza con Deep Research y organiza tus notas y borradores en Scriptor.', view: 'workspace', action: 'Nodus Scriptor' },
  ];
  else steps = [
    { title: 'Elige las secciones', body: 'Muestra u oculta las secciones desde Ajustes → Interfaz → Barra lateral.' },
    { title: 'Ordénalas a tu manera', body: 'Arrastra las entradas o usa las flechas dentro de cada sección. Inicio y Ajustes mantienen su posición.' },
    { title: 'Vuelve al trabajo', body: 'Puedes cambiar el perfil o recuperar esta guía desde el selector de interfaz.', view: 'researchChat', action: 'Abrir Research chat' },
  ];
  return <section className="academic-interface-guide" data-testid="academic-interface-guide" aria-label={t('Cómo empezar')}>
    <div className="flex items-center justify-between gap-2"><strong className="text-sm">{t('Cómo empezar')} · {t(academicProfileLabel(profile))}</strong><button className="btn btn-ghost" aria-label={t('Cerrar guía')} onClick={onClose}><Icon name="x" size={14} /></button></div>
    <ol className="academic-guide-steps">{steps.map((step, index) => <li key={index}><span className="academic-guide-number">{index + 1}</span><div><strong>{t(step.title)}</strong><p>{t(step.body)}</p>{step.view && <button className="academic-guide-link" onClick={() => step.view === 'library' ? onLibrary('vault') : onNavigate(step.view!)}>{t(step.action!)} <Icon name="arrowRight" size={12} /></button>}{profile === 'custom' && index < 2 && <button className="academic-guide-link" onClick={onCustomize}>{t('Personalizar interfaz')}</button>}{profile === 'simple' && index === 0 && <button className="academic-guide-link ml-2" onClick={() => onLibrary('global')}>{t('Biblioteca global')}</button>}</div></li>)}</ol>
    {profile !== 'custom' && <div className="academic-guide-status"><span role="status">{preparation}{paused && ` ${t('Indexación en pausa')}`}{failed > 0 && ` ${tx('{n} fuentes requieren revisión.', { n: failed })}`}{policy?.futureAdditions === false && ` ${t('La indexación automática está desactivada. Iníciala desde Biblioteca.')}`}</span><button className="academic-guide-link shrink-0" onClick={stateAction}>{t(stateLabel)}</button></div>}
    {profile !== 'custom' && <p className="academic-guide-note">{t(manual ? 'Indexar permite consultar las fuentes. En trabajo Manual, tú creas las ideas y sus relaciones.' : 'Indexar permite consultar las fuentes; extraer ideas alimenta las vistas de análisis.')}</p>}
  </section>;
}

export { ACADEMIC_GUIDE_VERSION };
