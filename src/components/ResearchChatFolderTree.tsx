import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { ChatConversationSummary, ResearchChatProjectFolder } from '@shared/types';
import { UNFILED_FOLDER, canNestFolder, folderChildren, type ChatFolderSelection } from '@shared/researchChatFolders';
import { ConfirmModal } from './ConfirmModal';
import { FloatingMenu, MenuItem, RenameField } from './ResearchChatHistoryMenu';
import { MarqueeText } from './MarqueeText';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/*
 * The folder tree under a research chat project in the history:
 *   · a chat dropped on a folder is filed there (and joins the folder's project);
 *   · a folder dropped on a folder nests inside it;
 *   · dropped anywhere else in the project (its row, "No folder", the free space), a chat
 *     leaves its folder and a folder goes back to the project's root.
 */

/** A refusal from the main process, in the reader's language when it is one of ours. */
export function historyError(message: string): string {
  if (message.includes('research_chat_pin_limit')) return tx('Solo puedes destacar {n} chats. Quita uno para destacar otro.', { n: 5 });
  if (message.includes('research_chat_folder_cycle')) return t('Una carpeta no puede ir dentro de sí misma ni de sus subcarpetas.');
  if (message.includes('research_chat_folder_wrong_project')) return t('Una carpeta solo puede moverse dentro de su proyecto.');
  if (message.includes('research_chat_folder_not_found')) return t('Esa carpeta ya no existe.');
  return message;
}

/** The selected folder and expanded folders in the history. */
export interface ChatFolderTreeState {
  selection: ChatFolderSelection | null;
  select: (selection: ChatFolderSelection | null) => void;
  expanded: ReadonlySet<string>;
  toggle: (folderId: string) => void;
  expand: (folderId: string) => void;
}

export function useChatFolderTreeState(): ChatFolderTreeState {
  const [selection, select] = useState<ChatFolderSelection | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((folderId: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return next;
  }), []);
  const expand = useCallback((folderId: string) => setExpanded(current => current.has(folderId) ? current : new Set([...current, folderId])), []);
  return useMemo(() => ({ selection, select, expanded, toggle, expand }), [selection, expanded, toggle, expand]);
}

/** What the tree may change. Every call may reject; the caller shows why. */
export interface ChatFolderActions {
  folders: ResearchChatProjectFolder[];
  onCreateFolder: (projectId: string, parentId: string | null) => Promise<ResearchChatProjectFolder | null>;
  onRenameFolder: (folder: ResearchChatProjectFolder, name: string) => Promise<void>;
  onMoveFolder: (folder: ResearchChatProjectFolder, parentId: string | null, index?: number) => Promise<void>;
  onDeleteFolder: (folder: ResearchChatProjectFolder) => Promise<void>;
  /** A folder files the chat (and moves it to the folder's project); null unfiles it. */
  onFileConversation: (conversation: ChatConversationSummary, folderId: string | null) => Promise<void>;
  onMoveConversation: (conversation: ChatConversationSummary, projectId: string | null) => Promise<void>;
}

export type FolderTreeRow =
  | { kind: 'root'; projectId: string; count: number }
  | { kind: 'folder'; folder: ResearchChatProjectFolder; depth: number; count: number; hasChildren: boolean; expanded: boolean }
  | { kind: 'unfiled'; projectId: string; count: number };

// ── Dragging ────────────────────────────────────────────────────────────────
// What is being dragged lives here, not in dataTransfer: a dragover cannot read the
// payload, and both places are in one window.
type Dragged = { kind: 'chat'; conversation: ChatConversationSummary } | { kind: 'folder'; folder: ResearchChatProjectFolder };
let dragged: Dragged | null = null;
const DRAG_TYPE = 'application/x-nodus-research-chat';

function beginDrag(event: DragEvent, item: Dragged, label: string) {
  dragged = item;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(DRAG_TYPE, item.kind);
  event.dataTransfer.setData('text/plain', label);
}
const endDrag = () => { dragged = null; };

/** Drag handlers for a chat row, in the history or on the project's page. */
export function chatDragProps(conversation: ChatConversationSummary) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => beginDrag(event, { kind: 'chat', conversation }, conversation.title),
    onDragEnd: endDrag,
  };
}

type Zone = 'before' | 'inside' | 'after';

