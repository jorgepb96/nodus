import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The bars stacked at the bottom of the window — scan queue, Zotero import, document
// index, idea embeddings, passage embeddings — are the only readout a multi-hour run
// has, and almost every word in them is written by the MAIN process. That is what
// makes them a translation blind spot of their own: `scripts/test-i18n-coverage.mjs`
// collects the keys the RENDERER hands to t(), and a sentence built in Electron is
// invisible to it.
//
// Those sentences reach the screen through two gates, and each used to break the bars
// in its own way:
//
//   1. `localizeIpcPayload` (shared/uiLanguage.ts) rewrites every `message`/`error`
//      field of every payload as if it were a failure. A healthy Zotero import
//      therefore told an English reader either "Copiando y verificando adjuntos…"
//      (Spanish leaked: too few function words to be detected) or "The operation
//      could not be completed." (detected, and so replaced) — a crash report in place
//      of a progress step. The same happened to "No hay obras … para indexar.", which
//      is what an idle embedding queue says about itself.
//   2. `tr()` (src/i18n.ts) is what translates prose that survives gate 1 — but only
//      if the sentence is a key in the tables or matches a runtime pattern, AND only
//      if the component actually calls it instead of rendering the raw field.
//
// So this file asserts all three links: the sentence is still spelled in Electron the
// way the tables expect, it passes gate 1 untouched, and tr() renders it in all seven
// languages. Change the Spanish wording in Electron without updating src/i18n.*.ts and
// this fails instead of quietly shipping Spanish to six interfaces.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-progress-i18n-'));

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const i18n = loadModule('src/i18n.ts');
const { localizeIpcPayload } = loadModule('shared/uiLanguage.ts');
const TABLES = {
  en: loadModule('src/i18n.en.ts').EN,
  fr: loadModule('src/i18n.fr.ts').FR,
  de: loadModule('src/i18n.de.ts').DE,
  pt: loadModule('src/i18n.pt.ts').PT,
  'pt-BR': loadModule('src/i18n.pt-BR.ts').PT_BR,
  it: loadModule('src/i18n.it.ts').IT,
  tr: loadModule('src/i18n.tr.ts').TR,
};
const LANGUAGES = Object.keys(TABLES);

const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

/**
 * One line a bottom bar can show, as the main process writes it.
 *
 * `key` is the Spanish translation key it resolves to and `params` the values the
 * sentence carries, so the expected text in each language is derived from the tables
 * themselves rather than restated here. `suffix` covers the labels whose counter is
 * appended outside the key, e.g. "Validando candidatos con IA" + " (1/10)".
 * `source`/`snippet` pin the sentence to the file that emits it.
 */
