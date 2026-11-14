import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseColumn, DatabaseRow } from '@shared/databases';
import type { DatabaseSavedView } from '@shared/databaseFilters';
import type { FilterNode } from '@shared/databaseQuery';
import type { DatabaseChartViewConfig, DatabaseDashboardViewConfig, DatabaseFeedViewConfig, DatabaseMapViewConfig } from '@shared/databaseViewConfig';
import {
  clusterDatabaseMapMarkersForViewport,
  renderDatabaseChartSvg,
  type DatabaseChartPoint,
  type DatabaseChartResult,
  type DatabaseFeedResult,
  type DatabaseMapResult,
} from '@shared/databaseVisualization';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import { toast } from './feedback';

type CommonProps = { databaseId: string; columns: DatabaseColumn[]; onOpen: (rowId: string) => void };
const PALETTE = ['#4f46e5','#db2777','#059669','#d97706','#7c3aed','#0891b2','#dc2626','#65a30d'];
const DASHBOARD_COLUMN_SPAN: Record<number, string> = {
  1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4', 5: 'lg:col-span-5', 6: 'lg:col-span-6',
  7: 'lg:col-span-7', 8: 'lg:col-span-8', 9: 'lg:col-span-9', 10: 'lg:col-span-10', 11: 'lg:col-span-11', 12: 'lg:col-span-12',
};

function titleOf(row: DatabaseRow, columns: DatabaseColumn[]): string {
  const title = columns.find((column) => column.type === 'title'); return (title ? row.cells[title.id] : '') || t('Sin título');
}

function mergeFilters(...filters: Array<FilterNode | null | undefined>): FilterNode | null {
  const valid = filters.filter((filter): filter is FilterNode => Boolean(filter));
  return valid.length === 0 ? null : valid.length === 1 ? valid[0] : { type: 'group', operator: 'and', children: valid };
}

function VisualizationStatus({ loading, error, truncated }: { loading: boolean; error: string | null; truncated?: boolean }) {
  return <>{loading && <div role="status" data-testid="database-visualization-loading" className="absolute inset-x-0 top-2 z-30 flex justify-center"><span className="rounded-full bg-white px-3 py-1 text-xs shadow dark:bg-neutral-900"><Icon name="sync" className="mr-1 inline animate-spin" />{t('Cargando visualización…')}</span></div>}
    {error && <div role="alert" data-testid="database-visualization-error" className="m-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
    {truncated && <div className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-center text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t('La visualización está acotada para mantener la interacción fluida.')}</div>}</>;
}

