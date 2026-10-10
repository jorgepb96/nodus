import { isPhoneSurface } from '../mobileWeb/phoneLayout';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatConversationSummary, ResearchChatProject } from '@shared/types';
import type { ChatHistoryNotebookEntry } from '../views/researchChatAdapter';
import { VirtualList } from './VirtualList';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';
import { useDismissableLayer } from '../hooks';
import { t, tx } from '../i18n';
import { FloatingMenu, MenuItem, RenameField } from './ResearchChatHistoryMenu';
import { FolderTreeRowView, chatDragProps, historyError, outsideDropProps, useFolderTreeUi, type ChatFolderActions, type ChatFolderTreeState, type FolderTreeRow } from './ResearchChatFolderTree';
import { MarqueeText } from './MarqueeText';
import { conversationsInSelection, folderOutline, projectFolderHistoryRows, UNFILED_FOLDER } from '@shared/researchChatFolders';

/** The colours a project can take, plus any custom one. */
export const PROJECT_COLORS = ['#171717', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
/** Icons a project can take. Every name exists in the shared icon set. */
export const PROJECT_ICONS = [
  'folder', 'book', 'bookOpen', 'notebook', 'library', 'bookmark', 'graduation', 'quote', 'edit', 'highlighter',
  'code', 'tools', 'palette', 'image', 'video', 'audio', 'microphone', 'presentation', 'chartBar', 'table',
  'calendar', 'clock', 'flask', 'telescope', 'bulb', 'target', 'compass', 'globe', 'map', 'mapPin',
  'scale', 'network', 'tree', 'users', 'user', 'building', 'home', 'flag', 'star', 'sparkles',
  'archive', 'tag', 'mail', 'chat', 'shield', 'key', 'puzzle', 'cube', 'layers', 'sun',
  'moon', 'bell', 'anchor', 'truck', 'languages', 'rss', 'bug', 'plug', 'inbox', 'ruler',
];

/** How the history names its notebook-equivalent: Research Chat's notebooks, or Study's courses. */
function notebookLabels(courses: boolean) {
  return courses
    ? { heading: t('Cursos'), newChat: t('Nuevo chat en el curso'), search: t('Buscar chats, proyectos, cursos…'), icon: 'graduation' }
    : { heading: t('Cuadernos'), newChat: t('Nuevo chat en el cuaderno'), search: t('Buscar chats, proyectos, cuadernos…'), icon: 'notebook' };
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return t('ahora');
  if (minutes < 60) return tx('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return tx('hace {n} d', { n: days });
  return new Date(iso).toLocaleDateString();
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

type Row =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'project'; project: ResearchChatProject; expanded: boolean; count: number }
  | { kind: 'chat'; conversation: ChatConversationSummary; nested: boolean; depth?: number }
  | { kind: 'notebook'; notebook: ChatHistoryNotebookEntry; expanded: boolean; count: number }
  | { kind: 'folder'; row: FolderTreeRow }
  | { kind: 'empty'; id: string; label: string };

export interface ResearchChatSidebarProps {
  conversations: ChatConversationSummary[];
  projects: ResearchChatProject[];
  /** Research Chat's notebooks, or the surface's equivalent (Study's courses). */
  notebooks: ChatHistoryNotebookEntry[];
  /** Projects and pins exist only where the transport stores them. */
  supportsProjects: boolean;
  notebooksOn: boolean;
  /** What the notebook-equivalent is called; notebooks by default. */
  notebookKind?: 'notebook' | 'course';
  /** Research Chat's notebooks, whose sources are collections, rather than a surface's own. */
  notebookCollections?: boolean;
  /** A notebook's chat stays out of projects (Research Chat's rule); a course's may move. */
  notebookLocksMoves?: boolean;
  activeId: string | null;
  activeProjectId: string | null;
  sending: boolean;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  onNewConversation: () => void;
  onNewNotebook?: () => void;
  onNewProject: () => Promise<ResearchChatProject | null>;
  onOpenConversation: (id: string) => void;
  onOpenProject: (id: string) => void;
  activeNotebookId: string | null;
  onOpenNotebook: (id: string) => void;
  onEditNotebook?: (notebook: ChatHistoryNotebookEntry) => void;
  onUpdateNotebook?: (notebook: ChatHistoryNotebookEntry, patch: { name?: string; icon?: string | null; color?: string | null }) => Promise<void>;
  onDeleteNotebook?: (notebook: ChatHistoryNotebookEntry) => Promise<void>;
  onRenameConversation?: (conversation: ChatConversationSummary, title: string) => Promise<void>;
  onPinConversation: (conversation: ChatConversationSummary, pinned: boolean) => Promise<void>;
  onArchiveConversation?: (conversation: ChatConversationSummary) => Promise<void>;
  onDeleteConversation: (conversation: ChatConversationSummary) => void;
  onMoveConversation: (conversation: ChatConversationSummary, projectId: string | null) => Promise<void>;
  onEditProjectInstructions: (project: ResearchChatProject) => void;
  onUpdateProject: (project: ResearchChatProject, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }) => Promise<void>;
  onDeleteProject: (project: ResearchChatProject) => Promise<void>;
  /** The projects' folder trees: the same state and actions as the project's page. */
  folderTree: ChatFolderTreeState;
  folderActions: ChatFolderActions;
}

/** The research chat history: tools, search, then Projects, Notebooks, Pinned and the other chats. */
export function ResearchChatSidebar(props: ResearchChatSidebarProps) {
  const { conversations, projects, notebooks, supportsProjects, notebooksOn, activeId, activeProjectId, activeNotebookId, sending } = props;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  // A chat's menu remembers which of its rows opened it: a pinned chat inside an open
  // project shows twice, and only that row may turn into a rename field.
  const [menu, setMenu] = useState<{ kind: 'chat'; conversation: ChatConversationSummary; row: string; anchor: DOMRect } | { kind: 'project'; project: ResearchChatProject; anchor: DOMRect } | { kind: 'notebook'; notebook: ChatHistoryNotebookEntry; anchor: DOMRect } | null>(null);
  const [styling, setStyling] = useState<{ kind: 'project' | 'notebook'; id: string } | null>(null);
  const [deletingProject, setDeletingProject] = useState<ResearchChatProject | null>(null);
  const [deletingNotebook, setDeletingNotebook] = useState<ChatHistoryNotebookEntry | null>(null);
  const courses = props.notebookKind === 'course';
  const labels = notebookLabels(courses);
  const locksMoves = props.notebookLocksMoves ?? true;
  const notebookMenu = !!(props.onUpdateNotebook || props.onEditNotebook || props.onDeleteNotebook);
  const [notice, setNotice] = useState<string | null>(null);
  const { folderTree, folderActions } = props;
  const folders = folderActions.folders;
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const notebookById = useMemo(() => new Map((notebooksOn ? notebooks : []).map(notebook => [notebook.id, notebook])), [notebooks, notebooksOn]);
  // A chat that reads a notebook lives in it, like a project's chats in their project.
  const inNotebook = (conversation: ChatConversationSummary) => !!conversation.notebookId && notebookById.has(conversation.notebookId);

  const rows = useMemo<Row[]>(() => {
    const needle = fold(query.trim());
    if (needle) {
      const out: Row[] = [];
      const matchedProjects = supportsProjects ? projects.filter(project => fold(project.name).includes(needle)) : [];
      const matchedNotebooks = notebooksOn ? notebooks.filter(notebook => fold(`${notebook.name} ${notebook.keywords ?? ''}`).includes(needle)) : [];
      const matchedChats = conversations.filter(conversation => fold(conversation.title).includes(needle)
        || (conversation.projectId && fold(projectById.get(conversation.projectId)?.name ?? '').includes(needle))
        || (conversation.notebookId && fold(`${notebookById.get(conversation.notebookId)?.name ?? ''} ${notebookById.get(conversation.notebookId)?.keywords ?? ''}`).includes(needle)));
      if (matchedProjects.length) out.push({ kind: 'header', id: 'h-projects', label: t('Proyectos') }, ...matchedProjects.map(project => ({ kind: 'project' as const, project, expanded: false, count: 0 })));
      if (matchedNotebooks.length) out.push({ kind: 'header', id: 'h-notebooks', label: labels.heading }, ...matchedNotebooks.map(notebook => ({ kind: 'notebook' as const, notebook, expanded: false, count: 0 })));
      if (matchedChats.length) out.push({ kind: 'header', id: 'h-chats', label: t('Chats') }, ...matchedChats.map(conversation => ({ kind: 'chat' as const, conversation, nested: false })));
      if (!out.length) out.push({ kind: 'empty', id: 'no-results', label: t('Sin resultados') });
      return out;
    }
    const out: Row[] = [];
    const inProject = new Map<string, ChatConversationSummary[]>();
    if (supportsProjects) for (const conversation of conversations) if (conversation.projectId && projectById.has(conversation.projectId)) {
      inProject.set(conversation.projectId, [...(inProject.get(conversation.projectId) ?? []), conversation]);
    }
    if (supportsProjects && projects.length) {
      out.push({ kind: 'header', id: 'h-projects', label: t('Proyectos') });
      for (const project of projects) {
        const chats = inProject.get(project.id) ?? [];
        const open = expanded.has(`project:${project.id}`);
        out.push({ kind: 'project', project, expanded: open, count: chats.length });
        if (!open) continue;
        for (const row of projectFolderHistoryRows(project.id, folders, chats, folderTree.expanded)) {
          if (row.kind === 'folder') out.push({ kind: 'folder', row });
          else out.push({ kind: 'chat', conversation: row.conversation, nested: true, depth: row.depth });
        }
        const unfiled = conversationsInSelection(chats, folders, project.id, UNFILED_FOLDER);
        if (folders.some(folder => folder.projectId === project.id)) out.push({ kind: 'folder', row: { kind: 'unfiled', projectId: project.id, count: unfiled.length } });
        out.push(...unfiled.map(conversation => ({ kind: 'chat' as const, conversation, nested: true })));
      }
    }
    if (notebooksOn && notebooks.length) {
      const inNotebooks = new Map<string, ChatConversationSummary[]>();
      for (const conversation of conversations) if (inNotebook(conversation)) inNotebooks.set(conversation.notebookId!, [...(inNotebooks.get(conversation.notebookId!) ?? []), conversation]);
      out.push({ kind: 'header', id: 'h-notebooks', label: labels.heading });
      for (const notebook of [...notebooks].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))) {
        const chats = inNotebooks.get(notebook.id) ?? [];
        const open = expanded.has(`notebook:${notebook.id}`);
        out.push({ kind: 'notebook', notebook, expanded: open, count: chats.length });
        if (open) out.push(...chats.map(conversation => ({ kind: 'chat' as const, conversation, nested: true })));
      }
    }
    const pinned = supportsProjects ? conversations.filter(conversation => conversation.pinnedAt && !conversation.archived)
      .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? '')) : [];
    if (pinned.length) out.push({ kind: 'header', id: 'h-pinned', label: t('Chats destacados') }, ...pinned.map(conversation => ({ kind: 'chat' as const, conversation, nested: false })));
    const rest = conversations.filter(conversation => !(supportsProjects && conversation.pinnedAt && !conversation.archived)
      && !(supportsProjects && conversation.projectId && projectById.has(conversation.projectId)) && !inNotebook(conversation));
    if (rest.length) {
      if (out.length) out.push({ kind: 'header', id: 'h-chats', label: t('Chats') });
      out.push(...rest.map(conversation => ({ kind: 'chat' as const, conversation, nested: false })));
    }
    return out;
  }, [query, conversations, projects, notebooks, supportsProjects, notebooksOn, projectById, notebookById, expanded, folders, folderTree.expanded]);

  const toggleGroup = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const run = (action: () => Promise<unknown>) => {
    setNotice(null);
    void action().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setNotice(historyError(message));
    });
  };
  const folderUi = useFolderTreeUi(folderActions, folderTree, run);
  const newProject = () => run(async () => {
    const created = await props.onNewProject();
    if (created) { setQuery(''); setRenaming(`project:${created.id}`); }
  });

  return (
    <>
      <div className="research-chat-history-tools">
        <div className="flex items-center gap-1">
          <button type="button" className="research-chat-history-tool" data-testid="research-new-conversation" onClick={props.onNewConversation} disabled={sending} aria-label={t('Nueva conversación')} title={t('Nueva conversación')}><Icon name="plus" size={16} /></button>
          {notebooksOn && props.onNewNotebook && <button type="button" className="research-chat-history-tool" data-testid="research-new-notebook" onClick={props.onNewNotebook} aria-label={t('Nuevo cuaderno')} title={t('Nuevo cuaderno')}><Icon name="notebook" size={16} /></button>}
          {supportsProjects && <button type="button" className="research-chat-history-tool" data-testid="research-new-project" onClick={newProject} aria-label={t('Nuevo proyecto')} title={t('Nuevo proyecto')}><Icon name="folderPlus" size={16} /></button>}
        </div>
        <label className="research-chat-search">
          <Icon name="search" size={14} aria-hidden="true" />
          <input data-testid="research-chat-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder={t('Buscar…')}
            title={notebooksOn ? labels.search : supportsProjects ? t('Buscar chats y proyectos…') : t('Buscar chats…')}
            aria-label={t('Buscar en el historial')} />
        </label>
        {notice && <p role="alert" className="text-[11px] text-amber-500">{notice}</p>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col" {...(supportsProjects ? outsideDropProps(folderActions, run) : {})}>
      <VirtualList
        items={rows}
        itemHeight={row => row.kind === 'header' ? 30 : isPhoneSurface() ? 52 : 38}
        // A pinned chat in a project shows twice, pinned and inside its project: two keys.
        getKey={row => row.kind === 'project' ? `p:${row.project.id}` : row.kind === 'chat' ? `${row.nested ? 'nc' : 'c'}:${row.conversation.id}` : row.kind === 'notebook' ? `n:${row.notebook.id}`
          : row.kind === 'folder' ? (row.row.kind === 'folder' ? `f:${row.row.folder.id}` : `f:${row.row.kind}:${row.row.projectId}`) : row.id}
        className="flex-1 min-h-0 px-2 pb-2"
        empty={<div className="px-2 py-6 text-center text-xs text-neutral-600">{t('Aún no hay conversaciones. Escribe abajo para empezar.')}</div>}
        renderItem={row => {
          if (row.kind === 'header') return <div className="research-history-heading">{row.label}</div>;
          if (row.kind === 'empty') return <div className="research-history-empty px-2 py-2 text-xs text-neutral-500">{row.label}</div>;
          if (row.kind === 'folder') return <FolderTreeRowView row={row.row} tree={folderTree} ui={folderUi} actions={folderActions} run={run} baseIndent={14} contentsInline />;
          if (row.kind === 'notebook') {
            const { notebook } = row;
            const key = `notebook:${notebook.id}`;
            const searching = !!query.trim();
            const open = () => { setQuery(''); props.onOpenNotebook(notebook.id); };
            return (
              <div className={`research-history-row group ${activeNotebookId === notebook.id && !activeId ? 'is-active' : ''} ${menu?.kind === 'notebook' && menu.notebook.id === notebook.id ? 'is-menu-open' : ''}`}
                data-testid={searching ? `research-search-notebook-${notebook.id}` : `research-notebook-${notebook.id}`} data-marquee-host>
                {renaming === key
                  ? <><span className="shrink-0" style={{ color: notebook.color ?? undefined }}><Icon name={notebook.icon ?? labels.icon} size={15} /></span>
                    <RenameField value={notebook.name} onDone={name => { setRenaming(null); if (name && name !== notebook.name && props.onUpdateNotebook) run(() => props.onUpdateNotebook!(notebook, { name })); }} /></>
                  : <button type="button" className="research-history-main" aria-expanded={searching ? undefined : row.expanded} title={tx('{n} chat(s)', { n: row.count })}
                    onClick={() => { if (searching) open(); else toggleGroup(key); }}>
                    <span className="shrink-0" style={{ color: notebook.color ?? undefined }}><Icon name={notebook.icon ?? labels.icon} size={15} /></span>
                    <MarqueeText text={notebook.name} className="min-w-0 flex-1" />
                  </button>}
                <span className="research-history-row-actions">
                  <button type="button" className="research-history-action" aria-label={tx('Abrir {name}', { name: notebook.name })} title={labels.newChat}
                    onClick={event => { event.stopPropagation(); open(); }}><Icon name="edit" size={14} /></button>
                  {notebookMenu && <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
                    onClick={event => { event.stopPropagation(); setMenu({ kind: 'notebook', notebook, anchor: event.currentTarget.getBoundingClientRect() }); }}><Icon name="moreVertical" size={14} /></button>}
                </span>
              </div>
            );
          }
          if (row.kind === 'project') {
            const { project } = row;
            const key = `project:${project.id}`;
            return (
              <div className={`research-history-row group ${activeProjectId === project.id && !activeId ? 'is-active' : ''} ${menu?.kind === 'project' && menu.project.id === project.id ? 'is-menu-open' : ''}`}
                data-testid={`research-project-${project.id}`} data-marquee-host {...outsideDropProps(folderActions, run, project.id)}>
                {renaming === key
                  ? <><span className="shrink-0" style={{ color: project.color ?? undefined }}><Icon name={project.icon ?? 'folder'} size={15} /></span>
                    <RenameField value={project.name} onDone={name => { setRenaming(null); if (name && name !== project.name) run(() => props.onUpdateProject(project, { name })); }} /></>
                  : <button type="button" className="research-history-main" aria-expanded={row.expanded} title={tx('{n} chat(s)', { n: row.count })} onClick={() => toggleGroup(key)}>
                    <span className="shrink-0" style={{ color: project.color ?? undefined }}><Icon name={project.icon ?? 'folder'} size={15} /></span>
                    <MarqueeText text={project.name} className="min-w-0 flex-1" />
                  </button>}
                <span className="research-history-row-actions">
                  <button type="button" className="research-history-action" aria-label={tx('Abrir {name}', { name: project.name })} title={t('Nuevo chat en el proyecto')}
                    onClick={event => { event.stopPropagation(); props.onOpenProject(project.id); }}><Icon name="edit" size={14} /></button>
                  <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
                    onClick={event => { event.stopPropagation(); setMenu({ kind: 'project', project, anchor: event.currentTarget.getBoundingClientRect() }); }}><Icon name="moreVertical" size={14} /></button>
                </span>
              </div>
            );
          }
          const { conversation } = row;
          const key = `chat:${row.nested ? 'nested' : 'top'}:${conversation.id}`;
          const pinned = !!conversation.pinnedAt && !conversation.archived;
          return (
            <div className={`research-history-row group ${row.nested ? 'is-nested' : ''} ${conversation.id === activeId ? 'is-active' : ''} ${pinned ? 'is-pinned' : ''} ${menu?.kind === 'chat' && menu.row === key ? 'is-menu-open' : ''}`}
              data-testid={`research-conversation-${conversation.id}`} data-marquee-host
              style={row.depth === undefined ? undefined : { paddingLeft: 14 + row.depth * 14 + 18 }}
              {...(supportsProjects && !(locksMoves && inNotebook(conversation)) && renaming !== key ? chatDragProps(conversation) : {})}>
              {renaming === key
                ? <RenameField value={conversation.title} onDone={title => { setRenaming(null); if (title && title !== conversation.title && props.onRenameConversation) run(() => props.onRenameConversation!(conversation, title)); }} />
                : <button type="button" className="research-history-main" aria-current={conversation.id === activeId ? 'page' : undefined}
                  aria-label={tx('Abrir {name}', { name: conversation.title })}
                  title={`${formatRelative(conversation.updated_at)} · ${tx('{n} mensaje(s)', { n: conversation.messageCount })}`}
                  onClick={() => { if (!sending) props.onOpenConversation(conversation.id); }}>
                  <MarqueeText text={conversation.title} className={`min-w-0 flex-1 ${conversation.archived ? 'italic text-neutral-500' : ''}`} />
                </button>}
              <span className="research-history-row-actions">
                {supportsProjects && !conversation.archived && <button type="button" className={`research-history-action ${pinned ? 'is-on' : ''}`} aria-pressed={pinned}
                  aria-label={pinned ? t('Quitar de destacados') : t('Destacar chat')} title={pinned ? t('Quitar de destacados') : t('Destacar chat')}
                  onClick={event => { event.stopPropagation(); run(() => props.onPinConversation(conversation, !pinned)); }}><Icon name="pin" size={14} /></button>}
                <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
                  onClick={event => { event.stopPropagation(); setMenu({ kind: 'chat', conversation, row: key, anchor: event.currentTarget.getBoundingClientRect() }); }}><Icon name="moreVertical" size={14} /></button>
              </span>
            </div>
          );
        }}
      />
      </div>
      {props.archivedCount > 0 && (
        <button className="flex items-center gap-1.5 border-t border-neutral-800 px-3 py-2 text-left text-xs text-neutral-500 hover:text-neutral-300" onClick={props.onToggleArchived}>
          <Icon name="archive" size={13} />
          {props.showArchived ? t('Ocultar archivadas') : tx('Ver archivadas ({n})', { n: props.archivedCount })}
        </button>
      )}
      {menu?.kind === 'chat' && <ChatMenu {...props} conversation={menu.conversation} anchor={menu.anchor} onClose={() => setMenu(null)}
        onRename={() => setRenaming(menu.row)} run={run} />}
      {menu?.kind === 'project' && <FloatingMenu anchor={menu.anchor} label={menu.project.name} onClose={() => setMenu(null)}>
        <MenuItem icon="brain" label={t('Instrucciones del proyecto')} onSelect={() => { setMenu(null); props.onEditProjectInstructions(menu.project); }} />
        <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { setMenu(null); setRenaming(`project:${menu.project.id}`); }} />
        <MenuItem icon="palette" label={t('Icono y color')} onSelect={() => { setMenu(null); setStyling({ kind: 'project', id: menu.project.id }); }} />
        <MenuItem icon="folderPlus" label={t('Nueva carpeta')} onSelect={() => {
          const { project } = menu;
          setMenu(null);
          setExpanded(current => new Set([...current, `project:${project.id}`]));
          folderUi.create(project.id, null);
        }} />
        <hr className="research-history-menu-separator" />
        <MenuItem icon="trash" danger label={t('Eliminar proyecto')} onSelect={() => { setMenu(null); setDeletingProject(menu.project); }} />
      </FloatingMenu>}
      {menu?.kind === 'notebook' && <FloatingMenu anchor={menu.anchor} label={menu.notebook.name} onClose={() => setMenu(null)}>
        {props.onUpdateNotebook && <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { setMenu(null); setRenaming(`notebook:${menu.notebook.id}`); }} />}
        {props.onUpdateNotebook && <MenuItem icon="palette" label={t('Icono y color')} onSelect={() => { setMenu(null); setStyling({ kind: 'notebook', id: menu.notebook.id }); }} />}
        {props.onEditNotebook && <MenuItem icon="folder" label={props.notebookCollections === false ? t('Editar fuentes') : t('Editar colecciones')} onSelect={() => { setMenu(null); props.onEditNotebook!(menu.notebook); }} />}
        {props.onDeleteNotebook && <>
          <hr className="research-history-menu-separator" />
          <MenuItem icon="trash" danger label={t('Eliminar cuaderno')} onSelect={() => { setMenu(null); setDeletingNotebook(menu.notebook); }} />
        </>}
      </FloatingMenu>}
      {styling?.kind === 'project' && projectById.has(styling.id) && <AppearanceDialog value={projectById.get(styling.id)!} fallbackIcon="folder" onClose={() => setStyling(null)}
        onChange={patch => run(() => props.onUpdateProject(projectById.get(styling.id)!, patch))} />}
      {styling?.kind === 'notebook' && notebookById.has(styling.id) && props.onUpdateNotebook && <AppearanceDialog value={notebookById.get(styling.id)!} fallbackIcon={labels.icon} onClose={() => setStyling(null)}
        onChange={patch => run(() => props.onUpdateNotebook!(notebookById.get(styling.id)!, patch))} />}
      {deletingNotebook && <ConfirmModal
        title={t('Eliminar cuaderno')}
        message={props.notebookCollections === false
          ? tx('Se eliminará «{name}». Sus chats no se borran: vuelven al historial general.', { name: deletingNotebook.name })
          : tx('Se eliminará «{name}». Sus chats no se borran: vuelven al historial general, y sus colecciones siguen en la Biblioteca.', { name: deletingNotebook.name })}
        confirmLabel={t('Eliminar')}
        danger
        onConfirm={() => { const notebook = deletingNotebook; setDeletingNotebook(null); if (props.onDeleteNotebook) run(() => props.onDeleteNotebook!(notebook)); }}
        onCancel={() => setDeletingNotebook(null)}
      />}
      {folderUi.overlays}
      {deletingProject && <ConfirmModal
        title={t('Eliminar proyecto')}
        message={tx('Se eliminará «{name}». Sus chats no se borran: vuelven al historial general.', { name: deletingProject.name })}
        confirmLabel={t('Eliminar')}
        danger
        onConfirm={() => { const project = deletingProject; setDeletingProject(null); run(() => props.onDeleteProject(project)); }}
        onCancel={() => setDeletingProject(null)}
      />}
    </>
  );
}

