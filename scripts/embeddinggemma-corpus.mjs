import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import { createCanvas } from '@napi-rs/canvas';
import AdmZip from 'adm-zip';
import XLSX from 'xlsx';

const sha = buffer => createHash('sha256').update(buffer).digest('hex');
// Authored QA documents. This data is the source content, never answer annotations.
const languages = ['es', 'en', 'fr', 'de', 'pt', 'it'];
const themes = [
  ['La escuela de Puerto Claro abrió su biblioteca en 1912. En 1913 abrió el laboratorio; no la biblioteca.', 'The school in Puerto Claro opened its library in 1912. Its laboratory opened in 1913, not its library.', 'L’école de Puerto Claro a ouvert sa bibliothèque en 1912. Le laboratoire a ouvert en 1913, pas la bibliothèque.', 'Die Schule in Puerto Claro eröffnete ihre Bibliothek 1912. Das Labor eröffnete 1913, nicht die Bibliothek.', 'A escola de Puerto Claro abriu a biblioteca em 1912. O laboratório abriu em 1913, não a biblioteca.', 'La scuola di Puerto Claro aprì la biblioteca nel 1912. Il laboratorio aprì nel 1913, non la biblioteca.'],
  ['En el ensayo Vega, el grupo que practicó recuperación espaciada recordó el 72 %; el grupo de relectura, el 51 %. No se midió inteligencia.', 'In the Vega trial, spaced retrieval participants recalled 72%; rereading participants recalled 51%. Intelligence was not measured.', 'Dans l’essai Vega, le rappel espacé a atteint 72 %, contre 51 % pour la relecture. L’intelligence n’a pas été mesurée.', 'Im Vega-Versuch erreichte verteiltes Abrufen 72 %, erneutes Lesen 51 %. Intelligenz wurde nicht gemessen.', 'No ensaio Vega, a recuperação espaçada atingiu 72 %, e a releitura, 51 %. A inteligência não foi medida.', 'Nello studio Vega, il recupero distribuito raggiunse il 72 %, la rilettura il 51 %. L’intelligenza non fu misurata.'],
  ['El sensor Alba usa luz verde a 530 nm para medir turbidez. No mide concentración de oxígeno. Debe calibrarse cada 30 días.', 'The Alba sensor uses green light at 530 nm to measure turbidity. It does not measure oxygen concentration. Calibration is required every 30 days.', 'Le capteur Alba utilise une lumière verte à 530 nm pour mesurer la turbidité. Il ne mesure pas l’oxygène. Il doit être étalonné tous les 30 jours.', 'Der Alba-Sensor misst Trübung mit grünem Licht bei 530 nm. Er misst keinen Sauerstoff. Die Kalibrierung erfolgt alle 30 Tage.', 'O sensor Alba mede turbidez com luz verde de 530 nm. Não mede oxigénio. Deve ser calibrado a cada 30 dias.', 'Il sensore Alba misura la torbidità con luce verde a 530 nm. Non misura l’ossigeno. Va calibrato ogni 30 giorni.'],
  ['La encuesta Bruma incluyó 240 personas de seis pueblos. El intervalo de confianza fue del 95 %. La mediana fue 18 y la media 24; no son equivalentes.', 'The Bruma survey included 240 people from six villages. Confidence was 95%. The median was 18 and the mean 24; they are not equivalent.', 'L’enquête Bruma comprenait 240 personnes de six villages. Le niveau de confiance était de 95 %. La médiane était 18 et la moyenne 24.', 'Die Bruma-Umfrage umfasste 240 Personen aus sechs Dörfern. Das Konfidenzniveau betrug 95 %. Der Median war 18, der Mittelwert 24.', 'O inquérito Bruma incluiu 240 pessoas de seis aldeias. A confiança foi de 95 %. A mediana foi 18 e a média 24.', 'L’indagine Bruma comprendeva 240 persone di sei villaggi. La confidenza era del 95 %. La mediana era 18, la media 24.'],
  ['La API Linde conserva eventos durante 14 días. El endpoint /restore recupera elementos borrados, pero no cuentas cerradas. La versión 2 cambió el límite de 7 a 14 días.', 'The Linde API retains events for 14 days. The /restore endpoint recovers deleted items, but not closed accounts. Version 2 changed retention from 7 to 14 days.', 'L’API Linde conserve les événements 14 jours. /restore récupère les éléments supprimés, pas les comptes fermés. La version 2 a remplacé 7 jours par 14.', 'Die Linde-API speichert Ereignisse 14 Tage. /restore stellt gelöschte Elemente, aber keine geschlossenen Konten wieder her. Version 2 erhöhte die Frist von 7 auf 14 Tage.', 'A API Linde conserva eventos durante 14 dias. /restore recupera itens eliminados, mas não contas encerradas. A versão 2 alterou o prazo de 7 para 14 dias.', 'L’API Linde conserva gli eventi per 14 giorni. /restore recupera elementi eliminati, non account chiusi. La versione 2 ha cambiato il limite da 7 a 14 giorni.'],
];
const questions = [
  ['¿Cuándo comenzó a funcionar la biblioteca escolar de Puerto Claro?', 'When did the school library at Puerto Claro first open?', 'Quand la bibliothèque scolaire de Puerto Claro a-t-elle ouvert ?', 'Wann eröffnete die Schulbibliothek von Puerto Claro?', 'Quando abriu a biblioteca escolar de Puerto Claro?', 'Quando aprì la biblioteca scolastica di Puerto Claro?'],
  ['¿Qué actividad obtuvo más recuerdo en el ensayo Vega?', 'Which learning activity produced better recall in the Vega trial?', 'Quelle activité a amélioré le rappel dans l’essai Vega ?', 'Welche Lernaktivität verbesserte das Erinnern im Vega-Versuch?', 'Que atividade melhorou a memória no ensaio Vega?', 'Quale attività migliorò il ricordo nello studio Vega?'],
  ['¿Qué propiedad del agua mide Alba y con qué luz?', 'Which water property does Alba measure, and with which light?', 'Quelle propriété de l’eau mesure Alba et avec quelle lumière ?', 'Welche Wassereigenschaft misst Alba und mit welchem Licht?', 'Que propriedade da água mede Alba e com que luz?', 'Quale proprietà dell’acqua misura Alba e con quale luce?'],
  ['¿Cuántos participantes y localidades tuvo Bruma?', 'How many participants and villages were included in Bruma?', 'Combien de participants et de villages comptait Bruma ?', 'Wie viele Teilnehmer und Dörfer umfasste Bruma?', 'Quantas pessoas e aldeias participaram em Bruma?', 'Quante persone e quanti villaggi comprendeva Bruma?'],
  ['¿Durante cuánto tiempo conserva eventos Linde en la versión 2?', 'How long does Linde retain events in version 2?', 'Combien de temps Linde conserve-t-elle les événements en version 2 ?', 'Wie lange speichert Linde Ereignisse in Version 2?', 'Por quanto tempo Linde conserva eventos na versão 2?', 'Per quanto tempo Linde conserva eventi nella versione 2?'],
];
const hard = [
  ['¿La biblioteca abrió en 1913 o fue otro espacio?', 'Does the Vega result demonstrate higher intelligence?', 'Does Alba measure dissolved oxygen?', 'Was the Bruma median 24?', 'Can Linde restore a closed account?'],
  ['¿Coinciden los años de inauguración del laboratorio y la biblioteca?', 'Was the rereading group the one that recalled 72 percent?', 'Is Alba calibrated once per year?', 'Did Bruma sample six people from 240 villages?', 'Did version two shorten the Linde retention interval?'],
  ['¿Qué espacio escolar abrió primero y cuál un año después?', 'Can Vega establish a difference in IQ, or only recall?', 'Could Alba supply an oxygen reading from its green-light measurement?', 'Should the Bruma mean and median be reported as the same statistic?', 'Are deleted objects and closed accounts equally recoverable in Linde?'],
  ['¿Es correcta la afirmación de que la biblioteca nació después del laboratorio?', 'Does the 51 percent recall figure belong to spaced retrieval?', 'Is the 530 nm specification a calibration period or a wavelength?', 'Does a preliminary Bruma count supersede its final sample of 240?', 'Which Linde retention claim refers to the old version: seven days or fourteen?'],
];
const negative = [
  ['¿Quién donó los libros de Puerto Claro?', 'What were the Vega participants’ names?', 'What is the Alba sensor’s retail price?', 'How many Bruma participants were under 18?', 'Where is Linde’s source code hosted?'],
  ['¿Cuántos libros tenía Puerto Claro el día de su inauguración?', 'What was the age of Vega’s oldest participant?', 'What company manufactures Alba?', 'What was the Bruma response rate?', 'What is the monthly price of a Linde subscription?'],
  ['¿Cuál es el domicilio de la escuela de Puerto Claro?', 'Was the Vega trial preregistered?', 'What is Alba’s maximum operating temperature?', 'Which six villages were surveyed in Bruma?', 'Who is the lead developer of Linde?'],
  ['¿Cuál fue el presupuesto anual de la biblioteca de Puerto Claro?', 'Which ethics committee approved Vega?', 'How much electrical power does Alba draw?', 'When were the Bruma interviews conducted?', 'Which database engine implements Linde event storage?'],
];
const stressCases = {
  20: { text: '\nCatalà: El canal Cerç transporta 42 litres per minut; la mesura és de cabal, no de pressió.', language: 'ca', question: 'Quin cabal porta el canal Cerç i es tracta d’una mesura de pressió?', expected: '42 litres per minute; flow, not pressure' },
  21: { text: '\nEuskara: Haize estazioak hamazazpi gradu neurtu zituen eguerdian, ez hezetasuna.', language: 'eu', question: 'Zer neurtu zuen Haize estazioak eguerdian eta zenbat gradu ziren?', expected: 'temperature; seventeen degrees; not humidity' },
  22: { text: '\nLatine: Navis Aster triginta amphoras portat; viginti vacuae sunt.', language: 'la', question: 'Quot amphoras navis Aster portat et quot vacuae sunt?', expected: 'thirty amphorae; twenty empty' },
  23: { text: '\nMixed: The Mistral observatory cerró durante cinco días por mantenimiento, not due to bad weather.', language: 'mixed', question: 'Why did Mistral cerrar and how many días lasted the closure?', expected: 'maintenance; five days; not weather' },
};
const expected = ['1912', '72%; 51%; recall, not intelligence', 'turbidity; green; 530 nm; not oxygen', '240; six; median 18; mean 24', '14 days; deleted items; not closed accounts'];
const formats = ['pdf', 'pdf', ...Array(6).fill('scan.pdf'), ...Array(6).fill('docx'), ...Array(4).fill('epub'), ...Array(4).fill('md'), ...Array(4).fill('txt'), 'csv', 'csv', 'xlsx', 'xlsx'];
function lines(text, width = 85) { return text.match(new RegExp(`.{1,${width}}(?:\\s|$)`, 'g')) ?? [text]; }
async function writeDocument(file, format, title, text, index) {
  if (format.endsWith('pdf')) {
    const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const paragraphs = [title, '', ...lines(text, 70), '', 'Source: Nodus QA synthetic archive.'];
    if (format === 'scan.pdf') {
      const canvas = createCanvas(1190, 1684); const context = canvas.getContext('2d');
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '24px sans-serif'; context.fillStyle = index % 2 ? '#555' : '#000';
      paragraphs.forEach((line, row) => context.fillText(line, 70, 100 + row * 42));
      if (index % 2) { context.globalAlpha = .18; for (let n = 0; n < 2500; n++) context.fillRect((n * 7919) % 1190, (n * 997) % 1684, 2, 2); }
      const image = await pdf.embedPng(canvas.toBuffer('image/png'));
      page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    } else paragraphs.forEach((line, row) => page.drawText(line.replace(/[’]/g, "'"), { x: 35, y: 792 - row * 21, size: 12, font }));
    await fs.writeFile(file, await pdf.save());
  } else if (format === 'docx') {
    await fs.writeFile(file, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(title), ...text.split('\n').map(line => new Paragraph(line))] }] })));
  } else if (format === 'epub') {
    const zip = new AdmZip(); zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.addFile('META-INF/container.xml', Buffer.from('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
    zip.addFile('content.opf', Buffer.from(`<package version="3.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">qa-${index}</dc:identifier><dc:title>${title}</dc:title><dc:language>${languages[index % 6]}</dc:language><meta property="dcterms:modified">2026-10-06T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>`));
    zip.addFile('chapter.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1><p>${text}</p></body></html>`));
    zip.addFile('nav.xhtml', Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter 1</a></li></ol></nav></body></html>'));
    await fs.writeFile(file, zip.toBuffer());
  } else if (format === 'xlsx' || format === 'csv') {
    const table = index % 5 === 4 ? [['Version', 'Retention days'], ['1', 7], ['2', 14]] : index % 5 === 3 ? [['Statistic', 'Value'], ['Median', 18], ['Mean', 24], ['Sample', 240]] : [['Source type', 'synthetic archive']];
    const sheet = XLSX.utils.aoa_to_sheet([['Document', 'Evidence'], [title, text], ...table]);
    if (format === 'csv') await fs.writeFile(file, XLSX.utils.sheet_to_csv(sheet));
    else { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Evidence'); await fs.writeFile(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })); }
  } else await fs.writeFile(file, format === 'md' ? `# ${title}\n\n${text}\n` : `${title}\n\n${text}\n`);
}
export async function prepareEmbeddingCorpus(root, { publicPdfs = true } = {}) {
  const folder = path.join(root, 'fixtures', 'corpus'); await fs.mkdir(folder, { recursive: true });
  const documents = [];
  for (let index = 0; index < 30; index++) {
    const theme = index % 5, languageIndex = index % 6, format = formats[index];
    const title = `${['Puerto Claro', 'Vega', 'Alba', 'Bruma', 'Linde'][theme]} · archive ${index + 1}`;
    const stress = stressCases[index]?.text ?? '';
    const contradiction = theme === 3 ? '\nBruma archive: preliminary memorandum counted 239 records. The final correction records 240 participants; the preliminary total is superseded.' : '';
    const longText = index === 18 ? '\n' + Array.from({ length: 180 }, (_, row) => `## Archive section ${row + 2}\nBruma field log ${row + 1}: this record describes survey methods, confidence intervals, missing responses, and separate definitions of the mean and median. Administrative review ${row + 1} contains no additional outcome claim.\n`).join('\n') : '';
    const text = themes[theme][languageIndex] + contradiction + stress + longText;
    const id = `fixture-${String(index + 1).padStart(2, '0')}`, file = path.join(folder, `${id}.${format.replace('scan.', '')}`);
    await writeDocument(file, format, title, text, index);
    documents.push({ id, file, format: format === 'scan.pdf' ? 'pdf-scanned' : format, language: languages[languageIndex], theme,
      title, sha256: sha(await fs.readFile(file)), provenance: 'Authored synthetic QA fixture; CC0-1.0',
      controlChunks: [{ id: `${id}:0`, title, text: themes[theme][languageIndex] + contradiction + stress, locator: format.endsWith('pdf') ? { page: 1 } : format === 'xlsx' ? { sheet: 'Evidence', cell: 'B2' } : { section: 1 } }],
      longDocument: index === 18,
      expectedFacts: expected[theme], extractionRequired: true, scanQuality: format === 'scan.pdf' ? index % 2 ? 'degraded' : 'clean' : undefined });
  }
  const papers = JSON.parse(await fs.readFile('audit/adaptive-concurrency/corpus.json', 'utf8')).papers;
  const facts = ['LoRA freezes pretrained weights and learns low-rank updates.', 'Self-Instruct generates instructions using a language model and filters them.', 'LLaMA is a collection of foundation language models trained on publicly available datasets.', 'Segment Anything introduces promptable image segmentation.', 'RWKV combines recurrent inference with transformer-like parallel training.', 'QLoRA finetunes a frozen 4-bit quantized model with low-rank adapters.', 'DPO optimizes preferences without fitting a separate reward model.', 'Chatbot Arena uses human preferences from pairwise model comparisons.', 'Generative Agents combines memory, reflection and planning.', 'HuggingGPT coordinates models using a language model as a controller.'];
  for (const [index, paper] of papers.entries()) {
    const id = `public-${paper.key}`, file = path.join(folder, `${id}.pdf`);
    if (publicPdfs) {
      let buffer = await fs.readFile(file).catch(() => null);
      if (!buffer || sha(buffer) !== paper.sha256) {
        const response = await fetch(paper.url); if (!response.ok) throw new Error(`Public PDF ${paper.key}: HTTP ${response.status}`);
        buffer = Buffer.from(await response.arrayBuffer());
        if (sha(buffer) !== paper.sha256) throw new Error(`Public PDF hash mismatch: ${paper.key}`);
        await fs.writeFile(file, buffer);
      }
    }
    // Curated excerpts are used only in the controlled lane. Product lane imports original PDFs.
    documents.push({ id, file, format: 'pdf', language: 'en', title: paper.title, sha256: paper.sha256, provenance: paper.url,
      controlChunks: [{ id: `${id}:0`, title: paper.title, text: facts[index], locator: { page: 1 } }], expectedFacts: facts[index], extractionRequired: true, downloaded: publicPdfs });
  }
  const queries = [];
  for (const [index, document] of documents.entries()) {
    const sourceLanguage = languages.indexOf(document.language);
    for (const kind of ['monolingual', 'cross-language']) {
      const languageIndex = kind === 'monolingual' ? sourceLanguage : (sourceLanguage + 1) % 6;
      const stress = kind === 'cross-language' ? stressCases[index] : undefined;
      const question = stress?.question ?? (document.theme === undefined ? (kind === 'monolingual' ? `What is the main method proposed by ${document.title}?` : `¿Qué método propone ${document.title}?`) : kind === 'monolingual' ? questions[document.theme][languageIndex] : `${questions[document.theme][languageIndex]} (${['fuente', 'source', 'source', 'Quelle', 'fonte', 'fonte'][languageIndex]}: ${document.title})`);
      const relevant = document.theme === undefined ? [document.id] : documents.filter(candidate => candidate.theme === document.theme).map(candidate => candidate.id);
      queries.push({ id: `${kind}-${index + 1}`, kind, language: stress?.language ?? (document.theme === undefined && kind === 'cross-language' ? 'es' : languages[languageIndex]), sourceLanguage: document.language,
        split: [0,3,8,11,14,17,20,23,26,29].includes(index) ? 'development' : 'evaluation', question,
        filterLanguage: document.language, relevant: stress ? [document.id] : relevant.filter(id => documents.find(document => document.id === id).language === document.language), expected: stress?.expected ?? document.expectedFacts });
    }
  }
  for (let index = 0; index < 20; index++) {
    const theme = index % 5;
    queries.push({ id: `hard-${index + 1}`, kind: 'hard-negative', language: theme === 0 ? 'es' : 'en', sourceLanguage: languages[index % 6], split: index < 10 ? 'development' : 'evaluation', question: hard[Math.floor(index / 5)][theme], relevant: documents.filter(document => document.theme === theme).map(document => document.id), expected: expected[theme] });
    queries.push({ id: `absent-${index + 1}`, kind: 'no-evidence', language: theme === 0 ? 'es' : 'en', split: index < 10 ? 'development' : 'evaluation', question: negative[Math.floor(index / 5)][theme], relevant: [], expected: 'insufficient evidence' });
  }
  if (new Set(queries.map(query => query.question)).size !== 120) throw new Error('QA queries must be unique');
  const manifest = { format: 'nodus.embedding-corpus/2', createdAt: new Date().toISOString(), documents,
    totals: { documents: 40, controlled: 30, publicPdfs: 10, queries: 120, development: 40, evaluation: 80 },
    limitations: ['Controlled lane uses curated short excerpts of public papers; product lane must extract the originals.', 'Synthetic themes are translated parallel sources; report per-format/language strata and do not infer real-world recall from this small corpus.'] };
  await fs.writeFile(path.join(root, 'artifacts', 'corpus-manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(root, 'artifacts', 'queries-gold.json'), JSON.stringify(queries, null, 2));
  return { manifest, queries };
}
