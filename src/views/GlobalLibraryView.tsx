import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { MultiSelectDropdown } from '../components/library/MultiSelectDropdown';
import type {
  LibraryCatalogItem,
  LibraryCollectionView,
  LibraryExtractionJob,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryMigrationPreview,
  LibraryMigrationProgress,
  LibraryMigrationSession,
  LibraryScope,
  LibraryStatus,
  LibraryVaultLink,
  LibrarySavedSearchRecord,
  LibraryCatalogFacets,
  LibraryColumnId,
  LibrarySortField,
  LibraryViewPreferences,
  LibraryItemType,
  LibraryCollectionIcon,
  GlobalLibrarySettings,
  ZoteroImportProgress,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  ZoteroSyncSession,
  ZoteroImportVerificationMismatch,
} from '@shared/libraryTypes';
import type { AppSettings, LibraryReaderReference, VaultSummary, VaultType } from '@shared/types';
import { isPreviewVaultType } from '@shared/vaultTypes';
import { Icon, Spinner } from '../components/ui';
import { PreviewBadge, VaultPhaseBadge, VAULT_TYPE_COLOR, vaultTypeIcon, vaultTypeLabel, vaultTypePhase } from '../components/vaultTypeUi';
import { LibraryCitationExportDialog, LibraryCreateReferenceDialog, LibraryDuplicatesDialog, LibraryMetadataBatchDialog, LibraryMetadataEditor } from '../components/library/LibraryMetadataDialogs';
import { LibraryItemManager } from '../components/library/LibraryItemManager';
import { LibrarySettingsDialog } from '../components/library/LibrarySettingsDialog';
import { LibraryWorkspaceTabs, libraryWorkspaceTabKey, type LibraryWorkspaceTab } from '../components/library/LibraryWorkspaceTabs';
import { LibrarySmartSearchDialog, LibraryTablePreferencesDialog } from '../components/library/LibrarySmartSearchDialog';
import { LibraryRecoveryDialog, LibraryTrashImpactDialog } from '../components/library/LibraryRecoveryDialogs';
import { LibraryDocumentReader } from './LibraryDocumentReader';
import { VirtualList } from '../components/VirtualList';
import { confirm, promptText, toast } from '../components/feedback';
import { errorText, t, tr, tx } from '../i18n';
import { zoteroConnectionHint, zoteroFailureText } from '../lib/zoteroConnection';
import { notifyDataChanged, useDismissableLayer } from '../hooks';
import { invalidateVaultQueryCache } from '../vaultQueryCache';
import type { PendingAssistantNavigationTarget } from '../navigation';
import type { PendingLibraryNavigationTarget } from '../navigation';
import type { LibraryGlobalSnapshot, LibrarySnapshot, ListPlacement } from '../app/viewSnapshots';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Library } from './Library';
import { LibraryTutorialModal, libraryTutorialSeen, markLibraryTutorialSeen, type LibraryTutorialTab } from '../components/LibraryTutorialModal';
import { LIBRARY_COLUMN_BY_ID, libraryItemTypeLabel } from '@shared/libraryBibliography';
import { DEFAULT_GLOBAL_LIBRARY_SETTINGS } from '@shared/libraryAttachmentNaming';

const PAGE_SIZE = 250;
const LIBRARY_COLLECTION_PANE_RATIO_KEY = 'nodus.library.collectionsPaneRatio';
const DEFAULT_LIBRARY_COLLECTION_PANE_RATIO = 48;
const MIN_LIBRARY_COLLECTION_PANE_RATIO = 22;
const MAX_LIBRARY_COLLECTION_PANE_RATIO = 76;

function clampCollectionPaneRatio(value: number): number {
  return Math.min(MAX_LIBRARY_COLLECTION_PANE_RATIO, Math.max(MIN_LIBRARY_COLLECTION_PANE_RATIO, Math.round(value)));
}
const TRASH_SEARCH = { id: 'library-trash', mode: 'all' as const, rules: [{ id: 'library-trash-only', field: 'trash' as const, operator: 'is-true' as const, value: true }] };

const SOURCE_LABEL: Record<LibraryItemSource, string> = {
  nodus: 'Nodus', zotero: 'Zotero', mendeley: 'Mendeley', ris: 'RIS', bibtex: 'BibTeX',
  biblatex: 'BibLaTeX', 'csl-json': 'CSL JSON', 'endnote-xml': 'EndNote XML',
  'zotero-rdf': 'Zotero RDF', csv: 'CSV', markdown: 'Markdown', legacy: 'Legado',
  compass: 'Nodus Compass',
};

const EXTRACTION_LABEL: Record<LibraryCatalogItem['extractionStatus'], string> = {
  pending: 'Pendiente', processing: 'Procesando…', ready: 'Lista', 'needs-review': 'Revisar', failed: 'Con error', unsupported: 'No compatible',
};

function preparationPhaseLabel(job: LibraryExtractionJob): string {
  if (job.phase === 'queued') return 'En espera…';
  if (job.phase === 'ocr') return 'Reconociendo texto…';
  if (job.phase === 'assets') return 'Recuperando imágenes y tablas…';
  if (job.phase === 'write') return 'Guardando la versión limpia…';
  return 'Preparando lectura…';
}

function friendlyExtractionError(error?: string | null): string {
  if (!error) return 'No se pudo preparar la lectura. El original se conserva sin cambios.';
  if (/sin extensión|no compatible|unsupported/i.test(error)) return 'Nodus no reconoce el formato de este archivo. Puedes sustituirlo o añadir otro adjunto compatible.';
  if (/no tiene un original|no está disponible|missing|enoent/i.test(error)) return 'El archivo original no está disponible en este dispositivo. Añádelo de nuevo para preparar la lectura.';
  if (/texto ni contenido legible|muy poco texto|empty/i.test(error)) return 'No se encontró suficiente contenido legible. Puedes abrir el original o revisar las opciones de OCR.';
  return 'La versión limpia no pudo prepararse. El original y la última copia legible siguen intactos.';
}

const REUSE_COMPONENT_LABELS = {
  light: 'Light', deep: 'Deep', summary: 'Resumen', ideas: 'Ideas', passages: 'Pasajes', embeddings: 'Embeddings',
} as const;

const EMPTY_FACETS: LibraryCatalogFacets = { sources: [], itemTypes: [], extraction: [], attachments: [], years: [], tags: [], vaults: [] };
const DEFAULT_VIEW_PREFERENCES: LibraryViewPreferences = {
  visibleColumns: ['title', 'creator', 'year', 'source', 'status'],
  columnWidths: {},
  sort: [{ field: 'updatedAt', direction: 'desc' }, { field: 'title', direction: 'asc' }],
};
const COLUMN_LABEL = Object.fromEntries(Object.entries(LIBRARY_COLUMN_BY_ID).map(([id, column]) => [id, column.label])) as Record<LibraryColumnId, string>;
const COLUMN_WIDTH = Object.fromEntries(Object.entries(LIBRARY_COLUMN_BY_ID).map(([id, column]) => [id, column.width])) as Record<LibraryColumnId, string>;
const COLUMN_SORT = Object.fromEntries(Object.entries(LIBRARY_COLUMN_BY_ID).flatMap(([id, column]) => column.sort ? [[id, column.sort]] : [])) as Partial<Record<LibraryColumnId, LibrarySortField>>;
const COLLECTION_ICONS: LibraryCollectionIcon[] = ['folder', 'book', 'bookmark', 'star', 'archive', 'notebook', 'graduation', 'flask', 'globe', 'map', 'users', 'tag'];
const COLLECTION_COLOR_PRESETS = [
  { id: 'indigo', value: '#6366f1' }, { id: 'sky', value: '#0ea5e9' }, { id: 'emerald', value: '#10b981' },
  { id: 'amber', value: '#f59e0b' }, { id: 'rose', value: '#f43f5e' }, { id: 'violet', value: '#8b5cf6' },
] as const;

function VaultReuseBadges({ link }: { link: LibraryVaultLink }) {
  if (!link.analysis.reuse) return null;
  return <div data-testid={`vault-reuse-${link.vaultId}`} className="mt-2 grid grid-cols-2 gap-1">
    {Object.entries(link.analysis.reuse).map(([component, status]) => <span
      key={component}
      title={status.reason}
      className={`flex min-w-0 items-center justify-between gap-1 rounded px-1.5 py-1 text-[9px] ${
        status.state === 'reused' || status.state === 'current' ? 'bg-emerald-500/10 text-emerald-300'
          : status.state === 'incompatible' ? 'bg-amber-500/10 text-amber-300'
            : 'bg-neutral-900 text-neutral-500'
      }`}
    ><span className="truncate">{t(REUSE_COMPONENT_LABELS[component as keyof typeof REUSE_COMPONENT_LABELS])}</span><span aria-hidden="true">{status.state === 'reused' ? '↗' : status.state === 'current' ? '✓' : status.state === 'incompatible' ? '!' : '·'}</span></span>)}
  </div>;
}

function creatorText(item: LibraryCatalogItem): string {
  return item.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join('; ');
}

function catalogColumnText(item: LibraryCatalogItem, column: LibraryColumnId): string {
  if (column === 'creator') return creatorText(item) || '—';
  if (column === 'itemType') return t(libraryItemTypeLabel(item.itemType));
  if (column === 'year') return item.year == null ? '—' : String(item.year);
  if (column === 'citationKey') return item.citationKey ?? '—';
  if (column === 'attachments') return String(item.attachmentCount);
  if (column === 'createdAt' || column === 'updatedAt') return new Date(item[column]).toLocaleDateString();
  if (column === 'accessDate' || column === 'zoteroDateAdded' || column === 'zoteroDateModified') {
    const value = item.metadata[column];
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }
  if (column === 'isbn' || column === 'issn' || column === 'tags') return (item.metadata[column] ?? []).join('; ') || '—';
  const metadataValue = (item.metadata as unknown as Record<string, unknown>)[column];
  return metadataValue == null || metadataValue === '' ? '—' : String(metadataValue);
}

function collectionChildren(collections: LibraryCollectionView[]): Map<string | null, LibraryCollectionView[]> {
  const map = new Map<string | null, LibraryCollectionView[]>();
  for (const collection of collections) map.set(collection.parentId, [...(map.get(collection.parentId) ?? []), collection]);
  for (const entries of map.values()) entries.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return map;
}

function collectionSubtreeIds(collectionId: string, children: Map<string | null, LibraryCollectionView[]>): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const child of children.get(id) ?? []) visit(child.id);
  };
  visit(collectionId);
  return ids;
}

function flattenedCollections(children: Map<string | null, LibraryCollectionView[]>): Array<{ collection: LibraryCollectionView; depth: number }> {
  const entries: Array<{ collection: LibraryCollectionView; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const collection of children.get(parentId) ?? []) {
      entries.push({ collection, depth });
      visit(collection.id, depth + 1);
    }
  };
  visit(null, 0);
  return entries;
}

function normalizedCollectionSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}

