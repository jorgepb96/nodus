import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, StudyAssistantCitation, StudyAssistantSelection } from '@shared/types';
import type { StudyWorkspace } from '@shared/studyOrg';
import { DEFAULT_STUDY_ASSISTANT_SELECTION } from '@shared/studyAssistant';
import type { StudySearchLocation } from '@shared/studySearch';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { t } from '../i18n';
import { ResearchAssistantModal } from './ResearchAssistantModal';
import { StudySourcePicker } from '../components/StudySourcePicker';
import { nativeSummary, surfaceChatOrganizer, type ChatHistoryNotebooks, type ResearchChatAdapter, type ResearchUiMessage } from './researchChatAdapter';
import { STUDY_WORKSPACE_CHANGED } from '../components/StudySidebar';
import type { ResearchConversationNavigationTarget } from '../researchNoteProvenance';

export type StudyChatVariant = 'study' | 'teaching';

const COPY: Record<StudyChatVariant, {
  title: string;
  subtitle: string;
  historyEmpty: string;
  scopeNote: string;
  starters: string[];
}> = {
  study: {
    title: 'Research chat',
    subtitle: 'Pregunta a tus materiales y apuntes con citas verificables.',
    historyEmpty: 'Tus conversaciones de estudio aparecerán aquí.',
    scopeNote: 'Las respuestas se fundamentan en el contenido del vault de estudio. Las citas abren la fuente original.',
    starters: [
      'Resume las ideas esenciales y señala qué debería recordar.',
      'Compara los conceptos centrales de estas fuentes.',
      '¿Qué contradicciones o puntos incompletos aparecen en el material?',
      'Explícamelo paso a paso como si fuera la primera vez que lo estudio.',
    ],
  },
  teaching: {
    title: 'Research chat',
    subtitle: 'Pregunta a tus materiales de clase con citas verificables.',
    historyEmpty: 'Tus conversaciones aparecerán aquí.',
    scopeNote: 'Las respuestas se fundamentan en el contenido del vault de docencia. Las citas abren la fuente original.',
    starters: [
      'Resume las ideas esenciales de este material para preparar la clase.',
      'Compara los conceptos centrales de estas fuentes.',
      '¿Qué contradicciones o puntos incompletos aparecen en el material?',
      'Propón una explicación paso a paso para el alumnado.',
    ],
  },
};

