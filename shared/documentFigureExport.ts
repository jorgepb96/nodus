import { documentBlocks, type DocumentFigure, type DocumentVisualManifest } from './documentSkills';
import { escapeHtml } from './toolkitMarkdown';

export const readyDocumentFigures = (manifest: DocumentVisualManifest | null | undefined) => manifest?.figures.filter(figure => figure.state === 'ready' && (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(figure.poster ?? '') || (typeof figure.owner==='string' && /^[a-f0-9]{64}$/.test(figure.owner) && new RegExp(`^nodus-image://chat/${figure.owner}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`).test(figure.poster??'')))).sort((a,b) => manifest.blocks.findIndex(block => block.id === a.blockId) - manifest.blocks.findIndex(block => block.id === b.blockId)) ?? [];
export function figureHtml(figure: DocumentFigure, number: number): string {
  return `<figure class="report-figure"><img src="${figure.poster}" alt="${escapeHtml(figure.caption)}"/><figcaption><b>${number}.</b> ${escapeHtml(figure.caption)}${figure.sources.map((source,index) => /^nodus:\/\/[a-z-]+\//.test(source) ? ` <a href="${escapeHtml(source)}">[${index+1}]</a>` : '').join('')}</figcaption></figure>`;
}

/** The export may remove the already displayed abstract or add an appendix. Align full
 * parsed blocks in order; never find an insertion by a model-authored phrase. */
export function documentFigureInsertions(markdown: string, field: string, manifest?: DocumentVisualManifest | null): Map<number, string> {
  const result = new Map<number, string>(); if (!manifest) return result;
  const blocks = documentBlocks({ [field]: markdown }), saved = manifest.blocks.filter(block => block.field === field);
  const ready = readyDocumentFigures(manifest);
  let cursor = 0;
  for (const block of blocks) {
    const index = saved.findIndex((candidate, index) => index >= cursor && candidate.markdown === block.markdown);
    if (index < 0) continue;
    cursor = index + 1;
    const figures = ready.filter(figure => figure.blockId === saved[index].id);
    if (figures.length) result.set(block.index, figures.map(figure => figureHtml(figure, ready.indexOf(figure)+1)).join(''));
  }
  return result;
}

export function documentMarkdownWithFigures(markdown: string, field: string, manifest: DocumentVisualManifest | null, directory: string): { markdown: string; files: Array<{ name: string; base64: string }> } {
  const files: Array<{ name: string; base64: string }> = [];
  const insertions = documentFigureInsertions(markdown, field, manifest);
  const ready = readyDocumentFigures(manifest);
  const blocks = documentBlocks({ [field]: markdown });
  const output = blocks.map(block => {
    const html = insertions.get(block.index); if (!html) return block.markdown;
    const figures = ready.filter(figure => html.includes(figure.poster!));
    return block.markdown + figures.map(figure => {
      const encoded = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(figure.poster??'');if(!encoded)throw new Error('Resolve the saved document figure image before exporting it.');
      const name = `figure-${figure.id}.png`; files.push({ name, base64: encoded[1] });
      const caption = figure.caption.replace(/[\r\n]/g, ' ').replace(/[\\`*_{}[\]<>]/g, '\\$&');
      return `\n\n![${caption}](${directory}/${name})\n\n*${caption}*${figure.sources.map((source,index) => ` [${index+1}](${source})`).join('')}`;
    }).join('');
  }).join('\n\n');
  return { markdown: output, files };
}
