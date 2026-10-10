import { normalizeAcademicMetadata, cloneAcademicDocument } from '@shared/academicDocument';
import { EditorialCards, EditorialNavigator, CatalogViewControl, EditorialCreateTrigger, EditorialCatalogRow } from '../components/workspace/EditorialChrome';
import '../components/workspace/editorialWorkspace.css';
import { notifyDataChanged } from '../hooks';
import { ManualIdeaEditor } from './ManualIdeaEditor';
// El espacio de trabajo de la bóveda académica: notas, ideas y colecciones en una sola
// vista, y el mismo editor que ya usan Estudio y Docencia.
//
// Antes eran tres secciones —Notas, Escritura y Proyectos— que se contaban la misma
// historia por separado: un proyecto era una carpeta de notas con otro nombre, y un
// documento guardado de Escritura era una nota que no se podía editar. Aquí hay una sola
// estructura: COLECCIONES que contienen NOTAS e IDEAS.
//
// La forma es deliberadamente la de la Biblioteca, hasta reutilizar su tira de pestañas,
// su cabecera y sus paneles: las dos vistas hacen lo mismo —recorrer una colección de
// cosas y abrir varias a la vez— y aprenderlas dos veces no aportaba nada.
//
// El almacén es el árbol de notas de siempre (`note_folders` + `notes`), así que todo lo
// que ya colgaba de él —búsqueda global, embeddings, MCP, copias, sincronización— sigue
// funcionando sin enterarse de que la vista cambió.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Note, NoteFolder, NoteResearchChatSource, NotesTree, WorkspaceLibraryLink } from '@shared/types';
import { MANUAL_IDEA_MARKER } from '@shared/types';
import type { TestimonyDeepLink } from '@shared/testimonyDeepLinks';
import type { LibraryScope } from '@shared/libraryTypes';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { TextInputModal } from '../components/TextInputModal';
import { WorkspaceTabStrip } from '../components/library/LibraryWorkspaceTabs';
import { noteAsEditorDocument, workspaceNotePort } from '../components/editor/documentPort';
import type { PendingGraphNavigationTarget } from '../navigation';
import type { WorkspaceSnapshot } from '../app/viewSnapshots';
import { useListPlacement } from '../listPlacement';
import { t, tx } from '../i18n';
import { ResearchNoteProvenancePanel } from '../components/ResearchNoteProvenancePanel';
import { StudyNoteLinkDialog } from '../components/StudyNoteLinkDialog';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED, type StudyNavigationTarget } from '../components/StudySidebar';
import { studyNoteLinkLabel, studyNoteLinkTarget } from '@shared/studyNoteLinks';
import type { StudyNoteLink, StudyWorkspace } from '@shared/types';

const StudyEditor = lazy(() => import('../components/editor/StudyEditor').then((module) => ({ default: module.StudyEditor })));

/** Lo que se puede crear aquí. Una idea es una nota que además vive en el grafo. */
/** Exported because the section's snapshot stores it. */
export type WorkspaceItemKind = 'note' | 'idea';

type Scope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'trash' } | { kind: 'collection'; id: string };

interface WorkspaceItemContextMenu {
  noteId: string;
  x: number;
  y: number;
}

const KIND_ICON: Record<WorkspaceItemKind, string> = { note: 'notebook', idea: 'bulb' };

/** Una nota es una idea cuando la escribió el usuario COMO idea y vive en el grafo. */
function itemKind(note: Note): WorkspaceItemKind {
  return note.kind === 'idea' || note.source?.note === MANUAL_IDEA_MARKER ? 'idea' : 'note';
}

function collectionChildren(collections: NoteFolder[]): Map<string | null, NoteFolder[]> {
  const map = new Map<string | null, NoteFolder[]>();
  for (const collection of collections) {
    const bucket = map.get(collection.parentId) ?? [];
    bucket.push(collection);
    map.set(collection.parentId, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.orderIdx - b.orderIdx || a.name.localeCompare(b.name));
  }
  return map;
}

function folderPath(id: string, folders: NoteFolder[]): string {
  const names: string[] = []; const visited = new Set<string>();
  let current = folders.find(folder => folder.id === id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id); names.unshift(current.name);
    current = folders.find(folder => folder.id === current?.parentId);
  }
  return names.join(' / ');
}

/** Una colección y todo lo que cuelga de ella: lo que se ve al seleccionarla. */
function subtreeIds(collectionId: string, children: Map<string | null, NoteFolder[]>): Set<string> {
  const ids = new Set<string>([collectionId]);
  const pending = [collectionId];
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      pending.push(child.id);
    }
  }
  return ids;
}

