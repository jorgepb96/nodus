import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { ResearchExplorationMode } from '@shared/researchExploration';
import { t } from '../i18n';
import './researchExploration.css';

/** Hover and keyboard help stays outside scrolling toolbars and generation forms. */
function ExplorationOption({ mode, active, setActive, description, children }: {
  mode: ResearchExplorationMode; active: ResearchExplorationMode | null; setActive: Dispatch<SetStateAction<ResearchExplorationMode | null>>;
  description: string; children: (descriptionId: string) => ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLLabelElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const open = active === mode;
  const [style, setStyle] = useState<CSSProperties>({});
  const [light, setLight] = useState(false);
  const show = () => { clearTimeout(timer.current); setActive(mode); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setActive(current => current === mode ? null : current), 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const element = anchor.current, panel = tooltip.current;
      if (!element || !panel) return;
      const rect = element.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 24);
      const above = window.innerHeight - rect.bottom < panel.offsetHeight + 16 && rect.top > panel.offsetHeight + 16;
      setLight(!!element.closest('.light, .nodi-theme-light'));
      setStyle({ width, left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(above ? rect.top - panel.offsetHeight - 8 : rect.bottom + 8, window.innerHeight - panel.offsetHeight - 12)),
        '--research-exploration-accent': document.documentElement.classList.contains('theme-active') ? 'var(--a-500)'
          : getComputedStyle(element).getPropertyValue('--research-exploration-accent').trim() } as CSSProperties);
    };
    place();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { clearTimeout(timer.current); setActive(null); } };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', escape); };
  }, [open, setActive]);
  return <label ref={anchor} className="research-exploration-option" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
    {children(id)}
    <span id={id} className="sr-only">{description}</span>
    {/* The input's description also works when the visual tooltip is dismissed. */}
    {open && createPortal(<span ref={tooltip} role="tooltip" className={`research-exploration-tooltip${light ? ' is-light' : ''}`} style={style}
      onMouseEnter={show} onMouseLeave={hide}>{description}</span>, document.body)}
  </label>;
}

/** A two-option switch, shared by the chat toolbar and the three generation forms. */
export function ResearchExplorationControl({ value, onChange, disabled = false }: {
  value: ResearchExplorationMode; onChange: (value: ResearchExplorationMode) => void; disabled?: boolean;
}) {
  const name = useId();
  const [help, setHelp] = useState<ResearchExplorationMode | null>(null);
  return <div className="research-exploration-control" role="radiogroup" aria-label={t('Amplitud de investigación')}
    aria-disabled={disabled} data-testid="research-exploration-control">
    <ExplorationOption mode="fast" active={help} setActive={setHelp} description={`${t('Búsquedas centradas y menos lecturas, con margen para resolver dudas importantes.')} ${t('Suele responder antes y consumir menos.')}`}>
      {id => <><input className="sr-only" type="radio" name={name} value="fast" aria-label={t('Rápido')} aria-describedby={id} checked={value === 'fast'} disabled={disabled}
        onChange={() => onChange('fast')} /><span>{t('Rápido')}</span></>}
    </ExplorationOption>
    <ExplorationOption mode="expanded" active={help} setActive={setHelp} description={`${t('Más margen para explorar preguntas relacionadas, contrastar y conectar fuentes.')} ${t('Puede necesitar más tiempo y consumo.')}`}>
      {id => <><input className="sr-only" type="radio" name={name} value="expanded" aria-label={t('Ampliado')} aria-describedby={id} checked={value === 'expanded'} disabled={disabled}
        onChange={() => onChange('expanded')} /><span>{t('Ampliado')}</span></>}
    </ExplorationOption>
  </div>;
}
