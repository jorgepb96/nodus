// Loop 12 acceptance: charts, drilldown, maps, feed and dashboard configuration on real SQLite.
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
const marker = '--electron-database-visualizations-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-visualizations-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { databaseCellStorage } = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));
  const { encodeDatabaseDate, encodeDatabaseLocation } = require(path.join(repoRoot, 'shared/databaseProperties.ts'));
  const visualization = require(path.join(repoRoot, 'shared/databaseVisualization.ts'));
  const { normalizeDatabaseViewConfig } = require(path.join(repoRoot, 'shared/databaseViewConfig.ts'));
  const { normalizeCsvValue } = require(path.join(repoRoot, 'shared/databaseCsv.ts'));
  assert.ok(require(path.join(repoRoot, 'build/packagedNodeModules.cjs')).MAIN_PROCESS_EXTERNALS.includes('sharp'),
    'sharp must remain external so Electron can load its native runtime');
  assert.equal(normalizeCsvValue('date', '2026-08-14T13:30:00+02:00'), '2026-08-14T13:30:00+02:00');

  const sqlite = new Database(path.join(root, 'visualizations.sqlite'));
  runMigrations(sqlite); globalThis.__databaseVisualizationDb = sqlite;
  const database = repo.createDatabase('Visualizaciones reales');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const status = repo.createColumn(database.id, 'Estado', 'status');
  const score = repo.createColumn(database.id, 'Puntuación', 'number');
  const location = repo.createColumn(database.id, 'Ubicación', 'location');
  const date = repo.createColumn(database.id, 'Fecha', 'date');
  const pending = repo.addOption(status.id, 'Pendiente', '#f59e0b', 'pending');
  const active = repo.addOption(status.id, 'En curso', '#4f46e5', 'in_progress');
  const complete = repo.addOption(status.id, 'Completo', '#10b981', 'complete');
  const optionIds = [pending.id, active.id, complete.id];
  const timestamp = '2026-08-14T10:00:00.000Z';
  const insertRow = sqlite.prepare(`INSERT INTO db_rows
    (id,database_id,position,unique_sequence,created_at,updated_at,revision,created_by,updated_by)
    VALUES (?,?,?,?,?,?,1,'fixture','fixture')`);
  const insertCell = sqlite.prepare(`INSERT INTO db_cells
    (database_id,row_id,column_id,value_type,value_text,value_number,value_integer,value_date,value_json,value_reference,
     revision,created_by,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,'fixture','fixture',?,?)`);
  const addCell = (rowId, column, raw) => {
    const stored = databaseCellStorage(column.type, raw);
    insertCell.run(database.id, rowId, column.id, stored.value_type, stored.value_text, stored.value_number,
      stored.value_integer, stored.value_date, stored.value_json, stored.value_reference, timestamp, timestamp);
  };
  sqlite.transaction(() => {
    for (let index = 0; index < 620; index += 1) {
      const rowId = `visual-${String(index).padStart(4, '0')}`;
      insertRow.run(rowId, database.id, index, index + 1, timestamp, timestamp);
      addCell(rowId, title, `Elemento ${index}`);
      if (index !== 619) addCell(rowId, status, optionIds[index % optionIds.length]);
      if (index % 17 !== 0) addCell(rowId, score, String(index % 101));
      if (index < 610) addCell(rowId, location, encodeDatabaseLocation({
        name: `Punto ${index}`, address: `Calle ${index}`,
        latitude: index === 609 ? 120 : 40.40 + (index % 11) * .015,
        longitude: index === 608 ? -220 : -3.72 + (index % 13) * .015,
      }));
      addCell(rowId, date, encodeDatabaseDate({ start: `2026-08-${String(index % 28 + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00`, includeTime: true, timeZone: 'Europe/Madrid' }));
    }
  })();

  const counts = repo.queryDatabaseChart({ databaseId: database.id, xColumnId: status.id, aggregation: 'count', type: 'bar' });
  assert.equal(counts.points.length, 4, 'three status values plus the null bucket');
  assert.equal(counts.points.reduce((sum, point) => sum + point.rowCount, 0), 620);
  assert.equal(counts.nullRows, 1);
  assert.equal(counts.points.find((point) => point.key === pending.id).label, 'Pendiente');
  const pendingPoint = counts.points.find((point) => point.key === pending.id);
  const drilldown = repo.queryDatabaseRows({ databaseId: database.id, filter: pendingPoint.drilldownFilter, limit: 50 });
  assert.equal(drilldown.rows.length, 50); assert.equal(drilldown.totalCount, pendingPoint.rowCount); assert.ok(drilldown.nextCursor);
  assert.ok(drilldown.rows.every((row) => row.cells[status.id] === pending.id));

  const expectedPendingSum = Array.from({ length: 620 }, (_, index) => index)
    .filter((index) => index % 3 === 0 && index % 17 !== 0).reduce((sum, index) => sum + index % 101, 0);
  const sums = repo.queryDatabaseChart({ databaseId: database.id, xColumnId: status.id, yColumnId: score.id,
    aggregation: 'sum', type: 'donut' });
  assert.equal(sums.points.find((point) => point.key === pending.id).value, expectedPendingSum);
  for (const aggregation of ['average', 'min', 'max']) {
    const result = repo.queryDatabaseChart({ databaseId: database.id, xColumnId: status.id, yColumnId: score.id,
      aggregation, type: aggregation === 'average' ? 'line' : 'area', filter: { type: 'condition', columnId: status.id, op: 'isAnyOf', value: [complete.id] } });
    assert.equal(result.points.length, 1); assert.ok(Number.isFinite(result.points[0].value));
  }
  const cardinality = repo.queryDatabaseChart({ databaseId: database.id, xColumnId: title.id, aggregation: 'count', type: 'scatter', limit: 10_000 });
  assert.equal(cardinality.points.length, 200); assert.equal(cardinality.totalGroups, 620); assert.equal(cardinality.truncated, true);

  const map = repo.queryDatabaseMap({ databaseId: database.id, locationColumnId: location.id, limit: 10_000 });
  assert.equal(map.markers.length, 500); assert.equal(map.totalCount, 608, 'out-of-range coordinates are excluded consistently');
  assert.equal(map.truncated, true);
  const clusters = visualization.clusterDatabaseMapMarkers(map.markers, 8);
  assert.ok(clusters.length < map.markers.length); assert.equal(clusters.reduce((sum, cluster) => sum + cluster.count, 0), 500);
  assert.deepEqual(clusters, visualization.clusterDatabaseMapMarkers([...map.markers].reverse(), 8), 'clustering is independent of insertion order');
  assert.equal(visualization.clusterDatabaseMapMarkers([{ id: 'bad', rowId: 'bad', title: 'bad', name: 'bad', latitude: 200, longitude: 0 }]).length, 0);
  const screenClusters = visualization.clusterDatabaseMapMarkersForViewport(map.markers, 480, 260, 64);
  assert.equal(screenClusters.reduce((sum, cluster) => sum + cluster.count, 0), 500);
  assert.deepEqual(screenClusters, visualization.clusterDatabaseMapMarkersForViewport([...map.markers].reverse(), 480, 260, 64));
  for (let index = 0; index < screenClusters.length; index += 1) for (let peer = index + 1; peer < screenClusters.length; peer += 1) {
    const left = screenClusters[index]; const right = screenClusters[peer];
    const dx = Math.abs(left.longitude - right.longitude) / 360 * 480;
    const dy = Math.abs(left.latitude - right.latitude) / 180 * 260;
    assert.ok(dx >= 63.9 || dy >= 63.9, 'viewport clusters keep interactive targets separated');
  }

  const feed = repo.queryDatabaseFeed({ databaseId: database.id, dateColumnId: date.id, includePageChanges: true, limit: 10_000 });
  assert.equal(feed.items.length, 200); assert.equal(feed.truncated, true);
  assert.ok(feed.items.every((item) => item.kind === 'date'));
  assert.ok(feed.items.every((item, index) => index === 0 || item.occurredAt <= feed.items[index - 1].occurredAt));

  for (const type of ['bar', 'line', 'area', 'donut', 'scatter']) {
    const svg = visualization.renderDatabaseChartSvg('A&B <script>alert(1)</script>', counts.points, type, 120, 99);
    assert.match(svg, /^<svg /); assert.match(svg, /width="320" height="220"/);
    assert.ok(!svg.includes('<script>')); assert.ok(svg.includes('&lt;script&gt;'));
  }
  const chartConfig = normalizeDatabaseViewConfig({ layout: 'chart', chart: { type: 'scatter', xColumnId: score.id,
    yColumnId: score.id, aggregation: 'average', seriesColumnId: status.id } });
  assert.equal(chartConfig.layout, 'chart'); assert.equal(chartConfig.chart.type, 'scatter');
  const dashboardConfig = normalizeDatabaseViewConfig({ layout: 'dashboard', widgets: Array.from({ length: 120 }, (_, index) => ({
    id: `widget-${index}`, viewId: `view-${index}`, x: -10, y: index, width: 99, height: 99,
  })) });
  assert.equal(dashboardConfig.layout, 'dashboard'); assert.equal(dashboardConfig.widgets.length, 100);
  assert.deepEqual({ x: dashboardConfig.widgets[0].x, width: dashboardConfig.widgets[0].width, height: dashboardConfig.widgets[0].height }, { x: 0, width: 12, height: 20 });

  assert.deepEqual(sqlite.pragma('foreign_key_check'), []); assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database charts/map/feed/dashboard (real SQLite) test passed');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseVisualizationDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot,
      isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename);
  };
}
