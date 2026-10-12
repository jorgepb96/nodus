import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseChannel } from './verify-release-channel.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-update-channels-'));
const bundle = path.join(outDir, 'updateChannel.cjs');

execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'electron/updateChannel.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=es2022',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });

const { applyUpdateChannel, availableUpdateVersion, isPrereleaseVersion } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('stable is the default preference and the beta choice is app-wide', async () => {
  const [types, defaults, prefs] = await Promise.all([
    read('shared/types.ts'),
    read('electron/db/settingsRepo.ts'),
    read('electron/db/appPrefs.ts'),
  ]);
  assert.match(types, /betaUpdates: boolean/);
  assert.match(defaults, /betaUpdates: false/);
  assert.match(prefs, /'betaUpdates'/);
});

test('selecting either feed keeps downgrades disabled', () => {
  for (const betaUpdates of [false, true]) {
    const updater = { channel: null, allowPrerelease: false, allowDowngrade: true };
    const channel = applyUpdateChannel(updater, betaUpdates);
    assert.equal(channel, betaUpdates ? 'beta' : 'latest');
    assert.equal(updater.channel, channel);
    assert.equal(updater.allowPrerelease, betaUpdates);
    assert.equal(updater.allowDowngrade, false);
  }
  assert.equal(isPrereleaseVersion('3.3.0-beta.1'), true);
  assert.equal(isPrereleaseVersion('3.3.0'), false);
});

test('a rejected older stable feed cannot become an update prompt in a beta build', () => {
  assert.equal(availableUpdateVersion({
    isUpdateAvailable: false,
    updateInfo: { version: '5.1.2' },
  }, '5.1.3-beta.4'), null);
  assert.equal(availableUpdateVersion({
    isUpdateAvailable: true,
    updateInfo: { version: '5.1.3' },
  }, '5.1.3-beta.4'), '5.1.3');
  assert.equal(availableUpdateVersion({
    isUpdateAvailable: true,
    updateInfo: { version: '5.1.3-beta.4' },
  }, '5.1.3-beta.4'), null);
});

test('opting out cancels a pending prerelease and blocks its installation', async () => {
  const [main, ipc] = await Promise.all([read('electron/main.ts'), read('electron/ipc.ts')]);
  assert.match(main, /activeUpdateCancellationToken\?\.cancel\(\)/);
  assert.doesNotMatch(main, /autoUpdater\.autoInstallOnAppQuit = (?!false)/, 'install-on-quit stays disabled across every channel');
  assert.match(main, /isPrereleaseVersion\(downloadedUpdateVersion\) && !getSettings\(\)\.betaUpdates/);
  assert.match(ipc, /updateChannelChanged\(next\.betaUpdates\)/);
});

test('beta installation is fail-closed behind a verified pre-update snapshot', async () => {
  const [main, backups, types] = await Promise.all([
    read('electron/main.ts'),
    read('electron/export/autoBackup.ts'),
    read('shared/types.ts'),
  ]);
  assert.match(main, /prerelease && !recoveryReady/);
  assert.match(main, /errorCode: 'pre-update-backup-required'/);
  assert.match(main, /await runPreUpdateBackupNow\(app\.getVersion\(\), targetVersion\)/);
  assert.match(main, /if \(!backup\.ok\)[\s\S]*if \(prerelease\)[\s\S]*pre-update-backup-failed/);
  assert.match(main, /if \(prerelease \|\| recoveryConfigured\)/, 'stable attempts the snapshot whenever a Recovery folder is configured');
  assert.match(main, /stable pre-update backup failed; continuing without blocking stable/, 'stable preserves its non-blocking contract');
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false/);
  assert.match(backups, /await verifyBackupFileInUtility\(target, password\)/, 'pre-update verification uses the backup utility process');
  assert.match(backups, /selectPreUpdateBackupsToPrune/);
  assert.match(types, /'backing-up'/);
});

test('the Settings opt-in is confirmed and checks immediately after acceptance', async () => {
  const settings = await read('src/views/Settings.tsx');
  assert.match(settings, /data-testid="toggle-beta-updates"/);
  assert.match(settings, /if \(event\.target\.checked\) setConfirmBetaUpdates\(true\)/);
  assert.match(settings, /await patch\(\{ betaUpdates: true \}\);\s*await checkForUpdates\(\);/);
  assert.match(settings, /recomendado únicamente para testers/);
  assert.match(settings, /pueden contener errores o ser inestables/);
  assert.match(settings, /Si Recuperación no está configurada o la copia falla, la beta no se instalará/);
});

