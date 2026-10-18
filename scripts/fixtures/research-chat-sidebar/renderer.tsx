import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchChatSidebar } from '../../../src/components/ResearchChatSidebar';
import { chatDragProps, useChatFolderTreeState, type ChatFolderActions } from '../../../src/components/ResearchChatFolderTree';
import { MarqueeText } from '../../../src/components/MarqueeText';
import { folderSubtree, nextFolderName } from '../../../shared/researchChatFolders';
import { setActiveLang } from '../../../src/i18n';
import type { ChatConversationSummary, ResearchChatProject, ResearchChatProjectFolder } from '../../../shared/types';

const fixture = window as any;
fixture.actions = [];
const now = new Date().toISOString();
const chat = (id: string, title: string, extra: Partial<ChatConversationSummary> = {}): ChatConversationSummary =>
  ({ id, title, created_at: now, updated_at: now, archived: false, model: null, messageCount: 2, projectId: null, pinnedAt: null, ...extra });
const project = (id: string, name: string, icon = 'folder', color: string | null = null): ResearchChatProject => ({ id, name, icon, color, createdAt: now, updatedAt: now });
const folder = (id: string, projectId: string, parentId: string | null, name: string, position: number): ResearchChatProjectFolder => ({ id, projectId, parentId, name, position, createdAt: now });
/** Siblings renumbered with `moving` at `index` (the end when omitted), as the repository does. */
const placeFolder = (folders: ResearchChatProjectFolder[], moving: ResearchChatProjectFolder, parentId: string | null, index?: number) => {
  const siblings = folders.filter(item => item.projectId === moving.projectId && item.parentId === parentId && item.id !== moving.id).sort((a, b) => a.position - b.position);
  siblings.splice(index ?? siblings.length, 0, { ...moving, parentId });
  const placed = new Map(siblings.map((item, position) => [item.id, { ...item, position }]));
  return folders.map(item => placed.get(item.id) ?? item);
};

