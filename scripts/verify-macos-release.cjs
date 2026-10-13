#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyMacApp } = require('./verify-macos-code-signing.cjs');

function fail(message) {
  throw new Error(`[macOS artifact verification] ${message}`);
}

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    fail(`${file} ${args.join(' ')} failed\n${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim());
  }
}

function findApp(directory) {
  const direct = path.join(directory, 'Nodus.app');
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const found = findApp(path.join(directory, entry.name));
    if (found) return found;
  }
  return null;
}

function assertSameApp(candidate, expected, label) {
  const verified = verifyMacApp(candidate, { verifyEveryComponent: false });
  if (verified.teamId !== expected.teamId || verified.cdHash !== expected.cdHash) {
    fail(`${label} does not contain the exact signed Nodus.app that was verified before packaging`);
  }
}

const SUPPORTED_ARCHITECTURES = ['arm64', 'x64'];
const DETACH_ATTEMPTS = 5;

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isMounted(mountPoint) {
  // mount(8) prints the resolved path: /private/var/... for a /var/... mount point.
  let resolved = mountPoint;
  try { resolved = realpathSync(mountPoint); } catch { return false; }
  const lines = run('/sbin/mount', []).split('\n');
  return [mountPoint, resolved].some((candidate) => lines.some((line) => line.includes(` on ${candidate} (`)));
}

// hdiutil can report a failed detach while the volume is in fact going away
// (the system is still scanning the app that was just verified), and the
// -force retry then fails with "No such file or directory" because there is
// nothing left to detach. That aborted the v5.9.0 build after every signing
// check had passed. Whether the volume is still mounted is the only answer
// that matters, so ask that instead of trusting either exit code.
function detachDiskImage(mountPoint, {
  detach = (args) => run('/usr/bin/hdiutil', args),
  mounted = isMounted,
  wait = pause,
} = {}) {
  const errors = [];
  for (let attempt = 0; attempt < DETACH_ATTEMPTS; attempt += 1) {
    if (!mounted(mountPoint)) return { detached: true, errors };
    try {
      detach(attempt < 2 ? ['detach', mountPoint] : ['detach', '-force', mountPoint]);
    } catch (error) {
      errors.push(error.message);
    }
    if (!mounted(mountPoint)) return { detached: true, errors };
    wait(2000);
  }
  return { detached: false, errors };
}

function verifyRelease(releaseDirectory, architecture) {
  if (process.platform !== 'darwin') fail('artifact verification must run on macOS');
  if (!SUPPORTED_ARCHITECTURES.includes(architecture)) {
    fail(`unsupported macOS architecture: ${architecture} (expected ${SUPPORTED_ARCHITECTURES.join(' or ')})`);
  }
  const releaseDir = path.resolve(releaseDirectory);
  const appPath = findApp(releaseDir);
  const dmgPath = path.join(releaseDir, `Nodus-mac-${architecture}.dmg`);
  const zipPath = path.join(releaseDir, `Nodus-mac-${architecture}.zip`);
  for (const required of [appPath, dmgPath, zipPath]) {
    if (!required || !existsSync(required)) fail(`missing release output: ${required ?? 'Nodus.app'}`);
  }

  const expected = verifyMacApp(appPath, { verifyEveryComponent: true });
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'nodus-macos-release-'));
  const zipOutput = path.join(scratch, 'zip');
  const mountPoint = path.join(scratch, 'dmg');
  let mounted = false;
  let verificationError = null;
  try {
    run('/bin/mkdir', ['-p', zipOutput, mountPoint]);
    run('/usr/bin/ditto', ['-x', '-k', zipPath, zipOutput]);
    const zippedApp = findApp(zipOutput);
    if (!zippedApp) fail('the ZIP does not contain Nodus.app');
    assertSameApp(zippedApp, expected, 'ZIP');

    run('/usr/bin/hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountPoint]);
    mounted = true;
    const dmgApp = findApp(mountPoint);
    if (!dmgApp) fail('the DMG does not contain Nodus.app');
    assertSameApp(dmgApp, expected, 'DMG');
  } catch (error) {
    verificationError = error;
  }

  // Cleanup never replaces the verdict: a verification failure is reported as
  // itself, and a volume that will not detach after a verification that passed
  // is a runner problem, not a reason to withhold signed, verified artifacts.
  const cleanup = mounted ? detachDiskImage(mountPoint) : { detached: true, errors: [] };
  if (cleanup.detached) {
    rmSync(scratch, { recursive: true, force: true });
  } else {
    console.warn(`::warning::Could not detach ${mountPoint}; leaving it for the runner to discard\n${cleanup.errors.join('\n')}`);
  }
  if (verificationError) throw verificationError;

  console.log(`[macOS release] Verified ${architecture} app, ZIP and DMG; publication may proceed`);
}

if (require.main === module) {
  verifyRelease(process.argv[2] ?? path.join(__dirname, '..', 'release'), process.argv[3]);
}

module.exports = { SUPPORTED_ARCHITECTURES, detachDiskImage, verifyRelease };
