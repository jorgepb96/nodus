// Every error the queue surfaces can show, in every language.
//
// The rule this file enforces is the one the queue kept breaking: a failure that the user can
// read must arrive translated, whichever gate it came through. Two gates exist —
// `localizeRuntimeError` in Electron (only for IPC fields named `message`/`error`) and `tr()`
// in the renderer (used by `pausedReason`, `saveError`, a job's own error, a rail's status
// text) — and a sentence that only one of them knew about used to reach the screen as Spanish
// or as "this message could not be translated".
//
// Part 1 drives `tr()` over the real sentences each producer writes. Part 2 pins the render
// sites themselves by source, because a component that stops calling `tr()` compiles, ships
// and quietly shows Spanish: that is exactly how the gaps below appeared.
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
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-queue-error-i18n-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const entry = path.join(dir, 'i18n.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'scripts/fixtures/i18n-runtime.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', '--alias:@shared=./shared', '--loader:.css=empty', `--outfile=${entry}`],
  { cwd: repoRoot, stdio: 'inherit' },
);
const i18n = require(entry);
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

const LANGUAGES = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'];

/**
 * The sentences the queue can put in front of a reader, grouped by where they come from.
 * Every one is a real string written by the producer named beside it.
 */
const SENTENCES = [
  // The scan queue's paused banner: `QueueBar` renders `tr(pausedReason)`, and this field is
  // NOT named `message`/`error`, so the renderer is its only gate.
  ['aiClient.ts (no AI model)', 'No hay un modelo de IA configurado. Elige uno en Ajustes.'],
  ['aiClient.ts (invalid key)', 'Clave de IA inválida. Revísala en Ajustes.'],
  ['aiClient.ts (timeout)', 'Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.'],
  ['aiClient.ts (rate limit)', 'Límite de tasa del proveedor de IA'],
  ['aiClient.ts (provider 5xx)', 'Error del proveedor (503)'],
  ['aiClient.ts (400 with detail)', 'El proveedor rechazó la solicitud (400). Detalle: model `gpt-4o-mini` does not exist'],
  ['aiClient.ts (context overflow)', 'El modelo no tiene suficiente contexto para esta petición. Reduce el tamaño de la tarea, aumenta el contexto del modelo (Context Length / num_ctx si es local) o usa un modelo con más contexto.'],
  ['scanQueue.ts (missing work)', 'Obra no encontrada'],
  ['scanQueue.ts (retry readout)', 'Reintentando (2/4)…'],
  // Document index states, rendered by the rail, the manager and the queue rows.
  ['documentIndexQueue.ts (deleted work)', 'La obra ya no existe.'],
  ['documentProfile.ts (no legible text)', 'No hay texto completo legible'],
  // Embedding pipelines, rendered by their bars.
  ['embeddingPipeline.ts (nothing to index)', 'No hay obras con análisis profundo para indexar.'],
  ['passageEmbeddingPipeline.ts (nothing to index)', 'No hay obras disponibles para indexar.'],
];

/**
 * The dictionary's own progress prefixes are read by DictionaryView's helper, which maps each
 * one to a t() key; they never reach tr(). Kept beside the list above so both halves of the
 * audit stay visible in one place.
 */
const DICTIONARY_PREFIXES = ['En cola', 'Analizando corpus', 'Generando definición', 'Redactando definición', 'Comprobando'];

test('every queue failure reads translated in every language', () => {
  const untranslatedNotice = i18n.resolveTranslation('en', 'No se pudo traducir este mensaje.');
  for (const [origin, sentence] of SENTENCES) {
    for (const language of LANGUAGES) {
      i18n.setActiveLang(language);
      const rendered = i18n.tr(sentence);
      assert.ok(rendered && rendered.trim().length > 0, `${origin} (${language}): empty`);
      assert.notEqual(rendered, sentence, `${origin} (${language}): left in Spanish`);
      assert.notEqual(rendered, untranslatedNotice, `${origin} (${language}): fell back to "could not be translated"`);
      assert.ok(!/\{[a-z]+\}/.test(rendered), `${origin} (${language}): unresolved placeholder in ${rendered}`);
    }
  }
  i18n.setActiveLang('es');
  for (const [origin, sentence] of SENTENCES) {
    assert.equal(i18n.tr(sentence), sentence, `${origin}: Spanish is the source language and must be untouched`);
  }
});

