import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { StudyEditor } from '../../src/components/editor/StudyEditor';
import { DEFAULT_STUDY_DOC_STYLE } from '../../shared/studyEditor';
import { markdownToBlockNote } from '../../shared/blockNoteDocument';
import type { AppSettings } from '../../shared/types';
import type { StudyDocEditorData } from '../../shared/studyEditor';
import type { EditorDocumentPort } from '../../src/components/editor/documentPort';
import { setActiveLang } from '../../src/i18n';
import '../../src/index.css';

setActiveLang('es');
const settings = { sttProvider: 'openai', sttWhisperCppModel: 'base', sttTransformersModel: 'Xenova/whisper-tiny', studyImproveToolbarStyleIds: [], favoriteModels: [], uiLanguage: 'es' } as unknown as AppSettings;
const documents = [
  { id: 'dictation-a', title: 'Dictado en Scriptor', contentMarkdown: 'Texto original.', favorite: false },
  { id: 'dictation-b', title: 'Segundo documento', contentMarkdown: 'Otro documento.', favorite: false },
];
const data = new Map(documents.map(doc => [doc.id, {
  documentTitle: doc.title, contentMarkdown: doc.contentMarkdown, nativeDocument: markdownToBlockNote(doc.contentMarkdown),
  revision: 0, versions: [], annotations: [], outgoingLinks: [], backlinks: [], style: DEFAULT_STUDY_DOC_STYLE,
  spellcheckLanguage: 'es-ES', customDictionary: [],
} as StudyDocEditorData]));
let flush: (() => Promise<boolean>) | undefined;
const qa = { calls: [] as Array<Record<string, unknown>>, cancelled: [] as string[], delay: 60, micDelay: 0, noModels: false, real: false, fail: false, denied: false, releasedTracks: 0, streams: [] as MediaStream[] };
const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async constraints => {
  if (qa.denied) throw new DOMException('Permission denied', 'NotAllowedError');
  const stream = await getUserMedia(constraints);
  qa.streams.push(stream);
  stream.getTracks().forEach(track => {
    const stop = track.stop.bind(track);
    track.stop = () => { qa.releasedTracks++; stop(); };
  });
  if (qa.micDelay) await new Promise(resolve => setTimeout(resolve, qa.micDelay));
  return stream;
};
Object.assign(window, { dictationQa: qa, dictationSaved: data, dictationFlush: () => flush?.() });
localStorage.setItem('nodus.micPrivacyAcknowledged', '1');
Object.defineProperty(window, 'nodus', { value: {
  getSettings: async () => settings,
  getActiveVault: async () => ({ id: 'dictation-qa' }),
  listStudyStyles: async () => [],
  onBeforeEditorLeave: () => () => {},
  listEditorReferences: async () => [],
  getWhisperCppStatus: async () => ({ executableReady: !qa.noModels, executablePath: 'whisper-cli', models: [{ id: 'base', downloaded: !qa.noModels }] }),
  cancelStudyTranscription: async (id: string) => { qa.cancelled.push(id); },
  transcribeStudyAudio: async (request: Record<string, any>, handlers: { onPartial?(text: string): void }) => {
    if (!request.audioBytes.byteLength) return { text: '', provider: 'whisper_cpp', model: 'base' };
    qa.calls.push({ provider: request.provider, model: request.model, requestId: request.requestId, bytes: request.audioBytes.byteLength });
    if (request.provider !== 'whisper_cpp') throw new Error('Live dictation used a cloud provider');
    if (qa.fail) throw new Error('Controlled model failure');
    const count = qa.calls.length;
    const growing = 'Primera frase dictada mientras sigo hablando sin puntos artificiales';
    const words = growing.split(' ').slice(0, Math.max(1, Math.min(growing.split(' ').length, count * 2))).join(' ');
    handlers.onPartial?.(words);
    let text: string;
    if (qa.real) text = await (window as any).transcribeRealDictation({ bytes: Array.from(request.audioBytes), language: request.language });
    else { await new Promise(resolve => setTimeout(resolve, qa.delay)); text = `${words}. [Música] [Música de cierre]`; }
    return { text, provider: 'whisper_cpp', model: 'base', chunks: [] };
  },
} });
const port: EditorDocumentPort = {
  referenceKind: 'note', dragType: 'dictation-test', linkHref: id => `nodus://note/${id}`,
  loadEditorData: async id => structuredClone(data.get(id)!),
  save: async (id, input) => {
    const current = data.get(id)!;
    Object.assign(current, input, { revision: current.revision! + 1 });
    return { ...documents.find(doc => doc.id === id)!, editorRevision: current.revision };
  },
  listLinkTargets: async () => [], listReferences: async () => [], improveTarget: id => ({ noteId: id }),
  createAnnotation: async () => { throw new Error('Unused'); }, updateAnnotation: async () => null,
  restoreVersion: async () => { throw new Error('Unused'); },
};
function Fixture() {
  const [activeId, setActiveId] = useState(documents[0].id);
  return <StudyEditor settings={settings} documents={documents} activeId={activeId} subjectId={null} port={port}
    onActivate={setActiveId} onSaved={() => {}} onClose={() => {}} onDuplicate={async () => {}} onTrash={async () => {}}
    onOpenLinkedDocument={setActiveId} onRegisterFlush={value => { flush = value; }} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