const LINES = [
  // ---- Scan queue: what the pipeline is doing to the work in hand.
  { text: 'Deteniendo al terminar la operación actual…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Analizando con IA…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Resumiendo…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Escaneando pares semánticos…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Generando el resumen requerido…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Indexando ideas y pasajes requeridos…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Modo léxico: no hay proveedor de embeddings configurado.', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Postprocesando relaciones del grafo…', source: 'electron/pipeline/scanQueue.ts' },
  { text: 'Preparando descubrimiento de puentes…', source: 'electron/pipeline/scanQueue.ts' },
  {
    text: '5 nuevas · 2 validados · 30 escaneados',
    key: '{added} nuevas · {validated} validados · {scanned} escaneados',
    params: { added: '5', validated: '2', scanned: '30' },
    source: 'electron/pipeline/scanQueue.ts',
    snippet: 'nuevas · ${result.validated} validados · ${result.candidatesScanned} escaneados',
  },
  {
    text: 'Reintentando (2/3)…',
    key: 'Reintentando ({current}/{total})…',
    params: { current: '2', total: '3' },
    field: 'error',
    source: 'electron/pipeline/scanQueue.ts',
    snippet: 'Reintentando (${attempts}/${MAX_RETRIES})…',
  },

  // ---- Extraction: resolving the full text before the AI sees it.
  {
    text: 'Extrayendo p. 3/10',
    key: 'Extrayendo p. {current}/{total}',
    params: { current: '3', total: '10' },
    source: 'electron/extraction/fileTextExtraction.ts',
    snippet: 'Extrayendo p. ${p}/${total}',
  },
  {
    text: 'OCR p. 3/10',
    key: 'OCR p. {current}/{total}',
    params: { current: '3', total: '10' },
    source: 'electron/extraction/fileTextExtraction.ts',
    snippet: 'OCR p. ${page}/${totalPages}',
  },
  { text: 'OCR de imagen…', source: 'electron/extraction/fileTextExtraction.ts' },
  { text: 'Analizando PDF…', source: 'electron/extraction/fileTextExtraction.ts' },
  { text: 'Comprobando índice de Zotero…', source: 'electron/extraction/textExtractor.ts' },
  { text: 'Buscando texto abierto (Unpaywall)…', source: 'electron/extraction/textExtractor.ts' },

  // ---- Deep scan: the per-chunk counters the bar ticks through for minutes. Both
  // spellings live in one reporter that owns the whole phase, so a parallel worker
  // can no longer write a lower fragment after a higher one.
  {
    text: 'Analizando fragmento 2/5 con IA…',
    key: 'Analizando fragmento {current}/{total} con IA…',
    params: { current: '2', total: '5' },
    source: 'electron/ai/deepScan.ts',
    snippet: 'Analizando fragmento ${current}/${chunks.length} con IA…`',
  },
  {
    text: 'Analizando fragmento 2/5 con IA… (8s)',
    key: 'Analizando fragmento {current}/{total} con IA… ({seconds}s)',
    params: { current: '2', total: '5', seconds: '8' },
    source: 'electron/ai/deepScan.ts',
    snippet: 'Analizando fragmento ${current}/${chunks.length} con IA… (${seconds}s)',
  },
  {
    text: 'Fusionando idea 2/5…',
    key: 'Fusionando idea {current}/{total}…',
    params: { current: '2', total: '5' },
    source: 'electron/ai/deepScan.ts',
    snippet: 'Fusionando idea ${current}/${ideaEntries.length}…',
  },

  // ---- Semantic bridges, whose counter is appended around the label.
  { text: 'Escaneando pares semánticos', source: 'electron/ai/semanticBridges.ts' },
  {
    text: 'Validando candidatos con IA (1/10)',
    key: 'Validando candidatos con IA',
    suffix: ' (1/10)',
    source: 'electron/ai/semanticBridges.ts',
    snippet: "label: 'Validando candidatos con IA'",
  },
  {
    text: '12 candidatos encontrados (3 cross-tema)',
    key: '{candidates} candidatos encontrados ({cross} entre temas)',
    params: { candidates: '12', cross: '3' },
    source: 'electron/ai/semanticBridges.ts',
    snippet: '${candidates.length} candidatos encontrados (${crossTheme} cross-tema)',
  },
  {
    text: '4 nuevas relaciones',
    key: '{n} nuevas relaciones',
    params: { n: '4' },
    source: 'electron/ai/semanticBridges.ts',
    snippet: '${added} nuevas relaciones',
  },
  {
    text: 'Agrupando ideas en temas (1/5)',
    key: 'Agrupando ideas en temas',
    suffix: ' (1/5)',
    source: 'shared/reprocessConnectionsPromptPacks.ts',
    snippet: "groupingProgress: 'Agrupando ideas en temas'",
  },

  // ---- Zotero import, which names the library and the item it is walking through.
  { text: 'Conectando con Zotero…', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },
  {
    text: 'Inventariando Mi biblioteca…',
    key: 'Inventariando {library}…',
    params: { library: 'Mi biblioteca' },
    field: 'message',
    source: 'electron/library/zoteroLibraryImport.ts',
    snippet: 'Inventariando ${library.name}…',
  },
  {
    text: 'Reconciliando colecciones de Mi biblioteca…',
    key: 'Reconciliando colecciones de {library}…',
    params: { library: 'Mi biblioteca' },
    field: 'message',
    source: 'electron/library/zoteroLibraryImport.ts',
    snippet: 'Reconciliando colecciones de ${library.name}…',
  },
  {
    text: 'Catálogo disponible: La estructura de las revoluciones científicas',
    key: 'Catálogo disponible: {title}',
    params: { title: 'La estructura de las revoluciones científicas' },
    field: 'message',
    source: 'electron/library/zoteroLibraryImport.ts',
    snippet: 'Catálogo disponible: ${item.title}',
  },
  { text: 'Catálogo listo; reconciliando notas…', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },
  {
    text: 'Notas: La estructura de las revoluciones científicas',
    key: 'Notas: {title}',
    params: { title: 'La estructura de las revoluciones científicas' },
    field: 'message',
    source: 'electron/library/zoteroLibraryImport.ts',
    snippet: 'Notas: ${item.title}',
  },
  { text: 'Copiando y verificando adjuntos…', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },
  {
    text: 'Adjuntos: La estructura de las revoluciones científicas',
    key: 'Adjuntos: {title}',
    params: { title: 'La estructura de las revoluciones científicas' },
    field: 'message',
    source: 'electron/library/zoteroLibraryImport.ts',
    snippet: 'Adjuntos: ${item.title}',
  },
  {
    text: 'Verificando Mi biblioteca contra el inventario…',
    key: 'Verificando {library} contra el inventario…',
    params: { library: 'Mi biblioteca' },
    field: 'message',
    source: 'electron/library/zoteroLibraryImport.ts',
    snippet: 'Verificando ${library.name} contra el inventario…',
  },
  { text: 'Verificando el índice local…', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },
  { text: 'Finalizando claves de cita y cola de extracción…', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },
  { text: 'Importación de Zotero completada y verificada.', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },
  { text: 'Importación cancelada; el catálogo ya importado se conserva.', field: 'message', source: 'electron/library/zoteroLibraryImport.ts' },

  // ---- States the bars report through a field called `error` without anything
  // having failed.
  { text: 'No hay obras con análisis profundo para indexar.', field: 'error', source: 'electron/ai/embeddingPipeline.ts' },
  { text: 'No hay obras disponibles para indexar.', field: 'error', source: 'electron/ai/passageEmbeddingPipeline.ts' },
  { text: 'La obra ya no existe.', field: 'error', source: 'electron/pipeline/documentIndexQueue.ts' },
];

function expected(line, language) {
  const key = line.key ?? line.text;
  const table = TABLES[language];
  assert.ok(key in table, `${language} has no entry for ${JSON.stringify(key)}`);
  let rendered = table[key];
  for (const [name, value] of Object.entries(line.params ?? {})) {
    rendered = rendered.split(`{${name}}`).join(value);
  }
  return rendered + (line.suffix ?? '');
}

test('every progress line is still spelled in Electron the way the tables expect', () => {
  for (const line of LINES) {
    const src = read(line.source);
    const needle = line.snippet ?? line.text;
    assert.ok(
      src.includes(needle),
      `${line.source} no longer writes ${JSON.stringify(needle)} — update src/i18n.*.ts and this list together`
    );
  }
});

for (const language of LANGUAGES) {
  test(`progress bars read in ${language}, not Spanish`, () => {
    i18n.setActiveLang(language);
    const untranslated = i18n.t('No se pudo traducir este mensaje.');
    for (const line of LINES) {
      const rendered = i18n.tr(line.text);
      assert.notEqual(rendered, untranslated, `${JSON.stringify(line.text)} is erased instead of translated`);
      assert.equal(rendered, expected(line, language), `${JSON.stringify(line.text)} is not rendered from its ${language} entry`);
    }
  });
  i18n.setActiveLang('es');
}

test('a progress line survives IPC localization instead of being read as a failure', () => {
  // Gate 1 only rewrites fields literally named `message` or `error`, so it reaches
  // exactly the lines that declare one — the Zotero import readout and the states the
  // bars report through `error`. The scan queue carries its prose in `detail`, which
  // this gate never touches; tr() alone answers for those.
  const gated = LINES.filter((line) => line.field);
  assert.ok(gated.length >= 15, 'the message/error lines are the ones this gate must protect');
  for (const language of LANGUAGES) {
    for (const line of gated) {
      assert.equal(
        localizeIpcPayload({ [line.field]: line.text }, language)[line.field],
        line.text,
        `${JSON.stringify(line.text)} is rewritten by localizeIpcPayload before the ${language} interface can translate it`
      );
    }
  }
});

test('the bottom bars translate runtime prose instead of printing it raw', () => {
  const queue = read('src/components/QueueBar.tsx');
  assert.match(queue, /tr\(running\.detail\)/);
  assert.match(queue, /tr\(maintenanceDetail/);
  assert.match(queue, /it\.error \? tr\(it\.error\)/);

  const zotero = read('src/components/ZoteroImportProgressBar.tsx');
  assert.match(zotero, /\{tr\(message\)\}/);
  assert.doesNotMatch(zotero, /· \{message\}/);

  const embeddings = read('src/components/EmbeddingProgressBar.tsx');
  assert.match(embeddings, /\{tr\(error\)\}/);
  assert.doesNotMatch(embeddings, /: \{error\}</);

  const passages = read('src/components/PassageProgressBar.tsx');
  assert.match(passages, /\{tr\(error\)\}/);
  assert.doesNotMatch(passages, /: \{error\}</);

  const documents = read('src/components/DocumentIndexProgressBar.tsx');
  assert.match(documents, /\{tr\(error\)\}/);
  assert.doesNotMatch(documents, />\{error\}</);

  // The import dialog shows the same sentence as the bar and used to show it raw.
  const library = read('src/views/GlobalLibraryView.tsx');
  assert.match(library, /\{tr\(progress\.message\)\}/);
  assert.match(library, /\{tr\(resumable\.progress\.message\)\}/);
});