/** Drop feedback also clears when a drag is cancelled without leaving the row. */
export function useHistoryDropHint<T>() {
  const [hint, setHint] = useState<T | null>(null);
  useEffect(() => {
    if (hint === null) return;
    const clear = () => setHint(null);
    document.addEventListener('dragend', clear, true);
    document.addEventListener('drop', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('dragend', clear, true);
      document.removeEventListener('drop', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, [hint]);
  return [hint, setHint] as const;
}

function siblingsIndex(folders: ResearchChatProjectFolder[], moving: ResearchChatProjectFolder, target: ResearchChatProjectFolder, zone: Zone): number {
  const siblings = (folderChildren(folders, target.projectId).get(target.parentId) ?? []).filter(folder => folder.id !== moving.id);
  return siblings.findIndex(folder => folder.id === target.id) + (zone === 'after' ? 1 : 0);
}

/** Whether the current drag may land on `target` in `zone`. */
function acceptsOnFolder(folders: ResearchChatProjectFolder[], target: ResearchChatProjectFolder, zone: Zone): boolean {
  if (!dragged) return false;
  if (dragged.kind === 'chat') return dragged.conversation.folderId !== target.id;
  const moving = dragged.folder;
  if (moving.id === target.id) return false;
  return canNestFolder(folders, moving, zone === 'inside' ? target.id : target.parentId);
}

/** Whether the current drag may land outside every folder of `projectId` (any project when null). */
function acceptsOutside(projectId: string | null): boolean {
  if (!dragged) return false;
  if (dragged.kind === 'chat') {
    const { conversation } = dragged;
    return (!!projectId && conversation.projectId !== projectId) || !!conversation.folderId;
  }
  return (!projectId || dragged.folder.projectId === projectId) && !!dragged.folder.parentId;
}

async function dropOutside(actions: ChatFolderActions, item: Dragged, projectId: string | null): Promise<void> {
  if (item.kind === 'chat') {
    if (projectId && item.conversation.projectId !== projectId) await actions.onMoveConversation(item.conversation, projectId);
    else if (item.conversation.folderId) await actions.onFileConversation(item.conversation, null);
  } else if (item.folder.parentId) await actions.onMoveFolder(item.folder, null);
}

/**
 * The free space of a project, or of the whole history: whatever is not a folder. A drop
 * there takes a chat out of its folder and a folder back to its project's root; on a
 * project's own row (projectId given) a chat from elsewhere joins that project.
 */
export function outsideDropProps(actions: ChatFolderActions, run: (action: () => Promise<unknown>) => void, projectId: string | null = null, onHover?: (active: boolean) => void) {
  const hover = (event: DragEvent) => {
    if (!dragged || !acceptsOutside(projectId)) { onHover?.(false); return; }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    onHover?.(true);
  };
  return {
    onDragEnter: hover,
    onDragOver: hover,
    onDragLeave: (event: DragEvent) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) onHover?.(false);
    },
    onDrop: (event: DragEvent) => {
      onHover?.(false);
      const item = dragged;
      if (!item || !acceptsOutside(projectId)) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = null;
      run(() => dropOutside(actions, item, projectId));
    },
  };
}

function useFolderDrop(folder: ResearchChatProjectFolder, actions: ChatFolderActions, run: (action: () => Promise<unknown>) => void, expand: (id: string) => void, contentsInline = false) {
  const [hint, setHint] = useHistoryDropHint<Zone>();
  const zoneOf = (event: DragEvent): Zone => {
    // Alphabetical inline trees support nesting, not manual sibling reordering.
    if (contentsInline || dragged?.kind !== 'folder') return 'inside';
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (event.clientY - box.top) / Math.max(1, box.height);
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
  };
  const hover = (event: DragEvent) => {
    if (!dragged) return;
    // A folder answers for itself: a refused drop must not fall through to the free
    // space behind it, which would move the folder to the root instead.
    event.stopPropagation();
    const zone = zoneOf(event);
    if (!acceptsOnFolder(actions.folders, folder, zone)) { setHint(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setHint(zone);
  };
  return {
    hint,
    onDragEnter: hover,
    onDragOver: hover,
    onDragLeave: (event: DragEvent) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setHint(null);
    },
    onDrop: (event: DragEvent) => {
      event.stopPropagation();
      setHint(null);
      const item = dragged;
      if (!item) return;
      const zone = zoneOf(event);
      if (!acceptsOnFolder(actions.folders, folder, zone)) return;
      event.preventDefault();
      dragged = null;
      if (item.kind === 'chat') { run(() => actions.onFileConversation(item.conversation, folder.id)); return; }
      if (zone === 'inside') { expand(folder.id); run(() => actions.onMoveFolder(item.folder, folder.id)); return; }
      run(() => actions.onMoveFolder(item.folder, folder.parentId, siblingsIndex(actions.folders, item.folder, folder, zone)));
    },
  };
}

// ── Per-place interface: renaming, the ⋯ menu and the delete confirmation ──────

export interface FolderTreeUi {
  renaming: string | null;
  setRenaming: (folderId: string | null) => void;
  menuFolderId: string | null;
  openMenu: (folder: ResearchChatProjectFolder, anchor: DOMRect) => void;
  /** Create a folder and name it in place. */
  create: (projectId: string, parentId: string | null) => void;
  overlays: ReactNode;
}

/** Each place keeps its own rename field and menu; the tree's selection is shared. */
export function useFolderTreeUi(actions: ChatFolderActions, tree: ChatFolderTreeState, run: (action: () => Promise<unknown>) => void): FolderTreeUi {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ folder: ResearchChatProjectFolder; anchor: DOMRect } | null>(null);
  const [deleting, setDeleting] = useState<ResearchChatProjectFolder | null>(null);
  const create = (projectId: string, parentId: string | null) => run(async () => {
    const created = await actions.onCreateFolder(projectId, parentId);
    if (!created) return;
    if (parentId) tree.expand(parentId);
    setRenaming(created.id);
  });
  const overlays = <>
    {menu && <FloatingMenu anchor={menu.anchor} label={menu.folder.name} onClose={() => setMenu(null)}>
      <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { setMenu(null); setRenaming(menu.folder.id); }} />
      <MenuItem icon="folderPlus" label={t('Nueva subcarpeta')} onSelect={() => { setMenu(null); create(menu.folder.projectId, menu.folder.id); }} />
      {menu.folder.parentId && <MenuItem icon="arrowLeft" label={t('Sacar a la raíz del proyecto')} onSelect={() => { const { folder } = menu; setMenu(null); run(() => actions.onMoveFolder(folder, null)); }} />}
      <hr className="research-history-menu-separator" />
      <MenuItem icon="trash" danger label={t('Eliminar carpeta')} onSelect={() => { setMenu(null); setDeleting(menu.folder); }} />
    </FloatingMenu>}
    {deleting && <ConfirmModal
      title={t('Eliminar carpeta')}
      message={tx('Se eliminará «{name}» con sus subcarpetas. Sus chats no se borran: quedan en el proyecto, sin carpeta.', { name: deleting.name })}
      confirmLabel={t('Eliminar')}
      danger
      onConfirm={() => {
        const folder = deleting;
        setDeleting(null);
        if (tree.selection?.folderId === folder.id) tree.select({ projectId: folder.projectId, folderId: null });
        run(() => actions.onDeleteFolder(folder));
      }}
      onCancel={() => setDeleting(null)}
    />}
  </>;
  return { renaming, setRenaming, menuFolderId: menu?.folder.id ?? null, openMenu: (folder, anchor) => setMenu({ folder, anchor }), create, overlays };
}

