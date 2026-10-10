import { getDocumentVisuals } from '../ai/documentVisuals';
import { documentFigureInsertions, readyDocumentFigures, figureHtml } from '@shared/documentFigureExport';
import type { DocumentVisualManifest } from '@shared/documentSkills';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { DecorativeImageSource, ImmersionCitation, ImmersionSession } from '@shared/types';
import { escapeHtml } from '@shared/toolkitMarkdown';
import { zoteroSelectUrl } from '@shared/pageLocation';
import { getDecorativeImage, getDecorativeImageData } from '../db/decorativeImagesRepo';
import {
  PROFESSIONAL_REPORT_THEMES,
  anchoredMarkdown,
  professionalReportPdf,
  reportLink,
  type ProfessionalReportInput,
  type ProfessionalReportSection,
} from './professionalReportPdf';

interface ImmersionReportLabels {
  kind: string;
  contents: string;
  generated: string;
  objective: string;
  overview: string;
  overviewEyebrow: string;
  vocabulary: string;
  vocabularyEyebrow: string;
  station: string;
  stationEyebrow: string;
  guidingQuestion: string;
  guidedReading: string;
  positions: string;
  takeaways: string;
  whyItMatters: string;
  commentary: string;
  contrasts: string;
  contrastsEyebrow: string;
  frontiers: string;
  frontiersEyebrow: string;
  feynman: string;
  feynmanEyebrow: string;
  sources: string;
  sourcesEyebrow: string;
  zotero: string;
  minutes: string;
  stations: string;
  works: string;
  imageAi: string;
  imageCustom: string;
  saveTitle: string;
}

// PDF scaffolding currently has Spanish and English copy; the authored content
// and the document's language tag retain the session's actual prompt language.
const LABELS: Record<'es' | 'en', ImmersionReportLabels> = {
  es: {
    kind: 'Dossier profesional · Inmersión',
    contents: 'Contenido',
    generated: 'Generado',
    objective: 'Tema',
    overview: 'Panorama',
    overviewEyebrow: 'Mapa de orientación',
    vocabulary: 'Vocabulario esencial',
    vocabularyEyebrow: 'Conceptos clave',
    station: 'Estación',
    stationEyebrow: 'Itinerario de aprendizaje',
    guidingQuestion: 'Pregunta guía',
    guidedReading: 'Lectura guiada',
    positions: 'Posiciones',
    takeaways: 'Para retener',
    whyItMatters: 'Por qué importa',
    commentary: 'Comentario',
    contrasts: 'Matriz de contrastes',
    contrastsEyebrow: 'Perspectivas comparadas',
    frontiers: 'Fronteras del corpus',
    frontiersEyebrow: 'Límites y oportunidades',
    feynman: 'Cierre Feynman',
    feynmanEyebrow: 'Síntesis personal',
    sources: 'Fuentes y enlaces',
    sourcesEyebrow: 'Trazabilidad',
    zotero: 'Abrir en Zotero',
    minutes: 'minutos',
    stations: 'estaciones',
    works: 'obras',
    imageAi: 'Imagen de portada generada por IA en Nodus.',
    imageCustom: 'Imagen de portada aportada por el usuario.',
    saveTitle: 'Exportar inmersión como PDF',
  },
  en: {
    kind: 'Professional dossier · Immersion',
    contents: 'Contents',
    generated: 'Generated',
    objective: 'Topic',
    overview: 'Overview',
    overviewEyebrow: 'Orientation map',
    vocabulary: 'Essential vocabulary',
    vocabularyEyebrow: 'Key concepts',
    station: 'Station',
    stationEyebrow: 'Learning route',
    guidingQuestion: 'Guiding question',
    guidedReading: 'Guided reading',
    positions: 'Positions',
    takeaways: 'Key takeaways',
    whyItMatters: 'Why it matters',
    commentary: 'Commentary',
    contrasts: 'Contrast matrix',
    contrastsEyebrow: 'Compared perspectives',
    frontiers: 'Corpus frontiers',
    frontiersEyebrow: 'Limits and opportunities',
    feynman: 'Feynman close',
    feynmanEyebrow: 'Personal synthesis',
    sources: 'Sources and links',
    sourcesEyebrow: 'Traceability',
    zotero: 'Open in Zotero',
    minutes: 'minutes',
    stations: 'stations',
    works: 'works',
    imageAi: 'Cover image generated with AI in Nodus.',
    imageCustom: 'Cover image provided by the user.',
    saveTitle: 'Export immersion as PDF',
  },
};

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return clean || 'inmersion';
}

