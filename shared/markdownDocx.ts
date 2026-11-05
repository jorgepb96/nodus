import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { collectCitations, stripInlineMarkdown, stripMarkdownLinks } from './markdownRender';

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → Word. Shared by every export that offers a `.docx`: project
// chapters, the study export and the generated reports (Deep Research, the
// writing workshop, database research). It lives on its own — rather than beside
// the project exporter that first needed it — so a report export does not drag
// the projects repository (and the Electron surface it touches) into its graph.
// ─────────────────────────────────────────────────────────────────────────────

/** An image a report already rendered, ready to be embedded in a Word document. */
export interface DocxImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Width and height from a PNG's IHDR chunk, so an embedded figure keeps its shape. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // 8-byte signature, 4-byte chunk length, 'IHDR', then both dimensions big-endian.
  if (bytes.length < 24) return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(0)!==0x89504e47)return null;
  return {width:view.getUint32(16),height:view.getUint32(20)};
}

export interface DocxOptions {
  /**
   * Resolves a Markdown image URL to its bytes. Supplied by the report exporters,
   * whose figures travel as separate assets next to the Markdown; without it an
   * image line keeps the literal text it has always produced.
   */
  resolveImage?: (url: string) => DocxImage | null;
  /** Widest an embedded figure may be printed, in pixels at 96 dpi. */
  maxImageWidth?: number;
}

export async function markdownToDocxBytes(markdown: string, options: DocxOptions = {}): Promise<Uint8Array> {
  const children = markdownToDocxParagraphs(markdown, options);
  const refs = collectCitations(markdown);
  if (refs.length) {
    children.push(new Paragraph({ text: 'Bibliografia Nodus', heading: HeadingLevel.HEADING_1 }));
    for (const ref of refs) {
      children.push(new Paragraph({ text: `${ref.label} - ${ref.url}`, bullet: { level: 0 } }));
    }
  }
  const document = new Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}

/** A figure scaled to fit the page, keeping its own proportions. */
function imageParagraph(image: DocxImage, maxWidth: number): Paragraph {
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;
  return new Paragraph({
    children: [
      new ImageRun({
        type: 'png',
        data: image.data,
        transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) },
      }),
    ],
  });
}

function markdownToDocxParagraphs(markdown: string, options: DocxOptions = {}): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = markdown.split(/\r?\n/);
  const maxImageWidth = options.maxImageWidth ?? 600;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(' ').trim();
    if (text) paragraphs.push(new Paragraph({ children: inlineRuns(text) }));
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      paragraphs.push(new Paragraph({ text: stripMarkdownLinks(heading[2]), heading: headingLevel(heading[1].length) }));
      continue;
    }
    if (image) {
      flush();
      const resolved = options.resolveImage?.(image[2]);
      if (resolved) paragraphs.push(imageParagraph(resolved, maxImageWidth));
      else if (options.resolveImage && image[1].trim()) paragraphs.push(new Paragraph({ children: inlineRuns(image[1]) }));
      else if (!options.resolveImage) paragraphs.push(new Paragraph({ children: inlineRuns(line.trim()) }));
      continue;
    }
    if (bullet) {
      flush();
      paragraphs.push(new Paragraph({ children: inlineRuns(bullet[1]), bullet: { level: 0 } }));
      continue;
    }
    buffer.push(line.trim());
  }
  flush();
  return paragraphs.length ? paragraphs : [new Paragraph('')];
}

function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) runs.push(new TextRun(stripInlineMarkdown(text.slice(cursor, match.index))));
    runs.push(new TextRun({ text: stripInlineMarkdown(match[1]), italics: false }));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) runs.push(new TextRun(stripInlineMarkdown(text.slice(cursor))));
  return runs.length ? runs : [new TextRun('')];
}

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level <= 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  if (level === 4) return HeadingLevel.HEADING_4;
  if (level === 5) return HeadingLevel.HEADING_5;
  return HeadingLevel.HEADING_6;
}
