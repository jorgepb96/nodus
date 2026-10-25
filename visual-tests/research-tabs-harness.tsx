import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeepResearchView } from '../src/views/DeepResearchView';
import { DictionaryView } from '../src/views/DictionaryView';
import { normalizeUiLanguage } from '../shared/uiLanguage';
import { ImmersionView } from '../src/views/ImmersionView';
import { AudioPlayerProvider } from '../src/components/AudioPlayer';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';

// Deterministic local fixtures: the production views render unchanged; only IPC is replaced.
const params = new URLSearchParams(location.search);
const language = normalizeUiLanguage(params.get('lang') ?? 'es');
const date = '2026-09-05T09:00:00Z';
const settings = { uiLanguage: language, imageStyle: 'antique_book', synthesisModel: null, ...(params.get('harness') === 'v1' ? { researchHarnessVersion: 'v1' } : {}) } as any;
const titles = ['Memoria colectiva y archivos digitales', 'Patrimonio, territorio e identidad', 'La historia oral como fuente'];
const sections = ['Introducción', 'El archivo como espacio de memoria', 'Comunidades y participación', 'Conclusiones'];
const paragraphs = [
  'La memoria colectiva se construye a través de relatos, documentos y prácticas compartidas. Los archivos digitales amplían el acceso a estas fuentes y permiten estudiar cómo una comunidad interpreta su pasado.',
  'La selección y descripción de los documentos influyen en aquello que permanece visible. Examinar los criterios de conservación ayuda a reconocer las voces presentes en el archivo y las ausencias que requieren una lectura crítica.',
  'Las iniciativas participativas conectan testimonios personales con colecciones institucionales. El diálogo entre ambas escalas ofrece nuevas preguntas sobre la transmisión de la memoria, el patrimonio y la identidad.',
];
let drafts = titles.map((title, index) => ({
  id: `report-${index}`, title, image: null, model: null, readAt: null, createdAt: date, updatedAt: date,
  brief: { kind: 'deep_research', objective: title, language: 'es' }, selection: {},
  draft: { title, abstract: 'Una aproximación a las relaciones entre memoria, archivos y participación a partir de las fuentes del corpus.',
    draftMarkdown: sections.map((heading) => `## ${heading}\n\n${paragraphs.join('\n\n')}`).join('\n\n'),
    outline: sections.map((title, index) => ({ id: String(index), title, purpose: '', sources: [] })), matrix: [], bibliography: [], nextSteps: [], limitations: [],
    stats: { selectedIdeas: 18, selectedWorks: 12, selectedPassages: 36, selectedGaps: 0, contextChars: 24500 } },
}));
const stationTitles = ['Memoria e identidad', 'La construcción del archivo', 'Voces y silencios'];
let sessions = titles.map((title, index) => ({
  id: `session-${index}`, topic: title, language: 'es', minutes: 150, model: null, image: null, createdAt: date, updatedAt: date,
  progress: { currentStep: 0, furthestStep: 0, completedSteps: [], answers: [], startedAt: date, finishedAt: null },
  plan: { title, topic: title, language: 'es', minutes: 150, generatedAt: date, model: null,
    overview: paragraphs.join('\n\n'),
    keyTerms: [{ term: 'Memoria colectiva', definition: 'Relatos y prácticas mediante los que un grupo interpreta y transmite su pasado.' }, { term: 'Archivo participativo', definition: 'Colección que incorpora la descripción y los testimonios de la comunidad.' }],
    stations: stationTitles.map((name, i) => ({ id: `station-${i}`, title: name, question: '¿Cómo se relacionan las fuentes con la experiencia colectiva?', ideaIds: [], citations: [], positions: [], takeaways: [], quiz: [], synthesis: paragraphs.join('\n\n'), context: '' })),
    contrasts: { authors: [], rows: [] }, frontiers: [], exam: { questions: [], feynman: 'Explica cómo un archivo contribuye a construir la memoria colectiva.' },
    graph: { nodes: [], edges: [] }, ideaIndex: [], stoppedReason: null,
    stats: { stations: 3, ideas: 18, works: 12, authors: 8, citations: 24, quizQuestions: 0 },
  },
}));
const listeners = new Set<() => void>();
const api = {
  getSettings: async () => settings,
  getActiveVault: async () => ({ id: 'visual-academic', type: 'academic', name: 'Visual fixture' }),
  scanChangedDictionaryEntries: async () => [],
  updateSettings: async (patch: any) => { Object.assign(settings, { ...patch, researchExplorationByMode: { ...settings.researchExplorationByMode, ...patch.researchExplorationByMode } }); return settings; },
  listDictionaryEntries: async () => ({ items: [], total: 0, hasMore: false }),
  listDictionaryFacets: async () => ({ letters: [], tags: [], authors: [], works: [] }),
  getAudioSegments: async () => [],
  listWritingWorkshopDrafts: async () => drafts,
  listDeepResearchJobs: async () => [],
  onWritingDraftsChanged: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  listImmersionSessions: async () => sessions.map((s) => ({ ...s, title: s.plan.title, stats: s.plan.stats, finished: !!s.progress.finishedAt, progressPct: Math.round(s.progress.completedSteps.length / 7 * 100) })),
  getImmersionSession: async (id: string) => structuredClone(sessions.find((s) => s.id === id) ?? null),
  setImmersionProgress: async (id: string, progress: any) => { sessions = sessions.map((s) => s.id === id ? { ...s, progress } : s); },
};
window.nodus = new Proxy(api, { get(target, key: string) {
  if (key in target) return target[key as keyof typeof target];
  if (key.startsWith('on')) return () => () => {};
  if (key.startsWith('list')) return async () => [];
  return async () => null;
} }) as any;
(window as any).removeReport = (id: string) => { drafts = drafts.filter((d) => d.id !== id); listeners.forEach((fn) => fn()); };
(window as any).snapshots = {};
function Harness() {
  const immersion = new URLSearchParams(location.search).get('section') === 'immersion';
  const [revision, setRevision] = useState(0);
  (window as any).remount = () => new Promise<void>((resolve) => {
    setRevision((n) => n + 1);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  const section = immersion ? 'immersion' : 'research';
  return <AudioPlayerProvider><main className="h-full min-h-0 flex flex-col bg-neutral-950 text-neutral-100" key={revision}>
    {params.get('section') === 'dictionary' ? <DictionaryView settings={settings} onOpenIdea={() => {}} onOpenAuthor={() => {}} onOpenLibraryWork={() => {}} /> : immersion
      ? <ImmersionView settings={settings} snapshot={(window as any).snapshots[section]} onSnapshotChange={(patch) => { (window as any).snapshots[section] = { ...(window as any).snapshots[section], ...patch }; }} />
      : <DeepResearchView settings={settings} snapshot={(window as any).snapshots[section]} onSnapshotChange={(patch) => { (window as any).snapshots[section] = { ...(window as any).snapshots[section], ...patch }; }} />}
  </main></AudioPlayerProvider>;
}
setActiveLang(language);
document.documentElement.classList.add(params.get('theme') === 'light' ? 'light' : 'dark');
createRoot(document.getElementById('root')!).render(<Harness />);
