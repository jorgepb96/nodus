import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-archdisc-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-archive-discovery.mjs'), '--electron-archdisc-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-archdisc-test-'));
installRuntimeHooks(root);

try {
  const disc = require(path.join(repoRoot, 'shared/archiveDiscovery.ts'));

  // ── Pure name matching ────────────────────────────────────────────────────
  assert.ok(disc.nameAppearsInText('Juan Pérez', [], 'consta que Juan Pérez firmó el acta'), 'full name matches');
  assert.equal(disc.nameAppearsInText('Juan Pérez', [], 'aquí solo aparece Juan a secas'), null, 'a lone given name is not a match');
  assert.ok(disc.nameAppearsInText('Juan Pérez', ['Joan Peres'], 'firmó Joan Peres'), 'a spelling variant matches');
  assert.ok(
    disc.nameAppearsInText('María de los Ángeles Ruiz', [], 'María Ángeles Ruiz nació en 1850'),
    'connectors are ignored and all-but-one token is enough on long names'
  );
  assert.match(disc.personProfileText({ name: 'Ana', events: [{ type: 'baptism', date: '1875', place: 'Sevilla' }] }), /Sevilla/);
  assert.ok(disc.documentHasGenealogyAnchor({ name: 'Ana', birthDate: '1875', places: ['Sevilla'] }, 'Registro parroquial de Sevilla de 1875'));
  assert.equal(disc.documentHasGenealogyAnchor({ name: 'Ana', birthDate: '1875', places: ['Sevilla'] }, 'Informe minero de Asturias de 1936'), false);
  assert.match(disc.archiveEmbeddingText({ title: 'Padrón', extractedText: 'vecinos de la villa' }), /vecinos/);

  // ── Repo + orchestrator ───────────────────────────────────────────────────
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const orch = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  settings.updateSettings({ embeddingProvider: 'openrouter', embeddingModel: 'test-model' });

  const juan = entities.createPerson({ displayName: 'Juan Pérez', sex: 'male' });
  entities.addPersonName(juan.personId, 'Joan Peres', 'variant');
  const otro = entities.createPerson({ displayName: 'Rosa Molina', sex: 'female' });

  const censo = archive.createItem({
    title: 'Padrón 1875',
    kind: 'csv',
    extractedText: 'Hoja del padrón: Juan Pérez, jornalero, y su vecino Tomás Gil.',
    docType: 'census',
  });
  const cartaRosa = archive.createItem({ title: 'Carta', kind: 'text', extractedText: 'Querida Rosa Molina, te escribo...' });

  // Item → persons: Juan (named) surfaces for the padrón; Rosa does not.
  const forCenso = orch.suggestPersonsForItem(censo.itemId);
  assert.ok(forCenso.some((p) => p.personId === juan.personId && p.reason === 'name'), 'named person suggested for the document');
  assert.ok(!forCenso.some((p) => p.personId === otro.personId), 'unrelated person not suggested');

  // Person → documents: the padrón surfaces for Juan (lexical). Semantic is skipped
  // gracefully in this test (no embedding provider configured).
  const forJuan = await orch.suggestDocumentsForPerson(juan.personId);
  assert.ok(forJuan.some((d) => d.itemId === censo.itemId && d.reason === 'name'), 'document suggested for the person by name');

  // Already-linked documents are never re-proposed.
  archive.linkItemPerson(censo.itemId, juan.personId);
  const afterLink = await orch.suggestDocumentsForPerson(juan.personId);
  assert.ok(!afterLink.some((d) => d.itemId === censo.itemId), 'linked document dropped from suggestions');
  const forCensoAfter = orch.suggestPersonsForItem(censo.itemId);
  assert.ok(!forCensoAfter.some((p) => p.personId === juan.personId), 'linked person dropped from suggestions');

  // ── Semantic similarity SQL (vec_cosine over stored embeddings) ────────────
  archive.setItemEmbedding(censo.itemId, [1, 0, 0], 'openrouter', 'test-model', 'h1');
  archive.setItemEmbedding(cartaRosa.itemId, [0, 1, 0], 'openrouter', 'test-model', 'h2');
  assert.equal(archive.getItem(censo.itemId).hasEmbedding, true, 'embedding flag surfaces on the item');
  const near = await archive.findArchiveItemsSimilar([0.9, 0.1, 0], { limit: 5, minSimilarity: 0.5 });
  assert.equal(near[0].itemId, censo.itemId, 'nearest item by cosine similarity is the padrón');
  assert.ok(near[0].similarity > 0.9);
  const status = archive.archiveEmbeddingCount();
  assert.equal(status.indexed, 2, 'two items indexed');

  // Metadata outside the embedded text preserves the vector, while any edit to
  // title/type/description/extracted text invalidates it atomically.
  archive.updateItem(censo.itemId, { source: 'Archivo municipal' });
  assert.equal(archive.getItem(censo.itemId).hasEmbedding, true, 'source-only edit keeps the embedding');
  archive.updateItem(censo.itemId, { description: 'Descripción revisada' });
  assert.equal(archive.getItem(censo.itemId).hasEmbedding, false, 'semantic source edit clears the embedding');
  assert.ok(
    !(await archive.findArchiveItemsSimilar([1, 0, 0], { limit: 5, minSimilarity: 0 })).some((item) => item.itemId === censo.itemId),
    'stale vector cannot remain in retrieval'
  );
  archive.setItemEmbedding(censo.itemId, [1, 0, 0], 'openrouter', 'test-model', 'h1-reindexed');

  // A vector from another provider/model is stale data, not a partial-coordinate
  // neighbour. It must disappear from both ranking and the coverage counter.
  assert.throws(() => archive.setItemEmbedding(cartaRosa.itemId, [1, 0], 'openai', 'test-model', 'h2-old-provider'), /embedding_index_configuration_changed/);
  archive.updateItem(cartaRosa.itemId, { extractedText: 'Changed letter awaiting a compatible vector.' });
  assert.equal((await archive.findArchiveItemsSimilar([1, 0, 0], { limit: 5, minSimilarity: 0 })).length, 1);
  assert.equal(archive.archiveEmbeddingCount().indexed, 1);

  console.log('Archive discovery test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
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
