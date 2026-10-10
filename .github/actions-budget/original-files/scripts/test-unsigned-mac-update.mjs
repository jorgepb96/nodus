// The unsigned-macOS update path: staged, then never installed.
//
// Older and local ad-hoc builds replace their own .app with an external helper
// instead of handing off to Squirrel.Mac. The helper waits for the app to exit
// before touching the bundle — correct, because swapping a running bundle breaks
// it — and that wait was unbounded. When app.quit() failed to terminate the
// process (finishing a download makes electron-updater start a Squirrel proxy
// server and call setFeedURL regardless of autoInstallOnAppQuit), the helper
// waited forever, the user force quit, the helper died with the app, and nothing
// was installed. Reopening staged another doomed helper. No error was ever shown
// because the state file the helper writes was never read.
//
// This exercises the REAL helper script the app generates, against fake bundles.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
const source = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');

/** Rebuild the helper exactly as unsignedMacUpdateHelperScript() emits it, so the
 *  test runs the shipped script rather than a paraphrase of it. */
function helperScript() {
  const body = source.match(/function unsignedMacUpdateHelperScript\(\): string \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, 'unsignedMacUpdateHelperScript() not found in electron/main.ts');
  const lines = [...body.matchAll(/^\s{4}(['"])((?:\\.|(?!\1).)*)\1,$/gm)]
    .map((m) => JSON.parse(m[1] === "'" ? `"${m[2].replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : `"${m[2]}"`));
  assert.ok(lines.length > 10, `expected the helper body, parsed ${lines.length} lines`);
  return lines.join('\n');
}

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for: ${label}`);
};

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-unsigned-update-'));
try {
  const script = helperScript();

  // ── The helper survives the signals a Force Quit sprays at descendants ──────
  // This is what made every force quit lose the update: the helper died mid-wait.
  assert.match(script, /trap '' TERM HUP INT/, 'the helper ignores terminating signals');
  assert.match(script, /WAITED/, 'the helper bounds its wait instead of hanging forever');
  assert.match(script, /\/bin\/mv "\$TARGET" "\$BACKUP"/, 'the running bundle is displaced before the new one lands');
  assert.match(script, /\/bin\/rm -rf "\$BACKUP"/, 'the displaced bundle is removed after the swap');

  const scriptPath = path.join(root, 'helper.sh');
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });

  // Fake bundles: a "new" Nodus.app zipped the way the release ships it, and an
  // "old" one in place. Only the swap matters here, not the payload.
  const stage = path.join(root, 'stage');
  fs.mkdirSync(path.join(stage, 'Nodus.app', 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'Nodus.app', 'Contents', 'version'), 'NEW');
  const zip = path.join(root, 'Nodus-mac-arm64.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(stage, 'Nodus.app'), zip]);

  const target = path.join(root, 'Nodus.app');
  fs.mkdirSync(path.join(target, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(target, 'Contents', 'version'), 'OLD');
  const statePath = path.join(root, 'update-install-state.json');

  // A stand-in for the app: it must be gone before the helper touches anything.
  const victim = spawn('/bin/sh', ['-c', 'while true; do sleep 0.1; done'], { stdio: 'ignore' });
  const helper = spawn('/bin/sh', [scriptPath, String(victim.pid), zip, target, statePath], {
    detached: true,
    stdio: 'ignore',
    // `open -n` would launch a bundle that is not a real app; harmless but noisy.
    env: { ...process.env, PATH: process.env.PATH },
  });
  helper.unref();

  // While the app lives, the bundle must not be touched.
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8'), 'OLD',
    'the helper must not replace the bundle while the app is still running');

  // Force Quit: SIGKILL the app, and SIGTERM the helper the way macOS sprays the
  // descendants of a force-quit app. The helper must survive and finish the job.
  try { process.kill(helper.pid, 'SIGTERM'); } catch { /* already reaped */ }
  victim.kill('SIGKILL');

  // `printf > file` is not atomic, so a read can land on an empty file.
  const readState = () => {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
  };
  await waitFor(
    async () => ['installed', 'failed'].includes(readState()?.status),
    15_000,
    'the helper to report an outcome',
  );
  assert.equal(readState()?.status, 'installed', `the helper reported: ${JSON.stringify(readState())}`);
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8'), 'NEW',
    'the new bundle is in place after a force quit');
  // The displaced bundle is only a rollback until the swap lands: the helper
  // unregisters and removes it so LaunchServices cannot show a second Dock icon.
  // Reading it right after `installed` raced the helper's own cleanup, which is
  // why this test failed intermittently. Assert the shipped behavior instead:
  // the old bundle was moved aside (checked in the script below) and is removed.
  await waitFor(
    async () => !fs.existsSync(`${target}.previous`),
    15_000,
    'the displaced bundle to be removed after the swap',
  );
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8'), 'NEW',
    'removing the displaced bundle does not disturb the installed one');

  // ── The quit is not left to chance ─────────────────────────────────────────
  assert.match(source, /function quitForUpdate\(\): void \{[\s\S]*?app\.quit\(\)[\s\S]*?app\.exit\(0\)/,
    'the update quit falls back to app.exit() when app.quit() does not terminate');
  assert.match(source, /installUnsignedMacUpdate[\s\S]*?quitForUpdate\(\);/,
    'the unsigned installer uses the guarded quit');

  // ── A stalled install is reported instead of silently retried ──────────────
  assert.match(source, /reportInterruptedUpdateInstall/, 'startup reads the install state file');
  const reporter = source.match(/async function reportInterruptedUpdateInstall[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(reporter, /status === 'installed'/, 'a successful install is not reported as a failure');
  assert.match(reporter, /state\.version === app\.getVersion\(\)/, 'an install that did land is not reported as a failure');
  assert.match(reporter, /status: 'error'/, 'an interrupted install surfaces as an update error');

  console.log('Unsigned macOS update install test passed');
} finally {
  // Anything the helper relaunched is a fake bundle; nothing to clean but ours.
  await rm(root, { recursive: true, force: true });
  await execFileAsync('/bin/sh', ['-c', 'true']).catch(() => {});
}
