#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const dbPath = path.resolve(arg('db') ?? '');
const fixturePath = path.resolve(arg('fixture') ?? '');
if (!arg('db') || !arg('fixture')) throw new Error('Usage: research-live-passages-sqlite-fixture.mjs --db=PATH --fixture=PATH');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const require = createRequire(import.meta.url);
const Database = require(path.resolve('node_modules/better-sqlite3'));
const db = new Database(dbPath);
try {
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE documentary_publications(document_id TEXT PRIMARY KEY, document_json TEXT NOT NULL);
    CREATE TABLE documentary_revisions(index_key TEXT PRIMARY KEY, document_id TEXT NOT NULL, identity_json TEXT NOT NULL, lexical_ready INTEGER NOT NULL, embedding_ready INTEGER NOT NULL);
    CREATE TABLE documentary_passages(document_id TEXT NOT NULL, index_key TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      text TEXT NOT NULL, locator_json TEXT NOT NULL, vector BLOB, vector_json TEXT, PRIMARY KEY(index_key,ordinal));`);
  const insertPublication = db.prepare('INSERT INTO documentary_publications VALUES(?,?)');
  const insertRevision = db.prepare('INSERT INTO documentary_revisions VALUES(?,?,?,?,?)');
  const insertPassage = db.prepare('INSERT INTO documentary_passages VALUES(?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const row of fixture.publications) insertPublication.run(row.documentId, JSON.stringify(row.publication));
    for (const row of fixture.passages) {
      insertRevision.run(row.indexKey, row.documentId, JSON.stringify(row.identity), 1, row.embeddingReady);
      insertPassage.run(row.documentId, row.indexKey, `${row.indexKey}:${row.ordinal}`, row.ordinal, row.text, JSON.stringify(row.locator),
        row.embeddingReady ? Buffer.alloc(2048, row.ordinal + 1) : null, null);
    }
  })();
  db.pragma('wal_checkpoint(TRUNCATE)');
} finally { db.close(); }
process.stdout.write(JSON.stringify({ databaseCreated: true, publicationCount: fixture.publications.length,
  passageCount: fixture.passages.length, databaseSha256: 'computed-by-parent-test' }) + '\n');
