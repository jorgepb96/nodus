import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PrimarySourceArchiveRow,
  PrimarySourceArchiveWorkspace,
  PrimarySourceBulkPatch,
  PrimarySourceBulkPreview,
  PrimarySourceIngestInput,
  PrimarySourceUnitCreateInput,
} from '@shared/primarySourcesTypes';
import type { ArchiveDescriptionUnit } from '@shared/archiveTypes';
import type { GazetteerPlace } from '@shared/types';
import { getArchiveDocType } from '@shared/archiveDocTypes';
import { Icon, ModalBackdrop } from '../components/ui';
import { DocumentIconPicker } from '../components/DocumentIconPicker';
import { DocTypeForm, DocTypeSelect, docTypeLabel } from '../components/DocTypeForm';
import { PlacePicker } from '../components/PlacePicker';
import { t } from '../i18n';
import { consumePrimarySourceAttention } from '../primarySourcesAttention';
import { PrimarySourceDossierView } from './PrimarySourceDossierView';
import { archiveFileUrl } from '../lib/archiveFileUrl';
import { archiveDocumentIcon, suggestedArchiveDocumentIcon } from '../lib/archiveDocumentIcon';

type DisplayMode = 'table' | 'gallery' | 'hierarchy';
type LeftTree = 'provenance' | 'collections';

const ARCHIVE_SIDEBAR_SESSION_KEY = 'nodus.primarySources.archiveSidebarCollapsed';

const EMPTY_WORKSPACE: PrimarySourceArchiveWorkspace = {
  rows: [],
  repositories: [],
  units: [],
  sessions: [],
  collections: [],
  places: [],
  templates: [],
  page: {
    offset: 0,
    limit: 200,
    total: 0,
    hasMore: false,
    unitsTruncated: false,
  },
};

const LEVEL_LABELS: Record<ArchiveDescriptionUnit['level'], string> = {
  repository: 'Repositorio',
  fonds: 'Fondo',
  collection: 'Colección archivística',
  subfonds: 'Subfondo',
  series: 'Serie',
  subseries: 'Subserie',
  file: 'Unidad de instalación',
  item: 'Documento',
  component: 'Componente',
  local: 'Nivel local',
};

const ACCESS_LABELS = {
  open: 'Abierta',
  private: 'Privada',
  restricted: 'Restringida',
  embargoed: 'Embargada',
  unknown: 'Acceso por revisar',
} as const;

const SENSITIVITY_LABELS = {
  normal: 'Normal',
  personal: 'Datos personales',
  sensitive: 'Sensible',
  highly_sensitive: 'Muy sensible',
} as const;

const PROCESSING_LABELS = {
  imported: 'Importada',
  needs_description: 'Requiere descripción',
  ready: 'Preparada',
  processing: 'Procesando',
  error: 'Con incidencias',
  archived: 'Archivada',
} as const;

