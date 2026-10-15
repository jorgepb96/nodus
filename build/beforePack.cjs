const { execFileSync } = require('node:child_process');
const { cpSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');
const { buildServerWeb } = require('../scripts/packaged-server-web.cjs');

// clang names the Intel slice x86_64; electron-builder names it x64.
const CLANG_ARCHITECTURES = { arm64: 'arm64', x64: 'x86_64' };

exports.default = async function beforePack(context) {
  const root = path.join(__dirname, '..');
  if (context.electronPlatformName !== process.platform || Arch[context.arch] !== process.arch) {
    throw new Error('Managed Zotero runtime must be packaged on its native platform and architecture');
  }
  execFileSync(process.execPath, [path.join(root, 'scripts', 'prepare-zotero-mcp.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-third-party-licenses.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('[beforePack] Generated and verified third-party legal bundle');

  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-zotero-xpi.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('[beforePack] Built the canonical Zotero XPI');

  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-browser-extension.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('[beforePack] Built the canonical Chrome connector ZIP');

  // Basic mode serves the Nodus Server's web app from nodus-server/dist/web, which the `server`
  // extra resource copies from server/dist/web. It is a build output, never versioned, so it is
  // rebuilt for every packed app rather than trusting whatever an earlier checkout left there.
  // afterPack refuses an app that does not carry it.
  buildServerWeb(root);
  console.log('[beforePack] Built the Nodus Server web app');

  // Nodus Drift's recordings are not versioned in Git. They come from their pinned upstream commit,
  // each checked against its catalogued size and SHA-256, and one that is already in place and intact
  // is kept. afterPack then refuses an app that does not carry every one of them.
  execFileSync(process.execPath, [path.join(root, 'scripts', 'prepare-drift-assets.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('[beforePack] Prepared the Nodus Drift recordings');

  if (context.electronPlatformName !== 'darwin') return;
  require('../scripts/build-apple-calendar.cjs').buildAppleCalendar(Arch[context.arch]);
  require('../scripts/build-presenter-native.cjs').buildPresenterNative(Arch[context.arch]);
  require('../scripts/build-system-audio.cjs').buildSystemAudio(Arch[context.arch]);
  const source = path.join(__dirname, 'docktile');
  const output = path.join(__dirname, 'NodusDockTile.docktileplugin');
  const contents = path.join(output, 'Contents');
  const executable = path.join(contents, 'MacOS', 'NodusDockTilePlugin');

  // macOS ships as two single-architecture products, and this hook runs once
  // per architecture immediately before that architecture is packed. The Dock
  // tile plug-in is loaded by the Dock into the app's own process, so an
  // arm64-only bundle would silently stop drawing the badge inside the Intel
  // app. Compile it for whichever slice is being packed right now.
  const clangArchitecture = CLANG_ARCHITECTURES[Arch[context.arch]];
  if (!clangArchitecture) {
    throw new Error(`[beforePack] Unsupported macOS architecture: ${Arch[context.arch]}`);
  }

  rmSync(output, { recursive: true, force: true });
  mkdirSync(path.dirname(executable), { recursive: true });
  cpSync(path.join(source, 'Info.plist'), path.join(contents, 'Info.plist'));
  execFileSync('xcrun', [
    'clang', '-fobjc-arc', '-fmodules', '-bundle', '-arch', clangArchitecture,
    '-mmacosx-version-min=11.0', '-framework', 'Cocoa',
    path.join(source, 'NodusDockTilePlugin.m'), '-o', executable,
  ], { stdio: 'inherit' });
  console.log(`[beforePack] Built ${output} for ${Arch[context.arch]}`);
};