function App() {
  const [projects, setProjects] = useState<ResearchChatProject[]>([project('p-z', 'Zeta'), project('p-a', 'Alfa', 'flask', '#3b82f6')].sort((a, b) => a.name.localeCompare(b.name)));
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([
    chat('c1', 'Sevilla en guías de viaje', { pinnedAt: '2026-09-24T10:00:00Z' }),
    chat('c2', 'Regadío del Tormeral', { projectId: 'p-a', folderId: 'f-2' }),
    chat('c3', 'Réplica y cifras'),
    chat('c4', 'Cartografía medieval'),
    chat('c5', 'Pozos y norias', { notebookId: 'n1' }),
    chat('c6', 'Un título de conversación larguísimo que no cabe entero en la barra lateral', { projectId: 'p-z' }),
  ]);
  const [folders, setFolders] = useState<ResearchChatProjectFolder[]>([
    folder('f-1', 'p-a', null, 'Capítulo primero: fuentes, archivos y cartografía del regadío', 0),
    folder('f-2', 'p-a', 'f-1', 'Fuentes', 0),
    folder('f-3', 'p-a', null, 'Notas', 1),
  ]);
  const folderTree = useChatFolderTreeState();
  const [notebooks, setNotebooks] = useState<any[]>([{ id: 'n1', name: 'Cuaderno de riegos', icon: 'notebook', color: null, sources: [], exclusions: [], mode: 'linked', revision: 1, resolvedDocumentIds: [], createdAt: now, updatedAt: now }]);
  const log = (...entry: unknown[]) => fixture.actions.push(entry);
  const folderActions: ChatFolderActions = {
    folders,
    onCreateFolder: async (projectId, parentId) => {
      const created = folder(`f-new-${folders.length}`, projectId, parentId, nextFolderName(folders, projectId, parentId, 'Nueva carpeta'), folders.filter(item => item.projectId === projectId && item.parentId === parentId).length);
      log('createFolder', projectId, parentId);
      setFolders(current => [...current, created]);
      return created;
    },
    onRenameFolder: async (target, name) => { log('renameFolder', target.id, name); setFolders(current => current.map(item => item.id === target.id ? { ...item, name } : item)); },
    onMoveFolder: async (target, parentId, index) => { log('moveFolder', target.id, parentId, index ?? null); setFolders(current => placeFolder(current, target, parentId, index)); },
    onDeleteFolder: async target => {
      log('deleteFolder', target.id);
      const gone = folderSubtree(folders, target.id);
      setFolders(current => current.filter(item => !gone.has(item.id)));
      setConversations(current => current.map(item => item.folderId && gone.has(item.folderId) ? { ...item, folderId: null } : item));
    },
    onFileConversation: async (conversation, folderId) => {
      log('file', conversation.id, folderId);
      const projectId = folderId ? folders.find(item => item.id === folderId)!.projectId : conversation.projectId;
      setConversations(current => current.map(item => item.id === conversation.id ? { ...item, folderId, projectId } : item));
    },
    onMoveConversation: async (conversation, projectId) => { log('move', conversation.id, projectId); setConversations(current => current.map(item => item.id === conversation.id ? { ...item, projectId, folderId: null } : item)); },
  };
  return <><div style={{ display: 'flex', gap: 16 }}><aside style={{ width: 280, height: 640, display: 'flex', flexDirection: 'column' }} data-testid="research-history-sidebar" className="research-chat-history">
    <ResearchChatSidebar
      conversations={conversations} projects={projects} notebooks={notebooks}
      supportsProjects notebooksOn activeId={null} activeProjectId={null} activeNotebookId={null} archivedCount={0} showArchived={false}
      onToggleArchived={() => log('toggleArchived')}
      onNewConversation={() => log('new')}
      onNewNotebook={() => log('newNotebook')}
      onNewProject={async () => { const created = project(`p-${projects.length}`, 'Nuevo proyecto'); setProjects(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name))); log('newProject'); return created; }}
      onOpenConversation={id => log('open', id)}
      onOpenProject={id => log('openProject', id)}
      onOpenNotebook={id => log('notebook', id)}
      onEditNotebook={notebook => log('editNotebook', notebook.id)}
      onUpdateNotebook={async (notebook, patch) => { log('updateNotebook', notebook.id, patch); setNotebooks(current => current.map(item => item.id === notebook.id ? { ...item, ...patch } : item)); }}
      onDeleteNotebook={async notebook => { log('deleteNotebook', notebook.id); setNotebooks(current => current.filter(item => item.id !== notebook.id)); }}
      onRenameConversation={async (conversation, title) => { log('rename', conversation.id, title); setConversations(current => current.map(item => item.id === conversation.id ? { ...item, title } : item)); }}
      onPinConversation={async (conversation, pinned) => {
        log('pin', conversation.id, pinned);
        if (pinned && fixture.pinLimitReached) throw new Error('research_chat_pin_limit');
        setConversations(current => current.map(item => item.id === conversation.id ? { ...item, pinnedAt: pinned ? now : null } : item));
      }}
      onArchiveConversation={async conversation => log('archive', conversation.id)}
      onDeleteConversation={conversation => log('delete', conversation.id)}
      onMoveConversation={folderActions.onMoveConversation}
      onDeleteConversations={selected => log('deleteMany', selected.map(item => item.id))}
      onArchiveConversations={async (selected, archived) => log('archiveMany', selected.map(item => item.id), archived)}
      onMoveConversations={async (selected, projectId) => {
        log('moveMany', selected.map(item => item.id), projectId);
        setConversations(current => current.map(item => selected.some(chosen => chosen.id === item.id) ? { ...item, projectId, folderId: null } : item));
      }}
      onUpdateProject={async (target, patch) => { log('updateProject', target.id, patch); setProjects(current => current.map(item => item.id === target.id ? { ...item, ...patch } : item)); }}
      onDeleteProject={async target => { log('deleteProject', target.id); setProjects(current => current.filter(item => item.id !== target.id)); }}
      folderTree={folderTree}
      folderActions={folderActions}
    />
  </aside>
  {/* Project homes include all their chats, independent of folder selection. */}
  <main data-testid="project-home" style={{ width: 580 }}>
    <ul className="research-project-chats" data-testid="research-project-chats">
      {conversations.filter(conversation => conversation.projectId === 'p-a').map(conversation => <li key={conversation.id} data-testid={`home-chat-${conversation.id}`} {...chatDragProps(conversation)}>
        <button type="button" data-marquee-host><MarqueeText text={conversation.title} className="research-project-chat-title" /></button>
      </li>)}
    </ul>
  </main>
  </div>
  {/* Other chat histories, below: Study's courses as its notebooks, and a Databases-style one. */}
  <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
    <SurfaceHistory kind="course" />
    <SurfaceHistory kind="notebook" />
  </div>
  </>;
}
/**
 * A chat history of another surface, as the Study and Databases views hand it to the
 * sidebar: Study's courses (a chat's scope, still movable into projects, managed in Study
 * and so without a menu here) or the surface's own notebooks (sources, not collections).
 */
