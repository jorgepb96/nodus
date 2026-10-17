import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, DatabaseSummary } from '@shared/types';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { ChartFromSpec } from '../components/DatabaseChart';
import { parseChatSegments } from '@shared/chartSpec';
import { t } from '../i18n';
import { ResearchAssistantModal } from './ResearchAssistantModal';
import { nativeSummary, surfaceChatOrganizer, type ResearchChatAdapter } from './researchChatAdapter';
import { useSurfaceNotebooks } from './useSurfaceNotebooks';
import { ChatNotebookContextNote } from '../components/ChatNotebookDialog';
import type { ResearchConversationNavigationTarget } from '../researchNoteProvenance';

const STARTERS = [
  'Resume esta base de datos en 3 puntos.',
  'Muéstrame la distribución por categoría en un gráfico.',
  '¿Qué valores atípicos o problemas de calidad detectas?',
  'Compara los grupos y destaca las diferencias.',
];

/** Renders an assistant message: Markdown prose with any native chart specs inline. */
function AssistantMessage({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const segments = parseChatSegments(text);
  return (
    <div className="text-sm">
      {segments.map((seg, i) =>
        seg.kind === 'chart' ? <ChartFromSpec key={i} spec={seg.spec} /> : <ChatMarkdown key={i} streaming={streaming} content={seg.text} className="text-sm" />
      )}
    </div>
  );
}

/** A notebook of the database chat reads a set of databases. */
type DatabaseSelection = { databaseIds: string[] };
const parseDatabaseSelection = (stored: unknown): DatabaseSelection => {
  const ids = (stored as { databaseIds?: unknown } | null)?.databaseIds;
  return { databaseIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [] };
};

function DatabasePicker({ databases, selected, onChange, disabled = false }: { databases: DatabaseSummary[]; selected: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return <div className="space-y-2">{databases.map(database => <label key={database.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={selected.includes(database.id)} onChange={event => onChange(event.target.checked ? [...selected, database.id] : selected.filter(id => id !== database.id))} />{database.name}</label>)}{!selected.length && <p className="text-xs text-neutral-500">{t('Elige al menos una base de datos.')}</p>}</div>;
}

export function DatabasesChatView({ settings, initialDatabaseId, conversationTarget, onOpenSavedNote }: { settings: AppSettings; initialDatabaseId: string | null; conversationTarget?: ResearchConversationNavigationTarget | null; onOpenSavedNote?: (id: string) => void }) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [selected, setSelected] = useState<string[]>(initialDatabaseId ? [initialDatabaseId] : []);
  useEffect(() => { void window.nodus.listDatabases().then(list => { setDatabases(list); setSelected(current => current.length ? current : list[0] ? [list[0].id] : []); }); }, []);
  const notebooks = useSurfaceNotebooks<DatabaseSelection>({
    surface: 'database', current: { databaseIds: selected }, apply: selection => setSelected(selection.databaseIds), parse: parseDatabaseSelection,
    picker: (selection, onChange, disabled) => <DatabasePicker databases={databases} selected={selection.databaseIds} disabled={disabled} onChange={databaseIds => onChange({ databaseIds })} />,
    ready: selection => selection.databaseIds.length > 0,
  });
  const reading = notebooks.active;
  const adapter = useMemo<ResearchChatAdapter>(() => ({
    id: 'database', contextKey: JSON.stringify([...selected].sort()), canSend: selected.length > 0,
    subtitle: 'Pregunta a tus datos. Puede responder con cifras y gráficos, siempre a partir de tus filas.', suggestions: STARTERS,
    // A chat that reads a notebook reads the notebook's databases; the notebook is where they change.
    contextPanel: reading ? <ChatNotebookContextNote name={reading.name} onEdit={() => notebooks.editSources(reading.id)} /> : <DatabasePicker databases={databases} selected={selected} onChange={setSelected} />,
    reset: notebooks.clear,
    organizer: surfaceChatOrganizer('database') ?? undefined,
    notebooks: notebooks.notebooks,
    listConversations: async includeArchived => (await window.nodus.listDatabaseChatConversations(includeArchived)).map(nativeSummary),
    getConversation: async id => { const chat = await window.nodus.getDatabaseChatConversation(id); if (!chat) return null; setSelected(chat.databaseIds); notebooks.follow(chat.notebookId); return { ...nativeSummary(chat), selection: null, messages: chat.messages.map((message, index) => ({ ...message, id: `${id}:${index}`, selectionKey: message.selectionKey ?? JSON.stringify([...chat.databaseIds].sort()) })) }; },
    createConversation: input => window.nodus.createDatabaseChatConversation({ title: input.title ?? 'Research chat', databaseIds: selected, projectId: input.projectId, folderId: input.folderId, notebookId: input.notebookId }),
    saveConversationMessages: (id, messages) => window.nodus.saveDatabaseChatConversation(id, messages, selected),
    deleteConversation: id => window.nodus.deleteDatabaseChatConversation(id),
    archiveConversation: window.nodus.archiveChatHistoryConversation ? (id, archived) => window.nodus.archiveChatHistoryConversation!('database', id, archived) : undefined,
    renameConversation: window.nodus.renameChatHistoryConversation ? (id, title) => window.nodus.renameChatHistoryConversation!('database', id, title) : undefined,
    researchChatStream: async (request, handlers) => { const result = await window.nodus.dbChatStream({ conversationId: request.conversationId, attachmentIds: request.attachmentIds, question: request.messages.at(-1)!.content, databaseIds: selected, history: request.messages.slice(0, -1), model: request.model, thinkingEffort: request.thinkingEffort, systemPromptId: request.systemPromptId }, handlers); return { answer: result.text, aborted: result.aborted }; },
    cancelResearchChat: conversationId => window.nodus.cancelDbChat(conversationId),
    renderMessage: (message, streaming) => <AssistantMessage text={message.content} streaming={streaming} />,
  }), [databases, selected, reading, notebooks]);
  return <ResearchAssistantModal settings={settings} embedded adapter={adapter} initialConversationTarget={conversationTarget} onOpenSavedNote={onOpenSavedNote} />;
}
