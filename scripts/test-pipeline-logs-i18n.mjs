// The log's two languages and its colours.
//
// The lines are stored as catalogue ids (shared/pipelineLogMessages.ts) and rendered by the
// modal in whichever language the reader picks beside the filters — English by default, so a
// log can be pasted into a GitHub issue as it stands. This test drives that renderer directly:
// a language switch must change the SENTENCE and the nested `{subject}`/`{reason}` inside it,
// in one pass, without leaving a `{placeholder}` behind.
//
// scripts/test-i18n-coverage.mjs proves every catalogue sentence has its eight translations;
// this one proves the renderer actually reaches them, and pins the colour contract the log
// surface promises (dark green on light, light green on dark, bold red for errors).
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-pipeline-log-i18n-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function bundle(entry, name) {
  const out = path.join(dir, `${name}.cjs`);
  execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    '--alias:@shared=./shared', '--loader:.css=empty', `--outfile=${out}`,
  ], { cwd: repoRoot, stdio: 'inherit' });
  return require(out);
}

// Presentation AND i18n from one entry: two bundles would be two module instances, and the
// interface-language switch below would never reach the renderer under test.
const presentation = bundle('scripts/fixtures/pipeline-logs/presentation.ts', 'presentation');
const messages = bundle('shared/pipelineLogMessages.ts', 'messages');
const i18nModule = presentation;
const { setActiveLang } = presentation;

test('a line renders in the chosen log language, nested subjects included', () => {
  const line = { id: 'logRetry', params: { subject: { id: 'subjectIndexing' }, attempt: 2, max: 4 } };
  assert.equal(presentation.renderPipelineLogLine(line, 'es'), 'Indexado de documentos: error — reintentando (2/4)');
  assert.equal(presentation.renderPipelineLogLine(line, 'en'), 'Document indexing: error — retrying (2/4)');
  assert.equal(presentation.renderPipelineLogLine(line, 'fr'), 'Indexation des documents : erreur — nouvelle tentative (2/4)');
  assert.equal(presentation.renderPipelineLogLine(line, 'de'), 'Dokumentindexierung: Fehler — neuer Versuch (2/4)');
  assert.equal(presentation.renderPipelineLogLine(line, 'tr'), 'Belge indeksleme: hata — yeniden deneniyor (2/4)');
  assert.equal(presentation.renderPipelineLogLine(line, 'zh-CN'), '文档索引：错误 — 正在重试（2/4）');

  // A reason is a catalogue id too, so it follows the same language.
  const degraded = { id: 'logWarning', params: { subject: { id: 'subjectExtraction' }, reason: { id: 'reasonNoAttachment' } } };
  assert.equal(presentation.renderPipelineLogLine(degraded, 'en'), 'Text extraction: warning — the item has no readable attachment');
  assert.equal(presentation.renderPipelineLogLine(degraded, 'it'), 'Estrazione del testo: avviso — l’elemento non ha allegati leggibili');
});

// The `{detail}` of a failure is the `message` of the error the main process threw, in the
// language that process wrote it. On an English log it used to arrive as Spanish — the
// screenshot in issue #830 carries "Document indexing: error — No se puede publicar una ficha
// que no superó la auditoría." — so the renderer now consults the same catalogue the main
// process uses, and leaves alone everything that is not one of our sentences.
test('an error sentence the main process wrote reaches the log in the log’s language', () => {
  const refused = {
    id: 'logFailed',
    params: { subject: { id: 'subjectIndexing' }, detail: 'No se puede publicar una ficha que no superó la auditoría.' },
  };
  assert.equal(
    presentation.renderPipelineLogLine(refused, 'en'),
    'Document indexing: error — A record that failed the audit cannot be published.',
  );
  assert.equal(
    presentation.renderPipelineLogLine(refused, 'es'),
    'Indexado de documentos: error — No se puede publicar una ficha que no superó la auditoría.',
  );
  assert.equal(
    presentation.renderPipelineLogLine(refused, 'fr'),
    'Indexation des documents : erreur — Une fiche qui n’a pas passé l’audit ne peut pas être publiée.',
  );
  assert.equal(
    presentation.renderPipelineLogLine(refused, 'de'),
    'Dokumentindexierung: Fehler — Ein Datensatz, der die Prüfung nicht bestanden hat, kann nicht veröffentlicht werden.',
  );

  // A provider's own wording, a document title and a path are not ours to translate: they
  // travel as they arrived, in every language.
  const provider = { id: 'logFailed', params: { subject: { id: 'subjectJsonResponse' }, detail: 'Unexpected token <' } };
  const title = { id: 'logWarningDetail', params: { subject: { id: 'subjectIndexing' }, detail: 'Temperature Cycled Operation' } };
  for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN']) {
    assert.ok(presentation.renderPipelineLogLine(provider, language).endsWith('Unexpected token <'), `${language}: a provider sentence is not rewritten`);
    assert.ok(presentation.renderPipelineLogLine(title, language).endsWith('Temperature Cycled Operation'), `${language}: a document title is not rewritten`);
  }
  // The diagnostics a refused profile carries are language-neutral, so they read the same
  // everywhere instead of leaking Spanish tag names into an English log.
  const diagnostics = 'verdict=rejected · score=0.79 · support=1.00 · structure=1.00';
  assert.equal(presentation.renderPipelineLogDetail(diagnostics, 'en'), diagnostics);
  assert.equal(presentation.renderPipelineLogDetail(diagnostics, 'zh-CN'), diagnostics);
  assert.equal(presentation.renderPipelineLogDetail('No se puede publicar una ficha que no superó la auditoría.', 'en'),
    'A record that failed the audit cannot be published.');
  assert.equal(presentation.renderPipelineLogDetail(null, 'en'), null);
});

