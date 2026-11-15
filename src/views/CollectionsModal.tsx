import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ZoteroCollection, ZoteroItem, ZoteroLibrary, WorkView, AppSettings } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { ZoteroConnectionNotice } from '../components/ZoteroConnectionNotice';
import { useZoteroConnection } from '../hooks/useZoteroConnection';
import { zoteroFailureText } from '../lib/zoteroConnection';
import { t, tx } from '../i18n';

const ITEM_TYPES = ['journalArticle', 'book', 'bookSection', 'conferencePaper', 'thesis', 'preprint', 'report'];
const ZOTERO_ITEM_ROW_HEIGHT = 58;

// Session-level cache of collection items so re-selecting doesn't re-hit the API.
const itemCache = new Map<string, ZoteroItem[]>();

function CollectionNode({
  col,
  depth,
  selectedKey,
  monitoredKeys,
  onMonitorToggle,
  registerCollections,
  onSelect,
}: {
  col: ZoteroCollection;
  depth: number;
  selectedKey: string | null;
  monitoredKeys: Set<string>;
  onMonitorToggle: (key: string) => void;
  registerCollections: (collections: ZoteroCollection[]) => void;
  onSelect: (c: ZoteroCollection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ZoteroCollection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isSelected = selectedKey === col.key;
  const isMonitored = monitoredKeys.has(col.key);

  const expand = async () => {
    if (!open && children === null) {
      setLoading(true);
      const loaded = await window.nodus.zoteroChildCollections(col.key).catch(() => []);
      registerCollections(loaded);
      setChildren(loaded);
      setLoading(false);
    }
    setOpen((o) => !o);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded border cursor-pointer text-sm transition-colors ${
          isSelected
            ? 'border-indigo-500 bg-indigo-100 text-indigo-900 dark:border-indigo-600 dark:bg-indigo-600/15 dark:text-neutral-100'
            : isMonitored
              ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-600/70 dark:bg-emerald-900/50 dark:text-emerald-300'
              : 'border-transparent text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
        }`}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <button onClick={expand} className="w-4 text-neutral-500">
          {loading ? '…' : open ? '▾' : '▸'}
        </button>
        <span className="flex-1 truncate" onClick={() => onSelect(col)}>
          {col.name}
        </span>
        {isMonitored && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            {t('Monitorizada')}
          </span>
        )}
        <button
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            isMonitored
              ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50'
              : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-600/15 dark:text-indigo-300 dark:hover:bg-indigo-600 dark:hover:text-white'
          }`}
          title={isMonitored ? t('Quitar esta colección del monitoreo') : t('Monitorizar esta colección')}
          onClick={(e) => {
            e.stopPropagation();
            onMonitorToggle(col.key);
          }}
        >
          {isMonitored ? t('Quitar') : t('Monitorizar')}
        </button>
        <span className="text-[10px] text-neutral-600" title={t('ítems directos · subcolecciones')}>
          {col.itemCount}
          {col.subCount ? ` · ${col.subCount}▸` : ''}
        </span>
      </div>
      {open &&
        children?.map((c) => (
          <CollectionNode
            key={c.key}
            col={c}
            depth={depth + 1}
            selectedKey={selectedKey}
            monitoredKeys={monitoredKeys}
            onMonitorToggle={onMonitorToggle}
            registerCollections={registerCollections}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function CollectionsModal({
  settings,
  onSettingsChange,
  onClose,
}: {
  settings: AppSettings;
  onSettingsChange?: () => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const readTag = settings.readTag;
  const [roots, setRoots] = useState<ZoteroCollection[]>([]);
  const [libraries, setLibraries] = useState<ZoteroLibrary[]>([]);
  const [library, setLibrary] = useState<ZoteroLibrary | null>(null);
  const [selected, setSelected] = useState<ZoteroCollection | null>(null);
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [worksByKey, setWorksByKey] = useState<Map<string, WorkView>>(new Map());
  const [recursive, setRecursive] = useState(true);
  const [monitoringKeys, setMonitoringKeys] = useState<string[]>(settings.monitoredCollections ?? []);
  const [knownCollections, setKnownCollections] = useState<Map<string, string>>(new Map());
  const monitoredKeys = useMemo(() => new Set(monitoringKeys), [monitoringKeys]);

  // Filters
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [onlyTag, setOnlyTag] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unscanned' | 'light' | 'deep' | 'summary'>('all');

  // A closed Zotero used to reject these reads with nobody listening, which left the
  // tree saying "No collections." — indistinguishable from an empty library. The reads
  // now wait for a connection that answers, and every failure is shown where the list
  // would have been.
  const zotero = useZoteroConnection();
  const zoteroReady = zotero.status?.ok === true;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    void window.nodus.listWorks({ includeArchived: true }).then((ws) => {
      setWorksByKey(new Map(ws.map((w) => [w.zotero_key, w])));
    });
  }, []);

  useEffect(() => {
    if (!zoteroReady) return;
    let cancelled = false;
    setLoadError(null);
    window.nodus.zoteroLibraries().then(
      (next) => { if (!cancelled) { setLibraries(next); setLibrary((current) => current ?? next[0] ?? null); } },
      (cause) => { if (!cancelled) setLoadError(zoteroFailureText(cause)); },
    );
    return () => { cancelled = true; };
  }, [zoteroReady, reloadNonce]);

  useEffect(() => {
    if (!library || !zoteroReady) return;
    let cancelled = false;
    setRoots([]); setSelected(null); setItems([]);
    window.nodus.zoteroCollections(library).then(
      (next) => { if (!cancelled) { setLoadError(null); setRoots(next); } },
      (cause) => { if (!cancelled) setLoadError(zoteroFailureText(cause)); },
    );
    return () => { cancelled = true; };
  }, [library?.type, library?.id, zoteroReady, reloadNonce]);

  useEffect(() => {
    setMonitoringKeys(settings.monitoredCollections ?? []);
  }, [settings.monitoredCollections]);

  const registerCollections = useCallback((collections: ZoteroCollection[]) => {
    setKnownCollections((current) => {
      const next = new Map(current);
      for (const collection of collections) next.set(collection.key, collection.name);
      return next;
    });
  }, []);

  useEffect(() => {
    registerCollections(roots);
  }, [registerCollections, roots]);

  const updateMonitoredCollections = useCallback(
    async (nextKeys: string[]) => {
      setMonitoringKeys(nextKeys);
      await window.nodus.updateSettings({ monitoredCollections: nextKeys });
      await onSettingsChange?.();
    },
    [onSettingsChange]
  );

  const toggleMonitoredCollection = useCallback(
    (key: string) => {
      const nextKeys = monitoredKeys.has(key)
        ? monitoringKeys.filter((current) => current !== key)
        : [...monitoringKeys, key];
      void updateMonitoredCollections(nextKeys);
    },
    [monitoredKeys, monitoringKeys, updateMonitoredCollections]
  );

  const loadItems = useCallback(
    async (col: ZoteroCollection, force = false) => {
      setSelected(col);
      const cacheKey = `${col.key}:${recursive ? 'r' : 'd'}`;
      if (!force && itemCache.has(cacheKey)) {
        setItems(itemCache.get(cacheKey)!);
        return;
      }
      setLoadingItems(true);
      // Include subcollection items by default so a parent collection isn't shown empty.
      try {
        const data = await window.nodus.zoteroCollectionItems(col.key, { recursive });
        // Only a real answer is cached: caching the failure would keep showing an
        // empty collection after Zotero came back.
        itemCache.set(cacheKey, data);
        setItems(data);
      } catch (cause) {
        setItems([]);
        setLoadError(zoteroFailureText(cause));
      } finally {
        setLoadingItems(false);
      }
    },
    [recursive]
  );

  // Reload the selected collection's items when the recursive toggle changes.
  useEffect(() => {
    if (selected) void loadItems(selected, true);
  }, [recursive, selected, loadItems]);

  const statusOf = useCallback((key: string): 'unscanned' | 'light' | 'deep' => {
    const w = worksByKey.get(key);
    if (!w) return 'unscanned';
    if (w.deep_status === 'done') return 'deep';
    if (w.light_status === 'done') return 'light';
    return 'unscanned';
  }, [worksByKey]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const min = yearMin ? parseInt(yearMin) : null;
    const max = yearMax ? parseInt(yearMax) : null;
    const readTagLower = readTag.toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hit =
          (it.title ?? '').toLowerCase().includes(q) ||
          it.creators.some((c) => (c.lastName ?? c.name ?? '').toLowerCase().includes(q)) ||
          String(it.year ?? '').includes(q) ||
          (it.abstract ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (types.size && !types.has(it.itemType)) return false;
      if (min != null && (it.year ?? 0) < min) return false;
      if (max != null && (it.year ?? 9999) > max) return false;
      if (onlyTag && !it.tags.some((tag) => (tag ?? '').toLowerCase() === readTagLower)) return false;
      if (statusFilter === 'summary' && worksByKey.get(it.key)?.summary_status !== 'done') return false;
      if (statusFilter !== 'all' && statusFilter !== 'summary' && statusOf(it.key) !== statusFilter) return false;
      return true;
    });
  }, [items, onlyTag, readTag, search, statusFilter, statusOf, types, yearMax, yearMin]);

  const selectedIsMonitored = selected ? monitoredKeys.has(selected.key) : false;
  const monitoredEntries = monitoringKeys.map((key) => ({ key, name: knownCollections.get(key) ?? key }));

  const refreshWorks = async () => {
    const ws = await window.nodus.listWorks({ includeArchived: true });
    setWorksByKey(new Map(ws.map((w) => [w.zotero_key, w])));
  };

  const ensureWorks = async (itemsToEnsure: ZoteroItem[]) => {
    const missing = itemsToEnsure.filter((it) => !worksByKey.has(it.key));
    if (missing.length) await window.nodus.ingestZoteroItems(missing);
    const ws = await window.nodus.listWorks({ includeArchived: true });
    const next = new Map(ws.map((w) => [w.zotero_key, w]));
    setWorksByKey(next);
    return next;
  };

  const analyzeFiltered = async () => {
    const nextWorks = await ensureWorks(filtered);
    const ids = filtered.map((it) => nextWorks.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.setManualDeepBulk(ids, true);
    await refreshWorks();
  };

  const analyzeFilteredBoth = async () => {
    const nextWorks = await ensureWorks(filtered);
    const ids = filtered.map((it) => nextWorks.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.analyzeBothBulk(ids);
    await refreshWorks();
  };

  const summarizeFiltered = async () => {
    const nextWorks = await ensureWorks(filtered);
    const ids = filtered.map((it) => nextWorks.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.summarizeBulk(ids);
    await refreshWorks();
  };

  const deselectAllFiltered = async () => {
    const ids = filtered.map((it) => worksByKey.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.setManualDeepBulk(ids, false);
    await refreshWorks();
  };

  const toggleItem = async (it: ZoteroItem) => {
    const nextWorks = worksByKey.has(it.key) ? worksByKey : await ensureWorks([it]);
    const w = nextWorks.get(it.key);
    if (!w) return;
    await window.nodus.setManualDeep(w.nodus_id, !w.manual_deep);
    await refreshWorks();
  };

  const summarizeItem = async (it: ZoteroItem) => {
    const nextWorks = worksByKey.has(it.key) ? worksByKey : await ensureWorks([it]);
    const work = nextWorks.get(it.key);
    if (!work) return;
    await window.nodus.summarizeWork(work.nodus_id);
    await refreshWorks();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card w-full max-w-6xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 className="font-semibold">{t('Colecciones de Zotero')}</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="border-b border-neutral-800 bg-neutral-950/35 px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-neutral-300">{t('Monitorizando:')}</span>
            {monitoringKeys.length === 0 ? (
              <Badge color="amber">{t('Ninguna colección')}</Badge>
            ) : (
              monitoredEntries.map((entry) => (
                <button
                  key={entry.key}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 hover:bg-red-100 hover:text-red-700 dark:bg-emerald-900/50 dark:text-emerald-300 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                  title={t('Quitar del monitoreo')}
                  onClick={() => toggleMonitoredCollection(entry.key)}
                >
                  {entry.name}
                  <Icon name="x" size={10} />
                </button>
              ))
            )}
            {selected && (
              <>
                <span className="text-neutral-600">|</span>
                <span className="text-neutral-500">{t('Vista actual:')}</span>
                <Badge color={selectedIsMonitored ? 'green' : 'neutral'}>
                  {selected.name} · {selectedIsMonitored ? t('monitorizada') : t('solo exploración')}
                </Badge>
                <button
                  className={`rounded-md border px-2 py-0.5 ${
                    selectedIsMonitored
                      ? 'border-red-200 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/50'
                      : 'border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-600 dark:hover:text-white'
                  }`}
                  onClick={() => toggleMonitoredCollection(selected.key)}
                >
                  {selectedIsMonitored ? t('Quitar del monitoreo') : t('Monitorizar esta colección')}
                </button>
              </>
            )}
          </div>
        </div>

        {(!zoteroReady || loadError) && <ZoteroConnectionNotice connection={zotero} loadError={loadError} onRetry={() => setReloadNonce((value) => value + 1)} testId="collections-zotero-notice" />}

        <div className="flex-1 flex min-h-0">
          {/* Tree */}
          <div className="w-72 border-r border-neutral-800 overflow-y-auto p-2">
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Biblioteca')}<select data-testid="zotero-library-select" className="input mt-1 w-full text-xs" value={library ? `${library.type}:${library.id}` : ''} onChange={(event) => setLibrary(libraries.find((candidate) => `${candidate.type}:${candidate.id}` === event.target.value) ?? null)}>{libraries.map((candidate) => <option key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`}>{candidate.type === 'group' ? `${t('Grupo')}: ` : ''}{candidate.name}</option>)}</select></label>
            {roots.map((c) => (
              <CollectionNode
                key={c.key}
                col={c}
                depth={0}
                selectedKey={selected?.key ?? null}
                monitoredKeys={monitoredKeys}
                onMonitorToggle={toggleMonitoredCollection}
                registerCollections={registerCollections}
                onSelect={loadItems}
              />
            ))}
            {zoteroReady && !loadError && roots.length === 0 && <div className="text-neutral-500 text-sm p-2" data-testid="zotero-collections-empty">{t('Sin colecciones.')}</div>}
          </div>

          {/* Items */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="p-3 border-b border-neutral-800 space-y-2">
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  className="input flex-1 min-w-[160px]"
                  placeholder={t('Buscar título, autor, año, abstract…')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <input className="input w-20" placeholder={t('Año min')} value={yearMin} onChange={(e) => setYearMin(e.target.value)} />
                <input className="input w-20" placeholder={t('Año max')} value={yearMax} onChange={(e) => setYearMax(e.target.value)} />
                <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                  <option value="all">{t('Todos')}</option>
                  <option value="unscanned">{t('Sin escanear')}</option>
                  <option value="light">{t('Ligero')}</option>
                  <option value="deep">{t('Profundo')}</option>
                  <option value="summary">{t('Resumen')}</option>
                </select>
                <label className="text-xs flex items-center gap-1 text-neutral-400">
                  <input type="checkbox" checked={onlyTag} onChange={(e) => setOnlyTag(e.target.checked)} /> {t('solo tag')}
                </label>
                <label className="text-xs flex items-center gap-1 text-neutral-400" title={t('Incluir ítems de subcolecciones')}>
                  <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> {t('subcolecciones')}
                </label>
                <span className="text-xs text-neutral-500">{t('Modelos de análisis: Ajustes')}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {ITEM_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      const next = new Set(types);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      setTypes(next);
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      types.has(t) ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
                <div className="flex-1" />
                <button className="btn btn-ghost text-xs" title={t('Analizar ideas de los ítems filtrados')} onClick={analyzeFiltered}>
                  <Icon name="bulb" size={14} /> {t('Ideas')}
                </button>
                <button className="btn btn-primary text-xs" title={t('Analizar temas y luego ideas de los ítems filtrados')} onClick={analyzeFilteredBoth}>
                  <Icon name="layers" size={14} /> {t('Ambos')}
                </button>
                <button className="btn btn-ghost text-xs border border-violet-800 text-violet-300" title={t('Generar resúmenes de los ítems filtrados')} onClick={summarizeFiltered}>
                  <Icon name="wand" size={14} /> {t('Resumen')}
                </button>
                <button className="btn btn-ghost text-xs" onClick={deselectAllFiltered}>
                  <Icon name="x" size={14} /> {t('Deseleccionar')}
                </button>
                {selected && (
                  <button className="btn btn-ghost text-xs" title={t('Recargar ítems')} onClick={() => loadItems(selected, true)}>
                    <Icon name="refresh" size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0">
              {loadingItems && <div className="p-4 text-neutral-500 text-sm">{t('Cargando ítems…')}</div>}
              {!loadingItems && !selected && (
                <div className="p-4 text-neutral-500 text-sm">{t('Selecciona una colección.')}</div>
              )}
              {!loadingItems && selected && (
                <VirtualList
                  items={filtered}
                  itemHeight={ZOTERO_ITEM_ROW_HEIGHT}
                  getKey={(it) => it.key}
                  className="h-full"
                  empty={<div className="p-4 text-neutral-500 text-sm">{t('No hay ítems con los filtros actuales.')}</div>}
                  renderItem={(it) => {
                  const w = worksByKey.get(it.key);
                  const st = statusOf(it.key);
                  return (
                    <div className="flex h-full items-center gap-3 border-b border-neutral-800/60 px-4">
                      <input
                        type="checkbox"
                        checked={!!w?.manual_deep}
                        onChange={() => void toggleItem(it)}
                        title={w ? t('Analizar ideas de esta obra') : t('Incorporar a Nodus y analizar ideas')}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm">{it.title}</div>
                        <div className="text-xs text-neutral-500">
                          {(it.creators[0]?.lastName ?? it.creators[0]?.name ?? '—')}
                          {it.creators.length > 1 ? ' et al.' : ''} · {it.year ?? t('s.f.')} · {it.itemType}
                        </div>
                      </div>
                      <Badge color={st === 'deep' ? 'indigo' : st === 'light' ? 'green' : 'neutral'}>{st}</Badge>
                      {w && <Badge color={w.summary_status === 'done' ? 'indigo' : w.summary_status === 'failed' ? 'red' : 'neutral'}>{w.summary_status === 'done' ? t('resumen ✓') : t('resumen —')}</Badge>}
                      <button
                        className="btn btn-ghost text-xs border border-violet-800/70 text-violet-300"
                        title={w?.summary_status === 'done' ? t('Regenerar resumen') : t('Generar resumen')}
                        onClick={() => void summarizeItem(it)}
                      >
                        <Icon name="wand" size={13} />
                      </button>
                      {w?.deep_trigger === 'tag' && <span title={t('tag')}>🏷</span>}
                      {w?.deep_trigger === 'manual' && <span title={t('manual')}>✦</span>}
                      {w?.deep_trigger === 'both' && <span title={t('ambos')}>🏷✦</span>}
                    </div>
                  );
                  }}
                />
              )}
            </div>
            <div className="px-4 py-1.5 border-t border-neutral-800 text-xs text-neutral-500">
              {tx('{a} de {b} ítems', { a: filtered.length, b: items.length })}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
