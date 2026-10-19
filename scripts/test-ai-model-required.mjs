import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

test('missing-model errors have one stable classifier', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-required-'));
  try {
    const output = path.join(scratch, 'classifier.mjs');
    execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
      path.join(root, 'shared/aiModelRequired.ts'),
      '--bundle', '--platform=node', '--format=esm', `--outfile=${output}`,
    ], { cwd: root, stdio: 'pipe' });
    const { AI_MODEL_REQUIRED_ERROR_CODE, isAiModelRequiredError } = await import(pathToFileURL(output).href);
    assert.equal(isAiModelRequiredError({ code: AI_MODEL_REQUIRED_ERROR_CODE }), true);
    for (const message of [
      'No hay un modelo de IA configurado. Elige uno en Ajustes.',
      'No hay un modelo de visión configurado.',
      'Selecciona primero un modelo de IA en Ajustes.',
      'La página necesita un modelo de visión para traducirse.',
    ]) assert.equal(isAiModelRequiredError(new Error(message)), true, message);
    assert.equal(isAiModelRequiredError(new Error('El modelo no devolvió un resumen utilizable.')), false);
    assert.equal(isAiModelRequiredError(new Error('Clave de IA inválida.')), false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('the app presents one translated light and dark modal and routes to Models', async () => {
  const [component, app, context, preload, types, settings, translations] = await Promise.all([
    read('src/components/AiModelRequiredModal.tsx'),
    read('src/App.tsx'),
    read('electron/ipc/context.ts'),
    read('electron/preload/api.ts'),
    read('shared/types.ts'),
    read('src/views/Settings.tsx'),
    read('src/i18n.modelSettings.ts'),
  ]);
  assert.match(component, /data-testid="ai-model-required-modal"/);
  assert.match(component, /bg-white[\s\S]*dark:bg-neutral-900/);
  assert.match(component, /btn btn-primary !text-white/);
  assert.match(component, /Ir a Ajustes y Modelos/);
  assert.match(app, /onAiModelRequired\(\(\) => setAiModelRequiredOpen\(true\)\)/);
  assert.match(app, /nodus\.settingsTarget', 'models'/);
  assert.match(context, /isAiModelRequiredError\(error\)[\s\S]*ai:modelRequired/);
  assert.match(preload, /onAiModelRequired:[\s\S]*ai:modelRequired/);
  assert.match(types, /onAiModelRequired\(cb: \(\) => void\)/);
  assert.match(settings, /target === 'models'[\s\S]*setSettingsTab\('models'\)/);
  for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
    assert.match(translations, new RegExp(`const ${language} = table\\(\\[`));
  }
});

test('every model row shown in the reported Settings block has a short description', async () => {
  const settings = await read('src/views/Settings.tsx');
  for (const label of [
    'Modelo de embeddings (similitud semántica multilingüe)',
    'Extracción de temas, ideas y evidencias',
    'Visión y OCR de imágenes',
    'Resúmenes de obras',
    'Comprensión de documentos completos',
    'Auditor de fichas documentales',
    'Fusión y deduplicación',
    'Asistente Nodi',
    'Llamadas simultáneas',
    'Razonamiento (chat/tutor/escritura)',
    'IA y datos del alumnado',
    'OpenRouter: priorizar velocidad',
    'Email Unpaywall (fallback de texto)',
    'Modo de contexto deep scan',
    'Palabras por fragmento',
  ]) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(settings, new RegExp(`<Row[^>]*label=\\{t\\('${escaped}'\\)\\}[^>]*hint=`), label);
  }
  assert.match(settings, /<EmbeddingIndexesManager settings=/, 'embedding maintenance is managed per saved index');
  assert.match(settings, /keys\.map\(\(key\) => <Row key=\{key\} label=\{t\(VAULT_MODEL_FIELDS\[key\]\)\} hint=\{t\(VAULT_MODEL_HINTS\[key\]\)\}/);
});