function ChartMarks({ points, type, onPoint }: { points: DatabaseChartPoint[]; type: DatabaseChartViewConfig['chart']['type']; onPoint: (point: DatabaseChartPoint) => void }) {
  const width = 900; const height = 420; const left = 58; const top = 20; const plotWidth = 820; const plotHeight = 330;
  const max = Math.max(1, ...points.map((point) => point.value)); const x = (index: number) => left + (index + .5) * plotWidth / Math.max(1, points.length);
  const y = (value: number) => top + plotHeight - Math.max(0, value) / max * plotHeight; const labelStep = Math.max(1, Math.ceil(points.length / 12));
  if (type === 'donut') {
    const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1; let offset = 0;
    return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto p-4 sm:flex-row" data-testid="database-chart-donut">
      <svg viewBox="0 0 320 320" className="h-64 w-64 shrink-0" role="group" aria-label={t('Gráfico donut')}>{points.map((point, index) => { const length = Math.max(0, point.value) / total * 100; const current = offset; offset += length;
        return <circle key={`${point.key}:${point.seriesKey}`} cx="160" cy="160" r="105" fill="none" stroke={PALETTE[index % PALETTE.length]} strokeWidth="58" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-current} transform="rotate(-90 160 160)" className="cursor-pointer focus:outline-none" role="button" tabIndex={0} aria-label={`${point.label}: ${point.value}`} onClick={() => onPoint(point)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onPoint(point); }}><title>{point.label}: {point.value}</title></circle>; })}</svg>
      <div className="grid max-h-64 min-w-56 gap-1 overflow-auto">{points.map((point, index) => <button key={`${point.key}:${point.seriesKey}`} className="flex min-h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={() => onPoint(point)}><span className="h-3 w-3 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} /><span className="min-w-0 flex-1 truncate">{point.label}</span><strong>{point.value.toLocaleString()}</strong></button>)}</div>
    </div>;
  }
  const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  return <div className="min-h-0 flex-1 overflow-auto p-3"><svg viewBox={`0 0 ${width} ${height}`} className="min-h-[300px] w-full min-w-[640px]" role="group" aria-label={t('Gráfico de base de datos')} data-testid="database-chart-svg">
    <line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} className="stroke-neutral-400" />
    {type === 'area' && <polygon points={`${left},${top + plotHeight} ${coordinates} ${left + plotWidth},${top + plotHeight}`} fill="#4f46e528" />}
    {(type === 'line' || type === 'area') && <polyline points={coordinates} fill="none" stroke="#4f46e5" strokeWidth="3" />}
    {points.map((point, index) => type === 'bar'
      ? <rect key={`${point.key}:${point.seriesKey}`} data-testid="chart-point" role="button" tabIndex={0} aria-label={`${point.label}: ${point.value}`} x={x(index) - Math.max(3, plotWidth / Math.max(1, points.length) * .35)} y={y(point.value)} width={Math.max(6, plotWidth / Math.max(1, points.length) * .7)} height={Math.max(1, top + plotHeight - y(point.value))} rx="3" fill={PALETTE[index % PALETTE.length]} className="cursor-pointer focus:outline-none focus:ring-2" onClick={() => onPoint(point)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onPoint(point); }}><title>{point.label}: {point.value}</title></rect>
      : <circle key={`${point.key}:${point.seriesKey}`} data-testid="chart-point" role="button" tabIndex={0} aria-label={`${point.label}: ${point.value}`} cx={x(index)} cy={y(point.value)} r={type === 'scatter' ? 7 : 5} fill={PALETTE[index % PALETTE.length]} className="cursor-pointer focus:outline-none" onClick={() => onPoint(point)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onPoint(point); }}><title>{point.label}: {point.value}</title></circle>)}
    {points.map((point, index) => index % labelStep === 0 && <text key={`label-${index}`} x={x(index)} y={height - 28} textAnchor="middle" className="fill-neutral-600 text-[11px] dark:fill-neutral-300">{point.label.slice(0, 18)}</text>)}
  </svg></div>;
}

