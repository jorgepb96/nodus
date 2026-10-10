import { useMemo, useRef, useState } from 'react';
import { summarizeResearchActivity, summarizeWebActivity, type ResearchActivity, type ResearchActivityLayer, type ResearchActivityLayerState, type ResearchActivityOperation, type ResearchActivityStatus, type ResearchWebPageOutcome, type ResearchWebView } from '@shared/researchActivity';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import nodusMark from '../assets/nodus-logo-violet.svg';
import zoteroMark from '../assets/nodus-logo-zotero.svg';
import './researchActivity.css';
import { isPhoneSurface } from '../mobileWeb/phoneLayout';
import { MobileSheet } from './MobileSheet';

const layers: Record<ResearchActivityLayer, [string, string]> = {
  scope: ['Fuentes autorizadas', 'filter'], ideas: ['Ideas', 'bulb'],
  profiles: ['Perfiles documentales', 'fileText'], nodus: ['Biblioteca Nodus', 'book'],
  zotero: ['Biblioteca Zotero', 'book'], context: ['Contexto documental', 'layers'],
  graph: ['Grafo', 'share'], attachments: ['Archivos adjuntos', 'copyText'],
  response: ['Respuesta', 'edit'], tools: ['Herramientas', 'settings'], web: ['Búsqueda web', 'globe'],
};
const operations: Record<ResearchActivityOperation, string> = {
  resolve: 'Delimitar fuentes', embed: 'Preparar búsqueda', lexical: 'Búsqueda léxica',
  semantic: 'Búsqueda semántica', search: 'Buscar en obras', expand: 'Ampliar pasajes',
  pages: 'Leer páginas', references: 'Consultar referencias', metadata: 'Consultar ficha',
  fulltext: 'Leer texto completo', read: 'Consultar contenido', write: 'Redactar respuesta',
  citations: 'Comprobar citas', execute: 'Ejecutar herramientas',
  plan: 'Planificar búsquedas', query: 'Consultar buscadores', results: 'Reunir resultados', fetch: 'Leer páginas',
  reformulate: 'Reformular búsquedas', select: 'Seleccionar evidencias', finish: 'Finalizar búsqueda web',
};
const pageOutcomes: Record<ResearchWebPageOutcome, string> = {
  read: 'Consultada', empty: 'Sin texto útil', blocked: 'Bloqueada', timeout: 'Tiempo agotado', too_large: 'Demasiado grande',
  unsupported: 'Formato no admitido', not_found: 'No encontrada', failed: 'No accesible', cancelled: 'Cancelada',
};
const finishReasons: Record<string, string> = {
  sufficient: 'Evidencia suficiente', limits: 'Límites alcanzados', deadline: 'Tiempo agotado', exhausted: 'Sin más fuentes útiles',
  not_needed: 'No era necesaria', unavailable: 'Búsqueda no disponible', disabled: 'Desactivada',
};

/** The label for a consulted page: its outcome, or how the attempt ended when the
 * page never produced one. Kept out of the render so the translation key is always
 * one of the table's own strings. */
const pageOutcomeLabel = (page: { outcome?: ResearchWebPageOutcome; status: ResearchActivityStatus }): string =>
  pageOutcomes[page.outcome ?? (page.status === 'cancelled' ? 'cancelled' : 'failed')];

/** The web step in detail: searches, results found (not read), pages actually
 * consulted, the evidence kept and how it ended. Found results are listed muted
 * and hollow; consulted pages carry a document mark and their read state. */
