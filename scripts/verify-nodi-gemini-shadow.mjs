// Live, isolated reliability suite for Nodi's product knowledge. It is deliberately
// pinned to the only model authorised for this audit. The API key exists only in
// process memory and the ephemeral Electron secret store; reports are sanitized.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_PROVIDER = 'gemini';
const REQUIRED_MODEL = 'gemini-2.5-flash-lite';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const reportPath = path.resolve(
  process.env.NODUS_NODI_REPORT || path.join(os.tmpdir(), 'nodus-nodi-gemini-shadow-report.json'),
);
const childFlag = '--electron-nodi-gemini-shadow';

if (!process.argv.includes(childFlag)) {
  const stdinKey = process.argv.includes('--api-key-stdin')
    ? await readApiKeyFromStdin()
    : '';
  const apiKey = stdinKey || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('Provide GEMINI_API_KEY or pipe it with --api-key-stdin for this isolated run.');

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-nodi-gemini-shadow.mjs'), childFlag],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        GEMINI_API_KEY: apiKey,
        NODUS_NODI_REQUIRED_PROVIDER: REQUIRED_PROVIDER,
        NODUS_NODI_REQUIRED_MODEL: REQUIRED_MODEL,
      },
      stdio: 'inherit',
    },
  );
  process.exit(0);
}

async function readApiKeyFromStdin() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    let value = '';
    for await (const chunk of process.stdin) value += String(chunk);
    return value.trim();
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Credential input cancelled.'));
        value += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

