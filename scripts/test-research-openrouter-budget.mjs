import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimOpenRouterBudget, closeOpenRouterBudget } from './research-openrouter-budget.mjs';

test('one authorization retains unknown costs across attempts and blocks crash resets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-budget-regression-'));
  try {
    const authorization = path.join(root, 'authorization.json');
    fs.writeFileSync(path.join(root, 'prior.json'), JSON.stringify({ cost: { committedUsd: 0.00211523 } }));
    fs.writeFileSync(authorization, JSON.stringify({ format: 'research-openrouter-authorization/1', limitUsd: 0.5,
      oldDeepSeekCampaignReopened: false, priorAttempts: [{ report: 'prior.json', committedUsd: 0.00211523 }] }));
    const first = claimOpenRouterBudget(root, authorization, path.join(root, 'first'), 'isolated-root-1');
    assert.equal(first.limitUsd, 0.49788477);
    assert.throws(() => claimOpenRouterBudget(root, authorization, path.join(root, 'second'), 'isolated-root-2'), /already active/);
    assert.throws(() => closeOpenRouterBudget(authorization, 'wrong-root', 0), /Invalid/);
    fs.mkdirSync(path.join(root, 'first'));
    fs.writeFileSync(path.join(root, 'first/campaign.json'), JSON.stringify({ cost: { committedUsd: 0.2 } }));
    closeOpenRouterBudget(authorization, 'isolated-root-1', 0.2);
    const second = claimOpenRouterBudget(root, authorization, path.join(root, 'second'), 'isolated-root-2');
    assert.ok(Math.abs(second.limitUsd - 0.29788477) < 1e-9);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stopped credential access blocks a new attempt without changing remaining authorization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-budget-stopped-'));
  try {
    const authorization = path.join(root, 'authorization.json');
    const record = { format: 'research-openrouter-authorization/1', limitUsd: 0.5,
      oldDeepSeekCampaignReopened: false, credentialAccessStoppedByUser: true,
      priorAttempts: [], remainingUsd: 0.5, state: 'closed' };
    fs.writeFileSync(authorization, JSON.stringify(record));
    assert.throws(() => claimOpenRouterBudget(root, authorization, path.join(root, 'attempt'), 'isolated-root'), /stopped by the user/);
    assert.deepEqual(JSON.parse(fs.readFileSync(authorization, 'utf8')), record);
    assert.equal(fs.existsSync(`${authorization}.lock`), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