function WebSearchSection({ view }: { view: ResearchWebView }) {
  return <div className="research-web" data-testid="research-activity-web">
    {view.planning === 'active' && <p className="research-web-line"><span className="research-activity-spinner" aria-hidden="true"><Icon name="rotateCw" size={11} /></span>{t('Planificando búsquedas…')}</p>}
    {view.rounds.map(round => <section key={round.round} className="research-web-round" aria-label={round.round === 1 ? t('Búsqueda inicial') : tx('Búsqueda adicional {n}', { n: round.round - 1 })}>
      <h3>{round.round === 1 ? t('Búsqueda inicial') : tx('Búsqueda adicional {n}', { n: round.round - 1 })}</h3>
      {round.reformulating && <p className="research-web-line">{round.reformulating === 'active' ? t('Reformulando consultas…') : t('Consultas reformuladas')}</p>}
      {round.queries.length > 0 && <ul className="research-web-queries" aria-label={t('Consultas realizadas')}>
        {round.queries.map((query, index) => <li key={`${query.query}-${index}`} data-status={query.status}>
          <Icon name="search" size={11} /><span className="research-web-query">{query.query}</span>
          <span className="research-web-count">{query.status === 'active' ? '…' : query.status === 'failed' ? t('Error') : tx('{n} resultados', { n: query.results ?? 0 })}</span>
        </li>)}
      </ul>}
      {round.found !== undefined && <div className="research-web-found">
        <p><strong>{tx('{n} resultados encontrados', { n: round.found })}</strong> <span>{t('sin leer todavía')}</span></p>
        {round.foundItems.length > 0 && <ul aria-label={t('Resultados encontrados')}>{round.foundItems.slice(0, 5).map(item => <li key={item.url} title={item.url}>
          <span className="research-web-found-mark" aria-hidden="true" /><span className="research-web-title">{item.title || item.domain}</span><span className="research-web-domain">{item.domain}</span>
          <span className="research-web-tag found">{t('Encontrado')}</span>
        </li>)}</ul>}
      </div>}
      {round.pages.length > 0 && <ul className="research-web-pages" aria-label={t('Páginas consultadas')}>
        {round.pages.map(page => <li key={page.url} data-status={page.status} data-outcome={page.outcome ?? ''} title={page.url}>
          <Icon name="fileText" size={12} /><span className="research-web-title">{page.title || page.domain}</span><span className="research-web-domain">{page.domain}</span>
          {page.status === 'active' ? <span className="research-web-tag reading"><span className="research-activity-spinner" aria-hidden="true"><Icon name="rotateCw" size={10} /></span>{t('Leyendo…')}</span>
            : <span className={`research-web-tag ${page.outcome === 'read' ? 'consulted' : 'unread'}`}>{t(pageOutcomeLabel(page))}</span>}
        </li>)}
      </ul>}
      {round.evidence && <p className="research-web-line research-web-evidence"><Icon name="check" size={11} />{round.evidence.status === 'active' ? t('Seleccionando evidencias…')
        : tx('{passages} pasajes seleccionados de {sources} fuentes', { passages: round.evidence.passages, sources: round.evidence.sources })}</p>}
    </section>)}
    {view.finished && <p className={`research-web-line research-web-final ${view.finished.status}`}>
      {t('Búsqueda web finalizada')}{view.finished.reason ? ` · ${t(finishReasons[view.finished.reason] ?? 'Búsqueda web finalizada')}` : ''}
      {` · ${tx('{consulted} de {found} resultados consultados', { consulted: view.consulted, found: view.found })}`}
    </p>}
  </div>;
}

const statuses: Record<ResearchActivityStatus, string> = { active: 'En curso', completed: 'Completado', failed: 'Error', cancelled: 'Cancelado' };
const layerStates: Record<ResearchActivityLayerState, string> = {
  idle: 'Sin consultar', active: 'Consultando…', completed: 'Consultado', empty: 'Sin resultados', failed: 'Error', cancelled: 'Cancelado',
};

function LayerIcon({ layer }: { layer: ResearchActivityLayer }) {
  if (layer === 'nodus' || layer === 'zotero') return <img src={layer === 'nodus' ? nodusMark : zoteroMark} alt="" className={`research-activity-brand ${layer}`} />;
  return <Icon name={layers[layer][1]} size={15} />;
}

/** A fixed list of every layer a research turn can consult, in flow order. Each row is
 * this request's live state for that layer: a turning arrow while it is being consulted,
 * then green when it contributed, orange when it answered with nothing and the flow had
 * to rely on another layer, red when its attempt failed. A new request starts over.
 * The panel only minimises to its radar; it is never closed. A layer switched off in the
 * context balloon reads "Desactivada" rather than "Sin consultar". */
