import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { macTests, researchTests, strictTestSummary, runStrictTests } from './ci-native-checks.mjs';

test('native gates retain all five macOS files and all seventeen Research regression files', () => {
  assert.equal(macTests.length, 5);
  assert.equal(researchTests.length, 17);
  for (const file of [...macTests, ...researchTests]) assert.ok(fs.existsSync(file), file);
});

test('zero tests, omissions, skips, cancellation, todo and nonzero process exit cannot pass', () => {
  const passed = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  strictTestSummary(passed, 0);
  for (const field of ['fail', 'cancelled', 'skipped', 'todo']) assert.throws(() => strictTestSummary(passed.replace(`# ${field} 0`, `# ${field} 1`), 0));
  assert.throws(() => strictTestSummary(passed.replace('# pass 2', '# pass 1'), 0));
  assert.throws(() => strictTestSummary(passed.replaceAll('2', '0'), 0));
  assert.throws(() => strictTestSummary(passed, 1));
  assert.throws(() => strictTestSummary(passed + '# skipped 0\n', 0));
  assert.throws(() => strictTestSummary('truncated output', 0));
});

test('real native child processes must pass without a new platform skip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-native-gate-'));
  const file = 'test-fixture.mjs';
  try {
    fs.writeFileSync(path.join(root, file), "import test from 'node:test'; test('native fixture',()=>{});\n");
    runStrictTests([file], { cwd: root, quiet: true });
    fs.writeFileSync(path.join(root, file), "import test from 'node:test'; test('native fixture',t=>t.skip('missing framework'));\n");
    assert.throws(() => runStrictTests([file], { cwd: root, quiet: true }), /skipped native tests/);
    fs.writeFileSync(path.join(root, file), "import test from 'node:test'; test('native fixture',()=>{throw new Error('native regression')});\n");
    assert.throws(() => runStrictTests([file], { cwd: root, quiet: true }), /process failed/);
    assert.throws(() => runStrictTests([file, file], { cwd: root, quiet: true }), /inventory/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
