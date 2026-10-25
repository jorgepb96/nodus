// main shipped Teaching attendance as migration 179 while the research notebooks branch
// held 179–190, so the branch's migrations became 180–191, and 192 re-applies main's
// attendance tables (their ON DELETE CASCADE keeps the create-only backfill from
// replaying 179). A database built by an earlier
// build of that branch sits at its old user_version with the old contents: already some of
// the columns that a later migration now adds, and none of main's attendance tables. Each
// such database must reach the current schema on its next open, without a "duplicate
// column name" failure and without losing a row.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--migration-branch-renumbering')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-migration-renumbering-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
try {
  const Database = require('better-sqlite3');
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  assert.ok(SCHEMA_VERSION >= 192);
  const columns = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const hasTable = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

  // Old numbering: 183 chat skills, 184 notebook icon, 185 notebook colour, 186 web
  // passages, 187 chat folder stamps, 188 Databases/Worldbuilding chat tables, 189 and
  // 190 their archived columns. What each old version has, beyond everything up to 178.
  const oldBuilds = [
    { oldVersion: 183, has: ['skills'] },
    { oldVersion: 185, has: ['skills', 'icon', 'color'] },
    { oldVersion: 186, has: ['skills', 'icon', 'color', 'web'] },
    { oldVersion: 187, has: ['skills', 'icon', 'color', 'web', 'stamps'] },
    { oldVersion: 190, has: ['skills', 'icon', 'color', 'web', 'stamps', 'surfaces', 'archived'] },
  ];
  for (const { oldVersion, has } of oldBuilds) {
    const label = `a database from the branch at its old v${oldVersion}`;
    const db = new Database(path.join(scratch, `old-${oldVersion}.sqlite`));
    runMigrations(db);
    // Take the current schema back to what that build had.
    db.exec('DROP TABLE teaching_attendance; DROP TABLE teaching_attendance_holidays; DROP TABLE research_harness_runs;');
    if (!has.includes('skills')) db.exec('ALTER TABLE chat_messages DROP COLUMN skills_json');
    if (!has.includes('icon')) db.exec('ALTER TABLE research_notebooks DROP COLUMN icon');
    if (!has.includes('color')) db.exec('ALTER TABLE research_notebooks DROP COLUMN color');
    if (!has.includes('web')) db.exec('DROP TABLE research_web_passages');
    if (!has.includes('stamps')) db.exec('ALTER TABLE research_chat_project_folders DROP COLUMN updated_at; ALTER TABLE research_chat_placements DROP COLUMN updated_at;');
    if (!has.includes('archived')) db.exec('ALTER TABLE database_chat_conversations DROP COLUMN archived; ALTER TABLE world_chat_conversations DROP COLUMN archived;');
    if (!has.includes('surfaces')) for (const prefix of ['database', 'world']) db.exec(`DROP TABLE ${prefix}_chat_placements; DROP TABLE ${prefix}_chat_project_folders; DROP TABLE ${prefix}_chat_notebooks; DROP TABLE ${prefix}_chat_projects;`);
    db.prepare("INSERT INTO chat_conversations (id, title, created_at, updated_at, archived) VALUES ('kept', 'Sigue aquí', '2026-09-20', '2026-09-20', 0)").run();
    db.pragma(`user_version = ${oldVersion}`);

    assert.doesNotThrow(() => runMigrations(db), `${label} opens`);
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION, `${label} reaches the current schema`);
    assert.ok(hasTable(db, 'teaching_attendance') && hasTable(db, 'teaching_attendance_holidays'), `${label} gets main's attendance tables`);
    assert.ok(columns(db, 'chat_messages').has('skills_json'));
    assert.ok(['icon', 'color'].every(column => columns(db, 'research_notebooks').has(column)));
    assert.ok(hasTable(db, 'research_web_passages'));
    assert.ok(hasTable(db, 'research_harness_runs'), `${label} gets the durable research execution table`);
    assert.ok(columns(db, 'research_chat_project_folders').has('updated_at') && columns(db, 'research_chat_placements').has('updated_at'));
    for (const prefix of ['database', 'world']) {
      assert.ok(hasTable(db, `${prefix}_chat_placements`) && hasTable(db, `${prefix}_chat_notebooks`), `${label} has the ${prefix} chat history tables`);
      assert.ok(columns(db, `${prefix}_chat_conversations`).has('archived'));
    }
    assert.equal(db.prepare("SELECT title FROM chat_conversations WHERE id = 'kept'").get().title, 'Sigue aquí', `${label} keeps its rows`);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.doesNotThrow(() => runMigrations(db), 'opening it again changes nothing');
    db.close();
  }
  console.log('Databases from every earlier numbering of the branch reach the current schema with main\'s attendance tables, their columns and their rows.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