export function ResearchActivityPanel({ activities, outcome, webDisabled = false, disabledLayers = [] }: {
  activities: ResearchActivity[]; outcome: ResearchActivityStatus; webDisabled?: boolean; disabledLayers?: readonly ResearchActivityLayer[];
}) {
  const phone = isPhoneSurface();
  const [minimized, setMinimized] = useState(() => phone || localStorage.getItem('nodus.researchActivityMinimized') === '1');
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rows = useMemo(() => summarizeResearchActivity(activities), [activities]);
  const web = useMemo(() => summarizeWebActivity(activities), [activities]);
  const active = activities.filter(item => item.status === 'active');
  const current = active.at(-1) ?? activities.at(-1);
  const toggle = () => {
    setMinimized(value => {
      if (!phone) localStorage.setItem('nodus.researchActivityMinimized', value ? '0' : '1');
      return !value;
    });
    requestAnimationFrame(() => toggleRef.current?.focus());
  };
  const off = (layer: ResearchActivityLayer) => layer === 'web' ? webDisabled : disabledLayers.includes(layer);
  if (!activities.length) return null;
  const status = outcome === 'active' ? tx('{n} operaciones activas', { n: active.length }) : t(statuses[outcome]);
  const announcement = `${status}${current ? ` · ${t(layers[current.layer][0])} · ${t(operations[current.operation])}` : ''}`;
  const panel = <section className={`research-activity ${minimized ? 'is-minimized' : ''} ${web && !minimized ? 'has-web' : ''}`} aria-label={t('Actividad del Research chat')} data-testid="research-activity" data-outcome={outcome} onKeyDown={event => {
    if (event.key === 'Escape' && !minimized) { event.stopPropagation(); toggle(); }
  }}>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {minimized ? <button ref={toggleRef} className="research-activity-orb" onClick={toggle} aria-label={t('Ampliar actividad')} aria-expanded={false} title={announcement}>
      {/* The radar itself carries the request's state: it sweeps while the request runs,
          then turns green when it completed, red when it failed and grey when cancelled. */}
      <span className={`research-activity-radar ${outcome}`} aria-hidden="true"><Icon name="radar" size={20} /></span>
    </button> : <>
      <header><div><h2>{t('Actividad del Research chat')}</h2><p>{status}</p></div>
        <button ref={toggleRef} onClick={toggle} aria-label={t('Minimizar actividad')} aria-expanded={true} title={t('Minimizar actividad')}><Icon name="minus" size={16} /></button>
      </header>
      <ol>
        {rows.map(row => {
          const switchedOff = row.state === 'idle' && off(row.layer);
          const detail = [row.operation && `${t(operations[row.operation])}${row.count !== undefined ? ` · ${row.count}` : ''}`, row.subject].filter(Boolean).join(' — ');
          return <li key={row.layer} data-status={row.state} data-layer={row.layer} data-off={switchedOff || undefined} className={row.layer === 'web' && web ? 'has-detail' : undefined}>
          <span className="research-activity-icon" aria-hidden="true"><LayerIcon layer={row.layer} /></span>
          <div className="research-activity-copy"><div className="research-activity-heading"><strong>{t(layers[row.layer][0])}</strong><span className="research-activity-state">{switchedOff ? t('Desactivada') : t(layerStates[row.state])}</span></div>
            {row.layer === 'web' && web ? <details className="research-web-disclosure">
              <summary>{t('Ver detalles')}</summary>
              <WebSearchSection view={web} />
            </details> : detail && <p title={detail}>{detail}</p>}
          </div>
          {row.state === 'active'
            ? <span className="research-activity-spinner" aria-hidden="true"><Icon name="rotateCw" size={13} /></span>
            : <span className={`research-activity-indicator ${switchedOff ? 'off' : row.state}`} aria-hidden="true" />}
        </li>;
        })}
      </ol>
    </>}
  </section>;
  return phone && !minimized
    ? <MobileSheet title={t('Actividad del Research chat')} className="research-activity-sheet" onClose={() => setMinimized(true)}>{panel}</MobileSheet>
    : panel;
}
