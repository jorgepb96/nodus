import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './research-app-harness.mjs';

/** Faults target the real native worker of an already isolated application. */
export async function checkNativeEmbeddingFailures(harness, report, notebookId, sourceId) {
  if (!report.profile.startsWith('embeddinggemma')) return;
  const { app, page } = harness, query = 'Which apparatus determines how cloudy a liquid is using a visible beam?';
  const traceFile = path.join(harness.root, 'profile/embedding-trace.jsonl');
  const traces = () => fs.readFileSync(traceFile, 'utf8').trim().split('\n').map(JSON.parse);
  const arm = mode => app.evaluate((_, mode) => {
    const { Worker } = process.getBuiltinModule('module').createRequire(process.cwd() + '/qa.cjs')('node:worker_threads');
    const original = Worker.prototype.postMessage;
    globalThis.qaEmbeddingFault = { original, mode, intercepted: false, Worker };
    Worker.prototype.postMessage = function(message, ...rest) {
      const fault = globalThis.qaEmbeddingFault;
      if (!fault.intercepted && message?.operation === 'infer' && message.texts?.some(text => text.includes('QA_NATIVE_FAULT'))) {
        fault.intercepted = true; fault.dimensions = message.dimensions; fault.worker = this; fault.message = message; fault.rest = rest;
        if (mode === 'crash') void this.terminate();
        else if (mode === 'memory') this.emit('error', Object.assign(new Error('QA simulated native allocation failure'), { code: 'ENOMEM' }));
        return;
      }
      return original.call(this, message, ...rest);
    };
  }, mode);
  const release = () => app.evaluate(() => {
    const fault = globalThis.qaEmbeddingFault; fault.Worker.prototype.postMessage = fault.original;
    if (fault.mode === 'hold' && fault.intercepted && !fault.released) { fault.released = true; fault.original.call(fault.worker, fault.message, ...fault.rest); }
    return { intercepted: fault.intercepted, dimensions: fault.dimensions, mode: fault.mode };
  });
  report.checks.nativeFailures = [];
  for (const mode of ['crash', 'memory']) {
    const before = traces().length; await arm(mode);
    let result;
    try { result = await page.evaluate(({ notebookId, query }) => window.nodus.searchResearchNotebook(notebookId, query + ' QA_NATIVE_FAULT'), { notebookId, query }); }
    finally { await release(); }
    const failed = traces().slice(before).filter(trace => trace.type === 'documentary-retrieval');
    assert(failed.length && failed.every(trace => !trace.retrieval.semantic.length), 'a failed encoder cannot count as semantic success');
    assert(failed.every(trace => trace.profile.model === report.profile));
    const recovered = await page.evaluate(({ notebookId, query }) => window.nodus.searchResearchNotebook(notebookId, query), { notebookId, query });
    assert(recovered.evidence.some(evidence => evidence.documentId === sourceId));
    assert(traces().filter(trace => trace.type === 'documentary-retrieval').at(-1).retrieval.semantic.length);
    report.checks.nativeFailures.push({ mode, failedRetrieval: result, traces: failed, recovered: true, profileUnchanged: true });
  }
  for (const change of ['model', 'vault']) {
    const before = traces().length; await arm('hold');
    const request = page.evaluate(({ notebookId, query }) => window.nodus.searchResearchNotebook(notebookId, query + ' QA_NATIVE_FAULT'), { notebookId, query });
    // Attach the rejection handler immediately while the request is in flight.
    const response = request.then(value => ({ value }), error => ({ error: error.message }));
    assert(await waitFor(() => app.evaluate(() => globalThis.qaEmbeddingFault.intercepted), { timeoutMs: 30000 }));
    try {
      if (change === 'model') {
        const alternate = report.profile.includes('-512-') ? 'embeddinggemma-2-text-q8-256-v1' : 'embeddinggemma-2-text-q8-512-v1';
        await page.evaluate(model => window.nodus.updateSettings({ embeddingModel: model }), alternate);
      } else {
        await page.evaluate(id => window.nodus.switchVault(id), report.vaults.find(vault => vault.mode === 'manual').id);
        await page.evaluate(id => window.nodus.switchVault(id), report.vaults.find(vault => vault.mode === 'auto').id);
      }
      await release(); const outcome = await response;
      const stale = traces().slice(before).filter(trace => trace.type === 'documentary-retrieval');
      assert(outcome.error || (stale.length && stale.every(trace => !trace.retrieval.semantic.length)), 'stale native vectors are rejected after an in-flight change');
      report.checks.nativeFailures.push({ change, outcome, traces: stale, staleSemanticRejected: true });
    } finally {
      await release();
      await page.evaluate(model => window.nodus.updateSettings({ embeddingModel: model }), report.profile);
    }
  }
}
