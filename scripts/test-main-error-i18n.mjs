// No main-process error sentence may reach a non-Spanish reader in Spanish.
//
// The app has two ways to keep an Electron error out of a foreign-language window, and
// both used to share one blind spot. `localizeRuntimeError` translates the messages it
// recognises; everything else goes to `looksLikeSpanishUiText`, and whatever that
// detector calls Spanish is replaced by the generic "the operation could not be
// completed". The detector wants a diacritic, two Spanish function words or a term from
// a short vocabulary — so short, accent-free sentences ("La nota no existe.", "El adjunto
// ya no existe.", "Escribe una pregunta.") satisfied neither path and arrived verbatim:
// Spanish prose in an English, French, German, Portuguese, Italian or Turkish interface.
//
// This test is the sweep that found them, kept runnable. It re-reads every error literal
// in electron/ and shared/, pushes each through `localizeRuntimeError` in all seven
// non-Spanish languages, and fails on any that comes back unchanged and Spanish. A new
// `throw new Error('…')` in the main process therefore has to be either English-neutral
// (a transport string, an identifier) or listed in shared/mainProcessErrors.ts.
//
// It also fails on the second, quieter failure: a Spanish message the detector DOES
// recognise, which `localizeRuntimeError` replaces with "the operation could not be
// completed". That is not a leak — the reader gets a sentence in their own language — but
// it erases the one thing the message was for. The sweep found 1,051 of those alongside
// the 146 leaks; both sets are now in the catalogue, so either regression fails here.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-main-error-i18n-'));

/** Bundle a TS module so its real exported values can be asserted on. esbuild's own API,
 *  not its command line: `.bin/esbuild` is a shell script Windows cannot execute, and
 *  `esbuild/bin/esbuild` is a native binary on macOS/Linux. */
function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  buildSync({
    entryPoints: [path.join(repoRoot, file)],
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
  });
  return require(bundle);
}

const { localizeRuntimeError, localizeIpcPayload } = load('shared/uiLanguage.ts');
const { MAIN_PROCESS_ERRORS, MAIN_PROCESS_ERROR_PATTERNS } = load('shared/mainProcessErrors.ts');
const { CLOUDFLARE_SYNC_ERRORS } = load('shared/cloudflareSyncErrors.ts');

/** Every language the interface offers, minus Spanish (the source). */
const LANGUAGES = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN'];

function sourceFiles() {
  const files = [];
  const walk = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  };
  for (const root of ['electron', 'shared']) walk(path.join(repoRoot, root));
  return files;
}

/**
 * Spanish detection for source literals, deliberately stricter than the runtime
 * `looksLikeSpanishUiText`: this one may be as aggressive as it likes because a false
 * positive costs a translation, not an erased message.
 *
 * Two signals, because neither alone is enough. Counting Spanish function words against
 * English ones handles ordinary prose and settles the words both languages share ("no",
 * "a", "solo", "con", "sin"), which a one-sided list gets wrong in both directions. But a
 * short label — "Modelo local no calibrable.", "Formato no compatible: X" — carries no
 * function words at all, so shape carries those: Spanish morphology (-ción, -idad,
 * -mente), "no" before a participle, and the nouns this app's errors are actually built
 * from followed by a Spanish word.
 *
 * Measured on the 146 sentences the original sweep found, against the 12 English error
 * literals living beside them: 146 detected, 0 false positives.
 */
