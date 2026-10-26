import {useEffect, useRef} from 'react';
import {Icon} from '../components/ui';
import {t, tx} from '../i18n';
import type {StellarGraphTabDescriptor} from './snapshot';

/** The graph keeps its canvas state; only its tab chrome adapts to the phone. */
export function StellarTabsHeader({tabs, active, tabsId, tabName, onActivate, onClose, onAdd, fullscreen, onFullscreen}: {
  tabs: StellarGraphTabDescriptor[];
  active: number;
  tabsId: string;
  tabName: (tab: StellarGraphTabDescriptor) => string;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  onAdd: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  const tabStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const reveal = () => {
      const tab = strip.querySelector<HTMLElement>('[aria-selected="true"]')?.closest('.stellar-tab');
      if (!tab) return;
      const item = tab.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
      // Move only this row, including its close button. scrollIntoView can
      // scroll the canvas's outer containers when a phone changes orientation.
      const delta = item.left < bounds.left ? item.left - bounds.left : item.right > bounds.right ? item.right - bounds.right : 0;
      if (delta) strip.scrollLeft += delta;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [active, tabs]);
  return <div className="stellar-tabs-header">
      <div className="stellar-tabs" ref={tabStrip} role="tablist" aria-label={t("Grafos abiertos")}>
        {tabs.map(tab => <div className={`stellar-tab ${active === tab.id ? "active" : ""}`} key={tab.id}>
          <button role="tab" id={`${tabsId}-tab-${tab.id}`} aria-controls={`${tabsId}-panel-${tab.id}`} aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1} onClick={() => onActivate(tab.id)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex(item => item.id === tab.id);
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              onActivate(tabs[next].id); document.getElementById(`${tabsId}-tab-${tabs[next].id}`)?.focus();
            }} title={tabName(tab)}><Icon name={tab.mode === "themes" ? "layers" : "map"} size={14} /><span>{tabName(tab)}</span></button>
          {tab.id !== tabs[0].id && <button className="stellar-tab-close" aria-label={tx("Cerrar grafo {n}", { n: tab.id })} onClick={() => onClose(tab.id)}>×</button>}
        </div>)}
      </div>
      {tabs.length > 1 && <label className="stellar-tab-picker library-workspace-tab-picker">
        <span aria-hidden="true"><Icon name="layers" size={14} />{tabs.length}</span>
        <select aria-label={t("Grafos abiertos")} data-testid="stellar-open-tabs" value={active}
          onChange={event => onActivate(Number(event.currentTarget.value))}>
          {tabs.map(tab => <option key={tab.id} value={tab.id}>{tabName(tab)}</option>)}
        </select>
      </label>}
      <button className="stellar-new-tab" onClick={onAdd} title={t("Nuevo grafo")} aria-label={t("Nuevo grafo")}><Icon name="plus" size={18} /></button>
      <button className="stellar-fullscreen" onClick={onFullscreen} aria-pressed={fullscreen} aria-label={t(fullscreen ? "Salir de pantalla completa" : "Pantalla completa")} title={t(fullscreen ? "Salir de pantalla completa" : "Pantalla completa")}>
        <Icon name={fullscreen ? "minimize" : "maximize"} size={15} /><span>{t(fullscreen ? "Salir de pantalla completa" : "Pantalla completa")}</span>
      </button>
    </div>;
}