function unitChildren(units: ArchiveDescriptionUnit[], parentId: string | null): ArchiveDescriptionUnit[] {
  return units
    .filter((unit) => unit.parentUnitId === parentId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

function descendantIds(units: ArchiveDescriptionUnit[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (unit.parentUnitId && result.has(unit.parentUnitId) && !result.has(unit.unitId)) {
        result.add(unit.unitId);
        changed = true;
      }
    }
  }
  return result;
}

function fileKindIcon(kind: string): string {
  if (kind === 'image') return 'eye';
  if (kind === 'pdf') return 'book';
  if (kind === 'csv' || kind === 'xlsx') return 'grid';
  if (kind === 'text') return 'notebook';
  return 'archive';
}

export function PrimarySourcesArchiveView({
  target = null,
  onTargetConsumed,
}: {
  target?: {
    itemId: string;
    excerptId?: string | null;
    textVersionId?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
    nonce: number;
  } | null;
  onTargetConsumed?: () => void;
} = {}) {
  const [workspace, setWorkspace] = useState<PrimarySourceArchiveWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<DisplayMode>('table');
  const [leftTree, setLeftTree] = useState<LeftTree>('provenance');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.sessionStorage.getItem(ARCHIVE_SIDEBAR_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingestOpen, setIngestOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<PrimarySourceArchiveRow | null>(null);
  const [deepLinkedExcerptId, setDeepLinkedExcerptId] = useState<string | null>(null);
  const [deepLinkedTextTarget, setDeepLinkedTextTarget] = useState<{
    textVersionId: string;
    start: number;
    end: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attention, setAttention] = useState(() => consumePrimarySourceAttention([
    'missing_provenance',
    'missing_reference',
    'ocr_review',
    'pending_proposals',
    'restricted_export',
    'integrity',
  ]));

  const reload = useCallback(async (search = query, offset = 0, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const next = await window.nodus.getPrimarySourcesWorkspace(search.trim(), offset, 200);
      setWorkspace((current) => {
        if (!append) return next;
        const rows = new Map(current.rows.map((row) => [row.item.itemId, row]));
        for (const row of next.rows) rows.set(row.item.itemId, row);
        const units = new Map(current.units.map((unit) => [unit.unitId, unit]));
        for (const unit of next.units) units.set(unit.unitId, unit);
        return {
          ...next,
          rows: [...rows.values()],
          units: [...units.values()],
          page: { ...next.page, offset: 0 },
        };
      });
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(query), 180);
    return () => window.clearTimeout(timer);
  }, [query, reload]);

  useEffect(() => {
    let active = true;
    void window.nodus.getSettings().then((settings) => {
      if (!active || settings.primarySourcesTourComplete) return;
      setSidebarCollapsed(false);
      try {
        window.sessionStorage.removeItem(ARCHIVE_SIDEBAR_SESSION_KEY);
      } catch {
        // Storage can be unavailable in hardened renderer contexts; the UI still works.
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.sessionStorage.setItem(ARCHIVE_SIDEBAR_SESSION_KEY, next ? '1' : '0');
      } catch {
        // Keep the in-memory toggle functional even when session storage is unavailable.
      }
      return next;
    });
  };

  const visibleRows = useMemo(() => {
    let rows = workspace.rows;
    if (unitFilter) {
      const ids = descendantIds(workspace.units, unitFilter);
      rows = rows.filter((row) => ids.has(row.unit.unitId));
    }
    if (collectionFilter) {
      rows = rows.filter((row) => row.item.folderIds.includes(collectionFilter));
    }
    if (attention?.targetIds.length) {
      rows = rows.filter((row) => attention.targetIds.includes(row.item.itemId));
    }
    return rows;
  }, [workspace, unitFilter, collectionFilter, attention]);

  const toggleSelected = (itemId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.item.itemId));

  useEffect(() => {
    if (!target || loading) return;
    const row = workspace.rows.find((candidate) => candidate.item.itemId === target.itemId);
    const open = (resolved: PrimarySourceArchiveRow) => {
      setDeepLinkedExcerptId(target.excerptId ?? null);
      setDeepLinkedTextTarget(
        target.textVersionId
          && typeof target.startOffset === 'number'
          && typeof target.endOffset === 'number'
          ? {
            textVersionId: target.textVersionId,
            start: target.startOffset,
            end: target.endOffset,
          }
          : null
      );
      setEditing(resolved);
      onTargetConsumed?.();
    };
    if (row) {
      open(row);
      return;
    }
    // A deep link can target a source outside the first metadata page.
    let active = true;
    void window.nodus.getPrimarySourceDossier(target.itemId).then((dossier) => {
      if (active && dossier) open(dossier.row);
    });
    return () => {
      active = false;
    };
  }, [loading, onTargetConsumed, target, workspace.rows]);

  return (
    <div className="flex h-full min-h-0 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="primary-sources-archive">
      {!sidebarCollapsed && (
        <aside
          className="hidden w-72 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex"
          data-tour="primary-sources-provenance-tree"
          data-testid="primary-sources-archive-sidebar"
        >
          <div className="flex items-center border-b border-neutral-200 p-2 dark:border-neutral-800">
            <div
              className="grid min-w-0 flex-1 grid-cols-2"
              role="group"
              aria-label={t('Modo de vista')}
            >
              <button
                className={`rounded-lg px-2 py-2 text-xs font-medium ${leftTree === 'provenance' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
                onClick={() => setLeftTree('provenance')}
                aria-pressed={leftTree === 'provenance'}
              >
                {t('Ubicación archivística')}
              </button>
              <button
                className={`rounded-lg px-2 py-2 text-xs font-medium ${leftTree === 'collections' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
                onClick={() => setLeftTree('collections')}
                aria-pressed={leftTree === 'collections'}
              >
                {t('Colecciones de trabajo')}
              </button>
            </div>
            <button
              type="button"
              className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              aria-label={t('Ocultar panel lateral')}
              title={t('Ocultar panel lateral')}
              aria-expanded="true"
              data-testid="primary-sources-archive-sidebar-toggle"
              onClick={toggleSidebar}
            >
              <Icon name="chevronLeft" size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {leftTree === 'provenance' ? (
              <>
                <TreeButton active={!unitFilter} icon="archive" label={t('Todo el archivo')} onClick={() => setUnitFilter(null)} />
                <UnitTree
                  units={workspace.units}
                  rows={workspace.rows}
                  parentId={null}
                  selectedId={unitFilter}
                  onSelect={(unitId) => {
                    setUnitFilter(unitId);
                    setCollectionFilter(null);
                  }}
                />
              </>
            ) : (
              <>
                <TreeButton active={!collectionFilter} icon="folder" label={t('Todas las colecciones')} onClick={() => setCollectionFilter(null)} />
                {workspace.collections.map((collection) => (
                  <TreeButton
                    key={collection.folderId}
                    active={collectionFilter === collection.folderId}
                    icon="folder"
                    label={collection.name}
                    count={workspace.rows.filter((row) => row.item.folderIds.includes(collection.folderId)).length}
                    onClick={() => {
                      setCollectionFilter(collection.folderId);
                      setUnitFilter(null);
                    }}
                  />
                ))}
                {workspace.collections.length === 0 && (
                  <p className="px-2 py-4 text-xs leading-5 text-neutral-500">{t('Las colecciones agrupan trabajo sin alterar la procedencia.')}</p>
                )}
              </>
            )}
          </div>
          <div className="flex h-8 shrink-0 items-center justify-center border-t border-neutral-200 px-3 dark:border-neutral-800">
            <button
              className="btn btn-secondary h-full w-full justify-center gap-2 py-0 text-xs"
              data-testid="primary-sources-organize-open"
              onClick={() => setManageOpen(true)}
            >
              <Icon name="settings" size={14} /> {t('Organizar')}
            </button>
          </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2">
            {sidebarCollapsed && (
              <button
                type="button"
                className="btn btn-ghost hidden h-9 w-9 shrink-0 p-0 lg:grid lg:place-items-center"
                aria-label={t('Mostrar panel lateral')}
                title={t('Mostrar panel lateral')}
                aria-expanded="false"
                data-testid="primary-sources-archive-sidebar-toggle"
                onClick={toggleSidebar}
              >
                <Icon name="columns" size={16} />
              </button>
            )}
            <div className="mr-2 flex items-center gap-2">
              <Icon name="archive" className="text-indigo-600 dark:text-indigo-300" />
              <h1 className="text-base font-semibold">{t('Archivo')}</h1>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                {workspace.page.total > workspace.rows.length
                  ? `${visibleRows.length}/${workspace.page.total}`
                  : visibleRows.length}
              </span>
            </div>
            <label className="relative min-w-[14rem] flex-1">
              <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-2.5 text-neutral-400" />
              <input
                className="input input-with-leading-icon h-9 w-full text-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Buscar metadatos: título, signatura, creador o descripción…')}
                aria-label={t('Buscar fuentes por metadatos')}
              />
            </label>
            <div
              className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700"
              aria-label={t('Modo de vista')}
              role="group"
              data-tour="primary-sources-view-modes"
            >
              {([
                ['table', 'table', 'Tabla'],
                ['gallery', 'grid', 'Galería'],
                ['hierarchy', 'network', 'Jerarquía'],
              ] as const).map(([value, icon, label]) => (
                <button
                  key={value}
                  className={`rounded-md p-2 ${mode === value ? 'bg-neutral-100 text-indigo-700 dark:bg-neutral-800 dark:text-indigo-200' : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'}`}
                  title={t(label)}
                  aria-label={t(label)}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  <Icon name={icon} size={15} />
                </button>
              ))}
            </div>
            <button className="btn btn-secondary gap-2 text-xs" onClick={() => setUnitOpen(true)}>
              <Icon name="plus" size={14} /> {t('Unidad sin archivo')}
            </button>
            <button
              className="btn btn-primary gap-2 text-xs"
              onClick={() => setIngestOpen(true)}
              data-tour="primary-sources-import"
            >
              <Icon name="upload" size={14} /> {t('Añadir fuentes')}
            </button>
          </div>
          {message && <p role="status" aria-live="polite" className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
          {selected.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs dark:border-indigo-900 dark:bg-indigo-950/40">
              <span className="font-medium">{t('{n} fuentes seleccionadas').replace('{n}', String(selected.size))}</span>
              <button className="btn btn-secondary ml-auto text-xs" onClick={() => setBulkOpen(true)}>{t('Editar lote')}</button>
              <button className="btn btn-ghost text-xs" onClick={() => setSelected(new Set())}>{t('Cancelar selección')}</button>
            </div>
          )}
        </header>
        {attention && (
          <div className="flex shrink-0 items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-[10px] text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
            <Icon name="filter" size={12} />
            <span>{t('Lista filtrada')}: {t(attention.label)}</span>
            <button className="ml-auto font-medium hover:underline" onClick={() => setAttention(null)}>{t('Mostrar todo')}</button>
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div role="status" aria-live="polite" className="grid h-full place-items-center text-sm text-neutral-500">{t('Cargando archivo…')}</div>
          ) : visibleRows.length === 0 && workspace.units.length === 0 ? (
            <ArchiveEmpty onIngest={() => setIngestOpen(true)} onUnit={() => setUnitOpen(true)} />
          ) : mode === 'table' ? (
            <ArchiveTable
              rows={visibleRows}
              collections={workspace.collections}
              places={workspace.places}
              selected={selected}
              allSelected={allVisibleSelected}
              onToggle={toggleSelected}
              onToggleAll={() => setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map((row) => row.item.itemId)))}
              onOpen={setEditing}
            />
          ) : mode === 'gallery' ? (
            <ArchiveGallery rows={visibleRows} selected={selected} onToggle={toggleSelected} onOpen={setEditing} />
          ) : (
            <HierarchyCanvas units={workspace.units} rows={visibleRows} onOpen={setEditing} />
          )}
        </section>
        {(workspace.page.hasMore || workspace.page.total > 0) && (
          <footer className="flex h-8 shrink-0 items-center justify-center gap-3 border-t border-neutral-200 bg-white px-4 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
            <span>
              {t('{shown} de {total} fuentes cargadas')
                .replace('{shown}', String(workspace.rows.length))
                .replace('{total}', String(workspace.page.total))}
            </span>
            {workspace.page.hasMore && (
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={loadingMore}
                aria-busy={loadingMore}
                onClick={() => void reload(query, workspace.rows.length, true)}
              >
                {loadingMore ? t('Cargando más…') : t('Cargar más')}
              </button>
            )}
            {workspace.page.unitsTruncated && (
              <span title={t('El árbol muestra la ruta de las fuentes cargadas; usa la búsqueda para localizar otras unidades.')}>
                {t('Árbol contextual')}
              </span>
            )}
          </footer>
        )}
      </main>

      {ingestOpen && (
        <IngestModal
          workspace={workspace}
          onClose={() => setIngestOpen(false)}
          onComplete={async (result) => {
            setIngestOpen(false);
            setMessage(
              t('Añadidas: {added} · duplicadas vinculadas: {duplicates}')
                .replace('{added}', String(result.added))
                .replace('{duplicates}', String(result.duplicates))
            );
            await reload();
          }}
        />
      )}
      {unitOpen && (
        <UnitModal
          workspace={workspace}
          onClose={() => setUnitOpen(false)}
          onComplete={async () => {
            setUnitOpen(false);
            setMessage(t('Unidad archivística creada.'));
            await reload();
          }}
        />
      )}
      {manageOpen && (
        <OrganizeModal
          workspace={workspace}
          onClose={() => setManageOpen(false)}
          onChanged={async () => {
            await reload();
          }}
        />
      )}
      {bulkOpen && (
        <BulkEditModal
          itemIds={[...selected]}
          sessions={workspace.sessions}
          collections={workspace.collections}
          onClose={() => setBulkOpen(false)}
          onComplete={async (count) => {
            setBulkOpen(false);
            setSelected(new Set());
            setMessage(t('{n} fuentes actualizadas con seguridad.').replace('{n}', String(count)));
            await reload();
          }}
        />
      )}
      {editing && (
        <ModalBackdrop
          zIndex={150}
          onClose={() => {
            setEditing(null);
            setDeepLinkedExcerptId(null);
            setDeepLinkedTextTarget(null);
          }}
        >
          <section
            className="card-modal h-[92vh] w-[96vw] max-w-[1600px] overflow-hidden rounded-2xl shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('Ficha documental')}
            data-testid="primary-source-dossier-modal"
          >
            <PrimarySourceDossierView
              initialRow={editing}
              initialExcerptId={deepLinkedExcerptId}
              initialTextTarget={deepLinkedTextTarget}
              workspace={workspace}
              presentation="modal"
              onBack={() => {
                setEditing(null);
                setDeepLinkedExcerptId(null);
                setDeepLinkedTextTarget(null);
              }}
              onChanged={async () => {
                await reload();
              }}
            />
          </section>
        </ModalBackdrop>
      )}
    </div>
  );
}

function TreeButton({
  active,
  icon,
  label,
  count,
  depth = 0,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  count?: number;
  depth?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'}`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={onClick}
    >
      <Icon name={icon} size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t(label)}</span>
      {count !== undefined && <span className="tabular-nums text-neutral-400">{count}</span>}
    </button>
  );
}

/** The provenance tree, built once per render of the archive: each unit's children and the
 *  number of sources filed anywhere beneath it. Counting by re-deriving every unit's
 *  descendants once per source row, at every node, made the sidebar cubic in the size of
 *  the archive; this is linear. */
export function archiveUnitTree(units: ArchiveDescriptionUnit[], rows: PrimarySourceArchiveRow[]): { children: Map<string | null, ArchiveDescriptionUnit[]>; counts: Map<string, number> } {
  const children = new Map<string | null, ArchiveDescriptionUnit[]>();
  for (const unit of units) {
    const siblings = children.get(unit.parentUnitId ?? null);
    if (siblings) siblings.push(unit); else children.set(unit.parentUnitId ?? null, [unit]);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const direct = new Map<string, number>();
  for (const row of rows) direct.set(row.unit.unitId, (direct.get(row.unit.unitId) ?? 0) + 1);
  const counts = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (unitId: string): number => {
    const known = counts.get(unitId);
    if (known !== undefined) return known;
    if (visiting.has(unitId)) return 0;
    visiting.add(unitId);
    let total = direct.get(unitId) ?? 0;
    for (const child of children.get(unitId) ?? []) total += count(child.unitId);
    visiting.delete(unitId);
    counts.set(unitId, total);
    return total;
  };
  for (const unit of units) count(unit.unitId);
  return { children, counts };
}

export function UnitTree({
  units,
  rows,
  parentId,
  selectedId,
  onSelect,
  depth = 0,
  tree: givenTree,
}: {
  units: ArchiveDescriptionUnit[];
  rows: PrimarySourceArchiveRow[];
  parentId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
  tree?: ReturnType<typeof archiveUnitTree>;
}) {
  const builtTree = useMemo(() => givenTree ?? archiveUnitTree(units, rows), [givenTree, units, rows]);
  const tree = givenTree ?? builtTree;
  return (
    <>
      {(tree.children.get(parentId) ?? []).map((unit) => {
        const count = tree.counts.get(unit.unitId) ?? 0;
        return (
          <div key={unit.unitId}>
            <TreeButton
              active={selectedId === unit.unitId}
              icon={unit.level === 'item' ? 'book' : 'folder'}
              label={unit.title}
              count={count}
              depth={depth}
              onClick={() => onSelect(unit.unitId)}
            />
            <UnitTree units={units} rows={rows} parentId={unit.unitId} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} tree={tree} />
          </div>
        );
      })}
    </>
  );
}

function ArchiveEmpty({ onIngest, onUnit }: { onIngest: () => void; onUnit: () => void }) {
  return (
    <div className="grid min-h-full place-items-center p-8">
      <div className="max-w-xl text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
          <Icon name="archive" size={26} />
        </span>
        <h2 className="mt-5 text-xl font-semibold">{t('Tu archivo empieza aquí')}</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t('Añade archivos o registra una fuente localizada. Podrás completar la procedencia y la descripción gradualmente.')}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn btn-primary gap-2" onClick={onIngest}><Icon name="upload" /> {t('Añadir fuentes')}</button>
          <button className="btn btn-secondary gap-2" onClick={onUnit}><Icon name="plus" /> {t('Unidad sin archivo')}</button>
        </div>
      </div>
    </div>
  );
}

function ArchiveTable({
  rows,
  collections,
  places,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: PrimarySourceArchiveRow[];
  collections: PrimarySourceArchiveWorkspace['collections'];
  places: PrimarySourceArchiveWorkspace['places'];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: PrimarySourceArchiveRow) => void;
}) {
  if (rows.length === 0) return <FilteredEmpty />;
  const columns = [
    { id: 'preview', label: 'Miniatura', width: 100 },
    { id: 'title', label: 'Título', width: 270 },
    { id: 'docType', label: 'Tipo de documento', width: 220 },
    { id: 'typedMetadata', label: 'Datos de catalogación', width: 290 },
    { id: 'description', label: 'Descripción', width: 300 },
    { id: 'date', label: 'Fecha', width: 150 },
    { id: 'creator', label: 'Creador documental', width: 210 },
    { id: 'reference', label: 'Signatura', width: 150 },
    { id: 'repository', label: 'Repositorio', width: 220 },
    { id: 'level', label: 'Nivel', width: 135 },
    { id: 'collections', label: 'Colecciones de trabajo', width: 220 },
    { id: 'tags', label: 'Etiquetas', width: 220 },
    { id: 'access', label: 'Acceso', width: 145 },
    { id: 'sensitivity', label: 'Sensibilidad', width: 155 },
    { id: 'status', label: 'Estado de procesamiento', width: 175 },
    { id: 'files', label: 'Archivos', width: 115 },
    { id: 'provenancePlace', label: 'Lugar de procedencia', width: 220 },
    { id: 'updated', label: 'Actualizado', width: 170 },
  ] as const;
  const gutterWidth = 42;
  const minWidth = gutterWidth + columns.reduce((total, column) => total + column.width, 0);
  const collectionNames = new Map(collections.map((collection) => [collection.folderId, collection.name]));
  const placeNames = new Map(places.map((place) => [place.placeId, place.name]));
  const cellClass = 'flex shrink-0 items-center overflow-hidden border-r border-neutral-200 px-3 text-xs dark:border-neutral-800';

  return (
    <div className="text-sm" style={{ minWidth }} data-testid="primary-sources-archive-grid">
      <div className="sticky top-0 z-10 flex border-b border-neutral-200 bg-neutral-100/95 text-xs font-medium text-neutral-500 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <label className="grid shrink-0 place-items-center" style={{ width: gutterWidth }}>
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label={t('Seleccionar todo')} />
        </label>
        {columns.map((column) => (
          <div
            key={column.id}
            className="shrink-0 truncate border-l border-neutral-200 px-3 py-3 dark:border-neutral-800"
            style={{ width: column.width }}
          >
            {t(column.label)}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.item.itemId}
          className="flex min-h-[58px] cursor-pointer border-b border-neutral-200 bg-white outline-none transition hover:bg-indigo-50/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-indigo-950/25"
          role="button"
          tabIndex={0}
          data-testid={`primary-source-archive-row-${row.item.itemId}`}
          aria-label={t('Abrir ficha de {title}').replace('{title}', row.item.title)}
          onClick={() => onOpen(row)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onOpen(row);
          }}
        >
          <label
            className="grid shrink-0 cursor-default place-items-center"
            style={{ width: gutterWidth }}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected.has(row.item.itemId)}
              onChange={() => onToggle(row.item.itemId)}
              aria-label={t('Seleccionar {title}').replace('{title}', row.item.title)}
            />
          </label>
          <div className={`${cellClass} justify-center p-1.5`} style={{ width: columns[0].width }}>
            <ArchiveTablePreview row={row} />
          </div>
          <div className={`${cellClass} gap-2`} style={{ width: columns[1].width }}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
              <Icon name={archiveDocumentIcon(row.profile.metadata, row.item.docType, row.item.kind)} size={15} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">{row.item.title}</span>
              <span className="block truncate text-[10px] text-neutral-500">{row.item.fileName || t('Sin archivo')}</span>
            </span>
          </div>
          <div className={cellClass} style={{ width: columns[2].width }}>
            <span className="truncate">{docTypeLabel(row.item.docType) || t('Sin clasificar')}</span>
          </div>
          <div className={cellClass} style={{ width: columns[3].width }} title={typedMetadataSummary(row)}>
            <span className="line-clamp-2 leading-5 text-neutral-500">{typedMetadataSummary(row) || '—'}</span>
          </div>
          <div className={cellClass} style={{ width: columns[4].width }} title={row.unit.scopeContent ?? ''}>
            <span className="line-clamp-2 leading-5 text-neutral-500">{row.unit.scopeContent || '—'}</span>
          </div>
          <div className={cellClass} style={{ width: columns[5].width }}>{row.unit.date.display || row.item.year || '—'}</div>
          <div className={cellClass} style={{ width: columns[6].width }}><span className="truncate">{row.unit.creatorDisplay || '—'}</span></div>
          <div className={`${cellClass} font-mono`} style={{ width: columns[7].width }}><span className="truncate">{row.unit.referenceCode || '—'}</span></div>
          <div className={cellClass} style={{ width: columns[8].width }}><span className="truncate">{row.repositoryName || t('Procedencia por completar')}</span></div>
          <div className={cellClass} style={{ width: columns[9].width }}>{t(LEVEL_LABELS[row.unit.level])}</div>
          <div className={`${cellClass} gap-1`} style={{ width: columns[10].width }}>
            <CompactValues values={row.item.folderIds.map((id) => collectionNames.get(id)).filter((value): value is string => Boolean(value))} />
          </div>
          <div className={`${cellClass} gap-1`} style={{ width: columns[11].width }}><CompactValues values={row.item.tags} /></div>
          <div className={cellClass} style={{ width: columns[12].width }}><AccessBadge row={row} /></div>
          <div className={cellClass} style={{ width: columns[13].width }}>{t(SENSITIVITY_LABELS[row.profile.sensitivity])}</div>
          <div className={cellClass} style={{ width: columns[14].width }}>{t(PROCESSING_LABELS[row.profile.processingStatus])}</div>
          <div className={`${cellClass} justify-center tabular-nums`} style={{ width: columns[15].width }}>
            <span title={t('Másteres')}>{row.masterCount}</span>
            <span className="text-neutral-300 dark:text-neutral-700">/</span>
            <span title={t('Derivados')}>{row.derivativeCount}</span>
            <span className="text-neutral-300 dark:text-neutral-700">/</span>
            <span title={t('Versiones de texto')}>{row.textVersionCount}</span>
          </div>
          <div className={cellClass} style={{ width: columns[16].width }}>
            <span className="truncate">
              {row.profile.provenancePlaceId
                ? placeNames.get(row.profile.provenancePlaceId) ?? t('Lugar no disponible')
                : t('Sin lugar de procedencia')}
            </span>
          </div>
          <div className={cellClass} style={{ width: columns[17].width }}>
            {new Date(row.item.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArchiveTablePreview({ row }: { row: PrimarySourceArchiveRow }) {
  const [failed, setFailed] = useState(false);
  const file = row.previewFile;
  useEffect(() => setFailed(false), [file?.fileId, file?.contentHash]);
  if (!file || failed) {
    return (
      <span className="grid h-10 w-12 place-items-center rounded-lg bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
        <Icon name={archiveDocumentIcon(row.profile.metadata, row.item.docType, row.item.kind)} size={17} />
      </span>
    );
  }
  return (
    <img
      src={archiveFileUrl(file)}
      alt=""
      className="h-11 w-14 rounded-lg border border-neutral-200 object-cover shadow-sm dark:border-neutral-700"
      loading="lazy"
      decoding="async"
      data-testid={`primary-source-thumbnail-${row.item.itemId}`}
      onError={() => setFailed(true)}
    />
  );
}

function typedMetadataSummary(row: PrimarySourceArchiveRow): string {
  const definition = getArchiveDocType(row.item.docType);
  if (!definition || !row.item.metadata) return '';
  return definition.fields
    .map((field) => {
      const value = row.item.metadata?.[field.key]?.trim();
      return value ? `${t(field.label)}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

function CompactValues({ values }: { values: string[] }) {
  if (!values.length) return <span className="text-neutral-400">—</span>;
  return (
    <span className="line-clamp-2 leading-5" title={values.join(' · ')}>
      {values.map((value) => (
        <span key={value} className="mr-1 inline-flex rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
          {value}
        </span>
      ))}
    </span>
  );
}

function ArchiveGallery({
  rows,
  selected,
  onToggle,
  onOpen,
}: {
  rows: PrimarySourceArchiveRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (row: PrimarySourceArchiveRow) => void;
}) {
  if (rows.length === 0) return <FilteredEmpty />;
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((row) => (
        <article key={row.item.itemId} className="group overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="relative grid aspect-[16/9] place-items-center overflow-hidden bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-950">
            <ArchiveGalleryPreview row={row} />
            <label className="absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-md bg-white/90 shadow dark:bg-neutral-900/90">
              <input type="checkbox" checked={selected.has(row.item.itemId)} onChange={() => onToggle(row.item.itemId)} aria-label={t('Seleccionar {title}').replace('{title}', row.item.title)} />
            </label>
            <span className="absolute bottom-3 right-3 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white">{row.masterCount} {t('máster')}</span>
          </div>
          <button className="block w-full p-4 text-left" onClick={() => onOpen(row)}>
            <p className="truncate font-medium">{row.item.title}</p>
            <p className="mt-1 truncate text-xs text-neutral-500">{row.unit.referenceCode || t('Sin signatura')} · {row.repositoryName || t('Procedencia por completar')}</p>
            <div className="mt-3 flex items-center justify-between gap-2"><AccessBadge row={row} /><span className="text-xs text-neutral-500">{row.unit.date.display || t('Sin fecha')}</span></div>
          </button>
        </article>
      ))}
    </div>
  );
}

function ArchiveGalleryPreview({ row }: { row: PrimarySourceArchiveRow }) {
  const [failed, setFailed] = useState(false);
  const file = row.previewFile;
  useEffect(() => setFailed(false), [file?.fileId, file?.contentHash]);
  if (!file || failed) {
    return <Icon name={fileKindIcon(row.item.kind)} size={34} className="text-neutral-400" />;
  }
  const alternativeText = typeof file.captureMetadata?.alternativeText === 'string'
    ? file.captureMetadata.alternativeText
    : row.item.title;
  return (
    <img
      src={archiveFileUrl(file)}
      alt={alternativeText}
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function HierarchyCanvas({
  units,
  rows,
  onOpen,
}: {
  units: ArchiveDescriptionUnit[];
  rows: PrimarySourceArchiveRow[];
  onOpen: (row: PrimarySourceArchiveRow) => void;
}) {
  return (
    <div className="mx-auto max-w-5xl p-5">
      {unitChildren(units, null).map((root) => (
        <HierarchyBranch key={root.unitId} unit={root} units={units} rows={rows} onOpen={onOpen} depth={0} />
      ))}
      {units.length === 0 && <FilteredEmpty />}
    </div>
  );
}

function HierarchyBranch({
  unit,
  units,
  rows,
  onOpen,
  depth,
}: {
  unit: ArchiveDescriptionUnit;
  units: ArchiveDescriptionUnit[];
  rows: PrimarySourceArchiveRow[];
  onOpen: (row: PrimarySourceArchiveRow) => void;
  depth: number;
}) {
  const attached = rows.filter((row) => row.unit.unitId === unit.unitId);
  const children = unitChildren(units, unit.unitId);
  return (
    <section className={`${depth ? 'ml-5 border-l border-neutral-200 pl-4 dark:border-neutral-800' : 'mb-4'}`}>
      <div className="mb-2 flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <Icon name={unit.level === 'item' ? 'book' : 'folder'} className="mt-0.5 text-indigo-500" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t(LEVEL_LABELS[unit.level])}</p>
          <h3 className="truncate text-sm font-medium">{unit.title}</h3>
          {(unit.referenceCode || unit.date.display) && <p className="mt-0.5 text-xs text-neutral-500">{[unit.referenceCode, unit.date.display].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      {attached.map((row) => (
        <button key={row.item.itemId} className="mb-2 ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-left text-xs text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200" onClick={() => onOpen(row)}>
          <Icon name={fileKindIcon(row.item.kind)} size={13} /> <span className="truncate">{row.item.title}</span>
        </button>
      ))}
      {children.map((child) => <HierarchyBranch key={child.unitId} unit={child} units={units} rows={rows} onOpen={onOpen} depth={depth + 1} />)}
    </section>
  );
}

function AccessBadge({ row }: { row: PrimarySourceArchiveRow }) {
  const restricted = row.profile.accessStatus === 'restricted' || row.profile.accessStatus === 'embargoed';
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${restricted ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>
      <Icon name={restricted ? 'shield' : 'check'} size={11} />
      <span className="truncate">{t(ACCESS_LABELS[row.profile.accessStatus])}</span>
    </span>
  );
}

function FilteredEmpty() {
  return <div className="grid min-h-[20rem] place-items-center p-6 text-sm text-neutral-500">{t('Ninguna fuente coincide con la vista actual.')}</div>;
}

function DialogShell({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <ModalBackdrop onClose={onClose}>
      <section className={`card-modal flex max-h-[92vh] w-full flex-col overflow-hidden ${wide ? 'max-w-6xl' : 'max-w-2xl'}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-start gap-3 border-b border-neutral-200 p-5 dark:border-neutral-800">
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}</div>
          <button className="btn btn-ghost p-2" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </section>
    </ModalBackdrop>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-4 text-neutral-500">{hint}</span>}
    </label>
  );
}

function IngestModal({
  workspace,
  onClose,
  onComplete,
}: {
  workspace: PrimarySourceArchiveWorkspace;
  onClose: () => void;
  onComplete: (result: Awaited<ReturnType<typeof window.nodus.ingestPrimarySources>>) => void;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [documentMetadata, setDocumentMetadata] = useState<Record<string, string>>({});
  const [documentIcon, setDocumentIcon] = useState(() => suggestedArchiveDocumentIcon(null));
  const [repositoryId, setRepositoryId] = useState('');
  const [parentUnitId, setParentUnitId] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [creator, setCreator] = useState('');
  const [dateDisplay, setDateDisplay] = useState('');
  const [captureSessionId, setCaptureSessionId] = useState('');
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [accessStatus, setAccessStatus] = useState<PrimarySourceIngestInput['accessStatus']>('unknown');
  const [sensitivity, setSensitivity] = useState<PrimarySourceIngestInput['sensitivity']>('normal');
  const [place, setPlace] = useState<GazetteerPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    const selected = await window.nodus.choosePrimarySourceFiles();
    if (selected.length) {
      setPaths(selected);
      if (selected.length === 1 && !title) setTitle(selected[0].split(/[\\/]/).pop() ?? '');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (paths.length === 0) {
      setError(t('Selecciona uno o más archivos.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const template = workspace.templates.find((candidate) => candidate.templateId === templateId);
      const result = await window.nodus.ingestPrimarySources({
        paths,
        title: paths.length === 1 ? title : null,
        description,
        documentType: documentType ?? template?.documentType ?? null,
        documentMetadata,
        documentIcon,
        templateId: templateId || null,
        repositoryId: repositoryId || null,
        parentUnitId: parentUnitId || null,
        referenceCode,
        creatorDisplay: creator,
        dateDisplay,
        captureSessionId: captureSessionId || null,
        collectionIds,
        accessStatus,
        sensitivity,
        place,
      });
      onComplete(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title={t('Añadir fuentes')} subtitle={t('El máster se conserva, se calcula su checksum y la descripción queda separada de tus colecciones.')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-secondary gap-2" onClick={() => void choose()}><Icon name="folder" /> {paths.length ? t('Cambiar archivos') : t('Elegir archivos')}</button>
            <span className="text-xs text-neutral-500">{paths.length ? t('{n} archivos seleccionados').replace('{n}', String(paths.length)) : t('PDF, imágenes, texto, datos, audio o vídeo')}</span>
          </div>
          {paths.length > 0 && <ul className="mt-3 max-h-24 overflow-y-auto text-xs text-neutral-600 dark:text-neutral-400">{paths.map((path) => <li key={path} className="truncate py-0.5">{path.split(/[\\/]/).pop()}</li>)}</ul>}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/25">
          <h3 className="mb-3 text-sm font-semibold">{t('1. Información básica')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('Plantilla de descripción')}>
            <select
              className="input w-full"
              value={templateId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextTemplate = workspace.templates.find((candidate) => candidate.templateId === nextId);
                setTemplateId(nextId);
                if (nextTemplate?.documentType) {
                  setDocumentType(nextTemplate.documentType);
                  setDocumentMetadata({});
                  setDocumentIcon(suggestedArchiveDocumentIcon(nextTemplate.documentType));
                }
              }}
            >
              <option value="">{t('Descripción general')}</option>
              {workspace.templates.map((template) => <option key={template.templateId} value={template.templateId}>{t(template.name)}</option>)}
            </select>
          </Field>
          <Field label={t('Título')} hint={paths.length > 1 ? t('En un lote se conserva el nombre individual de cada archivo.') : undefined}>
            <input className="input w-full" value={title} onChange={(event) => setTitle(event.target.value)} disabled={paths.length > 1} />
          </Field>
          </div>
          <div className="mt-4">
            <Field label={t('Alcance y contenido')}>
              <textarea className="input min-h-20 w-full resize-y" value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/25" data-testid="primary-source-ingest-classification">
          <h3 className="mb-3 text-sm font-semibold">{t('2. Clasificación documental')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('Tipo de documento')}>
              <DocTypeSelect
                value={documentType}
                onChange={(value) => {
                  setDocumentType(value);
                  setDocumentMetadata({});
                  setDocumentIcon(suggestedArchiveDocumentIcon(value));
                }}
                emptyLabel="Elegir tipo de documento…"
              />
            </Field>
            <Field label={t('Icono')}>
              <DocumentIconPicker
                value={documentIcon}
                suggested={suggestedArchiveDocumentIcon(documentType)}
                onChange={setDocumentIcon}
              />
            </Field>
          </div>
          {getArchiveDocType(documentType) && (
            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
              <DocTypeForm
                docType={documentType}
                values={documentMetadata}
                onChange={(key, value) => setDocumentMetadata((current) => ({ ...current, [key]: value }))}
              />
            </div>
          )}
        </section>

        <fieldset className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <legend className="px-2 text-sm font-semibold">{t('3. Ubicación archivística')}</legend>
          <p className="mb-4 text-xs text-neutral-500">{t('No es una carpeta personal: conserva dónde vive intelectualmente la fuente.')}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('Repositorio')}>
              <select className="input w-full" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                <option value="">{t('Procedencia por completar')}</option>
                {workspace.repositories.map((repository) => <option key={repository.repositoryId} value={repository.repositoryId}>{repository.name}</option>)}
              </select>
            </Field>
            <Field label={t('Unidad padre')}>
              <select className="input w-full" value={parentUnitId} onChange={(event) => setParentUnitId(event.target.value)}>
                <option value="">{t('Asignar automáticamente')}</option>
                {workspace.units.filter((unit) => unit.level !== 'item').map((unit) => <option key={unit.unitId} value={unit.unitId}>{unit.referenceCode ? `${unit.referenceCode} · ` : ''}{unit.title}</option>)}
              </select>
            </Field>
            <Field label={t('Signatura')}><input className="input w-full" value={referenceCode} onChange={(event) => setReferenceCode(event.target.value)} /></Field>
            <Field label={t('Creador documental')}><input className="input w-full" value={creator} onChange={(event) => setCreator(event.target.value)} /></Field>
            <Field label={t('Fecha tal como aparece')}><input className="input w-full" value={dateDisplay} onChange={(event) => setDateDisplay(event.target.value)} /></Field>
            <Field label={t('Sesión de captura')}>
              <select className="input w-full" value={captureSessionId} onChange={(event) => setCaptureSessionId(event.target.value)}>
                <option value="">{t('Sin sesión')}</option>
                {workspace.sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.title}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <legend className="px-2 text-sm font-semibold">{t('Lugar de procedencia')}</legend>
          <p className="mb-4 text-xs text-neutral-500">
            {t('Busca y selecciona el lugar donde se originó la fuente. Las ciudades mencionadas dentro del documento no se añadirán al mapa de procedencia.')}
          </p>
          {place ? (
            <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-900 dark:bg-indigo-950/40">
              <Icon name="map" className="shrink-0 text-indigo-600 dark:text-indigo-300" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{place.name}</p>
                <p className="truncate text-[11px] text-neutral-500">
                  {[place.admin1, place.country].filter(Boolean).join(', ')} · {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}
                </p>
              </div>
              <button type="button" className="btn btn-ghost p-2" onClick={() => setPlace(null)} aria-label={t('Quitar lugar')}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : (
            <PlacePicker onPick={setPlace} />
          )}
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('Acceso')}>
            <select className="input w-full" value={accessStatus} onChange={(event) => setAccessStatus(event.target.value as PrimarySourceIngestInput['accessStatus'])}>
              {Object.entries(ACCESS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
          <Field label={t('Sensibilidad')}>
            <select className="input w-full" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as PrimarySourceIngestInput['sensitivity'])}>
              {Object.entries(SENSITIVITY_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
        </div>

        <Field label={t('Colecciones de trabajo')} hint={t('Puedes cambiar estas agrupaciones sin alterar la procedencia.')}>
          <div className="flex flex-wrap gap-2">
            {workspace.collections.length === 0 ? <span className="text-xs text-neutral-500">{t('Aún no hay colecciones.')}</span> : workspace.collections.map((collection) => (
              <label key={collection.folderId} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-700">
                <input type="checkbox" checked={collectionIds.includes(collection.folderId)} onChange={(event) => setCollectionIds((current) => event.target.checked ? [...current, collection.folderId] : current.filter((id) => id !== collection.folderId))} />
                {collection.name}
              </label>
            ))}
          </div>
        </Field>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('Cancelar')}</button>
          <button type="submit" className="btn btn-primary gap-2" disabled={busy}><Icon name="upload" /> {busy ? t('Importando y verificando…') : t('Importar fuentes')}</button>
        </div>
      </form>
    </DialogShell>
  );
}

function UnitModal({
  workspace,
  onClose,
  onComplete,
}: {
  workspace: PrimarySourceArchiveWorkspace;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [input, setInput] = useState<PrimarySourceUnitCreateInput>({ title: '', level: 'series' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.title.trim()) return;
    setBusy(true);
    try {
      await window.nodus.createPrimarySourceUnit(input);
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title={t('Nueva unidad archivística')} subtitle={t('Crea fondo, serie, expediente u otra unidad aunque todavía no tengas un archivo digital.')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t('Título')}><input autoFocus required className="input w-full" value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Nivel')}>
            <select className="input w-full" value={input.level} onChange={(event) => setInput({ ...input, level: event.target.value as PrimarySourceUnitCreateInput['level'] })}>
              {Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
          <Field label={t('Signatura')}><input className="input w-full" value={input.referenceCode ?? ''} onChange={(event) => setInput({ ...input, referenceCode: event.target.value })} /></Field>
          <Field label={t('Repositorio')}>
            <select className="input w-full" value={input.repositoryId ?? ''} onChange={(event) => setInput({ ...input, repositoryId: event.target.value || null })}>
              <option value="">{t('Sin repositorio')}</option>
              {workspace.repositories.map((repository) => <option key={repository.repositoryId} value={repository.repositoryId}>{repository.name}</option>)}
            </select>
          </Field>
          <Field label={t('Unidad padre')}>
            <select className="input w-full" value={input.parentUnitId ?? ''} onChange={(event) => setInput({ ...input, parentUnitId: event.target.value || null })}>
              <option value="">{t('Nivel raíz')}</option>
              {workspace.units.map((unit) => <option key={unit.unitId} value={unit.unitId}>{unit.referenceCode ? `${unit.referenceCode} · ` : ''}{unit.title}</option>)}
            </select>
          </Field>
          <Field label={t('Creador documental')}><input className="input w-full" value={input.creatorDisplay ?? ''} onChange={(event) => setInput({ ...input, creatorDisplay: event.target.value })} /></Field>
          <Field label={t('Fecha tal como aparece')}><input className="input w-full" value={input.dateDisplay ?? ''} onChange={(event) => setInput({ ...input, dateDisplay: event.target.value })} /></Field>
        </div>
        <Field label={t('Alcance y contenido')}><textarea className="input min-h-20 w-full" value={input.scopeContent ?? ''} onChange={(event) => setInput({ ...input, scopeContent: event.target.value })} /></Field>
        {input.level === 'local' && <Field label={t('Nombre del nivel local')}><input required className="input w-full" value={input.localLevelLabel ?? ''} onChange={(event) => setInput({ ...input, localLevelLabel: event.target.value })} /></Field>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy}>{busy ? t('Creando…') : t('Crear unidad')}</button></div>
      </form>
    </DialogShell>
  );
}

function OrganizeModal({
  workspace,
  onClose,
  onChanged,
}: {
  workspace: PrimarySourceArchiveWorkspace;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryShort, setRepositoryShort] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionRepository, setSessionRepository] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<'repository' | 'session' | 'collection' | 'template' | null>(null);
  const actionButtonClass = 'btn btn-primary h-10 w-full cursor-pointer gap-2 border border-indigo-600 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none disabled:hover:bg-neutral-100 dark:focus-visible:ring-offset-neutral-900 dark:disabled:border-neutral-700 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500 dark:disabled:hover:bg-neutral-800';
  const run = async (
    action: NonNullable<typeof busyAction>,
    work: () => Promise<unknown>,
    success: string,
    clear: () => void,
  ) => {
    if (busyAction) return;
    setBusyAction(action);
    setMessage('');
    setError('');
    try {
      await work();
      clear();
      setMessage(success);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(null);
    }
  };
  return (
    <DialogShell title={t('Organizar Archivo')} subtitle={t('Repositorios, sesiones y colecciones son vocabularios distintos.')} onClose={onClose} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <OrganizeCard title={t('Repositorios')} body={t('Autoridad que custodia o publica la fuente.')}>
          <input data-testid="primary-sources-repository-name" className="input w-full" placeholder={t('Nombre del repositorio')} value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} />
          <input data-testid="primary-sources-repository-short-name" className="input w-full" placeholder={t('Abreviatura')} value={repositoryShort} onChange={(event) => setRepositoryShort(event.target.value)} />
          <button
            type="button"
            data-testid="primary-sources-create-repository"
            className={actionButtonClass}
            disabled={!repositoryName.trim() || busyAction !== null}
            aria-busy={busyAction === 'repository'}
            onClick={() => void run(
              'repository',
              () => window.nodus.createPrimarySourceRepository({ name: repositoryName, shortName: repositoryShort || null }),
              t('Repositorio creado.'),
              () => { setRepositoryName(''); setRepositoryShort(''); },
            )}
          >
            <Icon name={busyAction === 'repository' ? 'sync' : 'plus'} size={14} className={busyAction === 'repository' ? 'animate-spin' : ''} />
            {busyAction === 'repository' ? t('Creando…') : t('Crear repositorio')}
          </button>
          <p className="text-xs text-neutral-500">{t('{n} repositorios').replace('{n}', String(workspace.repositories.length))}</p>
        </OrganizeCard>
        <OrganizeCard title={t('Sesiones de captura')} body={t('Agrupa una consulta, descarga o campaña de digitalización.')}>
          <input data-testid="primary-sources-session-title" className="input w-full" placeholder={t('Título de la sesión')} value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
          <select data-testid="primary-sources-session-repository" className="input w-full" value={sessionRepository} onChange={(event) => setSessionRepository(event.target.value)}>
            <option value="">{t('Sin repositorio')}</option>
            {workspace.repositories.map((repository) => <option key={repository.repositoryId} value={repository.repositoryId}>{repository.name}</option>)}
          </select>
          <button
            type="button"
            data-testid="primary-sources-create-session"
            className={actionButtonClass}
            disabled={!sessionTitle.trim() || busyAction !== null}
            aria-busy={busyAction === 'session'}
            onClick={() => void run(
              'session',
              () => window.nodus.createPrimarySourceCaptureSession({ title: sessionTitle, repositoryId: sessionRepository || null, sessionKind: 'consultation' }),
              t('Sesión creada.'),
              () => setSessionTitle(''),
            )}
          >
            <Icon name={busyAction === 'session' ? 'sync' : 'plus'} size={14} className={busyAction === 'session' ? 'animate-spin' : ''} />
            {busyAction === 'session' ? t('Creando…') : t('Crear sesión')}
          </button>
          <p className="text-xs text-neutral-500">{t('{n} sesiones').replace('{n}', String(workspace.sessions.length))}</p>
        </OrganizeCard>
        <OrganizeCard title={t('Colecciones de trabajo')} body={t('Agrupación personal que nunca altera la jerarquía archivística.')}>
          <input data-testid="primary-sources-collection-name" className="input w-full" placeholder={t('Nombre de la colección')} value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
          <button
            type="button"
            data-testid="primary-sources-create-collection"
            className={actionButtonClass}
            disabled={!collectionName.trim() || busyAction !== null}
            aria-busy={busyAction === 'collection'}
            onClick={() => void run(
              'collection',
              () => window.nodus.createPrimarySourceCollection(collectionName),
              t('Colección creada.'),
              () => setCollectionName(''),
            )}
          >
            <Icon name={busyAction === 'collection' ? 'sync' : 'plus'} size={14} className={busyAction === 'collection' ? 'animate-spin' : ''} />
            {busyAction === 'collection' ? t('Creando…') : t('Crear colección')}
          </button>
          <p className="text-xs text-neutral-500">{t('{n} colecciones').replace('{n}', String(workspace.collections.length))}</p>
        </OrganizeCard>
        <OrganizeCard title={t('Plantillas')} body={t('Preconfigura campos repetidos sin ocultar la descripción archivística.')}>
          <input data-testid="primary-sources-template-name" className="input w-full" placeholder={t('Nombre de la plantilla')} value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
          <button
            type="button"
            data-testid="primary-sources-create-template"
            className={actionButtonClass}
            disabled={!templateName.trim() || busyAction !== null}
            aria-busy={busyAction === 'template'}
            onClick={() => void run(
              'template',
              () => window.nodus.createPrimarySourceDescriptionTemplate({ name: templateName, defaultLevel: 'item' }),
              t('Plantilla creada.'),
              () => setTemplateName(''),
            )}
          >
            <Icon name={busyAction === 'template' ? 'sync' : 'plus'} size={14} className={busyAction === 'template' ? 'animate-spin' : ''} />
            {busyAction === 'template' ? t('Creando…') : t('Crear plantilla')}
          </button>
          <p className="text-xs text-neutral-500">{t('{n} plantillas').replace('{n}', String(workspace.templates.length))}</p>
        </OrganizeCard>
      </div>
      {message && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="mt-5 flex justify-end"><button className="btn btn-primary" onClick={onClose}>{t('Listo')}</button></div>
    </DialogShell>
  );
}

function OrganizeCard({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{title}</h3><p className="text-xs leading-5 text-neutral-500">{body}</p>{children}</section>;
}

function BulkEditModal({
  itemIds,
  sessions,
  collections,
  onClose,
  onComplete,
}: {
  itemIds: string[];
  sessions: PrimarySourceArchiveWorkspace['sessions'];
  collections: PrimarySourceArchiveWorkspace['collections'];
  onClose: () => void;
  onComplete: (count: number) => void;
}) {
  const [patch, setPatch] = useState<PrimarySourceBulkPatch>({});
  const [tags, setTags] = useState('');
  const [replaceCollections, setReplaceCollections] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<PrimarySourceBulkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = () => setPreview(null);
  const buildPatch = (): PrimarySourceBulkPatch => ({
    ...patch,
    addTags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    ...(replaceCollections ? { collectionIds } : {}),
  });
  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await window.nodus.previewPrimarySourceBulkEdit(itemIds));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await window.nodus.applyPrimarySourceBulkEdit({
        itemIds: preview.itemIds.filter((id) => !preview.missing.includes(id)),
        patch: buildPatch(),
        expectedRevisions: preview.revisions,
      });
      onComplete(rows.length);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title={t('Edición masiva segura')} subtitle={t('Primero revisa cuántas fuentes cambiarán; Nodus aborta si alguna se modifica antes de confirmar.')} onClose={onClose}>
      <div className="space-y-4" onChange={changed}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Acceso')}>
            <select className="input w-full" value={patch.accessStatus ?? ''} onChange={(event) => setPatch({ ...patch, accessStatus: event.target.value ? event.target.value as PrimarySourceBulkPatch['accessStatus'] : undefined })}>
              <option value="">{t('No cambiar')}</option>{Object.entries(ACCESS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
          <Field label={t('Sensibilidad')}>
            <select className="input w-full" value={patch.sensitivity ?? ''} onChange={(event) => setPatch({ ...patch, sensitivity: event.target.value ? event.target.value as PrimarySourceBulkPatch['sensitivity'] : undefined })}>
              <option value="">{t('No cambiar')}</option>{Object.entries(SENSITIVITY_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
          <Field label={t('Estado de procesamiento')}>
            <select className="input w-full" value={patch.processingStatus ?? ''} onChange={(event) => setPatch({ ...patch, processingStatus: event.target.value ? event.target.value as PrimarySourceBulkPatch['processingStatus'] : undefined })}>
              <option value="">{t('No cambiar')}</option>
              {Object.entries(PROCESSING_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </Field>
          <Field label={t('Sesión de captura')}>
            <select className="input w-full" value={patch.captureSessionId ?? ''} onChange={(event) => setPatch({ ...patch, captureSessionId: event.target.value || undefined })}>
              <option value="">{t('No cambiar')}</option>{sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.title}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('Añadir etiquetas')} hint={t('Separadas por comas; no se borran las existentes.')}><input className="input w-full" value={tags} onChange={(event) => setTags(event.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replaceCollections} onChange={(event) => { setReplaceCollections(event.target.checked); changed(); }} /> {t('Reemplazar colecciones de trabajo')}</label>
        {replaceCollections && <div className="flex flex-wrap gap-2">{collections.map((collection) => <label key={collection.folderId} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-700"><input type="checkbox" checked={collectionIds.includes(collection.folderId)} onChange={(event) => setCollectionIds((current) => event.target.checked ? [...current, collection.folderId] : current.filter((id) => id !== collection.folderId))} />{collection.name}</label>)}</div>}
        {preview && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"><p className="font-medium text-emerald-800 dark:text-emerald-200">{t('{n} fuentes se actualizarán').replace('{n}', String(preview.affected))}</p>{preview.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-700">{t(warning)}</p>)}</div>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={onClose}>{t('Cancelar')}</button>{preview ? <button className="btn btn-primary" disabled={busy || preview.affected === 0} onClick={() => void apply()}>{busy ? t('Aplicando…') : t('Confirmar cambios')}</button> : <button className="btn btn-primary" disabled={busy} onClick={() => void prepare()}>{busy ? t('Preparando…') : t('Vista previa')}</button>}</div>
      </div>
    </DialogShell>
  );
}
