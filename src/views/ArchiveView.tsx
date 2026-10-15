import { useCallback, useEffect, useState } from 'react';
import type {
  ArchiveFolder,
  ArchiveItem,
  ArchiveItemKind,
  ArchiveMatchMode,
  ArchiveSortKey,
  ArchiveTagCount,
  Person,
  PersonLinkSuggestion,
} from '@shared/types';
import { getArchiveDocType } from '@shared/archiveDocTypes';
import { countActiveFacets } from '@shared/archiveFilters';
import { Icon } from '../components/ui';
import { DocTypeForm, DocTypePicker, DocTypeSelect } from '../components/DocTypeForm';
import { PersonLinkPicker } from '../components/PersonLinkPicker';
import { ArchiveFilterBar } from '../components/ArchiveFilterBar';
import { GenealogyArchiveEntryModal } from '../components/GenealogyArchiveEntryModal';
import {
  ChipSelectCell,
  GUTTER_WIDTH,
  LongTextCell,
  TextCell,
  type ChipOption,
} from '../components/dbGrid';
import { confirm, toast } from '../components/feedback';
import { t } from '../i18n';

const KIND_ICON: Record<ArchiveItemKind, string> = {
  image: 'eye',
  csv: 'grid',
  xlsx: 'grid',
  pdf: 'book',
  text: 'notebook',
  other: 'folder',
};

// Fixed, preconfigured column schema for the genealogy Archive. The user does not
// add/remove properties — these mirror the archive_items model (see archiveRepo). The
// grid mimics Databases mode; per-cell editing writes straight back to the archive.
interface ArchiveColumn {
  id: string;
  label: string;
  width: number;
}
const ARCHIVE_COLUMNS: ArchiveColumn[] = [
  { id: 'title', label: 'Título', width: 240 },
  { id: 'description', label: 'Descripción', width: 260 },
  { id: 'file', label: 'Archivo', width: 84 },
  { id: 'docType', label: 'Tipo de documento', width: 190 },
  { id: 'year', label: 'Año', width: 84 },
  { id: 'persons', label: 'Personas', width: 230 },
  { id: 'source', label: 'Fuente', width: 200 },
  { id: 'tags', label: 'Etiquetas', width: 200 },
  { id: 'folders', label: 'Carpeta', width: 180 },
  { id: 'text', label: 'Texto detectado', width: 220 },
];