export function DatabaseChartView({ databaseId, columns, config, onOpen, filterOverride = null, compact = false }: CommonProps & { config: DatabaseChartViewConfig | null; filterOverride?: FilterNode | null; compact?: boolean }) {
  const xColumn = config?.chart.xColumnId ? columns.find((column) => column.id === config.chart.xColumnId)
    : columns.find((column) => ['select','status','date','text','title','number'].includes(column.type));
  const yColumn = config?.chart.yColumnId ? columns.find((column) => column.id === config.chart.yColumnId)
    : columns.find((column) => column.type === 'number');
  const type = config?.chart.type ?? 'bar'; const aggregation = config?.chart.aggregation ?? 'count';
  const configError = Boolean(config?.chart.xColumnId && !xColumn) || Boolean(aggregation !== 'count' && config?.chart.yColumnId && !yColumn)
    ? t('La vista hace referencia a una propiedad que ya no existe.') : null;
  const [result, setResult] = useState<DatabaseChartResult | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<{ point: DatabaseChartPoint; rows: DatabaseRow[]; cursor: string | null; loading: boolean } | null>(null);
  const queryFilter = useMemo(() => mergeFilters(config?.filter, filterOverride), [config?.filter, filterOverride]);
  const load = useCallback(async () => { if (!xColumn || configError) return; setLoading(true); setError(null); try { setResult(await window.nodus.queryDatabaseChart({ databaseId,
    xColumnId: xColumn.id, yColumnId: aggregation === 'count' ? null : yColumn?.id ?? null, seriesColumnId: config?.chart.seriesColumnId ?? null,
    aggregation, type, filter: queryFilter, limit: compact ? 20 : 200 })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLoading(false); } },
  [aggregation, compact, config?.chart.seriesColumnId, configError, databaseId, queryFilter, type, xColumn, yColumn]);
  useEffect(() => { void load(); }, [load]);
  const openPoint = async (point: DatabaseChartPoint) => {
    setError(null);
    try{const page=await window.nodus.queryDatabaseRows({databaseId,filter:mergeFilters(queryFilter,point.drilldownFilter),limit:50});setDrilldown({point,rows:page.rows,cursor:page.nextCursor,loading:false});}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  };
  const loadMore = async () => {
    if(!drilldown?.cursor)return;const captured=drilldown;setError(null);setDrilldown({...captured,loading:true});
    try{const page=await window.nodus.queryDatabaseRows({databaseId,filter:mergeFilters(queryFilter,captured.point.drilldownFilter),cursor:captured.cursor,limit:50});setDrilldown(current=>current?.point===captured.point?{...captured,rows:[...captured.rows,...page.rows],cursor:page.nextCursor,loading:false}:current);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));setDrilldown(current=>current?.point===captured.point?{...current,loading:false}:current);}
  };
  const exportChart = async (format: 'svg' | 'png') => { if (!result) return; const title = `${t('Gráfico')} · ${xColumn?.name ?? ''}`;
    try {
      const exported = await window.nodus.exportDatabaseChart({ databaseId, title, format, svg: renderDatabaseChartSvg(title, result.points, type) });
      if (!exported.canceled) toast(tx('Gráfico exportado a {format}.', { format: format.toUpperCase() }));
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };
  if (configError) return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-chart-view"><VisualizationStatus loading={false} error={configError} /></section>;
  if (!xColumn) return <div className="grid min-h-0 flex-1 place-items-center p-8 text-sm text-neutral-500" data-testid="database-chart-empty-config">{t('Añade una propiedad para usar gráficos.')}</div>;
  return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-chart-view">
    {!compact && <div className="flex min-h-11 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800"><div className="min-w-0 flex-1"><strong className="text-sm">{xColumn.name}</strong><span className="ml-2 text-xs text-neutral-500">{t(type)} · {t(aggregation)}</span></div><button className="btn btn-ghost h-8" onClick={() => void exportChart('svg')}>SVG</button><button className="btn btn-ghost h-8" onClick={() => void exportChart('png')}>PNG</button></div>}
    <VisualizationStatus loading={loading} error={error} truncated={result?.truncated} />
    {result && result.points.length > 0 ? <ChartMarks points={result.points} type={type} onPoint={(point) => void openPoint(point)} /> : !loading && !error && <div className="grid flex-1 place-items-center text-sm text-neutral-500" data-testid="database-chart-empty">{t('No hay datos para este gráfico.')}</div>}
    {drilldown && <div className="absolute inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950" data-testid="database-chart-drilldown"><header className="flex items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800"><div className="min-w-0 flex-1"><strong className="block truncate">{drilldown.point.label}</strong><span className="text-xs text-neutral-500">{tx('{n} filas', { n: drilldown.point.rowCount })}</span></div><button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={() => setDrilldown(null)}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-auto">{drilldown.rows.map((row) => <button key={row.id} className="block min-h-11 w-full truncate border-b border-neutral-200 px-3 text-left text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900" onClick={() => onOpen(row.id)}>{titleOf(row, columns)}</button>)}</div>{drilldown.cursor && <button className="btn btn-ghost m-3" disabled={drilldown.loading} onClick={() => void loadMore()}>{t('Cargar más')}</button>}</div>}
  </section>;
}

export function DatabaseMapView({ databaseId, columns, config, onOpen, filterOverride = null, compact = false }: CommonProps & { config: DatabaseMapViewConfig | null; filterOverride?: FilterNode | null; compact?: boolean }) {
  const location = columns.find((column) => column.id === config?.locationColumnId && column.type === 'location') ?? columns.find((column) => column.type === 'location');
  const [result, setResult] = useState<DatabaseMapResult | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [expanded, setExpanded] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null); const [viewport, setViewport] = useState({ width: compact ? 480 : 1000, height: 500 });
  const queryFilter = useMemo(() => mergeFilters(config?.filter, filterOverride), [config?.filter, filterOverride]);
  useEffect(() => { if (!location) return; let canceled = false; setLoading(true); setError(null); void window.nodus.queryDatabaseMap({ databaseId, locationColumnId: location.id, filter: queryFilter, limit: 500 })
    .then((value) => { if (!canceled) setResult(value); }).catch((cause) => { if (!canceled) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (!canceled) setLoading(false); }); return () => { canceled = true; }; }, [databaseId, location, queryFilter]);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const update = () => setViewport({ width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) }); update(); const observer = new ResizeObserver(update); observer.observe(canvas); return () => observer.disconnect(); }, [result?.markers.length]);
  const clusters = useMemo(() => result ? clusterDatabaseMapMarkersForViewport(result.markers, viewport.width, viewport.height,
    expanded || config?.cluster === false ? 48 : compact ? 64 : 72) : [], [compact, config?.cluster, expanded, result, viewport.height, viewport.width]);
  if (!location) return <div className="grid min-h-0 flex-1 place-items-center p-8 text-sm text-neutral-500" data-testid="database-map-empty-config">{t('Añade una propiedad Ubicación para usar el mapa.')}</div>;
  return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-map-view"><VisualizationStatus loading={loading} error={error} truncated={result?.truncated} />
    {!compact && <div className="flex min-h-11 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800"><strong className="min-w-0 flex-1 truncate text-sm">{location.name}</strong><button className="btn btn-ghost h-8" onClick={() => setExpanded((value) => !value)}>{expanded ? t('Agrupar') : t('Separar marcadores')}</button></div>}
    {result && result.markers.length > 0 ? <div ref={canvasRef} className="relative min-h-[260px] flex-1 overflow-hidden bg-sky-50 dark:bg-slate-950" data-testid="database-map-canvas"><svg viewBox="0 0 1000 500" className="absolute inset-0 h-full w-full" aria-hidden="true"><defs><pattern id="map-grid" width="100" height="50" patternUnits="userSpaceOnUse"><path d="M100 0H0V50" fill="none" className="stroke-sky-200 dark:stroke-slate-800" /></pattern></defs><rect width="1000" height="500" fill="url(#map-grid)"/><path d="M80 135L180 80 265 115 290 205 225 255 145 230ZM365 70L470 55 535 130 505 220 420 260 350 190ZM570 110L690 70 805 125 910 105 940 205 850 280 710 245 625 285 555 205Z" className="fill-emerald-100 stroke-emerald-300 dark:fill-emerald-950 dark:stroke-emerald-800" /></svg>
      {clusters.map((cluster) => { const marker = result.markers.find((candidate) => candidate.id === cluster.markerIds[0])!; return <button key={cluster.id} data-testid="map-marker" className="absolute grid min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-indigo-600 px-2 text-xs font-bold text-white shadow-lg focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-900" style={{ left: `${(cluster.longitude + 180) / 360 * 100}%`, top: `${(90 - cluster.latitude) / 180 * 100}%` }} title={cluster.count > 1 ? tx('{n} ubicaciones', { n: cluster.count }) : marker.name} onClick={() => cluster.count === 1 ? onOpen(marker.rowId) : setExpanded(true)}>{cluster.count}</button>; })}</div>
      : !loading && !error && <div className="grid flex-1 place-items-center text-sm text-neutral-500" data-testid="database-map-empty">{t('No hay ubicaciones con coordenadas.')}</div>}
  </section>;
}

