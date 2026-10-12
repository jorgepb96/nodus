import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const macTests = [
  'scripts/test-calendar-integrations.mjs', 'scripts/test-mac-bundle-name.mjs',
  'scripts/test-research-isolation.mjs', 'scripts/test-unsigned-mac-update.mjs',
  'scripts/test-presenter-multipeer.mjs',
];
export const researchTests = [
  'research-activity', 'research-background-process', 'documentary-store', 'documentary-requests',
  'research-notebooks', 'research-corpus-run', 'research-request-budget', 'documentary-writers',
  'documentary-ocr-deferred', 'documentary-campaigns', 'documentary-automatic-lifecycle',
  'research-actions', 'research-original-read', 'research-zotero-sessions', 'research-claim-audit',
  'research-preflight', 'research-listener',
].map(name => `scripts/test-${name}.mjs`);

export function strictTestSummary(output, status) {
  assert.equal(status, 0, 'Native test process failed');
  const count = name => {
    const values = [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))];
    assert.equal(values.length, 1, `Missing or ambiguous native test summary: ${name}`);
    return Number(values[0][1]);
  };
  assert.ok(count('tests') > 0, 'Native checks executed no tests');
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0, `${name} native tests`);
  assert.equal(count('pass'), count('tests'), 'Not every native test passed');
}

export function runStrictTests(files, options = {}) {
  assert.ok(files.length > 0 && new Set(files).size === files.length, 'Invalid native test inventory');
  const env = { ...process.env, ...options.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter=tap', ...files], {
    cwd: options.cwd, env, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  if (!options.quiet) { process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); }
  if (result.error) throw result.error;
  strictTestSummary(result.stdout || '', result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'platform' || mode === 'macos' || mode === 'python') {
    if (mode === 'macos') assert.equal(process.platform, 'darwin');
    runStrictTests([
      ...(mode !== 'python' && process.platform === 'darwin' ? macTests : []),
      ...(mode !== 'macos' ? ['scripts/test-capability-python-runtime.mjs'] : []),
    ]);
  } else {
    assert.equal(mode, 'research', 'Unknown native check mode');
    const run = (script, args = [], options = {}) => execFileSync(process.execPath, [script, ...args],
      { stdio: 'inherit', ...options });
    run('scripts/prepare-zotero-mcp.mjs');
    run('scripts/verify-managed-zotero-mcp.mjs', ['--disposable-ci']);
    run('scripts/verify-managed-searxng.mjs', ['--disposable-ci']);
    const lifecycle = run('scripts/verify-research-runtime-lifecycle.mjs', ['--disposable-ci'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    fs.writeFileSync('research-runtime-lifecycle.json', lifecycle);
    process.stdout.write(lifecycle);
    if (!process.argv.includes('--no-synthetic')) runStrictTests(researchTests);
    if (process.platform === 'darwin') run('scripts/e2e-research-isolated.mjs', ['--notebooks', '--pdf', '--activity']);
  }
}
