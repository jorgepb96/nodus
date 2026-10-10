import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-bridge-jobs-'));
installRuntimeHooks(directory);
const require = createRequire(import.meta.url);
const { BridgeJobStore, BridgeJobCancelledError } = require('../electron/desktopBridge/jobs.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = { deviceGrant: 'phone-a', vaultId: 'vault-a', domains: ['research-generation'], method: 'researchChat', args: [{ question: 'Audit fixture' }], idempotencyKey: '01234567-89ab-cdef-0123-456789abcdef' };
test('replayed requests execute once and keep the result across restart', async () => {
  let executions = 0;
  const folder = path.join(directory, 'replay');
  const store = new BridgeJobStore(folder, async (_job, emit) => { executions++; emit('progress', 'planning'); return { reportId: 'saved-fixture' }; });
  const accepted = store.submit(input);
  assert.equal(accepted.state, 'accepted');
  assert.equal(store.submit(input).id, accepted.id);
  await tick();
  assert.equal(executions, 1); assert.equal(accepted.state, 'available');
  assert.equal(accepted.events[0].sequence, 1);
  assert.equal(store.get(accepted.id, 'another-phone', 'vault-a'), undefined);
  assert.equal(store.get(accepted.id, 'phone-a', 'another-vault'), undefined);
  const reopened = new BridgeJobStore(folder, async () => { throw new Error('A committed job must not run again'); });
  assert.deepEqual(reopened.submit(input).result, { reportId: 'saved-fixture' });
  assert.throws(() => reopened.submit({ ...input, args: ['different-content'] }), /idempotency_conflict/);
});
test('a Mac restart interrupts unfinished work and does not duplicate it', async () => {
  const folder = path.join(directory, 'interrupted');
  const store = new BridgeJobStore(folder, () => new Promise(() => {}));
  const accepted = store.submit(input); await tick(); assert.equal(accepted.state, 'running');
  let repeats = 0;
  const reopened = new BridgeJobStore(folder, async () => { repeats++; });
  assert.equal(reopened.submit(input).state, 'interrupted'); await tick(); assert.equal(repeats, 0);
});
test('reordered JSON object keys do not repeat a research operation', async () => {
  let executions = 0;
  const store = new BridgeJobStore(path.join(directory, 'canonical'), async () => { executions++; return 'saved'; });
  const first = store.submit({ ...input, args: [{ question: 'audit', options: { model: 'local', language: 'es' } }] });
  const replay = store.submit({ ...input, args: [{ options: { language: 'es', model: 'local' }, question: 'audit' }] });
  assert.equal(replay.id, first.id); await tick(); assert.equal(executions, 1);
});
test('cancellation belongs to the requesting device and stops its engine', async () => {
  const store = new BridgeJobStore(path.join(directory, 'cancel'), (_job, _emit, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
  const job = store.submit(input); await tick();
  assert.equal(store.cancel(job.id, 'another-phone', 'vault-a'), undefined);
  assert.equal(job.state, 'running'); store.cancel(job.id, 'phone-a', 'vault-a'); await tick(); assert.equal(job.state, 'cancelled');
});
test('shared queue cancellation persists as cancelled and a provider error remains failed', async () => {
  for (const [name, error, expected] of [
    ['queue-cancel', new BridgeJobCancelledError('Generación cancelada por el usuario.'), 'cancelled'],
    ['provider-failure', new Error('Provider disconnected'), 'failed'],
  ]) {
    const folder = path.join(directory, name);
    const store = new BridgeJobStore(folder, async () => { throw error; });
    const job = store.submit({ ...input, method: 'enqueueDeepResearchJob' }); await tick();
    assert.equal(job.state, expected);
    const restored = new BridgeJobStore(folder, async () => assert.fail('A terminal job must not execute again'));
    assert.equal(restored.get(job.id, input.deviceGrant, input.vaultId).state, expected);
  }
});
test('long streams append progress once and recover every event after restart', async () => {
  const folder = path.join(directory, 'stream');
  const store = new BridgeJobStore(folder, async (_job, emit) => {
    for (let index = 0; index < 2_000; index++) emit('delta', `${index}:${'a'.repeat(200)}`);
    return { saved: true };
  });
  const job = store.submit(input); await tick();
  assert.equal(job.state, 'available');
  assert(fs.statSync(path.join(folder, `${job.id}.json`)).size < 2_000, 'Snapshots must not repeatedly rewrite the entire stream');
  assert.equal(fs.statSync(path.join(folder, `${job.id}.events.jsonl`)).mode & 0o777, 0o600);
  const restored = new BridgeJobStore(folder, async () => assert.fail('Saved work must not replay')).get(job.id, input.deviceGrant, input.vaultId);
  assert.deepEqual(restored.events, job.events);
  assert.equal(restored.nextSequence, 2_001);
});
test('legacy snapshots migrate progress before updating their state', () => {
  const folder = path.join(directory, 'legacy'); fs.mkdirSync(folder);
  const legacy = { ...input, id: '11111111-1111-4111-8111-111111111111', payloadHash: 'legacy', state: 'running', createdAt: '2026-10-08', updatedAt: '2026-10-08', events: [{ sequence: 1, channel: 'delta', args: ['preserved'] }], nextSequence: 2 };
  fs.writeFileSync(path.join(folder, `${legacy.id}.json`), JSON.stringify(legacy));
  const restored = new BridgeJobStore(folder, async () => {}).get(legacy.id, input.deviceGrant, input.vaultId);
  assert.equal(restored.state, 'interrupted'); assert.deepEqual(restored.events, legacy.events);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, `${legacy.id}.json`))).events.length, 0);
});
test('research recovery uses the original Bridge identity instead of creating another request', async () => {
  const folder = path.join(directory, 'research-recovery');
  const research = { ...input, method: 'enqueueDeepResearchJob' };
  const store = new BridgeJobStore(folder, (job, emit) => {
    emit('mobile:deepResearch:progress', { id: 'owned-lane', bridgeJobId: job.id, status: 'queued' });
    return new Promise(() => {});
  });
  const original = store.submit(research); await tick();
  let observed;
  const reopened = new BridgeJobStore(folder, async job => { observed = job; return { savedDraftId: 'saved-once' }; });
  const recovered = reopened.submit(research); assert.equal(recovered.id, original.id); await tick();
  assert.equal(observed.id, original.id); assert.equal(observed.mayHaveStarted, true);
  assert.equal(recovered.state, 'available'); assert.equal(recovered.result.savedDraftId, 'saved-once');
});
test('research recovery repairs a torn progress append before saving new events', async () => {
  for (const tail of ['{"sequence":2,"channel":', '{"sequence":2,"channel":"delta","args":["completo: ñ"]}']) {
    const folder = path.join(directory, `torn-${tail.length}`);
    const research = { ...input, method: 'enqueueDeepResearchJob' };
    const store = new BridgeJobStore(folder, (_job, emit) => {
      emit('delta', 'preserved'); return new Promise(() => {});
    });
    const original = store.submit(research); await tick();
    fs.appendFileSync(path.join(folder, `${original.id}.events.jsonl`), tail);
    const reopened = new BridgeJobStore(folder, async (_job, emit) => { emit('delta', 'recovered'); return { saved: true }; });
    reopened.submit(research); await tick();
    const restored = new BridgeJobStore(folder, async () => assert.fail('Saved work must not replay')).get(original.id, input.deviceGrant, input.vaultId);
    assert.equal(restored.state, 'available');
    assert.equal(restored.events.at(-1).args[0], 'recovered');
    assert.equal(restored.events.length, tail.endsWith('}') ? 3 : 2);
  }
});
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