export function StudyChatView({ settings, onOpenDocument, onOpenMaterial, onOpenRecording, initialPrompt, conversationTarget, onOpenSavedNote, variant = 'study' }: {
  settings: AppSettings; onOpenDocument: (id: string) => void; onOpenMaterial: (id: string, location?: StudySearchLocation | null) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void; initialPrompt?: string | null; conversationTarget?: ResearchConversationNavigationTarget | null; onOpenSavedNote?: (id: string) => void; variant?: StudyChatVariant;
}) {
  const copy = COPY[variant];
  const [selection, setSelection] = useState<StudyAssistantSelection>(() => ({ ...DEFAULT_STUDY_ASSISTANT_SELECTION, sourceKeys: [] }));
  const initialTarget = useMemo(() => initialPrompt ? { prompt: initialPrompt, nonce: Date.now() } : null, [initialPrompt]);
  const courses = useStudyCourses();
  const notebooks: ChatHistoryNotebooks = {
    kind: 'course', entries: courses.entries,
    // A course is the chat's scope, which can change turn by turn: its chats still move into projects.
    locksMoves: false,
    open: courseId => setSelection({ ...DEFAULT_STUDY_ASSISTANT_SELECTION, scope: 'course', courseId, subjectId: null, topicId: null, sourceKeys: [] }),
  };
  const withCourse = <T extends { selection: StudyAssistantSelection }>(chat: T) => ({ ...chat, notebookId: courses.courseOf(chat.selection) });
  // The citation knows the page or slide it came from; passing it along is what
  // makes the click land on the quoted passage instead of the first page of the
  // material.
  const openCitation = (citation: StudyAssistantCitation) => {
    if (citation.kind === 'document' && citation.location.documentId) onOpenDocument(citation.location.documentId);
    else if (citation.kind === 'material' && citation.location.materialId) onOpenMaterial(citation.location.materialId, citation.location);
    else if (citation.kind === 'transcript' && citation.location.recordingId) onOpenRecording(citation.location.recordingId, citation.location.timestampSeconds);
  };
  const toNative = (message: ResearchUiMessage) => ({ ...message.study, id: message.id, role: message.role, content: message.content, createdAt: message.study?.createdAt ?? new Date().toISOString(), error: message.error, interrupted: message.interrupted, attachments: message.attachments, selectionKey: message.selectionKey });
  const adapter: ResearchChatAdapter = {
    id: 'study', modelFeature: 'studyModel', contextKey: JSON.stringify(selection), subtitle: copy.subtitle, suggestions: copy.starters,
    canSend: selection.scope !== 'manual' || selection.sourceKeys.length > 0,
    contextPanel: <><StudySourcePicker selection={selection} onChange={setSelection} /><p className="mt-4 rounded-lg bg-neutral-100 p-3 text-[10px] leading-5 text-neutral-500 dark:bg-neutral-900/60">{t(copy.scopeNote)}</p></>,
    organizer: surfaceChatOrganizer('study') ?? undefined,
    notebooks,
    listConversations: async includeArchived => (await window.nodus.listStudyAssistantConversations(includeArchived)).map(chat => nativeSummary(withCourse(chat))),
    getConversation: async id => { const chat = await window.nodus.getStudyAssistantConversation(id); if (!chat) return null; setSelection(chat.selection); return { ...nativeSummary(withCourse(chat)), selection: null, messages: chat.messages.map(message => ({ id: message.id, role: message.role, content: message.content, error: message.error, interrupted: message.interrupted, study: message, attachments: message.attachments, selectionKey: message.selectionKey ?? JSON.stringify(chat.selection) })) }; },
    createConversation: input => window.nodus.createStudyAssistantConversation({ title: input.title, model: input.model, selection, projectId: input.projectId, folderId: input.folderId }),
    saveConversationMessages: (id, messages, options) => window.nodus.updateStudyAssistantConversation(id, { messages: messages.map(toNative), selection, model: options.model }),
    deleteConversation: id => window.nodus.deleteStudyAssistantConversation(id),
    archiveConversation: (id, archived) => window.nodus.updateStudyAssistantConversation(id, { archived }),
    renameConversation: (id, title) => window.nodus.updateStudyAssistantConversation(id, { title }),
    researchChatStream: async (request, handlers) => { const result = await window.nodus.streamStudyAssistant({ conversationId: request.conversationId, attachmentIds: request.attachmentIds, messages: request.messages.map(message => toNative({ ...message, id: crypto.randomUUID() })), selection, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: false, model: request.model, thinkingEffort: request.thinkingEffort, systemPromptId: request.systemPromptId }, handlers); return { answer: result.answer, aborted: result.interrupted, message: { study: { id: '', role: 'assistant', content: result.answer, createdAt: new Date().toISOString(), citations: result.citations, citationWarning: result.citationWarning, stats: result.stats, interrupted: result.interrupted } } }; },
    cancelResearchChat: conversationId => window.nodus.cancelStudyAssistant(conversationId),
    renderMessage: (message, streaming) => <><ChatMarkdown content={message.content} streaming={streaming} verify={false} onStudyEvidence={id => { const citation = message.study?.citations?.find(item => item.id === id); if (citation) openCitation(citation); }} />{message.study?.citations?.length ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-800 pt-3">{message.study.citations.map(citation => <button key={citation.id} className="suggestion-chip text-xs" onClick={() => openCitation(citation)}>{citation.id} · {citation.title}</button>)}</div> : null}</>,
  };
  return <ResearchAssistantModal settings={settings} embedded adapter={adapter} initialTarget={initialTarget} initialConversationTarget={conversationTarget} notesDestinationLabel="Nodus Scriptor" studyNoteDestination={{ onOpenSavedDocument: onOpenDocument }} onOpenSavedNote={onOpenSavedNote} />;
}

/**
 * Study's own organization as the history's notebook-equivalent: Courses → Subjects →
 * Topics, reused rather than duplicated. A chat lives in the course its scope reads (a
 * subject or topic scope reads inside its course); the history search also matches a
 * course by its subjects and topics.
 */
function useStudyCourses() {
  const [workspace, setWorkspace] = useState<Pick<StudyWorkspace, 'courses' | 'subjects' | 'topics'> | null>(null);
  const refresh = useCallback(() => {
    void window.nodus.getStudyWorkspace().then(({ courses, subjects, topics }) => setWorkspace({ courses, subjects, topics })).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, refresh);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, refresh);
  }, [refresh]);
  return useMemo(() => {
    const live = <T extends { archivedAt: string | null; deletedAt: string | null }>(items: T[]) => items.filter(item => !item.archivedAt && !item.deletedAt);
    const courses = live(workspace?.courses ?? []);
    const subjects = live(workspace?.subjects ?? []);
    const topics = live(workspace?.topics ?? []);
    const subjectCourse = new Map(subjects.map(subject => [subject.id, subject.courseId]));
    const topicSubject = new Map(topics.map(topic => [topic.id, topic.subjectId]));
    const courseIds = new Set(courses.map(course => course.id));
    const courseOf = (selection: StudyAssistantSelection): string | null => {
      if (!['course', 'subject', 'topic'].includes(selection.scope)) return null;
      const subjectId = selection.subjectId ?? (selection.topicId ? topicSubject.get(selection.topicId) : undefined) ?? null;
      const courseId = selection.courseId ?? (subjectId ? subjectCourse.get(subjectId) : undefined) ?? null;
      return courseId && courseIds.has(courseId) ? courseId : null;
    };
    const entries = courses.map(course => {
      const own = subjects.filter(subject => subject.courseId === course.id);
      const ownIds = new Set(own.map(subject => subject.id));
      return { id: course.id, name: course.name, color: course.color, keywords: [...own.map(subject => subject.name), ...topics.filter(topic => ownIds.has(topic.subjectId)).map(topic => topic.name)].join(' ') };
    });
    return { entries, courseOf };
  }, [workspace]);
}
