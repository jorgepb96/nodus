import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadGate() {
  const output = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-gate-'));
  const bundle = path.join(output, 'gate.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/ai/aiRequestGate.ts')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const module = await import(pathToFileURL(bundle));
  return { Gate: module.AiRequestGate, Scheduler: module.AiRequestScheduler, output };
}

const descriptor = (overrides = {}) => ({
  provider: 'gemini', model: 'gemini-2.5-flash-lite', credentialScope: 'opaque-project-a',
  requestClass: 'background', ...overrides,
});

test('the AI request gate enforces the configured process-wide limit', async () => {
  const { Gate, output } = await loadGate();
  try {
    let active = 0;
    let peak = 0;
    const releases = [];
    const gate = new Gate(() => 2);
    const jobs = Array.from({ length: 5 }, (_, index) => gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return index;
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(peak, 2);
    while (releases.length) {
      releases.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
    assert.equal(peak, 2);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('a request aborted while waiting never occupies a provider slot', async () => {
  const { Gate, output } = await loadGate();
  try {
    const gate = new Gate(() => 1);
    let releaseFirst;
    const first = gate.run(() => new Promise((resolve) => { releaseFirst = resolve; }));
    const controller = new AbortController();
    let ran = false;
    const waiting = gate.run(async () => { ran = true; }, controller.signal);
    controller.abort(new Error('cancelled'));
    await assert.rejects(waiting, /cancelled/);
    assert.equal(ran, false);
    releaseFirst();
    await first;
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('queued work never reevaluates policy from a later async context', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let policyContextOpen = true;
    let releaseFirst;
    const scheduler = new Scheduler({
      globalLimit: 1,
      policyFor: () => {
        assert.equal(policyContextOpen, true, 'policy was read after its originating vault context closed');
        return { mode: 'manual', initial: 1, maximum: 1, manualLimit: 1 };
      },
    });
    const first = scheduler.run(descriptor({ jobId: 'first-vault-task' }), () =>
      new Promise((resolve) => { releaseFirst = resolve; }));
    const second = scheduler.run(descriptor({ jobId: 'queued-vault-task' }), async () => 'second');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof releaseFirst, 'function');
    policyContextOpen = false;
    releaseFirst('first');
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('automatic mode halves immediately on 429 but never on a caller 400', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let now = 180_000;
    const scheduler = new Scheduler({
      now: () => now,
      random: () => 0,
      policyFor: () => ({ mode: 'automatic', initial: 4, maximum: 8, manualLimit: 1 }),
    });
    const rateError = Object.assign(new Error('rate'), { status: 429, headers: { 'retry-after': '2' } });
    await assert.rejects(scheduler.run(descriptor(), async () => { throw rateError; }), /rate/);
    let snapshot = scheduler.snapshots()[0];
    assert.equal(snapshot.currentLimit, 2);
    assert.equal(snapshot.cooldownUntil, 182_000);
    assert.equal(snapshot.lastChangeReason, 'rate-limited-429');

    now = 182_001;
    const badRequest = Object.assign(new Error('invalid schema'), { status: 400 });
    await assert.rejects(scheduler.run(descriptor(), async () => { throw badRequest; }), /invalid schema/);
    snapshot = scheduler.snapshots()[0];
    assert.equal(snapshot.currentLimit, 2, 'a deterministic caller/schema error must not reduce capacity');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('two related transient failures reduce once while one timeout does not', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let now = 200_000;
    const scheduler = new Scheduler({
      now: () => now,
      policyFor: () => ({ mode: 'automatic', initial: 4, maximum: 8, manualLimit: 1 }),
    });
    const unavailable = () => Object.assign(new Error('unavailable'), { status: 503 });
    await assert.rejects(scheduler.run(descriptor(), async () => { throw unavailable(); }));
    assert.equal(scheduler.snapshots()[0].currentLimit, 4);
    now += 10_000;
    await assert.rejects(scheduler.run(descriptor(), async () => { throw unavailable(); }));
    assert.equal(scheduler.snapshots()[0].currentLimit, 2);
    assert.equal(scheduler.snapshots()[0].lastChangeReason, 'repeated-503-error');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('manual mode follows a changed limit without retaining adaptive cooldown', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let limit = 1;
    const scheduler = new Scheduler({
      policyFor: () => ({ mode: 'manual', initial: limit, maximum: limit, manualLimit: limit }),
    });
    await scheduler.run(descriptor(), async () => 'first');
    assert.equal(scheduler.snapshots()[0].currentLimit, 1);
    limit = 8;
    await scheduler.run(descriptor(), async () => 'second');
    assert.equal(scheduler.snapshots()[0].currentLimit, 8);
    assert.equal(scheduler.snapshots()[0].maximumLimit, 8);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('switching to manual one immediately serializes work that is still queued', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let mode = 'automatic';
    const scheduler = new Scheduler({
      globalLimit: 4,
      policyFor: () => mode === 'automatic'
        ? { mode: 'automatic', initial: 4, maximum: 8, manualLimit: 1 }
        : { mode: 'manual', initial: 1, maximum: 1, manualLimit: 1 },
    });
    const started = [];
    const releases = [];
    const jobs = Array.from({ length: 6 }, (_, index) => scheduler.run(descriptor({ jobId: `rollback-${index}` }), () =>
      new Promise((resolve) => {
        started.push(index);
        releases.push(resolve);
      })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2, 3]);

    mode = 'manual';
    scheduler.reconfigure();
    assert.equal(scheduler.snapshots()[0].currentLimit, 1);
    assert.equal(scheduler.snapshots()[0].lastChangeReason, 'manual');

    for (const release of releases.splice(0, 4)) release('done');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2, 3, 4], 'only one queued request starts after rollback');
    releases.shift()('done');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
    releases.shift()('done');
    await Promise.all(jobs);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('automatic mode grows only after sustained healthy saturation', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let now = 0;
    const scheduler = new Scheduler({
      now: () => now,
      policyFor: () => ({ mode: 'automatic', initial: 1, maximum: 4, manualLimit: 1 }),
    });
    const jobs = Array.from({ length: 25 }, () => scheduler.run(descriptor(), async () => {
      now += 7_000;
      return now;
    }));
    await Promise.all(jobs);
    assert.equal(scheduler.snapshots()[0].currentLimit, 2, 'one additive increase after >=20 healthy completions');
    assert.equal(scheduler.snapshots()[0].lastChangeReason, 'healthy-saturated-queue');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('known RPM/TPM headers are reserved before dispatch and release on reset', { timeout: 10_000 }, async (t) => {
  const { Scheduler, output } = await loadGate();
  try {
    const scheduler = new Scheduler({
      policyFor: () => ({ mode: 'manual', initial: 4, maximum: 4, manualLimit: 4 }),
    });
    const request = descriptor({ estimatedInputTokens: 40, estimatedOutputTokens: 10 });
    scheduler.observeQuota(request, {
      'x-ratelimit-remaining-requests': '1',
      'x-ratelimit-remaining-tokens': '55',
      'x-ratelimit-reset-requests': '0.05s',
    });
    const started = [];
    const beganAt = Date.now();
    // The scheduler unrefs its quota timer. Keep this test alive until its jobs settle,
    // rather than guessing a wall-clock allowance that expires under CI load.
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    const jobs = [0, 1].map((index) => scheduler.run(request, async () => {
      started.push({ index, at: Date.now() - beganAt });
      return index;
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduler.snapshots()[0].lastChangeReason, 'request-quota-reserved');
    assert.deepEqual(await Promise.all(jobs), [0, 1]);
    clearInterval(keepAlive);
    assert.deepEqual(started.map((entry) => entry.index), [0, 1]);
    assert.ok(started[1].at >= 35, `second request started before the quota reset (${started[1].at}ms)`);
    assert.equal(scheduler.snapshots()[0].lastChangeReason, 'manual');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('529 halves immediately while authentication and authorization errors never tune capacity', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let now = 300_000;
    const scheduler = new Scheduler({
      now: () => now,
      random: () => 0,
      policyFor: () => ({ mode: 'automatic', initial: 8, maximum: 8, manualLimit: 1 }),
    });
    await assert.rejects(scheduler.run(descriptor(), async () => {
      throw Object.assign(new Error('overloaded'), { status: 529 });
    }), /overloaded/);
    assert.equal(scheduler.snapshots()[0].currentLimit, 4);
    assert.equal(scheduler.snapshots()[0].lastChangeReason, 'provider-overloaded-529');

    now += 3_001;
    for (const status of [401, 403]) {
      await assert.rejects(scheduler.run(descriptor(), async () => {
        throw Object.assign(new Error(`auth-${status}`), { status });
      }), new RegExp(`auth-${status}`));
      assert.equal(scheduler.snapshots()[0].currentLimit, 4, `${status} must not reduce concurrency`);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('mixed failures never leak slots or exceed either scheduler limit', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    const scheduler = new Scheduler({
      globalLimit: 3,
      policyFor: () => ({ mode: 'manual', initial: 3, maximum: 3, manualLimit: 3 }),
    });
    let active = 0;
    let peak = 0;
    const runWave = async (count, failEvery) => Promise.allSettled(Array.from({ length: count }, (_, index) =>
      scheduler.run(descriptor({ jobId: `property-${failEvery}-${index}` }), async () => {
        active += 1;
        peak = Math.max(peak, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, index % 4));
          if (failEvery && index % failEvery === 0) throw Object.assign(new Error('synthetic'), { status: 400 });
          return index;
        } finally {
          active -= 1;
        }
      })));

    const first = await runWave(80, 5);
    assert.equal(first.filter((result) => result.status === 'rejected').length, 16);
    assert.equal(active, 0);
    assert.ok(peak <= 3, `observed ${peak} active requests with a limit of 3`);

    const second = await runWave(24, 0);
    assert.ok(second.every((result) => result.status === 'fulfilled'), 'capacity is fully reusable after failures');
    assert.equal(active, 0);
    assert.equal(scheduler.snapshots()[0].queued, 0);
    assert.equal(scheduler.snapshots()[0].active, 0);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('model snapshots report aggregate model capacity across credential scopes', async () => {
  const { Scheduler, output } = await loadGate();
  try {
    let now = 0;
    let latest = [];
    const scheduler = new Scheduler({
      globalLimit: 12,
      now: () => now,
      policyFor: () => ({ mode: 'automatic', initial: 4, maximum: 8, manualLimit: 1 }),
      onSnapshot: (snapshots) => { latest = snapshots; },
    });
    const descriptors = ['credential-a', 'credential-b'].map((credentialScope) => ({
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      credentialScope,
      requestClass: 'background',
    }));
    // The model sees twenty healthy completions and grows to five, while each
    // individual credential has seen only ten and correctly remains at four.
    await Promise.all(Array.from({ length: 25 }, (_, index) => scheduler.run(
      descriptors[index % descriptors.length],
      async () => {
        now += 7_000;
        return index;
      },
    )));
    assert.equal(latest[0]?.currentLimit, 5);

    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const work = Array.from({ length: 5 }, (_, index) => scheduler.run(
      descriptors[index % descriptors.length],
      () => blocked,
    ));
    await new Promise((resolve) => setImmediate(resolve));
    const snapshot = latest.find((entry) => entry.model === 'gemini-2.5-flash-lite');
    assert.equal(snapshot?.active, 5);
    assert.equal(snapshot?.currentLimit, 5);
    assert.ok(snapshot.active <= snapshot.currentLimit);
    release();
    await Promise.all(work);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
