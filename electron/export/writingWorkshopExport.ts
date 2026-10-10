import { getDocumentVisuals } from '../ai/documentVisuals';
import { dialogTitle } from '../dialogTitles';
import { documentMarkdownWithFigures } from '@shared/documentFigureExport';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type {
  DecorativeImageSource,
  DeepResearchArchiveRequest,
  DeepResearchArchiveResult,
  WritingWorkshopDraft,
  WritingWorkshopExportFormat,
  WritingWorkshopExportRequest,
  WritingWorkshopMatrixRow,
  WritingWorkshopSavedDraft,
} from '@shared/types';
import { stripLeadingAbstract } from '@shared/writingDocument';
import { DEEP_LABELS, deepResearchReportInput, type DeepReportLabels } from '@shared/deepResearchReport';
import { markdownToPdf } from './markdownRender';
import { markdownToDocx, pngSize, type DocxImage } from './markdownDocx';
import { getDecorativeImage, getDecorativeImageData } from '../db/decorativeImagesRepo';
import { getWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { professionalReportPdf, type ProfessionalReportInput } from './professionalReportPdf';
import { getSettings } from '../db/settingsRepo';
import { renderCompleteGuideFiles } from './completeGuideExport';


export async function exportWritingWorkshopDraft(
  request: WritingWorkshopExportRequest
): Promise<{ path: string } | null> {
  const draft = request.draft;
  const requested = request.format ?? 'markdown';
  const cheatSheet = Boolean(draft.completeGuide) && request.part === 'cheatsheet';
  const base = `${slug(draft.title || 'taller-escritura')}${cheatSheet ? '-ficha' : ''}`;
  const extension = requested === 'pdf' ? 'pdf' : requested === 'docx' ? 'docx' : 'md';
  const filters: Record<WritingWorkshopExportFormat, { name: string; extensions: string[] }> = {
    markdown: { name: 'Markdown', extensions: ['md'] },
    pdf: { name: 'PDF', extensions: ['pdf'] },
    docx: { name: 'Word', extensions: ['docx'] },
  };
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: dialogTitle('exportReport', getSettings().uiLanguage),
    defaultPath: path.join(app.getPath('documents'), `${base}.${extension}`),
    // Offer every format so the user can switch in the native dialog; the final
    // format is decided by the chosen extension (falling back to `requested`).
    filters: [filters[requested], ...Object.entries(filters).filter(([key]) => key !== requested).map(([, filter]) => filter)],
  });
  if (canceled || !filePath) return null;

  const chosen = path.extname(filePath).toLowerCase();
  const format: WritingWorkshopExportFormat = chosen === '.pdf' ? 'pdf' : chosen === '.docx' ? 'docx' : 'markdown';
  if (draft.completeGuide) {
    // Complete study guides have their own document model (callouts, math, tables).
    const fileBase = path.basename(filePath, path.extname(filePath));
    const files = await renderCompleteGuideFiles(draft, {
      format, part: cheatSheet ? 'cheatsheet' : 'full', entityId: request.entityId, base: fileBase,
      image: reportImage(request.entityId, DEEP_LABELS[draft.brief.language ?? 'es']),
    });
    for (const file of files) {
      const target = path.join(path.dirname(filePath), file.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.bytes);
    }
    return { path: filePath };
  }
  const visuals = request.entityId ? getDocumentVisuals({ kind: 'deep-research', id: request.entityId }) : null;
  const assetDirectory = `${path.basename(filePath, path.extname(filePath))}-assets`;
  const enriched = documentMarkdownWithFigures(renderDraftMarkdown(draft), 'body', visuals, assetDirectory);
  const markdown = enriched.markdown;
  if (format === 'pdf') {
    const bytes = draft.brief.kind === 'deep_research'
      ? await professionalReportPdf(buildDeepResearchPdfInput(draft, request.entityId))
      : await markdownToPdf(markdown, draft.title || 'Informe');
    fs.writeFileSync(filePath, bytes);
  } else if (format === 'docx') {
    // The figures travel inside the document, so nothing is left beside it.
    fs.writeFileSync(filePath, await markdownToDocx(markdown, { resolveImage: figureResolver(enriched.files) }));
  } else {
    if (enriched.files.length) {
      const dir = path.join(path.dirname(filePath), assetDirectory); fs.mkdirSync(dir, { recursive: true });
      for (const file of enriched.files) fs.writeFileSync(path.join(dir, file.name), Buffer.from(file.base64, 'base64'));
    }
    fs.writeFileSync(filePath, markdown, 'utf8');
  }
  return { path: filePath };
}

