// A database form server whose first listen failed (port in use) must be able to start later.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a failed listen does not wedge the form server', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-form-server-'));
  const blocker = net.createServer();
  try {
    const stub = path.join(temp, 'stub.cjs');
    fs.writeFileSync(stub, 'module.exports={getColumns:()=>[],authenticateDatabaseForm:()=>false,getDatabaseFormBySlug:()=>null,submitDatabaseForm:async()=>{}};');
    const out = path.join(temp, 'form.cjs');
    await build({ entryPoints: [path.join(root, 'electron/automation/formServer.ts')], outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'error', external: ['electron', 'better-sqlite3'], tsconfig: path.join(root, 'tsconfig.json'),
      plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /\/db\/(databasesRepo|databaseAutomationsRepo)$/ }, () => ({ path: stub })); } }] });
    const forms = createRequire(import.meta.url)(out);
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    await assert.rejects(forms.startDatabaseFormServer(blocker.address().port), { code: 'EADDRINUSE' });
    assert.equal(forms.databaseFormServerStatus().running, false);
    const status = await forms.startDatabaseFormServer(0);
    assert.equal(status.running, true, 'a later start on a free port runs');
    assert.ok(status.port > 0);
    await forms.stopDatabaseFormServer();
  } finally {
    blocker.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