export function ArchiveView({ onOpenLibrary, isGenealogy = false }: { onOpenLibrary?: () => void; isGenealogy?: boolean } = {}) {
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [treePersons, setTreePersons] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [textEntry, setTextEntry] = useState(false);
  const [genealogyEntry, setGenealogyEntry] = useState(false);

  // ── Filters (Notion-style) + sorting ────────────────────────────────────────
  const [availableTags, setAvailableTags] = useState<ArchiveTagCount[]>([]);
  const [fDocTypes, setFDocTypes] = useState<string[]>([]);
  const [fKinds, setFKinds] = useState<ArchiveItemKind[]>([]);
  const [fTags, setFTags] = useState<string[]>([]);
  const [fTagsMode, setFTagsMode] = useState<ArchiveMatchMode>('all');
  const [fPersonIds, setFPersonIds] = useState<string[]>([]);
  const [fPersonsMode, setFPersonsMode] = useState<ArchiveMatchMode>('any');
  const [fFolderIds, setFFolderIds] = useState<string[]>([]);
  // Heritage-dimension facets. In a genealogy vault the Genealogy facet is ON by
  // default (the user can clear it); the guard makes it a one-time initial value.
  const [fFacets, setFFacets] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    if (isGenealogy) init.genealogia = ['si'];
    return init;
  });
  const [fYearFrom, setFYearFrom] = useState('');
  const [fYearTo, setFYearTo] = useState('');
  const [sort, setSort] = useState<ArchiveSortKey>('updatedDesc');

  const activeFilterCount =
    fDocTypes.length + fKinds.length + fTags.length + fPersonIds.length + fFolderIds.length + countActiveFacets(fFacets) +
    (fYearFrom.trim() || fYearTo.trim() ? 1 : 0);

  const clearFilters = () => {
    setFDocTypes([]);
    setFKinds([]);
    setFTags([]);
    setFPersonIds([]);
    setFFolderIds([]);
    setFFacets({});
    setFYearFrom('');
    setFYearTo('');
  };

  const reload = useCallback(async () => {
    setFolders(await window.nodus.listArchiveFolders());
    void window.nodus.listPersons().then(setTreePersons);
    void window.nodus.listArchiveTags().then(setAvailableTags);
    const parseYear = (v: string) => {
      const n = Number.parseInt(v.trim(), 10);
      return Number.isFinite(n) ? n : null;
    };
    setItems(
      await window.nodus.listArchiveItems({
        folderIds: fFolderIds.length ? fFolderIds : undefined,
        search: search.trim() || undefined,
        docTypes: fDocTypes.length ? fDocTypes : undefined,
        kinds: fKinds.length ? fKinds : undefined,
        tags: fTags.length ? fTags : undefined,
        tagsMode: fTagsMode,
        personIds: fPersonIds.length ? fPersonIds : undefined,
        personsMode: fPersonsMode,
        facets: fFacets,
        yearFrom: parseYear(fYearFrom),
        yearTo: parseYear(fYearTo),
        sort,
      })
    );
  }, [search, fDocTypes, fKinds, fTags, fTagsMode, fPersonIds, fPersonsMode, fFolderIds, fFacets, fYearFrom, fYearTo, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addFiles = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // A single active folder facet is used as the ingest target so new files land
      // where the user is looking; otherwise they are unfiled.
      const target = fFolderIds.length === 1 ? fFolderIds[0] : null;
      const result = await window.nodus.pickAndIngestArchive(target, fDocTypes.length === 1 ? fDocTypes[0] : null);
      if (result.added || result.duplicates) {
        setMessage(
          t('Añadidos: {a} · duplicados omitidos: {d}')
            .replace('{a}', String(result.added))
            .replace('{d}', String(result.duplicates))
        );
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  // ── Option lists for the fixed chip columns ─────────────────────────────────
  const tagOptions: ChipOption[] = availableTags.map((t) => ({ id: t.tag, label: t.tag }));
  const folderOptions: ChipOption[] = folders.map((f) => ({ id: f.folderId, label: f.name }));

  // ── Per-cell mutations (write straight back to the archive, then refresh) ────
  const setItemTags = async (item: ArchiveItem, nextTags: string[]) => {
    const current = new Set(item.tags);
    const next = new Set(nextTags);
    for (const tag of nextTags) if (!current.has(tag)) await window.nodus.addArchiveTag(item.itemId, tag);
    for (const tag of item.tags) if (!next.has(tag)) await window.nodus.removeArchiveTag(item.itemId, tag);
    await reload();
  };
  const setItemFolders = async (item: ArchiveItem, nextIds: string[]) => {
    await window.nodus.setArchiveItemFolders(item.itemId, nextIds);
    await reload();
  };
  const patchItem = async (item: ArchiveItem, patch: Parameters<typeof window.nodus.updateArchiveItem>[1]) => {
    await window.nodus.updateArchiveItem(item.itemId, patch);
    await reload();
  };

  const gridMinWidth = GUTTER_WIDTH + ARCHIVE_COLUMNS.reduce((s, c) => s + c.width, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-neutral-800 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="archive" size={18} className="shrink-0 text-indigo-300" />
          <h1 className="mr-1 shrink-0 text-sm font-semibold">{t('Archivo')}</h1>
          <input
            className="input h-9 min-w-[12rem] flex-1 text-sm"
            placeholder={t('Buscar en títulos, texto y metadatos…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {isGenealogy ? (
            <ArchiveActionButton label={t('Añadir entrada')} icon="plus" primary disabled={busy} onClick={() => setGenealogyEntry(true)} />
          ) : <>
            <ArchiveActionButton label={t('Añadir archivos')} icon="upload" primary disabled={busy} onClick={() => void addFiles()} />
            <ArchiveActionButton
              label={t('Nueva entrada')}
              icon="edit"
              onClick={() => setTextEntry(true)}
              title={t('Crear una entrada de texto (diario, nota, memorias) sin subir un archivo')}
            />
          </>}
          <ArchiveActionButton
            label={t('Indexar')}
            icon="wand"
            disabled={busy}
            title={t('Indexar el texto de los documentos para descubrir relaciones semánticas con las personas')}
            onClick={async () => {
              setBusy(true);
              setMessage(t('Indexando el archivo…'));
              try {
                const r = await window.nodus.indexArchive();
                setMessage(
                  r.indexed > 0
                    ? t('Indexados {n} documentos para la búsqueda semántica.').replace('{n}', String(r.indexed))
                    : t('El archivo ya está indexado (o no hay proveedor de embeddings configurado).')
                );
              } catch (err) {
                setMessage(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <p className="text-xs text-neutral-500">
          {t('El Archivo guarda fuentes primarias (documentos, registros, fotografías). La bibliografía académica (libros, artículos, tesis) se gestiona en la Biblioteca importándola desde Zotero.')}
          {onOpenLibrary && (
            <button className="ml-1 text-indigo-400 hover:underline" onClick={onOpenLibrary}>
              {t('Ir a la Biblioteca')}
            </button>
          )}
        </p>
        {message && <p className="text-xs text-neutral-400">{message}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <ArchiveFilterBar
            compact={isGenealogy}
            genealogyOnly={isGenealogy}
            docTypes={fDocTypes}
            onDocTypesChange={setFDocTypes}
            facets={fFacets}
            onFacetsChange={setFFacets}
            kinds={fKinds}
            onKindsChange={setFKinds}
            tags={fTags}
            tagsMode={fTagsMode}
            onTagsChange={setFTags}
            onTagsModeChange={setFTagsMode}
            availableTags={availableTags}
            personIds={fPersonIds}
            personsMode={fPersonsMode}
            onPersonIdsChange={setFPersonIds}
            onPersonsModeChange={setFPersonsMode}
            persons={treePersons}
            yearFrom={fYearFrom}
            yearTo={fYearTo}
            onYearFromChange={setFYearFrom}
            onYearToChange={setFYearTo}
            sort={sort}
            onSortChange={setSort}
            activeCount={activeFilterCount}
            onClear={clearFilters}
            folderIds={fFolderIds}
            onFolderIdsChange={setFFolderIds}
            folders={folderOptions.map((folder) => ({ value: folder.id, label: folder.label }))}
          />
          {!isGenealogy && folderOptions.length > 0 && (
            <div className="flex h-8 items-center overflow-hidden rounded-md border border-neutral-700 bg-neutral-900" style={{ width: 200 }}>
              <ChipSelectCell
                values={fFolderIds}
                options={folderOptions}
                multi
                onChange={setFFolderIds}
                placeholder={t('Carpeta…')}
              />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: gridMinWidth }} className="text-sm">
          {/* Header row */}
          <div className="sticky top-0 z-10 flex border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
            <div className="shrink-0 border-r border-neutral-900" style={{ width: GUTTER_WIDTH }} />
            {ARCHIVE_COLUMNS.map((col) => (
              <div
                key={col.id}
                className="shrink-0 truncate border-r border-neutral-900 px-2 py-2 text-xs font-medium text-neutral-500"
                style={{ width: col.width }}
              >
                {t(col.label)}
              </div>
            ))}
          </div>

          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              {activeFilterCount > 0 || search.trim()
                ? t('Ningún documento coincide con los filtros.')
                : t('Este archivo está vacío. Añade fotos de registros, CSV/XLSX o escaneos; Nodus extraerá su texto (y una descripción visual de las imágenes) para poder buscarlos y citarlos.')}
            </p>
          ) : (
            items.map((it) => (
              <ArchiveRow
                key={it.itemId}
                item={it}
                persons={treePersons}
                tagOptions={tagOptions}
                folderOptions={folderOptions}
                isGenealogy={isGenealogy}
                onOpen={() => setSelected(it)}
                onReload={reload}
                onSetTags={(next) => setItemTags(it, next)}
                onSetFolders={(next) => setItemFolders(it, next)}
                onPatch={(patch) => patchItem(it, patch)}
              />
            ))
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-800 px-4 py-1.5 text-xs text-neutral-600">
        {t('{n} documentos').replace('{n}', String(items.length))}
      </div>

      {selected && (
        <ArchiveItemDetail
          item={selected}
          isGenealogy={isGenealogy}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await reload();
          }}
        />
      )}
      {textEntry && (
        <TextEntryModal
          folderId={fFolderIds.length === 1 ? fFolderIds[0] : null}
          isGenealogy={isGenealogy}
          onClose={() => setTextEntry(false)}
          onSaved={async () => {
            setTextEntry(false);
            await reload();
          }}
        />
      )}
      {genealogyEntry && (
        <GenealogyArchiveEntryModal
          folders={folders}
          persons={treePersons}
          initialFolderIds={fFolderIds.length === 1 ? fFolderIds : []}
          onClose={() => setGenealogyEntry(false)}
          onSaved={async (result) => {
            setMessage(
              t('Añadidos: {a} · duplicados omitidos: {d}')
                .replace('{a}', String(result.added))
                .replace('{d}', String(result.duplicates))
            );
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ArchiveActionButton({
  label,
  icon,
  primary = false,
  disabled,
  title,
  onClick,
}: {
  label: string;
  icon: string;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <span className="group/archive-action inline-flex" title={title ?? label}>
      <button
        className={`btn h-9 min-h-9 justify-center gap-0 px-2.5 py-0 ${primary ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
        aria-label={label}
        disabled={disabled}
        onClick={() => void onClick()}
      >
        <Icon name={icon} size={15} />
        <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover/archive-action:ml-1.5 group-hover/archive-action:max-w-40 group-hover/archive-action:opacity-100 group-focus-within/archive-action:ml-1.5 group-focus-within/archive-action:max-w-40 group-focus-within/archive-action:opacity-100">
          {label}
        </span>
      </button>
    </span>
  );
}

/** One database-style row in the Archive grid: fixed cells with inline editing. */
function ArchiveRow({
  item,
  persons,
  tagOptions,
  folderOptions,
  isGenealogy,
  onOpen,
  onReload,
  onSetTags,
  onSetFolders,
  onPatch,
}: {
  item: ArchiveItem;
  persons: Person[];
  tagOptions: ChipOption[];
  folderOptions: ChipOption[];
  isGenealogy: boolean;
  onOpen: () => void;
  onReload: () => Promise<void>;
  onSetTags: (next: string[]) => void;
  onSetFolders: (next: string[]) => void;
  onPatch: (patch: Parameters<typeof window.nodus.updateArchiveItem>[1]) => void;
}) {
  const col = (id: string) => ARCHIVE_COLUMNS.find((c) => c.id === id)!.width;
  return (
    <div className="flex min-h-[40px] items-stretch border-b border-neutral-900 hover:bg-neutral-900/30">
      {/* Gutter: expand into the full-record modal. */}
      <div className="flex shrink-0 items-center justify-center border-r border-neutral-900" style={{ width: GUTTER_WIDTH }}>
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          title={t('Abrir ficha')}
          onClick={onOpen}
        >
          <Icon name="external" size={14} />
        </button>
      </div>
      {/* Nombre */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('title') }}>
        <LongTextCell value={item.title} markdown={false} onChange={(v) => onPatch({ title: v ?? t('Sin título') })} />
      </div>
      {/* Descripción */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('description') }}>
        <LongTextCell value={item.description} markdown={false} onChange={(v) => onPatch({ description: v })} />
      </div>
      {/* Archivo (kind) */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-hidden border-r border-neutral-900 px-2" style={{ width: col('file') }}>
        <Icon name={KIND_ICON[item.kind]} size={15} className="shrink-0 text-neutral-400" />
        <span className="text-[11px] uppercase text-neutral-500">{item.kind}</span>
      </div>
      {/* Tipo de documento */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('docType') }}>
        <DocTypePicker value={item.docType} onChange={(id) => onPatch({ docType: id })} placeholder={t('Sin tipo')} fill genealogyFilter={isGenealogy} />
      </div>
      {/* Año (derived, read-only) */}
      <div className="flex shrink-0 items-center overflow-hidden border-r border-neutral-900 px-2 text-neutral-400" style={{ width: col('year') }}>
        {item.year ?? <span className="text-neutral-700">—</span>}
      </div>
      {/* Personas */}
      <div className="flex shrink-0 items-center overflow-x-auto border-r border-neutral-900 px-2 py-1" style={{ width: col('persons') }}>
        <PersonLinkPicker item={item} persons={persons} onChanged={onReload} />
      </div>
      {/* Fuente */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('source') }}>
        <TextCell value={item.source} inputType="text" onChange={(v) => onPatch({ source: v })} />
      </div>
      {/* Etiquetas */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('tags') }}>
        <ChipSelectCell values={item.tags} options={tagOptions} multi onChange={onSetTags} allowCreate onCreate={(label) => onSetTags([...item.tags, label])} placeholder={t('Etiquetas…')} />
      </div>
      {/* Carpeta */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('folders') }}>
        <ChipSelectCell values={item.folderIds} options={folderOptions} multi onChange={onSetFolders} placeholder={t('Carpeta…')} />
      </div>
      {/* Texto detectado (read-only preview → opens the record) */}
      <div className="shrink-0 overflow-hidden border-r border-neutral-900" style={{ width: col('text') }}>
        <button
          className="h-full w-full px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-800/40"
          onClick={onOpen}
          title={item.extractedText ?? ''}
        >
          {item.extractedText ? (
            <span className="line-clamp-2">{item.extractedText.slice(0, 160)}</span>
          ) : (
            <span className="text-neutral-700">—</span>
          )}
        </button>
      </div>
    </div>
  );
}

/** Create a typed text entry (diary page, note, memoir) with no file. */
function TextEntryModal({
  folderId,
  isGenealogy,
  onClose,
  onSaved,
}: {
  folderId: string | null;
  isGenealogy: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  // Start unclassified so the picker reads as a clear "choose a type" prompt rather
  // than silently defaulting to "Notas".
  const [docType, setDocType] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() && !content.trim()) return;
    setBusy(true);
    try {
      await window.nodus.createArchiveTextEntry({
        title: title.trim() || t('Entrada sin título'),
        content,
        folderId,
        docType,
        metadata,
        source: source.trim() || null,
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const fieldLabel = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card-modal flex max-h-[85vh] w-full max-w-lg flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex shrink-0 items-center gap-2">
          <Icon name="edit" size={16} className="text-indigo-300" />
          <h2 className="font-semibold">{t('Nueva entrada de texto')}</h2>
          <button className="btn btn-ghost ml-auto px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div>
            <label className={fieldLabel}>{t('Título')}</label>
            <input
              className="input h-9 w-full text-sm"
              placeholder={t('Título de la entrada')}
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className={fieldLabel}>{t('Tipo de documento')}</label>
            <DocTypeSelect
              value={docType}
              onChange={setDocType}
              emptyLabel="Elegir tipo de documento…"
              genealogyFilter={isGenealogy}
            />
            {getArchiveDocType(docType) && (
              <div className="mt-2 rounded-md border border-neutral-800 p-3">
                <DocTypeForm docType={docType} values={metadata} onChange={(k, v) => setMetadata((m) => ({ ...m, [k]: v }))} />
              </div>
            )}
          </div>

          <div>
            <label className={fieldLabel}>{t('Fuente')}</label>
            <input
              className="input h-9 w-full text-sm"
              placeholder={t('Opcional: archivo, repositorio, cita, URL…')}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          <div>
            <label className={fieldLabel}>{t('Contenido')}</label>
            <textarea
              className="input min-h-[9rem] w-full resize-y text-sm"
              placeholder={t('Escribe el contenido (se indexa para búsqueda)…')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-neutral-800 pt-3">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {t('Guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArchiveItemDetail({
  item,
  isGenealogy,
  onClose,
  onChanged,
}: {
  item: ArchiveItem;
  isGenealogy: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState<string[]>(item.tags);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(item.description);
  const [source, setSource] = useState(item.source ?? '');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState(false);
  const [descDraft, setDescDraft] = useState(item.description ?? '');
  const [textDraft, setTextDraft] = useState(item.extractedText ?? '');
  const [savingContent, setSavingContent] = useState(false);
  const [docType, setDocType] = useState<string | null>(item.docType);
  const [metadata, setMetadata] = useState<Record<string, string>>(item.metadata ?? {});
  const [classDirty, setClassDirty] = useState(false);
  const [personSuggestions, setPersonSuggestions] = useState<PersonLinkSuggestion[]>([]);
  const [hiddenPersons, setHiddenPersons] = useState<Set<string>>(new Set());

  const loadPersonSuggestions = useCallback(() => {
    void window.nodus.suggestPersonsForItem(item.itemId).then(setPersonSuggestions);
  }, [item.itemId]);
  useEffect(() => loadPersonSuggestions(), [loadPersonSuggestions]);

  const saveClassification = async () => {
    await window.nodus.updateArchiveItem(item.itemId, { docType, metadata });
    setClassDirty(false);
    await onChanged();
  };

  useEffect(() => {
    // The bytes can arrive after the detail closed: no object URL is made for a closed
    // detail, so the image is not pinned in memory for the rest of the session.
    let alive = true;
    let revoked: string | null = null;
    setImageUrl(null);
    if (item.kind === 'image' && item.hasBlob) {
      void window.nodus.getArchiveItemBlob(item.itemId).then((bytes) => {
        if (!bytes || !alive) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: item.mimeType ?? 'image/png' });
        const url = URL.createObjectURL(blob);
        revoked = url;
        setImageUrl(url);
      }).catch(() => undefined);
    }
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [item.itemId, item.hasBlob, item.kind, item.mimeType]);

  const saveTitle = async () => {
    if (title.trim() && title.trim() !== item.title) {
      await window.nodus.updateArchiveItem(item.itemId, { title: title.trim() });
      await onChanged();
    }
  };

  const saveSource = async () => {
    const next = source.trim();
    if (next !== (item.source ?? '')) {
      await window.nodus.updateArchiveItem(item.itemId, { source: next || null });
      await onChanged();
    }
  };

  const saveContent = async () => {
    setSavingContent(true);
    try {
      await window.nodus.updateArchiveItem(item.itemId, {
        description: descDraft.trim() || null,
        extractedText: textDraft.trim() || null,
      });
      setDescription(descDraft.trim() || null);
      setEditingContent(false);
      await onChanged();
    } finally {
      setSavingContent(false);
    }
  };

  const addTag = async () => {
    const value = tag.trim();
    if (!value || tags.includes(value)) return;
    await window.nodus.addArchiveTag(item.itemId, value);
    setTags([...tags, value]);
    setTag('');
    await onChanged();
  };

  const removeTag = async (value: string) => {
    await window.nodus.removeArchiveTag(item.itemId, value);
    setTags(tags.filter((x) => x !== value));
    await onChanged();
  };

  const [replacing, setReplacing] = useState(false);

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar del archivo'),
      message: t('¿Eliminar «{title}» y su archivo adjunto? Esta acción no se puede deshacer.').replace('{title}', item.title),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteArchiveItem(item.itemId);
    onClose();
    await onChanged();
  };

  const replace = async () => {
    const ok = await confirm({
      title: t('Reemplazar el archivo adjunto'),
      message: t('Se sustituirá el archivo de «{title}» por otro y se volverá a extraer su texto. Se conservan el título, la clasificación, las etiquetas y las personas vinculadas. ¿Continuar?').replace('{title}', item.title),
      confirmLabel: t('Elegir archivo…'),
    });
    if (!ok) return;
    setReplacing(true);
    try {
      const r = await window.nodus.replaceArchiveFile(item.itemId);
      if (r.replaced) {
        toast(t('Archivo reemplazado.'), { tone: 'success' });
        await onChanged();
        onClose();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { tone: 'error' });
    } finally {
      setReplacing(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    try {
      const r = await window.nodus.analyzeArchiveItem(item.itemId);
      if (r.unsupported) {
        setAnalyzeMsg(t('Este elemento no es una imagen analizable.'));
      } else {
        setDescription(r.description);
        setAnalyzeMsg(t('Imagen analizada.'));
        await onChanged();
      }
    } catch (err) {
      setAnalyzeMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await window.nodus.scanArchiveItem(item.itemId);
      if (r.noText) {
        setScanMsg(t('Este elemento no tiene texto extraído para analizar.'));
      } else {
        const parts = [
          t('Extraídos: {p} personas, {e} eventos.')
            .replace('{p}', String(r.persons))
            .replace('{e}', String(r.events)),
        ];
        if (r.linked) parts.push(t('{n} enlazadas a personas existentes.').replace('{n}', String(r.linked)));
        if (r.suggestions) parts.push(t('{n} parentescos sugeridos por revisar.').replace('{n}', String(r.suggestions)));
        setScanMsg(parts.join(' '));
        loadPersonSuggestions();
        await onChanged();
      }
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card-modal flex max-h-[85vh] w-full max-w-2xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-2">
          <input
            className="input h-9 flex-1 text-sm font-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
          />
          <button className="btn btn-ghost gap-1.5 text-red-300" onClick={() => void remove()}>
            <Icon name="trash" size={14} />
          </button>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-neutral-500">
            {item.kind.toUpperCase()}
            {item.fileName ? ` · ${item.fileName}` : ''}
            {item.bytes ? ` · ${(item.bytes / 1024).toFixed(0)} KB` : ''}
          </p>
          {item.kind === 'image' && (
            <button
              className="btn btn-ghost h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
              disabled={analyzing}
              onClick={() => void analyze()}
              title={t('Describir la imagen y transcribir su texto con el modelo de visión')}
            >
              <Icon name="eye" size={13} /> {analyzing ? t('Analizando…') : t('Analizar imagen')}
            </button>
          )}
          {item.extractedText && (
            <button
              className="btn btn-ghost h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
              disabled={scanning}
              onClick={() => void scan()}
              title={t('Extraer personas, lugares y eventos de este documento')}
            >
              <Icon name="users" size={13} /> {scanning ? t('Analizando…') : t('Extraer personas y eventos')}
            </button>
          )}
          {item.hasBlob && (
            <button
              className="btn btn-ghost h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
              disabled={replacing}
              onClick={() => void replace()}
              title={t('Sustituir el archivo adjunto por otro (se vuelve a extraer su texto)')}
            >
              <Icon name="upload" size={13} /> {replacing ? t('Reemplazando…') : t('Reemplazar archivo')}
            </button>
          )}
          {(scanMsg || analyzeMsg) && <span className="text-xs text-neutral-400">{scanMsg ?? analyzeMsg}</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {imageUrl && (
            <img src={imageUrl} alt={item.title} className="mb-3 max-h-80 w-auto rounded-md border border-neutral-800" />
          )}

          <div className="mb-3 flex justify-end">
            <button
              className="btn btn-ghost h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
              onClick={() => {
                setDescDraft(description ?? '');
                setTextDraft(item.extractedText ?? '');
                setEditingContent((v) => !v);
              }}
            >
              <Icon name="edit" size={12} /> {t('Editar descripción y texto')}
            </button>
          </div>

          {editingContent ? (
            <div className="mb-3 space-y-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción')}</h3>
                <textarea
                  className="input min-h-16 w-full resize-y text-sm"
                  value={descDraft}
                  placeholder={t('Descripción o resumen del documento…')}
                  onChange={(e) => setDescDraft(e.target.value)}
                />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Texto extraído')}</h3>
                <textarea
                  className="input min-h-40 w-full resize-y font-mono text-xs"
                  value={textDraft}
                  placeholder={t('Transcripción o texto del documento…')}
                  onChange={(e) => setTextDraft(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary h-8 text-xs" disabled={savingContent} onClick={() => void saveContent()}>
                  {savingContent ? t('Guardando…') : t('Guardar cambios')}
                </button>
                <button className="btn btn-ghost h-8 border border-neutral-700 px-3 text-xs" onClick={() => setEditingContent(false)} disabled={savingContent}>
                  {t('Cancelar')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {description && (
                <div className="mb-3">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción visual')}</h3>
                  <p className="rounded-md bg-neutral-900/60 p-3 text-sm text-neutral-300">{description}</p>
                </div>
              )}
              {item.extractedText ? (
                <div className="mb-3">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Texto extraído')}</h3>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-900/60 p-3 text-xs text-neutral-300">
                    {item.extractedText}
                  </pre>
                </div>
              ) : (
                <p className="mb-3 text-sm italic text-neutral-500">{t('Sin texto extraído.')}</p>
              )}
            </>
          )}

          <div className="mb-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <Icon name="link" size={12} /> {t('Fuente')}
            </h3>
            <input
              className="input h-9 w-full text-sm"
              placeholder={t('¿De dónde procede? Archivo, repositorio, cita, URL…')}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onBlur={() => void saveSource()}
            />
          </div>

          <div className="mb-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Clasificación')}</h3>
            <DocTypeSelect
              value={docType}
              onChange={(id) => {
                setDocType(id);
                setClassDirty(true);
              }}
              genealogyFilter={isGenealogy}
            />
            {getArchiveDocType(docType) && (
              <div className="mt-2 rounded-md border border-neutral-800 p-3">
                <DocTypeForm
                  docType={docType}
                  values={metadata}
                  onChange={(key, value) => {
                    setMetadata((m) => ({ ...m, [key]: value }));
                    setClassDirty(true);
                  }}
                />
              </div>
            )}
            {classDirty && (
              <button className="btn btn-primary mt-2 h-8 text-xs" onClick={() => void saveClassification()}>
                {t('Guardar clasificación')}
              </button>
            )}
          </div>

          {personSuggestions.filter((p) => !hiddenPersons.has(p.personId)).length > 0 && (
            <div className="mb-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-300">
                <Icon name="bulb" size={12} /> {t('Personas mencionadas en este documento')}
              </h3>
              <p className="mb-2 text-[11px] text-neutral-500">
                {t('Coinciden con miembros del árbol. Vincúlalas si son la misma persona.')}
              </p>
              <ul className="space-y-1.5">
                {personSuggestions
                  .filter((p) => !hiddenPersons.has(p.personId))
                  .map((p) => (
                    <li key={p.personId} className="flex items-center gap-2 rounded-md border border-indigo-900/40 bg-indigo-950/10 px-3 py-2 text-sm">
                      <Icon name="user" size={14} className="shrink-0 text-neutral-500" />
                      <span className="truncate text-neutral-200">{p.displayName}</span>
                      <button
                        className="btn btn-primary ml-auto h-7 shrink-0 px-2 text-xs"
                        onClick={async () => {
                          await window.nodus.linkArchivePerson(item.itemId, p.personId);
                          setHiddenPersons((prev) => new Set(prev).add(p.personId));
                          await onChanged();
                        }}
                      >
                        {t('Vincular')}
                      </button>
                      <button
                        className="btn btn-ghost h-7 shrink-0 border border-neutral-700 px-2 text-xs text-neutral-400"
                        onClick={() => setHiddenPersons((prev) => new Set(prev).add(p.personId))}
                      >
                        {t('Ocultar')}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-2 border-t border-neutral-800 pt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {tags.map((x) => (
              <span key={x} className="flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                {x}
                <button onClick={() => void removeTag(x)} className="text-neutral-500 hover:text-neutral-200">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input h-8 flex-1 text-sm"
              placeholder={t('Añadir etiqueta…')}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTag();
              }}
            />
            <button className="btn btn-ghost h-8 border border-neutral-700" onClick={() => void addTag()}>
              <Icon name="tag" size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