/** Matching nodes stay in their original tree: every ancestor is retained as context. */
function collectionSearchIds(collections: LibraryCollectionView[], search: string): Set<string> | null {
  const query = normalizedCollectionSearch(search);
  if (!query) return null;
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const visible = new Set<string>();
  for (const collection of collections) {
    if (!normalizedCollectionSearch(collection.name).includes(query)) continue;
    let cursor: LibraryCollectionView | undefined = collection;
    while (cursor && !visible.has(cursor.id)) {
      visible.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  return visible;
}

function LibraryCollectionMoveDialog({
  collection,
  collections,
  onClose,
  onMove,
}: {
  collection: LibraryCollectionView;
  collections: LibraryCollectionView[];
  onClose: () => void;
  onMove: (parentId: string | null) => Promise<void>;
}) {
  const children = useMemo(() => collectionChildren(collections), [collections]);
  const excluded = useMemo(() => collectionSubtreeIds(collection.id, children), [children, collection.id]);
  const entries = useMemo(() => flattenedCollections(children), [children]);
  const [search, setSearch] = useState('');
  const visibleIds = useMemo(() => collectionSearchIds(collections, search), [collections, search]);
  const visibleEntries = useMemo(() => entries.filter(({ collection: entry }) => !visibleIds || visibleIds.has(entry.id)), [entries, visibleIds]);
  const [parentId, setParentId] = useState<string | null>(collection.parentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const move = async () => {
    if (parentId === collection.parentId || busy) return;
    setBusy(true); setError(null);
    try { await onMove(parentId); onClose(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section data-testid="library-collection-move-dialog" className="card-modal flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-800 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="library-collection-move-title">
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="route" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="library-collection-move-title" className="font-semibold">{t('Mover colección')}</h2>
            <p className="mt-1 truncate text-sm text-neutral-300">{collection.name}</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{t('Elige dónde debe quedar anidada. También puedes arrastrar la carpeta directamente en el árbol.')}</p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="shrink-0 border-b border-neutral-800 p-3">
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              data-testid="library-collection-move-search"
              className="input w-full"
              style={{ paddingInlineStart: '2.25rem' }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Buscar colección…')}
              autoFocus
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <button
            data-testid="library-collection-move-root"
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${parentId === null ? 'border-indigo-500/55 bg-indigo-500/10 text-indigo-200' : 'border-transparent text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200'}`}
            onClick={() => setParentId(null)}
            disabled={busy}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full border ${parentId === null ? 'border-indigo-400' : 'border-neutral-700'}`}>{parentId === null && <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />}</span>
            <Icon name="library" size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">{t('Nivel superior de la Biblioteca')}</span>
            {collection.parentId === null && <span className="text-[10px] text-neutral-500">{t('Destino actual')}</span>}
          </button>
          <div className="mt-1 space-y-0.5">
            {visibleEntries.map(({ collection: target, depth }) => {
              const unavailable = excluded.has(target.id) || target.source !== 'nodus';
              const active = parentId === target.id;
              return <button
                key={target.id}
                data-testid={`library-collection-move-target-${target.id}`}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${active ? 'border-indigo-500/55 bg-indigo-500/10 text-indigo-200' : 'border-transparent text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200'} disabled:cursor-not-allowed disabled:opacity-35`}
                style={{ paddingLeft: 12 + depth * 18 }}
                disabled={unavailable || busy}
                onClick={() => setParentId(target.id)}
                title={excluded.has(target.id) ? t('La colección actual y sus subcolecciones no pueden ser destino.') : target.source !== 'nodus' ? t('Las colecciones importadas son de solo lectura en Nodus.') : tx('Mover dentro de {name}', { name: target.name })}
              >
                <span aria-hidden="true" className="relative h-5 shrink-0" style={{ width: depth ? depth * 10 : 0 }}>{depth > 0 && <span className="absolute inset-y-0 right-0 w-2.5 rounded-bl border-b border-l border-neutral-700 opacity-70" />}</span>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? 'border-indigo-400' : 'border-neutral-700'}`}>{active && <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />}</span>
                <span className="shrink-0" style={{ color: target.color ?? undefined }}><Icon name={target.icon ?? 'folder'} size={15} /></span>
                <span className="min-w-0 flex-1 truncate">{target.name}</span>
                {target.id === collection.id && <span className="text-[10px] text-neutral-500">{t('Colección actual')}</span>}
                {target.source !== 'nodus' && <Icon name="lock" size={10} className="shrink-0" />}
                {target.id === collection.parentId && <span className="text-[10px] text-neutral-500">{t('Destino actual')}</span>}
              </button>;
            })}
            {visibleEntries.length === 0 && <p className="px-3 py-8 text-center text-sm text-neutral-500">{t('Sin colecciones.')}</p>}
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-neutral-800 p-4">
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
          <button data-testid="confirm-library-collection-move" className="btn btn-primary" disabled={busy || parentId === collection.parentId} onClick={() => void move()}>{busy ? <Spinner /> : <Icon name="route" />} {t('Mover aquí')}</button>
        </footer>
      </section>
    </div>
  );
}

/** Copy or move the selected documents into one Nodus collection, chosen from the tree. */
function LibraryBulkCollectionDialog({ mode, count, collections, currentId, onClose, onApply }: {
  mode: 'copy' | 'move';
  count: number;
  collections: LibraryCollectionView[];
  currentId: string | null;
  onClose: () => void;
  onApply: (targetId: string) => Promise<void>;
}) {
  const children = useMemo(() => collectionChildren(collections), [collections]);
  const entries = useMemo(() => flattenedCollections(children), [children]);
  const [search, setSearch] = useState('');
  const visibleIds = useMemo(() => collectionSearchIds(collections, search), [collections, search]);
  const visibleEntries = useMemo(() => entries.filter(({ collection: entry }) => !visibleIds || visibleIds.has(entry.id)), [entries, visibleIds]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const apply = async () => {
    if (!target || busy) return;
    setBusy(true); setError(null);
    try { await onApply(target); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const title = t(mode === 'copy' ? 'Copiar a una colección' : 'Mover a una colección');
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section data-testid="library-bulk-collection-dialog" data-mode={mode} className="card-modal flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-neutral-800 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name={mode === 'copy' ? 'copy' : 'folderMove'} /></span>
          <div className="min-w-0 flex-1"><h2 className="font-semibold">{title}</h2><p className="mt-0.5 text-xs text-neutral-500">{tx('{n} documento(s) seleccionado(s)', { n: count })}</p></div>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="shrink-0 border-b border-neutral-800 p-3">
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input className="input w-full" style={{ paddingInlineStart: '2.25rem' }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar colección…')} autoFocus />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3">
          {visibleEntries.map(({ collection: entry, depth }) => {
            const unavailable = entry.source !== 'nodus' || (mode === 'move' && entry.id === currentId);
            const active = target === entry.id;
            return <button
              key={entry.id}
              data-testid={`library-bulk-collection-target-${entry.id}`}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm ${active ? 'border-indigo-500/55 bg-indigo-500/10 text-indigo-200' : 'border-transparent text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200'} disabled:cursor-not-allowed disabled:opacity-35`}
              style={{ paddingLeft: 12 + depth * 18 }}
              disabled={unavailable || busy}
              title={entry.source !== 'nodus' ? t('Las colecciones importadas son de solo lectura en Nodus.') : entry.id === currentId ? t('Colección actual') : entry.name}
              onClick={() => setTarget(entry.id)}
              onDoubleClick={() => { if (!unavailable) { setTarget(entry.id); void onApply(entry.id).then(onClose, (cause: unknown) => setError(errorText(cause))); } }}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? 'border-indigo-400' : 'border-neutral-700'}`}>{active && <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />}</span>
              <span className="shrink-0" style={{ color: entry.color ?? undefined }}><Icon name={entry.icon ?? 'folder'} size={15} /></span>
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.source !== 'nodus' && <Icon name="lock" size={10} className="shrink-0" />}
            </button>;
          })}
          {visibleEntries.length === 0 && <p className="px-3 py-8 text-center text-sm text-neutral-500">{t('Sin colecciones.')}</p>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-neutral-800 p-4">
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
          <button data-testid="confirm-library-bulk-collection" className="btn btn-primary" disabled={busy || !target} onClick={() => void apply()}>{busy ? <Spinner /> : <Icon name={mode === 'copy' ? 'copy' : 'folderMove'} />} {t(mode === 'copy' ? 'Copiar aquí' : 'Mover aquí')}</button>
        </footer>
      </section>
    </div>
  );
}

/** Add one tag to every selected document. */
function LibraryBulkTagDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (tag: string) => Promise<void> }) {
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const apply = async () => {
    if (!tag.trim() || busy) return;
    setBusy(true); setError(null);
    try { await onApply(tag.trim()); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section data-testid="library-bulk-tag-dialog" className="card-modal w-full max-w-sm overflow-hidden rounded-2xl border border-neutral-800 shadow-2xl" role="dialog" aria-modal="true" aria-label={t('Etiquetar')}>
        <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="tag" /></span>
          <div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Etiquetar')}</h2><p className="mt-0.5 text-xs text-neutral-500">{tx('{n} documento(s) seleccionado(s)', { n: count })}</p></div>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <form className="space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void apply(); }}>
          <input data-testid="library-bulk-tag-input" className="input w-full" value={tag} onChange={(event) => setTag(event.target.value)} placeholder={t('Nueva etiqueta')} autoFocus />
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
            <button type="submit" data-testid="confirm-library-bulk-tag" className="btn btn-primary" disabled={busy || !tag.trim()}>{busy ? <Spinner /> : <Icon name="tag" />} {t('Añadir etiqueta')}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** One icon of the selection bar: the tooltip and the accessible name carry the words. */
function BulkIconButton({ icon, label, hint, onClick, testId, danger = false, disabled = false }: {
  icon: string; label: string; hint?: string; onClick: () => void; testId?: string; danger?: boolean; disabled?: boolean;
}) {
  return <button type="button" data-testid={testId} aria-label={label} title={hint ? `${label} · ${hint}` : label} disabled={disabled} onClick={onClick}
    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-transparent disabled:cursor-not-allowed disabled:opacity-35 ${danger ? 'text-red-400 hover:border-red-500/40 hover:bg-red-500/10' : 'text-neutral-400 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-300'}`}>
    <Icon name={icon} size={15} />
  </button>;
}

function LibraryCollectionStyleDialog({ collection, onClose, onSave }: {
  collection: LibraryCollectionView;
  onClose: () => void;
  onSave: (icon: LibraryCollectionIcon | null, color: string | null) => Promise<void>;
}) {
  const [icon, setIcon] = useState<LibraryCollectionIcon | null>(collection.icon);
  const [color, setColor] = useState<string | null>(collection.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await onSave(icon, color); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[92] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section data-testid="library-collection-style-dialog" className="card-modal w-full max-w-md overflow-hidden rounded-2xl border border-neutral-800 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="library-collection-style-title">
        <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10" style={{ color: color ?? undefined }}><Icon name={icon ?? 'folder'} size={20} /></span>
          <div className="min-w-0 flex-1"><h2 id="library-collection-style-title" className="font-semibold">{t('Icono')} · {t('Color')}</h2><p className="mt-1 truncate text-xs text-neutral-500">{collection.name}</p></div>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="space-y-5 p-5">
          <section><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Icono')}</h3><div className="mt-2 grid grid-cols-6 gap-2">{COLLECTION_ICONS.map((candidate) => <button key={candidate} data-testid={`library-collection-icon-${candidate}`} className={`grid aspect-square place-items-center rounded-xl border ${icon === candidate ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-200'}`} onClick={() => setIcon(candidate)} aria-label={candidate}><Icon name={candidate} size={18} /></button>)}</div></section>
          <section><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Color')}</h3><div className="mt-2 flex flex-wrap items-center gap-2">{COLLECTION_COLOR_PRESETS.map((preset) => <button key={preset.id} data-testid={`library-collection-color-preset-${preset.id}`} className={`grid h-9 w-9 place-items-center rounded-full border-2 ${color === preset.value ? 'border-white shadow-[0_0_0_2px_rgba(99,102,241,.65)]' : 'border-transparent'}`} style={{ backgroundColor: preset.value }} onClick={() => setColor(preset.value)} aria-label={preset.id}>{color === preset.value && <Icon name="check" size={15} className="text-white" />}</button>)}<label className={`relative grid h-10 w-10 cursor-pointer place-items-center overflow-hidden rounded-full border-2 ${color && !COLLECTION_COLOR_PRESETS.some((preset) => preset.value === color) ? 'border-white shadow-[0_0_0_2px_rgba(99,102,241,.65)]' : 'border-neutral-700'}`} title={t('Color')}><Icon name="palette" size={17} className="pointer-events-none relative z-10 text-white drop-shadow" /><input data-testid="library-collection-custom-color" type="color" className="absolute inset-[-8px] h-14 w-14 cursor-pointer border-0 p-0" value={color ?? '#64748b'} onChange={(event) => setColor(event.target.value.toLowerCase())} aria-label={t('Color')} /></label></div></section>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-between gap-2 border-t border-neutral-800 p-4"><button className="btn btn-ghost" disabled={busy} onClick={() => { setIcon(null); setColor(null); }}><Icon name="rotateCcw" /> {t('Restablecer')}</button><div className="flex gap-2"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button data-testid="save-library-collection-style" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : <Icon name="check" />} {t('Guardar')}</button></div></footer>
      </section>
    </div>
  );
}

function CollectionBranch({
  collection,
  children,
  selected,
  expanded,
  onSelect,
  onToggle,
  onDrop,
  onRename,
  onMove,
  onStyle,
  onDelete,
  depth,
}: {
  collection: LibraryCollectionView;
  children: Map<string | null, LibraryCollectionView[]>;
  selected: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDrop: (event: DragEvent, collection: LibraryCollectionView) => void;
  onRename: (collection: LibraryCollectionView) => void;
  onMove: (collection: LibraryCollectionView) => void;
  onStyle: (collection: LibraryCollectionView) => void;
  onDelete: (collection: LibraryCollectionView) => void;
  depth: number;
}) {
  const descendants = children.get(collection.id) ?? [];
  const open = expanded.has(collection.id);
  return (
    <>
      <div className="group flex items-center pr-1" style={{ paddingLeft: depth * 12 }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move'; }} onDrop={(event) => onDrop(event, collection)}>
        <button
          className={`grid h-7 w-6 shrink-0 place-items-center rounded text-neutral-600 hover:text-neutral-300 ${descendants.length ? '' : 'invisible'}`}
          onClick={() => onToggle(collection.id)}
          aria-label={open ? t('Plegar') : t('Desplegar')}
        >
          <Icon name="chevronRight" size={12} className={open ? 'rotate-90' : ''} />
        </button>
        {collection.source === 'nodus' ? <button
          data-testid={`library-collection-style-${collection.id}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
          style={{ color: collection.color ?? undefined }}
          onClick={() => onStyle(collection)}
          title={`${t('Icono')} · ${t('Color')}`}
          aria-label={`${t('Icono')} · ${collection.name}`}
        ><Icon name={collection.icon ?? 'folder'} size={13} /></button> : <span className="grid h-7 w-7 shrink-0 place-items-center text-neutral-500" style={{ color: collection.color ?? undefined }}><Icon name={collection.icon ?? 'folder'} size={13} /></span>}
        <button
          data-testid={`global-library-collection-${collection.id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${selected === collection.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`}
          onClick={() => onSelect(collection.id)}
          title={collection.name}
          draggable={collection.source === 'nodus'}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-nodus-library-collection', collection.id); }}
        >
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          {collection.source !== 'nodus' && <Icon name="lock" size={9} className="shrink-0 opacity-45" />}
          <span className="text-[10px] tabular-nums opacity-55">{collection.directItemCount}</span>
        </button>
        {collection.source === 'nodus' && <div className={`ml-0.5 flex shrink-0 items-center gap-0.5 transition-opacity ${selected === collection.id ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <button data-testid={`library-collection-edit-${collection.id}`} className={`grid h-6 w-6 place-items-center rounded ${selected === collection.id ? 'text-neutral-500 hover:bg-indigo-500/15 hover:text-indigo-500' : 'text-neutral-600 hover:bg-neutral-900 hover:text-neutral-200'}`} onClick={() => onRename(collection)} title={t('Renombrar colección')} aria-label={tx('Renombrar {name}', { name: collection.name })}><Icon name="edit" size={11} /></button>
          <button data-testid={`library-collection-move-${collection.id}`} className={`grid h-6 w-6 place-items-center rounded ${selected === collection.id ? 'text-neutral-500 hover:bg-indigo-500/15 hover:text-indigo-500' : 'text-neutral-600 hover:bg-neutral-900 hover:text-neutral-200'}`} onClick={() => onMove(collection)} title={t('Mover colección')} aria-label={tx('Mover {name}', { name: collection.name })}><Icon name="route" size={11} /></button>
          <button data-testid={`library-collection-delete-${collection.id}`} className="grid h-6 w-6 place-items-center rounded text-neutral-600 hover:bg-red-500/10 hover:text-red-400" onClick={() => onDelete(collection)} title={t('Eliminar colección')} aria-label={tx('Eliminar {name}', { name: collection.name })}><Icon name="trash" size={11} /></button>
        </div>}
      </div>
      {open && descendants.map((child) => (
        <CollectionBranch
          key={child.id} collection={child} children={children} selected={selected} expanded={expanded}
          onSelect={onSelect} onToggle={onToggle} depth={depth + 1}
          onDrop={onDrop} onRename={onRename} onMove={onMove} onStyle={onStyle} onDelete={onDelete}
        />
      ))}
    </>
  );
}

/**
 * The failure text names the cause; this names the fix. Asking Zotero itself is what
 * separates a closed Zotero from a Nodus-side precondition such as an unconfigured
 * library folder: pointing at Zotero's Advanced settings would be a wrong turn for
 * the second, so a Zotero that answers gets no hint.
 */
async function diagnoseZotero(): Promise<string | null> {
  try {
    const status = await window.nodus.zoteroPing();
    return status.ok ? null : zoteroConnectionHint(status);
  } catch {
    return null;
  }
}

function ZoteroImportDialog({ onClose, onFinished }: { onClose: () => void; onFinished: () => void }) {
  const [libraries, setLibraries] = useState<ZoteroLibraryPreview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ZoteroImportProgress | null>(null);
  const [copyAttachments, setCopyAttachments] = useState(true);
  const [includeUnfiled, setIncludeUnfiled] = useState(true);
  // Standalone Zotero files are real source entries. Keep them enabled for new
  // imports; an older/BETA session can still be resumed with its saved selection.
  const [includeStandaloneFiles, setIncludeStandaloneFiles] = useState(true);
  const [sessions, setSessions] = useState<ZoteroSyncSession[]>([]);
  const [lastReport, setLastReport] = useState<ZoteroSyncSession['report']>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      window.nodus.listZoteroImportLibraries(),
      window.nodus.listZoteroSyncSessions(),
    ]).then(([libraryResult, sessionResult]) => {
      if (!alive) return;
      if (libraryResult.status === 'fulfilled') {
        setLibraries(libraryResult.value);
        setSelected(new Set(libraryResult.value.map((entry) => entry.id)));
      } else {
        setError(zoteroFailureText(libraryResult.reason));
        void diagnoseZotero().then((next) => { if (alive) setHint(next); });
      }
      if (sessionResult.status === 'fulfilled') setSessions(sessionResult.value);
    }).finally(() => alive && setLoading(false));
    const off = window.nodus.onZoteroImportProgress((value) => {
      if (!requestId || value.requestId === requestId) setProgress(value);
    });
    return () => { alive = false; off(); };
  }, [requestId]);

  const run = async (id: string, selection?: ZoteroImportSelection) => {
    setRequestId(id);
    setError(null);
    setHint(null);
    setLastReport(null);
    try {
      const report = selection
        ? await window.nodus.importZoteroLibrary(id, selection)
        : await window.nodus.resumeZoteroLibraryImport(id);
      setLastReport(report);
      const verificationBlocked = report.verification?.status === 'blocked';
      toast(report.canceled ? t('La importación se canceló; el catálogo ya recuperado se conserva.')
        : report.partial || verificationBlocked ? t('La sincronización necesita revisión; los datos locales se conservan.')
          : tx('Importación terminada: {n} documentos.', { n: report.itemsDiscovered }));
      onFinished();
      // A partial or blocked verification is never presented as a successful
      // completion. Keep the dialog open so the mismatch and retry action remain
      // visible, including for a report whose legacy importer forgot `partial`.
      if (!report.canceled && !report.partial && !verificationBlocked) onClose();
    } catch (nextError) {
      setError(zoteroFailureText(nextError));
      void diagnoseZotero().then(setHint);
    } finally {
      setRequestId(null);
      void window.nodus.listZoteroSyncSessions().then(setSessions).catch(() => undefined);
    }
  };
  const start = () => {
    const availableIds = libraries.map((entry) => entry.id);
    const allAvailableSelected = availableIds.length === selected.size && availableIds.every((id) => selected.has(id));
    return run(crypto.randomUUID(), {
      ...(allAvailableSelected ? {} : { libraryIds: [...selected] }),
      copyAttachments, includeUnfiled, includeStandaloneFiles,
    });
  };
  // Only the newest session can be resumed. Searching the whole history instead meant
  // that one old failure kept the "interrupted sync" banner up forever: a later run
  // that completed cleanly still found the stale entry and reported itself as
  // interrupted, which makes a healthy import look broken. A newer run supersedes an
  // older failure, so the banner follows the latest attempt and nothing else. Picked by
  // `updatedAt` rather than list order, so it does not depend on how the store sorts.
  const latestSession = sessions.reduce<ZoteroSyncSession | null>(
    (newest, session) => (!newest || session.updatedAt > newest.updatedAt ? session : newest),
    null,
  );
  const resumable = latestSession && (latestSession.status === 'canceled' || latestSession.status === 'failed'
    || (latestSession.status === 'completed' && (latestSession.report?.partial || latestSession.report?.verification?.status === 'blocked')))
    ? latestSession
    : null;
  const resumableIsPartial = Boolean(resumable?.report?.partial || resumable?.report?.verification?.status === 'blocked');

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !requestId) onClose(); }}>
      <section data-testid="zotero-global-import-dialog" className="card flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl">
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="book" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{t('Importar desde Zotero')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('Copia de solo lectura: Nodus nunca modifica Zotero.')}</p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!requestId} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {resumable && !requestId && (
            <div data-testid="zotero-sync-resume" className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <Icon name="refresh" className="shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1 text-xs"><b className="block text-amber-950 dark:text-amber-100">{resumableIsPartial ? t('Sincronización requiere revisión') : t('Sincronización interrumpida')}</b><span className="text-amber-800 dark:text-amber-200/80">{tr(resumable.progress.message)}</span></div>
              <button data-testid="resume-zotero-sync" className="btn btn-ghost border border-amber-500/25" onClick={() => void run(resumable.id)}>{resumableIsPartial ? t('Reintentar') : t('Reanudar')}</button>
            </div>
          )}
          {loading ? <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Spinner /> {t('Buscando bibliotecas…')}</div> : (
            <div className="space-y-2">
              {libraries.map((library) => (
                <label key={library.id} className="flex items-center gap-3 rounded-xl border border-neutral-800 p-3 hover:bg-neutral-900/60">
                  <input type="checkbox" checked={selected.has(library.id)} disabled={!!requestId} onChange={(event) => setSelected((current) => {
                    const next = new Set(current); if (event.target.checked) next.add(library.id); else next.delete(library.id); return next;
                  })} />
                  <Icon name={library.type === 'group' ? 'users' : 'book'} className="text-neutral-500" />
                  <span className="min-w-0 flex-1"><b className="block truncate text-sm">{library.name}</b><span className="text-[11px] text-neutral-500">{library.id}</span></span>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${library.lastImportedVersion === library.version && library.version > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                    {library.lastImportedVersion === library.version && library.version > 0 ? t('Actualizada') : t('Cambios disponibles')}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg bg-neutral-900/60 p-2.5"><input type="checkbox" checked={copyAttachments} disabled={!!requestId} onChange={(event) => setCopyAttachments(event.target.checked)} />{t('Copiar todos los adjuntos')}</label>
            <label className="flex items-center gap-2 rounded-lg bg-neutral-900/60 p-2.5"><input type="checkbox" checked={includeUnfiled} disabled={!!requestId} onChange={(event) => setIncludeUnfiled(event.target.checked)} />{t('Incluir documentos sin colección')}</label>
            {/* A parentless file is a first-class entry in Zotero. It is enabled for
                new imports, while the checkbox remains available for compatibility. */}
            <label className="flex items-start gap-2 rounded-lg bg-neutral-900/60 p-2.5"><input type="checkbox" className="mt-0.5" checked={includeStandaloneFiles} disabled={!!requestId} onChange={(event) => setIncludeStandaloneFiles(event.target.checked)} /><span>{t('Importar archivos sueltos (sin ficha bibliográfica)')}<span className="mt-0.5 block text-[10px] text-neutral-500">{t('PDFs y EPUBs añadidos a Zotero sin una entrada encima. Llegan sin autor ni año.')}</span></span></label>
          </div>
          {progress && (
            <div className="mt-5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
              <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-indigo-200">{tr(progress.message)}</span><b className="tabular-nums">{progress.percent}%</b></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
              <p className="mt-2 text-[10px] text-neutral-500">{progress.processedItems}/{progress.totalItems || '—'} {t('documentos')} · {progress.processedAttachments}/{progress.totalAttachments || '—'} {t('adjuntos')}</p>
            </div>
          )}
          {error && (
            <div role="alert" data-testid="zotero-global-import-error" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <p>{error}</p>
              {hint && <p data-testid="zotero-global-import-hint" className="mt-2 opacity-80">{hint}</p>}
            </div>
          )}
          {!!lastReport?.itemsStandaloneSkipped && !includeStandaloneFiles && (
            <div role="status" className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-950 dark:text-sky-100">
              <b>{t('Archivos sueltos no importados')}</b>
              <p className="mt-1">{tx('Tu biblioteca tiene {n} archivo(s) sin ficha bibliográfica. Marca la casilla de arriba y vuelve a importar si los quieres.', { n: lastReport.itemsStandaloneSkipped })}</p>
            </div>
          )}
          {lastReport?.verification?.status === 'blocked' && (
            <div role="alert" data-testid="zotero-import-verification-blocked" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-950 dark:text-red-100">
              <b>{t('Verificación bloqueada')}</b>
              <p className="mt-1">{t('La importación no se ha cerrado como correcta porque el inventario no coincide con lo guardado.')}</p>
              <div className="mt-2 grid grid-cols-2 gap-1 tabular-nums text-[10px]">
                <span>{tx('Documentos: {imported}/{expected}', { imported: lastReport.verification.imported.items, expected: lastReport.verification.expected.items })}</span>
                <span>{tx('Adjuntos: {imported}/{expected}', { imported: lastReport.verification.imported.attachments, expected: lastReport.verification.expected.attachments })}</span>
              </div>
              {!!lastReport.verification.mismatches.length && <ul className="mt-2 list-disc space-y-0.5 pl-4">{lastReport.verification.mismatches.map((mismatch: ZoteroImportVerificationMismatch, index) => <li key={`${mismatch.kind}-${index}`}>{mismatch.message || tx('{kind}: se esperaban {expected} y se importaron {imported}.', { kind: mismatch.kind, expected: mismatch.expected, imported: mismatch.imported })}</li>)}</ul>}
              <p className="mt-2 font-medium">{t('Puedes reintentar esta sesión cuando se resuelva la incidencia.')}</p>
            </div>
          )}
          {lastReport?.partial && (
            <div role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100">
              <b>{t('Sincronización parcial')}</b>
              <p className="mt-1">{tx('{n} incidencia(s); {missing} fuente(s) ausente(s); {attachments} adjunto(s) no disponible(s).', {
                n: lastReport.failures.length, missing: lastReport.itemsSourceMissing, attachments: lastReport.attachmentsUnavailable,
              })}</p>
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-4">
          {requestId && !progress?.phase.match(/^(complete|canceled|failed)$/) ? <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.cancelZoteroLibraryImport(requestId)}><Icon name="x" /> {t('Cancelar')}</button> : (
            <><button className="btn btn-ghost" onClick={onClose}>{t('Cerrar')}</button><button data-testid="start-zotero-global-import" className="btn btn-primary" disabled={loading || selected.size === 0} onClick={() => void start()}><Icon name="download" /> {t('Importar / actualizar')}</button></>
          )}
        </footer>
      </section>
    </div>
  );
}

function migrationBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LibraryMigrationDialog({ onClose, onFinished }: { onClose: () => void; onFinished: () => void }) {
  const [preview, setPreview] = useState<LibraryMigrationPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<LibraryMigrationSession | null>(null);
  const [progress, setProgress] = useState<LibraryMigrationProgress | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.nodus.previewLibraryMigration(), window.nodus.listLibraryMigrationSessions()])
      .then(([nextPreview, sessions]) => {
        if (!alive) return;
        setPreview(nextPreview); setSelected(new Set(nextPreview.selectedVaultIds));
        setSession(sessions.find((entry) => entry.status !== 'rolled-back') ?? null);
      })
      .catch((nextError) => alive && setError(nextError instanceof Error ? nextError.message : String(nextError)))
      .finally(() => alive && setBusy(false));
    const off = window.nodus.onLibraryMigrationProgress((next) => {
      setProgress(next);
      setSession((current) => !current || current.id !== next.sessionId ? current : {
        ...current,
        checkpoint: { phase: next.phase, vaultId: next.vaultId, processedItems: next.processedItems, totalItems: next.totalItems, percent: next.percent, recordedAt: new Date().toISOString() },
      });
    });
    return () => { alive = false; off(); };
  }, []);

  const execute = async (resume = false) => {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try {
      const result = resume && session
        ? await window.nodus.resumeLibraryMigration(session.id)
        : await window.nodus.startLibraryMigration({ preview, selectedVaultIds: [...selected] });
      setSession(result);
      if (result.status === 'completed') {
        toast(tx('Migración verificada: {n} documentos enlazados.', { n: result.report?.vaultLinks ?? 0 }));
        onFinished();
      }
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };

  const rollback = async () => {
    if (!session || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await window.nodus.rollbackLibraryMigration(session.id);
      setSession(result); onFinished();
      toast(result.rollbackConflicts.length
        ? tx('Rollback terminado con {n} conflicto(s) conservado(s).', { n: result.rollbackConflicts.length })
        : t('Rollback terminado sin pérdida de datos.'));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };

  const active = busy && Boolean(progress?.sessionId) && progress?.phase !== 'complete';
  const shownProgress = progress?.sessionId === session?.id || active ? progress : null;
  return <div className="fixed inset-0 z-[86] grid place-items-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !active) onClose(); }}>
    <section data-testid="library-migration-dialog" className="card flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl">
      <header className="flex items-start gap-3 border-b border-neutral-800 p-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="vault" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Migrar vaults a la Biblioteca global')}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{t('Simula primero, lee los vaults sin modificarlos y conserva análisis, notas y documentos existentes.')}</p></div><button className="btn btn-ghost" onClick={onClose} disabled={active} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {busy && !preview ? <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Spinner /> {t('Creando inventario de solo lectura…')}</div> : preview && <>
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              [t('Documentos'), preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.itemCount, 0)],
              [t('Colecciones'), preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.collectionCount, 0)],
              [t('Duplicados previstos'), preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.duplicateItems, 0)],
              [t('Espacio estimado'), migrationBytes(preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.estimatedAdditionalBytes, 0))],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"><span className="block text-[9px] uppercase tracking-wider text-neutral-600">{label}</span><b className="mt-1 block text-sm tabular-nums">{value}</b></div>)}
          </div>
          <div className="mt-4 space-y-2">{preview.vaults.map((vault) => <label key={vault.id} className={`flex items-center gap-3 rounded-xl border p-3 ${selected.has(vault.id) ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-neutral-800'}`}>
            <input type="checkbox" checked={selected.has(vault.id)} disabled={active || !vault.available} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(vault.id); else next.delete(vault.id); return next; })} />
            <Icon name="vault" size={15} className="text-neutral-500" /><span className="min-w-0 flex-1"><b className="block truncate text-sm font-medium">{vault.name}</b><span className="text-[10px] text-neutral-600">{vault.type} · {vault.origin === 'local' ? t('local') : t('conectado')} · {vault.itemCount} {t('documentos')}</span>{vault.warnings.map((warning) => <span key={warning} className="mt-1 block text-[10px] text-amber-400">{t(warning)}</span>)}</span>
            {vault.defaultSelected && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] text-emerald-300">{t('Recomendado')}</span>}
          </label>)}</div>
        </>}
        {(shownProgress || session) && <div data-testid="library-migration-progress" className="mt-5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
          <div className="flex items-center justify-between gap-3 text-xs"><b>{session?.status === 'completed' ? t('Migración verificada') : session?.status === 'rolled-back' ? t('Migración revertida') : session?.status === 'canceled' ? t('Migración pausada de forma segura') : t('Migrando Biblioteca…')}</b><span className="tabular-nums">{shownProgress?.percent ?? session?.checkpoint.percent ?? 0}%</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${shownProgress?.percent ?? session?.checkpoint.percent ?? 0}%` }} /></div>
          <p className="mt-2 text-[10px] text-neutral-500">{shownProgress?.processedItems ?? session?.checkpoint.processedItems ?? 0}/{shownProgress?.totalItems || session?.checkpoint.totalItems || '—'} {t('documentos')} · {t('checkpoint recuperable')}</p>
          {session?.verification && <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] text-emerald-400"><span>✓ {t('Catálogo')}</span><span>✓ {t('Manifiestos')}</span><span>✓ {t('Archivos')}</span><span>✓ {t('Enlaces')}</span></div>}
          {session?.rollbackConflicts.length ? <p className="mt-3 text-[10px] text-amber-300">{tx('{n} registro(s) modificados después de migrar se conservaron para revisión.', { n: session.rollbackConflicts.length })}</p> : null}
        </div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-neutral-800 p-4">
        {active && progress?.sessionId ? <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.cancelLibraryMigration(progress.sessionId!)}><Icon name="x" /> {t('Cancelar con seguridad')}</button> : <>
          {session && ['canceled', 'failed'].includes(session.status) && <button className="btn btn-primary" disabled={busy} onClick={() => void execute(true)}><Icon name="refresh" /> {t('Reanudar')}</button>}
          {session && ['completed', 'canceled', 'failed'].includes(session.status) && <button className="btn btn-ghost border border-amber-500/30 text-amber-300" disabled={busy} onClick={() => void rollback()}><Icon name="undo" /> {t('Revertir esta migración')}</button>}
          {session?.status === 'completed' && <button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => { setSession(null); setProgress(null); }}>{t('Nueva simulación')}</button>}
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cerrar')}</button>
          {(!session || session.status === 'rolled-back') && <button data-testid="start-library-migration" className="btn btn-primary" disabled={busy || selected.size === 0} onClick={() => void execute()}><Icon name="check" /> {t('Migrar y verificar')}</button>}
        </>}
      </footer>
    </section>
  </div>;
}

function VaultLinkDialog({ itemIds, onClose, onLinked }: {
  itemIds: string[];
  onClose: () => void;
  onLinked: (links: LibraryVaultLink[]) => void;
}) {
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [vaultId, setVaultId] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.nodus.listGlobalLibraryVaults().then((entries) => {
      setVaults(entries);
      setVaultId(entries.find((vault) => !isReadOnlyVault(vault))?.id ?? '');
    }).catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, []);
  // The type label is part of the haystack because that is how the list is read
  // ("the genealogy one", "Estudio"), not by switching vaults and looking. Filtered
  // on every render on purpose: the label is translated, so a memoized result would
  // still be matching the language the query was typed in.
  const needle = query.trim().toLowerCase();
  const shownVaults = needle
    ? vaults.filter((vault) => [
      vault.name,
      vaultTypeLabel(vault.type),
      vault.origin === 'connected' ? vault.remote?.spaceName ?? '' : '',
    ].some((value) => value.toLowerCase().includes(needle)))
    : vaults;
  const selectedVault = vaults.find((vault) => vault.id === vaultId) ?? null;
  const link = async () => {
    if (!vaultId || busy) return;
    setBusy(true); setError(null);
    try {
      const report = await window.nodus.linkGlobalLibraryItemsToVault(itemIds, vaultId);
      toast(report.linked
        ? report.reusedComponents
          ? tx('{n} documento(s) añadidos; {reused} componente(s) reutilizados con huellas exactas.', { n: report.linked, reused: report.reusedComponents })
          : tx('{n} documento(s) añadidos al vault.', { n: report.linked })
        : t('Los documentos ya estaban vinculados a ese vault.'));
      // The vault's Library list is served from a per-vault, per-filter cache that
      // this link never invalidated: returning to "This vault" showed the pre-link
      // page until another filter forced a fresh query.
      invalidateVaultQueryCache(vaultId);
      notifyDataChanged();
      onLinked(report.links);
      onClose();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[85] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="global-library-vault-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    {/* The body scrolls inside a capped panel. Left to grow with the vault list, the
        dialog stretched the full height of the window on any account with more than a
        handful of vaults. */}
    <section data-testid="global-library-vault-dialog" className="card-modal flex max-h-[min(86vh,620px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl">
      <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="vault" /></span><div className="min-w-0 flex-1"><h2 id="global-library-vault-dialog-title" className="font-semibold">{t('Añadir al vault')}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{tx('{n} documento(s) conservarán su copia global; el vault recibirá una referencia analizable al Markdown limpio.', { n: itemIds.length })}</p></div><button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
      <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input data-testid="global-library-vault-search" className="input input-with-leading-icon h-9 w-full py-1 text-sm" placeholder={t('Buscar bóvedas…')} aria-label={t('Buscar bóvedas…')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {Boolean(query.trim()) && <span className="shrink-0 tabular-nums text-[10px] text-neutral-500" aria-live="polite">{shownVaults.length}/{vaults.length}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!vaults.length && !error && <p className="py-10 text-center text-sm text-neutral-500">{t('No hay vaults disponibles.')}</p>}
        {Boolean(vaults.length) && !shownVaults.length && <p className="py-10 text-center text-sm text-neutral-500">{t('Sin coincidencias.')}</p>}
        <div className="grid gap-2 sm:grid-cols-2">{shownVaults.map((vault) => {
          const readOnly = isReadOnlyVault(vault);
          const accent = VAULT_TYPE_COLOR[vault.type] ?? '#6366f1';
          const selected = vaultId === vault.id;
          const phase = vaultTypePhase(vault.type);
          return <label key={vault.id} data-testid={`global-library-vault-option-${vault.id}`} title={readOnly ? t('Solo lectura') : undefined} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors ${readOnly ? 'cursor-not-allowed border-neutral-900 opacity-55' : selected ? 'cursor-pointer border-transparent ring-2' : 'cursor-pointer border-neutral-800 hover:border-neutral-600 hover:bg-neutral-900/50'}`} style={!readOnly && selected ? { boxShadow: `inset 0 0 0 1px ${accent}`, ['--tw-ring-color' as string]: accent } : undefined}>
            <input type="radio" name="library-vault" value={vault.id} checked={selected} disabled={readOnly || busy} onChange={() => setVaultId(vault.id)} />
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: accent }}><Icon name={vaultTypeIcon(vault.type)} size={17} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5"><b className="truncate text-sm font-medium">{vault.name}</b>{vault.active && <span className="shrink-0 rounded bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">{t('Activo')}</span>}</span>
              <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-neutral-500"><span className="truncate">{vaultTypeLabel(vault.type)}</span>{phase && <VaultPhaseBadge phase={phase} compact />}{isPreviewVaultType(vault.type) && <PreviewBadge compact />}</span>
              <span className="mt-0.5 block truncate text-[10px] text-neutral-600">{vault.origin === 'connected' ? `${vault.remote?.role ?? 'reader'} · ${vault.remote?.spaceName ?? ''}` : t('local')}{readOnly ? ` · ${t('Solo lectura')}` : ''}</span>
            </span>
          </label>;
        })}</div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" aria-label={selectedVault ? `${t('Añadir al vault')}: ${selectedVault.name}` : undefined}>
          {selectedVault && <><span className="mr-1.5 inline-block h-2 w-2 -translate-y-px rounded-full align-middle" style={{ backgroundColor: VAULT_TYPE_COLOR[selectedVault.type] ?? '#6366f1' }} />{selectedVault.name}</>}
        </span>
        <span className="flex shrink-0 justify-end gap-2"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button data-testid="confirm-global-library-vault-link" className="btn btn-primary" disabled={!vaultId || busy} onClick={() => void link()}>{busy ? <Spinner /> : <Icon name="plus" />} {t('Añadir')}</button></span>
      </footer>
    </section>
  </div>;
}

