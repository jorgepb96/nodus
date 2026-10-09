import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, waitFor } from './lib/research-app-harness.mjs';

const source = fs.realpathSync(process.argv.find(value => value.startsWith('--model-root='))?.slice(13) ?? '');
const marker = JSON.parse(fs.readFileSync(path.join(source, 'isolation.json'), 'utf8')); assert.equal(marker.root, source);
assert.equal(marker.format, 'nodus.isolated-research-profile/1');
const model = JSON.parse(fs.readFileSync(path.join(source, 'artifacts/model-manifest.json'), 'utf8'));
const harness = await createResearchApp({ extraEnv: { NODUS_EMBEDDING_QA_TRACE: '1' } });
const report = { format: 'nodus.embedding-restart-preparation/1', root: harness.root, isolation: harness.proof, completed: false };
try {
  fs.cpSync(model.directory, path.join(harness.root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1'), { recursive: true });
  let { app, page } = await harness.launch();
  await harness.prepareProfile(page, { embeddingProvider: 'nodus', embeddingModel: 'embeddinggemma-2-text-q8-512-v1' });
  await app.evaluate(() => {
    const { Worker } = process.getBuiltinModule('module').createRequire(process.cwd() + '/qa.cjs')('node:worker_threads');
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (message.operation === 'infer' && message.texts.some(text => text.includes('QA_RESTART'))) { globalThis.qaHeldPreparation = true; return; }
      return original.call(this, message, ...rest);
    };
  });
  const item = await page.evaluate(() => window.nodus.createGlobalLibraryItem({ title: 'Restart checkpoint', itemType: 'report', creators: [],
    abstract: Array.from({ length: 100 }, (_, index) => `QA_RESTART source record ${index}: the Prisma instrument measures salinity after a seventy-one-minute calibration window.`).join('\n') }, []));
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'Restart during preparation', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), item.id);
  assert(await waitFor(() => app.evaluate(() => Boolean(globalThis.qaHeldPreparation)), { timeoutMs: 120000 }));
  report.before = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  assert.notEqual(report.before.documents.find(document => document.id === item.id).preparation.embeddings, 'ready');
  const exit = new Promise(resolve => app.process().once('exit', (code, signal) => resolve({ code, signal })));
  app.process().kill('SIGKILL'); report.interruption = await exit; await harness.closeApp();
  ({ app, page } = await harness.launch());
  await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), item.id);
  assert(await waitFor(async () => (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === item.id).preparation.embeddings === 'ready', { timeoutMs: 240000 }));
  report.after = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  report.result = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'What does Prisma measure and how long is its calibration window?'), notebook.id);
  assert(report.result.evidence.some(evidence => /salinity|seventy-one/.test(evidence.text)));
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { await harness.close(); fs.writeFileSync(path.join(harness.root, 'artifacts/restart-preparation.json'), JSON.stringify(report, null, 2)); console.log(`Restart preparation: ${harness.root}/artifacts/restart-preparation.json`); }
