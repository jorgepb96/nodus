import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { parse } from 'csv-parse/sync';
const require = createRequire(import.meta.url),
  repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--electron-open-backups')) {
  execFileSync(
    path.join(repo, 'node_modules/.bin/electron'),
    [fileURLToPath(import.meta.url), '--electron-open-backups'],
    {
      cwd: repo,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ELECTRON_RUN_AS_NODE: '1' }).filter(
          ([key]) => key !== 'NODE_TEST_CONTEXT',
        ),
      ),
      stdio: 'inherit',
    },
  );
  process.exit(0);
}
const Database = require('better-sqlite3');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-open-backups-test-'));
const bundle = (file, name) => {
  const out = path.join(root, name + '.cjs');
  buildSync({
    entryPoints: [path.join(repo, file)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: [require.resolve('better-sqlite3')],
    alias: { '@shared': path.join(repo, 'shared'), 'better-sqlite3': require.resolve('better-sqlite3') },
    outfile: out,
    logLevel: 'silent',
  });
  return require(out);
};
const core = bundle('electron/export/openBackupCore.ts', 'core'),
  registry = bundle('electron/export/backupsRegistry.ts', 'registry'),
  types = bundle('shared/backups.ts', 'types');
function fixture() {
  const file = path.join(root, 'fixture-' + Math.random() + '.sqlite');
  const db = new Database(file);
  db.exec(`
CREATE TABLE works(nodus_id TEXT PRIMARY KEY,zotero_key TEXT,title TEXT,authors_json TEXT,year INTEGER);
CREATE TABLE work_summaries(nodus_id TEXT PRIMARY KEY,summary TEXT);
CREATE TABLE ideas(global_id TEXT PRIMARY KEY,label TEXT,statement TEXT,type TEXT,embedding BLOB);
CREATE TABLE idea_occurrences(global_id TEXT,nodus_id TEXT,development TEXT,PRIMARY KEY(global_id,nodus_id));
CREATE TABLE evidence(id TEXT PRIMARY KEY,global_id TEXT,nodus_id TEXT,quote TEXT,location TEXT,kind TEXT);
CREATE TABLE archive_items(item_id TEXT PRIMARY KEY,title TEXT,file_name TEXT,mime_type TEXT,blob BLOB);
CREATE TABLE archive_item_profiles(item_id TEXT PRIMARY KEY,access_status TEXT,sensitivity TEXT,embargo_until TEXT);
CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT,content TEXT);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
INSERT INTO works VALUES('a','ZA','Obra','["Autora"]',2024);
INSERT INTO work_summaries VALUES('a','Resumen');
INSERT INTO ideas VALUES('i','Idea con fuente','Enunciado','claim',X'0102');
INSERT INTO ideas VALUES('manual','Idea manual','IDEA_WITHOUT_SOURCE','claim',X'0102');
INSERT INTO idea_occurrences VALUES('i','a','Desarrollo');
INSERT INTO evidence VALUES('e','i','a','Cita literal','p. 10','quote');
INSERT INTO notes VALUES('note','Nota','[Fuente](nodus://work/a)');
INSERT INTO settings VALUES('providerKeys','DO_NOT_EXPORT_CREDENTIALS');`);
  db.close();
  return file;
}
async function build(file, overrides = {}, previewOnly = false) {
  const dir = fs.mkdtempSync(path.join(root, 'out-'));
  const options = {
    ...types.defaultOpenBackupOptions('v'),
    formats: ['markdown', 'csv', 'json'],
    ...overrides,
  };
  const result = await core.buildOpenBackup({
    options,
    sources: [{ id: 'v', name: 'Pruebas', type: 'academic', snapshotPath: file }],
    directory: dir,
    libraryRoot: null,
    appVersion: 'test',
    jobId: 'test',
    previewOnly,
  });
  return { dir, result, options };
}
test('CSV preserves Unicode, multiline quotes, nulls and nested JSON with an independent parser', () => {
  const rows = [
    {
      id: '0001',
      text: '"Comillas", acento: hipótesis\nSegunda línea',
      empty: null,
      nested: { labels: ['uno', 'dos'] },
    },
  ];
  const parsed = parse(core.backupCsv(rows, Object.keys(rows[0])), { columns: true, bom: true });
  assert.deepEqual(parsed, [
    { id: '0001', text: rows[0].text, empty: '', nested: '{"labels":["uno","dos"]}' },
  ]);
});
test('full Markdown retains manual ideas without occurrences and rewrites native links', async () => {
  const { dir, result } = await build(fixture());
  const contents = result.entries
    .filter((e) => e.path.endsWith('.md'))
    .map((e) => fs.readFileSync(path.join(dir, e.path), 'utf8'));
  assert.ok(contents.some((s) => s.includes('IDEA_WITHOUT_SOURCE')));
  assert.ok(!contents.some((s) => s.includes('nodus://work/a')));
  assert.ok(!result.entries.some((e) => e.path.includes('settings')));
});
test('binary exports remain byte-exact and previews never materialize payload files', async () => {
  const file = fixture(),
    db = new Database(file),
    bytes = Buffer.alloc(8 * 1024 * 1024, 71);
  db.prepare('INSERT INTO archive_items VALUES(?,?,?,?,?)').run(
    'large',
    'Original',
    'original.bin',
    'application/octet-stream',
    bytes,
  );
  db.close();
  const { dir, result } = await build(file);
  const blob = result.entries.find((e) => e.path.endsWith('original.bin'));
  assert.ok(blob);
  assert.deepEqual(fs.readFileSync(path.join(dir, blob.path)), bytes);
  const preview = await build(file, {}, true);
  assert.equal(fs.readdirSync(preview.dir).length, 0);
  assert.equal(preview.result.files, result.files);
  const excluded = await build(file, { includeAttachments: false });
  assert.ok(!excluded.result.entries.some((e) => e.path.endsWith('.bin')));
});
test('private/restricted source content cannot bypass export policy through a format', async () => {
  const file = fixture(),
    db = new Database(file);
  db.prepare('INSERT INTO archive_items VALUES(?,?,?,?,?)').run(
    'private',
    'PRIVATE_SOURCE_SENTINEL',
    'private.txt',
    'text/plain',
    Buffer.from('PRIVATE_BINARY_SENTINEL'),
  );
  db.prepare('INSERT INTO archive_item_profiles VALUES(?,?,?,?)').run(
    'private',
    'restricted',
    'sensitive',
    null,
  );
  db.close();
  const { dir, result } = await build(file);
  assert.ok(result.omissions.some((s) => s.includes('private')));
  for (const entry of result.entries)
    assert.ok(!fs.readFileSync(path.join(dir, entry.path), 'utf8').includes('PRIVATE_SOURCE_SENTINEL'));
});
test('unknown persistent tables fail closed instead of disappearing from a full export', async () => {
  const file = fixture(),
    db = new Database(file);
  db.exec('CREATE TABLE new_user_content(id TEXT PRIMARY KEY,body TEXT)');
  db.close();
  await assert.rejects(() => build(file), /Tabla sin clasificación/);
  assert.equal(registry.classifyBackupTable('vector_scan_generations'), 'technical');
});
test('disk-full errors and cancellation are reported rather than completing a partial package', async () => {
  const file = fixture();
  const original = fs.promises.writeFile;
  try {
    fs.promises.writeFile = async () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    };
    await assert.rejects(
      () => build(file),
      (e) => e.code === 'ENOSPC',
    );
  } finally {
    fs.promises.writeFile = original;
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      core.buildOpenBackup(
        {
          options: types.defaultOpenBackupOptions('v'),
          sources: [{ id: 'v', name: 'v', type: 'academic', snapshotPath: file }],
          directory: root,
          libraryRoot: null,
          appVersion: 'test',
          jobId: 'cancel',
        },
        () => {},
        controller.signal,
      ),
    /BACKUP_CANCELLED/,
  );
});
test('JSON user fields are preserved even when their names resemble connection credentials', () => {
  assert.deepEqual(core.portableBackupValue('{"password":"authored data","secrets":[1,2]}', 'value_json'), {
    password: 'authored data',
    secrets: [1, 2],
  });
});
test('Markdown filenames with fragments and parentheses have resolvable links and code is unchanged', async () => {
  const file = fixture(),
    db = new Database(file);
  db.prepare('UPDATE works SET title=?').run('Obra #1 (edición)');
  db.prepare('UPDATE work_summaries SET summary=?').run('# Apartado\n\n```python\n# comentario literal\n```');
  db.prepare('UPDATE notes SET content=?').run('[Fuente](nodus://work/a)\n\n`[ejemplo](nodus://work/a)`');
  db.close();
  const { dir, result } = await build(file);
  const note = result.entries.find((e) => e.path.includes('/notes/notes/'));
  assert.ok(note);
  const body = fs.readFileSync(path.join(dir, note.path), 'utf8');
  assert.ok(body.includes('%23'));
  assert.ok(body.includes('%28'));
  assert.ok(body.includes('`[ejemplo](nodus://work/a)`'));
  const work = result.entries.find((e) => e.path.includes('/markdown/works/'));
  const markdown = fs.readFileSync(path.join(dir, work.path), 'utf8');
  assert.ok(markdown.includes('```python\n# comentario literal\n```'));
});
test('confirmable private sources require a per-export acknowledgement', async () => {
  const file = fixture(),
    db = new Database(file);
  db.prepare('INSERT INTO archive_items VALUES(?,?,?,?,?)').run(
    'private',
    'Source',
    'private.txt',
    'text/plain',
    Buffer.from('CONFIRMED_PRIVATE_SOURCE'),
  );
  db.prepare('INSERT INTO archive_item_profiles VALUES(?,?,?,?)').run('private', 'private', 'normal', null);
  db.close();
  await assert.rejects(() => build(file), /Confirma la exportación/);
  const preview = await build(file, {}, true);
  assert.equal(preview.result.requiresConfirmation, true);
  const accepted = await build(file, { authorizePreservation: true });
  assert.ok(accepted.result.entries.some((e) => e.path.endsWith('private.txt')));
});
test('explicit dependent selections cannot reintroduce content denied by page ACL', async () => {
  const file = fixture(),
    db = new Database(file);
  db.exec(`CREATE TABLE pages(id TEXT PRIMARY KEY, parent_page_id TEXT, note_id TEXT, title TEXT);
    CREATE TABLE page_blocks(id TEXT PRIMARY KEY,page_id TEXT, type TEXT, content_json TEXT);
    CREATE TABLE acl_entries(resource_type TEXT,resource_id TEXT,principal_type TEXT,principal_id TEXT,role TEXT);
    CREATE TABLE workspace_group_members(group_id TEXT,actor_id TEXT);
    INSERT INTO pages VALUES('denied',NULL,NULL,'Hidden');
    INSERT INTO page_blocks VALUES('hidden-block','denied','paragraph','{"text":"ACL_HIDDEN_SENTINEL"}');
    INSERT INTO acl_entries VALUES('vault','current','actor','someone-else','owner');`);
  db.close();
  const { dir, result } = await build(file, {
    selections: { 'v:page_blocks': [JSON.stringify(['hidden-block'])] },
  });
  for (const entry of result.entries)
    assert.ok(!fs.readFileSync(path.join(dir, entry.path)).toString().includes('ACL_HIDDEN_SENTINEL'));
});
test('long Unicode titles keep safe path components and original attachment extensions', async () => {
  const file = fixture(),
    db = new Database(file),
    name = '研究🌍'.repeat(90);
  db.prepare('INSERT INTO archive_items VALUES(?,?,?,?,?)').run(
    'long',
    name,
    name + '.pdf',
    'application/pdf',
    Buffer.from('original'),
  );
  db.close();
  const { result } = await build(file);
  const attachment = result.entries.find((e) => e.path.endsWith('.pdf'));
  assert.ok(attachment);
  assert.ok(attachment.path.split('/').every((part) => Buffer.byteLength(part) < 255));
});
test('research Markdown links valid Zotero identifiers to the canonical local and group locations', async () => {
  for (const key of ['ABCD2345', 'groups:123:ABCD2345']) {
    const file = fixture(),
      db = new Database(file);
    db.prepare('UPDATE works SET zotero_key=?').run(key);
    db.close();
    const { dir, result } = await build(file);
    const work = result.entries.find((entry) => entry.path.includes('/markdown/works/'));
    const source = fs.readFileSync(path.join(dir, work.path), 'utf8');
    assert.ok(
      source.includes(
        key.startsWith('groups:')
          ? 'zotero://select/groups/123/items/ABCD2345'
          : 'zotero://select/library/items/ABCD2345',
      ),
    );
  }
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
