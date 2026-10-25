import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchHarnessControl, type ResearchHarnessOptions } from '../src/components/ResearchHarnessControl';
import { ResearchHarnessPanel } from '../src/components/ResearchHarnessPanel';
import type { ResearchRunSummary } from '../shared/researchHarness';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';

const listeners = new Set<(run: ResearchRunSummary) => void>();
let run: ResearchRunSummary = { id: 'run-fixture', version: 'v1', mode: 'chat', conversationId: 'chat-fixture', objective: 'Contrastar las interpretaciones sobre los relatos de viaje', status: 'running',
  questions: [{ question: '¿Qué evidencia distingue las dos interpretaciones?', status: 'partial', evidenceIds: ['source-fixture'], relation: 'contrast',
    purpose: 'Contrastar explicaciones alternativas para responder a la pregunta original sin asumir que los autores están de acuerdo.' }],
  tasks: [{ id: 'task-1', question: 'Consultar una posición alternativa', action: { action: 'search', query: 'relato de viaje contraste' }, priority: 3, status: 'pending', evidenceIds: [] }],
  usage: { rounds: 3, evidenceBytes: 2000, decisionBytes: 6000, modelCalls: 4 }, updatedAt: '2026-10-18' };
const emit = () => listeners.forEach(listener => listener(structuredClone(run)));
window.nodus = {
  listResearchRuns: async () => [run], onResearchRun: (listener: (run: ResearchRunSummary) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  pauseResearchRun: async () => { run = { ...run, status: 'paused', stopReason: 'interrupted' }; emit(); return run; },
  resumeResearchRun: async () => { run = { ...run, status: 'completed', stopReason: 'sufficient' }; emit(); return { mode: 'chat' }; },
  cancelResearchRun: async () => { run = { ...run, status: 'cancelled', stopReason: 'interrupted' }; emit(); return run; },
} as unknown as typeof window.nodus;
setActiveLang('es');
function Fixture() {
  const version = 'v1' as const;
  const [exploration, onExploration] = useState<ResearchHarnessOptions['exploration']>('fast');
  const [web, onWeb] = useState<ResearchHarnessOptions['web']>('off');
  return <main className="mx-auto max-w-2xl p-4 text-neutral-900 dark:text-neutral-100">
    <h1 className="mb-4 text-lg">Nodus Research Harness</h1>
    <ResearchHarnessControl options={{ version, web, onWeb, exploration, onExploration }} web />
    <ResearchHarnessPanel mode="chat" conversationId="chat-fixture" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
