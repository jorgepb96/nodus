// electron-builder afterPack hook. Release builds are signed later by the
// release-only custom signer; ad-hoc signing remains available solely for local
// development artifacts.
const { execFileSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');
const { assertServerWeb } = require('../scripts/packaged-server-web.cjs');
const { verifyPackagedNativeRuntime, assertBinaryArchitecture } = require('../scripts/verify-packaged-native-runtime.cjs');
const {
  packedLayout,
  stageAndVerifyOnDemandRuntimes,
  verifyPackagedNodeModules,
} = require('../scripts/verify-packaged-node-modules.cjs');
const {
  packagedExecutable,
  stagePackagedServerRuntime,
  verifyPackagedServerRuntime,
} = require('../scripts/packaged-server-runtime.cjs');

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename; // "Nodus"
  const appPath = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${appName}.app`)
    : context.appOutDir;
  const resourcesPath = context.electronPlatformName === 'darwin'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(appPath, 'resources');
  const generatedLegalPath = path.join(resourcesPath, 'legal', 'generated');

  // Electron's own MIT text and Chromium's third-party notices must survive on
  // every platform. electron-builder already keeps them on Windows/Linux, but
  // copying the verified bundle here also covers the macOS .app.
  const electronLicense = path.join(generatedLegalPath, 'ELECTRON_LICENSE.txt');
  const chromiumLicenses = path.join(generatedLegalPath, 'ELECTRON_CHROMIUM_LICENSES.html');
  if (!existsSync(electronLicense) || !existsSync(chromiumLicenses)) {
    throw new Error(`Missing generated Electron legal files in ${generatedLegalPath}`);
  }
  mkdirSync(resourcesPath, { recursive: true });
  copyFileSync(electronLicense, path.join(resourcesPath, 'LICENSE.electron.txt'));
  copyFileSync(chromiumLicenses, path.join(resourcesPath, 'LICENSES.chromium.html'));

  // Basic mode's server boots without its web app and only its /app, /view and published links
  // break, so nothing else would notice an app that lost the build beforePack made.
  assertServerWeb(path.join(resourcesPath, 'nodus-server', 'dist', 'web'), `The packed ${appName}`);

  // Every recording the catalogue approves must be inside the packed app.asar, intact, and nothing
  // else may be: an app that lost them (a failed download, an ignored directory) must not become an
  // installer. The legal record for them travels beside the app and is checked too.
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'verify-drift-assets.mjs'), '--asar', resourcesPath, '--require-all'], {
    stdio: 'inherit',
  });

  // Basic mode runs nodus-server/server.mjs with this app's own executable as Node, and the
  // extra resource that put it there carries the server's source and nothing it imports. Give it
  // its packages and the files it reaches beside it, then start it with the executable just
  // packed: a server that cannot load must stop the build, not surface on a user's machine as a
  // phone that never connects. Before signing, so everything staged here is signed with the app.
  const staged = await stagePackagedServerRuntime({ repoRoot: path.join(__dirname, '..'), resourcesPath });
  console.log(
    `[afterPack] Staged the Nodus Server runtime: ${staged.packages.length} packages `
    + `(${(staged.bytes / 1024 / 1024).toFixed(1)} MB), ${staged.outsideFiles.length + staged.migrationFiles.length} source files`,
  );
  const server = await verifyPackagedServerRuntime({ executable: packagedExecutable(context), resourcesPath });
  for (const line of server.passed) console.log(`[afterPack] Nodus Server: ${line}`);

  // node_modules is pruned to what the main process loads (build/packagedNodeModules.cjs).
  // Prove that nothing it loads went missing: every package must be packed, and must load
  // in the executable just packed, run as Node the same way the server check above runs it.
  const layout = packedLayout(context.appOutDir, context.electronPlatformName, appName, context.packager.executableName);
  verifyPackagedNodeModules(layout);
  // Codex and Copilot are downloaded at first use, from the tarballs this manifest pins.
  stageAndVerifyOnDemandRuntimes(layout, context.electronPlatformName, Arch[context.arch]);

  if (context.electronPlatformName !== 'darwin') return;

  // npm optional native packages follow the runner architecture, so each macOS
  // product must be packed on a host of its own architecture. Fail before
  // signing if the dependency tree does not match the slice being packed —
  // a mixed bundle installs fine and only breaks on the user's machine.
  verifyPackagedNativeRuntime(appPath, Arch[context.arch]);
  assertBinaryArchitecture('Apple Calendar', path.join(resourcesPath, 'apple-calendar', 'nodus-apple-calendar.node'), Arch[context.arch]);

  assertBinaryArchitecture('Trackpad', path.join(resourcesPath, 'trackpad-native', 'nodus-trackpad.node'), Arch[context.arch]);

  assertBinaryArchitecture('Presenter', path.join(resourcesPath, 'presenter-native', 'nodus-presenter-native'), Arch[context.arch]);

  if (process.env.NODUS_REQUIRE_MACOS_SIGNING === 'true') {
    console.log(`[afterPack] Deferred ${appPath} to the mandatory Developer ID signer`);
    return;
  }

  // This branch is never reachable from the GitHub release workflow. It makes
  // local/dev bundles launchable while remaining recognisably non-production.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`[afterPack] Ad-hoc signed ${appPath} (local/dev fallback)`);
};
