/**
 * Files for a complete study guide: the full guide (PDF in the Deep Research design,
 * Word with native tables and equations, Markdown with callouts and LaTeX) and the
 * review sheet on its own. Figures travel inside PDF and Word, and as assets beside
 * Markdown.
 */
import { documentMarkdownWithFigures } from '@shared/documentFigureExport';
import { completeGuideLabels } from '@shared/completeGuide/labels';
import { completeGuideMarkdown, completeGuideReportInput, completeGuideReviewSheetHtml } from '@shared/completeGuide/reportInput';
import type { PromptLanguage, WritingWorkshopDraft, WritingWorkshopExportFormat } from '@shared/types';
import { DEEP_LABELS } from '@shared/deepResearchReport';
import { stripLeadingAbstract } from '@shared/writingDocument';
import { getDocumentVisualsForExport as getDocumentVisuals } from './documentVisualAssets';
import { completeGuideDocx } from './completeGuideDocx';
import { htmlToPdfBytes } from './htmlToPdf';
import { pngSize, type DocxImage } from './markdownDocx';
import { professionalReportPdf } from './professionalReportPdf';

export interface GuideFile { name: string; bytes: Buffer }

/**
 * Render one guide (or its review sheet) in one format. `base` is the file name
 * without extension; Markdown may return extra asset files under `${base}-assets/`.
 */
export async function renderCompleteGuideFiles(
  draft: WritingWorkshopDraft,
  options: { format: WritingWorkshopExportFormat; part?: 'full' | 'cheatsheet'; entityId?: string; base: string; image?: { dataUrl: string | null; credit: string | null } },
): Promise<GuideFile[]> {
  const language = (draft.brief.language ?? 'es') as PromptLanguage;
  const labels = completeGuideLabels(language);
  const contents = (DEEP_LABELS[language] ?? DEEP_LABELS.es).contents;
  if (options.part === 'cheatsheet') {
    const sheet = draft.completeGuide?.cheatSheetMarkdown;
    if (!sheet) throw new Error('Esta guía no tiene ficha de repaso.');
    if (options.format === 'pdf') {
      const html = completeGuideReviewSheetHtml(draft)!;
      return [{ name: `${options.base}.pdf`, bytes: await htmlToPdfBytes(html) }];
    }
    if (options.format === 'docx') {
      return [{ name: `${options.base}.docx`, bytes: await completeGuideDocx(sheet, { title: `${labels.reviewSheet} · ${draft.title}`, contentsLabel: contents }) }];
    }
    return [{ name: `${options.base}.md`, bytes: Buffer.from(sheet, 'utf8') }];
  }
  const visuals = options.entityId ? getDocumentVisuals({ kind: 'deep-research', id: options.entityId }) : null;
  const directory = `${options.base}-assets`;
  const enriched = documentMarkdownWithFigures(completeGuideMarkdown(draft), 'body', visuals, directory);
  const byName = new Map(enriched.files.map((file) => [file.name, file.base64]));
  const nameOf = (url: string) => decodeURIComponent(url.split('/').pop() ?? '');
  if (options.format === 'pdf') {
    // The cover carries title and abstract; the body gets the figures.
    const body = documentMarkdownWithFigures(stripLeadingAbstract(draft.draftMarkdown, draft.abstract), 'body', visuals, directory);
    const bodyFiles = new Map(body.files.map((file) => [file.name, file.base64]));
    const input = completeGuideReportInput(draft, options.image, {
      markdown: body.markdown,
      resolve: (url) => { const data = bodyFiles.get(nameOf(url)); return data ? `data:image/png;base64,${data}` : null; },
    });
    return [{ name: `${options.base}.pdf`, bytes: await professionalReportPdf(input) }];
  }
  if (options.format === 'docx') {
    const resolveImage = (url: string): DocxImage | null => {
      const data = byName.get(nameOf(url));
      if (!data) return null;
      const bytes = Buffer.from(data, 'base64');
      const size = pngSize(bytes);
      return size ? { data: bytes, width: size.width, height: size.height } : null;
    };
    return [{ name: `${options.base}.docx`, bytes: await completeGuideDocx(enriched.markdown, { title: draft.title, contentsLabel: contents, resolveImage }) }];
  }
  return [
    { name: `${options.base}.md`, bytes: Buffer.from(enriched.markdown, 'utf8') },
    ...enriched.files.map((file) => ({ name: `${directory}/${file.name}`, bytes: Buffer.from(file.base64, 'base64') })),
  ];
}
