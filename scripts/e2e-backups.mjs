// Real Electron/UI -> preload -> IPC -> snapshots -> worker -> artifacts.
// Only native destination dialogs are automated. The export pipeline is never mocked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { parse } from 'csv-parse/sync';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url),
  repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--electron-backups')) {
  execFileSync(
    path.join(repo, 'node_modules/.bin/electron'),
    [fileURLToPath(import.meta.url), '--electron-backups'],
    { cwd: repo, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}
const Database = require('better-sqlite3'),
  AdmZip = require('adm-zip');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-backups-e2e-'));
const artifacts = process.env.NODUS_BACKUPS_ARTIFACT_DIR || path.join(temp, 'artifacts');
await mkdir(artifacts, { recursive: true });
const output = path.join(artifacts, 'exports');
await mkdir(output, { recursive: true });
const bundle = path.join(temp, 'backups.cjs');
buildSync({
  entryPoints: [path.join(repo, 'shared/backups.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
});
const { defaultOpenBackupOptions } = require(bundle);
const types = [
  'academic',
  'estudio',
  'primary_sources',
  'genealogy',
  'prosopography',
  'databases',
  'testimonios',
  'worldbuilding',
  'docencia',
];
const stamp = '2026-10-12T12:00:00.000Z',
  body = 'Texto con "comillas", coma, acento: genealogía.\nSegunda línea.';
const digest = (b) => createHash('sha256').update(b).digest('hex');
let app;
const report = { cases: [], screenshots: [], artifacts };
async function filesOf(result) {
  if (result.path.endsWith('.zip'))
    return new Map(
      new AdmZip(result.path)
        .getEntries()
        .filter((e) => !e.isDirectory)
        .map((e) => [e.entryName, e.getData()]),
    );
  const resultFiles = new Map();
  async function walk(dir, rel = '') {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const name = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), name);
      else resultFiles.set(name, await readFile(path.join(dir, e.name)));
    }
  }
  await walk(result.path);
  return resultFiles;
}
function markdownText(source) {
  let result = '';
  function walk(node) {
    if (typeof node.value === 'string') result += node.value + '\n';
    for (const child of node.children ?? []) walk(child);
  }
  walk(unified().use(remarkParse).parse(source));
  return result;
}
function validate(files, options, expectedVaults) {
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.format, 'nodus.open-backup');
  assert.equal(manifest.formatVersion, 1);
  assert.deepEqual(
    manifest.vaults.map((v) => v.id),
    expectedVaults,
  );
  assert.equal(files.size, manifest.files.length + 1, 'manifest lists every output except itself');
  for (const item of manifest.files) {
    assert.ok(files.has(item.path), item.path);
    assert.equal(files.get(item.path).length, item.bytes);
    assert.equal(digest(files.get(item.path)), item.sha256);
  }
  let jsonRows = 0,
    mdCount = 0,
    csvCount = 0;
  for (const [name, bytes] of files) {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    const source = bytes.toString('utf8');
    assert.ok(!source.includes('BACKUPS_SECRET_SENTINEL'), `credential leaked in ${name}`);
    if (
      name.endsWith('.json') &&
      name !== 'manifest.json' &&
      !name.includes('/files/') &&
      !name.includes('/attachments/')
    ) {
      const data = JSON.parse(source);
      assert.equal(data.formatVersion, 1);
      if (data.records) {
        jsonRows += data.records.length;
        assert.equal(data.format, 'nodus.open-backup-table');
        assert.equal(typeof data.vaultId, 'string');
        assert.equal(typeof data.table, 'string');
        assert.ok(Array.isArray(data.primaryKey) && data.primaryKey.every((key) => typeof key === 'string'));
        assert.ok(
          Array.isArray(data.records) &&
            data.records.every((row) => row && typeof row === 'object' && !Array.isArray(row)),
        );
        const identities = data.records.map((row) =>
          JSON.stringify(data.primaryKey.map((key) => row[key] ?? null)),
        );
        assert.equal(new Set(identities).size, identities.length, 'duplicate primary identity in ' + name);
        for (const row of data.records) assert.ok(!('embedding' in row));
      }
      if (!options.includeAttachments)
        assert.ok(!source.includes('"sha256"'), `attachment leaked in ${name}`);
      if (options.summaries === 'none') assert.ok(!name.endsWith('/work_summaries.json'));
      if (!options.includeIdeas) assert.ok(!name.endsWith('/ideas.json'));
      if (!options.includeEvidence) assert.ok(!name.endsWith('/evidence.json'));
      if (!options.includeHistory) assert.ok(!name.endsWith('/note_versions.json'));
    }
    if (name.endsWith('.csv')) {
      csvCount++;
      const rows = parse(source, {
        bom: true,
        columns: true,
        relax_column_count: false,
        skip_empty_lines: true,
      });
      assert.ok(rows.length);
      assert.ok(!Object.keys(rows[0]).includes('embedding'));
      const json = files.get(name.replace('/csv/', '/json/').replace(/\.csv$/, '.json'));
      if (json) {
        const counterpart = JSON.parse(json);
        const records = counterpart.records ?? [counterpart.record];
        assert.equal(rows.length, records.length);
        for (let i = 0; i < rows.length; i++)
          for (const key of Object.keys(rows[i])) {
            const v = records[i][key];
            assert.equal(
              rows[i][key],
              typeof v === 'string'
                ? v
                : v == null
                  ? ''
                  : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v),
              `${name}:${i}:${key}`,
            );
          }
      }
    }
    if (name.endsWith('.md')) {
      mdCount++;
      const tree = unified().use(remarkParse).parse(source);
      if (!name.includes('/files/')) {
        let previousDepth = 0;
        for (const node of tree.children)
          if (node.type === 'heading') {
            assert.ok(node.depth <= previousDepth + 1, 'heading hierarchy: ' + name);
            previousDepth = node.depth;
          }
      }
      if (!name.includes('/files/')) {
        assert.equal(tree.children[0].type, 'heading', name);
        assert.equal(tree.children[0].depth, 1, name);
      }
      assert.ok(!source.includes('[object Object]'));
      function visit(node) {
        if (node.type === 'link' && !/^[a-z][a-z0-9+.-]*:/i.test(node.url) && !node.url.startsWith('#')) {
          const target = decodeURIComponent(node.url).split('#')[0];
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
          assert.ok(files.has(resolved), `broken link ${name} -> ${node.url}`);
        }
        for (const child of node.children ?? []) visit(child);
      }
      visit(tree);
      if (options.summaries === 'none') assert.ok(!markdownText(source).includes('SUMMARY_SENTINEL'));
      if (!options.includeEvidence) assert.ok(!markdownText(source).includes('EVIDENCE_SENTINEL'));
    }
  }
  if (options.formats.includes('json'))
    assert.equal(
      jsonRows +
        [...files].filter(([name]) => name.startsWith('library/') && name.endsWith('/record.json')).length,
      manifest.records,
    );
  assert.ok(mdCount >= 1);
  assert.equal(csvCount > 0, options.formats.includes('csv'));
  assert.equal(
    jsonRows > 0 || [...files.keys()].some((name) => name.endsWith('/record.json')),
    options.formats.includes('json'),
  );
  return manifest;
}
try {
  const env = {
    ...process.env,
    NODUS_USERDATA: path.join(temp, 'profile'),
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repo], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => !!window.nodus && !!document.getElementById('root')?.children.length);
  const version = require(path.join(repo, 'package.json')).version;
  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    await window.nodus.updateSettings({
      announcementsEnabled: false,
      academicMode: 'manual',
      basicsTutorialVersion: 99,
      firstVaultVersion: 99,
      recoverySetupVersion: 1,
      onboardingComplete: true,
      tourComplete: true,
      advancedTourComplete: true,
      mascotEnabled: false,
      uiLanguage: 'es',
      theme: 'light',
      toolkitPinnedPages: ['backups'],
      academicInterfaceProfile: 'custom',
      sidebarCustomized: true,
      sidebarHidden: [],
    });
  }, version);
  const vaults = [];
  for (const type of types) {
    console.log('Seeding', type);
    const created = await page.evaluate(async (type) => {
      const result = await window.nodus.createVault({
        name: {
          academic: 'Investigación sobre memoria',
          estudio: 'Materiales de estudio',
          primary_sources: 'Archivo histórico',
          genealogy: 'Historia familiar',
          prosopography: 'Estudio colectivo',
          databases: 'Inventarios',
          testimonios: 'Historia oral',
          worldbuilding: 'Mundo narrativo',
          docencia: 'Docencia',
        }[type],
        type,
      });
      await window.nodus.switchVault(result.vault.id);
      await window.nodus.updateSettings({
        onboardingComplete: true,
        tourComplete: true,
        advancedTourComplete: true,
        sidebarCustomized: true,
        academicInterfaceProfile: 'custom',
        sidebarHidden: [],
      });
      return result.vault;
    }, type);
    vaults.push(created);
    const db = new Database(created.path);
    db.pragma('foreign_keys=ON');
    const insert = (table, values) => {
      const info = db.pragma(`table_info("${table}")`);
      const columns = new Set(info.map((c) => c.name));
      for (const c of info)
        if (c.notnull && c.dflt_value === null && values[c.name] === undefined)
          values[c.name] = /INT|REAL/.test(c.type)
            ? 0
            : c.name.includes('hash')
              ? digest(Buffer.from(body))
              : c.name.endsWith('_at')
                ? stamp
                : 'E2E ' + c.name;
      const fields = Object.keys(values).filter((k) => columns.has(k));
      db.prepare(
        `INSERT INTO "${table}" (${fields.map((f) => '"' + f + '"').join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      ).run(...fields.map((f) => values[f]));
    };
    insert('works', {
      nodus_id: 'work-a',
      zotero_key: 'ZA',
      title: 'Memoria y aprendizaje',
      authors_json: '["Ada Lovelace"]',
      year: 2024,
      item_type: 'book',
      summary_status: 'done',
    });
    insert('works', {
      nodus_id: 'work-b',
      zotero_key: 'ZB',
      title: 'Memoria y aprendizaje',
      authors_json: '["Grace Hopper"]',
      year: 2025,
      item_type: 'book',
      summary_status: 'done',
    });
    insert('work_summaries', {
      nodus_id: 'work-a',
      summary: 'SUMMARY_SENTINEL_A · ' + body,
      source_level: 'deep',
      created_at: stamp,
      updated_at: stamp,
    });
    insert('work_summaries', {
      nodus_id: 'work-b',
      summary: 'SUMMARY_SENTINEL_B',
      source_level: 'deep',
      created_at: stamp,
      updated_at: stamp,
    });
    insert('authors', { author_id: 'author-a', name: 'Ada Lovelace' });
    insert('authors', { author_id: 'author-b', name: 'Grace Hopper' });
    insert('work_authors', { nodus_id: 'work-a', author_id: 'author-a' });
    insert('work_authors', { nodus_id: 'work-b', author_id: 'author-b' });
    insert('ideas', {
      global_id: 'idea-a',
      type: 'claim',
      label: 'Recuperación activa',
      statement: 'IDEA_SENTINEL_A · ' + body,
      embedding: Buffer.from('unused-vector'),
      created_at: stamp,
    });
    insert('ideas', {
      global_id: 'idea-b',
      type: 'claim',
      label: 'Memoria contextual',
      statement: 'IDEA_SENTINEL_B',
      created_at: stamp,
    });
    for (const id of ['work-a', 'work-b'])
      insert('idea_occurrences', {
        global_id: 'idea-a',
        nodus_id: id,
        role: 'principal',
        development: 'Desarrollo en ' + id,
        confidence: 0.9,
      });
    insert('idea_occurrences', {
      global_id: 'idea-b',
      nodus_id: 'work-b',
      role: 'secondary',
      development: 'Desarrollo secundario',
      confidence: 0.8,
    });
    insert('evidence', {
      id: 'ev-a',
      global_id: 'idea-a',
      nodus_id: 'work-a',
      quote: 'EVIDENCE_SENTINEL_A · ' + body,
      location: 'p. 12',
      kind: 'quote',
    });
    insert('evidence', {
      id: 'ev-b',
      global_id: 'idea-a',
      nodus_id: 'work-b',
      quote: 'EVIDENCE_SENTINEL_B',
      location: 'p. 27',
      kind: 'paraphrase',
    });
    insert('edges', {
      id: 'edge-a',
      from_id: 'idea-a',
      to_id: 'idea-b',
      type: 'supports',
      basis: 'text',
      confidence: 0.8,
    });
    insert('note_folders', {
      id: 'folder-a',
      name: 'Proyecto de lectura',
      parent_id: null,
      summary: '',
      order_idx: 0,
      created_at: stamp,
      updated_at: stamp,
    });
    insert('notes', {
      id: 'note-a',
      folder_id: 'folder-a',
      title: 'Notas de lectura',
      kind: 'markdown',
      content: '# Apuntes\n\n' + body + '\n\n[Abrir fuente](nodus://work/work-a)',
      created_at: stamp,
      updated_at: stamp,
    });
    insert('note_versions', {
      id: 'version-a',
      note_id: 'note-a',
      version_no: 1,
      title: 'Notas anteriores',
      content_markdown: 'HISTORY_SENTINEL',
      style_json: '{}',
      reason: 'manual',
      content_hash: 'hash',
      created_at: stamp,
    });
    insert('note_annotations', {
      id: 'comment-a',
      note_id: 'note-a',
      comment: 'COMMENT_SENTINEL',
      created_at: stamp,
      updated_at: stamp,
    });
    insert('dictionary_entries', {
      id: 'dictionary-a',
      name: 'Memoria',
      normalized_name: 'memoria',
      scope_kind: 'vault',
      scope_json: '{}',
      content_markdown: 'DICTIONARY_SENTINEL · ' + body,
      created_at: stamp,
      updated_at: stamp,
    });
    insert('chat_conversations', {
      id: 'conversation-a',
      title: 'Conversación de investigación',
      created_at: stamp,
      updated_at: stamp,
    });
    insert('chat_messages', {
      id: 'message-a',
      conversation_id: 'conversation-a',
      seq: 0,
      role: 'user',
      content: 'CHAT_SENTINEL · ' + body,
      created_at: stamp,
    });
    insert('writing_saved_drafts', {
      id: 'draft-a',
      title: 'Informe de investigación',
      brief_json: '{}',
      selection_json: '{}',
      draft_json: JSON.stringify({ body: 'REPORT_SENTINEL · ' + body, password: 'authored field' }),
      created_at: stamp,
      updated_at: stamp,
    });
    insert('study_docs', {
      id: 'document-a',
      short_id: 'SD-A',
      title: 'Apuntes de estudio',
      content_markdown: 'STUDY_SENTINEL · ' + body,
      created_at: stamp,
      updated_at: stamp,
    });
    insert('study_questions', {
      id: 'question-a',
      short_id: 'SQ-A',
      prompt: 'QUESTION_SENTINEL',
      question_type: 'short_answer',
      document_id: 'document-a',
      answer_json: JSON.stringify({ answer: body }),
      created_at: stamp,
      updated_at: stamp,
    });
    insert('archive_items', {
      item_id: 'attachment-a',
      title: 'Original de prueba',
      kind: 'other',
      file_name: 'ejemplo.txt',
      mime_type: 'text/plain',
      bytes: Buffer.byteLength(body),
      blob: Buffer.from(body),
      created_at: stamp,
      updated_at: stamp,
    });
    if (type === 'estudio')
      insert('study_docs', {
        id: 'study-a',
        short_id: 'ST-A',
        title: 'Apunte de estudio',
        content_markdown: body,
        created_at: stamp,
        updated_at: stamp,
      });
    if (type === 'primary_sources')
      insert('archive_repositories', {
        repository_id: 'repository-a',
        name: 'Archivo de prueba',
        created_at: stamp,
        updated_at: stamp,
      });
    if (type === 'genealogy')
      insert('persons', {
        person_id: 'person-a',
        preferred_name: 'Persona de prueba',
        sex: 'unknown',
        created_at: stamp,
        updated_at: stamp,
      });
    if (type === 'prosopography')
      insert('prosop_studies', {
        study_id: 'prosop-a',
        title: 'Estudio colectivo',
        created_at: stamp,
        updated_at: stamp,
      });
    if (type === 'databases') {
      insert('db_databases', {
        id: 'database-a',
        short_id: 'DB-A',
        name: 'Inventario de prueba',
        created_at: stamp,
        updated_at: stamp,
      });
      insert('db_columns', {
        id: 'col-a',
        database_id: 'database-a',
        name: 'Archivo',
        type: 'attachment',
        created_at: stamp,
        updated_at: stamp,
      });
      insert('db_rows', { id: 'row-a', database_id: 'database-a', created_at: stamp, updated_at: stamp });
      const blob = Buffer.from(body),
        hash = digest(blob);
      insert('db_blobs', {
        hash,
        bytes: blob.length,
        mime_type: 'text/plain',
        data: blob,
        created_at: stamp,
        updated_at: stamp,
      });
      insert('db_attachments', {
        id: 'db-attachment-a',
        database_id: 'database-a',
        row_id: 'row-a',
        column_id: 'col-a',
        file_name: 'original.txt',
        mime_type: 'text/plain',
        bytes: blob.length,
        blob_hash: hash,
        created_at: stamp,
        updated_at: stamp,
      });
    }
    if (type === 'testimonios')
      insert('testimony_interviews', {
        id: 'interview-a',
        short_id: 'TI-A',
        title: 'Entrevista de prueba',
        context_markdown: body,
        created_at: stamp,
        updated_at: stamp,
      });
    if (type === 'worldbuilding')
      insert('world_articles', {
        article_id: 'world-a',
        title: 'Historia del mundo',
        title_key: 'historia del mundo',
        body,
        category: 'other',
        created_at: stamp,
        updated_at: stamp,
      });
    if (type === 'docencia') {
      insert('study_courses', {
        id: 'course-a',
        short_id: 'C-A',
        name: 'Curso de prueba',
        created_at: stamp,
        updated_at: stamp,
      });
      insert('study_subjects', {
        id: 'subject-a',
        short_id: 'S-A',
        course_id: 'course-a',
        name: 'Asignatura',
        created_at: stamp,
        updated_at: stamp,
      });
      insert('teaching_groups', {
        id: 'group-a',
        short_id: 'G-A',
        subject_id: 'subject-a',
        name: 'Grupo de prueba',
        created_at: stamp,
        updated_at: stamp,
      });
    }
    insert('settings', { key: 'BACKUPS_SECRET_SENTINEL', value: 'BACKUPS_SECRET_SENTINEL' });
    db.close();
  }
  await page.evaluate((id) => window.nodus.switchVault(id), vaults[0].id);
  await page.reload();
  await page.waitForFunction(() => !!window.nodus);
  const nativePage = await page.evaluate(async () => {
    const page = await window.nodus.createPage({
      title: 'Documento nativo',
      blocks: [
        { id: 'native-heading', type: 'heading_1', content: { text: 'Sección de investigación' } },
        { id: 'native-paragraph', type: 'paragraph', content: { text: 'NATIVE_DOCUMENT_SENTINEL' } },
      ],
    });
    const saved = await window.nodus.savePageDocument({
      pageId: page.page.id,
      expectedRevision: page.page.revision,
      blocks: page.blocks,
      nativeDocument: [
        {
          id: 'native-heading',
          type: 'heading',
          props: { level: 1 },
          content: [{ type: 'text', text: 'Sección de investigación', styles: {} }],
        },
        {
          id: 'native-paragraph',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'NATIVE_DOCUMENT_SENTINEL', styles: { bold: true } }],
        },
      ],
    });
    return { id: page.page.id, markdown: saved.document.markdown };
  });
  for (const vault of vaults) {
    const c = await page.evaluate((ids) => window.nodus.getBackupCatalog(ids), [vault.id]);
    assert.ok(c.tables.length);
  }
  console.log('Catalog coverage: all nine vault types.');
  await app.evaluate(({ dialog }, output) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [output] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output + '/complete.nodus' });
  }, output);
  // Pinning follows the real settings update, then use the actual navigation.
  const banner = page.getByRole('button', { name: 'Ocultar aviso', exact: true });
  if (await banner.count()) await banner.click();
  await page.getByRole('button', { name: 'Backups', exact: true }).first().click();
  await page.getByTestId('backups-view').waitFor();
  await page.getByTestId('backups-back').click();
  await page
    .getByTestId('toolkit-card-backups')
    .waitFor({ timeout: 1000 })
    .catch(() => {});
  async function screenshot(name) {
    const file = path.join(artifacts, name + '.png');
    await page.screenshot({ path: file, fullPage: true, scale: 'css' });
    report.screenshots.push(file);
  }
  await screenshot('01-catalog');
  await page.getByTestId('toolkit-card-backups').click();
  await page.getByTestId('backups-hero').waitFor();
  await screenshot('02-backups');
  await page.getByTestId('backups-customize').click();
  await page.getByTestId('backups-select-research').click();
  await page.getByTestId('backups-record').first().waitFor();
  await screenshot('03-selection');
  await page.getByTestId('backups-selector-close').click();
  await page.getByTestId('backups-customize').click();
  await page.getByTestId('backups-preset').selectOption('research');
  await page.getByTestId('backups-organization').selectOption('authors');
  await page.getByTestId('backups-preview').click();
  await page.getByTestId('backups-preview-result').waitFor({ timeout: 120000 });
  await page.getByTestId('backups-preview-result').scrollIntoViewIfNeeded();
  await screenshot('04-preview');
  await page.getByTestId('backups-customize').click();
  await page.getByTestId('backups-preset-name').fill('Lectura por autores');
  await page.getByTestId('backups-save-preset').click();
  await page.getByTestId('backups-format-csv').check();
  await page.getByTestId('backups-format-json').check();
  await page.getByTestId('backups-destination').click();
  await page.getByTestId('backups-export').click();
  await page.getByTestId('backups-open-result').waitFor({ timeout: 120000 });
  await page.getByTestId('backups-job').scrollIntoViewIfNeeded();
  await screenshot('05-completed');
  const uiResult = await page.evaluate(() => window.nodus.getBackupCatalog([]));
  assert.ok(uiResult.vaults.length >= 9);
  let count = 0;
  let folderContents;
  for (const vault of vaults)
    for (const formats of [['markdown'], ['csv'], ['json'], ['markdown', 'csv', 'json']])
      for (const container of ['folder', 'zip']) {
        const options = {
          ...defaultOpenBackupOptions(vault.id),
          formats,
          container,
          authorizePreservation: true,
        };
        const result = await page.evaluate(
          async ({ id, options, output }) => window.nodus.runOpenBackup(id, options, output, () => {}),
          { id: 'e2e-' + count++, options, output },
        );
        assert.ok(!result.cancelled);
        const files = await filesOf(result);
        const manifest = validate(files, options, [vault.id]);
        assert.equal(manifest.omissions.length, 0, JSON.stringify(manifest.omissions));
        if (formats.includes('json')) {
          const table = (name) =>
            JSON.parse([...files].find(([p]) => p.endsWith('/' + name + '.json'))[1]).records;
          assert.deepEqual(
            table('works')
              .map((r) => r.nodus_id)
              .sort(),
            ['work-a', 'work-b'],
          );
          assert.deepEqual(
            table('ideas')
              .map((r) => r.global_id)
              .sort(),
            ['idea-a', 'idea-b'],
          );
          assert.equal(table('idea_occurrences').length, 3);
          assert.deepEqual(
            table('evidence').map((r) => [r.id, r.nodus_id, r.quote]),
            [
              ['ev-a', 'work-a', 'EVIDENCE_SENTINEL_A · ' + body],
              ['ev-b', 'work-b', 'EVIDENCE_SENTINEL_B'],
            ],
          );
          assert.equal(table('dictionary_entries')[0].content_markdown, 'DICTIONARY_SENTINEL · ' + body);
          assert.equal(table('chat_messages')[0].content, 'CHAT_SENTINEL · ' + body);
          assert.deepEqual(table('writing_saved_drafts')[0].draft_json, {
            body: 'REPORT_SENTINEL · ' + body,
            password: 'authored field',
          });
          assert.equal(table('study_docs')[0].content_markdown, 'STUDY_SENTINEL · ' + body);
          assert.deepEqual(table('study_questions')[0].answer_json, { answer: body });
          const attached = table('archive_items').find((r) => r.item_id === 'attachment-a');
          assert.equal(files.get(attached.blob.file).toString(), body);
          if (vault.type === 'databases') {
            const binary = table('db_attachments')[0].blob;
            assert.equal(files.get(binary.file).toString(), body);
          }
        }
        if (vault.type === 'academic' && formats.includes('markdown'))
          assert.ok(
            [...files].some(
              ([name, bytes]) =>
                name.endsWith('.md') && bytes.toString().includes('NATIVE_DOCUMENT_SENTINEL'),
            ),
          );
        if (container === 'folder') folderContents = files;
        else {
          assert.deepEqual([...files.keys()].sort(), [...folderContents.keys()].sort());
          for (const [name, bytes] of files)
            if (name !== 'manifest.json')
              assert.ok(bytes.equals(folderContents.get(name)), 'ZIP/folder: ' + name);
        }
        report.cases.push({ vault: vault.type, formats, container, files: files.size });
        if (vault.type === 'academic' && formats.length === 3 && container === 'folder')
          report.example = result.path;
      }
  for (const organization of ['works', 'authors', 'ideas'])
    for (const summaries of ['inline', 'separate', 'none']) {
      const options = {
        ...defaultOpenBackupOptions(vaults[0].id),
        formats: ['markdown', 'csv', 'json'],
        organization,
        summaries,
        includeAttachments: false,
        includeHistory: false,
      };
      const result = await page.evaluate(
        async ({ id, options, output }) => window.nodus.runOpenBackup(id, options, output, () => {}),
        { id: 'e2e-' + count++, options, output },
      );
      const files = await filesOf(result);
      validate(files, options, [vaults[0].id]);
      const md = [...files].filter(([name]) => name.includes('/markdown/' + organization + '/'));
      assert.equal(md.length, 2, organization);
      for (const [name, bytes] of md) {
        const source = bytes.toString('utf8');
        if (organization === 'works' && source.includes('ZA')) {
          assert.ok(!markdownText(source).includes('EVIDENCE_SENTINEL_B'));
          assert.ok(markdownText(source).includes('EVIDENCE_SENTINEL_A'));
        }
      }
      report.cases.push({ organization, summaries });
    }
  for (const organization of ['works', 'authors', 'ideas']) {
    const options = {
      ...defaultOpenBackupOptions(vaults[0].id),
      formats: ['markdown', 'csv', 'json'],
      organization,
      includeEvidence: false,
      includeRelations: false,
      includeThemes: false,
      includeSyntheses: false,
      includeHistory: false,
      includeAttachments: false,
      summaries: 'none',
    };
    const result = await page.evaluate(
      async ({ options, output }) =>
        window.nodus.runOpenBackup('e2e-exclusions-' + options.organization, options, output, () => {}),
      { options, output },
    );
    const files = await filesOf(result);
    validate(files, options, [vaults[0].id]);
    assert.ok(
      ![...files.keys()].some((name) => /\/(edges|themes|author_dossier_synthesis)\.(json|csv)$/.test(name)),
    );
    report.cases.push({ organization, exclusions: true });
  }
  const partial = {
    ...defaultOpenBackupOptions(vaults[0].id),
    formats: ['markdown', 'csv', 'json'],
    selections: { [vaults[0].id + ':works']: [JSON.stringify(['work-a'])] },
    includeEvidence: false,
    includeRelations: false,
    includeThemes: false,
    includeSyntheses: false,
    includeAttachments: false,
    includeHistory: false,
  };
  const partialResult = await page.evaluate(
    async ({ options, output }) => window.nodus.runOpenBackup('e2e-partial', options, output, () => {}),
    { options: partial, output },
  );
  const partialFiles = await filesOf(partialResult);
  validate(partialFiles, partial, [vaults[0].id]);
  for (const [name, bytes] of partialFiles)
    if (
      name.endsWith('.json') &&
      name !== 'manifest.json' &&
      !name.includes('/files/') &&
      !name.includes('/attachments/')
    ) {
      assert.ok(!bytes.toString().includes('SUMMARY_SENTINEL_B'));
      assert.ok(!bytes.toString().includes('IDEA_SENTINEL_B'));
    }
  for (const vault of vaults) {
    const options = {
      ...partial,
      vaultIds: [vault.id],
      selections: { [vault.id + ':works']: [JSON.stringify(['work-a'])] },
      authorizePreservation: true,
    };
    const result = await page.evaluate(
      async ({ options, output }) =>
        window.nodus.runOpenBackup('e2e-selected-' + options.vaultIds[0], options, output, () => {}),
      { options, output },
    );
    const files = await filesOf(result);
    validate(files, options, [vault.id]);
    const work = JSON.parse([...files].find(([name]) => name.endsWith('/works.json'))[1]);
    assert.deepEqual(
      work.records.map((row) => row.nodus_id),
      ['work-a'],
    );
    report.cases.push({ vault: vault.type, partialSelection: true });
  }
  const multi = {
    ...defaultOpenBackupOptions(vaults[0].id),
    vaultIds: [vaults[0].id, vaults[1].id],
    formats: ['markdown', 'csv', 'json'],
  };
  const multiResult = await page.evaluate(
    async ({ options, output }) => window.nodus.runOpenBackup('e2e-multi', options, output, () => {}),
    { options: multi, output },
  );
  validate(await filesOf(multiResult), multi, multi.vaultIds);
  const libraryParent = path.join(temp, 'recovery'),
    libraryRoot = path.join(libraryParent, 'nodus-library');
  await mkdir(libraryRoot, { recursive: true });
  const libraryBundle = path.join(temp, 'library.cjs');
  buildSync({
    entryPoints: [path.join(repo, 'electron/library/libraryStorage.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@shared': path.join(repo, 'shared') },
    outfile: libraryBundle,
    logLevel: 'silent',
  });
  const { LibraryDiskStore } = require(libraryBundle);
  const store = new LibraryDiskStore(libraryRoot, 'e2e-backups-device');
  for (const id of ['linked', 'unlinked']) {
    store.upsertItem({
      id,
      storageId: id,
      source: 'nodus',
      metadata: { title: 'Documento ' + id, itemType: 'book', creators: [], year: 2024 },
      collectionIds: [],
      attachments: [],
      files: { original: 'original.txt', reader: 'reader.md' },
      vaultWorkIds: id === 'linked' ? { [vaults[0].id]: 'work-a' } : {},
    });
    await writeFile(path.join(store.itemFolder(id), 'original.txt'), body);
    await writeFile(path.join(store.itemFolder(id), 'reader.md'), '# Documento ' + id + '\n\n' + body);
  }
  await page.evaluate((folder) => window.nodus.updateSettings({ autoBackupFolder: folder }), libraryParent);
  for (const includeGlobalLibrary of [false, true]) {
    const options = {
      ...defaultOpenBackupOptions(vaults[0].id),
      formats: ['markdown', 'csv', 'json'],
      includeGlobalLibrary,
    };
    const result = await page.evaluate(
      async ({ options, output }) =>
        window.nodus.runOpenBackup('e2e-global-' + options.includeGlobalLibrary, options, output, () => {}),
      { options, output },
    );
    const files = await filesOf(result);
    validate(files, options, [vaults[0].id]);
    const records = [...files]
      .filter(([name]) => name.startsWith('library/') && name.endsWith('/record.json'))
      .map(([, bytes]) => JSON.parse(bytes).record.id)
      .sort();
    assert.deepEqual(records, includeGlobalLibrary ? ['linked', 'unlinked'] : ['linked']);
    for (const id of records) {
      const original = [...files].find(
        ([name]) => name.startsWith('library/Documento ' + id) && name.endsWith('/original.txt'),
      );
      assert.equal(original[1].toString(), body);
    }
    report.cases.push({ globalLibrary: includeGlobalLibrary, records });
  }
  // Cancellation crosses the real IPC channel while the worker streams a large original.
  const largeDb = new Database(vaults[0].path);
  const libraryOnly = {
    ...defaultOpenBackupOptions(vaults[0].id),
    vaultIds: [],
    includeGlobalLibrary: true,
    formats: ['markdown', 'csv', 'json'],
    selections: { 'global:library_items': [JSON.stringify(['unlinked'])] },
  };
  const libraryResult = await page.evaluate(
    async ({ options, output }) =>
      window.nodus.runOpenBackup('e2e-library-selection', options, output, () => {}),
    { options: libraryOnly, output },
  );
  const libraryFiles = await filesOf(libraryResult);
  validate(libraryFiles, libraryOnly, []);
  assert.deepEqual(
    [...libraryFiles]
      .filter(([name]) => name.endsWith('/record.json'))
      .map(([, bytes]) => JSON.parse(bytes).record.id),
    ['unlinked'],
  );
  report.cases.push({ globalLibrarySelection: true });
  await rm(path.join(store.itemFolder('unlinked'), 'original.txt'));
  const missingOriginal = await page.evaluate(
    async ({ options, output }) =>
      window.nodus.runOpenBackup('e2e-missing-attachment', options, output, () => {}),
    { options: libraryOnly, output },
  );
  assert.ok(missingOriginal.omissions.length);
  validate(await filesOf(missingOriginal), libraryOnly, []);
  report.cases.push({ missingAttachment: true });
  const large = Buffer.alloc(16 * 1024 * 1024, 77);
  largeDb
    .prepare(
      'INSERT INTO archive_items(item_id,title,kind,file_name,mime_type,bytes,blob,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'large-cancel',
      'Original grande',
      'other',
      'large.bin',
      'application/octet-stream',
      large.length,
      large,
      stamp,
      stamp,
    );
  const insertLargeNote = largeDb.prepare(
    'INSERT INTO notes(id,title,kind,content,created_at,updated_at) VALUES(?,?,?,?,?,?)',
  );
  largeDb.transaction(() => {
    for (let i = 0; i < 1000; i++)
      insertLargeNote.run('large-note-' + i, 'Nota ' + i, 'markdown', body.repeat(40), stamp, stamp);
  })();
  largeDb.close();
  const largeStarted = Date.now();
  const previousOutputs = new Set(await readdir(output));
  await page.getByTestId('backups-preset').selectOption('all');
  await page.getByTestId('backups-export').click();
  await page.getByTestId('backups-back').click();
  await page.getByTestId('toolkit-card-backups').click();
  await page.getByTestId('backups-open-result').waitFor({ timeout: 120000 });
  const largePublished = (await readdir(output)).filter(
    (name) => !previousOutputs.has(name) && !name.startsWith('.'),
  );
  assert.equal(largePublished.length, 1);
  const largeResultPath = path.join(output, largePublished[0]);
  const largeFiles = await filesOf({ path: largeResultPath });
  validate(largeFiles, { ...defaultOpenBackupOptions(vaults[0].id), formats: ['markdown', 'csv', 'json'] }, [
    vaults[0].id,
  ]);
  const largeNotes = JSON.parse([...largeFiles].find(([name]) => name.endsWith('/notes.json'))[1]).records;
  assert.equal(largeNotes.filter((row) => row.id.startsWith('large-note-')).length, 1000);
  const largeAttachments = JSON.parse(
    [...largeFiles].find(([name]) => name.endsWith('/archive_items.json'))[1],
  ).records;
  const largeDescriptor = largeAttachments.find((row) => row.item_id === 'large-cancel').blob;
  assert.equal(largeDescriptor.sha256, digest(large));
  assert.ok(largeFiles.get(largeDescriptor.file).equals(large));
  report.cases.push({
    largeAttachment: large.length,
    textRecords: 1000,
    navigationDuringExport: true,
    elapsedMs: Date.now() - largeStarted,
  });
  const cancelled = await page.evaluate(
    async ({ options, output }) =>
      window.nodus.runOpenBackup('e2e-cancel', options, output, (p) => {
        if (p.phase === 'export') void window.nodus.cancelOpenBackup('e2e-cancel');
      }),
    { options: defaultOpenBackupOptions(vaults[0].id), output },
  );
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.path, null);
  assert.ok(!(await readdir(output)).some((name) => name.startsWith('.nodus-export-')));
  report.cases.push({ cancellation: true });
  const preset = { id: 'e2e-preset', name: 'Mi selección', options: partial };
  await page.evaluate((p) => window.nodus.saveBackupPreset(p), preset);
  assert.ok(
    (await page.evaluate(() => window.nodus.getBackupCatalog([]))).presets.some((p) => p.id === preset.id),
  );
  const stale = { ...partial, selections: { [vaults[0].id + ':works']: [JSON.stringify(['missing-work'])] } };
  const missing = await page.evaluate(
    async ({ options, output }) => window.nodus.runOpenBackup('e2e-missing', options, output, () => {}),
    { options: stale, output },
  );
  assert.ok(missing.omissions.length);
  await assert.rejects(() =>
    page.evaluate(
      async ({ options, output }) => window.nodus.runOpenBackup('e2e-invalid', options, output, () => {}),
      { options: partial, output: path.join(temp, 'missing-directory') },
    ),
  );
  await page.reload();
  await page.waitForFunction(() => !!window.nodus);
  await page.getByRole('button', { name: 'Backups', exact: true }).first().click();
  await page.getByTestId('backups-preset').selectOption(preset.id);
  await page.getByTestId('backups-customize').click();
  await page.getByTestId('backups-select-research').click();
  await page.getByTestId('backups-record').first().waitFor();
  const checkedRecords = await page.locator('[data-testid="backups-record"]:checked').count();
  assert.equal(checkedRecords, 1);
  await page.getByTestId('backups-selector-close').click();
  report.cases.push({ presetReopened: true, missingSelectedRecord: true, invalidDestination: true });
  await page.getByTestId('backups-preset').selectOption('all');
  await page.getByTestId('backups-vault-' + vaults[6].id).check();
  await page.getByTestId('backups-vault-' + vaults[0].id).uncheck();
  await page.getByTestId('backups-destination').click();
  await page.getByTestId('backups-export').click();
  await page.getByTestId('backups-preservation-confirm').waitFor();
  await page.getByTestId('backups-preservation-accept').click();
  await page.getByTestId('backups-open-result').waitFor({ timeout: 120000 });
  report.cases.push({ preservationConfirmationUi: true });
  await page.getByTestId('backups-native').scrollIntoViewIfNeeded();
  await page.getByTestId('backups-native').click();
  await page.getByTestId('backups-native-result').waitFor({ timeout: 180000 });
  const credentials = (await page.getByTestId('backups-native-credentials').textContent()).split('\n');
  assert.ok(credentials[0]);
  const restoreEnv = { ...env, NODUS_USERDATA: path.join(temp, 'restored-profile') };
  const restoredApp = await electron.launch({
    executablePath: require('electron'),
    args: [repo],
    env: restoreEnv,
    timeout: 30000,
  });
  try {
    const restoredPage = await restoredApp.firstWindow();
    await restoredPage.waitForFunction(() => !!window.nodus);
    const restoredLibraryParent = path.join(temp, 'restored-recovery');
    await mkdir(restoredLibraryParent, { recursive: true });
    await restoredPage.evaluate(
      (folder) => window.nodus.updateSettings({ autoBackupFolder: folder }),
      restoredLibraryParent,
    );
    await restoredApp.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      },
      path.join(output, 'complete.nodus'),
    );
    const restored = await restoredPage.evaluate(
      (password) => window.nodus.importData(password),
      credentials[0],
    );
    assert.equal(restored.ok, true, restored.message);
    const recovered = await restoredPage.evaluate(() => window.nodus.listVaults());
    for (const vault of vaults) {
      const recoveredVault = recovered.find((v) => v.id === vault.id);
      assert.ok(recoveredVault);
      const db = new Database(recoveredVault.path, { readonly: true });
      try {
        assert.equal(
          db.prepare('SELECT summary FROM work_summaries WHERE nodus_id=?').get('work-a').summary,
          'SUMMARY_SENTINEL_A · ' + body,
        );
        assert.equal(
          db.prepare('SELECT quote FROM evidence WHERE id=?').get('ev-b').quote,
          'EVIDENCE_SENTINEL_B',
        );
        assert.equal(
          db.prepare('SELECT blob FROM archive_items WHERE item_id=?').get('attachment-a').blob.toString(),
          body,
        );
      } finally {
        db.close();
      }
    }
    const restoredOriginal = await readFile(
      path.join(restoredLibraryParent, 'nodus-library', 'linked', 'original.txt'),
    );
    assert.equal(restoredOriginal.toString(), body);
    report.cases.push({ nativeRestore: true, vaults: vaults.length, globalLibrary: true });
  } finally {
    await restoredApp.close();
  }
  assert.deepEqual(errors, []);
  report.passed = true;
  await rm(path.join(artifacts, 'failure.png'), { force: true });
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify(report, null, 2));
  console.log('Backups E2E passed:', report.cases.length, 'format/selection cases. Artifacts:', artifacts);
} catch (error) {
  if (app)
    await (await app.firstWindow())
      .screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  if (!process.env.NODUS_BACKUPS_ARTIFACT_DIR) console.log('Temporary evidence retained at', temp);
}