/**
 * The figures a report carries are separate assets referenced by name from its
 * Markdown, so a Word export resolves each `![…](dir/figure-x.png)` back to the
 * bytes the manifest produced and embeds them.
 */
function figureResolver(files: Array<{ name: string; base64: string }>): (url: string) => DocxImage | null {
  const byName = new Map(files.map((file) => [file.name, Buffer.from(file.base64, 'base64')]));
  return (url) => {
    const name = decodeURIComponent(url.split('/').pop() ?? '');
    const data = byName.get(name);
    if (!data) return null;
    const size = pngSize(data);
    return size ? { data, width: size.width, height: size.height } : null;
  };
}

/** One report rendered to bytes, in every requested format. */
export async function renderSavedWritingFiles(
  saved: WritingWorkshopSavedDraft,
  base: string,
  format: DeepResearchArchiveRequest['format'],
  includeCheatSheets = false,
): Promise<{ name: string; bytes: Buffer }[]> {
  const entries: { name: string; bytes: Buffer }[] = [];
  if (saved.draft.completeGuide) {
    const image = reportImage(saved.id, DEEP_LABELS[saved.draft.brief.language ?? 'es']);
    const formats: WritingWorkshopExportFormat[] = format === 'both' ? ['markdown', 'pdf'] : [format ?? 'markdown'];
    for (const each of formats) {
      entries.push(...await renderCompleteGuideFiles(saved.draft, { format: each, entityId: saved.id, base, image }));
      if (includeCheatSheets && saved.draft.completeGuide.cheatSheetMarkdown) {
        entries.push(...await renderCompleteGuideFiles(saved.draft, { format: each, part: 'cheatsheet', base: `${base}-ficha` }));
      }
    }
    return entries;
  }
  if (format === 'markdown' || format === 'both') {
    const enriched = documentMarkdownWithFigures(renderDraftMarkdown(saved.draft), 'body', getDocumentVisuals({ kind: 'deep-research', id: saved.id }), `${base}-assets`);
    entries.push({ name: `${base}.md`, bytes: Buffer.from(enriched.markdown, 'utf8') });
    for (const file of enriched.files) entries.push({ name: `${base}-assets/${file.name}`, bytes: Buffer.from(file.base64, 'base64') });
  }
  if (format === 'pdf' || format === 'both') {
    const bytes = saved.draft.brief.kind === 'deep_research'
      ? await professionalReportPdf(buildDeepResearchPdfInput(saved.draft, saved.id))
      : await markdownToPdf(renderDraftMarkdown(saved.draft), saved.draft.title || 'Informe');
    entries.push({ name: `${base}.pdf`, bytes });
  }
  if (format === 'docx') {
    const enriched = documentMarkdownWithFigures(renderDraftMarkdown(saved.draft), 'body', getDocumentVisuals({ kind: 'deep-research', id: saved.id }), `${base}-assets`);
    entries.push({ name: `${base}.docx`, bytes: await markdownToDocx(enriched.markdown, { resolveImage: figureResolver(enriched.files) }) });
  }
  return entries;
}

/**
 * Download a batch of saved reports as one zip.
 *
 * Rendered one report at a time on purpose: a PDF is printed by a real Chromium
 * window (see htmlToPdf.ts), and the deferred teardown that makes repeated exports
 * reliable only holds if the next print starts after the previous one let go. The
 * `onProgress` callback exists because that serial pass can run for a minute over a
 * large selection, and a silent minute reads as a hang.
 */
