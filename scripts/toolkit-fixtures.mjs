// Deterministic, in-process fixture builders for the Nodus Toolkit tests. Rather
// than commit binary fixtures to a public repo, each test builds exactly the
// fixtures it needs into a temp dir at runtime — fully hermetic (no network), and
// no personal files ever enter the tree (the HEIC rule, §6.2-bis). Content is
// fixed so tests can assert on known phrases, page counts, dimensions and hashes.
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

// Scanned fixtures draw with a font shipped in the repository, never the runner's
// `sans-serif`: the 2026-10-28 GitHub Ubuntu image resolved that family to nothing,
// so every "scan" came out blank and OCR read only spaces.
const FIXTURE_FONT = 'NodusFixtureSans';
GlobalFonts.registerFromPath(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server/lib/assets/fonts/NodusCJK-Regular.ttf'),
  FIXTURE_FONT,
);

// Known phrases embedded in the text PDF, one heading + body lines per page.
export const PDF_PAGES = [
  {
    heading: 'Introduccion General',
    body: ['El rapido zorro marron salta sobre el perro perezoso.', 'The quick brown fox jumps over the lazy dog.'],
  },
  {
    heading: 'Metodo del Estudio',
    body: ['La investigacion cualitativa requiere rigor documental.'],
  },
  {
    heading: 'Resultados y Conclusiones',
    body: ['Los hallazgos confirman la hipotesis inicial del estudio.'],
  },
];

/** A 3-page PDF with a real text layer and a clear heading/body font-size split. */
export async function buildTextPdf(dir, name = 'sample-3pages.pdf') {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const spec of PDF_PAGES) {
    const page = pdf.addPage([595, 842]); // A4 points
    let y = 780;
    page.drawText(spec.heading, { x: 60, y, size: 26, font: bold, color: rgb(0, 0, 0) });
    y -= 50;
    for (const line of spec.body) {
      page.drawText(line, { x: 60, y, size: 12, font, color: rgb(0, 0, 0) });
      y -= 24;
    }
  }
  const bytes = await pdf.save();
  const out = path.join(dir, name);
  fs.writeFileSync(out, bytes);
  return out;
}

/** A single-page second PDF, used for merge tests. */
export async function buildSecondPdf(dir, name = 'sample-b.pdf') {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Anexo Documental', { x: 60, y: 780, size: 22, font });
  page.drawText('Este apendice contiene material complementario.', { x: 60, y: 730, size: 12, font });
  const out = path.join(dir, name);
  fs.writeFileSync(out, await pdf.save());
  return out;
}

/** Render text onto a white canvas at a generous size (good for OCR). */
function renderTextCanvas(lines, { width = 1000, height = 700, fontSize = 44 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = `${fontSize}px ${FIXTURE_FONT}`;
  let y = fontSize + 40;
  for (const line of lines) {
    ctx.fillText(line, 40, y);
    y += fontSize + 24;
  }
  return canvas;
}

/** A standalone scan image (PNG or JPEG) carrying known words for OCR. */
export function buildScanImage(dir, name, lines, format = 'png') {
  const canvas = renderTextCanvas(lines);
  const buf = format === 'jpeg' || format === 'jpg' ? canvas.toBuffer('image/jpeg', 90) : canvas.toBuffer('image/png');
  const out = path.join(dir, name);
  fs.writeFileSync(out, buf);
  return out;
}

/** An image-only ("scanned") PDF: each page is a rasterised text image, no text layer. */
export async function buildScannedPdf(dir, name = 'scanned-2pages.pdf', pages) {
  const specs = pages ?? [
    ['Documento escaneado de prueba', 'contiene texto nitido para OCR'],
    ['Segunda pagina del escaneo', 'con palabras reconocibles claramente'],
  ];
  const pdf = await PDFDocument.create();
  for (const lines of specs) {
    const canvas = renderTextCanvas(lines, { width: 1000, height: 700, fontSize: 40 });
    const png = await pdf.embedPng(canvas.toBuffer('image/png'));
    const page = pdf.addPage([png.width, png.height]);
    page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  }
  const out = path.join(dir, name);
  fs.writeFileSync(out, await pdf.save());
  return out;
}

/** A small solid-gradient photo (JPEG), for image conversion/resize/compress tests. */
export function buildPhoto(dir, name = 'photo.jpg', { width = 640, height = 480 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < width; x++) {
    ctx.fillStyle = `rgb(${Math.floor((x / width) * 255)}, ${Math.floor((1 - x / width) * 180)}, 120)`;
    ctx.fillRect(x, 0, 1, height);
  }
  const out = path.join(dir, name);
  fs.writeFileSync(out, canvas.toBuffer('image/jpeg', 92));
  return out;
}

/** A PNG of a given exact size (magic-byte + dimension checks). */
export function buildPng(dir, name, { width = 300, height = 200 } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366cc';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
  const out = path.join(dir, name);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  return out;
}

/** A DOCX with a heading, bold run, a bullet list and a table. */
export async function buildDocx(dir, name = 'sample.docx') {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Titulo Principal', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun('Texto normal con una parte '), new TextRun({ text: 'en negrita', bold: true }), new TextRun(' incluida.')],
          }),
          new Paragraph({ text: 'Primer elemento', bullet: { level: 0 } }),
          new Paragraph({ text: 'Segundo elemento', bullet: { level: 0 } }),
          new Table({
            rows: [
              new TableRow({ children: [cell(TableCell, Paragraph, 'Celda A1'), cell(TableCell, Paragraph, 'Celda B1')] }),
              new TableRow({ children: [cell(TableCell, Paragraph, 'Celda A2'), cell(TableCell, Paragraph, 'Celda B2')] }),
            ],
          }),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  const out = path.join(dir, name);
  fs.writeFileSync(out, buf);
  return out;
}

