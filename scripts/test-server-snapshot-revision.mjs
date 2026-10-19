import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-server-snapshot-revision.mjs'), '--electron-snapshot-revision')) {
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-snapshot-revision-'));
installRuntimeHooks(root);
const Database = require('better-sqlite3');
const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));

test('streaming revision matches the former whole-object JSON digest', () => {
  const db = new Database(path.join(root, 'vault.sqlite'));
  try {
    runMigrations(db);
    const vault = { id: 'v1', name: 'Sintética', type: 'academic' };
    const built = buildServerSnapshot(
      vault,
      { nodusServerIncludeUserContent: true, nodusServerIncludePassages: true },
      db,
      null,
    );
    const payload = JSON.parse(built.buffer.toString('utf8'));
    const expected = createHash('sha256').update(JSON.stringify({
      vault: payload.vault,
      embeddingIndex: payload.embeddingIndex,
      schemaVersion: payload.schemaVersion,
      assets: payload.assets,
      library: null,
      tables: payload.tables,
    })).digest('base64url');
    assert.equal(built.revision, expected);

    const second = buildServerSnapshot(
      vault,
      { nodusServerIncludeUserContent: true, nodusServerIncludePassages: true },
      db,
      null,
    );
    assert.equal(second.revision, built.revision, 'generatedAt is excluded from the revision');
  } finally {
    db.close();
  }
});

test('revision hashing streams values instead of materialising the full object again', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'), 'utf8');
  assert.match(source, /updateJsonHash\(revisionHash,/);
  assert.doesNotMatch(source, /\.update\(JSON\.stringify\(\{/);
});

test.after(async () => {
  await rm(root, { recursive: true, force: true });
});