test('prose that is not ours is left alone instead of being mangled', () => {
  // A provider's own words are the technical detail a maintainer needs, and none of these
  // matches a Spanish catalogue or pattern.
  const technical = [
    'Unexpected token < in JSON at position 0',
    'Connection error.',
    'fetch failed',
    'model \`gpt-4o-mini\` does not exist',
  ];
  for (const language of LANGUAGES) {
    i18n.setActiveLang(language);
    for (const value of technical) {
      assert.equal(i18n.tr(value), value, `${language}: provider prose must survive verbatim (${value})`);
    }
  }
  i18n.setActiveLang('es');
});

test('the dictionary progress readout translates its prefixes through t()', () => {
  const dictionary = read('src/views/DictionaryView.tsx');
  const helper = dictionary.slice(dictionary.indexOf('function dictionaryProgressText'), dictionary.indexOf('function dictionaryVersionText'));
  for (const prefix of DICTIONARY_PREFIXES) {
    assert.ok(helper.includes(`"${prefix}`) || helper.includes(`'${prefix}`), `${prefix} must be recognised by the helper`);
  }
  // Every recognised prefix maps to a t() key, and the unknown rest goes through tr().
  assert.equal((helper.match(/return t\("/g) ?? []).length, DICTIONARY_PREFIXES.length);
  assert.match(helper, /return tr\(value\);/);
  // The keys themselves are held to full coverage by scripts/test-i18n-coverage.mjs.
  for (const key of ['En cola', 'Analizando corpus…', 'Generando definición…', 'Redactando definición…', 'Comprobando…']) {
    assert.ok(i18n.resolveTranslation('en', key) !== key, `${key} needs an English translation`);
  }
});

test('the document-index error surfaces translate what they are handed', () => {
  // The rail already did; the manager painted the same value raw, and it is the surface a
  // user opens on purpose.
  const rail = read('src/components/DocumentIndexProgressBar.tsx');
  assert.match(rail, /\{tr\(error\)\}/, 'the rail must translate the job error');
  const manager = read('src/views/DocumentIndexManager.tsx');
  assert.match(manager, /break-words">\{tr\(liveError\)\}/, 'the manager must translate the campaign/job error');
  assert.doesNotMatch(manager, /break-words">\{liveError\}/, 'and must not paint it raw again');
  // The steps in the rail and the phase labels are keys, rendered through t().
  assert.match(rail, /t\(\[\.\.\.\]|t\(PHASE_LABEL|t\(\{/);
});

test('the queue bars and rows translate every error they can show', () => {
  const queueBar = read('src/components/QueueBar.tsx');
  for (const field of ['pausedReason', 'maintenanceError', 'maintenanceDetail']) {
    assert.match(queueBar, new RegExp(`\\{tr\\(${field}[^}]*\\)\\}`), `${field} must be translated`);
  }
  assert.match(queueBar, /title=\{it\.error \? tr\(it\.error\) : undefined\}/, 'a failed scan row must translate its error');
  assert.match(read('src/components/EmbeddingProgressBar.tsx'), /\{tr\(error\)\}/);
  assert.match(read('src/components/PassageProgressBar.tsx'), /\{tr\(error\)\}/);
  // The shared task primitive: the error goes through errorText, the detail through tr.
  const tasks = read('src/components/AdditionalQueueTasks.tsx');
  assert.match(tasks, /\{errorText\(error\)\}/, 'a task row must translate its error');
  assert.match(tasks, /tr\(job\.message\)/, 'a library extraction readout must be translated');
  assert.match(tasks, /tr\(job\.message\)|tr\(progress\.message\)|tr\(progress\.label\)/);
});

test('the dictionary and deep-research failures are translated at the point they are shown', () => {
  const dictionary = read('src/views/DictionaryView.tsx');
  assert.match(dictionary, /const message = \(reason: unknown\) => errorText\(reason\);/,
    'a dictionary failure reason must be translated as it is captured');
  assert.doesNotMatch(dictionary, /title=\{progress\.error\}/, 'the failure tooltip must not show the raw reason');
  assert.match(dictionary, /title=\{progress\.error \? errorText\(progress\.error\) : undefined\}/);
  assert.match(dictionary, /\{progress\.error \? errorText\(progress\.error\) : t\("La generación no pudo completarse\."\)\}/);
  assert.match(dictionary, /if \(value\.startsWith\("Comprobando"\)\) return t\("Comprobando…"\);\s*return tr\(value\);/,
    'an unknown dictionary progress message must still be translated');

  const strip = read('src/components/DeepResearchQueueStrip.tsx');
  assert.match(strip, /default: return tr\(progress\.message\);/,
    'a deep-research phase with no label must not return the raw pipeline message');
  assert.match(strip, /\{item\.error \? `\$\{t\('Falló'\)\}: \$\{errorText\(item\.error\)\}` : t\('Falló'\)\}/);
  assert.match(strip, /title=\{item\.error \? errorText\(item\.error\) : displayTitle\(item\)\}/);

  const view = read('src/views/DeepResearchView.tsx');
  assert.match(view, /setError\(errorText\(unsaved\.saveError\)\)/, 'a failed save must be translated');
  assert.match(view, /\{errorText\(error \?\? message\)\}/, 'and the banner must translate what it shows');
});

test('no label inside the queue panel is left as a bare literal', () => {
  // Each of these sat next to a translated neighbour, which is how it went unnoticed.
  assert.match(read('src/components/EmbeddingProgressBar.tsx'), /\{t\('Embeddings'\)\}/);
  assert.doesNotMatch(read('src/components/EmbeddingProgressBar.tsx'), /whitespace-nowrap">Embeddings</);
  assert.match(read('src/components/ZoteroImportProgressBar.tsx'), /\{t\('Zotero'\)\}/);
  assert.doesNotMatch(read('src/components/ZoteroImportProgressBar.tsx'), /text-amber-500">Zotero</);
  assert.match(read('src/components/NotificationsPanel.tsx'), /\{t\('Nodus Radar'\)\}/);
  const strip = read('src/components/DeepResearchQueueStrip.tsx');
  assert.match(strip, /origin === 'mobile' \? t\('Móvil'\) : t\('MCP'\)/);
  assert.match(strip, /item\.origin !== 'app' && <OriginBadge origin=\{item\.origin\}/);
  const tasks = read('src/components/AdditionalQueueTasks.tsx');
  assert.match(tasks, /t\('Nodus Convert'\)/);
  assert.match(tasks, /t\('Nodus Translate'\)/);
  assert.doesNotMatch(tasks, /\? 'Nodus Convert' :/);
});

test('the "no legible text" state travels as a key, so both gates translate it', () => {
  // It used to be thrown with a trailing period that no catalogue entry had, which made it
  // unknown Spanish prose: Electron replaced it with a generic error and the renderer showed
  // it raw. The producer now writes the key and the state list hands it to the renderer.
  const uiLanguage = read('shared/uiLanguage.ts');
  assert.match(uiLanguage, /export function knownRuntimeErrorText\(message: string, language: unknown\): string \| null \{/,
    'the renderer needs the main-process catalogues');
  assert.match(uiLanguage, /export function localizeRuntimeError\(message: string, language: unknown\): string \{\s*const known = knownRuntimeErrorText\(message, language\);/,
    'and the main-process gate must keep its behaviour on top of them');
  const progressStates = uiLanguage.slice(uiLanguage.indexOf('export const PROGRESS_STATE_MESSAGES'), uiLanguage.indexOf('/**\n * The Zotero import readout'));
  assert.ok(progressStates.includes("'No hay texto completo legible',"), 'the state must be listed for the renderer');
  const profile = read('electron/ai/documentProfile.ts');
  assert.match(profile, /'No hay texto completo legible'\)/, 'the producer must write the key exactly');
  assert.doesNotMatch(profile, /'No hay texto completo legible\.'/, 'the trailing period broke every gate');
  // And the renderer consults those catalogues for fields Electron never touches.
  const i18nSource = read('src/i18n.ts');
  assert.match(i18nSource, /const known = knownRuntimeErrorText\(value, activeLang\);\s*if \(known !== null\) return known;/);
});
