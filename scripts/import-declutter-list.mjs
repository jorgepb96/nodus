#!/usr/bin/env node
// One-time import of the old per-file declutter list (<userData>/scheme-declutter.json) into the
// per-work choice that extraction now reads (schemeDeclutter.ts, `pdf_declutter:<identity>`).
// A listed PDF was extracted decluttered and its passages and analysis were built from that
// text; without a recorded choice, extraction would decide 'plain' for it (its text is in use)
// and the text would change. The choice binds layout-2, the classifier that text came from, so a
// later classifier never changes it (schemeClassifiers.ts). Only inserts: an existing choice is
// never overwritten.
//
//   node scripts/import-declutter-list.mjs [--dry-run] [--user-data <dir>]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const Database = createRequire(import.meta.url)('better-sqlite3');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const at = args.indexOf('--user-data');
const userData = at >= 0 ? args[at + 1] : path.join(os.homedir(), 'Library', 'Application Support', 'Nodus');
const listPath = path.join(userData, 'scheme-declutter.json');
if (!fs.existsSync(listPath)) { console.log(`no list at ${listPath}; nothing to import`); process.exit(0); }
const files = JSON.parse(fs.readFileSync(listPath, 'utf8')).files ?? [];

const db = new Database(path.join(userData, 'nodus.sqlite'), { readonly: dryRun });
// Zotero stores an attachment at <storage>/<itemKey>/<file>; the recorded text source names it.
const sourcesFor = db.prepare(`SELECT DISTINCT nodus_id, source_ref FROM work_text_sources WHERE source_ref LIKE ?`);
const insert = dryRun ? null : db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'declutter:layout-2') ON CONFLICT(key) DO NOTHING`);
const existing = db.prepare('SELECT value FROM settings WHERE key = ?');
let imported = 0;
for (const file of files) {
  const itemKey = path.basename(path.dirname(file));
  const rows = sourcesFor.all(`zotero:%:%:${itemKey}`);
  if (!rows.length) { console.log(`  skip (no recorded source): ${file}`); continue; }
  for (const { nodus_id: nodusId, source_ref: sourceRef } of rows) {
    // Same identity as declutterForWorkSource.
    const key = `pdf_declutter:${createHash('sha256').update(JSON.stringify([nodusId, sourceRef])).digest('hex')}`;
    const saved = existing.get(key)?.value;
    if (saved !== undefined) { console.log(`  keep (${saved}): ${path.basename(file)}`); continue; }
    if (insert) insert.run(key);
    imported += 1;
    console.log(`  ${dryRun ? 'would record' : 'recorded'} declutter: ${path.basename(file)}`);
  }
}
console.log(`${imported} choice(s) ${dryRun ? 'to record (dry run)' : 'recorded'} from ${files.length} listed file(s)`);