function cell(TableCell, Paragraph, text) {
  return new TableCell({ children: [new Paragraph(text)] });
}

/** A Markdown file with headings, a table and a KaTeX formula. */
export function buildMarkdown(dir, name = 'sample.md') {
  const md = [
    '# Titulo Principal',
    '',
    'Un parrafo con **negrita** y texto normal.',
    '',
    '## Subseccion',
    '',
    '- Primer punto',
    '- Segundo punto',
    '',
    '| Columna A | Columna B |',
    '| --- | --- |',
    '| A1 | B1 |',
    '| A2 | B2 |',
    '',
    'Una formula: $E = mc^2$.',
    '',
  ].join('\n');
  const out = path.join(dir, name);
  fs.writeFileSync(out, md, 'utf8');
  return out;
}

/** An HTML file mirroring the Markdown fixture. */
export function buildHtml(dir, name = 'sample.html') {
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>Prueba</title></head><body>',
    '<h1>Titulo Principal</h1>',
    '<p>Un parrafo con <strong>negrita</strong> y texto normal.</p>',
    '<h2>Subseccion</h2>',
    '<ul><li>Primer punto</li><li>Segundo punto</li></ul>',
    '<table><tr><th>Columna A</th><th>Columna B</th></tr><tr><td>A1</td><td>B1</td></tr></table>',
    '</body></html>',
  ].join('\n');
  const out = path.join(dir, name);
  fs.writeFileSync(out, html, 'utf8');
  return out;
}

/** A minimal but valid EPUB with two spine chapters in a fixed order. */
export async function buildEpub(dir, name = 'sample.epub') {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();
  // mimetype MUST be first and stored (uncompressed) — handled by the reader tests.
  zip.addFile('mimetype', Buffer.from('application/epub+zip'), '', 0);
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:test</dc:identifier>' +
        '<dc:title>Libro de Prueba</dc:title><dc:language>es</dc:language></metadata>' +
        '<manifest><item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="c2" href="chap2.xhtml" media-type="application/xhtml+xml"/></manifest>' +
        '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    ),
  );
  zip.addFile(
    'OEBPS/chap1.xhtml',
    Buffer.from(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Uno</title></head>' +
        '<body><h1>Capitulo Primero</h1><p>El comienzo de la historia narrada aqui.</p></body></html>',
    ),
  );
  zip.addFile(
    'OEBPS/chap2.xhtml',
    Buffer.from(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Dos</title></head>' +
        '<body><h1>Capitulo Segundo</h1><p>La continuacion despues del primero.</p></body></html>',
    ),
  );
  const out = path.join(dir, name);
  zip.writeZip(out);
  return out;
}

/** A subtitle file (SRT) with six cues. */
export function buildSrt(dir, name = 'interview.srt') {
  const srt = [
    '1', '00:00:01,000 --> 00:00:03,000', 'Hola y bienvenidos a la entrevista.', '',
    '2', '00:00:03,500 --> 00:00:06,000', 'Hoy hablamos sobre el proyecto', 'y sus objetivos principales.', '',
    '3', '00:00:06,500 --> 00:00:09,000', 'La primera pregunta es sencilla.', '',
    '4', '00:00:09,500 --> 00:00:12,000', 'Respondere con mucho gusto.', '',
    '5', '00:00:12,500 --> 00:00:15,000', 'Gracias por la aclaracion.', '',
    '6', '00:00:15,500 --> 00:00:18,000', 'Cerramos con las conclusiones finales.', '',
  ].join('\n');
  const out = path.join(dir, name);
  fs.writeFileSync(out, srt, 'utf8');
  return out;
}

/** A rotated (skewed) scan image, for the deskew test (late phase). */
export async function buildSkewedScan(dir, name = 'scan-skewed.png', angleDeg = 3) {
  const src = renderTextCanvas(['Texto ligeramente inclinado', 'para probar el enderezado'], { width: 1000, height: 700, fontSize: 40 });
  const canvas = createCanvas(1000, 700);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1000, 700);
  ctx.translate(500, 350);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.translate(-500, -350);
  ctx.drawImage(src, 0, 0);
  const out = path.join(dir, name);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  return out;
}

// Re-export degrees so PDF tests can build pre-rotated fixtures if needed.
export { degrees };