function SurfaceHistory({ kind }: { kind: 'course' | 'notebook' }) {
  const log = (...entry: unknown[]) => fixture.actions.push([kind, ...entry]);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([
    chat(`${kind}-c1`, 'Membranas y transporte', { notebookId: `${kind}-n1` }),
    chat(`${kind}-c2`, 'Repaso general'),
  ]);
  const [folders] = useState<ResearchChatProjectFolder[]>([folder(`${kind}-f1`, `${kind}-p1`, null, 'Parciales', 0)]);
  const folderTree = useChatFolderTreeState();
  const entries = kind === 'course'
    ? [{ id: `${kind}-n1`, name: 'Biología celular', color: '#22c55e', keywords: 'Célula Membrana plasmática' }]
    : [{ id: `${kind}-n1`, name: 'Ventas', icon: 'chartBar', color: null }];
  const folderActions: ChatFolderActions = {
    folders,
    onCreateFolder: async () => null,
    onRenameFolder: async () => undefined,
    onMoveFolder: async () => undefined,
    onDeleteFolder: async () => undefined,
    onFileConversation: async (conversation, folderId) => { log('file', conversation.id, folderId); },
    onMoveConversation: async (conversation, projectId) => { log('move', conversation.id, projectId); setConversations(current => current.map(item => item.id === conversation.id ? { ...item, projectId } : item)); },
  };
  const editing = kind === 'notebook' ? {
    onEditNotebook: (notebook: { id: string }) => log('editSources', notebook.id),
    onUpdateNotebook: async (notebook: { id: string }, patch: object) => { log('updateNotebook', notebook.id, patch); },
    onDeleteNotebook: async (notebook: { id: string }) => { log('deleteNotebook', notebook.id); },
  } : {};
  return <aside style={{ width: 280, height: 320, display: 'flex', flexDirection: 'column' }} data-testid={`${kind}-history-sidebar`} className="research-chat-history">
    <ResearchChatSidebar
      conversations={conversations} projects={[project(`${kind}-p1`, 'Examen')]} notebooks={entries}
      supportsProjects notebooksOn notebookKind={kind} notebookCollections={false} notebookLocksMoves={kind !== 'course'}
      activeId={null} activeProjectId={null} activeNotebookId={null} archivedCount={0} showArchived={false}
      onToggleArchived={() => undefined} onNewConversation={() => undefined} onNewProject={async () => null}
      onOpenConversation={id => log('open', id)} onOpenProject={id => log('openProject', id)} onOpenNotebook={id => log('notebook', id)}
      {...editing}
      onRenameConversation={async (conversation, title) => log('rename', conversation.id, title)}
      onPinConversation={async () => undefined} onArchiveConversation={async conversation => log('archive', conversation.id)}
      onDeleteConversation={() => undefined} onMoveConversation={folderActions.onMoveConversation}
      onUpdateProject={async () => undefined} onDeleteProject={async () => undefined}
      folderTree={folderTree} folderActions={folderActions}
    />
  </aside>;
}

setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