// ── The row ─────────────────────────────────────────────────────────────────

const INDENT = 14;

/** One row of a project's tree: the project's root, a folder, or "No folder". */
export function FolderTreeRowView({ row, tree, ui, actions, run, baseIndent = 10, rootLabel, contentsInline = false }: {
  row: FolderTreeRow;
  tree: ChatFolderTreeState;
  ui: FolderTreeUi;
  actions: ChatFolderActions;
  run: (action: () => Promise<unknown>) => void;
  /** Left padding of a top-level folder, so the tree lines up with its surroundings. */
  baseIndent?: number;
  rootLabel?: string;
  /** The sidebar expands folders to reveal their own chats as well as subfolders. */
  contentsInline?: boolean;
}) {
  const [outsideHint, setOutsideHint] = useHistoryDropHint<boolean>();
  if (row.kind !== 'folder') {
    const folderId = row.kind === 'unfiled' ? UNFILED_FOLDER : null;
    const selected = tree.selection?.projectId === row.projectId && tree.selection.folderId === folderId;
    const label = row.kind === 'unfiled' ? t('Sin carpeta') : rootLabel ?? t('Todos los chats');
    return <div className={`research-history-row research-folder-row ${selected ? 'is-active' : ''} ${outsideHint ? 'is-drop-inside' : ''}`} style={{ paddingLeft: baseIndent }} data-marquee-host
      data-testid={row.kind === 'unfiled' ? `research-folder-unfiled-${row.projectId}` : `research-folder-root-${row.projectId}`}
      {...outsideDropProps(actions, run, row.projectId, active => setOutsideHint(active ? true : null))}>
      <span className="research-folder-toggle" aria-hidden="true" />
      <button type="button" className="research-history-main" aria-pressed={selected} title={tx('{n} chat(s)', { n: row.count })}
        onClick={() => tree.select(selected && row.kind === 'unfiled' ? { projectId: row.projectId, folderId: null } : { projectId: row.projectId, folderId })}>
        <span className="shrink-0 text-neutral-500"><Icon name={row.kind === 'unfiled' ? 'inbox' : 'layers'} size={15} /></span>
        <MarqueeText text={label} className="min-w-0 flex-1" />
      </button>
      <span className="research-folder-count">{row.count}</span>
      {/* Where a folder has its ⋯, so every count lines up. */}
      <span className="research-folder-actions-spacer" aria-hidden="true" />
    </div>;
  }
  return <FolderRow row={row} tree={tree} ui={ui} actions={actions} run={run} baseIndent={baseIndent} contentsInline={contentsInline} />;
}