// The library extraction reports its findings as a list of our own sentences joined with
// `; `, and the log prints the list as one value — the screenshot of a real run carried
// "Document extracted with warnings: … · El texto contiene espacios dobles inesperados."
// No single lookup can match a list, so the renderer translates it item by item, and
// refuses the list outright when any item is not ours.
test('a list of extraction warnings reaches the log in the log’s language', () => {
  // The real line: `documentExtractedReview` carries the report as `{warnings}`, which is why
  // translating only `{detail}` was not enough.
  const line = {
    id: 'documentExtractedReview',
    params: {
      subject: { id: 'subjectLibraryExtraction' },
      title: 'MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications',
      warnings: 'El texto contiene espacios dobles inesperados.; Hay 2 nota(s) sin referencia bidireccional.',
    },
  };
  assert.equal(
    presentation.renderPipelineLogLine(line, 'en'),
    'Document extracted with warnings: MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications · The text contains unexpected double spaces.; 2 note(s) have no two-way reference.',
  );
  assert.equal(
    presentation.renderPipelineLogLine(line, 'es'),
    'Documento extraído con avisos: MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications · El texto contiene espacios dobles inesperados.; Hay 2 nota(s) sin referencia bidireccional.',
  );
  assert.equal(
    presentation.renderPipelineLogLine(line, 'de'),
    'Dokument mit Warnungen extrahiert: MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications · Der Text enthält unerwartete doppelte Leerzeichen.; 2 Notiz(en) haben keinen beidseitigen Verweis.',
  );
  // One warning is just a sentence, and it follows the same catalogue.
  const single = { id: 'logWarningDetail', params: { subject: { id: 'subjectLibraryExtraction' }, detail: 'La extracción contiene muy poco texto.' } };
  assert.equal(presentation.renderPipelineLogLine(single, 'en'), 'Library extraction: warning — The extraction contains very little text.');
  assert.equal(presentation.renderPipelineLogLine(single, 'fr'), 'Extraction de la bibliothèque : avertissement — L’extraction contient très peu de texte.');
  // A list with anything that is not ours stays exactly as stored: half-translating it would
  // put two languages inside one sentence, which is the leak itself.
  const mixed = { ...line, params: { ...line.params, warnings: 'El texto contiene espacios dobles inesperados.; 42 widgets went missing.' } };
  assert.equal(
    presentation.renderPipelineLogLine(mixed, 'en'),
    'Document extracted with warnings: MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications · El texto contiene espacios dobles inesperados.; 42 widgets went missing.',
  );
  // A title is not a sentence of ours, in any language.
  assert.equal(
    presentation.renderPipelineLogLine({ id: 'logInfo', params: { subject: { id: 'subjectExtraction' }, detail: 'Historia contemporánea' } }, 'de'),
    'Textextraktion: Historia contemporánea',
  );
});

test('counts and titles keep their numbers in every language', () => {
  const indexed = { id: 'documentIndexed', params: { title: 'Historia contemporánea', sections: 12, vectors: 40 } };
  for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN']) {
    const rendered = presentation.renderPipelineLogLine(indexed, language);
    assert.ok(rendered.includes('Historia contemporánea'), `${language}: the document keeps its title`);
    assert.ok(rendered.includes('12') && rendered.includes('40'), `${language}: the counts survive`);
    assert.ok(!/\{\w+\}/.test(rendered), `${language}: no unresolved placeholder: ${rendered}`);
  }
  const summary = { id: 'campaignFinished', params: { completed: 160, total: 200, failed: 40 } };
  assert.equal(presentation.renderPipelineLogLine(summary, 'en'), 'Indexing finished: 160 of 200 documents (40 failed)');
});

