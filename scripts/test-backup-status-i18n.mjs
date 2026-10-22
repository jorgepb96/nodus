// Regression test for the second finding in #1285: the backup scheduler stores Spanish
// prose in `lastAutoBackupStatus`, and `getRecoveryStatus().health.detail` used to relay
// it verbatim into an English interface. The sentences now live in the shared backups
// catalogue, so both the main process and the renderer can translate them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-backup-status-i18n-'));

function load(entry) {
  const outfile = path.join(scratch, `${path.basename(entry, '.ts')}.cjs`);
  buildSync({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
    alias: { '@shared': path.join(repoRoot, 'shared') },
  });
  return require(outfile);
}

test.after(() => rm(scratch, { recursive: true, force: true }));

const { knownRuntimeErrorText, localizeIpcPayload } = load('shared/uiLanguage.ts');
const { BACKUPS_RUNTIME_ERRORS } = load('shared/backupsErrors.ts');

const LANGUAGES = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'];

const STATUS_MESSAGES = [
  'No hay carpeta de destino configurada.',
  'No hay contraseña maestra de copias configurada.',
  'No se pudo leer la contraseña maestra del almacén seguro del sistema. Vuelve a introducirla en Ajustes para reanudar las copias.',
];

for (const message of STATUS_MESSAGES) {
  test(`backup status is translated in every interface language: ${message}`, () => {
    const entry = BACKUPS_RUNTIME_ERRORS[message];
    assert.ok(entry, 'the message must be in the shared backups catalogue');
    for (const language of LANGUAGES) {
      assert.ok(entry[language]?.trim(), `${language} is missing from the catalogue entry`);
      const translated = knownRuntimeErrorText(message, language);
      assert.equal(translated, entry[language], `${language} must resolve to its catalogue entry`);
      assert.notEqual(translated, message, `${language} must not leak the Spanish source`);
    }
    assert.equal(knownRuntimeErrorText(message, 'es'), message, 'Spanish source stays unchanged');
  });
}

test('the manual backup toast message is localized through IPC', () => {
  const payload = localizeIpcPayload({ ok: false, message: 'No hay carpeta de destino configurada.' }, 'en');
  assert.equal(payload.message, 'No destination folder is configured.');
  assert.equal(
    localizeIpcPayload({ ok: false, message: 'No hay carpeta de destino configurada.' }, 'es').message,
    'No hay carpeta de destino configurada.',
  );
});

const DYNAMIC_CASES = [
  {
    source: 'Copia verificada y guardada en /tmp/ejemplo.nodus.',
    kept: '/tmp/ejemplo.nodus',
  },
  {
    source: 'Copia verificada y guardada en /tmp/ejemplo.nodus. Aviso: las claves de openai, anthropic no se pudieron leer del almacén seguro y no viajan en esta copia.',
    kept: 'openai, anthropic',
  },
  {
    source: 'La copia se escribió pero no se pudo verificar, así que se descartó y no se ha podado ninguna anterior: Formato de copia de seguridad no soportado.',
    kept: 'Formato de copia de seguridad no soportado.',
  },
];

for (const { source, kept } of DYNAMIC_CASES) {
  test(`backup status keeps its runtime value in every language: ${source}`, () => {
    for (const language of LANGUAGES) {
      const translated = knownRuntimeErrorText(source, language);
      assert.ok(translated, `${language} did not translate the status`);
      assert.notEqual(translated, source, `${language} leaked the Spanish source`);
      assert.ok(translated.includes(kept), `${language} dropped the runtime value`);
    }
    assert.equal(knownRuntimeErrorText(source, 'es'), source);
  });
}

test('the busy backup message translates its operation label too', () => {
  const retry = 'Hay otra operación de copias en curso (copia de seguridad). Vuelve a intentarlo cuando termine.';
  const cleanup = 'Hay otra operación de copias en curso (limpieza de copias). No se ha modificado nada.';
  for (const language of LANGUAGES) {
    for (const source of [retry, cleanup]) {
      const translated = knownRuntimeErrorText(source, language);
      assert.ok(translated, `${language} did not translate the busy message`);
      assert.notEqual(translated, source, `${language} leaked the Spanish source`);
      assert.doesNotMatch(translated, /copia de seguridad|limpieza de copias/,
        `${language} left the Spanish operation label embedded`);
    }
  }
});