function ChatMenu({ conversation, anchor, onClose, onRename, run, projects, supportsProjects, ...props }: ResearchChatSidebarProps & {
  conversation: ChatConversationSummary; anchor: DOMRect; onClose: () => void; onRename: () => void; run: (action: () => Promise<unknown>) => void;
}) {
  // The menu swaps its list in place: the chat's actions, the projects, or the folders.
  const [list, setList] = useState<'actions' | 'projects' | 'folders'>('actions');
  const pinned = !!conversation.pinnedAt && !conversation.archived;
  // A notebook's chat belongs to its notebook; it is not moved into a project. A course is
  // only a Study chat's scope, so its chats still move.
  const movable = supportsProjects && !((props.notebookLocksMoves ?? true) && conversation.notebookId && props.notebooksOn && props.notebooks.some(notebook => notebook.id === conversation.notebookId));
  const project = conversation.projectId ? projects.find(item => item.id === conversation.projectId) ?? null : null;
  // The folders of the chat's own project; a folder id that no longer resolves is no folder.
  const outline = project ? folderOutline(props.folderActions.folders, project.id) : [];
  const currentFolder = outline.some(entry => entry.folder.id === conversation.folderId) ? conversation.folderId : null;
  const act = (action: () => Promise<unknown> | void) => { onClose(); run(async () => { await action(); }); };
  const back = () => setList('actions');
  return <FloatingMenu anchor={anchor} label={conversation.title} onClose={onClose} onBack={list === 'actions' ? undefined : back} focusKey={list}>
    {list === 'projects' ? <>
      <MenuItem icon="arrowLeft" label={t('Mover a proyecto')} onSelect={back} />
      <hr className="research-history-menu-separator" />
      {conversation.projectId && <MenuItem icon="x" label={t('Sacar del proyecto')} onSelect={() => act(() => props.onMoveConversation(conversation, null))} />}
      {projects.map(item => <MenuItem key={item.id} radio icon={item.icon ?? 'folder'} color={item.color} label={item.name} checked={item.id === conversation.projectId}
        onSelect={() => act(() => item.id === conversation.projectId ? undefined : props.onMoveConversation(conversation, item.id))} />)}
      <MenuItem icon="folderPlus" label={t('Nuevo proyecto')} onSelect={() => act(async () => {
        const created = await props.onNewProject();
        if (created) await props.onMoveConversation(conversation, created.id);
      })} />
    </> : list === 'folders' && project ? <>
      <MenuItem icon="arrowLeft" label={t('Mover a carpeta…')} onSelect={back} />
      <hr className="research-history-menu-separator" />
      {currentFolder && <MenuItem icon="x" label={t('Sacar de la carpeta')} onSelect={() => act(() => props.folderActions.onFileConversation(conversation, null))} />}
      {outline.map(({ folder, depth }) => <MenuItem key={folder.id} radio icon="folder" indent={depth} label={folder.name} checked={folder.id === currentFolder}
        onSelect={() => act(() => folder.id === currentFolder ? undefined : props.folderActions.onFileConversation(conversation, folder.id))} />)}
    </> : <>
      {props.onRenameConversation && <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { onClose(); onRename(); }} />}
      {props.onRenameConversation && <hr className="research-history-menu-separator" />}
      {supportsProjects && !conversation.archived && <MenuItem icon="pin" label={pinned ? t('Quitar de destacados') : t('Destacar chat')} onSelect={() => act(() => props.onPinConversation(conversation, !pinned))} />}
      {props.onArchiveConversation && <MenuItem icon="archive" label={conversation.archived ? t('Desarchivar') : t('Archivar')} onSelect={() => act(() => props.onArchiveConversation!(conversation))} />}
      <MenuItem icon="trash" danger label={t('Eliminar')} onSelect={() => { onClose(); props.onDeleteConversation(conversation); }} />
      {movable && <>
        <hr className="research-history-menu-separator" />
        <MenuItem icon="folderMove" label={t('Mover a proyecto')} trailing={<Icon name="chevronRight" size={13} />} keepOpen submenu onSelect={() => setList('projects')} />
        {/* Only a chat in a project has folders to go to: those of its project. */}
        {project && outline.length > 0 && <MenuItem icon="folder" label={t('Mover a carpeta…')} trailing={<Icon name="chevronRight" size={13} />} keepOpen submenu onSelect={() => setList('folders')} />}
      </>}
    </>}
  </FloatingMenu>;
}