/** A connected vault only for reading: it can be listed but never written to. */
function isReadOnlyVault(vault: VaultSummary): boolean {
  return vault.origin === 'connected' && (vault.remote?.role === 'reader' || vault.remote?.state !== 'active');
}

function LibraryScopeControls({
  scope,
  switching,
  globalEnabled,
  onChoose,
}: {
  scope: LibraryScope;
  switching: boolean;
  globalEnabled: boolean;
  onChoose: (scope: LibraryScope) => void;
}) {
  return (
    <div
      data-testid="library-scope-switcher"
      data-tour="library-scope"
      data-scope-placement="content-header"
      className="library-scope-switcher"
      role="group"
      aria-label={t('Ámbito de la Biblioteca')}
    >
      <span className="library-scope-option">
        <button
          data-testid="library-scope-vault"
          className={`library-scope-button ${scope === 'vault' ? 'is-active' : ''}`}
          aria-pressed={scope === 'vault'}
          aria-describedby="library-scope-vault-tooltip"
          disabled={switching}
          onClick={() => onChoose('vault')}
        >
          <Icon name="vault" size={13} />
          <span>{t('Este vault')}</span>
        </button>
        <span id="library-scope-vault-tooltip" data-testid="library-scope-vault-tooltip" className="library-scope-tooltip" role="tooltip">
          {t('Este vault conserva colecciones, scans, resúmenes, embeddings y análisis existentes.')}
        </span>
      </span>
      <span className="library-scope-option">
        <button
          data-testid="library-scope-global"
          className={`library-scope-button ${scope === 'global' ? 'is-active' : ''}`}
          aria-pressed={scope === 'global'}
          aria-describedby="library-scope-global-tooltip"
          disabled={switching}
          onClick={() => onChoose('global')}
        >
          <Icon name="library" size={13} />
          <span>{globalEnabled ? t('Global') : t('Activar Global')}</span>
        </button>
        <span id="library-scope-global-tooltip" data-testid="library-scope-global-tooltip" className="library-scope-tooltip" role="tooltip">
          {t('Global reúne originales y Markdown limpio para todos tus vaults.')}
          {!globalEnabled && <> {t('Activa la Biblioteca global cuando quieras; este vault no cambiará.')}</>}
        </span>
      </span>
    </div>
  );
}

