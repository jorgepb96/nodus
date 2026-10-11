import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DatabaseContainerDefinition, DatabaseContainerRow, DatabaseContainerRowPage, DatabaseDataSource } from '@shared/databaseSources';
import type { FilterNode } from '@shared/databaseQuery';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

interface ViewOption { id: string; label: string }

export function LinkedDatabaseViewBlock({ content, onContent, onNavigatePage, readOnly = false, onOpenRow }: {
  content: Record<string, unknown>;
  onContent: (patch: Record<string, unknown>) => void;
  onNavigatePage?: (pageId: string) => void;
  readOnly?: boolean;
  onOpenRow?: (rowId:string)=>void;
}) {
  const viewId = typeof content.viewId === 'string' ? content.viewId : '';
  const [readFilter,setReadFilter]=useState(typeof content.titleFilter==='string'?content.titleFilter:'');
  const titleFilter = readOnly ? readFilter : typeof content.titleFilter === 'string' ? content.titleFilter : '';
  const storedFilter = content.localFilter && typeof content.localFilter === 'object' ? content.localFilter as FilterNode : null;
  const localFilter = useMemo<FilterNode | null>(() => titleFilter.trim()
    ? { type: 'condition', columnId: 'title', op: 'contains', value: titleFilter.trim() } : storedFilter,
  [storedFilter, titleFilter]);
  const [views, setViews] = useState<ViewOption[]>([]); const [allSources, setAllSources] = useState<DatabaseDataSource[]>([]);
  const [definition, setDefinition] = useState<DatabaseContainerDefinition | null>(null);
  const [page, setPage] = useState<DatabaseContainerRowPage | null>(null); const [rows, setRows] = useState<DatabaseContainerRow[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null); const [sourceToAdd, setSourceToAdd] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);

  useEffect(() => { if(readOnly)return;let active = true; void Promise.all([window.nodus.listDatabases(), window.nodus.listDatabaseDataSources()]).then(async ([databases, sources]) => {
    const groups = await Promise.all(databases.map(async (database) => (await window.nodus.listDatabaseViews(database.id)).map((view) => ({ id: view.id, label: `${database.name} · ${view.name}` }))));
    if (active) { setViews(groups.flat()); setAllSources(sources); }
  }).catch(() => undefined); return () => { active = false; }; }, [readOnly]);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (!viewId) { setDefinition(null); setPage(null); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const container = await window.nodus.getDatabaseContainer(viewId);
      if (!container) throw new Error(t('La vista enlazada ya no existe.'));
      const next = await window.nodus.queryDatabaseContainerRows({ viewId, sourceId, localFilter, cursor, limit: 30 });
      setDefinition(container); setPage(next); setRows((current) => append ? [...current, ...next.rows] : next.rows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (!append) { setPage(null); setRows([]); } }
    finally { setLoading(false); }
  }, [localFilter, sourceId, viewId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSourceId(null); }, [viewId]);
  const titleProperty = definition?.properties.find((property) => property.type === 'title')?.id ?? 'title';
  const attach = async () => { if (!viewId || !sourceToAdd) return; setLoading(true); setError(null); try {
    await window.nodus.attachDatabaseViewSource(viewId, allSources.find((source) => source.id === sourceToAdd)?.databaseId ?? '', {});
    setSourceToAdd(''); await load();
  } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } };
  const detach = async (targetSourceId: string) => { try { await window.nodus.detachDatabaseViewSource(viewId, targetSourceId);
    if (sourceId === targetSourceId) setSourceId(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const openRow = async (rowId: string) => { if(onOpenRow){onOpenRow(rowId);return;}const document = await window.nodus.getPageForDatabaseRow(rowId); if (document) onNavigatePage?.(document.page.id); };
  const availableSources = allSources.filter((source) => !definition?.sources.some((attached) => attached.sourceId === source.id));

  return <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/20" data-testid="linked-database-block">
    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-800 dark:text-indigo-200"><Icon name="table" size={14} />{t('Vista enlazada de base de datos')}</div>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,1fr)]">
      {readOnly?<p className="min-w-0 text-sm">{definition?.viewName||t('Vista enlazada')}</p>:<select aria-label={t('Selecciona una vista')} className="input h-9 min-w-0 text-sm" value={viewId} onChange={(event) => onContent({ viewId: event.target.value })}>
        <option value="">{t('Selecciona una vista')}</option>{views.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
        {viewId && !views.some((view) => view.id === viewId) && <option value={viewId}>{viewId}</option>}
      </select>}
      <input aria-label={t('Filtrar título')} className="input h-9 min-w-0 text-sm" value={titleFilter} placeholder={t('Filtrar título')} onChange={(event) => readOnly?setReadFilter(event.target.value):onContent({ titleFilter: event.target.value, localFilter: null })} />
    </div>
    {definition && <>
      <div className="mt-3 flex min-h-11 gap-1 overflow-x-auto border-b border-indigo-200 pb-1 dark:border-indigo-900" role="tablist" aria-label={t('Fuentes de datos')}>
        <button type="button" role="tab" aria-selected={!sourceId} className={`min-h-10 shrink-0 rounded-lg px-3 text-xs ${!sourceId ? 'bg-white font-semibold shadow-sm dark:bg-neutral-900' : 'hover:bg-white/60 dark:hover:bg-neutral-900/60'}`} onClick={() => setSourceId(null)}>{t('Todas las fuentes')}</button>
        {definition.sources.map((source) => <button key={source.sourceId} type="button" role="tab" aria-selected={sourceId === source.sourceId} className={`min-h-10 shrink-0 rounded-lg px-3 text-xs ${sourceId === source.sourceId ? 'bg-white font-semibold shadow-sm dark:bg-neutral-900' : 'hover:bg-white/60 dark:hover:bg-neutral-900/60'}`} onClick={() => setSourceId(source.sourceId)}>{source.alias}</button>)}
      </div>
      {!readOnly&&<details className="mt-2 text-xs"><summary className="cursor-pointer py-1 font-medium text-neutral-700 dark:text-neutral-300">{t('Fuentes de datos')} · {definition.sources.length}</summary>
        <div className="mb-2 grid gap-1">{definition.sources.map((source) => <div key={source.sourceId} className="flex min-h-9 items-center justify-between rounded-lg bg-white/70 px-2 dark:bg-neutral-900/70"><span className="truncate pr-2">{source.alias}</span>{!source.primary && <button type="button" className="grid min-h-9 min-w-9 place-items-center rounded-lg text-neutral-700 hover:bg-rose-100 hover:text-rose-800 dark:text-neutral-200 dark:hover:bg-rose-950/50 dark:hover:text-rose-100" aria-label={`${t('Quitar fuente')} ${source.alias}`} onClick={() => void detach(source.sourceId)}><Icon name="x" size={12} /></button>}</div>)}</div>
        <div className="mt-1 flex gap-2"><select aria-label={t('Añadir fuente')} className="input h-9 min-w-0 flex-1 text-xs" value={sourceToAdd} onChange={(event) => setSourceToAdd(event.target.value)}><option value="">{t('Selecciona una fuente')}</option>{availableSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select><button type="button" className="btn h-9 px-3 text-xs" disabled={!sourceToAdd || loading} onClick={() => void attach()}><Icon name="plus" size={12} />{t('Añadir fuente')}</button></div>
      </details>}
    </>}
    {loading && !page && <div role="status" data-testid="linked-database-loading" className="grid min-h-28 place-items-center text-xs text-neutral-600 dark:text-neutral-300">{t('Cargando visualización…')}</div>}
    {error && <div role="alert" data-testid="linked-database-error" className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}{readOnly&&<button type="button" className="ml-2 min-h-11" onClick={()=>void load()}>{t('Reintentar')}</button>}</div>}
    {!loading && !error && viewId && rows.length === 0 && <div data-testid="linked-database-empty" className="grid min-h-24 place-items-center text-xs text-neutral-600 dark:text-neutral-300">{t('No hay filas para este filtro.')}</div>}
    {rows.length > 0 && <div className="mt-2 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" data-testid="linked-database-rows">
      {rows.map((row) => <button type="button" key={row.id} data-source-id={row.sourceId} className="flex min-h-11 w-full items-center gap-2 border-b border-neutral-200 px-3 text-left text-sm last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900" onClick={() => void openRow(row.rowId)}><span className="min-w-0 flex-1 truncate">{row.cells[titleProperty] || t('Sin título')}</span><span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">{row.sourceName}</span></button>)}
      {page?.nextCursor && <button type="button" className="min-h-11 w-full text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30" disabled={loading} onClick={() => void load(page.nextCursor, true)}>{t('Cargar más')}</button>}
    </div>}
    {page && <div className="mt-1 text-right text-[10px] text-neutral-600 dark:text-neutral-400">{tx('{n} filas', { n: page.totalCount })}</div>}
  </div>;
}
