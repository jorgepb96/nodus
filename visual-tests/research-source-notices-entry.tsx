import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchMarkdown } from '../src/components/ResearchSourceNotice';
import { researchSourcePresentation } from '../shared/researchSourceNotices';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';
setActiveLang('es');
const body = 'La campaña promovía una imagen del país. Su recepción no demuestra por sí sola que cambiara la opinión de todos los visitantes.';
const note = '**Nota sobre la evidencia disponible:** los pasajes recuperados no ofrecen un análisis comparado. Para profundizar, convendría indexar más fuentes.';
const original = `${body}\n\n${note}`;
function Fixture() {
  const [copied, setCopied] = useState('');
  return <main className="mx-auto max-w-xl p-5 text-neutral-200"><article className="rounded-lg border border-neutral-700 bg-neutral-900 p-4"><ResearchMarkdown content={original} /><button className="mt-4" onClick={() => setCopied(researchSourcePresentation(original).content)}>Copiar</button></article><output data-testid="copied">{copied}</output><article className="mt-4" data-testid="no-notice"><ResearchMarkdown content={body} /></article></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
