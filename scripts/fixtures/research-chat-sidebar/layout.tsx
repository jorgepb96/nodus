import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchChatSidebar } from '../../../src/components/ResearchChatSidebar';
import { useChatFolderTreeState } from '../../../src/components/ResearchChatFolderTree';
import { setActiveLang } from '../../../src/i18n';
import type { ChatConversationSummary } from '../../../shared/types';

const titles = [
  'Evidencias sobre la mirada turística en España',
  'Trípticos turísticos del franquismo y sus imágenes',
  'África comienza en los Pirineos: relatos de viaje',
  'Categorías de libros de viajes por España',
  'Viaje como reconocimiento del territorio',
  'Orientalización romántica de España',
  'Viajeros que reconocen España en sus relatos',
  'Interpretación de Alburquerque sobre el viaje',
  'Dime cuál es la interpretación de este texto',
];
const now = '2026-10-19T11:10:00Z';
const noop = async () => undefined;
function App() {
  const [activeId, setActiveId] = useState('c0');
  const [conversations, setConversations] = useState<ChatConversationSummary[]>(titles.map((title, index) => ({
    id: `c${index}`, title, created_at: now, updated_at: now, archived: false, model: null,
    messageCount: 2, projectId: null, pinnedAt: null,
  })));
  const folderTree = useChatFolderTreeState();
  return <aside data-testid="research-history-sidebar" className="research-chat-history bg-neutral-950" style={{ width: 240, height: 490, display: 'flex', flexDirection: 'column', '--vault-accent': '#6366f1' } as React.CSSProperties}>
    <ResearchChatSidebar conversations={conversations} projects={[]} notebooks={[]} supportsProjects notebooksOn
      activeId={activeId} activeProjectId={null} activeNotebookId={null} archivedCount={0} showArchived={false}
      onToggleArchived={() => undefined} onNewConversation={() => undefined} onNewNotebook={() => undefined}
      onNewProject={async () => null} onOpenConversation={setActiveId} onOpenProject={() => undefined} onOpenNotebook={() => undefined}
      onPinConversation={async (chat, pinned) => setConversations(current => current.map(item => item.id === chat.id ? { ...item, pinnedAt: pinned ? now : null } : item))}
      onRenameConversation={async (chat, title) => setConversations(current => current.map(item => item.id === chat.id ? { ...item, title } : item))}
      onArchiveConversation={noop} onDeleteConversation={() => undefined} onMoveConversation={noop}
      onDeleteConversations={() => undefined} onArchiveConversations={noop} onMoveConversations={noop}
      onEditProjectInstructions={() => undefined} onUpdateProject={noop} onDeleteProject={noop}
      folderTree={folderTree} folderActions={{ folders: [], onCreateFolder: async () => null, onRenameFolder: noop, onDeleteFolder: noop, onMoveFolder: noop, onFileConversation: noop, onMoveConversation: noop }} />
  </aside>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