function FolderRow({ row, tree, ui, actions, run, baseIndent, contentsInline }: {
  row: Extract<FolderTreeRow, { kind: 'folder' }>; tree: ChatFolderTreeState; ui: FolderTreeUi; actions: ChatFolderActions;
  run: (action: () => Promise<unknown>) => void; baseIndent: number; contentsInline: boolean;
}) {
  const { folder } = row;
  const drop = useFolderDrop(folder, actions, run, tree.expand, contentsInline);
  const selected = tree.selection?.folderId === folder.id;
  const renaming = ui.renaming === folder.id;
  const select = () => {
    if (contentsInline) {
      tree.select({ projectId: folder.projectId, folderId: folder.id });
      tree.toggle(folder.id);
    } else tree.select(selected ? { projectId: folder.projectId, folderId: null } : { projectId: folder.projectId, folderId: folder.id });
  };
  return <div className={`research-history-row research-folder-row group ${selected ? 'is-active' : ''} ${ui.menuFolderId === folder.id ? 'is-menu-open' : ''} ${drop.hint ? `is-drop-${drop.hint}` : ''}`}
    style={{ paddingLeft: baseIndent + row.depth * INDENT }} data-marquee-host data-testid={`research-folder-${folder.id}`}
    draggable={!renaming} onDragStart={event => beginDrag(event, { kind: 'folder', folder }, folder.name)} onDragEnd={endDrag}
    onDragEnter={drop.onDragEnter} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
    <button type="button" className={`research-folder-toggle ${row.expanded ? 'is-open' : ''}`} tabIndex={row.hasChildren ? 0 : -1}
      aria-label={row.expanded ? tx('Contraer {name}', { name: folder.name }) : tx('Desplegar {name}', { name: folder.name })} aria-expanded={row.hasChildren ? row.expanded : undefined}
      style={row.hasChildren ? undefined : { visibility: 'hidden' }} onClick={() => tree.toggle(folder.id)}><Icon name="chevronRight" size={12} /></button>
    {renaming
      ? <><span className="shrink-0 text-neutral-500"><Icon name="folder" size={15} /></span>
        <RenameField value={folder.name} onDone={name => {
          ui.setRenaming(null);
          if (name === null) return;
          // An emptied name is not a refusal: the folder takes the default one.
          const next = name || t('Nueva carpeta');
          if (next !== folder.name) run(() => actions.onRenameFolder(folder, next));
        }} /></>
      : <button type="button" className="research-history-main" aria-pressed={selected} title={tx('{n} chat(s)', { n: row.count })}
        aria-expanded={contentsInline && row.hasChildren ? row.expanded : undefined} onClick={select} onDoubleClick={() => { tree.select({ projectId: folder.projectId, folderId: folder.id }); ui.setRenaming(folder.id); }}>
        <span className="shrink-0 text-neutral-500"><Icon name="folder" size={15} /></span>
        <MarqueeText text={folder.name} className="min-w-0 flex-1" />
      </button>}
    {!renaming && <span className="research-folder-count">{row.count}</span>}
    <span className="research-history-row-actions">
      <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
        onClick={event => { event.stopPropagation(); ui.openMenu(folder, event.currentTarget.getBoundingClientRect()); }}><Icon name="moreVertical" size={14} /></button>
    </span>
  </div>;
}