/** Colour and icon of a project or a notebook; each choice applies at once. */
function AppearanceDialog({ value: project, fallbackIcon, onClose, onChange }: { value: { icon?: string | null; color?: string | null }; fallbackIcon: string; onClose: () => void; onChange: (patch: { icon?: string; color?: string | null }) => void }) {
  const ref = useDismissableLayer<HTMLDivElement>({ open: true, onDismiss: onClose, group: 'research-project-style' });
  const custom = project.color && !PROJECT_COLORS.includes(project.color);
  return createPortal(
    <div className="research-project-style-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('Icono y color')} data-testid="research-project-style" className="research-project-style">
        <div className="flex flex-wrap gap-3">
          {PROJECT_COLORS.map(color => <button key={color} type="button" className={`research-project-swatch ${project.color === color ? 'is-selected' : ''}`}
            style={{ backgroundColor: color }} aria-label={color} aria-pressed={project.color === color} onClick={() => onChange({ color })} />)}
          <label className={`research-project-swatch is-custom ${custom ? 'is-selected' : ''}`} title={t('Color personalizado')}>
            <input type="color" value={project.color ?? '#3b82f6'} aria-label={t('Color personalizado')} onChange={event => onChange({ color: event.target.value.toLowerCase() })} />
          </label>
          {project.color && <button type="button" className="research-project-swatch is-none" aria-label={t('Sin color')} title={t('Sin color')} onClick={() => onChange({ color: null })}><Icon name="x" size={14} /></button>}
        </div>
        <hr className="research-history-menu-separator" />
        <div className="research-project-icons">
          {PROJECT_ICONS.map(icon => <button key={icon} type="button" className={`research-project-icon ${(project.icon ?? fallbackIcon) === icon ? 'is-selected' : ''}`}
            aria-label={icon} aria-pressed={(project.icon ?? fallbackIcon) === icon} onClick={() => onChange({ icon })}><Icon name={icon} size={18} /></button>)}
        </div>
        <hr className="research-history-menu-separator" />
        <button type="button" className="research-history-menu-item" onClick={onClose}>{t('Cerrar')}</button>
      </div>
    </div>,
    document.body,
  );
}
