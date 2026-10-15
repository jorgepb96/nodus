import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deepseekUsageUpperBound } from './research-deepseek-tariff.mjs';
import { reconcileResearchTariff } from './reconcile-research-tariff.mjs';
import { createResearchTestRoot } from './research-isolation.mjs';
import { ResearchCostLedger } from './research-cost-ledger.mjs';

test('tariff accounting bounds the entire interval and fails closed outside verified dates', () => {
  const cost = (start, end = start) => deepseekUsageUpperBound(1000000, 1000000, start, end).usd;
  assert.equal(cost('2026-10-07T20:00:00Z'), .75);
  assert.equal(cost('2026-10-03T02:00:00Z'), .75, 'weekend hours are off-peak');
  assert.equal(cost('2026-10-07T02:00:00Z'), 1.5);
  assert.equal(cost('2026-10-07T06:00:00Z'), 1.5);
  assert.equal(cost('2026-10-07T04:00:00Z'), .75);
  assert.equal(cost('2026-10-07T00:59:59Z', '2026-10-07T01:00:01Z'), 1.5);
  assert.equal(cost('2026-10-07T03:59:59Z', '2026-10-07T04:00:01Z'), 1.5);
  assert.equal(cost('2026-10-06T23:00:00Z', '2026-10-07T11:00:00Z'), 1.5);
  assert.equal(cost('2026-10-07T20:00:00'), 1.5, 'an unspecified timezone cannot justify a discount');
  for (const [start, end] of [['invalid', 'invalid'], ['2026-10-08T20:00:00Z', '2026-10-08T20:00:01Z'], ['2026-09-01T20:00:00Z', '2026-09-01T20:00:01Z'], ['2026-10-07T20:01:00Z', '2026-10-07T20:00:00Z']]) assert.equal(cost(start, end), 1.5);
  assert.throws(() => deepseekUsageUpperBound(-1, 1, '', ''));
});

test('reconciliation preserves cap, calls, unknown reservations, invoice costs and original evidence', () => {
  const root = createResearchTestRoot();
  try {
    const file = path.join(root, 'artifacts/cost-ledger.json');
    const ledger = new ResearchCostLedger(file, 5);
    const id = ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 2 });
    ledger.settle(id, { actualUsd: 1.5, inputTokens: 1000000, outputTokens: 1000000 });
    const known = ledger.read(); known.calls[0].reservedAt = '2026-10-07T20:00:00Z'; known.calls[0].settledAt = '2026-10-07T20:01:00Z';
    fs.writeFileSync(file, JSON.stringify(known));
    const unknown = ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: .3 });
    const invoice = ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: .4 });
    ledger.settle(invoice, { actualUsd: .2, inputTokens: 1000, outputTokens: 100 });
    fs.writeFileSync(path.join(root, 'artifacts/provider-metrics.jsonl'), [
      { reservation: id, accounting: 'peak_price_upper_bound', accountedUsd: 1.5, inputTokens: 1000000, outputTokens: 1000000 },
      { reservation: invoice, accounting: 'provider_cost', accountedUsd: .2, inputTokens: 1000, outputTokens: 100 },
    ].map(JSON.stringify).join('\n'));
    const before = fs.readFileSync(file), report = reconcileResearchTariff(root), after = ledger.read();
    assert.equal(report.changes.length, 1); assert.equal(report.limitUsd, 5); assert.equal(report.calls, 3);
    assert.deepEqual(after.calls.map(call => call.id), JSON.parse(before).calls.map(call => call.id));
    assert.equal(after.calls[0].actualUsd, .75); assert.equal(after.calls[0].accountingReconciliation.originalAccountedUsd, 1.5);
    assert.equal(after.calls.find(call => call.id === unknown).actualUsd, null);
    assert.equal(after.calls.find(call => call.id === unknown).maximumUsd, .3);
    assert.equal(after.calls.find(call => call.id === invoice).actualUsd, .2);
    assert.deepEqual(fs.readFileSync(path.join(root, 'artifacts', report.backup)), before);
    assert.equal(reconcileResearchTariff(root).changes.length, 0, 'repeat does not apply the discount again');
    assert.throws(() => ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 4 }), /exhausted/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('mismatched accounting evidence rejects reconciliation without changing the ledger', () => {
  const root = createResearchTestRoot();
  try {
    const file = path.join(root, 'artifacts/cost-ledger.json'), ledger = new ResearchCostLedger(file, 5);
    const id = ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 1 });
    ledger.settle(id, { actualUsd: .1, inputTokens: 10, outputTokens: 5 });
    fs.writeFileSync(path.join(root, 'artifacts/provider-metrics.jsonl'), JSON.stringify({ reservation: id, accounting: 'peak_price_upper_bound', accountedUsd: .1, inputTokens: 999, outputTokens: 5 }));
    const before = fs.readFileSync(file);
    assert.throws(() => reconcileResearchTariff(root));
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