function formatRelative(iso: string): string {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return '';
  const minutes = Math.round((Date.now() - value) / 60000);
  if (minutes < 1) return t('ahora');
  if (minutes < 60) return tx('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: hours });
  return new Date(iso).toLocaleDateString();
}

function plainSnippet(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enlaces con la biblioteca
// ─────────────────────────────────────────────────────────────────────────────

interface LibraryCandidate {
  id: string;
  title: string;
  subtitle: string;
  scope: LibraryScope;
}

/**
 * Buscador de elementos de la biblioteca, en sus dos ámbitos a la vez.
 *
 * La biblioteca global y la de la bóveda son dos almacenes distintos con dos
 * identificadores distintos, y una nota puede querer citar de cualquiera de los dos. En
 * vez de obligar a elegir ámbito antes de buscar —que es pedir que se sepa la respuesta
 * antes de la pregunta— se consultan los dos y cada resultado dice de dónde viene.
 */
function LibraryLinkPicker({ onClose, onPick }: { onClose: () => void; onPick: (candidate: LibraryCandidate) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LibraryCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const [vault, global] = await Promise.all([
          window.nodus.listWorksPage({ search: query.trim() || undefined }, { offset: 0, limit: 25 }).catch(() => null),
          window.nodus.listGlobalLibraryItems({ search: query.trim() || undefined, limit: 25, includeFacets: false }).catch(() => null),
        ]);
        if (!alive) return;
        setResults([
          ...(vault?.items ?? []).map((work) => ({
            id: work.nodus_id,
            title: work.title ?? t('Sin título'),
            subtitle: [work.authors.join('; '), work.year ?? ''].filter(Boolean).join(' · '),
            scope: 'vault' as const,
          })),
          ...(global?.items ?? []).map((item) => ({
            id: item.id,
            title: item.title || t('Sin título'),
            subtitle: [item.creators.map((creator) => creator.lastName ?? creator.name ?? '').filter(Boolean).join('; '), item.year ?? ''].filter(Boolean).join(' · '),
            scope: 'global' as const,
          })),
        ]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t('Enlazar con la biblioteca')}>
      <div data-testid="workspace-library-picker" className="flex max-h-[70vh] w-full max-w-xl flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Icon name="library" size={15} />
          <b className="flex-1 text-sm">{t('Enlazar con la biblioteca')}</b>
          <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="px-4 py-3">
          <input
            autoFocus
            data-testid="workspace-library-picker-search"
            className="input w-full"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Buscar por título o autoría…')}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading && <p className="px-3 py-4 text-xs text-neutral-500"><Spinner /> {t('Buscando…')}</p>}
          {!loading && results.length === 0 && <p className="px-3 py-4 text-xs text-neutral-500">{t('Ningún elemento coincide.')}</p>}
          {results.map((candidate) => (
            <button
              key={`${candidate.scope}:${candidate.id}`}
              data-testid={`workspace-library-candidate-${candidate.id}`}
              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
              onClick={() => onPick(candidate)}
            >
              <Icon name={candidate.scope === 'global' ? 'library' : 'book'} size={13} className="mt-0.5 shrink-0 text-neutral-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{candidate.title}</span>
                {candidate.subtitle && <span className="block truncate text-[11px] text-neutral-500">{candidate.subtitle}</span>}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-500">
                {t(candidate.scope === 'global' ? 'Global' : 'Este vault')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Los elementos de biblioteca enlazados con una nota, una idea o una colección. */
function LibraryLinksPanel({
  ownerKind,
  ownerId,
  ownerLabel,
  links,
  onChanged,
}: {
  ownerKind: WorkspaceLibraryLink['ownerKind'];
  ownerId: string;
  ownerLabel: string;
  links: WorkspaceLibraryLink[];
  onChanged: () => Promise<unknown> | void;
}) {
  const [picking, setPicking] = useState(false);
  const mine = links.filter((link) => link.ownerKind === ownerKind && link.ownerId === ownerId);

  return (
    <div data-testid="workspace-library-links" className="border-t border-neutral-200 px-3 py-3 dark:border-neutral-800">
      <div className="flex items-center gap-1">
        <b className="min-w-0 flex-1 text-[10px] uppercase tracking-wider text-neutral-500">{t('Biblioteca enlazada')}</b>
        <button
          data-testid="workspace-add-library-link"
          className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-900"
          title={tx('Enlazar {name} con la biblioteca', { name: ownerLabel })}
          aria-label={tx('Enlazar {name} con la biblioteca', { name: ownerLabel })}
          onClick={() => setPicking(true)}
        ><Icon name="link" size={13} /></button>
      </div>
      {mine.length === 0 && <p className="mt-1 text-[11px] leading-5 text-neutral-500">{t('Sin elementos enlazados todavía.')}</p>}
      <ul className="mt-1 space-y-0.5">
        {mine.map((link) => (
          <li key={`${link.libraryItemId}:${link.scope}`} className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">
            <Icon name={link.scope === 'global' ? 'library' : 'book'} size={12} className="shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1 truncate" title={link.label ?? link.libraryItemId}>{link.label ?? link.libraryItemId}</span>
            <button
              data-testid={`workspace-remove-library-link-${link.libraryItemId}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-neutral-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
              title={t('Quitar enlace')}
              aria-label={tx('Quitar el enlace con {name}', { name: link.label ?? link.libraryItemId })}
              onClick={async () => {
                await window.nodus.removeWorkspaceLibraryLink(ownerKind, ownerId, link.libraryItemId, link.scope);
                await onChanged();
              }}
            ><Icon name="x" size={11} /></button>
          </li>
        ))}
      </ul>
      {picking && (
        <LibraryLinkPicker
          onClose={() => setPicking(false)}
          onPick={async (candidate) => {
            await window.nodus.addWorkspaceLibraryLink({
              ownerKind, ownerId, libraryItemId: candidate.id, scope: candidate.scope, label: candidate.title,
            });
            setPicking(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Where a note is linked in a study or teaching vault, and the way to change it. */
function StudyLinksPanel({
  note,
  links,
  organization,
  onOpenLocation,
  onOpenMaterial,
  onManage,
  onChanged,
}: {
  note: Note;
  links: StudyNoteLink[];
  organization: StudyWorkspace | null;
  onOpenLocation: (target: StudyNavigationTarget) => void;
  onOpenMaterial: (id: string) => void;
  onManage: () => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const mine = links.filter((link) => link.noteId === note.id);
  return (
    <div data-testid="workspace-study-links" className="border-t border-neutral-200 px-3 py-3 dark:border-neutral-800">
      <div className="flex items-center gap-1">
        <b className="min-w-0 flex-1 text-[10px] uppercase tracking-wider text-neutral-500">{t('Cursos y materiales vinculados')}</b>
        <button
          data-testid="workspace-add-study-link"
          className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-900"
          title={tx('Vincular {name} con cursos y materiales', { name: note.title })}
          aria-label={tx('Vincular {name} con cursos y materiales', { name: note.title })}
          onClick={onManage}
        ><Icon name="graduation" size={13} /></button>
      </div>
      {mine.length === 0 && <p className="mt-1 text-[11px] leading-5 text-neutral-500">{t('Vincúlala a cursos, asignaturas, temas o materiales para verla también allí.')}</p>}
      <ul className="mt-1 space-y-0.5">
        {mine.map((link) => {
          const label = studyNoteLinkLabel(link, organization) || t('Sin ubicación');
          const target = studyNoteLinkTarget(link);
          return (
            <li key={link.id} className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">
              <Icon name={link.materialId ? 'book' : 'graduation'} size={12} className="shrink-0 text-neutral-500" />
              <button
                className="min-w-0 flex-1 text-left hover:text-indigo-400"
                title={label}
                onClick={() => {
                  if (!target) return;
                  if (target.kind === 'material') onOpenMaterial(target.id);
                  else onOpenLocation({ kind: target.kind, id: target.id });
                }}
              >
                {/* The place itself first; the path that leads to it underneath. */}
                <span className="block truncate">{link.materialId ? label : label.split(' / ').at(-1)}</span>
                <span className="block truncate text-[10px] text-neutral-500">{link.materialId ? t('Material') : label.split(' / ').slice(0, -1).join(' / ')}</span>
              </button>
              <button
                data-testid={`workspace-remove-study-link-${link.id}`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-neutral-500 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                title={t('Quitar vínculo')}
                aria-label={tx('Quitar el vínculo con {name}', { name: label })}
                onClick={async () => {
                  await window.nodus.removeStudyNoteLinks([link.id]);
                  announceStudyWorkspaceChanged();
                  await onChanged();
                }}
              ><Icon name="x" size={11} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// El árbol de colecciones
// ─────────────────────────────────────────────────────────────────────────────

function CollectionBranch({
  collection,
  children,
  counts,
  selected,
  expanded,
  depth,
  onSelect,
  onToggle,
  onRename,
  onDelete,
  onDropItem,
}: {
  collection: NoteFolder;
  children: Map<string | null, NoteFolder[]>;
  counts: Map<string, number>;
  selected: string | null;
  expanded: Set<string>;
  depth: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (collection: NoteFolder) => void;
  onDelete: (collection: NoteFolder) => void;
  onDropItem: (noteId: string, collectionId: string) => void;
}) {
  const descendants = children.get(collection.id) ?? [];
  const open = expanded.has(collection.id);
  const active = selected === collection.id;
  return (
    <>
      <div
        className="group flex items-center pr-1"
        style={{ paddingLeft: depth * 12 }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('application/x-nodus-workspace-note')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          const noteId = event.dataTransfer.getData('application/x-nodus-workspace-note');
          if (noteId) { event.preventDefault(); onDropItem(noteId, collection.id); }
        }}
      >
        <button
          className={`grid h-7 w-6 shrink-0 place-items-center rounded text-neutral-600 hover:text-neutral-300 ${descendants.length ? '' : 'invisible'}`}
          onClick={() => onToggle(collection.id)}
          aria-label={open ? t('Plegar') : t('Desplegar')}
        ><Icon name="chevronRight" size={12} className={open ? 'rotate-90' : ''} /></button>
        <span className="grid h-7 w-7 shrink-0 place-items-center text-neutral-500"><Icon name="folder" size={13} /></span>
        <button
          data-testid={`workspace-collection-${collection.id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${active ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`}
          onClick={() => onSelect(collection.id)}
          title={collection.sourceRef ? `${collection.name} · ${t('Procede de una sección anterior')}` : collection.name}
        >
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          <span className="text-[10px] tabular-nums opacity-55">{counts.get(collection.id) ?? 0}</span>
        </button>
        <div className={`ml-0.5 flex shrink-0 items-center gap-0.5 transition-opacity ${active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <button
            data-testid={`workspace-collection-rename-${collection.id}`}
            className="grid h-6 w-6 place-items-center rounded text-neutral-600 hover:bg-neutral-900 hover:text-neutral-200"
            onClick={() => onRename(collection)}
            title={t('Renombrar colección')}
            aria-label={tx('Renombrar {name}', { name: collection.name })}
          ><Icon name="edit" size={11} /></button>
          <button
            data-testid={`workspace-collection-delete-${collection.id}`}
            className="grid h-6 w-6 place-items-center rounded text-neutral-600 hover:bg-red-500/10 hover:text-red-400"
            onClick={() => onDelete(collection)}
            title={t('Eliminar colección')}
            aria-label={tx('Eliminar {name}', { name: collection.name })}
          ><Icon name="trash" size={11} /></button>
        </div>
      </div>
      {open && descendants.map((child) => (
        <CollectionBranch
          key={child.id} collection={child} children={children} counts={counts} selected={selected}
          expanded={expanded} depth={depth + 1} onSelect={onSelect} onToggle={onToggle}
          onRename={onRename} onDelete={onDelete} onDropItem={onDropItem}
        />
      ))}
    </>
  );
}

function WorkspaceTagsEditor({ note, onChanged }: { note: Note; onChanged: () => Promise<unknown> }) {
  const [draft, setDraft] = useState('');
  const add = async () => {
    if (!draft.trim()) return;
    await window.nodus.patchNoteTags([note.id], { add: [draft] });
    setDraft('');
    await onChanged();
  };
  return (
    <div data-testid="workspace-item-tags" className="border-t border-neutral-200 px-3 py-3 dark:border-neutral-800">
      <b className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Etiquetas')}</b>
      <div className="mt-2 flex flex-wrap gap-1">
        {note.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-1 text-[10px] text-indigo-300">
            {tag}
            <button
              type="button"
              className="text-indigo-400/70 hover:text-red-400"
              aria-label={tx('Quitar etiqueta {tag}', { tag })}
              onClick={async () => { await window.nodus.patchNoteTags([note.id], { remove: [tag] }); await onChanged(); }}
            ><Icon name="x" size={9} /></button>
          </span>
        ))}
        {note.tags.length === 0 && <span className="text-[11px] text-neutral-600">{t('Sin etiquetas')}</span>}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          data-testid="workspace-item-tag-input"
          className="input h-8 min-w-0 flex-1 text-xs"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }}
          placeholder={t('Añadir etiqueta…')}
        />
        <button type="button" className="btn btn-ghost h-8 w-8 p-0" disabled={!draft.trim()} onClick={() => void add()} aria-label={t('Añadir etiqueta')}>
          <Icon name="tag" size={13} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// La vista
// ─────────────────────────────────────────────────────────────────────────────

export function WorkspaceView({
  settings,
  focusNote,
  snapshot,
  onSnapshotChange,
  onOpenGraph,
  title = 'Nodus Scriptor',
  onTestimonyLink,
  onOpenResearchConversation,
  onOpenStudyDocument,
  onOpenStudyMaterial,
  onOpenStudyRecording,
  onOpenWorldEntry,
  studyLinks,
}: {
  settings: AppSettings;
  /** Una nota que abrir al entrar (búsqueda global, Nodi); el nonce repite el gesto. */
  focusNote?: { id: string; nonce: number } | null;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: WorkspaceSnapshot;
  onSnapshotChange?: (patch: Partial<WorkspaceSnapshot>) => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
  title?: 'Nodus Scriptor';
  /** Los enlaces temporales de una nota testimonial abren su entrevista y minuto. */
  onTestimonyLink?: (link: TestimonyDeepLink) => void;
  onOpenResearchConversation?: (source: NoteResearchChatSource) => void;
  onOpenStudyDocument?: (id: string) => void;
  onOpenStudyMaterial?: (id: string) => void;
  onOpenStudyRecording?: (id: string, timestamp?: number | null) => void;
  onOpenWorldEntry?: (kind: string, id: string) => void;
  /** Study and teaching vaults: notes can be linked to courses, subjects, topics and materials. */
  studyLinks?: { onOpenLocation: (target: StudyNavigationTarget) => void; onOpenMaterial: (id: string) => void };
}) {
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>(snapshot?.pinnedActionIds ?? []);
  const [layout, setLayout] = useState<'editorial' | 'navigator'>(() => snapshot?.layout ?? 'editorial');
  const [catalogView, setCatalogView] = useState<'list' | 'cards'>(() => snapshot?.catalogView ?? 'list');
  const [contextOpen, setContextOpen] = useState(snapshot?.contextOpen ?? false);
  const [focusMode, setFocusMode] = useState(false);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const [tree, setTree] = useState<NotesTree>({ folders: [], notes: [] });
  const [links, setLinks] = useState<WorkspaceLibraryLink[]>([]);
  const [studyNoteLinks, setStudyNoteLinks] = useState<StudyNoteLink[]>([]);
  const [studyOrganization, setStudyOrganization] = useState<StudyWorkspace | null>(null);
  const [linkingNote, setLinkingNote] = useState<Note | null>(null);
  const studyLinksEnabled = Boolean(studyLinks);
  const [loading, setLoading] = useState(true);
  // Restored as initial values only. The expanded folders are part of the cut:
  // collapsing back to the root loses the reader's route to what they were reading
  // just as surely as dropping the filter does.
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState('recent');
  const [scope, setScope] = useState<Scope>(() => snapshot?.scope ?? { kind: 'all' });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(snapshot?.expanded ?? []));
  const [search, setSearch] = useState(() => snapshot?.search ?? '');
  const [kindFilter, setKindFilter] = useState<'' | WorkspaceItemKind>(() => snapshot?.kindFilter ?? '');
  const [selectedTags, setSelectedTags] = useState<string[]>(() => snapshot?.selectedTags ?? []);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState('');
  const [bulkCollection, setBulkCollection] = useState('');
  const [openIds, setOpenIds] = useState<string[]>(() => snapshot?.openIds ?? []);
  const [activeId, setActiveId] = useState<string | null>(() => snapshot?.activeId ?? null);
  const [anchorId, setAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const [itemContextMenu, setItemContextMenu] = useState<WorkspaceItemContextMenu | null>(null);
  const [renaming, setRenaming] = useState<NoteFolder | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<NoteFolder | null>(null);
  const [pendingNoteDelete, setPendingNoteDelete] = useState<Note | null>(null);
  const [pendingPermanentDeleteIds, setPendingPermanentDeleteIds] = useState<string[] | null>(null);
  const focusedNonce = useRef<number | null>(null);
  const tagFilterRef = useRef<HTMLDivElement | null>(null);
  const bulkTagRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const [nextTree, nextLinks] = await Promise.all([
      window.nodus.getNotesTree(true),
      window.nodus.listAllWorkspaceLibraryLinks(),
    ]);
    setTree(nextTree);
    setLinks(nextLinks);
    setLoading(false);
    return nextTree;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // The study side of the links reloads on its own: it changes from the study sections
  // too (a note unlinked from a subject), not only from here.
  const refreshStudyLinks = useCallback(async () => {
    if (!studyLinksEnabled) return;
    const [nextLinks, organization] = await Promise.all([
      window.nodus.listStudyNoteLinks().catch(() => [] as StudyNoteLink[]),
      window.nodus.getStudyWorkspace().catch(() => null),
    ]);
    setStudyNoteLinks(nextLinks);
    setStudyOrganization(organization);
  }, [studyLinksEnabled]);
  useEffect(() => {
    if (!studyLinksEnabled) return;
    void refreshStudyLinks();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, refreshStudyLinks);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, refreshStudyLinks);
  }, [refreshStudyLinks, studyLinksEnabled]);
  const studyLinkCounts = useMemo(() => {
    const counts = new Map<string, StudyNoteLink[]>();
    for (const link of studyNoteLinks) counts.set(link.noteId, [...(counts.get(link.noteId) ?? []), link]);
    return counts;
  }, [studyNoteLinks]);

  useEffect(() => {
    if (!tagFilterOpen && !itemContextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (tagFilterRef.current?.contains(event.target as Node)) return;
      if ((event.target as Element | null)?.closest?.('[data-testid="workspace-context-menu"]')) return;
      setTagFilterOpen(false);
      setItemContextMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setTagFilterOpen(false); setItemContextMenu(null); } };
    const blur = () => setItemContextMenu(null);
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  }, [tagFilterOpen, itemContextMenu]);

  // Entrar desde fuera (búsqueda global, Nodi) abre la nota en su pestaña.
  useEffect(() => {
    if (!focusNote || focusedNonce.current === focusNote.nonce) return;
    focusedNonce.current = focusNote.nonce;
    setOpenIds((current) => current.includes(focusNote.id) ? current : [...current, focusNote.id]);
    setActiveId(focusNote.id);
  }, [focusNote?.id, focusNote?.nonce]);

  const children = useMemo(() => collectionChildren(tree.folders), [tree.folders]);
  const activeNotes = useMemo(() => tree.notes.filter((note) => !note.trashedAt), [tree.notes]);
  const trashedNotes = useMemo(() => tree.notes.filter((note) => Boolean(note.trashedAt)), [tree.notes]);
  const tagFacets = useMemo(() => {
    const countsByTag = new Map<string, { label: string; count: number }>();
    for (const note of activeNotes) for (const label of note.tags) {
      const key = label.toLocaleLowerCase();
      const current = countsByTag.get(key);
      countsByTag.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
    }
    return [...countsByTag.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [activeNotes]);
  const visibleTagFacets = useMemo(() => {
    const needle = tagSearch.trim().toLocaleLowerCase();
    return needle ? tagFacets.filter((entry) => entry.label.toLocaleLowerCase().includes(needle)) : tagFacets;
  }, [tagFacets, tagSearch]);

  /** Cuántas notas hay en cada colección, contando sus subcolecciones. */
  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const note of activeNotes) {
      if (!note.folderId) continue;
      direct.set(note.folderId, (direct.get(note.folderId) ?? 0) + 1);
    }
    const total = new Map<string, number>();
    for (const collection of tree.folders) {
      let sum = 0;
      for (const id of subtreeIds(collection.id, children)) sum += direct.get(id) ?? 0;
      total.set(collection.id, sum);
    }
    return total;
  }, [activeNotes, tree.folders, children]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const allowed = scope.kind === 'collection' ? subtreeIds(scope.id, children) : null;
    return tree.notes
      .filter((note) => {
        if (scope.kind === 'trash') {
          if (!note.trashedAt) return false;
        } else if (note.trashedAt) return false;
        if (scope.kind === 'unfiled' && note.folderId) return false;
        if (allowed && (!note.folderId || !allowed.has(note.folderId))) return false;
        if (kindFilter && itemKind(note) !== kindFilter) return false;
        if (selectedTags.length && !selectedTags.some((tag) => note.tags.some((own) => own.toLocaleLowerCase() === tag.toLocaleLowerCase()))) return false;
        if (!needle) return true;
        return note.title.toLocaleLowerCase().includes(needle)
          || note.content.toLocaleLowerCase().includes(needle)
          || note.tags.some((tag) => tag.toLocaleLowerCase().includes(needle));
      })
      .sort((a, b) => sortOrder === 'title' ? a.title.localeCompare(b.title) : sortOrder === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [tree.notes, scope, children, kindFilter, search, selectedTags, sortOrder]);

  // The registry rebuilds the callback on every render of the shell, so a ref keeps
  // its identity out of the effect's dependencies.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    report.current?.({ scope, expanded: [...expanded], search, kindFilter, selectedTags, openIds, activeId, layout, catalogView, contextOpen, focusMode, pinnedActionIds });
  }, [activeId, expanded, kindFilter, openIds, scope, search, selectedTags, layout, catalogView, contextOpen, focusMode, pinnedActionIds]);

  // This list is not paged — the filtered set renders whole — so the placement is
  // scroll alone. It is still an id: row heights change with the window, and the
  // notes reorder themselves by modification date under the reader's feet.
  const listRef = useListPlacement<HTMLDivElement>({
    restoreAnchorId: anchorId,
    revision: visible,
    onRestoreMissed: () => {
      setAnchorId(null);
      report.current?.({ placement: null });
    },
    onCapture: (topId) => report.current?.({ placement: topId ? { anchorId: topId } : null }),
  });

  const openTabs = useMemo(
    () => openIds
      .map((id) => tree.notes.find((note) => note.id === id))
      .filter((note): note is Note => Boolean(note && !note.trashedAt)),
    [openIds, tree.notes]
  );
  const active = openTabs.find((note) => note.id === activeId) ?? null;

  const openNote = async (id: string) => {
    if (activeId && !await flushRef.current()) return;
    setOpenIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveId(id);
  };

  const closeNote = async (id: string) => {
    if (activeId === id && !await flushRef.current()) return;
    setOpenIds((current) => current.filter((candidate) => candidate !== id));
    setActiveId((current) => {
      if (current !== id) return current;
      const remaining = openIds.filter((candidate) => candidate !== id);
      return remaining.at(-1) ?? null;
    });
  };

  const closeNotes = (ids: Iterable<string>) => {
    const closing = new Set(ids);
    setOpenIds((current) => current.filter((id) => !closing.has(id)));
    setActiveId((current) => current && closing.has(current) ? null : current);
  };

  const toggleSelected = (id: string, checked?: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = checked ?? !next.has(id);
      if (shouldSelect) next.add(id); else next.delete(id);
      return next;
    });
  };

  const duplicateNote = async (note: Note) => {
    if (activeId === note.id && !await flushRef.current()) return;
    const data = await window.nodus.getWorkspaceNoteEditorData(note.id);
    const copy = await window.nodus.createNote({
      title: `${note.title} (${t('copia')})`, content: note.content,
      kind: note.kind === 'idea' ? 'markdown' : note.kind, folderId: note.folderId, tags: note.tags,
    });
    if(data.nativeDocument){const cloned=cloneAcademicDocument(data.nativeDocument,data.academicMetadata);await window.nodus.updateWorkspaceNote(copy.id,{title:copy.title,contentMarkdown:copy.content,nativeDocument:cloned.document,academicMetadata:cloned.metadata,style:data.style});}
    await refresh();
    openNote(copy.id);
  };

  const moveToTrash = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    if (activeId && unique.includes(activeId) && !await flushRef.current()) return;
    await window.nodus.trashNotes(unique);
    closeNotes(unique);
    setSelected(new Set());
    setPendingNoteDelete(null);
    setItemContextMenu(null);
    await refresh();
  };

  const restoreItems = async (ids: string[]) => {
    await window.nodus.restoreNotes([...new Set(ids)]);
    setSelected(new Set());
    setItemContextMenu(null);
    await refresh();
  };

  const permanentlyDelete = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    await window.nodus.deleteNotesPermanently(unique);
    closeNotes(unique);
    setSelected(new Set());
    setPendingPermanentDeleteIds(null);
    setItemContextMenu(null);
    await refresh();
  };

  const applyBulkTag = async () => {
    if (!selected.size || !bulkTag.trim()) return;
    await window.nodus.patchNoteTags([...selected], { add: [bulkTag] });
    setBulkTag('');
    await refresh();
  };

  const moveSelected = async () => {
    if (!selected.size) return;
    await Promise.all([...selected].map((id) => window.nodus.moveNote(id, bulkCollection || null)));
    setSelected(new Set());
    await refresh();
  };

  /** La colección en la que aterriza lo que se cree ahora mismo. */
  const targetCollectionId = () => (scope.kind === 'collection' ? scope.id : null);

  const createItem = async (kind: WorkspaceItemKind) => {
    const folderId = targetCollectionId();
    const created = kind === 'idea'
      ? (await window.nodus.createManualIdea({ folderId })).note
      : await window.nodus.createNote({ title: t('Nota sin título'), content: '', kind: 'markdown', folderId });
    await refresh();
    openNote(created.id);
  };

  const createManuscript = async () => {
    const collectionId=targetCollectionId();
    const folderId=collectionId??(await window.nodus.createNoteFolder({name:t('Nuevo manuscrito')})).id;
    const folderIds=new Set([folderId]);for(let count=0;count<tree.folders.length;count++)for(const folder of tree.folders)if(folder.parentId&&folderIds.has(folder.parentId))folderIds.add(folder.id);
    const chapters=tree.notes.filter(note=>note.folderId&&folderIds.has(note.folderId)&&!note.trashedAt&&note.source?.note!=='academic-manuscript').sort((a,b)=>a.orderIdx-b.orderIdx).map(note=>({documentId:note.id,kind:'note' as const,title:note.title,included:true}));
    const created=await window.nodus.createNote({title:t('Nuevo manuscrito'),content:'',folderId,kind:'markdown',source:{origin:'markdown',ref:folderId,note:'academic-manuscript'}});
    const metadata=normalizeAcademicMetadata(null);metadata.manuscript={kind:'paper',chapters,authors:'',abstract:'',keywords:'',includeContents:false,paper:'A4',marginMm:25};
    await window.nodus.updateWorkspaceNote(created.id,{title:created.title,contentMarkdown:'',nativeDocument:[],academicMetadata:metadata,schemaVersion:2});
    await refresh();openNote(created.id);
  };

  const selectedCollection = scope.kind === 'collection' ? tree.folders.find((folder) => folder.id === scope.id) ?? null : null;
  const contextNote = itemContextMenu ? tree.notes.find((note) => note.id === itemContextMenu.noteId) ?? null : null;

  const workspaceTabs = (      <WorkspaceTabStrip
        alwaysShowHome
        homeLabel={t(title)}
        homeIcon="notebook"
        homeTestId="workspace-tab-home"
        tabTestId={(tab) => `workspace-tab-${tab.key}`}
        closeTestId={(tab) => `workspace-tab-close-${tab.key}`}
        tabs={openTabs.map((note) => ({ key: note.id, title: note.title, icon: KIND_ICON[itemKind(note)] }))}
        activeKey={active?.id ?? null}
        onActivateHome={() => { void flushRef.current().then(saved => { if (saved) setActiveId(null); }); }}
        onActivateTab={openNote}
        onCloseTab={closeNote}
      />
  );

  const editorPane = active && (
    <div className="flex min-h-0 min-w-0 flex-1 relative">
      <div className="min-h-0 min-w-0 flex-1 flex flex-col">
        <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label={t('Cargando editor…')} /></div>}>
          <StudyEditor
            pinnedActionIds={pinnedActionIds} onPinnedActionsChange={setPinnedActionIds}
            navigatorContent={layout === 'navigator' && <EditorialNavigator items={visible.map(note => ({ id: note.id, title: note.title, snippet: plainSnippet(note.content) }))} activeId={active.id} search={search} onSearch={setSearch} onOpen={openNote} onClose={() => setLayout('editorial')} collectionControl={<select className="input" aria-label={t('Colección')} value={scope.kind === 'collection' ? scope.id : scope.kind} onChange={event => setScope(event.target.value === 'all' ? { kind: 'all' } : event.target.value === 'unfiled' ? { kind: 'unfiled' } : { kind: 'collection', id: event.target.value })}><option value="all">{t('Todo')}</option><option value="unfiled">{t('Sin colección')}</option>{tree.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>} />}
            location={active.folderId ? folderPath(active.folderId, tree.folders) : t('Sin colección')}
            contextOpen={contextOpen} onContextOpenChange={setContextOpen}
            focusMode={focusMode} onFocusModeChange={focus => { setFocusMode(focus); if (focus) setLayout('editorial'); }}
            onNavigateLink={href => {
              const study = href.match(/^nodus:\/\/study\/(doc|material)\/([^?]+)/);
              if(study) { const handler=study[1]==='doc'?onOpenStudyDocument:onOpenStudyMaterial; if(handler){handler(decodeURIComponent(study[2]));return true;} }
              const world=href.match(/^nodus:\/\/world\/([^/]+)\/(.+)/);if(world&&onOpenWorldEntry){onOpenWorldEntry(world[1],decodeURIComponent(world[2]));return true;}
              const citation=href.match(/^nodus:\/\/(idea|work|gap|contradiction)\/([^?]+)/);if(citation&&onOpenGraph){onOpenGraph(citation[1]==='work'?{workId:decodeURIComponent(citation[2])}:{nodeId:decodeURIComponent(citation[2])});return true;}
              return false;
            }}
            onRegisterFlush={flush => { flushRef.current = flush; }}
            headerContent={<><button className="editorial-header-action" aria-label={t('Navegador de documentos')} aria-pressed={layout === 'navigator'} onClick={() => setLayout(layout === 'navigator' ? 'editorial' : 'navigator')}><Icon name="list" size={14} /></button>{workspaceTabs}</>}
            contextDetails={<>
        <div className="px-3 py-3">
          <b className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Detalles')}</b>
          <p className="mt-1 truncate text-xs font-medium" title={active.title}>{active.title}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {t(itemKind(active) === 'idea' ? 'Idea' : 'Nota')}
            {active.folderId ? ` · ${tree.folders.find((folder) => folder.id === active.folderId)?.name ?? ''}` : ` · ${t('Sin colección')}`}
          </p>
        </div>
        <div className="px-3 pb-3">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500" htmlFor="workspace-item-collection">{t('Colección')}</label>
          <select
            id="workspace-item-collection"
            data-testid="workspace-item-collection"
            className="input mt-1 w-full text-xs"
            value={active.folderId ?? ''}
            onChange={async (event) => {
              await window.nodus.moveNote(active.id, event.target.value || null);
              await refresh();
            }}
          >
            <option value="">{t('Sin colección')}</option>
            {tree.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </div>
        <WorkspaceTagsEditor note={active} onChanged={refresh} />
        {itemKind(active) === 'idea' && active.source?.ref && onOpenGraph && (
          <div className="px-3 pb-3">
            <button className="btn btn-ghost w-full text-xs" onClick={() => onOpenGraph({ nodeId: active.source!.ref!, label: active.title })}>
              <Icon name="layers" size={13} /> {t('Ver en el grafo')}
            </button>
          </div>
        )}
        {studyLinks && (
          <StudyLinksPanel
            note={active}
            links={studyNoteLinks}
            organization={studyOrganization}
            onOpenLocation={studyLinks.onOpenLocation}
            onOpenMaterial={studyLinks.onOpenMaterial}
            onManage={() => setLinkingNote(active)}
            onChanged={refreshStudyLinks}
          />
        )}
            </>}
            contextSources={<>
        <ResearchNoteProvenancePanel
          note={active}
          onOpenConversation={onOpenResearchConversation}
          onOpenStudyDocument={onOpenStudyDocument}
          onOpenStudyMaterial={onOpenStudyMaterial}
          onOpenStudyRecording={onOpenStudyRecording}
          onOpenWorldEntry={onOpenWorldEntry}
        />
        <LibraryLinksPanel ownerKind="note" ownerId={active.id} ownerLabel={active.title} links={links} onChanged={refresh} />              {settings.academicMode === 'manual' && itemKind(active) === 'idea' && active.source?.ref && <ManualIdeaEditor key={active.id} note={active} globalId={active.source.ref} linksOnly manual onSaved={() => { void refresh(); notifyDataChanged(); }} onOpenGraph={onOpenGraph} />}
            </>}
            settings={settings}
            port={workspaceNotePort}
            showTabs={false}
            documentIcon={KIND_ICON[itemKind(active)]}
            documents={[noteAsEditorDocument(active)]}
            activeId={active.id}
            onActivate={openNote}
            onClose={closeNote}
            onSaved={(updated) => {
              if (settings.academicMode === 'manual') notifyDataChanged();
              setTree((current) => ({
                ...current,
                notes: current.notes.map((note) => note.id === updated.id
                  ? { ...note, title: updated.title, content: updated.contentMarkdown, updatedAt: new Date().toISOString() }
                  : note),
              }));
            }}
            onDuplicate={async () => duplicateNote(active)}
            onTrash={async () => setPendingNoteDelete(active)}
            onOpenLinkedDocument={openNote}
            onOpenRecording={() => undefined}
            onTestimonyLink={onTestimonyLink}
          />
        </Suspense>
      </div>
    </div>
  );

  const browser = (
    <div data-testid="workspace-view" className="library-theme-canvas flex h-full min-h-0 flex-col bg-neutral-950">
      <header data-testid="workspace-header" className="library-header-bar min-h-14 shrink-0 border-b border-neutral-800 px-5 py-3">
        <div className="library-header-title min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name={scope.kind === 'trash' ? 'trash' : 'notebook'} className={scope.kind === 'trash' ? 'text-red-400' : 'text-indigo-400'} /> {t(scope.kind === 'trash' ? 'Papelera' : title)}</h1>
          <p className="text-[11px] text-neutral-500">{scope.kind === 'trash'
            ? tx('{n} elemento(s) recuperable(s)', { n: trashedNotes.length })
            : tx('{n} nota(s) e idea(s) · {c} colección(es)', { n: activeNotes.length, c: tree.folders.length })}</p>
        </div>
        <div className="library-header-actions">
          {scope.kind === 'trash' ? <button data-testid="workspace-empty-trash" className="btn btn-ghost h-8 border border-red-500/30 text-xs text-red-400" disabled={!trashedNotes.length} onClick={() => setPendingPermanentDeleteIds(trashedNotes.map((note) => note.id))}>
            <Icon name="trash" size={13} /> {t('Vaciar papelera')}
          </button> : <details className="editorial-options editorial-create-options"><EditorialCreateTrigger /><div className="editorial-create-menu"><button data-testid="workspace-create-idea" className="btn btn-secondary h-8 text-xs" onClick={() => void createItem('idea')}>
            <Icon name="bulb" size={13} /> {t('Idea')}
          </button>
          <button data-testid="workspace-create-note" className="btn btn-primary h-8 text-xs" onClick={() => void createItem('note')}>
            <Icon name="notebook" size={13} /> {t('Nota')}
          </button><button data-testid="workspace-create-manuscript" className="btn btn-ghost" onClick={()=>void createManuscript()}>{t('Manuscrito')}</button><button className="btn btn-ghost" onClick={() => setCreatingCollection(true)}>{t('Colección')}</button></div></details>}
          <button className="editorial-header-action editorial-collection-toggle" onClick={() => setCollectionsOpen(!collectionsOpen)}>{t('Colecciones')}</button><CatalogViewControl value={catalogView} onChange={setCatalogView} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`editorial-collections library-theme-panel w-[238px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/80 ${collectionsOpen ? 'is-open' : ''}`}>
          <div className="flex items-center gap-1 px-3 py-3">
            <b className="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-neutral-500">{t('Colecciones')}</b>
            <button
              data-testid="workspace-create-collection"
              className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900"
              title={t('Nueva colección')}
              aria-label={t('Nueva colección')}
              onClick={() => setCreatingCollection(true)}
            ><Icon name="folderPlus" size={14} /></button>
          </div>
          <div className="px-2 pb-2">
            <button
              data-testid="workspace-scope-all"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${scope.kind === 'all' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}
              onClick={() => { setScope({ kind: 'all' }); setSelected(new Set()); }}
            ><Icon name="library" size={14} /><span className="flex-1">{t('Todo')}</span><span className="text-[10px] opacity-60">{activeNotes.length}</span></button>
          </div>
          <div
            data-testid="workspace-collections-pane"
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-1"
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('application/x-nodus-workspace-note')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={async (event) => {
              const noteId = event.dataTransfer.getData('application/x-nodus-workspace-note');
              if (!noteId) return;
              event.preventDefault();
              await window.nodus.moveNote(noteId, null);
              await refresh();
            }}
          >
            {(children.get(null) ?? []).map((collection) => (
              <CollectionBranch
                key={collection.id}
                collection={collection}
                children={children}
                counts={counts}
                selected={scope.kind === 'collection' ? scope.id : null}
                expanded={expanded}
                depth={0}
                onSelect={(id) => { setScope({ kind: 'collection', id }); setSelected(new Set()); }}
                onToggle={(id) => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                onRename={setRenaming}
                onDelete={setPendingCollectionDelete}
                onDropItem={async (noteId, collectionId) => {
                  await window.nodus.moveNote(noteId, collectionId);
                  await refresh();
                }}
              />
            ))}
            {tree.folders.length === 0 && (
              <p className="px-3 py-4 text-xs leading-5 text-neutral-600">{t('Agrupa tus notas e ideas en colecciones para trabajar por temas o capítulos.')}</p>
            )}
          </div>
          <div className="shrink-0 space-y-1 border-t border-neutral-800 px-2 py-2">
            <button
              data-testid="workspace-scope-unfiled"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${scope.kind === 'unfiled' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}
              onClick={() => { setScope({ kind: 'unfiled' }); setSelected(new Set()); }}
            >
              <Icon name="folder" size={14} /><span className="flex-1">{t('Sin colección')}</span>
              <span className="text-[10px] opacity-60">{activeNotes.filter((note) => !note.folderId).length}</span>
            </button>
            <button
              data-testid="workspace-scope-trash"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${scope.kind === 'trash' ? 'bg-red-500/15 text-red-300' : 'text-neutral-500 hover:bg-neutral-900 hover:text-red-400'}`}
              onClick={() => { setScope({ kind: 'trash' }); setSelected(new Set()); setActiveId(null); }}
            >
              <Icon name="trash" size={14} /><span className="flex-1">{t('Papelera')}</span>
              <span className="text-[10px] opacity-60">{trashedNotes.length}</span>
            </button>
          </div>
          {selectedCollection && (
            <LibraryLinksPanel
              ownerKind="collection"
              ownerId={selectedCollection.id}
              ownerLabel={selectedCollection.name}
              links={links}
              onChanged={refresh}
            />
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="relative min-w-48 flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                data-testid="workspace-search"
                className="input input-with-leading-icon h-8 w-full text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('Buscar en notas e ideas…')}
              />
            </div>
            <select
              data-testid="workspace-kind-filter"
              aria-label={t('Tipo')}
              className="input h-8 w-32 text-xs"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as '' | WorkspaceItemKind)}
            >
              <option value="">{t('Todo')}</option>
              <option value="note">{t('Notas')}</option>
              <option value="idea">{t('Ideas')}</option>
            </select>
            <select aria-label={t('Ordenar documentos')} className="input h-8 text-xs" value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="recent">{t('Recientes')}</option><option value="oldest">{t('Más antiguos')}</option><option value="title">{t('Título')}</option></select><div className="relative" ref={tagFilterRef}>
              <button
                data-testid="workspace-tag-filter"
                type="button"
                className={`btn h-8 border text-xs ${selectedTags.length ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'btn-ghost border-neutral-700'}`}
                onClick={() => setTagFilterOpen((open) => !open)}
                aria-expanded={tagFilterOpen}
                aria-haspopup="dialog"
              >
                <Icon name="tag" size={13} /> {t('Etiquetas')}
                {selectedTags.length > 0 && <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">{selectedTags.length}</span>}
              </button>
              {tagFilterOpen && (
                <div data-testid="workspace-tag-filter-popover" role="dialog" aria-label={t('Filtrar por etiquetas')} className="library-action-menu absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl">
                  <div className="relative">
                    <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input autoFocus className="input input-with-leading-icon h-8 w-full text-xs" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder={t('Buscar etiqueta…')} />
                  </div>
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                    {visibleTagFacets.map((entry) => {
                      const checked = selectedTags.some((tag) => tag.toLocaleLowerCase() === entry.label.toLocaleLowerCase());
                      return <label key={entry.label} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-neutral-900 ${checked ? 'bg-indigo-500/10 text-indigo-300' : 'text-neutral-400'}`}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedTags((current) => checked ? current.filter((tag) => tag.toLocaleLowerCase() !== entry.label.toLocaleLowerCase()) : [...current, entry.label])} />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span><span className="text-[10px] text-neutral-600">{entry.count}</span>
                      </label>;
                    })}
                    {visibleTagFacets.length === 0 && <p className="px-2 py-3 text-xs text-neutral-600">{t('No hay etiquetas que coincidan.')}</p>}
                  </div>
                  {selectedTags.length > 0 && <button className="mt-2 w-full text-center text-[11px] text-indigo-300 hover:text-indigo-200" onClick={() => setSelectedTags([])}>{t('Limpiar filtros')}</button>}
                </div>
              )}
            </div>
          </div>

          {selected.size > 0 && (
            <div data-testid="workspace-bulk-actions" className="flex flex-wrap items-center gap-2 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs">
              <b>{tx('{n} seleccionados', { n: selected.size })}</b>
              {scope.kind === 'trash' ? <>
                <button data-testid="workspace-bulk-restore" className="btn btn-secondary h-8 text-xs" onClick={() => void restoreItems([...selected])}><Icon name="refresh" size={13} /> {t('Restaurar')}</button>
                <button data-testid="workspace-bulk-delete-permanently" className="btn btn-ghost h-8 text-xs text-red-400" onClick={() => setPendingPermanentDeleteIds([...selected])}><Icon name="trash" size={13} /> {t('Eliminar definitivamente')}</button>
              </> : <>
                <input ref={bulkTagRef} data-testid="workspace-bulk-tag-input" className="input h-8 w-36 text-xs" value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void applyBulkTag(); }} placeholder={t('Etiqueta…')} />
                <button data-testid="workspace-bulk-tag" className="btn btn-ghost h-8 text-xs" disabled={!bulkTag.trim()} onClick={() => void applyBulkTag()}><Icon name="tag" size={13} /> {t('Etiquetar')}</button>
                <select data-testid="workspace-bulk-collection" aria-label={t('Mover a colección')} className="input h-8 min-w-40 text-xs" value={bulkCollection} onChange={(event) => setBulkCollection(event.target.value)}>
                  <option value="">{t('Sin colección')}</option>
                  {tree.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <button data-testid="workspace-bulk-move" className="btn btn-ghost h-8 text-xs" onClick={() => void moveSelected()}><Icon name="folder" size={13} /> {t('Mover')}</button>
                <button data-testid="workspace-bulk-trash" className="btn btn-ghost h-8 text-xs text-red-400" onClick={() => void moveToTrash([...selected])}><Icon name="trash" size={13} /> {t('Enviar a la papelera')}</button>
              </>}
              <button className="ml-auto text-neutral-500 hover:text-neutral-200" onClick={() => setSelected(new Set())}>{t('Limpiar selección')}</button>
            </div>
          )}

          <div ref={listRef} data-testid="workspace-item-list" className="library-catalog-scroll min-h-0 flex-1 overflow-y-auto">
            {catalogView === 'cards' && scope.kind !== 'trash' && <><h2 className="editorial-catalog-subtitle">{t('Recientes')}</h2><EditorialCards items={visible.slice(0,3).map(note => ({ id: note.id, title: note.title, snippet: plainSnippet(note.content), collection: tree.folders.find(folder => folder.id === note.folderId)?.name }))} onOpen={openNote} /><h2 className="editorial-catalog-subtitle">{t('Otros documentos')}</h2></>}
          <div data-testid="workspace-table-header" className="grid h-9 shrink-0 grid-cols-[28px_22px_minmax(0,1fr)_minmax(120px,0.45fr)_72px] items-center border-b border-neutral-800 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <input
              data-testid="workspace-select-all"
              type="checkbox"
              checked={visible.length > 0 && visible.every((note) => selected.has(note.id))}
              onChange={(event) => setSelected((current) => {
                const next = new Set(current);
                for (const note of visible) { if (event.target.checked) next.add(note.id); else next.delete(note.id); }
                return next;
              })}
              aria-label={t('Seleccionar todos los elementos visibles')}
            />
            <span />
            <span>{t('Título / Colección')}</span>
            <span>{t('Etiquetas')}</span>
            <span className="text-right">{t('Modificado')}</span>
          </div>

            {loading && <p className="px-4 py-6 text-xs text-neutral-500"><Spinner /> {t('Cargando…')}</p>}
            {!loading && visible.length === 0 && (
              <p className="px-4 py-6 text-xs leading-5 text-neutral-500">
                {scope.kind === 'trash' ? t('La papelera está vacía.') : (search || selectedTags.length ? t('Ningún elemento coincide.') : t('Todavía no hay nada aquí. Crea una nota o una idea para empezar.'))}
              </p>
            )}
            {(catalogView === 'cards' && scope.kind !== 'trash' ? visible.slice(3) : visible).map((note) => {
              const kind = itemKind(note);
              const linkCount = links.filter((link) => link.ownerKind === 'note' && link.ownerId === note.id).length;
              const studyLinksOfNote = studyLinkCounts.get(note.id) ?? [];
              return (
                <EditorialCatalogRow data-selected={selected.has(note.id)}
                  key={note.id}
                  data-testid={`workspace-item-${note.id}`}
                  data-anchor-id={note.id}
                  draggable={scope.kind !== 'trash'}
                  onDragStart={(event) => {
                    if (scope.kind === 'trash') return;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-nodus-workspace-note', note.id);
                  }}
                  className={`grid min-h-[62px] w-full grid-cols-[28px_22px_minmax(0,1fr)_minmax(120px,0.45fr)_72px] items-center border-b border-neutral-900 px-4 text-left text-xs hover:bg-neutral-900/60 ${selected.has(note.id) ? 'bg-indigo-500/10' : openIds.includes(note.id) ? 'bg-neutral-900/40' : ''}`}
                  onClick={(event) => { if ((event.target as HTMLElement).closest('input,button')) return; if (scope.kind === 'trash') toggleSelected(note.id); else openNote(note.id); }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setItemContextMenu({ noteId: note.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 250)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 340)) });
                  }}
                >
                  <input type="checkbox" checked={selected.has(note.id)} onChange={(event) => toggleSelected(note.id, event.target.checked)} onClick={(event) => event.stopPropagation()} aria-label={tx('Seleccionar {name}', { name: note.title })} />
                  <Icon name={KIND_ICON[kind]} size={14} className={`mt-0.5 shrink-0 ${kind === 'idea' ? 'text-amber-400' : 'text-neutral-500'}`} />
                  <span className="min-w-0 flex-1">
                    <button className="block w-full truncate text-left text-sm" aria-label={tx('Abrir {name}', { name: note.title })} onClick={event => { event.stopPropagation(); if (scope.kind === 'trash') toggleSelected(note.id); else void openNote(note.id); }}>{note.title}</button><small className="text-[10px] text-neutral-500">{tree.folders.find(folder => folder.id === note.folderId)?.name ?? t('Sin colección')}</small>
                    <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{plainSnippet(note.content) || t('Sin contenido')}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1 pr-2">
                    {note.tags.slice(0, 3).map((tag) => <span key={tag} className="max-w-28 truncate rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{tag}</span>)}
                    {note.tags.length > 3 && <span className="text-[10px] text-neutral-600">+{note.tags.length - 3}</span>}
                    {linkCount > 0 && <span className="flex items-center gap-1 text-[10px] text-neutral-600" title={tx('{n} elemento(s) de biblioteca enlazado(s)', { n: linkCount })}><Icon name="link" size={10} />{linkCount}</span>}
                    {studyLinksOfNote.length > 0 && <span data-testid={`workspace-item-study-links-${note.id}`} className="flex items-center gap-1 text-[10px] text-indigo-400/80" title={[tx('Vinculada en {n} sitio(s)', { n: studyLinksOfNote.length }), ...studyLinksOfNote.map((link) => studyNoteLinkLabel(link, studyOrganization))].filter(Boolean).join('\n')}><Icon name="graduation" size={10} />{studyLinksOfNote.length}</span>}
                  </span>
                  <span className="shrink-0 text-right text-[10px] tabular-nums text-neutral-600">{formatRelative(note.trashedAt ?? note.updatedAt)}<span className="editorial-row-actions"><button aria-label={t('Opciones del documento')} onClick={event => { event.stopPropagation(); setItemContextMenu({ noteId: note.id, x: Math.min(event.clientX,window.innerWidth-250), y: Math.min(event.clientY,window.innerHeight-340) }); }}>···</button></span></span>
                </EditorialCatalogRow>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <div className="library-theme editorial-workspace relative flex h-full min-h-0 flex-col">
      {!active && <div className="editorial-editor-header"><button className="editorial-header-action" disabled aria-label={t('Navegador de documentos')}><Icon name="list" size={14} /></button><div className="editorial-header-leading">{workspaceTabs}</div></div>}

      <div className={`min-h-0 flex-1 overflow-hidden ${active ? 'hidden' : ''}`} aria-hidden={active ? true : undefined}>
        {browser}
      </div>
      {editorPane}

      {itemContextMenu && contextNote && (
        <div
          data-testid="workspace-context-menu"
          role="menu"
          className="library-action-menu fixed z-50 w-60 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
        >
          {contextNote.trashedAt ? <>
            <button role="menuitem" className="library-action-menu-item" onClick={() => void restoreItems([contextNote.id])}><Icon name="refresh" /><span><b>{t('Restaurar')}</b><small>{t('Devuelve el elemento al espacio de trabajo')}</small></span></button>
            <button role="menuitem" className="library-action-menu-item text-red-400" onClick={() => { setPendingPermanentDeleteIds([contextNote.id]); setItemContextMenu(null); }}><Icon name="trash" /><span><b>{t('Eliminar definitivamente')}</b><small>{t('Esta acción no se puede deshacer')}</small></span></button>
          </> : <>
            <button role="menuitem" className="library-action-menu-item" onClick={() => { openNote(contextNote.id); setItemContextMenu(null); }}><Icon name="external" /><span><b>{t('Abrir en una pestaña')}</b><small>{t(itemKind(contextNote) === 'idea' ? 'Idea' : 'Nota')}</small></span></button>
            <button role="menuitem" className="library-action-menu-item" onClick={() => { toggleSelected(contextNote.id); setItemContextMenu(null); }}><Icon name="check" /><span><b>{selected.has(contextNote.id) ? t('Quitar de la selección') : t('Seleccionar')}</b></span></button>
            <button role="menuitem" className="library-action-menu-item" onClick={() => { setSelected((current) => new Set([...current, contextNote.id])); setItemContextMenu(null); window.setTimeout(() => bulkTagRef.current?.focus(), 0); }}><Icon name="tag" /><span><b>{t('Etiquetar…')}</b><small>{t('Añade una etiqueta desde la barra de acciones')}</small></span></button>
            <button role="menuitem" className="library-action-menu-item" onClick={() => { setSelected(new Set([contextNote.id])); setItemContextMenu(null); }}><Icon name="folder" /><span><b>{t('Mover a colección…')}</b><small>{t('Elige el destino en la barra de acciones')}</small></span></button>
            <button role="menuitem" className="library-action-menu-item" onClick={() => { setItemContextMenu(null); void duplicateNote(contextNote); }}><Icon name="copy" /><span><b>{t('Duplicar')}</b></span></button>
            <button role="menuitem" className="library-action-menu-item" onClick={() => { void navigator.clipboard.writeText(contextNote.title); setItemContextMenu(null); }}><Icon name="copy" /><span><b>{t('Copiar título')}</b></span></button>
            {studyLinks && <button role="menuitem" data-testid="workspace-context-study-link" className="library-action-menu-item" onClick={() => { setLinkingNote(contextNote); setItemContextMenu(null); }}><Icon name="graduation" /><span><b>{t('Vincular con cursos y materiales…')}</b><small>{t('Cursos, asignaturas, temas o materiales')}</small></span></button>}
            <button role="menuitem" className="library-action-menu-item text-red-400" onClick={() => { setPendingNoteDelete(contextNote); setItemContextMenu(null); }}><Icon name="trash" /><span><b>{t('Enviar a la papelera')}</b></span></button>
          </>}
        </div>
      )}

      {creatingCollection && (
        <TextInputModal
          title={t('Nueva colección')}
          label={t('Nombre')}
          initialValue=""
          submitLabel={t('Crear')}
          onCancel={() => setCreatingCollection(false)}
          onSubmit={async (name) => {
            const created = await window.nodus.createNoteFolder({ name, parentId: targetCollectionId() });
            setCreatingCollection(false);
            await refresh();
            setScope({ kind: 'collection', id: created.id });
          }}
        />
      )}
      {renaming && (
        <TextInputModal
          title={t('Renombrar colección')}
          label={t('Nombre')}
          initialValue={renaming.name}
          submitLabel={t('Guardar')}
          onCancel={() => setRenaming(null)}
          onSubmit={async (name) => {
            await window.nodus.renameNoteFolder(renaming.id, name);
            setRenaming(null);
            await refresh();
          }}
        />
      )}
      {pendingCollectionDelete && (
        <ConfirmModal
          title={t('Eliminar colección')}
          message={tx('Se eliminará «{name}» con sus subcolecciones. Sus {n} nota(s) e idea(s) se moverán a la papelera.', {
            name: pendingCollectionDelete.name,
            n: counts.get(pendingCollectionDelete.id) ?? 0,
          })}
          confirmLabel={t('Mover a la papelera')}
          danger
          onCancel={() => setPendingCollectionDelete(null)}
          onConfirm={async () => {
            const removed = subtreeIds(pendingCollectionDelete.id, children);
            const trashedIds = await window.nodus.trashNoteFolder(pendingCollectionDelete.id);
            setPendingCollectionDelete(null);
            await refresh();
            closeNotes(trashedIds);
            if (scope.kind === 'collection' && removed.has(scope.id)) setScope({ kind: 'all' });
          }}
        />
      )}
      {linkingNote && <StudyNoteLinkDialog noteId={linkingNote.id} noteTitle={linkingNote.title} onClose={() => setLinkingNote(null)} onChanged={() => void refreshStudyLinks()} />}
      {pendingNoteDelete && (
        <ConfirmModal
          title={t('Enviar a la papelera')}
          message={tx('«{name}» se moverá a la papelera y podrá restaurarse más adelante.', { name: pendingNoteDelete.title })}
          confirmLabel={t('Mover a la papelera')}
          danger
          onCancel={() => setPendingNoteDelete(null)}
          onConfirm={async () => {
            await moveToTrash([pendingNoteDelete.id]);
          }}
        />
      )}
      {pendingPermanentDeleteIds && (
        <ConfirmModal
          title={t('Eliminar definitivamente')}
          message={tx('Se eliminarán definitivamente {n} elemento(s), junto con su historial y sus comentarios. Esta acción no se puede deshacer.', { n: pendingPermanentDeleteIds.length })}
          confirmLabel={t('Eliminar definitivamente')}
          danger
          onCancel={() => setPendingPermanentDeleteIds(null)}
          onConfirm={async () => permanentlyDelete(pendingPermanentDeleteIds)}
        />
      )}
    </div>
  );
}