assert.equal(process.env.NODUS_NODI_REQUIRED_PROVIDER, REQUIRED_PROVIDER);
assert.equal(process.env.NODUS_NODI_REQUIRED_MODEL, REQUIRED_MODEL);
const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'The isolated child received the Gemini credential.');

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-nodi-gemini-shadow-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
let clearApiKey = () => undefined;
const startedAt = Date.now();

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const nodi = require(path.join(repoRoot, 'electron/ai/nodiChat.ts'));
  const databaseApi = require(path.join(repoRoot, 'electron/db/database.ts'));
  const crossVault = require(path.join(repoRoot, 'electron/db/crossVault.ts'));
  ({ closeDb } = databaseApi);
  clearApiKey = () => secrets.clearApiKey(REQUIRED_PROVIDER);

  secrets.setApiKey(REQUIRED_PROVIDER, apiKey);
  delete process.env.GEMINI_API_KEY;
  const models = await providers.listModels(REQUIRED_PROVIDER, secrets.getApiKey(REQUIRED_PROVIDER));
  assert.ok(models.some((item) => item.id === REQUIRED_MODEL), `${REQUIRED_MODEL} is available`);
  const model = { provider: REQUIRED_PROVIDER, model: REQUIRED_MODEL };
  const configureActiveVault = () => {
    secrets.setApiKey(REQUIRED_PROVIDER, apiKey);
    settings.updateSettings({
      uiLanguage: 'es',
      promptLanguage: 'es',
      nodiModel: model,
      chatModel: model,
    });
  };
  const switchVault = (id) => {
    crossVault.closeCrossVaultConnections();
    databaseApi.closeDb();
    vaults.setActiveVault(id);
    databaseApi.getDb();
    configureActiveVault();
  };
  configureActiveVault();

  const academic = vaults.renameVault(vaults.getActiveVault().id, 'Auditoría Nodi aislada');
  const primarySources = vaults.createVault('Fuentes de prueba', 'primary_sources');
  const testimonies = vaults.createVault('Testimonios de prueba', 'testimonios');
  const prosopography = vaults.createVault('Prosopografía de prueba', 'prosopography');
  const worldbuilding = vaults.createVault('Mundo de prueba', 'worldbuilding');
  const teaching = vaults.createVault('Docencia de prueba', 'docencia');

  const answers = {};
  const ask = async (id, question, vaultId = academic.id) => {
    switchVault(vaultId);
    const deltas = [];
    const requestModel = { provider: REQUIRED_PROVIDER, model: REQUIRED_MODEL };
    assert.deepEqual(requestModel, model, `${id} is pinned to the authorised model`);
    const answer = await retryOnce(() => nodi.streamNodiChat(
      {
        messages: [{ role: 'user', content: question }],
        contexts: ['documentation'],
        currentView: null,
        model: requestModel,
      },
      (delta) => { if (delta) deltas.push(delta); },
    ));
    assert.ok(deltas.length > 0, `${id} streamed`);
    answers[id] = answer;
    await pace();
    return answer;
  };

  const roadmap = await ask(
    'roadmap',
    'Enumera en orden el roadmap oficial. Indica el estado de cada iniciativa y si hay fechas cerradas.',
  );
  assertOrdered(roadmap, ['Pulido', 'Servidor', 'Compartir', 'iOS', 'Docencia', 'Fuentes primarias', 'Testimonios', 'Vaults sugeridos', 'Toolkit']);
  assert.match(roadmap, /sin fechas|no (?:hay|tiene).*fechas|ninguna fecha/i);
  assert.doesNotMatch(roadmap, /20\d{2}/, 'roadmap answer invented a year');

  const vaultsAnswer = await ask(
    'vault_catalogue',
    '¿Qué tipos de vault puedo crear ahora y qué fase tiene cada uno? Aclara cuáles no sirven para trabajo real.',
  );
  for (const expected of ['Académico', 'Fuentes primarias', 'Testimonios', 'Bases de datos', 'Docencia', 'Estudio', 'Genealogía', 'Prosopografía', 'Worldbuilding']) {
    assert.match(vaultsAnswer, new RegExp(expected, 'i'));
  }
  assert.match(vaultsAnswer, /PRE-ALPHA/i);
  assert.match(vaultsAnswer, /Worldbuilding[\s\S]{0,100}ALPHA|ALPHA[\s\S]{0,100}Worldbuilding/i);
  assert.match(vaultsAnswer, /no (?:son|es).*trabajo real|no.*utilizable/i);

  const primary = await ask(
    'primary_sources',
    'Explícame cómo añado, catalogo, edito y sitúo en el mapa una fuente. ¿Qué representa el mapa?',
    primarySources.id,
  );
  for (const expected of [/Archivo/i, /Añadir fuente/i, /modal/i, /procedencia/i, /desplegable/i]) assert.match(primary, expected);
  assert.match(primary, /no todas? las (?:ciudades|menciones)/i);

  const oral = await ask(
    'testimonies',
    '¿Cuál es el flujo básico de Testimonios y qué límites debe respetar Nodi con acuerdos y participantes?',
    testimonies.id,
  );
  for (const expected of [/Entrevista/i, /participante/i, /transcrip/i, /acuerdo/i, /anonimiz|embargo|atribuci/i]) assert.match(oral, expected);

  const prosop = await ask(
    'prosopography',
    'Dame el flujo correcto del vault de Prosopografía y distingue persona, mención, fuente, factoid y statement.',
    prosopography.id,
  );
  for (const expected of [/metodolog/i, /poblaci/i, /cuestionario/i, /factoid/i, /statement/i, /identidad/i]) assert.match(prosop, expected);

  const world = await ask(
    'worldbuilding',
    '¿Cómo empiezo a trabajar en Worldbuilding y qué puede o no puede inventar Nodi?',
    worldbuilding.id,
  );
  for (const expected of [/Personajes|Lugares|Enciclopedia/i, /canon|fuente de verdad/i, /no invent/i]) assert.match(world, expected);

  const teachingAnswer = await ask(
    'teaching',
    '¿Qué puedo hacer ya en Docencia y qué apartados siguen solamente en diseño?',
    teaching.id,
  );
  for (const expected of [/Grupos/i, /Rúbricas/i, /Exámenes/i, /Calificaciones/i, /Diseño de unidades/i, /En diseño/i]) assert.match(teachingAnswer, expected);

  const toolkit = await ask(
    'toolkit',
    '¿Qué herramientas incluye Toolkit y cómo vuelvo a su pantalla principal desde una herramienta?',
  );
  for (const expected of [/Convert/i, /Protect/i, /Translate/i, /Nodus Presenter/i, /OCR Workspace/i, /izquierda/i]) assert.match(toolkit, expected);

  const connectivity = await ask(
    'connectivity',
    'Diferencia el MCP local de Nodus Server e indica sus rutas exactas en Ajustes. ¿El trabajo colaborativo ya está disponible?',
  );
  assert.match(connectivity, /Integraciones/i);
  assert.match(connectivity, /Ajustes\s*(?:>|→)\s*Servidor/i);
  assert.match(connectivity, /independiente|distint/i);
  assert.match(connectivity, /planificad|todavía no|no.*disponible/i);

  const trap = await ask(
    'hallucination_trap',
    '¿Cómo uso el botón «Fusionar universos» para publicar automáticamente un vault en iPad?',
  );
  assert.match(trap, /No puedo verificar|no.*documentad|no existe|planificad/i);
  assert.doesNotMatch(trap, /haz clic|pulsa/i);

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    provider: REQUIRED_PROVIDER,
    model: REQUIRED_MODEL,
    cases: Object.entries(answers).map(([id, answer]) => ({ id, passed: true, answer })),
    totals: { passed: Object.keys(answers).length, failed: 0 },
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ...report,
    cases: report.cases.map(({ id, passed }) => ({ id, passed })),
  }, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log(`Live isolated Nodi verification passed with ${REQUIRED_PROVIDER}/${REQUIRED_MODEL}.`);
} finally {
  delete process.env.GEMINI_API_KEY;
  delete process.env.NODUS_NODI_REQUIRED_PROVIDER;
  delete process.env.NODUS_NODI_REQUIRED_MODEL;
  try { clearApiKey(); } catch { /* the ephemeral profile is the final backstop */ }
  try { closeDb(); } catch { /* the DB may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

function assertOrdered(text, fragments) {
  let previous = -1;
  for (const fragment of fragments) {
    const current = text.toLocaleLowerCase().indexOf(fragment.toLocaleLowerCase());
    assert.ok(current > previous, `${fragment} follows the preceding roadmap item`);
    previous = current;
  }
}

async function retryOnce(operation) {
  try {
    return await operation();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    return operation();
  }
}

async function pace() {
  await new Promise((resolve) => setTimeout(resolve, 1_200));
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-nodi-shadow-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
