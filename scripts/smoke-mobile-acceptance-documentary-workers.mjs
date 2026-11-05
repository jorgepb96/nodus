// Run with Electron (browser main), not ELECTRON_RUN_AS_NODE. This checks the
// built LAB artifacts, their real utility wrapper and existing read-only text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { app, utilityProcess } from 'electron';

// Electron must finish evaluating its ESM entrypoint before app.ready can fire.
// Start the async run without a top-level await, and bound readiness as well as IPC.
async function run() {
let scratch;
let database;
let child;
let childExited;
let workerOutputBytes = 0;
let exitCode = 1;
let deadline;
const expired = new Promise((_, reject) => {
  deadline = setTimeout(() => reject(new Error('The documentary artifact smoke exceeded its global 20-second deadline.')), 20000);
});
try {
  assert.ok(process.type === 'browser' && utilityProcess?.fork, 'Run this smoke with the Electron browser main runtime.');
  const configuredLab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
  assert.ok(configuredLab, 'NODUS_MOBILE_ACCEPTANCE_LAB must identify an isolated marked LAB.');
  const lab = fs.realpathSync(configuredLab);
  assert.ok(fs.statSync(path.join(lab, '.nodus-mobile-acceptance-lab')).isFile(), 'An isolated marked LAB is required.');
  const filename = fs.realpathSync(process.env.NODUS_MOBILE_ACCEPTANCE_DOCUMENTARY ?? path.join(lab, 'documentary/store.sqlite'));
  const relative = path.relative(lab, filename);
  assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), 'The documentary database must resolve inside the marked LAB.');
  assert.ok(fs.statSync(filename).isFile(), 'The documentary database must already exist.');

  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const folder = path.join(repo, 'node_modules/.cache/nodus-mobile-acceptance');
  const receipt = JSON.parse(fs.readFileSync(path.join(folder, 'lab-bridge.build.json'), 'utf8'));
  const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.ok(sha256(path.join(folder, 'lab-bridge.cjs')) === receipt.bundleSha256, 'The Bridge must match its build receipt.');
  for (const name of ['backgroundUtility', 'documentaryRetrievalWorker']) {
    const item = receipt.workers?.[name];
    assert.ok(item?.file === `${name}.js` && sha256(path.join(folder, `${name}.js`)) === item.sha256, `The ${name} artifact must match its build receipt.`);
  }

  // Chromium's own profile is temporary; this process never opens the LAB as its
  // userData, initializes its services, imports aiClient or requests a provider.
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-worker-smoke-'));
  app.setPath('userData', scratch);
  app.on('window-all-closed', () => {});
  await Promise.race([app.whenReady(), expired]);
  database = new Database(filename, { readonly: true, fileMustExist: true });
  const samples = database.prepare(`SELECT p.index_key,p.document_id,p.text FROM documentary_passages p
    JOIN documentary_revisions r ON r.index_key=p.index_key
    WHERE r.lexical_ready=1 AND length(p.text) BETWEEN 80 AND 10000 ORDER BY p.rowid LIMIT 32`).all();
  const sample = samples.find(row => Buffer.byteLength(row.text, 'utf8') <= 8000 && row.text.match(/\p{L}{4,}/u));
  assert.ok(sample, 'The existing documentary store needs a prepared prose passage.');
  const query = sample.text.match(/\p{L}{4,}/u)[0];
  const input = {
    filename, query, lexicalKeys: [sample.index_key], vectorKeys: [], vector: null, threshold: -1,
    settings: { preset: 'custom', candidates: 40, passagesPerRound: 8, evidenceTokens: 12000,
      rounds: 1, autoExpand: false, threshold: { mode: 'automatic' } },
  };
  const canonical = database.prepare('SELECT index_key,document_id,text,locator_json FROM documentary_passages WHERE id=?');
  const validate = message => {
    assert.ok(!message.error, 'The built documentary worker returned an error.');
    assert.ok(Array.isArray(message.passages) && message.passages.length > 0, 'The built worker must return existing evidence for both queries.');
    for (const passage of message.passages) {
      const source = canonical.get(passage.id);
      assert.ok(source && source.index_key === sample.index_key && source.document_id === sample.document_id
        && passage.index_key === source.index_key && passage.document_id === source.document_id
        && passage.text === source.text && passage.locator_json === source.locator_json,
      'Every result must be canonical existing evidence within the authorized revision.');
    }
    return message.passages.map(passage => [passage.id, passage.index_key, passage.locator_json]);
  };
  const result = await Promise.race([new Promise((resolve, reject) => {
    let finished = false;
    let first;
    let nextId = 1;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      if (error) reject(error); else resolve(value);
    };
    try {
      child = utilityProcess.fork(path.join(folder, 'backgroundUtility.js'), [path.join(folder, 'documentaryRetrievalWorker.js')],
        { serviceName: 'Nodus documentary artifact smoke', stdio: 'pipe', execArgv: [] });
      childExited = new Promise(done => child.once('exit', done));
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { workerOutputBytes += chunk.length; });
      child.once('spawn', () => child.postMessage({ ...input, id: nextId }));
      child.once('error', () => finish(new Error('The documentary smoke utility failed to start.')));
      child.once('exit', code => finish(new Error(`The documentary smoke utility exited before completion (code ${code}).`)));
      child.on('message', message => {
        if (finished || message?.id !== nextId || message.type === 'activity') return;
        try {
          const selected = validate(message);
          if (nextId === 1) {
            first = selected; nextId = 2;
            child.postMessage({ ...input, id: nextId });
          } else {
            assert.ok(JSON.stringify(selected) === JSON.stringify(first), 'The same long-lived utility must return stable canonical evidence twice.');
            finish(null, { queries: 2, passagesPerQuery: selected.length,
              evidenceIdentitySha256: createHash('sha256').update(JSON.stringify(selected)).digest('hex') });
          }
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  }), expired]);
  console.log(JSON.stringify({ ok: true, ...result, workerOutputBytes, sourceDigest: receipt.sourceDigest,
    bundleSha256: receipt.bundleSha256, workers: receipt.workers }));
  exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Documentary artifact smoke failed.');
} finally {
  clearTimeout(deadline);
  // Only this smoke's child, read-only connection and temporary profile belong
  // to us. The running acceptance host and the LAB files remain untouched.
  if (child) {
    child.kill();
    let timer;
    await Promise.race([childExited, new Promise(done => { timer = setTimeout(done, 5000); })]);
    clearTimeout(timer);
  }
  database?.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  app.exit(exitCode);
}
}
void run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Documentary artifact smoke cleanup failed.');
  app.exit(1);
});
