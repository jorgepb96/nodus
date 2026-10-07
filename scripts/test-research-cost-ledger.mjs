import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchCostLedger } from './research-cost-ledger.mjs';

test('campaign reservations survive restart and fail closed at the shared seven-dollar boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ledger-test-'));
  try {
    const file = path.join(root, 'cost.json');
    for (const value of [NaN, Infinity, 0, -1, 8.01, 9]) assert.throws(() => new ResearchCostLedger(file, value));
    const ledger = new ResearchCostLedger(file);
    const call = { provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 3 };
    assert.throws(() => ledger.reserve({ ...call, model: 'unapproved' }));
    const first = ledger.reserve(call);
    const second = new ResearchCostLedger(file).reserve(call);
    assert.notEqual(first, second);
    assert.equal(ledger.read().limitUsd, 7, 'a new campaign ledger records the seven-dollar ceiling');
    assert.throws(() => ledger.reserve({ ...call, maximumUsd: 1 }), /exhausted/);
    assert.throws(() => ledger.settle(first, { actualUsd: 0.5, inputTokens: -1, outputTokens: 10 }));
    const usage = { actualUsd: 0.5, inputTokens: 1000, outputTokens: 100 };
    ledger.settle(first, usage);
    ledger.settle(first, usage);
    assert.throws(() => ledger.settle(first, { ...usage, actualUsd: 0.1 }), /Conflicting/);
    assert.throws(() => ledger.settle(second, { ...usage, actualUsd: 4 }));
    ledger.reserve({ provider: 'openrouter', model: 'baai/bge-m3', maximumUsd: 0.25 });
    assert.equal(ledger.read().calls[1].actualUsd, null, 'unknown or failed calls keep their entire reservation');
    const corrupted = ledger.read();
    corrupted.calls[0].actualUsd = -10;
    fs.writeFileSync(file, JSON.stringify(corrupted));
    assert.throws(() => ledger.reserve(call), /Invalid research ledger/);
    assert.equal(fs.existsSync(`${file}.lock`), false);
    // An existing campaign keeps its own, lower authorization until its file says otherwise,
    // and no file may authorize more than the ceiling.
    fs.writeFileSync(file, JSON.stringify({ limitUsd: 5, calls: [{ id: 'spent', provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 4.5, actualUsd: 4.5 }] }));
    assert.throws(() => ledger.reserve({ ...call, maximumUsd: 0.6 }), /exhausted/);
    fs.writeFileSync(file, JSON.stringify({ limitUsd: 7, calls: [{ id: 'spent', provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 4.5, actualUsd: 4.5 }] }));
    ledger.reserve({ ...call, maximumUsd: 0.6 });
    fs.writeFileSync(file, JSON.stringify({ limitUsd: 8.01, calls: [] }));
    assert.throws(() => ledger.reserve({ ...call, maximumUsd: 0.1 }), /Invalid research ledger/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an explicit eight-dollar campaign preserves every reservation and cannot exceed its authorization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ledger-eight-'));
  try {
    const file = path.join(root, 'cost.json'), ledger = new ResearchCostLedger(file, 8);
    const call = ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 7.9 });
    assert.equal(ledger.read().limitUsd, 8);
    assert.throws(() => ledger.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: .1 }), /exhausted/);
    assert.equal(ledger.read().calls[0].id, call);
    assert.equal(ledger.read().calls[0].actualUsd, null, 'unknown usage is never released to fit another request');
    assert.throws(() => new ResearchCostLedger(file).reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: .01 }), /exhausted/, 'a default caller still uses its lower limit');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