test('the exported .txt follows the same language as the lines', async () => {
  const exporter = bundle('src/components/pipeline-logs/pipelineLogExport.ts', 'exporter');
  const entry = {
    id: 'pl-1',
    at: '2026-09-15T10:00:00.000Z',
    level: 'error',
    category: 'json',
    scope: 'indexing',
    message: { id: 'logFailed', params: { subject: { id: 'subjectJsonResponse' }, detail: 'Unexpected token <' } },
    code: 'invalid_json',
    detail: null,
    repeat: 1,
    firstAt: null,
    vaultId: 'v1',
    vaultName: 'Tesis',
    documentTitle: 'Historia contemporánea',
  };
  const english = exporter.buildLogEntryText(entry, 'en');
  assert.match(english, /Model JSON response: error — Unexpected token </);
  assert.match(english, /Log language: en/);
  const spanish = exporter.buildLogEntryText(entry, 'es');
  assert.match(spanish, /Respuesta JSON del modelo: error — Unexpected token </);
  // The JSON export keeps the machine-readable half of the line, which is what a bug report
  // pastes next to a stack trace.
  const json = JSON.parse(exporter.buildLogEntryJson(entry, 'en'));
  assert.equal(json.code, 'invalid_json');
  assert.equal(json.level, 'error');
  assert.equal(json.message.text, 'Model JSON response: error — Unexpected token <');
  assert.equal(json.vaultName, 'Tesis');
  // The `detail:` line — the secondary line under a row — follows the same language, whether
  // it carries one of our sentences or the value it always was.
  const refused = {
    ...entry,
    message: { id: 'logFailedPlain', params: { subject: { id: 'subjectIndexing' } } },
    detail: 'No se puede publicar una ficha que no superó la auditoría.',
  };
  assert.match(exporter.buildLogEntryText(refused, 'en'), /detail: A record that failed the audit cannot be published\./);
  assert.match(exporter.buildLogEntryText(refused, 'de'), /detail: Ein Datensatz, der die Prüfung nicht bestanden hat, kann nicht veröffentlicht werden\./);
  assert.equal(JSON.parse(exporter.buildLogEntryJson(refused, 'en')).detail, 'A record that failed the audit cannot be published.');
  const titled = { ...entry, message: { id: 'logInfo', params: { subject: { id: 'subjectExtraction' }, detail: 'Historia contemporánea' } }, detail: 'Historia contemporánea' };
  assert.match(exporter.buildLogEntryText(titled, 'en'), /detail: Historia contemporánea/);
});

test('the colours are the standardised ones, in both themes', () => {
  const { LEVEL_PRESENTATION } = presentation;
  // Green success: dark green on the light theme, light green on the dark one.
  assert.match(LEVEL_PRESENTATION.success.text, /text-green-700/);
  assert.match(LEVEL_PRESENTATION.success.text, /dark:text-green-400/);
  assert.match(LEVEL_PRESENTATION.success.accent, /border-l-green-600/);
  assert.match(LEVEL_PRESENTATION.success.accent, /dark:border-l-green-400/);
  // Red AND bold for an error — the one the reader must never miss.
  assert.match(LEVEL_PRESENTATION.error.text, /text-red-600/);
  assert.match(LEVEL_PRESENTATION.error.text, /dark:text-red-400/);
  assert.match(LEVEL_PRESENTATION.error.text, /font-semibold/);
  assert.match(LEVEL_PRESENTATION.error.accent, /border-l-red-600/);
  assert.match(LEVEL_PRESENTATION.error.row, /bg-red-500\/5/);
  // Amber warnings, neutral information, each with a light-theme and a dark-theme variant.
  assert.match(LEVEL_PRESENTATION.warning.text, /text-amber-700/);
  assert.match(LEVEL_PRESENTATION.warning.text, /dark:text-amber-400/);
  assert.match(LEVEL_PRESENTATION.info.text, /text-neutral-700/);
  assert.match(LEVEL_PRESENTATION.info.text, /dark:text-neutral-300/);
  for (const level of ['success', 'error', 'warning', 'info']) {
    assert.match(LEVEL_PRESENTATION[level].badge, /dark:/, `${level} badge needs a dark variant`);
    assert.ok(LEVEL_PRESENTATION[level].label.length > 0, `${level} needs a translatable label`);
  }
});