export function DatabaseFeedView({ databaseId, columns, config, onOpen, filterOverride = null, compact = false }: CommonProps & { config: DatabaseFeedViewConfig | null; filterOverride?: FilterNode | null; compact?: boolean }) {
  const date = columns.find((column) => column.id === config?.dateColumnId && column.type === 'date') ?? columns.find((column) => column.type === 'date');
  const [result, setResult] = useState<DatabaseFeedResult | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const queryFilter = useMemo(() => mergeFilters(config?.filter, filterOverride), [config?.filter, filterOverride]);
  useEffect(() => { let canceled = false; setLoading(true); setError(null); void window.nodus.queryDatabaseFeed({ databaseId, dateColumnId: date?.id ?? null,
    includePageChanges: config?.includePageChanges ?? true, filter: queryFilter, limit: compact ? 12 : 200 }).then((value) => { if (!canceled) setResult(value); })
    .catch((cause) => { if (!canceled) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (!canceled) setLoading(false); }); return () => { canceled = true; }; }, [compact, config?.includePageChanges, databaseId, date, queryFilter]);
  return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-feed-view"><VisualizationStatus loading={loading} error={error} truncated={result?.truncated} />
      <div className="min-h-0 flex-1 overflow-auto p-3"><div className="mx-auto max-w-3xl space-y-2">{result?.items.map((item) => <button key={item.id} data-testid="feed-item" className="flex min-h-16 w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left hover:border-indigo-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-indigo-800" onClick={() => onOpen(item.rowId)}><span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"><Icon name={item.kind === 'date' ? 'calendar' : item.kind === 'created' ? 'plus' : 'edit'} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.title}</strong><span className="block text-xs text-neutral-600 dark:text-neutral-400">{t(item.summary)} · {new Date(item.occurredAt).toLocaleString()}</span></span></button>)}{!loading && !error && (result?.items.length ?? 0) === 0 && <div className="grid h-40 place-items-center text-sm text-neutral-500" data-testid="database-feed-empty">{t('No hay actividad para mostrar.')}</div>}</div></div>
  </section>;
}

function DashboardMini({ databaseId, columns, view, globalFilter, onOpen }: CommonProps & { view: DatabaseSavedView; globalFilter: FilterNode | null }) {
  if (view.config.layout === 'chart') return <DatabaseChartView databaseId={databaseId} columns={columns} config={view.config} filterOverride={globalFilter} compact onOpen={onOpen} />;
  if (view.config.layout === 'map') return <DatabaseMapView databaseId={databaseId} columns={columns} config={view.config} filterOverride={globalFilter} compact onOpen={onOpen} />;
  if (view.config.layout === 'feed') return <DatabaseFeedView databaseId={databaseId} columns={columns} config={view.config} filterOverride={globalFilter} compact onOpen={onOpen} />;
  return <DashboardRowPreview databaseId={databaseId} columns={columns} view={view} globalFilter={globalFilter} onOpen={onOpen} />;
}

function DashboardRowPreview({ databaseId, columns, view, globalFilter, onOpen }: CommonProps & { view: DatabaseSavedView; globalFilter: FilterNode | null }) {
  const [rows, setRows] = useState<DatabaseRow[]>([]); const [count, setCount] = useState(0);
  const [error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
  useEffect(() => { let canceled = false;setError(null);setLoading(true); void window.nodus.queryDatabaseRows({ databaseId, viewId: view.id, filter: mergeFilters(view.config.filter, globalFilter), limit: 8 }).then((page) => { if (!canceled) { setRows(page.rows); setCount(page.totalCount); } }).catch(cause=>{if(!canceled)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(!canceled)setLoading(false);}); return () => { canceled = true; }; }, [databaseId, globalFilter, view]);
  if(error||loading)return <VisualizationStatus loading={loading} error={error}/>;
  return <div className="min-h-0 flex-1 overflow-auto p-2"><div className="mb-1 text-xs text-neutral-500">{tx('{n} filas', { n: count })}</div>{rows.map((row) => <button key={row.id} className="block min-h-8 w-full truncate rounded px-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={() => onOpen(row.id)}>{titleOf(row, columns)}</button>)}</div>;
}

export function DatabaseDashboardView({ databaseId, columns, config, views, onOpen }: CommonProps & { config: DatabaseDashboardViewConfig | null; views: DatabaseSavedView[] }) {
  const candidates = views.filter((view) => view.layout !== 'dashboard');
  const widgets = config?.widgets.length ? config.widgets.flatMap((widget) => { const view = candidates.find((candidate) => candidate.id === widget.viewId); return view ? [{ ...widget, view }] : []; })
    : candidates.slice(0, 6).map((view, index) => ({ id: `auto-${view.id}`, viewId: view.id, x: index % 2 * 6, y: Math.floor(index / 2) * 4, width: 6, height: 4, view }));
  return <section className="min-h-0 flex-1 overflow-auto bg-neutral-50 p-3 dark:bg-neutral-950" data-testid="database-dashboard-view"><div className="grid auto-rows-[72px] grid-cols-1 gap-3 lg:grid-cols-12">
    {widgets.map((widget) => { const width = Math.max(1, Math.min(12, widget.width)); return <article key={widget.id} data-testid="dashboard-widget" className={`col-span-1 flex min-h-[240px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${DASHBOARD_COLUMN_SPAN[width]}`} style={{ gridRow: `span ${Math.max(3, Math.min(8, widget.height))}` }}><header className="flex min-h-10 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800"><Icon name={widget.view.layout === 'chart' ? 'chartBar' : widget.view.layout === 'map' ? 'mapPin' : widget.view.layout === 'feed' ? 'list' : 'table'} /><strong className="truncate text-sm">{widget.view.name}</strong></header><DashboardMini databaseId={databaseId} columns={columns} view={widget.view} globalFilter={config?.filter ?? null} onOpen={onOpen} /></article>; })}
    {widgets.length === 0 && <div className="col-span-full grid h-64 place-items-center text-sm text-neutral-500" data-testid="database-dashboard-empty">{t('Crea vistas para añadir widgets al dashboard.')}</div>}
  </div></section>;
}
