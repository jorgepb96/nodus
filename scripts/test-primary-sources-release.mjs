import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-primary-sources-release-test')) {
  const sources = Object.fromEntries([
    ['schema', 'electron/db/migrations.ts'],
    ['demo', 'electron/db/primarySourcesDemoData.ts'],
    ['metrics', 'electron/db/primarySourceMetricsRepo.ts'],
    ['workspace', 'electron/db/primarySourcesArchiveRepo.ts'],
    ['archive', 'electron/db/archiveRepo.ts'],
    ['preload', '@bridge'],
    ['ipc', '@main'],
    ['types', '@api'],
    ['vaults', 'shared/vaultTypes.ts'],
    ['tour', 'src/views/PrimarySourcesTour.tsx'],
    ['tourEngine', 'src/views/tourEngine.tsx'],
    ['dossier', 'src/views/PrimarySourceDossierView.tsx'],
    ['archiveView', 'src/views/PrimarySourcesArchiveView.tsx'],
    ['placePicker', 'src/components/PlacePicker.tsx'],
    ['settings', 'src/views/Settings.tsx'],
    ['app', '@shell'],
    ['toolkit', 'src/views/ToolkitView.tsx'],
  ].map(([key, relative]) => [key, readSource(relative)]));
  assert.ok(Number(sources.schema.match(/SCHEMA_VERSION = (\d+)/)[1]) >= 118,
    'the release migration is applied');
  assert.match(sources.schema, /CREATE TABLE primary_source_local_metrics/);
  assert.match(sources.vaults, /PRIMARY_SOURCES_RELEASE_ENABLED = true/);
  assert.match(sources.demo, /primary-sources-demo/);
  assert.match(sources.demo, /AI-generated fictional demo facsimile; not historical evidence/);
  assert.doesNotMatch(sources.demo, /createCanvas|function documentImage/);
  assert.match(sources.demo, /source_engine[\s\S]*demo_fixture/);
  assert.doesNotMatch(sources.demo, /ai_confirmed/);
  assert.match(sources.archive, /NULL AS extracted_text/);
  assert.doesNotMatch(
    sources.workspace.slice(
      sources.workspace.indexOf('function queryPrimarySourceArchiveRows'),
      sources.workspace.indexOf('export function getPrimarySourceDossier'),
    ),
    /tv\.content|content_blob|\bblob\b/i,
  );
  for (const method of [
    'seedPrimarySourcesDemoData',
    'getPrimarySourceLocalMetricSummary',
    'clearPrimarySourceLocalMetrics',
  ]) {
    assert.ok(sources.preload.includes(method), `${method} is exposed`);
    assert.ok(sources.types.includes(method), `${method} is typed`);
  }
  for (const channel of [
    'data:seedPrimarySourcesDemo',
    'primarySources:metrics:summary',
    'primarySources:metrics:clear',
  ]) assert.ok(sources.ipc.includes(channel), `${channel} is registered`);

  assert.equal(
    [...sources.tour.matchAll(/\btarget: '/g)].length,
    6,
    'the Primary Sources onboarding has exactly six steps',
  );
  for (const step of [
    'El Archivo es el centro',
    'Importa sin perder procedencia',
    'La jerarquía no es una carpeta temática',
    'Preserva el original; trabaja en derivados y texto',
    'Acepta propuestas antes de convertirlas en hechos',
    'Vuelve de la conclusión a la evidencia',
  ]) assert.ok(sources.tour.includes(step), `tour teaches: ${step}`);
  assert.match(sources.settings, /primary-sources-tour-replay/);
  assert.match(sources.settings, /primarySourcesTourComplete: false/);
  assert.match(sources.settings, /getPrimarySourceGovernanceWorkspace/);
  assert.match(sources.settings, /updatePrimarySourcePolicySettings/);
  assert.match(sources.settings, /Política de IA de Fuentes primarias/);
  assert.match(sources.settings, /EmbeddingIndexesManager/,
    'Primary Sources uses the same staged index coordinator as every vault');
  const inventory = readSource('electron/ai/embeddingIndexInventory.ts');
  assert.match(inventory, /case 'archive_items'/);
  assert.match(inventory, /archiveEmbeddingAllowed/,
    'archive inputs are governed by destination-provider policies');
  assert.match(sources.app, /!settings\.primarySourcesTourComplete/);
  assert.match(sources.tourEngine, /AcademicLearningSpotlight as GuidedPopover/);
  assert.doesNotMatch(sources.tourEngine, /aria-modal="true"/);
  assert.match(sources.tourEngine, /previousFocus\.current/);
  assert.match(sources.tourEngine, /const isInvitation = isFirst && !started/);
  assert.match(sources.tourEngine, /disabled=\{!video\}/);
  assert.match(sources.tour, /showUnavailableVideo/);
  assert.match(sources.dossier, /role="tablist"/);
  assert.match(sources.dossier, /role="tabpanel"/);
  assert.match(sources.dossier, /aria-keyshortcuts="\+ - 0 R"/);
  assert.match(sources.dossier, /alternativeText/);
  assert.match(sources.archiveView, /<PlacePicker onPick=\{setPlace\}/);
  assert.match(sources.archiveView, /Lugar de procedencia/);
  assert.doesNotMatch(sources.archiveView, /placeRole: 'creation'/);
  assert.match(sources.placePicker, /searchGazetteer/);
  assert.match(sources.toolkit, /const visibleTools = TOOLKIT_TOOLS\.filter\(/, 'search filters the shared catalogue');
  assert.match(sources.toolkit, /visibleTools\.map\(/, 'the hub renders the filtered shared catalogue');
  assert.doesNotMatch(sources.app, /PrimarySourcesToolkitView/);
  assert.match(sources.app, /toolkit: \([^)]*\)[\s\S]{0,120}<ToolkitView/);
  for (const relative of [
    'docs/primary-sources/README.md',
    'docs/primary-sources/demo-and-onboarding.md',
    'docs/primary-sources/privacy-ai-and-local-metrics.md',
    'docs/primary-sources/preservation-backup-recovery.md',
    'docs/primary-sources/performance.md',
    'docs/primary-sources/beta-validation.md',
    'docs/primary-sources/acceptance-checklist.md',
    'docs/architecture/adr-005-primary-sources-release-privacy.md',
  ]) assert.ok(fs.existsSync(path.join(repoRoot, relative)), `${relative} exists`);
  // Lossy WebP since 5.9.2 (quality 75): as PNG they were 18 MB of every installer.
  // What matters for the learning corpus is the resolution a reader zooms into.
  const sharp = require('sharp');
  for (const fileName of [
    'letter-page-1.webp',
    'letter-page-2.webp',
    'letter-page-3.webp',
    'workshop-photograph.webp',
    'valley-voice-newspaper.webp',
    'river-road-sketch-map.webp',
    'flour-delivery-register.webp',
  ]) {
    const bytes = fs.readFileSync(path.join(repoRoot, 'electron/assets/primary-sources-demo', fileName));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', `${fileName} is a WebP`);
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', `${fileName} is a WebP`);
    const { width, height } = await sharp(bytes).metadata();
    assert.ok(Math.max(width, height) >= 1500, `${fileName} is a high-resolution demo asset (${width}×${height})`);
  }
  assert.ok(
    !fs.readdirSync(path.join(repoRoot, 'electron/assets/primary-sources-demo')).some((fileName) => fileName.endsWith('.png')),
    'no PNG copy ships beside them',
  );

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-release.mjs'), '--electron-primary-sources-release-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-release-'));
installRuntimeHooks(root);
try {
  const { getDb, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/primarySourcesDemoData.ts'));
  const sharedDemo = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const metrics = require(path.join(repoRoot, 'electron/db/primarySourceMetricsRepo.ts'));
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const workspaceRepo = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const derived = require(path.join(repoRoot, 'electron/db/primarySourceDerivedViewsRepo.ts'));
  const { getArchiveDocType } = require(path.join(repoRoot, 'shared/archiveDocTypes.ts'));
  const db = getDb();
  assert.ok(SCHEMA_VERSION >= 118, 'the primary-sources migrations are part of the schema');
  vaults.setVaultType(vaults.getActiveVault().id, 'primary_sources');
  settings.updateSettings({ uiLanguage: 'es', primarySourcesTourComplete: true });

  assert.equal(metrics.getPrimarySourceLocalMetricSummary().enabled, false);
  metrics.recordPrimarySourceLocalMetric('archive_list', 12.34, 10, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS value FROM primary_source_local_metrics').get().value, 0);

  assert.equal(demo.seedPrimarySourcesDemoData(), true);
  assert.equal(demo.seedPrimarySourcesDemoData(), false, 'the seed is idempotently refused once data exists');
  assert.equal(
    settings.getSettings().primarySourcesTourComplete,
    true,
    'loading the learning corpus does not relaunch a completed or dismissed tour',
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_items WHERE item_id LIKE 'demo-ps-%'").get().value, 10);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_repositories WHERE repository_id LIKE 'demo-ps-%'").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_description_units WHERE unit_id LIKE 'demo-ps-series-%'").get().value, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_item_files WHERE item_id='demo-ps-item-letter' AND role='master'").get().value, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_item_files WHERE item_id='demo-ps-item-letter' AND role='access'").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_item_files WHERE mime_type='image/webp' AND json_extract(capture_metadata_json, '$.synthetic')=1 AND item_id LIKE 'demo-ps-%'").get().value, 8);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_text_versions WHERE status='automatic' AND item_id LIKE 'demo-ps-%'").get().value, 1);
  assert.ok(db.prepare("SELECT COUNT(*) AS value FROM archive_text_versions WHERE status='reviewed' AND item_id LIKE 'demo-ps-%'").get().value >= 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_entity_proposals WHERE source_engine='demo_fixture' AND status='pending'").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM record_evidence WHERE target_kind='relationship' AND target_id='demo-ps-relationship-correspondence'").get().value, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM record_evidence WHERE evidence_role='contradicts' AND nodus_id LIKE 'demo-ps-%'").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM primary_source_note_profiles WHERE note_id LIKE 'demo-ps-%'").get().value, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_integrity_checks WHERE check_id='demo-ps-integrity-map' AND status='mismatch'").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_entity_proposals WHERE source_engine='ai_confirmed'").get().value, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM places WHERE gazetteer_id LIKE 'geonames:%' AND place_id LIKE 'demo-ps-%'").get().value, 3);
  assert.ok(db.prepare("SELECT COUNT(*) AS value FROM archive_place_mentions WHERE item_id LIKE 'demo-ps-%' AND status='resolved'").get().value >= 10);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_item_profiles WHERE item_id LIKE 'demo-ps-%' AND provenance_place_id IS NOT NULL").get().value, 10);
  assert.ok(db.prepare("SELECT COUNT(*) AS value FROM record_evidence WHERE target_kind='place' AND nodus_id LIKE 'demo-ps-%'").get().value >= 9);
  assert.ok(db.prepare("SELECT COUNT(*) AS value FROM archive_excerpts WHERE item_id LIKE 'demo-ps-%'").get().value >= 9);
  assert.ok(db.prepare("SELECT COUNT(*) AS value FROM archive_item_tags WHERE item_id LIKE 'demo-ps-%'").get().value >= 25);
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS value FROM archive_description_units
       WHERE unit_id LIKE 'demo-ps-unit-%'
         AND creator_display IS NOT NULL
         AND custodial_history IS NOT NULL
         AND access_conditions IS NOT NULL`
    ).get().value,
    10,
  );

  const demoMap = derived.getPrimarySourceMapWorkspace();
  const visibleDemoPoints = demoMap.points.filter((point) =>
    !point.hypothesis && point.latitude !== null && point.longitude !== null
  );
  assert.equal(visibleDemoPoints.length, 10, 'the demo map has exactly one provenance point per source');
  assert.deepEqual(
    [...new Set(visibleDemoPoints.map((point) => point.normalizedName))].sort(),
    ['Carmona', 'Sevilla', 'Écija'].sort(),
  );
  assert.ok(visibleDemoPoints.every((point) =>
    point.role === 'provenance'
    && point.layer === 'provenance'
    && point.mentionId === null
    && point.sourceIds.length === 1
  ));
  assert.ok(derived.getPrimarySourceTimelineWorkspace().events.filter((event) => !event.hypothesis).length >= 2);

  const map = db.prepare(
    `SELECT f.content_blob, f.content_hash, c.expected_hash, c.observed_hash
       FROM archive_item_files f
       JOIN archive_integrity_checks c ON c.file_id=f.file_id
      WHERE f.file_id='demo-ps-file-map-master'`
  ).get();
  const crypto = require('node:crypto');
  assert.equal(crypto.createHash('sha256').update(map.content_blob).digest('hex'), map.content_hash);
  assert.equal(map.expected_hash, map.content_hash);
  assert.notEqual(map.observed_hash, map.content_hash);

  const workspace = workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 4);
  assert.equal(workspace.rows.length, 4);
  assert.equal(workspace.page.total, 10);
  assert.equal(workspace.page.hasMore, true);
  assert.ok(workspace.rows.every((row) => row.item.extractedText === null));
  const catalogue = workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 200);
  assert.ok(catalogue.rows.every((row) => getArchiveDocType(row.item.docType)), 'every demo document uses the shared Genealogy catalogue');
  assert.ok(catalogue.rows.every((row) => Object.keys(row.item.metadata).length >= 4), 'every demo row shows type-specific cataloguing data');
  const filtered = workspaceRepo.getPrimarySourceArchiveWorkspace('FCA/COR', 0, 200);
  assert.equal(filtered.page.total, 3);
  assert.ok(filtered.rows.every((row) => row.unit.referenceCode.startsWith('FCA/COR')));

  settings.updateSettings({ primarySourcesLocalMetricsEnabled: true });
  metrics.recordPrimarySourceLocalMetric('archive_list', 12.34, 10, true);
  metrics.recordPrimarySourceLocalMetric('archive_list', 22.89, 10, false);
  const metricSummary = metrics.getPrimarySourceLocalMetricSummary();
  assert.equal(metricSummary.enabled, true);
  assert.equal(metricSummary.localOnly, true);
  assert.equal(metricSummary.contentFree, true);
  assert.equal(metricSummary.total, 2);
  assert.equal(metricSummary.events[0].failures, 1);
  const metricColumns = db.prepare('PRAGMA table_info(primary_source_local_metrics)').all()
    .map((column) => column.name);
  for (const forbidden of ['content', 'item_id', 'query', 'title', 'path', 'prompt', 'provider', 'model']) {
    assert.equal(metricColumns.includes(forbidden), false, `local metrics exclude ${forbidden}`);
  }
  metrics.clearPrimarySourceLocalMetrics();
  assert.equal(metrics.getPrimarySourceLocalMetricSummary().total, 0);

  const userItem = archive.createItem({
    title: 'Fuente del usuario que debe sobrevivir',
    kind: 'text',
    extractedText: 'No borrar',
  });
  workspaceRepo.ensurePrimarySourceProjection(userItem.itemId, {
    title: userItem.title,
    place: {
      gazetteerId: 'geonames:2520118',
      name: 'Carmona',
      admin1: 'Andalusia',
      country: 'Spain',
      countryCode: 'ES',
      latitude: 37.4713,
      longitude: -5.6469,
      population: 28531,
    },
  });
  const attachedPoint = derived.getPrimarySourceMapWorkspace().points.find((point) =>
    point.sourceIds.includes(userItem.itemId) && point.role === 'provenance'
  );
  assert.ok(attachedPoint, 'a gazetteer place selected during ingest is materialized on the map');
  assert.equal(attachedPoint.hypothesis, false);
  assert.equal(attachedPoint.normalizedName, 'Carmona');
  sharedDemo.clearDemoData();
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM archive_items WHERE item_id LIKE 'demo-ps-%'").get().value, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS value FROM archive_items WHERE item_id=?').get(userItem.itemId).value, 1);
  assert.equal(settings.getSettings().demoMode, false);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  console.log('Primary Sources release corpus, privacy metrics and reversible cleanup test passed!');
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
      getVersion: () => '2.7.0-test',
      getAppPath: () => repoRoot,
      getLocale: () => 'es',
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
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