test('the chrome follows the interface language while the lines follow their own', () => {
  setActiveLang('en');
  assert.equal(presentation.categoryLabel('json'), 'JSON');
  assert.equal(presentation.categoryLabel('connection'), 'Connection');
  assert.equal(presentation.categoryLabel('indexing'), 'Indexed');
  assert.equal(presentation.categoryLabel('storage'), 'Storage');
  assert.equal(i18nModule.t(presentation.LEVEL_PRESENTATION.error.label), 'Error');
  assert.equal(i18nModule.t(presentation.LEVEL_PRESENTATION.success.label), 'Success');
  assert.equal(i18nModule.t(presentation.LEVEL_PRESENTATION.warning.label), 'Warning');
  assert.equal(i18nModule.t('Registros de procesamiento'), 'Processing logs');
  assert.equal(i18nModule.t('Copiar registro'), 'Copy log');
  assert.equal(i18nModule.t('Descargar lo mostrado (.txt)'), 'Download shown (.txt)');
  assert.equal(i18nModule.tx('{count} entradas', { count: 1284 }), '1284 entries');
  setActiveLang('es');
  assert.equal(i18nModule.t('Registros de procesamiento'), 'Registros de procesamiento');
  assert.equal(i18nModule.t('Copiar registro'), 'Copiar registro');
  // …and the log lines are unaffected by the interface language.
  assert.equal(presentation.renderPipelineLogLine({ id: 'logDone', params: { subject: { id: 'subjectOcr' } } }, 'en'), 'OCR: completed');
});

test('the language selector offers every supported language, ordered like Settings', () => {
  const modal = readFileSync(path.join(repoRoot, 'src/components/pipeline-logs/PipelineLogsModal.tsx'), 'utf8');
  const settings = readFileSync(path.join(repoRoot, 'src/views/Settings.tsx'), 'utf8');
  // The modal builds its options from a list; Settings writes them inline. Both are read as
  // `code: label` pairs so the comparison is about the languages and their order, not markup.
  const fromList = [...modal.matchAll(/\{ value: '([a-zA-Z-]+)', label: '([^']+)' \}/g)]
    .map((match) => `${match[1]}:${match[2]}`);
  const banner = settings.indexOf('value={settings.uiLanguage}');
  const uiLanguageSelect = settings.slice(banner, settings.indexOf('</select>', banner));
  const fromSelect = [...uiLanguageSelect.matchAll(/<option value="(es|en|fr|de|pt|pt-BR|it|tr|zh-CN|zh-TW|ja|ko)">([^<]+)<\/option>/g)]
    .map((match) => `${match[1]}:${match[2]}`);
  assert.equal(fromList.length, 12, 'the log language selector must offer all twelve languages');
  assert.equal(fromSelect.length, 12, 'the Settings selector must offer all twelve languages');
  assert.deepEqual(fromList, fromSelect, 'the order and the labels must match the Settings selector');
  // English is the default, so a log is shareable on GitHub without touching the selector.
  const defaults = readFileSync(path.join(repoRoot, 'shared/defaultAppSettings.ts'), 'utf8');
  assert.match(defaults, /pipelineLogLanguage: 'en'/, 'the log defaults to English');
  assert.match(defaults, /pipelineLogRetention: '10d'/, 'ten days of log by default');
});

test('every catalogue sentence is a real key in every language', () => {
  const { PIPELINE_LOG_TEXT } = messages;
  const tables = {
    en: bundle('src/i18n.en.ts', 'en').EN,
    fr: bundle('src/i18n.fr.ts', 'fr').FR,
    de: bundle('src/i18n.de.ts', 'de').DE,
    pt: bundle('src/i18n.pt.ts', 'pt').PT,
    'pt-BR': bundle('src/i18n.pt-BR.ts', 'ptbr').PT_BR,
    it: bundle('src/i18n.it.ts', 'it').IT,
    tr: bundle('src/i18n.tr.ts', 'tr').TR,
    'zh-CN': bundle('src/i18n.zh-CN.ts', 'zh').ZH_CN,
  };
  const placeholders = (sentence) => [...sentence.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
  for (const [id, sentence] of Object.entries(PIPELINE_LOG_TEXT)) {
    const expected = placeholders(sentence);
    for (const [language, table] of Object.entries(tables)) {
      const translated = table[sentence];
      assert.ok(typeof translated === 'string' && translated.trim().length > 0, `${id} is not translated into ${language}`);
      assert.equal(placeholders(translated), expected, `${id} (${language}) must keep the same placeholders`);
    }
  }
});