test('stable and beta publication have isolated entry points and shared build logic', async () => {
  const [stable, beta, shared, pkgText] = await Promise.all([
    read('.github/workflows/release.yml'),
    read('.github/workflows/release-beta.yml'),
    read('.github/workflows/release-build.yml'),
    read('package.json'),
  ]);
  const pkg = JSON.parse(pkgText);
  assert.match(stable, /'!v\*-\*'/, 'stable tags explicitly exclude prereleases');
  assert.match(stable, /channel: latest/);
  assert.match(beta, /v\*-beta\.\*/);
  assert.match(beta, /channel: beta/);
  assert.match(stable, /uses: \.\/\.github\/workflows\/release-build\.yml/);
  assert.match(beta, /uses: \.\/\.github\/workflows\/release-build\.yml/);
  assert.equal(pkg.build.publish[0].channel, 'latest');
  assert.match(shared, /beta-mac\.yml beta\.yml beta-linux\.yml/);
  assert.match(shared, /Beta release contains stable update manifest/);
  assert.match(shared, /--prerelease --latest=false/);
  assert.match(shared, /- os: macos-latest/, 'Apple silicon packaging runs on an ARM64 host for native optional dependencies');
  assert.match(shared, /- os: macos-15-intel/, 'Intel packaging runs on an Intel host for native optional dependencies');
  assert.match(shared, /platform: '--mac --arm64'/, 'each macOS runner packs exactly one architecture');
  assert.match(shared, /platform: '--mac --x64'/, 'each macOS runner packs exactly one architecture');
  // Neither macOS runner may publish <channel>-mac.yml: each one lists only its
  // own files, so the second upload would decide which architecture can still
  // update itself. One job merges them and publication waits for it.
  assert.match(shared, /merge-mac-manifest:/, 'the two macOS manifests are merged into the published one');
  assert.match(shared, /needs\.merge-mac-manifest\.result == 'success'/, 'publication waits for the merged manifest');
  assert.match(shared, /merge-mac-update-manifest\.mjs/, 'the merge job runs the audited merger');
  assert.match(shared, /node node_modules\/electron\/install\.js/, 'release runners install Electron legal files before packaging');
  assert.match(shared, /gh release create[\s\S]*--draft/, 'the workflow creates one explicit draft before native builds');
  assert.match(shared, /upload-release-assets\.mjs/, 'all platforms upload to the explicit shared draft');
  assert.doesNotMatch(shared, /--publish always/, 'electron-builder cannot create competing draft releases');

  const lock = JSON.parse(await read('package-lock.json'));
  const nativePackages = [
    '@esbuild/darwin-arm64',
    '@esbuild/darwin-x64',
    '@esbuild/linux-x64',
    '@esbuild/win32-x64',
    '@github/copilot-darwin-arm64',
    '@github/copilot-darwin-x64',
    '@github/copilot-linux-x64',
    '@github/copilot-win32-x64',
    '@img/sharp-darwin-arm64',
    '@img/sharp-darwin-x64',
    '@img/sharp-libvips-darwin-arm64',
    '@img/sharp-libvips-darwin-x64',
    '@img/sharp-linux-x64',
    '@img/sharp-win32-x64',
    '@koromix/koffi-darwin-arm64',
    '@koromix/koffi-darwin-x64',
    '@koromix/koffi-linux-x64',
    '@koromix/koffi-win32-x64',
    '@napi-rs/canvas-darwin-arm64',
    '@napi-rs/canvas-darwin-x64',
    '@napi-rs/canvas-linux-x64-gnu',
    '@napi-rs/canvas-win32-x64-msvc',
    '@openai/codex-darwin-arm64',
    '@openai/codex-darwin-x64',
    '@openai/codex-linux-x64',
    '@openai/codex-win32-x64',
    '@rollup/rollup-darwin-arm64',
    '@rollup/rollup-darwin-x64',
    '@rollup/rollup-linux-x64-gnu',
    '@rollup/rollup-win32-x64-msvc',
  ];
  for (const packageName of nativePackages) {
    const entry = lock.packages[`node_modules/${packageName}`];
    assert.ok(entry, `${packageName} is locked for release runners`);
    assert.ok(entry.resolved, `${packageName} has a deterministic tarball URL`);
    assert.ok(entry.integrity, `${packageName} has a deterministic integrity hash`);
  }
  assert.equal(lock.packages['node_modules/@koromix/koffi-darwin-arm64'].version, '3.1.1');
  assert.equal(
    lock.packages['node_modules/@koromix/koffi-darwin-x64'].version,
    lock.packages['node_modules/@koromix/koffi-darwin-arm64'].version,
    'both macOS runners must resolve the same Koffi release',
  );
  assert.equal(
    lock.packages['node_modules/@rollup/rollup-darwin-arm64'].version,
    lock.packages['node_modules/rollup'].version,
    'the native Rollup binary must exactly match the locked JavaScript package',
  );

  const configPath = require.resolve(path.join(repoRoot, 'build/electron-builder.release.cjs'));
  const previousChannel = process.env.NODUS_RELEASE_CHANNEL;
  process.env.NODUS_RELEASE_CHANNEL = 'beta';
  delete require.cache[configPath];
  const betaConfig = require(configPath);
  assert.equal(betaConfig.publish[0].channel, 'beta');
  if (previousChannel === undefined) delete process.env.NODUS_RELEASE_CHANNEL;
  else process.env.NODUS_RELEASE_CHANNEL = previousChannel;
});

test('release version validation cannot cross channels', () => {
  assert.doesNotThrow(() => validateReleaseChannel('latest', 'v3.3.0', '3.3.0'));
  assert.doesNotThrow(() => validateReleaseChannel('beta', 'v3.3.0-beta.2', '3.3.0-beta.2'));
  assert.throws(() => validateReleaseChannel('latest', 'v3.3.0-beta.2', '3.3.0-beta.2'));
  assert.throws(() => validateReleaseChannel('beta', 'v3.3.0', '3.3.0'));
  assert.throws(() => validateReleaseChannel('beta', 'v3.3.0-beta.3', '3.3.0-beta.2'));
});

test('desktop betas keep the Chrome connector on its Manifest V3 base version', async () => {
  const [pkg, manifest, builder] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('browser-extension/manifest.json').then(JSON.parse),
    read('scripts/build-browser-extension.mjs'),
  ]);
  assert.equal(manifest.version, pkg.version.replace(/-beta\.\d+$/, ''));
  assert.match(builder, /const connectorVersion = pkg\.version\.replace\(\/-beta\\\.\\d\+\$\/, ''\)/);
  assert.match(builder, /manifest\.version !== connectorVersion/);
});