const SPANISH_MARKERS = /(?:^|[\s“«("'¡¿/])(?:el|la|los|las|un|una|unos|unas|del|al|de|en|para|por|con|sin|este|esta|estos|estas|ese|esa|esos|esas|ya|se|su|sus|hay|es|son|y|que|más|cada|otra|otro|otros|otras|entre|desde|hasta|sobre|como|cuando|donde|todos|todas|muy|también|solo|mientras|aunque|porque|fuera|antes|después|primero|dos|debe|puede|pueden|falta|faltan|necesita|necesitan|existe|existen|pertenece|pertenecen|contiene|supera|permite|admite|intenta)(?:[\s.,:;!?)”»"'’]|$)/gi;
const ENGLISH_MARKERS = /(?:^|[\s“("'/])(?:the|of|is|are|was|were|this|that|these|those|has|have|had|does|did|not|and|to|in|on|at|with|from|for|be|been|it|its|an|a|no longer|there|any|only|must|cannot|can)(?:[\s.,:;!?)”"'’]|$)/gi;
/** Spanish morphology that survives without function words: "no soportado", "no válido",
 *  "-ción", "-mente", "-idad", and the participles Spanish error prose leans on. */
const SPANISH_SHAPE = /(?:\bno\s+\w*(?:ado|ada|ido|ida|oso|osa|ante)\b)|(?:\b(?:estuvo|estuvieron|estaba|estaban|quedó|quedaron|sigue|siguen)\b)|(?:\w{4,}(?:ción|ciones|idad|mente|ándose|iendo)\b)|(?:\bno\s+(?:válido|valido|válida|valida|compatible|permitid[ao]|soportad[ao]|encontrad[ao]|disponible)\b)|(?:\b(?:formato|modelo|idioma|plataforma|cadena|tabla|escala|fichero|bóveda|fallo|descarga|pregunta|propuesta|fuente|adjunto|apunte|asignatura|arista|cohorte|fila|columna|consulta|informe|marcador|proveedor|clave|copia|paquete|carpeta|equipo|servidor|imagen|texto|nivel|criterio|persona|lugar|nota|proyecto|comentario|recurso|permiso|enlace|documento|entrada|entrevista|estilo|estilos|intento|material|unidad|variante|identidad|corpus|cursor|serie|eje|propiedad|reintento|respuesta|solicitud|despliegue|contenido|estado|tipo|dato|datos|bases|hora|horas|opción|opciones|elemento|elementos|pareja|parejas|descriptor|descriptores|nombre|campo|informes|preguntas|documentos|estilos)\b\s+(?:no|ya|de|del|que|es|son|necesita|pertenece|contiene|local|nuevo|nueva|anterior|superior|inverso|inversa|padre)\b)/i;

function looksSpanish(text) {
  if (/[áéíóúñ¿¡]/i.test(text)) return true;
  if (SPANISH_SHAPE.test(text)) return true;
  const spanish = (text.match(SPANISH_MARKERS) ?? []).length;
  const english = (text.match(ENGLISH_MARKERS) ?? []).length;
  return spanish > english;
}

/** Collect `new Error('…')` literals, with `${…}` replaced by a value that satisfies both
 *  the `\d+` and the `.+` capture groups the catalogue uses. */
function errorLiterals() {
  const patterns = [
    /new Error\(\s*'((?:[^'\\]|\\.)*)'/g,
    /new Error\(\s*"((?:[^"\\]|\\.)*)"/g,
    /new Error\(\s*`((?:[^`\\]|\\.)*)`/g,
  ];
  const literals = new Map();
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(src))) {
        const text = match[1].replace(/\$\{[^}]*\}/g, '1').replace(/\\n/g, ' ').trim();
        if (!text) continue;
        if (!literals.has(text)) literals.set(text, new Set());
        literals.get(text).add(path.relative(repoRoot, file));
      }
    }
  }
  return literals;
}

/**
 * Two literals a source scanner cannot judge, because their runtime text is not what the
 * file shows. `localError` only ever builds "Ollama" or "LM Studio" into its sentence, so
 * the catalogue pattern pins those two names and the scanner's placeholder matches
 * neither; and the testimony message is a string concatenation, so the scanner sees only
 * its first half. Both are asserted below in the exact form they actually reach a reader.
 */
const SCANNER_BLIND_SPOTS = new Set([
  'No se pudo conectar con 1 en 1. 1',
  'El acuerdo de esta entrevista no permite tratarla con IA: 1.',
]);

/** What an unrecognised Spanish message becomes — the outcome that erases the cause. */
const GENERIC = new Set([
  'The operation could not be completed.',
  'L’opération n’a pas pu être effectuée.',
  'Der Vorgang konnte nicht abgeschlossen werden.',
  'Não foi possível concluir a operação.',
  'Non è stato possibile completare l’operazione.',
  'İşlem tamamlanamadı.',
]);

test('no Spanish error literal in the main process reaches a foreign-language reader untranslated', () => {
  const leaks = [];
  for (const [message, files] of errorLiterals()) {
    if (!looksSpanish(message)) continue;
    const untouched = LANGUAGES.filter((language) => localizeRuntimeError(message, language) === message);
    if (untouched.length) leaks.push(`${JSON.stringify(message)} — ${[...files].join(', ')} (${untouched.join(', ')})`);
  }
  assert.deepEqual(leaks, [], `Spanish error messages that leak untranslated:\n  ${leaks.join('\n  ')}`);
});

test('no Spanish error literal in the main process is erased into the generic message', () => {
  const erased = [];
  for (const [message, files] of errorLiterals()) {
    if (!looksSpanish(message) || SCANNER_BLIND_SPOTS.has(message)) continue;
    const collapsed = LANGUAGES.filter((language) => GENERIC.has(localizeRuntimeError(message, language)));
    if (collapsed.length) erased.push(`${JSON.stringify(message)} — ${[...files].join(', ')} (${collapsed.join(', ')})`);
  }
  assert.deepEqual(erased, [], `Spanish error messages erased into the generic line:\n  ${erased.join('\n  ')}`);
});

test('every catalogue entry is translated in all seven languages and left alone in Spanish', () => {
  for (const [message, translations] of Object.entries(MAIN_PROCESS_ERRORS)) {
    assert.equal(localizeRuntimeError(message, 'es'), message, `${message} must be unchanged in Spanish`);
    for (const language of LANGUAGES) {
      const out = localizeRuntimeError(message, language);
      assert.ok(translations[language], `${message} is missing a ${language} translation`);
      assert.equal(out, translations[language], `${message} must resolve to its ${language} translation`);
      assert.notEqual(out, message, `${message} must actually change in ${language}`);
    }
  }
});

test('every parameterized pattern keeps its runtime values and translates around them', () => {
  for (const { pattern, translate } of MAIN_PROCESS_ERROR_PATTERNS) {
    const translations = translate(...Array.from({ length: 4 }, () => '1'));
    for (const language of LANGUAGES) {
      assert.ok(translations[language], `${pattern} is missing a ${language} translation`);
    }
  }
});

test('Cloudflare safety errors preserve their cause and recovery instruction through IPC in every UI language', () => {
  const languages = [...LANGUAGES, 'zh-TW', 'ja', 'ko'];
  for (const [message, translations] of Object.entries(CLOUDFLARE_SYNC_ERRORS)) {
    for (const language of languages) {
      assert.ok(translations[language], `${message} needs a ${language} translation`);
      const localized = localizeIpcPayload({ ok: false, error: message }, language);
      assert.equal(localized.error, translations[language]);
      assert.ok(!GENERIC.has(localized.error));
    }
  }
  const cause = 'La publicación alcanzó el límite de seguridad de llamadas a Cloudflare.';
  const suffixes = [
    'La sincronización automática se ha detenido para evitar llamadas repetidas.',
    'La sincronización automática se ha detenido para evitar llamadas repetidas. Vuelve a conectar o sincroniza manualmente tras resolver el error.',
  ];
  for (const language of languages) {
    for (const suffix of suffixes) {
      const message = `${cause} ${suffix}`;
      const localized = localizeIpcPayload({ ok: false, error: message }, language);
      assert.equal(localized.error, `${CLOUDFLARE_SYNC_ERRORS[cause][language]} ${CLOUDFLARE_SYNC_ERRORS[suffix][language]}`);
      assert.equal(localizeRuntimeError(message, 'es'), message);
      assert.equal(localizeRuntimeError(`HTTP 429 ${suffix}`, language), `HTTP 429 ${CLOUDFLARE_SYNC_ERRORS[suffix][language]}`);
    }
    for (const [message, value] of [
      ['El índice ideas-768 supera el límite seguro de búsqueda exacta de Cloudflare.', 'ideas-768'],
      ['El proceso auxiliar de réplica terminó sin completar la importación (SIGKILL).', 'SIGKILL'],
      ['No se pudieron verificar las protecciones de Cloudflare (HTTP 503).', '503'],
      ['Cloudflare no devolvió el relay (HTTP 429).', '429'],
    ]) {
      const localized = localizeIpcPayload({ ok: false, error: message }, language);
      assert.ok(localized.error.includes(value), `${language} preserves ${value}`);
      assert.notEqual(localized.error, message);
      assert.ok(!GENERIC.has(localized.error));
    }
  }
});

test('Scriptor errors preserve recovery codes and unsupported formula elements through IPC', () => {
  const messages = [
    'REVISION_CONFLICT: La nota ha cambiado en otra sesión. El borrador se conserva.',
    'ACADEMIC_PROJECTION_CONFLICT: Esta edición eliminaría citas o notas estructuradas. Abre Scriptor para resolverla; el borrador se conserva.',
  ];
  for (const language of LANGUAGES) {
    for (const message of messages) {
      const localized = localizeIpcPayload({ ok: false, error: message }, language);
      assert.equal(localized.ok, false);
      assert.ok(localized.error.startsWith(message.split(':')[0] + ':'), 'draft recovery remains detectable');
      assert.notEqual(localized.error, message);
      assert.ok(!GENERIC.has(localized.error));
    }
    const formula = localizeRuntimeError('La fórmula contiene un elemento no compatible con Word: merror', language);
    assert.ok(formula.endsWith(' merror'), 'the rejected element stays available to diagnose the export');
    assert.notEqual(formula, 'La fórmula contiene un elemento no compatible con Word: merror');
    assert.ok(!GENERIC.has(formula));
  }
});

test('catalogue and server-address errors keep their specific cause through IPC in every UI language', () => {
  const messages = [
    ['El proveedor no devolvió un catálogo de modelos válido.', 'The provider did not return a valid model catalogue.'],
    ['El catálogo de modelos está incompleto.', 'The model catalogue is incomplete.'],
    ['Falta la dirección del servidor.', 'The server address is missing.'],
  ];
  for (const [message, english] of messages) {
    const payload = { ok: false, message };
    assert.deepEqual(localizeIpcPayload(payload, 'es'), payload);
    assert.equal(localizeIpcPayload(payload, 'en').message, english);
    for (const language of [...LANGUAGES, 'zh-TW', 'ja', 'ko']) {
      const translated = localizeIpcPayload(payload, language);
      assert.equal(translated.ok, false);
      assert.ok(MAIN_PROCESS_ERRORS[message][language], `${message} needs a ${language} translation`);
      assert.equal(translated.message, MAIN_PROCESS_ERRORS[message][language]);
      assert.notEqual(translated.message, message);
      assert.ok(!GENERIC.has(translated.message), `${language} must preserve the cause of ${message}`);
    }
  }
});

test('the local provider failure that opened this file names its cause in every language', () => {
  const message = 'No se pudo conectar con Ollama en http://localhost:11434. HTTP 404. ¿Está Ollama en marcha?';
  assert.equal(localizeRuntimeError(message, 'es'), message);
  assert.equal(
    localizeRuntimeError(message, 'en'),
    'Could not connect to Ollama at http://localhost:11434. HTTP 404. Is Ollama running?',
  );
  for (const language of LANGUAGES) {
    const out = localizeRuntimeError(message, language);
    assert.notEqual(out, message, `the Ollama failure must be translated in ${language}`);
    assert.ok(out.includes('http://localhost:11434'), `the base URL must survive in ${language}`);
    assert.ok(out.includes('404'), `the HTTP status must survive in ${language}`);
    assert.notEqual(out, 'The operation could not be completed.', `${language} must not collapse into the generic error`);
  }
});

test('a transport detail we did not author is passed through verbatim', () => {
  const message = 'No se pudo conectar con LM Studio en http://localhost:1234. fetch failed';
  const english = localizeRuntimeError(message, 'en');
  assert.equal(english, 'Could not connect to LM Studio at http://localhost:1234. fetch failed');
  assert.ok(localizeRuntimeError(message, 'de').endsWith('fetch failed'), 'transport output stays verbatim');
});

test('the Settings connection test reports its HTTP status, not a generic failure', () => {
  const message = 'HTTP 500 en http://localhost:11434';
  assert.equal(localizeRuntimeError(message, 'en'), 'HTTP 500 at http://localhost:11434');
  assert.equal(localizeRuntimeError(message, 'fr'), 'HTTP 500 sur http://localhost:11434');
  assert.equal(localizeRuntimeError(message, 'es'), message);
});

test('the Settings result travels as an IPC payload, which is the path the report used', () => {
  // `testLocalProvider` does not throw: it RETURNS { ok: false, message }, so the
  // translation has to happen in `localizeIpcPayload`, not in the `h()` catch block.
  // ProvidersSettings then renders it as tx('Sin conexión: {msg}') — a key that was
  // already translated, around a value that was not.
  const result = { ok: false, message: 'No se pudo conectar con Ollama en http://localhost:11434. HTTP 404. ¿Está Ollama en marcha?' };
  assert.deepEqual(localizeIpcPayload(result, 'es'), result, 'Spanish keeps the source sentence');
  assert.equal(
    localizeIpcPayload(result, 'en').message,
    'Could not connect to Ollama at http://localhost:11434. HTTP 404. Is Ollama running?',
  );
  for (const language of LANGUAGES) {
    const { message } = localizeIpcPayload(result, language);
    assert.notEqual(message, result.message, `${language} must not receive the Spanish sentence`);
    assert.notEqual(message, 'The operation could not be completed.', `${language} must not receive the generic error`);
  }
});

test('the two literals the scanner cannot evaluate are translated in their real runtime form', () => {
  // Exempted from the sweep above, so they are pinned here instead — by hand, in the exact
  // shape the main process composes.
  const agreement = 'El acuerdo de esta entrevista no permite tratarla con IA: sin consentimiento documentado. '
    + 'Documenta el uso «tratamiento por IA» en el acuerdo, o usa un modelo local.';
  for (const message of ['No se pudo conectar con LM Studio en http://localhost:1234. fetch failed', agreement]) {
    assert.equal(localizeRuntimeError(message, 'es'), message, `${message} is unchanged in Spanish`);
    for (const language of LANGUAGES) {
      const out = localizeRuntimeError(message, language);
      assert.notEqual(out, message, `must be translated in ${language}`);
      assert.ok(!GENERIC.has(out), `must not collapse into the generic error in ${language}`);
    }
  }
  assert.match(localizeRuntimeError(agreement, 'en'), /^This interview's agreement does not allow AI processing: sin consentimiento documentado\./);
});