function localizedDate(iso: string, language: ImmersionSession['language']): string {
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function imageCredit(source: DecorativeImageSource | null, labels: ImmersionReportLabels): string | null {
  if (source === 'ai') return labels.imageAi;
  if (source === 'custom') return labels.imageCustom;
  return null;
}

function reportImage(session: ImmersionSession, labels: ImmersionReportLabels): { dataUrl: string | null; credit: string | null } {
  const meta = getDecorativeImage('immersion', session.id);
  const data = getDecorativeImageData('immersion', session.id);
  if (!meta || meta.status !== 'ready' || !data) return { dataUrl: null, credit: null };
  return {
    dataUrl: `data:${data.mimeType};base64,${data.bytes.toString('base64')}`,
    credit: imageCredit(meta.source, labels),
  };
}

function citationLabel(citation: ImmersionCitation): string {
  return [
    citation.workTitle,
    citation.authors.slice(0, 3).join(', '),
    citation.year ? String(citation.year) : '',
    citation.pageLabel ? `p. ${citation.pageLabel}` : '',
  ].filter(Boolean).join(' · ');
}

function citationHtml(citation: ImmersionCitation, labels: ImmersionReportLabels): string {
  const source = reportLink(`nodus://passage/${encodeURIComponent(citation.passageId)}`, citationLabel(citation));
  const zotero = citation.zoteroKey
    ? ` · ${reportLink(zoteroSelectUrl(citation.zoteroKey), labels.zotero)}`
    : '';
  return `<article class="source-card">
    <blockquote>“${escapeHtml(citation.text.trim())}”</blockquote>
    <footer>${source}${zotero}</footer>
    ${citation.whyItMatters ? `<p class="commentary"><strong>${escapeHtml(labels.whyItMatters)}.</strong> ${escapeHtml(citation.whyItMatters)}</p>` : ''}
    ${citation.commentary ? `<p class="commentary"><strong>${escapeHtml(labels.commentary)}.</strong> ${escapeHtml(citation.commentary)}</p>` : ''}
  </article>`;
}

function stationHtml(session: ImmersionSession, index: number, labels: ImmersionReportLabels, visuals?: DocumentVisualManifest | null): { html: string; headings: ReturnType<typeof anchoredMarkdown>['headings'] } {
  const station = session.plan.stations[index];
  const synthesis = anchoredMarkdown(station.synthesis, `station-${index + 1}`, documentFigureInsertions(station.synthesis, `station-${station.id}-synthesis`, visuals));
  const readings = station.citations.length
    ? `<h3>${escapeHtml(labels.guidedReading)}</h3>${station.citations.map((citation) => citationHtml(citation, labels)).join('')}`
    : '';
  const positions = station.positions.length
    ? `<h3>${escapeHtml(labels.positions)}</h3><div class="evidence-grid">${station.positions.map((position) =>
        `<article class="evidence-card"><span>${escapeHtml(labels.positions)}</span><h3>${escapeHtml(position.name)}</h3><div>${escapeHtml(position.position)}</div></article>`
      ).join('')}</div>`
    : '';
  const takeaways = station.takeaways.length
    ? `<aside class="takeaway-list"><h3>${escapeHtml(labels.takeaways)}</h3><ul>${station.takeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></aside>`
    : '';
  return {
    html: `<div class="question-box"><small>${escapeHtml(labels.guidingQuestion)}</small><p>${escapeHtml(station.question)}</p></div>
      ${station.context ? `<div class="prose">${anchoredMarkdown(station.context, `context-${index}`, documentFigureInsertions(station.context, `station-${station.id}-context`, visuals)).html}</div>` : ''}
      <div class="prose">${synthesis.html}</div>
      ${readings}${positions}${takeaways}`,
    headings: synthesis.headings,
  };
}

function contrastHtml(session: ImmersionSession): string {
  const { authors, rows } = session.plan.contrasts;
  if (!authors.length || !rows.length) return '';
  return `<table><thead><tr><th></th>${authors.map((author) => `<th>${escapeHtml(author)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.question)}</th>${row.cells.map((cell) => `<td>${escapeHtml(cell.stance || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function frontiersHtml(session: ImmersionSession): string {
  return `<div class="evidence-grid">${session.plan.frontiers.map((frontier) =>
    `<article class="evidence-card"><span>${escapeHtml(frontier.kind.replace('_', ' '))}</span><h3>${escapeHtml(frontier.statement)}</h3>${frontier.detail ? `<div>${escapeHtml(frontier.detail)}</div>` : ''}${frontier.workTitle ? `<div class="muted" style="margin-top:2mm">${escapeHtml(frontier.workTitle)}</div>` : ''}</article>`
  ).join('')}</div>`;
}

function sourcesHtml(session: ImmersionSession, labels: ImmersionReportLabels): string {
  const seen = new Set<string>();
  const sources = session.plan.stations.flatMap((station) => station.citations).filter((citation) => {
    const key = citation.passageId || `${citation.workId}:${citation.pageLabel ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return `<ol class="reference-list">${sources.map((citation) => {
    const passage = reportLink(`nodus://passage/${encodeURIComponent(citation.passageId)}`, citationLabel(citation));
    const zotero = citation.zoteroKey ? ` · ${reportLink(zoteroSelectUrl(citation.zoteroKey), labels.zotero)}` : '';
    return `<li>${passage}${zotero}</li>`;
  }).join('')}</ol>`;
}

/** Structured report model shared by the save-dialog exporter and PDF visual tests. */
export function buildImmersionPdfInput(session: ImmersionSession, imageOverride?: { dataUrl: string | null; credit: string | null }): ProfessionalReportInput {
  let visuals: DocumentVisualManifest | null = null;
  try { visuals = getDocumentVisuals({ kind: 'immersion', id: session.id }); } catch { /* Unsaved export fixtures have no local manifest. */ }
  const labels = LABELS[session.language === 'es' ? 'es' : 'en'];
  const image = imageOverride ?? reportImage(session, labels);
  const overview = anchoredMarkdown(session.plan.overview, 'overview', documentFigureInsertions(session.plan.overview, 'overview', visuals));
  const sections: ProfessionalReportSection[] = [
    {
      id: 'overview',
      number: '01',
      title: labels.overview,
      eyebrow: labels.overviewEyebrow,
      html: `<div class="prose">${overview.html}</div>`,
      tocChildren: overview.headings,
    },
  ];
  if (session.plan.keyTerms.length) {
    sections.push({
      id: 'vocabulary',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.vocabulary,
      eyebrow: labels.vocabularyEyebrow,
      html: `<div class="term-grid">${session.plan.keyTerms.map((term) =>
        `<article class="term-card"><h3>${escapeHtml(term.term)}</h3><p>${escapeHtml(term.definition)}</p></article>`
      ).join('')}</div>`,
    });
  }
  session.plan.stations.forEach((station, index) => {
    const content = stationHtml(session, index, labels, visuals);
    sections.push({
      id: `station-${index + 1}`,
      number: String(sections.length + 1).padStart(2, '0'),
      title: `${labels.station} ${index + 1} · ${station.title}`,
      eyebrow: labels.stationEyebrow,
      lead: station.question,
      html: content.html,
      tocChildren: content.headings,
      pageBreakBefore: true,
    });
  });
  if (session.plan.contrasts.authors.length && session.plan.contrasts.rows.length) {
    sections.push({
      id: 'contrasts',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.contrasts,
      eyebrow: labels.contrastsEyebrow,
      html: contrastHtml(session) + readyDocumentFigures(visuals).filter(figure => visuals?.blocks.some(block => block.field === 'contrasts' && block.id === figure.blockId)).map(figure => figureHtml(figure, readyDocumentFigures(visuals).indexOf(figure)+1)).join(''),
      pageBreakBefore: true,
    });
  }
  if (session.plan.frontiers.length) {
    sections.push({
      id: 'frontiers',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.frontiers,
      eyebrow: labels.frontiersEyebrow,
      html: frontiersHtml(session),
    });
  }
  if (session.plan.exam.feynman) {
    sections.push({
      id: 'feynman-close',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.feynman,
      eyebrow: labels.feynmanEyebrow,
      html: `<div class="abstract-box prose"><p>${escapeHtml(session.plan.exam.feynman)}</p></div>`,
    });
  }
  const sourceCount = new Set(session.plan.stations.flatMap((station) => station.citations.map((citation) => citation.passageId))).size;
  if (sourceCount) {
    sections.push({
      id: 'sources',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.sources,
      eyebrow: labels.sourcesEyebrow,
      html: sourcesHtml(session, labels),
      pageBreakBefore: true,
    });
  }
  return {
    title: session.plan.title,
    subtitle: session.topic,
    kindLabel: labels.kind,
    language: session.language,
    generatedLabel: labels.generated,
    generatedAt: localizedDate(session.plan.generatedAt || session.createdAt, session.language),
    objectiveLabel: labels.objective,
    objective: session.topic,
    imageDataUrl: image.dataUrl,
    imageCredit: image.credit,
    contentsLabel: labels.contents,
    metrics: [
      { value: String(session.minutes), label: labels.minutes },
      { value: String(session.plan.stats.stations), label: labels.stations },
      { value: String(session.plan.stats.works), label: labels.works },
    ],
    sections,
    theme: PROFESSIONAL_REPORT_THEMES.immersion,
  };
}

export async function exportImmersionSessionPdf(session: ImmersionSession): Promise<{ path: string } | null> {
  const labels = LABELS[session.language === 'es' ? 'es' : 'en'];
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: labels.saveTitle,
    defaultPath: path.join(app.getPath('documents'), `${slug(session.plan.title)}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, await professionalReportPdf(buildImmersionPdfInput(session)));
  return { path: filePath };
}