export async function exportDeepResearchArchive(
  request: DeepResearchArchiveRequest,
  onProgress?: (done: number, total: number, title: string) => void
): Promise<DeepResearchArchiveResult | null> {
  const format = request.format ?? 'markdown';
  const drafts = request.ids
    .map((id) => getWritingWorkshopDraft(id))
    .filter((saved): saved is WritingWorkshopSavedDraft => saved !== null);
  if (drafts.length === 0) throw new Error('No hay informes que descargar.');

  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: dialogTitle('downloadReports', getSettings().uiLanguage),
    defaultPath: path.join(app.getPath('downloads'), `nodus-deep-research-${stamp}.zip`),
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return null;

  const zip = new AdmZip();
  const failed: DeepResearchArchiveResult['failed'] = [];
  const used = new Set<string>();
  let done = 0;
  for (const saved of drafts) {
    onProgress?.(done, drafts.length, saved.title);
    // Distinct reports can share a title, and a zip entry silently overwrites its
    // namesake — so the name is claimed before anything is rendered into it.
    const base = uniqueName(used, slug(saved.title || 'informe'));
    try {
      // Staged first, added second: a report whose PDF fails must not leave a lone
      // Markdown file behind while being reported as failed.
      for (const entry of await renderSavedWritingFiles(saved, base, format, request.includeCheatSheets === true)) {
        zip.addFile(entry.name, entry.bytes);
      }
    } catch (error) {
      failed.push({ title: saved.title, reason: error instanceof Error ? error.message : String(error) });
    }
    done += 1;
    onProgress?.(done, drafts.length, saved.title);
  }

  fs.writeFileSync(filePath, zip.toBuffer());
  return { path: filePath, count: drafts.length - failed.length, failed };
}

function uniqueName(used: Set<string>, base: string): string {
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${n}`;
  used.add(candidate);
  return candidate;
}

function reportImage(entityId: string | undefined, labels: DeepReportLabels): { dataUrl: string | null; credit: string | null } {
  if (!entityId) return { dataUrl: null, credit: null };
  const meta = getDecorativeImage('deep_research', entityId);
  const data = getDecorativeImageData('deep_research', entityId);
  if (!meta || meta.status !== 'ready' || !data) return { dataUrl: null, credit: null };
  return {
    dataUrl: `data:${data.mimeType};base64,${data.bytes.toString('base64')}`,
    credit: imageCredit(meta.source, labels),
  };
}

function imageCredit(source: DecorativeImageSource | null, labels: DeepReportLabels): string | null {
  if (source === 'ai') return labels.imageAi;
  if (source === 'custom') return labels.imageCustom;
  return null;
}




/** Pure document model used by the Electron exporter and its visual regression fixture. */
export function buildDeepResearchPdfInput(
  draft: WritingWorkshopDraft,
  entityId?: string,
  imageOverride?: { dataUrl: string | null; credit: string | null }
): ProfessionalReportInput {
  const labels = DEEP_LABELS[draft.brief.language ?? 'es'];
  return deepResearchReportInput(draft, imageOverride ?? reportImage(entityId, labels), entityId ? getDocumentVisuals({ kind: 'deep-research', id: entityId }) : null);
}

function renderDraftMarkdown(draft: WritingWorkshopDraft): string {
  const parts = [
    `# ${draft.title}`,
    '',
    `Generado: ${draft.generatedAt}`,
    `Tipo: ${draft.brief.kind}`,
    `Objetivo: ${draft.brief.objective}`,
    '',
    '## Resumen',
    draft.abstract,
    '',
    ...(draft.deepResearchStructure === 'single' ? [] : [
      '## Esquema',
      ...draft.outline.flatMap((section, index) => [
        `### ${index + 1}. ${section.title}`,
        section.purpose,
        '',
        ...section.keyClaims.map((claim) => `- ${claim}`),
        ...(section.sources.length ? ['', `Fuentes: ${section.sources.join('; ')}`] : []),
        '',
      ]),
    ]),
    '## Borrador',
    // The body already opens with the abstract and closes with its limitations and
    // references, so those are rendered once — here from the body, not twice.
    stripLeadingAbstract(draft.draftMarkdown, draft.abstract),
    '',
    '## Matriz de apoyo',
    matrixTable(draft.matrix),
    '',
    '## Siguientes pasos',
    ...(draft.nextSteps.length ? draft.nextSteps.map((item) => `- ${item}`) : ['- Revisar el borrador.']),
    '',
  ];
  return parts.join('\n');
}

function matrixTable(rows: WritingWorkshopMatrixRow[]): string {
  if (rows.length === 0) return 'Sin matriz generada.';
  const header = '| Papel | Afirmacion | Fuente | Evidencia | Notas |\n| --- | --- | --- | --- | --- |';
  const body = rows
    .map((row) =>
      [
        row.role,
        row.claim,
        row.citation ? `[${row.sourceLabel || 'fuente'}](${row.citation})` : row.sourceLabel,
        row.evidence,
        row.notes,
      ]
        .map(escapeCell)
        .join(' | ')
    )
    .map((line) => `| ${line} |`)
    .join('\n');
  return `${header}\n${body}`;
}

function escapeCell(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return clean || 'taller-escritura';
}