function GlobalLibraryContent({
  target, onTargetConsumed, snapshot, onSnapshotChange, onOpenSettings, scopeControls, onOpenReader,
}: {
  target?: (PendingLibraryNavigationTarget & { nonce: number }) | null;
  onTargetConsumed?: () => void;
  snapshot?: LibraryGlobalSnapshot;
  onSnapshotChange?: (next: LibraryGlobalSnapshot) => void;
  onOpenSettings: () => void;
  scopeControls: ReactNode;
  onOpenReader: (reference: LibraryReaderReference) => void;
}) {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [collections, setCollections] = useState<LibraryCollectionView[]>([]);
  const [savedSearches, setSavedSearches] = useState<LibrarySavedSearchRecord[]>([]);
  const [selectedSavedSearch, setSelectedSavedSearch] = useState<string | null>(() => snapshot?.selectedSavedSearch ?? null);
  const [viewPreferences, setViewPreferences] = useState<LibraryViewPreferences>(DEFAULT_VIEW_PREFERENCES);
  const [librarySettings, setLibrarySettings] = useState<GlobalLibrarySettings>(DEFAULT_GLOBAL_LIBRARY_SETTINGS);
  const [items, setItems] = useState<LibraryCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  // The page and the row that was at the top are one restored value.
  const [offset, setOffset] = useState(() => snapshot?.placement?.pageOffset ?? 0);
  // Restored as initial values only. The draft and the applied search start from the
  // same text, or the debounce would wipe the restored cut on mount.
  const [searchDraft, setSearchDraft] = useState(() => snapshot?.search ?? '');
  const [search, setSearch] = useState(() => snapshot?.search ?? '');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(() => snapshot?.selectedCollection ?? null);
  // Facets restored from a snapshot written before they held several values keep working.
  const restored = snapshot?.filters as (Partial<LibraryGlobalSnapshot['filters']> & Record<string, unknown>) | undefined;
  const restoredList = <T,>(list: unknown, legacy: unknown): T[] => Array.isArray(list) ? list as T[] : typeof legacy === 'string' && legacy ? [legacy as T] : [];
  const [sources, setSources] = useState<LibraryItemSource[]>(() => restoredList(restored?.sources, restored?.source));
  const [extractions, setExtractions] = useState<LibraryCatalogItem['extractionStatus'][]>(() => restoredList(restored?.extractions, restored?.extraction));
  const [yearFrom, setYearFrom] = useState(() => restored?.yearFrom ?? '');
  const [yearTo, setYearTo] = useState(() => restored?.yearTo ?? '');
  const [itemTypes, setItemTypes] = useState<LibraryItemType[]>(() => restoredList(restored?.itemTypes, restored?.itemType));
  const [tags, setTags] = useState<string[]>(() => restoredList(restored?.tags, restored?.facetTag));
  const [vaults, setVaults] = useState<string[]>(() => restoredList(restored?.vaults, restored?.facetVault));
  const [attachments, setAttachments] = useState<Array<'with' | 'without'>>(() => restoredList(restored?.attachments, restored?.attachmentFilter));
  // What each dropdown offers: the catalogue without its own facet cuts, so choosing one
  // value never hides the others.
  const [facetOptions, setFacetOptions] = useState<LibraryCatalogFacets>(EMPTY_FACETS);
  const [vaultNames, setVaultNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryItemRecord | null>(null);
  const [jobs, setJobs] = useState<LibraryExtractionJob[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  // A balloon: it never reopens by itself when the section is shown again.
  const [filtersOpen, setFiltersOpenState] = useState(false);
  const [metadataItem, setMetadataItem] = useState<LibraryItemRecord | null>(null);
  const [createReferenceMode, setCreateReferenceMode] = useState<'identifier' | 'manual' | null>(null);
  const [metadataBatchItems, setMetadataBatchItems] = useState<string[] | null>(null);
  const [citationItems, setCitationItems] = useState<string[] | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [trashMode, setTrashMode] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [trashImpactItems, setTrashImpactItems] = useState<string[] | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [vaultLinkItems, setVaultLinkItems] = useState<string[] | null>(null);
  const [detailLinks, setDetailLinks] = useState<LibraryVaultLink[]>([]);
  const [manager, setManager] = useState<{ item: LibraryItemRecord; tab?: 'attachments' | 'notes' | 'relations' | 'tags' } | null>(null);
  const [bulkDialog, setBulkDialog] = useState<'copy' | 'move' | 'tag' | null>(null);
  const [movingCollection, setMovingCollection] = useState<LibraryCollectionView | null>(null);
  const [stylingCollection, setStylingCollection] = useState<LibraryCollectionView | null>(null);
  const [smartSearchEditor, setSmartSearchEditor] = useState<LibrarySavedSearchRecord | 'new' | null>(null);
  const [tablePreferencesOpen, setTablePreferencesOpen] = useState(false);
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [detailActionsOpen, setDetailActionsOpen] = useState(false);
  const [dragImport, setDragImport] = useState<{ collectionId: string | null; label: string } | null>(null);
  const [itemContextMenu, setItemContextMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const [foregroundPreparation, setForegroundPreparation] = useState<{ item: LibraryItemRecord; jobId: string; progress: number; message: string } | null>(null);
  const sidebarNavigationRef = useRef<HTMLDivElement>(null);
  const selectedDetailIdRef = useRef<string | null>(null);
  selectedDetailIdRef.current = detailId;
  const [collectionPaneRatio, setCollectionPaneRatio] = useState(() => {
    const stored = Number(window.localStorage.getItem(LIBRARY_COLLECTION_PANE_RATIO_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampCollectionPaneRatio(stored) : DEFAULT_LIBRARY_COLLECTION_PANE_RATIO;
  });
  const sortKey = JSON.stringify(viewPreferences.sort);

  const resizeCollectionPane = (value: number) => {
    const next = clampCollectionPaneRatio(value);
    setCollectionPaneRatio(next);
    window.localStorage.setItem(LIBRARY_COLLECTION_PANE_RATIO_KEY, String(next));
  };

  const resizeCollectionPaneFromPointer = (clientY: number) => {
    const box = sidebarNavigationRef.current?.getBoundingClientRect();
    if (!box?.height) return;
    resizeCollectionPane(((clientY - box.top) / box.height) * 100);
  };

  const load = useCallback(async () => {
    try {
      const [nextStatus, page, nextCollections, nextJobs, nextSavedSearches, nextViewPreferences, nextLibrarySettings, trashPage, optionsPage, libraryVaults] = await Promise.all([
        window.nodus.getGlobalLibraryStatus(),
        window.nodus.listGlobalLibraryItems({
          search: search || undefined, collectionId: trashMode ? null : selectedCollection, savedSearchId: trashMode ? null : selectedSavedSearch,
          smartSearch: trashMode ? TRASH_SEARCH : null, includeDeleted: trashMode,
          sources, extractionStatuses: extractions, itemTypes, tags, vaultIds: vaults,
          yearFrom: yearFrom ? Number(yearFrom) : null, yearTo: yearTo ? Number(yearTo) : null,
          hasAttachments: attachments.length === 1 ? attachments[0] === 'with' : null,
          limit: PAGE_SIZE, offset, sort: JSON.parse(sortKey) as LibraryViewPreferences['sort'], includeFacets: false,
        }),
        window.nodus.listGlobalLibraryCollections(),
        window.nodus.listLibraryExtractionJobs(),
        window.nodus.listGlobalLibrarySavedSearches(),
        window.nodus.getGlobalLibraryViewPreferences(),
        window.nodus.getGlobalLibrarySettings(),
        window.nodus.listGlobalLibraryItems({ includeDeleted: true, smartSearch: TRASH_SEARCH, limit: 1, includeFacets: false }),
        // The same cut without facet filters: what each filter dropdown can offer.
        window.nodus.listGlobalLibraryItems({
          search: search || undefined, collectionId: trashMode ? null : selectedCollection, savedSearchId: trashMode ? null : selectedSavedSearch,
          smartSearch: trashMode ? TRASH_SEARCH : null, includeDeleted: trashMode, limit: 1,
        }),
        window.nodus.listGlobalLibraryVaults().catch(() => []),
      ]);
      setStatus(nextStatus); setItems(page.items); setTotal(page.total); setCollections(nextCollections); setJobs(nextJobs);
      setSavedSearches(nextSavedSearches); setViewPreferences(nextViewPreferences); setLibrarySettings(nextLibrarySettings); setError(null);
      setTrashCount(trashPage.total);
      setFacetOptions(optionsPage.facets); setVaultNames(new Map(libraryVaults.map((vault) => [vault.id, vault.name])));
      if (!expanded.size && nextCollections.length) setExpanded(new Set(nextCollections.filter((entry) => !entry.parentId).map((entry) => entry.id)));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setLoading(false); }
  }, [search, selectedCollection, selectedSavedSearch, trashMode, sources, extractions, yearFrom, yearTo, itemTypes, tags, vaults, attachments, offset, expanded.size, sortKey]);

  const refreshSelectedLibraryDetail = useCallback(async (changedItemId?: string) => {
    const selectedId = selectedDetailIdRef.current;
    if (!selectedId || (changedItemId && changedItemId !== selectedId)) return;
    const [item, links] = await Promise.all([
      window.nodus.getGlobalLibraryItem(selectedId),
      window.nodus.listGlobalLibraryVaultLinks(selectedId),
    ]);
    if (selectedDetailIdRef.current !== selectedId) return;
    setDetail(item);
    setDetailLinks(links);
  }, []);

  // The debounce must skip its own first run: on arrival the draft already equals the
  // restored search, and letting it fire would reset the restored page to zero.
  const searchSettled = useRef(false);
  useEffect(() => {
    if (!searchSettled.current) {
      searchSettled.current = true;
      return;
    }
    const timer = window.setTimeout(() => { setOffset(0); setSearch(searchDraft.trim()); }, 220);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  // The cut this section will find again on the way back. `search` and not
  // `searchDraft`: half a word typed on the way out is not a cut worth returning to.
  // The registry rebuilds the callback on every render of the shell, so a ref keeps
  // its identity out of the dependencies.
  const reportSnapshot = useRef(onSnapshotChange);
  reportSnapshot.current = onSnapshotChange;
  // The place in the list is a ref, not state: it changes on every scroll frame, and
  // as state it would re-render this whole view — sidebar, detail pane and all — for
  // each one.
  const placementRef = useRef<ListPlacement | null>(snapshot?.placement ?? null);
  const currentSnapshot = useCallback((): LibraryGlobalSnapshot => ({
    search,
    selectedCollection,
    selectedSavedSearch,
    filtersOpen,
    filters: { sources, extractions, itemTypes, yearFrom, yearTo, tags, vaults, attachments },
    placement: placementRef.current,
  }), [attachments, extractions, tags, vaults, filtersOpen, itemTypes, search, selectedCollection, selectedSavedSearch, sources, yearFrom, yearTo]);
  const snapshotOf = useRef(currentSnapshot);
  snapshotOf.current = currentSnapshot;
  useEffect(() => { reportSnapshot.current?.(currentSnapshot()); }, [currentSnapshot]);

  // Report explicit filter actions immediately. If the click that dismisses a
  // filter also leaves the section, this component may unmount before the passive
  // effect above can publish the new value.
  const reportSnapshotNow = useCallback((overrides: Partial<Omit<LibraryGlobalSnapshot, 'filters'>> & {
    filters?: Partial<LibraryGlobalSnapshot['filters']>;
  }) => {
    const current = snapshotOf.current();
    reportSnapshot.current?.({
      ...current,
      ...overrides,
      filters: { ...current.filters, ...overrides.filters },
    });
  }, []);
  const activeCatalogFilters = sources.length + extractions.length + itemTypes.length + tags.length + vaults.length + attachments.length + (yearFrom ? 1 : 0) + (yearTo ? 1 : 0);
  // The filters open as a balloon anchored to their button; its dropdowns are a group of
  // their own, so opening one does not close it.
  const filterBalloonRef = useDismissableLayer<HTMLDivElement>({ open: filtersOpen, onDismiss: () => setFiltersOpenState(false), group: 'global-library-filter-balloon' });
  const toggleFilterPanel = () => {
    const nextOpen = !filtersOpen;
    setFiltersOpenState(nextOpen);
    reportSnapshotNow({ filtersOpen: nextOpen });
  };
  const rememberCatalogFilters = (filters: Partial<LibraryGlobalSnapshot['filters']>) => {
    setOffset(0);
    reportSnapshotNow({ filters });
  };
  const clearCatalogFilters = () => {
    setSources([]); setExtractions([]); setYearFrom(''); setYearTo(''); setItemTypes([]);
    setTags([]); setVaults([]); setAttachments([]); setOffset(0);
    reportSnapshotNow({
      filters: {
        sources: [], extractions: [], yearFrom: '', yearTo: '', itemTypes: [],
        tags: [], vaults: [], attachments: [],
      },
    });
  };

  // The anchor is restored by VirtualList, which is the only thing that knows where a
  // row that is not rendered yet would be. What it cannot decide is what to do when
  // the row is gone: that is this view's call, and the answer is the first page.
  const [restoreAnchorId, setRestoreAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const anchorChecked = useRef(restoreAnchorId === null);
  useEffect(() => {
    if (anchorChecked.current || items.length === 0) return;
    anchorChecked.current = true;
    if (items.some((item) => item.id === restoreAnchorId)) return;
    setRestoreAnchorId(null);
    setOffset(0);
    placementRef.current = null;
    reportSnapshot.current?.(snapshotOf.current());
  }, [items, restoreAnchorId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const offChanged = window.nodus.onGlobalLibraryChanged(() => {
      void load();
      void refreshSelectedLibraryDetail();
    });
    const offExtraction = window.nodus.onLibraryExtractionProgress((progress) => {
      setJobs((current) => [progress, ...current.filter((job) => job.id !== progress.id)]);
      setForegroundPreparation((current) => current?.jobId === progress.id && ['queued', 'processing'].includes(progress.status)
        ? { ...current, progress: progress.progress, message: preparationPhaseLabel(progress) }
        : current);
      if (progress.status === 'done') {
        setForegroundPreparation((current) => {
          if (current?.jobId !== progress.id) return current;
          onOpenReader({
            id: current.item.id,
            zoteroKey: current.item.source === 'zotero' ? current.item.sourceKey ?? null : null,
            title: current.item.metadata.title,
            authors: current.item.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean),
            year: current.item.metadata.year ?? null,
            preferredSource: 'clean',
          });
          return null;
        });
      } else if (progress.status === 'failed' || progress.status === 'canceled') {
        setForegroundPreparation((current) => {
          if (current?.jobId !== progress.id) return current;
          if (progress.status === 'failed') {
            toast(t('No se pudo preparar ahora; se abrirá el original.'), { tone: 'info' });
            onOpenReader({
              id: current.item.id,
              zoteroKey: current.item.source === 'zotero' ? current.item.sourceKey ?? null : null,
              title: current.item.metadata.title,
              authors: current.item.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean),
              year: current.item.metadata.year ?? null,
              preferredSource: 'original',
            });
          }
          return null;
        });
      }
      if (progress.status === 'done' || progress.status === 'failed' || progress.status === 'canceled') {
        void load();
        void refreshSelectedLibraryDetail(progress.itemId);
      }
    });
    return () => { offChanged(); offExtraction(); };
  }, [load, onOpenReader, refreshSelectedLibraryDetail]);
  useEffect(() => {
    if (!detailId) { setDetail(null); setDetailLinks([]); return; }
    void refreshSelectedLibraryDetail();
  }, [detailId, refreshSelectedLibraryDetail, status?.lastRebuiltAt]);
  useEffect(() => { setDetailActionsOpen(false); }, [detailId]);
  useEffect(() => {
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAddMenuOpen(false); setMoreMenuOpen(false); setDetailActionsOpen(false); setItemContextMenu(null);
    };
    window.addEventListener('keydown', closeMenus);
    return () => window.removeEventListener('keydown', closeMenus);
  }, []);
  useEffect(() => {
    const itemId = target?.readerItemId;
    if (!itemId) return;
    const page = target.readerPage ?? null;
    const attachmentId = target.readerAttachmentId ?? null;
    onTargetConsumed?.();
    void window.nodus.getGlobalLibraryItem(itemId).then((item) => {
      if (!item) return;
      if (item.files?.reader || item.attachments.length) onOpenReader({
        id: item.id,
        zoteroKey: item.source === 'zotero' ? item.sourceKey ?? null : null,
        title: item.metadata.title,
        authors: item.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean),
        year: item.metadata.year ?? null,
        ...(page ? { page } : {}),
        ...(attachmentId && item.attachments.some(attachment => attachment.id === attachmentId) ? { attachmentId } : {}),
      });
      else setDetailId(item.id);
    });
  }, [onOpenReader, onTargetConsumed, target?.nonce, target?.readerItemId, target?.readerPage, target?.readerAttachmentId]);
  useEffect(() => {
    if (!target?.citationStyles) return;
    setCitationItems([]);
    onTargetConsumed?.();
  }, [onTargetConsumed, target?.citationStyles, target?.nonce]);

  const children = useMemo(() => collectionChildren(collections), [collections]);
  const localCollections = useMemo(() => collections.filter((entry) => entry.source === 'nodus'), [collections]);
  const activeJobs = jobs.filter((job) => ['queued', 'processing'].includes(job.status));
  const detailJob = detail ? activeJobs.find((job) => job.itemId === detail.id) ?? null : null;
  const detailReadingLabel = detail ? t(detailJob ? preparationPhaseLabel(detailJob)
    : detail.attachments.length === 0 ? 'Sin archivo'
      : detail.extraction?.status === 'ready' ? 'Lista para leer'
        : detail.extraction?.status === 'needs-review' ? 'Lectura preparada; conviene revisarla'
          : detail.extraction?.status === 'failed' ? 'No se pudo preparar la lectura'
            : 'Preparación pendiente') : '';
  const visibleColumns = viewPreferences.visibleColumns;
  const tableGrid = `2.2rem ${visibleColumns.map((column) => viewPreferences.columnWidths?.[column] ? `${viewPreferences.columnWidths[column]}px` : COLUMN_WIDTH[column]).join(' ')}`;
  const tableMinWidth = Math.max(560, 160 + visibleColumns.length * 112);

  const createCollection = async () => {
    const name = await promptText({ title: t('Nueva colección'), placeholder: t('Nombre de la colección'), confirmLabel: t('Crear') });
    if (!name?.trim()) return;
    try {
      const selectedParent = collections.find((entry) => entry.id === selectedCollection);
      const created = await window.nodus.createGlobalLibraryCollection(name, selectedParent?.source === 'nodus' ? selectedParent.id : null);
      setExpanded((current) => new Set([...current, ...(created.parentId ? [created.parentId] : [])]));
      setSelectedCollection(created.id); await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const renameCollection = async (collectionId: string) => {
    const current = collections.find((entry) => entry.id === collectionId);
    if (!current || current.source !== 'nodus') return;
    const name = await promptText({ title: t('Renombrar colección'), initial: current.name, confirmLabel: t('Guardar') });
    if (!name?.trim()) return;
    try { await window.nodus.updateGlobalLibraryCollection(current.id, { name }); await load(); }
    catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const moveCollection = async (current: LibraryCollectionView, parentId: string | null) => {
    const position = children.get(parentId)?.filter((entry) => entry.id !== current.id).length ?? 0;
    await window.nodus.updateGlobalLibraryCollection(current.id, { parentId, position });
    if (parentId) setExpanded((value) => new Set([...value, parentId]));
    await load();
    toast(t('Colección movida.'));
  };

  const deleteCollection = async (collectionId: string) => {
    const current = collections.find((entry) => entry.id === collectionId);
    if (!current || current.source !== 'nodus') return;
    const subtree = collectionSubtreeIds(current.id, children);
    const subcollectionCount = subtree.size - 1;
    if (!(await confirm({
      title: t('Eliminar colección'),
      message: tx('Se eliminará «{name}» y {n} subcolección(es). No se borrará ningún ítem, archivo, nota, anotación ni análisis; sólo desaparecerá esta agrupación.', { name: current.name, n: subcollectionCount }),
      danger: true,
      confirmLabel: t('Eliminar'),
    }))) return;
    try {
      await window.nodus.deleteGlobalLibraryCollection(current.id, false);
      if (selectedCollection && subtree.has(selectedCollection)) setSelectedCollection(null);
      await load();
      toast(t('Colección eliminada; sus ítems siguen en la Biblioteca.'));
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const importDroppedFiles = async (fileList: FileList, collectionId: string | null) => {
    const filePaths = [...new Set(Array.from(fileList)
      .map((file) => window.nodus.getPathForDroppedFile(file))
      .filter((entry): entry is string => !!entry))];
    setDragImport(null);
    if (!filePaths.length) return;
    try {
      const report = await window.nodus.importDroppedGlobalLibraryFiles(filePaths, collectionId);
      if (report.created) toast(librarySettings.autoPrepareAttachments
        ? tx('{n} documento(s) añadido(s). Puedes editar sus metadatos mientras Nodus prepara la lectura.', { n: report.created })
        : tx('{n} documento(s) añadido(s). La preparación automática está desactivada.', { n: report.created }));
      if (report.warnings.length) toast(report.warnings[0], { tone: report.created ? 'info' : 'error' });
      await load();
      if (report.itemIds[0]) setDetailId(report.itemIds[0]);
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const dropOnCollection = async (event: DragEvent, targetCollection: LibraryCollectionView) => {
    event.preventDefault(); event.stopPropagation();
    try {
      if (event.dataTransfer.files.length) {
        if (targetCollection.source !== 'nodus') throw new Error(t('Las colecciones importadas son de solo lectura en Nodus.'));
        await importDroppedFiles(event.dataTransfer.files, targetCollection.id);
        return;
      }
      const movedCollectionId = event.dataTransfer.getData('application/x-nodus-library-collection');
      if (movedCollectionId) {
        if (movedCollectionId === targetCollection.id) return;
        if (targetCollection.source !== 'nodus') throw new Error(t('Las colecciones importadas son de solo lectura en Nodus.'));
        const nextParentId = targetCollection.id;
        const nextPosition = children.get(targetCollection.id)?.length ?? 0;
        await window.nodus.updateGlobalLibraryCollection(movedCollectionId, { parentId: nextParentId, position: nextPosition });
        setExpanded((current) => new Set([...current, nextParentId])); await load();
        toast(t('Colección movida.'));
        return;
      }
      const rawItems = event.dataTransfer.getData('application/x-nodus-library-items');
      if (rawItems) {
        if (targetCollection.source !== 'nodus') throw new Error(t('Las colecciones importadas son de solo lectura en Nodus.'));
        const itemIds = JSON.parse(rawItems) as string[];
        await window.nodus.patchGlobalLibraryItemCollections(itemIds, { add: [targetCollection.id] }); await load();
      }
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const dropCollectionAtRoot = async (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer.files.length) {
      await importDroppedFiles(event.dataTransfer.files, null);
      return;
    }
    const collectionId = event.dataTransfer.getData('application/x-nodus-library-collection');
    if (!collectionId) return;
    try { await window.nodus.updateGlobalLibraryCollection(collectionId, { parentId: null, position: children.get(null)?.length ?? 0 }); await load(); }
    catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const removeSavedSearch = async (record: LibrarySavedSearchRecord) => {
    if (!(await confirm({ title: t('Eliminar búsqueda inteligente'), message: t('Sólo se elimina la búsqueda; ningún documento cambia.'), danger: true, confirmLabel: t('Eliminar') }))) return;
    await window.nodus.deleteGlobalLibrarySavedSearch(record.id);
    if (selectedSavedSearch === record.id) setSelectedSavedSearch(null);
    await load();
  };

  const sortByColumn = async (field: LibrarySortField, additive: boolean) => {
    const existing = viewPreferences.sort.find((entry) => entry.field === field);
    const nextRule = { field, direction: existing?.direction === 'asc' ? 'desc' as const : 'asc' as const };
    const sort = additive
      ? [...viewPreferences.sort.filter((entry) => entry.field !== field), nextRule].slice(-3)
      : [nextRule];
    const next = { ...viewPreferences, sort };
    setViewPreferences(next); setOffset(0);
    await window.nodus.setGlobalLibraryViewPreferences(next);
  };

  const importFiles = async () => {
    try {
      const report = await window.nodus.importGlobalLibraryFiles(selectedCollection);
      if (report.created) toast(librarySettings.autoPrepareAttachments
        ? tx('{n} documento(s) importado(s); la extracción continúa en segundo plano.', { n: report.created })
        : tx('{n} documento(s) importado(s). La preparación automática está desactivada.', { n: report.created }));
      else if (report.warnings.length) toast(report.warnings[0], { tone: 'info' });
      await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const importBibliography = async () => {
    try {
      const report = await window.nodus.importGlobalBibliographyFiles(selectedCollection);
      if (report.created) toast(tx('{n} referencia(s) importada(s).', { n: report.created }));
      else if (report.duplicates) toast(tx('{n} referencia(s) ya estaban en la Biblioteca.', { n: report.duplicates }), { tone: 'info' });
      else if (report.warnings.length) toast(report.warnings[0], { tone: 'info' });
      await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const duplicateDetail = async () => {
    if (!detail) return; const created = await window.nodus.duplicateGlobalLibraryItem(detail.id);
    setDetailId(created.id); setDetail(created); toast(t('Se creó una copia independiente de Nodus.')); await load();
  };

  const convertDetail = async () => {
    if (!detail || detail.source === 'nodus') return; const created = await window.nodus.convertGlobalLibraryItemToNodus(detail.id);
    setDetailId(created.id); setDetail(created); toast(t('Se creó una ficha Nodus independiente; el espejo de origen se conserva.')); await load();
  };

  const applyBulkTag = async (tag: string) => {
    if (!selected.size) return;
    await window.nodus.patchGlobalLibraryItemTags([...selected], { add: [tag] });
    toast(tx('Etiqueta «{tag}» añadida a {n} documento(s).', { tag, n: selected.size })); await load();
  };

  const rebuildSelectedCleanReading = async () => {
    const ids = selected.size ? [...selected] : detailId ? [detailId] : [];
    if (!ids.length) return;
    const result = await window.nodus.enqueueLibraryExtraction(ids, { force: true });
    toast(result.queued
      ? tx('Preparando la lectura de {n} documento(s) en segundo plano.', { n: result.queued })
      : t('La preparación ya estaba en curso.'));
    setSelected(new Set()); await load();
  };

  const prepareDetail = async (force = false) => {
    if (!detail) return;
    const result = await window.nodus.enqueueLibraryExtraction([detail.id], { force });
    if (result.queued) toast(t('Preparando lectura en segundo plano.'));
    else toast(t('La preparación ya estaba en curso.'), { tone: 'info' });
    await load();
  };

  const addFileToDetail = async () => {
    if (!detail) return;
    try {
      const saved = await window.nodus.addGlobalLibraryAttachments(detail.id);
      setDetail(saved);
      await load();
      if (saved.attachments.length > detail.attachments.length) toast(t(librarySettings.autoPrepareAttachments
        ? 'Archivo añadido. Nodus está preparando la lectura.'
        : 'Archivo añadido. La preparación automática está desactivada.'));
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const cancelDetailPreparation = async () => {
    if (!detailJob) return;
    if (await window.nodus.cancelLibraryExtraction(detailJob.id)) {
      toast(t('Preparación cancelada. El archivo original se conserva.'), { tone: 'info' });
      await load();
    }
  };

  const selectedLocalCollection = collections.find((entry) => entry.id === selectedCollection && entry.source === 'nodus') ?? null;
  const applySelectedToCollection = async (mode: 'copy' | 'move', target: string) => {
    if (!selected.size) return;
    const moving = mode === 'move' && selectedLocalCollection;
    await window.nodus.patchGlobalLibraryItemCollections([...selected], { add: [target], ...(moving ? { remove: [selectedLocalCollection.id] } : {}) });
    toast(t(moving ? 'Documentos movidos a la colección.' : 'Documentos añadidos a la colección.'));
    setSelected(new Set()); await load();
  };
  const removeSelectedFromCollection = async () => {
    if (!selected.size || !selectedLocalCollection) return;
    await window.nodus.patchGlobalLibraryItemCollections([...selected], { remove: [selectedLocalCollection.id] });
    toast(t('Documentos retirados de la colección.'));
    setSelected(new Set()); await load();
  };

  const deleteSelected = async () => {
    const ids = selected.size ? [...selected] : detailId ? [detailId] : [];
    if (!ids.length || !(await confirm({ title: t('Enviar a la papelera'), message: tx('Se ocultarán {n} documento(s). Los archivos se conservan y pueden restaurarse.', { n: ids.length }), danger: true, confirmLabel: t('Enviar a la papelera') }))) return;
    await window.nodus.setGlobalLibraryItemsDeleted(ids, true); setSelected(new Set()); setDetailId(null); await load();
  };

  const restoreSelected = async (only?: string[]) => {
    const ids = only ?? (selected.size ? [...selected] : detailId ? [detailId] : []);
    if (!ids.length) return;
    await window.nodus.setGlobalLibraryItemsDeleted(ids, false); setSelected(new Set()); setDetailId(null);
    toast(tx('{n} elemento(s) restaurado(s).', { n: ids.length })); await load();
  };

  const openTrash = () => {
    setTrashMode(true); setSelectedCollection(null); setSelectedSavedSearch(null); setSelected(new Set()); setDetailId(null); setOffset(0);
  };

  const closeTrash = () => {
    setTrashMode(false); setSelected(new Set()); setDetailId(null); setOffset(0);
  };

  const openReaderReference = (item: LibraryItemRecord, preferredSource?: 'clean' | 'original') => onOpenReader({
    id: item.id,
    zoteroKey: item.source === 'zotero' ? item.sourceKey ?? null : null,
    title: item.metadata.title,
    authors: item.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean),
    year: item.metadata.year ?? null,
    preferredSource,
  });

  const openReader = async (itemId: string, preferredSource?: 'clean' | 'original') => {
    const item = detail?.id === itemId ? detail : await window.nodus.getGlobalLibraryItem(itemId);
    if (!item || (!item.files?.reader && !item.attachments.length)) return;
    if (preferredSource) { openReaderReference(item, preferredSource); return; }
    const plan = await window.nodus.prepareGlobalLibraryReading(item.id);
    if (plan.action === 'open-clean') { openReaderReference(item); return; }
    if (plan.action === 'queue-and-open-original') {
      toast(plan.pageCount
        ? tx('Documento largo ({n} páginas): la versión limpia queda en segundo plano.', { n: plan.pageCount })
        : t('Documento largo: la versión limpia queda en segundo plano.'), { tone: 'info' });
      openReaderReference(item, 'original');
      return;
    }
    if (plan.action === 'prepare-before-open' && plan.jobId) {
      setForegroundPreparation({ item, jobId: plan.jobId, progress: 0, message: t('Preparando lectura…') });
      return;
    }
    openReaderReference(item, 'original');
  };

  const loadContextItem = async (): Promise<LibraryItemRecord | null> => {
    const itemId = itemContextMenu?.itemId;
    setItemContextMenu(null);
    if (!itemId) return null;
    const item = detail?.id === itemId ? detail : await window.nodus.getGlobalLibraryItem(itemId);
    if (item) { setDetailId(item.id); setDetail(item); }
    return item;
  };

  const openContextManager = async (tab: 'attachments' | 'notes') => {
    const item = await loadContextItem();
    if (item) setManager({ item, tab });
  };

  const editContextMetadata = async () => {
    const item = await loadContextItem();
    if (item) setMetadataItem(item);
  };

  const revealContextOriginal = async () => {
    const item = await loadContextItem();
    const attachment = item?.attachments.find((entry) => entry.role === 'original') ?? item?.attachments[0];
    if (item && attachment) await window.nodus.revealGlobalLibraryAttachment(item.id, attachment.id);
  };

  const openContextOnlineSource = async () => {
    const item = await loadContextItem();
    if (item?.metadata.url) await window.nodus.openExternal(item.metadata.url);
  };

  const duplicateContextItem = async () => {
    const item = await loadContextItem();
    if (!item) return;
    const created = await window.nodus.duplicateGlobalLibraryItem(item.id);
    setDetailId(created.id); setDetail(created); await load();
    toast(t('Se creó una copia independiente de Nodus.'));
  };

  const trashContextItem = async () => {
    const item = await loadContextItem();
    if (!item || !(await confirm({ title: t('Enviar a la papelera'), message: t('El archivo, las notas y los análisis se conservarán hasta que vacíes la papelera.'), danger: true, confirmLabel: t('Enviar a la papelera') }))) return;
    await window.nodus.setGlobalLibraryItemsDeleted([item.id], true);
    setDetailId(null); await load();
  };

  if (loading && !status) return <div data-testid="global-library-view" className="library-theme-canvas flex h-full min-h-0 flex-col bg-neutral-950"><header data-testid="global-library-header" className="library-header-bar min-h-14 shrink-0 border-b border-neutral-800 px-5 py-3"><div className="library-header-title min-w-0"><h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="book" className="text-indigo-400" /> {t('Biblioteca')}</h1></div>{scopeControls}<div className="library-header-actions" /></header><div className="grid min-h-0 flex-1 place-items-center text-sm text-neutral-500"><span className="flex items-center gap-2"><Spinner /> {t('Cargando Biblioteca…')}</span></div></div>;
  if (!status?.configured) return (
    <div data-testid="global-library-view" className="library-theme-canvas flex h-full min-h-0 flex-col bg-neutral-950">
      <header data-testid="global-library-header" className="library-header-bar min-h-14 shrink-0 border-b border-neutral-800 px-5 py-3"><div className="library-header-title min-w-0"><h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="book" className="text-indigo-400" /> {t('Biblioteca')}</h1></div>{scopeControls}<div className="library-header-actions" /></header>
      <div className="grid min-h-0 flex-1 place-items-center p-8"><section className="card max-w-lg p-7 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-300"><Icon name="book" size={28} /></span>
        <h1 className="mt-4 text-xl font-semibold">{t('Activa la Biblioteca transversal')}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">{t('Elige una carpeta de copias de seguridad. Nodus creará dentro nodus-library para guardar originales, Markdown limpio y recursos.')}</p>
        <button className="btn btn-primary mt-5" onClick={onOpenSettings}><Icon name="settings" /> {t('Configurar copias de seguridad')}</button>
      </section></div>
    </div>
  );

  return (
    <div data-testid="global-library-view" className="library-theme-canvas flex h-full min-h-0 flex-col bg-neutral-950">
      <header data-testid="global-library-header" className="library-header-bar min-h-14 border-b border-neutral-800 px-5 py-3">
        <div className="library-header-title min-w-0"><h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name={trashMode ? 'trash' : 'book'} className={trashMode ? 'text-red-400' : 'text-indigo-400'} /> {t(trashMode ? 'Papelera' : 'Biblioteca')}</h1><p className="text-[11px] text-neutral-500">{trashMode ? tx('{n} elemento(s) recuperable(s)', { n: trashCount }) : tx('{n} documentos · disponible en todos los vaults', { n: status.items })}</p></div>
        {scopeControls}
        <div className="library-header-actions">
          {activeJobs.length > 0 && <span className="flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300"><Spinner /> {tx('{n} tarea(s) en segundo plano', { n: activeJobs.length })}</span>}
        {trashMode ? <><button data-testid="close-library-trash" className="btn btn-ghost border border-neutral-700" onClick={closeTrash}><Icon name="chevronLeft" /> {t('Volver a la Biblioteca')}</button><button data-testid="empty-library-trash" className="btn btn-ghost border border-red-500/30 text-red-400" disabled={!trashCount} onClick={() => setTrashImpactItems([])}><Icon name="trash" /> {t('Vaciar papelera')}</button></> : <>
          <div className="relative z-40">
            <button
              data-testid="library-add-menu-toggle"
              className="btn btn-primary relative z-40"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              onClick={() => { setAddMenuOpen((value) => !value); setMoreMenuOpen(false); }}
            ><Icon name="plus" /> {t('Añadir')} <Icon name="chevronDown" size={12} /></button>
            {addMenuOpen && <><button className="fixed inset-0 z-30 cursor-default" aria-label={t('Cerrar menú')} onClick={() => setAddMenuOpen(false)} /><div data-testid="library-add-menu" role="menu" className="library-action-menu absolute right-0 top-[calc(100%+.45rem)] z-50 w-64 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl">
              <button data-testid="magic-add-library-reference" role="menuitem" className="library-action-menu-item" onClick={() => { setAddMenuOpen(false); setCreateReferenceMode('identifier'); }}><Icon name="wand" /><span><b>{t('Añadir por identificador')}</b><small>{t('DOI, ISBN, ISSN, PMID, PMCID, arXiv o una dirección web')}</small></span></button>
              <button data-testid="create-library-reference" role="menuitem" className="library-action-menu-item" onClick={() => { setAddMenuOpen(false); setCreateReferenceMode('manual'); }}><Icon name="edit" /><span><b>{t('Entrada manual')}</b><small>{t('Crear una referencia sin archivo')}</small></span></button>
              <button data-testid="add-library-files" role="menuitem" className="library-action-menu-item" onClick={() => { setAddMenuOpen(false); void importFiles(); }}><Icon name="upload" /><span><b>{t('Añadir archivos')}</b><small>{t(librarySettings.autoPrepareAttachments ? 'La lectura se prepara automáticamente' : 'La preparación automática está desactivada')}</small></span></button>
              <button data-testid="import-library-bibliography" role="menuitem" className="library-action-menu-item" onClick={() => { setAddMenuOpen(false); void importBibliography(); }}><Icon name="fileText" /><span><b>{t('Importar referencias')}</b><small>{t('RIS, BibTeX, CSL JSON y otros formatos')}</small></span></button>
            </div></>}
          </div>
          <button data-testid="open-zotero-global-import" className="btn btn-secondary" onClick={() => setZoteroOpen(true)}><Icon name="refresh" /> {t('Sincronizar Zotero')}</button>
          <button data-testid="open-global-library-settings" className="btn btn-ghost border border-neutral-700" aria-label={t('Opciones de la Biblioteca global')} title={t('Opciones de la Biblioteca global')} onClick={() => { setLibrarySettingsOpen(true); setAddMenuOpen(false); setMoreMenuOpen(false); }}><Icon name="tools" /></button>
          <div className="relative z-40">
            <button data-testid="library-more-menu-toggle" className="btn btn-ghost relative z-40 border border-neutral-700" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu" aria-expanded={moreMenuOpen} onClick={() => { setMoreMenuOpen((value) => !value); setAddMenuOpen(false); }}><Icon name="menu" /></button>
            {moreMenuOpen && <><button className="fixed inset-0 z-30 cursor-default" aria-label={t('Cerrar menú')} onClick={() => setMoreMenuOpen(false)} /><div data-testid="library-more-menu" role="menu" className="library-action-menu absolute right-0 top-[calc(100%+.45rem)] z-50 w-60 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl">
              <button data-testid="open-library-migration" role="menuitem" className="library-action-menu-item" onClick={() => { setMoreMenuOpen(false); setMigrationOpen(true); }}><Icon name="vault" /><span><b>{t('Migrar vaults')}</b></span></button>
              <button data-testid="open-library-duplicates" role="menuitem" className="library-action-menu-item" onClick={() => { setMoreMenuOpen(false); setDuplicatesOpen(true); }}><Icon name="copy" /><span><b>{t('Revisar duplicados')}</b></span></button>
              <button data-testid="open-library-export" role="menuitem" className="library-action-menu-item" onClick={() => { setMoreMenuOpen(false); setCitationItems([]); }}><Icon name="download" /><span><b>{t('Exportar biblioteca')}</b></span></button>
              <button data-testid="open-library-recovery" role="menuitem" className="library-action-menu-item" onClick={() => { setMoreMenuOpen(false); setRecoveryOpen(true); }}><Icon name="shield" /><span><b>{t('Revisión y recuperación')}</b></span></button>
              <button data-testid="open-library-trash-mobile" role="menuitem" className="library-action-menu-item text-red-400 lg:hidden" onClick={() => { setMoreMenuOpen(false); openTrash(); }}><Icon name="folder" /><span><b>{t('Papelera')}</b><small>{tx('{n} elemento(s) recuperable(s)', { n: trashCount })}</small></span></button>
            </div></>}
          </div>
        </>}
        </div>
      </header>

      {error && <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">{error}</div>}
      {foregroundPreparation && <div data-testid="library-foreground-preparation" role="status" className="flex h-9 shrink-0 items-center gap-3 border-b border-indigo-500/20 bg-indigo-500/5 px-5 text-xs"><Spinner /><span className="min-w-0 flex-1 truncate"><b>{foregroundPreparation.item.metadata.title}</b> · {t(foregroundPreparation.message)}</span><div className="h-1.5 w-32 overflow-hidden rounded-full bg-neutral-800"><span className="block h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(3, foregroundPreparation.progress * 100)}%` }} /></div><span className="w-9 text-right tabular-nums text-indigo-300">{Math.round(foregroundPreparation.progress * 100)}%</span><button className="grid h-7 w-7 place-items-center rounded text-neutral-500 hover:bg-neutral-900 hover:text-red-400" aria-label={t('Cancelar preparación')} title={t('Cancelar preparación')} onClick={() => { void window.nodus.cancelLibraryExtraction(foregroundPreparation.jobId); setForegroundPreparation(null); }}><Icon name="x" size={13} /></button></div>}
      {(status.conflicts > 0 || status.invalidRecords > 0) && <div data-testid="global-library-integrity-warning" role="status" className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-200"><Icon name="alert" size={14} className="mt-0.5 shrink-0" /><span><b>{t('La Biblioteca necesita revisión.')}</b> {tx('{conflicts} conflicto(s) conservado(s) · {invalid} registro(s) inválido(s) excluido(s). Los originales no se han modificado.', { conflicts: status.conflicts, invalid: status.invalidRecords })}</span></div>}
      <div className="flex min-h-0 flex-1">
        <aside className="library-theme-panel hidden w-[238px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/80 lg:flex">
          <div className="flex items-center gap-1 px-3 py-3"><b className="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-neutral-500">{t('Colecciones')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" title={t('Nueva colección')} onClick={() => void createCollection()}><Icon name="folderPlus" size={14} /></button></div>
          <div className="px-2 pb-2" onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDragImport({ collectionId: null, label: t('Biblioteca') }); }} onDragLeave={() => setDragImport(null)} onDrop={(event) => void dropCollectionAtRoot(event)}>
            <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${!trashMode && selectedCollection === null && selectedSavedSearch === null ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`} onClick={() => { setTrashMode(false); setSelectedCollection(null); setSelectedSavedSearch(null); setSelected(new Set()); setDetailId(null); setOffset(0); }}><Icon name="library" size={14} /><span className="flex-1">{t('Todos los documentos')}</span><span className="text-[10px] opacity-60">{status.items}</span></button>
          </div>
          <div ref={sidebarNavigationRef} data-testid="library-sidebar-navigation" className="flex min-h-0 flex-1 flex-col">
            <div data-testid="library-collections-pane" className="min-h-0 shrink-0 overflow-y-auto px-2 pb-1" style={{ flexBasis: `${collectionPaneRatio}%` }}>
              {(children.get(null) ?? []).map((collection) => <CollectionBranch key={collection.id} collection={collection} children={children} selected={trashMode ? null : selectedCollection} expanded={expanded} onSelect={(id) => { setTrashMode(false); setSelectedCollection(id); setSelectedSavedSearch(null); setSelected(new Set()); setDetailId(null); setOffset(0); }} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onDrop={(event, entry) => void dropOnCollection(event, entry)} onRename={(entry) => void renameCollection(entry.id)} onMove={setMovingCollection} onStyle={setStylingCollection} onDelete={(entry) => void deleteCollection(entry.id)} depth={0} />)}
              {collections.length === 0 && <p className="px-3 py-4 text-xs leading-5 text-neutral-600">{t('Crea colecciones propias o importa la jerarquía completa de Zotero.')}</p>}
            </div>
            <div
              data-testid="library-sidebar-section-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label={`${t('Colecciones')} · ${t('Búsquedas inteligentes')}`}
              aria-valuemin={MIN_LIBRARY_COLLECTION_PANE_RATIO}
              aria-valuemax={MAX_LIBRARY_COLLECTION_PANE_RATIO}
              aria-valuenow={collectionPaneRatio}
              tabIndex={0}
              className="group grid h-3 shrink-0 cursor-row-resize touch-none place-items-center px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/60"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizeCollectionPaneFromPointer(event.clientY); }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeCollectionPaneFromPointer(event.clientY); }}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
              onDoubleClick={() => resizeCollectionPane(DEFAULT_LIBRARY_COLLECTION_PANE_RATIO)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') { event.preventDefault(); resizeCollectionPane(collectionPaneRatio - 4); }
                else if (event.key === 'ArrowDown') { event.preventDefault(); resizeCollectionPane(collectionPaneRatio + 4); }
                else if (event.key === 'Home') { event.preventDefault(); resizeCollectionPane(MIN_LIBRARY_COLLECTION_PANE_RATIO); }
                else if (event.key === 'End') { event.preventDefault(); resizeCollectionPane(MAX_LIBRARY_COLLECTION_PANE_RATIO); }
              }}
              title={`${t('Colecciones')} · ${t('Búsquedas inteligentes')}`}
            ><span className="h-px w-full bg-neutral-800 transition-colors group-hover:bg-indigo-500/60" /></div>
            <div data-testid="library-saved-searches-pane" className="flex min-h-0 flex-1 flex-col overflow-hidden px-2">
              <div className="flex shrink-0 items-center gap-1 px-1 py-2"><b className="min-w-0 flex-1 text-[10px] uppercase tracking-wider text-neutral-600">{t('Búsquedas inteligentes')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" onClick={() => setSmartSearchEditor('new')} title={t('Nueva búsqueda inteligente')}><Icon name="plus" size={13} /></button></div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">{savedSearches.map((record) => <button key={record.id} data-testid={`library-saved-search-${record.id}`} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${!trashMode && selectedSavedSearch === record.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`} onClick={() => { setTrashMode(false); setSelectedSavedSearch(record.id); setSelectedCollection(null); setSelected(new Set()); setDetailId(null); setOffset(0); }}><Icon name="search" size={12} /><span className="min-w-0 flex-1 truncate">{record.name}</span></button>)}</div>
              {selectedSavedSearch && savedSearches.find((entry) => entry.id === selectedSavedSearch) && <div className="flex shrink-0 gap-1 border-t border-neutral-800 py-2"><button className="btn btn-ghost flex-1 text-xs" onClick={() => setSmartSearchEditor(savedSearches.find((entry) => entry.id === selectedSavedSearch) ?? null)}><Icon name="edit" size={13} /> {t('Editar')}</button><button className="btn btn-ghost text-red-400" onClick={() => { const record = savedSearches.find((entry) => entry.id === selectedSavedSearch); if (record) void removeSavedSearch(record); }} title={t('Eliminar')}><Icon name="trash" size={13} /></button></div>}
            </div>
          </div>
          <div data-testid="library-trash-section" className="flex h-10 shrink-0 items-center border-t border-red-500/15 px-2">
            <button
              data-testid="open-library-trash"
              className={`library-trash-folder flex h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs ${trashMode ? 'is-active' : ''}`}
              onClick={openTrash}
              aria-current={trashMode ? 'page' : undefined}
            >
              <Icon name="folder" size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('Papelera')}</span>
              {trashCount ? <span className="library-trash-folder-count rounded-full px-1.5 text-[10px] tabular-nums">{trashCount}</span> : null}
            </button>
          </div>
        </aside>

        <section
          data-testid="library-file-drop-surface"
          className="relative flex min-w-0 flex-1 flex-col"
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            const collection = collections.find((entry) => entry.id === selectedCollection && entry.source === 'nodus');
            setDragImport({ collectionId: collection?.id ?? null, label: collection?.name ?? t('Biblioteca') });
          }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragImport(null); }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            void importDroppedFiles(event.dataTransfer.files, dragImport?.collectionId ?? null);
          }}
        >
          {dragImport && <div data-testid="library-file-drop-overlay" className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-500/10 backdrop-blur-sm"><div className="rounded-2xl border border-indigo-400/35 bg-white/95 px-7 py-5 text-center shadow-2xl dark:bg-neutral-950/95"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500"><Icon name="upload" size={22} /></span><b className="mt-3 block text-sm">{t('Suelta para añadir')}</b><span className="mt-1 block max-w-xs text-xs text-neutral-500">{dragImport.collectionId ? tx('Se añadirá a «{name}» y Nodus inferirá los metadatos que pueda.', { name: dragImport.label }) : t('Se añadirá a la Biblioteca y Nodus inferirá los metadatos que pueda.')}</span></div></div>}
          <div className="border-b border-neutral-800 p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-[220px] flex-1"><Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-600" /><input data-testid="global-library-search" className="input input-with-leading-icon w-full" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t('Buscar título, autor, etiqueta, DOI, ISBN, ISSN, PMID o arXiv…')} /></div>
              <div className="relative" ref={filterBalloonRef}>
                <button data-testid="global-library-filters-toggle" className={`btn border border-neutral-700 ${filtersOpen || activeCatalogFilters > 0 ? 'bg-indigo-500/10 text-indigo-300' : 'btn-ghost'}`} onClick={toggleFilterPanel} aria-expanded={filtersOpen} aria-haspopup="dialog">
                  <Icon name="filter" /> {t('Filtros')}
                  {activeCatalogFilters > 0 && <span className="rounded bg-indigo-500/25 px-1.5 text-[10px] font-semibold tabular-nums">{activeCatalogFilters}</span>}
                </button>
                {filtersOpen && <div role="dialog" aria-label={t('Filtros')} data-testid="global-library-filters-panel" className="library-filter-balloon absolute right-0 top-full z-40 mt-2 w-[34rem] max-w-[calc(100vw-3rem)] rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MultiSelectDropdown testId="global-library-filter-source" label={t('Origen')} icon="library" selected={sources}
                      options={(Object.keys(SOURCE_LABEL) as LibraryItemSource[]).map((value) => ({ value, label: SOURCE_LABEL[value], count: facetOptions.sources.find((entry) => entry.value === value)?.count }))}
                      onChange={(next) => { setSources(next as LibraryItemSource[]); rememberCatalogFilters({ sources: next as LibraryItemSource[] }); }} />
                    <MultiSelectDropdown testId="global-library-filter-extraction" label={t('Estado')} icon="status" selected={extractions}
                      options={(Object.keys(EXTRACTION_LABEL) as LibraryCatalogItem['extractionStatus'][]).map((value) => ({ value, label: t(EXTRACTION_LABEL[value]), count: facetOptions.extraction.find((entry) => entry.value === value)?.count }))}
                      onChange={(next) => { setExtractions(next as LibraryCatalogItem['extractionStatus'][]); rememberCatalogFilters({ extractions: next as LibraryCatalogItem['extractionStatus'][] }); }} />
                    <MultiSelectDropdown testId="global-library-filter-type" label={t('Tipo')} icon="file" selected={itemTypes}
                      options={facetOptions.itemTypes.map((entry) => ({ value: entry.value, label: t(libraryItemTypeLabel(entry.value as LibraryItemType)), count: entry.count }))}
                      onChange={(next) => { setItemTypes(next as LibraryItemType[]); rememberCatalogFilters({ itemTypes: next as LibraryItemType[] }); }} />
                    <MultiSelectDropdown testId="global-library-filter-attachments" label={t('Adjuntos')} icon="copyText" selected={attachments}
                      options={[{ value: 'with', label: t('Con adjuntos') }, { value: 'without', label: t('Sin adjuntos') }]}
                      onChange={(next) => { setAttachments(next as Array<'with' | 'without'>); rememberCatalogFilters({ attachments: next as Array<'with' | 'without'> }); }} />
                    <MultiSelectDropdown testId="global-library-filter-tags" label={t('Etiquetas')} icon="tag" selected={tags}
                      options={facetOptions.tags.map((entry) => ({ value: entry.value, label: entry.value, count: entry.count }))}
                      onChange={(next) => { setTags(next); rememberCatalogFilters({ tags: next }); }} />
                    <MultiSelectDropdown testId="global-library-filter-vaults" label={t('Vaults')} icon="vault" selected={vaults}
                      options={facetOptions.vaults.map((entry) => ({ value: entry.value, label: vaultNames.get(entry.value) ?? entry.value, count: entry.count }))}
                      onChange={(next) => { setVaults(next); rememberCatalogFilters({ vaults: next }); }} />
                  </div>
                  <div className="mt-3 border-t border-neutral-800 pt-3">
                    <span className="mb-1 block text-[11px] font-medium text-neutral-500">{t('Años')}</span>
                    <div className="flex items-center gap-2">
                      <input data-testid="global-library-filter-year-from" className="input h-9 w-28 text-xs" type="number" inputMode="numeric" value={yearFrom} onChange={(event) => { const next = event.target.value; setYearFrom(next); rememberCatalogFilters({ yearFrom: next }); }} placeholder={t('Desde')} aria-label={t('Año desde')} />
                      <span className="text-neutral-600">–</span>
                      <input data-testid="global-library-filter-year-to" className="input h-9 w-28 text-xs" type="number" inputMode="numeric" value={yearTo} onChange={(event) => { const next = event.target.value; setYearTo(next); rememberCatalogFilters({ yearTo: next }); }} placeholder={t('Hasta')} aria-label={t('Año hasta')} />
                      <div className="flex-1" />
                      {activeCatalogFilters > 0 && <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={clearCatalogFilters}>{t('Limpiar filtros')}</button>}
                    </div>
                  </div>
                </div>}
              </div>
              <button data-testid="library-table-settings" className="btn btn-ghost border border-neutral-700" onClick={() => setTablePreferencesOpen(true)} title={t('Columnas y orden')}><Icon name="columns" /></button>
            </div>
          </div>

          {/* The selection's actions, as one row of icons whose tooltips carry the words. */}
          {selected.size > 0 && <div data-testid="global-library-bulk-actions" className="flex flex-nowrap items-center gap-0.5 overflow-x-auto border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-1 text-xs">
            <b className="mr-2 shrink-0 whitespace-nowrap">{tx('{n} seleccionados', { n: selected.size })}</b>
            {trashMode ? <>
              <BulkIconButton testId="bulk-restore-library-trash" icon="refresh" label={t('Restaurar')} onClick={() => void restoreSelected()} />
              <BulkIconButton testId="bulk-purge-library-trash" icon="trash" danger label={t('Revisar y vaciar')} onClick={() => setTrashImpactItems([...selected])} />
            </> : <>
              <BulkIconButton testId="bulk-copy-library-collection" icon="copy" label={t('Copiar a una colección')} disabled={!localCollections.length} onClick={() => setBulkDialog('copy')} />
              <BulkIconButton testId="bulk-move-library-collection" icon="folderMove" label={t('Mover a una colección')}
                hint={selectedLocalCollection ? undefined : t('Abre una colección de Nodus para mover documentos desde ella.')}
                disabled={!selectedLocalCollection || localCollections.length < 2} onClick={() => setBulkDialog('move')} />
              {selectedLocalCollection && <BulkIconButton testId="bulk-remove-library-collection" icon="minus" label={t('Quitar de esta colección')} hint={selectedLocalCollection.name} onClick={() => void removeSelectedFromCollection()} />}
              <BulkIconButton testId="bulk-tag-library-items" icon="tag" label={t('Etiquetar')} onClick={() => setBulkDialog('tag')} />
              <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-neutral-700/70" />
              <BulkIconButton testId="bulk-resolve-library-metadata" icon="wand" label={t('Completar metadatos')} onClick={() => setMetadataBatchItems([...selected])} />
              <BulkIconButton testId="bulk-library-citations" icon="quote" label={t('Citar / exportar')} onClick={() => setCitationItems([...selected])} />
              <BulkIconButton testId="bulk-add-library-to-vault" icon="vault" label={t('Usar en un vault')} onClick={() => setVaultLinkItems([...selected])} />
              <BulkIconButton testId="bulk-rebuild-library-clean" icon="scanText" label={t('Reconstruir versiones limpias')} hint={t('Repite extracción, OCR y estructura')} onClick={() => void rebuildSelectedCleanReading()} />
              <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-neutral-700/70" />
              <BulkIconButton testId="bulk-trash-library-items" icon="trash" danger label={t('Enviar a la papelera')} onClick={() => void deleteSelected()} />
            </>}
            <span className="ml-auto" />
            <BulkIconButton testId="bulk-clear-library-selection" icon="x" label={t('Limpiar selección')} onClick={() => setSelected(new Set())} />
          </div>}

          <div data-testid="library-catalog-scroll" className="library-catalog-scroll min-h-0 flex-1 overflow-x-auto">
          <div data-testid="global-library-table-header" className="grid h-9 items-center border-b border-neutral-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600" style={{ gridTemplateColumns: tableGrid, minWidth: tableMinWidth }}>
            <input type="checkbox" checked={items.length > 0 && items.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const item of items) { if (event.target.checked) next.add(item.id); else next.delete(item.id); } return next; })} aria-label={t('Seleccionar página')} />
            {visibleColumns.map((column) => { const sortField = COLUMN_SORT[column]; const sortIndex = sortField ? viewPreferences.sort.findIndex((entry) => entry.field === sortField) : -1; const rule = sortIndex >= 0 ? viewPreferences.sort[sortIndex] : null; return <button key={column} className="flex min-w-0 items-center gap-1 text-left hover:text-neutral-300" disabled={!sortField} onClick={(event) => sortField && void sortByColumn(sortField, event.shiftKey)} title={t('Clic para ordenar; Mayús+Clic añade un criterio')}><span className="truncate">{t(COLUMN_LABEL[column])}</span>{rule && <span className="text-indigo-400">{rule.direction === 'asc' ? '↑' : '↓'}{viewPreferences.sort.length > 1 ? sortIndex + 1 : ''}</span>}</button>; })}
          </div>
          <VirtualList
            items={items} itemHeight={62} getKey={(item) => item.id} className="library-catalog-list h-[calc(100%-2.25rem)] min-h-0 overflow-x-hidden" style={{ minWidth: tableMinWidth }}
            anchorKey={restoreAnchorId}
            onAnchorChange={(key) => {
              placementRef.current = key === null ? null : { anchorId: String(key), pageOffset: offset };
              reportSnapshot.current?.(snapshotOf.current());
            }}
            empty={<div className="grid h-full place-items-center p-8 text-center"><div><Icon name={trashMode ? 'trash' : 'book'} size={28} className="mx-auto text-neutral-700" /><p className="mt-3 text-sm text-neutral-400">{t(trashMode ? 'La papelera está vacía.' : 'No hay documentos que coincidan.')}</p><p className="mt-1 text-xs text-neutral-600">{t(trashMode ? 'Los elementos enviados aquí podrán restaurarse antes del vaciado manual.' : 'Añade archivos o importa una biblioteca de Zotero.')}</p></div></div>}
            renderItem={(item) => {
              const activeJob = jobs.find((job) => job.itemId === item.id && ['queued', 'processing'].includes(job.status));
              return <div
                data-testid={`global-library-item-${item.id}`}
                draggable
                className={`grid h-[62px] items-center border-b border-neutral-900 px-3 text-xs ${detailId === item.id ? 'bg-indigo-500/10' : 'hover:bg-neutral-900/55'}`}
                style={{ gridTemplateColumns: tableGrid }}
                onDragStart={(event) => { const itemIds = selected.has(item.id) ? [...selected] : [item.id]; event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('application/x-nodus-library-items', JSON.stringify(itemIds)); }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setDetailId(item.id);
                  setItemContextMenu({
                    itemId: item.id,
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 270)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 430)),
                  });
                }}
                onDoubleClick={(event) => { if ((event.target as HTMLElement).closest('button, input, select, a')) return; if (item.readerAvailable || item.attachmentCount) void openReader(item.id); else setDetailId(item.id); }}
              >
                <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
                {visibleColumns.map((column) => {
                  if (column === 'title') return <button key={column} className="min-w-0 pr-4 text-left" onClick={() => setDetailId(item.id)} onDoubleClick={(event) => { event.stopPropagation(); if (item.readerAvailable || item.attachmentCount) void openReader(item.id); }}><b className="flex min-w-0 items-center gap-1.5 font-medium text-neutral-200"><span className="truncate">{item.title}</span>{item.sourceState && item.sourceState !== 'current' && <Icon name="alert" size={11} className="shrink-0 text-amber-400" />}</b><span className="mt-1 block truncate text-[10px] text-neutral-600">{item.doi || item.isbn[0] || item.issn[0] || item.sourceKey || item.id}</span></button>;
                  if (column === 'source') return <span key={column} className="w-fit rounded bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{SOURCE_LABEL[item.source]}</span>;
                  if (column === 'status') {
                    const label = activeJob ? tx('Preparando… {progress}%', { progress: Math.round(activeJob.progress * 100) })
                      : !item.attachmentCount ? t('Sin archivo')
                        : item.extractionStatus === 'ready' ? t('Lista para leer')
                          : item.extractionStatus === 'needs-review' ? t('Lectura para revisar')
                            : item.extractionStatus === 'failed' ? t('No se pudo preparar')
                              : item.extractionStatus === 'unsupported' ? t('Archivo no compatible')
                                : t('Preparación pendiente');
                    return <span key={column} className={`flex items-center gap-1.5 text-[10px] ${activeJob ? 'text-indigo-300' : item.extractionStatus === 'ready' ? 'text-emerald-400' : item.extractionStatus === 'failed' ? 'text-red-400' : item.extractionStatus === 'needs-review' ? 'text-amber-400' : 'text-neutral-500'}`}>{activeJob && <Spinner />} {label}</span>;
                  }
                  if (column === 'createdAt' || column === 'updatedAt' || column === 'accessDate' || column === 'zoteroDateAdded' || column === 'zoteroDateModified') {
                    const dateTime = column === 'createdAt' || column === 'updatedAt' ? item[column] : item.metadata[column];
                    return <time key={column} className="truncate pr-3 text-[10px] text-neutral-500" dateTime={dateTime}>{catalogColumnText(item, column)}</time>;
                  }
                  return <span key={column} title={catalogColumnText(item, column)} className={`truncate pr-3 text-neutral-500 ${['year', 'attachments'].includes(column) ? 'tabular-nums' : ''}`}>{catalogColumnText(item, column)}</span>;
                })}
              </div>;
            }}
          />
          </div>
          <footer data-testid="library-table-footer" className="flex h-10 items-center border-t border-neutral-800 px-3 text-xs text-neutral-500"><span>{tx('{start}–{end} de {total}', { start: total ? offset + 1 : 0, end: Math.min(offset + items.length, total), total })}</span><div className="flex-1" /><button className="btn btn-ghost h-7" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><Icon name="chevronLeft" size={13} /></button><button className="btn btn-ghost h-7" disabled={offset + items.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}><Icon name="chevronRight" size={13} /></button></footer>
        </section>

        {detail && <aside data-testid="global-library-detail" className="library-theme-panel flex w-[340px] max-w-[45vw] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
          <header className="flex items-center gap-2 border-b border-neutral-800 p-3"><b className="min-w-0 flex-1 truncate text-sm">{t('Detalles')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" onClick={() => setDetailId(null)}><Icon name="x" size={14} /></button></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex items-center justify-between gap-2"><span className="rounded bg-indigo-500/10 px-2 py-1 text-[10px] font-medium text-indigo-300">{SOURCE_LABEL[detail.source]}</span><div className="flex items-center gap-1">
            <span
              data-testid="library-reading-status"
              role="status"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${detailJob ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : detail.extraction?.status === 'ready' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : detail.extraction?.status === 'needs-review' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : detail.extraction?.status === 'failed' ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-neutral-800 text-neutral-500'}`}
              title={detailReadingLabel}
              aria-label={detailReadingLabel}
            >{detailJob ? <Spinner /> : <Icon name={detail.files?.reader ? 'bookOpen' : detail.attachments.length ? 'clock' : 'file'} size={14} />}<span className="sr-only">{detailReadingLabel}</span></span>
            {!trashMode && <>
              <button data-testid="edit-library-metadata" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-neutral-800 text-neutral-500 hover:border-indigo-500/40 hover:text-indigo-300" onClick={() => setMetadataItem(detail)} title={t('Editar metadatos')} aria-label={t('Editar metadatos')}><Icon name="edit" size={14} /></button>
              <button data-testid="add-library-item-to-vault" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-neutral-800 text-neutral-500 hover:border-indigo-500/40 hover:text-indigo-300" onClick={() => setVaultLinkItems([detail.id])} title={t('Usar en un vault')} aria-label={t('Usar en un vault')}><Icon name="vault" size={14} /></button>
            </>}
            <details data-testid="library-extraction-advanced" className="relative">
              <summary className="grid h-8 w-8 shrink-0 cursor-pointer list-none place-items-center rounded-lg border border-neutral-800 text-neutral-500 hover:border-indigo-500/40 hover:text-indigo-300" title={t('Detalles técnicos')} aria-label={t('Detalles técnicos')}><Icon name="settings" size={14} /></summary>
              <div className="absolute right-0 top-[calc(100%+.4rem)] z-50 w-72 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[10px] leading-4 text-neutral-500 shadow-2xl">
                <div className="mb-2 flex items-center gap-2 font-medium text-neutral-300"><Icon name="settings" size={12} />{t('Detalles técnicos')}</div>
                <dl className="space-y-1"><div className="flex justify-between gap-3"><dt>{t('Estado')}</dt><dd>{t(EXTRACTION_LABEL[detail.extraction?.status ?? 'pending'])}</dd></div><div className="flex justify-between gap-3"><dt>{t('Adjuntos')}</dt><dd>{detail.attachments.length}</dd></div><div className="flex justify-between gap-3"><dt>{t('Markdown')}</dt><dd>{detail.files?.reader ? t('Disponible') : t('No disponible')}</dd></div>{detail.extraction?.engine && <div className="flex justify-between gap-3"><dt>{t('Motor')}</dt><dd className="truncate text-right">{detail.extraction.engine}</dd></div>}</dl>
                {detail.extraction?.error && <p className="mt-2 break-words rounded-lg bg-neutral-900 p-2 font-mono text-[9px] text-neutral-500">{detail.extraction.error}</p>}
                {detail.attachments.length > 0 && !detailJob && <button data-testid="rebuild-clean-library-reading" className="btn btn-ghost mt-3 w-full border border-neutral-700" onClick={() => void prepareDetail(true)}><Icon name="refresh" size={12} /> {t('Reconstruir versión limpia')}</button>}
                <p className="mt-2">{t('Repite extracción, OCR, limpieza y estructura. No ejecuta ideas, resúmenes, embeddings ni análisis del vault.')}</p>
              </div>
            </details>
            {detail.metadata.url && <button data-testid="library-online-source" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-neutral-800 text-neutral-500 hover:border-indigo-500/40 hover:text-indigo-300" onClick={() => void window.nodus.openExternal(detail.metadata.url!)} title={t('Abrir fuera de Nodus')} aria-label={t('Abrir fuera de Nodus')}><Icon name="external" size={14} /></button>}
          </div></div><h2 className="mt-3 text-base font-semibold leading-6">{detail.metadata.title}</h2><p className="mt-2 text-xs leading-5 text-neutral-500">{detail.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join('; ') || t('Sin autoría')}</p>
            {detail.sourceState && detail.sourceState !== 'current' && <div data-testid="library-source-missing" role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-950 dark:text-amber-100"><b>{t(detail.sourceState === 'library-missing' ? 'Biblioteca de origen no disponible' : 'Elemento ausente en el origen')}</b><p className="mt-1 opacity-80">{t('El contenido de Nodus se conserva y volverá a vincularse si reaparece en Zotero.')}</p></div>}
            <dl className="mt-5 space-y-3 text-xs">{[
              [t('Tipo'), t(libraryItemTypeLabel(detail.metadata.itemType))], [t('Fecha'), detail.metadata.date || detail.metadata.year], [t('Publicación'), detail.metadata.publicationTitle], [t('Editorial'), detail.metadata.publisher], [t('DOI'), detail.metadata.doi], [t('ISBN'), detail.metadata.isbn?.join('; ')], [t('ISSN'), detail.metadata.issn?.join('; ')], [t('PMID'), detail.metadata.pmid], [t('PMCID'), detail.metadata.pmcid], [t('arXiv'), detail.metadata.arxiv], [t('Clave de cita'), detail.citationKey], [t('Idioma'), detail.metadata.language], [t('Identificador'), detail.sourceKey || detail.id],
            ].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={String(label)}><dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt><dd className="mt-1 break-words text-neutral-300">{String(value)}</dd></div>)}</dl>
            {detail.metadata.abstract && <div className="mt-5"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Resumen')}</h3><p className="mt-2 text-xs leading-5 text-neutral-400">{detail.metadata.abstract}</p></div>}
            {detail.metadata.tags?.length ? <div className="mt-5 flex flex-wrap gap-1">{detail.metadata.tags.map((tag) => <span key={tag} className="rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{tag}</span>)}</div> : null}
            <div className="mt-5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Uso en vaults')}</h3>
              {detailLinks.length ? <div className="mt-2 space-y-1.5">{detailLinks.map((link) => <div key={`${link.vaultId}:${link.workId}`} className="rounded-lg border border-neutral-800 px-2.5 py-2 text-[10px]"><div className="flex items-center gap-2"><Icon name="vault" size={12} className="text-indigo-400" /><span className="min-w-0 flex-1 truncate text-neutral-400">{link.vaultName}</span><span className="text-neutral-600">{link.analysis.deepStatus === 'done' ? t('analizado') : t('vinculado')}</span></div><VaultReuseBadges link={link} /></div>)}</div> : <p className="mt-2 text-[10px] leading-4 text-neutral-600">{t('Todavía no participa en ningún análisis de vault.')}</p>}
            </div>

            {(detailJob || detail.extraction?.status !== 'ready') && <div data-testid="library-reading-status-details" className={`mt-5 rounded-xl border p-3 ${detailJob ? 'border-indigo-500/30 bg-indigo-500/5' : detail.extraction?.status === 'failed' ? 'border-red-500/30 bg-red-500/5' : detail.extraction?.status === 'needs-review' ? 'border-amber-500/30 bg-amber-500/5' : 'border-neutral-800'}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${detailJob ? 'bg-indigo-500/15 text-indigo-300' : detail.files?.reader ? 'bg-emerald-500/10 text-emerald-400' : detail.extraction?.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-neutral-900 text-neutral-500'}`}>{detailJob ? <Spinner /> : <Icon name={detail.files?.reader ? 'bookOpen' : detail.attachments.length ? 'clock' : 'file'} size={14} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs"><b>{detailReadingLabel}</b>{detailJob && <span className="tabular-nums text-indigo-300">{Math.round(detailJob.progress * 100)}%</span>}</div>
                  {detailJob ? <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-900"><span className="block h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(3, detailJob.progress * 100)}%` }} /></div><button data-testid="cancel-library-preparation" className="mt-2 text-[10px] text-neutral-500 hover:text-red-400" onClick={() => void cancelDetailPreparation()}>{t('Cancelar preparación')}</button></>
                    : detail.attachments.length === 0 ? <p className="mt-1.5 text-[10px] leading-4 text-neutral-600">{t('Añade un PDF, EPUB, documento, texto o imagen. Nodus preparará automáticamente la lectura.')}</p>
                      : detail.extraction?.status === 'failed' ? <><p role="alert" className="mt-1.5 text-[10px] leading-4 text-red-300">{t(friendlyExtractionError(detail.extraction.error))}</p>{detail.files?.reader && <button className="mt-2 text-[10px] font-medium text-indigo-300 hover:text-indigo-200" onClick={() => void openReader(detail.id)}>{t('Leer la última copia disponible')}</button>}</>
                        : detail.extraction?.status === 'needs-review' ? <p className="mt-1.5 text-[10px] leading-4 text-amber-200">{t('Puedes leerla ya. Algunos fragmentos, tablas o páginas OCR pueden necesitar revisión.')}</p>
                          : <p className="mt-1.5 text-[10px] leading-4 text-neutral-600">{detail.files?.reader ? t('Markdown limpio, páginas e imágenes están listos.') : t('Nodus preparará el texto, la estructura, las tablas, las imágenes y la trazabilidad de páginas.')}</p>}
                </div>
              </div>
            </div>}
          </div>
          <footer className="border-t border-neutral-800 p-3">{trashMode ? <div className="grid grid-cols-2 gap-2"><button data-testid="restore-library-trash-item" className="btn btn-secondary" onClick={() => void restoreSelected([detail.id])}><Icon name="refresh" /> {t('Restaurar')}</button><button data-testid="review-library-trash-item" className="btn btn-ghost text-red-400" onClick={() => setTrashImpactItems([detail.id])}><Icon name="trash" /> {t('Revisar y vaciar')}</button></div> : <div className="flex gap-2">
            {detail.attachments.length === 0 ? <button data-testid="library-detail-primary-action" className="btn btn-primary min-w-0 flex-1" onClick={() => void addFileToDetail()}><Icon name="upload" /> {t('Añadir archivo')}</button>
              : detailJob ? <button data-testid="library-detail-primary-action" className="btn btn-primary min-w-0 flex-1" disabled><Spinner /> {tx('Preparando… {progress}%', { progress: Math.round(detailJob.progress * 100) })}</button>
                : detail.extraction?.status === 'failed' ? <button data-testid="library-detail-primary-action" className="btn btn-primary min-w-0 flex-1" onClick={() => void prepareDetail(true)}><Icon name="refresh" /> {t('Intentar de nuevo')}</button>
                  : detail.extraction?.status === 'needs-review' ? <button data-testid="library-detail-primary-action" className="btn btn-primary min-w-0 flex-1" onClick={() => void openReader(detail.id)}><Icon name="bookOpen" /> {t('Leer y revisar')}</button>
                    : detail.files?.reader ? <button data-testid="library-detail-primary-action" className="btn btn-primary min-w-0 flex-1" onClick={() => void openReader(detail.id)}><Icon name="bookOpen" /> {t('Leer')}</button>
                      : <button data-testid="library-detail-primary-action" className="btn btn-primary min-w-0 flex-1" onClick={() => void prepareDetail()}><Icon name="refresh" /> {t('Continuar preparación')}</button>}
            <div className="relative z-40">
              <button data-testid="library-detail-actions-toggle" className="btn btn-ghost relative z-40 border border-neutral-700" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu" aria-expanded={detailActionsOpen} onClick={() => setDetailActionsOpen((value) => !value)}><Icon name="menu" /></button>
              {detailActionsOpen && <><button className="fixed inset-0 z-30 cursor-default" aria-label={t('Cerrar menú')} onClick={() => setDetailActionsOpen(false)} /><div data-testid="library-detail-actions-menu" role="menu" className="library-action-menu absolute bottom-[calc(100%+.45rem)] right-0 z-50 w-60 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl">
                <button data-testid="manage-library-attachments" role="menuitem" className="library-action-menu-item" onClick={() => { setDetailActionsOpen(false); setManager({ item: detail, tab: 'attachments' }); }}><Icon name="file" /><span><b>{t('Archivos y adjuntos')}</b></span></button>
                <button data-testid="manage-library-notes" role="menuitem" className="library-action-menu-item" onClick={() => { setDetailActionsOpen(false); setManager({ item: detail, tab: 'notes' }); }}><Icon name="notebook" /><span><b>{t('Notas')}</b></span></button>
                <button data-testid="cite-library-item" role="menuitem" className="library-action-menu-item" onClick={() => { setDetailActionsOpen(false); setCitationItems([detail.id]); }}><Icon name="quote" /><span><b>{t('Citar / exportar')}</b></span></button>
                <button role="menuitem" className="library-action-menu-item" onClick={() => { setDetailActionsOpen(false); void duplicateDetail(); }}><Icon name="copy" /><span><b>{t('Duplicar')}</b></span></button>
                {detail.source !== 'nodus' && <button role="menuitem" className="library-action-menu-item" onClick={() => { setDetailActionsOpen(false); void convertDetail(); }}><Icon name="library" /><span><b>{t('Crear copia Nodus')}</b></span></button>}
                <button role="menuitem" className="library-action-menu-item text-red-400" onClick={() => { setDetailActionsOpen(false); void deleteSelected(); }}><Icon name="trash" /><span><b>{t('Enviar a la papelera')}</b></span></button>
              </div></>}
            </div>
          </div>}</footer>
        </aside>}
      </div>
      {itemContextMenu && !trashMode && <>
        <button className="fixed inset-0 z-[70] cursor-default" aria-label={t('Cerrar menú')} onClick={() => setItemContextMenu(null)} />
        <div
          data-testid="library-item-context-menu"
          role="menu"
          className="library-action-menu fixed z-[71] w-64 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
        >
          <button data-testid="context-read-library-item" role="menuitem" className="library-action-menu-item" onClick={() => { const id = itemContextMenu.itemId; setItemContextMenu(null); void openReader(id); }}><Icon name="bookOpen" /><span><b>{t('Leer')}</b><small>{t('Elegir Markdown limpio u original')}</small></span></button>
          <button data-testid="context-open-original" role="menuitem" className="library-action-menu-item" onClick={() => { const id = itemContextMenu.itemId; setItemContextMenu(null); void openReader(id, 'original'); }}><Icon name="file" /><span><b>{t('Abrir original')}</b></span></button>
          <button role="menuitem" className="library-action-menu-item" onClick={() => void openContextOnlineSource()}><Icon name="globe" /><span><b>{t('Ver fuente en línea')}</b></span></button>
          <button data-testid="context-reveal-library-attachment" role="menuitem" className="library-action-menu-item" onClick={() => void revealContextOriginal()}><Icon name="folder" /><span><b>{t('Mostrar en carpeta')}</b></span></button>
          <div className="my-1 border-t border-neutral-800" />
          <button data-testid="context-edit-library-metadata" role="menuitem" className="library-action-menu-item" onClick={() => void editContextMetadata()}><Icon name="edit" /><span><b>{t('Editar metadatos')}</b></span></button>
          <button data-testid="context-manage-library-attachments" role="menuitem" className="library-action-menu-item" onClick={() => void openContextManager('attachments')}><Icon name="file" /><span><b>{t('Archivos y adjuntos')}</b></span></button>
          <button data-testid="context-manage-library-notes" role="menuitem" className="library-action-menu-item" onClick={() => void openContextManager('notes')}><Icon name="notebook" /><span><b>{t('Notas')}</b></span></button>
          <div className="my-1 border-t border-neutral-800" />
          <button data-testid="context-cite-library-item" role="menuitem" className="library-action-menu-item" onClick={() => { setCitationItems([itemContextMenu.itemId]); setItemContextMenu(null); }}><Icon name="quote" /><span><b>{t('Citar / exportar')}</b></span></button>
          <button role="menuitem" className="library-action-menu-item" onClick={() => { setVaultLinkItems([itemContextMenu.itemId]); setItemContextMenu(null); }}><Icon name="vault" /><span><b>{t('Usar en un vault')}</b></span></button>
          <button data-testid="context-duplicate-library-item" role="menuitem" className="library-action-menu-item" onClick={() => void duplicateContextItem()}><Icon name="copy" /><span><b>{t('Duplicar')}</b></span></button>
          <button data-testid="context-trash-library-item" role="menuitem" className="library-action-menu-item text-red-400" onClick={() => void trashContextItem()}><Icon name="trash" /><span><b>{t('Enviar a la papelera')}</b></span></button>
        </div>
      </>}
      {zoteroOpen && <ZoteroImportDialog onClose={() => setZoteroOpen(false)} onFinished={() => void load()} />}
      {librarySettingsOpen && <LibrarySettingsDialog settings={librarySettings} onClose={() => setLibrarySettingsOpen(false)} onSaved={setLibrarySettings} />}
      {(bulkDialog === 'copy' || bulkDialog === 'move') && <LibraryBulkCollectionDialog mode={bulkDialog} count={selected.size} collections={collections} currentId={selectedLocalCollection?.id ?? null} onClose={() => setBulkDialog(null)} onApply={(target) => applySelectedToCollection(bulkDialog, target)} />}
      {bulkDialog === 'tag' && <LibraryBulkTagDialog count={selected.size} onClose={() => setBulkDialog(null)} onApply={applyBulkTag} />}
      {movingCollection && <LibraryCollectionMoveDialog collection={movingCollection} collections={collections} onClose={() => setMovingCollection(null)} onMove={(parentId) => moveCollection(movingCollection, parentId)} />}
      {stylingCollection && <LibraryCollectionStyleDialog collection={stylingCollection} onClose={() => setStylingCollection(null)} onSave={async (icon, color) => { await window.nodus.updateGlobalLibraryCollection(stylingCollection.id, { icon, color }); await load(); }} />}
      {migrationOpen && <LibraryMigrationDialog onClose={() => setMigrationOpen(false)} onFinished={() => void load()} />}
      {createReferenceMode && <LibraryCreateReferenceDialog defaultMode={createReferenceMode} collectionIds={selectedCollection && collections.find((entry) => entry.id === selectedCollection)?.source === 'nodus' ? [selectedCollection] : []} onClose={() => setCreateReferenceMode(null)} onCreated={(created, openEditor) => { setDetailId(created.id); setDetail(created); if (openEditor) setMetadataItem(created); void load(); }} />}
      {metadataItem && <LibraryMetadataEditor item={metadataItem} onClose={() => setMetadataItem(null)} onSaved={(saved) => { setDetail(saved); void load(); }} />}
      {metadataBatchItems && <LibraryMetadataBatchDialog itemIds={metadataBatchItems} onClose={() => setMetadataBatchItems(null)} onApplied={() => { setSelected(new Set()); void load(); }} />}
      {citationItems && <LibraryCitationExportDialog itemIds={citationItems} requestScope={{ collectionId: selectedCollection, savedSearchId: selectedSavedSearch, smartSearch: selectedSavedSearch ? savedSearches.find((entry) => entry.id === selectedSavedSearch)?.query ?? null : null }} initialStyleManagerOpen={Boolean(target?.citationStyles)} onClose={() => setCitationItems(null)} />}
      {manager && <LibraryItemManager item={manager.item} initialTab={manager.tab} onClose={() => setManager(null)} onChanged={(saved) => { setManager((value) => value ? { ...value, item: saved } : null); setDetail(saved); void load(); }} />}
      {smartSearchEditor && <LibrarySmartSearchDialog initial={smartSearchEditor === 'new' ? null : smartSearchEditor} onClose={() => setSmartSearchEditor(null)} onSaved={(record) => { setSelectedSavedSearch(record.id); setSelectedCollection(null); void load(); }} />}
      {tablePreferencesOpen && <LibraryTablePreferencesDialog preferences={viewPreferences} onClose={() => setTablePreferencesOpen(false)} onSaved={(preferences) => { setViewPreferences(preferences); setOffset(0); }} />}
      {duplicatesOpen && <LibraryDuplicatesDialog onClose={() => setDuplicatesOpen(false)} onChanged={() => void load()} />}
      {trashImpactItems && <LibraryTrashImpactDialog itemIds={trashImpactItems} onClose={() => setTrashImpactItems(null)} onChanged={() => { setSelected(new Set()); setDetailId(null); void load(); }} />}
      {recoveryOpen && <LibraryRecoveryDialog onClose={() => setRecoveryOpen(false)} onRebuilt={() => void load()} />}
      {vaultLinkItems && <VaultLinkDialog itemIds={vaultLinkItems} onClose={() => setVaultLinkItems(null)} onLinked={(links) => {
        if (detailId && links.some((link) => link.itemId === detailId)) setDetailLinks((current) => [...current.filter((existing) => !links.some((link) => link.itemId === existing.itemId && link.vaultId === existing.vaultId)), ...links.filter((link) => link.itemId === detailId)]);
        setSelected(new Set());
      }} />}
    </div>
  );
}

export function GlobalLibraryView({
  target,
  onTargetConsumed,
  settings,
  vaultId,
  vaultType,
  snapshot,
  onSnapshotChange,
  onSettingsChange,
  onOpenSettings,
  onOpenCollections,
  onOpenGraph,
  onOpenAssistant,
  onOpenArchive,
}: {
  target?: (PendingLibraryNavigationTarget & { nonce: number }) | null;
  /** Clear a navigation command after the matching Library surface applies it. */
  onTargetConsumed?: () => void;
  settings: AppSettings;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: LibrarySnapshot;
  onSnapshotChange?: (patch: Partial<LibrarySnapshot>) => void;
  vaultId: string | null;
  vaultType?: VaultType;
  onSettingsChange: () => Promise<AppSettings | undefined>;
  onOpenSettings: () => void;
  onOpenCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenArchive?: () => void;
}) {
  const requestedScope = target?.healthBucket ? 'vault' : target?.scope;
  const preferredScope = requestedScope ?? (settings.libraryGlobalEnabled ? settings.libraryScope : 'vault');
  const [scope, setScope] = useState<LibraryScope>(preferredScope);
  const [switching, setSwitching] = useState(false);
  // Everyone meets the Library guide once, on their first visit to the section. The
  // flag is written as soon as it is presented — not when it is dismissed — so a
  // closed window or a switched vault does not queue the same greeting again. The
  // header's «?» reopens it afterwards, and that route ignores the flag entirely.
  const [tutorialOpen, setTutorialOpen] = useState(() => vaultType !== 'academic' && settings.academicMode !== 'manual' && !libraryTutorialSeen());
  const [tutorialTab, setTutorialTab] = useState<LibraryTutorialTab>('analysis');
  // The flag records that the guide WAS presented, not that it was dismissed, so it
  // is written on the visit that opened it: closing the window cannot queue it again.
  const autoPresented = useRef(tutorialOpen);
  useEffect(() => {
    if (autoPresented.current) markLibraryTutorialSeen();
  }, []);
  const openTutorial = useCallback((tab: LibraryTutorialTab = 'analysis') => {
    setTutorialTab(tab);
    setTutorialOpen(true);
  }, []);
  // The documents left open, restored as initial values. Reopening one is the same
  // read as opening it was, and the page the reader had reached inside it comes back
  // with it: the reader writes its own position per document and restores it on mount.
  const [workspaceTabs, setWorkspaceTabs] = useState<LibraryWorkspaceTab[]>(() => snapshot?.readers?.tabs ?? []);
  const [activeReaderKey, setActiveReaderKey] = useState<string | null>(() => (
    snapshot?.readers?.tabs.some((tab) => tab.key === snapshot.readers?.activeKey)
      ? snapshot.readers.activeKey
      : null
  ));

  // The registry builds `onSnapshotChange` inline, so its identity changes on every
  // render of the shell; a ref keeps that out of the effect's dependencies.
  const reportReaders = useRef(onSnapshotChange);
  reportReaders.current = onSnapshotChange;
  useEffect(() => {
    reportReaders.current?.({ readers: { tabs: workspaceTabs, activeKey: activeReaderKey } });
  }, [activeReaderKey, workspaceTabs]);

  // Contextual entries (Home health buckets and Zotero reader links) choose their
  // scope once. After arrival the user remains free to change the switcher.
  useEffect(() => {
    if (!requestedScope) return;
    setScope(requestedScope);
  }, [requestedScope, target?.nonce]);

  const chooseScope = async (next: 'global' | 'vault') => {
    if (switching || next === scope) return;
    if (next === 'global' && !settings.libraryGlobalEnabled && !settings.autoBackupFolder.trim()) {
      toast(t('Configura las copias de seguridad para activar Global.'), { tone: 'info' });
      onOpenSettings();
      return;
    }
    setSwitching(true);
    try {
      await window.nodus.updateSettings({
        libraryGlobalEnabled: next === 'global' ? true : settings.libraryGlobalEnabled,
        libraryScope: next,
        libraryScopeOnboardingVersion: next === 'global' ? 1 : settings.libraryScopeOnboardingVersion,
      });
      await onSettingsChange();
      setScope(next);
      if (next === 'global' && !settings.libraryGlobalEnabled) toast(t('Biblioteca global activada.'));
    } finally {
      setSwitching(false);
    }
  };

  const scopeControls = (
    <LibraryScopeControls
      scope={scope}
      switching={switching}
      globalEnabled={settings.libraryGlobalEnabled}
      onChoose={(next) => void chooseScope(next)}
    />
  );

  const openReaderTab = useCallback((tabScope: LibraryScope, reference: LibraryReaderReference) => {
    const key = libraryWorkspaceTabKey(tabScope, reference);
    setWorkspaceTabs((current) => current.some((tab) => tab.key === key)
      ? current.map((tab) => tab.key === key ? { ...tab, reference } : tab)
      : [...current, { key, scope: tabScope, reference }]);
    setScope(tabScope);
    setActiveReaderKey(key);
  }, []);
  const openVaultReader = useCallback((reference: LibraryReaderReference) => openReaderTab('vault', reference), [openReaderTab]);
  const openGlobalReader = useCallback((reference: LibraryReaderReference) => openReaderTab('global', reference), [openReaderTab]);
  // The cited page is a one-shot command, not part of the tab's identity: once the
  // reader has honoured it the reference goes back to carrying no page, so the tab
  // restores the user's own reading position from then on.
  const clearReaderPage = useCallback((key: string) => {
    setWorkspaceTabs((current) => current.map((tab) => (
      tab.key === key && tab.reference.page
        ? { ...tab, reference: { ...tab.reference, page: null } }
        : tab
    )));
  }, []);

  const activateReaderTab = (key: string) => {
    const tab = workspaceTabs.find((entry) => entry.key === key);
    if (!tab) return;
    setScope(tab.scope);
    setActiveReaderKey(key);
  };

  const closeReaderTab = (key: string) => {
    const index = workspaceTabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const remaining = workspaceTabs.filter((tab) => tab.key !== key);
    setWorkspaceTabs(remaining);
    if (activeReaderKey !== key) return;
    const replacement = remaining[Math.min(index, remaining.length - 1)] ?? null;
    setActiveReaderKey(replacement?.key ?? null);
    if (replacement) setScope(replacement.scope);
  };

  const activeReader = workspaceTabs.find((tab) => tab.key === activeReaderKey) ?? null;

  return (
    <div data-testid="library-scope-shell" data-library-scope={scope} className="library-theme flex h-full min-h-0 flex-col">
      <LibraryWorkspaceTabs
        tabs={workspaceTabs}
        activeKey={activeReaderKey}
        onActivateLibrary={() => setActiveReaderKey(null)}
        onActivateTab={activateReaderTab}
        onCloseTab={closeReaderTab}
      />
      <div className={`min-h-0 flex-1 overflow-hidden ${activeReader ? 'hidden' : ''}`} aria-hidden={activeReader ? true : undefined}>
        {scope === 'vault' ? (
          <Library
            academicMode={settings.academicMode}
            vaultId={vaultId}
            target={target}
            onTargetConsumed={onTargetConsumed}
            vaultType={vaultType}
            snapshot={snapshot?.vault}
            onSnapshotChange={(vault) => onSnapshotChange?.({ vault })}
            onOpenCollections={onOpenCollections}
            onOpenNodusCollections={() => void chooseScope('global')}
            onOpenTutorial={() => openTutorial('analysis')}
            onOpenGraph={onOpenGraph}
            onOpenAssistant={onOpenAssistant}
            onOpenArchive={onOpenArchive}
            scopeControls={scopeControls}
            onOpenReader={openVaultReader}
          />
        ) : (
          <GlobalLibraryContent
            target={target}
            onTargetConsumed={onTargetConsumed}
            snapshot={snapshot?.global}
            onSnapshotChange={(next) => onSnapshotChange?.({ global: next })}
            onOpenSettings={onOpenSettings}
            scopeControls={scopeControls}
            onOpenReader={openGlobalReader}
          />
        )}
      </div>
      {activeReader && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LibraryDocumentReader
            key={activeReader.key}
            reference={activeReader.reference}
            initialSource={activeReader.sourceId}
            showLibraryBackButton={false}
            initialPage={activeReader.reference.page ?? null}
            onInitialPageApplied={() => clearReaderPage(activeReader.key)}
            onSourceChange={(sourceId) => setWorkspaceTabs((current) => current.map((tab) => tab.key === activeReader.key ? { ...tab, sourceId } : tab))}
            onBack={() => setActiveReaderKey(null)}
            onOpenAssistant={onOpenAssistant}
          />
        </div>
      )}
      <LibraryTutorialModal
        academic={!vaultType || vaultType === 'academic'}
        open={tutorialOpen}
        tab={tutorialTab}
        onTabChange={setTutorialTab}
        onClose={() => setTutorialOpen(false)}
      />
    </div>
  );
}
