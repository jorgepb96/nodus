// SPPS-FIXES-2026-10-17 fix 3, the rule half.
//
// The contract described the legal form of the last statement and never ruled out the illegal one
// the model actually reached for. Measured at
// harness-runs/spps-02-ladder2-program-mode-thinking-none turn 0, which ended with
// `target = apply(M5, named="resin-cleavage")` — a fair reading of "the last statement is the
// target" — and was refused before anything ran. The parser now names the repair
// (routeProgram.ts, the `target` branch of parseStatement); this is the half that gets there first.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-rules-program-target-'));
await build({ entryPoints: ['shared/routeRules.ts'], outfile: path.join(dir, 'rules.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { routeProgramRules } = await import(pathToFileURL(path.join(dir, 'rules.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

test('the contract rules out assigning an operation to target, not just describes the legal form', () => {
  const rules = routeProgramRules().join('\n');
  assert.match(rules, /target = M<n>/, 'the legal form is still given');
  // The prohibition, and the worked repair beside it. Both matter: the model that wrote this had
  // read the legal form and still took the other reading.
  assert.match(rules, /never an operation|not `?target = apply/,
    'the contract says an operation is not assigned to target');
  assert.match(rules, /target = apply/, 'the illegal form is shown, so it is recognisable');
  assert.match(rules, /M6 = apply\(M5[^)]*\)/, 'the two-line repair is spelled out');
});

test('the target clause and the reference clause do not contradict each other', () => {
  // `target` is not an M-reference, so a rule saying every name must be M1..M999 would make the
  // target line itself look illegal. Check the reference rule still scopes itself to references.
  const rules = routeProgramRules();
  const reference = rules.find((rule) => rule.includes('M1 to M999'));
  assert.ok(reference, 'the reference rule is still present');
  assert.match(reference, /A reference is M1 to M999/, 'it is about references, not about every name');
});
