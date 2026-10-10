// Tests for the single Deep Research generation lane. The real queue in
// electron/ai/deepResearchQueue.ts has no Electron/DB/AI dependencies (only erased
// type imports), so we bundle just that file with esbuild and drive it with fakes —
// no provider calls, no database, and crucially NOT the running local app instance.
//
// It locks the guarantees that make a *deferred* report safe to queue:
//   • only one report is ever generated at a time, whoever asked for it;
//   • a caller waiting behind others is told how many are ahead;
//   • a queued report survives a vault switch and resumes only against its own corpus;
//   • a report whose vault changed *during* generation is never saved as a draft of
//     the new vault;
//   • a report that cannot be filed is still returned, not thrown away;
//   • both a queued report and the running one can be cancelled without overlap;
//   • one failure does not stall the lane.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-queue-test-'));

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** A report shaped just enough for the lane: it only ever touches `draft`. */
const fakeReport = (objective) => ({ draft: { title: objective, sections: [] } });

try {
  const outfile = path.join(tmp, 'deepResearchQueue.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchQueue.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    logLevel: 'silent',
  });
  const queue = await import(pathToFileURL(outfile).href);

  // ── One lane: two reports never generate at once ───────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = [];
    queue.configureDeepResearchQueue({
      generate: (request) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          gates.push(() => {
            inFlight -= 1;
            resolve(fakeReport(request.objective));
          });
        });
      },
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    const positions = [];
    const first = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'app', save: false });
    const second = queue.runDeepResearchJob({ request: { objective: 'B' }, origin: 'mcp', save: false }, (p) =>
      positions.push(p)
    );

    // `>= 1`, not `=== 1`: if the lane ever let both start, this must reach the
    // assertion below and name the fault, not hang waiting for a count it overshot.
    await waitFor(() => gates.length >= 1, 'the first report to start');
    assert.equal(maxInFlight, 1, 'a second report must not start while one is generating');
    const queued = queue.listDeepResearchJobs().find((job) => job.title === 'B');
    assert.equal(queued.status, 'queued');
    assert.equal(queued.ahead, 1, 'the waiting report knows one is in front of it');
    assert.deepEqual(
      positions.map((p) => p.phase),
      ['queued'],
      'a caller that has to wait is told so'
    );
    assert.match(positions[0].message, /1 informe/);

    gates[0]();
    await first;
    await waitFor(() => gates.length === 2, 'the second report to start');
    gates[1]();
    await second;
    assert.equal(maxInFlight, 1, 'the lane never ran two pipelines at once');
    assert.equal(queue.isDeepResearchLaneBusy(), false);
  }

  // ── Queue-owned UI copy follows all supported report languages ─────────────
  {
    queue.__resetDeepResearchQueueForTest();
    let runningSignal;
    queue.configureDeepResearchQueue({
      generate: (_request, _onProgress, signal) => new Promise((_resolve, reject) => {
        runningSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      saveDraft: () => 'draft-localized',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });
    const running = queue.runDeepResearchJob({ request: { objective: 'running', language: 'es' }, origin: 'app', save: false }).catch((error) => error);
    await waitFor(() => runningSignal instanceof AbortSignal, 'the localization sentinel to start');
    const expected = {
      en: /Queued/, fr: /En attente/, de: /Warteschlange/, pt: /Em fila/, 'pt-BR': /Na fila/, it: /In coda/, tr: /Kuyrukta/,
      'zh-Hans': /排队中/, 'zh-Hant': /排隊中/, vi: /Đang chờ/, ja: /待機中/, ru: /В очереди/, uk: /У черзі/, ko: /대기 중/,
    };
    const queuedJobs = Object.entries(expected).map(([language, marker]) => {
      const record = queue.enqueueDeepResearchJob({ request: { objective: `job-${language}`, language }, origin: 'mcp', save: false });
      const current = queue.getDeepResearchJob(record.id).job;
      assert.match(current.progress.message, marker, `${language} queue progress is native`);
      assert.doesNotMatch(current.progress.message, /En cola|informe.*por delante/i, `${language} queue progress does not leak Spanish`);
      return current;
    });
    for (const record of queuedJobs) queue.cancelDeepResearchJob(record.id);
    const runningId = queue.listDeepResearchJobs().find((job) => job.title === 'running').id;
    queue.cancelDeepResearchJob(runningId);
    await running;
    await waitFor(() => queue.isDeepResearchLaneBusy() === false, 'the localization sentinel to unwind');
  }

  // ── A vault switch parks the job until its own corpus is active again ────────
  {
    queue.__resetDeepResearchQueueForTest();
    let generated = 0;
    let vault = { id: 'v1', name: 'Corpus A' };
    const gates = [];
    queue.configureDeepResearchQueue({
      generate: (request) => {
        generated += 1;
        return new Promise((resolve) => gates.push(() => resolve(fakeReport(request.objective))));
      },
      saveDraft: () => 'draft-1',
      activeVault: () => vault,
      // Flips the vault the moment the first report is filed and before the next one
      // is picked up, so the switch happens exactly while B is still waiting.
      onSettled: (job) => {
        if (job.title === 'A') vault = { id: 'v2', name: 'Corpus B' };
      },
    });

    const running = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'app', save: false });
    const deferred = queue.runDeepResearchJob({ request: { objective: 'B' }, origin: 'mcp', save: false });
    await waitFor(() => gates.length === 1, 'the first report to start');

    gates[0]();
    await running;
    await waitFor(() => queue.listDeepResearchJobs().find((job) => job.title === 'B')?.status === 'queued', 'the deferred report to remain parked');
    assert.equal(generated, 1, 'the deferred report was never generated against the new vault');
    vault = { id: 'v1', name: 'Corpus A' };
    assert.equal(queue.cancelDeepResearchJobsForOtherVaults('v1'), 0, 'the legacy switch hook preserves durable work');
    await waitFor(() => gates.length === 2, 'the parked report to resume in its vault');
    gates[1]();
    assert.equal((await deferred).draft.title, 'B');
    assert.equal(generated, 2);
  }

  // ── Version/approach/model survive queue serialization and completion metadata ─
  {
    queue.__resetDeepResearchQueueForTest();
    const model = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    let seenSectionLimit = null;
    queue.configureDeepResearchQueue({
      generate: (request) => {
        seenSectionLimit = request.sectionLimit;
        return Promise.resolve({
          draft: {
            title: request.objective,
            deepResearchApproach: request.approach,
            deepResearchVersion: request.deepResearchVersion,
            deepResearchStructure: request.sectionLimit === 'single' ? 'single' : 'sectioned',
            generationModel: request.model,
          },
        });
      },
      saveDraft: () => 'draft-approach',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });
    const report = await queue.runDeepResearchJob({
      request: { objective: 'Comparar A y B', approach: 'comparative', deepResearchVersion: 'v1', sectionLimit: 'single', model },
      origin: 'mcp',
      save: true,
    });
    const restored = JSON.parse(JSON.stringify(queue.listDeepResearchJobs()[0]));
    assert.equal(restored.deepResearchApproach, 'comparative');
    assert.equal(restored.deepResearchVersion, 'v1');
    assert.equal(restored.structure, 'single');
    assert.deepEqual(restored.model, model);
    assert.equal(seenSectionLimit, 'single', 'continuous structure survives the queue request boundary');
    assert.equal(report.draft.deepResearchApproach, 'comparative');
    assert.equal(report.draft.deepResearchVersion, 'v1');
    assert.equal(report.draft.deepResearchStructure, 'single');
    assert.deepEqual(report.draft.generationModel, model);
  }

  // ── A vault switch *during* generation must not save into the new vault ─────
  {
    queue.__resetDeepResearchQueueForTest();
    let vault = { id: 'v1', name: 'Corpus A' };
    const saves = [];
    let release;
    queue.configureDeepResearchQueue({
      generate: (request) =>
        new Promise((resolve) => {
          release = () => resolve(fakeReport(request.objective));
        }),
      saveDraft: (input) => {
        saves.push(input);
        return 'draft-1';
      },
      activeVault: () => vault,
    });

    const job = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'mcp', save: true }).catch((e) => e);
    await waitFor(() => typeof release === 'function', 'generation to start');
    vault = { id: 'v2', name: 'Corpus B' };
    release();

    const outcome = await job;
    assert.ok(outcome instanceof Error, 'a report whose vault changed mid-generation must not be handed back as if nothing happened');
    assert.match(outcome.message, /Corpus A/);
    assert.equal(saves.length, 0, 'a finished report is never filed in a vault it was not researched against');
    assert.equal(queue.listDeepResearchJobs()[0].status, 'failed');
  }

  // ── A report that cannot be filed is still a report ────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => {
        throw new Error('disk full');
      },
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    const report = await queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'mcp', save: true });
    assert.equal(report.draft.title, 'A', 'the generation is returned even though it could not be stored');
    const record = queue.listDeepResearchJobs()[0];
    assert.equal(record.status, 'completed');
    assert.equal(record.savedDraftId, null);
    assert.match(record.saveError, /disk full/);
    assert.equal(queue.getDeepResearchJob(record.id).report.draft.title, 'A', 'the report stays readable through the job');
  }

  // ── Cancelling queued and running work ──────────────────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    let runningSignal;
    queue.configureDeepResearchQueue({
      generate: (request, _onProgress, signal) =>
        new Promise((resolve, reject) => {
          runningSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    const running = queue.runDeepResearchJob({ request: { objective: 'A' }, origin: 'app', save: false }).catch((error) => error);
    const waiting = queue.enqueueDeepResearchJob({ request: { objective: 'B' }, origin: 'mcp', save: false });
    await waitFor(() => runningSignal instanceof AbortSignal, 'generation to start');

    const runningId = queue.listDeepResearchJobs().find((job) => job.title === 'A').id;
    assert.equal(queue.cancelDeepResearchJob(waiting.id), true);
    assert.equal(queue.getDeepResearchJob(waiting.id).job.status, 'cancelled');
    assert.equal(queue.cancelDeepResearchJob(waiting.id), false, 'cancelling twice is not a second cancellation');
    assert.equal(queue.cancelDeepResearchJob(runningId), true, 'the visible running report can be removed too');
    assert.equal(runningSignal.aborted, true, 'cancellation reaches the active pipeline');
    assert.equal(queue.isDeepResearchLaneBusy(), true, 'the lane stays occupied while the active pipeline unwinds');

    const outcome = await running;
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, /cancelada/);
    await waitFor(() => queue.isDeepResearchLaneBusy() === false, 'the cancelled pipeline to unwind');
    assert.equal(queue.listDeepResearchJobs().filter((job) => job.status === 'completed').length, 0);
  }

  // ── A failure does not stall the lane ──────────────────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    const changes = [];
    const settled = [];
    queue.configureDeepResearchQueue({
      generate: (request) =>
        request.objective === 'boom' ? Promise.reject(new Error('provider exploded')) : Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
      onChange: (jobs) => changes.push(jobs),
      onSettled: (job) => settled.push(job),
    });

    const failing = queue.runDeepResearchJob({ request: { objective: 'boom' }, origin: 'mcp', save: false });
    const following = queue.runDeepResearchJob({ request: { objective: 'ok' }, origin: 'mcp', save: false });
    await assert.rejects(failing, /provider exploded/);
    const report = await following;
    assert.equal(report.draft.title, 'ok', 'the report behind a failed one still runs');
    assert.deepEqual(
      settled.map((job) => job.status),
      ['failed', 'completed']
    );
    assert.ok(changes.length > 0, 'the lane broadcasts its state so the app window can mirror it');

    assert.equal(queue.clearFinishedDeepResearchJobs(), 2);
    assert.deepEqual(queue.listDeepResearchJobs(), [], 'clearing empties the finished tail');
  }

  // ── Relaunch restores running work as queued and keeps foreign-vault work ───
  {
    queue.__resetDeepResearchQueueForTest();
    let vault = { id: 'v2', name: 'Corpus B' };
    const persisted = [];
    const restored = {
      record: {
        id: 'drj-restored', origin: 'mcp', vaultId: 'v1', vaultName: 'Corpus A', objective: 'Restored', title: 'Restored',
        deepResearchApproach: 'general', model: null, status: 'running', progress: { phase: 'writing', message: 'Writing' },
        error: null, savedDraftId: null, saveError: null, ahead: null, enqueuedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(), finishedAt: null,
      },
      request: { objective: 'Restored', language: 'en' },
      save: false,
      draftTitle: null,
    };
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => 'draft-1',
      activeVault: () => vault,
      load: () => [restored],
      persist: (jobs) => persisted.push(structuredClone(jobs)),
    });

    let parked = queue.getDeepResearchJob('drj-restored').job;
    assert.equal(parked.status, 'queued', 'a process interruption turns running back into recoverable queued work');
    assert.match(parked.progress.message, /Recovered/);
    assert.equal(queue.cancelDeepResearchJobsForOtherVaults('v2'), 0);
    parked = queue.getDeepResearchJob('drj-restored').job;
    assert.equal(parked.status, 'queued', 'opening another vault never deletes the restored request');
    vault = { id: 'v1', name: 'Corpus A' };
    queue.cancelDeepResearchJobsForOtherVaults('v1');
    await waitFor(() => queue.getDeepResearchJob('drj-restored').job.status === 'completed', 'the restored request to finish');
    assert.ok(persisted.some((snapshot) => snapshot.some((job) => job.record.status === 'completed')), 'terminal state is durably checkpointed');
  }

  // ── The finished tail stays bounded ────────────────────────────────────────
  {
    queue.__resetDeepResearchQueueForTest();
    queue.configureDeepResearchQueue({
      generate: (request) => Promise.resolve(fakeReport(request.objective)),
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    for (let i = 0; i < 25; i++) {
      await queue.runDeepResearchJob({ request: { objective: `report ${i}` }, origin: 'mcp', save: false });
    }
    const all = queue.listDeepResearchJobs();
    assert.equal(all.length, 20, 'the lane keeps a bounded history');
    assert.equal(all.filter((job) => queue.getDeepResearchJob(job.id).report !== null).length, 5, 'only the last few reports stay in memory');
    assert.equal(all[all.length - 1].title, 'report 24', 'the newest report is the last one kept');
  }

  // ── The guideline section length travels, and legacy jobs stay auto ───────
  //
  // The lane is where a request stops being renderer state and becomes durable
  // work: an MCP payload, a queued job restored from disk and a request written
  // before the control existed all have to resolve to something the writers can
  // trust, without changing the length of any report queued in the old world.
  {
    queue.__resetDeepResearchQueueForTest();
    const seen = [];
    queue.configureDeepResearchQueue({
      generate: (request) => {
        seen.push({ objective: request.objective, sectionLength: request.sectionLength });
        return Promise.resolve(fakeReport(request.objective));
      },
      saveDraft: () => 'draft-1',
      activeVault: () => ({ id: 'v1', name: 'Corpus' }),
    });

    await queue.runDeepResearchJob({ request: { objective: 'legacy' }, origin: 'app', save: false });
    await queue.runDeepResearchJob({ request: { objective: 'preset', sectionLength: 10_000 }, origin: 'app', save: false });
    await queue.runDeepResearchJob({ request: { objective: 'custom', sectionLength: 7_300 }, origin: 'mcp', save: false });
    // A hostile / mistaken MCP payload must not buy an unbounded generation.
    await queue.runDeepResearchJob({ request: { objective: 'hostile', sectionLength: 900_000 }, origin: 'mcp', save: false });
    await queue.runDeepResearchJob({ request: { objective: 'nonsense', sectionLength: 'muy largo' }, origin: 'mcp', save: false });

    assert.deepEqual(
      seen,
      [
        { objective: 'legacy', sectionLength: 'auto' },
        { objective: 'preset', sectionLength: 10_000 },
        { objective: 'custom', sectionLength: 7_300 },
        { objective: 'hostile', sectionLength: 40_000 },
        { objective: 'nonsense', sectionLength: 'auto' },
      ],
      'the lane normalizes the guideline length once, at the durable boundary',
    );

    const records = queue.listDeepResearchJobs();
    assert.equal(records.find((job) => job.title === 'legacy').sectionLength, 'auto', 'a legacy job reads back as auto');
    assert.equal(records.find((job) => job.title === 'custom').sectionLength, 7_300, 'a queued job carries its length for the UI');
    // Records are serialized to disk and restored: the field has to survive that.
    const restored = JSON.parse(JSON.stringify(records));
    assert.equal(restored.find((job) => job.title === 'preset').sectionLength, 10_000);
  }

  // Mobile requests own their vault across awaits and UI switches, while retaining one lane.
  {
    queue.__resetDeepResearchQueueForTest();
    const owner = new AsyncLocalStorage();
    let uiVault = { id: 'desktop-a', name: 'Desktop A' }, active = 0, maximum = 0;
    const gates = [], saved = [];
    queue.configureDeepResearchQueue({
      activeVault: () => uiVault,
      executionVault: () => owner.getStore() ?? uiVault,
      runMobile: (vault, work) => owner.run(vault, work),
      generate: request => new Promise(resolve => {
        maximum = Math.max(maximum, ++active);
        const vault = owner.getStore(); assert(vault);
        gates.push(() => { active--; resolve(fakeReport(request.objective)); });
      }),
      saveDraft: ({ request }) => { saved.push({ objective: request.objective, vault: owner.getStore().id }); return `saved-${request.objective}`; },
    });
    const b = queue.runDeepResearchJob({ origin: 'mobile', vault: { id: 'mobile-b', name: 'B' }, request: { objective: 'mobile-B' }, save: true });
    const c = queue.runDeepResearchJob({ origin: 'mobile', vault: { id: 'mobile-c', name: 'C' }, request: { objective: 'mobile-C' }, save: true });
    await waitFor(() => gates.length === 1, 'the owned mobile lane');
    uiVault = { id: 'desktop-d', name: 'Desktop D' };
    gates[0](); await b;
    await waitFor(() => gates.length === 2, 'the second mobile vault'); gates[1](); await c;
    assert.deepEqual(saved, [{ objective: 'mobile-B', vault: 'mobile-b' }, { objective: 'mobile-C', vault: 'mobile-c' }]);
    assert.equal(maximum, 1); assert.equal(uiVault.id, 'desktop-d'); assert.equal(queue.isDeepResearchLaneBusy(), false);
  }
  // A running mobile request may already have committed: restore it for review, never regenerate.
  {
    queue.__resetDeepResearchQueueForTest(); let checkpoints = [], executions = 0;
    queue.configureDeepResearchQueue({ activeVault: () => ({ id: 'mobile-vault', name: 'Mobile' }),
      generate: () => new Promise(() => {}), saveDraft: () => 'saved', persist: records => { checkpoints = JSON.parse(JSON.stringify(records)); } });
    queue.enqueueDeepResearchJob({ origin: 'mobile', request: { objective: 'Interrupted mobile request' }, save: true });
    await waitFor(() => checkpoints[0]?.record.status === 'running', 'a running checkpoint');
    queue.__resetDeepResearchQueueForTest();
    queue.configureDeepResearchQueue({ activeVault: () => ({ id: 'mobile-vault', name: 'Mobile' }), load: () => checkpoints,
      generate: async () => { executions++; return fakeReport('repeat'); }, saveDraft: () => 'saved-again' });
    assert.equal(queue.listDeepResearchJobs()[0].status, 'failed'); assert.match(queue.listDeepResearchJobs()[0].error, /Review/);
    assert.equal(executions, 0);
  }

  // A restored queued mobile job waits for recovery of its original Bridge id.
  {
    queue.__resetDeepResearchQueueForTest(); let checkpoints = [];
    const vault = { id: 'mobile-recovery', name: 'Recovery' };
    queue.configureDeepResearchQueue({ activeVault: () => ({ id: 'desktop', name: 'Desktop' }),
      generate: () => new Promise(() => {}), saveDraft: () => 'saved', persist: records => { checkpoints = JSON.parse(JSON.stringify(records)); } });
    const input = { origin: 'mobile', bridgeJobId: 'private-bridge-job', vault, request: { objective: 'Recover once' }, save: true };
    const original = queue.enqueueDeepResearchJob(input);
    const persisted = checkpoints.find(job => job.record.id === original.id); assert.equal(persisted.record.status, 'queued');
    queue.__resetDeepResearchQueueForTest(); let executions = 0;
    queue.configureDeepResearchQueue({ activeVault: () => vault, load: () => [persisted], runMobile: (_vault, work) => work(),
      generate: async () => { executions++; return fakeReport('Recovered'); }, saveDraft: () => 'saved-recovery' });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(executions, 0, 'A disconnected queued request cannot secretly resume');
    const resumed = queue.enqueueDeepResearchJob({ ...input, requireExisting: true }); assert.equal(resumed.id, original.id);
    await waitFor(() => queue.listDeepResearchJobs()[0].status === 'completed', 'one recovered result');
    assert.equal(queue.listDeepResearchJobs()[0].savedDraftId, 'saved-recovery'); assert.equal(executions, 1);
    assert.equal(queue.enqueueDeepResearchJob({ ...input, requireExisting: true }).id, original.id); assert.equal(executions, 1);
    assert.throws(() => queue.enqueueDeepResearchJob({ ...input, bridgeJobId: 'lost-history', requireExisting: true }), /Review/);
    assert.throws(() => queue.enqueueDeepResearchJob({ ...input, vault: { id: 'another-vault', name: 'Other' }, requireExisting: true }), /Review/);
  }
  console.log('deep research queue test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
